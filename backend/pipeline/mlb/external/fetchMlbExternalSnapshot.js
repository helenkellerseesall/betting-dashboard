"use strict"

const { EDGE_SOURCE_CONFIG } = require("../../edge/sourceConfig")
const { getSportConfig } = require("../../sports/sportConfig")
const {
  createEmptyMlbExternalSnapshot,
  normalizeMlbExternalSnapshotShape
} = require("../enrichment/buildMlbExternalSnapshotScaffold")
const { fetchMlbApiSportsScaffold } = require("./adapters/fetchMlbApiSportsScaffold")
const { fetchMlbOfficialLineupsSnapshot } = require("./adapters/fetchMlbOfficialLineupsSnapshot")
const { mergeMlbExternalSnapshots } = require("./mergeMlbExternalSnapshots")

const MLB_EXTERNAL_ADAPTERS = {
  mlb_api_sports: fetchMlbApiSportsScaffold,
  mlb_official_lineups: fetchMlbOfficialLineupsSnapshot,
  rotowire_mlb: null,
  fangraphs_lineups: null,
  mlb_official_injury_report: null
}

function toSafeSourceName(value) {
  return String(value || "").trim().toLowerCase()
}

function getPreferredMlbSource({ sourceName } = {}) {
  const fromParam = toSafeSourceName(sourceName)
  if (fromParam) return fromParam

  const mlbConfig = getSportConfig("mlb") || {}
  const fromSportConfig = toSafeSourceName(mlbConfig?.externalData?.preferredSource)
  if (fromSportConfig) return fromSportConfig

  const trustedStack = Array.isArray(EDGE_SOURCE_CONFIG?.mlbTrustedSourceStack)
    ? EDGE_SOURCE_CONFIG.mlbTrustedSourceStack
    : []
  if (trustedStack.length) return toSafeSourceName(trustedStack[0])

  return "mlb_api_sports"
}

async function fetchMlbExternalSnapshot({
  events = [],
  now = Date.now(),
  sourceName,
  sourceOptions = {}
} = {}) {
  const selectedSource = getPreferredMlbSource({ sourceName })
  const mlbConfig = getSportConfig("mlb") || {}
  const liveFetchEnabled = mlbConfig?.externalData?.enableLiveFetch !== false
  const adapter = MLB_EXTERNAL_ADAPTERS[selectedSource]
  const lineupOverlaySource = toSafeSourceName(
    sourceOptions?.lineupOverlaySource ||
    mlbConfig?.externalData?.lineupOverlaySource ||
    ""
  )
  const lineupOverlayEnabled = sourceOptions?.enableLineupOverlay !== false && mlbConfig?.externalData?.enableLineupOverlay !== false
  const overlayAdapter = lineupOverlayEnabled ? MLB_EXTERNAL_ADAPTERS[lineupOverlaySource] : null

  if (!liveFetchEnabled) {
    const empty = createEmptyMlbExternalSnapshot({
      now,
      source: selectedSource || "mlb-external-scaffold"
    })

    return {
      ...empty,
      diagnostics: {
        ...(empty.diagnostics || {}),
        fetchReadiness: {
          selectedSource,
          adapter: adapter?.name || null,
          mode: "live-fetch-disabled",
          fetchAttempted: false,
          eventCountInput: Array.isArray(events) ? events.length : 0,
          notes: [
            "MLB external live fetch disabled in sport config."
          ]
        }
      }
    }
  }

  if (typeof adapter !== "function") {
    const empty = createEmptyMlbExternalSnapshot({
      now,
      source: selectedSource || "mlb-external-scaffold"
    })

    const withReadiness = {
      ...empty,
      diagnostics: {
        ...(empty.diagnostics || {}),
        fetchReadiness: {
          selectedSource,
          adapter: null,
          mode: "unsupported-source",
          fetchAttempted: false,
          eventCountInput: Array.isArray(events) ? events.length : 0,
          notes: [
            `No MLB external adapter is implemented yet for source '${selectedSource}'.`
          ]
        }
      }
    }

    return normalizeMlbExternalSnapshotShape(withReadiness, { now })
  }

  try {
    const fetched = await adapter({ events, now, sourceOptions })
    let normalized = normalizeMlbExternalSnapshotShape(fetched, { now })

    if (
      selectedSource === "mlb_api_sports" &&
      lineupOverlayEnabled &&
      lineupOverlaySource &&
      typeof overlayAdapter === "function" &&
      lineupOverlaySource !== selectedSource
    ) {
      const overlayFetched = await overlayAdapter({ events, now, sourceOptions })
      const normalizedOverlay = normalizeMlbExternalSnapshotShape(overlayFetched, { now })
      normalized = normalizeMlbExternalSnapshotShape(
        mergeMlbExternalSnapshots({
          baseSnapshot: normalized,
          overlaySnapshot: normalizedOverlay,
          overlaySourceName: lineupOverlaySource
        }),
        { now }
      )
    }

    return {
      ...normalized,
      diagnostics: {
        ...(normalized.diagnostics || {}),
        fetchReadiness: {
          ...(normalized?.diagnostics?.fetchReadiness || {}),
          selectedSource,
          adapter: adapter.name || "anonymous-adapter",
          mode: "adapter-ok",
          fetchAttempted: normalized?.diagnostics?.fetchReadiness?.fetchAttempted === true,
          eventCountInput: Array.isArray(events) ? events.length : 0
        }
      }
    }
  } catch (error) {
    const empty = createEmptyMlbExternalSnapshot({ now, source: selectedSource })

    return {
      ...empty,
      diagnostics: {
        ...(empty.diagnostics || {}),
        fetchReadiness: {
          selectedSource,
          adapter: adapter.name || "anonymous-adapter",
          mode: "adapter-error",
          fetchAttempted: true,
          eventCountInput: Array.isArray(events) ? events.length : 0,
          error: String(error?.message || error),
          notes: [
            "Adapter error occurred; using empty external snapshot fallback."
          ]
        }
      }
    }
  }
}

module.exports = {
  fetchMlbExternalSnapshot,
  getPreferredMlbSource,
  MLB_EXTERNAL_ADAPTERS
}
