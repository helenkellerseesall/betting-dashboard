"use strict"

/**
 * buildPlayDisplayBundle — CANONICAL display payload for NBA play cards.
 *
 * 2026-05-24 — Created to eliminate shadow authority between backend tag logic
 * (pregameContext) and the duplicate NBA tag emitter in frontend/mobile/index.html.
 *
 * Single source of truth. Stamp this onto every NBA play during board build.
 * The FE consumes `play.displayBundle` as-is — no recomputation, no per-card
 * field inspection, no parallel tag formulas.
 *
 * Output shape:
 *   {
 *     tier:            "PLAYABLE",
 *     headlineText:    "Wembanyama OVER pts 20.5",
 *     tags:            ["every-game starter", "FG: 8/15.3 (52%)", ...],
 *     signalsTable:    [{label: "matchup", value: "OKC @ SAS"}, ...],
 *     reasoning:       "...",
 *   }
 *
 * Tags are PROP-AWARE — a points prop surfaces FG/3P/FT volume, a rebounds prop
 * surfaces OR/DR/rebRate, a threes prop surfaces 3PM trend. Numbers are
 * pre-rounded at this layer; the FE never formats numbers.
 */

// ── helpers ────────────────────────────────────────────────────────────────

function n1(v) {
  const x = Number(v)
  if (!Number.isFinite(x)) return null
  return Math.round(x * 10) / 10
}
function n0(v) {
  const x = Number(v)
  if (!Number.isFinite(x)) return null
  return Math.round(x)
}
function pct(v) {
  const x = Number(v)
  if (!Number.isFinite(x)) return null
  // accept either 0..1 or 0..100
  const norm = x <= 1.5 ? x * 100 : x
  return Math.round(norm)
}
function isNum(v) { return typeof v === "number" && Number.isFinite(v) }
function lastTokenOf(s) {
  const tokens = String(s || "").trim().split(/\s+/)
  return tokens[tokens.length - 1] || String(s || "").trim()
}

// 2026-05-25 — Team abbreviation map for condensed FE labels. Operator wants
// "v AVG D (CLE 113 ppg)" instead of "vs avg D (Cavaliers 113 ppg)" etc.
const TEAM_ABBR = {
  "atlanta hawks": "ATL", "boston celtics": "BOS", "brooklyn nets": "BKN",
  "charlotte hornets": "CHA", "chicago bulls": "CHI", "cleveland cavaliers": "CLE",
  "dallas mavericks": "DAL", "denver nuggets": "DEN", "detroit pistons": "DET",
  "golden state warriors": "GSW", "houston rockets": "HOU", "indiana pacers": "IND",
  "la clippers": "LAC", "los angeles clippers": "LAC",
  "los angeles lakers": "LAL", "la lakers": "LAL",
  "memphis grizzlies": "MEM", "miami heat": "MIA", "milwaukee bucks": "MIL",
  "minnesota timberwolves": "MIN", "new orleans pelicans": "NOP",
  "new york knicks": "NYK", "oklahoma city thunder": "OKC",
  "orlando magic": "ORL", "philadelphia 76ers": "PHI", "phoenix suns": "PHX",
  "portland trail blazers": "POR", "sacramento kings": "SAC",
  "san antonio spurs": "SAS", "toronto raptors": "TOR",
  "utah jazz": "UTA", "washington wizards": "WAS",
  // Also accept nickname-only matches (last token fallback)
  "hawks":"ATL","celtics":"BOS","nets":"BKN","hornets":"CHA","bulls":"CHI",
  "cavaliers":"CLE","cavs":"CLE","mavericks":"DAL","mavs":"DAL","nuggets":"DEN",
  "pistons":"DET","warriors":"GSW","rockets":"HOU","pacers":"IND","clippers":"LAC",
  "lakers":"LAL","grizzlies":"MEM","heat":"MIA","bucks":"MIL","timberwolves":"MIN",
  "wolves":"MIN","pelicans":"NOP","knicks":"NYK","thunder":"OKC","magic":"ORL",
  "76ers":"PHI","sixers":"PHI","suns":"PHX","blazers":"POR","trail blazers":"POR",
  "kings":"SAC","spurs":"SAS","raptors":"TOR","jazz":"UTA","wizards":"WAS",
}
function teamAbbr(s) {
  if (!s) return null
  const raw = String(s).trim()
  if (!raw) return null
  // Already an abbreviation?
  if (raw.length <= 4 && raw === raw.toUpperCase()) return raw
  const lower = raw.toLowerCase()
  if (TEAM_ABBR[lower]) return TEAM_ABBR[lower]
  // Try last token (e.g. "New York Knicks" -> "knicks")
  const tokens = lower.split(/\s+/)
  const last = tokens[tokens.length - 1]
  if (TEAM_ABBR[last]) return TEAM_ABBR[last]
  return raw.length <= 4 ? raw.toUpperCase() : null
}
function matchupAbbr(play) {
  // Build "NYK @ CLE" style from awayTeam / homeTeam if present, else from matchup string
  const away = teamAbbr(play?.awayTeam)
  const home = teamAbbr(play?.homeTeam)
  if (away && home) return `${away} @ ${home}`
  const m = String(play?.matchup || "")
  if (m.includes("@")) {
    const parts = m.split("@").map(p => teamAbbr(p) || p.trim())
    return parts.join(" @ ")
  }
  return m || null
}

// 2026-05-25 — Honest window labels (Path A). Our "season pts: 14.9/g" was
// actually a 21-day rolling window, not a real season average. KAT showed 14.9
// while DraftKings showed his real season PPG at 19.5 — operator caught this.
// Now: every "season X" label becomes "lastNg X" where N is the actual
// gamesPlayed count from the cache. When operator extends the populator to
// 90 days (Path B), N grows and the average converges to the real season number.
function windowLabel(playerSeasonStats) {
  const n = Number(playerSeasonStats && playerSeasonStats.gamesPlayed)
  if (Number.isFinite(n) && n > 0) return `L${n}`
  return "recent"
}

function statFamilyKey(play) {
  const sf = String(play?.statFamily || "").toLowerCase()
  if (sf) return sf
  const t = String(play?.propType || play?.marketKey || "").toLowerCase()
  // 2026-05-25 — Combo-prop fix. Order MUST be: triple-combos → two-stat
  // combos → singles. "Points + Rebounds" propType was matching /rebound/
  // → rebounds family. Now route two-stat combos to "pra" so signals
  // table shows P/R/A split (matches how the math treats them).
  if (/pra|points.*rebounds.*assists|pts.*reb.*ast/.test(t)) return "pra"
  if (/points.*rebounds|points\s*\+\s*rebounds/.test(t)) return "pra"
  if (/points.*assists|points\s*\+\s*assists/.test(t)) return "pra"
  if (/rebounds.*assists|rebounds\s*\+\s*assists/.test(t)) return "pra"
  if (/three|3pt|3pm/.test(t)) return "threes"
  if (/rebound/.test(t)) return "rebounds"
  if (/assist/.test(t)) return "assists"
  if (/point/.test(t)) return "points"
  if (/first.*basket/.test(t)) return "first_basket"
  return "other"
}

function realRecentForm(play) {
  const rf = play?.recentForm
  if (!rf || typeof rf !== "object") return null
  const src = String(rf.source || "").toLowerCase()
  // 2026-05-24 — Reject projection-fallback: its last5_avg is synthesized
  // from the line itself, which makes the form-contradiction gate impotent
  // AND would put misleading "last 5 avg: 20.5" tags on cards where the
  // engine has no real signal. Only treat ESPN / api-sports / disk-real
  // sources as truthful.
  if (src === "projection-fallback") return null
  const last5 = Number(rf.last5_avg)
  const last10 = Number(rf.last10_avg)
  if (!Number.isFinite(last5) && !Number.isFinite(last10)) return null
  return rf
}

// ── tag emitters per prop family ───────────────────────────────────────────

function commonRoleTags(play, tags) {
  // 2026-05-25 — Operator-requested condensed labels.
  // Starter / role
  const starterRate = play?.roleContext?.starter_rate_recent
  if (play.starterFlag === 1 || starterRate === 1) {
    tags.push("STARTER")
  } else if (play.starterFlag === 0) {
    tags.push("BENCH")
  }
  const roleChange = play?.roleContext?.role_change
  if (roleChange === "promoted") tags.push("promoted")
  else if (roleChange === "demoted") tags.push("demoted")

  // Projected minutes
  const pm = Number(play.projectedMinutes)
  if (Number.isFinite(pm)) {
    if (pm >= 32) tags.push(`${n0(pm)}+ min`)
    else if (pm < 22) tags.push(`${n0(pm)} min (low)`)
  } else {
    const recMin = Number(play?.roleContext?.minutes_avg_recent)
    if (Number.isFinite(recMin)) {
      if (recMin >= 32) tags.push(`${n0(recMin)}+ min`)
      else if (recMin < 22) tags.push(`${n0(recMin)} min (low)`)
    }
  }
  const minTrend = Number(play?.roleContext?.minutes_trend)
  if (Number.isFinite(minTrend)) {
    if (minTrend >= 3) tags.push("MINS ↑")
    else if (minTrend <= -3) tags.push("MINS ↓")
  }
}

function opponentTags(play, tags, family) {
  const oppDef = Number(play.oppDef)
  const oppCode = teamAbbr(play.opponent) || lastTokenOf(play.opponent || "OPP")
  const oppStats = play.opponentStats || {}

  // 2026-05-26 — Family-specific opponent dimension.
  // For prop families where we have direct opp-allowed data (rebounds/assists/
  // threes), show THAT instead of the generic PPG-allowed. Generic PPG is
  // wrong dimension for these props — opp 12.5 3PM/g is the actual defensive
  // context for a threes pick, not opp 108 ppg. Operator-flagged 2026-05-26.
  //
  // For families WITHOUT a family-specific dim (points / pra / dd / td /
  // first_basket / steals / blocks), keep the generic PPG tag — it's the
  // best defensive signal we have for those.
  const hasFamilySpecific =
    (family === "rebounds" && isNum(Number(oppStats.reboundsAllowed))) ||
    (family === "assists"  && isNum(Number(oppStats.assistsAllowed))) ||
    (family === "threes"   && isNum(Number(oppStats.threePMAllowed)))

  if (hasFamilySpecific) {
    // Family-specific opp-allowed REPLACES generic PPG tag for this prop.
    if (family === "rebounds") {
      tags.push(`${oppCode} allows ${n1(oppStats.reboundsAllowed)} reb/g`)
    } else if (family === "assists") {
      tags.push(`${oppCode} allows ${n1(oppStats.assistsAllowed)} ast/g`)
    } else if (family === "threes") {
      tags.push(`${oppCode} allows ${n1(oppStats.threePMAllowed)} 3PM/g`)
    }
  } else if (Number.isFinite(oppDef)) {
    // Generic PPG tag — correct dimension for points / pra / dd / td.
    if (oppDef <= 108)      tags.push(`v STRONG D (${oppCode} ${n0(oppDef)} ppg)`)
    else if (oppDef >= 117) tags.push(`v WEAK D (${oppCode} ${n0(oppDef)} ppg)`)
    else                    tags.push(`v AVG D (${oppCode} ${n0(oppDef)} ppg)`)
  }
}

function paceTag(play, tags) {
  const pace = Number(play.pace)
  if (Number.isFinite(pace) && pace !== 100) {
    if (pace >= 103) tags.push(`fast-paced game (${n0(pace)})`)
    else if (pace <= 97) tags.push(`slow-paced game (${n0(pace)})`)
  }
}

function recentFormTag(play, tags, family) {
  const rf = realRecentForm(play)
  if (!rf) return
  const last5 = Number(rf.last5_avg)
  const last10 = Number(rf.last10_avg)
  if (Number.isFinite(last5)) tags.push(`L5: ${n1(last5)}`)
  if (Number.isFinite(last10) && Number.isFinite(last5) && Math.abs(last10 - last5) >= 1) {
    tags.push(`L10: ${n1(last10)}`)
  }
}

function pointsTags(play, tags) {
  const s = play.playerSeasonStats || {}
  // FG line — most informative single tag for a points bet
  const avgFgm = Number(s.avgFgm)
  const avgFga = Number(s.avgFga)
  if (Number.isFinite(avgFga)) {
    if (Number.isFinite(avgFgm)) {
      const pctVal = avgFga > 0 ? Math.round((avgFgm / avgFga) * 100) : null
      tags.push(`FG: ${n1(avgFgm)} / ${n1(avgFga)}${pctVal != null ? ` (${pctVal}%)` : ""}`)
    } else {
      tags.push(`FG: ${n1(avgFga)} att/g`)
    }
  }
  // 3P — points scorers live and die on 3PT efficiency
  const avgThrees = Number(s.avgThrees)
  const avgThreeAtt = Number(s.avgThreeAtt ?? s.avg3pa ?? s.threePAttempts)
  if (Number.isFinite(avgThrees)) {
    if (Number.isFinite(avgThreeAtt)) {
      const pctVal = avgThreeAtt > 0 ? Math.round((avgThrees / avgThreeAtt) * 100) : null
      tags.push(`3P: ${n1(avgThrees)} / ${n1(avgThreeAtt)}${pctVal != null ? ` (${pctVal}%)` : ""}`)
    } else {
      tags.push(`3PM: ${n1(avgThrees)}/g`)
    }
  }
  // FT — high FT volume = 2-3 pts of safe floor
  const avgFtm = Number(s.avgFtm)
  const avgFta = Number(s.avgFta)
  if (Number.isFinite(avgFta)) {
    if (Number.isFinite(avgFtm)) {
      const pctVal = avgFta > 0 ? Math.round((avgFtm / avgFta) * 100) : null
      tags.push(`FT: ${n1(avgFtm)} / ${n1(avgFta)}${pctVal != null ? ` (${pctVal}%)` : ""}`)
    } else if (avgFta >= 4) {
      tags.push(`FT volume: ${n1(avgFta)} att/g`)
    }
  }
  // Window-anchored points avg (NOT "season" — see windowLabel comment).
  const avgPts = Number(s.avgPoints)
  if (Number.isFinite(avgPts)) tags.push(`${windowLabel(s)} pts: ${n1(avgPts)}/g`)
  // Turnover risk
  const toRate = Number(play.toRate)
  if (Number.isFinite(toRate) && toRate >= 0.18) tags.push("turnover risk")
}

function reboundsTags(play, tags) {
  const s = play.playerSeasonStats || {}
  const avgReb = Number(s.avgRebounds)
  const avgOR = Number(s.avgOffRebounds)
  const avgDR = Number(s.avgDefRebounds)
  if (Number.isFinite(avgReb)) tags.push(`${windowLabel(s)} reb: ${n1(avgReb)}/g`)
  if (Number.isFinite(avgOR) && Number.isFinite(avgDR)) {
    tags.push(`OR/DR split: ${n1(avgOR)} / ${n1(avgDR)}`)
  } else if (Number.isFinite(avgOR)) {
    tags.push(`OR: ${n1(avgOR)}/g`)
  }
  const rebRate = Number(play.rebRate)
  if (Number.isFinite(rebRate)) {
    if (rebRate >= 0.22) tags.push(`elite rebounder (${pct(rebRate)}% reb rate)`)
    else if (rebRate >= 0.15) tags.push(`${pct(rebRate)}% reb rate`)
  }
}

function threesTags(play, tags) {
  const s = play.playerSeasonStats || {}
  const avgThrees = Number(s.avgThrees)
  const avgThreeAtt = Number(s.avgThreeAtt ?? s.avg3pa ?? s.threePAttempts)
  if (Number.isFinite(avgThrees)) tags.push(`${windowLabel(s)} 3PM: ${n1(avgThrees)}/g`)
  if (Number.isFinite(avgThreeAtt)) {
    tags.push(`3PA: ${n1(avgThreeAtt)}/g`)
    if (Number.isFinite(avgThrees) && avgThreeAtt > 0) {
      tags.push(`3P%: ${Math.round((avgThrees / avgThreeAtt) * 100)}%`)
    }
  }
  // Recent threes trend
  const rf = realRecentForm(play)
  if (rf) {
    const last5 = Number(rf.last5_avg)
    if (Number.isFinite(last5)) tags.push(`L5 3PM: ${n1(last5)}`)
  }
}

function assistsTags(play, tags) {
  const s = play.playerSeasonStats || {}
  const avgAst = Number(s.avgAssists)
  if (Number.isFinite(avgAst)) tags.push(`${windowLabel(s)} ast: ${n1(avgAst)}/g`)
  const astRate = Number(play.astRate)
  if (Number.isFinite(astRate)) {
    if (astRate >= 0.28) tags.push(`primary creator (${pct(astRate)}% ast rate)`)
    else tags.push(`${pct(astRate)}% ast rate`)
  }
  const toRate = Number(play.toRate)
  if (Number.isFinite(toRate) && toRate >= 0.18) tags.push("turnover risk")
}

function praTags(play, tags) {
  const s = play.playerSeasonStats || {}
  const p = Number(s.avgPoints)
  const r = Number(s.avgRebounds)
  const a = Number(s.avgAssists)
  if (Number.isFinite(p) && Number.isFinite(r) && Number.isFinite(a)) {
    tags.push(`P/R/A: ${n1(p)} / ${n1(r)} / ${n1(a)}`)
    tags.push(`${windowLabel(s)} PRA: ${n1(p + r + a)}/g`)
  }
  // Projection range
  const range = play.range || {}
  if (isNum(range.floor) && isNum(range.ceiling)) {
    tags.push(`proj range: ${n1(range.floor)}–${n1(range.ceiling)}`)
  }
}

function firstBasketTags(play, tags) {
  if (play.starterFlag === 1) tags.push("opening lineup")
  const s = play.playerSeasonStats || {}
  const usage = Number(play.usageRate ?? s.usageRate)
  if (Number.isFinite(usage)) tags.push(`${pct(usage)}% usage`)
  const avgPts = Number(s.avgPoints)
  if (Number.isFinite(avgPts)) tags.push(`${windowLabel(s)} pts: ${n1(avgPts)}/g`)
}

// 2026-05-26 — Lane A1: Binary-event tags. Hit-rate is the signal that drives
// modelProb for DD/TD, so the card shows the same numbers — no fabrication,
// just the basis for the probability the bettor sees.
function doubleDoubleTags(play, tags) {
  const hr5  = Number(play.ddHitRateL5)
  const hr10 = Number(play.ddHitRateL10)
  const s5   = Number(play.ddSampleL5)
  const s10  = Number(play.ddSampleL10)
  if (Number.isFinite(hr5) && Number.isFinite(s5) && s5 > 0) {
    const hits = Math.round(hr5 * s5)
    tags.push(`DD last 5: ${hits}/${s5}`)
  }
  if (Number.isFinite(hr10) && Number.isFinite(s10) && s10 > 0) {
    tags.push(`L10 DD rate: ${pct(hr10)}%`)
  }
  if (play.starterFlag === 1) tags.push("starter")
}

function tripleDoubleTags(play, tags) {
  const hr5  = Number(play.tdHitRateL5)
  const hr10 = Number(play.tdHitRateL10)
  const s5   = Number(play.tdSampleL5)
  const s10  = Number(play.tdSampleL10)
  if (Number.isFinite(hr5) && Number.isFinite(s5) && s5 > 0) {
    const hits = Math.round(hr5 * s5)
    tags.push(`TD last 5: ${hits}/${s5}`)
  }
  if (Number.isFinite(hr10) && Number.isFinite(s10) && s10 > 0) {
    tags.push(`L10 TD rate: ${pct(hr10)}%`)
  }
  // Helpful context for TD — rare event, knowing it's happened recently matters
  const seasonRate = Number(play.tdHitRateSeason)
  if (Number.isFinite(seasonRate) && seasonRate > 0.1) {
    tags.push(`season TD rate: ${pct(seasonRate)}%`)
  }
}

// ── signals table builder ──────────────────────────────────────────────────

function buildSignalsTable(play, family) {
  const rows = []
  const seen = new Set()
  const push = (label, value) => {
    if (value === null || value === undefined || value === "") return
    // 2026-05-25 — Dedupe: operator caught MATCHUP / MODEL PROB / EDGE PROB
    // being listed 2x in the signals panel (top section + legacy fallback).
    // Reject any label collision so each row shows exactly once.
    const key = String(label).toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    rows.push({ label, value: String(value) })
  }
  // 2026-05-25 — Operator-condensed: matchup abbreviated "NYK @ CLE",
  // opponent abbreviated "CLE".
  const matchupShort = matchupAbbr(play)
  push("matchup", matchupShort)
  push("opponent", teamAbbr(play.opponent) || play.opponent)
  push("book", play.sportsbook)
  if (isNum(play.modelProb)) push("model prob", play.modelProb.toFixed(4))
  if (isNum(play.edge))      push("edge prob", play.edge.toFixed(4))
  if (isNum(play.confidence)) push("confidence", n1(play.confidence * 100) + "%")
  if (isNum(play.oppDef))    push("opp PPG allowed", n1(play.oppDef))
  if (isNum(play.pace))      push("pace", n0(play.pace))

  const rf = realRecentForm(play)
  if (rf) {
    if (isNum(Number(rf.last5_avg)))  push("L5", n1(rf.last5_avg))
    if (isNum(Number(rf.last10_avg))) push("L10", n1(rf.last10_avg))
    if (rf.sample_count != null) push("games sampled", rf.sample_count)
    if (rf.source) push("source", rf.source)
  }

  const s = play.playerSeasonStats || {}
  // 2026-05-25 — Honest window labels. "season X/g" was misleading (it was
  // a 21-day rolling avg, not season). Now: "lastNg X/g" where N is real
  // sample count. After Path B (populator extended to 90d), N grows toward
  // true season scale.
  const wl = windowLabel(s)
  if (isNum(Number(s.avgMinutes))) push(`${wl} minutes`, n1(s.avgMinutes))
  if (family === "points") {
    if (isNum(Number(s.avgPoints))) push(`${wl} pts/g`, n1(s.avgPoints))
    if (isNum(Number(s.avgFga)))    push(`${wl} FGA/g`, n1(s.avgFga))
    if (isNum(Number(s.avgFgm)))    push(`${wl} FGM/g`, n1(s.avgFgm))
    if (isNum(Number(s.avgThrees))) push(`${wl} 3PM/g`, n1(s.avgThrees))
    if (isNum(Number(s.avgFta)))    push(`${wl} FTA/g`, n1(s.avgFta))
    if (isNum(Number(s.avgFtm)))    push(`${wl} FTM/g`, n1(s.avgFtm))
  } else if (family === "rebounds") {
    if (isNum(Number(s.avgRebounds)))   push(`${wl} reb/g`, n1(s.avgRebounds))
    if (isNum(Number(s.avgOffRebounds))) push(`${wl} OR/g`, n1(s.avgOffRebounds))
    if (isNum(Number(s.avgDefRebounds))) push(`${wl} DR/g`, n1(s.avgDefRebounds))
    if (isNum(play.rebRate)) push("reb rate", pct(play.rebRate) + "%")
  } else if (family === "threes") {
    if (isNum(Number(s.avgThrees))) push(`${wl} 3PM/g`, n1(s.avgThrees))
    const att = Number(s.avgThreeAtt ?? s.threePAttempts)
    if (Number.isFinite(att)) push(`${wl} 3PA/g`, n1(att))
  } else if (family === "assists") {
    if (isNum(Number(s.avgAssists))) push(`${wl} ast/g`, n1(s.avgAssists))
    if (isNum(play.astRate)) push("ast rate", pct(play.astRate) + "%")
  } else if (family === "pra") {
    if (isNum(Number(s.avgPoints)))   push(`${wl} pts/g`, n1(s.avgPoints))
    if (isNum(Number(s.avgRebounds))) push(`${wl} reb/g`, n1(s.avgRebounds))
    if (isNum(Number(s.avgAssists)))  push(`${wl} ast/g`, n1(s.avgAssists))
  }
  const range = play.range || {}
  if (isNum(range.floor))      push("projection floor", n1(range.floor))
  if (isNum(range.mostLikely)) push("projection most likely", n1(range.mostLikely))
  if (isNum(range.ceiling))    push("projection ceiling", n1(range.ceiling))

  return rows
}

// ── reasoning ──────────────────────────────────────────────────────────────

function buildReasoning(play, family) {
  const parts = []
  const sideStr = String(play.side || "").toUpperCase()
  const rf = realRecentForm(play)
  const last5 = rf ? Number(rf.last5_avg) : null
  const range = play.range || {}
  const proj = isNum(range.mostLikely) ? n1(range.mostLikely) : null
  if (proj != null && isNum(play.line)) {
    parts.push(`projects ${proj} vs line ${play.line}`)
  }
  if (last5 != null) parts.push(`L5 ${family}: ${n1(last5)}`)
  if (isNum(play.oppDef)) parts.push(`vs ${lastTokenOf(play.opponent || "opp")} ${n0(play.oppDef)} ppg D`)
  if (isNum(play.pace) && play.pace !== 100) parts.push(`pace ${n0(play.pace)}`)
  if (isNum(play.edge)) parts.push(`edge ${(play.edge * 100).toFixed(1)}%`)
  return `${sideStr} ${family}: ${parts.join(" • ")}`
}

// ── main ───────────────────────────────────────────────────────────────────

function buildPlayDisplayBundle(play) {
  if (!play || typeof play !== "object") return null
  const family = statFamilyKey(play)
  const tags = []

  // Role / minutes — common across all prop families
  commonRoleTags(play, tags)

  // Recent form — only if real (rejects projection-fallback)
  recentFormTag(play, tags, family)

  // Opponent defense + pace
  opponentTags(play, tags, family)
  paceTag(play, tags)

  // Prop-aware stat tags
  switch (family) {
    case "points":         pointsTags(play, tags); break
    case "rebounds":       reboundsTags(play, tags); break
    case "threes":         threesTags(play, tags); break
    case "assists":        assistsTags(play, tags); break
    case "pra":            praTags(play, tags); break
    case "first_basket":   firstBasketTags(play, tags); break
    case "double_double":  doubleDoubleTags(play, tags); break
    case "triple_double":  tripleDoubleTags(play, tags); break
    default: break
  }

  // Deduplicate while preserving order
  const seen = new Set()
  const dedupedTags = []
  for (const t of tags) {
    if (!t) continue
    const k = String(t).toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    dedupedTags.push(String(t))
  }

  const propLabel = String(play.propType || family || "prop")
  const sideStr = String(play.side || "").toUpperCase()
  const headlineText = `${play.player || ""} ${sideStr} ${propLabel} ${play.line ?? ""}`.trim()

  return {
    tier: play.tier || null,
    headlineText,
    tags: dedupedTags,
    signalsTable: buildSignalsTable(play, family),
    reasoning: buildReasoning(play, family),
  }
}

module.exports = { buildPlayDisplayBundle }
