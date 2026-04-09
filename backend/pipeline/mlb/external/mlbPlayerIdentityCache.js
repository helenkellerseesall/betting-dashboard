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
      .filter(Boolean)
  }
}

async function mergeMlbPlayerIdentityCache({ candidates = [] } = {}) {
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
  let added = 0

  for (const candidate of safeCandidates) {
    const key = String(candidate.playerKey || "").trim()
    if (!key) continue

    if (!Array.isArray(playersByPlayerKey[key])) {
      playersByPlayerKey[key] = []
    }

    const duplicate = playersByPlayerKey[key].some((existing) => {
      const sameName = String(existing?.playerName || "") === String(candidate.playerName || "")
      const sameTeam = String(existing?.teamResolved || "") === String(candidate.teamResolved || "")
      return sameName && sameTeam
    })

    if (duplicate) continue
    playersByPlayerKey[key].push(candidate)
    added += 1
  }

  const pruned = {}
  for (const [playerKey, rows] of Object.entries(playersByPlayerKey)) {
    pruned[playerKey] = normalizeArray(rows).slice(0, 10)
  }

  await writeIdentityCacheFile({
    savedAt: Date.now(),
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