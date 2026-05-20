#!/usr/bin/env node
"use strict"

/**
 * groupedTerm.js — Phase Runtime-Supervisor-B9 (2026-05-20).
 *
 * Canonical grouped-TERM primitive. Reads supervisor state and prints the
 * cwd-safe TERM 1/2/3 command block per OPERATIONAL_FOOTER_TEMPLATE. When
 * the supervisor daemon is running, augments the block with live state
 * (active slice / lane / heartbeat freshness / override banner).
 *
 * Usage:
 *   node backend/scripts/ops/groupedTerm.js          # print combined block
 *   node backend/scripts/ops/groupedTerm.js --status # print state summary only
 */

const fs   = require("fs")
const path = require("path")

const STATE_PATH = path.join(__dirname, "..", "..", "runtime", "supervisor", "state.json")
const LOCK_PATH  = path.join(__dirname, "..", "..", "runtime", "supervisor", "state.lock")

function isAlive(pid) { try { process.kill(Number(pid), 0); return true } catch (_) { return false } }

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) } catch (_) { return null }
}
function readLock() {
  try { return JSON.parse(fs.readFileSync(LOCK_PATH, "utf8")) } catch (_) { return null }
}

function statusBanner() {
  const state = readState()
  const lock  = readLock()
  const live  = lock && isAlive(lock.pid)
  const overrideActive = !!(state && state.operatorOverride && state.operatorOverride.active)
  const ageMs = state && state.heartbeatAt ? (Date.now() - Date.parse(state.heartbeatAt)) : null
  const freshness = ageMs == null ? "no-state" : ageMs < 30_000 ? "fresh" : ageMs < 120_000 ? "warm" : "stale"
  return {
    supervisorAlive: !!live,
    instanceId:      lock && lock.instanceId || null,
    pid:             lock && lock.pid || null,
    heartbeatSeq:    state && state.heartbeatSeq || 0,
    heartbeatAt:     state && state.heartbeatAt || null,
    ageMs,
    freshness,
    activeSlice:     state && state.activeSlice || null,
    activeLane:      state && state.activeLane || null,
    operatorOverride: overrideActive,
    overrideReason:  state && state.operatorOverride && state.operatorOverride.reason || null,
    openRisks:       state && state.openRisks || [],
    openBacklog:     state && state.openBacklog || [],
  }
}

function groupedBlock(status) {
  const banner = status.supervisorAlive
    ? `[supervisor-live instanceId=${status.instanceId} pid=${status.pid} seq=${status.heartbeatSeq} freshness=${status.freshness}${status.operatorOverride ? " OVERRIDE-ACTIVE" : ""}]`
    : `[supervisor-not-running]`
  return [
    `# ${banner}`,
    `# active-slice: ${status.activeSlice || "?"}    active-lane: ${status.activeLane || "?"}`,
    `# open-risks: ${(status.openRisks || []).join(", ") || "none"}`,
    `# open-backlog: ${(status.openBacklog || []).join(", ") || "none"}`,
    `(cd "$(git rev-parse --show-toplevel)/backend" && npm run ops:term1) && \\`,
    `(cd "$(git rev-parse --show-toplevel)/backend" && npm run ops:term2) && \\`,
    `(cd "$(git rev-parse --show-toplevel)/backend" && npm run ops:checkpoint)`,
  ].join("\n")
}

const args = process.argv.slice(2)
const status = statusBanner()
if (args.includes("--status")) {
  console.log(JSON.stringify(status, null, 2))
} else {
  console.log(groupedBlock(status))
}
