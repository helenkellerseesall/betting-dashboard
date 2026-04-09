"use strict"

function ensureArray(value) {
  return Array.isArray(value) ? value : []
}

function ensureObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function dedupeCandidateRows(rows) {
  const seen = new Set()
  const out = []
  for (const row of ensureArray(rows)) {
    const key = [
      String(row?.playerKey || ""),
      String(row?.playerName || ""),
      String(row?.teamResolved || ""),
      String(row?.source || "")
    ].join("|")
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

function mergePlayersByPlayerKey(baseMap, overlayMap) {
  const out = { ...ensureObject(baseMap) }
  for (const [playerKey, overlayRows] of Object.entries(ensureObject(overlayMap))) {
    out[playerKey] = dedupeCandidateRows([
      ...ensureArray(overlayRows),
      ...ensureArray(out[playerKey])
    ])
  }
  return out
}

function mergePlayersByEventId(baseMap, overlayMap) {
  const out = { ...ensureObject(baseMap) }
  for (const [eventId, overlayRows] of Object.entries(ensureObject(overlayMap))) {
    out[eventId] = dedupeCandidateRows([
      ...ensureArray(overlayRows),
      ...ensureArray(out[eventId])
    ])
  }
  return out
}

function mergeEventContext(baseMap, overlayMap) {
  const out = { ...ensureObject(baseMap) }
  for (const [eventId, overlayContext] of Object.entries(ensureObject(overlayMap))) {
    const baseContext = ensureObject(out[eventId])
    const safeOverlay = ensureObject(overlayContext)
    out[eventId] = {
      ...baseContext,
      ...safeOverlay,
      probablePitchers: safeOverlay?.probablePitchers || baseContext?.probablePitchers || null,
      lineupConfirmation: safeOverlay?.lineupConfirmation || baseContext?.lineupConfirmation || null
    }
  }
  return out
}

function mergeMlbExternalSnapshots({ baseSnapshot, overlaySnapshot, overlaySourceName = null } = {}) {
  const base = ensureObject(baseSnapshot)
  const overlay = ensureObject(overlaySnapshot)

  const merged = {
    ...base,
    generatedAt: overlay?.generatedAt || base?.generatedAt || null,
    source: base?.source || null,
    version: base?.version || null,
    eventContextByEventId: mergeEventContext(base?.eventContextByEventId, overlay?.eventContextByEventId),
    probablePitchersByEventId: {
      ...ensureObject(base?.probablePitchersByEventId),
      ...ensureObject(overlay?.probablePitchersByEventId)
    },
    lineupConfirmationByEventId: {
      ...ensureObject(base?.lineupConfirmationByEventId),
      ...ensureObject(overlay?.lineupConfirmationByEventId)
    },
    teamContextByEventId: {
      ...ensureObject(base?.teamContextByEventId)
    },
    playersByEventId: mergePlayersByEventId(base?.playersByEventId, overlay?.playersByEventId),
    playersByPlayerKey: mergePlayersByPlayerKey(base?.playersByPlayerKey, overlay?.playersByPlayerKey),
    recentStatsByPlayerKey: {
      ...ensureObject(base?.recentStatsByPlayerKey)
    },
    diagnostics: {
      ...ensureObject(base?.diagnostics),
      mergePrecedence: {
        teamContextByEventId: "base-only",
        eventContextByEventId: `${String(overlaySourceName || overlay?.source || "overlay")} over base when player-bearing fields exist`,
        probablePitchersByEventId: `${String(overlaySourceName || overlay?.source || "overlay")} over base`,
        lineupConfirmationByEventId: `${String(overlaySourceName || overlay?.source || "overlay")} over base`,
        playersByEventId: `${String(overlaySourceName || overlay?.source || "overlay")} first, then base deduped`,
        playersByPlayerKey: `${String(overlaySourceName || overlay?.source || "overlay")} first, then base deduped`
      },
      sourceContributions: {
        baseSource: base?.source || null,
        overlaySource: overlaySourceName || overlay?.source || null,
        overlayPlayerKeyCount: Object.keys(ensureObject(overlay?.playersByPlayerKey)).length,
        overlayPlayersByEventCount: Object.keys(ensureObject(overlay?.playersByEventId)).length,
        overlayProbablePitcherEventCount: Object.keys(ensureObject(overlay?.probablePitchersByEventId)).length,
        overlayLineupConfirmationEventCount: Object.keys(ensureObject(overlay?.lineupConfirmationByEventId)).length
      },
      fetchReadiness: {
        ...ensureObject(base?.diagnostics?.fetchReadiness),
        secondSource: {
          source: overlaySourceName || overlay?.source || null,
          fetchReadiness: ensureObject(overlay?.diagnostics?.fetchReadiness),
          overlayPlayersByEventCount: Object.keys(ensureObject(overlay?.playersByEventId)).length,
          overlayPlayerKeyCount: Object.keys(ensureObject(overlay?.playersByPlayerKey)).length,
          overlayProbablePitcherEventCount: Object.keys(ensureObject(overlay?.probablePitchersByEventId)).length,
          overlayLineupConfirmationEventCount: Object.keys(ensureObject(overlay?.lineupConfirmationByEventId)).length
        }
      }
    }
  }

  return merged
}

module.exports = {
  mergeMlbExternalSnapshots
}