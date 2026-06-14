"use strict"

/**
 * mlbMarginalCalibration.js — Phase T2-MarginalCalib-1A (2026-06-14)
 *
 * SHADOW marginal calibration for MLB modelProb. Maps the raw (overconfident,
 * ~+16pp) modelProb to a calibrated probability via a monotone isotonic map
 * (backend/config/mlbMarginalCalibration.json, fit from the graded ledger by
 * deriveMlbMarginalCalibration.js). Method primitive: backend/pipeline/shared/
 * isotonicCalibration.js (the canonical calibration math).
 *
 * SHADOW ONLY (v1): pure, computes modelProbCalibrated ALONGSIDE modelProb; feeds
 * NOTHING in scoring/edge/tier. Does NOT modify the PRESERVED calibrationDampener
 * (the live integration — extend the dampener + wire onto the cluster path — is a
 * SCORING change, gated by the R2 freeze + separate operator approval).
 *
 * Lookup ladder: families[fam].buckets[bucket] → families[fam] → global → identity.
 * Shrink-to-identity on low-n maps so thin cells don't overcorrect.
 *
 * Kill-switch: MLB_MARGINAL_CALIB env, read once at load (MLB_NB_LADDER pattern).
 * Default ON; exact string "0" = OFF (calibrateModelProb returns null).
 */

const fs = require("fs")
const path = require("path")
const { predictIsotonic } = require("../shared/isotonicCalibration")

const ENABLED = (process.env.MLB_MARGINAL_CALIB ?? "1") !== "0"
console.log(`[MLB-MARGINAL-CALIB-BOOT] ${ENABLED ? "ON" : "OFF — MLB_MARGINAL_CALIB=0"}`)

const MAPS_PATH = path.join(__dirname, "..", "..", "config", "mlbMarginalCalibration.json")
let MAPS = { global: null, families: {} }
try { MAPS = JSON.parse(fs.readFileSync(MAPS_PATH, "utf8")) } catch (e) {
  console.log(`[MLB-MARGINAL-CALIB-BOOT] maps unreadable (${e && e.code ? e.code : e}) — calibrate falls back to identity`)
}

const N_FULL = 300       // map weight reaches full at n≥N_FULL; below → shrink to raw
const PEPS = 1e-4
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }

function bucketOf(oddsAmerican) {
  const o = Number(oddsAmerican)
  if (!Number.isFinite(o)) return null
  if (o <= -150) return "heavy_fav"
  if (o < 100) return "mod_fav"
  if (o < 200) return "mod_dog"
  return "longshot"
}

// Pick the most-specific available map for (family, bucket).
function pickMap(family, bucket) {
  const fam = MAPS.families ? MAPS.families[family] : null
  if (fam && bucket && fam.buckets && fam.buckets[bucket]) return { map: fam.buckets[bucket], source: "family_bucket" }
  if (fam && Array.isArray(fam.knots)) return { map: fam, source: "family" }
  if (MAPS.global && Array.isArray(MAPS.global.knots)) return { map: MAPS.global, source: "global" }
  return { map: null, source: "identity" }
}

/**
 * calibrateDetail(modelProb, family, { bucket, oddsAmerican }) →
 *   { calibrated, raw, source, n, weight } | null (OFF / invalid input)
 * Marginal-agnostic: takes the raw modelProb, never recomputes it.
 */
function calibrateDetail(modelProb, family, opts = {}) {
  if (!ENABLED) return null
  const raw = num(modelProb)
  if (raw == null) return null
  const bucket = opts.bucket || bucketOf(opts.oddsAmerican)
  const { map, source } = pickMap(family, bucket)
  if (!map) return { calibrated: raw, raw, source: "identity", n: 0, weight: 0 }
  const iso = predictIsotonic(map, raw)
  const n = Number(map.n) || 0
  const w = Math.max(0, Math.min(1, n / N_FULL))         // shrink-to-identity on low n
  let cal = w * iso + (1 - w) * raw
  if (cal < PEPS) cal = PEPS
  if (cal > 1 - PEPS) cal = 1 - PEPS
  return { calibrated: cal, raw, source, n, weight: +w.toFixed(4) }
}

/** calibrateModelProb → number (calibrated prob) or null. Convenience wrapper. */
function calibrateModelProb(modelProb, family, opts = {}) {
  const d = calibrateDetail(modelProb, family, opts)
  return d ? d.calibrated : null
}

module.exports = { calibrateModelProb, calibrateDetail, bucketOf, _enabled: ENABLED, _mapsPath: MAPS_PATH }
