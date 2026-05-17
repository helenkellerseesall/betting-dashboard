// Phase BNDS-1A (Bettor-Native Discovery Surface) — pure deterministic helpers
//
// Composes per-event "game ecosystem" aggregates from the existing
// state.candidates array. No fetches. No fabrication. Every derived field is
// either:
//   (a) a count / set / average of canonical fields actually present on the
//       candidate rows, OR
//   (b) explicit null / empty when the canonical signal is absent.
//
// This module is the canonical-bridge layer that the new GameDiscoveryView
// consumes — same canonical-bridge pattern that worked four phases in a row
// (MLB-COV / VBI / BC / OE / BNSB).
//
// Anti-fabrication doctrine:
//   • Never invents env tags (windDirectionTag / hrEnvironmentTag / etc.).
//   • Never invents player counts or game totals.
//   • `isExplosive` derives ONLY from canonical thresholds the backend
//     OE-5 helper (`buildExplosiveEnvironmentIndex`) uses verbatim:
//        gameTotal >= 9.5 AND avg(impliedTeamTotal) >= 4.5 AND wind out
//        AND NOT hrEnvironmentTag === "HR_SUPPRESSING".
//   • `hasDisagreement` derives from EXPL-1 consensusConfidence < 0.6 on at
//     least one candidate (canonical EXPL1_MIN_CONSENSUS_CONFIDENCE threshold).
//   • Sentence composition is fixed-template per signal; no LLM; no synthesis.

import type { Candidate } from "./types"

// ─────────────────────────────────────────────────────────────────────────────
// PROP-FAMILY canonical buckets
// ─────────────────────────────────────────────────────────────────────────────

// Canonical FE-side prop family buckets. Each candidate's statFamily / propType
// maps to ONE bucket via PROP_FAMILY_ALIASES. Order in PROP_FAMILY_ORDER drives
// the rail render order in GameDiscoveryView.
export type PropFamilyKey =
  | "hits" | "totalBases" | "hr" | "rbis" | "runs" | "ks" | "walks" | "outs"
  | "points" | "rebounds" | "assists" | "threes" | "pra"
  | "blocks" | "steals" | "firstBasket"
  | "alts" | "specials" | "other"

export interface PropFamilyDef {
  key:   PropFamilyKey
  label: string
  icon:  string
  sport: "mlb" | "nba" | "any"
}

export const PROP_FAMILIES: PropFamilyDef[] = [
  // MLB
  { key: "hits",        label: "Hits",        icon: "🥎", sport: "mlb" },
  { key: "totalBases",  label: "Total Bases", icon: "📦", sport: "mlb" },
  { key: "hr",          label: "Home Runs",   icon: "💣", sport: "mlb" },
  { key: "rbis",        label: "RBIs",        icon: "🏃", sport: "mlb" },
  { key: "runs",        label: "Runs",        icon: "🟢", sport: "mlb" },
  { key: "ks",          label: "Strikeouts",  icon: "🌀", sport: "mlb" },
  { key: "walks",       label: "Walks",       icon: "🚶", sport: "mlb" },
  { key: "outs",        label: "Outs",        icon: "⌛", sport: "mlb" },
  // NBA
  { key: "points",      label: "Points",      icon: "🔵", sport: "nba" },
  { key: "rebounds",    label: "Rebounds",    icon: "🟠", sport: "nba" },
  { key: "assists",     label: "Assists",     icon: "🤝", sport: "nba" },
  { key: "threes",      label: "Threes",      icon: "🎯", sport: "nba" },
  { key: "pra",         label: "PRA",         icon: "🔁", sport: "nba" },
  { key: "blocks",      label: "Blocks",      icon: "🛑", sport: "nba" },
  { key: "steals",      label: "Steals",      icon: "🪙", sport: "nba" },
  { key: "firstBasket", label: "First Basket",icon: "🏀", sport: "nba" },
  // Cross-sport
  { key: "alts",        label: "Alt Lines",   icon: "📈", sport: "any" },
  { key: "specials",    label: "Specials",    icon: "✨", sport: "any" },
  { key: "other",       label: "Other",       icon: "•",  sport: "any" },
]

const PROP_FAMILY_ALIASES: Record<string, PropFamilyKey> = {
  // hits
  "hits": "hits", "hit": "hits", "h": "hits", "1+ hits": "hits", "any hits": "hits",
  // total bases
  "totalbases": "totalBases", "total bases": "totalBases", "tb": "totalBases", "total base": "totalBases",
  // hr
  "hr": "hr", "homerun": "hr", "home runs": "hr", "home run": "hr", "hrs": "hr",
  // rbis
  "rbi": "rbis", "rbis": "rbis", "run batted in": "rbis", "runs batted in": "rbis",
  // runs
  "runs": "runs", "runs scored": "runs", "r": "runs",
  // ks
  "ks": "ks", "strikeouts": "ks", "k": "ks", "pitcher k": "ks", "pitcher strikeouts": "ks",
  // walks
  "walks": "walks", "walk": "walks", "bb": "walks", "pitcher walks": "walks",
  // outs
  "outs": "outs", "pitcher outs": "outs", "pitching outs": "outs",
  // nba
  "points": "points", "pts": "points",
  "rebounds": "rebounds", "rebs": "rebounds", "reb": "rebounds",
  "assists": "assists", "ast": "assists", "asts": "assists",
  "threes": "threes", "3pm": "threes", "3-pointers": "threes", "made threes": "threes",
  "pra": "pra", "points+rebounds+assists": "pra", "p+r+a": "pra",
  "blocks": "blocks", "blk": "blocks",
  "steals": "steals", "stl": "steals",
  "firstbasket": "firstBasket", "first basket": "firstBasket", "1st basket": "firstBasket",
  // alt
  "alt": "alts", "alts": "alts", "alt line": "alts", "alt lines": "alts",
}

const norm = (s: string): string =>
  String(s || "").toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim()

export function propFamilyForCandidate(c: Candidate): PropFamilyKey {
  // Prefer statFamily; fall back to propType. Normalize and lookup.
  const fam = norm(c.statFamily || "")
  const fromFam = (fam && PROP_FAMILY_ALIASES[fam]) || (fam && PROP_FAMILY_ALIASES[fam.replace(/\s+/g, "")])
  if (fromFam) {
    // Detect alts/lots via marketKey / propType wording
    const isAlt = /alt|altline|ladder/i.test(c.marketKey || c.propType || "")
    if (isAlt) return "alts"
    return fromFam
  }
  const propRaw = norm(c.propType || "")
  if (propRaw) {
    const fromProp = PROP_FAMILY_ALIASES[propRaw] || PROP_FAMILY_ALIASES[propRaw.replace(/\s+/g, "")]
    if (fromProp) return fromProp
    if (/alt|ladder/.test(propRaw)) return "alts"
    if (/special|anytime|first/.test(propRaw)) return "specials"
  }
  return "other"
}

export function groupByPropFamily(candidates: Candidate[]): Map<PropFamilyKey, Candidate[]> {
  const out = new Map<PropFamilyKey, Candidate[]>()
  for (const c of candidates) {
    const fam = propFamilyForCandidate(c)
    const arr = out.get(fam) || []
    arr.push(c)
    out.set(fam, arr)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// GAME ECOSYSTEM
// ─────────────────────────────────────────────────────────────────────────────

export interface GameEcosystem {
  eventId:              string
  matchup:              string                 // best-effort "AAA @ BBB"
  teams:                string[]               // deduped team abbreviations seen on this event
  startTime:            string | null
  candidateCount:       number
  propsByFamily:        Record<string, number> // PropFamilyKey → count
  uniqueBooks:          string[]
  bookCount:            number
  impliedTeamTotals:    Record<string, number> // team → impliedTeamTotal (when present)
  avgImpliedTeamTotal:  number | null
  gameTotal:            number | null
  hrEnvironmentTag:     string | null
  windDirectionTag:     string | null
  carryShift:           number | null
  contextualTags:       string[]               // deduped union across all candidates
  topPlayers:           Array<{ player: string; team: string | null; count: number }>
  isExplosive:          boolean
  hasDisagreement:      boolean
  sport:                "mlb" | "nba" | null
}

function pickFirstFinite(arr: Array<number | null | undefined>): number | null {
  for (const v of arr) if (typeof v === "number" && Number.isFinite(v)) return v
  return null
}

function inferSport(eventId: string, families: Set<PropFamilyKey>): "mlb" | "nba" | null {
  // First check families for sport-specific keys.
  const mlbKeys: PropFamilyKey[] = ["hits", "totalBases", "hr", "rbis", "runs", "ks", "walks", "outs"]
  const nbaKeys: PropFamilyKey[] = ["points", "rebounds", "assists", "threes", "pra", "blocks", "steals", "firstBasket"]
  let mlb = 0, nba = 0
  for (const k of mlbKeys) if (families.has(k)) mlb++
  for (const k of nbaKeys) if (families.has(k)) nba++
  if (mlb > 0 && nba === 0) return "mlb"
  if (nba > 0 && mlb === 0) return "nba"
  // Heuristic on eventId
  const id = String(eventId || "").toLowerCase()
  if (/nba|basket/i.test(id)) return "nba"
  if (/mlb|bsbl|base/i.test(id)) return "mlb"
  return null
}

function deriveMatchup(team1: string, team2: string, observed: string | null): string {
  if (observed) return observed
  if (team1 && team2) return `${team1} @ ${team2}`
  if (team1) return team1
  return "(unknown matchup)"
}

const WIND_OUT_TAGS = new Set(["out_to_cf", "out_to_lf", "out_to_rf", "out", "out_to_left", "out_to_right"])

export function buildGameEcosystems(candidates: Candidate[]): GameEcosystem[] {
  const byEvent = new Map<string, Candidate[]>()
  for (const c of candidates) {
    const id = String(c.eventId || "").trim()
    if (!id) continue   // anti-fabrication: never invent an eventId
    const arr = byEvent.get(id) || []
    arr.push(c)
    byEvent.set(id, arr)
  }

  const result: GameEcosystem[] = []
  for (const [eventId, list] of byEvent) {
    // ── matchup + teams ─────────────────────────────────────────────────────
    const matchupObserved =
      list.find((c) => c.matchup)?.matchup || null
    const teamSet = new Set<string>()
    for (const c of list) if (c.team) teamSet.add(String(c.team))
    const teamList = [...teamSet]

    // ── candidate + book + propsByFamily ────────────────────────────────────
    const propsByFamily: Record<string, number> = {}
    const bookSet = new Set<string>()
    const families = new Set<PropFamilyKey>()
    for (const c of list) {
      const fam = propFamilyForCandidate(c)
      propsByFamily[fam] = (propsByFamily[fam] || 0) + 1
      families.add(fam)
      const book = (c.book || c.sportsbook || "").toLowerCase()
      if (book) bookSet.add(book)
    }
    const uniqueBooks = [...bookSet].sort()

    // ── team totals + game total + env tags (canonical-only) ────────────────
    const impliedTeamTotals: Record<string, number> = {}
    for (const c of list) {
      const team = c.team
      if (!team) continue
      if (typeof c.impliedTeamTotal === "number" && Number.isFinite(c.impliedTeamTotal)) {
        impliedTeamTotals[team] = c.impliedTeamTotal
      }
    }
    const ttValues = Object.values(impliedTeamTotals)
    const avgImpliedTeamTotal = ttValues.length
      ? ttValues.reduce((a, b) => a + b, 0) / ttValues.length
      : null
    const gameTotal       = pickFirstFinite(list.map((c) => c.gameTotal ?? null))
    const hrEnvironmentTag = list.find((c) => typeof c.hrEnvironmentTag === "string")?.hrEnvironmentTag || null
    const windDirectionTag = list.find((c) => typeof c.windDirectionTag === "string")?.windDirectionTag || null
    const carryShift       = pickFirstFinite(list.map((c) => c.carryShift ?? null))

    // ── contextualTags union ─────────────────────────────────────────────────
    const tagSet = new Set<string>()
    for (const c of list) {
      if (Array.isArray(c.contextualTags)) {
        for (const t of c.contextualTags) if (typeof t === "string") tagSet.add(t)
      }
    }

    // ── top players ─────────────────────────────────────────────────────────
    const playerCount = new Map<string, { player: string; team: string | null; count: number }>()
    for (const c of list) {
      if (!c.player) continue
      const key = c.player
      const entry = playerCount.get(key) || { player: c.player, team: c.team || null, count: 0 }
      entry.count++
      playerCount.set(key, entry)
    }
    const topPlayers = [...playerCount.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)

    // ── start time (best-effort; never invented) ────────────────────────────
    const startTime = list.find((c) => typeof c.startTime === "string")?.startTime
                    || list.find((c) => typeof c.gameTime === "string")?.gameTime
                    || null

    // ── isExplosive — canonical OE-5 threshold ──────────────────────────────
    const windOut = !!(windDirectionTag && WIND_OUT_TAGS.has(String(windDirectionTag).toLowerCase()))
    const isExplosive =
      gameTotal != null && gameTotal >= 9.5 &&
      avgImpliedTeamTotal != null && avgImpliedTeamTotal >= 4.5 &&
      windOut &&
      hrEnvironmentTag !== "HR_SUPPRESSING"

    // ── hasDisagreement — canonical EXPL-1 consensusConfidence threshold ────
    const hasDisagreement = list.some(
      (c) => typeof c.consensusConfidence === "number" && c.consensusConfidence < 0.6
    )

    const sport = inferSport(eventId, families)

    result.push({
      eventId,
      matchup: deriveMatchup(teamList[0] || "", teamList[1] || "", matchupObserved),
      teams: teamList,
      startTime,
      candidateCount: list.length,
      propsByFamily,
      uniqueBooks,
      bookCount: uniqueBooks.length,
      impliedTeamTotals,
      avgImpliedTeamTotal,
      gameTotal,
      hrEnvironmentTag,
      windDirectionTag,
      carryShift,
      contextualTags: [...tagSet].sort(),
      topPlayers,
      isExplosive,
      hasDisagreement,
      sport,
    })
  }

  // Sort: explosive first, then by candidate count desc
  result.sort((a, b) => {
    if (a.isExplosive !== b.isExplosive) return a.isExplosive ? -1 : 1
    return b.candidateCount - a.candidateCount
  })

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPLOSIVE / ENVIRONMENT SENTENCE — BNDS-1A-4
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One bettor-readable sentence describing the canonical environment fragments
 * present on the game. No hype. No emojis. No fake certainty.
 *
 * Returns null when no canonical environment signal is available (caller
 * renders honest empty copy).
 */
export function composeExplosiveSentence(eco: GameEcosystem): string | null {
  const fragments: string[] = []

  // Wind component
  if (eco.windDirectionTag) {
    const w = String(eco.windDirectionTag).toLowerCase()
    if (WIND_OUT_TAGS.has(w))      fragments.push("wind blowing out")
    else if (/in_from/.test(w))    fragments.push("wind blowing in")
  }

  // HR environment
  if (eco.hrEnvironmentTag === "HR_FRIENDLY")        fragments.push("HR-friendly park")
  else if (eco.hrEnvironmentTag === "HR_SUPPRESSING") fragments.push("HR-suppressing park")

  // Carry / temp
  if (typeof eco.carryShift === "number" && eco.carryShift > 0) {
    fragments.push("positive carry shift")
  }

  // Game total / team totals
  if (typeof eco.gameTotal === "number") {
    if (eco.gameTotal >= 10)      fragments.push(`high game total ${eco.gameTotal.toFixed(1)}`)
    else if (eco.gameTotal >= 9)  fragments.push(`elevated game total ${eco.gameTotal.toFixed(1)}`)
    else if (eco.gameTotal <= 7)  fragments.push(`low game total ${eco.gameTotal.toFixed(1)}`)
  }
  if (typeof eco.avgImpliedTeamTotal === "number") {
    if (eco.avgImpliedTeamTotal >= 5.0)      fragments.push(`top-heavy team totals (avg ${eco.avgImpliedTeamTotal.toFixed(1)})`)
    else if (eco.avgImpliedTeamTotal <= 3.5) fragments.push(`desert team totals (avg ${eco.avgImpliedTeamTotal.toFixed(1)})`)
  }

  // Contextual tags (only the canonical ones the operator already approved)
  for (const t of eco.contextualTags) {
    const tl = t.toLowerCase()
    if (tl.includes("k_heavy") && !fragments.some((f) => f.includes("strikeout"))) {
      fragments.push("strikeout-heavy starting pitching")
    }
    if (tl.includes("bullpen") && tl.includes("fragile") && !fragments.some((f) => f.includes("bullpen"))) {
      fragments.push("fragile bullpen context")
    }
  }

  if (fragments.length === 0) return null

  // Conclusion phrase — derive from explosive boolean
  let conclusion = ""
  if (eco.isExplosive) {
    conclusion = " — elevated HR + offensive ecology."
  } else if (eco.hrEnvironmentTag === "HR_SUPPRESSING" && eco.avgImpliedTeamTotal != null && eco.avgImpliedTeamTotal <= 3.5) {
    conclusion = " — muted offensive ceiling."
  } else {
    conclusion = "."
  }

  // Capitalize first fragment
  const first = fragments[0]
  const head = first.charAt(0).toUpperCase() + first.slice(1)
  const rest = fragments.slice(1)
  return rest.length > 0
    ? `${head}, ${rest.join(", ")}${conclusion}`
    : `${head}${conclusion}`
}

// ─────────────────────────────────────────────────────────────────────────────
// DISCOVERY LENSES — BNDS-1A-6
// ─────────────────────────────────────────────────────────────────────────────

export type DiscoveryLens =
  | "all"
  | "top"
  | "explosive"
  | "ladder_zones"
  | "strongest_environments"
  | "contradiction_zones"
  | "hr_environments"
  | "k_environments"

export const DISCOVERY_LENSES: Array<{ key: DiscoveryLens; label: string; hint: string }> = [
  { key: "all",                    label: "All games",                hint: "Every game on tonight's slate." },
  { key: "top",                    label: "Top games",                hint: "Sorted by highest avg implied team total." },
  { key: "explosive",              label: "Explosive games",          hint: "Canonical OE-5 explosive threshold met (game total ≥ 9.5 + avg TT ≥ 4.5 + wind out + not HR-suppressing)." },
  { key: "ladder_zones",           label: "Ladder zones",             hint: "Games where at least one player has 3+ separate props (ladder opportunity)." },
  { key: "strongest_environments", label: "Strongest environments",   hint: "Game total ≥ 10." },
  { key: "contradiction_zones",    label: "Contradiction zones",      hint: "Books disagree materially on at least one prop (EXPL-1 consensusConfidence < 0.6)." },
  { key: "hr_environments",        label: "HR environments",          hint: "Canonical hrEnvironmentTag = HR_FRIENDLY." },
  { key: "k_environments",         label: "K environments",           hint: "Strikeout-heavy starting pitching (canonical context tag)." },
]

export function applyLens(games: GameEcosystem[], lens: DiscoveryLens): GameEcosystem[] {
  switch (lens) {
    case "all":
      return games
    case "top":
      return [...games].sort((a, b) => {
        const av = a.avgImpliedTeamTotal ?? -Infinity
        const bv = b.avgImpliedTeamTotal ?? -Infinity
        return bv - av
      })
    case "explosive":
      return games.filter((g) => g.isExplosive)
    case "ladder_zones":
      return games.filter((g) =>
        g.topPlayers.some((p) => p.count >= 3)
      )
    case "strongest_environments":
      return games.filter((g) => typeof g.gameTotal === "number" && g.gameTotal >= 10)
    case "contradiction_zones":
      return games.filter((g) => g.hasDisagreement)
    case "hr_environments":
      return games.filter((g) => g.hrEnvironmentTag === "HR_FRIENDLY")
    case "k_environments":
      return games.filter((g) =>
        g.contextualTags.some((t) => /k_heavy|strikeout/i.test(t))
      )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LADDER EXPLORER — BNDS-1A-3 (per-player relationship surfacing)
// ─────────────────────────────────────────────────────────────────────────────

export interface PlayerLadder {
  player:        string
  team:          string | null
  legs:          Candidate[]                // every candidate row for this player in the game
  familiesPresent: PropFamilyKey[]          // which prop families are covered
  legCount:      number
  hasOver:       boolean
  hasUnder:      boolean
  hasContradiction: boolean                 // simultaneous OVER and UNDER on same family
  survivability: "high" | "neutral" | "low" // derived from depth + impliedTeamTotal
  ecologySupport: "supported" | "neutral" | "hostile"
}

export function buildPlayerLadders(eco: GameEcosystem, candidates: Candidate[]): PlayerLadder[] {
  // Filter to candidates in this event
  const inGame = candidates.filter((c) => String(c.eventId || "") === eco.eventId)

  const byPlayer = new Map<string, Candidate[]>()
  for (const c of inGame) {
    const p = c.player
    if (!p) continue
    const arr = byPlayer.get(p) || []
    arr.push(c)
    byPlayer.set(p, arr)
  }

  const ladders: PlayerLadder[] = []
  for (const [player, legs] of byPlayer) {
    const familiesSeen = new Set<PropFamilyKey>()
    let hasOver = false, hasUnder = false
    const byFamSide = new Map<string, Set<string>>()
    for (const l of legs) {
      const fam = propFamilyForCandidate(l)
      familiesSeen.add(fam)
      const s = String(l.side || "").toLowerCase()
      if (s === "over")  hasOver = true
      if (s === "under") hasUnder = true
      const k = String(fam)
      const sides = byFamSide.get(k) || new Set<string>()
      sides.add(s)
      byFamSide.set(k, sides)
    }
    // Contradiction = same family has both OVER and UNDER
    let hasContradiction = false
    for (const sides of byFamSide.values()) {
      if (sides.has("over") && sides.has("under")) { hasContradiction = true; break }
    }

    // Survivability — depth + teamTotal heuristic (canonical fields only)
    const depthSamples = legs.map((l) => l.depth).filter((d): d is string => typeof d === "string")
    const teamTotal = legs.find((l) => typeof l.impliedTeamTotal === "number")?.impliedTeamTotal ?? null
    let survivability: "high" | "neutral" | "low" = "neutral"
    if (depthSamples.includes("top") || (teamTotal != null && teamTotal >= 5.0)) survivability = "high"
    else if (depthSamples.includes("back") || (teamTotal != null && teamTotal <= 3.5)) survivability = "low"

    // Ecology support — game ecosystem signals
    let ecologySupport: "supported" | "neutral" | "hostile" = "neutral"
    if (eco.isExplosive || eco.hrEnvironmentTag === "HR_FRIENDLY") ecologySupport = "supported"
    else if (eco.hrEnvironmentTag === "HR_SUPPRESSING")            ecologySupport = "hostile"

    ladders.push({
      player,
      team: legs[0]?.team || null,
      legs,
      familiesPresent: [...familiesSeen],
      legCount: legs.length,
      hasOver,
      hasUnder,
      hasContradiction,
      survivability,
      ecologySupport,
    })
  }

  // Sort by leg count desc (richest ladders first)
  ladders.sort((a, b) => b.legCount - a.legCount)
  return ladders
}
