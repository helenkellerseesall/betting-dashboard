"use strict"

/**
 * buildArchetypePerformanceSummary.js
 *
 * Signal Archetype Tracking V1.
 *
 * Aggregates REAL settled bet outcomes from nba_tracked_bets_*.json across a
 * rolling window. Groups by statFamily, tier, side (over/under), and derived
 * archetype combinations. Returns truth-based hit rates and ROI.
 *
 * INVARIANTS:
 *   - Only settled bets (result = "win" | "loss" | "push") contribute to rates.
 *   - ROI is computed from actual oddsAmerican — not estimated.
 *   - No fake EV. No invented profitability. Small samples are flagged.
 *   - MLB stats are kept isolated; this file is sport-scoped (default: nba).
 *
 * Session AV — additive, no existing pipelines touched.
 */

const fs   = require("fs")
const path = require("path")

const RUNTIME_DIR = path.join(__dirname, "..", "..", "runtime", "tracking")

// ─── Archetype label map ─────────────────────────────────────────────────────

const FAMILY_LABELS = {
  points:       "Primary Scorer",
  assists:      "Playmaker",
  rebounds:     "Rebounder",
  threes:       "Perimeter Specialist",
  pra:          "Combo Contributor",
  first_basket: "First Basket",
}

// Named combos that get dedicated tracking (statFamily + side)
const NAMED_ARCHETYPES = [
  { key: "threes_under",    family: "threes",    side: "under", label: "Perimeter Specialist Unders"  },
  { key: "threes_over",     family: "threes",    side: "over",  label: "Perimeter Specialist Overs"   },
  { key: "rebounds_under",  family: "rebounds",  side: "under", label: "Rebounder Unders"             },
  { key: "rebounds_over",   family: "rebounds",  side: "over",  label: "Rebounder Overs"              },
  { key: "assists_under",   family: "assists",   side: "under", label: "Playmaker Unders"             },
  { key: "assists_over",    family: "assists",   side: "over",  label: "Playmaker Overs"              },
  { key: "points_under",    family: "points",    side: "under", label: "Primary Scorer Unders"        },
  { key: "points_over",     family: "points",    side: "over",  label: "Primary Scorer Overs"         },
  { key: "pra_under",       family: "pra",       side: "under", label: "Combo Contributor Unders"     },
  { key: "pra_over",        family: "pra",       side: "over",  label: "Combo Contributor Overs"      },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function americanOddsToDecimal(american) {
  const o = Number(american)
  if (!Number.isFinite(o)) return null
  return o > 0 ? o / 100 : 100 / Math.abs(o)
}

/** Unit ROI: profit per $1 staked, as a decimal. */
function legUnitProfit(result, oddsAmerican) {
  const r = String(result || "").toLowerCase()
  if (r === "push") return 0
  if (r !== "win" && r !== "loss") return null
  const dec = americanOddsToDecimal(oddsAmerican)
  if (dec === null) return null
  return r === "win" ? dec : -1
}

function isSettled(result) {
  const r = String(result || "").toLowerCase()
  return r === "win" || r === "loss" || r === "push"
}

/** Bootstrap an empty bucket. */
function emptyBucket(label = null) {
  return {
    label,
    total: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    pending: 0,
    hitRate: null,
    roi: null,        // percentage, e.g. 12.5 means +12.5 units per 100 staked
    avgEdge: null,
    avgModelProb: null,
  }
}

function finalizeBucket(b) {
  const settled = b.wins + b.losses + b.pushes
  if (settled > 0) {
    b.hitRate = Number((b.wins / (b.wins + b.losses || 1)).toFixed(4))
  }
  if (b._roiSum !== undefined && b._roiCount > 0) {
    b.roi = Number(((b._roiSum / b._roiCount) * 100).toFixed(2))
    b.avgEdge = Number((b._edgeSum / b._roiCount).toFixed(4))
    b.avgModelProb = Number((b._mpSum / b._roiCount).toFixed(4))
  }
  delete b._roiSum
  delete b._roiCount
  delete b._edgeSum
  delete b._mpSum
  return b
}

function addToBucket(bucket, entry, profit) {
  const r = String(entry.result || "").toLowerCase()
  bucket.total++
  if (r === "win")  bucket.wins++
  else if (r === "loss") bucket.losses++
  else if (r === "push") bucket.pushes++
  else bucket.pending++

  if (profit !== null) {
    bucket._roiSum  = (bucket._roiSum  || 0) + profit
    bucket._roiCount = (bucket._roiCount || 0) + 1
    bucket._edgeSum = (bucket._edgeSum || 0) + (Number(entry.edge) || 0)
    bucket._mpSum   = (bucket._mpSum   || 0) + (Number(entry.modelProb) || 0)
  }
}

// ─── Date range helpers ───────────────────────────────────────────────────────

function getWindowDates(windowDays) {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
  return cutoff
}

function parseDateFromFilename(filename) {
  const m = path.basename(filename).match(/(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

// ─── Load bet entries from tracked files ─────────────────────────────────────

function loadBetEntries(sport, windowCutoff) {
  const pattern = `${sport}_tracked_bets_`
  const allFiles = fs.existsSync(RUNTIME_DIR)
    ? fs.readdirSync(RUNTIME_DIR).filter(f => f.startsWith(pattern) && f.endsWith(".json"))
    : []

  const entries = []
  for (const filename of allFiles) {
    const dateStr = parseDateFromFilename(filename)
    if (!dateStr) continue
    if (dateStr < windowCutoff.toISOString().slice(0, 10)) continue

    const raw = readJsonSafe(path.join(RUNTIME_DIR, filename))
    if (!raw) continue

    const rows = Array.isArray(raw) ? raw : (raw.entries || [])
    for (const row of rows) {
      if (!row || typeof row !== "object") continue
      // Require statFamily for archetype grouping
      if (!row.statFamily) continue
      entries.push(row)
    }
  }
  return entries
}

// ─── Insight generation ───────────────────────────────────────────────────────

const MIN_SAMPLE_INSIGHT = 3   // need at least N settled to generate an insight line
const MIN_SAMPLE_RELIABLE = 20 // need this many for "reliable" quality flag

function sampleQualityLabel(settledCount) {
  if (settledCount < 8)  return "insufficient"
  if (settledCount < MIN_SAMPLE_RELIABLE) return "emerging"
  return "reliable"
}

function rateLabel(hitRate) {
  if (hitRate === null) return "no data"
  const pct = Math.round(hitRate * 100)
  if (pct >= 70) return `${pct}% ✓ outperforming`
  if (pct >= 55) return `${pct}% ~ on trend`
  if (pct <= 35) return `${pct}% ✗ underperforming`
  return `${pct}%`
}

function generateInsights(byStatFamily, byTier, bySide, archetypes, totalSettled) {
  const lines = []

  // Overall sample note
  if (totalSettled < MIN_SAMPLE_INSIGHT) {
    lines.push(`Insufficient settled data (${totalSettled} bets) — accumulating sample`)
    return lines
  }

  // Side comparison
  const over  = bySide.over
  const under = bySide.under
  if (over && under && over.hitRate !== null && under.hitRate !== null) {
    const overPct  = Math.round(over.hitRate  * 100)
    const underPct = Math.round(under.hitRate * 100)
    if (overPct > underPct + 10) lines.push(`Overs outperforming unders (${overPct}% vs ${underPct}%)`)
    else if (underPct > overPct + 10) lines.push(`Unders outperforming overs (${underPct}% vs ${overPct}%)`)
  }

  // Stat family observations
  for (const [family, bucket] of Object.entries(byStatFamily)) {
    const settled = bucket.wins + bucket.losses + bucket.pushes
    if (settled < MIN_SAMPLE_INSIGHT) continue
    const label = FAMILY_LABELS[family] || family
    const hr = bucket.hitRate
    if (hr === null) continue
    const pct = Math.round(hr * 100)
    const roiStr = bucket.roi !== null ? ` ROI ${bucket.roi > 0 ? "+" : ""}${bucket.roi.toFixed(1)}%` : ""
    if (pct >= 65) lines.push(`${label} strongest hit rate (${pct}% on ${settled} bets${roiStr})`)
    else if (pct <= 35) lines.push(`${label} underperforming (${pct}% on ${settled} bets${roiStr})`)
  }

  // Tier observations
  for (const tier of ["ELITE", "STRONG", "PLAYABLE"]) {
    const bucket = byTier[tier]
    if (!bucket) continue
    const settled = bucket.wins + bucket.losses + bucket.pushes
    if (settled < MIN_SAMPLE_INSIGHT) continue
    const hr = bucket.hitRate
    if (hr === null) continue
    const pct = Math.round(hr * 100)
    if (pct >= 70) lines.push(`${tier} tier leading — ${pct}% hit rate (${settled} bets)`)
    else if (pct <= 30) lines.push(`${tier} tier lagging — ${pct}% hit rate (${settled} bets)`)
  }

  // Named archetype observations
  for (const arch of NAMED_ARCHETYPES) {
    const bucket = archetypes[arch.key]
    if (!bucket) continue
    const settled = bucket.wins + bucket.losses + bucket.pushes
    if (settled < MIN_SAMPLE_INSIGHT) continue
    const hr = bucket.hitRate
    if (hr === null) continue
    const pct = Math.round(hr * 100)
    if (pct >= 70 || pct <= 35) {
      const roiStr = bucket.roi !== null ? ` (ROI ${bucket.roi > 0 ? "+" : ""}${bucket.roi.toFixed(1)}%)` : ""
      lines.push(`${arch.label}: ${rateLabel(hr)} on ${settled} bets${roiStr}`)
    }
  }

  if (lines.length === 0) {
    lines.push(`${totalSettled} bets settled — no strong archetype divergence yet`)
  }

  return lines
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} [opts.sport="nba"]
 * @param {number} [opts.windowDays=30]
 * @returns {object} archetype performance summary
 */
function buildArchetypePerformanceSummary({ sport = "nba", windowDays = 30 } = {}) {
  const generatedAt  = new Date().toISOString()
  const windowCutoff = getWindowDates(windowDays)

  const entries = loadBetEntries(sport, windowCutoff)

  // ── Aggregation buckets ──
  const byStatFamily = {}   // keyed by statFamily
  const byTier       = {}   // keyed by ELITE / STRONG / PLAYABLE
  const bySide       = {}   // keyed by "over" / "under"
  const archetypes   = {}   // keyed by NAMED_ARCHETYPES key
  const byVolatility = {}   // keyed by volatility (if present)

  for (const arch of NAMED_ARCHETYPES) archetypes[arch.key] = emptyBucket(arch.label)

  let totalBets    = 0
  let totalSettled = 0
  const datesObserved = new Set()

  for (const entry of entries) {
    const family     = String(entry.statFamily || "").toLowerCase()
    const side       = String(entry.side       || "").toLowerCase()
    const tier       = String(entry.tier       || "").toUpperCase()
    const volatility = String(entry.volatility || "").toLowerCase()
    const result     = entry.result
    const odds       = entry.oddsAmerican
    const dateKey    = String(entry.date || "").slice(0, 10)

    if (dateKey) datesObserved.add(dateKey)
    totalBets++
    if (isSettled(result)) totalSettled++

    const profit = legUnitProfit(result, odds)

    // byStatFamily
    if (family) {
      if (!byStatFamily[family]) byStatFamily[family] = emptyBucket(FAMILY_LABELS[family] || family)
      addToBucket(byStatFamily[family], entry, profit)
    }

    // byTier
    if (tier) {
      if (!byTier[tier]) byTier[tier] = emptyBucket(tier)
      addToBucket(byTier[tier], entry, profit)
    }

    // bySide
    if (side) {
      if (!bySide[side]) bySide[side] = emptyBucket(side)
      addToBucket(bySide[side], entry, profit)
    }

    // byVolatility
    if (volatility) {
      if (!byVolatility[volatility]) byVolatility[volatility] = emptyBucket(volatility)
      addToBucket(byVolatility[volatility], entry, profit)
    }

    // Named archetypes
    for (const arch of NAMED_ARCHETYPES) {
      if (family === arch.family && side === arch.side) {
        addToBucket(archetypes[arch.key], entry, profit)
      }
    }
  }

  // Finalize all buckets
  for (const b of Object.values(byStatFamily)) finalizeBucket(b)
  for (const b of Object.values(byTier))       finalizeBucket(b)
  for (const b of Object.values(bySide))        finalizeBucket(b)
  for (const b of Object.values(byVolatility))  finalizeBucket(b)
  for (const b of Object.values(archetypes))    finalizeBucket(b)

  // Prune empty archetype buckets
  for (const key of Object.keys(archetypes)) {
    if (archetypes[key].total === 0) delete archetypes[key]
  }

  const insights = generateInsights(byStatFamily, byTier, bySide, archetypes, totalSettled)
  const quality  = sampleQualityLabel(totalSettled)

  return {
    generatedAt,
    sport,
    window: {
      days:         windowDays,
      cutoff:       windowCutoff.toISOString().slice(0, 10),
      datesWithData: [...datesObserved].sort(),
    },
    sample: {
      totalBets,
      totalSettled,
      quality,
      warning: quality !== "reliable"
        ? `Sample quality: ${quality} (${totalSettled} settled bets — ${MIN_SAMPLE_RELIABLE} needed for reliability)`
        : null,
    },
    byStatFamily,
    byTier,
    bySide,
    byVolatility,
    archetypes,
    insights,
  }
}

module.exports = { buildArchetypePerformanceSummary }
