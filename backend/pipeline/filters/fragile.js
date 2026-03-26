const FRAGILE_FILTER_ADJUSTED_LOG_LIMIT = 20
let fragileFilterAdjustedLogCount = 0

function resetFragileFilterAdjustedLogCount() {
  fragileFilterAdjustedLogCount = 0
}

function getFragileLegDiagnostics(row, mode = "default") {
  // STEP 3: Prevent filters from removing force-included watched players
  if (row?.__forceInclude) {
    return {
      fragile: false,
      reasons: ["force_included_watched_player"],
      skippedMissing: {
        avgMin: 0,
        minFloor: 0,
        minStd: 0,
        valueStd: 0,
        trendRisk: 0
      }
    }
  }

  const reasons = []
  const parseOptionalNumber = (value) => {
    if (value === null || value === undefined) return { usable: false, value: null }
    if (typeof value === "string" && value.trim() === "") return { usable: false, value: null }
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return { usable: false, value: null }
    return { usable: true, value: numeric }
  }

  const parseOptionalLabel = (value) => {
    if (value === null || value === undefined) return { usable: false, value: "" }
    const text = String(value).trim().toLowerCase()
    if (!text) return { usable: false, value: "" }
    return { usable: true, value: text }
  }

  const avgMinMetric = parseOptionalNumber(row?.avgMin)
  const minFloorMetric = parseOptionalNumber(row?.minFloor)
  const minStdMetric = parseOptionalNumber(row?.minStd)
  const valueStdMetric = parseOptionalNumber(row?.valueStd)
  const trendRiskMetric = parseOptionalLabel(row?.trendRisk)

  const skippedMissing = {
    avgMin: avgMinMetric.usable ? 0 : 1,
    minFloor: minFloorMetric.usable ? 0 : 1,
    minStd: minStdMetric.usable ? 0 : 1,
    valueStd: valueStdMetric.usable ? 0 : 1,
    trendRisk: trendRiskMetric.usable ? 0 : 1
  }

  if (fragileFilterAdjustedLogCount < FRAGILE_FILTER_ADJUSTED_LOG_LIMIT) {
    console.log("[FRAGILE-FILTER-ADJUSTED]", {
      avgMin: row?.avgMin,
      minFloor: row?.minFloor,
      trendRisk: row?.trendRisk,
      minStd: row?.minStd,
      valueStd: row?.valueStd,
      skippedMissing
    })
    fragileFilterAdjustedLogCount += 1
  }

  if (mode === "best") {
    if (avgMinMetric.usable && avgMinMetric.value < 22) reasons.push("avgMin_lt_22_best")
  } else {
    if (avgMinMetric.usable && avgMinMetric.value < 22) reasons.push("avgMin_lt_22")
  }
  if (mode !== "best" && minFloorMetric.usable && minFloorMetric.value > 0 && minFloorMetric.value < 10) reasons.push("minFloor_between_0_and_10")
  if (minStdMetric.usable && minStdMetric.value >= 9) reasons.push("minStd_gte_9")
  if (valueStdMetric.usable && valueStdMetric.value >= 11) reasons.push("valueStd_gte_11")
  if (trendRiskMetric.usable && trendRiskMetric.value === "high") reasons.push("trendRisk_high")

  return {
    fragile: reasons.length > 0,
    reasons,
    skippedMissing
  }
}

function isFragileLeg(row, mode = "default") {
  return getFragileLegDiagnostics(row, mode).fragile
}

module.exports = {
  isFragileLeg,
  getFragileLegDiagnostics,
  resetFragileFilterAdjustedLogCount
}
