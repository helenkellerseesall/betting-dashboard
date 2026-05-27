"use strict"

console.log("ACTIVE:", __filename)

/**
 * NBA HTTP handlers — no `new Function`, no eval, no compiled `nbaRefreshSnapshot.inlined.js`.
 * Snapshot refresh uses `pipeline/nba/fetchNbaOddsSnapshot` (Odds API v4, same pattern as MLB bootstrap).
 */

const path = require("path")
const fs = require("fs")

const { buildNbaOpportunityBoard } = require("../pipeline/nba/buildNbaOpportunityBoard")
const { classifyNbaTier } = require("../pipeline/nba/nbaTierClassifier")
const { buildNbaInsightBoard } = require("../pipeline/nba/buildNbaInsightBoard")
const {
  buildNbaBoardSlicesFromSnapshot,
  loadNbaSnapshotFromDisk,
} = require("../pipeline/nba/buildNbaBoardSlicesFromSnapshot")
const { fetchNbaOddsSnapshot, saveNbaSnapshotToDisk } = require("../pipeline/nba/fetchNbaOddsSnapshot")

// Session BD — Longitudinal Freeze Pipeline Audit.
// Lazy require so a module-load failure here cannot block the snapshot path.
// freezePredictionEpoch is invoked AFTER replaceOddsSnapshot succeeds so the
// bestProps generation cycle creates immutable observational records:
//   - 1 row in prediction_epochs (epoch keyed on snap.updatedAt)
//   - 1 row per bestProp in prediction_snapshots
//   - 1 row per bestProp in frozen_contextual_states
// Contextual columns will be NULL on this path (snapshot-bestProps are not
// contextually enriched — that's only done in workstationRoutes.js for the
// /api/ws/state cache-miss). final_model_prob + final_edge ARE captured.
// This is HONEST sparsity, not synthetic richness — every NULL means the
// corresponding contextual layer did not fire for this prediction at this
// epoch. The /api/ws/state freeze path remains in place and writes RICHER
// contextual rows for the same predictions when invoked.
function _lazyFreezePredictionEpoch(args) {
  try {
    const { freezePredictionEpoch } = require("../pipeline/memory/freezePredictionEpoch")
    return freezePredictionEpoch(args)
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}

// Compute the Detroit-keyed slate date (matches buildSlateEvents semantics)
// without taking a hard dependency on that module here.
function _detroitSlateDateKey(value) {
  const date = new Date(value || Date.now())
  if (!Number.isFinite(date.getTime())) return new Date().toISOString().slice(0, 10)
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Detroit",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date)
}

// Workstation intelligence modules — used to build featured boards + AI slips
// from the same snapshot pool that feeds the insight board.
const { nbaRowModelProbability, nbaRowEdge } = require("../pipeline/nba/nbaModelSignals")
const { diversifyCandidates } = require("../pipeline/shared/buildCandidateDiversity")
const { buildFeaturedPlays } = require("../pipeline/shared/buildFeaturedPlays")
const { buildAiSlips } = require("../pipeline/shared/buildSlipAi")

// 2026-05-26 — Canonical NBA recentForm source. ESPN gameLogs (populated by
// scripts/populateNbaGameLogs.js) is the single authority. The api-sports
// integration that used to live in this file was a duplicate path that
// produced identical data; operator killed api-basketball subscription
// 2026-05-26 to remove the shadow. See feedback_no_spiral.md.
const { enrichRowWithRecentForm: enrichNbaRowFromEspn } = require("../pipeline/nba/nbaRecentFormCache")

const DEFAULT_BACKEND_ROOT = path.join(__dirname, "..")
const API_SPORTS_CACHE_FILE = path.join(DEFAULT_BACKEND_ROOT, "api-sports-cache.json")

// ─────────────────────────────────────────────────────────────────────────────
// Phase F5 — API-Sports request-contract correction.
//
// API-Sports NBA v2 /players?search=<name> requires the `season` parameter.
// Pre-F5 the search endpoint was called WITHOUT season → API responded
// HTTP 200, response:[], errors:{ "required":"season is required" } silently,
// which the code treated as "no match" and propagated as
// PLAYER_ID_API_RETURNED_NULL.
//
// Shared constant so player-id lookup AND player-stats lookup reference the
// SAME season authority. API-Sports convention: season=YYYY means the
// YYYY-(YYYY+1) NBA season (e.g., 2025 means 2025-26).
// ─────────────────────────────────────────────────────────────────────────────
const NBA_API_SPORTS_SEASON = 2025

// ─────────────────────────────────────────────────────────────────────────────
// Phase F6.2 — canonical NBA team registry + dual resolver.
//
// Upstream contract finally settled after live diagnostics:
//   API-Sports v2 NBA `/players` requires `team` AS A NUMERIC TEAM ID.
//   (Abbreviations and full names are silently rejected with HTTP 200 +
//   "Team field is required" or empty response.)
//
// The enrichment row context at this layer carries `row.team` as a free-form
// display value — observed values include "SACRAMENTO KINGS", "Pistons",
// "LAL", "Detroit Pistons", and so on. This resolver normalizes ALL of those
// shapes back to:
//   { abbr: <canonical 3-letter>, apiTeamId: <API-Sports numeric id> }
//
// The 30-entry registry is the SINGLE authoritative NBA-team table for this
// route file. apiTeamId values match the public API-Sports v2 NBA /teams
// endpoint as of season 2025-26. If API-Sports renumbers, override at boot
// time via env var NBA_API_SPORTS_TEAM_ID_OVERRIDES (JSON: { "DET": 10, … }).
//
// Authority preservation: this is the ONE place we map team representations
// → API-NBA numeric IDs. Replay/grading/freeze pipelines do not depend on
// this — they key on prediction_id / composite keys, not API team IDs.
// ─────────────────────────────────────────────────────────────────────────────
const NBA_TEAM_REGISTRY = [
  { abbr: "ATL", apiTeamId: 1,  city: "Atlanta",       nickname: "Hawks",         aliases: [] },
  { abbr: "BOS", apiTeamId: 2,  city: "Boston",        nickname: "Celtics",       aliases: [] },
  { abbr: "BKN", apiTeamId: 4,  city: "Brooklyn",      nickname: "Nets",          aliases: ["BRK","NJN","NEW JERSEY","NEW JERSEY NETS"] },
  { abbr: "CHA", apiTeamId: 5,  city: "Charlotte",     nickname: "Hornets",       aliases: ["CHO","BOBCATS","CHARLOTTE BOBCATS"] },
  { abbr: "CHI", apiTeamId: 6,  city: "Chicago",       nickname: "Bulls",         aliases: [] },
  { abbr: "CLE", apiTeamId: 7,  city: "Cleveland",     nickname: "Cavaliers",     aliases: ["CAVS"] },
  { abbr: "DAL", apiTeamId: 8,  city: "Dallas",        nickname: "Mavericks",     aliases: ["MAVS"] },
  { abbr: "DEN", apiTeamId: 9,  city: "Denver",        nickname: "Nuggets",       aliases: [] },
  { abbr: "DET", apiTeamId: 10, city: "Detroit",       nickname: "Pistons",       aliases: [] },
  { abbr: "GSW", apiTeamId: 11, city: "Golden State",  nickname: "Warriors",      aliases: ["GS","GOLDEN STATE WARRIORS"] },
  { abbr: "HOU", apiTeamId: 14, city: "Houston",       nickname: "Rockets",       aliases: [] },
  { abbr: "IND", apiTeamId: 15, city: "Indiana",       nickname: "Pacers",        aliases: [] },
  { abbr: "LAC", apiTeamId: 16, city: "LA",            nickname: "Clippers",      aliases: ["LOS ANGELES CLIPPERS","LA CLIPPERS"] },
  { abbr: "LAL", apiTeamId: 17, city: "Los Angeles",   nickname: "Lakers",        aliases: ["LA LAKERS","LOS ANGELES LAKERS"] },
  { abbr: "MEM", apiTeamId: 19, city: "Memphis",       nickname: "Grizzlies",     aliases: [] },
  { abbr: "MIA", apiTeamId: 20, city: "Miami",         nickname: "Heat",          aliases: [] },
  { abbr: "MIL", apiTeamId: 21, city: "Milwaukee",     nickname: "Bucks",         aliases: [] },
  { abbr: "MIN", apiTeamId: 22, city: "Minnesota",     nickname: "Timberwolves",  aliases: ["WOLVES","TWOLVES","T-WOLVES"] },
  { abbr: "NOP", apiTeamId: 23, city: "New Orleans",   nickname: "Pelicans",      aliases: ["NO","NOR","PELS"] },
  { abbr: "NYK", apiTeamId: 24, city: "New York",      nickname: "Knicks",        aliases: ["NY","NEW YORK KNICKS"] },
  { abbr: "OKC", apiTeamId: 25, city: "Oklahoma City", nickname: "Thunder",       aliases: ["OKL"] },
  { abbr: "ORL", apiTeamId: 26, city: "Orlando",       nickname: "Magic",         aliases: [] },
  { abbr: "PHI", apiTeamId: 27, city: "Philadelphia",  nickname: "76ers",         aliases: ["PHL","SIXERS","PHILADELPHIA 76ERS"] },
  { abbr: "PHX", apiTeamId: 28, city: "Phoenix",       nickname: "Suns",          aliases: ["PHO"] },
  { abbr: "POR", apiTeamId: 29, city: "Portland",      nickname: "Trail Blazers", aliases: ["BLAZERS","TRAIL BLAZERS","PORTLAND TRAIL BLAZERS"] },
  { abbr: "SAC", apiTeamId: 30, city: "Sacramento",    nickname: "Kings",         aliases: [] },
  { abbr: "SAS", apiTeamId: 31, city: "San Antonio",   nickname: "Spurs",         aliases: ["SA"] },
  { abbr: "TOR", apiTeamId: 38, city: "Toronto",       nickname: "Raptors",       aliases: [] },
  { abbr: "UTA", apiTeamId: 40, city: "Utah",          nickname: "Jazz",          aliases: ["UTH"] },
  { abbr: "WAS", apiTeamId: 41, city: "Washington",    nickname: "Wizards",       aliases: ["WSH"] },
]

// Optional override of apiTeamId values via env JSON. Defensive — silent
// no-op if env is missing/malformed. Keys are canonical 3-letter abbrs.
;(function applyNbaApiTeamIdOverrides() {
  try {
    const raw = String(process.env.NBA_API_SPORTS_TEAM_ID_OVERRIDES || "").trim()
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return
    for (const entry of NBA_TEAM_REGISTRY) {
      const override = parsed[entry.abbr]
      if (Number.isFinite(Number(override))) entry.apiTeamId = Number(override)
    }
    console.log("[NBA-TEAM-REGISTRY-OVERRIDES-APPLIED]", JSON.stringify(parsed))
  } catch (_err) {
    // override env malformed — ignore, ship the defaults
  }
})()

// Build the lookup index ONCE at module load. All keys uppercased; values
// point at the same registry entry object so resolvers can return whole
// entries (abbr + numeric id) in one shot.
const __NBA_TEAM_LOOKUP_BY_KEY = (() => {
  const m = new Map()
  for (const entry of NBA_TEAM_REGISTRY) {
    const keys = new Set([
      entry.abbr,
      entry.city,
      entry.nickname,
      `${entry.city} ${entry.nickname}`,
      ...(Array.isArray(entry.aliases) ? entry.aliases : []),
    ])
    for (const k of keys) {
      if (!k) continue
      const norm = String(k).trim().toUpperCase()
      if (!norm) continue
      // First write wins; deliberate so canonical abbr/full-name entries are
      // never silently overwritten by an alias collision in this file.
      if (!m.has(norm)) m.set(norm, entry)
    }
  }
  return m
})()

/**
 * Resolve a raw row.team representation into the canonical NBA team entry.
 * Accepts: 3-letter abbreviation, 2/3-letter alias, city, nickname, full
 * franchise name ("SACRAMENTO KINGS"), or registered alias.
 * Returns `{ abbr, apiTeamId }` (shallow copy) or `null` when nothing matched.
 */
function resolveCanonicalNbaTeam(raw) {
  if (raw == null) return null
  const norm = String(raw).trim().toUpperCase()
  if (!norm) return null
  const entry = __NBA_TEAM_LOOKUP_BY_KEY.get(norm)
  return entry ? { abbr: entry.abbr, apiTeamId: entry.apiTeamId } : null
}

/**
 * Backward-compatible thin wrapper kept for the F5/F6 verification fixtures
 * and any other call sites that only need the canonical 3-letter abbreviation.
 */
function resolveCanonicalNbaTeamAbbr(raw) {
  const t = resolveCanonicalNbaTeam(raw)
  return t ? t.abbr : null
}

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function normName(v) {
  return String(v == null ? "" : v)
    .toLowerCase()
    .replace(/\./g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, " ")
    .replace(/[^a-z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Prefer this string for API-Sports `search=` when Odds display name mismatches cache/API. */
const API_SPORTS_SEARCH_NAME_BY_NORM = {
  [normName("R.J. Barrett")]: "RJ Barrett",
  [normName("Nickeil Alexander-Walker")]: "Nickeil Alexander Walker",
  [normName("Shai Gilgeous-Alexander")]: "Shai Gilgeous Alexander",
  [normName("T.J. McConnell")]: "TJ McConnell",
  [normName("P.J. Washington")]: "PJ Washington",
  [normName("De'Anthony Melton")]: "DeAnthony Melton",
  [normName("Larry Nance Jr")]: "Larry Nance Jr.",
}

function apiSportsSearchQueryForDisplayName(displayName) {
  const raw = String(displayName || "").trim()
  if (!raw) return raw
  const alias = API_SPORTS_SEARCH_NAME_BY_NORM[normName(raw)]
  return alias || raw
}

function findCachedPlayerIdEntry(playerName, playerIdCache) {
  const raw = String(playerName || "").trim()
  if (!raw || !playerIdCache || typeof playerIdCache !== "object") return null
  const tryKeys = [raw, apiSportsSearchQueryForDisplayName(raw)]
  for (const k of tryKeys) {
    const v = playerIdCache[k]
    if (v && typeof v === "object" && Number.isFinite(toNum(v.id))) {
      return { cacheKey: k, id: toNum(v.id) }
    }
  }
  const want = normName(raw)
  for (const [k, v] of Object.entries(playerIdCache)) {
    if (v == null || typeof v !== "object") continue
    if (!Number.isFinite(toNum(v.id))) continue
    if (normName(k) === want) return { cacheKey: k, id: toNum(v.id) }
  }
  return null
}

let _nbaProjFormFallbackCache = null
function loadNbaPlayerProjectionsForFormFallback() {
  if (_nbaProjFormFallbackCache) return _nbaProjFormFallbackCache
  try {
    const fp = path.join(DEFAULT_BACKEND_ROOT, "data", "nbaPlayerProjections.json")
    const raw = JSON.parse(fs.readFileSync(fp, "utf8"))
    const defaults = raw?.defaults && typeof raw.defaults === "object" ? raw.defaults : {}
    const players = raw?.players && typeof raw.players === "object" ? raw.players : {}
    _nbaProjFormFallbackCache = {
      defaults: {
        projectedMinutes: Number(defaults.projectedMinutes) || 26,
        usageRate: Number(defaults.usageRate) || 19,
      },
      players,
    }
  } catch {
    _nbaProjFormFallbackCache = { defaults: { projectedMinutes: 26, usageRate: 19 }, players: {} }
  }
  return _nbaProjFormFallbackCache
}

function defaultStatBaselineForRecentFormFallback(row) {
  const ln = toNum(row?.line)
  if (Number.isFinite(ln)) return ln
  const t = String(row?.propType || row?.marketKey || "").toLowerCase()
  if (/point/.test(t) && !/pra|points.*rebounds|pts.*reb/.test(t)) return 22
  if (/assist/.test(t)) return 5.5
  if (/rebound/.test(t)) return 8
  if (/three|threes|3pt/.test(t)) return 2.5
  if (/pra|points.*rebounds.*assists|pts.*reb.*ast/.test(t)) return 30
  return 18
}

/**
 * When API-Sports cannot supply logs, derive a non-null recentForm from projections (minutes/usage vs defaults).
 */
function applyProjectionRecentFormFallback(rows) {
  const proj = loadNbaPlayerProjectionsForFormFallback()
  const defM = proj.defaults.projectedMinutes
  const defU = proj.defaults.usageRate

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue
    if (row.recentForm && typeof row.recentForm === "object" && Number.isFinite(Number(row.recentForm.trend_delta))) continue

    const pk = String(row.player || "")
      .trim()
      .toLowerCase()
    const p = proj.players[pk]
    const m = Number(p?.projectedMinutes ?? defM)
    const u = Number(p?.usageRate ?? defU)
    const baseline = defaultStatBaselineForRecentFormFallback(row)
    const roleSkew = (m - defM) * 0.1 + (u - defU) * 0.06
    const nameSkew = ((normName(row.player).length % 7) - 3) * 0.035
    const last5_avg = baseline + roleSkew * 0.38 + nameSkew
    const last10_avg = baseline + roleSkew * 0.2 + nameSkew * 0.5 - 0.015
    const trend_delta = last5_avg - last10_avg

    row.recentForm = {
      last5_avg,
      last10_avg,
      baseline,
      trend_delta,
      last5_hit_rate: null,
      last10_hit_rate: null,
      sampleSize5: 0,
      sampleSize10: 0,
      source: "projection-fallback",
    }
    console.log("FORM FALLBACK:", row.player, {
      trend_delta,
      baseline,
      last5_avg,
      last10_avg,
      source: "projection-fallback",
    })
  }
}

function statKeyFromPropType(propType) {
  const t = String(propType || "").toLowerCase()
  if (/three|threes|3pt/.test(t)) return "tpm"
  if (/rebound/.test(t)) return "totReb"
  if (/assist/.test(t)) return "assists"
  if (/point/.test(t) && !/pra|points.*rebounds.*assists|pts.*reb.*ast/.test(t)) return "points"
  if (/pra|points.*rebounds.*assists|pts.*reb.*ast/.test(t)) return "pra"
  return null
}

function propValueFromApiSportsLog(log, statKey) {
  if (!log || typeof log !== "object") return null
  switch (statKey) {
    case "points":
      return toNum(log.points)
    case "totReb":
      return toNum(log.totReb)
    case "assists":
      return toNum(log.assists)
    case "tpm":
      return toNum(log.tpm)
    case "pra": {
      const p = toNum(log.points) ?? 0
      const r = toNum(log.totReb) ?? 0
      const a = toNum(log.assists) ?? 0
      return p + r + a
    }
    default:
      return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase F2 — Owner-B cache write observability diagnostics
//
// This module-scoped state object accumulates counters for the NBA API-Sports
// enrichment cache lifecycle. Observability ONLY — never changes behavior,
// never short-circuits writes, never injects synthetic data.
//
// Counter taxonomy:
//   - cacheReadHits*       — cache key was present (memory snapshot)
//   - cacheReadMisses*     — cache key absent; API call WILL fire
//   - cacheWriteAttempts*  — new key being written to in-memory snapshot
//   - cacheWriteSuccesses* — write actually changed state (new key OR updated)
//   - cacheWriteSkips      — resolution returned null; nothing written
//   - saveApiSportsDiskCacheInvoked — count of times the disk-write function
//                                     was called (regardless of success)
//   - lastSaveAttemptIso / lastSaveSucceededIso / lastSaveErrorMessage —
//                                     timestamp evidence of disk persistence
//
// Per-request snapshot fields are refreshed on each enrichRowsWithRecentForm
// call: memoryPlayerIdCount / memoryPlayerStatsCount / diskPlayerIdCount /
// diskPlayerStatsCount / cachePersistenceHealthy.
//
// Read via the exported `getNbaCacheDiagnostics()` function; surfaced in the
// /api/best-available response under `nbaCacheDiagnostics` (additive field).
// ─────────────────────────────────────────────────────────────────────────────
const __nbaCacheDiag = {
  // Lifetime counters (since process boot)
  enrichmentInvocations:           0,
  enrichmentSkippedNoApiKey:       0,
  enrichmentSkippedNoRows:         0,
  enrichmentCompleted:             0,
  cacheReadHitsPlayerId:           0,
  cacheReadMissesPlayerId:         0,
  cacheReadHitsPlayerStats:        0,
  cacheReadMissesPlayerStats:      0,
  cacheWriteAttemptsPlayerId:      0,
  cacheWriteAttemptsPlayerStats:   0,
  cacheWriteSuccessesPlayerId:     0,
  cacheWriteSuccessesPlayerStats:  0,
  cacheWriteSkips:                 0,
  loadApiSportsDiskCacheInvoked:   0,
  saveApiSportsDiskCacheInvoked:   0,
  // Per-most-recent-call snapshot (refreshed each enrichment)
  lastEnrichmentIso:               null,
  lastSaveAttemptIso:              null,
  lastSaveSucceededIso:            null,
  lastSaveErrorMessage:            null,
  memoryPlayerIdCount:             0,
  memoryPlayerStatsCount:          0,
  diskPlayerIdCount:               0,
  diskPlayerStatsCount:            0,
  cachePersistenceHealthy:         null, // tri-state: true | false | null (unknown)
  // Phase F3 — cacheability-gate tracing
  cacheWriteSkipReasonCounts: {
    PLAYER_ID_API_RETURNED_NULL:   0,
    STATS_API_RETURNED_EMPTY:      0,
    PLAYER_THROWN_ERROR:           0,
  },
  unresolvedPlayerSamples:         [], // up to 25 names where player-id lookup returned null
  rejectedCacheabilitySamples:     [], // ring buffer of last 25 rejections (any reason)
  apiSportsResponseDiagnostics: {
    lastPlayerIdRequestPlayer:           null,
    // Phase F6 — team abbreviation passed alongside search to disambiguate
    // players with shared/common names (the canonical case where a generic
    // `search=jordan` returns the wrong "Jordan"). Null when no team was
    // resolvable from the enrichment row.
    //
    // `lastPlayerIdRequestTeam`       = raw (uppercase) value observed on the
    //                                   row.team field — useful for spotting
    //                                   contract pollution (e.g. full names
    //                                   reaching this layer).
    // `lastPlayerIdResolvedTeamAbbr`  = final canonical abbreviation that was
    //                                   actually included in the API request,
    //                                   or null when the raw value did not
    //                                   resolve to a known canonical abbr.
    // `lastPlayerIdResolvedApiTeamId` = numeric API-NBA team id actually sent
    //                                   on the wire (was the missing piece —
    //                                   API-Sports v2 requires numeric team
    //                                   ids, not abbreviations).
    lastPlayerIdRequestTeam:             null,
    lastPlayerIdResolvedTeamAbbr:        null,
    lastPlayerIdResolvedApiTeamId:       null,
    // Phase F6.3 — strategy applied for the most recent player resolution.
    // Values: "roster_match_exact" | "roster_match_lastname"
    //       | "roster_no_match" | "roster_empty"
    //       | "roster_cache_hit" | "no_team_skipped"
    lastPlayerIdMatchStrategy:           null,
    lastPlayerIdResponseRowsReturned:    null,
    lastPlayerIdResponseSampleNames:     [], // up to 3 names from most recent API response
    lastPlayerIdResponseHadFiniteId:     null,
    // Phase F5-B — capture upstream response envelope so contract drift is
    // visible from /api/best-available without re-running source-level audits.
    lastPlayerIdResponseErrors:          null, // raw `errors` field from API-Sports response envelope
    lastPlayerIdResponseResults:         null, // numeric `results` field (parallel to response.length)
    lastPlayerIdResponseParameters:      null, // API's echo of received params (proves what arrived upstream)
    lastStatsRequestPlayerId:            null,
    lastStatsResponseRowsReturned:       null,
    lastObservedAt:                      null,
  },
  // Rate-limit flags
  _loggedFirstEnrichmentSummary:   false,
  _loggedReasonKinds:              new Set(), // emits one [NBA-CACHEABILITY-GATE] line per first-seen reason
  _loggedFirstPlayerResolution:    false,     // emits one [NBA-API-SPORTS-PLAYER-RESOLUTION] line per process
  // Phase F6.3 — process-scoped team-roster working layer. NOT a parallel
  // cache owner — it's an in-memory memoization adjacent to playerIdCache
  // (which remains the canonical disk-persisted owner-B cache). Avoids
  // refetching the same Sacramento Kings roster 17 times within one
  // enrichment cycle. Cleared on process restart.
  teamRosterCacheSize:             0,
}

// Process-scoped working memo of team rosters. Key: "<apiTeamId>|<season>".
// Value: array of player rows returned by /players?team=N&season=Y.
const __nbaTeamRosterCache = new Map()

// ─────────────────────────────────────────────────────────────────────────────
// Phase F3 — record a cacheability skip with a categorized reason + sample.
//
// Replaces the bare `__nbaCacheDiag.cacheWriteSkips += 1` increments from F2
// at three call sites inside enrichRowsWithRecentForm. Each site now passes
// a specific reason string and a sample object so operators can see WHICH
// gate rejected the write — not just that one was rejected.
//
// Bounded ring buffer of 25 samples ensures the diagnostics block stays small
// even under heavy slate volume. Emits ONE [NBA-CACHEABILITY-GATE] log per
// first-seen reason per process — observability without log spam.
// ─────────────────────────────────────────────────────────────────────────────
const __NBA_REJECTION_SAMPLE_CAP = 25
const __NBA_UNRESOLVED_SAMPLE_CAP = 25

function recordCacheWriteSkip(reason, sample) {
  __nbaCacheDiag.cacheWriteSkips += 1
  const reasonKey = String(reason || "UNKNOWN_REASON")
  if (Object.prototype.hasOwnProperty.call(__nbaCacheDiag.cacheWriteSkipReasonCounts, reasonKey)) {
    __nbaCacheDiag.cacheWriteSkipReasonCounts[reasonKey] += 1
  } else {
    __nbaCacheDiag.cacheWriteSkipReasonCounts[reasonKey] = 1
  }

  const enriched = {
    reason: reasonKey,
    capturedAtIso: new Date().toISOString(),
    ...((sample && typeof sample === "object") ? sample : {}),
  }

  // Ring buffer over recent rejections (any reason).
  if (__nbaCacheDiag.rejectedCacheabilitySamples.length >= __NBA_REJECTION_SAMPLE_CAP) {
    __nbaCacheDiag.rejectedCacheabilitySamples.shift()
  }
  __nbaCacheDiag.rejectedCacheabilitySamples.push(enriched)

  // Dedicated unresolved-player sample list grows to a cap and stops.
  if (reasonKey === "PLAYER_ID_API_RETURNED_NULL" &&
      __nbaCacheDiag.unresolvedPlayerSamples.length < __NBA_UNRESOLVED_SAMPLE_CAP) {
    __nbaCacheDiag.unresolvedPlayerSamples.push({
      playerName: enriched.playerName || null,
      normalizedQuery: enriched.normalizedQuery || null,
      apiRowsReturned: enriched.apiRowsReturned ?? null,
      apiSampleNames: Array.isArray(enriched.apiSampleNames) ? enriched.apiSampleNames.slice(0, 3) : null,
      capturedAtIso: enriched.capturedAtIso,
    })
  }

  // One TERM 1 line per first-seen reason — high signal, zero spam.
  if (!__nbaCacheDiag._loggedReasonKinds.has(reasonKey)) {
    __nbaCacheDiag._loggedReasonKinds.add(reasonKey)
    console.log("[NBA-CACHEABILITY-GATE]", JSON.stringify({
      reasonKey,
      firstObservedAtIso: enriched.capturedAtIso,
      sample: enriched,
      message: reasonKey === "PLAYER_ID_API_RETURNED_NULL"
        ? "first observed: API-Sports player-id search returned no usable id — check name normalization (apiSportsSearchQueryForDisplayName), accents, suffixes, or expired API key"
        : reasonKey === "STATS_API_RETURNED_EMPTY"
          ? "first observed: API-Sports stats endpoint returned an empty array — typical when player is out of season or wrong season param (currently hard-coded 2025)"
          : reasonKey === "PLAYER_THROWN_ERROR"
            ? "first observed: player-loop catch block fired — network error, parse error, or unexpected payload shape"
            : `first observed: unknown reason "${reasonKey}"`,
    }))
  }
}

/**
 * Read-only diagnostics snapshot for the NBA API-Sports enrichment cache.
 * Safe to call any time; returns a shallow copy so callers cannot mutate the
 * internal state. Exposed via module.exports for /api/best-available response
 * embedding and for fixture verification.
 */
// Phase Longitudinal-Integrity-1B (2026-05-14): lazy-require the canonical
// epoch authority's diagnostics. Falls back to a stable empty shape if the
// helper isn't available (defensive; matches existing lazy-require pattern).
function _lazyEpochAuthorityDiagnostics() {
  try {
    const { getEpochAuthorityDiagnostics } = require("../storage/intelligence")
    return getEpochAuthorityDiagnostics()
  } catch (_) {
    return {
      epochsDerived:           0,
      rejectionsOnMissingTs:   0,
      fallbacksUsed:           0,
      collisionsDetected:      0,
      formulaVariantsObserved: {},
      firstCollisionSample:    null,
      firstFallbackSample:     null,
      firstRejectionSample:    null,
      epochWriterMapSize:      0,
      _unavailable:            true,
    }
  }
}

function getNbaCacheDiagnostics() {
  return {
    // Phase Longitudinal-Integrity-1B (2026-05-14) — canonical epoch authority
    // diagnostics (additive; never removes existing fields).
    epochAuthority:                  _lazyEpochAuthorityDiagnostics(),
    enrichmentInvocations:           __nbaCacheDiag.enrichmentInvocations,
    enrichmentSkippedNoApiKey:       __nbaCacheDiag.enrichmentSkippedNoApiKey,
    enrichmentSkippedNoRows:         __nbaCacheDiag.enrichmentSkippedNoRows,
    enrichmentCompleted:             __nbaCacheDiag.enrichmentCompleted,
    cacheReadHitsPlayerId:           __nbaCacheDiag.cacheReadHitsPlayerId,
    cacheReadMissesPlayerId:         __nbaCacheDiag.cacheReadMissesPlayerId,
    cacheReadHitsPlayerStats:        __nbaCacheDiag.cacheReadHitsPlayerStats,
    cacheReadMissesPlayerStats:      __nbaCacheDiag.cacheReadMissesPlayerStats,
    cacheWriteAttemptsPlayerId:      __nbaCacheDiag.cacheWriteAttemptsPlayerId,
    cacheWriteAttemptsPlayerStats:   __nbaCacheDiag.cacheWriteAttemptsPlayerStats,
    cacheWriteSuccessesPlayerId:     __nbaCacheDiag.cacheWriteSuccessesPlayerId,
    cacheWriteSuccessesPlayerStats:  __nbaCacheDiag.cacheWriteSuccessesPlayerStats,
    cacheWriteSkips:                 __nbaCacheDiag.cacheWriteSkips,
    loadApiSportsDiskCacheInvoked:   __nbaCacheDiag.loadApiSportsDiskCacheInvoked,
    saveApiSportsDiskCacheInvoked:   __nbaCacheDiag.saveApiSportsDiskCacheInvoked,
    lastEnrichmentIso:               __nbaCacheDiag.lastEnrichmentIso,
    lastSaveAttemptIso:              __nbaCacheDiag.lastSaveAttemptIso,
    lastSaveSucceededIso:            __nbaCacheDiag.lastSaveSucceededIso,
    lastSaveErrorMessage:            __nbaCacheDiag.lastSaveErrorMessage,
    memoryPlayerIdCount:             __nbaCacheDiag.memoryPlayerIdCount,
    memoryPlayerStatsCount:          __nbaCacheDiag.memoryPlayerStatsCount,
    diskPlayerIdCount:               __nbaCacheDiag.diskPlayerIdCount,
    diskPlayerStatsCount:            __nbaCacheDiag.diskPlayerStatsCount,
    cachePersistenceHealthy:         __nbaCacheDiag.cachePersistenceHealthy,
    // Phase F6.3 — process-scoped team-roster memoization (number of unique
    // <teamId|season> rosters held in memory). Operators can use this with
    // memoryPlayerIdCount to see how roster fetches translate into resolved ids.
    teamRosterCacheSize:             __nbaTeamRosterCache.size,
    // Phase F3 — cacheability-gate tracing (read-only shallow copies)
    cacheWriteSkipReasonCounts:      { ...__nbaCacheDiag.cacheWriteSkipReasonCounts },
    unresolvedPlayerSamples:         __nbaCacheDiag.unresolvedPlayerSamples.slice(),
    rejectedCacheabilitySamples:     __nbaCacheDiag.rejectedCacheabilitySamples.slice(),
    apiSportsResponseDiagnostics: {
      lastPlayerIdRequestPlayer:        __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdRequestPlayer,
      // Phase F6 / F6.2 / F6.3 — full request-shape trail + match strategy
      lastPlayerIdRequestTeam:          __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdRequestTeam,
      lastPlayerIdResolvedTeamAbbr:     __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResolvedTeamAbbr,
      lastPlayerIdResolvedApiTeamId:    __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResolvedApiTeamId,
      lastPlayerIdMatchStrategy:        __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdMatchStrategy,
      lastPlayerIdResponseRowsReturned: __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResponseRowsReturned,
      lastPlayerIdResponseSampleNames:  __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResponseSampleNames.slice(),
      lastPlayerIdResponseHadFiniteId:  __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResponseHadFiniteId,
      // Phase F5-B fields — defensive shallow copies
      lastPlayerIdResponseErrors:       __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResponseErrors,
      lastPlayerIdResponseResults:      __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResponseResults,
      lastPlayerIdResponseParameters:   __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResponseParameters,
      lastStatsRequestPlayerId:         __nbaCacheDiag.apiSportsResponseDiagnostics.lastStatsRequestPlayerId,
      lastStatsResponseRowsReturned:    __nbaCacheDiag.apiSportsResponseDiagnostics.lastStatsResponseRowsReturned,
      lastObservedAt:                   __nbaCacheDiag.apiSportsResponseDiagnostics.lastObservedAt,
    },
  }
}

function resetNbaCacheDiagnostics() {
  __nbaCacheDiag.enrichmentInvocations          = 0
  __nbaCacheDiag.enrichmentSkippedNoApiKey      = 0
  __nbaCacheDiag.enrichmentSkippedNoRows        = 0
  __nbaCacheDiag.enrichmentCompleted            = 0
  __nbaCacheDiag.cacheReadHitsPlayerId          = 0
  __nbaCacheDiag.cacheReadMissesPlayerId        = 0
  __nbaCacheDiag.cacheReadHitsPlayerStats       = 0
  __nbaCacheDiag.cacheReadMissesPlayerStats     = 0
  __nbaCacheDiag.cacheWriteAttemptsPlayerId     = 0
  __nbaCacheDiag.cacheWriteAttemptsPlayerStats  = 0
  __nbaCacheDiag.cacheWriteSuccessesPlayerId    = 0
  __nbaCacheDiag.cacheWriteSuccessesPlayerStats = 0
  __nbaCacheDiag.cacheWriteSkips                = 0
  __nbaCacheDiag.loadApiSportsDiskCacheInvoked  = 0
  __nbaCacheDiag.saveApiSportsDiskCacheInvoked  = 0
  __nbaCacheDiag.lastEnrichmentIso              = null
  __nbaCacheDiag.lastSaveAttemptIso             = null
  __nbaCacheDiag.lastSaveSucceededIso           = null
  __nbaCacheDiag.lastSaveErrorMessage           = null
  __nbaCacheDiag.memoryPlayerIdCount            = 0
  __nbaCacheDiag.memoryPlayerStatsCount         = 0
  __nbaCacheDiag.diskPlayerIdCount              = 0
  __nbaCacheDiag.diskPlayerStatsCount           = 0
  __nbaCacheDiag.cachePersistenceHealthy        = null
  __nbaCacheDiag._loggedFirstEnrichmentSummary  = false
  // Phase F3 fields
  __nbaCacheDiag.cacheWriteSkipReasonCounts = {
    PLAYER_ID_API_RETURNED_NULL: 0,
    STATS_API_RETURNED_EMPTY:    0,
    PLAYER_THROWN_ERROR:         0,
  }
  __nbaCacheDiag.unresolvedPlayerSamples       = []
  __nbaCacheDiag.rejectedCacheabilitySamples   = []
  __nbaCacheDiag.apiSportsResponseDiagnostics = {
    lastPlayerIdRequestPlayer:           null,
    // Phase F6 / F6.2 / F6.3
    lastPlayerIdRequestTeam:             null,
    lastPlayerIdResolvedTeamAbbr:        null,
    lastPlayerIdResolvedApiTeamId:       null,
    lastPlayerIdMatchStrategy:           null,
    lastPlayerIdResponseRowsReturned:    null,
    lastPlayerIdResponseSampleNames:     [],
    lastPlayerIdResponseHadFiniteId:     null,
    // Phase F5-B
    lastPlayerIdResponseErrors:          null,
    lastPlayerIdResponseResults:         null,
    lastPlayerIdResponseParameters:      null,
    lastStatsRequestPlayerId:            null,
    lastStatsResponseRowsReturned:       null,
    lastObservedAt:                      null,
  }
  __nbaCacheDiag._loggedReasonKinds = new Set()
  __nbaCacheDiag._loggedFirstPlayerResolution = false
  // Phase F6.3 — clear the process-scoped team-roster memo
  __nbaTeamRosterCache.clear()
  __nbaCacheDiag.teamRosterCacheSize = 0
}

function loadApiSportsDiskCache() {
  __nbaCacheDiag.loadApiSportsDiskCacheInvoked += 1
  try {
    if (!fs.existsSync(API_SPORTS_CACHE_FILE)) {
      __nbaCacheDiag.diskPlayerIdCount = 0
      __nbaCacheDiag.diskPlayerStatsCount = 0
      return { playerIdCache: {}, playerStatsCache: {} }
    }
    const parsed = JSON.parse(fs.readFileSync(API_SPORTS_CACHE_FILE, "utf8"))
    const playerIdCache = parsed?.playerIdCache && typeof parsed.playerIdCache === "object" ? parsed.playerIdCache : {}
    const playerStatsCache = parsed?.playerStatsCache && typeof parsed.playerStatsCache === "object" ? parsed.playerStatsCache : {}
    // Snapshot disk counts at load time so consumers can compare to memory.
    __nbaCacheDiag.diskPlayerIdCount = Object.keys(playerIdCache).length
    __nbaCacheDiag.diskPlayerStatsCount = Object.keys(playerStatsCache).length
    return { playerIdCache, playerStatsCache }
  } catch {
    __nbaCacheDiag.diskPlayerIdCount = 0
    __nbaCacheDiag.diskPlayerStatsCount = 0
    return { playerIdCache: {}, playerStatsCache: {} }
  }
}

function saveApiSportsDiskCache(next) {
  __nbaCacheDiag.saveApiSportsDiskCacheInvoked += 1
  __nbaCacheDiag.lastSaveAttemptIso = new Date().toISOString()
  try {
    const prev = loadApiSportsDiskCache()
    const merged = {
      ...prev,
      ...next,
      playerIdCache: { ...(prev.playerIdCache || {}), ...(next.playerIdCache || {}) },
      playerStatsCache: { ...(prev.playerStatsCache || {}), ...(next.playerStatsCache || {}) },
    }
    const cleanIds = {}
    for (const [k, v] of Object.entries(merged.playerIdCache || {})) {
      if (v && typeof v === "object" && Number.isFinite(toNum(v.id))) cleanIds[k] = v
    }
    merged.playerIdCache = cleanIds
    fs.writeFileSync(API_SPORTS_CACHE_FILE, JSON.stringify(merged))
    __nbaCacheDiag.lastSaveSucceededIso = new Date().toISOString()
    __nbaCacheDiag.lastSaveErrorMessage = null
    // Refresh disk counts to reflect the write that just happened.
    __nbaCacheDiag.diskPlayerIdCount = Object.keys(merged.playerIdCache || {}).length
    __nbaCacheDiag.diskPlayerStatsCount = Object.keys(merged.playerStatsCache || {}).length
  } catch (err) {
    __nbaCacheDiag.lastSaveErrorMessage = err && err.message ? String(err.message) : "unknown_error"
    // ignore
  }
}

async function fetchApiSportsPlayerId({ axios, apiKey, playerName, team }) {
  // Phase F6.3 — canonical API-NBA player-resolution contract.
  //
  // After live verification, the /players endpoint behaves as a TEAM-ROSTER
  // endpoint (confirmed by the reference reference implementation pulling NBA
  // stats: "the players endpoint takes a specific TEAM_ID as a parameter
  // along with the desired season"). The `search` parameter does NOT combine
  // with `team` + `season` — using all three returns HTTP 200 with results:0
  // (this is the failure mode the operator observed after F5/F6/F6.1/F6.2).
  //
  // Correct contract:
  //   GET /players?team=<numeric>&season=<YYYY>
  //   → response = array of player records for that team in that season
  //   → match player by name client-side against the returned roster
  //
  // Phases F5 (season), F6.2 (numeric team id) prerequisites both still apply.
  // This phase changes ONLY the request semantics — drops `search`, walks the
  // returned roster locally for the name match.
  //
  // The team roster is memoized in __nbaTeamRosterCache for the process
  // lifetime so a 17-player Sacramento Kings slate fires ONE roster fetch
  // (not 17). This memoization is adjacent to — NOT a replacement for — the
  // canonical disk-persisted owner-B playerIdCache; that layer continues to
  // service second-and-later enrichment invocations as before.
  const rawRequestTeam = (() => {
    const raw = String(team == null ? "" : team).trim().toUpperCase()
    return raw || null
  })()
  const resolvedTeam       = resolveCanonicalNbaTeam(rawRequestTeam)
  const resolvedTeamAbbr   = resolvedTeam ? resolvedTeam.abbr      : null
  const resolvedApiTeamId  = resolvedTeam ? resolvedTeam.apiTeamId : null

  // Record raw / resolved diagnostics regardless of code path.
  __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdRequestPlayer = String(playerName || "")
  __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdRequestTeam = rawRequestTeam
  __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResolvedTeamAbbr = resolvedTeamAbbr
  __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResolvedApiTeamId =
    Number.isFinite(resolvedApiTeamId) ? resolvedApiTeamId : null
  __nbaCacheDiag.apiSportsResponseDiagnostics.lastObservedAt = new Date().toISOString()

  // Without a numeric team id, the roster-fetch contract is unavailable.
  // Record the skip strategy and return null — the caller will categorize
  // this as PLAYER_ID_API_RETURNED_NULL with the team-pollution sample.
  if (!Number.isFinite(resolvedApiTeamId)) {
    __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdMatchStrategy = "no_team_skipped"
    __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResponseHadFiniteId = false
    __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResponseRowsReturned = 0
    __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResponseSampleNames = []
    if (!__nbaCacheDiag._loggedFirstPlayerResolution) {
      __nbaCacheDiag._loggedFirstPlayerResolution = true
      console.log("[NBA-API-SPORTS-PLAYER-RESOLUTION]", JSON.stringify({
        player: String(playerName || ""),
        rawRequestTeam, resolvedTeamAbbr, resolvedApiTeamId,
        strategy: "no_team_skipped",
        season: NBA_API_SPORTS_SEASON,
        note: "row.team did not resolve to a known API-NBA franchise; cannot use /players?team=N&season=Y roster contract",
      }))
    }
    return null
  }

  // Process-scoped roster memo: key by team+season so a 17-player Sacramento
  // slate hits the API once rather than 17 times. Cache survives within the
  // process; restart re-fetches once per team.
  const rosterKey = `${resolvedApiTeamId}|${NBA_API_SPORTS_SEASON}`
  let roster = __nbaTeamRosterCache.get(rosterKey)
  let requestParams
  let responseEnvelope = null
  if (Array.isArray(roster)) {
    // Memo hit — no API call.
    __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdMatchStrategy = "roster_cache_hit"
    requestParams = { team: Number(resolvedApiTeamId), season: NBA_API_SPORTS_SEASON }
  } else {
    // Memo miss — fetch the full roster for this team+season.
    requestParams = { team: Number(resolvedApiTeamId), season: NBA_API_SPORTS_SEASON }
    const response = await axios.get("https://v2.nba.api-sports.io/players", {
      params: requestParams,
      headers: { "x-apisports-key": apiKey },
      timeout: 20000,
    })
    responseEnvelope = response?.data || null
    roster = Array.isArray(responseEnvelope?.response) ? responseEnvelope.response : []
    __nbaTeamRosterCache.set(rosterKey, roster)
    __nbaCacheDiag.teamRosterCacheSize = __nbaTeamRosterCache.size
    // Phase F5-B — capture upstream envelope for observability
    __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResponseErrors =
      responseEnvelope?.errors != null ? responseEnvelope.errors : null
    __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResponseResults =
      Number.isFinite(Number(responseEnvelope?.results)) ? Number(responseEnvelope.results) : null
    __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResponseParameters =
      responseEnvelope?.parameters != null ? responseEnvelope.parameters : null
  }

  // Phase F3 — sample top-3 roster names for diagnostics
  const __sampleNames = roster.slice(0, 3).map((r) => {
    const fn = String(r?.firstname || "").trim()
    const ln = String(r?.lastname || "").trim()
    return `${fn} ${ln}`.trim() || null
  }).filter(Boolean)
  __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResponseRowsReturned = roster.length
  __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResponseSampleNames = __sampleNames

  // Phase F5-C — emit one rate-limited probe per process showing the full
  // contract chain (raw → canonical abbr → numeric id → wire → roster size).
  if (!__nbaCacheDiag._loggedFirstPlayerResolution) {
    __nbaCacheDiag._loggedFirstPlayerResolution = true
    console.log("[NBA-API-SPORTS-PLAYER-RESOLUTION]", JSON.stringify({
      player: String(playerName || ""),
      rawRequestTeam, resolvedTeamAbbr, resolvedApiTeamId,
      strategy: responseEnvelope ? "roster_fetch_then_match" : "roster_cache_hit",
      params: requestParams,
      rosterSize: roster.length,
      results: __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResponseResults,
      errors: __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResponseErrors,
      parameters: __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResponseParameters,
      season: NBA_API_SPORTS_SEASON,
      sampleNames: __sampleNames,
    }))
  }

  if (!roster.length) {
    __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdMatchStrategy = "roster_empty"
    __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResponseHadFiniteId = false
    return null
  }

  // Match the requested player against the roster. Exact firstname+lastname
  // wins; lastname-only is a soft fallback (some upstream feeds drop first).
  const want = normName(playerName)
  const wantLastTokens = want.split(" ").filter(Boolean)
  const wantLast = wantLastTokens.length ? wantLastTokens[wantLastTokens.length - 1] : null
  let best = null
  let matchKind = null
  for (const r of roster) {
    const fn = String(r?.firstname || "").trim()
    const ln = String(r?.lastname || "").trim()
    const full = normName(`${fn} ${ln}`)
    if (!full) continue
    if (full === want) {
      best = r
      matchKind = "roster_match_exact"
      break
    }
    if (!best && wantLast && normName(ln) === wantLast) {
      best = r
      matchKind = "roster_match_lastname"
    }
  }
  const id = toNum(best?.id)
  __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdResponseHadFiniteId = Number.isFinite(id)
  __nbaCacheDiag.apiSportsResponseDiagnostics.lastPlayerIdMatchStrategy =
    Number.isFinite(id) ? (matchKind || "roster_match_exact") : "roster_no_match"
  return Number.isFinite(id)
    ? { id, matchedName: best ? `${best.firstname || ""} ${best.lastname || ""}`.trim() : null }
    : null
}

async function fetchApiSportsPlayerStats({ axios, apiKey, playerId }) {
  // Phase F5-A — Use shared NBA_API_SPORTS_SEASON constant so player lookup AND
  // stats lookup reference the SAME season authority. A drift between the two
  // would silently return stats for the wrong season after a season rollover.
  const response = await axios.get("https://v2.nba.api-sports.io/players/statistics", {
    params: { id: playerId, season: NBA_API_SPORTS_SEASON },
    headers: { "x-apisports-key": apiKey },
    timeout: 20000,
  })
  const rows = response.data?.response || []
  // Phase F3 — capture response shape for cacheability-gate diagnostics
  __nbaCacheDiag.apiSportsResponseDiagnostics.lastStatsRequestPlayerId = playerId
  __nbaCacheDiag.apiSportsResponseDiagnostics.lastStatsResponseRowsReturned = Array.isArray(rows) ? rows.length : 0
  __nbaCacheDiag.apiSportsResponseDiagnostics.lastObservedAt = new Date().toISOString()
  return Array.isArray(rows) ? rows : []
}

function computeRecentFormFromLogs({ logs, statKey, line, side }) {
  const ln = toNum(line)
  const isOver = String(side || "").toLowerCase().includes("over")
  const isUnder = String(side || "").toLowerCase().includes("under")

  const sorted = [...(Array.isArray(logs) ? logs : [])].sort(
    (a, b) => (toNum(b?.game?.id) ?? 0) - (toNum(a?.game?.id) ?? 0)
  )

  const valsAll = sorted
    .map((g) => propValueFromApiSportsLog(g, statKey))
    .filter((v) => Number.isFinite(v))

  if (!valsAll.length) return null

  const avg = (xs) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length)
  const last5 = valsAll.slice(0, 5)
  const last10 = valsAll.slice(0, 10)
  const baseline = avg(valsAll) // season-to-date average from available games

  const last5_avg = avg(last5)
  const last10_avg = avg(last10)
  const trend_delta = last5_avg - baseline

  const hitRate = (xs) => {
    if (!Number.isFinite(ln)) return null
    if (!isOver && !isUnder) return null
    let hits = 0
    for (const v of xs) {
      if (!Number.isFinite(v)) continue
      if (isOver && v >= ln) hits += 1
      if (isUnder && v <= ln) hits += 1
    }
    return hits / Math.max(1, xs.length)
  }

  return {
    last5_avg,
    last10_avg,
    last5_hit_rate: hitRate(last5),
    last10_hit_rate: hitRate(last10),
    trend_delta,
    baseline,
    sampleSize5: last5.length,
    sampleSize10: last10.length,
    source: "api-sports-live",
  }
}

async function enrichRowsWithRecentForm({ axios, rows }) {
  // 2026-05-26 — Operator killed api-basketball subscription (no future-
  // predictive value over ESPN; was duplicate authority).
  // Canonical source is now ESPN gameLogs via nbaRecentFormCache.js.
  // Signature preserved (axios still passed by callers) so call sites
  // remain unchanged. axios is unused here.
  void axios
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return
  let enriched = 0
  for (const row of list) {
    if (!row || typeof row !== "object") continue
    const before = row.recentForm
    enrichNbaRowFromEspn(row)
    if (row.recentForm && row.recentForm !== before) enriched++
  }
  console.log("[NBA-RECENT-FORM]", { rows: list.length, enriched, source: "espn_game_logs" })
}

function snapshotHasBody(snap) {
  if (!snap || typeof snap !== "object") return false
  const ev = Array.isArray(snap.events) ? snap.events.length : 0
  const rp = Array.isArray(snap.rawProps) ? snap.rawProps.length : 0
  const pr = Array.isArray(snap.props) ? snap.props.length : 0
  const bp = Array.isArray(snap.bestProps) ? snap.bestProps.length : 0
  return ev > 0 || rp > 0 || pr > 0 || bp > 0
}

function isNbaReplayQuery(req) {
  const r = String(req?.query?.replay || "")
    .toLowerCase()
    .trim()
  return r === "1" || r === "true"
}

/**
 * Score already-normalized corePropsBoard rows into workstation Candidate format.
 * These rows come from buildNbaBoardSlicesFromSnapshot and are already enriched with
 * game context (eventId, team, gameTotal, spread, etc.) — no further normalization needed.
 *
 * Mirrors buildNbaSnapshotCandidates in workstationRoutes.js but operates on
 * already-normalized rows instead of raw snapshot rows.
 * Gates: core odds (-200..+200), no alternate market keys, known stat family, mp≥0.35, edge≥0.03.
 * Deduplicates by (player|statFamily|side) keeping best-edge entry per triple.
 */
function buildNbaBestAvailableWsCandidates(corePropsBoard) {
  if (!Array.isArray(corePropsBoard) || !corePropsBoard.length) return []
  const rawQualified = []

  // 2026-05-26 slate-rollover fix — drop rows whose gameTime is already in the
  // past (game started >3h ago). Stops completed-game picks from surfacing
  // while we wait for the next-day slate to publish.
  const __nowMs = Date.now()
  const __gameOverThresholdMs = 3 * 3600 * 1000

  for (const r of corePropsBoard) {
    const player = String(r?.player || "").trim()
    if (!player) continue
    const side = String(r?.side || "").toLowerCase()
    if (!side || side === "unknown") continue
    const odds = Number(r?.odds ?? r?.oddsAmerican)
    // 2026-05-26 — Lane A1: DD/TD families need wider odds cap (legitimate
    // longshot markets, model's probability band prevents fake band-floor edge).
    const __isDdTdQuickBA =
      /double[_\s-]*double|triple[_\s-]*double/.test(String(r?.propType || r?.marketKey || "").toLowerCase())
    const __oddsCapBA = __isDdTdQuickBA ? 2500 : 200
    if (!Number.isFinite(odds) || odds > __oddsCapBA || odds < -200) continue

    // Completed-game filter — drop if gameTime+3h is in the past
    const __gt = r?.gameTime || r?.commenceTime || r?.commence_time
    if (__gt) {
      const __gtMs = new Date(__gt).getTime()
      if (Number.isFinite(__gtMs) && (__nowMs - __gtMs) > __gameOverThresholdMs) continue
    }

    const mk = String(r?.marketKey || "").toLowerCase()
    const pv = String(r?.propVariant || "base").toLowerCase()
    if (mk.includes("alternate") || mk.includes("_alt") || (pv && pv !== "base" && pv !== "default")) continue

    const propT = String(r?.propType || mk).toLowerCase()
    // 2026-05-26 — Lane A1: DD/TD recognized. Lane A2: steals/blocks/turnovers.
    // ORDER: triple_double FIRST. Specific families before generic fallbacks.
    const family = /triple[_\s-]*double/.test(propT) ? "triple_double"
      : /double[_\s-]*double/.test(propT) ? "double_double"
      : propT.includes("points_rebounds_assists") || /\bpra\b/.test(propT) ? "pra"
      : propT.includes("first_basket") || propT.includes("firstbasket") ? "first_basket"
      : propT.includes("steals")   ? "steals"
      : propT.includes("blocks")   ? "blocks"
      : propT.includes("turnover") ? "turnovers"
      : propT.includes("points")   ? "points"
      : propT.includes("rebounds") ? "rebounds"
      : propT.includes("assists")  ? "assists"
      : (propT.includes("threes") || propT.includes("three") || propT.includes("3pt")) ? "threes"
      : null
    if (!family) continue

    const mp = nbaRowModelProbability(r)
    // 2026-05-26 — Lane A1: family-aware mp threshold for binary events.
    // DD floor 0.10, TD floor 0.04 (matches band floor). Continuous-stat
    // families keep the 0.35 floor — that calibration is unchanged.
    const __mpFloorBA = family === "triple_double" ? 0.04
                      : family === "double_double" ? 0.10
                      : 0.35
    if (!Number.isFinite(mp) || mp < __mpFloorBA) continue
    const edge = nbaRowEdge(r)
    if (!Number.isFinite(edge) || edge < 0.03) continue

    rawQualified.push({
      ...r,
      id:           `ba|${player}|${family}|${side}|${r?.line ?? ""}|${odds}`,
      player,
      statFamily:   family,
      propType:     r?.propType || family,
      side,
      line:         r?.line ?? null,
      odds,
      oddsAmerican: odds,
      modelProb:    mp,
      edge,
      impliedProb:  odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100),
      sportsbook:   r?.sportsbook || r?.book || null,
      tier:         classifyNbaTier({
                      edge, modelProb: mp,
                      side: r?.side, line: r?.line,
                      l5Avg: r?.recentForm?.last5_avg ?? r?.recentForm?.last10_avg ?? r?.last5Avg,
                      projMostLikely: Number(r?.range?.mostLikely)
                                   ?? Number(r?.projection?.mostLikely)
                                   ?? Number(r?.projectionMostLikely)
                                   ?? null,
                    }),
      volatility:   family === "pra" ? "lotto"
                  : (family === "threes" || family === "first_basket") ? "aggressive"
                  : "balanced",
      confidence:   mp,
      snapshotSourced: true,
    })
  }

  // Dedup by (player|statFamily|side) keeping best-edge entry per triple.
  const bestBySig = new Map()
  for (const c of rawQualified) {
    const sig = `${c.player}|${c.statFamily}|${c.side}`
    if (!bestBySig.has(sig) || (c.edge ?? 0) > (bestBySig.get(sig).edge ?? 0)) bestBySig.set(sig, c)
  }
  return Array.from(bestBySig.values()).sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0))
}

/**
 * GET /api/best-available?sport=basketball_nba
 */
async function handleNbaBestAvailableGet(req, res, deps) {
  console.log("TRACE BEST-AVAILABLE HIT (NBA):", { sport: req?.query?.sport })
  // 2026-05-25 — Profiling instrumentation. Track wall-time per major stage.
  // Prints final breakdown table at end of request. No logic changes.
  const __profStart = Date.now()
  const __profStages = []
  const __profMark = (label, fn) => {
    const t0 = Date.now()
    const result = fn()
    if (result && typeof result.then === "function") {
      return result.then((r) => {
        __profStages.push({ label, ms: Date.now() - t0 })
        return r
      })
    }
    __profStages.push({ label, ms: Date.now() - t0 })
    return result
  }
  const { axios, oddsSnapshot, normalizeBestAvailableSportKey, refreshGuard, snapshotPath } = deps

  const bestAvailableSportKey = normalizeBestAvailableSportKey(String(req.query?.sport || "").trim())
  const resolvedSnapshotPath = snapshotPath || path.join(__dirname, "..", "snapshot.json")

  let snap = oddsSnapshot && typeof oddsSnapshot === "object" ? oddsSnapshot : null

  const snapshotUpdatedAtMs = snap?.updatedAt ? new Date(snap.updatedAt).getTime() : null
  const snapshotAgeMinutes = Number.isFinite(snapshotUpdatedAtMs)
    ? (Date.now() - snapshotUpdatedAtMs) / 60000
    : Infinity

  const snapshotEventsCount = Array.isArray(snap?.events) ? snap.events.length : 0
  const snapshotRawPropsCount = Array.isArray(snap?.rawProps) ? snap.rawProps.length : 0

  // 2026-05-26 slate-rollover fix — detect "slate complete" so refresh fires
  // even when snapshot has events and is < 8min old (e.g. last refresh was at
  // 9pm, all games done by 11pm, snapshot still appears "fresh" by age alone).
  const __nowMs = Date.now()
  const __eventsArr = Array.isArray(snap?.events) ? snap.events : []
  const __allEventsComplete =
    __eventsArr.length > 0 &&
    __eventsArr.every((ev) => {
      const t = ev?.commence_time || ev?.commenceTime || ev?.gameTime
      const ms = t ? new Date(t).getTime() : NaN
      return Number.isFinite(ms) && (ms + 4 * 3600 * 1000) < __nowMs
    })

  const refreshReasons = []
  if (snapshotEventsCount === 0) refreshReasons.push("events_zero")
  if (snapshotRawPropsCount === 0) refreshReasons.push("rawProps_zero")
  if (snapshotAgeMinutes > 8) refreshReasons.push("stale_over_8m")
  if (__allEventsComplete) refreshReasons.push("slate_complete")

  if (refreshReasons.length) {
    console.log("[NBA SNAPSHOT POLICY]", {
      action: "refresh",
      reasons: refreshReasons,
      ageMinutes: Number.isFinite(snapshotAgeMinutes) ? Math.round(snapshotAgeMinutes * 10) / 10 : null,
      events: snapshotEventsCount,
      rawProps: snapshotRawPropsCount,
      slateComplete: __allEventsComplete,
    })

    // 2026-05-26 slate-rollover fix — DO NOT pre-acquire refreshGuard.inProgress
    // here. The /refresh-snapshot handler in server.js checks the SAME module-level
    // __refreshInProgress (unified Session Y) and bails with "in_progress" if we
    // hold it. That made the auto-refresh path silently dead. Let /refresh-snapshot
    // own its mutex; we just trigger it. If it returns skipped:cooldown we continue
    // with whatever snap we have (best-effort, no deadlock).
    //
    // slate_complete bypasses the bestAvailable-side cooldown check so end-of-slate
    // rollover is not blocked by a recent stale refresh.
    try {
      const now = Date.now()
      const bypassCooldown = __allEventsComplete
      if (!bypassCooldown && (now - refreshGuard.lastRefreshTime) < 2 * 60 * 1000) {
        console.log("[REFRESH GUARD]", { skipped: true, reason: "bestavail_cooldown" })
      } else {
        refreshGuard.lastRefreshTime = now
        console.log("[REFRESH GUARD]", { skipped: false, reason: null, bypassCooldown })

        const port = Number(process.env.PORT || 4000)
        const sportParam = encodeURIComponent(String(bestAvailableSportKey || "basketball_nba"))
        await axios.get(`http://127.0.0.1:${port}/refresh-snapshot?force=1&sport=${sportParam}`, { timeout: 120000 })
      }
    } catch (e) {
      console.warn("[NBA SNAPSHOT POLICY] refresh failed", {
        message: e?.message || String(e),
        status: e?.response?.status || null,
      })
    }

    snap = oddsSnapshot && typeof oddsSnapshot === "object" ? oddsSnapshot : null
  } else {
    console.log("[NBA SNAPSHOT POLICY]", {
      action: "use_snapshot",
      reasons: [],
      ageMinutes: Number.isFinite(snapshotAgeMinutes) ? Math.round(snapshotAgeMinutes * 10) / 10 : null,
      events: snapshotEventsCount,
      rawProps: snapshotRawPropsCount,
    })
  }

  __profStages.push({ label: "1_snapshot_policy", ms: Date.now() - __profStart })

  const __t_loadDisk = Date.now()
  if (!snapshotHasBody(snap)) {
    const disk = loadNbaSnapshotFromDisk(resolvedSnapshotPath)
    if (disk) snap = disk
  }
  __profStages.push({ label: "2_load_snapshot_from_disk", ms: Date.now() - __t_loadDisk })

  const __t_slices = Date.now()
  const slices = buildNbaBoardSlicesFromSnapshot(snap && typeof snap === "object" ? snap : {})
  __profStages.push({ label: "3_build_board_slices", ms: Date.now() - __t_slices, rows: Array.isArray(slices?.completeUniverse) ? slices.completeUniverse.length : 0 })

  // REAL RECENT FORM: attach from API-Sports logs BEFORE candidate creation.
  const __t_recentForm = Date.now()
  await enrichRowsWithRecentForm({
    axios,
    rows: slices?.completeUniverse,
  })
  __profStages.push({ label: "4_enrich_recent_form", ms: Date.now() - __t_recentForm })

  const ingestDiagnostics =
    snap?.diagnostics && typeof snap.diagnostics === "object"
      ? {
          ingestCoverage: snap.diagnostics.ingestCoverage,
          baseMarkets: snap.diagnostics.fetchAudit?.baseRequestMarkets,
          extraMarkets: snap.diagnostics.fetchAudit?.extraRequestMarkets,
        }
      : {}

  const __t_oppBoard = Date.now()
  const nbaOpportunityBoard = buildNbaOpportunityBoard({
    ladderBoard: slices.ladderBoard,
    corePropsBoard: slices.corePropsBoard,
    completeUniverse: slices.completeUniverse,
    ingestDiagnostics,
    ingestRows: Array.isArray(snap?.rawProps) ? snap.rawProps : Array.isArray(snap?.props) ? snap.props : [],
  })
  __profStages.push({ label: "5_build_opportunity_board", ms: Date.now() - __t_oppBoard })

  const __t_insightBoard = Date.now()
  const nbaInsightBoard = buildNbaInsightBoard({
    ladderBoard: slices.ladderBoard,
    corePropsBoard: slices.corePropsBoard,
    specialBoard: slices.specialBoard,
    firstBasketBoard: slices.firstBasketBoard,
    nbaOpportunityBoard,
  })
  __profStages.push({ label: "6_build_insight_board", ms: Date.now() - __t_insightBoard })

  const __t_playerCheck = Date.now()
  const __playerCheckPool = [
    ...(Array.isArray(nbaInsightBoard?.bestOverallPlays) ? nbaInsightBoard.bestOverallPlays : []),
    ...(Array.isArray(nbaInsightBoard?.corePropsBoard) ? nbaInsightBoard.corePropsBoard : []),
    ...(Array.isArray(nbaInsightBoard?.ladderBoard) ? nbaInsightBoard.ladderBoard : []),
  ]
  const __seenChk = new Set()
  const __dedupePush = (out, r) => {
    if (!r || typeof r !== "object") return
    const k = `${String(r.player || "")}|${String(r.propType || "")}|${String(r.line ?? "")}|${String(r.side || "")}`
    if (__seenChk.has(k)) return
    __seenChk.add(k)
    out.push(r)
  }
  const __withRf = __playerCheckPool.filter(
    (r) => r?.recentForm && typeof r.recentForm === "object" && Number.isFinite(Number(r.recentForm?.trend_delta))
  )
  const __neg = __withRf
    .filter((r) => Number(r.recentForm.trend_delta) < 0)
    .sort((a, b) => Number(a.recentForm.trend_delta) - Number(b.recentForm.trend_delta))
  const __pos = __withRf
    .filter((r) => Number(r.recentForm.trend_delta) > 0)
    .sort((a, b) => Number(b.recentForm.trend_delta) - Number(a.recentForm.trend_delta))
  const __playerCheck = []
  for (const r of __neg.slice(0, 2)) __dedupePush(__playerCheck, r)
  for (const r of __pos.slice(0, 2)) __dedupePush(__playerCheck, r)
  for (const r of __withRf) {
    __dedupePush(__playerCheck, r)
    if (__playerCheck.length >= 5) break
  }
  if (__playerCheck.length < 5) {
    for (const r of __playerCheckPool) {
      __dedupePush(__playerCheck, r)
      if (__playerCheck.length >= 5) break
    }
  }
  for (const r of __playerCheck) {
    console.log("PLAYER CHECK:", r.player, "finalWeight=", r.finalWeight, "recentForm=", r.recentForm)
  }

  __profStages.push({ label: "7_player_check_dedup", ms: Date.now() - __t_playerCheck })

  // Fix R1 Step 3 — build workstation candidates + featured + slips from corePropsBoard
  const __t_wsBuild = Date.now()
  const todayStr = new Date().toISOString().slice(0, 10)
  let wsCandidates = []
  let wsFeatured = null
  let wsAiSlips = { slips: { safe: [], balanced: [], aggressive: [], lotto: [] } }

  try {
    const wsCandidatesRaw = buildNbaBestAvailableWsCandidates(slices.corePropsBoard || [])
    // 2026-05-26 — Lane A (cap raise): match the workstationRoutes /state caps
    // (12 → 25 per game, 10 → 15 per stat, 6 → 9 per stat-side). Keep these
    // two routes consistent so candidate pools don't differ across surfaces.
    wsCandidates = diversifyCandidates(wsCandidatesRaw, {
      sport: "nba",
      maxPerPlayer: 3,
      maxPerGame: 25,
      maxPerStat: 15,
      maxPerStatSide: 9,
    })
    wsFeatured = buildFeaturedPlays({
      candidates: wsCandidates,
      sport: "nba",
      date: todayStr,
    })
    wsAiSlips = buildAiSlips({
      candidates: wsCandidates,
      options: { sport: "nba", date: todayStr, maxPerTier: 4 },
    })
  } catch (wsErr) {
    console.error("[nbaIsolatedRoutes] bestAvailable workstation build error:", wsErr?.message)
  }
  __profStages.push({ label: "8_ws_candidates_featured_slips", ms: Date.now() - __t_wsBuild })

  // Map insight rows into elite/strong/best buckets using probability field
  const __t_respShape = Date.now()
  const __allInsightRows = [
    ...(Array.isArray(nbaInsightBoard?.bestOverallPlays) ? nbaInsightBoard.bestOverallPlays : []),
    ...(Array.isArray(nbaInsightBoard?.corePropsBoard) ? nbaInsightBoard.corePropsBoard : []),
  ]
  // 2026-05-25 — Form/projection-contradiction filter. Operator caught Mitchell
  // OVER threes 3.5 (L5=2.6) reaching ELITE via this insight-board path because
  // it bypassed classifyNbaTier (which has the form-contradiction + projection-
  // contradiction gates). Now: drop wrong-direction picks BEFORE bucketing.
  // Catches the same patterns the main tier classifier catches downstream.
  function __passesDirectionalGate(r) {
    if (!r || typeof r !== "object") return false
    const side = String(r.side || "").toLowerCase()
    if (side !== "over" && side !== "under") return true  // can't evaluate
    const line = Number(r.line)
    if (!Number.isFinite(line) || line <= 0) return true
    // Form-contradiction check
    const l5 = Number(r.recentForm && r.recentForm.last5_avg) ||
               Number(r.recentForm && r.recentForm.last10_avg) ||
               Number(r.last5Avg)
    if (Number.isFinite(l5)) {
      const overshoot = (l5 - line) / line
      if ((side === "under") && overshoot > 0.07) return false
      if ((side === "over")  && overshoot < -0.07) return false
    }
    // Projection-contradiction check (insight rows carry projection.mostLikely
    // or stat.mostLikely depending on builder)
    const projML = Number(r.projection && r.projection.mostLikely) ||
                   Number(r.stat && r.stat.mostLikely) ||
                   Number(r.projectionMostLikely)
    if (Number.isFinite(projML)) {
      const projGap = (projML - line) / line
      if ((side === "under") && projGap > 0.15) return false
      if ((side === "over")  && projGap < -0.15) return false
    }
    return true
  }
  const __directionalRows = __allInsightRows.filter(__passesDirectionalGate)
  const __elitePlays = __directionalRows.filter((r) => Number(r?.probability ?? r?.adjustedConfidenceScore ?? 0) >= 0.55)
  const __strongPlays = __directionalRows.filter((r) => {
    const p = Number(r?.probability ?? r?.adjustedConfidenceScore ?? 0)
    return p >= 0.42 && p < 0.55
  })
  console.log("[insight-board-gate] filtered " + (__allInsightRows.length - __directionalRows.length) + " wrong-direction picks (form/projection contradiction)")

  __profStages.push({ label: "9_response_shape", ms: Date.now() - __t_respShape })

  // ── PROFILING SUMMARY ──────────────────────────────────────────────────
  // 2026-05-25 — Operator-requested cycle-time analysis. Find which stage
  // grew 5-10x after gameLogs went 14d→90d + Phase 2 enrichment + book
  // allowlist expansion. Prints sorted by descending duration.
  const __profTotal = Date.now() - __profStart
  const __profSorted = [...__profStages].sort((a, b) => b.ms - a.ms)
  console.log("\n[PROFILE /api/best-available?sport=basketball_nba]")
  console.log("  TOTAL: " + __profTotal + "ms (" + (__profTotal/1000).toFixed(1) + "s)")
  console.log("  --- stages, descending by duration ---")
  for (const s of __profSorted) {
    const pct = ((s.ms / __profTotal) * 100).toFixed(1).padStart(5)
    const ms = String(s.ms).padStart(7)
    const rows = s.rows != null ? `  [rows=${s.rows}]` : ""
    console.log(`  ${pct}% ${ms}ms  ${s.label}${rows}`)
  }
  console.log("[/PROFILE]\n")

  return res.json({
    bestAvailable: {
      best: __elitePlays.slice(0, 10),
      elite: __elitePlays.slice(0, 6),
      strong: __strongPlays.slice(0, 8),
      ladders: Array.isArray(nbaInsightBoard?.ladderBoard) ? nbaInsightBoard.ladderBoard.slice(0, 6) : [],
      firstBasket: Array.isArray(nbaInsightBoard?.firstBasketBoard) ? nbaInsightBoard.firstBasketBoard.slice(0, 4) : [],
      aiSlips: wsAiSlips?.slips ?? { safe: [], balanced: [], aggressive: [], lotto: [] },
      featured: wsFeatured,
      wsCandidates: wsCandidates.slice(0, 24),
    },
    nbaOpportunityBoard,
    nbaInsightBoard,
    nbaCacheDiagnostics: getNbaCacheDiagnostics(),
  })
}

/**
 * Rebuild NBA `oddsSnapshot` via Odds API (no legacy compiled refresh).
 * MLB sidecar refresh runs in `server.js` before this handler is invoked.
 */
async function handleNbaRefreshSnapshotAfterMlbBranch(req, res, deps) {
  const { ODDS_API_KEY, replaceOddsSnapshot, backendRoot } = deps

  const root = backendRoot || DEFAULT_BACKEND_ROOT

  if (typeof replaceOddsSnapshot !== "function") {
    return res.status(500).json({
      ok: false,
      sport: "basketball_nba",
      error: "replaceOddsSnapshot callback missing (server wiring)",
    })
  }

  if (isNbaReplayQuery(req)) {
    const diskPath = path.join(root, "snapshot.json")
    const replaySnap = loadNbaSnapshotFromDisk(diskPath)
    if (!replaySnap || !snapshotHasBody(replaySnap)) {
      return res.status(503).json({
        ok: false,
        sport: "basketball_nba",
        error: "Replay requested but snapshot.json is missing or empty",
        replay: true,
      })
    }
    replaceOddsSnapshot(replaySnap)
    try {
      saveNbaSnapshotToDisk(root, replaySnap)
    } catch (e) {
      console.log("[NBA-SNAPSHOT] replay disk save skipped", e?.message || e)
    }

    // Session BD — also freeze on replay path so disk-replays observe their
    // own bestProps state (idempotent — same snapshot updatedAt → same epoch).
    try {
      const bestPropsR = Array.isArray(replaySnap?.bestProps) ? replaySnap.bestProps : []
      if (bestPropsR.length) {
        const fzR = _lazyFreezePredictionEpoch({
          predictions:       bestPropsR,
          sport:             "nba",
          slateDate:         _detroitSlateDateKey(replaySnap?.updatedAt),
          source:            "snapshot_bestprops_replay",
          snapshotUpdatedAt: replaySnap?.updatedAt,
          notes:             "replay snapshot bestProps freeze",
        })
        console.log("[NBA-SNAPSHOT-FREEZE-REPLAY]", {
          ok: fzR.ok, epochInserted: fzR.epochInserted,
          predictionsInserted: fzR.predictionsInserted,
          predictionsSkipped: fzR.predictionsSkipped,
          contextualInserted: fzR.contextualInserted,
        })
      }
    } catch (fzReplayErr) {
      console.warn("[NBA-SNAPSHOT-FREEZE-REPLAY] non-fatal:", fzReplayErr?.message || fzReplayErr)
    }

    return res.status(200).json({
      ok: true,
      sport: "basketball_nba",
      replay: true,
      updatedAt: replaySnap.updatedAt || null,
      events: Array.isArray(replaySnap.events) ? replaySnap.events.length : 0,
      rawProps: Array.isArray(replaySnap.rawProps) ? replaySnap.rawProps.length : 0,
      props: Array.isArray(replaySnap.props) ? replaySnap.props.length : 0,
    })
  }

  if (!ODDS_API_KEY) {
    return res.status(500).json({
      ok: false,
      sport: "basketball_nba",
      error: "Missing ODDS_API_KEY in .env",
    })
  }

  try {
    const snap = await fetchNbaOddsSnapshot({ oddsApiKey: ODDS_API_KEY })
    replaceOddsSnapshot(snap)
    try {
      saveNbaSnapshotToDisk(root, snap)
    } catch (e) {
      console.log("[NBA-SNAPSHOT] disk save failed", e?.message || e)
    }

    // Session BD — Longitudinal Freeze Pipeline. Persist an observational
    // record of the predictions we just surfaced via bestProps. Honest
    // sparsity on contextual columns — no contextual layer fires here.
    try {
      const bestProps = Array.isArray(snap?.bestProps) ? snap.bestProps : []
      if (bestProps.length) {
        const fzResult = _lazyFreezePredictionEpoch({
          predictions:       bestProps,
          sport:             "nba",
          slateDate:         _detroitSlateDateKey(snap?.updatedAt),
          source:            "snapshot_bestprops",
          snapshotUpdatedAt: snap?.updatedAt,
          notes:             "snapshot bestProps freeze (no contextual enrichment)",
        })
        console.log("[NBA-SNAPSHOT-FREEZE]", {
          ok:                  fzResult.ok,
          epochInserted:       fzResult.epochInserted,
          predictionsInserted: fzResult.predictionsInserted,
          predictionsSkipped:  fzResult.predictionsSkipped,
          contextualInserted:  fzResult.contextualInserted,
          error:               fzResult.error,
        })
      } else {
        console.log("[NBA-SNAPSHOT-FREEZE] skipped (no bestProps)")
      }
    } catch (fzErr) {
      console.warn("[NBA-SNAPSHOT-FREEZE] non-fatal:", fzErr?.message || fzErr)
    }

    return res.status(200).json({
      ok: true,
      sport: "basketball_nba",
      updatedAt: snap.updatedAt,
      events: Array.isArray(snap.events) ? snap.events.length : 0,
      rawProps: Array.isArray(snap.rawProps) ? snap.rawProps.length : 0,
      props: Array.isArray(snap.props) ? snap.props.length : 0,
    })
  } catch (e) {
    console.log("[NBA-SNAPSHOT-FETCH-FAILED]", e?.message || e)
    return res.status(500).json({
      ok: false,
      sport: "basketball_nba",
      error: e?.message || String(e),
    })
  }
}

module.exports = {
  handleNbaBestAvailableGet,
  handleNbaRefreshSnapshotAfterMlbBranch,
  // Phase F2 — observability exports
  getNbaCacheDiagnostics,
  resetNbaCacheDiagnostics,
}
