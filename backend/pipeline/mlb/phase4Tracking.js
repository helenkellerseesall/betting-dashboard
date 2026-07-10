"use strict"

const fs = require("fs")
const path = require("path")
// 2026-05-28 — Lane B Phase 1 port to MLB. Closing-line-value math for the
// open-side stamping in leanBet. Same module NBA uses (single source).
const clvMath = require("../grading/clvMath")
// 2026-05-29 — auto-mirror tracked_bets into personal_ledger after every slate
// write. Same idempotent pattern as NBA's buildNbaPerformanceTracking.
const _personalLedger = require("../shared/buildPersonalLedger")

const MLB_TRACKED_BEST_PREFIX = "mlb_tracked_best_"
const MLB_PICKS_PREFIX = "mlb_picks_"
const LEGACY_TRACKED_PREFIX = "tracked_props_"

// 2026-06-01 Phase Date-Doctrine-1A — replaced server-local date math with
// canonical ET-with-4-AM-boundary helper. The previous comment claimed
// "server-local to avoid UTC midnight drift" but server-local is only ET
// on the operator's mac and was UTC in sandbox/CI. The doctrine: every
// slate writer uses currentSlateDateEt() / slateDateForTimestamp(ts).
const { slateDateForTimestamp } = require("../shared/slateDate")
// 2026-06-09 lineupSpot wiring fix — back-fill lineupPosition onto tracked rows from
// the FRESH lineup cache at serialization time (confirmed-game picks were 1/26).
// Post-scoring + null-only ⇒ edge/tier/selection byte-identical. Omit when unposted.
const { makeLineupBackfiller } = require("./backfillMlbLineupSpot")
const { deriveMlbLineupContext } = require("./context/deriveMlbLineupContext")

function dateKeyFromNow(now = Date.now()) {
  return slateDateForTimestamp(now)
}

function runtimeTrackingDir() {
  return path.join(__dirname, "..", "..", "runtime", "tracking")
}

function mlbTrackedBestPath(slateDate) {
  return path.join(runtimeTrackingDir(), `${MLB_TRACKED_BEST_PREFIX}${slateDate}.json`)
}

function mlbPicksPath(slateDate) {
  return path.join(runtimeTrackingDir(), `${MLB_PICKS_PREFIX}${slateDate}.json`)
}

function legacyTrackedPropsPath(slateDate) {
  return path.join(runtimeTrackingDir(), `${LEGACY_TRACKED_PREFIX}${slateDate}.json`)
}

function ensureDirSync(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true })
  } catch (_) {
    // ignore
  }
}

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, "utf8")
    return JSON.parse(raw)
  } catch (_) {
    return null
  }
}

function safeWriteJson(filePath, payload) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2))
    return true
  } catch (_) {
    return false
  }
}

function isMlbBestAvailableEntry(e) {
  return e?.sport === "mlb" && e?.bucket === "mlb.bestAvailable.best"
}

/**
 * Normalize persisted MLB tracking JSON to `{ metadata, entries }`.
 * Accepts legacy shapes that used `allTrackedProps` inside the MLB-only file.
 */
function normalizeMlbTrackedPayload(raw) {
  if (!raw || typeof raw !== "object") {
    return { metadata: {}, entries: [] }
  }
  let entries = []
  if (Array.isArray(raw.entries)) {
    entries = raw.entries.filter(isMlbBestAvailableEntry)
  } else if (Array.isArray(raw.allTrackedProps)) {
    entries = raw.allTrackedProps.filter(isMlbBestAvailableEntry)
  }
  return { metadata: raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {}, entries }
}

function loadLegacyMlbBestEntries(slateDate) {
  const legacyPath = legacyTrackedPropsPath(slateDate)
  const legacy = safeReadJson(legacyPath)
  const rows = Array.isArray(legacy?.allTrackedProps) ? legacy.allTrackedProps : []
  return rows.filter(isMlbBestAvailableEntry)
}

/**
 * Read MLB best-available tracking for a slate date (dedicated file only).
 * @param {string} slateDate YYYY-MM-DD
 * @returns {{ ok: boolean, path: string, payload: { metadata: object, entries: object[] } }}
 */
function readMlbTrackedBestSnapshot(slateDate) {
  const date =
    typeof slateDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(slateDate)
      ? slateDate
      : dateKeyFromNow()
  const filePath = mlbTrackedBestPath(date)
  const raw = safeReadJson(filePath)
  const { metadata, entries } = normalizeMlbTrackedPayload(raw)
  const meta = {
    sport: "mlb",
    slateDate: date,
    ...metadata,
    slateDate: metadata.slateDate || date
  }
  return {
    ok: Boolean(raw),
    path: filePath,
    payload: { metadata: meta, entries }
  }
}

function legKey(row) {
  return [
    String(row?.player || "").trim().toLowerCase(),
    String(row?.team || "").trim().toLowerCase(),
    String(row?.propType || "").trim(),
    String(row?.side || "").trim(),
    String(row?.line ?? ""),
    String(row?.book || "").trim(),
  ].join("|")
}

// 2026-06-09 — back-fill a row's lineup spot from the fresh cache BEFORE serialize.
// Sets only null fields (lineupPosition + re-derived lineupContextV2) so the serializer
// picks up lineupSpot + depth + PA proxy + run/rbi env. Mutates the row in place but
// touches NO scoring field (edge/tier/predictedProbability untouched). Omit-not-fabricate:
// no-ops when the resolver returns null (game unposted / player unmatched).
function backfillRowLineup(row, backfiller) {
  if (!row || !backfiller || typeof backfiller.resolve !== "function") return
  if (row.lineupPosition != null || row.battingOrderIndex != null) return
  const lp = backfiller.resolve(row)
  if (lp == null) return
  row.lineupPosition = lp
  if (!row.lineupContextV2) {
    try { row.lineupContextV2 = deriveMlbLineupContext(row) } catch (_) { /* keep lineupPosition only */ }
  }
}

function toTrackedMlbPick(row, { slateDate, timestamp }) {
  // Phase Item 0002 Slice 1 — mirror lift on the parallel picks persistence
  // path (recordMlbDailyPicks). Same field categories as toTrackedMlbBestEntry;
  // same anti-fabrication discipline (every value `?? null`).
  const lc = row?.lineupContextV2 || null
  const pc = row?.parkContext     || null
  const wc = row?.weatherContext  || null
  return {
    slateDate,
    timestamp,

    player: row?.player ?? null,
    team: row?.team ?? null,
    propType: row?.propType ?? null,
    side: row?.side ?? null,
    line: row?.line ?? null,
    odds: row?.odds ?? null,

    predictedProbability: row?.predictedProbability ?? null,
    edge: row?.edgeProbability ?? row?.edge ?? null,
    // 2026-07-05 G1-Serve-1A — calibration stamps on the parallel picks path
    // (see toTrackedMlbBestEntry). Present IFF upstream injection stamped the row.
    ...(row?.calibVersion != null ? { calibVersion: row.calibVersion, modelProbRaw: row.modelProbRaw ?? null } : {}),

    // Result fields (initially null)
    result: null, // "win" | "loss" | null
    closingLine: null,
    closingOdds: null,

    // ── Phase Item 0002 Slice 1 — canonical hydration lift ──────────────
    eventId:          row?.eventId  ?? null,
    matchup:          row?.matchup  ?? null,
    gameTime:         row?.gameTime ?? null,
    awayTeam:         row?.awayTeam ?? null,
    homeTeam:         row?.homeTeam ?? null,
    book:             row?.book     ?? null,
    marketKey:        row?.marketKey ?? null,

    impliedTeamTotal: Number.isFinite(Number(row?.impliedTeamTotal)) ? Number(row.impliedTeamTotal) : null,
    gameTotal:        Number.isFinite(Number(row?.gameTotal))        ? Number(row.gameTotal)        : null,
    hrEnvironmentTag: pc?.hrEnvironmentTag ?? row?.hrEnvironmentTag ?? null,
    // 2026-06-01 Phase MLB-Platoon-Persistence-Fix-1A (#135) — isPlatoonAdvantage
    // is one of buildMlbBestBetsBoard's 4 canonical projection inputs per
    // [[project-pick-origin-architecture]] memory ("Single platoon-flag wire
    // fixed 2026-05-30"). It was populated at the snapshot source (94.7% per
    // probe 2026-06-01) but never made the persistence whitelist here, so
    // every tracked_best entry had isPlatoonAdvantage=undefined regardless.
    // sysAudit's hourly lineupSpot RED was the dashboard surfacing one of
    // four canonical-input gaps; this fix closes the platoon side of the gap.
    isPlatoonAdvantage: typeof row?.isPlatoonAdvantage === "boolean" ? row.isPlatoonAdvantage : null,

    lineupSpot:            lc?.lineupSpot            ?? row?.lineupPosition ?? row?.battingOrderIndex ?? null,
    depth:                 lc?.depth                 ?? null,
    plateAppearancesProxy: lc?.plateAppearancesProxy ?? null,
    runEnvironment:        lc?.runEnvironment        ?? null,
    rbiEnvironment:        lc?.rbiEnvironment        ?? null,
    // 2026-06-09 — preserve external id for reliable future lineup id-joins (lossy name-fallback otherwise).
    playerIdExternal:      row?.playerIdExternal ?? (row?.__src && row.__src.playerIdExternal) ?? null,

    hrFactor:         pc?.hrFactor         ?? row?.hrFactor         ?? null,
    windDirectionTag: wc?.windDirectionTag ?? row?.windDirectionTag ?? null,
    carryShift:       wc?.carryShift       ?? row?.carryShift       ?? null,
    temperatureF:     wc?.temperatureF     ?? row?.temperatureF     ?? null,
    contextualTags:   Array.isArray(row?.mlbContextualTags) ? row.mlbContextualTags : null,
    // 2026-06-08 Step-2 — carry the board pick's displayBundle. Gated by presence:
    // when the bundle is absent (kill-switch OFF, or non-board row) the spread adds
    // NOTHING ⇒ every existing field byte-identical to pre-Step-2. Built in the
    // server.js best-row attach (buildMlbLiveDualBestAvailablePayload).
    ...(row?.displayBundle ? { displayBundle: row.displayBundle } : {}),
  }
}

function toTrackedMlbBestEntry(row, { slateDate, timestamp }) {
  // Phase Item 0002 Slice 1 — canonical hydration lift. Persistence whitelist
  // extended additively so the workstation /state route receives full
  // canonical context on enrichedBest candidates. Three field categories:
  //   (a) game-identity fields (eventId, matchup, gameTime, teams) — required
  //       for FE buildGameEcosystems indexing (frontend/.../gameEcosystem.ts
  //       line 195: `if (!c.eventId) continue`).
  //   (b) BC-1 canonical realism signals (depth, lineupSpot, impliedTeamTotal,
  //       gameTotal, hrEnvironmentTag) — required for BC-8
  //       computeBettorRealismScore (backend/pipeline/shared/buildSlipAi.js
  //       lines 130–203) which reads them at TOP LEVEL.
  //   (c) Item 0001 survivability inputs (depth, lineupSpot, plateAppearancesProxy,
  //       runEnvironment, rbiEnvironment, hrEnvironmentTag, carryShift, hrFactor)
  //       — survivabilityGate's paFactor × runEnvFactor × hrCarryFactor formula
  //       reads these. Lifted from nested lineupContextV2 / parkContext /
  //       weatherContext when upstream `applyMlbContextualLayers` populated them.
  // Anti-fabrication: every field uses `?? null` — missing upstream signals
  // propagate as null, never invented. Never substitutes default values.
  const lc = row?.lineupContextV2 || null
  const pc = row?.parkContext     || null
  const wc = row?.weatherContext  || null
  return {
    slateDate,
    sport: "mlb",
    player: row?.player ?? null,
    team: row?.team ?? null,
    propType: row?.propType ?? null,
    side: row?.side ?? null,
    line: row?.line ?? null,
    odds: row?.odds ?? null,
    predictedProbability: row?.predictedProbability ?? null,
    edgeProbability: row?.edgeProbability ?? null,
    mlbPhase3Score: row?.mlbPhase3Score ?? null,
    timestamp,

    // Phase 4 result fields (initially null)
    result: null, // "win" | "loss" | null
    closingOdds: null,
    clv: null,

    // Traceability (non-breaking, additive)
    book: row?.book ?? null,
    marketKey: row?.marketKey ?? null,
    bucket: "mlb.bestAvailable.best",

    // 2026-05-31 Phase #71-MLB — propagate tier + volatility so
    // archetypeHistoryLookup can hit the richer (sport, volatility, tier)
    // bucket on MLB picks instead of falling back to family-only.
    // Anti-fabrication: `?? null` — never invented.
    tier:       row?.tier       ?? null,
    volatility: row?.volatility ?? null,
    // 2026-06-11 R2-4 — tierPolicy stamp propagation, present IFF upstream
    // stamped it (MLB_BUCKET_TIER_POLICY ON in buildMlbPropClusters.makePlay).
    // Conditional spread (displayBundle precedent below) keeps OFF artifacts
    // byte-identical — field ABSENT when policy OFF, never null, never "off".
    ...(row?.tierPolicy != null ? { tierPolicy: row.tierPolicy } : {}),
    // 2026-07-05 G1-Serve-1A — calibration stamps, present IFF the serve-surface
    // injection stamped this row (MLB_CALIB_LIVE ON + board join hit); on stamped
    // rows predictedProbability above IS the calibrated prob and modelProbRaw
    // preserves the board raw. Conditional spread (tierPolicy precedent): OFF /
    // unstamped ⇒ keys ABSENT ⇒ byte-identical. Absence of calibVersion on a
    // persisted row = raw era — that IS the version history; already-persisted
    // rows are NEVER rewritten (recordMlbBestProps legKey dedupe is append-only).
    ...(row?.calibVersion != null ? { calibVersion: row.calibVersion, modelProbRaw: row.modelProbRaw ?? null } : {}),

    // ── Phase Item 0002 Slice 1 — canonical hydration lift ──────────────
    // (a) game-identity (FE Discover indexing)
    eventId:          row?.eventId  ?? null,
    matchup:          row?.matchup  ?? null,
    gameTime:         row?.gameTime ?? null,
    awayTeam:         row?.awayTeam ?? null,
    homeTeam:         row?.homeTeam ?? null,

    // (b) BC-1 canonical realism signals (top-level for BC-8 + buildFeaturedPlays.normalizeCandidate)
    impliedTeamTotal: Number.isFinite(Number(row?.impliedTeamTotal)) ? Number(row.impliedTeamTotal) : null,
    gameTotal:        Number.isFinite(Number(row?.gameTotal))        ? Number(row.gameTotal)        : null,
    hrEnvironmentTag: pc?.hrEnvironmentTag ?? row?.hrEnvironmentTag ?? null,
    // 2026-06-01 Phase MLB-Platoon-Persistence-Fix-1A (#135) — see toMlbBestEntry
    // (b) above for full context. Canonical 4-input contract per
    // [[project-pick-origin-architecture]] — was being dropped at the whitelist.
    isPlatoonAdvantage: typeof row?.isPlatoonAdvantage === "boolean" ? row.isPlatoonAdvantage : null,

    // (c) lineup / survivability inputs (lifted from nested lineupContextV2)
    lineupSpot:            lc?.lineupSpot            ?? row?.lineupPosition ?? row?.battingOrderIndex ?? null,
    depth:                 lc?.depth                 ?? null,
    plateAppearancesProxy: lc?.plateAppearancesProxy ?? null,
    runEnvironment:        lc?.runEnvironment        ?? null,
    rbiEnvironment:        lc?.rbiEnvironment        ?? null,
    // 2026-06-09 — preserve the external id so the reliable id-join fires on future
    // lineup back-fills (the name-fallback is lossy). Null when upstream didn't carry it.
    playerIdExternal:      row?.playerIdExternal ?? (row?.__src && row.__src.playerIdExternal) ?? null,

    // (d) environmental tuners (lifted from nested parkContext / weatherContext)
    hrFactor:         pc?.hrFactor         ?? row?.hrFactor         ?? null,
    windDirectionTag: wc?.windDirectionTag ?? row?.windDirectionTag ?? null,
    carryShift:       wc?.carryShift       ?? row?.carryShift       ?? null,
    temperatureF:     wc?.temperatureF     ?? row?.temperatureF     ?? null,
    contextualTags:   Array.isArray(row?.mlbContextualTags) ? row.mlbContextualTags : null,
    // 2026-06-08 Step-2 — carry the board pick's displayBundle. Gated by presence:
    // when the bundle is absent (kill-switch OFF, or non-board row) the spread adds
    // NOTHING ⇒ every existing field byte-identical to pre-Step-2. Built in the
    // server.js best-row attach (buildMlbLiveDualBestAvailablePayload).
    ...(row?.displayBundle ? { displayBundle: row.displayBundle } : {}),
  }
}

/**
 * Record MLB best props for Phase 4 tracking.
 * Writes only to `backend/runtime/tracking/mlb_tracked_best_<date>.json` (MLB-only, queryable).
 * On first create, seeds from legacy `tracked_props_<date>.json` MLB rows if present (one-time carryover).
 *
 * @param {object[]} bestProps
 * @param {{ now?: number }} options
 * @returns {{ ok: boolean, path: string, added: number, totalMlbBest: number }}
 */
function recordMlbBestProps(bestProps, options = {}) {
  const now = Number.isFinite(options?.now) ? Number(options.now) : Date.now()
  const slateDate = dateKeyFromNow(now)
  const timestamp = new Date(now).toISOString()

  const runtimeDir = runtimeTrackingDir()
  ensureDirSync(runtimeDir)
  const filePath = mlbTrackedBestPath(slateDate)

  const existingRaw = safeReadJson(filePath)
  let { metadata, entries } = normalizeMlbTrackedPayload(existingRaw)

  if (!existingRaw && entries.length === 0) {
    entries = loadLegacyMlbBestEntries(slateDate)
  }

  const payload = {
    metadata: {
      ...(metadata && typeof metadata === "object" ? metadata : {}),
      sport: "mlb",
      slateDate,
      generatedAt: timestamp,
      version: "tracking-phase-4-mlb",
      bucket: "mlb.bestAvailable.best",
      storage: "mlb_tracked_best",
    },
    entries: [...entries],
  }

  const incoming = Array.isArray(bestProps) ? bestProps : []
  const seen = new Set(entries.map((e) => legKey(e)))
  let added = 0

  // 2026-06-09 — back-fill lineupSpot from the fresh cache (one cache load per run).
  const _lineupBackfill = makeLineupBackfiller()
  for (const row of incoming) {
    const key = legKey(row)
    if (!key || key === "|||||") continue
    if (seen.has(key)) continue
    seen.add(key)
    backfillRowLineup(row, _lineupBackfill)
    payload.entries.push(toTrackedMlbBestEntry(row, { slateDate, timestamp }))
    added += 1
  }

  const ok = safeWriteJson(filePath, payload)
  const totalMlbBestAfter = payload.entries.length
  return { ok, path: filePath, added, totalMlbBest: totalMlbBestAfter }
}

/**
 * Evaluate MLB tracked performance (Phase 4).
 * Reads `mlb_tracked_best_<date>.json`; falls back to legacy rows inside `tracked_props_<date>.json` if empty.
 *
 * @param {{ date?: string, now?: number }} options
 * @returns {{
 *   ok: boolean,
 *   date: string,
 *   source: string,
 *   totalBets: number,
 *   wins: number,
 *   losses: number,
 *   hitRate: number|null,
 *   avgOdds: number|null,
 *   avgEdge: number|null
 * }}
 */
function evaluateMlbPerformance(options = {}) {
  const now = Number.isFinite(options?.now) ? Number(options.now) : Date.now()
  const date = typeof options?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(options.date)
    ? options.date
    : dateKeyFromNow(now)

  const snap = readMlbTrackedBestSnapshot(date)
  let mlb = Array.isArray(snap.payload?.entries) ? snap.payload.entries : []
  let source = snap.ok && mlb.length ? "mlb_tracked_best" : "none"

  if (!mlb.length) {
    mlb = loadLegacyMlbBestEntries(date)
    source = mlb.length ? "tracked_props_legacy" : "none"
  }

  const totalBets = mlb.length
  const wins = mlb.filter((e) => e?.result === "win").length
  const losses = mlb.filter((e) => e?.result === "loss").length
  const decided = wins + losses
  const hitRate = decided > 0 ? wins / decided : 0

  const oddsVals = mlb.map((e) => Number(e?.odds)).filter((n) => Number.isFinite(n))
  const avgOdds = oddsVals.length ? oddsVals.reduce((a, b) => a + b, 0) / oddsVals.length : null

  const edgeVals = mlb.map((e) => Number(e?.edgeProbability)).filter((n) => Number.isFinite(n))
  const avgEdge = edgeVals.length ? edgeVals.reduce((a, b) => a + b, 0) / edgeVals.length : null

  const emptyBucket = () => ({ totalBets: 0, wins: 0, losses: 0, hitRate: 0 })

  const normalizePropTypeKey = (pt) => {
    const s = String(pt || "").trim()
    if (!s) return "unknown"
    if (s === "Home Runs") return "HR"
    if (s === "Hits") return "Hits"
    if (s === "Total Bases") return "TB"
    if (s === "RBIs") return "RBI"
    return s
  }

  const edgeBucket = (edge) => {
    const e = Number(edge)
    if (!Number.isFinite(e)) return "unknown"
    if (e < 0.1) return "0-0.1"
    if (e < 0.2) return "0.1-0.2"
    if (e < 0.3) return "0.2-0.3"
    if (e < 0.4) return "0.3-0.4"
    return "0.4+"
  }

  const oddsBucket = (odds) => {
    const o = Number(odds)
    if (!Number.isFinite(o) || o === 0) return "unknown"
    if (o < 0) {
      if (o >= -110) return "fav_-110_to_-101"
      if (o >= -150) return "fav_-150_to_-111"
      if (o >= -250) return "fav_-250_to_-151"
      return "fav_-250+"
    }
    if (o <= 120) return "plus_+1_to_+120"
    if (o <= 200) return "plus_+121_to_+200"
    if (o <= 400) return "plus_+201_to_+400"
    return "plus_+401+"
  }

  const bump = (map, key, entry) => {
    const k = String(key || "unknown")
    if (!map[k]) map[k] = emptyBucket()
    map[k].totalBets += 1
    if (entry?.result === "win") map[k].wins += 1
    if (entry?.result === "loss") map[k].losses += 1
  }

  const finalizeBuckets = (map) => {
    const out = {}
    for (const [k, v] of Object.entries(map)) {
      const d = (v.wins || 0) + (v.losses || 0)
      out[k] = {
        totalBets: v.totalBets,
        wins: v.wins,
        losses: v.losses,
        hitRate: d > 0 ? v.wins / d : 0,
      }
    }
    return out
  }

  const byPropTypeMap = {}
  const byEdgeBucketMap = {}
  const byOddsBucketMap = {}

  for (const e of mlb) {
    bump(byPropTypeMap, normalizePropTypeKey(e?.propType), e)
    bump(byEdgeBucketMap, edgeBucket(e?.edgeProbability), e)
    bump(byOddsBucketMap, oddsBucket(e?.odds), e)
  }

  const learning = {
    byPropType: finalizeBuckets(byPropTypeMap),
    byEdgeBucket: finalizeBuckets(byEdgeBucketMap),
    byOddsBucket: finalizeBuckets(byOddsBucketMap),
  }

  const rankBuckets = (obj, minDecided = 3) => {
    const rows = Object.entries(obj || {}).map(([key, v]) => {
      const decidedLocal = (v.wins || 0) + (v.losses || 0)
      return { key, ...v, decided: decidedLocal }
    })
    const eligible = rows.filter((r) => r.decided >= minDecided)
    const sorted = eligible.slice().sort((a, b) => b.hitRate - a.hitRate)
    return {
      minDecided,
      best: sorted.slice(0, 3).map((r) => ({ key: r.key, hitRate: r.hitRate, wins: r.wins, losses: r.losses, totalBets: r.totalBets })),
      worst: sorted
        .slice()
        .reverse()
        .slice(0, 3)
        .map((r) => ({ key: r.key, hitRate: r.hitRate, wins: r.wins, losses: r.losses, totalBets: r.totalBets })),
    }
  }

  console.log("[MLB LEARNING]", {
    date,
    file: snap?.path || null,
    totals: { totalBets, wins, losses, decided, hitRate },
    byPropType: rankBuckets(learning.byPropType),
    byEdgeBucket: rankBuckets(learning.byEdgeBucket),
    byOddsBucket: rankBuckets(learning.byOddsBucket),
  })

  return {
    ok: true,
    date,
    source,
    file: snap?.path || null,
    count: totalBets,
    totalBets,
    wins,
    losses,
    hitRate,
    avgOdds,
    avgEdge,
    learning,
  }
}

/**
 * Record today's MLB picks (every run; file grows).
 * Writes to `backend/runtime/tracking/mlb_picks_<date>.json`.
 *
 * @param {object[]} bestRows
 * @param {{ now?: number }} options
 * @returns {{ ok: boolean, path: string, added: number, total: number }}
 */
function recordMlbDailyPicks(bestRows, options = {}) {
  const now = Number.isFinite(options?.now) ? Number(options.now) : Date.now()
  const slateDate = dateKeyFromNow(now)
  const timestamp = new Date(now).toISOString()

  const runtimeDir = runtimeTrackingDir()
  ensureDirSync(runtimeDir)
  const filePath = mlbPicksPath(slateDate)

  const existing = safeReadJson(filePath)
  const payload = {
    metadata: {
      sport: "mlb",
      slateDate,
      version: "mlb-picks-v1",
      updatedAt: timestamp,
    },
    picks: Array.isArray(existing?.picks) ? existing.picks : [],
  }

  const incoming = Array.isArray(bestRows) ? bestRows : []
  // Avoid duplicates within a single run only.
  const runSeen = new Set()
  let added = 0
  // 2026-06-09 — back-fill lineupSpot from the fresh cache (one cache load per run).
  const _lineupBackfill = makeLineupBackfiller()
  for (const row of incoming) {
    const key = legKey(row)
    if (!key || key === "|||||") continue
    if (runSeen.has(key)) continue
    runSeen.add(key)
    backfillRowLineup(row, _lineupBackfill)
    payload.picks.push(toTrackedMlbPick(row, { slateDate, timestamp }))
    added += 1
  }

  const ok = safeWriteJson(filePath, payload)
  return { ok, path: filePath, added, total: Array.isArray(payload.picks) ? payload.picks.length : 0 }
}

/**
 * Evaluate today's MLB picks.
 * @param {{ date?: string, now?: number }} options
 * @returns {{
 *   ok: boolean,
 *   date: string,
 *   path: string,
 *   totalPicks: number,
 *   decided: number,
 *   wins: number,
 *   losses: number,
 *   hitRate: number,
 *   avgEdge: number,
 *   avgPredictedProbability: number
 * }}
 */
function evaluateMlbPicks(options = {}) {
  const now = Number.isFinite(options?.now) ? Number(options.now) : Date.now()
  const date = typeof options?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(options.date)
    ? options.date
    : dateKeyFromNow(now)

  const filePath = mlbPicksPath(date)
  const raw = safeReadJson(filePath)
  const picks = Array.isArray(raw?.picks) ? raw.picks : []

  const wins = picks.filter((p) => p?.result === "win").length
  const losses = picks.filter((p) => p?.result === "loss").length
  const decided = wins + losses
  const hitRate = decided > 0 ? wins / decided : 0

  const edgeVals = picks.map((p) => Number(p?.edge)).filter((n) => Number.isFinite(n))
  const avgEdge = edgeVals.length ? edgeVals.reduce((a, b) => a + b, 0) / edgeVals.length : 0

  const predVals = picks.map((p) => Number(p?.predictedProbability)).filter((n) => Number.isFinite(n))
  const avgPredictedProbability = predVals.length ? predVals.reduce((a, b) => a + b, 0) / predVals.length : 0

  return {
    ok: true,
    date,
    path: filePath,
    totalPicks: picks.length,
    decided,
    wins,
    losses,
    hitRate,
    avgEdge,
    avgPredictedProbability,
  }
}



// ---- Best-bets / slip tracking (daily JSON; complements Phase 4 mlb_tracked_best) ----
/**
 * MLB Performance Tracking + Lightweight Model Feedback.
 *
 *   - ALWAYS records bets/slips to disk (fire-and-forget, never blocks pipeline)
 *   - Reads only the last N days of tracking files to build a summary
 *   - Produces non-binding `confidenceAdjustments` (small multipliers 0.90–1.10)
 *
 * The bet/slip files are written to:
 *
 *   backend/runtime/tracking/mlb_tracked_bets_YYYY-MM-DD.json
 *   backend/runtime/tracking/mlb_tracked_slips_YYYY-MM-DD.json
 *   backend/runtime/tracking/mlb_tracking_summary_YYYY-MM-DD.json
 *
 * Existing legacy `tracked_props_*` and `tracking_summary_*` filenames (used by
 * the slate snapshot system) are NOT touched, by design.
 *
 * Performance constraints:
 *   - Disk writes are async + non-awaited (pipeline never blocks)
 *   - Summary scan reads at most `windowDays` files (default 14)
 *   - Summary compute is O(totalBets in window)
 *   - Pruning runs async after summary
 *
 * Tracked fields (intentionally minimal — no projection objects, no raw rows):
 *   bet:  { id, date, player, eventId, prop, statFamily, side, line,
 *           oddsAmerican, sportsbook, modelProb, edge, confidence, tier,
 *           result }
 *   slip: { id, date, type, legs[{player,statFamily,side,line,oddsAmerican,result}],
 *           combinedAmericanOdds, combinedDecimalOdds, combinedModelProb, edge,
 *           result }
 */


const BETS_PREFIX = "mlb_tracked_bets_"
const SLIPS_PREFIX = "mlb_tracked_slips_"
const SUMMARY_PREFIX = "mlb_tracking_summary_"

const DEFAULT_WINDOW_DAYS = 14
// Phase G1-Prune-Margin-1A (2026-06-24) — was 14, which ≈ the G1 gate's 14-clean-night need counted
// from these SAME tracking files → zero margin → the pruner ate the oldest clean night
// (mlb_tracked_bets_2026-06-11 = game-night 06-12) as each new one arrived, stalling cleanCount ~11 so
// the gate could never reach 14. 45 comfortably exceeds the gate need + the forward-CLV window; cutoff
// lands ~05-11, so the whole freeze-forward window (06-11 onward) is safe. ~45×3MB ≈ 135MB, fine.
const DEFAULT_PRUNE_KEEP_DAYS = 45

function fileFor(prefix, date) {
  return path.join(runtimeTrackingDir(), `${prefix}${date}.json`)
}

function readJsonSafe(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback
    const s = fs.readFileSync(p, "utf8")
    if (!s) return fallback
    return JSON.parse(s)
  } catch (_) {
    return fallback
  }
}

/**
 * Atomic-ish write: write to .tmp then rename. Async, never throws into caller.
 */
function writeJsonAsync(p, obj) {
  try {
    ensureDirSync(runtimeTrackingDir())
    const tmp = `${p}.tmp.${process.pid}.${Date.now()}`
    const data = JSON.stringify(obj, null, 0)
    fs.writeFile(tmp, data, "utf8", (err) => {
      if (err) return // swallow
      fs.rename(tmp, p, () => {
        // swallow rename error
      })
    })
  } catch (_) {
    // never throw from tracking
  }
}

/**
 * Synchronous, atomic-ish write. Used ONLY for the small daily bets/slips
 * files that the immediate-next summary read depends on. Files are <100KB,
 * so the cost is sub-millisecond and does not violate the "never slow the
 * pipeline" rule.
 *
 * Wrapped in try/catch — any disk error becomes a no-op so tracking failures
 * cannot break the live pipeline.
 */
function writeJsonSync(p, obj) {
  try {
    ensureDirSync(runtimeTrackingDir())
    const data = JSON.stringify(obj, null, 0)
    const tmp = `${p}.tmp.${process.pid}.${Date.now()}`
    fs.writeFileSync(tmp, data, "utf8")
    fs.renameSync(tmp, p)
  } catch (_) {
    // never throw from tracking
  }
}

/**
 * Stable id for a bet/leg so result ingestion can match without ordering.
 * Includes date so the same prop on different days is distinct.
 */
function idForBet(date, bet) {
  return [
    date,
    String(bet?.player || "").toLowerCase(),
    String(bet?.eventId || "").toLowerCase(),
    String(bet?.statFamily || "").toLowerCase(),
    String(bet?.side || "").toLowerCase(),
    Number(bet?.line),
    Number(bet?.oddsAmerican),
    String(bet?.sportsbook || "").toLowerCase(),
  ].join("|")
}

function idForSlipLeg(date, slipId, leg) {
  return [
    slipId,
    String(leg?.player || "").toLowerCase(),
    String(leg?.statFamily || "").toLowerCase(),
    String(leg?.side || "").toLowerCase(),
    Number(leg?.line),
  ].join("|")
}

function idForSlip(date, slip) {
  // Stable: type + sorted legs (player|stat|side|line)
  const legs = Array.isArray(slip?.legs) ? slip.legs : []
  const sig = legs
    .map((l) =>
      [
        String(l?.player || "").toLowerCase(),
        String(l?.statFamily || "").toLowerCase(),
        String(l?.side || "").toLowerCase(),
        Number(l?.line),
      ].join("|")
    )
    .sort()
    .join("__")
  return [date, String(slip?.type || ""), sig].join("##")
}

/**
 * Convert a bestBetsBoard play into the lean tracked-bet record.
 * Strips projection / range / reasoning to keep the file small.
 */
function leanBet(play, date) {
  // Authoritative team resolution — priority order:
  //   1. play.team      (teamResolved from current slate enrichment — most authoritative)
  //   2. play.teamCode  (code form of same)
  //   3. play.awayTeam / play.homeTeam (from sportsbook event row)
  //   All four are carried through makePlay() from buildMlbPropClusters.
  //   Persisting them here ensures every downstream consumer (correlation grouping,
  //   ecology grouping, portfolio diversification, slip construction team gates)
  //   gets the current-slate team assignment — not a stale cache or matchup parse.
  // 2026-05-28 — Lane B Phase 1 port to MLB: stamp gameTime + open-side CLV
  // fields at write-time. Mirror of NBA leanBet (buildNbaPerformanceTracking).
  // Without these, captureClosingLines can't determine in-window eligibility
  // (no gameTime) and the CLV math has no anchor (no openOdds).
  const openImp = clvMath.impliedFromAmerican(play.oddsAmerican)
  return {
    id: idForBet(date, play),
    date,
    player: play.player,
    eventId: play.eventId || null,
    matchup: play.matchup || null,
    gameTime: play.gameTime || play.commenceTime || play.commence_time || null,
    team: play.team ?? null,
    teamCode: play.teamCode ?? null,
    awayTeam: play.awayTeam ?? null,
    homeTeam: play.homeTeam ?? null,
    prop: `${play.statFamily} ${play.side} ${play.line}`,
    statFamily: play.statFamily,
    side: play.side,
    line: play.line,
    oddsAmerican: play.oddsAmerican,
    sportsbook: play.sportsbook || null,
    modelProb: play.modelProb,
    impliedProb: play.impliedProb,
    edge: play.edge,
    confidence: play.confidence,
    tier: play.tier,
    // 2026-06-11 R2-4 — tierPolicy stamp propagation onto tracked_bets rows
    // (the graded-corpus surface the 14d re-probe filters on). Present IFF
    // upstream stamped it; ABSENT when MLB_BUCKET_TIER_POLICY=0 (byte-identical).
    ...(play?.tierPolicy != null ? { tierPolicy: play.tierPolicy } : {}),
    // 2026-07-05 G1-Serve-1A — carry the G1 calibration stamps from makePlay onto
    // tracked_bets (the graded corpus the 14d verify filters on calibVersion — it
    // was BLIND because this whitelist stripped the stamp even though modelProb
    // above is already the calibrated value when MLB_CALIB_LIVE is ON). Present
    // IFF makePlay stamped; OFF ⇒ absent ⇒ byte-identical. Pre-fix persisted rows
    // are never rewritten — missing calibVersion = raw era, the version history.
    ...(play?.calibVersion != null ? { calibVersion: play.calibVersion, modelProbRaw: play.modelProbRaw ?? null } : {}),
    // 2026-06-12 T2-L1 — NB shadow-rung ride-along (validation only; never read
    // by scoring). Present IFF upstream attached it; ABSENT when MLB_NB_LADDER=0
    // or no fitted ladder for this batter/line (byte-identical OFF).
    ...(play?.nbProbOver != null ? { nbProbOver: play.nbProbOver, nbFit: play.nbFit ?? null } : {}),
    result: "pending",
    settledAt: null,
    // 2026-05-28 — Lane B Phase 3 v0.1.4 — marketKey identity preservation.
    // Same fix as NBA leanBet — without marketKey, captureClosingLines can
    // land on a different market (main vs alt) for the same logical pick
    // and produce fake CLV. Stamp marketKey here for downstream identity.
    marketKey: play.marketKey || null,
    propType:  play.propType  || null,
    // Lane B Phase 1 CLV fields:
    openOdds:        play.oddsAmerican,
    openObservedAt:  new Date().toISOString(),
    openImpliedProb: Number.isFinite(openImp) ? openImp : null,
    closeOdds:        null,
    closeObservedAt:  null,
    closeImpliedProb: null,
    clv:              null,
    clvQuality:       null,
    // Phase Calibration-Root-Cause-Audit-1A (2026-06-02 ~02:00 ET) — mirror
    // toTrackedMlbBestEntry's context-signal whitelist so the calibration
    // corpus (which reads tracked_bets) can see which signals the engine
    // actually used. Without this every MLB tracked_bet had lineupSpot/
    // hrEnvironmentTag/isPlatoonAdvantage/etc. = undefined → calibration
    // corpus was BLIND → per-signal grading impossible. Mirrors
    // toTrackedMlbBestEntry lines 162-189. Anti-fabrication: every field
    // uses `?? null` — never invented.
    impliedTeamTotal:      Number.isFinite(Number(play?.impliedTeamTotal)) ? Number(play.impliedTeamTotal) : null,
    gameTotal:             Number.isFinite(Number(play?.gameTotal))        ? Number(play.gameTotal)        : null,
    hrEnvironmentTag:      play?.hrEnvironmentTag ?? null,
    isPlatoonAdvantage:    typeof play?.isPlatoonAdvantage === "boolean" ? play.isPlatoonAdvantage : null,
    lineupSpot:            play?.lineupSpot ?? play?.lineupPosition ?? play?.battingOrderIndex ?? null,
    depth:                 play?.depth ?? null,
    plateAppearancesProxy: play?.plateAppearancesProxy ?? null,
    runEnvironment:        play?.runEnvironment ?? null,
    rbiEnvironment:        play?.rbiEnvironment ?? null,
    hrFactor:              play?.hrFactor ?? null,
    windDirectionTag:      play?.windDirectionTag ?? null,
    carryShift:            play?.carryShift ?? null,
    temperatureF:          play?.temperatureF ?? null,
    contextualTags:        Array.isArray(play?.mlbContextualTags) ? play.mlbContextualTags : (Array.isArray(play?.contextualTags) ? play.contextualTags : null),
  }
}

function leanSlip(slip, date) {
  // Phase Item 0003 Slice 2 — slip-persistence book-field hydration. Adds
  // book/sportsbook on every leg + slip.book + slip.alternativeBooks so the
  // verifier supplement (Item 0002 Slice 1.5 R-EXEC-S2-1) can validate same-
  // book curated discipline against the persisted artifact. Anti-fabrication:
  // every field uses `?? null` — never invents a book when upstream omitted.
  const id = idForSlip(date, slip)
  const legs = (slip.legs || []).map((l) => ({
    id: idForSlipLeg(date, id, l),
    player: l.player,
    team: l.team ?? null,
    teamCode: l.teamCode ?? null,
    eventId: l.eventId ?? null,
    matchup: l.matchup ?? null,
    statFamily: l.statFamily,
    side: l.side,
    line: l.line,
    oddsAmerican: l.oddsAmerican,
    // Phase Item 0003 Slice 2 — book / sportsbook persistence lift
    book:        l.book       ?? l.sportsbook ?? null,
    sportsbook:  l.sportsbook ?? l.book       ?? null,
    result: "pending",
  }))
  return {
    id,
    date,
    type: slip.type,
    legCount: slip.legCount,
    legs,
    combinedDecimalOdds: slip.combinedDecimalOdds,
    combinedAmericanOdds: slip.combinedAmericanOdds,
    combinedModelProb: slip.combinedModelProb,
    combinedImpliedProb: slip.combinedImpliedProb,
    edge: slip.edge,
    ev: slip.ev,
    // Phase Item 0003 Slice 2 — slip-level book + alternative books. Both
    // populated by buildSlipAi emit-boundary enforcement when slip survives
    // the same-book gate. Null-safe when upstream legacy path emitted slips
    // without book selection.
    book:              slip.book              ?? null,
    alternativeBooks:  Array.isArray(slip.alternativeBooks) ? slip.alternativeBooks : null,
    result: "pending",
    settledAt: null,
  }
}

/**
 * Public — fire-and-forget save of today's bets + slips. Never blocks.
 *
 * If a file already exists for today, merges by `id` keeping the existing
 * `result` for already-settled rows (so re-running the pipeline same day
 * doesn't reset graded results).
 */
function persistTrackedToday({ bestBetsBoard, date = dateKeyFromNow() } = {}) {
  if (!bestBetsBoard) return
  const board = bestBetsBoard
  const allPlays = Array.isArray(board.allPlays) ? board.allPlays : []

  // 2026-05-23 — HR capture fix. buildMlbPropClusters routes any play with
  // impliedProb < 0.1 to board.longshotPlays (not board.allPlays). That meant
  // batter_home_runs predictions never landed in tracked_bets — model prob
  // for HR is naturally 5-15%, all below the 10% longshot threshold.
  //
  // Fix: also persist longshotPlays + HR-flavored altPlays. They go through
  // the same leanBet() path so resulting tracked_bets rows are identical
  // shape, just with statFamily === "hr" instead of being missing entirely.
  //
  // Audit doc: scorecards/lane_scorecard_2026-05-23.md (NO DATA on MLB HR
  // across 19 days of tracked_bets prior to this fix).
  const longshotPlays = Array.isArray(board.longshotPlays) ? board.longshotPlays : []
  const altPlays      = Array.isArray(board.altPlays)      ? board.altPlays      : []
  const hrAltPlays    = altPlays.filter((p) => p && p.isHrProp)
  const captureExtras = [...longshotPlays, ...hrAltPlays]

  // -------- Bets --------
  const newBetsUnfiltered = [...allPlays, ...captureExtras].map((p) => leanBet(p, date))

  // 2026-07-10 SETTLE-SPINE-1 — THE BET-#1 ROOT CAUSE. The stale-pick filter
  // below used to run on the MERGED set (existing + new), so every hourly slate
  // run DELETED all rows whose games went final >1h earlier — including UNGRADED
  // pending rows (measured: the 07-07 file shrank 5,887 → 1,355 overnight;
  // McLain's tracked twin was destroyed by the ~23:00 run, hours before the 4 AM
  // nightly could grade it → no graded twin → batchSettleByFields had nothing to
  // match → the operator's WINNING first real bet sat pending 3 days, and its
  // close/CLV mirror died with the row). DOCTRINE: the per-date tracked file is
  // the day's RECORD — once persisted, rows leave ONLY via grading + the keepDays
  // prune. The filter now applies to the INCOMING batch only (its original
  // 2026-05-29 purpose: keep stale/rolled-over FRESH picks out).
  const HOUR_MS = 60 * 60 * 1000
  const nowMs = Date.now()
  const knownEventIdsMlb = new Set()
  try {
    const snapshotPath = path.join(__dirname, "..", "..", "snapshot-mlb.json")
    if (fs.existsSync(snapshotPath)) {
      const wrap = JSON.parse(fs.readFileSync(snapshotPath, "utf8"))
      const snap = wrap?.data || wrap
      const evs = Array.isArray(snap?.events) ? snap.events : []
      for (const e of evs) {
        const id = e?.id || e?.eventId
        if (id) knownEventIdsMlb.add(String(id))
      }
    }
  } catch (_) {}
  let droppedLayer1Mlb = 0
  let droppedLayer2Mlb = 0
  const newBets = newBetsUnfiltered.filter((b) => {
    if (b.gameTime) {
      const gtMs = new Date(b.gameTime).getTime()
      if (Number.isFinite(gtMs)) {
        if (gtMs <= nowMs - HOUR_MS) { droppedLayer1Mlb++; return false }
        return true
      }
    }
    if (b.eventId && knownEventIdsMlb.size > 0 && !knownEventIdsMlb.has(String(b.eventId))) {
      droppedLayer2Mlb++
      return false
    }
    return true
  })
  if (newBets.length < newBetsUnfiltered.length) {
    console.log(`[persistTrackedToday:mlb] filtered ${newBetsUnfiltered.length - newBets.length} stale INCOMING picks (layer1=${droppedLayer1Mlb} explicit-past, layer2=${droppedLayer2Mlb} eventId-not-in-snapshot) — persisted rows are NEVER dropped (SETTLE-SPINE-1)`)
  }
  const betsPath = fileFor(BETS_PREFIX, date)
  const existingBets = Array.isArray(readJsonSafe(betsPath, [])) ? readJsonSafe(betsPath, []) : []
  const mergedBetsById = new Map()
  for (const b of existingBets) mergedBetsById.set(b.id, b)
  for (const b of newBets) {
    const prev = mergedBetsById.get(b.id)
    // 2026-05-28 — Lane B Phase 1 port to MLB: CLV preservation rules.
    //   - openOdds / openObservedAt / openImpliedProb are STICKY — they reflect
    //     the FIRST observation of this pick. Re-runs MUST NOT overwrite or
    //     CLV measurement is invalid.
    //   - closeOdds / closeObservedAt / closeImpliedProb / clv / clvQuality
    //     are populated by captureClosingLines.js near tipoff. If prev already
    //     has them, preserve.
    const preservedClv = prev ? {
      openOdds:         prev.openOdds         ?? b.openOdds,
      openObservedAt:   prev.openObservedAt   ?? b.openObservedAt,
      openImpliedProb:  prev.openImpliedProb  ?? b.openImpliedProb,
      closeOdds:        prev.closeOdds        ?? b.closeOdds,
      closeObservedAt:  prev.closeObservedAt  ?? b.closeObservedAt,
      closeImpliedProb: prev.closeImpliedProb ?? b.closeImpliedProb,
      clv:              prev.clv              ?? b.clv,
      clvQuality:       prev.clvQuality       ?? b.clvQuality,
      // v0.1.4 — marketKey/propType sticky like openOdds for identity preservation.
      marketKey:        prev.marketKey        ?? b.marketKey,
      propType:         prev.propType         ?? b.propType,
    } : null
    if (prev && prev.result && prev.result !== "pending") {
      // Preserve graded result + CLV.
      mergedBetsById.set(b.id, { ...b, ...preservedClv, result: prev.result, settledAt: prev.settledAt })
    } else if (preservedClv) {
      // Same pick re-observed — keep open + close, refresh modelProb/edge/tier.
      mergedBetsById.set(b.id, { ...b, ...preservedClv })
    } else {
      mergedBetsById.set(b.id, b)
    }
  }
  // 2026-07-10 SETTLE-SPINE-1 — the two-layer stale filter MOVED ABOVE the merge
  // (incoming batch only). The merged set writes UNFILTERED: persisted rows are
  // the day's record and survive until grading + keepDays prune.
  writeJsonSync(betsPath, Array.from(mergedBetsById.values()))

  // -------- Slips --------
  const slips = board.slips || {}
  const slipBucket = []
  for (const t of ["safe", "balanced", "aggressive", "lotto"]) {
    for (const s of Array.isArray(slips[t]) ? slips[t] : []) {
      slipBucket.push({ ...s, type: s.type || t.toUpperCase() })
    }
  }
  const newSlips = slipBucket.map((s) => leanSlip(s, date))
  const slipsPath = fileFor(SLIPS_PREFIX, date)
  const existingSlips = Array.isArray(readJsonSafe(slipsPath, []))
    ? readJsonSafe(slipsPath, [])
    : []
  const mergedSlipsById = new Map()
  for (const s of existingSlips) mergedSlipsById.set(s.id, s)
  for (const s of newSlips) {
    const prev = mergedSlipsById.get(s.id)
    if (prev && prev.result && prev.result !== "pending") {
      mergedSlipsById.set(s.id, { ...s, result: prev.result, settledAt: prev.settledAt, legs: prev.legs })
    } else {
      mergedSlipsById.set(s.id, s)
    }
  }
  writeJsonSync(slipsPath, Array.from(mergedSlipsById.values()))

  // 2026-05-29 — auto-mirror to personal_ledger. After tracked_bets is written,
  // import to ledger so the CLV capture loop's mirror has matching entries.
  // Same pattern as NBA buildNbaPerformanceTracking. Wrapped in try/catch —
  // ledger import failure must never break the pipeline.
  try {
    if (_personalLedger && typeof _personalLedger.importFromTrackedBets === "function") {
      const r = _personalLedger.importFromTrackedBets({ sport: "mlb", date })
      if (r?.ok !== false) {
        const added = typeof r?.added === "number" ? r.added : (r?.added?.length || 0)
        const skipped = typeof r?.skipped === "number" ? r.skipped : (r?.skipped?.length || 0)
        console.log(`[persistTrackedToday:mlb] ledger auto-import: added ${added}, skipped ${skipped} (already in ledger)`)
      } else {
        console.log(`[persistTrackedToday:mlb] ledger auto-import skipped: ${r?.reason}`)
      }
    }
  } catch (e) {
    console.warn("[persistTrackedToday:mlb] ledger auto-import failed (non-fatal):", e?.message || e)
  }
}

/**
 * Apply a results map to today's tracked file. Used by the result-ingestion CLI.
 *
 * resultsByBetId: { [id]: "win" | "loss" | "void" | "push" }
 * resultsByLegId: { [legId]: "win" | "loss" | "void" | "push" }   (slips)
 *
 * Slip result derives automatically from legs:
 *   - any "loss" leg → slip "loss"
 *   - all "win" → slip "win"
 *   - else → "pending" (or "void" if any void w/ rest unsettled)
 *
 * Synchronous — this runs from a CLI/admin tool, NOT in the live pipeline.
 */
function applyResults({ date = dateKeyFromNow(), bets = {}, legs = {} } = {}) {
  const now = new Date().toISOString()
  const betsPath = fileFor(BETS_PREFIX, date)
  const slipsPath = fileFor(SLIPS_PREFIX, date)

  const trackedBets = readJsonSafe(betsPath, [])
  if (Array.isArray(trackedBets)) {
    for (const b of trackedBets) {
      const r = bets[b.id]
      if (r && b.result !== r) {
        b.result = r
        b.settledAt = now
      }
    }
    writeJsonSync(betsPath, trackedBets)
  }

  const trackedSlips = readJsonSafe(slipsPath, [])
  if (Array.isArray(trackedSlips)) {
    for (const slip of trackedSlips) {
      let anyLoss = false
      let allWin = true
      let anyPending = false
      for (const leg of slip.legs || []) {
        const lr = legs[leg.id]
        if (lr && leg.result !== lr) {
          leg.result = lr
        }
        if (leg.result === "loss") anyLoss = true
        if (leg.result !== "win") allWin = false
        if (!leg.result || leg.result === "pending") anyPending = true
      }
      if (anyLoss) {
        slip.result = "loss"
        slip.settledAt = now
      } else if (allWin) {
        slip.result = "win"
        slip.settledAt = now
      } else if (anyPending) {
        slip.result = "pending"
      } else {
        slip.result = "void"
        slip.settledAt = now
      }
    }
    writeJsonSync(slipsPath, trackedSlips)
  }

  return {
    date,
    betsUpdated: trackedBets.length,
    slipsUpdated: trackedSlips.length,
  }
}

/**
 * List YYYY-MM-DD strings for the last `windowDays` days, today inclusive.
 */
function recentDateKeys(windowDays = DEFAULT_WINDOW_DAYS) {
  const out = []
  const today = new Date()
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(today.getTime() - i * 24 * 3600 * 1000)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/**
 * Compute hit-rate metrics from settled bets.
 *
 *   hitRate = wins / (wins + losses)         (push/void excluded)
 *   roi     = sum(returnPerUnitStaked) / settledCount
 *
 * For ROI we approximate per-unit return using American odds:
 *   win:  decimalOdds - 1
 *   loss: -1
 *   void/push: 0
 */
function trAmericanToDecimal(odds) {
  const n = Number(odds)
  if (!Number.isFinite(n) || n === 0) return null
  if (n > 0) return 1 + n / 100
  return 1 + 100 / Math.abs(n)
}

function computeHitRoi(records, oddsKey = "oddsAmerican") {
  let wins = 0
  let losses = 0
  let pushes = 0
  let voids = 0
  let pending = 0
  let returnSum = 0
  let staked = 0
  for (const r of records || []) {
    const res = String(r.result || "pending").toLowerCase()
    if (res === "win") {
      wins += 1
      const d = trAmericanToDecimal(r[oddsKey])
      if (Number.isFinite(d)) returnSum += d - 1
      staked += 1
    } else if (res === "loss") {
      losses += 1
      returnSum -= 1
      staked += 1
    } else if (res === "push") {
      pushes += 1
    } else if (res === "void") {
      voids += 1
    } else {
      pending += 1
    }
  }
  const settled = wins + losses
  return {
    total: records.length,
    wins,
    losses,
    pushes,
    voids,
    pending,
    settled,
    hitRate: settled > 0 ? wins / settled : null,
    roi: staked > 0 ? returnSum / staked : null,
  }
}

/**
 * Compute confidence adjustment multiplier from observed vs expected.
 *
 * For a group with N settled bets:
 *   expectedHitRate = mean(modelProb of settled bets)
 *   observedHitRate = wins / settled
 *
 *   ratio = observed / expected
 *   multiplier = clamp(0.90, 1.10, 1 + (ratio - 1) * smoothing)
 *
 * `smoothing` shrinks the adjustment toward 1.0 when sample is small.
 */
function adjustmentFromGroup(records, settledStats) {
  if (!settledStats || settledStats.settled < 8) {
    return { multiplier: 1.0, reason: "insufficient sample (<8 settled)" }
  }
  const settled = records.filter((r) => {
    const v = String(r.result || "").toLowerCase()
    return v === "win" || v === "loss"
  })
  const expected =
    settled.reduce((a, r) => a + Number(r.modelProb || 0), 0) / Math.max(1, settled.length)
  const observed = settledStats.hitRate
  if (!Number.isFinite(observed) || !Number.isFinite(expected) || expected <= 0) {
    return { multiplier: 1.0, reason: "no valid expectation" }
  }
  const ratio = observed / expected
  // Smoothing scales with sample size; >=40 bets → full effect, <8 → ~0.
  const smoothing = Math.min(1, settledStats.settled / 40)
  const raw = 1 + (ratio - 1) * smoothing
  const multiplier = Math.max(0.9, Math.min(1.1, raw))
  return {
    multiplier: Math.round(multiplier * 1000) / 1000,
    expected: Math.round(expected * 10000) / 10000,
    observed: Math.round(observed * 10000) / 10000,
    sample: settledStats.settled,
    reason:
      ratio > 1.05
        ? "underconfident — model lower than reality, multiplier > 1"
        : ratio < 0.95
        ? "overconfident — model higher than reality, multiplier < 1"
        : "calibrated within ±5%",
  }
}

/**
 * Build the rolling summary across the last `windowDays` days.
 *
 * Output is intentionally compact:
 *   {
 *     window: { days, dates },
 *     bets:   { hit, roi, byStat: { points, threes, ... }, byTier: { ELITE, ... } },
 *     slips:  { hit, roi, byType: { SAFE, BALANCED, ... } },
 *     confidenceAdjustments: { byStat, byTier, byBoard },
 *   }
 */
function buildMlbTrackingSummary({ windowDays = DEFAULT_WINDOW_DAYS } = {}) {
  const generatedAt = new Date().toISOString()
  const dates = recentDateKeys(windowDays)
  const bets = []
  const slips = []
  for (const d of dates) {
    const b = readJsonSafe(fileFor(BETS_PREFIX, d), [])
    if (Array.isArray(b)) for (const r of b) bets.push(r)
    const s = readJsonSafe(fileFor(SLIPS_PREFIX, d), [])
    if (Array.isArray(s)) for (const r of s) slips.push(r)
  }

  // Overall.
  const betsAll = computeHitRoi(bets)

  // By stat family.
  const families = [
    "hits",
    "totalbases",
    "hr",
    "rbis",
    "runs",
    "batterks",
    "ks",
    "outs",
    "hitsallowed",
    "earnedruns",
    "walks",
  ]
  const byStat = {}
  for (const f of families) {
    const subset = bets.filter((r) => String(r.statFamily || "").toLowerCase() === f)
    const stats = computeHitRoi(subset)
    byStat[f] = {
      ...stats,
      adjustment: adjustmentFromGroup(subset, stats),
    }
  }

  // By tier.
  const tiers = ["ELITE", "STRONG", "PLAYABLE", "LONGSHOT"]
  const byTier = {}
  for (const t of tiers) {
    const subset = bets.filter((r) => String(r.tier || "").toUpperCase() === t)
    const stats = computeHitRoi(subset)
    byTier[t] = {
      ...stats,
      adjustment: adjustmentFromGroup(subset, stats),
    }
  }

  // Slips.
  const slipsAll = computeHitRoi(slips, "combinedAmericanOdds")
  const slipTypes = ["SAFE", "BALANCED", "AGGRESSIVE", "LOTTO"]
  const byType = {}
  for (const t of slipTypes) {
    const subset = slips.filter((r) => String(r.type || "").toUpperCase() === t)
    byType[t] = computeHitRoi(subset, "combinedAmericanOdds")
  }

  // Build the consolidated `confidenceAdjustments` block.
  const confidenceAdjustments = {
    byStat: Object.fromEntries(Object.entries(byStat).map(([k, v]) => [k, v.adjustment])),
    byTier: Object.fromEntries(Object.entries(byTier).map(([k, v]) => [k, v.adjustment])),
  }

  // Persist today's summary file (fire-and-forget).
  const today = dateKeyFromNow()
  const summaryPayload = {
    metadata: {
      date: today,
      generatedAt,
      windowDays,
      version: "mlb-tracking-v1",
    },
    window: { days: windowDays, dates },
    bets: {
      ...betsAll,
      byStat,
      byTier,
    },
    slips: {
      ...slipsAll,
      byType,
    },
    confidenceAdjustments,
  }
  writeJsonAsync(fileFor(SUMMARY_PREFIX, today), summaryPayload)

  return summaryPayload
}

/**
 * Async, fire-and-forget pruning. Removes any mlb_tracked_bets_, mlb_tracked_slips_
 * or mlb_tracking_summary_ file older than `keepDays`. Other files in the
 * directory (legacy systems) are left untouched.
 */
function pruneOldTrackingFilesAsync({ keepDays = DEFAULT_PRUNE_KEEP_DAYS } = {}) {
  setImmediate(() => {
    try {
      ensureDirSync(runtimeTrackingDir())
      const cutoff = Date.now() - keepDays * 24 * 3600 * 1000
      const files = fs.readdirSync(runtimeTrackingDir())
      for (const f of files) {
        if (
          !f.startsWith(BETS_PREFIX) &&
          !f.startsWith(SLIPS_PREFIX) &&
          !f.startsWith(SUMMARY_PREFIX)
        ) {
          continue
        }
        // Filename ends with YYYY-MM-DD.json — parse the date.
        const m = f.match(/(\d{4}-\d{2}-\d{2})\.json$/)
        if (!m) continue
        const t = Date.parse(m[1])
        if (!Number.isFinite(t)) continue
        if (t < cutoff) {
          fs.unlink(path.join(runtimeTrackingDir(), f), () => {})
        }
      }
    } catch (_) {
      // never throw
    }
  })
}
module.exports = {
  toTrackedMlbBestEntry, toTrackedMlbPick, // 2026-06-08 Step-2 test export (pure fns; no behavior change)
  leanBet, // 2026-07-05 G1-Serve-1A test export (pure fn; verifyServedCalibrationInjection stamp-carry assertion)
  readMlbTrackedBestSnapshot,
  recordMlbBestProps,
  evaluateMlbPerformance,
  recordMlbDailyPicks,
  evaluateMlbPicks,
  persistTrackedToday,
  applyResults,
  buildMlbTrackingSummary,
  pruneOldTrackingFilesAsync,
}
