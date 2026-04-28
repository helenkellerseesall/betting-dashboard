"use strict"

const fs = require("fs")
const path = require("path")
const axios = require("axios")

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function getEventId(row) {
  return row?.eventId || row?.event_id || row?.gameId || row?.game_id || null
}

function readSnapshot() {
  const snapPath = path.join(__dirname, "../../snapshot-mlb.json")
  if (!fs.existsSync(snapPath)) {
    throw new Error(`snapshot file missing: ${snapPath}`)
  }
  const raw = JSON.parse(fs.readFileSync(snapPath, "utf8"))
  const events = raw?.data?.events || raw?.events || []
  const rows = raw?.data?.rows || raw?.rows || []
  return {
    events: Array.isArray(events) ? events : [],
    rows: Array.isArray(rows) ? rows : [],
  }
}

async function geocodeHomeTeam(homeTeam) {
  const q1 = String(homeTeam || "").trim()
  const q2 = q1.split(" ").slice(0, -1).join(" ").trim() // drop nickname as fallback
  const queries = [q1, q2].filter(Boolean)

  for (const name of queries) {
    try {
      const url = "https://geocoding-api.open-meteo.com/v1/search"
      const res = await axios.get(url, {
        params: {
          name,
          count: 1,
          language: "en",
          format: "json",
        },
        timeout: 15000,
      })
      const hit = res?.data?.results?.[0]
      const lat = toNum(hit?.latitude)
      const lon = toNum(hit?.longitude)
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, nameUsed: name }
    } catch {
      // continue
    }
  }

  return null
}

function pickClosestHourIndex(times, targetIso) {
  const targetMs = new Date(targetIso).getTime()
  if (!Number.isFinite(targetMs)) return -1
  let bestIdx = -1
  let bestDist = Infinity
  for (let i = 0; i < times.length; i++) {
    const t = times[i]
    const ms = new Date(t).getTime()
    if (!Number.isFinite(ms)) continue
    const d = Math.abs(ms - targetMs)
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  return bestIdx
}

async function fetchForecastAtGameTime({ lat, lon, gameTimeIso }) {
  const url = "https://api.open-meteo.com/v1/forecast"
  const res = await axios.get(url, {
    params: {
      latitude: lat,
      longitude: lon,
      hourly: "temperature_2m,wind_speed_10m,wind_direction_10m",
      timezone: "UTC",
    },
    timeout: 20000,
  })

  const hourly = res?.data?.hourly || {}
  const times = Array.isArray(hourly?.time) ? hourly.time : []
  const temps = Array.isArray(hourly?.temperature_2m) ? hourly.temperature_2m : []
  const windSpeeds = Array.isArray(hourly?.wind_speed_10m) ? hourly.wind_speed_10m : []
  const windDirs = Array.isArray(hourly?.wind_direction_10m) ? hourly.wind_direction_10m : []

  const idx = pickClosestHourIndex(times, gameTimeIso)
  if (idx < 0) return null

  return {
    temperature: toNum(temps[idx]),
    windSpeed: toNum(windSpeeds[idx]),
    windDirectionDeg: toNum(windDirs[idx]),
    forecastTimeUtc: times[idx] || null,
  }
}

async function buildMlbWeather() {
  const { events, rows } = readSnapshot()

  const eventIds = [
    ...new Set(
      rows
        .map((r) => r?.eventId || r?.event_id || r?.gameId || r?.game_id)
        .filter(Boolean)
        .map(String)
    ),
  ]

  const eventMetaById = new Map()
  for (const e of events) {
    const id = e?.eventId || e?.id || e?.event_id
    if (!id) continue
    const homeTeam = e?.homeTeam || e?.home_team || e?.home || null
    const gameTime = e?.gameTime || e?.startTime || e?.commence_time || e?.gameDate || null
    eventMetaById.set(String(id), { homeTeam, gameTime })
  }

  const weatherMap = {}
  for (const eventId of eventIds) {
    try {
      const meta = eventMetaById.get(String(eventId)) || { homeTeam: null, gameTime: null }
      const homeTeam = meta.homeTeam
      const gameTime = meta.gameTime

      if (!homeTeam || !gameTime) throw new Error("missing homeTeam or gameTime")

      const geo = await geocodeHomeTeam(homeTeam)
      if (!geo) throw new Error("geocode_failed")

      const wx = await fetchForecastAtGameTime({ lat: geo.lat, lon: geo.lon, gameTimeIso: gameTime })
      if (!wx) throw new Error("forecast_failed")

      weatherMap[String(eventId)] = {
        windOut: false,
        windIn: false,
        windSpeed: wx.windSpeed,
        temperature: wx.temperature,
        temp: wx.temperature,
        windDir: "neutral",
        windDirectionDeg: wx.windDirectionDeg,
        forecastTimeUtc: wx.forecastTimeUtc,
        _meta: { homeTeam, geocode: { lat: geo.lat, lon: geo.lon, nameUsed: geo.nameUsed } },
      }
    } catch (e) {
      // fallback (CRITICAL)
      weatherMap[String(eventId)] = {
        windOut: false,
        windIn: false,
        windSpeed: 0,
        temperature: 70,
        temp: 70,
        windDir: "neutral",
      }
    }
  }

  console.log("[WEATHER COVERAGE]", Object.keys(weatherMap).length, eventIds.length)
  if (Object.keys(weatherMap).length !== eventIds.length) {
    console.log("[WEATHER FAIL] mismatch coverage")
  }

  const filePath = path.join(__dirname, "../../data/mlbGameWeather.json")
  fs.writeFileSync(filePath, JSON.stringify(weatherMap, null, 2))
  console.log("[MLB WEATHER] wrote", Object.keys(weatherMap).length, "events to", filePath)
}

if (require.main === module) {
  buildMlbWeather().catch((e) => {
    console.error("[MLB WEATHER ERROR]", e?.message || e)
    process.exit(1)
  })
}

module.exports = { buildMlbWeather }

