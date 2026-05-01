"use strict"

/**
 * Lightweight matchup layer: static-ish defense profiles by team + pace/total from row.
 * Used only as a small finalWeight multiplier (see computeFinalWeight).
 */

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clamp(min, max, v) {
  return Math.max(min, Math.min(max, v))
}

/** Defensive strength vs archetype / stat lane: higher = tougher on offense (suppress props). Range about ±0.28. */
const DEFENSE_BY_ABBR = {
  ATL: { vsGuard: 0.02, vsWing: -0.08, vsBig: 0.06, vsScorer: -0.04, vsPlaymaker: 0.10, vsGlass: 0.05, vsPerimeter: -0.02 },
  BOS: { vsGuard: 0.14, vsWing: 0.12, vsBig: 0.10, vsScorer: 0.16, vsPlaymaker: 0.08, vsGlass: 0.12, vsPerimeter: 0.18 },
  BKN: { vsGuard: -0.10, vsWing: -0.06, vsBig: -0.12, vsScorer: -0.08, vsPlaymaker: -0.14, vsGlass: -0.10, vsPerimeter: -0.04 },
  CHA: { vsGuard: -0.04, vsWing: 0.02, vsBig: -0.08, vsScorer: 0.02, vsPlaymaker: -0.06, vsGlass: -0.04, vsPerimeter: 0.06 },
  CHI: { vsGuard: 0.06, vsWing: 0.04, vsBig: 0.08, vsScorer: 0.05, vsPlaymaker: 0.02, vsGlass: 0.10, vsPerimeter: 0.04 },
  CLE: { vsGuard: 0.10, vsWing: 0.14, vsBig: 0.12, vsScorer: 0.12, vsPlaymaker: 0.06, vsGlass: 0.14, vsPerimeter: 0.10 },
  DAL: { vsGuard: 0.04, vsWing: 0.02, vsBig: -0.02, vsScorer: 0.06, vsPlaymaker: 0.08, vsGlass: 0.04, vsPerimeter: 0.12 },
  DEN: { vsGuard: 0.02, vsWing: 0.06, vsBig: 0.14, vsScorer: 0.04, vsPlaymaker: 0.04, vsGlass: 0.16, vsPerimeter: 0.06 },
  DET: { vsGuard: -0.12, vsWing: -0.08, vsBig: -0.14, vsScorer: -0.10, vsPlaymaker: -0.16, vsGlass: -0.12, vsPerimeter: -0.10 },
  GSW: { vsGuard: 0.08, vsWing: 0.06, vsBig: 0.04, vsScorer: 0.10, vsPlaymaker: 0.12, vsGlass: 0.06, vsPerimeter: 0.14 },
  HOU: { vsGuard: -0.06, vsWing: -0.10, vsBig: -0.04, vsScorer: -0.08, vsPlaymaker: -0.12, vsGlass: -0.06, vsPerimeter: -0.14 },
  IND: { vsGuard: 0.06, vsWing: 0.08, vsBig: 0.04, vsScorer: 0.04, vsPlaymaker: 0.10, vsGlass: 0.12, vsPerimeter: 0.08 },
  LAC: { vsGuard: 0.12, vsWing: 0.10, vsBig: 0.08, vsScorer: 0.10, vsPlaymaker: 0.08, vsGlass: 0.10, vsPerimeter: 0.14 },
  LAL: { vsGuard: 0.04, vsWing: 0.08, vsBig: 0.12, vsScorer: 0.06, vsPlaymaker: 0.04, vsGlass: 0.14, vsPerimeter: 0.06 },
  MEM: { vsGuard: 0.14, vsWing: 0.10, vsBig: 0.08, vsScorer: 0.12, vsPlaymaker: 0.14, vsGlass: 0.10, vsPerimeter: 0.12 },
  MIA: { vsGuard: 0.12, vsWing: 0.14, vsBig: 0.08, vsScorer: 0.10, vsPlaymaker: 0.08, vsGlass: 0.12, vsPerimeter: 0.16 },
  MIL: { vsGuard: 0.08, vsWing: 0.10, vsBig: 0.16, vsScorer: 0.08, vsPlaymaker: 0.06, vsGlass: 0.18, vsPerimeter: 0.10 },
  MIN: { vsGuard: 0.02, vsWing: 0.04, vsBig: 0.06, vsScorer: 0.06, vsPlaymaker: 0.04, vsGlass: 0.08, vsPerimeter: 0.08 },
  NOP: { vsGuard: -0.04, vsWing: -0.02, vsBig: -0.06, vsScorer: -0.04, vsPlaymaker: -0.08, vsGlass: -0.10, vsPerimeter: 0.02 },
  NYK: { vsGuard: 0.10, vsWing: 0.12, vsBig: 0.10, vsScorer: 0.08, vsPlaymaker: 0.12, vsGlass: 0.14, vsPerimeter: 0.10 },
  OKC: { vsGuard: 0.06, vsWing: 0.12, vsBig: 0.04, vsScorer: 0.14, vsPlaymaker: 0.08, vsGlass: 0.06, vsPerimeter: 0.16 },
  ORL: { vsGuard: 0.12, vsWing: 0.10, vsBig: 0.14, vsScorer: 0.06, vsPlaymaker: 0.10, vsGlass: 0.16, vsPerimeter: 0.08 },
  PHI: { vsGuard: 0.08, vsWing: 0.06, vsBig: 0.12, vsScorer: 0.04, vsPlaymaker: 0.06, vsGlass: 0.14, vsPerimeter: 0.10 },
  PHX: { vsGuard: 0.06, vsWing: 0.08, vsBig: 0.06, vsScorer: 0.08, vsPlaymaker: 0.10, vsGlass: 0.08, vsPerimeter: 0.12 },
  POR: { vsGuard: -0.14, vsWing: -0.10, vsBig: -0.12, vsScorer: -0.12, vsPlaymaker: -0.10, vsGlass: -0.14, vsPerimeter: -0.08 },
  SAC: { vsGuard: -0.08, vsWing: -0.06, vsBig: -0.04, vsScorer: -0.10, vsPlaymaker: -0.12, vsGlass: -0.08, vsPerimeter: -0.06 },
  SAS: { vsGuard: -0.02, vsWing: -0.04, vsBig: -0.08, vsScorer: -0.06, vsPlaymaker: -0.04, vsGlass: -0.06, vsPerimeter: -0.08 },
  TOR: { vsGuard: 0.08, vsWing: 0.10, vsBig: 0.06, vsScorer: 0.08, vsPlaymaker: 0.12, vsGlass: 0.08, vsPerimeter: 0.14 },
  UTA: { vsGuard: 0.04, vsWing: 0.06, vsBig: 0.08, vsScorer: 0.06, vsPlaymaker: 0.08, vsGlass: 0.10, vsPerimeter: 0.06 },
  WAS: { vsGuard: -0.16, vsWing: -0.14, vsBig: -0.12, vsScorer: -0.18, vsPlaymaker: -0.14, vsGlass: -0.10, vsPerimeter: -0.12 },
}

const NICK_TO_ABBR = {
  atlanta: "ATL",
  hawks: "ATL",
  boston: "BOS",
  celtics: "BOS",
  nets: "BKN",
  hornets: "CHA",
  bulls: "CHI",
  cavaliers: "CLE",
  cavs: "CLE",
  mavericks: "DAL",
  mavs: "DAL",
  nuggets: "DEN",
  pistons: "DET",
  warriors: "GSW",
  rockets: "HOU",
  pacers: "IND",
  clippers: "LAC",
  lakers: "LAL",
  grizzlies: "MEM",
  heat: "MIA",
  bucks: "MIL",
  timberwolves: "MIN",
  wolves: "MIN",
  pelicans: "NOP",
  knicks: "NYK",
  thunder: "OKC",
  magic: "ORL",
  "76ers": "PHI",
  sixers: "PHI",
  suns: "PHX",
  blazers: "POR",
  "trail blazers": "POR",
  kings: "SAC",
  spurs: "SAS",
  raptors: "TOR",
  jazz: "UTA",
  wizards: "WAS",
  washington: "WAS",
  sacramento: "SAC",
  phoenix: "PHX",
  philadelphia: "PHI",
  denver: "DEN",
  miami: "MIA",
  dallas: "DAL",
  orlando: "ORL",
  toronto: "TOR",
  chicago: "CHI",
  detroit: "DET",
  milwaukee: "MIL",
  houston: "HOU",
  indiana: "IND",
  memphis: "MEM",
  oklahoma: "OKC",
  portland: "POR",
  "san antonio": "SAS",
  utah: "UTA",
  minnesota: "MIN",
  brooklyn: "BKN",
  "new york": "NYK",
  "new orleans": "NOP",
  "golden state": "GSW",
}

function resolveDefenseProfile(opponent) {
  const raw = String(opponent || "").trim()
  if (!raw) return null
  const u = raw.toUpperCase()
  if (u.length <= 4 && DEFENSE_BY_ABBR[u]) return DEFENSE_BY_ABBR[u]
  const lower = raw.toLowerCase()
  for (const [nick, abbr] of Object.entries(NICK_TO_ABBR)) {
    if (lower.includes(nick)) return DEFENSE_BY_ABBR[abbr] || null
  }
  return null
}

function inferRoleBucket(row) {
  const pos = String(row?.position || row?.primaryPosition || row?.playerPosition || row?.Pos || "").toLowerCase()
  if (/\b(pg|sg|point guard|shooting guard)\b|^g\b|\bcombo guard\b/.test(pos)) return "guard"
  if (/\b(c|center|pf|power forward)\b/.test(pos)) return "big"
  if (/\b(sf|small forward|forward)\b|\bwing\b/.test(pos)) return "wing"
  if (/\bforward\b/.test(pos) && !/power/.test(pos)) return "wing"
  if (/\bguard\b/.test(pos)) return "guard"

  const pt = String(row?.propType || row?.marketKey || "").toLowerCase()
  if (/assist/.test(pt) && !/point.*rebound|pra|pts.*reb.*ast/.test(pt)) return "guard"
  if (/rebound/.test(pt) && !/pra|pts.*reb.*ast/.test(pt)) return "big"
  if (/three|threes|3pt/.test(pt)) return "wing"
  return "wing"
}

function defenseDifficultyForProp(profile, role, propType) {
  if (!profile) return 0
  const roleD = role === "guard" ? profile.vsGuard : role === "big" ? profile.vsBig : profile.vsWing
  const pt = String(propType || "").toLowerCase()

  let statD = profile.vsScorer
  if (/assist/.test(pt) && !/pra|pts.*reb|point.*rebound/.test(pt)) {
    statD = 0.55 * profile.vsPlaymaker + 0.45 * profile.vsGuard
  } else if (/rebound/.test(pt) && !/pra/.test(pt)) {
    statD = 0.55 * profile.vsGlass + 0.45 * profile.vsBig
  } else if (/three|threes|3pt/.test(pt)) {
    statD = 0.65 * profile.vsPerimeter + 0.35 * roleD
  } else if (/pra|points.*rebounds.*assists|pts.*reb.*ast/.test(pt)) {
    statD = 0.35 * profile.vsScorer + 0.25 * roleD + 0.25 * profile.vsPlaymaker + 0.15 * profile.vsGlass
  } else if (/point/.test(pt) && !/pra/.test(pt)) {
    statD = 0.5 * profile.vsScorer + 0.5 * roleD
  }

  return clamp(-0.35, 0.35, 0.48 * roleD + 0.52 * statD)
}

function readPaceTotal(row) {
  let pace = toNum(row?.eventPace ?? row?.pace ?? row?.projectedPace ?? row?.gamePace)
  let total = toNum(row?.gameTotal ?? row?.eventTotal ?? row?.total ?? row?.projectedTotal)
  if (!Number.isFinite(pace)) pace = null
  if (!Number.isFinite(total)) total = null
  return { pace, total }
}

/**
 * @returns {{ adj: number, opponent: string|null, defensePart: number, pacePart: number, totalPart: number }}
 */
function computeMatchupAdjustmentFromRow(row) {
  if (!row || typeof row !== "object") {
    return { adj: 0, opponent: null, defensePart: 0, pacePart: 0, totalPart: 0 }
  }

  const opponent = String(row?.opponent ?? row?.opponentTeam ?? "").trim() || null
  const propType = row?.propType || row?.marketKey || ""
  const profile = opponent ? resolveDefenseProfile(opponent) : null
  const role = inferRoleBucket(row)

  const difficulty = defenseDifficultyForProp(profile, role, propType)
  // Tough defense (positive difficulty) → negative adj (suppress). Weak → positive.
  let defensePart = clamp(-0.038, 0.038, -difficulty * 0.12)

  const { pace, total } = readPaceTotal(row)
  let pacePart = 0
  if (Number.isFinite(pace)) {
    pacePart = ((pace - 100) / 14) * 0.018
    pacePart = clamp(-0.022, 0.022, pacePart)
  }

  const pt = String(propType).toLowerCase()
  const scoringLane = /point|pra|three|threes|3pt|assist|ladder|double|triple/.test(pt) || /points\s*\d/.test(pt)

  let totalPart = 0
  if (Number.isFinite(total)) {
    if (/rebound/.test(pt) && !/pra/.test(pt)) {
      totalPart = ((total - 224) / 36) * 0.012
      totalPart = clamp(-0.014, 0.014, totalPart)
    } else if (scoringLane) {
      totalPart = ((total - 224) / 28) * 0.022
      totalPart = clamp(-0.028, 0.028, totalPart)
    }
  }

  let adj = defensePart + pacePart + totalPart
  adj = clamp(-0.06, 0.06, adj)

  return { adj, opponent, defensePart, pacePart, totalPart }
}

module.exports = {
  computeMatchupAdjustmentFromRow,
  inferRoleBucket,
  resolveDefenseProfile,
  readPaceTotal,
}
