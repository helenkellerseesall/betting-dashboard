"use strict"

/**
 * daemon.js — Phase Runtime-Supervisor-B7 (2026-05-20).
 *
 * Supervisor main loop. Pure setInterval heartbeat — NO fs.watch, NO spawn,
 * NO HTTP, NO WebSocket, NO child_process. File persistence only.
 *
 * Lifecycle:
 *   1. acquireLock(instanceId) — refuse boot if another live supervisor owns.
 *   2. appendEvent({ eventType: "boot" }) — record boot to events.log.
 *   3. setInterval(tick, HEARTBEAT_MS):
 *        a. hydrate state from canonical surfaces
 *        b. respect operatorOverride (no autonomous mutations)
 *        c. writeHeartbeat(state)
 *        d. appendEvent({ eventType: "heartbeat", payload: { seq } })
 *   4. On SIGINT / SIGTERM:
 *        a. appendEvent({ eventType: "supervisor-shutdown" })
 *        b. releaseLock()
 *        c. process.exit(0)
 *
 * Heartbeat cadence: 5000 ms default; override via SUPERVISOR_HEARTBEAT_MS env.
 *
 * Invariants:
 *   - SINGLE-INSTANCE: enforced via state.lock + pid liveness.
 *   - APPEND-ONLY: events.log via eventEmitter only.
 *   - REPLAY/LIVE PARITY: canonical fields deterministic from inputs;
 *     only heartbeatAt drifts.
 *   - OPERATOR OVERRIDE ABSOLUTE: overrideGuard wraps any future autonomous
 *     mutation. Phase B daemon performs heartbeat-only — no autonomous
 *     mutations to gate yet, but the guard is in place for Phase C+.
 */

const crypto = require("crypto")
const { writeHeartbeat }                   = require("./lib/heartbeatWriter")
const { appendEvent }                      = require("./lib/eventEmitter")
const { acquireLock, releaseLock }         = require("./lib/singleInstanceLock")
const { hydrate }                          = require("./lib/stateHydrator")
const { overrideActive }                   = require("./lib/overrideGuard")

const HEARTBEAT_MS = Number(process.env.SUPERVISOR_HEARTBEAT_MS) || 5000

function uuidV4() {
  return crypto.randomUUID()
}

function tick(ctx) {
  // Hydrate from canonical surfaces, then atomic write.
  const hydrated = hydrate({
    instanceId:       ctx.instanceId,
    startedAt:        ctx.startedAt,
    operatorOverride: ctx.operatorOverride,
    v5LastResult:     ctx.v5LastResult,
    v6LastResult:     ctx.v6LastResult,
  })
  const persisted = writeHeartbeat(hydrated)
  appendEvent({
    instanceId: ctx.instanceId,
    eventType:  "heartbeat",
    payload:    { seq: persisted.heartbeatSeq, activeSlice: persisted.activeSlice, activeLane: persisted.activeLane, overrideActive: overrideActive(persisted) },
  })
  return persisted
}

function start() {
  const instanceId = uuidV4()
  const startedAt  = new Date().toISOString()

  const lock = acquireLock({ instanceId })
  if (!lock) {
    console.error("[supervisor] another live supervisor owns the lock; refusing to boot")
    process.exit(1)
  }

  const ctx = {
    instanceId,
    startedAt,
    operatorOverride: { active: false, reason: null, sinceAt: null },
    v5LastResult:     null,
    v6LastResult:     null,
  }

  // Boot heartbeat + boot event.
  const boot = tick(ctx)
  appendEvent({
    instanceId,
    eventType:  "boot",
    payload:    { pid: process.pid, host: boot.host, heartbeatMs: HEARTBEAT_MS },
  })
  console.log("[supervisor] booted instanceId=%s pid=%d heartbeat=%dms", instanceId, process.pid, HEARTBEAT_MS)

  // Phase Runtime-Supervisor-B (live-fix): setInterval MUST hold the
  // event loop alive. Calling handle.unref() let Node drain after the
  // initial tick + boot event, exiting the process WITHOUT firing
  // SIGINT/SIGTERM — which meant releaseLock() never ran and state.lock
  // was left on disk pointing at a now-dead pid. groupedTerm.statusBanner
  // then correctly reported supervisorAlive=false even while heartbeat
  // metadata in state.json looked recent. The daemon is supposed to be a
  // persistent process; do NOT unref the heartbeat interval.
  const handle = setInterval(() => {
    try { tick(ctx) }
    catch (err) { console.error("[supervisor] tick error:", err && err.message || err) }
  }, HEARTBEAT_MS)

  const shutdown = (signal) => {
    console.log("[supervisor] shutdown signal=%s", signal)
    try { appendEvent({ instanceId, eventType: "supervisor-shutdown", payload: { signal, pid: process.pid } }) } catch (_) {}
    clearInterval(handle)
    releaseLock()
    process.exit(0)
  }
  process.on("SIGINT",  () => shutdown("SIGINT"))
  process.on("SIGTERM", () => shutdown("SIGTERM"))
  return { instanceId, ctx, handle }
}

module.exports = Object.freeze({ start, tick, HEARTBEAT_MS })

if (require.main === module) start()
