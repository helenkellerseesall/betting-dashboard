#!/usr/bin/env node
"use strict"

/**
 * supervisorOverrideSet.js — Phase Runtime-Supervisor-B8 (2026-05-20).
 *
 * Sets operatorOverride.active = true in state.json AND appends an
 * `override-set` event to events.log. The next supervisor tick picks up
 * the override and pauses all autonomous mutations.
 *
 * Usage:
 *   node backend/scripts/ops/supervisorOverrideSet.js "reason text"
 */
const fs   = require("fs")
const path = require("path")
const { writeHeartbeat }    = require("../../runtime/supervisor/lib/heartbeatWriter")
const { appendEvent }       = require("../../runtime/supervisor/lib/eventEmitter")
const { readLock }          = require("../../runtime/supervisor/lib/singleInstanceLock")
const { hydrate }           = require("../../runtime/supervisor/lib/stateHydrator")

const reason = (process.argv[2] || "operator-requested").slice(0, 200)
const lock = readLock()
const instanceId = (lock && lock.instanceId) || "manual-override"
const state = hydrate({
  instanceId,
  startedAt: (lock && lock.startedAt) || new Date().toISOString(),
  operatorOverride: { active: true, reason, sinceAt: new Date().toISOString() },
})
const persisted = writeHeartbeat(state)
appendEvent({ instanceId, eventType: "override-set", payload: { reason, pid: process.pid } })
console.log("[supervisor-override-set] active=true reason=%j seq=%d", reason, persisted.heartbeatSeq)
