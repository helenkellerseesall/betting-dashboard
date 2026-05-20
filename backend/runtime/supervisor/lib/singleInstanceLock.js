"use strict"

/**
 * singleInstanceLock.js — Phase Runtime-Supervisor-B4 (2026-05-20).
 *
 * Single-instance lock via backend/runtime/supervisor/state.lock. Pure
 * file-based advisory lock. No fcntl, no flock, no kernel locks — just a
 * file containing the active instance's UUID + pid + boot timestamp.
 *
 * Boot protocol:
 *   1. If state.lock absent → write our lock and proceed.
 *   2. If state.lock present → check whether `pid` is still alive via
 *      process.kill(pid, 0). If alive → REFUSE to boot (return null).
 *      If dead (stale lock) → overwrite with our lock and proceed.
 *
 * Shutdown protocol:
 *   1. releaseLock() removes state.lock atomically.
 *
 * Anti-shadow: single canonical lock path. Never opens sockets. Never spawns.
 */

const fs   = require("fs")
const path = require("path")

const LOCK_PATH = path.join(__dirname, "..", "state.lock")

function readLock() {
  try { return JSON.parse(fs.readFileSync(LOCK_PATH, "utf8")) }
  catch (_) { return null }
}

function isPidAlive(pid) {
  if (!Number.isFinite(Number(pid))) return false
  try { process.kill(Number(pid), 0); return true }
  catch (_) { return false }
}

/**
 * Attempt to acquire the single-instance lock. Returns the lock object on
 * success, or null when another live supervisor owns the lock.
 *
 * @param {{ instanceId: string }} args
 */
function acquireLock({ instanceId }) {
  if (!instanceId || typeof instanceId !== "string") {
    throw new Error("singleInstanceLock: instanceId required")
  }
  const existing = readLock()
  if (existing && existing.instanceId && existing.pid && isPidAlive(existing.pid)) {
    // Another live supervisor — refuse to boot.
    return null
  }
  // Stale or absent lock — claim it.
  const lock = {
    instanceId,
    pid:       process.pid,
    host:      require("os").hostname(),
    startedAt: new Date().toISOString(),
  }
  const tmp = LOCK_PATH + ".tmp." + process.pid + "." + Date.now()
  fs.writeFileSync(tmp, JSON.stringify(lock, null, 2) + "\n")
  fs.renameSync(tmp, LOCK_PATH)
  return lock
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_PATH) }
  catch (_) { /* idempotent */ }
}

module.exports = Object.freeze({
  acquireLock,
  releaseLock,
  readLock,
  isPidAlive,
  LOCK_PATH,
})
