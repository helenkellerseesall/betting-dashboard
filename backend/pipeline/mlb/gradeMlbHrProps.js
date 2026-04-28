"use strict"

const fs = require("fs")
const path = require("path")

// Prefer native fetch (Node 18+); fall back to node-fetch if present.
// eslint-disable-next-line no-undef
const fetchFn = (typeof fetch === "function" ? fetch : null) || (() => {
  try {
    // eslint-disable-next-line global-require
    return require("node-fetch")
  } catch {
    return null
  }
})()

function getToday() {
  return new Date().toISOString().split("T")[0]
}

async function fetchGames(date) {
  if (!fetchFn) throw new Error("fetch not available (native fetch or node-fetch required)")
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`
  const res = await fetchFn(url)
  const data = await res.json()
  return data.dates?.[0]?.games || []
}

async function fetchGameBox(gamePk) {
  if (!fetchFn) throw new Error("fetch not available (native fetch or node-fetch required)")
  const url = `https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`
  const res = await fetchFn(url)
  return await res.json()
}

function extractHrHitters(box) {
  const hitters = []

  const teams = [box?.teams?.home?.players, box?.teams?.away?.players].filter(Boolean)

  teams.forEach((team) => {
    Object.values(team).forEach((p) => {
      const stats = p.stats?.batting
      if (stats && stats.homeRuns > 0) {
        hitters.push(p.person.fullName.toLowerCase())
      }
    })
  })

  return hitters
}

async function gradeMlbHrProps() {
  const today = getToday()

  const trackedPath = path.join(__dirname, "../../runtime/tracking", `tracked_props_${today}.json`)
  const gradedPath = path.join(__dirname, "../../runtime/tracking", `graded_props_${today}.json`)

  if (!fs.existsSync(trackedPath)) {
    console.log("[GRADE] No tracked props found")
    return
  }

  const tracked = JSON.parse(fs.readFileSync(trackedPath, "utf8"))
  const games = await fetchGames(today)

  console.log(`[GRADE] ${games.length} games checked`)

  const allFinal = games.every((g) => g?.status?.detailedState === "Final")

  if (!allFinal) {
    console.log("[GRADE BLOCKED] Games not finished yet")
    return
  }

  let hrHitters = []

  for (const g of games) {
    const box = await fetchGameBox(g.gamePk)
    const hitters = extractHrHitters(box)
    hrHitters.push(...hitters)
  }

  const graded = (Array.isArray(tracked) ? tracked : []).map((p) => {
    const hit = hrHitters.includes(String(p?.player || "").toLowerCase())

    return {
      ...p,
      result: hit ? "HIT" : "MISS",
    }
  })

  fs.writeFileSync(gradedPath, JSON.stringify(graded, null, 2))

  console.log(`[GRADE] ${graded.length} props graded`)
}

module.exports = { gradeMlbHrProps }

