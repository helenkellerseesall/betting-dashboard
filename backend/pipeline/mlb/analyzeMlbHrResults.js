"use strict"

const fs = require("fs")
const path = require("path")

module.exports = function analyzeMlbHrResults(date) {
  const filePath = path.join(
    __dirname,
    "../../runtime/tracking",
    `hr_slips_${date}.json`
  )

  if (!fs.existsSync(filePath)) {
    console.log("[HR ANALYZER] No file found")
    return
  }

  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"))

  const allPlayers = []

  Object.values(data.results || {}).forEach((group) => {
    group.forEach((slip) => {
      slip.forEach((p) => {
        allPlayers.push(p)
      })
    })
  })

  let weatherHits = 0
  let weatherMisses = 0

  let parkHits = 0
  let parkMisses = 0

  let highScoreHits = 0
  let highScoreMisses = 0

  allPlayers.forEach((p) => {
    const isHit = p.result === "HIT"

    // WEATHER
    if (p._weatherScore && p._weatherScore > 0) {
      if (isHit) weatherHits++
      else weatherMisses++
    }

    // PARK
    if (p._parkScore && p._parkScore > 0) {
      if (isHit) parkHits++
      else parkMisses++
    }

    // HIGH SCORE (top tier)
    if (p.hrScore >= 15) {
      if (isHit) highScoreHits++
      else highScoreMisses++
    }
  })

  const analysis = {
    weather: {
      hits: weatherHits,
      misses: weatherMisses,
    },
    park: {
      hits: parkHits,
      misses: parkMisses,
    },
    highScore: {
      hits: highScoreHits,
      misses: highScoreMisses,
    },
  }

  console.log("[HR ANALYSIS]", JSON.stringify(analysis, null, 2))

  return analysis
}
