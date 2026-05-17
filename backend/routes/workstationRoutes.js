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
const { nbaRowModelProbability, nbaRowEdge } = require("../pipeline/nba/nbaModelSignals")
const { enrichNbaRowStatLayerInputs, applyTeamFallbackFromProjections } = require("../pipeline/nba/nbaEventTeamResolve")
// Phase 1 — Recent Form V1 (Session AP). Real per-player rolling stats from
// settled-bet history. Honest null when sample insufficient.
// enrichRowWithRecentForm is a no-op when no form exists for that player+stat.
const { enrichRowWithRecentForm: enrichNbaRowWithRecentForm } = require("../pipeline/nba/nbaRecentFormCache")
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
    const files = fs.readdirSync(TRACKING_DIR)
    const dayKeys = files
      .filter((f) => f.startsWith(`${sport}_tracked_`) && f.endsWith(".json"))
      .map((f) => (f.match(/_(\d{4}-\d{2}-\d{2})\.json$/) || [])[1])
      .filter(Boolean)
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
  const sport = String(req.query.sport || req.body?.sport || "mlb").toLowerCase()
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
    const propT = String(r?.propType || mk).toLowerCase()
    const family = propT.includes("points_rebounds_assists") || /\bpra\b/.test(propT) ? "pra"
      : propT.includes("first_basket") || propT.includes("firstbasket") ? "first_basket"
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
      tier:           edge >= 0.12 ? "ELITE" : edge >= 0.07 ? "STRONG" : edge >= 0.04 ? "PLAYABLE" : "LONGSHOT",
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

function buildCandidatePool(sport, date) {
  const trackedBets = readJsonSafe(fileFor(sport, "tracked_bets", date), []) || []
  const trackedBest = readJsonSafe(fileFor(sport, "tracked_best", date), null)
  const entries = trackedBest?.entries || []

  const betsById = new Map()
  for (const b of trackedBets) if (b?.id) betsById.set(b.id, b)

  const enrichedBest = entries.map((e) => enrichBestEntry(e, betsById)).filter(Boolean)
  // Filter tracked_bets to a sensible quality threshold so the pool is workable
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
router.get("/state", (req, res) => {
  try {
    const { sport, date } = resolveSportDate(req)
    // [WS-PROBE] Route entry
    console.log("[WS-PROBE] /state entry sport=%s date=%s", sport, date)
    const key = `state:${sport}:${date}`
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

      const rawCandidates = pool.enrichedBest.length ? pool.enrichedBest : pool.eligibleBets

      // FIX Q1: Pre-compute snapshot supplement ONCE and reuse for both the portfolio
      // candidate pool AND the featured/slip aiCandidates pool.
      // BEFORE: buildNbaSnapshotCandidates was called only for supplementedCandidates
      //   (used by portfolio). aiCandidatesRaw was set to [...eligibleBets,...enrichedBest]
      //   (2–4 entries on thin slates) and never supplemented → featured boards and AI
      //   slips always starved on nights without a full runNbaNight.js nightly run.
      // AFTER: both paths share the same scored snapshot supplement, no double-compute.
      const snapSupplement = (sport === "nba" && snapshotRows.length)
        ? buildNbaSnapshotCandidates(snapshotRows)
        : []
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
