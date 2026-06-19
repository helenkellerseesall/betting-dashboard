#!/usr/bin/env node
"use strict"
/**
 * deriveMlbAirDensity.js — NEW air-density STAGING ingest (2026-06-18, CB; ingestion #28).
 *
 * For each current-slate park: pull station ELEVATION + surface pressure from Open-Meteo (the SAME
 * vendor already wired in refreshMlbWeatherForSlate.js — no new vendor, no static elevation guess),
 * then compute moist-air DENSITY (kg/m³) + DENSITY ALTITUDE (ft) from temperature + relative
 * humidity + pressure. Writes a NEW staging file backend/data/mlbAirDensity.json with ZERO live
 * consumer. Leaves the live weather ingest (refreshMlbWeatherForSlate.js) and park context
 * (deriveMlbParkContext.js — altitudeFt stays null) UNTOUCHED; both are scoring-adjacent and frozen.
 * Wiring air-density into scoring is a separate post-freeze + forward-CLV-gated task. (Law 1: new
 * staging owner; altitudeFt/airDensity/densityAltitude are currently read by nothing — verified.)
 *
 * FORMULAS (cited):
 *   - Saturation vapor pressure: Arden Buck / Tetens — Psat = 610.94·exp(17.625·t/(t+243.04)) Pa
 *     (Buck 1981, J. Appl. Meteorol.).
 *   - Moist-air density (partial pressures): ρ = Pd/(Rd·T) + Pv/(Rv·T), Pv = (RH/100)·Psat,
 *     Pd = P − Pv, Rd=287.058, Rv=461.495 J/(kg·K), T in K. (CIPM-2007 / standard humid-air density.)
 *   - Density altitude: DA = 145442·(1 − (ρ/ρ0)^(1/4.2559)) ft, ρ0=1.225 kg/m³ (ISA sea level).
 *   - Pressure fallback (if surface_pressure missing): ISA barometric P = 101325·(1−2.25577e-5·h)^5.25588, h=m.
 *
 * ANTI-FAB: any missing input → null, never invented. Season/slate from slateDate.js (ET year).
 *
 *   node backend/scripts/deriveMlbAirDensity.js 2>&1 | tee .scratch/airdensity_verify.txt
 *   (Open-Meteo is allowlist-blocked from the sandbox → run on the operator machine.)
 */
const axios = require("axios")
const fs = require("fs")
const path = require("path")
const { currentSlateDateEt } = require("../pipeline/shared/slateDate")

const SEASON = currentSlateDateEt().slice(0, 4)
const WEATHER_FILE = path.join(__dirname, "..", "data", "mlbGameWeather.json")
const OUT = path.join(__dirname, "..", "data", "mlbAirDensity.json")
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

const Rd = 287.058, Rv = 461.495, RHO0 = 1.225
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null)
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000)
const fToC = (f) => (f == null ? null : (Number(f) - 32) * 5 / 9)

// Arden Buck / Tetens saturation vapor pressure (Pa) at t °C.
function satVaporPressurePa(tC) { return 610.94 * Math.exp((17.625 * tC) / (tC + 243.04)) }

// Moist-air density (kg/m³) from t°C, RH%, pressure Pa. null if any input missing.
function moistAirDensity(tC, rhPct, pPa) {
  if (tC == null || rhPct == null || pPa == null) return null
  const T = tC + 273.15
  const Pv = (rhPct / 100) * satVaporPressurePa(tC)
  const Pd = pPa - Pv
  if (!(T > 0) || !(Pd > 0)) return null
  return Pd / (Rd * T) + Pv / (Rv * T)
}
// Density altitude (ft) from density (kg/m³).
function densityAltitudeFt(rho) {
  if (rho == null || !(rho > 0)) return null
  return 145442 * (1 - Math.pow(rho / RHO0, 1 / 4.2559))
}
// ISA barometric pressure (Pa) from elevation (m) — fallback when surface_pressure is absent.
function barometricPa(elevM) {
  if (elevM == null) return null
  return 101325 * Math.pow(1 - 2.25577e-5 * elevM, 5.25588)
}

function pickClosestHourIndex(times, targetIso) {
  const t = new Date(targetIso).getTime()
  if (!Number.isFinite(t) || !Array.isArray(times)) return 0
  let bi = 0, bd = Infinity
  for (let i = 0; i < times.length; i++) { const d = Math.abs(new Date(times[i]).getTime() - t); if (d < bd) { bd = d; bi = i } }
  return bi
}

async function fetchElevAndConditions(lat, lon, targetIso) {
  const res = await axios.get(FORECAST_URL, {
    params: { latitude: lat, longitude: lon, hourly: "temperature_2m,relative_humidity_2m,surface_pressure", timezone: "UTC" },
    timeout: 15000, validateStatus: () => true,
  })
  if (res.status !== 200 || !res.data) return { __error: `status ${res.status}` }
  const elevM = num(res.data.elevation)
  const h = res.data.hourly || {}
  const idx = pickClosestHourIndex(h.time, targetIso)
  return {
    elevationM: elevM,
    temperatureC: num(h.temperature_2m?.[idx]),
    humidityPct: num(h.relative_humidity_2m?.[idx]),
    surfacePressureHpa: num(h.surface_pressure?.[idx]),
    hourUtc: h.time?.[idx] || null,
  }
}

async function main() {
  console.log("[air-density] season (ET, from slateDate):", SEASON)
  if (!fs.existsSync(WEATHER_FILE)) { console.error("[air-density] missing", WEATHER_FILE, "— run the weather refresh first."); process.exit(1) }
  const wx = JSON.parse(fs.readFileSync(WEATHER_FILE, "utf8"))
  const eventIds = Object.keys(wx)
  console.log(`[air-density] events in mlbGameWeather.json: ${eventIds.length}`)

  const out = {}
  let netFail = 0
  for (const eid of eventIds) {
    const e = wx[eid] || {}
    const geo = e?._meta?.geocode || {}
    const lat = num(geo.lat), lon = num(geo.lon)
    const homeTeam = e?._meta?.homeTeam || null
    if (lat == null || lon == null) { out[eid] = { homeTeam, error: "no_geocode", airDensity: null, season: SEASON }; continue }
    let cond
    try { cond = await fetchElevAndConditions(lat, lon, e.forecastTimeUtc || new Date().toISOString()) } catch (err) { cond = { __error: err?.code || err.message } }
    if (cond.__error) { netFail++; out[eid] = { homeTeam, lat, lon, error: cond.__error, airDensity: null, season: SEASON }; continue }
    const elevM = cond.elevationM
    const tC = cond.temperatureC
    const rh = cond.humidityPct
    // pressure: prefer measured surface_pressure (hPa→Pa); else ISA barometric from elevation.
    let pPa = cond.surfacePressureHpa != null ? cond.surfacePressureHpa * 100 : barometricPa(elevM)
    const pressureSource = cond.surfacePressureHpa != null ? "surface_pressure" : (elevM != null ? "barometric_from_elevation" : null)
    const rho = moistAirDensity(tC, rh, pPa)
    out[eid] = {
      homeTeam,
      elevationFt: elevM != null ? r4(elevM * 3.28084) : null,
      temperatureC: r4(tC),
      humidityPct: rh,
      surfacePressureHpa: cond.surfacePressureHpa,
      pressureSource,
      airDensity: r4(rho),                 // kg/m³ — LOWER = thinner air = ball carries
      densityAltitudeFt: r4(densityAltitudeFt(rho)),  // HIGHER = thinner
      hourUtc: cond.hourUtc,
      source: "open_meteo(elevation+surface_pressure)+moist_air_formula",
      season: SEASON,
      derivedAt: new Date().toISOString(),
    }
  }
  const rows = Object.entries(out).filter(([, v]) => v.airDensity != null).map(([eid, v]) => ({ eid, ...v }))
  // DON'T clobber a good prior file on total network failure (e.g. Open-Meteo unreachable / blip):
  // if nothing computed, leave the existing staging file intact and exit non-zero (visible in the
  // scheduler log). Only overwrite when we actually have ≥1 real airDensity. (Matches the other
  // derivations, which exit before writing on a 403.)
  if (rows.length === 0) {
    console.error(`[air-density] 0/${eventIds.length} parks computed (net fails: ${netFail}) — NOT overwriting ${OUT} (preserving prior good staging). Likely Open-Meteo unreachable from this host.`)
    process.exit(1)
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2))

  console.log(`\n[air-density] computed airDensity for ${rows.length}/${eventIds.length} parks  (net fails: ${netFail})`)
  if (netFail === eventIds.length) {
    console.error("[air-density] ALL fetches failed — Open-Meteo likely allowlist-blocked from this host. Run on the operator machine.")
  }
  const sorted = [...rows].sort((a, b) => a.airDensity - b.airDensity)
  console.log("[air-density] SANITY — lowest density (thinnest air, ball carries; Coors should be here if CO plays):")
  for (const r of sorted.slice(0, 4)) console.log(`  ${String(r.homeTeam).padEnd(24)} elev=${r.elevationFt}ft airDensity=${r.airDensity} densityAlt=${r.densityAltitudeFt}ft (${r.pressureSource})`)
  console.log("[air-density] highest density (sea-level, heavier air):")
  for (const r of sorted.slice(-3)) console.log(`  ${String(r.homeTeam).padEnd(24)} elev=${r.elevationFt}ft airDensity=${r.airDensity} densityAlt=${r.densityAltitudeFt}ft (${r.pressureSource})`)
  console.log("[air-density] wrote", OUT, "— STAGING, zero live consumer by design (wire post-freeze)")
  console.log("[air-density] SUCCESS BAR: airDensity populated for slate parks, SANE (Coors lowest density / highest densityAltitude; sea-level parks higher density).")
}

module.exports = { satVaporPressurePa, moistAirDensity, densityAltitudeFt, barometricPa, SEASON }
if (require.main === module) main()
