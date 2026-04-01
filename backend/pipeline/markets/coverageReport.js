function toKey(value) {
  return String(value || "").trim()
}

function bump(map, key, amount = 1) {
  const safeKey = toKey(key) || "unknown"
  map[safeKey] = (map[safeKey] || 0) + amount
  return map
}

function buildCountMap(rows, keySelector) {
  const out = {}
  const safeRows = Array.isArray(rows) ? rows : []

  for (const row of safeRows) {
    const key = keySelector(row)
    bump(out, key)
  }

  return out
}

function buildRequestedMarketMap(requestedMarketKeys = []) {
  const out = {}
  const safeKeys = Array.isArray(requestedMarketKeys) ? requestedMarketKeys : []

  for (const key of safeKeys) {
    bump(out, key)
  }

  return out
}

function buildCoverageReport({
  requestedMarketKeys = [],
  returnedRows = [],
  acceptedRows = [],
  rejectedRows = [],
  finalRows = []
} = {}) {
  const requestedByMarketKey = buildRequestedMarketMap(requestedMarketKeys)

  const returnedByMarketKey = buildCountMap(
    returnedRows,
    (row) => row?.marketKey
  )

  const acceptedByMarketKey = buildCountMap(
    acceptedRows,
    (row) => row?.marketKey
  )

  const finalByMarketKey = buildCountMap(
    finalRows,
    (row) => row?.marketKey
  )

  const rejectedByMarketKey = buildCountMap(
    rejectedRows,
    (row) => row?.marketKey
  )

  const rejectedByReason = buildCountMap(
    rejectedRows,
    (row) => row?.rejectReason
  )

  const allKeys = Array.from(
    new Set([
      ...Object.keys(requestedByMarketKey),
      ...Object.keys(returnedByMarketKey),
      ...Object.keys(acceptedByMarketKey),
      ...Object.keys(rejectedByMarketKey),
      ...Object.keys(finalByMarketKey)
    ])
  ).sort()

  const marketCoverage = allKeys.map((marketKey) => ({
    marketKey,
    requested: requestedByMarketKey[marketKey] || 0,
    returned: returnedByMarketKey[marketKey] || 0,
    accepted: acceptedByMarketKey[marketKey] || 0,
    rejected: rejectedByMarketKey[marketKey] || 0,
    final: finalByMarketKey[marketKey] || 0
  }))

  return {
    totals: {
      requestedMarkets: Array.isArray(requestedMarketKeys) ? requestedMarketKeys.length : 0,
      returnedRows: Array.isArray(returnedRows) ? returnedRows.length : 0,
      acceptedRows: Array.isArray(acceptedRows) ? acceptedRows.length : 0,
      rejectedRows: Array.isArray(rejectedRows) ? rejectedRows.length : 0,
      finalRows: Array.isArray(finalRows) ? finalRows.length : 0
    },
    requestedByMarketKey,
    returnedByMarketKey,
    acceptedByMarketKey,
    rejectedByMarketKey,
    rejectedByReason,
    finalByMarketKey,
    marketCoverage
  }
}

module.exports = {
  buildCoverageReport
}