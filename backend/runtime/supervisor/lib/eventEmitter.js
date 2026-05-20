"use strict"

/**
 * eventEmitter.js — Phase Runtime-Supervisor-B3 (2026-05-20).
 *
 * Append-only event-log writer with tamper-evident prevHash/hash chain.
 * Strict JSONL. Pure fs.appendFileSync — no fs.watch, no spawn, no sockets.
 *
 * Contract per line:
 *   ts          ISO-8601 UTC
 *   seq         monotonically increasing integer
 *   instanceId  UUID-v4 of writing supervisor
 *   eventType   ∈ canonical event-type vocabulary
 *   payload     event-specific object (never null)
 *   prevHash    SHA-256 of prior line's full JSON, or null on first line
 *   hash        SHA-256 of THIS line's JSON (excluding `hash` field itself)
 *
 * Invariants:
 *   - APPEND-ONLY: never seeks, never rewrites historical lines.
 *   - Chain integrity: prevHash[N] === recompute hash of line[N-1].
 *   - seq monotonically increasing across all writes by this instance.
 */

const fs     = require("fs")
const path   = require("path")
const crypto = require("crypto")

const EVENTS_PATH = path.join(__dirname, "..", "events.log.jsonl")

const ALLOWED_EVENT_TYPES = new Set([
  "boot","heartbeat","slice-open","slice-close","lane-handoff",
  "risk-open","risk-close","backlog-add","backlog-close",
  "v5-run","v6-run","regen-run","override-set","override-clear",
  "supervisor-shutdown",
])

function sha256OfJson(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex")
}

function lastLine() {
  try {
    const src = fs.readFileSync(EVENTS_PATH, "utf8")
    const lines = src.split("\n").filter(l => l.length > 0)
    if (lines.length === 0) return null
    return lines[lines.length - 1]
  } catch (_) { return null }
}

function lastEvent() {
  const l = lastLine()
  if (!l) return null
  try { return JSON.parse(l) } catch (_) { return null }
}

/**
 * Append one event. Returns the persisted object.
 *
 * @param {object} args
 * @param {string} args.instanceId  UUID-v4 of writing supervisor instance.
 * @param {string} args.eventType    Member of ALLOWED_EVENT_TYPES.
 * @param {object} args.payload      Event-specific payload (never null).
 */
function appendEvent({ instanceId, eventType, payload } = {}) {
  if (!instanceId || typeof instanceId !== "string") {
    throw new Error("eventEmitter: instanceId required (UUID-v4)")
  }
  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    throw new Error("eventEmitter: invalid eventType " + eventType)
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("eventEmitter: payload must be object")
  }
  const prev = lastEvent()
  // Phase B reconciliation (2026-05-20): use prev's STORED hash field
  // directly. Earlier implementation called sha256OfJson(prev), which
  // hashed the full object INCLUDING its `hash` field — but prev.hash
  // itself was computed BEFORE that field existed. Recomputing therefore
  // produced a value that diverged from prev.hash, breaking the verifier's
  // chain check (`line[N].prevHash === line[N-1].hash`). Using the stored
  // hash field directly makes writer and reader agree.
  const prevHash = prev && typeof prev.hash === "string" ? prev.hash : null
  const seq = prev && Number.isFinite(prev.seq) ? prev.seq + 1 : 1
  const entry = {
    ts: new Date().toISOString(),
    seq,
    instanceId,
    eventType,
    payload,
    prevHash,
  }
  // hash includes everything above (deterministic ordering)
  entry.hash = sha256OfJson(entry)
  fs.appendFileSync(EVENTS_PATH, JSON.stringify(entry) + "\n")
  return entry
}

module.exports = Object.freeze({
  appendEvent,
  lastEvent,
  ALLOWED_EVENT_TYPES,
  EVENTS_PATH,
  sha256OfJson,
})
