"use strict"

/**
 * supervisorReader.js — Operator Cockpit Phase 1 (2026-05-20).
 *
 * READ-ONLY reader for canonical supervisor state. Anti-shadow: NEVER
 * writes to disk, never opens sockets, never spawns. Reads ONLY from
 * the canonical paths:
 *   backend/runtime/supervisor/state.json
 *   backend/runtime/supervisor/state.lock
 *   backend/runtime/supervisor/events.log.jsonl  (last N lines)
 */

const fs   = require("fs")
const path = require("path")

const SUP_DIR     = path.join(__dirname, "..", "..", "runtime", "supervisor")
const STATE_PATH  = path.join(SUP_DIR, "state.json")
const LOCK_PATH   = path.join(SUP_DIR, "state.lock")
const EVENTS_PATH = path.join(SUP_DIR, "events.log.jsonl")

function isAlive(pid) {
  if (!Number.isFinite(Number(pid))) return false
  try { process.kill(Number(pid), 0); return true } catch (_) { return false }
}

function readSafe(p) { try { return fs.readFileSync(p, "utf8") } catch (_) { return null } }

function readSupervisor() {
  const state = (() => { try { return JSON.parse(readSafe(STATE_PATH) || "null") } catch (_) { return null } })()
  const lock  = (() => { try { return JSON.parse(readSafe(LOCK_PATH)  || "null") } catch (_) { return null } })()
  const live  = lock && isAlive(lock.pid)
  const ageMs = state && state.heartbeatAt ? (Date.now() - Date.parse(state.heartbeatAt)) : null
  const freshness = ageMs == null ? "no-state" : ageMs < 30_000 ? "fresh" : ageMs < 120_000 ? "warm" : "stale"
  return {
    supervisorAlive:  !!live,
    instanceId:       (lock && lock.instanceId) || (state && state.instanceId) || null,
    pid:              (lock && lock.pid)        || (state && state.pid)        || null,
    host:             (state && state.host)     || (lock && lock.host)         || null,
    startedAt:        (lock && lock.startedAt)  || (state && state.startedAt)  || null,
    heartbeatAt:      state && state.heartbeatAt || null,
    heartbeatSeq:     state && state.heartbeatSeq || 0,
    ageMs,
    freshness,
    activeSlice:      state && state.activeSlice || null,
    activeLane:       state && state.activeLane  || null,
    operatorOverride: state && state.operatorOverride || { active: false, reason: null, sinceAt: null },
    openRisksCount:   state && Array.isArray(state.openRisks)   ? state.openRisks.length   : 0,
    openBacklogCount: state && Array.isArray(state.openBacklog) ? state.openBacklog.length : 0,
    runtimeFreshness: state && state.runtimeFreshness || { mlbTrackedBestPath: null, mlbTrackedBestAgeMs: null },
    contentHash:      state && state.contentHash || null,
  }
}

function readRecentEvents(n = 20) {
  const src = readSafe(EVENTS_PATH) || ""
  const lines = src.split("\n").filter(l => l.length > 0)
  return lines.slice(-Math.max(1, Number(n) || 20)).map(l => { try { return JSON.parse(l) } catch (_) { return null } }).filter(Boolean)
}

module.exports = Object.freeze({ readSupervisor, readRecentEvents })
