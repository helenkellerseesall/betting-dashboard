"use strict"
// ============================================================================
// assembleMlbPickStatBacking — serve-time, per-pick MLB stat-backing assembly.
// ----------------------------------------------------------------------------
// The Top Picks card needs PROP-SPECIFIC stat backing on EVERY pick. The Step-2
// displayBundle only ever reached the ~3.6% of picks whose exact player|side|line
// matched the 92-row curated board. This module assembles a displayBundle for
// ANY pick by resolving the player against the full slate snapshot + the stat
// caches — no board join, no new network.
//
//   • Batters (hits/TB/HR/RBI/runs): reuse buildMlbDisplayBundle on the player's
//     snapshot row (which already carries opposing-pitcher / park / weather /
//     platoon), enriched with the season line from mlbBatterStats. getBatterForm
//     supplies L5/L15 inside buildMlbDisplayBundle.
//   • Pitcher strikeouts: a NEW pitcher-shaped bundle — recent Ks from
//     mlbPitcherGameLogs, season K%/K9/WHIP/IP-per-start from mlbPitcherStats,
//     opponent-lineup K% DERIVED from the opposing team's cached batter kRates
//     (no new feed). buildMlbDisplayBundle is batter-shaped, so pitchers get
//     their own builder here.
//
// ANTI-FABRICATION (binding — this is the trust surface): every field is
// null-guarded; a missing source value is OMITTED, never defaulted to 0 or
// invented. Uncached batters/teams simply drop the affected rows. League-average
// context (for helps/hurts reads) is computed from real cached data, never faked.
//
// PRESERVED files are reused, never edited (buildMlbDisplayBundle, intelligence
// normPlayer). Pure: reads file caches, no mutation of inputs, no network.
// ============================================================================
const fs = require("fs")
const path = require("path")
const { buildMlbDisplayBundle } = require("./buildMlbDisplayBundle")

let normPlayer
try {
  normPlayer = require("../../storage/intelligence").normPlayer
} catch (_) {
  normPlayer = (s) => String(s || "").toLowerCase().trim()
}

const BACKEND_ROOT = path.join(__dirname, "..", "..")
const DATA_DIR = path.join(BACKEND_ROOT, "data")

function loadJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch (_) { return null }
}

// ── lazy caches (built once per process; cheap file reads) ──────────────────
let _snapIdx = null, _batStats = null, _pitStats = null, _pitLogs = null, _leagueKPct = null

function snapIdx() {
  if (_snapIdx) return _snapIdx
  _snapIdx = new Map()
  const wrap = loadJsonSafe(path.join(BACKEND_ROOT, "snapshot-mlb.json"))
  const rows = (wrap && wrap.data && (wrap.data.rows || wrap.data.props)) || []
  for (const r of rows) {
    if (!r || !r.player) continue
    const k = normPlayer(r.player)
    if (!k) continue
    // keep the most context-rich row per player (pitcher-env + park + weather)
    const score = (r.pitcherEnvironmentContext ? 1 : 0) + (r.parkContext ? 1 : 0) + (r.weatherContext ? 1 : 0)
    const prev = _snapIdx.get(k)
    const prevScore = prev ? (prev.pitcherEnvironmentContext ? 1 : 0) + (prev.parkContext ? 1 : 0) + (prev.weatherContext ? 1 : 0) : -1
    if (score > prevScore) _snapIdx.set(k, r)
  }
  return _snapIdx
}
function batStats() { if (!_batStats) _batStats = loadJsonSafe(path.join(DATA_DIR, "mlbBatterStats.json")) || {}; return _batStats }
function pitStats() { if (!_pitStats) _pitStats = loadJsonSafe(path.join(DATA_DIR, "mlbPitcherStats.json")) || {}; return _pitStats }
function pitLogs() {
  if (!_pitLogs) {
    const w = loadJsonSafe(path.join(DATA_DIR, "mlbPitcherGameLogs.json"))
    _pitLogs = (w && w.players) || {}
  }
  return _pitLogs
}

const num = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null }
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
function pruneNull(obj) {
  if (!obj || typeof obj !== "object") return null
  const out = {}
  for (const [k, v] of Object.entries(obj)) { if (v === null || v === undefined) continue; out[k] = v }
  return Object.keys(out).length ? out : null
}

// League-average batter K% (real, from cache) — the helps/hurts baseline.
function leagueKPct() {
  if (_leagueKPct !== null) return _leagueKPct
  const bs = batStats()
  const ks = []
  for (const k of Object.keys(bs)) { const v = num(bs[k] && bs[k].kRate); if (v != null) ks.push(v) }
  _leagueKPct = ks.length ? avg(ks) : null
  return _leagueKPct
}

function isPitcherKFamily(fam) {
  const f = String(fam || "").toLowerCase()
  return /strikeout/.test(f) || /(^|[^a-z])ks([^a-z]|$)/.test(f) || f === "ks"
}

// opponent team for a pitcher pick = the matchup team that isn't the pitcher's team.
function pitcherOppTeam(pick, key) {
  const st = pitStats()[key]
  const myTeam = st && st.teamName ? String(st.teamName) : (pick.team ? String(pick.team) : null)
  const m = String(pick.matchup || "")
  const parts = m.split(/\s+@\s+/).map((s) => s.trim()).filter(Boolean)
  if (parts.length !== 2) return null
  if (!myTeam) return null
  return parts.find((t) => t !== myTeam) || null
}

// opponent-lineup K% = avg of the opposing team's cached batter kRates. Omit (null)
// when the team isn't cached or the sample is too thin to be meaningful.
function deriveOppLineupKPct(oppTeam) {
  if (!oppTeam) return null
  const bs = batStats()
  const ks = []
  for (const k of Object.keys(bs)) {
    const b = bs[k]
    if (b && b.teamName === oppTeam) { const v = num(b.kRate); if (v != null) ks.push(v) }
  }
  if (ks.length < 5) return null // too thin → omit, never fabricate
  return { kPct: avg(ks), n: ks.length }
}

// ── BATTER bundle — reuse buildMlbDisplayBundle on the snapshot row + season line.
function assembleBatterBundle(pick) {
  const key = normPlayer(pick.player)
  if (!key) return null
  const snap = snapIdx().get(key) || null
  const bs = batStats()[key] || null
  // Build a row buildMlbDisplayBundle understands. It reads pitcherEnvironmentContext,
  // parkContext, weatherContext, isPlatoonAdvantage/batterHand/pitcherHand (from snap),
  // batterStats (season line), and getBatterForm(player) internally.
  const row = { ...(snap || {}), player: pick.player }
  if (bs) {
    row.batterStats = pruneNull({
      avg: num(bs.avg), obp: num(bs.obp), slg: num(bs.slg), ops: num(bs.ops),
      iso: num(bs.iso), kRate: num(bs.kRate), hrRate: num(bs.hrRate), batSide: bs.batSide ?? null,
    })
  }
  // Nothing real to say? bail (omit-not-fabricate).
  const bundle = buildMlbDisplayBundle(row)
  if (!bundle || !bundle.statBacking) return null
  return bundle
}

// ── PITCHER (Ks) bundle — pitcher-shaped statBacking + its own signalsTable.
function assemblePitcherBundle(pick) {
  const key = normPlayer(pick.player)
  if (!key) return null

  // recent Ks from game logs
  const log = pitLogs()[key]
  const starts = Array.isArray(log) ? log : (log && (log.starts || log.logs)) || []
  const ks = starts.map((s) => num((s.stats || s).strikeOuts)).filter((x) => x != null)
  const recentKs = ks.length
    ? pruneNull({ l5: avg(ks.slice(-5)), l15: avg(ks.slice(-15)), values: ks.slice(-5), starts: ks.length })
    : null

  // season rates derived from raw season stats
  const st = pitStats()[key]
  let season = null
  if (st) {
    const so = num(st.strikeOuts), bf = num(st.battersFaced), ip = num(st.inningsPitched)
    const gs = num(st.gamesStarted), h = num(st.hits), bb = num(st.walks)
    season = pruneNull({
      kPct: (so != null && bf) ? so / bf : null,
      k9: (so != null && ip) ? (so * 9) / ip : null,
      whip: (h != null && bb != null && ip) ? (h + bb) / ip : null,
      ipPerStart: (ip != null && gs) ? ip / gs : null,
      gs, ip,
    })
  }

  const oppTeam = pitcherOppTeam(pick, key)
  const opp = deriveOppLineupKPct(oppTeam)

  const pitcher = pruneNull({
    recentKs,
    season,
    oppLineupKPct: opp ? opp.kPct : null,
    oppLineupN: opp ? opp.n : null,
    oppTeam: opp ? oppTeam : null,
    leagueAvgKPct: opp ? leagueKPct() : null,
  })
  if (!pitcher) return null
  const statBacking = { pitcher }

  // ── signalsTable (same flat {label,value} shape the FE renderCard renders) ──
  const signalsTable = []
  if (recentKs && recentKs.l5 != null) {
    const lbl = `L${Math.min(5, recentKs.starts)}`
    const vals = recentKs.values && recentKs.values.length ? ` (${recentKs.values.join(", ")})` : ""
    signalsTable.push({ label: "Recent Ks", value: `${lbl} avg ${recentKs.l5.toFixed(1)}/start${vals}` })
  }
  if (season) {
    const bits = []
    if (season.kPct != null) bits.push(`${Math.round(season.kPct * 100)}% K`)
    if (season.k9 != null) bits.push(`${season.k9.toFixed(1)} K/9`)
    if (season.whip != null) bits.push(`${season.whip.toFixed(2)} WHIP`)
    if (bits.length) signalsTable.push({ label: "Season", value: bits.join(" · ") })
  }
  if (season && season.ipPerStart != null) {
    signalsTable.push({ label: "Workload", value: `${season.ipPerStart.toFixed(1)} IP/start${season.gs != null ? ` (${season.gs} GS)` : ""}` })
  }
  if (pitcher.oppLineupKPct != null) {
    const la = pitcher.leagueAvgKPct
    const read = la != null ? (pitcher.oppLineupKPct >= la + 0.02 ? " — whiff-prone, helps" : (pitcher.oppLineupKPct <= la - 0.02 ? " — contact lineup, hurts" : "")) : ""
    signalsTable.push({ label: "Opp lineup", value: `${Math.round(pitcher.oppLineupKPct * 100)}% K${read}` })
  }

  return {
    _version: "mlb-pitcher-v1",
    statBacking,
    ...(signalsTable.length ? { signalsTable } : {}),
    notWired: { liveNews: "not_wired" },
  }
}

/**
 * Assemble a prop-specific displayBundle for one MLB pick. Returns null when there
 * is nothing real to show (omit-not-fabricate).
 * @param {object} pick — tracked_bets-shaped pick (player, statFamily/propType, matchup, team…)
 */
function assembleMlbPickDisplayBundle(pick) {
  if (!pick || String(pick.sport || "").toLowerCase() !== "mlb") return null
  const fam = pick.statFamily || pick.propType
  try {
    return isPitcherKFamily(fam) ? assemblePitcherBundle(pick) : assembleBatterBundle(pick)
  } catch (_) {
    return null
  }
}

// test seam — allow probes to reset the lazy caches between fixture loads
function _resetCaches() { _snapIdx = _batStats = _pitStats = _pitLogs = null; _leagueKPct = null }

module.exports = { assembleMlbPickDisplayBundle, isPitcherKFamily, _resetCaches }
