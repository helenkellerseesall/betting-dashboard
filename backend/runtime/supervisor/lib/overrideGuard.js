"use strict"

/**
 * overrideGuard.js — Phase Runtime-Supervisor-B6 (2026-05-20).
 *
 * Operator override is ABSOLUTE. When state.operatorOverride.active === true:
 *   - daemon continues heartbeat writes + events.log appends (visibility)
 *   - daemon DOES NOT autonomously mutate any backend file
 *   - daemon DOES NOT autonomously route slices / promote risks / claim backlog
 *
 * Phase B currently does not yet wire autonomous mutation paths, but this
 * guard is the single gate that any future autonomous action MUST pass.
 */

function overrideActive(state) {
  return !!(state && state.operatorOverride && state.operatorOverride.active === true)
}

function guardedAction(state, actionFn, actionLabel = "anonymous") {
  if (overrideActive(state)) {
    return { skipped: true, reason: "operator-override-active", label: actionLabel }
  }
  try {
    const result = actionFn()
    return { skipped: false, label: actionLabel, result }
  } catch (err) {
    return { skipped: false, label: actionLabel, error: String(err && err.message || err) }
  }
}

module.exports = Object.freeze({ overrideActive, guardedAction })
