"use strict"

/**
 * nbaPlayerSeasonStatsCache — computes per-player season averages + rate
 * stats from the EXISTING nbaPlayerGameLogs.json cache. Exports
 * enrichRowWithPlayerSeasonStats(row) for nbaModelSignals.
 *
 * Sets on row:
 *   row.shots       — estimated field goal attempts per game (from points/2.2
 *                     fallback when raw FGA not in cache)
 *   row.astRate     — ast / (ast + estimated_fga) — rough assist rate
 *   row.rebRate     — rebounds per 36 min — rate stat (per-minute reb usage)
 *   row.usage       — minutes-weighted role usage (proxy when raw USG% absent)
 *   row.threePerGame — avg 3PM per game (when present in cache)
 *
 * Cache uses estimates where raw data missing because ESPN's box-score field
 * names for FGA didn't match what populateNbaGameLogs.js expected (capture
 * succeeded for pts/reb/ast/min/blk/stl/threesMade but failed for fga/threeAtt).
 * These estimates beat null — they let the model factor in shot volume rather
 * than ignoring the dimension entirely. A future ESPN-format fix can replace
 * estimates with real values without changing the consumer interface.
 */

const fs   = require("fs")
const path = require("path")

const LOGS_PATH = path.join(__dirname, "..", "..", "data", "nbaPlayerGameLogs.json")
const RELOAD_AFTER_MS = 5 * 60 * 1000

let _logsCache = null
let _seasonCache = null    // computed from logs, indexed by normName
let _loadedAt = 0

function normName(s) { return String(s || "").trim().toLowerCase() }

function loadLogsFromDisk() {
  try {
    if (!fs.existsSync(LOGS_PATH)) return { players: {} }
    return JSON.parse(fs.readFileSync(LOGS_PATH, "utf8")) || { players: {} }
  } catch (_) { return { players: {} } }
}

// Compute per-player season averages + rate stats from game-log entries.
function computeSeasonStats(games) {
  if (!Array.isArray(games) || games.length === 0) return null
  // Only count games where player actually played (minutes > 0)
  const played = games.filter((g) => Number(g?.stats?.minutes) > 0)
  if (played.length === 0) return null

  const sum = { min: 0, pts: 0, reb: 0, ast: 0, blk: 0, stl: 0, threes: 0, fga: 0, threeAtt: 0, to: 0, oreb: 0, dreb: 0, ftm: 0, fta: 0 }
  let fgaCount = 0, threeAttCount = 0, threesCount = 0, toCount = 0, orebCount = 0, drebCount = 0, ftCount = 0
  for (const g of played) {
    const s = g.stats || {}
    sum.min   += Number(s.minutes)  || 0
    sum.pts   += Number(s.points)   || 0
    sum.reb   += Number(s.rebounds) || 0
    sum.ast   += Number(s.assists)  || 0
    sum.blk   += Number(s.blocks)   || 0
    sum.stl   += Number(s.steals)   || 0
    if (Number.isFinite(Number(s.threes))) { sum.threes += Number(s.threes); threesCount++ }
    if (Number.isFinite(Number(s.fga)))     { sum.fga += Number(s.fga); fgaCount++ }
    if (Number.isFinite(Number(s.threeAtt))) { sum.threeAtt += Number(s.threeAtt); threeAttCount++ }
    // 2026-05-24 — Phase 2 expansion. ESPN gameLogs carries these per game; sum
    // them so cognition can see turnover risk and free-throw volume per player.
    if (Number.isFinite(Number(s.turnovers))) { sum.to += Number(s.turnovers); toCount++ }
    if (Number.isFinite(Number(s.offRebounds || s.offReb))) { sum.oreb += Number(s.offRebounds || s.offReb); orebCount++ }
    if (Number.isFinite(Number(s.defRebounds || s.defReb))) { sum.dreb += Number(s.defRebounds || s.defReb); drebCount++ }
    if (Number.isFinite(Number(s.ftm))) { sum.ftm += Number(s.ftm); ftCount++ }
    if (Number.isFinite(Number(s.fta))) { sum.fta += Number(s.fta) }
  }
  const n = played.length

  const avgMin = sum.min / n
  const avgPts = sum.pts / n
  const avgReb = sum.reb / n
  const avgAst = sum.ast / n
  const avgBlk = sum.blk / n
  const avgStl = sum.stl / n
  const avgThrees = threesCount > 0 ? sum.threes / threesCount : null
  // Use real FGA if we have it for >half the games; otherwise estimate from pts
  const haveFgaCoverage = fgaCount / n > 0.5
  const avgFga = haveFgaCoverage ? sum.fga / fgaCount : (avgPts / 2.2)
  const avgThreeAtt = threeAttCount / n > 0.5 ? sum.threeAtt / threeAttCount : null

  // Rate stats — keep null when we don't have enough signal
  const rebPer36 = avgMin > 0 ? (avgReb / avgMin) * 36 : null
  const astPer36 = avgMin > 0 ? (avgAst / avgMin) * 36 : null
  // Ast rate (rough): ast / (ast + 0.5 * fga)
  const astRate = (Number.isFinite(avgFga) && (avgAst + 0.5 * avgFga) > 0)
                  ? avgAst / (avgAst + 0.5 * avgFga) : null
  // Reb rate (rough): rebounds per minute, normalized to per-team-pace-100
  const rebRate = avgMin > 0 ? avgReb / avgMin : null
  // Usage proxy: minutes / 36 (starters cluster ~0.9, bench ~0.5)
  const usage = avgMin / 36

  // 2026-05-24 — extended ESPN signals (Phase 2 expansion)
  const avgTurnovers   = toCount > 0 ? sum.to / toCount : null
  const avgOffRebounds = orebCount > 0 ? sum.oreb / orebCount : null
  const avgDefRebounds = drebCount > 0 ? sum.dreb / drebCount : null
  const avgFtm         = ftCount > 0 ? sum.ftm / ftCount : null
  const avgFta         = ftCount > 0 ? sum.fta / ftCount : null
  const toRate         = Number.isFinite(avgTurnovers) && Number.isFinite(avgFga)
                          ? avgTurnovers / Math.max(1, avgFga + avgTurnovers) : null

  return {
    gamesPlayed: n,
    avgMinutes:  avgMin,
    avgPoints:   avgPts,
    avgRebounds: avgReb,
    avgAssists:  avgAst,
    avgBlocks:   avgBlk,
    avgSteals:   avgStl,
    avgThrees:   avgThrees,
    avgFga:      avgFga,
    avgThreeAtt: avgThreeAtt,
    avgTurnovers, avgOffRebounds, avgDefRebounds, avgFtm, avgFta, toRate,
    fgaSource:   haveFgaCoverage ? "espn_raw" : "estimated_from_points",
    rebPer36, astPer36, astRate, rebRate, usage,
  }
}

function ensureSeasonCache() {
  if (_seasonCache && Date.now() - _loadedAt < RELOAD_AFTER_MS) return _seasonCache
  _logsCache = loadLogsFromDisk()
  _seasonCache = new Map()
  for (const [name, entry] of Object.entries(_logsCache.players || {})) {
    const stats = computeSeasonStats(entry.games)
    if (stats) _seasonCache.set(normName(name), stats)
  }
  _loadedAt = Date.now()
  return _seasonCache
}

function getPlayerSeasonStats(player) {
  const cache = ensureSeasonCache()
  return cache.get(normName(player)) || null
}

function enrichRowWithPlayerSeasonStats(row) {
  if (!row || typeof row !== "object") return row
  const player = row.player || row.playerName
  if (!player) return row
  const stats = getPlayerSeasonStats(player)
  if (!stats) return row

  // These are the signal field names nbaModelSignals roleSignals/recentForm
  // reads. We only set them when they're not already present (don't clobber
  // upstream enrichment).
  if (row.shots     == null && Number.isFinite(stats.avgFga))       row.shots     = stats.avgFga
  if (row.astRate   == null && Number.isFinite(stats.astRate))      row.astRate   = stats.astRate
  if (row.rebRate   == null && Number.isFinite(stats.rebRate))      row.rebRate   = stats.rebRate
  if (row.usage     == null && Number.isFinite(stats.usage))        row.usage     = stats.usage * 22
  if (row.turnovers == null && Number.isFinite(stats.avgTurnovers)) row.turnovers = stats.avgTurnovers
  if (row.toRate    == null && Number.isFinite(stats.toRate))       row.toRate    = stats.toRate

  // Surface the season-stat block under a clear key for FE display + debug
  row.playerSeasonStats = {
    gamesPlayed:    stats.gamesPlayed,
    avgPoints:      stats.avgPoints,
    avgRebounds:    stats.avgRebounds,
    avgAssists:     stats.avgAssists,
    avgMinutes:     stats.avgMinutes,
    avgFga:         stats.avgFga,
    avgThrees:      stats.avgThrees,
    avgTurnovers:   stats.avgTurnovers,
    avgOffRebounds: stats.avgOffRebounds,
    avgDefRebounds: stats.avgDefRebounds,
    avgFtm:         stats.avgFtm,
    avgFta:         stats.avgFta,
    toRate:         stats.toRate,
    fgaSource:      stats.fgaSource,
  }
  return row
}

module.exports = {
  loadLogsFromDisk,
  computeSeasonStats,
  getPlayerSeasonStats,
  enrichRowWithPlayerSeasonStats,
}
