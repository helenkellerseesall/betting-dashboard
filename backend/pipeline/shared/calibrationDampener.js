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
 *   dampenModelProb(modelProb, sport, statFamily, side?, line?)
 *     Returns calibrated probability. With `line` omitted/null (backwards-compat) or
 *     a line-agnostic family (moneyline/runline/...) → id-join family-side ladder:
 *       1. (sport, statFamily, side) bucket if n ≥ MIN_SAMPLE_SIDE (20)
 *       2. (sport, statFamily) all-sides bucket if n ≥ MIN_SAMPLE_FAMILY (30)
 *       3. No-op (return modelProb unchanged)
 *     With `line` passed (Phase Calibration-LineAware-1A, 5.2) → book-agnostic
 *     per-line corpus ladder:
 *       1. (sport, statFamily, side, lineBucket) if n ≥ MIN_SAMPLE_LINE (25)
 *       2. line-HOMOGENEOUS (NBA continuous): family-side _allLines if n ≥ MIN_SAMPLE_SIDE
 *       3. line-HETEROGENEOUS (MLB rungs): null — no pooled fallback (the bug fix)
 *     Multiplier = realized_hit_rate / avg_stated_model_prob, clamped to
 *     [MULTIPLIER_FLOOR, CEILING]=[0.20,1.10] (id-join) or
 *     [MULTIPLIER_FLOOR_LINEAWARE, CEILING]=[0.40,1.10] (line-aware).
 *
 *   getCalibrationForFamily(sport, statFamily, side?, line?)
 *     Returns the persisted entry { n, stated, realized, gapPp, multiplier,
 *     bucket } or null. `bucket` is "side"/"family"/"line"/"family-lineaware".
 *
 *   shouldShowCalibrationBadge(sport, statFamily, side?, line?)
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

// ── Phase Calibration-LineAware-1A (2026-06-06) — line-aware corpus tunables ──
// These feed the PARALLEL line-aware corpus (_queryCorpusLineAware) ONLY. Step 5.1
// builds + surfaces that corpus but does NOT consume it — the live dampening path
// (getCalibrationForFamily / dampenModelProb) still reads the id-join corpus, so
// dampening output is byte-identical until step 5.2 wires the line dimension in.
const MIN_SAMPLE_LINE            = 25    // per-(sport,family,side,lineBucket) min n to qualify (operator-approved)
const MULTIPLIER_FLOOR_LINEAWARE = 0.40  // raised from 0.20 (operator-approved): per-line buckets are thinner, a
                                         // softer floor protects real picks from thin-bucket noise. TUNABLE.
const RANGE_BUCKET_WIDTH         = 2     // NBA continuous families bucket lines into windows of this width
const DEFAULT_LINE_MODE          = "exact"  // unknown families → exact (never pool → never re-introduce line-bias)

// Phase Calibration-LineAware-1A step 5.3 — KILL-SWITCH. Read ONCE at module load
// (set via the backend plist EnvironmentVariables; flipping it requires a backend
// reload — that's the point: an emergency revert, not a mid-flight toggle).
//   CALIB_LINEAWARE unset or "1" → line-aware path live (5.2 default)
//   CALIB_LINEAWARE = "0"        → force the pre-5.2 id-join path (line ignored)
// Only the exact string "0" disables. See RUNTIME_FACTS.md.
const LINEAWARE_ENABLED = process.env.CALIB_LINEAWARE !== "0"

// Boot-time announcement (matches the [DB-BOOT] convention) so the LIVE flag state is
// observable in the backend log after a CALIB_LINEAWARE plist flip + reload. This is the
// reliable confirmation — the /status familyCalibration section reads family_calibration.json,
// NOT this module, so it does NOT reflect the flag.
console.log(`[CALIB-BOOT] line-aware dampener: ${LINEAWARE_ENABLED ? "ON (default)" : "OFF — CALIB_LINEAWARE=0, id-join path"}`)

// ── Phase G1 / POST_FREEZE STEP 1 (2026-07-01) — marginal calibration LIVE ──────
// Operator-approved G1 extension of this PRESERVED module (the ONLY sanctioned edit;
// see docs/POST_FREEZE_25TH_RUNBOOK.md §STEP 1 + docs/G1_STEP1_EXECUTION_BRIEF.md).
// When MLB_CALIB_LIVE is ON, the MLB dampening "multiplier" is REPLACED by the
// validated isotonic remap (backend/config/mlbMarginalCalibration.json — the SAME
// map the G1 forward gate probeCalibrationForward PASSED 2026-07-01). OFF ⇒ the
// realized/stated id-join / line-aware multiplier (today's behavior) ⇒ byte-identical.
// Read ONCE at module load (CALIB_LINEAWARE pattern; a flip needs a backend reload).
// MLB-only — NBA/other sports keep the multiplier path unchanged.
//
// DOUBLE-CALIBRATION GUARD: MLB cluster picks are calibrated ONCE, at scoring
// (buildMlbPropClusters, which stamps calibVersion). applyCalibrationDampener()
// therefore SKIPS rows already carrying that stamp so the remap is never applied
// twice on the serve path. See the guard in applyCalibrationDampener below.
const MLB_CALIB_LIVE = String(process.env.MLB_CALIB_LIVE ?? "0") === "1"
let _g1CalibrateModelProb = null
if (MLB_CALIB_LIVE) {
  try {
    _g1CalibrateModelProb = require(path.join(__dirname, "..", "mlb", "mlbMarginalCalibration")).calibrateModelProb
  } catch (e) {
    console.log(`[CALIB-BOOT] G1 isotonic module unavailable (${e && e.code ? e.code : e}) — MLB dampener stays on the multiplier`)
  }
}
console.log(`[CALIB-BOOT] G1 marginal calibration LIVE: ${MLB_CALIB_LIVE ? "ON — MLB multiplier = isotonic remap (mlb-calib-live-v1)" : "OFF (default) — realized/stated multiplier"}`)

let _cache       = null     // { sports: { nba: {...}, mlb: {...} } }
let _loadedAt    = 0
let _lastError   = null

// Phase Calibration-LineAware-1A — PARALLEL line-aware cache (separate from _cache;
// not consumed by dampening until step 5.2).
let _cacheLineAware    = null
let _loadedAtLineAware = 0

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

// ── Line-mode per family (Phase Calibration-LineAware-1A) ────────────────────
// How the line dimension is bucketed in the PARALLEL line-aware corpus.
// Operator-approved 2026-06-06:
//   exact     — each prop line is a distinct difficulty; never pool (MLB rungs).
//   range     — nearby lines behave alike; bucket into RANGE_BUCKET_WIDTH windows (NBA continuous).
//   agnostic  — no meaningful numeric line (moneyline / runline / spread / firstHR / yes-no specials).
// Families not listed default to DEFAULT_LINE_MODE ("exact"), the conservative
// choice: exact never pools, so it can never re-introduce the longshot line-bias
// that froze MLB. Only families that DIFFER from the default must be listed; the
// exact MLB rungs are listed anyway for documentation.
const _LINE_MODE = {
  // NBA continuous — range buckets (width 2)
  points:                  "range",
  rebounds:                "range",
  assists:                 "range",
  pra:                     "range",
  points_rebounds_assists: "range",
  pointsreboundsassists:   "range",
  threes:                  "range",
  threepointers:           "range",
  // line-agnostic markers — no numeric line dimension
  moneyline:               "agnostic",
  runline:                 "agnostic",
  spread:                  "agnostic",
  firsthr:                 "agnostic",
  firsthomerun:            "agnostic",
  // MLB rungs — exact (covered by the default; listed for documentation)
  hits:                    "exact",
  hr:                      "exact",
  home_runs:               "exact",
  rbis:                    "exact",
  totalbases:              "exact",
  total_bases:             "exact",
  batter_strikeouts:       "exact",
  strikeouts:              "exact",
}

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

// ── Phase Calibration-LineAware-1A — PARALLEL line-aware corpus (NOT consumed) ──
// Book-agnostic COLUMN join (the held work from Phase Settlement-PredictionSource-1A)
// PLUS a line dimension in the GROUP BY. Built + surfaced by step 5.1 (getLineAware-
// Snapshot) for inspection; WIRED INTO dampening in step 5.2. Until then the live
// path (getCalibrationForFamily / dampenModelProb / _load) is unchanged, so dampening
// output is identical. predictionId untouched — this joins raw columns, not the id.

function _clampMultiplierLineAware(m) {
  if (!Number.isFinite(m)) return 1
  return Math.max(MULTIPLIER_FLOOR_LINEAWARE, Math.min(MULTIPLIER_CEILING, m))
}

function _multiplierFromBucketLineAware(b) {
  if (!b || !Number.isFinite(b.stated) || !Number.isFinite(b.realized) || b.stated <= 0) return 1
  return _clampMultiplierLineAware(b.realized / b.stated)
}

function _lineModeFor(fam) {
  const n = _norm(fam)
  if (_LINE_MODE[n]) return _LINE_MODE[n]
  for (const a of _famNames(fam)) {        // alias-resolve (e.g. total_bases → totalbases)
    if (_LINE_MODE[a]) return _LINE_MODE[a]
  }
  return DEFAULT_LINE_MODE
}

// Map a raw corpus line value to its bucket key under the family's line mode.
// Trap 1 (num(null)=0, project-pick-origin-architecture): Number(null) === 0 and
// Number.isFinite(0) === true, so a null/absent line MUST be caught by an explicit
// `== null` check BEFORE Number(), or a line-less marker would mis-bucket as line 0.
function _lineBucketKey(mode, line) {
  if (line == null) return "_noline"
  const L = Number(line)
  if (!Number.isFinite(L)) return "_noline"
  if (mode === "agnostic") return "_noline"
  if (mode === "range") {
    const idx = Math.floor(L / RANGE_BUCKET_WIDTH)
    const lo  = idx * RANGE_BUCKET_WIDTH
    return `${lo}-${lo + RANGE_BUCKET_WIDTH}`
  }
  return String(L)   // exact
}

function _queryCorpusLineAware() {
  const { tryGetDb } = require(path.join(__dirname, "..", "..", "storage", "db"))
  const db = tryGetDb()
  if (!db) {
    return { sports: {}, generatedAt: new Date().toISOString(), totalRows: 0, joinedRows: 0, error: "sqlite-unavailable" }
  }

  let rows = []
  try {
    // Book-agnostic column join: dedupe BOTH sides to one row per
    // (run_date, sport, player, stat_family, side, line) BEFORE joining, so
    // multiple per-book rows don't fan out. Null-safe `IS` on the nullable
    // columns (player / side / line) so line-less markers (line NULL) still join.
    rows = db.prepare(`
      WITH preds AS (
        SELECT run_date, sport, player, stat_family, side, line,
               AVG(model_prob) AS model_prob
        FROM prediction_snapshots
        WHERE sport IS NOT NULL AND stat_family IS NOT NULL
        GROUP BY run_date, sport, player, stat_family, side, line
      ),
      outs AS (
        SELECT run_date, sport, player, stat_family, side, line,
               MAX(hit) AS hit
        FROM outcome_snapshots
        WHERE hit IS NOT NULL
        GROUP BY run_date, sport, player, stat_family, side, line
      )
      SELECT p.sport AS sport, p.stat_family AS stat_family, p.side AS side, p.line AS line,
             COUNT(*) AS n, AVG(p.model_prob) AS stated, AVG(o.hit) AS realized
      FROM outs o
      JOIN preds p
        ON  p.run_date    =  o.run_date
        AND p.sport       =  o.sport
        AND p.stat_family =  o.stat_family
        AND p.player      IS o.player
        AND p.side        IS o.side
        AND p.line        IS o.line
      GROUP BY p.sport, p.stat_family, p.side, p.line
    `).all()
  } catch (e) {
    return { sports: {}, generatedAt: new Date().toISOString(), totalRows: 0, joinedRows: 0, error: `query-failed: ${e.message}` }
  }

  // Bucketize: sports[sport][family][side] = { lineMode, lines: { <key>: bucket }, _allLines }
  // A range mode can map several raw corpus lines into one key → weighted-merge.
  const sports = {}
  let totalRows = 0
  for (const r of rows) {
    const sport = _norm(r.sport)
    const fam   = _norm(r.stat_family)
    const side  = _norm(r.side) || "unknown"
    if (!sport || !fam) continue
    const mode     = _lineModeFor(fam)
    const lineKey  = _lineBucketKey(mode, r.line)
    const n        = Number(r.n) || 0
    const stated   = Number.isFinite(Number(r.stated))   ? Number(r.stated)   : 0
    const realized = Number.isFinite(Number(r.realized)) ? Number(r.realized) : 0
    if (!sports[sport]) sports[sport] = {}
    if (!sports[sport][fam]) sports[sport][fam] = {}
    if (!sports[sport][fam][side]) sports[sport][fam][side] = { lineMode: mode, lines: {} }
    const lines = sports[sport][fam][side].lines
    const prev  = lines[lineKey]
    if (!prev) {
      lines[lineKey] = { lineKey, n, stated, realized }
    } else {
      const tot = prev.n + n
      prev.stated   = tot > 0 ? (prev.stated   * prev.n + stated   * n) / tot : 0
      prev.realized = tot > 0 ? (prev.realized * prev.n + realized * n) / tot : 0
      prev.n        = tot
    }
    totalRows += n
  }

  // Finalize per-bucket multipliers + synthesize the per-(family,side) _allLines
  // aggregate (used by the line-HOMOGENEOUS fallback in step 5.2; surfaced now).
  for (const sport of Object.keys(sports)) {
    for (const fam of Object.keys(sports[sport])) {
      for (const side of Object.keys(sports[sport][fam])) {
        const famSide = sports[sport][fam][side]
        let an = 0, as = 0, ar = 0
        for (const lk of Object.keys(famSide.lines)) {
          const b = famSide.lines[lk]
          b.multiplier = _multiplierFromBucketLineAware(b)
          b.gapPp      = _gapPpFromBucket(b)
          b.qualifies  = b.n >= MIN_SAMPLE_LINE
          an += b.n; as += b.stated * b.n; ar += b.realized * b.n
        }
        const all = { n: an, stated: an > 0 ? as / an : 0, realized: an > 0 ? ar / an : 0 }
        all.multiplier = _multiplierFromBucketLineAware(all)
        all.gapPp      = _gapPpFromBucket(all)
        famSide._allLines = all
      }
    }
  }

  return {
    sports,
    generatedAt: new Date().toISOString(),
    totalRows,
    joinedRows: totalRows,
    minSampleLine:            MIN_SAMPLE_LINE,
    multiplierFloorLineAware: MULTIPLIER_FLOOR_LINEAWARE,
    multiplierCeiling:        MULTIPLIER_CEILING,
    rangeBucketWidth:         RANGE_BUCKET_WIDTH,
    error: null,
  }
}

function _loadLineAware() {
  const now = Date.now()
  if (_cacheLineAware && (now - _loadedAtLineAware) < CACHE_TTL_MS) return _cacheLineAware
  _cacheLineAware = _queryCorpusLineAware()
  _loadedAtLineAware = now
  return _cacheLineAware
}

function getLineAwareSnapshot() { return _loadLineAware() }

function reload() {
  _cache = null; _loadedAt = 0
  _cacheLineAware = null; _loadedAtLineAware = 0
}

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

// ── id-join family-side ladder (today's behavior) ────────────────────────────
// PRESERVED VERBATIM from the pre-5.2 getCalibrationForFamily body. Used for
//   • line == null callers (backwards-compat), and
//   • line-agnostic markers (moneyline/runline/spread/firstHR — no line dimension).
//   1) (sport, family, side) if n ≥ MIN_SAMPLE_SIDE
//   2) (sport, family) all-sides if n ≥ MIN_SAMPLE_FAMILY
//   3) null
function _getCalibrationIdJoin(sport, statFamily, side) {
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

// ── line-aware ladder (Phase Calibration-LineAware-1A, step 5.2) ─────────────
// Reads the book-agnostic per-line corpus (_loadLineAware). Ladder:
//   1) (sport, family, side, lineBucket) if n ≥ MIN_SAMPLE_LINE → use it
//   2) line-HOMOGENEOUS (range): (sport, family, side) _allLines if n ≥ MIN_SAMPLE_SIDE
//   3) line-HETEROGENEOUS (exact): NULL — never fall back to the pooled family-side.
//      That pooled aggregate is the longshot-biased number that over-suppressed the
//      easy lines; refusing it is THE load-bearing bug fix.
function _getCalibrationLineAware(sport, statFamily, side, mode, line) {
  const data = _loadLineAware()
  const sp = data?.sports?.[_norm(sport)]
  if (!sp) return null
  let famEntry = null
  for (const name of _famNames(statFamily)) {     // alias-resolve (total_bases → totalbases)
    if (sp[name]) { famEntry = sp[name]; break }
  }
  if (!famEntry) return null
  const sideKey = _norm(side) || "unknown"
  const famSide = famEntry[sideKey]
  if (!famSide) return null
  const lineKey = _lineBucketKey(mode, line)
  const b = famSide.lines ? famSide.lines[lineKey] : null
  if (b && b.n >= MIN_SAMPLE_LINE) {
    return { ...b, bucket: "line", side: sideKey, lineBucket: lineKey, lineMode: mode }
  }
  if (mode === "range" && famSide._allLines && famSide._allLines.n >= MIN_SAMPLE_SIDE) {
    return { ...famSide._allLines, bucket: "family-lineaware", side: sideKey, lineMode: mode }
  }
  return null   // heterogeneous-thin (or no data) → no dampening (multiplier 1.0)
}

/**
 * Resolve a single calibration bucket.
 *   line == null OR line-agnostic family → id-join family-side ladder (today's behavior).
 *   otherwise                            → line-aware ladder against the per-line corpus.
 * Backwards-compat: `line` is optional; any caller omitting it gets the id-join ladder.
 * Returns { n, stated, realized, gapPp, multiplier, bucket, side, ... } or null.
 */
function getCalibrationForFamily(sport, statFamily, side, line = null) {
  const mode = _lineModeFor(statFamily)
  // 5.3 kill-switch (LINEAWARE_ENABLED): when disabled, ignore line → pre-5.2 id-join.
  // Trap 1 (num(null)=0): test `line == null`, NOT `!line` — `!line` would also treat
  // a (hypothetical) line 0 as absent. `== null` catches only null/undefined.
  if (!LINEAWARE_ENABLED || line == null || mode === "agnostic") {
    return _getCalibrationIdJoin(sport, statFamily, side)
  }
  return _getCalibrationLineAware(sport, statFamily, side, mode, line)
}

function dampenModelProb(modelProb, sport, statFamily, side, line = null) {
  const mp = Number(modelProb)
  if (!Number.isFinite(mp) || mp <= 0) return mp
  // G1 STEP 1: when MLB_CALIB_LIVE is ON, the MLB multiplier BECOMES the isotonic
  // remap (runbook §STEP 1). OFF ⇒ this branch is skipped ⇒ the realized/stated
  // multiplier below runs exactly as pre-G1 (byte-identical). MLB-only.
  if (MLB_CALIB_LIVE && _g1CalibrateModelProb && _norm(sport) === "mlb") {
    const _calP = _g1CalibrateModelProb(mp, statFamily, { side })
    return Number.isFinite(_calP) ? Math.max(0, Math.min(1, _calP)) : mp
  }
  const cal = getCalibrationForFamily(sport, statFamily, side, line)
  if (!cal || !Number.isFinite(cal.multiplier)) return mp
  const d = mp * cal.multiplier
  return Math.max(0, Math.min(1, d))
}

function shouldShowCalibrationBadge(sport, statFamily, side, line = null) {
  const cal = getCalibrationForFamily(sport, statFamily, side, line)
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
  // 2026-07-01 G1 STEP 1 anti-double-calibration guard: when MLB_CALIB_LIVE is ON,
  // MLB cluster picks are ALREADY isotonic-calibrated at scoring (buildMlbPropClusters
  // stamps calibVersion; modelProb/edge already reflect the remap). Re-dampening here
  // would apply the remap a SECOND time on the serve path. Skip. OFF ⇒ scoring never
  // stamps calibVersion ⇒ this guard never fires ⇒ byte-identical to pre-G1.
  if (MLB_CALIB_LIVE && pick.calibVersion) return pick
  const sport = pick.sport
  const fam = pick.statFamily || pick.propType
  const side = pick.side  // per-side asymmetry: UNDER 48.7% / OVER 25.5% on n=666 corpus
  // Phase Calibration-LineAware-1A step 5.2: thread the prop line into the dampener.
  // Trap 1 (num(null)=0): guard `pick.line == null` BEFORE Number() so a line-less
  // marker stays null (→ id-join family-side path) instead of collapsing to line 0.
  let line = null
  if (pick.line != null) {
    const L = Number(pick.line)
    if (Number.isFinite(L)) line = L
  }
  const raw = Number(pick.modelProb)
  const dampened = dampenModelProb(raw, sport, fam, side, line)
  if (dampened === raw) return pick
  pick.modelProbRaw = raw
  pick.modelProb = Math.round(dampened * 10000) / 10000
  const impliedP = Number(pick.impliedProb)
  if (Number.isFinite(impliedP)) {
    pick.edgeRaw = pick.edge
    pick.edge = Math.round((dampened - impliedP) * 10000) / 10000
  }
  if (shouldShowCalibrationBadge(sport, fam, side, line)) {
    pick.calibration = getCalibrationForFamily(sport, fam, side, line)
  }
  return pick
}

module.exports = {
  dampenModelProb,
  getCalibrationForFamily,
  shouldShowCalibrationBadge,
  getCalibrationSnapshot,
  getLineAwareSnapshot,   // Phase Calibration-LineAware-1A (parallel corpus; not consumed until 5.2)
  getLastError,
  applyCalibrationDampener,
  reload,
  // exported for tests/diagnostics
  _famNames,
  _lineModeFor,
  _lineBucketKey,
  _constants: {
    MIN_SAMPLE_SIDE,
    MIN_SAMPLE_FAMILY,
    MULTIPLIER_FLOOR,
    MULTIPLIER_CEILING,
    MIN_BADGE_GAP_PP,
    CACHE_TTL_MS,
    MIN_SAMPLE_LINE,
    MULTIPLIER_FLOOR_LINEAWARE,
    RANGE_BUCKET_WIDTH,
    DEFAULT_LINE_MODE,
    LINEAWARE_ENABLED,   // Phase Calibration-LineAware-1A 5.3 kill-switch (read at module load)
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
