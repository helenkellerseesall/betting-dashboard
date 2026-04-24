"use strict"

const fs = require("fs")
const path = require("path")

module.exports = function trackMlbHrSlips({ hrSlips, date }) {
  if (!hrSlips) return

  const filePath = path.join(__dirname, "../../runtime/tracking", `hr_slips_${date}.json`)

  const payload = {
    date,
    createdAt: new Date().toISOString(),
    slips: hrSlips,
    results: null, // filled later
    summary: {
      totalSlips: Object.keys(hrSlips || {}).length,
      hits: 0,
      misses: 0,
      roi: 0,
    },
  }

  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2))
}

