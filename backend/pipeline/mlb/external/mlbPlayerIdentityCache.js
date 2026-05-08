"use strict"

const fs = require("fs")
const path = require("path")

const MLB_PLAYER_IDENTITY_CACHE_PATH = path.join(__dirname, "../../../mlb-player-identity-cache.json")

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : []
}

async function readIdentityCacheFile() {
  try {
    const raw = await fs.promises.readFile(MLB_PLAYER_IDENTITY_CACHE_PATH, "utf8")
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return normalizeObject(parsed)
  } catch (error) {
    if (error && error.code === "ENOENT") return {}
    return {}
  }
}

async function writeIdentityCacheFile(payload) {
  const safePayload = normalizeObject(payload)
  await fs.promises.writeFile(MLB_PLAYER_IDENTITY_CACHE_PATH, JSON.stringify(safePayload))
}

async function getMlbPlayerIdentityCache() {
  const cache = await readIdentityCacheFile()
  return {
    savedAt: Number(cache.savedAt || 0) || null,
    playersByPlayerKey: normalizeObject(cache.playersByPlayerKey)
  }
}

// Eviction: candidates older than this many days are considered stale and deprioritized.
const IDENTITY_CACHE_EVICT_DAYS = 30
// Soft-stale: candidates older than this many days are moved behind fresh candidates.
const IDENTITY_CACHE_SOFT_STALE_DAYS = 7

function nowMs() {
  return Date.now()
}

function toCandidate(value) {
  if (!value || typeof value !== "object") return null
  const playerName = String(value.playerName || "").trim()
  const playerKey = String(value.playerKey || "").trim()
  if (!playerName || !playerKey) return null

  return {
    playerIdExternal: value.playerIdExternal ?? null,
    playerName,
    playerKey,
    teamResolved: String(value.teamResolved || "").trim() || null,
    teamCode: String(value.teamCode || "").trim() || null,
    source: String(value.source || "identity-cache").trim() || "identity-cache",
    eventIds: normalizeArray(value.eventIds)
      .map((eventId) => String(eventId || "").trim())
      .filter(Boolean),
    // Timestamp when this candidate was first observed — used for eviction.
    firstSeenAt: value.firstSeenAt ?? null,
    // Timestamp when this candidate was last confirmed on a current slate.
    lastSeenAt: value.lastSeenAt ?? null,
  }
}

/**
 * Evict hard-stale entries (> IDENTITY_CACHE_EVICT_DAYS since lastSeenAt).
 * Entries with no lastSeenAt are kept (we cannot know when they were observed).
 */
function evictStaleEntries(rows, nowTimestamp) {
  const cutoff = nowTimestamp - IDENTITY_CACHE_EVICT_DAYS * 24 * 60 * 60 * 1000
  return rows.filter((row) => {
    if (!row.lastSeenAt) return true  // no timestamp → keep (conservative)
    return Number(row.lastSeenAt) >= cutoff
  })
}

/**
 * Sort candidates so the most-recently-seen current-slate entry wins.
 * Priority order (ascending = lower index = higher priority):
 *   1. Candidate whose eventIds overlap currentEventIds (current slate match)
 *   2. Candidate with lastSeenAt within SOFT_STALE_DAYS (recently confirmed)
 *   3. All others (oldest last)
 *
 * This ensures that when a player changes teams, the new-team candidate
 * from today's slate is always at index 0 — without any hardcoding.
 */
function sortCandidatesByFreshness(rows, currentEventIds, nowTimestamp) {
  const softStaleCutoff = nowTimestamp - IDENTITY_CACHE_SOFT_STALE_DAYS * 24 * 60 * 60 * 1000
  const currentSet = new Set(normalizeArray(currentEventIds).map(String).filter(Boolean))

  function priority(row) {
    const eventMatch = currentSet.size > 0 &&
      normalizeArray(row.eventIds).some((id) => currentSet.has(String(id)))
    if (eventMatch) return 0

    const lastSeen = Number(row.lastSeenAt || 0)
    if (lastSeen >= softStaleCutoff) return 1

    return 2
  }

  return [...rows].sort((a, b) => priority(a) - priority(b))
}

async function mergeMlbPlayerIdentityCache({ candidates = [], currentEventIds = [] } = {}) {
  const safeCandidates = normalizeArray(candidates).map(toCandidate).filter(Boolean)
  if (safeCandidates.length === 0) {
    const existing = await getMlbPlayerIdentityCache()
    return {
      added: 0,
      totalKeys: Object.keys(existing.playersByPlayerKey || {}).length
    }
  }

  const cache = await readIdentityCacheFile()
  const playersByPlayerKey = normalizeObject(cache.playersByPlayerKey)
  const now = nowMs()
  let added = 0

  for (const candidate of safeCandidates) {
    const key = String(candidate.playerKey || "").trim()
    if (!key) continue

    if (!Array.isArray(playersByPlayerKey[key])) {
      playersByPlayerKey[key] = []
    }

    // Find an existing entry with same player name + same team (dedup by identity).
    const existingIdx = playersByPlayerKey[key].findIndex((existing) => {
      const sameName = String(existing?.playerName || "") === String(candidate.playerName || "")
      const sameTeam = String(existing?.teamResolved || "") === String(candidate.teamResolved || "")
      return sameName && sameTeam
    })

    if (existingIdx >= 0) {
      // Update lastSeenAt and merge any new eventIds onto the existing entry.
      const existing = playersByPlayerKey[key][existingIdx]
      const mergedEventIds = Array.from(
        new Set([
          ...normalizeArray(existing.eventIds),
          ...normalizeArray(candidate.eventIds),
        ])
      )
      playersByPlayerKey[key][existingIdx] = {
        ...existing,
        eventIds: mergedEventIds,
        lastSeenAt: now,
      }
    } else {
      // New candidate — stamp firstSeenAt and lastSeenAt.
      playersByPlayerKey[key].push({
        ...candidate,
        firstSeenAt: candidate.firstSeenAt ?? now,
        lastSeenAt: now,
      })
      added += 1
    }
  }

  // Evict hard-stale entries, sort by freshness, then cap at 10 per player.
  const currentEventIdsNorm = normalizeArray(currentEventIds).map(String).filter(Boolean)
  const pruned = {}
  for (const [playerKey, rows] of Object.entries(playersByPlayerKey)) {
    const evicted = evictStaleEntries(normalizeArray(rows), now)
    const sorted = sortCandidatesByFreshness(evicted, currentEventIdsNorm, now)
    pruned[playerKey] = sorted.slice(0, 10)
  }

  await writeIdentityCacheFile({
    savedAt: now,
    playersByPlayerKey: pruned
  })

  return {
    added,
    totalKeys: Object.keys(pruned).length
  }
}

module.exports = {
  getMlbPlayerIdentityCache,
  mergeMlbPlayerIdentityCache,
  MLB_PLAYER_IDENTITY_CACHE_PATH
}