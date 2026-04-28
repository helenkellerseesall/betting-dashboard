"use strict"

const fs = require("fs")
const path = require("path")

function getToday() {
  return new Date().toISOString().split("T")[0]
}

function trackMlbHrProps(hrPredictionToday) {
  try {
    if (!hrPredictionToday) return

    const today = getToday()
    const filePath = path.join(__dirname, "../../runtime/tracking", `tracked_props_${today}.json`)

    const mostLikely = Array.isArray(hrPredictionToday?.mostLikelyHr) ? hrPredictionToday.mostLikelyHr : []
    const props = mostLikely.map((p) => ({
      player: p.player,
      team: p.team,
      eventId: p.eventId,
      odds: p.odds,
      hrScore: p.hrScore,
      powerScore: p.powerScore,
      weather: p._weatherScore,
      park: p._parkScore,
      tag: p.tag,
      timestamp: new Date().toISOString(),
    }))

    // async write (non-blocking)
    fs.writeFile(filePath, JSON.stringify(props, null, 2), (err) => {
      if (err) console.error("[TRACK ERROR]", err)
    })

    console.log(`[TRACK] Saved ${props.length} HR props`)
  } catch (e) {
    console.error("[TRACK FAIL]", e)
  }
}

module.exports = { trackMlbHrProps }

