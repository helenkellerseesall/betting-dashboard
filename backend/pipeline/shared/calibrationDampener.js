"use strict"

/**
 * calibrationDampener — per-(sport, statFamily[, side]) realized-vs-stated
 * multiplier applied to modelProb so displayed/used probabilities track the
 * actual hit rate of the corpus, not the model's stated mean.
 *
 * Phase Calibration-Dampener-1B (2026-05-31):
 *   Extends prior `(c) Per-family calibration dampener` (task #75) +
 *   `(d) refinements` (#76) + `(e) filter` (#80). Moves data source from
 *   JSON-only (sysAudit-written `family_calibration.json`) to canonical
 *   SQLite corpus join. Adds per-side dampening.
 *
 * Canonical authority: outcome_snapshots × prediction_snapshots — same join
 * `calibration:status` (Phase Grading-Calibration-Operations-1B) uses. Single
 * source of truth per ARCHITECTURE_LAWS Law 1 (no parallel authority).
 *
 * REWRITE 2026-05-31 (#101):
 *   Source of truth moved from backend/runtime/calibration/family_calibration.json
 *   (sysAudit-written, JSON-only, pre-INC-013 was DRAMATICALLY wrong) to the
 *   canonical SQLite corpus: outcome_snapshots × prediction_snapshots, the
 *   exact join `npm run calibration:status` uses. Same data, single source.
 *
 *   Concrete numbers exposed by the post-backfill corpus that justified this
 *   rewrite (n=666 joined, UNDER 503 / OVER 161 split):
 *     totalbases 124  59.7%   ← prior dampener was crushing this at ~0.27x
 *     hits       116  46.6%
 *     runs       108  46.3%
 *     points      57  28.1%
 *     outs        44  31.8%
 *     rebounds    37  37.8%
 *     pra         28  35.7%
 *     steals      26  53.8%
 *     threes      26   7.7%   ← real signal; over-call rate near zero
 *     rbis        19  21.1%
 *     SIDE: under 503 @ 48.7%  /  over 161 @ 25.5%   (3:1 sample skew)
 *
 *   The OVER vs UNDER asymmetry is the bigger find than any single family:
 *   our model is meaningfully more overconfident on OVER calls than UNDER
 *   calls. Per-side dampening is the right primitive — flat per-family math
 *   was burying that signal.
 *
 * API:
 *   dampenModelProb(modelProb, sport, statFamily, side?)
 *     Returns calibrated probability. Lookup ladder:
 *       1. (sport, statFamily, side) bucket if n ≥ MIN_SAMPLE_SIDE (20)
 *       2. (sport, statFamily) all-sides bucket if n ≥ MIN_SAMPLE_FAMILY (30)
 *       3. No-op (return modelProb unchanged)
 *     Multiplier = realized_hit_rate / avg_stated_model_prob, clamped to
 *     [MULTIPLIER_FLOOR, MULTIPLIER_CEILING] = [0.20, 1.10].
 *
 *   getCalibrationForFamily(sport, statFamily, side?)
 *     Returns the persisted entry { n, stated, realized, gapPp, multiplier,
 *     bucket } or null. `bucket` is "side" or "family" so FE can explain.
 *
 *   shouldShowCalibrationBadge(sport, statFamily, side?)
 *     true when realized vs stated gap is ≥ MIN_BADGE_GAP_PP (5pp).
 *
 *   reload()  — clear the cache, force a fresh SQLite read on next call.
 *
 *   getCalibrationSnapshot()
 *     Dumps the entire calibration map. Used by sysAudit + verification.
 *
 * Single-source-of-truth doctrine: this module is the ONLY consumer of the
 * outcome_snapshots × prediction_snapshots join for runtime probability
 * dampening. sysAudit may still write family_calibration.json for audit
 * purposes, but this module no longer reads it.
 */

const path = require("path")

const MIN_SAMPLE_SIDE     = 20
const MIN_SAMPLE_FAMILY   = 30
const MULTIPLIER_FLOOR    = 0.20
const MULTIPLIER_CEILING  = 1.10
const MIN_BADGE_GAP_PP    = 5
const CACHE_TTL_MS        = 5 * 60 * 1000  // 5 min — corpus only grows after grading runs

let _cache       = null     // { sports: { nba: {...}, mlb: {...} } }
let _loadedAt    = 0
let _lastError   = null

// ── Family aliases ──────────────────────────────────────────────────────────
// tracked_bets and tracked_best disagree on a few labels. Resolve through this
// table so a caller passing either form finds the entry.
const _ALIASES = {
  pra:                       ["pra", "points_rebounds_assists"],
  points_rebounds_assists:   ["pra", "points_rebounds_assists"],
  // 2026-06-04 — combo families are stored WITHOUT underscores in the corpus
  // (prediction_snapshots.stat_family = "pointsassists") but picks/sysAudit use
  // the underscore form ("points_assists"). Without these bridges the dampener
  // lookup misses entirely, so the worst-calibrated NBA combo families were
  // never corrected even when corpus data exists. (Audit 2026-06-04.)
  points_assists:            ["points_assists", "pointsassists"],
  pointsassists:             ["points_assists", "pointsassists"],
  points_rebounds:           ["points_rebounds", "pointsrebounds"],
  pointsrebounds:            ["points_rebounds", "pointsrebounds"],
  rebounds_assists:          ["rebounds_assists", "reboundsassists"],
  reboundsassists:           ["rebounds_assists", "reboundsassists"],
  totalbases:                ["totalbases", "totalBases", "total_bases"],
  totalBases:                ["totalbases", "totalBases", "total_bases"],
  total_bases:               ["totalbases", "totalBases", "total_bases"],
  home_runs:                 ["hr", "home_runs", "homeruns"],
  homeruns:                  ["hr", "home_runs", "homeruns"],
  hr:                        ["hr", "home_runs", "homeruns"],
}

function _norm(s) { return String(s || "").toLowerCase().trim() }

function _clampMultiplier(m) {
  if (!Number.isFinite(m)) return 1
  return Math.max(MULTIPLIER_FLOOR, Math.min(MULTIPLIER_CEILING, m))
}

function _multiplierFromBucket(b) {
  if (!b || !Number.isFinite(b.stated) || !Number.isFinite(b.realized) || b.stated <= 0) {
    return 1
  }
  return _clampMultiplier(b.realized / b.stated)
}

function _gapPpFromBucket(b) {
  if (!b || !Number.isFinite(b.stated) || !Number.isFinite(b.realized)) return 0
  return Math.round((b.stated - b.realized) * 1000) / 10  // signed, 0.1pp resolution
}

// ── Canonical SQLite read ───────────────────────────────────────────────────
// Pulled from outcome_snapshots × prediction_snapshots — the same join
// calibrationStatus.js exposes via `npm run calibration:status`.
function _queryCorpus() {
  const { tryGetDb } = require(path.join(__dirname, "..", "..", "storage", "db"))
  const db = tryGetDb()
  if (!db) {
    _lastError = "sqlite-unavailable"
    return { sports: {}, generatedAt: new Date().toISOString(), totalRows: 0 }
  }

  // Per (sport, stat_family, side). hit IS NOT NULL avoids INC-013-style
  // dropped-signal rows; if backfill is incomplete the bucket sample size
  // ladder downshifts to family-wide or skips entirely.
  let rows = []
  try {
    // NOTE (Phase Settlement-PredictionSource-1A, 2026-06-04): the book-agnostic
    // column join (run_date|sport|player|stat_family|side|line, book dropped) is
    // BUILT and pre-validated (would yield MLB n=57 vs 0 today) but is deliberately
    // NOT live yet. Flipping it requires a LINE dimension first: the matched MLB
    // corpus clusters at longshot lines (hits|over ~95% line-2.5, stated 0.394 vs
    // realized 0.068), and this query + dampenModelProb are line-agnostic, so the
    // floor-clamped multiplier would over-suppress the majority easy-line picks.
    // The data plumbing (freezePredictionEpoch tracked_best source + column
    // backfills) IS shipped so the corpus is correct/joinable/growing; the live
    // read stays on the id-join until line-aware calibration lands. See
    // project_mlb_calibration_frozen_may17.md + OPERATOR_SESSION_LOG.md.
    rows = db.prepare(`
      SELECT
        ps.sport          AS sport,
        ps.stat_family    AS stat_family,
        ps.side           AS side,
        COUNT(*)          AS n,
        AVG(ps.model_prob) AS stated,
        AVG(os.hit)        AS realized
      FROM outcome_snapshots os
      JOIN prediction_snapshots ps ON ps.id = os.id
      WHERE os.hit IS NOT NULL
        AND ps.sport IS NOT NULL
        AND ps.stat_family IS NOT NULL
      GROUP BY ps.sport, ps.stat_family, ps.side
    `).all()
  } catch (e) {
    _lastError = `query-failed: ${e.message}`
    return { sports: {}, generatedAt: new Date().toISOString(), totalRows: 0 }
  }

  // Bucketize into:
  //   sports[sport][family] = { _all: {...}, over: {...}, under: {...}, yes/no: {...} }
  const sports = {}
  let totalRows = 0
  for (const r of rows) {
    const sport = _norm(r.sport)
    const fam   = _norm(r.stat_family)
    const side  = _norm(r.side)
    if (!sport || !fam) continue
    if (!sports[sport]) sports[sport] = {}
    if (!sports[sport][fam]) sports[sport][fam] = {}
    const bucket = {
      n:        Number(r.n) || 0,
      stated:   Number(r.stated) || 0,
      realized: Number(r.realized) || 0,
    }
    bucket.multiplier = _multiplierFromBucket(bucket)
    bucket.gapPp      = _gapPpFromBucket(bucket)
    sports[sport][fam][side || "unknown"] = bucket
    totalRows += bucket.n
  }

  // Synthesize the _all bucket per family by summing weighted across sides.
  // Doing it from the per-side rows preserves a single SQL roundtrip.
  for (const sport of Object.keys(sports)) {
    for (const fam of Object.keys(sports[sport])) {
      const sides = sports[sport][fam]
      let n = 0, statedNum = 0, realizedNum = 0
      for (const key of Object.keys(sides)) {
        if (key === "_all") continue
        const s = sides[key]
        n           += s.n
        statedNum   += s.stated   * s.n
        realizedNum += s.realized * s.n
      }
      if (n > 0) {
        const all = {
          n,
          stated:   statedNum   / n,
          realized: realizedNum / n,
        }
        all.multiplier = _multiplierFromBucket(all)
        all.gapPp      = _gapPpFromBucket(all)
        sports[sport][fam]._all = all
      }
    }
  }

  _lastError = null
  return {
    sports,
    generatedAt: new Date().toISOString(),
    totalRows,
    minSampleSide:   MIN_SAMPLE_SIDE,
    minSampleFamily: MIN_SAMPLE_FAMILY,
    multiplierFloor: MULTIPLIER_FLOOR,
    multiplierCeiling: MULTIPLIER_CEILING,
  }
}

function _load() {
  const now = Date.now()
  if (_cache && (now - _loadedAt) < CACHE_TTL_MS) return _cache
  _cache = _queryCorpus()
  _loadedAt = now
  return _cache
}

function reload() { _cache = null; _loadedAt = 0 }

function _famNames(fam) {
  const n = _norm(fam)
  if (!n) return []
  const aliases = _ALIASES[n] || _ALIASES[fam] || []
  const set = new Set([n, ...aliases.map(_norm)])
  return [...set]
}

function _findFamilyEntry(sport, fam) {
  const data = _load()
  const sp = data?.sports?.[_norm(sport)]
  if (!sp) return null
  for (const name of _famNames(fam)) {
    if (sp[name]) return sp[name]
  }
  return null
}

/**
 * Resolve a single calibration bucket. Lookup ladder:
 *   1) (sport, family, side) if n ≥ MIN_SAMPLE_SIDE
 *   2) (sport, family) all-sides if n ≥ MIN_SAMPLE_FAMILY
 *   3) null (no calibration data)
 *
 * Returns { n, stated, realized, gapPp, multiplier, bucket: "side"|"family" }
 */
function getCalibrationForFamily(sport, statFamily, side) {
  const famEntry = _findFamilyEntry(sport, statFamily)
  if (!famEntry) return null
  const sideKey = _norm(side)
  if (sideKey && famEntry[sideKey] && famEntry[sideKey].n >= MIN_SAMPLE_SIDE) {
    return { ...famEntry[sideKey], bucket: "side", side: sideKey }
  }
  if (famEntry._all && famEntry._all.n >= MIN_SAMPLE_FAMILY) {
    return { ...famEntry._all, bucket: "family", side: null }
  }
  return null
}

function dampenModelProb(modelProb, sport, statFamily, side) {
  const mp = Number(modelProb)
  if (!Number.isFinite(mp) || mp <= 0) return mp
  const cal = getCalibrationForFamily(sport, statFamily, side)
  if (!cal || !Number.isFinite(cal.multiplier)) return mp
  const d = mp * cal.multiplier
  return Math.max(0, Math.min(1, d))
}

function shouldShowCalibrationBadge(sport, statFamily, side) {
  const cal = getCalibrationForFamily(sport, statFamily, side)
  if (!cal) return false
  return Math.abs(cal.gapPp) >= MIN_BADGE_GAP_PP
}

function getCalibrationSnapshot() {
  return _load()
}

function getLastError() { return _lastError }

/**
 * Apply per-family per-side calibration to a response-payload pick.
 * Mutates the pick in place:
 *   modelProbRaw     — the original model probability
 *   modelProb        — dampened value (what FE displays + sorts on)
 *   edgeRaw          — original edge (preserved when re-derived)
 *   edge             — edge computed from dampened modelProb
 *   calibration      — { stated, realized, gapPp, multiplier, n, bucket, side }
 *                       attached only when the gap is bettor-visible
 *
 * Phase Calibration-Dampener-1B-cleanup (2026-05-31):
 *   Moved into the canonical dampener module from `workstationRoutes.js`
 *   per Law 1 (single canonical authority) + Law 19 (single canonical
 *   absence point per signal). Consumer becomes a one-liner; all
 *   absence policy (no pick / no modelProb / no calibration data /
 *   no actual change) lives here.
 */
function applyCalibrationDampener(pick) {
  if (!pick || !Number.isFinite(Number(pick.modelProb))) return pick
  const sport = pick.sport
  const fam = pick.statFamily || pick.propType
  const side = pick.side  // per-side asymmetry: UNDER 48.7% / OVER 25.5% on n=666 corpus
  const raw = Number(pick.modelProb)
  const dampened = dampenModelProb(raw, sport, fam, side)
  if (dampened === raw) return pick
  pick.modelProbRaw = raw
  pick.modelProb = Math.round(dampened * 10000) / 10000
  const impliedP = Number(pick.impliedProb)
  if (Number.isFinite(impliedP)) {
    pick.edgeRaw = pick.edge
    pick.edge = Math.round((dampened - impliedP) * 10000) / 10000
  }
  if (shouldShowCalibrationBadge(sport, fam, side)) {
    pick.calibration = getCalibrationForFamily(sport, fam, side)
  }
  return pick
}

module.exports = {
  dampenModelProb,
  getCalibrationForFamily,
  shouldShowCalibrationBadge,
  getCalibrationSnapshot,
  getLastError,
  applyCalibrationDampener,
  reload,
  // exported for tests/diagnostics
  _famNames,
  _constants: {
    MIN_SAMPLE_SIDE,
    MIN_SAMPLE_FAMILY,
    MULTIPLIER_FLOOR,
    MULTIPLIER_CEILING,
    MIN_BADGE_GAP_PP,
    CACHE_TTL_MS,
  },
}

// ── CLI mode: `node calibrationDampener.js` dumps the calibration map ──────
if (require.main === module) {
  const snap = getCalibrationSnapshot()
  console.log("=== calibrationDampener snapshot (canonical SQLite read) ===")
  console.log(`generatedAt    : ${snap.generatedAt}`)
  console.log(`totalRows      : ${snap.totalRows}`)
  console.log(`minSampleSide  : ${snap.minSampleSide}`)
  console.log(`minSampleFamily: ${snap.minSampleFamily}`)
  console.log(`multClamp      : [${snap.multiplierFloor}, ${snap.multiplierCeiling}]`)
  if (getLastError()) console.log(`LAST ERROR     : ${getLastError()}`)
  console.log("")
  for (const sport of Object.keys(snap.sports || {}).sort()) {
    console.log(`── ${sport.toUpperCase()} ──`)
    for (const fam of Object.keys(snap.sports[sport]).sort()) {
      const f = snap.sports[sport][fam]
      const sideRows = Object.keys(f).filter(k => k !== "_all").sort()
      console.log(`  ${fam}`)
      for (const sk of sideRows) {
        const b = f[sk]
        console.log(`    side=${sk.padEnd(7)} n=${String(b.n).padStart(4)}  ` +
          `stated=${(b.stated*100).toFixed(1).padStart(5)}%  ` +
          `realized=${(b.realized*100).toFixed(1).padStart(5)}%  ` +
          `gapPp=${b.gapPp >= 0 ? "+" : ""}${b.gapPp.toFixed(1).padStart(5)}  ` +
          `mult=${b.multiplier.toFixed(3)}`)
      }
      if (f._all) {
        const a = f._all
        console.log(`    side=ALL     n=${String(a.n).padStart(4)}  ` +
          `stated=${(a.stated*100).toFixed(1).padStart(5)}%  ` +
          `realized=${(a.realized*100).toFixed(1).padStart(5)}%  ` +
          `gapPp=${a.gapPp >= 0 ? "+" : ""}${a.gapPp.toFixed(1).padStart(5)}  ` +
          `mult=${a.multiplier.toFixed(3)}`)
      }
    }
  }
  console.log("")
}
