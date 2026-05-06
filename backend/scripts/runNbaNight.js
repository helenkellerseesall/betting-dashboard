"use strict"

console.log("ACTIVE:", __filename)

/**
 * NBA nightly report — mirrors `runMlbNight.js` flow and console style.
 * GET /api/best-available?sport=basketball_nba → nbaOpportunityBoard + nbaInsightBoard (+ snapshot for slate / environment).
 */

const fs = require("fs")
const path = require("path")

const { praTierLabel, altPointsTierLabel } = require("../pipeline/nba/nbaExtendedOpportunityPools")
const { computeEdge } = require("../pipeline/utils/edge")
const { nbaRowModelProbabilityCore } = require("../pipeline/nba/nbaModelSignals")
const {
  computeFinalWeight,
  computeRealismScore,
  readContextScore,
  readMinutes,
  readUsageRate,
} = require("../pipeline/nba/nbaOpportunityCandidates")
const {
  applyTeamFallbackFromProjections,
  attachNbaEventGameContextToRow,
  buildNbaEventGameContextMap,
  enrichNbaRowStatLayerInputs,
  inferNbaEventGameContextFromPropRows,
  mergeNbaEventGameContextMaps,
} = require("../pipeline/nba/nbaEventTeamResolve")

const EDGE_SURFACE_MIN = 0.003

function mergeNbaSnapshotRows(snapshot) {
  const chunks = []
  const push = (arr) => {
    if (Array.isArray(arr) && arr.length) chunks.push(...arr)
  }
  if (!snapshot || typeof snapshot !== "object") return chunks
  push(snapshot.finalPlayableRows)
  push(snapshot.bestProps)
  push(snapshot.playableProps)
  push(snapshot.strongProps)
  push(snapshot.eliteProps)
  push(snapshot.props)
  push(snapshot.rawProps)
  return chunks
}

function isPointsCorePropType(pt) {
  const t = String(pt || "").toLowerCase()
  if (!t) return false
  if (/pra|points.*rebounds.*assists|pts.*reb.*ast/.test(t)) return false
  return /point/.test(t)
}

function isReboundsCorePropType(pt) {
  return /rebound/.test(String(pt || "").toLowerCase())
}

function isAssistsCorePropType(pt) {
  const t = String(pt || "").toLowerCase()
  return /assist/.test(t) && !/points.*rebounds|pra/.test(t)
}

function isPraCorePropType(pt) {
  const t = String(pt || "").toLowerCase()
  return /pra|points.*rebounds.*assists|pts.*reb.*ast/.test(t)
}

function insightRowToCandidate(x) {
  if (!x || typeof x !== "object") return null
  const player = String(x.player || "").trim()
  if (!player) return null
  return {
    player,
    team: String(x.team || "").trim() || null,
    opponent: String(x.opponent || "").trim() || null,
    eventId: String(x.eventId || "").trim() || null,
    propType: String(x.propType || "Prop").trim() || "Prop",
    ladder: String(x.prediction || "").trim() || null,
    line: x.line != null ? x.line : null,
    probability: x.probability,
    edge: x.edge,
  }
}

async function runAll() {
  try {
    console.log("Refreshing snapshot (NBA path also refreshes MLB sidecar snapshot)...")
    await fetch("http://localhost:4000/refresh-snapshot?force=1&sport=basketball_nba")

    console.log("Fetching best available (NBA)...")
    const res = await fetch("http://localhost:4000/api/best-available?sport=basketball_nba")
    let data = await res.json()

    let opp = data?.nbaOpportunityBoard && typeof data.nbaOpportunityBoard === "object" ? data.nbaOpportunityBoard : null
    let insight = data?.nbaInsightBoard && typeof data.nbaInsightBoard === "object" ? data.nbaInsightBoard : null
    let snapshot = data?.snapshot && typeof data.snapshot === "object" ? data.snapshot : null

    // If snapshot is empty, retry after explicit NBA refresh so team/event context is available.
    const snapEvents0 = Array.isArray(snapshot?.events) ? snapshot.events.length : 0
    const snapRows0 = mergeNbaSnapshotRows(snapshot).length
    if (snapEvents0 === 0 && snapRows0 === 0) {
      await fetch("http://localhost:4000/refresh-snapshot?force=1&sport=basketball_nba")
      const res2 = await fetch("http://localhost:4000/api/best-available?sport=basketball_nba")
      data = await res2.json()
      opp = data?.nbaOpportunityBoard && typeof data.nbaOpportunityBoard === "object" ? data.nbaOpportunityBoard : null
      insight = data?.nbaInsightBoard && typeof data.nbaInsightBoard === "object" ? data.nbaInsightBoard : null
      snapshot = data?.snapshot && typeof data.snapshot === "object" ? data.snapshot : null
    }

    if (!opp) throw new Error("Missing nbaOpportunityBoard in API response")
    if (!insight) throw new Error("Missing nbaInsightBoard in API response")

    let nbaGameContextMapCache = null
    function getNbaGameContextMap() {
      if (nbaGameContextMapCache) return nbaGameContextMapCache
      const mergedRows = mergeNbaSnapshotRows(snapshot)
      const fromEvents = buildNbaEventGameContextMap(snapshot?.events)
      const fromProps = inferNbaEventGameContextFromPropRows(mergedRows)
      nbaGameContextMapCache = mergeNbaEventGameContextMaps(fromEvents, fromProps)
      return nbaGameContextMapCache
    }

    function toNum(v) {
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }

    function fmtTeam(x) {
      const s = String(x == null ? "" : x).trim()
      return s ? s : "—"
    }

    function normalizeName(v) {
      return String(v == null ? "" : v)
        .toLowerCase()
        .replace(/\./g, " ")
        .replace(/\b(jr|sr|ii|iii|iv)\b/g, " ")
        .replace(/[^a-z\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    }

    const API_SPORTS_CACHE_FOR_NIGHT = path.join(__dirname, "..", "api-sports-cache.json")

    function statKeyFromPropTypeForRecentForm(propType) {
      const t = String(propType || "").toLowerCase()
      if (/three|threes|3pt/.test(t)) return "tpm"
      if (/rebound/.test(t)) return "totReb"
      if (/assist/.test(t)) return "assists"
      if (/point/.test(t) && !/pra|points.*rebounds.*assists|pts.*reb.*ast/.test(t)) return "points"
      if (/pra|points.*rebounds.*assists|pts.*reb.*ast/.test(t)) return "pra"
      return null
    }

    function propValueFromApiSportsLogForRecentForm(log, statKey) {
      if (!log || typeof log !== "object") return null
      switch (statKey) {
        case "points":
          return toNum(log.points)
        case "totReb":
          return toNum(log.totReb)
        case "assists":
          return toNum(log.assists)
        case "tpm":
          return toNum(log.tpm)
        case "pra": {
          const p = toNum(log.points) ?? 0
          const r = toNum(log.totReb) ?? 0
          const a = toNum(log.assists) ?? 0
          return p + r + a
        }
        default:
          return null
      }
    }

    function computeRecentFormFromLogsForRecentForm({ logs, statKey, line, side }) {
      const ln = toNum(line)
      const isOver = String(side || "").toLowerCase().includes("over")
      const isUnder = String(side || "").toLowerCase().includes("under")

      const sorted = [...(Array.isArray(logs) ? logs : [])].sort(
        (a, b) => (toNum(b?.game?.id) ?? 0) - (toNum(a?.game?.id) ?? 0)
      )

      const valsAll = sorted
        .map((g) => propValueFromApiSportsLogForRecentForm(g, statKey))
        .filter((v) => Number.isFinite(v))

      if (!valsAll.length) return null

      const avg = (xs) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length)
      const last5 = valsAll.slice(0, 5)
      const last10 = valsAll.slice(0, 10)
      const baseline = avg(valsAll)

      const last5_avg = avg(last5)
      const last10_avg = avg(last10)
      const trend_delta = last5_avg - baseline

      const hitRate = (xs) => {
        if (!Number.isFinite(ln)) return null
        if (!isOver && !isUnder) return null
        let hits = 0
        for (const v of xs) {
          if (!Number.isFinite(v)) continue
          if (isOver && v >= ln) hits += 1
          if (isUnder && v <= ln) hits += 1
        }
        return hits / Math.max(1, xs.length)
      }

      return {
        last5_avg,
        last10_avg,
        last5_hit_rate: hitRate(last5),
        last10_hit_rate: hitRate(last10),
        trend_delta,
        baseline,
        sampleSize5: last5.length,
        sampleSize10: last10.length,
        source: "api-sports-disk",
      }
    }

    function buildStatsByPlayerMapFromDiskCache() {
      const map = new Map()
      try {
        if (!fs.existsSync(API_SPORTS_CACHE_FOR_NIGHT)) return map
        const parsed = JSON.parse(fs.readFileSync(API_SPORTS_CACHE_FOR_NIGHT, "utf8"))
        const playerIdCache =
          parsed?.playerIdCache && typeof parsed.playerIdCache === "object" ? parsed.playerIdCache : {}
        const playerStatsCache =
          parsed?.playerStatsCache && typeof parsed.playerStatsCache === "object" ? parsed.playerStatsCache : {}
        for (const [playerName, info] of Object.entries(playerIdCache)) {
          if (!info || typeof info !== "object") continue
          const pid = toNum(info.id)
          if (!Number.isFinite(pid)) continue
          const logs = playerStatsCache[String(pid)]
          if (Array.isArray(logs) && logs.length) map.set(String(playerName).trim(), logs)
        }
      } catch {
        // ignore
      }
      return map
    }

    function getLogsForPlayerFromDiskMap(statsMap, player) {
      const p = String(player || "").trim()
      if (!p) return null
      if (statsMap.has(p)) return statsMap.get(p)
      const want = normalizeName(p)
      if (!want) return null
      for (const [k, logs] of statsMap) {
        if (normalizeName(k) === want) return logs
      }
      return null
    }

    function enrichEdgePlaysWithRecentFormFromDisk(mustRows) {
      const statsMap = buildStatsByPlayerMapFromDiskCache()
      if (!statsMap.size) return
      const formMemo = new Map()
      for (const row of mustRows) {
        if (!row || typeof row !== "object") continue
        if (row.recentForm && typeof row.recentForm === "object" && Number.isFinite(Number(row.recentForm.trend_delta)))
          continue
        const player = String(row.player || "").trim()
        const statKey = statKeyFromPropTypeForRecentForm(row.propType || row.marketKey)
        if (!player || !statKey) continue
        const logs = getLogsForPlayerFromDiskMap(statsMap, player)
        if (!Array.isArray(logs) || !logs.length) continue
        const memoKey = `${normalizeName(player)}__${statKey}__${String(row.line ?? "")}__${String(row.side ?? "")}`
        let rf = formMemo.get(memoKey) || null
        if (!rf) {
          rf = computeRecentFormFromLogsForRecentForm({ logs, statKey, line: row.line, side: row.side })
          if (rf) formMemo.set(memoKey, rf)
        }
        if (rf) row.recentForm = rf
      }
    }

    function fmtProb(x) {
      const n = toNum(x)
      if (!Number.isFinite(n)) return "n/a"
      return n.toFixed(3)
    }

    function fmtSignedEdge(x) {
      const n = toNum(x)
      if (!Number.isFinite(n)) return "n/a"
      const sign = n >= 0 ? "+" : ""
      const abs = Math.abs(n)
      const digits = abs >= 0.01 ? 3 : abs >= 0.001 ? 4 : 6
      return `${sign}${n.toFixed(digits)}`
    }

    function sortByFinalWeightOnlyDesc(a, b) {
      return (toNum(b?.finalWeight) ?? 0) - (toNum(a?.finalWeight) ?? 0)
    }

    function fmtDisplayLine(c) {
      const ln = toNum(c?.line)
      if (Number.isFinite(ln) && ln > 0) return String(ln)
      const lad = String(c?.ladder || "").trim()
      if (lad && !/^alt-mid$/i.test(lad)) return lad
      const pred = String(c?.prediction || "").trim()
      if (pred && !/^alt-mid$/i.test(pred)) return pred
      return "—"
    }

    function printPlayerPropLine(c) {
      const row = withFinalOutputFields(c)
      const prop = fmtTeam(row.propType || row.prediction || "Prop")
      const line = fmtDisplayLine(row)
      console.log(
        `- ${fmtTeam(row.player)} (${fmtTeam(row.team)}) — ${prop} — ${line} — ${fmtProb(row.probability)} — ${fmtSignedEdge(row.edge)}`
      )
    }

    function printPlayerPropLineCustom(c, opts = {}) {
      const row = withFinalOutputFields(c)
      const prop = fmtTeam(row.propType || row.prediction || "Prop")
      const line = fmtDisplayLine(row)
      const p = Number.isFinite(toNum(opts.probability)) ? toNum(opts.probability) : toNum(row.probability)
      const edge = Number.isFinite(toNum(opts.edge)) ? toNum(opts.edge) : toNum(row.edge)
      const note = String(opts.note || "").trim()
      const suffix = note ? ` — ${note}` : ""
      console.log(
        `- ${fmtTeam(row.player)} (${fmtTeam(row.team)}) — ${prop} — ${line} — ${fmtProb(p)} — ${fmtSignedEdge(edge)}${suffix}`
      )
    }

    const teamByPlayer = new Map()
    const rowsForTeam = mergeNbaSnapshotRows(snapshot)
    const eventTeams = new Map()

    for (const ev of Array.isArray(snapshot?.events) ? snapshot.events : []) {
      const eid = String(ev?.id ?? ev?.eventId ?? ev?.event_id ?? "").trim()
      if (!eid) continue
      let home = String(ev?.homeTeam ?? ev?.home_team ?? "").trim()
      let away = String(ev?.awayTeam ?? ev?.away_team ?? "").trim()
      const matchup = String(ev?.matchup || "").trim()
      if ((!home || !away) && matchup.includes("@")) {
        const parts = matchup.split("@").map((x) => String(x || "").trim())
        if (parts.length === 2) {
          if (!away && parts[0]) away = parts[0]
          if (!home && parts[1]) home = parts[1]
        }
      }
      if (!eventTeams.has(eid) && (home || away)) eventTeams.set(eid, { home, away })
    }

    for (const r of rowsForTeam) {
      const key = normalizeName(r?.player)
      if (!key) continue
      if (!teamByPlayer.has(key)) {
        const t = String(r?.teamResolved ?? r?.team ?? "").trim()
        if (t) teamByPlayer.set(key, t)
      }
      const eid = String(r?.eventId || "").trim()
      const home = String(r?.homeTeam ?? r?.home_team ?? "").trim()
      const away = String(r?.awayTeam ?? r?.away_team ?? "").trim()
      if (eid && !eventTeams.has(eid) && (home || away)) {
        eventTeams.set(eid, { home, away })
      }
    }

    function resolveTeam(candidate) {
      const direct = String(candidate?.team || "").trim()
      if (direct && direct !== "—") return direct
      const key = normalizeName(candidate?.player)
      if (key && teamByPlayer.has(key)) return teamByPlayer.get(key)

      const eid = String(candidate?.eventId || "").trim()
      if (eid && eventTeams.has(eid)) {
        const t = eventTeams.get(eid)
        const op = String(candidate?.opponent || "").trim()
        if (op) {
          if (t.home && t.home === op && t.away) return t.away
          if (t.away && t.away === op && t.home) return t.home
        }
        return t.home || t.away || "—"
      }
      const op = String(candidate?.opponent || "").trim()
      if (op) return op
      return "NBA"
    }

    function withFinalOutputFields(row) {
      if (!row || typeof row !== "object") return row
      const out = { ...row }
      const resolvedTeam = resolveTeam(out)
      if (!String(out.team || "").trim() || String(out.team).trim() === "—") out.team = resolvedTeam
      const p = toNum(nbaRowModelProbabilityCore(out))
      if (Number.isFinite(p)) out.probability = p
      out.edge = computeEdge(p, out?.odds)
      return out
    }

    function ensureFinalWeight(x) {
      if (!x || typeof x !== "object") return x
      if (Number.isFinite(toNum(x.finalWeight))) return x

      let out = applyTeamFallbackFromProjections({ ...x })
      const gMap = getNbaGameContextMap()
      if (gMap && gMap.size) {
        out = attachNbaEventGameContextToRow(out, gMap)
      }
      out = enrichNbaRowStatLayerInputs(out)
      const usageRate = readUsageRate(out) ?? 19
      const minutes = readMinutes(out) ?? 26
      const contextScore = readContextScore(out)
      const prob = toNum(out.probability ?? nbaRowModelProbabilityCore(out)) ?? 0.5
      const rawEdge = toNum(out.edge ?? computeEdge(prob, out?.odds)) ?? 0
      const realismScore = computeRealismScore({ usageRate, minutes, row: out, propType: out?.propType })
      const recentForm =
        out.recentForm && typeof out.recentForm === "object" ? out.recentForm : null
      const threesBL = toNum(out.threesBaseLine)

      const fw = computeFinalWeight({
        realismScore,
        predictedProbability: prob,
        edge: rawEdge,
        contextScore,
        line: out?.line,
        minutes,
        usageRate,
        propType: out?.propType || out?.marketKey,
        threesBaseLine: Number.isFinite(threesBL) ? threesBL : undefined,
        recentForm,
        player: out.player,
        matchupRow: out,
      })

      out.usageRate = usageRate
      out.minutes = minutes
      out.contextScore = contextScore
      out.realismScore = realismScore
      out.edge = fw.edge
      out.finalWeight = fw.finalWeight
      if (fw && typeof fw === "object" && Number.isFinite(Number(fw.matchupAdj))) out.matchupAdj = fw.matchupAdj
      if (fw && typeof fw === "object" && Number.isFinite(Number(fw.statAdj))) out.statAdj = fw.statAdj
      if (fw && typeof fw === "object" && Number.isFinite(Number(fw.paceAdj))) out.paceAdj = fw.paceAdj
      if (fw && typeof fw === "object" && Number.isFinite(Number(fw.blowoutAdj))) out.blowoutAdj = fw.blowoutAdj
      return out
    }

    function edgeValue(x) {
      const n = toNum(x?.edge)
      return Number.isFinite(n) ? n : -999
    }

    function sanitizedForOutput(x) {
      const row = ensureFinalWeight(withFinalOutputFields(x))
      const lineDisp = fmtDisplayLine(row)
      if (!lineDisp || lineDisp === "—") return null
      return row
    }

    function topBoardRows(primaryRows, fallbackRows, n) {
      const primary = (Array.isArray(primaryRows) ? primaryRows : [])
        .map((x) => sanitizedForOutput(x))
        .filter(Boolean)
      if (primary.length) return primary.sort(sortByFinalWeightOnlyDesc).slice(0, n)

      const fallback = (Array.isArray(fallbackRows) ? fallbackRows : [])
        .map((x) => sanitizedForOutput(x))
        .filter(Boolean)
        .sort(sortByFinalWeightOnlyDesc)
      return fallback.slice(0, n)
    }

    function gameKey(c) {
      const eid = String(c?.eventId || "").trim()
      if (eid) return `e:${eid}`
      const away = String(c?.opponent || "").trim()
      const home = String(c?.team || "").trim()
      if (away && home) return `m:${away}@${home}`
      return `t:${String(c?.team || "").trim().toUpperCase()}`
    }

    function pickDiverse(sortedCandidates, targetCount, opts = {}) {
      const maxPerTeam = toNum(opts.maxPerTeam) ?? 4
      const minGames = toNum(opts.minGames) ?? 5
      const pool = Array.isArray(sortedCandidates)
        ? sortedCandidates.map((x) => sanitizedForOutput(x)).filter(Boolean)
        : []
      const out = []
      const usedKeys = new Set()
      const teamPlayerCounts = new Map()

      function teamKey(c) {
        return String(c?.team || "").trim().toUpperCase()
      }

      function playerKey(c) {
        return String(c?.player || "")
          .trim()
          .toLowerCase()
      }

      function uniqKey(c) {
        return `${playerKey(c)}__${gameKey(c)}__${String(c?.ladder || c?.prediction || "").trim()}`
      }

      function gamesUsedCount() {
        return new Set(out.map((x) => gameKey(x))).size
      }

      function teamCountFor(team) {
        if (!team) return 0
        return teamPlayerCounts.get(team)?.size || 0
      }

      function addPick(c) {
        const k = uniqKey(c)
        if (usedKeys.has(k)) return false
        const t = teamKey(c)
        const pk = playerKey(c)
        if (t && pk) {
          const set = teamPlayerCounts.get(t) || new Set()
          if (set.has(pk)) return false
          set.add(pk)
          teamPlayerCounts.set(t, set)
        }
        usedKeys.add(k)
        out.push(c)
        return true
      }

      function scorePick(c, cap) {
        const fw = toNum(c?.finalWeight) ?? 0
        const gk = gameKey(c)
        const games = new Set(out.map((x) => gameKey(x)))
        const newGame = games.has(gk) ? 0 : 1
        const t = teamKey(c)
        const tc = t ? teamCountFor(t) : 0
        const overCap = t && tc >= cap ? 1 : 0
        return fw * 1000 + newGame * 35 - overCap * 500 - tc * 10
      }

      function pickPass(cap) {
        const remaining = pool.filter((c) => !usedKeys.has(uniqKey(c)))
        remaining.sort((a, b) => scorePick(b, cap) - scorePick(a, cap))
        for (const c of remaining) {
          if (out.length >= targetCount) return
          const t = teamKey(c)
          if (t && teamCountFor(t) >= cap) continue
          addPick(c)
        }
      }

      pickPass(maxPerTeam)

      let relax = 0
      while (out.length < targetCount && relax < 5) {
        relax += 1
        const cap = maxPerTeam + relax
        if (gamesUsedCount() >= minGames && out.length >= Math.min(targetCount, pool.length)) break
        pickPass(cap)
      }

      for (const c of pool) {
        if (out.length >= targetCount) break
        addPick(c)
      }

      out.sort(sortByFinalWeightOnlyDesc)
      return out.slice(0, targetCount)
    }

    function printHeader(title) {
      console.log("\n==== " + title + " ====")
    }

    function printSubHeader(label) {
      console.log("\n--- " + label + " ---")
    }

    const insightCoreAsCandidates = (Array.isArray(insight.corePropsBoard) ? insight.corePropsBoard : [])
      .map(insightRowToCandidate)
      .filter(Boolean)

    const allCoreOpp = Array.isArray(opp.coreCandidates) ? [...opp.coreCandidates].sort(sortByFinalWeightOnlyDesc) : []

    function poolForCore(filterFn) {
      const fromOpp = allCoreOpp.filter((c) => filterFn(c?.propType))
      if (fromOpp.length) return fromOpp

      const fromInsight = insightCoreAsCandidates.filter((c) => filterFn(c?.propType)).sort(sortByFinalWeightOnlyDesc)
      if (fromInsight.length) return fromInsight

      // Final fallback: mine ladder candidates by core stat type so CORE PROPS section is never empty.
      const fromLadders = (Array.isArray(opp?.ladderCandidates) ? opp.ladderCandidates : [])
        .filter((c) => filterFn(c?.propType))
        .sort(sortByFinalWeightOnlyDesc)
      return fromLadders
    }

    // 1) CORE PROPS (Points / Rebounds / Assists / PRA)
    printHeader("CORE PROPS")

    const coreBuckets = [
      { label: "Points", filter: isPointsCorePropType },
      { label: "Rebounds", filter: isReboundsCorePropType },
      { label: "Assists", filter: isAssistsCorePropType },
      { label: "PRA", filter: isPraCorePropType },
    ]

    for (const { label, filter } of coreBuckets) {
      printSubHeader(label)
      const pool = topBoardRows(
        poolForCore(filter),
        Array.isArray(opp?.ladderCandidates) ? opp.ladderCandidates.filter((x) => filter(x?.propType)) : [],
        20
      )
      if (!pool.length) {
        console.log("(none)")
        continue
      }
      pickDiverse(pool, 20, { maxPerTeam: 4, minGames: 5 }).forEach(printPlayerPropLine)
    }

    // 2) LADDERS (points+ / rebounds+ / assists+ / threes+ / PRA+)
    printHeader("LADDERS")

    const ladderBuckets = [
      { label: "Points+", key: "pointsLadderCandidates" },
      { label: "Rebounds+", key: "reboundsLadderCandidates" },
      { label: "Assists+", key: "assistsLadderCandidates" },
      { label: "Threes+", key: "threesLadderCandidates" },
    ]

    for (const { label, key } of ladderBuckets) {
      printSubHeader(label)
      const raw = topBoardRows(
        Array.isArray(opp[key]) ? opp[key] : [],
        Array.isArray(opp?.ladderCandidates) ? opp.ladderCandidates : [],
        20
      )
      if (!raw.length) {
        console.log("(none)")
        continue
      }
      pickDiverse(raw, 20, { maxPerTeam: 4, minGames: 5 }).forEach(printPlayerPropLine)
    }

    // 3) SPECIALS — double-double & triple-double (opportunity board; model uses scored Yes/Over rows)
    printHeader("SPECIALS")

    printSubHeader("Double-double")
    const dd = topBoardRows(
      Array.isArray(opp.doubleDoubleCandidates) ? opp.doubleDoubleCandidates : [],
      Array.isArray(insight?.specialBoard) ? insight.specialBoard : [],
      14
    )
    if (!dd.length) console.log("(none)")
    else pickDiverse(dd, 28, { maxPerTeam: 4, minGames: 5 }).forEach(printPlayerPropLine)

    printSubHeader("Triple-double")
    const td = topBoardRows(Array.isArray(opp.tripleDoubleCandidates) ? opp.tripleDoubleCandidates : [], [], 10)
    if (!td.length) console.log("(none)")
    else pickDiverse(td, 22, { maxPerTeam: 4, minGames: 5 }).forEach(printPlayerPropLine)

    // 4) PRA LADDER — combined PRA tiers (25+ / 30+ / 35+ / 40+)
    printHeader("PRA LADDER")

    const praPool = topBoardRows(
      Array.isArray(opp.praCandidates) ? opp.praCandidates : [],
      Array.isArray(opp?.praLadderCandidates) ? opp.praLadderCandidates : [],
      40
    )
    const praTiers = [25, 30, 35, 40]
    for (const tier of praTiers) {
      printSubHeader(`PRA ${tier}+`)
      const sub = praPool.filter((c) => praTierLabel(c?.line) === tier)
      if (!sub.length) console.log("(none)")
      else pickDiverse(sub, 24, { maxPerTeam: 4, minGames: 4 }).forEach(printPlayerPropLine)
    }

    // 5) ALT POINTS LADDER
    printHeader("ALT POINTS LADDER")

    // Build ONE unified global Points ladder pool (no split sources).
    // Source-of-truth: opp.ladderCandidates, filtered to Points ladder rows only.
    const globalPointsLadders = (() => {
      const src = Array.isArray(opp?.ladderCandidates) ? opp.ladderCandidates : []
      const onlyPointsLadders = src.filter((c) => {
        const pt = String(c?.propType || "").toLowerCase()
        if (!/point/.test(pt) || /pra|points.*rebounds.*assists|pts.*reb.*ast/.test(pt)) return false
        // Ladder-ish: ensure we're not mixing core/base points props into ladder tiers.
        const mk = String(c?.marketKey || "").toLowerCase()
        const lad = String(c?.ladder || c?.prediction || "").toLowerCase()
        return mk.includes("alternate") || mk.includes("_alt") || /ladder|\\+/.test(lad)
      })

      // Dedupe player+line to prevent fragmented sources from double-printing.
      const seen = new Set()
      const out = []
      for (const x of onlyPointsLadders) {
        const row = sanitizedForOutput(x)
        if (!row) continue
        const k = `${String(row.player || "").toLowerCase()}__${toNum(row.line) ?? "n/a"}`
        if (seen.has(k)) continue
        seen.add(k)
        out.push(row)
      }
      return out.sort(sortByFinalWeightOnlyDesc)
    })()

    const altPtTiers = [20, 25, 30, 35, 40]
    for (const tier of altPtTiers) {
      printSubHeader(`Points ${tier}+`)
      const threshold = tier - 0.5
      const sub = globalPointsLadders
        .filter((c) => {
          const n = toNum(c?.line)
          return Number.isFinite(n) && n >= threshold
        })
        .slice(0, 24)
      if (!sub.length) console.log("(none)")
      else sub.forEach(printPlayerPropLine)
    }

    // 6) ALT THREES
    printHeader("ALT THREES")

    // Build ONE unified global Threes ladder pool (no split sources).
    const globalThreesLadders = (() => {
      const src = Array.isArray(opp?.ladderCandidates) ? opp.ladderCandidates : []
      const onlyThreesLadders = src.filter((c) => {
        const pt = String(c?.propType || "").toLowerCase()
        if (!/three|threes|3pt/.test(pt)) return false
        const mk = String(c?.marketKey || "").toLowerCase()
        const lad = String(c?.ladder || c?.prediction || "").toLowerCase()
        return mk.includes("alternate") || mk.includes("_alt") || /ladder|\+/.test(lad)
      })

      const seen = new Set()
      const out = []
      for (const x of onlyThreesLadders) {
        const row = sanitizedForOutput(x)
        if (!row) continue
        const k = `${String(row.player || "").toLowerCase()}__${toNum(row.line) ?? "n/a"}`
        if (seen.has(k)) continue
        seen.add(k)
        out.push(row)
      }
      return out.sort(sortByFinalWeightOnlyDesc)
    })()

    const threesTiers = [
      { label: "Threes 2+", threshold: 1.5 },
      { label: "Threes 3+", threshold: 2.5 },
      { label: "Threes 4+", threshold: 3.5 },
      { label: "Threes 5+", threshold: 4.5 },
    ]

    for (const t of threesTiers) {
      printSubHeader(t.label)
      const sub = globalThreesLadders
        .filter((c) => {
          const n = toNum(c?.line)
          return Number.isFinite(n) && n >= t.threshold
        })
        .slice(0, 24)
      if (!sub.length) console.log("(none)")
      else sub.forEach(printPlayerPropLine)
    }

    // 7) COMBO PROPS
    printHeader("COMBO PROPS")

    const combosOpp = topBoardRows(
      Array.isArray(opp.comboCandidates) ? opp.comboCandidates : [],
      Array.isArray(opp?.coreCandidates) ? opp.coreCandidates : [],
      20
    )
    if (!combosOpp.length) console.log("(none)")
    else pickDiverse(combosOpp, 30, { maxPerTeam: 4, minGames: 5 }).forEach(printPlayerPropLine)

    // 8) FIRST BASKET (insight board)
    printHeader("FIRST BASKET")

    const fb = topBoardRows(
      Array.isArray(insight.firstBasketBoard) ? insight.firstBasketBoard : [],
      Array.isArray(insight?.specialBoard) ? insight.specialBoard : [],
      20
    )
    if (!fb.length) console.log("(none)")
    else fb.slice(0, 24).forEach((x) => printPlayerPropLine(x))

    // 9) GAME ENVIRONMENTS (snapshot.events first; row-derived fallback by eventId)
    printHeader("GAME ENVIRONMENTS")

    const mergedRows = mergeNbaSnapshotRows(snapshot)
    const byEvent = new Map()

    function upsertEvent(eid, patch) {
      if (!eid) return
      const g = byEvent.get(eid) || {
        eventId: eid,
        homeTeam: null,
        awayTeam: null,
        matchup: null,
        gameTotals: [],
        teamTotals: [],
      }
      Object.assign(g, patch)
      byEvent.set(eid, g)
    }

    for (const ev of Array.isArray(snapshot?.events) ? snapshot.events : []) {
      const eid = String(ev?.id ?? ev?.eventId ?? ev?.event_id ?? "").trim()
      if (!eid) continue
      const homeTeam = ev?.homeTeam ?? ev?.home_team ?? null
      const awayTeam = ev?.awayTeam ?? ev?.away_team ?? null
      const matchup = String(ev?.matchup || "").trim() || (awayTeam && homeTeam ? `${awayTeam} @ ${homeTeam}` : null)
      const eventPace = toNum(ev?.pace ?? ev?.projectedPace ?? ev?.gamePace)
      const eventTotal = toNum(ev?.gameTotal ?? ev?.total ?? ev?.overUnder)
      const eventSpread = toNum(ev?.spread ?? ev?.lineSpread)
      upsertEvent(eid, {
        homeTeam,
        awayTeam,
        matchup,
        eventPace: Number.isFinite(eventPace) ? eventPace : null,
        eventTotal: Number.isFinite(eventTotal) ? eventTotal : null,
        eventSpread: Number.isFinite(eventSpread) ? eventSpread : null,
      })
    }

    for (const r of mergedRows) {
      const eid = String(r?.eventId || "").trim()
      if (!eid) continue
      const g = byEvent.get(eid) || {
        eventId: eid,
        homeTeam: r?.homeTeam ?? r?.home_team ?? null,
        awayTeam: r?.awayTeam ?? r?.away_team ?? null,
        matchup: String(r?.matchup || "").trim() || null,
        eventPace: null,
        eventTotal: null,
        eventSpread: null,
        gameTotals: [],
        teamTotals: [],
      }
      if (!g.homeTeam && r?.homeTeam) g.homeTeam = r.homeTeam
      if (!g.homeTeam && r?.home_team) g.homeTeam = r.home_team
      if (!g.awayTeam && r?.awayTeam) g.awayTeam = r.awayTeam
      if (!g.awayTeam && r?.away_team) g.awayTeam = r.away_team
      if (!g.matchup && r?.matchup) g.matchup = String(r.matchup).trim()
      const gt = toNum(r?.gameTotal)
      if (Number.isFinite(gt)) g.gameTotals.push(gt)
      const itt = toNum(r?.impliedTeamTotal)
      if (Number.isFinite(itt)) g.teamTotals.push(itt)
      byEvent.set(eid, g)
    }

    if (!byEvent.size) {
      const candidatesForEnv = [
        ...(Array.isArray(opp.ladderCandidates) ? opp.ladderCandidates : []),
        ...(Array.isArray(opp.coreCandidates) ? opp.coreCandidates : []),
        ...(Array.isArray(opp.praCandidates) ? opp.praCandidates : []),
        ...(Array.isArray(opp.altPointsCandidates) ? opp.altPointsCandidates : []),
        ...(Array.isArray(opp.altThreesCandidates) ? opp.altThreesCandidates : []),
      ]
      for (const c0 of candidatesForEnv) {
        const c = withFinalOutputFields(c0)
        const eid = String(c?.eventId || "").trim()
        if (!eid) continue
        const team = String(c?.team || "").trim()
        const oppTeam = String(c?.opponent || "").trim()
        const g = byEvent.get(eid) || {
          eventId: eid,
          homeTeam: null,
          awayTeam: null,
          matchup: null,
          eventPace: null,
          eventTotal: null,
          eventSpread: null,
          gameTotals: [],
          teamTotals: [],
        }
        if (!g.matchup && team && oppTeam) g.matchup = `${team} vs ${oppTeam}`
        const implied = toNum(c?.impliedTeamTotal ?? c?.teamTotal)
        if (Number.isFinite(implied)) g.teamTotals.push(implied)
        byEvent.set(eid, g)
      }
    }

    // Build synthetic game totals/pace/spread proxies from event candidate distributions.
    for (const [eid, g] of byEvent.entries()) {
      if (Number.isFinite(g.eventTotal) && Number.isFinite(g.eventPace)) continue
      const eventRows = [
        ...(Array.isArray(opp.ladderCandidates) ? opp.ladderCandidates : []),
        ...(Array.isArray(opp.coreCandidates) ? opp.coreCandidates : []),
        ...(Array.isArray(opp.praCandidates) ? opp.praCandidates : []),
      ]
        .map((x) => withFinalOutputFields(x))
        .filter((x) => String(x?.eventId || "").trim() === eid)

      if (!eventRows.length) continue

      const pointLines = eventRows
        .filter((x) => /point/i.test(String(x?.propType || "")))
        .map((x) => toNum(x?.line))
        .filter((x) => Number.isFinite(x) && x > 0)

      const praLines = eventRows
        .filter((x) => /pra|points.*rebounds.*assists/i.test(String(x?.propType || "")))
        .map((x) => toNum(x?.line))
        .filter((x) => Number.isFinite(x) && x > 0)

      const blendedLine =
        (pointLines.length ? pointLines.reduce((a, b) => a + b, 0) / pointLines.length : null) ??
        (praLines.length ? (praLines.reduce((a, b) => a + b, 0) / praLines.length) * 0.55 : null)

      if (!Number.isFinite(g.eventTotal) && Number.isFinite(blendedLine)) {
        g.eventTotal = Math.max(208, Math.min(244, blendedLine * 2 + 180))
      }

      const byTeam = new Map()
      for (const r of eventRows) {
        const team = String(r?.team || "").trim()
        if (!team || team === "NBA") continue
        const list = byTeam.get(team) || []
        const v = toNum(r?.line)
        if (Number.isFinite(v) && v > 0) list.push(v)
        byTeam.set(team, list)
      }
      if (!Number.isFinite(g.eventSpread) && byTeam.size >= 2) {
        const strengths = [...byTeam.values()].map((xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length))
        strengths.sort((a, b) => b - a)
        g.eventSpread = Math.max(1.5, Math.min(12.5, strengths[0] - strengths[1]))
      }

      if (!Number.isFinite(g.eventPace) && Number.isFinite(g.eventTotal)) {
        const spreadAdj = Number.isFinite(g.eventSpread) ? g.eventSpread / 18 : 0
        g.eventPace = Math.max(92, Math.min(107, 99 + (g.eventTotal - 220) / 3 - spreadAdj))
      }

      byEvent.set(eid, g)
    }

    const games = [...byEvent.values()].map((g) => {
      const gtMax = g.gameTotals.length ? Math.max(...g.gameTotals) : null
      const ttMax = g.teamTotals.length ? Math.max(...g.teamTotals) : null
      const total = Number.isFinite(g.eventTotal) ? g.eventTotal : gtMax
      const spread = Number.isFinite(g.eventSpread) ? g.eventSpread : null
      const pace = Number.isFinite(g.eventPace)
        ? g.eventPace
        : Number.isFinite(total)
          ? 99 + (total - 220) / 3 - (Number.isFinite(spread) ? spread / 20 : 0)
          : null
      const matchup =
        g.matchup ||
        (g.awayTeam && g.homeTeam ? `${fmtTeam(g.awayTeam)} @ ${fmtTeam(g.homeTeam)}` : fmtTeam(g.eventId))
      let label = "Neutral pace / environment"
      if (Number.isFinite(total) && total >= 232) label = "High game total environment"
      else if (Number.isFinite(total) && total <= 215) label = "Lower total / grind environment"
      else if (Number.isFinite(ttMax) && ttMax >= 118) label = "High implied team scoring"
      return { matchup, gtMax, ttMax, label, pace, total, spread }
    })

    games.sort((a, b) => (toNum(b.gtMax) ?? -1) - (toNum(a.gtMax) ?? -1))

    if (!games.length) {
      console.log("(no snapshot events/rows available for game environments)")
    } else {
      games.forEach((g) => {
        const gt = Number.isFinite(g.total) ? g.total.toFixed(1) : Number.isFinite(g.gtMax) ? g.gtMax.toFixed(1) : "n/a"
        const tt = Number.isFinite(g.ttMax) ? g.ttMax.toFixed(1) : "n/a"
        const pace = Number.isFinite(g.pace) ? g.pace.toFixed(1) : "n/a"
        const spread = Number.isFinite(g.spread) ? g.spread.toFixed(1) : "n/a"
        console.log(
          `- ${g.matchup} | pace: ${pace} | gameTotal: ${gt} | spread: ${spread} | impliedTeamTotals(max): ${tt} | ${g.label}`
        )
      })
    }

    // 10) EDGE PLAYS (high-edge real props only; no placeholders)

    function pickNbaMustPlays() {
      const points = (Array.isArray(opp?.coreCandidates) ? opp.coreCandidates : [])
        .filter((x) => /point/i.test(String(x?.propType || "")))
        .map((x) => ({ ...x, cat: "points" }))
      const pra = (Array.isArray(opp?.praCandidates) ? opp.praCandidates : []).map((x) => ({ ...x, cat: "pra" }))
      const threes = (Array.isArray(opp?.altThreesCandidates) ? opp.altThreesCandidates : []).map((x) => ({ ...x, cat: "threes" }))
      const ladders = (Array.isArray(opp?.ladderCandidates) ? opp.ladderCandidates : []).map((x) => ({ ...x, cat: "ladder" }))

      const pool = [...points, ...pra, ...threes, ...ladders]
        .map((x) => sanitizedForOutput(x))
        .filter(Boolean)
        .filter((x) => !/^alt-mid$/i.test(String(x?.prediction || x?.ladder || "").trim()))
        .sort(sortByFinalWeightOnlyDesc)

      const out = []
      const seen = new Set()
      const minByCat = { points: 2, pra: 2, threes: 2, ladder: 2 }

      for (const cat of Object.keys(minByCat)) {
        let need = minByCat[cat]
        for (const x of pool) {
          if (need <= 0) break
          if (String(x?.cat) !== cat) continue
          const k = `${String(x.player || "").toLowerCase()}__${String(x.propType || "")}__${fmtDisplayLine(x)}`
          if (seen.has(k)) continue
          seen.add(k)
          out.push(x)
          need -= 1
        }
      }

      for (const x of pool) {
        if (out.length >= 12) break
        const k = `${String(x.player || "").toLowerCase()}__${String(x.propType || "")}__${fmtDisplayLine(x)}`
        if (seen.has(k)) continue
        seen.add(k)
        out.push(x)
      }

      return out.slice(0, 12)
    }

    function pickStarPool(maxPlayers = 12) {
      const source = [
        ...(Array.isArray(opp?.coreCandidates) ? opp.coreCandidates : []),
        ...(Array.isArray(opp?.pointsLadderCandidates) ? opp.pointsLadderCandidates : []),
      ]
        .map((x) => sanitizedForOutput(x))
        .filter((x) => x && String(x.player || "").trim())
      const bestByPlayer = new Map()
      for (const r of source) {
        const k = String(r.player || "").trim().toLowerCase()
        const s = toNum(r?.finalWeight) ?? 0
        const cur = bestByPlayer.get(k)
        if (!cur || s > cur.s) bestByPlayer.set(k, { s, row: r })
      }
      return [...bestByPlayer.values()]
        .sort((a, b) => (toNum(b?.row?.finalWeight) ?? 0) - (toNum(a?.row?.finalWeight) ?? 0))
        .slice(0, maxPlayers)
        .map((x) => x.row)
    }

    function tierFromLine(line) {
      const n = toNum(line)
      if (!Number.isFinite(n)) return null
      if (n >= 39.5) return 40
      if (n >= 34.5) return 35
      if (n >= 29.5) return 30
      if (n >= 24.5) return 25
      return null
    }

    function pickUpsidePlays() {
      const stars = pickStarPool(12)
      const starSet = new Set(stars.map((x) => String(x.player || "").trim().toLowerCase()))
      const forcedTiers = new Set([25, 30, 35, 40])

      const forcedLadders = [
        ...(Array.isArray(opp?.pointsLadderCandidates) ? opp.pointsLadderCandidates : []),
        ...(Array.isArray(opp?.altPointsCandidates) ? opp.altPointsCandidates : []),
      ]
        .map((x) => sanitizedForOutput(x))
        .filter((x) => starSet.has(String(x.player || "").trim().toLowerCase()))
        .filter((x) => forcedTiers.has(tierFromLine(x?.line)))
        .sort(sortByFinalWeightOnlyDesc)

      const specialsRaw = [
        ...(Array.isArray(insight?.firstBasketBoard) ? insight.firstBasketBoard : []),
        ...(Array.isArray(opp?.doubleDoubleCandidates) ? opp.doubleDoubleCandidates : []),
        ...(Array.isArray(opp?.tripleDoubleCandidates) ? opp.tripleDoubleCandidates : []),
      ]
        .map((x) => sanitizedForOutput(x))
        .filter((x) => x && String(x.player || "").trim())
        .filter((x) => {
          const t = String(x?.propType || x?.prediction || "").toLowerCase()
          return /first\s*basket|double\s*double|triple\s*double/.test(t)
        })
        .filter((x) => starSet.has(String(x.player || "").trim().toLowerCase()))
        .sort(sortByFinalWeightOnlyDesc)

      let forced = pickDiverse(forcedLadders, 14, { maxPerTeam: 3, minGames: 4 })

      if (!forced.length) {
        const synthetic = []
        for (const s of stars) {
          const baseLine = Math.max(15, toNum(s?.line) ?? 20)
          const baseProb = toNum(s?.probability) ?? toNum(nbaRowModelProbabilityCore(s)) ?? 0.58
          for (const tier of [25, 30, 35, 40]) {
            const diff = Math.max(0, tier - baseLine)
            const p = Math.max(0.08, Math.min(0.62, baseProb - diff * 0.018))
            synthetic.push({
              ...s,
              propType: "Points Ladder",
              ladder: `Points ${tier}+`,
              line: tier - 0.5,
              probability: p,
              edge: computeEdge(p, s?.odds),
            })
          }
        }
        forced = pickDiverse(synthetic.map((x) => sanitizedForOutput(x)).filter(Boolean), 14, { maxPerTeam: 3, minGames: 4 })
      }

      return {
        forcedLadders: forced,
        specials: pickDiverse(specialsRaw, 10, { maxPerTeam: 3, minGames: 3 }),
      }
    }

    // 10) UPSIDE + EDGE split output
    printHeader("UPSIDE PLAYS")
    printSubHeader("Star Ladders (25+ / 30+ / 35+ / 40+)")
    const upside = pickUpsidePlays()
    if (!upside.forcedLadders.length) {
      console.log("(none)")
    } else {
      upside.forcedLadders.forEach((p) => printPlayerPropLineCustom(p, { note: "upside ladder" }))
    }

    printSubHeader("Star Specials (capped realism)")
    if (!upside.specials.length) {
      console.log("(none)")
    } else {
      upside.specials.forEach((p) => {
        const t = String(p?.propType || p?.prediction || "").toLowerCase()
        const baseProb = toNum(p?.probability) ?? toNum(nbaRowModelProbabilityCore(p))
        let cappedProb = baseProb
        if (/first\s*basket/.test(t)) cappedProb = Math.min(0.22, Math.max(0.04, baseProb ?? 0.10))
        else if (/double\s*double/.test(t)) cappedProb = Math.min(0.42, Math.max(0.06, baseProb ?? 0.16))
        else if (/triple\s*double/.test(t)) cappedProb = Math.min(0.26, Math.max(0.01, baseProb ?? 0.08))
        const cappedEdge = Number.isFinite(cappedProb) ? computeEdge(cappedProb, p?.odds) : p?.edge
        printPlayerPropLineCustom(p, { probability: cappedProb, edge: cappedEdge, note: "upside special" })
      })
    }

    printHeader("EDGE PLAYS")

    const must = pickNbaMustPlays()

    enrichEdgePlaysWithRecentFormFromDisk(must)
    for (const row of must) {
      delete row.finalWeight
      Object.assign(row, ensureFinalWeight(withFinalOutputFields(row)))
    }
    must.sort(sortByFinalWeightOnlyDesc)

    if (!must.length) console.log("(none)")
    else {
      must.forEach((p0) => {
        const p = withFinalOutputFields(p0)
        const rf = p.recentForm && typeof p.recentForm === "object" ? p.recentForm : null
        console.log("[EDGE PLAYS FINAL]", {
          player: p.player,
          finalWeight: p.finalWeight,
          recentForm: rf
            ? {
                trend_delta: rf.trend_delta,
                last5_avg: rf.last5_avg,
                baseline: rf.baseline,
                source: rf.source,
              }
            : null,
        })
        const prop =
          typeof p?.prediction === "string" && p.prediction.trim()
            ? p.prediction.trim()
            : String(p?.propType || "play").trim() || "play"
        const reason =
          typeof p?.why === "string" && p.why.trim()
            ? p.why.trim()
            : typeof p?.note === "string" && p.note.trim()
              ? p.note.trim()
              : "AI curated"
        const prob = toNum(p?.probability ?? p?.modelProbability)
        const lineDisp = fmtDisplayLine(p)
        const formSuffix =
          rf && Number.isFinite(Number(rf.trend_delta))
            ? ` — recentForm Δ5 vs season ${Number(rf.trend_delta).toFixed(2)} (${String(rf.source || "n/a")})`
            : ""
        console.log(
          `- ${fmtTeam(p.player)} (${fmtTeam(p.team)}) — ${prop} — ${lineDisp} — ${fmtProb(prob)} — ${fmtSignedEdge(p.edge)} — ${reason}${formSuffix}`
        )
      })
    }

    printHeader("AI PICKS")
    if (opp.aiPicks && typeof opp.aiPicks === "object" && typeof opp.aiPicks.formattedText === "string") {
      console.log(String(opp.aiPicks.formattedText).trimEnd())
    } else {
      console.log("(no aiPicks on opportunity board — rebuild API snapshot)")
    }

    printHeader("OUTCOME PREDICTIONS (NBA)")
    const pred = opp.playerOutcomePredictions
    if (pred && typeof pred === "object" && typeof pred.formattedText === "string") {
      console.log(String(pred.formattedText).trimEnd())
    } else if (opp.aiSlips && typeof opp.aiSlips === "object" && typeof opp.aiSlips.formattedText === "string") {
      console.log(String(opp.aiSlips.formattedText).trimEnd())
    } else {
      console.log("(no outcome predictions or slips on opportunity board)")
    }

    // 11) FREE BUILD POOL (candidate counts)
    printHeader("FREE BUILD POOL")

    const ladderAll = Array.isArray(opp.ladderCandidates) ? opp.ladderCandidates.length : 0
    const ptsL = Array.isArray(opp.pointsLadderCandidates) ? opp.pointsLadderCandidates.length : 0
    const rebL = Array.isArray(opp.reboundsLadderCandidates) ? opp.reboundsLadderCandidates.length : 0
    const astL = Array.isArray(opp.assistsLadderCandidates) ? opp.assistsLadderCandidates.length : 0
    const thrL = Array.isArray(opp.threesLadderCandidates) ? opp.threesLadderCandidates.length : 0
    const praL = Array.isArray(opp.praLadderCandidates) ? opp.praLadderCandidates.length : 0
    const praTierCt = Array.isArray(opp.praCandidates) ? opp.praCandidates.length : 0
    const ddCt = Array.isArray(opp.doubleDoubleCandidates) ? opp.doubleDoubleCandidates.length : 0
    const tdCt = Array.isArray(opp.tripleDoubleCandidates) ? opp.tripleDoubleCandidates.length : 0
    const altPtCt = Array.isArray(opp.altPointsCandidates) ? opp.altPointsCandidates.length : 0
    const alt3Ct = Array.isArray(opp.altThreesCandidates) ? opp.altThreesCandidates.length : 0
    const comboCt = Array.isArray(opp.comboCandidates) ? opp.comboCandidates.length : 0
    const coreCt = Array.isArray(opp.coreCandidates) ? opp.coreCandidates.length : 0
    const metaUni = opp.meta && typeof opp.meta === "object" ? opp.meta.completeUniverseRows : null

    console.log(`- Ladder candidates (all): ${ladderAll}`)
    console.log(`- Points+ ladder candidates: ${ptsL}`)
    console.log(`- Rebounds+ ladder candidates: ${rebL}`)
    console.log(`- Assists+ ladder candidates: ${astL}`)
    console.log(`- Threes+ ladder candidates: ${thrL}`)
    console.log(`- PRA+ ladder candidates (all PRA ladders): ${praL}`)
    console.log(`- PRA tier ladder candidates (25/30/35/40+): ${praTierCt}`)
    console.log(`- Double-double candidates: ${ddCt}`)
    console.log(`- Triple-double candidates: ${tdCt}`)
    console.log(`- Alt points ladder candidates: ${altPtCt}`)
    console.log(`- Alt threes candidates: ${alt3Ct}`)
    console.log(`- Combo stat candidates: ${comboCt}`)
    console.log(`- Core prop candidates: ${coreCt}`)
    console.log(`- Complete universe rows: ${metaUni != null ? metaUni : "n/a"}`)
    console.log(`- Insight best-overall rows: ${Array.isArray(insight.bestOverallPlays) ? insight.bestOverallPlays.length : 0}`)
    console.log(`- Insight ladder rows: ${Array.isArray(insight.ladderBoard) ? insight.ladderBoard.length : 0}`)
    console.log(`- Insight core rows: ${Array.isArray(insight.corePropsBoard) ? insight.corePropsBoard.length : 0}`)
    console.log(`- Insight special rows: ${Array.isArray(insight.specialBoard) ? insight.specialBoard.length : 0}`)
    console.log(`- Insight first-basket rows: ${Array.isArray(insight.firstBasketBoard) ? insight.firstBasketBoard.length : 0}`)

    const edgeCheckPool = [
      ...(Array.isArray(opp.ladderCandidates) ? opp.ladderCandidates : []),
      ...(Array.isArray(opp.coreCandidates) ? opp.coreCandidates : []),
      ...(Array.isArray(opp.doubleDoubleCandidates) ? opp.doubleDoubleCandidates : []),
      ...(Array.isArray(opp.tripleDoubleCandidates) ? opp.tripleDoubleCandidates : []),
      ...(Array.isArray(opp.praCandidates) ? opp.praCandidates : []),
      ...(Array.isArray(opp.altPointsCandidates) ? opp.altPointsCandidates : []),
      ...(Array.isArray(opp.altThreesCandidates) ? opp.altThreesCandidates : []),
      ...(Array.isArray(opp.comboCandidates) ? opp.comboCandidates : []),
    ].map((x) => withFinalOutputFields(x))

    const edgePos = edgeCheckPool.filter((x) => Number.isFinite(Number(x?.edge)) && Number(x.edge) > 0).length
    const edgeNeg = edgeCheckPool.filter((x) => Number.isFinite(Number(x?.edge)) && Number(x.edge) < 0).length
    const edgeZero = edgeCheckPool.filter((x) => Number.isFinite(Number(x?.edge)) && Number(x.edge) === 0).length
    console.log(`- Edge distribution (final-stage): +${edgePos} / -${edgeNeg} / 0:${edgeZero}`)

    console.log("\nDAILY REPORT COMPLETE\n")

    // ── Intelligence board (presentation layer) ────────────────────────────
    try {
      const { buildBoard } = require("../pipeline/shared/buildIntelligencePresentation")
      const {
        buildLineShopping,
        loadBookState,
      } = require("../pipeline/shared/buildLineShoppingIntelligence")
      const {
        buildMarketTiming,
        loadTimingState,
      } = require("../pipeline/shared/buildMarketTimingIntelligence")
      const { buildNightlyReport } = require("../pipeline/shared/buildPersonalLedger")

      const ingestRows = Array.isArray(data?.ingestRows) ? data.ingestRows : []
      const bets      = Array.isArray(opp?.aiPicks)  ? opp.aiPicks  : []
      const slipBets  = Array.isArray(opp?.aiSlips)  ? opp.aiSlips  : []

      let lineShopping = opp?.lineShopping
      let timingResult = opp?.timingResult

      if (ingestRows.length && !lineShopping) {
        const bookState = loadBookState()
        lineShopping = buildLineShopping(ingestRows, { sport: "nba", bookState })
        timingResult = buildMarketTiming(ingestRows, { lineShopping, timingState: loadTimingState(), bookState })
      }

      const ledgerReport = (() => {
        try { return buildNightlyReport({ sport: "nba", windowDays: 30 }) } catch (_) { return null }
      })()

      const { printable } = buildBoard({
        bets, slipBets, lineShopping, timingResult,
        bookState: loadBookState(),
        ledgerReport,
        sport: "nba",
        bankrollInfo: opp,
      })
      console.log(printable)
    } catch (boardErr) {
      if (process.env.DEBUG) console.error("[BOARD ERROR]", boardErr)
    }
  } catch (e) {
    console.error("[RUN ERROR]", e)
  }
}

runAll()
