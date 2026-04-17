"use strict"

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function norm(s) {
  return String(s || "").trim().toLowerCase()
}

function isOverSide(row) {
  const side = norm(row?.__src?.side ?? row?.side)
  return side === "over" || side === "yes"
}

function isUnderSide(row) {
  const side = norm(row?.__src?.side ?? row?.side)
  return side === "under" || side === "no"
}

function isHitterCountingProp(row) {
  const pt = String(row?.propType || "").toLowerCase()
  return (
    pt.includes("hits") ||
    pt.includes("total bases") ||
    pt.includes("rbi") ||
    pt.includes("runs") ||
    pt.includes("home run")
  )
}

function isPitcherKProp(row) {
  const pt = String(row?.propType || "").toLowerCase()
  return pt === "strikeouts" || pt.includes("strikeouts")
}

function isHomeRunsProp(row) {
  const pt = String(row?.propType || "").toLowerCase()
  return pt.includes("home run")
}

function ladderMarketish(row) {
  const mkLc = String(row?.marketKey || row?.__src?.marketKey || "").toLowerCase()
  const famLc = String(row?.marketFamily || row?.__src?.marketFamily || row?.boardFamily || "").toLowerCase()
  return (
    famLc === "ladder" ||
    mkLc.includes("ladder") ||
    mkLc.includes("_alt") ||
    mkLc.includes("alternate")
  )
}

function isHighUpsideRow(row) {
  const odds = toNum(row?.odds)
  const ptLc = String(row?.propType || "").trim().toLowerCase()

  const isHrProp = ptLc.includes("home run")
  const isTbProp = ptLc.includes("total base")
  const isRbiProp = ptLc.includes("rbi")
  const ladderish = ladderMarketish(row)

  if (isHrProp) return true
  if (isTbProp && odds != null && odds > 200) return true
  if (isRbiProp && odds != null && odds > 200) return true
  if (odds != null && odds >= 400) return true
  if (ladderish && odds != null && odds > 180) return true
  return false
}

/** Below high bar but still stackable when a game/team has fewer than 2 high-upside legs. */
function isMediumUpsideRow(row) {
  if (!row || isHighUpsideRow(row)) return false
  if (isUnderSide(row)) return false
  if (!isHitterCountingProp(row) && !isHomeRunsProp(row)) return false

  const odds = toNum(row?.odds)
  if (odds == null) return false

  const ptLc = String(row?.propType || "").trim().toLowerCase()
  const isTbProp = ptLc.includes("total base")
  const isRbiProp = ptLc.includes("rbi")
  const ladderish = ladderMarketish(row)

  if (isTbProp && odds > 150 && odds <= 200) return true
  if (isRbiProp && odds > 150 && odds <= 200) return true
  if (ladderish && odds > 140 && odds <= 180) return true
  if (odds >= 220 && odds < 400) return true
  return false
}

function upsideTierScore(row) {
  if (!isHighUpsideRow(row)) return 0
  const odds = toNum(row?.odds) || 0
  const ptLc = String(row?.propType || "").trim().toLowerCase()
  let s = 1
  if (ptLc.includes("home run")) s += 2
  if (ptLc.includes("total base")) s += 1
  if (odds >= 400) s += 1
  if (odds >= 800) s += 1
  s += Math.min(3, Math.max(0, (odds - 200) / 400))
  return s
}

function mediumUpsideTierScore(row) {
  if (!isMediumUpsideRow(row)) return 0
  const odds = toNum(row?.odds) || 0
  let s = 0.5
  if (ladderMarketish(row)) s += 0.5
  s += Math.min(2, Math.max(0, (odds - 150) / 200))
  return s
}

function pairCorrelationScore(a, b) {
  if (!a || !b) return 0

  // Negative correlation: pitcher K vs opposing hitter overs in same game.
  if (
    String(a?.eventId || "") &&
    String(a.eventId) === String(b?.eventId || "") &&
    ((isPitcherKProp(a) && isHitterCountingProp(b)) || (isPitcherKProp(b) && isHitterCountingProp(a))) &&
    (isOverSide(a) || isOverSide(b))
  ) {
    // If the hitter is on the opposing team to the pitcher (approx: different team labels).
    const teamA = norm(a?.team)
    const teamB = norm(b?.team)
    if (teamA && teamB && teamA !== teamB) return -1.0
    return -0.5
  }

  // Avoid pairing unders with over-heavy stacks.
  if (isUnderSide(a) || isUnderSide(b)) return -0.5

  // Positive correlation: same team hitters in same game.
  if (
    String(a?.eventId || "") &&
    String(a.eventId) === String(b?.eventId || "") &&
    norm(a?.team) &&
    norm(a.team) === norm(b?.team) &&
    isHitterCountingProp(a) &&
    isHitterCountingProp(b) &&
    isOverSide(a) &&
    isOverSide(b)
  ) {
    return 0.5
  }

  return 0
}

function contextBoost(row) {
  const teamTotal = toNum(row?.impliedTeamTotal)
  const gameTotal = toNum(row?.gameTotal)
  const pt = String(row?.propType || "").toLowerCase()

  let boost = 0

  if (teamTotal != null && teamTotal >= 5.0 && isHitterCountingProp(row) && isOverSide(row)) {
    boost += 1.0 // strong positive: hitter overs with high team total
  } else if (teamTotal != null && teamTotal >= 4.5 && isHitterCountingProp(row) && isOverSide(row)) {
    boost += 0.5
  }

  if (gameTotal != null && gameTotal >= 9.0 && pt.includes("total bases") && isOverSide(row)) {
    boost += 0.5 // TB with high game total
  }

  if (teamTotal != null && teamTotal >= 4.5 && pt.includes("rbis") && isOverSide(row)) {
    boost += 0.5 // RBI with team total
  }

  return boost
}

function buildMlbCorrelationClusters(rows, opts = {}) {
  const maxClusters = Math.max(1, Math.min(20, Number(opts.maxClusters || 10)))
  const maxLegs = Math.max(2, Math.min(4, Number(opts.maxLegs || 3)))
  const minUpsideLegs = Math.max(1, Math.min(2, Number(opts.minUpsideLegs || 1)))
  const targetUpsideLegs = Math.max(minUpsideLegs, Math.min(2, Number(opts.targetUpsideLegs || 2)))

  const safeRows = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.player && r.team && r.propType && r.eventId)

  // Candidate filter: only props that can participate in clusters.
  const candidates = safeRows.filter((r) => {
    if (isUnderSide(r)) return false
    return isHitterCountingProp(r) || isPitcherKProp(r) || isHomeRunsProp(r)
  })

  const byGameTeam = new Map() // key: eventId|team -> rows
  for (const r of candidates) {
    const key = `${String(r.eventId)}|${String(r.team)}`
    if (!byGameTeam.has(key)) byGameTeam.set(key, [])
    byGameTeam.get(key).push(r)
  }

  const clusters = []
  const usedLegKeysGlobal = new Set()

  const legKey = (r) =>
    [
      String(r?.eventId || ""),
      norm(r?.player),
      norm(r?.propType),
      String(r?.line ?? ""),
      norm(r?.side ?? r?.__src?.side),
      norm(r?.marketKey)
    ].join("|")

  for (const [key, group] of byGameTeam.entries()) {
    const [eventId, team] = key.split("|")
    const uniqueByPlayerProp = new Map()
    for (const r of group) {
      const k = `${norm(r.player)}|${norm(r.propType)}`
      const prev = uniqueByPlayerProp.get(k)
      if (!prev || (toNum(r.decisionScore) || 0) > (toNum(prev.decisionScore) || 0)) uniqueByPlayerProp.set(k, r)
    }
    const pool = [...uniqueByPlayerProp.values()]
      .filter((r) => !usedLegKeysGlobal.has(legKey(r)))
      .sort(
        (a, b) =>
          (upsideTierScore(b) - upsideTierScore(a)) ||
          (Boolean(b.isHighUpside ?? isHighUpsideRow(b)) - Boolean(a.isHighUpside ?? isHighUpsideRow(a))) ||
          (contextBoost(b) - contextBoost(a)) ||
          ((toNum(b.decisionScore) || 0) - (toNum(a.decisionScore) || 0))
      )

    if (pool.length < 2) continue

    const chosen = []
    const usedPlayers = new Set()

    const tryAdd = (r) => {
      if (!r) return false
      const lk = legKey(r)
      const pk = norm(r.player)
      if (!lk || usedLegKeysGlobal.has(lk)) return false
      if (!pk || usedPlayers.has(pk)) return false

      // Avoid negative correlation with already chosen legs.
      for (const ex of chosen) {
        if (pairCorrelationScore(ex, r) <= -1.0) return false
      }

      chosen.push(r)
      usedPlayers.add(pk)
      return true
    }

    // Upside forcing: ensure at least minUpsideLegs (prefer targetUpsideLegs) high-upside legs when available.
    const upsidePool = pool
      .filter((r) => r && (r.isHighUpside === true || isHighUpsideRow(r)))
      .sort((a, b) => upsideTierScore(b) - upsideTierScore(a))

    const upsideAvail = upsidePool.length
    const effMinUpsideLegs = upsideAvail ? Math.min(minUpsideLegs, upsideAvail) : 0
    const effTargetUpsideLegs = upsideAvail ? Math.min(targetUpsideLegs, upsideAvail, maxLegs) : 0

    let upsideAdded = 0
    for (const r of upsidePool) {
      if (chosen.length >= maxLegs) break
      if (upsideAdded >= effTargetUpsideLegs) break
      if (tryAdd(r)) upsideAdded += 1
    }

    // Fill remaining slots with best correlated context legs (still respecting negative pairing rules).
    const seeded = [...pool].sort(
      (a, b) =>
        (contextBoost(b) - contextBoost(a)) ||
        (upsideTierScore(b) - upsideTierScore(a)) ||
        ((toNum(b.decisionScore) || 0) - (toNum(a.decisionScore) || 0))
    )
    for (const r of seeded) {
      if (chosen.length >= maxLegs) break
      tryAdd(r)
    }

    const finalUpsideCount = chosen.filter((r) => r && (r.isHighUpside === true || isHighUpsideRow(r))).length
    if (finalUpsideCount < effMinUpsideLegs) continue

    if (chosen.length < 2) continue

    // Compute cluster score: sum of context boosts + average pair score.
    let boostSum = 0
    for (const r of chosen) boostSum += contextBoost(r)

    let pairSum = 0
    let pairCount = 0
    for (let i = 0; i < chosen.length; i++) {
      for (let j = i + 1; j < chosen.length; j++) {
        pairSum += pairCorrelationScore(chosen[i], chosen[j])
        pairCount += 1
      }
    }
    const avgPair = pairCount ? (pairSum / pairCount) : 0
    const correlationScore = Number((boostSum + avgPair).toFixed(3))

    clusters.push({
      game: String(eventId || "") || null,
      team: String(team || "") || null,
      correlationScore,
      legs: chosen.map((r) => ({
        player: r.player,
        team: r.team,
        propType: r.propType,
        marketKey: r.marketKey ?? null,
        line: r.line ?? null,
        odds: r.odds ?? null,
        playType: r.playType ?? null,
        isHighUpside: Boolean(r.isHighUpside ?? isHighUpsideRow(r)),
        eventId: r.eventId ?? null,
        gameTotal: r.gameTotal ?? null,
        impliedTeamTotal: r.impliedTeamTotal ?? null
      }))
    })
  }

  clusters.sort((a, b) => {
    const au = (Array.isArray(a.legs) ? a.legs : []).filter((l) => l && l.isHighUpside).length
    const bu = (Array.isArray(b.legs) ? b.legs : []).filter((l) => l && l.isHighUpside).length
    if (bu !== au) return bu - au
    return (toNum(b.correlationScore) || 0) - (toNum(a.correlationScore) || 0)
  })

  const out = []
  for (const c of clusters) {
    if (out.length >= maxClusters) break
    // global de-dupe: avoid reusing the same legs across clusters
    const legKeys = (Array.isArray(c.legs) ? c.legs : []).map((l) =>
      [String(l.eventId || ""), norm(l.player), norm(l.propType), String(l.line ?? ""), norm(l.marketKey)].join("|")
    )
    if (legKeys.some((k) => usedLegKeysGlobal.has(k))) continue
    for (const k of legKeys) usedLegKeysGlobal.add(k)
    out.push(c)
  }

  return out
}

function buildMlbUpsideClusters(rows, opts = {}) {
  const maxClusters = Math.max(1, Math.min(20, Number(opts.maxClusters || 10)))
  const maxLegs = Math.max(2, Math.min(5, Number(opts.maxLegs || 4)))
  const minHighLegsPreferred = Math.max(2, Math.min(3, Number(opts.minUpsideLegs || 2)))

  const rawRows = Array.isArray(rows) ? rows : []

  const getUpsideRowEventId = (r) =>
    String(r?.eventId ?? r?.__src?.eventId ?? r?.__src?.gameId ?? r?.gameId ?? "").trim()

  const getUpsideRowTeamLabel = (r) => String(r?.team ?? r?.__src?.team ?? "").trim()

  /** Missing side is allowed for upside pools; only explicit under/no is excluded. */
  const isUpsideStackUnderSide = (r) => {
    const s = norm(r?.__src?.side ?? r?.side)
    if (!s) return false
    return s === "under" || s === "no"
  }

  const upsideTeamKey = (r) => {
    const t = getUpsideRowTeamLabel(r)
    return t || "TBD"
  }

  const safeRows = rawRows.filter((r) => {
    if (!r) return false
    if (!String(r?.player || "").trim()) return false
    if (!String(r?.propType || "").trim()) return false
    if (!getUpsideRowEventId(r)) return false
    return true
  })

  const isUpsideClusterableRow = (r) => {
    if (!r || isUpsideStackUnderSide(r) || isPitcherKProp(r)) return false
    return isHitterCountingProp(r) || isHomeRunsProp(r)
  }

  const clusterCandidates = safeRows.filter((r) => isUpsideClusterableRow(r) && (isHighUpsideRow(r) || isMediumUpsideRow(r)))

  const highSeedRows = safeRows.filter((r) => isUpsideClusterableRow(r) && isHighUpsideRow(r))

  const byGameTeam = new Map()
  for (const r of highSeedRows) {
    const key = `${getUpsideRowEventId(r)}|${upsideTeamKey(r)}`
    if (!byGameTeam.has(key)) byGameTeam.set(key, [])
    byGameTeam.get(key).push(r)
  }

  const clusters = []

  const legKey = (r) =>
    [
      getUpsideRowEventId(r),
      norm(r?.player),
      norm(r?.propType),
      String(r?.line ?? ""),
      norm(r?.side ?? r?.__src?.side),
      norm(r?.marketKey ?? r?.__src?.marketKey)
    ].join("|")

  const fillPoolForTeamGame = (eventId, teamKeyFromBucket) => {
    const ev = String(eventId || "").trim()
    const tk = String(teamKeyFromBucket || "").trim() || "TBD"
    return safeRows.filter((r) => {
      if (!r) return false
      if (getUpsideRowEventId(r) !== ev) return false
      if (upsideTeamKey(r) !== tk) return false
      if (isUpsideStackUnderSide(r)) return false
      if (isPitcherKProp(r)) return false
      return isHitterCountingProp(r) || isHomeRunsProp(r)
    })
  }

  const maxClustersPerGameTeam = Math.max(1, Math.min(5, Number(opts.maxUpsideClustersPerGameTeam ?? 3)))

  const tryBuildUpsideClusterFromPool = (upsidePoolSlice, fillPool) => {
    const chosen = []
    const usedPlayers = new Set()
    const usedLegKeysLocal = new Set()

    const tryAdd = (r) => {
      if (!r) return false
      const lk = legKey(r)
      const pk = norm(r.player)
      if (!lk || usedLegKeysLocal.has(lk)) return false
      if (!pk || usedPlayers.has(pk)) return false
      for (const ex of chosen) {
        if (pairCorrelationScore(ex, r) <= -1.0) return false
      }
      chosen.push(r)
      usedPlayers.add(pk)
      usedLegKeysLocal.add(lk)
      return true
    }

    const highCount = upsidePoolSlice.length

    if (highCount >= minHighLegsPreferred) {
      let forcedHigh = 0
      for (const r of upsidePoolSlice) {
        if (chosen.length >= maxLegs) break
        if (forcedHigh >= minHighLegsPreferred) break
        if (tryAdd(r)) forcedHigh += 1
      }
      if (forcedHigh === 1 && chosen.length === 1) {
        const highRow = chosen[0]
        const mediumPool = fillPool
          .filter((r) => r && isMediumUpsideRow(r) && norm(r.player) !== norm(highRow.player))
          .sort(
            (a, b) =>
              mediumUpsideTierScore(b) - mediumUpsideTierScore(a) ||
              (contextBoost(b) - contextBoost(a)) ||
              ((toNum(b.decisionScore) || 0) - (toNum(a.decisionScore) || 0))
          )
        for (const r of mediumPool) {
          if (chosen.length >= maxLegs) break
          if (tryAdd(r)) {
            forcedHigh += 1
            break
          }
        }
      }
      if (forcedHigh < minHighLegsPreferred) return null
    } else if (highCount === 1) {
      const highRow = upsidePoolSlice[0]
      if (!tryAdd(highRow)) return null

      const mediumPool = fillPool
        .filter((r) => r && isMediumUpsideRow(r) && norm(r.player) !== norm(highRow.player))
        .sort(
          (a, b) =>
            mediumUpsideTierScore(b) - mediumUpsideTierScore(a) ||
            (contextBoost(b) - contextBoost(a)) ||
            ((toNum(b.decisionScore) || 0) - (toNum(a.decisionScore) || 0))
        )

      let gotMedium = false
      for (const r of mediumPool) {
        if (chosen.length >= maxLegs) break
        if (tryAdd(r)) {
          gotMedium = true
          break
        }
      }
      if (!gotMedium) return null
    } else {
      return null
    }

    const filler = [...fillPool].sort(
      (a, b) =>
        (contextBoost(b) - contextBoost(a)) ||
        (upsideTierScore(b) - upsideTierScore(a)) ||
        (mediumUpsideTierScore(b) - mediumUpsideTierScore(a)) ||
        ((toNum(b.decisionScore) || 0) - (toNum(a.decisionScore) || 0))
    )
    for (const r of filler) {
      if (chosen.length >= maxLegs) break
      tryAdd(r)
    }

    if (chosen.length < 2) return null

    const highs = chosen.filter((r) => isHighUpsideRow(r)).length
    const mediums = chosen.filter((r) => isMediumUpsideRow(r) && !isHighUpsideRow(r)).length
    if (!(highs >= 2 || (highs >= 1 && mediums >= 1))) return null

    return chosen
  }

  const debugUpside =
    Boolean(opts.debugUpsideClusterFilters) || String(process.env.MLB_UPSIDE_CLUSTER_DEBUG || "").toLowerCase() === "1"
  const dbg = debugUpside
    ? {
        totalRows: rawRows.length,
        afterPlayerProp: rawRows.filter((r) => r && String(r?.player || "").trim() && String(r?.propType || "").trim())
          .length,
        afterEventId: rawRows.filter((r) => r && getUpsideRowEventId(r)).length,
        afterHighUpside: rawRows.filter((r) => isHighUpsideRow(r)).length,
        afterMediumUpside: rawRows.filter((r) => isMediumUpsideRow(r)).length,
        afterSideNotUnder: rawRows.filter((r) => r && !isUpsideStackUnderSide(r)).length,
        afterTeamEventFilter: safeRows.length,
        afterClusterable: safeRows.filter((r) => isUpsideClusterableRow(r)).length,
        clusterCandidates: clusterCandidates.length,
        highSeedRows: highSeedRows.length,
        gameTeamBuckets: byGameTeam.size
      }
    : null

  for (const [key, group] of byGameTeam.entries()) {
    const pipe = key.indexOf("|")
    const eventId = pipe >= 0 ? key.slice(0, pipe) : key
    const teamKeyFromBucket = pipe >= 0 ? key.slice(pipe + 1) : "TBD"
    const uniqueByPlayerPropLine = new Map()
    for (const r of group) {
      const k = `${norm(r.player)}|${norm(r.propType)}|${String(r.line ?? "")}`
      const prev = uniqueByPlayerPropLine.get(k)
      if (!prev || upsideTierScore(r) > upsideTierScore(prev)) uniqueByPlayerPropLine.set(k, r)
    }

    const upsidePool = [...uniqueByPlayerPropLine.values()].sort((a, b) => upsideTierScore(b) - upsideTierScore(a))

    const fillPool = fillPoolForTeamGame(eventId, teamKeyFromBucket)
    const burnedPlayers = new Set()

    for (let passKey = 0; passKey < maxClustersPerGameTeam; passKey++) {
      const pool = upsidePool.filter((r) => r && !burnedPlayers.has(norm(r.player)))
      const chosen = tryBuildUpsideClusterFromPool(pool, fillPool)
      if (!chosen || chosen.length < 2) break

      for (const r of chosen) burnedPlayers.add(norm(r.player))

      const upsideLegs = chosen.filter((r) => r && (r.isHighUpside === true || isHighUpsideRow(r))).length
      const maxOdds = Math.max(...chosen.map((r) => toNum(r?.odds) || 0))
      const hrCount = chosen.filter((r) => String(r?.propType || "").toLowerCase().includes("home run")).length
      const tbCount = chosen.filter((r) => String(r?.propType || "").toLowerCase().includes("total base")).length

      const upsideScore = Number(
        (
          upsideLegs * 2.5 +
          hrCount * 1.5 +
          tbCount * 1.0 +
          Math.min(4, Math.max(0, (maxOdds - 250) / 200)) +
          chosen.reduce((acc, r) => acc + contextBoost(r), 0) * 0.25
        ).toFixed(3)
      )

      clusters.push({
        game: String(eventId || "") || null,
        team: String(teamKeyFromBucket || "") || null,
        upsideScore,
        legs: chosen.map((r) => {
          const high = Boolean(r.isHighUpside ?? isHighUpsideRow(r))
          const medium = Boolean(isMediumUpsideRow(r))
          return {
            player: r.player,
            team: r.team,
            propType: r.propType,
            marketKey: r.marketKey ?? null,
            line: r.line ?? null,
            odds: r.odds ?? null,
            playType: r.playType ?? null,
            isHighUpside: high,
            isMediumUpside: medium && !high,
            eventId: getUpsideRowEventId(r) || null,
            gameTotal: r.gameTotal ?? null,
            impliedTeamTotal: r.impliedTeamTotal ?? null
          }
        })
      })
    }
  }

  clusters.sort((a, b) => (toNum(b.upsideScore) || 0) - (toNum(a.upsideScore) || 0))

  let minOutputClusters = 0
  if (clusterCandidates.length > 0) {
    minOutputClusters = Math.min(5, Math.max(3, Number(opts.minOutputClusters ?? 4)))
    minOutputClusters = Math.min(minOutputClusters, clusters.length)
  }

  const globalLegCounts = new Map()
  const clusterLegKeys = (c) =>
    (Array.isArray(c.legs) ? c.legs : []).map((l) =>
      [String(l?.eventId || "").trim(), norm(l.player), norm(l.propType), String(l.line ?? ""), norm(l.marketKey)].join("|")
    )

  const tryEmitCluster = (c, maxShare, out, maxOut) => {
    if (out.length >= maxOut) return false
    const keys = clusterLegKeys(c)
    for (const k of keys) {
      if ((globalLegCounts.get(k) || 0) >= maxShare) return false
    }
    for (const k of keys) globalLegCounts.set(k, (globalLegCounts.get(k) || 0) + 1)
    out.push(c)
    return true
  }

  const out = []
  const addedIdx = new Set()
  for (let pass = 0; pass < 2; pass++) {
    const maxShare = pass === 0 ? 1 : 2
    for (let i = 0; i < clusters.length; i++) {
      if (out.length >= maxClusters) break
      if (pass === 1 && out.length >= minOutputClusters) break
      if (addedIdx.has(i)) continue
      if (tryEmitCluster(clusters[i], maxShare, out, maxClusters)) addedIdx.add(i)
    }
    if (out.length >= minOutputClusters || out.length >= maxClusters) break
    if (clusterCandidates.length === 0) break
  }

  if (dbg) {
    console.log("[buildMlbUpsideClusters]", {
      ...dbg,
      clustersBuilt: clusters.length,
      emitted: out.length
    })
  }

  return out
}

module.exports = {
  buildMlbCorrelationClusters,
  buildMlbUpsideClusters,
  pairCorrelationScore,
  isHighUpsideRow,
  isMediumUpsideRow
}

