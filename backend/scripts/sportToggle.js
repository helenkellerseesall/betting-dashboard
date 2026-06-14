#!/usr/bin/env node
"use strict"

/**
 * sportToggle.js — Phase Season-Switch-1A (2026-06-14)
 *
 * Flip a sport's season ON/OFF in backend/config/seasonsActive.json, then print
 * a commit fence so the operator can keep the tree clean.
 *
 *   npm run sport:on  <sport>
 *   npm run sport:off <sport>
 *     e.g.  npm run sport:off nba
 *
 * Reuses the canonical path + known-sport set from seasonGate.js (Law 1 — no
 * re-derivation). Writes nothing destructive: only flips one boolean + updatedAt,
 * preserving every other field (incl. _doc). The gate reads the file fresh, so
 * the change is live on the next scheduler tick / slate run / /status request —
 * no restart. (A backend restart is only needed the first time the new
 * statusRoute code ships, not for toggles.)
 */

const { CONFIG_PATH, KNOWN_SPORTS, setSportEnabled, snapshot } = require("../pipeline/shared/seasonGate")

function die(msg) {
  console.error(`[sport-toggle] ERROR: ${msg}`)
  console.error(`Usage: npm run sport:on <sport> | npm run sport:off <sport>`)
  console.error(`       sports: ${[...KNOWN_SPORTS].join(", ")}`)
  process.exit(1)
}

const action = String(process.argv[2] || "").trim().toLowerCase()
const sport = String(process.argv[3] || "").trim().toLowerCase()

if (action !== "on" && action !== "off") die(`first arg must be "on" or "off" (got "${process.argv[2] || ""}")`)
if (!KNOWN_SPORTS.has(sport)) die(`unknown sport "${process.argv[3] || ""}" — must be one of: ${[...KNOWN_SPORTS].join(", ")}`)

const want = action === "on"
const fmt = (v) => (v === true ? "ON" : v === false ? "OFF" : "(unset)")
let before, snap
try {
  before = snapshot().sports[sport]
  snap = setSportEnabled(sport, want)   // ONE canonical write (Law 1) — same fn the /status route calls
} catch (e) {
  die(e && e.message ? e.message : String(e))
}

console.log(`[sport-toggle] ${sport.toUpperCase()}: ${fmt(before)} -> ${fmt(want)}`)
console.log(`[sport-toggle] all sports now: ${Object.entries(snap.sports).map(([s, v]) => `${s}=${fmt(v)}`).join("  ")}`)
console.log(`[sport-toggle] wrote ${CONFIG_PATH}`)
console.log("")
console.log("Commit fence (keeps the tree clean):")
console.log("")
console.log("cd /Users/andrewmoore/Projects/betting-dashboard")
console.log("git add backend/config/seasonsActive.json")
console.log(`git commit -m "season: ${sport} ${want ? "ON" : "OFF"}"`)
console.log("git push")
