"use strict"

/**
 * cockpit/server.js — Operator Cockpit Phase 1 standalone server.
 *
 * Standalone HTTP server on port 4001 (overridable via COCKPIT_PORT).
 * Anti-shadow: NO mutation routes; NO bettor FE imports; isolated from
 * backend/server.js to keep cockpit observability separate from product
 * runtime. Bettor traffic is on 4000; cockpit is on 4001.
 *
 * Read-only. Reads canonical paths only.
 */

const http  = require("http")
const url   = require("url")
const { attach } = require("./routes")

const PORT = Number(process.env.COCKPIT_PORT) || 4001

// Minimal app shim with .get(path, handler) so the same attach() function
// could be used to mount under any Express-compatible host. We do NOT use
// Express here to keep cockpit isolated from the bettor backend stack.
function makeApp() {
  const routes = []
  return {
    get(p, h) { routes.push({ method: "GET", path: p, handler: h }) },
    match(req) {
      const u = url.parse(req.url, true)
      for (const r of routes) {
        if (r.method !== req.method) continue
        if (r.path === u.pathname) { req.query = u.query; return r }
      }
      return null
    },
  }
}

const app = makeApp()
attach(app)

const server = http.createServer((req, res) => {
  // Hard read-only: reject any non-GET method.
  if (req.method !== "GET") {
    res.statusCode = 405
    res.setHeader("allow", "GET")
    res.end("method not allowed; cockpit is read-only")
    return
  }
  const match = app.match(req)
  if (!match) {
    res.statusCode = 404
    res.end("not found")
    return
  }
  match.handler(req, res)
})

server.listen(PORT, "127.0.0.1", () => {
  console.log("[cockpit] read-only operator cockpit listening on http://127.0.0.1:" + PORT + "/cockpit")
})

process.on("SIGINT",  () => { console.log("[cockpit] SIGINT — shutting down"); server.close(() => process.exit(0)) })
process.on("SIGTERM", () => { console.log("[cockpit] SIGTERM — shutting down"); server.close(() => process.exit(0)) })

module.exports = Object.freeze({ server, app })
