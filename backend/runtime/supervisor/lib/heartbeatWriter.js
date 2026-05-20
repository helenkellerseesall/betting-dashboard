"use strict"

/**
 * heartbeatWriter.js — Phase Runtime-Supervisor-B2 (2026-05-20).
 *
 * Atomic state.json writer. Pure file persistence — NO fs.watch, NO spawn,
 * NO HTTP, NO WebSocket.
 *
 * Contract:
 *   - Write canonical state via tmpfile + rename (atomic on POSIX).
 *   - Recompute contentHash over canonicalSubset (excludes heartbeatAt,
 *     heartbeatSeq, contentHash, _doctrine) and embed.
 *   - Bump heartbeatSeq monotonically (non-decreasing).
 *   - heartbeatAt is the ONLY field permitted to drift between writes from
 *     real-time clock. All other fields are deterministic from canonical
 *     surfaces (passed in `nextState`).
 *
 * Anti-shadow invariants:
 *   - Single canonical path: backend/runtime/supervisor/state.json.
 *   - Never edits historical state — every write is a full replacement.
 *   - Never spawns processes. Never opens sockets. Never writes anywhere else.
 */

const fs     = require("fs")
const path   = require("path")
const crypto = require("crypto")

const STATE_PATH = path.join(__dirname, "..", "state.json")

function canonicalSubset(state) {
  const { heartbeatAt, heartbeatSeq, contentHash, _doctrine, ...rest } = state
  return rest
}

function sha256OfJson(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex")
}

function readCurrentState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) }
  catch (_) { return null }
}

/**
 * Atomically write the next state. Returns the persisted object.
 *
 * @param {object} nextState — canonical fields per supervisor-state-v1.
 *                              May omit heartbeatAt / heartbeatSeq /
 *                              contentHash (computed here).
 * @returns {object}
 */
function writeHeartbeat(nextState) {
  if (!nextState || typeof nextState !== "object") {
    throw new Error("heartbeatWriter: nextState must be object")
  }
  const current = readCurrentState() || {}
  const prevSeq = Number.isInteger(current.heartbeatSeq) ? current.heartbeatSeq : 0

  const merged = {
    ...nextState,
    schemaVersion: "supervisor-state-v1",
    heartbeatAt:   new Date().toISOString(),
    heartbeatSeq:  prevSeq + 1,
    contentHash:   null,  // recomputed below
  }
  // _doctrine is preserved when present in nextState; otherwise stripped.
  if (current._doctrine && !("_doctrine" in nextState)) merged._doctrine = current._doctrine

  merged.contentHash = sha256OfJson(canonicalSubset(merged))

  const tmp = STATE_PATH + ".tmp." + process.pid + "." + Date.now()
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n")
  fs.renameSync(tmp, STATE_PATH)
  return merged
}

module.exports = Object.freeze({
  writeHeartbeat,
  readCurrentState,
  canonicalSubset,
  sha256OfJson,
  STATE_PATH,
})
