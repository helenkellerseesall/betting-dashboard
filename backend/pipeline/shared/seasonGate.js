"use strict"

/**
 * seasonGate.js — Phase Season-Switch-1A (2026-06-14)
 *
 * CANONICAL AUTHORITY (Law 1) for "is this sport's pipeline enabled right now."
 * Exactly one source of truth: backend/config/seasonsActive.json.
 *
 * Consumed by:
 *   - slateMlb.js / slateNba.js  (entry gate at top of main() — covers scheduler,
 *     autopilot wrappers, AND manual `npm run slate:*`)
 *   - scheduler.sh sport_on()    (bash helper shells `node -e` against THIS module
 *     via exit code — one logic implementation, bash just consumes the result)
 *   - statusRoute.js             (sectionSportsActive card)
 *   - sysAudit.js                (skip OFF sports → no false WARN)
 *
 * Design rules:
 *   - FRESH READ every call (fs.readFileSync + JSON.parse, NO require cache) so a
 *     long-lived process (backend) never holds a stale enabled-state. Toggling the
 *     JSON takes effect on the next call — no restart.
 *   - FAIL-OPEN (Law 16, no silent fallback): a missing / unreadable / garbled
 *     config, or an unknown sport key, returns TRUE and emits a rate-limited
 *     [SEASON-GATE] warn. A config typo must never silently kill a LIVE sport;
 *     it degrades loud-and-on, never quiet-and-off.
 *   - This module is OUTSIDE the scoring path. It gates slate/populator ENTRY,
 *     before any engine call. R2 freeze + T2-L1 shadow are untouched.
 *
 * NOT gated by callers (operator-confirmed 2026-06-14): grading / settlement /
 * audit:nightly / status-autoticker / caffeinate are sport-agnostic and keep
 * running so an OFF sport's existing bets still grade and settle.
 */

const fs = require("fs")
const path = require("path")

const CONFIG_PATH = path.join(__dirname, "..", "..", "config", "seasonsActive.json")

// Canonical sport keys. Unknown sport → fail-open (true) + warn.
const KNOWN_SPORTS = new Set(["mlb", "nba", "nfl", "nhl"])

// Law 9 — rate-limit probes to once per first-seen condition per process.
const _warned = new Set()
function warnOnce(key, msg) {
  if (_warned.has(key)) return
  _warned.add(key)
  console.warn(`[SEASON-GATE] ${msg}`)
}

/**
 * Read the config fresh. Returns the parsed object, or null on any failure
 * (the caller treats null as fail-open).
 */
function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8")
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || typeof parsed.sports !== "object" || parsed.sports == null) {
      warnOnce("shape", `seasonsActive.json missing a valid "sports" object — failing OPEN (all sports treated ON)`)
      return null
    }
    return parsed
  } catch (e) {
    warnOnce("read", `cannot read seasonsActive.json (${e && e.code ? e.code : e && e.message ? e.message : e}) — failing OPEN (all sports treated ON)`)
    return null
  }
}

/**
 * isSportEnabled(sport) → boolean
 * Fail-OPEN: returns true on any config problem or unknown sport.
 */
function isSportEnabled(sport) {
  const key = String(sport == null ? "" : sport).trim().toLowerCase()
  if (!KNOWN_SPORTS.has(key)) {
    warnOnce(`unknown:${key}`, `isSportEnabled("${sport}") — unknown sport key, failing OPEN (treated ON)`)
    return true
  }
  const cfg = readConfig()
  if (cfg == null) return true // fail-open (already warned in readConfig)
  const val = cfg.sports[key]
  if (typeof val !== "boolean") {
    warnOnce(`missingkey:${key}`, `seasonsActive.json has no boolean for "${key}" — failing OPEN (treated ON)`)
    return true
  }
  return val
}

/**
 * snapshot() → { mlb, nba, nfl, nhl } booleans (fail-open per sport) + meta.
 * Convenience for /status so it doesn't read the file four times.
 */
function snapshot() {
  const cfg = readConfig()
  const sports = {}
  for (const s of KNOWN_SPORTS) {
    const val = cfg && typeof cfg.sports[s] === "boolean" ? cfg.sports[s] : true
    sports[s] = val
  }
  return {
    sports,
    updatedAt: cfg && typeof cfg.updatedAt === "string" ? cfg.updatedAt : null,
    configReadable: cfg != null,
    configPath: CONFIG_PATH,
  }
}

/**
 * setSportEnabled(sport, enabled) → { ok, sports, ... } | throws
 * Phase Season-Switch-2A — the ONE canonical write (Law 1). Used by the CLI
 * (sportToggle.js) AND the /status route — neither duplicates the file-write.
 * Validates sport ∈ KNOWN_SPORTS and enabled is a real boolean; flips one flag,
 * stamps updatedAt, writes seasonsActive.json; returns the fresh snapshot().
 * Throws on bad input or unreadable/garbled config (caller decides the response).
 */
function setSportEnabled(sport, enabled) {
  const key = String(sport == null ? "" : sport).trim().toLowerCase()
  if (!KNOWN_SPORTS.has(key)) throw new Error(`unknown sport "${sport}" — must be one of: ${[...KNOWN_SPORTS].join(", ")}`)
  if (typeof enabled !== "boolean") throw new Error(`enabled must be a boolean (got ${typeof enabled})`)
  let cfg
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) } catch (e) { throw new Error(`cannot read/parse ${CONFIG_PATH}: ${e && e.message ? e.message : e}`) }
  if (!cfg || typeof cfg.sports !== "object" || cfg.sports == null) throw new Error(`${CONFIG_PATH} has no valid "sports" object`)
  cfg.sports[key] = enabled
  cfg.updatedAt = new Date().toISOString()
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8")
  return snapshot()
}

module.exports = { isSportEnabled, snapshot, setSportEnabled, CONFIG_PATH, KNOWN_SPORTS }

// Inline self-test: `node backend/pipeline/shared/seasonGate.js`
if (require.main === module) {
  const snap = snapshot()
  console.log("[SEASON-GATE] config:", snap.configReadable ? "readable" : "UNREADABLE (fail-open)")
  console.log("[SEASON-GATE] updatedAt:", snap.updatedAt)
  for (const s of KNOWN_SPORTS) {
    console.log(`  ${s}: ${isSportEnabled(s) ? "ON" : "OFF"}`)
  }
}
