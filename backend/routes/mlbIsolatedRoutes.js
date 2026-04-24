"use strict"

const router = require("express").Router()

router.get("/grade-hr-test", (req, res) => {
  const gradeMlbHrSlips = require("../pipeline/mlb/gradeMlbHrSlips")

  const testDate = "2026-04-24"

  const actualHrPlayers = [
    "Aaron Judge",
    "Shohei Ohtani",
    "Kyle Schwarber"
  ]

  gradeMlbHrSlips({
    date: testDate,
    actualHrPlayers
  })

  res.json({ success: true })
})

module.exports = router

