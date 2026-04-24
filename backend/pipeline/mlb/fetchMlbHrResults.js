"use strict"

const axios = require("axios")

module.exports = async function fetchMlbHrResults(date) {
  try {
    const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`

    const res = await axios.get(url)

    const games = res.data.dates?.[0]?.games || []

    const hrPlayers = []
    const seen = new Set()

    for (const game of games) {
      const gamePk = game?.gamePk
      if (!gamePk) continue

      let box = null
      try {
        const boxRes = await axios.get(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`)
        box = boxRes?.data || null
      } catch {
        box = null
      }

      const players = box?.teams
      if (!players) continue

      ;["home", "away"].forEach((side) => {
        const roster = players[side]?.players || {}

        Object.values(roster).forEach((p) => {
          const stats = p.stats?.batting
          const hr = Number(stats?.homeRuns)
          if (Number.isFinite(hr) && hr > 0) {
            const name = p?.person?.fullName
            if (name && !seen.has(name)) {
              seen.add(name)
              hrPlayers.push(name)
            }
          }
        })
      })
    }

    return hrPlayers
  } catch (err) {
    console.error("[HR FETCH ERROR]", err.message)
    return []
  }
}

