"use strict"

function normalizeArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function createEmptyMlbExternalSnapshot({ now = Date.now(), source = "mlb-external-scaffold" } = {}) {
  const generatedAt = new Date(now).toISOString()

  return {
    sport: "mlb",
    generatedAt,
    source,
    version: "phase-6-ingest-scaffold-v1",

    // Event-scoped context lane (probables, lineup confirmation, weather tags, etc.)
    eventContextByEventId: {},

    // Player identity lane. Keyed by normalized player key.
    // Example row: { playerIdExternal, playerName, teamResolved, teamCode, eventIds: [], source }
    playersByPlayerKey: {},

    // Optional event-first lookup lane for narrowing identity candidates.
    // Example: { [eventId]: [ { playerIdExternal, playerName, playerKey, teamResolved, teamCode } ] }
    playersByEventId: {},

    diagnostics: {
      hasExternalData: false,
      playerKeyCount: 0,
      eventContextCount: 0,
      playersByEventCount: 0
    }
  }
}

function normalizeMlbExternalSnapshotShape(snapshot, { now = Date.now() } = {}) {
  const base = createEmptyMlbExternalSnapshot({ now })
  const safe = normalizeObject(snapshot)

  const eventContextByEventId = normalizeObject(safe.eventContextByEventId)
  const playersByPlayerKey = normalizeObject(safe.playersByPlayerKey)
  const playersByEventId = normalizeObject(safe.playersByEventId)

  const out = {
    ...base,
    ...safe,
    eventContextByEventId,
    playersByPlayerKey,
    playersByEventId,
    diagnostics: {
      ...(normalizeObject(safe.diagnostics)),
      hasExternalData:
        Object.keys(eventContextByEventId).length > 0 ||
        Object.keys(playersByPlayerKey).length > 0 ||
        Object.keys(playersByEventId).length > 0,
      playerKeyCount: Object.keys(playersByPlayerKey).length,
      eventContextCount: Object.keys(eventContextByEventId).length,
      playersByEventCount: Object.keys(playersByEventId).length
    }
  }

  return out
}

module.exports = {
  createEmptyMlbExternalSnapshot,
  normalizeMlbExternalSnapshotShape,
  normalizeArray,
  normalizeObject
}
