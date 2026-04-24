"use strict"

const fs = require("fs")
const path = require("path")

module.exports = function gradeMlbHrSlips({ date, actualHrPlayers = [] }) {
  const filePath = path.join(__dirname, "../../runtime/tracking", `hr_slips_${date}.json`)

  if (!fs.existsSync(filePath)) {
    console.log("[HR GRADER] No file found for date:", date)
    return
  }

  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"))

  const gradedSlips = {}

  Object.entries(data.slips || {}).forEach(([key, slipGroup]) => {
    gradedSlips[key] = (slipGroup || []).map((slip) => {
      return (slip || []).map((player) => {
        const hit = actualHrPlayers.includes(player.player)

        return {
          ...player,
          result: hit ? "HIT" : "MISS",
        }
      })
    })
  })

  data.results = gradedSlips

  // Summary
  let total = 0
  let hits = 0

  Object.values(gradedSlips).forEach((group) => {
    group.forEach((slip) => {
      slip.forEach((p) => {
        total++
        if (p.result === "HIT") hits++
      })
    })
  })

  data.summary = {
    totalPicks: total,
    hits,
    misses: total - hits,
    hitRate: total > 0 ? (hits / total).toFixed(3) : 0,
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))

  console.log("[HR GRADER] Completed for", date)
}

