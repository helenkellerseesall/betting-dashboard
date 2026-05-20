#!/usr/bin/env node
"use strict"

/**
 * supervisorOverrideClear.js — Phase Runtime-Supervisor-B8 (2026-05-20).
 *
 * Sets operatorOverride.active = false in state.json AND appends an
 * `override-clear` event to events.log.
 *
 * Usage:
 *   node backend/scripts/ops/supervisorOverrideClear.js [reason]
 */
const { writeHeartbeat } = require("../../runtime/supervisor/lib/heartbeatWriter")
const { appendEvent }    = require("../../runtime/supervisor/lib/eventEmitter")
const { readLock }       = require("../../runtime/supervisor/lib/singleInstanceLock")
const { hydrate }        = require("../../runtime/supervisor/lib/stateHydrator")

const reason = (process.argv[2] || "operator-cleared").slice(0, 200)
const lock = readLock()
const instanceId = (lock && lock.instanceId) || "manual-override"
const state = hydrate({
  instanceId,
  startedAt: (lock && lock.startedAt) || new Date().toISOString(),
  operatorOverride: { active: false, reason: null, sinceAt: null },
})
const persisted = writeHeartbeat(state)
appendEvent({ instanceId, eventType: "override-clear", payload: { reason, pid: process.pid } })
console.log("[supervisor-override-clear] active=false reason=%j seq=%d", reason, persisted.heartbeatSeq)
