"use strict"
// ============================================================================
// backfillMlbLineupSpot — re-join lineupSpot onto tracked rows at serialization
// time, from the FRESH lineup cache.
// ----------------------------------------------------------------------------
// Root cause (lineupSpot_rootcause_phase0.md): the upstream lineup join
// (mergeMlbExternalContext, during buildMlbBootstrapSnapshot) doesn't land on the
// rows that become tracked_best — they arrive at phase4Tracking with no
// playerIdExternal (id-join dead) and no lineupPosition, so confirmed-game picks
// were 1/26 instead of ~all rostered hitters. This back-fills lineupPosition at
// the tracked_best serializer against the CURRENT cache (which persists + grows as
// lineups post through the evening), reusing the canonical resolve from
// mergeMlbExternalContext (single source of truth — no duplicated join logic).
//
// SCOPE: back-fill is POST-SCORING — it sets only fields that were null on the
// output row (lineupPosition + derived lineup context). It does NOT touch
// edge/tier/predictedProbability/selection (already computed) ⇒ today's picks are
// byte-identical; the scoring benefit of better lineup data accrues NEXT slate
// when the upstream join is reliable.
//
// OMIT-NOT-FABRICATE: returns null when the row's game has no posted lineup, the
// player isn't matched, or the resolved spot is out of 1..9. Never invents a spot.
// ============================================================================
const { loadCacheForCurrentSlate } = require("./cache/mlbLineupCache")
const {
  buildExternalLineupIndexForEvent,
  resolveLineupPositionFromExternal,
} = require("./enrichment/mergeMlbExternalContext")

/**
 * Build a back-filler bound to ONE load of the current-slate lineup cache.
 * Call once per record loop; reuse `resolve(row)` per row (per-event index cached).
 * @returns {{ resolve: (row:object)=>(number|null), cache: object }}
 */
function makeLineupBackfiller() {
  let cache = null
  try { cache = loadCacheForCurrentSlate() } catch (_) { cache = null }
  const playersByEventId = (cache && cache.playersByEventId) || {}
  const idxByEvent = new Map()

  const indexFor = (eventId) => {
    const ev = String(eventId || "")
    if (!ev) return null
    if (idxByEvent.has(ev)) return idxByEvent.get(ev)
    const idx = buildExternalLineupIndexForEvent({ playersByEventId, eventId: ev })
    idxByEvent.set(ev, idx)
    return idx
  }

  const resolve = (row) => {
    // Only back-fill when truly absent (never override an upstream-set spot).
    if (!row || row.lineupPosition != null || row.battingOrderIndex != null) return null
    const idx = indexFor(row.eventId)
    if (!idx || !Array.isArray(idx.players) || idx.players.length === 0) return null
    try {
      const lp = resolveLineupPositionFromExternal({
        row,
        identity: {
          playerIdExternal: row.playerIdExternal ?? (row.__src && row.__src.playerIdExternal) ?? null,
          teamResolved: row.teamResolved ?? row.team ?? null,
        },
        externalIndex: idx,
      })
      return (lp != null && lp >= 1 && lp <= 9) ? lp : null
    } catch (_) {
      return null
    }
  }

  return { resolve, cache: cache || { eventCount: 0 } }
}

module.exports = { makeLineupBackfiller }
