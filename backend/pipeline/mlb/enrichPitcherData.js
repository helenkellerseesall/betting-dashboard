"use strict"

const fetch = global.fetch

async function fetchProbablePitchers(date) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=probablePitcher`
  const res = await fetch(url)
  const data = await res.json()

  const games = data.dates?.[0]?.games || []

  const pitcherMap = {}

  for (const g of games) {
    const homePitcher = g?.teams?.home?.probablePitcher
    const awayPitcher = g?.teams?.away?.probablePitcher
    const homeTeam = g?.teams?.home?.team?.name
    const awayTeam = g?.teams?.away?.team?.name
    if (!homeTeam || !awayTeam) continue

    const key = `${homeTeam}__${awayTeam}`
    pitcherMap[key] = {
      homeTeam,
      awayTeam,
      homePitcher: homePitcher?.fullName,
      awayPitcher: awayPitcher?.fullName,
    }
  }

  return pitcherMap
}

module.exports = { fetchProbablePitchers }

