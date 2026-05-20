#!/usr/bin/env node
"use strict"

/**
 * supervisorShutdown.js — Phase Runtime-Supervisor-B8 (2026-05-20).
 *
 * Reads state.lock, sends SIGTERM to the supervisor pid, waits up to 5s
 * for graceful exit. Releases lock if pid is dead but lock stale.
 */
const fs   = require("fs")
const path = require("path")
const LOCK = path.join(__dirname, "..", "..", "runtime", "supervisor", "state.lock")

function isAlive(pid) { try { process.kill(Number(pid), 0); return true } catch (_) { return false } }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  if (!fs.existsSync(LOCK)) { console.log("[supervisor-shutdown] no lock present; nothing to do"); return }
  const lock = JSON.parse(fs.readFileSync(LOCK, "utf8"))
  if (!isAlive(lock.pid)) {
    console.log("[supervisor-shutdown] lock pid %d is dead; clearing stale lock", lock.pid)
    try { fs.unlinkSync(LOCK) } catch (_) {}
    return
  }
  console.log("[supervisor-shutdown] sending SIGTERM to pid=%d instanceId=%s", lock.pid, lock.instanceId)
  try { process.kill(Number(lock.pid), "SIGTERM") } catch (e) { console.error("[supervisor-shutdown] SIGTERM error:", e.message); process.exit(1) }
  for (let i = 0; i < 25; i++) {
    if (!isAlive(lock.pid)) { console.log("[supervisor-shutdown] supervisor exited"); return }
    await sleep(200)
  }
  console.error("[supervisor-shutdown] supervisor did NOT exit within 5s")
  process.exit(2)
}
main().catch(e => { console.error(e); process.exit(1) })
