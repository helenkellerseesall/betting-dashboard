"use strict"

/**
 * Phase 1 — Teammate Absence + Usage Redistribution V1 (Session AS).
 *
 * Real teammate-context deriver. NO injury feed required (none exists in repo
 * yet — see audit). Instead, cross-references the per-player game logs from
 * Session AQ with the current tonight's-slate snapshot rows to infer:
 *
 *   1. likely_absent_teammates — players who appeared in their team's last N
 *      games (≥3 of last 5, ≥15 min/game recent average) but have NO prop on
 *      tonight's snapshot for their team. High-signal absence — sportsbooks
 *      generally don't list confirmed-out players.
 *
 *   2. per-stat redistribution — for each player P on tonight's slate, split
 *      P's game logs into:
 *         with_absent_games  : games where any flagged absent teammate was
 *                              ALSO absent (cross-ref: that teammate has no
 *                              log entry on the game's date)
 *         baseline_games     : games where all flagged absent teammates WERE
 *                              present (had log entries on the date)
 *      Then compute per-stat (minutes, points, rebounds, assists, threes, fga)
 *      delta = avg_with_absent - avg_baseline. Honest null when sample < 2 in
 *      either bucket.
 *
 * Sample-quality dampening + bounded shift cap enforce the user's mandate:
 * "widen contextual possibility, NOT create fake certainty" ; "star OUT ≠ lock".
 *
 * Data sources (all REAL, all already in repo):
 *   - data/nbaPlayerGameLogs.json (Session AQ ESPN populator)
 *   - tonight's snapshot.json (slate cross-reference)
 *   - data/nbaPlayerProjections.json (player→team fallback when cache team missing)
 *
 * Public surface:
 *   buildTeammateContextForSlate(snapshotRows) → SlateContext (build once per request)
 *   getTeammateContext(slateContext, player) → row-level teammate context | null
 *   enrichRowWithTeammateContext(row, slateContext) → mutates row, returns row
 */

const fs   = require("fs")
const path = require("path")

const CACHE_PATH = path.join(__dirname, "..", "..", "data", "nbaPlayerGameLogs.json")
const PROJ_PATH  = path.join(__dirname, "..", "..", "data", "nbaPlayerProjections.json")

// === Constants — sample-quality + influence-not-dominate gates ===
const RECENT_PLAY_WINDOW           = 5     // games window used for "recently active"
const RECENT_PLAY_MIN_GAMES        = 3     // must have played ≥ 3 of last 5
// Tiered absence detection — confidence-tagged so downstream can decide.
// 18+ min recent → HIGH confidence (definitely a rotation-impact player)
// 12-18 min      → MEDIUM (role player; absence may or may not redistribute usage materially)
// < 12 min       → not flagged (deep bench; absence-from-slate doesn't imply OUT)
const RECENT_MINUTES_HIGH_CONF     = 18
const RECENT_MINUTES_MED_CONF      = 12
const MAX_DAYS_STALE               = 30
const MIN_SAMPLE_FOR_REDIST        = 2     // need ≥ 2 with-absent AND ≥ 2 baseline for valid delta
const SHRINKAGE_FULL_AT            = 5     // sample-quality dampening: full weight at ≥ 5/bucket
const MAX_REDIST_SHIFT_PP          = 0.030 // hard cap: max ±3 pp modelProb shift from teammate context

// Stats we extract per game from cache
const STATS_TRACKED = ["minutes", "points", "rebounds", "assists", "threes", "fga"]

// Map snapshot statFamily → cache stat key
function statFamilyToCacheKey(fam) {
  const f = String(fam || "").toLowerCase().replace(/[\s_]+/g, "")
  if (/three/.test(f) || f.includes("3pt")) return "threes"
  if (/point.*rebound.*assist|pra/.test(f)) return null  // PRA not directly summable from boxscore
  if (f.includes("rebound")) return "rebounds"
  if (f.includes("assist"))  return "assists"
  if (f.includes("point"))   return "points"
  if (f.includes("minute"))  return "minutes"
  return null
}

// === Helpers ===

function normPlayer(s) { return String(s || "").trim().toLowerCase() }
function normTeam(s)   { return String(s || "").trim().toLowerCase() }
function todayIso()    { return new Date().toISOString().slice(0, 10) }

function daysBetween(isoA, isoB) {
  const a = new Date(isoA + "T00:00:00Z").getTime()
  const b = new Date(isoB + "T00:00:00Z").getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((b - a) / (1000 * 60 * 60 * 24))
}

function avg(arr) {
  const a = arr.filter((x) => Number.isFinite(x))
  if (!a.length) return null
  return a.reduce((s, x) => s + x, 0) / a.length
}

function readJsonSafe(p, fb) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf8")) } catch { return fb }
}

// === Cache load (lightweight in-memory, rebuilt per slate-context build) ===

function loadGameLogCache() {
  const raw = readJsonSafe(CACHE_PATH, { players: {} })
  return raw?.players || {}
}

function loadProjectionsTeamMap() {
  const raw = readJsonSafe(PROJ_PATH, { players: {} })
  const out = new Map()
  for (const [pk, v] of Object.entries(raw?.players || {})) {
    if (v?.team) out.set(normPlayer(pk), v.team)
  }
  return out
}

// Resolve a player's team. Priority: cache.team → projections → null.
function resolvePlayerTeam(playerKey, cache, projTeamMap) {
  const c = cache[playerKey]
  if (c?.team) return c.team
  const p = projTeamMap.get(playerKey)
  return p || null
}

// === Slate-level context build ===

/**
 * Build per-game per-team rosters from tonight's snapshot rows + game-log cache.
 * One pass per request.
 *
 * @param {Array<object>} snapshotRows  rows from snapshot.json
 * @returns {{
 *   cache: object,                                     // game-log cache
 *   projTeamMap: Map<string,string>,                   // player→team fallback
 *   slateRosterByTeam: Map<string, Set<string>>,       // teamLower → set of playerLower with props tonight
 *   absenceByTeam:    Map<string, Array<{playerKey, recentMinutes, recentGames}>>,
 *                                                      // teamLower → list of likely-absent recent-active
 *   absenceLookupByPlayer: Map<string, Array<{playerKey,recentMinutes}>>,
 *                                                      // playerLower → list of THEIR teammates who are absent tonight
 * }}
 */
function buildSlateContextFromSnapshot(snapshotRows) {
  const cache = loadGameLogCache()
  const projTeamMap = loadProjectionsTeamMap()
  const today = todayIso()

  // Step 1: identify NBA props on tonight's slate, group by team.
  const slateRosterByTeam = new Map()
  const slateTeamsObserved = new Set()
  const slatePlayersInGames = new Map()  // gameEventId → Set<playerLower>
  const teamsForGame = new Map()         // gameEventId → {home, away}

  for (const r of snapshotRows || []) {
    if (!r || !r.player || !r.eventId) continue
    const player = normPlayer(r.player)
    if (!player) continue
    const home = r.homeTeam, away = r.awayTeam
    if (!home || !away) continue

    if (!teamsForGame.has(r.eventId)) teamsForGame.set(r.eventId, { home, away })
    if (!slatePlayersInGames.has(r.eventId)) slatePlayersInGames.set(r.eventId, new Set())
    slatePlayersInGames.get(r.eventId).add(player)

    // Resolve player team via cache→projections
    const team = resolvePlayerTeam(player, cache, projTeamMap)
    if (!team) continue
    const tk = normTeam(team)
    slateTeamsObserved.add(tk)
    if (!slateRosterByTeam.has(tk)) slateRosterByTeam.set(tk, new Set())
    slateRosterByTeam.get(tk).add(player)
  }

  // Step 2: find likely-absent teammates per team.
  // For each team on tonight's slate, look at cache for players who:
  //   (a) played ≥ RECENT_PLAY_MIN_GAMES of last RECENT_PLAY_WINDOW
  //   (b) averaged ≥ RECENT_MINUTES_MED_CONF minutes
  // If they're NOT in tonight's slate roster, flag absent with confidence tier.
  const absenceByTeam = new Map()
  for (const [tk, slateRoster] of slateRosterByTeam) {
    const teamMembers = []
    for (const [pk, entry] of Object.entries(cache)) {
      const teamRaw = entry?.team
      if (!teamRaw) continue
      if (normTeam(teamRaw) !== tk) continue
      const games = (entry.games || []).filter((g) => {
        const d = daysBetween(g.date, today)
        return Number.isFinite(d) && d <= MAX_DAYS_STALE
      })
      const recentGames = games.slice(0, RECENT_PLAY_WINDOW)
      const minutesArr = recentGames.map((g) => Number(g?.stats?.minutes)).filter(Number.isFinite)
      const recentMinutes = avg(minutesArr) ?? 0
      if (recentGames.length < RECENT_PLAY_MIN_GAMES) continue
      if (recentMinutes < RECENT_MINUTES_MED_CONF) continue
      const confidence = recentMinutes >= RECENT_MINUTES_HIGH_CONF ? "high" : "medium"
      teamMembers.push({ playerKey: pk, recentMinutes, recentGames: recentGames.length, confidence })
    }
    // Likely absent = team member NOT in slate roster
    const absent = teamMembers.filter((m) => !slateRoster.has(m.playerKey))
    if (absent.length) absenceByTeam.set(tk, absent)
  }

  // Step 3: build per-player absence lookup (for any player on tonight's slate,
  // what teammates of theirs are likely absent tonight).
  const absenceLookupByPlayer = new Map()
  for (const [tk, absent] of absenceByTeam) {
    const slateRoster = slateRosterByTeam.get(tk)
    if (!slateRoster) continue
    for (const pk of slateRoster) {
      absenceLookupByPlayer.set(pk, absent)
    }
  }

  return { cache, projTeamMap, slateRosterByTeam, absenceByTeam, absenceLookupByPlayer, teamsForGame }
}

// === Per-row redistribution computation ===

/**
 * For player P with absent teammates [Y1, Y2, ...], split P's games into
 * "with_absent" (any of Y_i was also absent that day) vs "baseline" (all Y_i
 * were present that day). Returns per-stat delta + sample sizes.
 *
 * @returns {{ stats: { [stat]: { with_absent_avg, baseline_avg, delta, sample_with, sample_baseline } },
 *             absent_teammates: string[] }}
 */
function computeRedistributionForPlayer(playerKey, absentTeammates, cache) {
  const entry = cache[playerKey]
  if (!entry || !Array.isArray(entry.games) || !absentTeammates.length) return null
  const today = todayIso()

  // For each absent teammate, build set of dates where they DID play (from THEIR cache).
  const teammatePresentDates = new Map()
  for (const at of absentTeammates) {
    const tEntry = cache[at.playerKey]
    if (!tEntry || !Array.isArray(tEntry.games)) {
      teammatePresentDates.set(at.playerKey, new Set())  // unknown; treat as never-present (conservative)
      continue
    }
    teammatePresentDates.set(at.playerKey, new Set(tEntry.games.map((g) => g.date)))
  }

  // Split P's games
  const withAbsent = []   // games where at least one absent teammate was also absent that day
  const baseline   = []   // games where ALL absent teammates were present
  for (const g of entry.games) {
    const days = daysBetween(g.date, today)
    if (!Number.isFinite(days) || days > MAX_DAYS_STALE) continue
    let anyTeammateAbsent = false
    let allTeammatesPresent = true
    for (const at of absentTeammates) {
      const present = teammatePresentDates.get(at.playerKey)?.has(g.date)
      if (!present) {
        anyTeammateAbsent = true
        allTeammatesPresent = false
      }
    }
    if (anyTeammateAbsent) withAbsent.push(g)
    else if (allTeammatesPresent) baseline.push(g)
  }

  if (withAbsent.length < MIN_SAMPLE_FOR_REDIST || baseline.length < MIN_SAMPLE_FOR_REDIST) return null

  const statDeltas = {}
  for (const stat of STATS_TRACKED) {
    const withVals = withAbsent.map((g) => Number(g?.stats?.[stat])).filter(Number.isFinite)
    const baseVals = baseline  .map((g) => Number(g?.stats?.[stat])).filter(Number.isFinite)
    if (withVals.length < MIN_SAMPLE_FOR_REDIST || baseVals.length < MIN_SAMPLE_FOR_REDIST) continue
    const a = avg(withVals)
    const b = avg(baseVals)
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    statDeltas[stat] = {
      with_absent_avg: Number(a.toFixed(2)),
      baseline_avg:    Number(b.toFixed(2)),
      delta:           Number((a - b).toFixed(2)),
      sample_with:     withVals.length,
      sample_baseline: baseVals.length,
    }
  }

  return {
    stats: statDeltas,
    absent_teammates: absentTeammates.map((x) => x.playerKey),
  }
}

// === Public reader / enricher ===

/**
 * Get teammate context for one row.
 */
function getTeammateContext(slateContext, player) {
  if (!slateContext || !player) return null
  const pk = normPlayer(player)
  const absent = slateContext.absenceLookupByPlayer.get(pk)
  if (!absent || !absent.length) return null
  const redist = computeRedistributionForPlayer(pk, absent, slateContext.cache)
  if (!redist) {
    // Surface the absence even if redistribution sample is thin.
    return {
      absent_teammates: absent.map((x) => x.playerKey),
      absence_count:    absent.length,
      redistribution:   null,
      sample_quality:   "insufficient",
      source:           "espn_logs_x_slate_cross_ref",
    }
  }
  return {
    absent_teammates: redist.absent_teammates,
    absence_count:    redist.absent_teammates.length,
    redistribution:   redist.stats,
    sample_quality:   "ok",
    source:           "espn_logs_x_slate_cross_ref",
  }
}

/**
 * Mutate row to inject:
 *   - row.teammateContext  structured object (always when context present, even if sample thin)
 *   - bounded modelProb shift via row.teammateRedistShift  (number, in probability units, capped)
 *
 * The shift is consumed by the workstation's modelProb path via a thin
 * adapter: we expose teammateRedistShift on the row, and the prediction
 * core's nbaRowIndependentModelProbability picks it up exactly like the
 * matchup adjustment from Session AO. To avoid coupling, the actual addition
 * happens in nbaModelSignals (next session) — for now this enricher SETS the
 * shift value but does not modify modelProb directly. The adjustment is added
 * downstream so all four context layers (matchup + recent-form + role +
 * teammate) compose through the same honestWeightedScore re-normalization.
 *
 * Sample-quality cap + per-row hard cap: ±MAX_REDIST_SHIFT_PP (3 pp).
 *
 * Returns row.
 */
function enrichRowWithTeammateContext(row, slateContext) {
  if (!row || !slateContext) return row
  const player = row.player || row.playerName
  if (!player) return row
  const ctx = getTeammateContext(slateContext, player)
  if (!ctx) return row
  row.teammateContext = ctx

  // Redistribution shift: only when sample sufficient AND we have a stat-relevant delta.
  if (!ctx.redistribution) {
    row.teammateRedistShift = 0
    return row
  }
  const statKey = statFamilyToCacheKey(row.statFamily || row.propType)
  if (!statKey) {
    row.teammateRedistShift = 0
    return row
  }
  const r = ctx.redistribution[statKey]
  if (!r || !Number.isFinite(r.delta)) {
    row.teammateRedistShift = 0
    return row
  }

  // Convert stat delta → modelProb shift (probability units).
  // Use the same scale nbaModelSignals uses for formZ:
  //   formZ scale = max(2.5, anchor * 0.28).
  // anchor by family (rough): assists 4.2, rebounds 6.0, points 18, threes 1.8.
  const anchor =
    statKey === "threes"   ? 1.8 :
    statKey === "assists"  ? 4.2 :
    statKey === "rebounds" ? 6.0 :
    statKey === "points"   ? 18.0 :
    statKey === "minutes"  ? 30.0 :
    8.0
  const scale = Math.max(2.5, anchor * 0.28)
  const rawShiftMagnitude = Math.abs(r.delta) / scale  // unitless ~ z-score-ish

  // Sample-quality dampening: full influence only at ≥ SHRINKAGE_FULL_AT in BOTH buckets.
  const minSample = Math.min(r.sample_with, r.sample_baseline)
  const quality = Math.max(0, Math.min(1, minSample / SHRINKAGE_FULL_AT))

  // Final magnitude: capped at MAX_REDIST_SHIFT_PP. Side-aware: positive delta
  // means stat goes UP when teammate absent → boost overs / suppress unders.
  const directionFromStat = r.delta >= 0 ? +1 : -1
  const side = String(row.side || "").toLowerCase()
  const sideAware = side === "under" ? -directionFromStat : directionFromStat

  const shift = sideAware * Math.min(rawShiftMagnitude * 0.5 * quality, MAX_REDIST_SHIFT_PP)
  row.teammateRedistShift = Number(shift.toFixed(4))
  // Surface stat key + delta on the context for downstream visibility
  row.teammateContext = Object.assign({}, ctx, {
    applied_stat: statKey,
    applied_delta: r.delta,
    applied_shift_pp: Number((shift * 100).toFixed(2)),
    applied_sample_quality: Number(quality.toFixed(2)),
  })
  return row
}

module.exports = {
  buildSlateContextFromSnapshot,
  getTeammateContext,
  enrichRowWithTeammateContext,
  // exposed constants for tests
  RECENT_PLAY_WINDOW,
  RECENT_PLAY_MIN_GAMES,
  RECENT_MINUTES_HIGH_CONF,
  RECENT_MINUTES_MED_CONF,
  MIN_SAMPLE_FOR_REDIST,
  MAX_REDIST_SHIFT_PP,
}
