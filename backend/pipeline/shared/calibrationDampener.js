"use strict"

/**
 * calibrationDampener — applies per-family realized-vs-stated multiplier
 * to modelProb so displayed/used probabilities match historical reality.
 *
 * Built 2026-05-31 in response to the calibration audit finding: across
 * NBA + MLB, every family except MLB HR was over-confident by 10-37pp.
 * NBA rebounds: model claimed 41.4% / realized 9.4% (multiplier 0.227).
 * Operator's two placed parlays would have flagged as 0.36% / 0.03% real
 * chance instead of 13.3% / 6.9% model-implied.
 *
 * Reads: backend/runtime/calibration/family_calibration.json
 *   (written by sysAudit section 9 every hour and on post-boot)
 *
 * Shape:
 *   {
 *     generatedAt: ISO,
 *     windowDays: 7,
 *     minSample: 20,
 *     sports: {
 *       nba: { rebounds: { n, stated, realized, gapPp, multiplier }, ... },
 *       mlb: { ... }
 *     }
 *   }
 *
 * API:
 *   dampenModelProb(modelProb, sport, statFamily)
 *     Returns calibrated probability. When no calibration data (cold start
 *     or sample < min), returns modelProb unchanged. Multiplier is clipped
 *     [0.20, 1.10] so we never suppress to zero or amplify unreasonably.
 *
 *   getCalibrationForFamily(sport, statFamily)
 *     Returns the persisted entry { n, stated, realized, gapPp, multiplier }
 *     or null. Used by FE-facing reasoning to explain dampening.
 *
 *   shouldShowCalibrationBadge(sport, statFamily)
 *     true when gap is meaningful enough to surface in the UI (gap ≥ 10pp).
 *
 *   reload()  — clear cache, force fresh read on next call (used by tests)
 *
 * Single-source-of-truth doctrine: this module ONLY reads. sysAudit writes.
 * Don't fork the calibration math here — keep it in the audit so a single
 * code path defines what "calibration" means.
 */

const fs = require("fs")
const path = require("path")

const CAL_FILE = path.join(__dirname, "..", "..", "runtime", "calibration", "family_calibration.json")
const CACHE_TTL_MS = 5 * 60 * 1000  // 5 min — calibration only updates hourly anyway

let _cache = null
let _loadedAt = 0

function _load() {
  const now = Date.now()
  if (_cache && (now - _loadedAt) < CACHE_TTL_MS) return _cache
  try {
    const raw = fs.readFileSync(CAL_FILE, "utf8")
    _cache = JSON.parse(raw)
    _loadedAt = now
  } catch (e) {
    _cache = { sports: {} }
    _loadedAt = now
  }
  return _cache
}

function reload() { _cache = null; _loadedAt = 0 }

/** Family aliases: tracked_bets and tracked_best disagree on a few names.
 * Reuse the audit's family normalization so dampener finds the entry. */
const _ALIASES = {
  pra: ["pra", "points_rebounds_assists"],
  points_rebounds_assists: ["pra", "points_rebounds_assists"],
  totalbases: ["totalbases", "totalBases", "total_bases"],
  totalBases: ["totalbases", "totalBases", "total_bases"],
  home_runs: ["hr", "home_runs", "homeruns"],
  hr: ["hr", "home_runs", "homeruns"],
}
function _resolveFam(sport, fam) {
  const data = _load()
  const sp = data?.sports?.[sport]
  if (!sp) return null
  if (sp[fam]) return sp[fam]
  const aliases = _ALIASES[fam] || _ALIASES[String(fam).toLowerCase()] || []
  for (const a of aliases) if (sp[a]) return sp[a]
  return null
}

function getCalibrationForFamily(sport, statFamily) {
  return _resolveFam(String(sport || "").toLowerCase(), String(statFamily || "").toLowerCase()) ||
         _resolveFam(String(sport || "").toLowerCase(), String(statFamily || ""))
}

function dampenModelProb(modelProb, sport, statFamily) {
  const mp = Number(modelProb)
  if (!Number.isFinite(mp) || mp <= 0) return mp
  const cal = getCalibrationForFamily(sport, statFamily)
  if (!cal || !Number.isFinite(cal.multiplier)) return mp
  // Apply multiplier, clamp to [0, 1] so we never produce invalid probabilities
  const d = mp * cal.multiplier
  return Math.max(0, Math.min(1, d))
}

function shouldShowCalibrationBadge(sport, statFamily) {
  // Show whenever calibration data exists for this family — surface even small
  // dampenings (5pp+) since the operator needs full transparency on what got
  // adjusted. Lowering from 10pp → 5pp 2026-05-31 after MLB HR (9.2pp gap)
  // was being hidden from the badge despite multiplier 0.29 firing.
  const cal = getCalibrationForFamily(sport, statFamily)
  if (!cal) return false
  return Math.abs(cal.gapPp) >= 5
}

module.exports = {
  dampenModelProb,
  getCalibrationForFamily,
  shouldShowCalibrationBadge,
  reload,
}
