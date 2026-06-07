"use strict"

/**
 * Workstation Routes — read-only intelligence API for the frontend workstation.
 *
 * Sits ON TOP of the existing intelligence layers. Never duplicates business
 * logic. All routes are pure file readers + light computation.
 *
 * Endpoints (all GET except /preview):
 *   GET  /api/ws/health
 *   GET  /api/ws/state?sport=mlb&date=2026-05-06
 *   GET  /api/ws/ai-slips?sport=mlb&date=...
 *   GET  /api/ws/portfolio?sport=mlb&date=...
 *   GET  /api/ws/line-shopping?sport=mlb&date=...&limit=50
 *   GET  /api/ws/timing?sport=mlb&date=...&urgency=immediate
 *   GET  /api/ws/ledger?windowDays=30
 *   GET  /api/ws/first-basket?sport=nba&date=...
 *   POST /api/ws/bet-builder/preview
 *
 * Goals:
 *   - Lightweight: every route reads pre-computed files
 *   - Sport-agnostic: single shared shape
 *   - Cache-friendly: in-memory TTL cache (60s) per (sport,date)
 */

const express = require("express")
const fs = require("fs")
const path = require("path")
const { diversifyCandidates } = require("../pipeline/shared/buildCandidateDiversity")
const { isAllowedBook, canonicalBookName } = require("../pipeline/shared/sportsbookAllowlist")
// Phase Sport-Identity-Integrity-1A (2026-05-17): canonical sport-identity
// resolver. ONE authoritative alias map. Every sport input (mlb /
// baseball_mlb / MLB / nba / basketball_nba / etc.) converges onto the
// canonical runtime identity ("mlb" or "nba"). See verifySportIdentityParity.js.
const { resolveCanonicalSport } = require("../pipeline/shared/resolveCanonicalSport")
const { classifyNbaTier } = require("../pipeline/nba/nbaTierClassifier")
// 2026-05-26 — Stamp displayBundle on snapSupplement candidates so MODEL PROB
// / EDGE PROB / signals panel render correctly on iPhone. Previously only
// tracked_best entries (via buildNbaBestBetsBoard) got a displayBundle —
// snapSupplement candidates showed "—" for those fields.
const { buildPlayDisplayBundle } = require("../pipeline/nba/buildPlayDisplayBundle")
const { nbaRowModelProbability, nbaRowEdge } = require("../pipeline/nba/nbaModelSignals")
const { enrichNbaRowStatLayerInputs, applyTeamFallbackFromProjections } = require("../pipeline/nba/nbaEventTeamResolve")
// Phase 1 — Recent Form V1 (Session AP). Real per-player rolling stats from
// settled-bet history. Honest null when sample insufficient.
// enrichRowWithRecentForm is a no-op when no form exists for that player+stat.
const { enrichRowWithRecentForm: enrichNbaRowWithRecentForm } = require("../pipeline/nba/nbaRecentFormCache")
// 2026-05-24 — Phase 2 enrichers also wired into the workstation read path so
// the FE always sees opponent / oppDef / pace / playerSeasonStats even when
// the persisted tracked_best entry lacks them (stale snapshots, partial runs).
const { enrichRowWithTeamStats: enrichNbaRowWithTeamStats }                = require("../pipeline/nba/nbaTeamStatsCache")
const { enrichRowWithPlayerSeasonStats: enrichNbaRowWithPlayerSeasonStats } = require("../pipeline/nba/nbaPlayerSeasonStatsCache")
// Phase 1 — Lineup + Rotation Intelligence V1 (Session AR). Real role / minutes-
// trend deriver from the same ESPN game-log cache. Injects starterFlag +
// projectedMinutes (already consumed by nbaModelSignals.roleSignals) +
// structured roleContext for explainability. Honest no-op when sample < 3.
const { enrichRowWithRoleContext: enrichNbaRowWithRoleContext } = require("../pipeline/nba/nbaRoleContextDeriver")
// Phase 1 — Teammate Absence + Usage Redistribution V1 (Session AS). Cross-
// references tonight's snapshot rows with the same ESPN game-log cache to
// infer likely-absent teammates per team, then computes per-stat redistribution
// deltas (with-absent vs baseline). Sets row.teammateRedistShift consumed by
// nbaRowIndependentModelProbability. Bounded ±3 pp; sample-quality dampened.
const { buildSlateContextFromSnapshot: buildNbaTeammateSlateContext,
        enrichRowWithTeammateContext:  enrichNbaRowWithTeammateContext } = require("../pipeline/nba/nbaTeammateContextDeriver")
// Phase 1 — Market + News Adaptation V1 (Session AT). Pure derivation from
// existing multi-book snapshot data — no new feed, no scraping, no fake CLV.
// Per-prop consensus across books + per-row delta-vs-consensus. Sets
// row.marketShift consumed by nbaRowIndependentModelProbability. Bounded ±2pp;
// shrunk further when book dispersion is high (consensus uncertain).
const { buildSlateMarketContext, enrichRowWithMarketContext: enrichNbaRowWithMarketContext } = require("../pipeline/nba/nbaMarketContextDeriver")
// Phase 1 — Live Injury + Availability V1 (Session AV). Reads
// data/nbaInjuryReport.json (populated by scripts/populateNbaInjuryReport.js
// from ESPN per-team injury endpoint) using the EXISTING dormant
// normaliser ingestNbaOfficialInjuryReport.normalizeNbaOfficialAvailabilityStatus.
// Sets row.playerStatus + row.availabilityContext + row.availabilityShift.
// Honest no-op when player not in cache (NEVER fabricates "active by default").
const { enrichRowWithAvailability: enrichNbaRowWithAvailability } = require("../pipeline/nba/nbaAvailabilityCache")
// Phase Live-Game-State-Integration-1b — canonical player normalizer (NFD +
// diacritic-strip + lowercase + trim) used as the join key when attaching MLB
// mlbLiveState from snapshot rows onto the bettor candidate pool. intelligence.js
// is the canonical identity/join authority (PRESERVED).
const { normPlayer } = require("../storage/intelligence")
// Phase Live-Game-State-Integration-1b — canonical pitcher-market classifier.
// tracked_best entries carry marketKey but NOT isPitcherMarket; the slip gate's
// pitcher-scratch branch needs it, so we derive it from the canonical classifier
// during the MLB join (pure function; mlbClassification not modified).
const { isMlbPitcherMarketKey } = require("../pipeline/markets/mlbClassification")
// Session AZ — Frozen Prediction + Grading Architecture V1. Captures an
// immutable observational snapshot of every cache-miss prediction cycle
// (predictions + their full contextual reasoning state). NEVER duplicates
// existing prediction_snapshots writer — delegates to it, then writes
// new prediction_epochs + frozen_contextual_states rows on top.
const { freezePredictionEpoch } = require("../pipeline/memory/freezePredictionEpoch")
const screenshotRoutes = require("../pipeline/screenshots/screenshotRoutes")
const { compactLineShopping, compactTiming, compactPortfolio } = require("../pipeline/shared/buildWorkstationCompactors")
// 2026-06-01 Phase Date-Doctrine-1B — canonical ET slate date helper. Replaces
// all server-local + UTC date math throughout this file. See SLATE_DATE_DOCTRINE.md.
const { currentSlateDateEt, slateDateForTimestamp } = require("../pipeline/shared/slateDate")
const slipAuditRoute      = require("./slipAuditRoute")
const portfolioAuditRoute = require("./portfolioAuditRoute")
// Operational trust hardening — snapshot freshness probe. Read-only.
// Detects stale snapshots being silently served from disk and surfaces
// `freshness` diagnostics in every /state response + `/health` endpoint.
// Thresholds: env NBA_SNAPSHOT_WARN_MINUTES / NBA_SNAPSHOT_STALE_MINUTES
// and the MLB_-prefixed counterparts. Defaults: warn 10min, stale 25min.
const {
	computeSnapshotFreshness,
	computeSnapshotFreshnessFromDisk,
	logStaleProbe,
	buildFreshnessPayload,
	snapshotFilePath,
} = require("../pipeline/shared/snapshotFreshness")

const router = express.Router()

// Screenshot intelligence layer — JSON ingestion + classification
// POST /api/ws/screenshots/ingest
// GET  /api/ws/screenshots/list
// GET  /api/ws/screenshots/submission/:id
// GET  /api/ws/screenshots/:id
router.use("/screenshots", screenshotRoutes)

// Slip semantic audit — POST /api/ws/slip-audit
// Evaluates manually submitted slips against runtime semantics, volatility,
// correlation, and tier identity. No aiSlips generation involved.
router.use("/slip-audit", slipAuditRoute)

// Portfolio structural analysis — POST /api/ws/portfolio-audit
// Analyzes multiple slips together: player/game/stat exposure, diversification score.
router.use("/portfolio-audit", portfolioAuditRoute)

const TRACKING_DIR = path.join(__dirname, "..", "runtime", "tracking")

// ─── Lane calibration overlay (2026-05-23) ───────────────────────────────────
// scorecards/lane_calibration.json is written by backend/scripts/laneScoreboard.js
// every time it runs. Reads it lazily (cached 5min) and resolves
// (sport, statFamily) → {status, hitRate, modelAvg, roi, sample}.
//
// This is purely additive — the canonical model behavior is unchanged. The
// overlay just LABELS each surfaced prop with the model's own track record
// on that lane so the operator can see which props deserve trust.
//
// Statuses (from laneScoreboard.js):
//   "calibrated_positive"           — green: model is honest + profitable
//   "calibrated_neutral"            — green-ish: calibrated but flat ROI
//   "miscalibrated_overconfident"   — amber: model says X but reality is X−Δ
//   "miscalibrated_underconfident"  — amber-good: model is being too cautious
//   "broken"                        — red: ROI < -15%, do not bet
//   "insufficient_sample"           — grey: <30 decided bets yet
//   "no_data"                       — blank: pipeline isn't capturing this prop
const LANE_CALIBRATION_PATH = path.join(__dirname, "..", "..", "scorecards", "lane_calibration.json")
let _laneCalibrationCache = { loadedAt: 0, data: null }
function loadLaneCalibration() {
  const now = Date.now()
  if (now - _laneCalibrationCache.loadedAt < 5 * 60 * 1000 && _laneCalibrationCache.data) {
    return _laneCalibrationCache.data
  }
  try {
    if (!fs.existsSync(LANE_CALIBRATION_PATH)) {
      _laneCalibrationCache = { loadedAt: now, data: { verdicts: {} } }
      return _laneCalibrationCache.data
    }
    const raw = JSON.parse(fs.readFileSync(LANE_CALIBRATION_PATH, "utf8"))
    _laneCalibrationCache = { loadedAt: now, data: raw }
    return raw
  } catch (_) {
    _laneCalibrationCache = { loadedAt: now, data: { verdicts: {} } }
    return _laneCalibrationCache.data
  }
}
function _normFam(s) { return String(s || "").toLowerCase().replace(/[\s_\-]+/g, "") }
function resolveLaneCalibration(sport, statFamily) {
  const cal = loadLaneCalibration()
  if (!cal || !cal.verdicts) return null
  const fam = _normFam(statFamily)
  const sp  = String(sport || "").toLowerCase()
  // Try sport-prefixed alias first (most specific), then bare familyId
  return cal.verdicts[`${sp}:${fam}`] || cal.verdicts[fam] || null
}
function laneStatusBadge(status) {
  // FE-friendly badge metadata. Returns null when there's no data so the
  // FE can simply skip rendering the badge instead of showing a "blank" one.
  if (!status || status === "no_data") return null
  const BADGES = {
    calibrated_positive:        { tone: "green",   label: "CALIBRATED",   tip: "Model trusts itself here. +ROI over decided bets." },
    calibrated_neutral:         { tone: "green",   label: "CALIBRATED",   tip: "Model is calibrated; flat ROI so far." },
    miscalibrated_overconfident:{ tone: "amber",   label: "OVERCONFIDENT",tip: "Model says higher than it actually hits — bet smaller." },
    miscalibrated_underconfident:{ tone: "amber",   label: "UNDERCONFIDENT",tip: "Model is too cautious — may be hidden value." },
    broken:                     { tone: "red",     label: "BROKEN",       tip: "Model is proven wrong on this prop. Do not bet." },
    insufficient_sample:        { tone: "grey",    label: "PENDING",      tip: "Not enough decided bets yet to verify the model." },
    early_warning_lossy:        { tone: "amber",   label: "EARLY: LOSSY", tip: "Small sample but losing money on this prop so far. Wait for more data." },
  }
  return BADGES[status] || null
}

// ── helpers ───────────────────────────────────────────────────────────────────

function todayKey() {
  // 2026-06-01 Phase Date-Doctrine-1B — canonical ET helper.
  return currentSlateDateEt()
}

function readJsonSafe(p, fallback = null) {
  try {
    if (!fs.existsSync(p)) return fallback
    return JSON.parse(fs.readFileSync(p, "utf8"))
  } catch (_) { return fallback }
}

/**
 * Read snapshot rows for a sport.
 * - Tries snapshot-{sport}.json first (sport-specific file)
 * - Falls back to snapshot.json for NBA (legacy file has data.props key)
 * - Handles both data.rows (MLB) and data.props (NBA) key shapes
 *
 * The 4 existing callers expect a plain array — we preserve that contract.
 * For callers that ALSO want a freshness payload, use
 * `readSnapshotRowsWithFreshness(sport)` below.
 */
function readSnapshotRows(sport) {
  const sportFile = path.join(__dirname, "..", `snapshot-${sport}.json`)
  let snap = readJsonSafe(sportFile, null)
  // For NBA: fall back to snapshot.json which has data.props instead of data.rows
  if (!snap && sport === "nba") {
    snap = readJsonSafe(path.join(__dirname, "..", "snapshot.json"), null)
  }
  return snap?.data?.rows || snap?.data?.props || snap?.rows || []
}

/**
 * Returns the snapshot rows AND a freshness diagnostic payload computed
 * from the same on-disk file. Designed for use inside response builders
 * that surface freshness to the client without altering the legacy
 * `readSnapshotRows` API used in 4 other call sites.
 *
 * Behavior:
 *   - Always returns { rows: [...], freshness: {...} }; never throws.
 *   - When the file is missing OR has no usable timestamp, `freshness.isStale`
 *     is true and `freshness.status` is "absent". The rows array is still
 *     returned (empty in that case).
 *   - Emits a single-line `[STALE-SNAPSHOT-DETECTED]` log when stale, and
 *     `[STALE-SNAPSHOT-WARNING]` when in the warning band.
 *
 * @param {string} sport — "nba" | "mlb"
 * @param {object} [opts] — optional overrides for tests
 * @param {string} [opts.context="ws_state"] — tag for the stale probe
 * @returns {{ rows: any[], freshness: object }}
 */
function readSnapshotRowsWithFreshness(sport, { context = "ws_state" } = {}) {
  const sp = String(sport || "").toLowerCase()
  // Resolve the on-disk file we will actually read so freshness reports on
  // the correct path even when NBA falls back to legacy snapshot.json.
  let file = path.join(__dirname, "..", `snapshot-${sp}.json`)
  let snap = readJsonSafe(file, null)
  if (!snap && sp === "nba") {
    file = path.join(__dirname, "..", "snapshot.json")
    snap = readJsonSafe(file, null)
  }

  let fileExists = false
  let fileModifiedMs = null
  try {
    const stat = fs.statSync(file)
    fileExists = true
    fileModifiedMs = stat.mtimeMs
  } catch (_) {
    fileExists = false
  }

  const freshness = computeSnapshotFreshness({
    sport: sp,
    snapshot: snap,
    file,
    fileModifiedMs,
    fileExists,
  })

  // Single-line probe to TERM logs. Always-on for stale/warning/absent;
  // silent for fresh (to avoid log spam during normal operation).
  logStaleProbe(freshness, { context })

  const rows = snap?.data?.rows || snap?.data?.props || snap?.rows || []
  return { rows, freshness }
}

function fileFor(sport, kind, date) {
  return path.join(TRACKING_DIR, `${sport}_${kind}_${date}.json`)
}

function findLatestDateWithData(sport) {
  try {
    // Phase Candidate-Ecology-Parity-1A (2026-05-17): canonical date sanity.
    // Future-dated sentinel files (e.g. `mlb_tracked_bets_9999-12-31.json`)
    // would otherwise sort to the top of the descending date list and shadow
    // the real current-date file, collapsing the entire downstream
    // ecology to the sentinel's tiny entry count (≈5) regardless of how
    // many real candidates exist today. Reject any date strictly greater
    // than todayKey() before scanning — keeps the canonical "latest date
    // with data" honest. Anti-fabrication: never invents a date; honors
    // every legitimate past-or-today date in descending order.
    const today = todayKey()
    const files = fs.readdirSync(TRACKING_DIR)
    const dayKeys = files
      .filter((f) => f.startsWith(`${sport}_tracked_`) && f.endsWith(".json"))
      .map((f) => (f.match(/_(\d{4}-\d{2}-\d{2})\.json$/) || [])[1])
      .filter(Boolean)
      .filter((dk) => dk <= today)
      .sort()
      .reverse()
    for (const dk of dayKeys) {
      const bets = readJsonSafe(fileFor(sport, "tracked_bets", dk), [])
      const best = readJsonSafe(fileFor(sport, "tracked_best", dk), {})
      if ((Array.isArray(bets) && bets.length) || (best?.entries?.length)) return dk
    }
  } catch (_) {}
  return todayKey()
}

function resolveSportDate(req) {
  // Phase Sport-Identity-Integrity-1A: canonical alias normalization.
  // Maps every recognized sport alias (mlb / baseball_mlb / MLB / nba /
  // basketball_nba / etc.) to the canonical runtime identity ("mlb" or
  // "nba"). The canonical identity is what every downstream layer
  // (fileFor / findLatestDateWithData / pool builder / verifier) keys on.
  // Unrecognized aliases fall back to the historical default "mlb".
  const rawSport = req.query.sport || req.body?.sport || "mlb"
  const sport = resolveCanonicalSport(rawSport, { fallback: "mlb" })
  const dateRaw = req.query.date || req.body?.date
  const date = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(String(dateRaw))
    ? String(dateRaw)
    : findLatestDateWithData(sport)
  return { sport, date }
}

// ── lightweight cache (60s TTL) ───────────────────────────────────────────────

const CACHE_TTL_MS = 60 * 1000
const cache = new Map()

function cached(key, builder) {
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && now - hit.t < CACHE_TTL_MS) return hit.v
  const v = builder()
  cache.set(key, { t: now, v })
  return v
}

// 2026-05-26 — NBA stale-snapshot auto-refresh for the /state path.
// /api/best-available already auto-refreshes via the policy in nbaIsolatedRoutes,
// but the iPhone PWA hits /api/ws/state, which had no refresh trigger and was
// serving snapshots ageing past 90+ minutes (operator-reported). This guard
// fires a synchronous /refresh-snapshot call when the on-disk snapshot is
// older than 8 minutes for NBA. MLB is unaffected (sport-gated).
//
// Cross-request mutex prevents concurrent refresh fans-out. The 2-min cooldown
// lives inside /refresh-snapshot itself (server.js), so we don't double-cooldown.
let _wsRefreshInProgress = false
let _wsLastRefreshTriggerMs = 0
const WS_AUTO_REFRESH_STALE_MIN = 8

async function maybeTriggerNbaSnapshotRefresh(sport, freshness) {
  if (sport !== "nba") return false
  const ageMin = Number(freshness?.snapshotAgeMinutes)
  if (!Number.isFinite(ageMin) || ageMin < WS_AUTO_REFRESH_STALE_MIN) return false
  if (_wsRefreshInProgress) {
    console.log("[WS-AUTO-REFRESH] skipped — another refresh in progress")
    return false
  }
  // Local fan-out guard: don't fire more than once every 2 min from this path
  // (the /refresh-snapshot endpoint has its own 2-min cooldown anyway).
  if (Date.now() - _wsLastRefreshTriggerMs < 2 * 60 * 1000) {
    console.log("[WS-AUTO-REFRESH] skipped — local cooldown")
    return false
  }
  _wsRefreshInProgress = true
  _wsLastRefreshTriggerMs = Date.now()
  try {
    const port = Number(process.env.PORT || 4000)
    const url  = `http://127.0.0.1:${port}/refresh-snapshot?force=1&sport=basketball_nba`
    console.log("[WS-AUTO-REFRESH] triggering /refresh-snapshot — snapshot stale at %sm", ageMin.toFixed(1))
    // Node 18+ has global fetch; this avoids adding axios as a route-level dep.
    const ctl = new AbortController()
    const t   = setTimeout(() => ctl.abort(), 120000)
    try {
      const r = await fetch(url, { signal: ctl.signal })
      console.log("[WS-AUTO-REFRESH] refresh response status=%s", r.status)
    } finally {
      clearTimeout(t)
    }
    return true
  } catch (e) {
    console.warn("[WS-AUTO-REFRESH] refresh failed:", e?.message || e)
    return false
  } finally {
    _wsRefreshInProgress = false
  }
}

// ── candidate normalization (matches buildSlipAi expectations) ───────────────

function enrichBestEntry(e, betsById) {
  if (!e) return null
  const idGuess = `${e.slateDate || ""}|${(e.player || "").toLowerCase()}|${(e.eventId || "")}|${(e.propType || "").toLowerCase().replace(/\s+/g, "")}|${(e.side || "").toLowerCase()}|${e.line ?? ""}|${e.odds ?? ""}|${(e.book || "").toLowerCase()}`
  const tb = (betsById && betsById.get(idGuess)) || null
  const out = {
    ...e,
    edge:           e.edgeProbability,
    modelProb:      e.predictedProbability,
    statFamily:     String(e.propType || "").toLowerCase().replace(/\s+/g, ""),
    confidenceTier: e.bucket?.split(".").pop()?.toUpperCase() || "PLAYABLE",
    sportsbook:     e.book,
    odds:           e.odds,
    oddsAmerican:   e.odds,
    confidence:     tb?.confidence,
    tier:           tb?.tier,
    // 2026-05-24 — preserve canonical displayBundle for FE rendering.
    // Spread above keeps the field; explicit assignment here makes intent visible.
    displayBundle:  e.displayBundle || null,
  }
  // Phase 1 — Recent Form V1 (Session AP): inject real per-player rolling
  // stats when available. NBA only — MLB tracked_best entries simply won't
  // have a recent-form record (cache scoped to NBA settled bets).
  if (String(e?.sport || "").toLowerCase() === "nba") {
    enrichNbaRowWithRecentForm(out)
    // Phase 1 — Lineup + Rotation Intelligence V1 (Session AR): inject real
    // role / minutes-trend context derived from same ESPN game-log cache.
    // Sets row.starterFlag + row.projectedMinutes (consumed by nbaModelSignals)
    // and row.roleContext (explainability). Honest no-op for unknown players.
    enrichNbaRowWithRoleContext(out)
    // 2026-05-24 — Phase 2 enrichment defense-in-depth. Persisted tracked_best
    // entries may lack opponent / oppDef / pace / playerSeasonStats if a stale
    // snapshot persisted before the enricher landed; running the enrichers
    // here means the FE always sees them. They no-op when data already present.
    try { enrichNbaRowWithTeamStats(out) } catch (_) {}
    try { enrichNbaRowWithPlayerSeasonStats(out) } catch (_) {}
    // Derive matchup string from homeTeam/awayTeam when blank — operator
    // reported "—" on matchup field. The Phase 2 marketPropsFromPoolRows fix
    // preserves these so they reach tracked_best; this is the read-side guard.
    if (!out.matchup && out.awayTeam && out.homeTeam) {
      out.matchup = `${out.awayTeam} @ ${out.homeTeam}`
    }

    // 2026-05-26 — Read-side tier re-classification (attempt 3, safe pattern).
    //
    // Why: tracked_best disk files persist the tier stamped at write time.
    // Across many cycles those stamps drift — pre-form-gate, pre-projection-
    // gate, or written when recentForm wasn't yet populated. Result: Williams
    // Threes Ladder OVER 1.5 with L5=0.5 displays as ELITE on iPhone despite
    // canonical classifier returning FADE (10 of 12 candidates had this
    // drift in the 2026-05-26 trace).
    //
    // Why prior attempts failed:
    //   Attempt 1: forgot to call this from buildNbaSnapshotCandidates path
    //              (only fixed enrichBestEntry → snapSupplement candidates kept stale tier)
    //   Attempt 2: read l5Avg with fallback to `out.last5Avg` (single-stat
    //              field, populated with points-only L5 for combo props) →
    //              form gate fired on wrong stat → wiped every combo prop
    //
    // Safe pattern (this attempt):
    //   - Read L5 ONLY from family-keyed `out.recentForm.last5_avg` (and
    //     last10_avg fallback) — NEVER `out.last5Avg` single-stat
    //   - When recentForm is absent, pass NaN → classifyNbaTier honestly
    //     skips the form gate (no fabricated signal)
    //   - Idempotent: if recomputed tier matches existing, no-op
    try {
      const __edge      = Number(out.edge ?? out.edgeProbability)
      const __modelProb = Number(out.modelProb ?? out.predictedProbability)
      // Family-keyed L5 ONLY. No single-stat fallback (proven dangerous).
      const __l5        = Number(out?.recentForm?.last5_avg ?? out?.recentForm?.last10_avg)
      const __projML    = Number(
        out?.range?.mostLikely ??
        out?.projection?.mostLikely ??
        out?.projectionMostLikely
      )
      const __reTier = classifyNbaTier({
        edge:           Number.isFinite(__edge) ? __edge : null,
        modelProb:      Number.isFinite(__modelProb) ? __modelProb : null,
        side:           out.side,
        line:           Number(out.line),
        statFamily:     out.statFamily,  // 2026-05-27 Lane D.6: absolute-cap fallback
        l5Avg:          Number.isFinite(__l5) ? __l5 : null,
        projMostLikely: Number.isFinite(__projML) ? __projML : null,
      })
      if (__reTier && __reTier !== out.tier) {
        console.log("[TIER-RECLASSIFY]", out.player, out.propType, out.side, out.line,
                    "disk=" + out.tier, "→", __reTier,
                    "edge=" + (Number.isFinite(__edge) ? __edge.toFixed(3) : "—"),
                    "l5=" + (Number.isFinite(__l5) ? __l5 : "—"))
        out.tier = __reTier
      }
    } catch (e) {
      console.warn("[TIER-RECLASSIFY] failed for", out.player, ":", e?.message || e)
    }

  }
  return out
}

/**
 * Score NBA snapshot rows through the independent model and return the top
 * candidates by edge. Used to supplement the featured pool on nights where
 * tracked_bets/tracked_best are thin (< NBA_SNAPSHOT_SUPPLEMENT_THRESHOLD).
 *
 * 2026-05-27 — Lane A3: function extracted to
 *   backend/pipeline/nba/buildNbaSnapshotCandidates.js
 * so the persistence pipeline (buildNbaOpportunityBoard → persistTrackedToday)
 * can call the same canonical cognition layer and tracked_bets receives the
 * full set of families the FE displays (DD/TD/steals/blocks/PRA/combos —
 * not just points/threes/rebounds/assists from buildNbaPlayerOutcomePredictions
 * STAT_ORDER). Single source of truth.
 */
const NBA_SNAPSHOT_SUPPLEMENT_THRESHOLD = 20
const {
  buildNbaSnapshotCandidates,
  NBA_SNAPSHOT_TOP_N,
} = require("../pipeline/nba/buildNbaSnapshotCandidates")
// Keep NBA_SNAPSHOT_TOP_N referenceable as a local symbol for legacy reads
// elsewhere in this file (no behavior change — same value, same source).
void NBA_SNAPSHOT_TOP_N

// (Inline definition removed 2026-05-27; canonical lives in
//  backend/pipeline/nba/buildNbaSnapshotCandidates.js — see git history.)

// PHASE A1 (2026-05-22): operator-rejected prop patterns. These are
// filtered OUT of every candidate pool before display. The lotto-room
// quarantine wasn't strict enough — operator wants them GONE, not buried.
//
//   • Hits 2.5+ over → operator-stated "those will never hit and would be
//     parlay cancer long term"
//   • Total Bases 3.5+ over → same tail-outcome shape
//   • Anything with implied probability < 8% → extreme longshots, not
//     parlay-buildable, not bettor-realizable
//
// Filter applies AFTER cognition scoring (so we don't break model training)
// but BEFORE display (so operator never sees them on the surface).
function shouldRejectByOperatorPolicy(b) {
  const propType = String(b?.propType || b?.prop || b?.marketKey || "").toLowerCase()
  const side = String(b?.side || "").toLowerCase()
  const line = Number(b?.line)
  const odds = Number(b?.oddsAmerican ?? b?.odds)
  // Hits 2.5+ over → reject
  if (side === "over" && /^hits?$/.test(propType) && Number.isFinite(line) && line >= 2.5) return true
  if (side === "over" && /batter_hits$|^hits?$/i.test(propType) && Number.isFinite(line) && line >= 2.5) return true
  // Total Bases 3.5+ over → reject
  if (side === "over" && /total[\s_]?bases/i.test(propType) && Number.isFinite(line) && line >= 3.5) return true
  // Extreme longshots (implied prob < 8%) → reject. This catches +1050+ payouts
  // regardless of prop type (HR 0.5 at +1100, RBI 1.5 at +1500, etc).
  if (Number.isFinite(odds)) {
    const implied = odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100)
    if (implied < 0.08) return true
  }
  return false
}

function buildCandidatePool(sport, date) {
  const trackedBetsRaw = readJsonSafe(fileFor(sport, "tracked_bets", date), []) || []
  const trackedBest    = readJsonSafe(fileFor(sport, "tracked_best", date), null)
  const entries        = trackedBest?.entries || []

  // PHASE A1: hard-filter operator-rejected prop patterns at the pool source.
  // Diagnostic count so we can see how aggressive the filter is being.
  const trackedBets = trackedBetsRaw.filter(b => !shouldRejectByOperatorPolicy(b))
  const droppedByPolicy = trackedBetsRaw.length - trackedBets.length
  if (droppedByPolicy > 0) {
    console.log("[buildCandidatePool] operator-policy filter:", {
      sport, total: trackedBetsRaw.length, dropped: droppedByPolicy, kept: trackedBets.length,
    })
  }

  const betsById = new Map()
  for (const b of trackedBets) if (b?.id) betsById.set(b.id, b)

  const enrichedBest = entries
    .map((e) => enrichBestEntry(e, betsById))
    .filter(Boolean)
    .filter(b => !shouldRejectByOperatorPolicy(b))   // Also filter the enrichedBest path

  const eligibleBets = trackedBets
    .filter((b) => Number(b?.edge) > 0.04 && Number(b?.modelProb) > 0.20)

  return { trackedBets, trackedBest, enrichedBest, eligibleBets }
}

// ── Candidate diversification ────────────────────────────────────────────────
// Extracted to pipeline/shared/buildCandidateDiversity.js — imported above.

// ── load shared intelligence modules lazily ──────────────────────────────────

function loadSharedModules() {
  return {
    presentation:     require("../pipeline/shared/buildIntelligencePresentation"),
    slipAi:           require("../pipeline/shared/buildSlipAi"),
    portfolio:        require("../pipeline/shared/buildPortfolioOptimizer"),
    lineShop:         require("../pipeline/shared/buildLineShoppingIntelligence"),
    timing:           require("../pipeline/shared/buildMarketTimingIntelligence"),
    ledger:           require("../pipeline/shared/buildPersonalLedger"),
    featured:         require("../pipeline/shared/buildFeaturedPlays"),
  }
}

// ── routes ────────────────────────────────────────────────────────────────────

router.get("/health", (req, res) => {
  // Health probe now surfaces snapshot freshness for both sports so
  // operators can see stale state without crawling logs.
  let nbaFresh = null
  let mlbFresh = null
  try { nbaFresh = computeSnapshotFreshnessFromDisk("nba") } catch (_) {}
  try { mlbFresh = computeSnapshotFreshnessFromDisk("mlb") } catch (_) {}
  // Log any stale state observed via /health — same probe shape as /state.
  if (nbaFresh) logStaleProbe(nbaFresh, { context: "ws_health" })
  if (mlbFresh) logStaleProbe(mlbFresh, { context: "ws_health" })
  const anyStale = Boolean((nbaFresh && nbaFresh.isStale) || (mlbFresh && mlbFresh.isStale))
  res.json({
    ok: true,
    degraded: anyStale,
    time: new Date().toISOString(),
    freshness: {
      nba: buildFreshnessPayload(nbaFresh),
      mlb: buildFreshnessPayload(mlbFresh),
    },
  })
})

/**
 * Comprehensive sport+date snapshot for the workstation.
 * Returns everything needed to hydrate the main views in a single call.
 */
router.get("/state", async (req, res) => {
  try {
    const { sport, date } = resolveSportDate(req)
    // [WS-PROBE] Route entry
    console.log("[WS-PROBE] /state entry sport=%s date=%s", sport, date)
    const key = `state:${sport}:${date}`

    // 2026-05-26 — Auto-refresh stale NBA snapshot before serving. Reads the
    // freshness from disk first; if stale, fires /refresh-snapshot and waits
    // (the existing 60s response cache is invalidated for this key so the
    // post-refresh data is rebuilt, not served from stale memo).
    try {
      const { freshness: preFreshness } =
        readSnapshotRowsWithFreshness(sport, { context: "ws_state_pre_refresh_check" })
      const refreshed = await maybeTriggerNbaSnapshotRefresh(sport, preFreshness)
      if (refreshed) {
        cache.delete(key)
        console.log("[WS-AUTO-REFRESH] cache invalidated for", key)
      }
    } catch (e) {
      console.warn("[WS-AUTO-REFRESH] pre-check failed (non-fatal):", e?.message || e)
    }

    const out = cached(key, () => {
      console.log("[WS-PROBE] cache MISS — building state for", sport, date)
      const mods = loadSharedModules()
      const pool = buildCandidatePool(sport, date)
      console.log("[WS-PROBE] pool: eligibleBets=%d enrichedBest=%d trackedBets=%d",
        pool.eligibleBets.length, pool.enrichedBest.length, pool.trackedBets.length)

      // Snapshot rows for line shopping/timing — also captures snapshot
      // freshness for the response payload (operational trust hardening).
      const { rows: snapshotRows, freshness: snapshotFreshness } =
        readSnapshotRowsWithFreshness(sport, { context: "ws_state" })
      console.log("[WS-PROBE] snapshotRows=%d freshness=%s ageMin=%s",
        snapshotRows.length, snapshotFreshness?.status, snapshotFreshness?.snapshotAgeMinutes)

      const bookState    = mods.lineShop.loadBookState ? mods.lineShop.loadBookState() : null
      const timingState  = mods.timing.loadTimingState ? mods.timing.loadTimingState() : null

      const lineShopping = snapshotRows.length
        ? mods.lineShop.buildLineShopping(snapshotRows, { sport, bookState })
        : null
      const timingResult = snapshotRows.length
        ? mods.timing.buildMarketTiming(snapshotRows, { lineShopping, timingState, bookState })
        : null

      let rawCandidates = pool.enrichedBest.length ? pool.enrichedBest : pool.eligibleBets

      // 2026-05-26 SLATE-ROLLOVER STALE-MATCHUP FILTER
      // Disk files (tracked_best / tracked_bets) persist last-cycle picks. When
      // the slate rolls over (e.g. NYK@CLE finishes Mon night, SAS@OKC posts
      // Tue), the new snapshot reflects SAS@OKC but the disk file still holds
      // NYK@CLE entries (gameTime field is not even persisted, so no per-row
      // time check is possible). Result: FE mixes fresh + stale matchups.
      //
      // Fix: derive the active matchup set from the LIVE snapshot rows; drop
      // any rawCandidate whose matchup is not in that set. Single-source-of-
      // truth = current snapshot, no separate cache or new continuity layer.
      // Sport-gated to NBA so MLB behavior is unchanged.
      if (sport === "nba" && rawCandidates.length && snapshotRows.length) {
        const __activeMatchups = new Set()
        for (const r of snapshotRows) {
          const m = String(r?.matchup || "").trim()
          if (m) __activeMatchups.add(m)
        }
        if (__activeMatchups.size > 0) {
          const __preFilter = rawCandidates.length
          rawCandidates = rawCandidates.filter((c) => {
            const m = String(c?.matchup || "").trim()
            // Permissive when matchup missing — don't blow away rows that
            // simply lack the field. The set membership check only DROPS
            // rows whose matchup is explicitly NOT in the live slate.
            if (!m) return true
            return __activeMatchups.has(m)
          })
          const __dropped = __preFilter - rawCandidates.length
          if (__dropped > 0) {
            console.log("[SLATE-ROLLOVER] dropped %d stale-matchup candidates (not in live snapshot)", __dropped)
          }
        }
      }

      // NBA TEAM FALLBACK 2026-05-22: tracked_bets files don't write a `team`
      // field — verified 0/55 entries had it. Result: every NBA card showed
      // "TEAM PENDING" on the mobile PWA even though projections.json knows the
      // team for Mobley, Brunson, etc. applyTeamFallbackFromProjections runs in
      // the snapshot path (buildNbaSnapshotCandidates) but NOT in the tracked-bets
      // read path. Apply it defensively here so candidates from disk also get
      // team + opponent inferred from projections.json + matchup string.
      if (sport === "nba" && rawCandidates.length) {
        rawCandidates = rawCandidates.map(applyTeamFallbackFromProjections)
      }

      // FIX Q1: Pre-compute snapshot supplement ONCE and reuse for both the portfolio
      // candidate pool AND the featured/slip aiCandidates pool.
      // BEFORE: buildNbaSnapshotCandidates was called only for supplementedCandidates
      //   (used by portfolio). aiCandidatesRaw was set to [...eligibleBets,...enrichedBest]
      //   (2–4 entries on thin slates) and never supplemented → featured boards and AI
      //   slips always starved on nights without a full runNbaNight.js nightly run.
      // AFTER: both paths share the same scored snapshot supplement, no double-compute.
      let snapSupplement = (sport === "nba" && snapshotRows.length)
        ? buildNbaSnapshotCandidates(snapshotRows)
        : []
      // PHASE A1: operator-policy filter ALSO on snapshot supplement path
      const snapSupplementPreFilter = snapSupplement.length
      snapSupplement = snapSupplement.filter(b => !shouldRejectByOperatorPolicy(b))
      const snapSupplementDropped = snapSupplementPreFilter - snapSupplement.length
      if (snapSupplementDropped > 0) {
        console.log("[WS-PROBE] snapSupplement operator-policy filter: dropped %d", snapSupplementDropped)
      }
      console.log("[WS-PROBE] snapSupplement=%d rawCandidates=%d (sport=%s snapshotRows=%d)",
        snapSupplement.length, rawCandidates.length, sport, snapshotRows.length)

      // Supplement portfolio pool when tracked pool is thin.
      const supplementedCandidates = (rawCandidates.length < NBA_SNAPSHOT_SUPPLEMENT_THRESHOLD && snapSupplement.length)
        ? (() => {
            const trackSig = new Set(rawCandidates.map(rc => `${rc.player}|${rc.statFamily}|${rc.side}`))
            const novel = snapSupplement.filter(sc => !trackSig.has(`${sc.player}|${sc.statFamily}|${sc.side}`))
            return [...rawCandidates, ...novel]
          })()
        : rawCandidates

      // 2026-05-26 — FADE-tier pre-filter (NBA only).
      // Root cause for "iPhone shows 0 plays" with full DD/TD pipeline working:
      // diversifyCandidates ranks by edge magnitude. High-edge wrong-direction
      // picks (Threes Ladder OVER 1.5 with L5=0.5, edge +0.38) beat moderate-
      // edge legitimate picks (Castle DD edge +0.08) for the maxPerGame:12
      // slot budget. All 12 surviving slots end up FADE-tier, then the FE
      // FADE filter hides them all → 0 cards. DD/TD picks that survived the
      // model never had a chance.
      //
      // Fix: drop FADE-tier rows BEFORE diversifyCandidates so the slot
      // budget goes to picks that will actually be shown. Tier was stamped
      // upstream by classifyNbaTier (canonical) on both rawCandidates and
      // snapSupplement paths. NBA-gated so MLB behavior is unchanged.
      let nonFadeSupplemented = supplementedCandidates
      if (sport === "nba") {
        const __preFade = supplementedCandidates.length
        nonFadeSupplemented = supplementedCandidates.filter(c => String(c?.tier || "").toUpperCase() !== "FADE")
        const __droppedFade = __preFade - nonFadeSupplemented.length
        if (__droppedFade > 0) {
          console.log("[FADE-PREFILTER] dropped %d FADE-tier candidates pre-diversify (was occupying slot budget)", __droppedFade)
        }
      }

      // 2026-05-26 — Lane A (cap raise): bumped from 12 to 25 per game.
      // Earlier (12) was set when FADE-tier picks competed for slot budget;
      // now that the FADE pre-filter kills wrong-direction junk before
      // diversification, the 12-cap throws away ~80% of legitimate candidates
      // on small slates. Diagnostic showed snapSupplement = 116 candidates,
      // diversify kept only 12. Raising lets DD/TD/steals/blocks/etc. surface
      // alongside the main families.
      //
      // ALSO passing explicit maxPerStat / maxPerStatSide — the 10/6 defaults
      // would become the NEW binding cap once maxPerGame is raised. Bumped
      // proportionally (15 / 9) so e.g. a slate full of strong threes picks
      // can show 8 of them without the per-stat default cutting at 10.
      //
      // MLB keeps tighter caps (15+ games × 7-cap = 105 candidates already).
      const nbaPerGame = sport === "nba" ? 25 : 7

      // Diversify before downstream views — caps repeats per player/game so the
      // workstation isn't dominated by 17 Donovan Mitchell legs.
      const candidates = diversifyCandidates(nonFadeSupplemented, {
        maxPerPlayer:   3,
        maxPerGame:     nbaPerGame,
        maxPerStat:     sport === "nba" ? 15 : 10,
        maxPerStatSide: sport === "nba" ? 9  : 6,
      })
      console.log("[WS-PROBE] supplementedCandidates=%d (post-FADE=%d) → candidates(portfolio)=%d",
        supplementedCandidates.length, nonFadeSupplemented.length, candidates.length)

      // ── Phase BNDS-1B: DISCOVERY-SAFE EXPANSION ───────────────────────────
      //
      // The diversified `candidates` pool above (maxPerPlayer:3, maxPerGame:7-12,
      // maxPerStat:10, maxPerStatSide:6) is the ELITE/CURATED pool — it feeds
      // portfolio analysis, featured plays, AI parlay composition. That tight
      // diversification is correct for those surfaces: "don't let one player
      // dominate the surfaced edge."
      //
      // But the FE Discover tab needs a BROADER battlefield view —
      // "show me what's available across every game." With NBA's 86 canonical
      // tracked_bets in a 1-game playoff slate, the elite cap surfaces only
      // 12 (per-game cap); with MLB's 101 tracked_bets across 15 games, the
      // elite caps surface ~50–60. The FE Discover view felt empty as a
      // result (BNDS-1B operator framing: "show me the battlefield, then
      // intelligently narrow it" — Layer 1 not yet surfaced).
      //
      // Solution: compute a SEPARATE `discoveryCandidates` pool from the
      // SAME canonical-validated source (`supplementedCandidates`) but with
      // DISCOVERY-SAFE looser caps. This preserves every trust layer:
      //   • Same source pool (canonical validated; eligibleBets + enrichedBest
      //     + NBA snapshot supplement); NO raw sportsbook flooding.
      //   • Same diversifyCandidates scoring + ordering; just larger thresholds.
      //   • Elite pool (`candidates`) UNCHANGED — portfolio / featured /
      //     aiSlips continue to receive the tight cap.
      //
      // BNDS-1B operator directive: "split broad discovery pools FROM elite
      // edge pools" — these are different products inside the same workstation.
      const DISCOVERY_DIVERSITY_CAPS = Object.freeze({
        maxPerPlayer:   8,  // was 3 — allow a star's full prop board to surface
        maxPerGame:    60,  // was 7 (MLB) / 12 (NBA) — let an entire game's
                            // ecosystem surface even on thin playoff slates
        maxPerStat:    60,  // was 10 — full hits/totalBases/etc. surface
        maxPerStatSide: 35, // was 6 — both OVERs and UNDERs surface broadly
      })
      const discoveryCandidates = diversifyCandidates(
        supplementedCandidates,
        DISCOVERY_DIVERSITY_CAPS,
      )
      console.log("[WS-PROBE] discoveryCandidates=%d (elite=%d, source=%d, caps={pP:%d pG:%d pS:%d pSS:%d})",
        discoveryCandidates.length, candidates.length, supplementedCandidates.length,
        DISCOVERY_DIVERSITY_CAPS.maxPerPlayer, DISCOVERY_DIVERSITY_CAPS.maxPerGame,
        DISCOVERY_DIVERSITY_CAPS.maxPerStat, DISCOVERY_DIVERSITY_CAPS.maxPerStatSide)
      // ──────────────────────────────────────────────────────────────────────

      // Portfolio analysis runs against the diversified candidate pool only.
      // Persisted slip catalog is intentionally NOT merged in — those are
      // engine-generated slip suggestions, not the user's actual portfolio,
      // and including them inflates exposure 3-5x and produces noisy warnings.
      const portfolio = mods.portfolio.optimizePortfolio({
        bets: candidates,
        slipBets: [],
        timingResult,
        bookState,
      })

      // FIX Q1 (continued): Wire snapshot supplement into aiCandidates.
      // aiCandidates feeds BOTH buildAiSlips AND buildFeaturedPlays — the two primary
      // consumer-facing surfaces. Without this fix they see only 2–4 tracked entries.
      const aiCandidatesTracked = [...pool.eligibleBets, ...pool.enrichedBest]
      const aiCandidatesRaw = (sport === "nba" && aiCandidatesTracked.length < NBA_SNAPSHOT_SUPPLEMENT_THRESHOLD && snapSupplement.length)
        ? (() => {
            const trackSig = new Set(aiCandidatesTracked.map(rc =>
              `${String(rc.player || "").toLowerCase()}|${String(rc.statFamily || rc.propType || "").toLowerCase()}|${String(rc.side || "").toLowerCase()}`
            ))
            const novel = snapSupplement.filter(sc =>
              !trackSig.has(`${String(sc.player || "").toLowerCase()}|${sc.statFamily}|${sc.side}`)
            )
            console.log("[WS-PROBE] AI supplement FIRED: tracked=%d novel=%d", aiCandidatesTracked.length, novel.length)
            return [...aiCandidatesTracked, ...novel]
          })()
        : (() => {
            console.log("[WS-PROBE] AI supplement DID NOT fire: aiCandidatesTracked=%d snapSupplement=%d sport=%s",
              aiCandidatesTracked.length, snapSupplement.length, sport)
            return aiCandidatesTracked
          })()
      const aiCandidates = diversifyCandidates(aiCandidatesRaw, { maxPerPlayer: 3, maxPerGame: nbaPerGame })
      console.log("[WS-PROBE] aiCandidatesRaw=%d → aiCandidates=%d", aiCandidatesRaw.length, aiCandidates.length)

      // ── Phase Live-Game-State-Integration-1b — JOIN live-state detection onto
      // the bettor candidate pool BEFORE slip assembly. aiCandidates are
      // tracked_best-derived and carry NO live-state envelope; the detection
      // lives on a different source loaded in this same route:
      //   MLB → snapshotRows[].mlbLiveState (applyMlbLiveStateLayers); join by
      //         normPlayer (one game per player per slate → player key is
      //         unambiguous and immune to eventId-format drift).
      //   NBA → nbaAvailabilityCache.enrichRowWithAvailability (sets playerStatus
      //         + availabilityContext from the ESPN cache).
      // Without this join, buildSlipAi's gate reads leg.mlbLiveState /
      // leg.playerStatus = undefined for every leg → Trap-1 → "ok" for all → a
      // verified NO-OP (this is the dead-wire Phase 1 missed). Anti-fabrication:
      // attach ONLY on a real match; no match → field stays undefined → gate OK.
      // Featured plays deliberately keeps the un-joined aiCandidates (the gate is
      // a parlay-surface protection per the audit; single-pick surfaces are
      // out of Phase-1 scope).
      let gateReadyCandidates = aiCandidates
      if (sport === "mlb" && snapshotRows.length) {
        const liveByPlayer = new Map()
        for (const r of snapshotRows) {
          if (!r || !r.mlbLiveState) continue
          const k = normPlayer(r.player)
          if (k && !liveByPlayer.has(k)) liveByPlayer.set(k, r.mlbLiveState)
        }
        let __matched = 0
        gateReadyCandidates = aiCandidates.map((c) => {
          if (!c) return c
          const isPitcherMarket = isMlbPitcherMarketKey(c.marketKey) === true
          const ls = liveByPlayer.get(normPlayer(c.player))
          if (!ls) return isPitcherMarket ? { ...c, isPitcherMarket } : c
          __matched++
          return { ...c, mlbLiveState: ls, isPitcherMarket }
        })
        console.log("[WS-LIVESTATE] MLB join: candidates=%d snapshotPlayers=%d matched=%d",
          aiCandidates.length, liveByPlayer.size, __matched)
      } else if (sport === "nba") {
        let __withStatus = 0
        gateReadyCandidates = aiCandidates.map((c) => {
          if (!c) return c
          const clone = { ...c }
          try { enrichNbaRowWithAvailability(clone) } catch (_) {}
          if (clone.playerStatus) __withStatus++
          return clone
        })
        console.log("[WS-LIVESTATE] NBA availability join: candidates=%d withStatus=%d",
          aiCandidates.length, __withStatus)
      }

      let ledgerState = null
      try { ledgerState = mods.ledger.loadLedger ? mods.ledger.loadLedger() : null } catch (_) {}
      const aiSlips = mods.slipAi.buildAiSlips({
        candidates: gateReadyCandidates,
        timingResult,
        bookState,
        ledgerState,
        portfolioBaseline: { bets: candidates },
        options: { sport, date, maxPerTier: 4 },
      })
      console.log("[WS-PROBE] buildAiSlips result: safe=%d balanced=%d aggressive=%d lotto=%d summary=%s",
        (aiSlips.slips?.safe||[]).length, (aiSlips.slips?.balanced||[]).length,
        (aiSlips.slips?.aggressive||[]).length, (aiSlips.slips?.lotto||[]).length,
        aiSlips.summary || "")

      // FEATURED — curated trust anchor (5–15 plays across themed buckets).
      const featured = mods.featured.buildFeaturedPlays({
        candidates: aiCandidates,
        timingResult,
        lineShopping,
        bookState,
        ledgerState,
        sport,
        date,
      })

      // Compact urgent + best-edge for the dashboard
      const urgent = (timingResult?.timingClassifications || [])
        .filter((tc) => tc.urgency === "immediate" || tc.state === "stale_window")
        .slice(0, 25)

      // Bankroll info from tracked_best metadata
      const bankrollInfo = pool.trackedBest?.metadata
        ? { bankroll: pool.trackedBest.metadata.bankroll, dailyRiskBudget: pool.trackedBest.metadata.dailyRiskBudget }
        : null

      // Counts for header
      const counts = {
        candidates:      candidates.length,
        urgent:          urgent.length,
        propsWithMultiBook: lineShopping?.meta?.propsWithMultiBook ?? 0,
        steam:           timingResult?.meta?.steamCount ?? 0,
        stale:           timingResult?.meta?.staleCount ?? 0,
      }

      // ── Session AZ — Frozen Prediction + Grading Architecture V1 ────────────
      // Capture an immutable observational snapshot of THIS prediction cycle.
      // Wrapped in try/catch so the memory layer NEVER breaks the workstation
      // request. INSERT OR IGNORE on prediction_epochs + INSERT OR IGNORE on
      // prediction_snapshots means: re-running the same snapshot lifecycle
      // (same updatedAt) is a perfect no-op — predictions remain immutable.
      // New snapshot updatedAt → new epoch → new contextual freeze.
      try {
        // Read snapshot updatedAt for deterministic epoch keying. Read once
        // (cheap), don't modify readSnapshotRows (has 3 callers).
        let snapshotUpdatedAt = null
        try {
          const sportFile = path.join(__dirname, "..", `snapshot-${sport}.json`)
          const sportSnap = readJsonSafe(sportFile, null)
          let snap = sportSnap
          if (!snap && sport === "nba") {
            snap = readJsonSafe(path.join(__dirname, "..", "snapshot.json"), null)
          }
          snapshotUpdatedAt = snap?.updatedAt || snap?.data?.updatedAt || null
        } catch (_) { /* honest null on missing snapshot */ }

        const freezeResult = freezePredictionEpoch({
          predictions:       candidates,
          slipsByTier:       aiSlips.slips || null,
          sport,
          slateDate:         date,
          source:            "workstation_state",
          snapshotUpdatedAt,
          notes:             `cache-miss build; supplement=${snapSupplement.length}`,
        })
        console.log("[FROZEN-EPOCH]", {
          ok:                  freezeResult.ok,
          epochId:             freezeResult.epochId,
          epochInserted:       freezeResult.epochInserted,
          predictionsInserted: freezeResult.predictionsInserted,
          predictionsSkipped:  freezeResult.predictionsSkipped,
          contextualInserted:  freezeResult.contextualInserted,
          ecologyRecorded:     freezeResult.ecologyRecorded,
          error:               freezeResult.error,
        })
      } catch (freezeErr) {
        // Non-fatal — workstation must continue working even if memory layer breaks.
        console.warn("[FROZEN-EPOCH] capture skipped (non-fatal):", freezeErr?.message || freezeErr)
      }
      // ─────────────────────────────────────────────────────────────────────────

      return {
        sport,
        date,
        counts,
        bankrollInfo,
        candidates,
        // Phase BNDS-1B: broader canonical pool for the FE Discover surface.
        // Same source as `candidates` above (canonical validated); looser caps
        // for battlefield breadth. Elite consumers stay on `candidates`.
        discoveryCandidates,
        slipBets: readJsonSafe(fileFor(sport, "tracked_slips", date), []) || [],
        lineShopping: compactLineShopping(lineShopping, 60),
        timing: compactTiming(timingResult, 60),
        portfolio: compactPortfolio(portfolio),
        aiSlips: aiSlips.slips || { safe: [], balanced: [], aggressive: [], lotto: [] },
        // P1.1 — pool-wide dead legs the live-state gate removed before slip
        // assembly (slate-level; a dead leg never belongs to a specific slip).
        // FE surfaces this as a "removed from tonight's slips" note on the SLIPS tab.
        aiSlipsDeadRemoved: aiSlips.deadRemoved || [],
        // Phase BNSB-1A: expand aiSlipsSummary to carry the advisory metrics
        // already computed by buildAiSlips (bettorRealismScore from BC-8;
        // oe11SlipStats from OE-11; mlbCovStats from MLB-COV-1A). These fields
        // travel to the FE for surfacing on the Dashboard intelligence strip
        // and SlipCard reinforcement transparency. Anti-fabrication: all values
        // propagate verbatim (null/undefined when backend returns absent).
        aiSlipsSummary: {
          summary: aiSlips.summary,
          warnings: aiSlips.warnings,
          bettorRealismScore: aiSlips.bettorRealismScore,
          oe11SlipStats: aiSlips.oe11SlipStats,
          mlbCovStats: aiSlips.mlbCovStats,
        },
        featured,
        // Operational trust hardening — snapshot freshness diagnostics.
        // `degraded` is the top-level flag the UI can key on; `freshness`
        // carries the full payload (age, status, threshold breach, reason).
        snapshotFreshness: buildFreshnessPayload(snapshotFreshness),
        degraded: Boolean(snapshotFreshness?.isStale),
      }
    })
    res.json(out)
  } catch (err) {
    console.error("[ws/state]", err)
    res.status(500).json({ error: String(err?.message || err) })
  }
})

/**
 * Player Search — operator 2026-05-22: "i want for sure HITTERS not unknown
 * small players. so nba not having a wemby, sga, castle, etc is unacceptable."
 *
 * Confirmed root cause: nightly tracked_bets pipeline filters by edge → chalk
 * star lines (Wemby -300 to score 20+) have near-zero edge → filtered. But the
 * stars ARE in the full snapshot (2147 NBA props tonight). This endpoint lets
 * the operator type ANY player name and see ALL their props for tonight from
 * the 7-book allowlist — regardless of model edge.
 *
 * GET /api/ws/player-search?sport=nba&q=wemby
 *   sport: "nba" | "mlb" (defaults to "nba")
 *   q:     substring, case-insensitive, min 2 chars
 *
 * Response: { ok: true, results: [...rows], matchedPlayers: [names] }
 */
// Common player nicknames → official name substring used in the snapshot.
// Operator-friendly: typing "wemby" should find Wembanyama. Additive list —
// extend as needed when operator discovers a search that misses.
const PLAYER_NICKNAMES = {
  // NBA
  "wemby":   "wembanyama",
  "sga":     "gilgeous-alexander",
  "the king":"james",
  "lebron":  "james",
  "bron":    "james",
  "kd":      "durant",
  "dame":    "lillard",
  "ad":      "davis",
  "cp3":     "paul",
  "klay":    "thompson",
  "jokic":   "jokić",         // accent variant
  "shai":    "gilgeous",
  "jt":      "tatum",
  "jb":      "brown",
  "luka":    "dončić",        // accent variant
  "doncic":  "dončić",
  "joker":   "jokić",
  "scoot":   "henderson",
  // MLB
  "shohei":  "ohtani",
  "judge":   "aaron judge",
}
function expandQueryWithNicknames(q) {
  const ql = String(q || "").toLowerCase().trim()
  if (PLAYER_NICKNAMES[ql]) return PLAYER_NICKNAMES[ql]
  return ql
}

router.get("/player-search", (req, res) => {
  try {
    const sport = String(req.query.sport || "nba").toLowerCase()
    const rawQ  = String(req.query.q || "").toLowerCase().trim()
    if (rawQ.length < 2) {
      return res.json({ ok: true, results: [], matchedPlayers: [], note: "query must be at least 2 characters" })
    }
    // Expand nicknames so "wemby" → "wembanyama" before substring matching
    const q = expandQueryWithNicknames(rawQ)

    const rows = readSnapshotRows(sport)
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.json({ ok: true, results: [], matchedPlayers: [], note: "snapshot empty or missing" })
    }

    // Player substring match, then allowlist filter
    const matched = []
    const playerSet = new Set()
    for (const r of rows) {
      const player = String(r?.player || "").toLowerCase()
      if (!player.includes(q)) continue
      const book = String(r?.sportsbook || r?.book || "")
      if (!isAllowedBook(book)) continue
      playerSet.add(r.player)
      matched.push({
        player:       r.player,
        team:         r.team || r.teamResolved || null,
        matchup:      r.matchup || null,
        propType:     r.propType || r.marketKey || null,
        side:         r.side || null,
        line:         r.line ?? null,
        odds:         r.oddsAmerican ?? r.odds ?? null,
        oddsAmerican: r.oddsAmerican ?? r.odds ?? null,
        sportsbook:   canonicalBookName(book) || book,
        modelProb:    r.predictedProbability ?? r.modelProb ?? null,
        edge:         r.edgeProbability ?? r.edge ?? null,
        eventId:      r.eventId || null,
        gameTime:     r.gameTime || r.commenceTime || null,
        // Pass through any tier / archetype / signal annotations if present
        confidenceTier: r.confidenceTier || r.tier || null,
      })
    }

    // Sort: by player name then by line (so all of Wemby's points props in order)
    matched.sort((a, b) => {
      const p = String(a.player).localeCompare(String(b.player))
      if (p !== 0) return p
      const pt = String(a.propType || "").localeCompare(String(b.propType || ""))
      if (pt !== 0) return pt
      return Number(a.line ?? 0) - Number(b.line ?? 0)
    })

    res.json({
      ok: true,
      results: matched,
      matchedPlayers: [...playerSet],
      totalRows: rows.length,
      query: q,
      sport,
    })
  } catch (err) {
    console.error("[player-search]", err)
    res.status(500).json({ ok: false, error: err?.message || String(err) })
  }
})

/**
 * PHASE A2 (2026-05-22): Game-first starter view.
 *
 * Operator demand: "i need to see his true potential for each game in terms
 * of o/u, ladder, real predicted ceilings, etc". The current edge-filtered
 * candidate pool surfaces ~6 longshot no-names per playoff game; stars are
 * filtered out by design. This endpoint rebuilds the slate as game-first:
 *
 *   For each game tonight:
 *     - matchup, gameTime, sportsbook count
 *     - For each starter (or notable player):
 *         - primary props (Points/Rebounds/Assists for NBA, Hits/RBIs/HRs for MLB)
 *         - over/under lines available at allowed books
 *         - ceiling score if available (from buildCeilingRoleSpikeSignals)
 *         - recent form context (last5_avg from nbaRecentFormCache)
 *
 * Reads FULL snapshot rows (not edge-filtered tracked_bets pool). Filters by
 * 7-book allowlist + operator-policy (no 3x hits, no extreme longshots).
 * Groups by (eventId, player). Selects PRIMARY prop per player by stat family.
 *
 * GET /api/ws/games?sport=nba
 *
 * Response:
 *   { ok, sport, games: [
 *     { eventId, matchup, gameTime, awayTeam, homeTeam,
 *       players: [
 *         { player, team, propGroups: {
 *           points: [{line, side, odds, book, ...}, ...],
 *           rebounds: [...], assists: [...], etc.
 *         }, recentForm, ceilingScore, ... }
 *       ]
 *     }, ...
 *   ]}
 */
router.get("/games", (req, res) => {
  try {
    const sport = String(req.query.sport || "nba").toLowerCase()
    const rows = readSnapshotRows(sport)
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.json({ ok: true, sport, games: [], note: "snapshot empty or missing" })
    }

    // Filter 1: allowlist + operator-policy (no 3x hits, no extreme longshots)
    // Filter 2 (2026-05-23): garbage-line filter — drop near-certain "filler"
    // lines the books offer as parlay-pad (e.g. Harden Under 14.5 rebounds at
    // -1000). These pollute the surface and the model can't find edge on
    // them. Threshold: implied prob > 95% OR < 5%, UNLESS edge data later
    // shows the model strongly disagrees. We don't have edge on raw snapshot
    // rows here, so a hard implied-prob filter is the right cut at this stage.
    function impliedFromOdds(o) {
      const a = Number(o)
      if (!Number.isFinite(a) || a === 0) return null
      return a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100)
    }
    const filtered = rows.filter(r => {
      if (!isAllowedBook(String(r?.sportsbook || r?.book || ""))) return false
      if (shouldRejectByOperatorPolicy(r)) return false
      const ip = impliedFromOdds(r?.oddsAmerican ?? r?.odds)
      if (ip != null && (ip > 0.95 || ip < 0.05)) return false
      return true
    })

    // Model-prob join (2026-05-23) — pull tracked_bets for this sport+date and
    // build a lookup so we can surface modelProb/edge onto matching snapshot
    // rows. Without this, the /games view shows book lines with no model
    // signal — operator can't tell what the cognition thinks about each line.
    // Lookup key: `${player}|${family}|${side}|${line}` (normalized).
    //
    // CRITICAL: /games display family is "Total Bases" / "Pitcher Outs" but
    // tracked_bets statFamily is "totalbases" / "outs". Normalize both sides
    // through a shared canonical form via FAMILY_ALIAS.
    const FAMILY_ALIAS = {
      // /games display → canonical family used in tracked_bets
      "hits": "hits",
      "totalbases": "totalbases",
      "total bases": "totalbases",
      "homeruns": "hr",
      "home runs": "hr",
      "hr": "hr",
      "rbis": "rbis",
      "rbi": "rbis",
      "runsscored": "runs",
      "runs scored": "runs",
      "runs": "runs",
      "stolenbases": "sb",
      "stolen bases": "sb",
      "strikeouts": "ks",
      "pitcherstrikeouts": "ks",
      "pitcheroutts": "outs",
      "pitcherouts": "outs",
      "outs": "outs",
      "pitcherwalks": "walks",
      "walks": "walks",
      "earnedruns": "earnedruns",
      // NBA
      "points": "points",
      "rebounds": "rebounds",
      "assists": "assists",
      "threes": "threes",
      "pra": "pra",
      "ptsreb": "ptsreb",
      "ptsast": "ptsast",
      "rebast": "rebast",
    }
    function canonFamily(s) {
      const lc = String(s || "").toLowerCase().trim()
      if (FAMILY_ALIAS[lc]) return FAMILY_ALIAS[lc]
      const stripped = lc.replace(/[\s_\-+]+/g, "")
      return FAMILY_ALIAS[stripped] || stripped
    }
    const modelProbLookup = (() => {
      const map = new Map()
      try {
        // 2026-06-01 Phase Date-Doctrine-1A/1B — canonical ET slate date.
        const date = currentSlateDateEt()
        const p = path.join(TRACKING_DIR, `${sport}_tracked_bets_${date}.json`)
        if (!fs.existsSync(p)) return map
        const arr = JSON.parse(fs.readFileSync(p, "utf8"))
        const rows = Array.isArray(arr) ? arr : (arr.bets || [])
        for (const b of rows) {
          const key = `${String(b.player||"").toLowerCase().trim()}|${canonFamily(b.statFamily)}|${String(b.side||"").toLowerCase()}|${b.line ?? ""}`
          const prev = map.get(key)
          if (!prev || Number(b.edge||0) > Number(prev.edge||0)) {
            map.set(key, { modelProb: Number(b.modelProb), edge: Number(b.edge), tier: b.tier })
          }
        }
      } catch (_) {}
      return map
    })()

    // Stat family canonicalization — we'll group by these
    const STAT_FAMILY_MAP = {
      // NBA
      "player_points": "Points",
      "player_rebounds": "Rebounds",
      "player_assists": "Assists",
      "player_threes": "Threes",
      "player_threes_made": "Threes",
      "player_points_rebounds_assists": "PRA",
      "player_steals": "Steals",
      "player_blocks": "Blocks",
      "player_points_rebounds": "Pts+Reb",
      "player_points_assists": "Pts+Ast",
      "player_rebounds_assists": "Reb+Ast",
      // MLB
      "batter_hits": "Hits",
      "batter_home_runs": "Home Runs",
      "batter_total_bases": "Total Bases",
      "batter_rbis": "RBIs",
      "batter_runs_scored": "Runs Scored",
      "batter_stolen_bases": "Stolen Bases",
      "pitcher_strikeouts": "Strikeouts",
      "pitcher_outs": "Pitcher Outs",
      "pitcher_walks": "Pitcher Walks",
    }
    function statFamilyOf(row) {
      const mk = String(row?.marketKey || row?.propType || "").toLowerCase().replace(/^alternate_/, "")
      if (STAT_FAMILY_MAP[mk]) return STAT_FAMILY_MAP[mk]
      // Heuristic fallback
      const pt = String(row?.propType || "").toLowerCase()
      if (pt.includes("points") && pt.includes("rebounds") && pt.includes("assists")) return "PRA"
      if (pt.includes("points")) return "Points"
      if (pt.includes("rebounds")) return "Rebounds"
      if (pt.includes("assists")) return "Assists"
      if (pt.includes("threes") || pt.includes("3pt")) return "Threes"
      if (pt.includes("home run") || pt === "hr") return "Home Runs"
      if (/^hits?$/i.test(pt)) return "Hits"
      if (pt.includes("total bases")) return "Total Bases"
      if (pt.includes("rbi")) return "RBIs"
      return null
    }

    // Group by eventId → player → propGroup
    const games = new Map()
    for (const r of filtered) {
      const eventId = String(r?.eventId || "")
      if (!eventId) continue
      if (!games.has(eventId)) {
        games.set(eventId, {
          eventId,
          matchup:  r.matchup || null,
          gameTime: r.gameTime || r.commenceTime || null,
          awayTeam: r.awayTeam || r.away_team || null,
          homeTeam: r.homeTeam || r.home_team || null,
          playerMap: new Map(),
        })
      }
      const game = games.get(eventId)

      const player = String(r?.player || "").trim()
      if (!player) continue
      const fam = statFamilyOf(r)
      if (!fam) continue

      if (!game.playerMap.has(player)) {
        game.playerMap.set(player, {
          player,
          team: r.team || r.teamResolved || null,
          recentForm: r.recentForm || null,
          starterFlag: r.starterFlag ?? null,
          projectedMinutes: r.projectedMinutes ?? null,
          ceilingScore: r.ceilingScore ?? null,
          roleSpikeScore: r.roleSpikeScore ?? null,
          propGroups: {},
        })
      }
      const p = game.playerMap.get(player)
      if (!p.propGroups[fam]) p.propGroups[fam] = {}
      // Multi-book collapse (2026-05-23) — dedupe key is (side|line) ONLY,
      // not (book|side|line). When multiple books offer the same side+line,
      // we aggregate them: best price (highest American odds = best for
      // bettor) becomes the primary, the rest get listed as alternate
      // sources. This collapses Harden Over 0.5 Threes from 3 books into
      // ONE row showing the best price + a small "also at: ..." chip.
      const sideStr = String(r?.side || "").toLowerCase()
      const lineNum = r.line ?? null
      const oddsNum  = Number(r.oddsAmerican ?? r.odds)
      const bookName = canonicalBookName(String(r?.sportsbook || r?.book || "")) || r?.sportsbook || r?.book
      if (!bookName || !Number.isFinite(oddsNum)) continue

      const dedupeKey = `${sideStr}|${lineNum}`
      const existing  = p.propGroups[fam][dedupeKey]
      if (!existing) {
        p.propGroups[fam][dedupeKey] = {
          side:       sideStr,
          line:       lineNum,
          odds:       oddsNum,            // current best price
          book:       bookName,           // current best book
          isAltLine:  Boolean(r?.isAltLine || /alternate_/i.test(String(r?.marketKey || ""))),
          books:      [{ book: bookName, odds: oddsNum }],
        }
      } else {
        // Add this book to the books[] roster if not already present
        const have = existing.books.find(b => b.book === bookName)
        if (!have) existing.books.push({ book: bookName, odds: oddsNum })
        // Promote to primary if this price is better than the current primary
        if (oddsNum > existing.odds) {
          existing.odds = oddsNum
          existing.book = bookName
        }
      }
    }

    // Calibration overlay (2026-05-23) — for every family on every player,
    // attach the lane verdict so the FE can render a per-family badge that
    // tells the operator if the model has earned trust on this prop yet.
    // Computed once per (sport, family) pair — the overlay is read from
    // scorecards/lane_calibration.json (5min cache).
    const _laneCache = new Map()
    function _laneFor(sport, fam) {
      const key = `${sport}|${fam}`
      if (_laneCache.has(key)) return _laneCache.get(key)
      const verdict = resolveLaneCalibration(sport, fam)
      if (!verdict) { _laneCache.set(key, null); return null }
      const badge = laneStatusBadge(verdict.status)
      const out = {
        status:           verdict.status,
        badge,                           // null when status==="no_data"
        hitRate:          verdict.hitRate ?? null,
        modelAvg:         verdict.modelAvg ?? null,
        roi:              verdict.roi ?? null,
        sample:           verdict.sample ?? 0,
        calibrationDelta: verdict.calibrationDelta ?? null,
      }
      _laneCache.set(key, out)
      return out
    }

    // Convert maps to arrays, sort
    const out = []
    for (const [, g] of games) {
      const players = []
      for (const [, p] of g.playerMap) {
        // Flatten propGroups (Map of dedupeKey→entry) into array per family.
        // Attach: lane calibration verdict, model probability + edge joined
        // from tracked_bets, sorted books[] with best price first, top-line
        // model projection summary per family for the FE header.
        const flatGroups = {}
        const familyCalibration = {}
        const familyProjection = {}
        for (const fam of Object.keys(p.propGroups)) {
          const arr = Object.values(p.propGroups[fam])
          arr.sort((a, b) => Number(a.line ?? 0) - Number(b.line ?? 0))

          // Calibration overlay
          const cal = _laneFor(sport, fam)
          if (cal) {
            for (const e of arr) e.laneCalibration = cal
            familyCalibration[fam] = cal
          }

          // Per-row model-prob join + book sort
          let bestEdgeEntry = null
          for (const e of arr) {
            // Sort the books list by best price desc so FE renders best first
            if (Array.isArray(e.books) && e.books.length > 1) {
              e.books.sort((a, b) => Number(b.odds) - Number(a.odds))
            }
            // Look up model probability via tracked_bets join
            const key = `${String(p.player||"").toLowerCase().trim()}|${canonFamily(fam)}|${e.side}|${e.line ?? ""}`
            const m = modelProbLookup.get(key)
            if (m) {
              e.modelProb = Number.isFinite(m.modelProb) ? m.modelProb : null
              e.edge      = Number.isFinite(m.edge)      ? m.edge      : null
              e.tier      = m.tier || null
              if (!bestEdgeEntry || (e.edge != null && bestEdgeEntry.edge != null && e.edge > bestEdgeEntry.edge)) {
                bestEdgeEntry = e
              }
            }
          }
          // Family-level projection summary for the FE header
          if (bestEdgeEntry) {
            familyProjection[fam] = {
              bestEdge:     bestEdgeEntry.edge,
              bestModelProb:bestEdgeEntry.modelProb,
              bestSide:     bestEdgeEntry.side,
              bestLine:     bestEdgeEntry.line,
              tier:         bestEdgeEntry.tier,
            }
          }

          flatGroups[fam] = arr
        }
        p.propGroups = flatGroups
        p.familyCalibration = familyCalibration
        p.familyProjection  = familyProjection
        players.push(p)
      }
      // Sort players: starters first, then by ceiling score (best first), then alphabetical
      players.sort((a, b) => {
        const sa = a.starterFlag === 1 ? 1 : 0
        const sb = b.starterFlag === 1 ? 1 : 0
        if (sa !== sb) return sb - sa
        const ca = Number(a.ceilingScore || 0)
        const cb = Number(b.ceilingScore || 0)
        if (ca !== cb) return cb - ca
        return String(a.player).localeCompare(String(b.player))
      })
      out.push({
        eventId: g.eventId,
        matchup: g.matchup,
        gameTime: g.gameTime,
        awayTeam: g.awayTeam,
        homeTeam: g.homeTeam,
        players,
      })
    }
    out.sort((a, b) => String(a.gameTime || "").localeCompare(String(b.gameTime || "")))

    res.json({ ok: true, sport, games: out, totalGames: out.length, totalRows: rows.length, totalKept: filtered.length })
  } catch (err) {
    console.error("[/games]", err)
    res.status(500).json({ ok: false, error: err?.message || String(err) })
  }
})

/** AI Slips only (full payload). */
router.get("/ai-slips", (req, res) => {
  try {
    const { sport, date } = resolveSportDate(req)
    const mods = loadSharedModules()
    const pool = buildCandidatePool(sport, date)
    const rawCandidates = [...pool.eligibleBets, ...pool.enrichedBest]
    const candidates = diversifyCandidates(rawCandidates, { maxPerPlayer: 4, maxPerGame: 8 })
    let ledgerState = null
    try { ledgerState = mods.ledger.loadLedger ? mods.ledger.loadLedger() : null } catch (_) {}
    const result = mods.slipAi.buildAiSlips({
      candidates,
      ledgerState,
      portfolioBaseline: { bets: pool.enrichedBest.length ? pool.enrichedBest : pool.eligibleBets },
      options: { sport, date, maxPerTier: 5 },
    })
    res.json({ sport, date, ...result })
  } catch (err) { res.status(500).json({ error: String(err?.message || err) }) }
})

/**
 * Featured plays — the workstation trust anchor.
 * Themed buckets: tonight's best, HRs, ladders, smart aggression, safest,
 * best CLV, market agreement, timing windows, best books.
 */
router.get("/featured", (req, res) => {
  try {
    const { sport, date } = resolveSportDate(req)
    const key = `featured:${sport}:${date}`
    const out = cached(key, () => {
      const mods = loadSharedModules()
      const pool = buildCandidatePool(sport, date)
      const rawCandidates = [...pool.eligibleBets, ...pool.enrichedBest]
      const candidates = diversifyCandidates(rawCandidates, { maxPerPlayer: 4, maxPerGame: 8 })

      const snapshotRows = readSnapshotRows(sport)
      const bookState   = mods.lineShop.loadBookState   ? mods.lineShop.loadBookState()   : null
      const timingState = mods.timing.loadTimingState   ? mods.timing.loadTimingState()   : null
      const lineShopping = snapshotRows.length
        ? mods.lineShop.buildLineShopping(snapshotRows, { sport, bookState })
        : null
      const timingResult = snapshotRows.length
        ? mods.timing.buildMarketTiming(snapshotRows, { lineShopping, timingState, bookState })
        : null
      let ledgerState = null
      try { ledgerState = mods.ledger.loadLedger ? mods.ledger.loadLedger() : null } catch (_) {}
      return mods.featured.buildFeaturedPlays({
        candidates, timingResult, lineShopping, bookState, ledgerState, sport, date,
      })
    })
    res.json(out)
  } catch (err) { res.status(500).json({ error: String(err?.message || err) }) }
})

/** Line shopping detail. */
router.get("/line-shopping", (req, res) => {
  try {
    const { sport, date } = resolveSportDate(req)
    const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 80))
    const key = `lineshop:${sport}:${date}:${limit}`
    const out = cached(key, () => {
      const mods = loadSharedModules()
      const rows = readSnapshotRows(sport)
      if (!rows.length) return { sport, date, groups: [], meta: {} }
      const bookState = mods.lineShop.loadBookState ? mods.lineShop.loadBookState() : null
      const ls = mods.lineShop.buildLineShopping(rows, { sport, bookState })
      const compacted = compactLineShopping(ls, limit)
      return {
        sport, date,
        groups: compacted?.groups || [],
        meta:   ls.meta || {},
        ladders: [],
      }
    })
    res.json(out)
  } catch (err) { res.status(500).json({ error: String(err?.message || err) }) }
})

/** Timing detail. */
router.get("/timing", (req, res) => {
  try {
    const { sport, date } = resolveSportDate(req)
    const urgency = String(req.query.urgency || "").toLowerCase() || null
    const mods = loadSharedModules()
    const rows = readSnapshotRows(sport)
    if (!rows.length) return res.json({ sport, date, classifications: [], meta: {} })
    const bookState   = mods.lineShop.loadBookState ? mods.lineShop.loadBookState() : null
    const timingState = mods.timing.loadTimingState ? mods.timing.loadTimingState() : null
    const lineShopping = mods.lineShop.buildLineShopping(rows, { sport, bookState })
    const result = mods.timing.buildMarketTiming(rows, { lineShopping, timingState, bookState })
    let classifications = result.timingClassifications || []
    if (urgency) classifications = classifications.filter((c) => c.urgency === urgency || c.state === urgency)
    res.json({ sport, date, classifications: classifications.slice(0, 200), meta: result.meta || {} })
  } catch (err) { res.status(500).json({ error: String(err?.message || err) }) }
})

/** Portfolio detail. */
router.get("/portfolio", (req, res) => {
  try {
    const { sport, date } = resolveSportDate(req)
    const mods = loadSharedModules()
    const pool = buildCandidatePool(sport, date)
    const rawCandidates = pool.enrichedBest.length ? pool.enrichedBest : pool.eligibleBets
    const candidates = diversifyCandidates(rawCandidates, { maxPerPlayer: 3, maxPerGame: 7 })
    const bookState = mods.lineShop.loadBookState ? mods.lineShop.loadBookState() : null
    // slipBets intentionally omitted — see /state for rationale
    const result = mods.portfolio.optimizePortfolio({ bets: candidates, slipBets: [], bookState })
    res.json({ sport, date, ...result })
  } catch (err) { res.status(500).json({ error: String(err?.message || err) }) }
})

/** Ledger summary. */
router.get("/ledger", (req, res) => {
  try {
    const windowDays = Math.min(180, Math.max(1, Number(req.query.windowDays) || 30))
    const mods = loadSharedModules()
    const sport = req.query.sport ? String(req.query.sport).toLowerCase() : null
    const report = mods.ledger.buildNightlyReport
      ? mods.ledger.buildNightlyReport({ sport, windowDays })
      : null
    const ledger = mods.ledger.loadLedger ? mods.ledger.loadLedger() : null
    const recent = (ledger?.bets || []).slice(-50).reverse()
    res.json({ windowDays, report, recent, totals: ledger?.totals || null, bankroll: ledger?.bankroll || null })
  } catch (err) { res.status(500).json({ error: String(err?.message || err) }) }
})

/**
 * Feedback-loop surface (2026-05-23). Mobile-driven recommendation logging.
 *
 * Doctrine: NO new tables, NO new modules. These routes wrap the canonical
 * authority in buildPersonalLedger.js + buildNightlyOrchestrator.js.
 *
 *   POST /api/ws/ledger/log         — log a single pick the operator tapped
 *   GET  /api/ws/ledger/yesterday   — yesterday's logged picks + grades
 *   POST /api/ws/ledger/grade       — manually trigger nightly review
 */

/**
 * Log a single recommendation from the mobile UI to the canonical personal
 * ledger. Wraps `addOrUpdateBet` — idempotent on stableId collision so
 * re-tapping the same play won't duplicate.
 *
 * Body shape (all string/number fields tolerated):
 *   { sport, sportsbook, player, statFamily, side, line, odds,
 *     stake?, eventId?, matchup?, modelProb?, modelLine?, edge?,
 *     confidenceTier?, archetype?, decisionType?, note? }
 */
router.post("/ledger/log", express.json(), (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {}
    // Minimum viable shape — never fabricate a bet from empty input
    if (!body.player || !body.statFamily || !body.side) {
      return res.status(400).json({
        ok: false,
        error: "missing_required_fields",
        required: ["player", "statFamily", "side"],
      })
    }
    // Build a deterministic id from the natural-key fields so a double-tap
    // upserts instead of duplicating. The `_m` suffix marks mobile-origin
    // for traceability in the ledger.
    //
    // 2026-06-01 — Phase Ledger-Dedup-Fix-1A made buildPersonalLedger.stableId()
    // actually stable (dropped the Date.now() suffix that was breaking dedup
    // for ALL callers). The local _h32 + `_m` pinning below is now technically
    // redundant — the canonical stableId would produce a matching deterministic
    // id from the same parts. Keeping the local computation for now under
    // Law 11 conservatism (verbatim-preserve until intentional removal); the
    // `_m` suffix gives us mobile-vs-other origin tracing that the bare
    // stableId hash doesn't. Safe to retire if origin tracing is unneeded.
    function _h32(s) {
      let h = 2166136261 >>> 0
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
      return (h >>> 0).toString(16)
    }
    // 2026-06-01 Phase Date-Doctrine-1B — canonical ET helper.
    const _todayKey = currentSlateDateEt()
    const _idParts = [
      String(body.sport || "").toLowerCase(),
      _todayKey,
      String(body.player || "").toLowerCase().replace(/[^a-z0-9]+/g, ""),
      String(body.statFamily || "").toLowerCase(),
      String(body.side || "").toLowerCase(),
      String(body.line ?? ""),
      String(body.sportsbook || "").toLowerCase().replace(/[^a-z0-9]+/g, ""),
    ].join("|")
    const deterministicId = `pl_${_h32(_idParts)}_m`   // "_m" = mobile-logged origin

    const mods = loadSharedModules()
    const result = mods.ledger.addOrUpdateBet({
      id:              deterministicId,
      sport:           body.sport,
      sportsbook:      body.sportsbook,
      player:          body.player,
      team:            body.team,
      eventId:         body.eventId,
      matchup:         body.matchup,
      opponent:        body.opponent,
      statFamily:      body.statFamily,
      prop:            body.prop,
      side:            body.side,
      line:            body.line,
      odds:            body.odds,
      stake:           body.stake != null ? body.stake : 10,
      modelLine:       body.modelLine,
      modelOdds:       body.modelOdds,
      modelProb:       body.modelProb,
      modelTier:       body.modelTier || body.confidenceTier,
      confidenceTier:  body.confidenceTier,
      decisionType:    body.decisionType || "followed",
      modelSnapshot:   body.modelSnapshot || {
        edge:                  body.edge,
        calibratedConfidence:  body.confidence,
        archetype:             body.archetype,
      },
      note:            body.note,
    })
    res.json({
      ok:      true,
      isNew:   result.isNew,
      bet: {
        id:           result.bet.id,
        date:         result.bet.date,
        sport:        result.bet.sport,
        sportsbook:   result.bet.sportsbook,
        player:       result.bet.player,
        statFamily:   result.bet.statFamily,
        side:         result.bet.side,
        line:         result.bet.line,
        odds:         result.bet.odds,
        stake:        result.bet.stake,
        toWin:        result.bet.toWin,
        modelProb:    result.bet.modelProb,
        result:       result.bet.result,
        integrity:    result.bet.integrity,
      },
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) })
  }
})

/**
 * Return yesterday's logged picks (optionally narrowed by sport).
 * Pure read of the canonical ledger JSON. Picks settled by the nightly
 * orchestrator will already carry result/payout/clvSnapshot fields.
 */
router.get("/ledger/yesterday", (req, res) => {
  try {
    const sport = req.query.sport ? String(req.query.sport).toLowerCase() : null
    // 2026-05-29 — GRADES truthfulness fix. ?showAll=true bypasses both
    // tier filtering AND cross-sportsbook dedup, returning the full tracked
    // inventory. Default behavior shows the BETTABLE subset (operator's
    // intended view) — what the system actually recommends betting.
    const showAll = String(req.query.showAll || "").toLowerCase() === "true"

    const mods = loadSharedModules()
    const ledger = mods.ledger.loadLedger ? mods.ledger.loadLedger() : null
    if (!ledger) return res.json({ date: null, picks: [], totals: null })

    // Yesterday's slate date — 2026-06-01 Phase Date-Doctrine-1B canonical helper.
    const y = new Date()
    y.setDate(y.getDate() - 1)
    const yKey = slateDateForTimestamp(y.getTime())

    // 2026-05-27 — Lane B Phase 3 v0.3 Path A. Filter LONGSHOT-tier picks from
    // FE GRADES display. tracked_bets and ledger keep them for audit (CLV
    // measurement, hit-rate research), but the operator's "Last Night" view
    // should only show PLAYABLE/STRONG/ELITE picks that were actually
    // displayable on Sharp Plays. Without this, the 56-100 LONGSHOT alt-line
    // picks per slate flood the GRADES tab as "0W/130L · −$1300 profit"
    // calculated from $10 default stake × 130 unwinnable picks.
    //
    // 2026-05-29 — extended to FADE filter. FADE tier means the system
    // explicitly tagged "do not bet" because edge<0 or model contradicts.
    // Including them in the ROI calc inflated the loss column to -98% ROI
    // on yesterday's NBA Game 5 (225 of 359 FADE picks inflated -$3540).
    // Real bettable picks excluding FADE+LONGSHOT yields the honest number.
    const isUnbettableTier = (b) => {
      const t = String(b.modelTier || b.confidenceTier || "").toUpperCase()
      return t === "LONGSHOT" || t === "FADE"
    }

    let picks = (ledger.bets || [])
      .filter((b) => b.date === yKey && (!sport || b.sport === sport))
      .filter((b) => showAll || !isUnbettableTier(b))
      .map((b) => ({
        id:            b.id,
        sport:         b.sport,
        sportsbook:    b.sportsbook,
        player:        b.player,
        team:          b.team,
        matchup:       b.matchup,
        statFamily:    b.statFamily,
        prop:          b.prop,
        side:          b.side,
        line:          b.line,
        odds:          b.odds,
        stake:         b.stake,
        toWin:         b.toWin,
        modelProb:     b.modelProb,
        edge:          b.modelSnapshot?.edge,
        archetype:     b.modelSnapshot?.archetype,
        result:        b.result,
        actualStat:    b.actualStat,
        payout:        b.payout,
        clvScore:      b.clvSnapshot?.clv?.clvScore,
        clvPct:        b.clvSnapshot?.clv?.clvPct,
        clvQuality:    b.clvSnapshot?.clv?.quality,
        beatMarket:    b.clvSnapshot?.clv?.beatMarket,
      }))

    // 2026-05-29 — Cross-sportsbook dedup. Same logical pick (player +
    // statFamily + side + line) at DraftKings + FanDuel + BetMGM is ONE
    // bet you'd shop the line on, not three. Without dedup, the GRADES
    // tab counts each as a separate W/L. Yesterday: 1226 graded entries
    // collapsed to 761 unique logical picks (38% duplication).
    // Strategy: group by (player, statFamily, side, line) and keep the row
    // with the best odds (highest toWin for fixed stake = best for bettor).
    // ?showAll=true bypasses dedup so operator can audit the full inventory.
    if (!showAll) {
      const norm = (v) => String(v ?? "").toLowerCase().trim()
      const lineKey = (v) => (v == null || v === "" ? "" : String(Number(v)))
      const dedupKey = (p) =>
        `${norm(p.player)}|${norm(p.statFamily)}|${norm(p.side)}|${lineKey(p.line)}`
      const best = new Map()
      for (const p of picks) {
        const k = dedupKey(p)
        const prev = best.get(k)
        if (!prev) { best.set(k, p); continue }
        // Tiebreaker: pick row with higher toWin (better odds for bettor),
        // and if equal, prefer a result that's settled over pending.
        const prevWin = Number(prev.toWin) || 0
        const pWin = Number(p.toWin) || 0
        if (pWin > prevWin) { best.set(k, p); continue }
        if (pWin === prevWin) {
          const prevSettled = prev.result && prev.result !== "pending"
          const pSettled = p.result && p.result !== "pending"
          if (pSettled && !prevSettled) best.set(k, p)
        }
      }
      picks = Array.from(best.values())
    }

    // Rolling W/L + ROI for yesterday's logged picks only
    // 2026-05-29 — CRITICAL BUG FIX (worth flagging). Number(null) returns 0,
    // not NaN, so the original check `Number.isFinite(Number(p.payout))` was
    // true whenever payout was null (which is EVERY win — grading never sets
    // payout). That made the win path compute `0 - stake = -10` per win,
    // treating every winning pick as a -$10 LOSS in the profit accumulator.
    // Visible symptom: yesterday's NBA Game 5 displayed -98% ROI / -$3540
    // loss on 76W/278L when the real number (using toWin field) is closer to
    // -4% ROI on the bettable subset. Fix: explicit null/undefined check
    // BEFORE Number() conversion. Same logic for stake/toWin (those can be 0
    // legitimately so isFinite check after Number() is still safe).
    let wins = 0, losses = 0, pushes = 0, pending = 0, staked = 0, profit = 0
    for (const p of picks) {
      const stake = Number(p.stake) || 0
      const toWin = Number(p.toWin) || 0
      const hasRealPayout = p.payout != null && Number.isFinite(Number(p.payout))
      const payout = hasRealPayout ? Number(p.payout) : null
      staked += stake
      if (p.result === "win") {
        wins++
        profit += hasRealPayout ? (payout - stake) : toWin
      } else if (p.result === "loss") {
        losses++
        profit -= stake
      } else if (p.result === "push" || p.result === "void") {
        pushes++
      } else {
        pending++
      }
    }
    const settled = wins + losses + pushes
    const roi = staked > 0 && settled > 0 ? Math.round((profit / staked) * 10000) / 10000 : null
    const winRate = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 10000) / 10000 : null

    // 2026-05-29 — expose viewMode so FE can label the display honestly.
    // Default "bettable" view = FADE+LONGSHOT excluded + cross-sportsbook
    // deduped. ?showAll=true returns the raw tracked inventory.
    //
    // ALSO 2026-05-29 — separate MODEL TRACKING from PLACED BETS conceptually.
    // The operator's correct framing: GRADES tab should show W/L accuracy of
    // the model across tracked picks. It should NOT compute hypothetical
    // profit/loss in dollar terms because the operator hasn't actually placed
    // any bets at $10 stakes. Real money tracking happens when (eventually)
    // operator taps a Sharp Plays card → marks it placed → sets real stake.
    // Until that flow exists, placedBets remains null and the FE hides $$.
    const tracking = {
      count: picks.length,
      wins, losses, pushes, pending, settled,
      hitRate: winRate,                                  // semantic: model accuracy
      hypotheticalStaked: Math.round(staked * 100) / 100, // if all $10 stakes — for audit only
      hypotheticalProfit: Math.round(profit * 100) / 100, // if all $10 stakes — for audit only
      hypotheticalRoi: roi,                              // if all $10 stakes — for audit only
    }
    // 2026-05-30 — placed-bets surface. Real-money bets are added via
    // addPlacedBet.js (CLI today; mobile-tap-to-bet later). Marked with
    // decisionType="placed" OR realMoney=true. The GRADES tab needs to show
    // these separately from the 50000+ model-tracked picks. Surface BOTH
    // yesterday's settled placed bets AND today's pending ones.
    // 2026-06-01 Phase Date-Doctrine-1B — canonical ET helper.
    const todayKey = currentSlateDateEt()

    function rollupPlaced(bets) {
      let pwins = 0, plosses = 0, ppushes = 0, ppending = 0, pstaked = 0, pprofit = 0, ptoWin = 0
      for (const b of bets) {
        const s = Number(b.stake) || 0
        const w = Number(b.toWin) || 0
        pstaked += s
        ptoWin += w
        if (b.result === "win")  { pwins++;  pprofit += w }
        else if (b.result === "loss") { plosses++; pprofit -= s }
        else if (b.result === "push" || b.result === "void") ppushes++
        else ppending++
      }
      const settledP = pwins + plosses + ppushes
      const roiP = pstaked > 0 && settledP > 0 ? Math.round((pprofit / pstaked) * 10000) / 10000 : null
      const hitRateP = (pwins + plosses) > 0 ? Math.round((pwins / (pwins + plosses)) * 10000) / 10000 : null
      return {
        count: bets.length,
        wins: pwins, losses: plosses, pushes: ppushes, pending: ppending,
        settled: settledP,
        staked: Math.round(pstaked * 100) / 100,
        toWin: Math.round(ptoWin * 100) / 100,
        profit: Math.round(pprofit * 100) / 100,
        roi: roiP,
        hitRate: hitRateP,
      }
    }
    // 2026-06-01 Phase Truth-Fix-1A — MY BETS filter fix (audit RED #7). Two bugs:
    //   (a) isPlaced accepted test entries created by QA tooling with
    //       sportsbook IN (smoke-test, diag, verify) at stake $0.01 each —
    //       surfaced 3 of those instead of operator's 2 real $5 bets.
    //   (b) date window was yesterday+today only — operator's real bets from
    //       2026-05-30 fell outside the 2-day window and never appeared, while
    //       the test entries dated 2026-05-31 fit and surfaced.
    // Fix: tighten isPlaced (exclude test sportsbooks + require stake >= 1)
    // AND widen the window to last 14 days so real bets persist visibly even
    // after grading. The yesterday/today rollups remain for summary cards.
    const TEST_SPORTSBOOKS = new Set(["smoke-test", "diag", "verify"])
    const isPlaced = (b) => {
      const tagged = b.decisionType === "placed" || b.realMoney === true
      if (!tagged) return false
      const sb = String(b.sportsbook || "").toLowerCase().trim()
      if (TEST_SPORTSBOOKS.has(sb)) return false   // exclude QA/test entries
      const stake = Number(b.stake)
      if (!Number.isFinite(stake) || stake < 1) return false  // exclude penny test entries
      return true
    }
    // Date window: last 14 days inclusive of today — 2026-06-01 Phase Date-Doctrine-1B helper.
    const fourteenDaysAgo = new Date()
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)
    const windowKey = slateDateForTimestamp(fourteenDaysAgo.getTime())
    const placedAll = (ledger.bets || [])
      .filter(isPlaced)
      .filter((b) => !sport || b.sport === sport)
      .filter((b) => b.date && b.date >= windowKey)
    const placedYesterday = placedAll.filter((b) => b.date === yKey)
    const placedToday     = placedAll.filter((b) => b.date === todayKey)
    // Combined rollup spans the full 14-day window now, not just yesterday+today.
    // yesterdayRollup / todayRollup remain available for summary cards.
    const placedCombinedRollup = rollupPlaced(placedAll)
    const placedBets = placedAll.length ? {
      ...placedCombinedRollup,  // flat fields for FE backward compat
      windowDays: 14,
      yesterdayRollup: rollupPlaced(placedYesterday),
      todayRollup:     rollupPlaced(placedToday),
      bets: placedAll.map((b) => ({
        id: b.id, date: b.date, sport: b.sport, sportsbook: b.sportsbook,
        betType: b.betType, prop: b.prop, player: b.player, matchup: b.matchup,
        statFamily: b.statFamily, side: b.side, line: b.line, odds: b.odds,
        stake: b.stake, toWin: b.toWin, result: b.result || "pending",
        payout: b.payout, settledAt: b.settledAt, placedAt: b.placedAt,
        legs: b.legs || null, notes: b.notes || b.note || null,
      })),
    } : null

    res.json({
      date: yKey,
      today: todayKey,
      sport: sport || "all",
      viewMode: showAll ? "all_tracked" : "bettable_subset",
      picks,
      tracking,            // model accuracy stats (purely informational)
      placedBets,          // 2026-05-30 — real-money bets if any exist, else null
      // legacy field — preserved for backward compat with older FE bundles
      totals: {
        count: picks.length,
        wins, losses, pushes, pending, settled,
        // 2026-05-29 — financial fields nulled by default because operator
        // hasn't placed real bets. FE checks placedBets; if null, hides $$.
        staked: null,
        profit: null,
        roi: null,
        winRate,
      },
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) })
  }
})

/**
 * Manually trigger the nightly orchestrator. Used by the mobile "Grade now"
 * button so the operator can grade yesterday's slate without shelling into
 * the box. The orchestrator's slate-completion guard prevents poisoning
 * partial slates — pass { force: true } to override.
 *
 * Body: { sport: "mlb"|"nba", date?: "YYYY-MM-DD", force?: boolean }
 */
router.post("/ledger/grade", express.json(), (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {}
    const sport = String(body.sport || "").toLowerCase()
    if (!sport || (sport !== "mlb" && sport !== "nba")) {
      return res.status(400).json({ ok: false, error: "sport must be 'mlb' or 'nba'" })
    }
    const { runNightlyReview } = require("../pipeline/shared/buildNightlyOrchestrator")
    const result = runNightlyReview({
      sport,
      date:  body.date || undefined,
      force: !!body.force,
      verbose: false,
    })
    res.json(result)
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) })
  }
})

/** First basket (NBA-only, gracefully empty otherwise). */
router.get("/first-basket", (req, res) => {
  try {
    const { sport, date } = resolveSportDate(req)
    if (sport !== "nba") return res.json({ sport, date, supported: false, plays: [] })
    const pool = buildCandidatePool(sport, date)
    const fbBets = (pool.trackedBets || []).filter(
      (b) => String(b.statFamily || "").toLowerCase().includes("firstbasket") ||
             String(b.statFamily || "").toLowerCase() === "first_basket"
    )
    res.json({ sport, date, supported: true, plays: fbBets.slice(0, 100) })
  } catch (err) { res.status(500).json({ error: String(err?.message || err) }) }
})

/**
 * Bet builder live preview.
 * POST { legs: [{ player, statFamily, side, line, odds, eventId, sportsbook, modelProb }, ...] }
 * Returns combined odds, payout estimate, exposure warnings, correlation flags.
 */
router.post("/bet-builder/preview", express.json(), (req, res) => {
  try {
    const legs = Array.isArray(req.body?.legs) ? req.body.legs : []
    const stake = Number(req.body?.stake) > 0 ? Number(req.body.stake) : 10
    if (!legs.length) return res.json({ legs: 0, summary: "Add legs to preview." })

    function americanToDecimal(o) {
      const n = Number(o); if (!Number.isFinite(n) || n === 0) return null
      return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n)
    }
    function decimalToAmerican(d) {
      if (!Number.isFinite(d) || d <= 1) return null
      return d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1))
    }

    let dec = 1
    let modelProb = 1
    for (const l of legs) {
      const d = americanToDecimal(l.odds)
      if (!Number.isFinite(d)) return res.status(400).json({ error: "Invalid odds on a leg" })
      dec *= d
      const mp = Number(l.modelProb)
      modelProb *= Number.isFinite(mp) && mp > 0 ? Math.min(0.999, Math.max(0.001, mp)) : 0.5
    }
    const americanCombined = decimalToAmerican(dec)
    const impliedCombined = 1 / dec
    const edge = modelProb - impliedCombined
    const ev   = (modelProb * (dec - 1)) - (1 - modelProb)
    const payout = stake * dec

    // Run portfolio analysis on the legs themselves
    const mods = loadSharedModules()
    const portfolio = mods.portfolio.optimizePortfolio({
      bets: legs.map((l) => ({
        player: l.player, team: l.team, statFamily: l.statFamily, side: l.side,
        line: l.line, odds: l.odds, eventId: l.eventId, matchup: l.matchup,
        sportsbook: l.sportsbook,
      })),
    })

    res.json({
      legs: legs.length,
      combinedDecimal: Math.round(dec * 1000) / 1000,
      combinedAmerican: americanCombined,
      modelProb: Math.round(modelProb * 10000) / 10000,
      impliedProb: Math.round(impliedCombined * 10000) / 10000,
      edge: Math.round(edge * 10000) / 10000,
      ev: Math.round(ev * 10000) / 10000,
      payout: Math.round(payout * 100) / 100,
      stake,
      portfolioScore: portfolio.score,
      portfolioGrade: portfolio.grade,
      warnings: portfolio.warnings,
      conflicts: portfolio.conflicts,
      correlations: (portfolio.correlations?.clusters || []).slice(0, 5),
    })
  } catch (err) { res.status(500).json({ error: String(err?.message || err) }) }
})

// compactLineShopping, compactTiming, compactPortfolio — imported from
// pipeline/shared/buildWorkstationCompactors.js (extracted from here, Session Y)

// 2026-05-30 — FE v2 endpoints (Phase 1 of FE overhaul). All cross-sport,
// signal-enriched, and operator-preferred-book aware.
// 2026-05-31 — round 2: reasoning hydration + per-prop dedup in games-browser.
// 2026-05-31 (c) — per-family calibration dampener applied at response time.
// 2026-05-31 Phase Calibration-Dampener-1B — source migrated to canonical
//   outcome_snapshots × prediction_snapshots SQLite join (same join
//   `calibration:status` reads). Side parameter added to surface per-side
//   asymmetry (UNDER 48.7% / OVER 25.5% on n=666 corpus).
// 2026-05-31 Phase Calibration-Dampener-1B-cleanup — applyCalibrationDampener
//   moved into the canonical dampener module per Law 1 (single authority) +
//   Law 19 (single absence point). Consumer here is just an unconditional
//   call; all mutation + absence logic lives in the helper.
const { applyCalibrationDampener } =
  require("../pipeline/shared/calibrationDampener")
// 2026-05-31 Phase Archetype-Surfacing-1A — per-(sport, volatility, tier)
//   historical archetype hit-rate attached to TOP PICKS + GAMES BROWSER picks
//   so the bettor can see "plays like this hit X% historically" in dimension
//   terms (Law 24 + Law 27 class-not-identity recognition). Reader-only wraps
//   the canonical intel.getArchetypePerf SQLite reader.
const { getArchetypeHistoryForPick } =
  require("../pipeline/shared/archetypeHistoryLookup")

function attachArchetypeHistory(pick) {
  if (!pick) return
  // Lookup ladder: (sport, volatility, tier) → (sport, statFamily) → null.
  // Phase Archetype-Surfacing-1A.1 — tracked_best response payloads lack
  // volatility/tier (queued #71 wiring gap); family fallback fires on bulk.
  const fam = pick.statFamily || pick.propType
  const h = getArchetypeHistoryForPick(pick.sport, pick.volatility, pick.tier || pick.modelTier, fam)
  if (h) pick.archetypeHistory = h
}

/**
 * Build a join index from tracked_best entries. KEY DESIGN: do NOT include
 * propType in the join key. tracked_bets and tracked_best disagree on
 * propType labels for the same logical prop (e.g. tracked_bets
 * "points_rebounds_assists" vs tracked_best "pra"; MLB "Total Bases" vs
 * "batter_total_bases_alternate"). Caught 2026-05-31 by traceMyBets when
 * Caruso PRA U17.5 returned "no pre-game entry found." Fix: index by
 * (sport, player, side, line) only, with statFamily/propType collected as a
 * disambiguator list for the rare same-player-same-line cases.
 *
 * Returns Map<key, Array<entry>> where key = `${sport}|${player}|${side}|${line}`.
 */
function loadReasoningIndex(sport, date) {
  const file = readJsonSafe(fileFor(sport, "tracked_best", date), null)
  const idx = new Map()
  if (!file || !Array.isArray(file.entries)) return idx
  for (const e of file.entries) {
    const key = `${sport}|${(e.player || "").toLowerCase()}|${String(e.side || "").toLowerCase()}|${e.line}`
    if (!idx.has(key)) idx.set(key, [])
    idx.get(key).push(e)
  }
  return idx
}

/** Family aliases — tracked_bets ↔ tracked_best naming differences. Used to
 * disambiguate when multiple entries share player+side+line. */
const _FAMILY_ALIASES = {
  pra: ["pra", "points_rebounds_assists", "playerpointsreboundsassists"],
  points_rebounds_assists: ["pra", "points_rebounds_assists"],
  total_bases: ["totalbases", "total bases", "batter_total_bases", "batter_total_bases_alternate"],
  totalbases: ["totalbases", "total bases", "batter_total_bases", "batter_total_bases_alternate"],
  home_runs: ["home_runs", "homeruns", "hr", "batter_home_runs"],
  hr: ["home_runs", "homeruns", "hr"],
}
function _familyMatches(a, b) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[\s_-]+/g, "")
  const an = norm(a), bn = norm(b)
  if (an === bn) return true
  const aliasesA = (_FAMILY_ALIASES[a] || _FAMILY_ALIASES[an] || []).map(norm)
  if (aliasesA.includes(bn)) return true
  const aliasesB = (_FAMILY_ALIASES[b] || _FAMILY_ALIASES[bn] || []).map(norm)
  if (aliasesB.includes(an)) return true
  return false
}

/** Resolve the best-matching tracked_best entry for a pick. */
// #100 MLB-Reasoning-Snapshot-Hydration-1A — pseudo-bestEntry fallback from snapshot-mlb.
// The buildReasoning MLB branch is gated on bestEntry (tracked_best-shaped), but tracked_best
// is a different pick population (Over-only batter ladders) so most MLB picks miss the join
// (#99/#100 audits: 0/11 live top-picks joined). This factory returns a per-request lookup:
//   pick → bestEntry-SHAPED object mapped from the pick's snapshot row (normPlayer join), or
//   null (NBA pick / join miss / no real context) → honest-empty downstream.
// LAZY: snapshot-mlb.json is parsed only on the FIRST MLB join miss in the request — requests
// where every pick joins tracked_best pay nothing. Trap-1: every field guard-clamped; indoor
// venue → omit weather (wind + temp); nulls omitted, never zeroed; needs ≥1 real context field
// or returns null (no empty pseudo). contextualTags intentionally absent (not derivable from
// the snapshot without new compute — drivers are thinner than true tracked_best joins, honestly).
function makeMlbSnapshotPseudoIndex() {
  let idx = null   // lazy — built on first use
  const load = () => {
    idx = new Map()
    try {
      const wrap = readJsonSafe(path.join(__dirname, "..", "snapshot-mlb.json"), null)
      const rows = (wrap && ((wrap.data && wrap.data.rows) || wrap.rows)) || []
      for (const r of rows) {
        if (!r || !r.player) continue
        const k = normPlayer(r.player)
        if (!k) continue
        // keep the most context-rich row per player (weather + park + implied total)
        const score = (r.weatherContext ? 1 : 0) + (r.parkContext ? 1 : 0) + (r.impliedTeamTotal != null ? 1 : 0)
        const prev = idx.get(k)
        const prevScore = prev ? (prev.weatherContext ? 1 : 0) + (prev.parkContext ? 1 : 0) + (prev.impliedTeamTotal != null ? 1 : 0) : -1
        if (score > prevScore) idx.set(k, r)
      }
    } catch (_) { idx = new Map() }
  }
  return (pick) => {
    if (String(pick?.sport || "").toLowerCase() !== "mlb") return null
    if (idx === null) load()
    const row = idx.get(normPlayer(pick.player))
    if (!row) return null
    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
    const wc = (row.weatherContext && typeof row.weatherContext === "object") ? row.weatherContext : {}
    const pc = (row.parkContext && typeof row.parkContext === "object") ? row.parkContext : {}
    const out = {}
    const itt = num(row.impliedTeamTotal); if (itt != null) out.impliedTeamTotal = itt
    const gt = num(row.gameTotal); if (gt != null) out.gameTotal = gt
    if (wc.isIndoor !== true) {   // indoor venue → no weather (Trap 1: dome ≠ 0 wind / outdoor temp)
      const tf = num(wc.temperatureF); if (tf != null) out.temperatureF = tf
      if (wc.windDirectionTag) out.windDirectionTag = String(wc.windDirectionTag)
    }
    const hrf = num(pc.hrFactor); if (hrf != null) out.hrFactor = hrf
    if (pc.hrEnvironmentTag) out.hrEnvironmentTag = String(pc.hrEnvironmentTag)
    const ls = num(row.lineupPosition != null ? row.lineupPosition : row.battingOrderIndex)
    if (ls != null && ls > 0) out.lineupSpot = ls
    if (row.opponentTeam) out.opponent = String(row.opponentTeam)
    // require at least one REAL context field beyond opponent — otherwise honest null
    if (Object.keys(out).filter((k) => k !== "opponent").length === 0) return null
    out._source = "snapshot_pseudo"   // provenance (observability only; buildReasoning ignores it)
    return out
  }
}

function findReasoningEntry(reasoningIdx, pick) {
  const sport = pick.sport
  const key = `${sport}|${(pick.player||'').toLowerCase()}|${String(pick.side||'').toLowerCase()}|${pick.line}`
  const candidates = reasoningIdx?.get(key) || []
  if (!candidates.length) return null
  if (candidates.length === 1) return candidates[0]
  // Multiple entries — disambiguate by family/propType match
  const pickFam = pick.statFamily || pick.propType || ""
  for (const c of candidates) {
    if (_familyMatches(pickFam, c.statFamily) || _familyMatches(pickFam, c.propType) || _familyMatches(pickFam, c.marketPropType)) {
      return c
    }
  }
  return candidates[0] // fall back to first if no family match
}

function _round(n, p = 2) {
  if (n == null || !isFinite(n)) return null
  const m = Math.pow(10, p)
  return Math.round(Number(n) * m) / m
}

/**
 * Build a reasoning blob for a single pick, given its tracked_best entry.
 * Shape (FE renders these as 3 always-on blurbs + driver bullets):
 *   {
 *     l5:       { label, value, source }       // player L5 in this stat
 *     opp:      { label, value, source }       // opponent matchup vs this family
 *     propSpec: { label, value, source }       // one prop-specific signal
 *     drivers:  [string, ...]                  // 2-5 supporting bullets
 *   }
 */
function buildReasoning(pick, bestEntry) {
  const out = { l5: null, opp: null, propSpec: null, drivers: [] }
  const sport = String(pick.sport || "").toLowerCase()
  const fam = String(pick.statFamily || pick.propType || "").toLowerCase()
  const opp = bestEntry?.opponent || (() => {
    // derive opponent from matchup if needed
    const m = String(pick.matchup || "")
    const teamA = m.split(" @ ")[0]
    const teamB = m.split(" @ ")[1]
    return pick.team && pick.team === teamA ? teamB : teamA
  })()

  if (sport === "nba" && bestEntry) {
    const l5v = bestEntry?.recentForm?.last5_avg
    if (l5v != null) out.l5 = { label: "L5 avg", value: _round(l5v, 1), source: "espn game logs" }
    const baseline = bestEntry?.recentForm?.baseline
    if (l5v != null && baseline != null && Math.abs(l5v - baseline) >= 0.4) {
      const dir = l5v > baseline ? "above" : "below"
      out.drivers.push(`L5 ${_round(l5v, 1)} ${dir} season baseline ${_round(baseline, 1)}`)
    }

    // Opponent matchup. CRITICAL: gate on value > 0, not just != null.
    // Null pretending to be 0 was being printed as "allows 0 reb/g" (fabrication).
    const oppStats = bestEntry?.opponentStats || {}
    const isReal = (v) => v != null && Number.isFinite(Number(v)) && Number(v) > 0
    let oppLabel = `vs ${opp}`
    let oppVal = ""
    if (fam.includes("reb") && isReal(oppStats.reboundsAllowed)) {
      oppVal = `allows ${_round(oppStats.reboundsAllowed, 1)} reb/g`
    } else if ((fam.includes("three") || fam === "threes") && isReal(oppStats.threePAAllowed)) {
      oppVal = `allows ${_round(oppStats.threePAAllowed, 1)} 3PA/g`
    } else if (fam.includes("ast") && isReal(oppStats.assistsAllowed)) {
      oppVal = `allows ${_round(oppStats.assistsAllowed, 1)} ast/g`
    } else if (isReal(oppStats.pointsAllowed)) {
      oppVal = `allows ${_round(oppStats.pointsAllowed, 1)} pts/g`
    } else if (bestEntry?.oppDef) {
      oppVal = `def grade ${bestEntry.oppDef}`
    } else if (isReal(oppStats.defensiveRating)) {
      oppVal = `def rtg ${_round(oppStats.defensiveRating, 1)}`
    } else {
      // Honest "stats pending" instead of either "N/A" or fabricated 0
      oppVal = "team stats pending sync"
    }
    out.opp = { label: oppLabel, value: oppVal, source: "espn opp stats" }

    // Prop-specific signal (one)
    const minutes = bestEntry?.roleContext?.minutes_avg_recent
    const pace = bestEntry?.pace
    if (fam === "blocks" || fam.includes("block")) {
      out.propSpec = { label: "Role + opp", value: `${bestEntry?.roleContext?.role_change || "stable"} role, ${opp} pace ${_round(pace, 0) ?? "?"}`, source: "role + pace" }
    } else if (fam === "steals" || fam.includes("steal")) {
      out.propSpec = { label: "Opp TO rate", value: `pace ${_round(pace, 0) ?? "?"}, role ${bestEntry?.roleContext?.role_change || "stable"}`, source: "pace + role" }
    } else if (fam.includes("reb")) {
      out.propSpec = { label: "Reb rate", value: `${_round((bestEntry?.rebRate || 0) * 100, 1)}% of opportunities`, source: "season splits" }
    } else if (fam.includes("ast")) {
      out.propSpec = { label: "Ast rate", value: `${_round((bestEntry?.astRate || 0) * 100, 1)}% of possessions`, source: "season splits" }
    } else if (fam.includes("three")) {
      out.propSpec = { label: "Shots vol", value: `${_round(bestEntry?.shots, 1) ?? "?"} FGA/g, pace ${_round(pace, 0) ?? "?"}`, source: "shot volume" }
    } else {
      out.propSpec = { label: "Minutes + pace", value: `${_round(minutes, 1) ?? "?"} min/g, pace ${_round(pace, 0) ?? "?"}`, source: "role context" }
    }

    // Driver bullets from displayBundle.tags. Reject tags that fabricate a
    // zero opponent stat ("SAS allows 0 reb/g") — those are nullish values
    // being printed as literal 0 from upstream display formatters.
    // Also drop "MINS ↓" when game context (elimination/Game 7) invalidates
    // the trend signal (#60 — 2026-05-31 fix).
    const tags = Array.isArray(bestEntry?.displayBundle?.tags) ? bestEntry.displayBundle.tags : []
    const isFakeZeroTag = (t) =>
      /\ballows\s+0(\.0+)?\b/i.test(t) ||           // "SAS allows 0 reb/g"
      /\b=\s*0(\.0+)?\b/i.test(t) ||                // "opp X = 0"
      /\b0(\.0+)?\s*(reb|3pa|3pm|ast|stl|blk|pts|tov)\/g\b/i.test(t)  // "0 reb/g" naked
    // gameContext-aware filter: drop MINS ↓ for starters facing elimination.
    // Retroactive — looks up game context FRESH from nbaSeriesState.json at
    // request time using pick.matchup + pick.date, so stored entries that
    // predate the fix still get the right filtering.
    let suppressMinsDown = false
    let runtimeGameCtx = null
    try {
      const { getGameContext, shouldSuppressMinsDownTag } = require("../pipeline/nba/nbaGameContextCache")
      runtimeGameCtx = bestEntry?.gameContext || getGameContext(pick.matchup || bestEntry?.matchup, pick.date || bestEntry?.slateDate) || null
      if (runtimeGameCtx) {
        const team = bestEntry?.team || pick.team
        const roleStr = bestEntry?.starterFlag === 1 ? "starter" : (bestEntry?.starterFlag === 0 ? "bench" : "unknown")
        suppressMinsDown = shouldSuppressMinsDownTag(team, runtimeGameCtx, roleStr)
      }
    } catch (_) {}
    for (const tag of tags.slice(0, 6)) {
      if (typeof tag !== "string" || tag.length >= 60) continue
      if (isFakeZeroTag(tag)) continue
      if (suppressMinsDown && /MINS\s*↓/.test(tag)) continue
      out.drivers.push(tag)
    }
    // Surface game-context awareness in drivers (use the same runtime lookup)
    if (runtimeGameCtx?.isGame7) {
      out.drivers.push(`Game 7 (${runtimeGameCtx.seriesStatus || "decider"}) — starter minutes boosted, bench rotation tightened`)
    } else if (runtimeGameCtx?.isElimination) {
      out.drivers.push(`Elimination spot — projected minutes adjusted for stakes`)
    }
  } else if (sport === "mlb" && bestEntry) {
    // MLB tracked_best doesn't carry L5 today — surface implied team total as proxy "form gauge".
    if (bestEntry.impliedTeamTotal != null) {
      out.l5 = { label: "Team implied total", value: `${_round(bestEntry.impliedTeamTotal, 2)} runs`, source: "vegas-derived" }
    }
    out.opp = { label: `vs ${opp}`, value: opp, source: "matchup" }
    if (fam === "home_runs" || fam === "hr" || /home.run/.test(fam)) {
      const parts = []
      if (bestEntry.hrFactor != null) parts.push(`park HR factor ${_round(bestEntry.hrFactor, 2)}`)
      if (bestEntry.windDirectionTag) parts.push(`wind ${bestEntry.windDirectionTag}`)
      if (bestEntry.temperatureF != null) parts.push(`${_round(bestEntry.temperatureF, 0)}°F`)
      out.propSpec = { label: "HR environment", value: parts.join(" · ") || (bestEntry.hrEnvironmentTag || "neutral"), source: "park + weather + handedness" }
    } else if (fam.includes("pitch") || fam.includes("strikeout")) {
      const parts = []
      if (bestEntry.temperatureF != null) parts.push(`${_round(bestEntry.temperatureF, 0)}°F`)
      if (bestEntry.gameTotal != null) parts.push(`O/U ${_round(bestEntry.gameTotal, 1)}`)
      out.propSpec = { label: "Game environment", value: parts.join(" · ") || "—", source: "weather + total" }
    } else {
      const parts = []
      if (bestEntry.gameTotal != null) parts.push(`O/U ${_round(bestEntry.gameTotal, 1)}`)
      if (bestEntry.lineupSpot != null) parts.push(`bats ${bestEntry.lineupSpot}`)
      if (bestEntry.temperatureF != null) parts.push(`${_round(bestEntry.temperatureF, 0)}°F`)
      out.propSpec = { label: "Spot + environment", value: parts.join(" · ") || "—", source: "lineup + weather" }
    }
    const tags = Array.isArray(bestEntry.contextualTags) ? bestEntry.contextualTags : []
    for (const tag of tags) {
      if (typeof tag === "string") out.drivers.push(tag)
    }
  }

  // Always include the model's own confidence + edge stamp at the end.
  // 2026-05-31 (c) — when the dampener fired, show BOTH raw and calibrated
  // so operator can see the gap. Calibration audit data on the pick tells us.
  if (pick.calibration && Number.isFinite(pick.modelProbRaw)) {
    const rawPct = (pick.modelProbRaw * 100).toFixed(1)
    const dampPct = (Number(pick.modelProb) * 100).toFixed(1)
    const realPct = (pick.calibration.realized * 100).toFixed(1)
    const n = pick.calibration.n
    out.drivers.push(`⚖ Model raw ${rawPct}% → calibrated ${dampPct}% (this family hits ${realPct}% historically, n=${n})`)
  } else {
    out.drivers.push(`Model: ${(Number(pick.modelProb) * 100).toFixed(1)}% conf · edge ${(Number(pick.edge) * 100).toFixed(1)}%`)
  }
  return out
}

/**
 * GET /api/ws/top-picks?limit=50&date=2026-05-30
 * Cross-sport curated top picks. Smart-mix tier composition (top-N per tier),
 * dedup by player+stat+side+line, sorted by edge-weighted confidence.
 * Each pick is hydrated with a `reasoning` blob from tracked_best.
 */
router.get("/top-picks", (req, res) => {
  try {
    // 2026-06-01 Phase Date-Doctrine-1A/1B — canonical ET slate date.
    const todayK = currentSlateDateEt()
    let date = req.query.date ? String(req.query.date) : todayK
    let fellBack = false
    let requestedDate = date
    const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 50))
    const sports = ["nba", "mlb"]

    // Date-rollover fallback (2026-05-31): when "today" has no tracked_bets
    // yet (e.g. post-midnight ET, scheduler hasn't generated tomorrow's slate
    // or it generated a tracked_best but no bets crossed cutoffs), fall back
    // to the most recent date with NON-EMPTY tracked_bets across ANY sport.
    //
    // IMPORTANT: must check tracked_BETS specifically, not findLatestDateWithData
    // which also accepts tracked_best — that gap caused the 2026-05-31 4:55am
    // bug where NBA tracked_best had 163 entries but tracked_bets was [],
    // so findLatestDateWithData returned 5-31 and the endpoint then read the
    // empty bets file → 0 picks served.
    const probeAnySport = (d) => {
      for (const sport of sports) {
        const f = readJsonSafe(fileFor(sport, "tracked_bets", d), null)
        if (Array.isArray(f) && f.length) return true
      }
      return false
    }
    function findLatestDateWithBets() {
      try {
        const today = todayK
        const files = require("fs").readdirSync(TRACKING_DIR)
        const dayKeys = files
          .filter((f) => /^(nba|mlb)_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f))
          .map((f) => (f.match(/_(\d{4}-\d{2}-\d{2})\.json$/) || [])[1])
          .filter(Boolean)
          .filter((dk) => dk <= today)
          .sort()
          .reverse()
        const seen = new Set()
        for (const dk of dayKeys) {
          if (seen.has(dk)) continue
          seen.add(dk)
          if (probeAnySport(dk)) return dk
        }
      } catch (_) {}
      return null
    }
    if (!req.query.date && !probeAnySport(date)) {
      const latest = findLatestDateWithBets()
      if (latest && latest !== date) { date = latest; fellBack = true }
    }

    // 2026-06-01 Phase Truth-Fix-1C (audit RED #5) — preferred-books filter.
    // FE display narrows to 4 operator-preferred books (FD/DK/Fanatics/BetMGM)
    // per memory [[operator-preferred-books]]. Backend keeps the full 7-book
    // allowlist for line-shopping intelligence; this endpoint serves the
    // FE-facing TOP PICKS so it filters down to the 4. Audit found 22% NBA
    // and 62% MLB picks today were from Hard Rock + BetRivers (off-allowlist).
    // Defense-in-depth: the FE renderTopPicks also filters; this backend
    // filter is the source-of-truth gate.
    const PREFERRED_BOOKS = new Set(["draftkings", "fanduel", "fanatics", "betmgm"])
    const normBookName = (s) => String(s || "").toLowerCase().replace(/\s+/g, "")
    const isPreferredBook = (b) => PREFERRED_BOOKS.has(normBookName(b.book || b.sportsbook))

    const reasoningIdx = {}
    for (const sport of sports) reasoningIdx[sport] = loadReasoningIndex(sport, date)
    const all = []
    let droppedNonPreferredBook = 0
    for (const sport of sports) {
      const trackedBets = readJsonSafe(fileFor(sport, "tracked_bets", date), []) || []
      for (const b of trackedBets) {
        if (shouldRejectByOperatorPolicy(b)) continue
        const tier = String(b.tier || b.modelTier || "").toUpperCase()
        if (tier === "FADE" || tier === "LONGSHOT") continue
        if (!isPreferredBook(b)) { droppedNonPreferredBook++; continue }
        all.push({ ...b, sport })
      }
    }
    // 2026-05-31 (c) — apply calibration dampener BEFORE dedup/sort, so the
    // dampened probability flows through ranking. Picks in families the model
    // is honest about (MLB HR) are unaffected; picks in miscalibrated
    // families (NBA rebounds: ×0.227) drop significantly in modelProb +
    // recalculated edge, so they de-prioritize in TOP PICKS automatically.
    //
    // 2026-05-31 (e) — RELAX the filter. The original "drop if dampened edge ≤ 0"
    // was mathematically pure but produced 0 picks on a fresh Finals slate
    // because rebounds/threes/points multipliers (0.23-0.41) crush almost
    // every pick below break-even. UX preference: show picks ranked by
    // dampened edge regardless of sign, let operator see the model's calls
    // alongside calibration's verdict. ONLY filter picks that are SEVERELY
    // dampened (edge < -10%) since those are unambiguously losing at any odds.
    let dampenedRejected = 0
    const dampened = []
    for (const p of all) {
      applyCalibrationDampener(p)
      attachArchetypeHistory(p)  // Phase Archetype-Surfacing-1A
      if (p.modelProbRaw != null && Number(p.edge) < -0.10) {
        dampenedRejected++
        continue
      }
      dampened.push(p)
    }
    all.length = 0
    all.push(...dampened)

    // Dedup across books — keep best-odds row for each (sport,player,stat,side,line)
    const dedup = new Map()
    for (const p of all) {
      const key = `${p.sport}|${(p.player||'').toLowerCase()}|${p.statFamily}|${p.side}|${p.line}`
      const prev = dedup.get(key)
      const score = (Number(p.edge) || 0) * (Number(p.modelProb) || 0)
      const prevScore = prev ? (Number(prev.edge) || 0) * (Number(prev.modelProb) || 0) : -Infinity
      if (!prev || score > prevScore) dedup.set(key, p)
    }
    const unique = Array.from(dedup.values())

    // Smart-mix: hierarchical top-N per tier, proportional
    const byTier = { ELITE: [], STRONG: [], PLAYABLE: [] }
    for (const p of unique) {
      const t = String(p.tier || p.modelTier || "").toUpperCase()
      if (byTier[t]) byTier[t].push(p)
    }
    for (const t of Object.keys(byTier)) {
      byTier[t].sort((a, b) => (Number(b.edge) * Number(b.modelProb)) - (Number(a.edge) * Number(a.modelProb)))
    }
    // Allocation: ELITE 25% · STRONG 50% · PLAYABLE 25%
    const eliteN = Math.max(3, Math.floor(limit * 0.25))
    const strongN = Math.max(5, Math.floor(limit * 0.50))
    const playableN = limit - eliteN - strongN

    const picks = [
      ...byTier.ELITE.slice(0, eliteN),
      ...byTier.STRONG.slice(0, strongN),
      ...byTier.PLAYABLE.slice(0, playableN),
    ]

    // Hydrate reasoning on each pick (uses findReasoningEntry — no propType in join key).
    // #100 — MLB picks that miss the tracked_best join fall back to a snapshot-derived
    // pseudo-bestEntry (bestEntry-shaped; lazy snapshot load; honest null on miss). NBA
    // path untouched (the pseudo returns null for non-MLB picks).
    const mlbPseudoBest = makeMlbSnapshotPseudoIndex()
    for (const pick of picks) {
      const best = findReasoningEntry(reasoningIdx[pick.sport], pick) || mlbPseudoBest(pick)
      pick.reasoning = buildReasoning(pick, best)
    }

    res.json({
      date,
      requestedDate,
      fellBack,
      todayKey: todayK,
      sportsScanned: sports,
      counts: {
        ELITE: byTier.ELITE.length, STRONG: byTier.STRONG.length, PLAYABLE: byTier.PLAYABLE.length,
        returned: picks.length,
        dampenedRejected,
        droppedNonPreferredBook,
      },
      picks,
    })
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) })
  }
})

/**
 * GET /api/ws/games-browser?date=2026-05-30
 * Returns list of games with all picks grouped under each, ⭐ flag if pick is in top-picks.
 * Round 2 (2026-05-31):
 *   • Props within a player are deduped by statFamily+side+line.
 *   • Each deduped prop carries bookOptions[] with every (book, odds) pairing for that line.
 *   • Reasoning blob attached to the kept (best-edge) row.
 */
router.get("/games-browser", (req, res) => {
  try {
    // 2026-06-01 Phase Date-Doctrine-1B — canonical ET helper.
    const todayK = currentSlateDateEt()
    let date = req.query.date ? String(req.query.date) : todayK
    let fellBack = false
    const requestedDate = date
    const sports = ["nba", "mlb"]
    // Same date-rollover fallback as /top-picks. MUST check tracked_BETS
    // specifically (not findLatestDateWithData which also accepts tracked_best).
    const probeAnySport = (d) => {
      for (const sport of sports) {
        const f = readJsonSafe(fileFor(sport, "tracked_bets", d), null)
        if (Array.isArray(f) && f.length) return true
      }
      return false
    }
    function findLatestDateWithBets() {
      try {
        const files = require("fs").readdirSync(TRACKING_DIR)
        const dayKeys = files
          .filter((f) => /^(nba|mlb)_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f))
          .map((f) => (f.match(/_(\d{4}-\d{2}-\d{2})\.json$/) || [])[1])
          .filter(Boolean)
          .filter((dk) => dk <= todayK)
          .sort()
          .reverse()
        const seen = new Set()
        for (const dk of dayKeys) {
          if (seen.has(dk)) continue
          seen.add(dk)
          if (probeAnySport(dk)) return dk
        }
      } catch (_) {}
      return null
    }
    if (!req.query.date && !probeAnySport(date)) {
      const latest = findLatestDateWithBets()
      if (latest && latest !== date) { date = latest; fellBack = true }
    }
    const reasoningIdx = {}
    for (const sport of sports) reasoningIdx[sport] = loadReasoningIndex(sport, date)
    // #100 — per-request pseudo-bestEntry fallback (lazy snapshot load; null for NBA/misses).
    const mlbPseudoBest = makeMlbSnapshotPseudoIndex()
    const games = new Map()
    const allPicks = []
    for (const sport of sports) {
      const trackedBets = readJsonSafe(fileFor(sport, "tracked_bets", date), []) || []
      for (const b of trackedBets) {
        if (shouldRejectByOperatorPolicy(b)) continue
        const tier = String(b.tier || b.modelTier || "").toUpperCase()
        if (tier === "FADE" || tier === "LONGSHOT") continue
        allPicks.push({ ...b, sport })
        const key = `${sport}|${b.eventId || b.matchup}`
        if (!games.has(key)) {
          games.set(key, {
            sport, eventId: b.eventId, matchup: b.matchup,
            gameTime: b.gameTime, players: new Map(),
          })
        }
        const g = games.get(key)
        const pkey = (b.player || "?").toLowerCase()
        if (!g.players.has(pkey)) g.players.set(pkey, { player: b.player, props: new Map() })
        // Dedup at prop level: group by statFamily+side+line, accumulate book options
        const propKey = `${b.statFamily}|${String(b.side).toLowerCase()}|${b.line}`
        if (!g.players.get(pkey).props.has(propKey)) {
          g.players.get(pkey).props.set(propKey, { kept: b, bookOptions: [] })
        }
        const slot = g.players.get(pkey).props.get(propKey)
        slot.bookOptions.push({ book: b.sportsbook, odds: b.oddsAmerican })
        // Keep the row with best edge as the "kept" representative
        const curScore = (Number(slot.kept.edge) || 0) * (Number(slot.kept.modelProb) || 0)
        const newScore = (Number(b.edge) || 0) * (Number(b.modelProb) || 0)
        if (newScore > curScore) slot.kept = b
      }
    }
    // Compute top-picks key set (same algo as /top-picks, used to set ⭐)
    const dedup = new Map()
    for (const p of allPicks) {
      const key = `${p.sport}|${(p.player||'').toLowerCase()}|${p.statFamily}|${p.side}|${p.line}`
      const prev = dedup.get(key)
      const score = (Number(p.edge) || 0) * (Number(p.modelProb) || 0)
      const prevScore = prev ? (Number(prev.edge) || 0) * (Number(prev.modelProb) || 0) : -Infinity
      if (!prev || score > prevScore) dedup.set(key, p)
    }
    const unique = Array.from(dedup.values())
    const byTier = { ELITE: [], STRONG: [], PLAYABLE: [] }
    for (const p of unique) {
      const t = String(p.tier || p.modelTier || "").toUpperCase()
      if (byTier[t]) byTier[t].push(p)
    }
    for (const t of Object.keys(byTier)) {
      byTier[t].sort((a, b) => (Number(b.edge) * Number(b.modelProb)) - (Number(a.edge) * Number(a.modelProb)))
    }
    const limit = 50
    // P2b (FE-Trust-Surface-1A) — gate the ⭐ on edge > 0 so it never marks a pick the
    // engine wouldn't back (e.g. a tier-ranked prop that went negative-edge after the
    // calibration dampener). Applied WITHIN each tier, before the slice, so tier ordering
    // (already sorted by edge×modelProb desc above) is preserved. Trap-1: null edge → 0 → excluded.
    const posEdge = (p) => (Number(p.edge) || 0) > 0
    const topKeys = new Set([
      ...byTier.ELITE.filter(posEdge).slice(0, Math.max(3, Math.floor(limit * 0.25))),
      ...byTier.STRONG.filter(posEdge).slice(0, Math.max(5, Math.floor(limit * 0.50))),
      ...byTier.PLAYABLE.filter(posEdge).slice(0, limit - Math.max(3, Math.floor(limit * 0.25)) - Math.max(5, Math.floor(limit * 0.50))),
    ].map((p) => `${p.sport}|${(p.player||'').toLowerCase()}|${p.statFamily}|${p.side}|${p.line}`))

    const gamesArr = []
    for (const g of games.values()) {
      const players = []
      for (const p of g.players.values()) {
        // Flatten props map → array of kept rows with bookOptions attached
        const propsArr = []
        for (const slot of p.props.values()) {
          const prop = { ...slot.kept }
          const k = `${g.sport}|${(prop.player||'').toLowerCase()}|${prop.statFamily}|${prop.side}|${prop.line}`
          prop.isTopPick = topKeys.has(k)
          // Sort book options by best odds for the side
          slot.bookOptions.sort((a, b) => {
            // For the operator: best price = highest positive or closest-to-zero negative
            const oa = Number(a.odds), ob = Number(b.odds)
            return ob - oa
          })
          prop.bookOptions = slot.bookOptions
          // 2026-05-31 (c) — calibration dampener applied at games-browser too
          prop.sport = g.sport
          applyCalibrationDampener(prop)
          // P2b (completing fix) — the dampener can flip a tier-ranked pick to negative edge AFTER
          // topKeys was computed (isTopPick set at L2693 from the PRE-dampener edge). Re-gate the ⭐ on
          // the POST-dampener edge the bettor actually sees, so a star never marks a pick the engine
          // wouldn't back. Trap-1: null edge → 0 → cleared.
          if (prop.isTopPick && !((Number(prop.edge) || 0) > 0)) prop.isTopPick = false
          attachArchetypeHistory(prop)  // Phase Archetype-Surfacing-1A
          // Hydrate reasoning (no propType in join key — alias map handles family naming).
          // #100 — same snapshot pseudo-bestEntry fallback as /top-picks (no drift between surfaces).
          const pickShaped = { ...prop, sport: g.sport }
          const best = findReasoningEntry(reasoningIdx[g.sport], pickShaped) || mlbPseudoBest(pickShaped)
          prop.reasoning = buildReasoning(prop, best)
          propsArr.push(prop)
        }
        propsArr.sort((a, b) => (Number(b.edge) * Number(b.modelProb)) - (Number(a.edge) * Number(a.modelProb)))
        players.push({ player: p.player, props: propsArr })
      }
      players.sort((a, b) => a.player.localeCompare(b.player))
      gamesArr.push({ sport: g.sport, eventId: g.eventId, matchup: g.matchup, gameTime: g.gameTime, players })
    }
    // Sort by sport first (nba, mlb) then gameTime within sport
    const sportOrder = { nba: 0, mlb: 1 }
    gamesArr.sort((a, b) => {
      const so = (sportOrder[a.sport] ?? 99) - (sportOrder[b.sport] ?? 99)
      if (so !== 0) return so
      return (a.gameTime || "").localeCompare(b.gameTime || "")
    })
    res.json({ date, requestedDate, fellBack, todayKey: todayK, sportsScanned: sports, gameCount: gamesArr.length, games: gamesArr })
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) })
  }
})

/**
 * GET /api/ws/version
 *
 * Returns the commit hash + boot timestamp of the currently-running backend.
 * Used by probes and FE to detect "stale backend serving old code" — the same
 * trust-killer that hit us 2026-05-31 (LaunchAgent didn't reload after a
 * commit, so the FE looked fixed in chat but was still serving fabricated
 * "allows 0" tags from the old code path). If `commit` from this endpoint
 * doesn't match `git rev-parse HEAD` on disk, the backend needs a reload.
 *
 * Cached at module-load time — calling this endpoint does NOT shell out.
 */
let _VERSION_CACHE = null
function _computeVersion() {
  if (_VERSION_CACHE) return _VERSION_CACHE
  let commit = "unknown"
  let commitShort = "unknown"
  let commitDate = null
  try {
    const { execSync } = require("child_process")
    const repoRoot = path.join(__dirname, "..", "..")
    commit = execSync("git rev-parse HEAD", { cwd: repoRoot, timeout: 2000 }).toString().trim()
    commitShort = commit.slice(0, 7)
    commitDate = execSync("git log -1 --format=%cI HEAD", { cwd: repoRoot, timeout: 2000 }).toString().trim()
  } catch (e) { /* git may not be available in some environments */ }
  _VERSION_CACHE = {
    commit, commitShort, commitDate,
    bootAt: new Date().toISOString(),
    pid: process.pid,
  }
  return _VERSION_CACHE
}
router.get("/version", (req, res) => res.json(_computeVersion()))

/**
 * GET /api/ws/grades-health?days=7
 * Fast CLV-stamping + model-accuracy health probe. Reads only the small
 * per-day tracked_bets_*.json files (NOT the heavy ledger.json), so it never
 * hits the cloudflared 524 timeout. Surfaces proof that CLV is being stamped
 * and that grading/feedback is alive.
 */
router.get("/grades-health", (req, res) => {
  try {
    const days = Math.min(30, Math.max(1, Number(req.query.days) || 7))
    const sports = ["nba", "mlb"]
    // 2026-06-01 Phase Date-Doctrine-1B — canonical ET helper.
    const out = { days, today: currentSlateDateEt(), sports: {} }
    for (const sport of sports) {
      const window = { days: [], total: 0, clvStamped: 0, settled: 0, wins: 0, losses: 0, pushes: 0, pending: 0, clvSumCents: 0, clvBeatMarket: 0 }
      for (let i = 0; i < days; i++) {
        const d = new Date(); d.setDate(d.getDate() - i)
        const dk = slateDateForTimestamp(d.getTime())
        const file = readJsonSafe(fileFor(sport, "tracked_bets", dk), null)
        if (!file) continue
        const arr = Array.isArray(file) ? file : []
        const dayStat = { date: dk, total: arr.length, clvStamped: 0, wins: 0, losses: 0, pushes: 0, pending: 0 }
        for (const b of arr) {
          window.total++
          const stamped = b.closeOdds != null
          if (stamped) { window.clvStamped++; dayStat.clvStamped++ }
          const clv = Number(b.clv)
          if (Number.isFinite(clv)) {
            window.clvSumCents += clv * 100
            if (clv > 0) window.clvBeatMarket++
          }
          const r = String(b.result || "pending").toLowerCase()
          if (r === "win") { window.wins++; window.settled++; dayStat.wins++ }
          else if (r === "loss") { window.losses++; window.settled++; dayStat.losses++ }
          else if (r === "push" || r === "void") { window.pushes++; window.settled++; dayStat.pushes++ }
          else { window.pending++; dayStat.pending++ }
        }
        window.days.push(dayStat)
      }
      const settledWL = window.wins + window.losses
      window.hitRate = settledWL > 0 ? Math.round((window.wins / settledWL) * 10000) / 10000 : null
      window.clvStampRate = window.total > 0 ? Math.round((window.clvStamped / window.total) * 10000) / 10000 : null
      window.avgClvCents = window.clvStamped > 0 ? Math.round((window.clvSumCents / window.clvStamped) * 10) / 10 : null
      window.beatMarketRate = window.clvStamped > 0 ? Math.round((window.clvBeatMarket / window.clvStamped) * 10000) / 10000 : null
      out.sports[sport] = window
    }
    res.json(out)
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) })
  }
})

module.exports = router
