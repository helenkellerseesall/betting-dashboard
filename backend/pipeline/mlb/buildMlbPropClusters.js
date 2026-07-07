"use strict"

// 2026-05-29 — Lane B Phase 3 v0.3.0 — calibration feedback wire.
// Reads historical per-(family, side) hit rates from outcome_snapshots ×
// prediction_snapshots and returns a multiplicative adjustment factor.
// Sample-weighted Bayesian shrinkage prevents over-correction on small
// samples. Safe default 1.0 when DB unavailable or sample too small.
const { getCalibrationFactor: _getCalFactor } = require("../grading/calibrationFeedback")

// 2026-06-08 SHIP 2 — stolen-bases kill-switch (mirror of buildMlbPlayerDataset.js).
// Read ONCE at module load. unset/"1" → ON; ONLY exact "0" → OFF. OFF ⇒ resolveStatFamily
// never returns "stolenBases" (rows drop exactly like today) ⇒ classifier/tier/board
// byte-identical to pre-SHIP-2. ON ⇒ SB is a CAPPED-tier family (never ELITE/STRONG).
const SB_ENABLED = String(process.env.MLB_ENABLE_STOLEN_BASES ?? "1") !== "0"

// 2026-06-11 R2 (MLB-Tier-Assignment-Fix v1) — canonical odds-bucket arithmetic
// imported from the NBA tier classifier (Law 1: ONE bucketForOdds owner; the
// function is sport-agnostic odds math — importing extends the canonical,
// duplicating it would spawn a sibling).
const { bucketForOdds } = require("../nba/nbaTierClassifier")

// 2026-06-11 R2 — kill-switch (precedent: NBA_BUCKET_TIER_POLICY in
// nbaTierClassifier.js:81, CALIB_LINEAWARE, SB_ENABLED above). Read ONCE at
// module load. unset/"1" → ON; ONLY the exact string "0" → OFF. OFF ⇒ tier
// outputs AND tracked artifacts byte-identical to pre-R2 (the tierPolicy stamp
// is ABSENT when OFF — never null, never "off"). Flip requires a backend
// reload — deliberate operator action, not a mid-flight toggle.
const MLB_TIER_POLICY_ON = String(process.env.MLB_BUCKET_TIER_POLICY ?? "1") !== "0"
try {
  console.log(`[TIER-POLICY-BOOT] MLB bucket tier policy ${MLB_TIER_POLICY_ON ? "ON (default) — mlb-r2-v1" : "OFF — MLB_BUCKET_TIER_POLICY=0, pre-R2-identical"}`)
} catch (_) { /* no-op */ }

// 2026-07-01 G1 / POST_FREEZE STEP 1 — marginal calibration LIVE wire, behind a
// NEW default-OFF switch (CALIB_LINEAWARE / MLB_BUCKET_TIER_POLICY pattern; read
// ONCE at module load; flip needs a backend reload). When ON, the validated MLB
// isotonic remap (backend/config/mlbMarginalCalibration.json — the SAME map the G1
// forward gate probeCalibrationForward PASSED 2026-07-01) recalibrates modelProb
// BEFORE edge → ev → tier, so live selection derives from the calibrated prob.
// OFF ⇒ raw modelProb ⇒ scoring + tracked artifacts byte-identical to pre-G1 (the
// calibVersion / modelProbRaw stamps are ABSENT when OFF — never null). The 14d
// verify filters on calibVersion === "mlb-calib-live-v1". calibrateModelProb never
// throws and returns null only if the shadow module is disabled → fall back to raw.
// Rollback = unset MLB_CALIB_LIVE (=0) + backend kickstart ⇒ byte-identical.
const MLB_CALIB_LIVE = String(process.env.MLB_CALIB_LIVE ?? "0") === "1"
// Conditional require (matches calibrationDampener) so OFF loads nothing new ⇒ truly
// byte-identical. calibrateModelProb is CALLED only inside the MLB_CALIB_LIVE branch below.
let _calibrateModelProb = null
// 2026-07-06 G1 map-hygiene v2 — the calibVersion stamp now comes from the maps
// config via the engine (mapsVersion), not a hardcoded literal, so map re-trains
// (v2, v3…) separate eras in the tracked record automatically. Fallback literal
// covers a legacy engine/config without the export.
let _calibVersionStamp = "mlb-calib-live-v1"
if (MLB_CALIB_LIVE) {
  try {
    const _mc = require("./mlbMarginalCalibration")
    _calibrateModelProb = _mc.calibrateModelProb
    if (typeof _mc.mapsVersion === "string" && _mc.mapsVersion) _calibVersionStamp = _mc.mapsVersion
  }
  catch (e) { console.log(`[MLB-CALIB-LIVE-BOOT] isotonic module unavailable (${e && e.code ? e.code : e}) — scoring stays on raw modelProb`) }
}
try {
  console.log(`[MLB-CALIB-LIVE-BOOT] scoring modelProb calibration ${MLB_CALIB_LIVE ? "ON — isotonic remap live (mlb-calib-live-v1)" : "OFF (default) — raw modelProb, pre-G1-identical"}`)
} catch (_) { /* no-op */ }

// 2026-07-05 G1-Serve-1A — SERVED-SURFACE calibration injection (operator-approved
// follow-up to G1 STEP 1; scope: OPERATOR_SESSION_LOG 2026-07-05 23:00 Claude-A mission).
// WHY: G1 calibrates modelProb at BOARD scoring (above), but the SERVED best-available
// surface (server.js buildMlbLiveDualBestAvailablePayload → safeBest → /api/best-available
// → recordMlbBestProps → mlb_tracked_best) carries a DIFFERENT raw quantity
// (predictedProbability, hydrated at snapshot time via impliedProb×0.6 + signal×0.4) that
// never sees the remap — so what the operator SEES/BETS/self-grades stayed raw after the
// 07-01 flip.
// HOW (calibrate ONCE, Law 1): the calibrated quantity ORIGINATES here (makePlay stamps
// calibVersion). buildMlbBestBetsBoard registers a module-scope index of its stamped plays;
// injectMlbCalibratedServeProbs() joins that index onto best-available rows by
// (player|family|side|line|book) and sets predictedProbability = calibrated modelProb
// (+ modelProbRaw + calibVersion ride along). NO re-calibration at the serializer — the
// isotonic map's input axis is BOARD rawModelProb; feeding it the serve-surface
// predictedProbability (a different model's output) would be statistically unfounded.
// Join-only = the same play's already-calibrated value, never recomputed (anti-double-calib).
// GUARDS: OFF ⇒ injector returns the SAME array reference (byte-identical). Index is
// slate-scoped (currentSlateDateEt, 4 AM ET boundary per slate-date doctrine) — an
// empty/stale index skips injection LOUDLY. Rows with no board match stay raw + UNSTAMPED
// (absence of calibVersion = honest "raw" marker; never fabricate). Module-scope state
// (called out per OPERATOR_PROTOCOL "no hidden state"): process-local, rebuilt on every
// board build; empty until the first board build after boot — that first payload serves
// raw/unstamped, honestly logged.
const { currentSlateDateEt: _serveSlateDate } = require("../shared/slateDate")
let __mlbCalibratedServeIndex = { slateDate: null, builtAt: 0, byKey: new Map() }

// ONE key builder for BOTH sides of the join (board play: statFamily/sportsbook;
// serve row: resolveStatFamily(row)/book). Mirrors marketPropsFromMlbRows normalization
// (yes→over, no→under, HR default side "over", HR missing line → 0.5) so the two
// representations of the same prop produce identical keys.
function _serveCalibKey(obj, family) {
  const player = String(obj?.player || "").trim().toLowerCase()
  if (!player || !family) return null
  let side = String(obj?.side || "").trim().toLowerCase()
  if (side === "yes") side = "over"
  if (side === "no") side = "under"
  if (!side && family === "hr") side = "over"
  let line = Number(obj?.line)
  if (!Number.isFinite(line)) {
    if (family === "hr") line = 0.5
    else return null
  }
  const book = String(obj?.sportsbook || obj?.book || "").toLowerCase().replace(/\s+/g, "")
  if (!side || !book) return null
  return `${player}|${family}|${side}|${line}|${book}`
}

function registerMlbCalibratedServeIndex(plays) {
  if (!MLB_CALIB_LIVE) return
  const byKey = new Map()
  for (const p of Array.isArray(plays) ? plays : []) {
    if (!p || p.calibVersion == null || !Number.isFinite(Number(p.modelProb))) continue
    const k = _serveCalibKey(p, p.statFamily)
    if (k && !byKey.has(k)) byKey.set(k, { modelProb: Number(p.modelProb), modelProbRaw: p.modelProbRaw ?? null, calibVersion: p.calibVersion })
  }
  __mlbCalibratedServeIndex = { slateDate: _serveSlateDate(), builtAt: Date.now(), byKey }
}

// Read-only introspection (fixtures + diagnostics). Never exposes the Map itself.
function getMlbCalibratedServeIndex() {
  return { slateDate: __mlbCalibratedServeIndex.slateDate, builtAt: __mlbCalibratedServeIndex.builtAt, size: __mlbCalibratedServeIndex.byKey.size }
}

function injectMlbCalibratedServeProbs(rows, opts = {}) {
  if (!MLB_CALIB_LIVE) return rows
  if (!Array.isArray(rows) || rows.length === 0) return rows
  const idx = opts.__testIndex || __mlbCalibratedServeIndex
  if (!idx || !(idx.byKey instanceof Map) || idx.byKey.size === 0) {
    console.log("[MLB-CALIB-SERVE] skip: no calibrated board index yet (first payload after boot?) — best rows stay raw/unstamped")
    return rows
  }
  const today = opts.slateDate || _serveSlateDate()
  if (idx.slateDate !== today) {
    console.log(`[MLB-CALIB-SERVE] skip: index slate ${idx.slateDate} != current ${today} — best rows stay raw/unstamped`)
    return rows
  }
  let injected = 0
  const out = rows.map((r) => {
    const fam = resolveStatFamily(r)
    const k = fam ? _serveCalibKey(r, fam) : null
    const hit = k ? idx.byKey.get(k) : null
    if (!hit) return r
    injected += 1
    // COPY, never mutate — the raw row objects are shared with intra-payload
    // consumers (slips/clusters) whose behavior this step must not change.
    return { ...r, predictedProbability: hit.modelProb, modelProbRaw: hit.modelProbRaw, calibVersion: hit.calibVersion }
  })
  console.log(`[MLB-CALIB-SERVE] injected calibrated prob onto ${injected}/${rows.length} best rows (slate ${today}, index ${idx.byKey.size} plays)`)
  return out
}

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function norm(s) {
  return String(s || "").trim().toLowerCase()
}

function isUnderSide(row) {
  const s = norm(row?.side ?? row?.__src?.side)
  return s === "under" || s === "no"
}

function getEventId(row) {
  const ev = String(row?.eventId ?? row?.__src?.eventId ?? row?.__src?.gameId ?? row?.gameId ?? "").trim()
  return ev || null
}

function isHighUpsideRow(row, bucket) {
  const odds = toNum(row?.odds)
  if (bucket === "hr") return true
  return odds != null && odds >= 300
}

function normalizePropTypeKey(row) {
  return String(row?.propType || "").toLowerCase().replace(/[^a-z]/g, "")
}

function classifyRowBuckets(propType) {
  const isHR = propType.includes("homerun") || propType.includes("hr")
  const isRBI = propType.includes("rbi")
  const isTB = propType.includes("totalbase") || propType.includes("tb")
  const isHits = propType.includes("hit")
  return { isHR, isRBI, isTB, isHits, propType }
}

function passesHardQualityFilter(row, { isHR, isRBI, isTB, isHits }) {
  const pred = toNum(row?.predictedProbability)
  const edge = toNum(row?.edgeProbability)
  const decision = toNum(row?.decisionScore)
  const itt = toNum(row?.impliedTeamTotal)
  const lp = toNum(row?.lineupPosition)

  if (isHits || isTB) {
    return (pred != null && pred >= 0.45) || (decision != null && decision >= 0.5)
  }
  if (isRBI) {
    return (
      itt != null &&
      itt >= 4.5 &&
      (lp == null || lp <= 5)
    )
  }
  if (isHR) {
    return (pred != null && pred >= 0.12) || (edge != null && edge >= 0.08)
  }
  return false
}

function computeHrClusterScore(row) {
  const pred = toNum(row?.predictedProbability) ?? 0
  const edge = toNum(row?.edgeProbability) ?? 0
  const odds = toNum(row?.odds) ?? 0
  let hrScore = pred * 0.5 + edge * 0.3 + Math.min(odds / 1000, 1) * 0.2
  if (pred < 0.08) hrScore *= 0.5
  return Number(hrScore) || 0
}

function computeRbiClusterScore(row) {
  let score = 0

  const predicted = Number(row?.predictedProbability || 0)
  const edge = Number(row?.edgeProbability || 0)
  const decision = Number(row?.decisionScore || 0)
  const teamTotal = Number(row?.impliedTeamTotal || 0)
  const lineup = Number(row?.lineupPosition || 9)
  const platoon = row?.isPlatoonAdvantage ? 1 : 0
  const odds = Number(row?.odds || 0)

  score += predicted * 5
  score += edge * 4
  score += decision * 2

  score += teamTotal * 1.5

  if (lineup <= 5) score += 2
  if (lineup <= 3) score += 1

  if (platoon) score += 1

  score += Math.min(odds / 200, 2)

  return Number(score) || 0
}

/** Pick score for “best prop per player” across buckets (each row only matches one bucket). */
function clusterPickScoreForRow(row, { isHR, isRBI, isTB, isHits }) {
  if (isHR) return computeHrClusterScore(row)
  if (isRBI) return computeRbiClusterScore(row)
  if (isTB || isHits) {
    const p = toNum(row?.predictedProbability) ?? 0
    const e = toNum(row?.edgeProbability) ?? 0
    const d = toNum(row?.decisionScore) ?? 0
    const o = toNum(row?.odds) ?? 0
    return p * 2 + e * 2 + d * 2 + Math.min(o / 1000, 1) * 0.15
  }
  return 0
}

function sortControlledFinal(a, b) {
  const predA = toNum(a?.predictedProbability)
  const predB = toNum(b?.predictedProbability)
  const pA = predA != null ? predA : -1
  const pB = predB != null ? predB : -1
  if (pB !== pA) return pB - pA

  const edgeA = toNum(a?.edgeProbability)
  const edgeB = toNum(b?.edgeProbability)
  const eA = edgeA != null ? edgeA : -1
  const eB = edgeB != null ? edgeB : -1
  if (eB !== eA) return eB - eA

  const decA = toNum(a?.decisionScore)
  const decB = toNum(b?.decisionScore)
  const dA = decA != null ? decA : -1
  const dB = decB != null ? decB : -1
  if (dB !== dA) return dB - dA

  const oA = toNum(a?.odds)
  const oB = toNum(b?.odds)
  const oddsA = oA != null ? oA : 1e9
  const oddsB = oB != null ? oB : 1e9
  return oddsA - oddsB
}

function uniqByKey(rows, keyFn) {
  const seen = new Set()
  const out = []
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = keyFn(r)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }
  return out
}

function projectRow(row, bucket) {
  return {
    player: row?.player ?? null,
    team: row?.team ?? null,
    propType: row?.propType ?? null,
    line: row?.line ?? null,
    odds: row?.odds ?? null,
    eventId: getEventId(row),
    isHighUpside: Boolean(isHighUpsideRow(row, bucket))
  }
}

function computeMixSliceSizes({ hitsTarget, tbTarget, rbiTarget, hrTarget }) {
  const T = hitsTarget + tbTarget + rbiTarget + hrTarget
  const minNonHr = 4

  let slotHitsTb = Math.round(0.4 * T)
  let slotRbi = Math.round(0.35 * T)
  let slotHr = Math.round(0.25 * T)

  const drift = T - (slotHitsTb + slotRbi + slotHr)
  slotRbi += drift

  const maxNonHrSlots = hitsTarget + tbTarget + rbiTarget
  const nonHrPlanned = Math.min(maxNonHrSlots, slotHitsTb + slotRbi)
  if (nonHrPlanned < minNonHr) {
    const deficit = minNonHr - nonHrPlanned
    slotHr = Math.max(0, slotHr - deficit)
  }
  slotHr = Math.min(slotHr, hrTarget, Math.max(0, T - minNonHr))

  const denom = hitsTarget + tbTarget || 1
  let hitsSlice = Math.min(hitsTarget, Math.round(slotHitsTb * (hitsTarget / denom)))
  let tbSlice = Math.min(tbTarget, Math.max(0, slotHitsTb - hitsSlice))
  if (hitsSlice === 0 && hitsTarget > 0 && slotHitsTb > 0) hitsSlice = Math.min(hitsTarget, slotHitsTb)
  if (tbSlice === 0 && tbTarget > 0 && slotHitsTb > 0) tbSlice = Math.min(tbTarget, slotHitsTb - hitsSlice)
  hitsSlice = Math.min(hitsSlice, hitsTarget)
  tbSlice = Math.min(tbSlice, tbTarget)
  let rbiSlice = Math.min(rbiTarget, slotRbi)
  let hrSlice = Math.min(hrTarget, slotHr)

  const used = hitsSlice + tbSlice + rbiSlice + hrSlice
  if (used < T) {
    const extra = T - used
    rbiSlice = Math.min(rbiTarget, rbiSlice + extra)
  }

  return { hitsSlice, tbSlice, rbiSlice, hrSlice }
}

function buildMlbPropClusters(rows, opts = {}) {
  if (!Array.isArray(rows)) {
    return {
      hrCluster: [],
      rbiCluster: [],
      tbCluster: [],
      hitsCluster: []
    }
  }

  console.log("[MLB PROP CLUSTERS]", {
    rows: rows.length
  })

  const hrTarget = Math.max(6, Math.min(10, Number(opts.hrTarget ?? 8)))
  const rbiTarget = Math.max(1, Math.min(25, Number(opts.rbiTarget ?? 8)))
  const tbTarget = Math.max(1, Math.min(25, Number(opts.tbTarget ?? 8)))
  const hitsTarget = Math.max(1, Math.min(25, Number(opts.hitsTarget ?? 8)))

  let total = 0
  let afterEvent = 0
  let afterType = 0

  const base = (Array.isArray(rows) ? rows : []).filter((row) => {
    total += 1
    if (!row) return false
    if (!String(row?.player || "").trim()) return false
    const rawPropType = String(row?.propType || "")
    const propType = rawPropType.toLowerCase().replace(/[^a-z]/g, "")
    if (!propType.trim()) return false
    const odds = Number(row?.odds)
    const line = toNum(row?.line)
    if (!Number.isFinite(odds) || line == null) return false
    const ev = getEventId(row)
    if (!ev) return false
    afterEvent += 1
    if (isUnderSide(row)) return false
    const { isHR, isRBI, isTB, isHits } = classifyRowBuckets(propType)
    if (isHR || isRBI || isTB || isHits) afterType += 1
    return true
  })

  console.log("[PROP CLUSTER DEBUG]", {
    total,
    afterEvent,
    afterType
  })

  const filteredRows = []
  for (const row of base) {
    const { isHR, isRBI, isTB, isHits, propType } = classifyRowBuckets(normalizePropTypeKey(row))
    if (!(isHR || isRBI || isTB || isHits)) continue
    if (!passesHardQualityFilter(row, { isHR, isRBI, isTB, isHits })) continue
    filteredRows.push(row)
  }

  const scoredForPick = filteredRows
    .map((row) => {
      const { isHR, isRBI, isTB, isHits } = classifyRowBuckets(normalizePropTypeKey(row))
      const score = clusterPickScoreForRow(row, { isHR, isRBI, isTB, isHits })
      return { row, score, isHR, isRBI, isTB, isHits }
    })
    .sort((a, b) => b.score - a.score)

  const bestPropByPlayer = {}
  for (const { row, score, isHR, isRBI, isTB, isHits } of scoredForPick) {
    const playerKey = norm(row?.player)
    if (!playerKey) continue
    const prev = bestPropByPlayer[playerKey]
    if (!prev || score > prev.score) {
      bestPropByPlayer[playerKey] = { row, score, isHR, isRBI, isTB, isHits }
    }
  }

  const dedupedRows = Object.values(bestPropByPlayer).map((x) => x.row)

  console.log("[CONTROLLED AGGRESSION]", {
    totalRows: rows.length,
    afterFilter: filteredRows.length,
    playersSelected: Object.keys(bestPropByPlayer).length
  })

  const byBucket = {
    hr: [],
    rbi: [],
    tb: [],
    hits: []
  }

  for (const row of dedupedRows) {
    const { isHR, isRBI, isTB, isHits } = classifyRowBuckets(normalizePropTypeKey(row))
    if (isHR) byBucket.hr.push(row)
    else if (isRBI) byBucket.rbi.push(row)
    else if (isTB) byBucket.tb.push(row)
    else if (isHits) byBucket.hits.push(row)
  }

  const dedupeKey = (r) => [getEventId(r), norm(r?.player), norm(r?.propType), String(r?.line ?? "")].join("|")
  byBucket.hr = uniqByKey(byBucket.hr, dedupeKey)
  byBucket.rbi = uniqByKey(byBucket.rbi, dedupeKey)
  byBucket.tb = uniqByKey(byBucket.tb, dedupeKey)
  byBucket.hits = uniqByKey(byBucket.hits, dedupeKey)

  const { hitsSlice, tbSlice, rbiSlice, hrSlice } = computeMixSliceSizes({
    hitsTarget,
    tbTarget,
    rbiTarget,
    hrTarget
  })

  const hrRowsSorted = [...byBucket.hr].filter((row) => {
    if (!String(row?.player || "").trim()) return false
    const odds = Number(row?.odds)
    return Number.isFinite(odds)
  }).sort(sortControlledFinal)

  let hrCluster = hrRowsSorted.slice(0, hrSlice).map((row) => {
    const hrClusterScore = computeHrClusterScore(row)
    return {
      player: row.player,
      team: row.team,
      propType: row.propType,
      line: row.line,
      odds: row.odds,
      eventId:
        row.eventId ||
        row.__src?.eventId ||
        row.gameId ||
        null,
      isHighUpside: row.isHighUpside ?? (Number(row.odds) >= 300),
      hrClusterScore,
      predictedProbability: row.predictedProbability ?? null,
      edgeProbability: row.edgeProbability ?? null,
      impliedTeamTotal: row.impliedTeamTotal ?? null,
      lineupPosition: row.lineupPosition ?? null,
      isPlatoonAdvantage: row.isPlatoonAdvantage ?? null
    }
  })

  console.log("[HR CLUSTER SIZE]", hrCluster.length)
  console.log("[HR SCORE CHECK]", hrCluster.slice(0, 5).map((r) => ({
    player: r.player,
    score: r.hrClusterScore
  })))
  console.log("[HR CLUSTER DEBUG]", hrCluster.slice(0, 10).map((r) => ({
    player: r.player,
    odds: r.odds,
    hrClusterScore: r.hrClusterScore,
    predictedProbability: r.predictedProbability,
    edgeProbability: r.edgeProbability,
    impliedTeamTotal: r.impliedTeamTotal,
    lineupPosition: r.lineupPosition,
    isPlatoonAdvantage: r.isPlatoonAdvantage
  })))

  const rbiRowsSorted = [...byBucket.rbi].filter((row) => {
    const itt = toNum(row?.impliedTeamTotal)
    return itt != null && itt >= 4.5
  }).sort(sortControlledFinal)

  const rbiOut = rbiRowsSorted.slice(0, rbiSlice).map((row) => {
    const rbiClusterScore = computeRbiClusterScore(row)
    return {
      player: row?.player ?? null,
      team: row?.team ?? null,
      propType: row?.propType ?? null,
      line: row?.line ?? null,
      odds: row?.odds ?? null,
      eventId: getEventId(row),
      isHighUpside: Boolean(isHighUpsideRow(row, "rbi")),
      rbiClusterScore,
      predictedProbability: row?.predictedProbability ?? null,
      edgeProbability: row?.edgeProbability ?? null,
      impliedTeamTotal: row?.impliedTeamTotal ?? null,
      lineupPosition: row?.lineupPosition ?? null,
      isPlatoonAdvantage: row?.isPlatoonAdvantage ?? null
    }
  })

  console.log("[RBI CLUSTER DEBUG]", rbiOut.slice(0, 10).map((r) => ({
    player: r.player,
    odds: r.odds,
    score: r.rbiClusterScore,
    teamTotal: r.impliedTeamTotal,
    lineup: r.lineupPosition
  })))

  const tbSorted = [...byBucket.tb].sort(sortControlledFinal)
  const tbCluster = tbSorted.slice(0, tbSlice).map((r) => projectRow(r, "tb"))

  const hitsSorted = [...byBucket.hits].sort(sortControlledFinal)
  const hitsCluster = hitsSorted.slice(0, hitsSlice).map((r) => projectRow(r, "hits"))

  console.log("[PROP TYPE SAMPLE]", rows.slice(0, 5).map((r) => r?.propType))

  return {
    hrCluster: hrCluster || [],
    rbiCluster: rbiOut || [],
    tbCluster: tbCluster || [],
    hitsCluster: hitsCluster || []
  }
}



// ---- Best bets board (edge / EV / tiers) — unified with prop clusters ----
// 2026-06-08 SHIP 2 — "stolenBases" appended only when the kill-switch is ON, so OFF
// leaves the family registry (and every family iteration downstream) byte-identical.
const STAT_FAMILIES = [
  "hits",
  "totalBases",
  "hr",
  "rbis",
  "runs",
  "batterKs",
  "ks",
  "outs",
  "hitsAllowed",
  "earnedRuns",
  "walks",
  ...(SB_ENABLED ? ["stolenBases"] : []),
]

function americanOddsToImpliedProb(odds) {
  const n = Number(odds)
  if (!Number.isFinite(n) || n === 0) return null
  if (n < 0) return Math.abs(n) / (Math.abs(n) + 100)
  return 100 / (n + 100)
}

function americanToDecimal(odds) {
  const n = Number(odds)
  if (!Number.isFinite(n) || n === 0) return null
  if (n < 0) return 1 + 100 / Math.abs(n)
  return 1 + n / 100
}

/**
 * Sigma floors per stat family. MLB stats are integer / low-count Poisson-like,
 * so sigma anchors are tight (much smaller than NBA's points/rebounds bands).
 */
function minSigmaByFamily(family) {
  const f = String(family || "").toLowerCase()
  if (f === "hr") return 0.45
  if (f === "totalbases") return 0.7
  if (f === "hits") return 0.55
  if (f === "rbis") return 0.6
  if (f === "runs") return 0.45
  if (f === "batterks") return 0.55
  if (f === "ks") return 1.2 // pitcher Ks (lowest-variance MLB stat)
  if (f === "outs") return 1.6
  if (f === "hitsallowed") return 0.9
  if (f === "earnedruns") return 0.7
  if (f === "walks") return 0.55
  return 0.55
}

/**
 * zScale (curve flattener) per family. Lower = sharper curve = stronger conviction
 * when median is far from line. MLB ladder lines (1.5 hits, 0.5 HR, etc.) require
 * a tight curve so 0.2-median vs 1.5-line lands well below 50%.
 *
 * Phase 9 priority: Pitcher Ks gets the sharpest curve, HR the flattest.
 */
function zScaleByFamily(family) {
  const f = String(family || "").toLowerCase()
  if (f === "hr") return 1.6
  if (f === "totalbases") return 1.4
  if (f === "hits") return 1.3
  if (f === "rbis") return 1.4
  if (f === "runs") return 1.4
  if (f === "batterks") return 1.4
  if (f === "ks") return 1.0 // most stable
  if (f === "outs") return 1.2
  if (f === "hitsallowed") return 1.4
  if (f === "earnedruns") return 1.5
  if (f === "walks") return 1.5
  return 1.4
}

/**
 * Probability shrink per family. NUMBER = how much of the deviation from 0.5
 * is KEPT (1.0 = keep all, 0.0 = collapse to coin flip).
 *
 * MLB low-count stats need to KEEP most of the signal, otherwise the logistic
 * output (already conservative) gets squashed back to ~0.5 and every market
 * looks +EV.
 */
function probShrinkByFamily(family) {
  const f = String(family || "").toLowerCase()
  if (f === "hr") return 0.45 // HR is irreducibly variance-heavy
  if (f === "totalbases") return 0.7
  if (f === "hits") return 0.7
  if (f === "rbis") return 0.6
  if (f === "runs") return 0.55
  if (f === "batterks") return 0.55
  if (f === "ks") return 0.78 // pitcher Ks most stable → keep most signal
  if (f === "outs") return 0.7
  if (f === "hitsallowed") return 0.5
  if (f === "earnedruns") return 0.45
  if (f === "walks") return 0.45
  return 0.55
}

/**
 * Sigma derivation: anchored to the UPSIDE spread (ceiling − median) — for
 * "over" bets that's the relevant side of the distribution. For low-count
 * integer stats this keeps sigma tight so we don't over-flatten the curve.
 */
function deriveSigma(family, stat) {
  const m = Number(stat?.mostLikely)
  const c = Number(stat?.ceiling)
  const f = Number(stat?.floor)
  const upside = Number.isFinite(c) && Number.isFinite(m) ? Math.max(0.0001, c - m) : null
  const downside = Number.isFinite(f) && Number.isFinite(m) ? Math.max(0.0001, m - f) : null
  const half = upside != null ? upside : Math.abs(m) * 0.5
  // Use 1.5x the upside half-band as the implied stdev. (Symmetric Gaussian
  // would give ~2x, but our band is intentionally widish to capture variance.)
  const derived = Math.max(half / 1.5, downside != null ? downside / 1.5 : 0)
  return Math.max(minSigmaByFamily(family), derived)
}

/**
 * Direct probability lookup for a ladder rung (e.g. hits over 1.5 → ladder[1.5]).
 * Ladder probs come from MLB's already-calibrated probability engines (HR /
 * hits / RBI / Ks), so when the line matches a rung the ladder value is the
 * single source of truth and bypasses the synthetic band logistic.
 *
 * Returns null when no exact ladder match.
 */
function ladderProbForOver(stat, line) {
  const ladder = stat?.ladder
  if (!ladder || typeof ladder !== "object") return null
  const ln = Number(line)
  if (!Number.isFinite(ln)) return null
  // Try exact match first.
  if (Number.isFinite(Number(ladder[ln]))) return Number(ladder[ln])
  if (Number.isFinite(Number(ladder[String(ln)]))) return Number(ladder[String(ln)])
  // Look for closest ladder key within 0.05 (handles 0.5 vs "0.5" vs 0.50).
  let bestKey = null
  let bestDist = Infinity
  for (const k of Object.keys(ladder)) {
    const kn = Number(k)
    if (!Number.isFinite(kn)) continue
    const d = Math.abs(kn - ln)
    if (d < 0.05 && d < bestDist) {
      bestDist = d
      bestKey = kn
    }
  }
  if (bestKey != null) return Number(ladder[bestKey])
  return null
}

function modelProbOver(family, stat, line) {
  if (!stat || !Number.isFinite(line)) return null
  const m = Number(stat.mostLikely)
  if (!Number.isFinite(m)) return null

  // Direct ladder lookup (HR / hits / total bases / RBIs / pitcher Ks).
  const direct = ladderProbForOver(stat, line)
  if (direct != null) {
    return { value: Math.max(0.0001, Math.min(0.9999, direct)), source: "ladder" }
  }

  const sigma = deriveSigma(family, stat)
  const z = (line - m) / (sigma * zScaleByFamily(family))
  const pUnder = 1 / (1 + Math.exp(-z))
  const pOverRaw = 1 - pUnder
  return { value: Math.max(0.0001, Math.min(0.9999, pOverRaw)), source: "logistic" }
}

function modelProbForSide(family, stat, line, side, confidence = null) {
  const probInfo = modelProbOver(family, stat, line)
  if (probInfo == null) return null
  const pOver = Number(probInfo.value)
  const s = String(side || "").toLowerCase()

  const m = Number(stat?.mostLikely)
  if (!Number.isFinite(m)) return null
  const sigma = deriveSigma(family, stat)
  const dist = Math.abs(m - line)
  const conf = Number.isFinite(Number(confidence)) ? Number(confidence) : null

  // Calibrated confidence feeds this gate only — stricter = less fake ceiling on model prob.
  const allowHigh = conf != null && conf >= 0.88 && dist >= sigma * 1.75
  const isHr = family === "hr"
  // ECOLOGY FIX T4: HR over cap raised from 0.48 → 0.52. The 0.48 hard cap placed
  // HR overs structurally BELOW fair-coin (0.50), ensuring every HR over candidate
  // had modelProb < 0.50. This made them invisible to tier qualification — even a
  // 0.23-edge HR over could never climb past PLAYABLE because modelProb fed into
  // conf calibration which then missed every STRONG/ELITE conf threshold. The 0.52
  // cap still enforces genuine uncertainty for this high-variance market; it simply
  // allows genuinely well-projected HR overs to be recognized as slight favorites.
  const maxP = isHr ? (allowHigh ? 0.55 : 0.52) : allowHigh ? 0.76 : 0.68

  const pSideRaw = s.startsWith("u") ? 1 - pOver : pOver

  // HR: ladder-only path; cap at 0.5 (variance). No shrink-to-50% layers.
  if (family === "hr") {
    return Math.max(0.0001, Math.min(maxP, pSideRaw))
  }

  // 2026-06-08 SHIP 2 — stolenBases NO-SHRINK bypass. The generic ladder-shrink
  // (0.65 toward 0.50) would inflate a real low SB probability (e.g. 6% → ~21%),
  // erasing the steal-rate signal and manufacturing fake +EV on every SB-over — a
  // probabilityHonesty/Step-1 violation. SB returns the raw Poisson P(side) straight
  // from the ladder, capped, NO shrink — same rationale as the HR bypass above.
  if (family === "stolenBases") {
    return Math.max(0.0001, Math.min(maxP, pSideRaw))
  }

  if (probInfo.source === "ladder") {
    const shrink = 0.65
    const pSideShrunk = 0.5 + (pSideRaw - 0.5) * shrink
    return Math.max(0.0001, Math.min(maxP, pSideShrunk))
  }

  const shrink = probShrinkByFamily(family)
  const pSideShrunk = 0.5 + (pSideRaw - 0.5) * shrink
  return Math.max(0.0001, Math.min(maxP, pSideShrunk))
}

function projectionConfidence(stat, line) {
  if (!stat || !Number.isFinite(line)) return 0
  const m = Number(stat.mostLikely)
  const f = Number(stat.floor)
  const c = Number(stat.ceiling)
  if (!Number.isFinite(m)) return 0
  const halfBand = Math.max(
    0.5,
    (Number.isFinite(c) && Number.isFinite(f) ? c - f : Math.abs(m) * 0.6) / 2
  )
  return Math.max(0, Math.min(1, Math.abs(m - line) / halfBand))
}

/**
 * MLB variance-aware confidence: dampen displayed / tier confidence for high-variance
 * props and unders on counting stats (reduces fake certainty without rewriting ladders).
 */
function calibrateMlbConfidence(family, line, side, vol, rawConf, mp) {
  let r = Number(rawConf)
  if (!Number.isFinite(r)) return 0
  const f = String(family || "").toLowerCase()
  const ln = Number(line)
  const under = String(side || "").toLowerCase().startsWith("u")
  const propTxt = `${mp?.propType || ""} ${mp?.marketKey || ""}`.toLowerCase()
  const multiHit = f === "hits" && Number.isFinite(ln) && ln >= 1.5 - 1e-9
  const xbhish = propTxt.includes("extra") || propTxt.includes("xbh") || propTxt.includes("extra_base")

  let mult = 1
  // ECOLOGY FIX T3: HR confidence multiplier raised from 0.68 → 0.72.
  // At 0.68, combined with the 0.38 vol-weight penalty, HR calibrated conf was
  // ~0.26 — far below the 0.42 STRONG threshold. Even a 0.23-edge HR with strong
  // ladder separation could never tier above PLAYABLE. 0.72 is still conservative
  // (HR is genuinely high-variance) but allows high-separation projections to reach
  // STRONG (~0.29+ calibrated conf, clearing the adjusted 0.22 threshold in T1).
  if (f === "hr") mult *= 0.72
  else if (f === "rbis") mult *= 0.78
  else if (f === "runs") mult *= 0.82
  else if (f === "batterks") mult *= 0.76
  else if (f === "totalbases") {
    mult *= 0.87
    if (xbhish) mult *= 0.82
  } else if (f === "hits") mult *= multiHit ? 0.78 : 0.93
  else if (f === "ks") mult *= 0.97
  else if (f === "outs") mult *= 0.92
  else mult *= 0.9

  if (under && (f === "hits" || f === "totalbases" || f === "rbis")) mult *= 0.87
  if (under && f === "hr") mult *= 0.84

  const volN = Number.isFinite(vol) ? Math.max(0, Math.min(1, vol)) : 0
  const volWt =
    f === "hr" ? 0.38 : f === "rbis" || f === "runs" ? 0.22 : f === "totalbases" ? 0.14 : f === "hits" ? 0.12 : f === "ks" ? 0.06 : 0.15
  r *= mult * (1 - volWt * volN)

  // 2026-05-29 — calibration feedback wire (v1). Multiply by adjustment
  // factor derived from historical hit rates (rolling 30-day window).
  // Bayesian-shrinkage-weighted: small samples stay near 1.0; large
  // samples with clear over/underconfidence get correspondingly weighted.
  // Example: MLB runs OVER currently 0.679× (13% historical hit vs 40% model).
  // Default 1.0 when sample < 5 picks for that (family, side) tuple.
  try {
    const calFactor = _getCalFactor({ sport: "mlb", statFamily: f, side: String(side || "").toLowerCase() })
    if (Number.isFinite(calFactor)) r *= calFactor
  } catch (_) { /* no-op: calibration wire is non-fatal */ }

  return Math.max(0, Math.min(1, r))
}

function volatilityGap(stat) {
  if (!stat) return 0
  const m = Number(stat.mostLikely)
  const c = Number(stat.ceiling)
  if (!Number.isFinite(m) || !Number.isFinite(c) || m <= 0) return 0
  return Math.max(0, Math.min(1, (c - m) / m))
}

function scorePlay({ edge, ev, conf, vol, side, family }) {
  const e = Number.isFinite(edge) ? edge : 0
  const v = Number.isFinite(ev) ? ev : 0
  const c = Number.isFinite(conf) ? conf : 0
  const g = Number.isFinite(vol) ? vol : 0
  const sideBoost = String(side || "").toLowerCase().startsWith("o") ? g * 0.15 : g * 0.05
  // ECOLOGY FIX T1: Remove HR family penalty (was 0.85). The 0.85 weight created a
  // ~24% composite score penalty for all HR props regardless of edge quality — a
  // 0.23-edge HR was scoring below an 0.08-edge hits-under. HR is already naturally
  // penalized via lower conf values (calibrateMlbConfidence mult 0.72 vs 1.0 for
  // most families) and lower modelProb ceiling (maxP 0.52 vs 0.68). Adding a
  // further 0.85 family weight stacked three separate penalties onto HR candidates,
  // which is why they never surfaced. Now HR competes on equal composite footing —
  // if the edge and EV are real, it scores accordingly.
  // Pitcher Ks remain at 1.1 (reliable signal, high strike-out variance captures
  // genuine offensive attack edge on over pitching matchups).
  const familyWeight =
    family === "ks" ? 1.1 : family === "hits" || family === "totalBases" ? 1.05 : 1.0
  return (e * 100 * 1.0 + v * 60 + c * 12 + sideBoost * 8) * familyWeight
}

function tierForPlay(edge, ev, conf, family, oddsAmerican, modelProb) {
  // 2026-06-11 R2 (mlb-r2-v1) — oddsAmerican + modelProb threaded ADDITIVELY
  // (both already local at the sole call site below; legacy 4-arg callers get
  // undefined → bucket "unknown" → the mid-fav cap can never fire — Trap-1,
  // F1.2a precedent). modelProb is PLUMBED-UNUSED in v1 (operator §8 Q3:
  // kept ready for a governed v2; NO v1 predicate reads it).
  // Evidence base: docs/audits/2026-06-11-r2-mlb-tier-assignment/
  // phase0_bucket_tier_probe.md (12 files · 4,603 deduped graded picks).
  if (!Number.isFinite(edge) || !Number.isFinite(ev)) return "FADE"
  if (ev <= 0) return "FADE"
  if (edge < 0.04) return "FADE"
  // 2026-06-08 SHIP 2 — stolenBases TIER CAP. Zero graded SB history (Step-1 trust
  // proof: never trust an unproven family at a confident tier). A qualifying SB pick
  // surfaces at PLAYABLE at most — never ELITE/STRONG — until ~14d of grading earns it.
  // Returns BEFORE the ELITE/STRONG ladder, so SB can only be FADE (gates above) or
  // PLAYABLE. No effect on any other family.
  if (family === "stolenBases") return "PLAYABLE"
  const isHr = family === "hr"
  // 2026-06-11 R2-2 + R2-3 — badge caps derived ONLY from sufficient-n probe cells:
  //   R2-2 mid-fav cap — ELITE @ mid-fav realized −15.3pp (n=32), STRONG −11.1pp
  //        (n=49). HR EXEMPT (operator §8 Q1; HR badges ≈ market-rate, −2.2pp
  //        n=118). Demotion target PLAYABLE (§8 Q2) because STRONG @ mid-fav is
  //        itself toxic — ELITE→STRONG would move picks bad-cell → bad-cell.
  //   R2-3 family cap — ks (−21.3pp n=42) + totalBases (−8.4pp n=57) capped in
  //        ALL buckets; stolenBases cap above is the in-file precedent.
  // Caps return PLAYABLE — NEVER FADE — so the pick set is unchanged; only the
  // badge (and tier-derived stake suggestions) change. Policy OFF ⇒ _r2BadgeCap
  // is false ⇒ ladder byte-identical to pre-R2.
  const _r2Bucket = MLB_TIER_POLICY_ON ? bucketForOdds(oddsAmerican) : "unknown"
  const _r2BadgeCap =
    MLB_TIER_POLICY_ON &&
    ((_r2Bucket === "mid-fav" && !isHr) || family === "ks" || family === "totalBases")
  // Uses volatility-calibrated conf: ~0.56+ ≈ strong separation; 0.65+ becomes rare.
  if (!isHr && edge >= 0.1 && ev >= 0.05 && conf >= 0.56) return _r2BadgeCap ? "PLAYABLE" : "ELITE"
  // ECOLOGY FIX T2: HR-specific tier conf thresholds. HR calibrated conf is
  // structurally ~0.26–0.30 due to high variance (binary outcome, low ladder
  // separation). The old thresholds (ELITE: conf>=0.45, STRONG: conf>=0.42)
  // were calibrated for hits/runs/TB which have higher conf. Applying them to
  // HR caused every HR candidate to land as PLAYABLE regardless of edge quality.
  // New thresholds (ELITE: conf>=0.30, STRONG: conf>=0.22) are appropriate for
  // the actual range of HR conf values after calibration — they still require
  // genuine edge separation (edge>=0.125 for ELITE, edge>=0.075 for STRONG)
  // and valid EV; only the conf gate is HR-adjusted.
  if (isHr && edge >= 0.125 && ev >= 0.085 && conf >= 0.30) return "ELITE"
  if (isHr && edge >= 0.075 && ev >= 0.032 && conf >= 0.22) return "STRONG"
  // 2026-06-11 R2 — HR returns above are deliberately uncapped: R2-2 exempts hr
  // (§8 Q1) and the R2-3 families (ks / totalBases) can never reach them.
  if (!isHr && edge >= 0.075 && ev >= 0.032 && conf >= 0.42) return _r2BadgeCap ? "PLAYABLE" : "STRONG"
  return "PLAYABLE"
}

/**
 * Map MLB market strings to a normalized stat family.
 */
function resolveStatFamily(marketProp) {
  const direct = String(marketProp?.statFamily || "").toLowerCase()
  if (STAT_FAMILIES.map((s) => s.toLowerCase()).includes(direct)) {
    // Canonicalize back to camelCase keys used in predictions.stats.
    if (direct === "totalbases") return "totalBases"
    if (direct === "batterks") return "batterKs"
    if (direct === "hitsallowed") return "hitsAllowed"
    if (direct === "earnedruns") return "earnedRuns"
    if (direct === "stolenbases") return "stolenBases" // 2026-06-08 SHIP 2 (only in STAT_FAMILIES when ON)
    return direct
  }
  const s = `${marketProp?.propType || ""} ${marketProp?.marketKey || ""} ${marketProp?.marketName || ""}`.toLowerCase()

  // Pitcher markets first (more specific).
  const isPitcherMarket = Boolean(marketProp?.isPitcherMarket)
  if (isPitcherMarket && s.includes("strikeout")) return "ks"
  if (s.includes("pitcher") && s.includes("strikeout")) return "ks"
  if (s.includes("outs")) return "outs"
  if (s.includes("hits allowed") || s.includes("hits_allowed")) return "hitsAllowed"
  if (s.includes("earned run")) return "earnedRuns"
  if (s.includes("walks") && (isPitcherMarket || s.includes("pitcher"))) return "walks"

  // Hitter markets.
  // 2026-06-08 SHIP 2 — stolen bases (gated). Placed first among hitter markets;
  // "stolen bases" matches no existing branch, so OFF (returns null here) is the
  // exact pre-SHIP-2 drop behavior. marketKey batter_stolen_bases / propType "Stolen Bases".
  if (SB_ENABLED && (s.includes("stolen base") || s.includes("stolen_base") || s.includes("stolenbases"))) return "stolenBases"
  if (s.includes("home run") || /\bhr\b/.test(s) || s.includes("home_run")) return "hr"
  if (s.includes("total bases") || s.includes("total_bases")) return "totalBases"
  if (s.includes("rbi")) return "rbis"
  if (s.includes("runs scored") || (s.includes("runs") && !s.includes("earned"))) return "runs"
  if (s.includes("hit")) return "hits"
  if (s.includes("strikeout") && !isPitcherMarket) return "batterKs"
  return null
}

function normalizeKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
}

function indexPredictions(predictions) {
  const idx = new Map()
  const players = Array.isArray(predictions?.players) ? predictions.players : []
  for (const p of players) {
    if (!p?.player) continue
    const k1 = `${normalizeKey(p.player)}|${normalizeKey(p.eventId || "")}`
    const k2 = `${normalizeKey(p.player)}|`
    idx.set(k1, p)
    if (!idx.has(k2)) idx.set(k2, p)
  }
  return idx
}

function buildReasoning({ family, side, line, stat, edge, ev, conf, vol }) {
  const parts = []
  parts.push(
    `${family} proj ${stat?.floor ?? "?"} / ${stat?.mostLikely ?? "?"} / ${stat?.ceiling ?? "?"} vs line ${line}`
  )
  parts.push(`edge ${(edge * 100).toFixed(1)}% • EV ${ev.toFixed(3)}`)
  if (conf >= 0.62) parts.push("high conf")
  else if (conf >= 0.38) parts.push("medium conf")
  else parts.push("low conf")
  if (side === "over" && vol >= 0.35) parts.push("upside band")
  if (side === "under" && vol <= 0.2) parts.push("tight ceiling")
  return parts.join(" | ")
}

function isHrPropType(s) {
  const t = String(s || "").toLowerCase()
  return t.includes("home run") || t === "hr" || t.includes("home_run")
}

function buildMlbBestBetsBoard(input = {}) {
  const generatedAt = new Date().toISOString()
  const predictions = input?.predictions || null
  const marketProps = Array.isArray(input?.marketProps) ? input.marketProps : []

  if (!predictions || !Array.isArray(predictions.players) || !marketProps.length) {
    return {
      corePlays: [],
      valuePlays: [],
      upsidePlays: [],
      fades: [],
      allPlays: [],
      longshotPlays: [],
      altPlays: [],
      meta: {
        generatedAt,
        evaluated: 0,
        kept: 0,
        dropped: 0,
        reason: !predictions
          ? "no_predictions"
          : !marketProps.length
            ? "no_market_props"
            : "no_players",
      },
    }
  }

  const idx = indexPredictions(predictions)
  const allPlays = []
  const longshotPlays = []
  const altPlays = []
  const fades = []
  let evaluated = 0
  let dropped = 0

  for (const mp of marketProps) {
    if (!mp || typeof mp !== "object") continue
    const family = resolveStatFamily(mp)
    if (!family) continue
    const player = mp.player
    const eventId = mp.eventId || ""
    const line = Number(mp.line)
    const side = String(mp.side || "").toLowerCase()
    const odds = Number(mp.oddsAmerican)
    if (!player || !Number.isFinite(line) || !Number.isFinite(odds)) continue
    if (side !== "over" && side !== "under" && side !== "yes" && side !== "no") continue

    // Map yes/no (used for HR) to over/under for computation.
    const sideNorm = side === "yes" ? "over" : side === "no" ? "under" : side

    const k1 = `${normalizeKey(player)}|${normalizeKey(eventId)}`
    const k2 = `${normalizeKey(player)}|`
    const pred = idx.get(k1) || idx.get(k2)
    if (!pred) continue
    const stat = pred.stats?.[family]
    if (!stat) continue

    evaluated += 1

    const impliedProb = americanOddsToImpliedProb(odds)
    const decOdds = americanToDecimal(odds)
    const confRaw = projectionConfidence(stat, line)
    const vol = volatilityGap(stat)
    const conf = calibrateMlbConfidence(family, line, sideNorm, vol, confRaw, mp)
    const rawModelProb = modelProbForSide(family, stat, line, sideNorm, conf)
    if (impliedProb == null || decOdds == null || rawModelProb == null) {
      dropped += 1
      continue
    }
    // 2026-07-01 G1 STEP 1 — calibrate modelProb (isotonic remap) BEFORE edge/ev/
    // tier when MLB_CALIB_LIVE is ON, so live selection derives from the calibrated
    // prob. OFF ⇒ modelProb === rawModelProb (byte-identical to pre-G1). Fall back
    // to raw if the shadow module returns null (MLB_MARGINAL_CALIB=0 / no map).
    let modelProb = rawModelProb
    if (MLB_CALIB_LIVE && _calibrateModelProb) {
      const _calP = _calibrateModelProb(rawModelProb, family, { side: sideNorm, oddsAmerican: odds })
      if (Number.isFinite(_calP)) modelProb = _calP
    }
    const edge = modelProb - impliedProb
    const ev = modelProb * (decOdds - 1) - (1 - modelProb)

    if (modelProb > 0.49 && modelProb < 0.51) {
      dropped += 1
      continue
    }

    const isLongshot = impliedProb < 0.1
    const inCoreOddsBand = odds >= -300 && odds <= 300
    const isHrProp = family === "hr" || isHrPropType(mp?.propType) || isHrPropType(mp?.marketKey)
    const isAlternate =
      /alternate/i.test(String(mp?.marketKey || "")) ||
      /\bladder\b/i.test(String(mp?.propType || "")) ||
      /alternate/i.test(String(mp?.propType || "")) ||
      Boolean(mp?.ladder)

    // 2026-05-29 — Lane B Phase 3 v0.4.9 — MLB odds cap. Audit showed 94% of
    // MLB picks were LONGSHOT (3027 of 3206), mostly "over 3.5 hits" type
    // extreme alt-lines at +15000 to +22500 odds. modelProb ~0.16 with
    // implied ~0.04 = huge edge, but practical betting value near zero
    // because games where a batter gets 4+ hits are rare lottery events.
    // Mirrors NBA's existing alt-line cap (+800). Higher cap for HR family
    // because HR is intrinsically high-variance and operator may want longshot
    // HR picks. Triple/double markets don't exist in MLB so no equivalent.
    const __mlbOddsCap = isHrProp ? 2500 : 1500
    if (odds > __mlbOddsCap) {
      dropped += 1
      continue
    }

    if (!isLongshot && !isAlternate) {
      if (edge < 0.04 || ev <= 0) {
        dropped += 1
        continue
      }
      // ECOLOGY FIX T5: Exempt HR props from the high-variance drop gate.
      // HR is intrinsically high-variance (vol typically 0.7–1.0 for HR/game
      // projections). The vol>0.65 gate was removing most HR candidates before
      // they reached scorePlay / tierForPlay — including those with 0.10+ edge.
      // HR candidates already face an edge>=0.04 gate (line above) and will
      // receive PLAYABLE/FADE tier from tierForPlay if genuinely weak.
      // For non-HR props the vol-gate remains: it correctly filters
      // high-variance totalbases/runs props with marginal 5% edges.
      if (!isHrProp && vol > 0.65 && edge < 0.06) {
        dropped += 1
        continue
      }
    }

    // 2026-06-11 R2 — odds + modelProb threaded (both computed above; zero new computation).
    const tier = tierForPlay(edge, ev, conf, family, odds, modelProb)
    if (!isLongshot && !isAlternate && tier === "FADE") {
      // Track explicit fades (e.g. -EV / negative edge) for "FADE" board section.
      const fadePlay = makePlay({
        pred,
        mp,
        family,
        side: sideNorm,
        line,
        odds,
        impliedProb,
        modelProb,
        rawModelProb,
        edge,
        ev,
        conf,
        confRaw,
        vol,
        stat,
        tier: "FADE",
        isLongshot,
        isAlternate,
        inCoreOddsBand,
        isHrProp,
        score: 0,
      })
      fades.push(fadePlay)
      dropped += 1
      continue
    }

    const score = scorePlay({ edge, ev, conf, vol, side: sideNorm, family })
    const play = makePlay({
      pred,
      mp,
      family,
      side: sideNorm,
      line,
      odds,
      impliedProb,
      modelProb,
      rawModelProb,
      edge,
      ev,
      conf,
      confRaw,
      vol,
      stat,
      tier: isLongshot ? "LONGSHOT" : tier,
      isLongshot,
      isAlternate,
      inCoreOddsBand,
      isHrProp,
      score,
    })

    if (isLongshot) longshotPlays.push(play)
    else if (isAlternate || !inCoreOddsBand) altPlays.push(play)
    else allPlays.push(play)
  }

  allPlays.sort((a, b) => b.score - a.score)
  longshotPlays.sort((a, b) => b.score - a.score)
  altPlays.sort((a, b) => b.score - a.score)

  // CORE = ELITE/STRONG, non-HR or HR with major edge.
  const corePlays = allPlays.filter(
    (p) => p.inCoreOddsBand && !p.isAlternate && !p.isHrProp && (p.tier === "ELITE" || p.tier === "STRONG")
  )
  // VALUE = PLAYABLE in core odds band, non-HR.
  const valuePlays = allPlays.filter(
    (p) => p.inCoreOddsBand && !p.isAlternate && !p.isHrProp && p.tier === "PLAYABLE"
  )
  // UPSIDE / HR = HR plays + HR-flavored alternates (any tier above FADE).
  const upsidePlays = allPlays
    .filter((p) => p.isHrProp)
    .concat(altPlays.filter((p) => p.isHrProp))
    .concat(longshotPlays.filter((p) => p.isHrProp))
  upsidePlays.sort((a, b) => b.score - a.score)

  // 2026-07-05 G1-Serve-1A — register this board's calibrated plays for the
  // served-surface injection (see block near MLB_CALIB_LIVE at top). Fades included:
  // the join carries the calibrated PROB (equally real on a faded play), not the tier.
  // No-op when MLB_CALIB_LIVE is OFF.
  registerMlbCalibratedServeIndex([...allPlays, ...longshotPlays, ...altPlays, ...fades])

  return {
    corePlays,
    valuePlays,
    upsidePlays,
    fades,
    allPlays,
    longshotPlays,
    altPlays,
    meta: {
      generatedAt,
      evaluated,
      kept: allPlays.length,
      longshots: longshotPlays.length,
      alts: altPlays.length,
      fades: fades.length,
      dropped,
      tierCounts: tierCountsOf(allPlays),
      familyCounts: familyCountsOf(allPlays),
    },
  }
}

function makePlay(args) {
  const {
    pred,
    mp,
    family,
    side,
    line,
    odds,
    impliedProb,
    modelProb,
    rawModelProb,
    edge,
    ev,
    conf,
    confRaw,
    vol,
    stat,
    tier,
    isLongshot,
    isAlternate,
    inCoreOddsBand,
    isHrProp,
    score,
  } = args
  return {
    player: pred.player,
    eventId: pred.eventId || mp.eventId || null,
    // 2026-05-29 — gameTime propagation. MLB snapshot rawProps carry
    // gameTime (e.g. "2026-05-29T22:41:00Z"); without explicitly stamping
    // it onto play, leanBet → tracked_bets ends up with gameTime=null on
    // EVERY MLB pick. Observed 2026-05-29: 0/2491 MLB picks had gameTime
    // stamped. CLV capture then relies on the fragile eventTimeMap fallback
    // (snapshot.events lookup at capture time) which can fail when an event
    // ages out of the snapshot between slate-gen and capture-window-open.
    // NBA stamps gameTime correctly upstream; bringing MLB to parity.
    gameTime: mp.gameTime || mp.commence_time || mp.commenceTime || pred.gameTime || null,
    matchup: pred.matchup || null,
    team: pred.team || null,
    teamCode: pred.teamCode || null,
    awayTeam: pred.awayTeam || null,
    homeTeam: pred.homeTeam || null,
    opponent: pred.opponent || null,
    role: pred.role || null,
    statFamily: family,
    side,
    line,
    oddsAmerican: odds,
    sportsbook: mp.sportsbook || mp.book || null,
    propType: mp.propType || null,
    marketKey: mp.marketKey || null,
    ladder: mp.ladder || null,
    impliedProb: round4(impliedProb),
    modelProb: round4(modelProb),
    // 2026-07-01 G1 STEP 1 — calibration stamps, present IFF MLB_CALIB_LIVE ON
    // (conditional spread = the tierPolicy / ladderNB omit-when-absent precedent).
    // OFF ⇒ keys ABSENT ⇒ tracked artifacts byte-identical to pre-G1. modelProbRaw
    // keeps the pre-calibration prob auditable; the 14d verify filters on a
    // non-null calibVersion (the value names the map era).
    // 2026-07-06 v2 — stamp reads the maps config version via the engine
    // (_calibVersionStamp) so re-trained maps separate eras automatically.
    ...(MLB_CALIB_LIVE ? { modelProbRaw: round4(rawModelProb), calibVersion: _calibVersionStamp } : {}),
    edge: round4(edge),
    ev: round4(ev),
    confidence: round3(conf),
    confidenceRaw: round3(confRaw),
    volatility: round3(vol),
    tier,
    // 2026-06-11 R2-4 — tierPolicy version stamp, present IFF the policy is ON
    // (conditional spread = the displayBundle omit-when-absent precedent in
    // phase4Tracking.js). OFF ⇒ key ABSENT ⇒ artifacts byte-identical to pre-R2.
    // The 14d verify filters on tierPolicy === "mlb-r2-v1"; ANY future scoring
    // change MUST bump this version in a governed phase (frozen-base doctrine).
    ...(MLB_TIER_POLICY_ON ? { tierPolicy: "mlb-r2-v1" } : {}),
    // 2026-06-12 T2-L1 (mlb-nb-ladder-v1) — NB SHADOW rung for THIS play's line,
    // validation ride-along ONLY (never read by scoring — verifier-enforced).
    // Present IFF the shadow ladder exists on the stat AND has this exact rung.
    // nbProbOver = fitted P(X ≥ ceil(line)) — the OVER-side probability; the
    // validation probe derives the under side as 1 − nbProbOver.
    ...(family === "totalBases" && stat?.ladderNB && stat.ladderNB[String(line)] != null
      ? { nbProbOver: stat.ladderNB[String(line)], nbFit: { n: stat.ladderNBMeta?.n ?? null, method: stat.ladderNBMeta?.method ?? null } }
      : {}),
    isLongshot,
    isAlternate,
    inCoreOddsBand,
    isHrProp,
    score: round2(score),
    range: {
      floor: stat.floor ?? null,
      mostLikely: stat.mostLikely ?? null,
      ceiling: stat.ceiling ?? null,
    },
    reasoning: buildReasoning({ family, side, line, stat, edge, ev, conf, vol }),
  }
}

function tierCountsOf(plays) {
  const out = { ELITE: 0, STRONG: 0, PLAYABLE: 0, FADE: 0, LONGSHOT: 0 }
  for (const p of plays) out[p.tier] = (out[p.tier] || 0) + 1
  return out
}

function familyCountsOf(plays) {
  const out = {}
  for (const p of plays) out[p.statFamily] = (out[p.statFamily] || 0) + 1
  return out
}

function round2(x) {
  return Math.round(Number(x) * 100) / 100
}
function round3(x) {
  return Math.round(Number(x) * 1000) / 1000
}
function round4(x) {
  return Math.round(Number(x) * 10000) / 10000
}

/**
 * Build marketProps from MLB snapshot rows.
 * Handles MLB-specific propType strings and yes/no sides for HR.
 */
function marketPropsFromMlbRows(rows) {
  if (!Array.isArray(rows)) return []
  const out = []
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const player = row.player
    if (!player) continue
    const family = resolveStatFamily(row)
    if (!family) continue
    const line = Number(row.line)
    const odds = Number(row.odds)
    let side = String(row.side || row.outcomeName || "").toLowerCase()

    // Normalize HR-style "yes"/"no" to over/under semantics.
    if (side === "yes") side = "over"
    if (side === "no") side = "under"
    if (!side && family === "hr") {
      // First Home Run / HR markets often have a single-side outcome; treat as "over" 0.5.
      side = "over"
    }

    if (!Number.isFinite(odds)) continue
    if (!Number.isFinite(line)) {
      // Synthesize HR line (0.5) if missing — common for HR markets.
      if (family === "hr") {
        out.push({
          player,
          eventId: row.eventId || null,
          // 2026-05-29 — preserve gameTime through marketProps conversion so
          // makePlay (and downstream leanBet) can stamp it on tracked_bets.
          // Without this, MLB picks land with gameTime=null and CLV capture
          // relies on the fragile eventTimeMap fallback.
          gameTime: row.gameTime || row.commence_time || row.commenceTime || null,
          statFamily: family,
          line: 0.5,
          oddsAmerican: odds,
          side,
          sportsbook: row.book || row.sportsbook || null,
          propType: row.propType || null,
          marketKey: row.marketKey || null,
          ladder: row.ladder || null,
          isPitcherMarket: Boolean(row.isPitcherMarket),
        })
      }
      continue
    }
    if (side !== "over" && side !== "under") continue
    out.push({
      player,
      eventId: row.eventId || null,
      // 2026-05-29 — gameTime preservation, see comment above.
      gameTime: row.gameTime || row.commence_time || row.commenceTime || null,
      statFamily: family,
      line,
      oddsAmerican: odds,
      side,
      sportsbook: row.book || row.sportsbook || null,
      propType: row.propType || null,
      marketKey: row.marketKey || null,
      ladder: row.ladder || null,
      isPitcherMarket: Boolean(row.isPitcherMarket),
    })
  }
  return out
}

module.exports = { buildMlbPropClusters, buildMlbBestBetsBoard, marketPropsFromMlbRows, americanOddsToImpliedProb, americanToDecimal, modelProbOver, STAT_FAMILIES,
  // 2026-06-08 SHIP 2 — exported for the regression probe (pure fns; no behavior change)
  resolveStatFamily, tierForPlay, modelProbForSide,
  // 2026-06-11 R2 — exported for verifyMlbTierPolicyR2.js (pure fn; stamp assertion)
  makePlay,
  // 2026-07-05 G1-Serve-1A — served-surface calibration injection (server.js
  // buildMlbLiveDualBestAvailablePayload consumer) + fixture exports
  // (verifyServedCalibrationInjection.js).
  injectMlbCalibratedServeProbs, getMlbCalibratedServeIndex, registerMlbCalibratedServeIndex }

