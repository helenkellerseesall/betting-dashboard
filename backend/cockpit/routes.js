"use strict"

/**
 * routes.js — Operator Cockpit Phase 1 (2026-05-20).
 *
 * READ-ONLY HTTP routes. Anti-shadow: only GET methods, only canonical
 * readers — NEVER writes, NEVER mutates state, NEVER calls into bettor FE.
 *
 * Routes:
 *   GET /cockpit                 — minimal HTML view
 *   GET /cockpit/api/summary     — JSON: supervisor + active slice + backlog/risk counts
 *   GET /cockpit/api/supervisor  — JSON: full supervisor reader output
 *   GET /cockpit/api/backlog     — JSON: OPEN + IN-SLICE BBL entries
 *   GET /cockpit/api/risks       — JSON: OPEN + MITIGATED risks
 *   GET /cockpit/api/queue       — JSON: slice queue
 *   GET /cockpit/api/events      — JSON: last N supervisor events
 *   GET /cockpit/api/phase       — JSON: ACTIVE_PHASE.md headline + excerpt
 */

const fs   = require("fs")
const path = require("path")

const { readSupervisor, readRecentEvents } = require("./readers/supervisorReader")
const { readActiveSlice, readSliceQueue, readBacklog, readOpenBacklogIds, readOpenRisks, readActivePhase } = require("./readers/backlogReader")

const VIEW_PATH = path.join(__dirname, "views", "cockpit.html")

function jsonRoute(handler) {
  return (req, res) => {
    if (req.method !== "GET") { res.statusCode = 405; res.end("method not allowed"); return }
    try {
      const data = handler(req)
      res.setHeader("content-type", "application/json")
      res.setHeader("cache-control", "no-cache")
      res.end(JSON.stringify(data, null, 2))
    } catch (e) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(e && e.message || e) }))
    }
  }
}

function summaryHandler() {
  const sup = readSupervisor()
  const active = readActiveSlice()
  const openRisks = readOpenRisks()
  const openBacklog = readOpenBacklogIds()
  return {
    supervisor: sup,
    activeSlice: active,
    openRisksCount: openRisks.length,
    openBacklogCount: openBacklog.length,
    openRisksIds: openRisks.map(r => r.id),
    openBacklogIds: openBacklog,
  }
}

function attach(app) {
  app.get("/cockpit",                  (req, res) => {
    try {
      const html = fs.readFileSync(VIEW_PATH, "utf8")
      res.setHeader("content-type", "text/html; charset=utf-8")
      res.end(html)
    } catch (e) { res.statusCode = 500; res.end("view-not-found: " + e.message) }
  })
  app.get("/cockpit/api/summary",      jsonRoute(summaryHandler))
  app.get("/cockpit/api/supervisor",   jsonRoute(() => readSupervisor()))
  app.get("/cockpit/api/backlog",      jsonRoute(() => readBacklog().filter(e => e.state === "OPEN" || e.state === "IN-SLICE")))
  app.get("/cockpit/api/risks",        jsonRoute(() => readOpenRisks()))
  app.get("/cockpit/api/queue",        jsonRoute(() => readSliceQueue()))
  app.get("/cockpit/api/events",       jsonRoute((req) => readRecentEvents(req.query?.n || 20)))
  app.get("/cockpit/api/phase",        jsonRoute(() => readActivePhase()))
}

module.exports = Object.freeze({ attach, summaryHandler })
