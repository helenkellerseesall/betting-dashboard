"use strict"

/**
 * Outcome range: strict stat family (player + eventId + statFamilyKey).
 * No model changes — pool + form only.
 */

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function playerKey(c) {
  return String(c?.player || "")
    .trim()
    .toLowerCase()
}

function overRungFromLine(ln) {
  const n = toNum(ln)
  if (!Number.isFinite(n)) return null
  return Math.ceil(n - 0.49 + 1e-9)
}

function statFamilyKey(c) {
  const mk = String(c?.marketKey || "").toLowerCase()
  const pt = String(c?.propType || "").toLowerCase()

  if (mk.includes("points_rebounds_assists") || mk.includes("player_pra")) return "pra"

  if (
    mk.includes("player_points_assists") ||
    (mk.includes("player_points_rebounds") && !mk.includes("assists")) ||
    mk.includes("player_rebounds_assists")
  )
    return "combo"

  if (mk.includes("player_threes") || mk.includes("player_three")) return "threes"

  if (mk.includes("player_rebounds")) return "rebounds"
  if (mk.includes("player_assists")) return "assists"
  if (mk.includes("player_points")) return "points"

  if (pt.includes("pra")) return "pra"
  if (pt.includes("threes") || pt.includes("three")) return "threes"
  if (pt.includes("rebound")) return "rebounds"
  if (pt.includes("assist") && !pt.includes("point")) return "assists"
  if (pt.includes("point")) return "points"

  return "other"
}

function readUsageMinutes(pick) {
  const u =
    toNum(pick?.usageRate) ??
    toNum(pick?.playerUsage) ??
    toNum(pick?.usage) ??
    toNum(pick?.roleUsagePct) ??
    22
  const m = toNum(pick?.projectedMinutes) ?? toNum(pick?.minutes) ?? toNum(pick?.projectedMins) ?? 26
  return { u, m }
}

/**
 * Min/max rung gap (floor→median and median→ceiling) by family and usage.
 * Points/PRA: ~3–6 point bands (tighter for stars).
 */
function spreadPolicy(family, u, minutes) {
  const m = minutes ?? 26
  const highUsage = u >= 27 && m >= 30
  const lowUsage = u < 20.5 || m < 22
  if (family === "points" || family === "pra" || family === "combo") {
    if (highUsage) return { minGap: 3, maxGap: 5 }
    if (lowUsage) return { minGap: 2, maxGap: 7 }
    return { minGap: 2, maxGap: 6 }
  }
  if (family === "threes") return { minGap: 1, maxGap: 2 }
  if (family === "assists") return { minGap: 1, maxGap: 4 }
  if (family === "rebounds") return { minGap: 1, maxGap: 4 }
  return { minGap: 2, maxGap: 6 }
}

function predictedMedianOutcome(c) {
  const rf = c?.recentForm && typeof c.recentForm === "object" ? c.recentForm : null
  const b = toNum(rf?.baseline)
  if (Number.isFinite(b)) return b
  const l5 = toNum(rf?.last5_avg)
  const l10 = toNum(rf?.last10_avg)
  if (Number.isFinite(l5) && Number.isFinite(l10)) return 0.55 * l5 + 0.45 * l10
  if (Number.isFinite(l5)) return l5
  if (Number.isFinite(l10)) return l10
  return null
}

/** Floor / ceiling as fraction of true EV (not ladder midpoint). */
function evBandMultipliers(family) {
  if (family === "threes") return { lo: 0.88, hi: 1.12 }
  if (family === "assists" || family === "rebounds") return { lo: 0.82, hi: 1.18 }
  if (family === "points" || family === "pra" || family === "combo") return { lo: 0.825, hi: 1.15 }
  return { lo: 0.825, hi: 1.15 }
}

function normMarketKey(c) {
  return String(c?.marketKey || "")
    .trim()
    .toLowerCase()
}

function isAltMidLabel(c) {
  const l = String(c?.ladder || "").trim().toLowerCase()
  const pv = String(c?.propVariant || "").trim().toLowerCase()
  return l === "alt-mid" || l === "alt mid" || l === "alt_mid" || pv === "alt-mid"
}

function mkRung(line) {
  const r = overRungFromLine(line)
  const rung = r != null ? r : Math.round(line)
  return { line, rung, label: String(rung) }
}

/** Max |poolLine - rangeTierLine| when binding a tier to the board (points/PRA/combo: 8). */
function lineResolveMaxAbsDiff(family) {
  if (family === "points" || family === "pra" || family === "combo") return 8
  if (family === "threes") return 3
  if (family === "assists" || family === "rebounds") return 5
  return 8
}

function tieBreakLinePick(a, b, pickMkNorm) {
  const mk = String(pickMkNorm || "")
    .trim()
    .toLowerCase()
  const ma = normMarketKey(a.row)
  const mb = normMarketKey(b.row)
  const fa = mk && ma === mk ? 0 : 1
  const fb = mk && mb === mk ? 0 : 1
  if (fa !== fb) return fa - fb
  return (isAltMidLabel(a.row) ? 1 : 0) - (isAltMidLabel(b.row) ? 1 : 0)
}

/** Drop far-out book ladders before building aiRange (PRA / points spike lines). */
function filterUniqLinesForRangeBuild(uniqLines, mPred, pick, family) {
  if (!Array.isArray(uniqLines) || uniqLines.length < 2) return uniqLines || []
  const maxAbs = lineResolveMaxAbsDiff(family)
  const anchor = Number.isFinite(mPred)
    ? mPred
    : Number.isFinite(toNum(pick?.line))
      ? toNum(pick.line)
      : uniqLines[Math.floor(uniqLines.length / 2)]
  if (!Number.isFinite(anchor)) return uniqLines
  const span = Math.max(maxAbs * 5, 20)
  const cut = uniqLines.filter((ln) => Math.abs(ln - anchor) <= span)
  return cut.length >= 2 ? cut : uniqLines
}

/**
 * Only consider pool lines within ±maxAbs of the aiRange tier anchors (union band).
 * Excludes ladders far outside floor / median / ceiling targets.
 */
function prefilterRangeBindingCandidates(candidates, range, rangeFam) {
  if (!candidates.length) return candidates
  const maxAbs = lineResolveMaxAbsDiff(rangeFam)
  const fl = toNum(range.floor?.line)
  const ml = toNum(range.median?.line)
  const cl = toNum(range.ceiling?.line)
  if (![fl, ml, cl].every(Number.isFinite)) return candidates
  const pad = maxAbs * 2
  const lo = Math.min(fl, ml, cl) - pad
  const hi = Math.max(fl, ml, cl) + pad
  const out = candidates.filter((c) => {
    const ln = toNum(c.line)
    return Number.isFinite(ln) && ln >= lo - 1e-9 && ln <= hi + 1e-9
  })
  return out.length ? out : candidates
}

/** Prefer non–alt-mid row when the same numeric line exists on a base row. */
function filterAltMidWhenBaseLineExists(candidates) {
  if (!candidates.length) return candidates
  const byLine = new Map()
  for (const c of candidates) {
    const ln = toNum(c.line)
    if (!Number.isFinite(ln)) continue
    const k = String(ln)
    if (!byLine.has(k)) byLine.set(k, { hasBase: false })
    if (!isAltMidLabel(c)) byLine.get(k).hasBase = true
  }
  return candidates.filter((c) => {
    const ln = toNum(c.line)
    if (!Number.isFinite(ln)) return false
    const b = byLine.get(String(ln))
    if (isAltMidLabel(c) && b?.hasBase) return false
    return true
  })
}

/**
 * Hard guard: reject bindings >10 above median tier line AND outside ceiling + maxAbs band
 * (catches wrong snaps onto 50+ PRA ladders).
 */
function rangeBindingSpikesInflated(best, range, maxAbs, slot) {
  if (slot === "lotto" || !best) return false
  const ml = toNum(range.median?.line)
  const cl = toNum(range.ceiling?.line)
  const ln = toNum(best.line)
  if (!Number.isFinite(ln) || !Number.isFinite(ml)) return false
  if (ln <= ml + 10 + 1e-6) return false
  if (Number.isFinite(cl) && ln <= cl + maxAbs + 1e-6) return false
  return true
}

/**
 * Bind aiRange tier lines to pool rows (same player/event/family already filtered).
 * floor: closest line ≤ target (max line under), within maxAbs of target
 * median: closest line ≈ target, within maxAbs
 * ceiling: closest line ≥ target (min line over), within maxAbs above target
 */
function pickLineForRangeSlot(slot, target, linesWithRows, pickMkNorm, maxAbs) {
  if (!linesWithRows.length || !Number.isFinite(target)) return null

  if (slot === "floor") {
    const under = linesWithRows.filter((x) => x.line <= target + 1e-6)
    if (!under.length) return null
    const band = under.filter((x) => target - x.line <= maxAbs + 1e-6)
    const pool = band.length ? band : under
    const hi = Math.max(...pool.map((x) => x.line))
    const tied = pool.filter((x) => Math.abs(x.line - hi) < 1e-6)
    tied.sort((a, b) => tieBreakLinePick(a, b, pickMkNorm) || a.line - b.line)
    return tied[0]
  }

  if (slot === "ceiling") {
    const over = linesWithRows.filter((x) => x.line >= target - 1e-6)
    if (!over.length) return null
    const band = over.filter((x) => x.line - target <= maxAbs + 1e-6)
    const pool = band.length ? band : over
    const lo = Math.min(...pool.map((x) => x.line))
    const tied = pool.filter((x) => Math.abs(x.line - lo) < 1e-6)
    tied.sort((a, b) => tieBreakLinePick(a, b, pickMkNorm) || a.line - b.line)
    return tied[0]
  }

  if (slot !== "median") return null

  const band = linesWithRows.filter((x) => Math.abs(x.line - target) <= maxAbs + 1e-6)
  const pool = band.length ? band : linesWithRows
  let bestD = Infinity
  for (const x of pool) {
    const d = Math.abs(x.line - target)
    if (d < bestD - 1e-9) bestD = d
  }
  const tied = pool.filter((x) => Math.abs(Math.abs(x.line - target) - bestD) < 1e-9)
  tied.sort((a, b) => tieBreakLinePick(a, b, pickMkNorm) || Math.abs(a.line - target) - Math.abs(b.line - target))
  return tied[0]
}

function nearestRungInSorted(sortedRungs, target, preferLower) {
  if (!sortedRungs.length) return null
  let best = sortedRungs[0]
  let bd = Infinity
  for (const rg of sortedRungs) {
    const d = Math.abs(rg - target)
    if (d < bd - 1e-9 || (Math.abs(d - bd) < 1e-9 && preferLower && rg < best)) {
      bd = d
      best = rg
    }
  }
  return best
}

/**
 * Build floor / median / ceiling / lotto from pool lines.
 * Median locks to **expected value** (mPred = baseline / weighted form — not ladder midpoint).
 * Floor ≈ lo×EV, ceiling ≈ hi×EV; pool rungs are chosen by closest line to those targets.
 */
function buildLadderRange(linesAsc, mPred, family, pick = {}) {
  const lines = [...linesAsc].sort((a, b) => a - b)
  const r = (ln) => overRungFromLine(ln)
  if (lines.length < 2) return null

  const { u, m } = readUsageMinutes(pick)
  const { minGap, maxGap } = spreadPolicy(family, u, m)

  const byRung = new Map()
  for (const ln of lines) {
    const rg = r(ln)
    if (rg == null) continue
    const evA = Number.isFinite(mPred) ? mPred : toNum(pick?.line)
    const prev = byRung.get(rg)
    if (prev == null) byRung.set(rg, ln)
    else if (Number.isFinite(evA)) {
      if (Math.abs(ln - evA) + 1e-9 < Math.abs(prev - evA)) byRung.set(rg, ln)
    }
  }

  const rungsSorted = [...byRung.keys()].sort((a, b) => a - b)
  if (rungsSorted.length < 2) return null

  const lottoLine = lines[lines.length - 1]
  const rl = r(lottoLine)
  if (rl == null) return null

  const ev = Number.isFinite(mPred)
    ? mPred
    : Number.isFinite(toNum(pick?.line))
      ? toNum(pick.line)
      : lines[Math.floor(lines.length / 2)]
  if (!Number.isFinite(ev) || ev <= 0) return null

  const { lo: loM, hi: hiM } = evBandMultipliers(family)
  const tMed = ev
  const tFloor = ev * loM
  const tCeil = ev * hiM

  const closestRungToLine = (targetLine, allowedRungs) => {
    let bestRg = null
    let bd = Infinity
    for (const rg of allowedRungs) {
      const ln = byRung.get(rg)
      if (ln == null || !Number.isFinite(ln)) continue
      const d = Math.abs(ln - targetLine)
      if (bestRg == null || d < bd - 1e-9 || (Math.abs(d - bd) < 1e-9 && rg < bestRg)) {
        bd = d
        bestRg = rg
      }
    }
    return bestRg
  }

  let medR = closestRungToLine(tMed, rungsSorted)
  if (medR == null) return null

  let below = rungsSorted.filter((x) => x < medR).sort((a, b) => b - a)
  let above = rungsSorted.filter((x) => x > medR && x <= rl).sort((a, b) => a - b)
  if (!below.length || !above.length) return null

  let floorR = closestRungToLine(tFloor, below) ?? below[0]
  let ceilR = closestRungToLine(tCeil, above) ?? above[above.length - 1]

  let guard = 0
  while (guard++ < 14 && medR > floorR + minGap) {
    const gapLo = medR - floorR
    const gapHi = ceilR - medR
    if (gapHi + 1e-9 >= 0.85 * gapLo) break
    const down = below.filter((rg) => rg < medR && rg > floorR).sort((a, b) => b - a)
    let moved = false
    for (const rg of down) {
      if (ceilR - rg < minGap) continue
      if (rg - floorR < minGap) continue
      medR = rg
      moved = true
      break
    }
    if (!moved) break
    below = rungsSorted.filter((x) => x < medR).sort((a, b) => b - a)
    above = rungsSorted.filter((x) => x > medR && x <= rl).sort((a, b) => a - b)
    if (!below.length || !above.length) return null
    floorR = closestRungToLine(tFloor, below) ?? below[0]
    ceilR = closestRungToLine(tCeil, above) ?? above[above.length - 1]
  }

  if (medR - floorR > maxGap) {
    const target = medR - maxGap
    const ok = below.filter((fr) => medR - fr <= maxGap && medR - fr >= minGap)
    floorR = ok.length ? Math.max(...ok) : nearestRungInSorted(below, target, true) ?? floorR
  }
  if (ceilR - medR > maxGap) {
    const target = medR + maxGap
    const ok = above.filter((cr) => cr - medR <= maxGap && cr - medR >= minGap && cr <= rl)
    ceilR = ok.length ? Math.min(...ok) : nearestRungInSorted(above.filter((x) => x <= rl), target, false) ?? ceilR
  }

  if (medR - floorR < minGap - 1e-9) {
    const target = medR - minGap
    const nf = nearestRungInSorted(below, target, true)
    if (nf != null && nf < medR) floorR = nf
  }
  if (ceilR - medR < minGap - 1e-9) {
    const target = medR + minGap
    const na = nearestRungInSorted(above.filter((x) => x <= rl), target, false)
    if (na != null && na > medR) ceilR = na
  }

  if (!(floorR < medR && medR < ceilR && ceilR <= rl)) return null
  if (medR - floorR > maxGap + 1e-9 || ceilR - medR > maxGap + 1e-9) return null
  if (medR - floorR < minGap - 1e-9 || ceilR - medR < minGap - 1e-9) return null

  const floorLine = byRung.get(floorR)
  const medianLine = byRung.get(medR)
  const ceilingLine = byRung.get(ceilR)
  if (floorLine == null || medianLine == null || ceilingLine == null) return null

  const rf = r(floorLine)
  const rm = r(medianLine)
  const rc = r(ceilingLine)
  if (rf == null || rm == null || rc == null) return null
  if (!(rf < rm && rm < rc && rc <= rl)) return null

  return { floorLine, medianLine, ceilingLine, lottoLine }
}

/** Strong edge + weight: always emit numeric aiRange even when book ladders are sparse. */
function pickQualifiesForGuaranteedRange(pick) {
  const e = toNum(pick?.edge) ?? 0
  const fw = toNum(pick?.finalWeight) ?? 0
  return e >= 0.04 && fw >= 0.18
}

/** Model-shaped floor/median/ceiling when pool cannot form a ladder spread. */
function syntheticSpreadFromPrediction(pick, family, mPred) {
  const pl = toNum(pick?.line)
  const ev = Number.isFinite(mPred) ? mPred : pl
  if (!Number.isFinite(ev) || ev <= 0) return null
  const { u, m } = readUsageMinutes(pick)
  const { minGap } = spreadPolicy(family, u, m)
  const { lo: loM, hi: hiM } = evBandMultipliers(family)
  const rMed = overRungFromLine(ev) ?? Math.max(1, Math.round(ev))
  if (!Number.isFinite(rMed) || rMed < 1) return null
  let floorR = overRungFromLine(ev * loM - 0.49)
  let ceilR = overRungFromLine(ev * hiM - 0.49)
  if (!Number.isFinite(floorR) || floorR >= rMed) floorR = Math.max(1, rMed - Math.max(minGap, 3))
  if (!Number.isFinite(ceilR) || ceilR <= rMed) ceilR = rMed + Math.max(minGap, 3)
  if (!(floorR < rMed && rMed < ceilR)) return null
  const floorLine = floorR - 0.5
  const medianLine = rMed - 0.5
  const ceilingLine = ceilR - 0.5
  if (!(floorLine + 1e-9 < medianLine && medianLine + 1e-9 < ceilingLine)) return null
  const lottoR = ceilR + Math.max(2, minGap)
  const lottoLine = lottoR - 0.5
  return { floorLine, medianLine, ceilingLine, lottoLine, synthetic: true }
}

function finalizeAiRangeFromSpread(spread, linesForLotto, famPick, family) {
  const maxAbs = lineResolveMaxAbsDiff(family)
  const ceilLine = spread.ceilingLine
  const ceilR = overRungFromLine(ceilLine)
  let lottoLine = spread.lottoLine
  if (!spread.synthetic && Number.isFinite(ceilLine) && ceilR != null && Array.isArray(linesForLotto) && linesForLotto.length) {
    let nearAbove = null
    for (const ln of linesForLotto) {
      const r = overRungFromLine(ln)
      if (r == null || r <= ceilR) continue
      if (ln - ceilLine > maxAbs + 1e-6) continue
      nearAbove = ln
      break
    }
    if (nearAbove != null) lottoLine = nearAbove
    else if (spread.lottoLine - ceilLine > maxAbs + 1e-6) lottoLine = null
  }
  const out = {
    family: famPick,
    floor: mkRung(spread.floorLine),
    median: mkRung(spread.medianLine),
    ceiling: mkRung(spread.ceilingLine),
  }
  if (lottoLine != null) out.lotto = mkRung(lottoLine)
  if (spread.synthetic) out.synthetic = true
  return out
}

function computeOutcomeRange(pick, pool) {
  if (!pick || typeof pick !== "object") return null
  const pk = playerKey(pick)
  const eid = String(pick.eventId || "").trim()
  const family = statFamilyKey(pick)
  if (!pk || !eid) return null

  if (family === "other") return null

  const famPick = family
  const siblings = pool.filter((c) => {
    if (playerKey(c) !== pk) return false
    if (String(c.eventId || "").trim() !== eid) return false
    const fk = statFamilyKey(c)
    if (fk !== famPick) return false
    if (fk === "other") return false
    return Number.isFinite(toNum(c.line))
  })

  const linesWithRows = siblings
    .map((row) => ({ line: toNum(row.line), row }))
    .filter((x) => Number.isFinite(x.line))

  const uniqLines = []
  const seen = new Set()
  for (const x of linesWithRows) {
    const k = String(x.line)
    if (seen.has(k)) continue
    seen.add(k)
    uniqLines.push(x.line)
  }
  uniqLines.sort((a, b) => a - b)

  const mPred = predictedMedianOutcome(pick)

  if (uniqLines.length < 2) {
    if (!pickQualifiesForGuaranteedRange(pick)) return null
    const sp0 = syntheticSpreadFromPrediction(pick, family, mPred)
    if (!sp0) return null
    return finalizeAiRangeFromSpread(sp0, uniqLines, famPick, family)
  }

  const linesForSpread = filterUniqLinesForRangeBuild(uniqLines, mPred, pick, family)
  let spread = buildLadderRange(linesForSpread, mPred, family, pick)
  if (!spread && pickQualifiesForGuaranteedRange(pick)) {
    spread = syntheticSpreadFromPrediction(pick, family, mPred)
  }
  if (!spread) return null

  return finalizeAiRangeFromSpread(spread, linesForSpread, famPick, family)
}

/** Tier-shaped leg when no book row binds (still shows Range + slips align on rungs). */
function syntheticTierLeg(pick, tier, slot) {
  const line = toNum(tier.line)
  const rung = toNum(tier.rung) ?? overRungFromLine(line)
  if (!Number.isFinite(line) || !Number.isFinite(rung)) return null
  return {
    ...pick,
    line,
    ladder: `${rung}+`,
    propVariant: "base",
    aiRangeSlot: slot,
    aiRangeSyntheticLeg: true,
  }
}

/**
 * @param {'floor'|'median'|'ceiling'|'lotto'} slot
 */
function resolveLegFromAiRange(pick, pool, slot) {
  const range = pick?.aiRange
  if (!range) return null

  if (slot === "lotto") return resolveLottoLegAboveCeiling(pick, pool)

  if (!range[slot]) return null

  const famPick = statFamilyKey(pick)
  const rangeFam = range.family
  if (!rangeFam || famPick !== rangeFam || famPick === "other") return null

  const tier = range[slot]
  const target = toNum(tier.line)
  const rung = toNum(tier.rung)
  if (!Number.isFinite(target)) return null

  const pk = playerKey(pick)
  const eid = String(pick.eventId || "").trim()

  const baseCandidates = pool.filter((c) => {
    if (playerKey(c) !== pk) return false
    if (String(c.eventId || "").trim() !== eid) return false
    if (statFamilyKey(c) !== rangeFam) return false
    return Number.isFinite(toNum(c.line))
  })

  if (!baseCandidates.length) return syntheticTierLeg(pick, tier, slot)

  let candidates = prefilterRangeBindingCandidates(baseCandidates, range, rangeFam)
  candidates = filterAltMidWhenBaseLineExists(candidates)
  if (!candidates.length) candidates = baseCandidates

  const maxAbs = lineResolveMaxAbsDiff(rangeFam)
  const mlGuard = toNum(range.median?.line)
  const clGuard = toNum(range.ceiling?.line)

  let linesWithRows = candidates.map((row) => ({ line: toNum(row.line), row }))
  let best = pickLineForRangeSlot(slot, target, linesWithRows, normMarketKey(pick), maxAbs)
  if (rangeBindingSpikesInflated(best, range, maxAbs, slot)) {
    linesWithRows = linesWithRows.filter(({ line: ln }) => {
      if (!Number.isFinite(mlGuard)) return true
      if (ln <= mlGuard + 10 + 1e-6) return true
      return Number.isFinite(clGuard) && ln <= clGuard + maxAbs + 1e-6
    })
    if (linesWithRows.length) {
      best = pickLineForRangeSlot(slot, target, linesWithRows, normMarketKey(pick), maxAbs)
    }
  }
  if (!best || !best.row || rangeBindingSpikesInflated(best, range, maxAbs, slot)) {
    return syntheticTierLeg(pick, tier, slot)
  }

  if (statFamilyKey(best.row) !== rangeFam) return syntheticTierLeg(pick, tier, slot)

  const displayRung = Number.isFinite(rung) ? rung : overRungFromLine(target)
  const displayLadder = Number.isFinite(displayRung) ? `${displayRung}+` : `${overRungFromLine(target) ?? Math.round(target)}+`

  const row = { ...best.row }
  row.line = best.line
  row.ladder = displayLadder
  row.propVariant = "base"
  row.aiRangeSlot = slot
  return row
}

/**
 * LOTTO: first pool line strictly above aiRange.ceiling (same stat family), else null.
 */
function resolveLottoLegAboveCeiling(pick, pool) {
  const range = pick?.aiRange
  if (!range?.ceiling) return null

  const famPick = statFamilyKey(pick)
  const rangeFam = range.family
  if (!rangeFam || famPick !== rangeFam || famPick === "other") return null

  const ceilingRung = toNum(range.ceiling.rung) ?? overRungFromLine(toNum(range.ceiling.line))
  if (!Number.isFinite(ceilingRung)) return null

  const ceilingLine = toNum(range.ceiling.line)
  if (!Number.isFinite(ceilingLine)) return null

  const maxAbs = lineResolveMaxAbsDiff(rangeFam)

  const pk = playerKey(pick)
  const eid = String(pick.eventId || "").trim()

  const candidates = pool.filter((c) => {
    if (playerKey(c) !== pk) return false
    if (String(c.eventId || "").trim() !== eid) return false
    if (statFamilyKey(c) !== rangeFam) return false
    return Number.isFinite(toNum(c.line))
  })

  let bestRow = null
  let bestR = null
  let bestAlt = 2
  for (const row of candidates) {
    const ln = toNum(row.line)
    const rg = overRungFromLine(ln)
    if (rg == null || rg <= ceilingRung) continue
    if (ln - ceilingLine > maxAbs + 1e-6) continue
    const alt = isAltMidLabel(row) ? 1 : 0
    if (
      bestR == null ||
      rg < bestR - 1e-9 ||
      (Math.abs(rg - bestR) < 1e-9 && alt < bestAlt)
    ) {
      bestR = rg
      bestAlt = alt
      bestRow = row
    }
  }

  if (!bestRow || bestR == null) {
    const lt = range.lotto
    if (lt) {
      const ln = toNum(lt.line)
      const lr = toNum(lt.rung) ?? overRungFromLine(ln)
      if (Number.isFinite(ln) && Number.isFinite(lr) && lr > ceilingRung) {
        return {
          ...pick,
          line: ln,
          ladder: `${lr}+`,
          propVariant: "base",
          aiRangeSlot: "lotto",
          aiRangeSyntheticLeg: true,
        }
      }
    }
    return null
  }

  return {
    ...bestRow,
    line: toNum(bestRow.line),
    ladder: `${bestR}+`,
    propVariant: "base",
    aiRangeSlot: "lotto",
  }
}

module.exports = {
  statFamilyKey,
  predictedMedianOutcome,
  computeOutcomeRange,
  resolveLegFromAiRange,
  resolveLottoLegAboveCeiling,
  overRungFromLine,
  playerKey,
}
