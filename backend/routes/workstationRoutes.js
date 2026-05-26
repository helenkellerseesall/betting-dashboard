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
// Session AZ — Frozen Prediction + Grading Architecture V1. Captures an
// immutable observational snapshot of every cache-miss prediction cycle
// (predictions + their full contextual reasoning state). NEVER duplicates
// existing prediction_snapshots writer — delegates to it, then writes
// new prediction_epochs + frozen_contextual_states rows on top.
const { freezePredictionEpoch } = require("../pipeline/memory/freezePredictionEpoch")
const screenshotRoutes = require("../pipeline/screenshots/screenshotRoutes")
const { compactLineShopping, compactTiming, compactPortfolio } = require("../pipeline/shared/buildWorkstationCompactors")
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
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
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

    // 2026-05-26 — Re-classify tier on read using CURRENT enriched state.
    // Background: tracked_bets disk files persist the tier stamped at write
    // time. If recentForm wasn't populated at write time (e.g. thin sample
    // for a player, or runNbaNight pre-form-gate cycle), the stale tier
    // bypasses the form-contradiction gate forever. Jalen Williams threes
    // ladder OVER 1.5 surfaced as ELITE on iPhone 2026-05-26 despite L5=0.5
    // — direct classifyNbaTier returned FADE, but tb.tier was ELITE on disk.
    //
    // Now: the read-side classifier sees the just-enriched recentForm /
    // projection and is the single source of truth. Disk-stored tier is
    // discarded.
    try {
      const __edge      = Number(out.edge ?? out.edgeProbability)
      const __modelProb = Number(out.modelProb ?? out.predictedProbability)
      const __l5        = Number(out.recentForm?.last5_avg ?? out.last5Avg)
      const __projML    = Number(
        out?.range?.mostLikely ??
        out?.projection?.mostLikely ??
        out?.projectionMostLikely
      )
      const __reTier = classifyNbaTier({
        edge:           Number.isFinite(__edge) ? __edge : null,
        modelProb:      Number.isFinite(__modelProb) ? __modelProb : null,
        side:           out.side,
        line:           out.line,
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
 * Gates: player present, known stat family, modelProb >= 0.35, edge >= 0.03.
 * NBA-3: quality alt-lines (threes/pra/points families only) survive with stricter thresholds
 * (mp >= 0.42, edge >= 0.06) and a wider odds ceiling (+800 American / dec ~9.0).
 * All other alt-lines (rebounds/assists/first_basket/unknown) remain hard-killed.
 *
 * Returns at most NBA_SNAPSHOT_TOP_N rows sorted by edge descending.
 */
const NBA_SNAPSHOT_SUPPLEMENT_THRESHOLD = 20
// FIX Q2: increased from 100 → 150 to allow more family diversity in thin-pool supplement
const NBA_SNAPSHOT_TOP_N = 150

function buildNbaSnapshotCandidates(snapshotRows) {
  console.log("[WS-PROBE] buildNbaSnapshotCandidates called with", snapshotRows.length, "rows")
  // Phase 1 — Teammate Context V1 (Session AS): build slate-level absence
  // context ONCE per snapshot pass. Cross-references the snapshot rows with
  // the per-player ESPN game-log cache (Session AQ) to detect likely-absent
  // teammates per team. Used per-row below to compute redistribution shifts.
  const __teammateSlateCtx = buildNbaTeammateSlateContext(snapshotRows)
  let __teammateAbsenceCount = 0
  for (const _arr of __teammateSlateCtx.absenceByTeam.values()) __teammateAbsenceCount += _arr.length
  console.log("[WS-PROBE] teammate slate-context: teams=%d, total likely-absent=%d",
    __teammateSlateCtx.absenceByTeam.size, __teammateAbsenceCount)
  // Phase 1 — Market Context V1 (Session AT): build per-prop multi-book
  // consensus map ONCE per snapshot pass. Used per-row below to compute
  // delta-vs-consensus and set row.marketShift.
  const __marketSlateCtx = buildSlateMarketContext(snapshotRows)
  console.log("[WS-PROBE] market slate-context: multi-book props=%d", __marketSlateCtx.propConsensus.size)
  if (!Array.isArray(snapshotRows) || !snapshotRows.length) return []
  const rawQualified = []

  for (const r of snapshotRows) {
    const player = String(r?.player || "").trim()
    if (!player) continue
    const side = String(r?.side || "").toLowerCase()
    if (!side || side === "unknown") continue
    // NBA-3: Read market key and variant before odds gate — alt-line status determines odds ceiling.
    const mk = String(r?.marketKey || "").toLowerCase()
    const pv = String(r?.propVariant || "").toLowerCase()
    const isAltLine = mk.includes("alternate") || mk.includes("_alt") ||
                      (pv && pv !== "base" && pv !== "default")

    // NBA-3: Alt-line family pre-check. Only eruption-prone families survive elevation.
    // rebounds/assists/first_basket alt-lines remain hard-killed (low variance, not eruption-prone).
    if (isAltLine) {
      const propTQuick = String(r?.propType || mk).toLowerCase()
      // PRA: match "player_pra", "alternate_player_pra", "pra" — /\bpra\b/ fails when
      // underscore (a \w char) precedes "pra", so check underscore-delimited patterns explicitly.
      const isEligibleFamily = propTQuick.includes("points_rebounds_assists") ||
        propTQuick.includes("_pra") || propTQuick === "pra" || propTQuick.startsWith("pra_") ||
        propTQuick.includes("points") ||
        propTQuick.includes("threes") || propTQuick.includes("three") ||
        propTQuick.includes("3pt")
      if (!isEligibleFamily) continue
    }

    // Odds gate: base lines core market range (-200..+200).
    // NBA-3: Quality alt-lines allowed up to +800 American (dec ~9.0) — calibrated elevation range.
    // Extreme ladder lines (> +800 American) remain hard-killed: model edge not calibrated above that.
    const odds = Number(r?.odds ?? r?.oddsAmerican)
    if (!Number.isFinite(odds) || odds < -200 || odds > (isAltLine ? 800 : 200)) continue

    // Classify stat family
    // 2026-05-25 — CRITICAL ORDERING. Third shadow classifier (sibling of
    // classifyPropFamily in nbaModelSignals.js and resolveStatFamily in
    // buildNbaBestBetsBoard.js). Combos ("Points + Rebounds", "Points + Assists",
    // "Rebounds + Assists") contain "points" substring — old branch caught
    // them and returned "points", which is why every KAT/Allen/Brunson combo
    // line showed up in tracked_best as propType="points" with the combo
    // line (28.5 etc.) attached. Two-stat combos now route to "pra" for
    // sigma/projection math (closer to PRA behavior than pure points).
    const propT = String(r?.propType || mk).toLowerCase()
    const family =
        propT.includes("points_rebounds_assists") || /\bpra\b/.test(propT) ? "pra"
      : propT.includes("first_basket") || propT.includes("firstbasket") ? "first_basket"
      : propT.includes("points_rebounds") || /points.*rebounds/.test(propT) || /points\s*\+\s*rebounds/.test(propT) ? "pra"
      : propT.includes("points_assists")  || /points.*assists/.test(propT)  || /points\s*\+\s*assists/.test(propT)  ? "pra"
      : propT.includes("rebounds_assists")|| /rebounds.*assists/.test(propT)|| /rebounds\s*\+\s*assists/.test(propT)? "pra"
      : propT.includes("points")   ? "points"
      : propT.includes("rebounds") ? "rebounds"
      : propT.includes("assists")  ? "assists"
      : (propT.includes("threes") || propT.includes("three") || propT.includes("3pt")) ? "threes"
      : null
    if (!family) continue

    // NBA-2.C.2: Apply team fallback from nbaPlayerProjections.json AFTER stat-layer enrichment.
    // enrichNbaRowStatLayerInputs does not populate `team` — it handles pace/total/minutes/usage.
    // applyTeamFallbackFromProjections reads team from projections.json by player name (lowercase key)
    // and infers opponent from homeTeam/awayTeam when team resolves. Safe degradation: players not in
    // projections.json remain team=null (sameTeam boosts simply don't fire for them — not an error).
    // Coverage on current slate: 18/24 diversified candidates receive team → sameTeam boosts activate.
    const enriched = applyTeamFallbackFromProjections(enrichNbaRowStatLayerInputs(r))
    // Phase 1 — Recent Form V1 (Session AP): inject real per-player rolling
    // stats from settled-bet history BEFORE modelProb is computed, so
    // nbaModelSignals.recentFormSignal sees row.recentForm and contributes a
    // sample-quality-blended formZ to the score. Honest no-op when no form.
    enrichNbaRowWithRecentForm(enriched)
    // Phase 1 — Lineup + Rotation Intelligence V1 (Session AR): inject real
    // role + minutes-trend signals from the same game-log cache. Sets
    // row.starterFlag + row.projectedMinutes (already consumed by
    // nbaModelSignals.roleSignals) and row.roleContext. No-op when sample < 3.
    enrichNbaRowWithRoleContext(enriched)
    // Phase 1 — Teammate Absence + Usage Redistribution V1 (Session AS):
    // sets row.teammateContext (absent_teammates list, redistribution per
    // stat) and row.teammateRedistShift (signed, capped ±0.030 prob units)
    // consumed by nbaRowIndependentModelProbability. No-op when no likely
    // absences detected for this team or sample insufficient.
    enrichNbaRowWithTeammateContext(enriched, __teammateSlateCtx)
    // Phase 1 — Market + News Adaptation V1 (Session AT): sets
    // row.marketContext (consensus_implied, dispersion, delta_vs_consensus,
    // market_signal) and row.marketShift (signed, capped ±0.020 prob units)
    // consumed by nbaRowIndependentModelProbability. Honest no-op when only
    // single book quotes this prop.
    enrichNbaRowWithMarketContext(enriched, __marketSlateCtx)
    // Phase 1 — Live Injury + Availability V1 (Session AV): sets
    // row.playerStatus + row.availabilityContext + row.availabilityShift
    // (signed, capped ±0.020 prob units, side-aware) consumed by
    // nbaRowIndependentModelProbability. Honest no-op when player not in
    // injury cache (status remains undefined — no synthetic "active default").
    enrichNbaRowWithAvailability(enriched)
    // 2026-05-24 — Phase 2 enrichment also applied here so snapshot-sourced
    // candidates carry opponent / oppDef / pace / playerSeasonStats end-to-end.
    // Honest no-op when source data unavailable; preserves Lane 5 integrity.
    try { enrichNbaRowWithTeamStats(enriched) } catch (_) {}
    try { enrichNbaRowWithPlayerSeasonStats(enriched) } catch (_) {}
    const mp = nbaRowModelProbability(enriched)
    if (!Number.isFinite(mp) || mp < 0.35) continue
    const edge = nbaRowEdge(enriched)
    if (!Number.isFinite(edge) || edge < 0.03) continue

    // NBA-3: Alt-lines require a stronger model signal and edge to justify the elevated line.
    // Base lines: mp >= 0.35, edge >= 0.03. Alt-lines: mp >= 0.42, edge >= 0.06.
    // These thresholds apply POST ladder-penalty in nbaIndependentBaseModelProbability —
    // an alt-line scoring 0.42+ after the ladderZ penalty has a genuine eruption signal.
    if (isAltLine && (mp < 0.42 || edge < 0.06)) continue

    rawQualified.push({
      ...enriched,
      // NBA-3: Alt-line ID prefixed with "alt" to distinguish from base-line entries.
      id:             `snap|${isAltLine ? "alt" : "base"}|${player}|${family}|${side}|${r?.line ?? ""}|${odds}|${r?.sportsbook || r?.book || ""}`,
      player,
      statFamily:     family,
      propType:       r?.propType || family,
      side,
      line:           r?.line    ?? null,
      odds,
      oddsAmerican:   odds,
      modelProb:      mp,
      edge,
      impliedProb:    odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100),
      sportsbook:     r?.sportsbook || r?.book || null,
      // 2026-05-25 — projMostLikely now passed so projection-contradiction
      // gate can fire here. Also passes projection from multiple possible
      // upstream stamps (range.mostLikely, projection.mostLikely, etc.).
      //
      // 2026-05-26 — BUG FIX: previously read recentForm / last5Avg from `r`
      // (the un-enriched raw snapshot row), so the form-contradiction gate
      // never had data to check. All the recentForm enrichment was applied
      // to `enriched` above (lines 579/591/595/596). Switched to read from
      // `enriched` so the gate fires correctly. Caught via Jalen Williams
      // Threes Ladder OVER 1.5 surviving as ELITE despite L5=0.5.
      tier:           classifyNbaTier({
                        edge, modelProb: mp,
                        side: r?.side, line: r?.line,
                        l5Avg: enriched?.recentForm?.last5_avg
                            ?? enriched?.recentForm?.last10_avg
                            ?? enriched?.last5Avg,
                        projMostLikely: Number(enriched?.range?.mostLikely)
                                     ?? Number(enriched?.projection?.mostLikely)
                                     ?? Number(enriched?.projectionMostLikely)
                                     ?? null,
                      }),
      // FIX Q4: PRA → lotto, threes/first_basket → aggressive, others → balanced.
      // NBA-3: Alt-lines always aggressive or lotto — never balanced or safe.
      //   points alt → aggressive (high-volume stat, elevation pushes into volatile range).
      //   threes alt + pra alt → lotto (discrete/combo stat, alt-range is eruption territory).
      // Base-line classification unchanged.
      volatility:     isAltLine
                    ? (family === "points" ? "aggressive" : "lotto")
                    : (family === "pra" ? "lotto"
                      : (family === "threes" || family === "first_basket") ? "aggressive"
                      : "balanced"),
      confidence:     mp,
      snapshotSourced: true,  // auditable marker — not from tracked pipeline
      isAltLine,              // NBA-3: true for elevated alt-line entries
    })
  }

  // NBA-3: Base and alt lines deduplicate independently — allows coexistence in the pool.
  // Base: best-edge per (player|stat|side), max 1 per signature (unchanged from pre-NBA-3).
  // Alt: best-edge per (player|stat|side), max 1 alt per signature.
  // Combined pool: at most 2 entries per signature — 1 base + 1 quality alt.
  // Before dedup: may include both base and alt rows for same player×stat×side.
  const bestBySig = new Map()
  for (const c of rawQualified) {
    const sig = `${c.isAltLine ? "alt" : "base"}|${c.player}|${c.statFamily}|${c.side}`
    if (!bestBySig.has(sig) || (c.edge ?? 0) > (bestBySig.get(sig).edge ?? 0)) bestBySig.set(sig, c)
  }
  const deduped = Array.from(bestBySig.values())
  deduped.sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0))
  const result = deduped.slice(0, NBA_SNAPSHOT_TOP_N)
  console.log("[WS-PROBE] buildNbaSnapshotCandidates: rawQualified=%d deduped=%d returning=%d",
    rawQualified.length, deduped.length, result.length)
  return result
}

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

      // FIX Q3: NBA playoff slates typically have 1–2 games per night.
      // maxPerGame:7 × 2 games = hard ceiling of 14 candidates regardless of pool size.
      // Raise to 12 for NBA so a 2-game slate yields up to 24 diversified candidates.
      // MLB keeps the tighter 7 cap (15+ games per night, candidate explosion risk).
      const nbaPerGame = sport === "nba" ? 12 : 7

      // Diversify before downstream views — caps repeats per player/game so the
      // workstation isn't dominated by 17 Donovan Mitchell legs.
      const candidates = diversifyCandidates(supplementedCandidates, { maxPerPlayer: 3, maxPerGame: nbaPerGame })
      console.log("[WS-PROBE] supplementedCandidates=%d → candidates(portfolio)=%d", supplementedCandidates.length, candidates.length)

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
      let ledgerState = null
      try { ledgerState = mods.ledger.loadLedger ? mods.ledger.loadLedger() : null } catch (_) {}
      const aiSlips = mods.slipAi.buildAiSlips({
        candidates: aiCandidates,
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
        const date = String(new Date().toISOString().slice(0, 10))
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
    // upserts instead of duplicating. buildPersonalLedger.stableId() includes
    // Date.now() in its suffix which breaks idempotency for mobile-logged
    // picks. We pin the id here from the same parts stableId hashes so the
    // ledger's findIndex(b.id === bet.id) match works.
    function _h32(s) {
      let h = 2166136261 >>> 0
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
      return (h >>> 0).toString(16)
    }
    const _todayKey = (() => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    })()
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
    const mods = loadSharedModules()
    const ledger = mods.ledger.loadLedger ? mods.ledger.loadLedger() : null
    if (!ledger) return res.json({ date: null, picks: [], totals: null })

    // Yesterday in operator's local-day key (matches todayKey() in ledger)
    const y = new Date()
    y.setDate(y.getDate() - 1)
    const yKey = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`

    const picks = (ledger.bets || [])
      .filter((b) => b.date === yKey && (!sport || b.sport === sport))
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

    // Rolling W/L + ROI for yesterday's logged picks only
    let wins = 0, losses = 0, pushes = 0, pending = 0, staked = 0, profit = 0
    for (const p of picks) {
      const stake = Number(p.stake) || 0
      const toWin = Number(p.toWin) || 0
      const payout = Number(p.payout)
      staked += stake
      if (p.result === "win") {
        wins++
        profit += Number.isFinite(payout) ? payout - stake : toWin
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

    res.json({
      date: yKey,
      sport: sport || "all",
      picks,
      totals: {
        count: picks.length,
        wins, losses, pushes, pending, settled,
        staked: Math.round(staked * 100) / 100,
        profit: Math.round(profit * 100) / 100,
        roi, winRate,
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

module.exports = router
