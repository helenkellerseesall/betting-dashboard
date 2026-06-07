"use strict"

/**
 * liveStateGate — Phase Live-Game-State-Integration-1A · Phase 1 (parlay-surface gate).
 *
 * UNIFIED, sport-agnostic live-state gate applied at PARLAY/SLIP ASSEMBLY (the highest-impact
 * surface per the audit: a dead leg kills the whole ticket). WIRE-ONLY — reads detection that
 * already exists every cycle:
 *   MLB: row.mlbLiveState  (applyMlbLiveStateLayers — lineup.scratched, starter.changeType/pitcherChanged)
 *   NBA: row.playerStatus + row.availabilityContext  (nbaAvailabilityCache, ESPN)  [+ optional official override]
 *
 * Graduated, NOT binary:
 *   dead → the leg cannot win (scratched batter, non-starting pitcher, confirmed OUT). Excluded from the parlay;
 *          if a ticket drops below 2 legs after exclusion it is marked dead (no degenerate parlay).
 *   soft → still live but degraded (opposing-starter change, lineup-spot change, questionable/doubtful). Kept +
 *          flagged with an operator-friendly reason. NO numeric haircut in Phase 1 (decision 3 — flag-only).
 *   ok   → no adverse live-state.
 *
 * SAFETY RAIL (Trap 1 — the single most important guard): a MISSING / empty detection envelope returns OK,
 * never dead. A feed outage (live-state layer skipped, player not in cache) must NOT nuke every parlay.
 *
 * SCOPED OUT of Phase 1 (decision 4): mlbLiveState.lineMovement.steamFlag — that is a market-edge signal class,
 * not roster availability; it is deliberately NOT consulted here. Wire steam separately later.
 *
 * Decision 2 (NBA authority): the OFFICIAL injury report wins over the ESPN aggregator when both have an entry.
 * The gate accepts an optional opts.officialStatusByPlayer (Map|object player→status); when an official entry
 * exists it takes precedence, else ESPN row.playerStatus is the live fallback. (Phase 1 ships ESPN-effective on
 * the slip path; official-override activates the moment that map is supplied — see phase1_design.md §8.)
 */

function _norm(s) { return String(s == null ? "" : s).trim().toLowerCase() }

function _capturedAt(leg) {
  return (leg && (leg.mlbLiveState && leg.mlbLiveState.capturedAt)) ||
         (leg && leg.availabilityContext && leg.availabilityContext.lastUpdated) || null
}

// ── MLB ──────────────────────────────────────────────────────────────────────
function _gateMlb(leg) {
  const ls = leg && leg.mlbLiveState
  if (!ls || typeof ls !== "object") return null   // no envelope → caller defaults OK (Trap 1)
  const lineup  = ls.lineup  || {}
  const starter = ls.starter || {}
  const isPitcher = leg.isPitcherMarket === true
  const player = leg.player || "This player"
  const change = _norm(starter.changeType)

  // DEAD — the prop's own batter is not in the confirmed lineup.
  if (lineup.scratched === true && !isPitcher) {
    return { status: "dead", reason: `${player} scratched from the lineup`, source: "mlb.lineup.scratched" }
  }
  // DEAD — pitcher prop whose projected starter is not actually pitching (scratch / pitcher changed).
  if (isPitcher && (change === "scratch" || starter.pitcherChanged === true)) {
    return { status: "dead", reason: `${player} is not the confirmed starter (${change || "pitcher changed"})`, source: "mlb.starter.scratch" }
  }
  // SOFT — opposing starter changed for a batter prop: matchup projection stale, but the batter still plays.
  if (!isPitcher && (change === "emergency_callup" || change === "opener_pivot" || change === "scratch")) {
    return { status: "soft", reason: `opposing starter changed (${change}) — matchup projection may be stale`, source: "mlb.starter.opposingChange" }
  }
  // SOFT — batting-order spot changed since the projection was built.
  if (lineup.lineupSpotChanged === true) {
    return { status: "soft", reason: `${player} batting-order spot changed since projection`, source: "mlb.lineup.spotChanged" }
  }
  // (lineMovement.steamFlag intentionally NOT consulted — scoped out of Phase 1, decision 4.)
  return { status: "ok", reason: null, source: null }
}

// ── NBA ──────────────────────────────────────────────────────────────────────
function _gateNba(leg, officialStatusByPlayer) {
  const player = leg && (leg.player || leg.playerName) || "This player"
  const espn = _norm(leg && leg.playerStatus)
  let official = null
  if (officialStatusByPlayer) {
    const k = _norm(player)
    official = officialStatusByPlayer.get ? officialStatusByPlayer.get(k) : officialStatusByPlayer[k]
    official = official ? _norm(official) : null
  }
  const resolved = official || espn          // decision 2: official wins when present; ESPN is the live fallback
  if (!resolved || resolved === "active" || resolved === "available" || resolved === "probable") {
    return { status: "ok", reason: null, source: null }
  }
  const via = official ? "official injury report" : "injury report"
  const src = official ? "nba.official" : "nba.availability"
  const desc = (leg && leg.availabilityContext && leg.availabilityContext.description)
    ? ` (${leg.availabilityContext.description})` : ""
  if (resolved === "out" || resolved === "inactive" || resolved === "suspended") {
    return { status: "dead", reason: `${player} is OUT per ${via}${desc}`, source: src + ".out" }
  }
  if (resolved === "questionable" || resolved === "doubtful") {
    return { status: "soft", reason: `${player} ${resolved} per ${via}${desc}`, source: src + "." + resolved }
  }
  return { status: "ok", reason: null, source: null }   // unknown / other → OK (no false dead)
}

/**
 * Gate a single leg/row. Returns { status:"ok"|"soft"|"dead", reason, source, capturedAt }.
 * Dispatch: MLB if the leg carries an mlbLiveState envelope, else NBA. A leg with neither → OK (Trap 1).
 */
function liveStateGate(leg, opts) {
  if (!leg || typeof leg !== "object") return { status: "ok", reason: null, source: null, capturedAt: null }
  const o = opts || {}
  let r = (leg.mlbLiveState !== undefined && leg.mlbLiveState !== null) ? _gateMlb(leg) : _gateNba(leg, o.officialStatusByPlayer)
  if (!r) r = { status: "ok", reason: null, source: null }   // Trap 1: null envelope → OK, never dead
  return { status: r.status, reason: r.reason, source: r.source, capturedAt: _capturedAt(leg) }
}

/**
 * Gate the legs of a parlay/slip at assembly.
 *   - DEAD legs are EXCLUDED from gatedLegs (decision iii: pre-filter clean).
 *   - SOFT/OK legs are kept; every kept leg gains `leg.liveState = {status,reason,source,capturedAt}`.
 *   - summary rolls up the worst status + counts + operator-friendly reasons (incl. dropped dead legs) for the
 *     ticket-level flag + FE surface. The CALLER decides drop-if-<2-legs (it owns the min-leg rule).
 */
function gateParlayLegs(legs, opts) {
  const arr = Array.isArray(legs) ? legs : []
  const gatedLegs = []
  const reasons = []
  let deadCount = 0, softCount = 0
  for (const leg of arr) {
    const g = liveStateGate(leg, opts)
    if (g.status === "dead") { deadCount++; if (g.reason) reasons.push(g.reason); continue }   // EXCLUDE dead
    if (g.status === "soft") { softCount++; if (g.reason) reasons.push(g.reason) }
    gatedLegs.push((leg && typeof leg === "object") ? { ...leg, liveState: g } : leg)
  }
  const worst = deadCount > 0 ? "dead" : softCount > 0 ? "soft" : "ok"
  return { gatedLegs, summary: { worst, deadCount, softCount, reasons } }
}

module.exports = { liveStateGate, gateParlayLegs }
