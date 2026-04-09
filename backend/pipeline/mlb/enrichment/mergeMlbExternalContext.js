"use strict"

const { resolveMlbIdentityForRow } = require("./resolveMlbIdentityCandidates")
const { normalizeMlbExternalSnapshotShape } = require("./buildMlbExternalSnapshotScaffold")

function toKey(value, fallback = "unknown") {
  const key = String(value == null ? "" : value).trim()
  return key || fallback
}

function roundRate(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) return 0
  return Number((Number(numerator || 0) / denominator).toFixed(4))
}

function addFamilyBucket(target, familyKey) {
  const key = toKey(familyKey, "unknown")
  if (!target[key]) {
    target[key] = {
      total: 0,
      matched: 0,
      unresolved: 0,
      lowConfidence: 0,
      matchRate: 0
    }
  }
  return target[key]
}

function buildMlbEnrichmentDiagnostics(rows) {
  const safeRows = Array.isArray(rows) ? rows : []

  let playerRows = 0
  let matchedRows = 0
  let unresolvedRows = 0
  let lowConfidenceRows = 0

  const unresolvedSamples = []
  const lowConfidenceSamples = []
  const byMarketFamily = {}
  const unresolvedByReason = {}

  for (const row of safeRows) {
    const familyBucket = addFamilyBucket(byMarketFamily, row?.marketFamily)
    familyBucket.total += 1

    const isPlayerRow = String(row?.player || "").trim().length > 0 && String(row?.marketFamily || "") !== "game"
    if (!isPlayerRow) continue

    playerRows += 1

    const confidence = Number(row?.identityConfidence || 0)
    const matched = Boolean(row?.playerIdExternal) || confidence >= 0.6

    if (matched) {
      matchedRows += 1
      familyBucket.matched += 1
    } else {
      unresolvedRows += 1
      familyBucket.unresolved += 1
      const unresolvedReason = String(row?.unresolvedReason || "unknown")
      unresolvedByReason[unresolvedReason] = Number(unresolvedByReason[unresolvedReason] || 0) + 1
      if (unresolvedSamples.length < 25) {
        unresolvedSamples.push({
          eventId: row?.eventId || null,
          matchup: row?.matchup || null,
          player: row?.player || null,
          marketKey: row?.marketKey || null,
          marketFamily: row?.marketFamily || null,
          playerKey: row?.playerKey || null,
          unresolvedReason: row?.unresolvedReason || null,
          identitySource: row?.identitySource || null
        })
      }
    }

    if (confidence > 0 && confidence < 0.75) {
      lowConfidenceRows += 1
      familyBucket.lowConfidence += 1
      if (lowConfidenceSamples.length < 25) {
        lowConfidenceSamples.push({
          eventId: row?.eventId || null,
          matchup: row?.matchup || null,
          player: row?.player || null,
          marketKey: row?.marketKey || null,
          identityConfidence: confidence,
          identitySource: row?.identitySource || null
        })
      }
    }
  }

  for (const familyBucket of Object.values(byMarketFamily)) {
    familyBucket.matchRate = roundRate(familyBucket.matched, familyBucket.total)
  }

  return {
    totals: {
      totalRows: safeRows.length,
      playerRows,
      matchedRows,
      unresolvedRows,
      lowConfidenceRows,
      overallMatchRate: roundRate(matchedRows, playerRows)
    },
    byMarketFamily,
    unresolvedByReason,
    unresolvedSamples,
    lowConfidenceSamples
  }
}

function enrichMlbRowsWithExternalContext({ rows, externalSnapshot }) {
  const safeRows = Array.isArray(rows) ? rows : []
  const normalizedExternalSnapshot = normalizeMlbExternalSnapshotShape(externalSnapshot)

  const enrichedRows = safeRows.map((row) => {
    const identity = resolveMlbIdentityForRow({
      row,
      externalSnapshot: normalizedExternalSnapshot
    })

    return {
      ...row,
      playerKey: identity.playerKey,
      teamResolved: identity.teamResolved,
      teamCode: identity.teamCode,
      opponentTeam: identity.opponentTeam,
      isHome: identity.isHome,
      playerIdExternal: identity.playerIdExternal,
      identityConfidence: identity.identityConfidence,
      identitySource: identity.identitySource,
      unresolvedReason: identity.unresolvedReason || null
    }
  })

  return {
    rows: enrichedRows,
    diagnostics: buildMlbEnrichmentDiagnostics(enrichedRows),
    externalSnapshotMeta: {
      generatedAt: normalizedExternalSnapshot.generatedAt,
      source: normalizedExternalSnapshot.source,
      version: normalizedExternalSnapshot.version,
      hasExternalData: normalizedExternalSnapshot?.diagnostics?.hasExternalData === true,
      playerKeyCount: Number(normalizedExternalSnapshot?.diagnostics?.playerKeyCount || 0),
      eventContextCount: Number(normalizedExternalSnapshot?.diagnostics?.eventContextCount || 0),
      playersByEventCount: Number(normalizedExternalSnapshot?.diagnostics?.playersByEventCount || 0),
      probablePitcherEventCount: Number(normalizedExternalSnapshot?.diagnostics?.probablePitcherEventCount || 0),
      lineupConfirmationEventCount: Number(normalizedExternalSnapshot?.diagnostics?.lineupConfirmationEventCount || 0),
      teamContextEventCount: Number(normalizedExternalSnapshot?.diagnostics?.teamContextEventCount || 0),
      recentStatsPlayerCount: Number(normalizedExternalSnapshot?.diagnostics?.recentStatsPlayerCount || 0),
      fetchReadiness: normalizedExternalSnapshot?.diagnostics?.fetchReadiness || null
    }
  }
}

module.exports = {
  enrichMlbRowsWithExternalContext,
  buildMlbEnrichmentDiagnostics
}
