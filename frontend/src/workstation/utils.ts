import type { Candidate } from "./types"

export function fmtOdds(o?: number | null): string {
  if (o == null || !Number.isFinite(o)) return "—"
  return o > 0 ? `+${o}` : `${o}`
}

export function fmtPct(p?: number | null, digits = 1): string {
  if (p == null || !Number.isFinite(p)) return "—"
  return `${(p * 100).toFixed(digits)}%`
}

export function fmtSignedPct(p?: number | null, digits = 1): string {
  if (p == null || !Number.isFinite(p)) return "—"
  const v = p * 100
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`
}

export function fmtNum(n?: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return n.toFixed(digits)
}

export function impliedFromAmerican(o?: number | null): number | null {
  if (o == null || !Number.isFinite(o) || o === 0) return null
  return o > 0 ? 100 / (o + 100) : Math.abs(o) / (Math.abs(o) + 100)
}

export function decimalFromAmerican(o?: number | null): number | null {
  if (o == null || !Number.isFinite(o) || o === 0) return null
  return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o)
}

export function statKey(c: Candidate | undefined | null): string {
  if (!c) return ""
  return String(c.statFamily || c.propType || "").toLowerCase().replace(/[\s_]+/g, "")
}

export function teamAbbrev(team?: string | null): string {
  if (!team) return ""
  const t = String(team).trim()
  if (t.length <= 4) return t.toUpperCase()
  // Map a few common full names to abbrevs as fallback
  const m = t.toLowerCase()
  const map: Record<string, string> = {
    "new york yankees": "NYY", "new york mets": "NYM", "boston red sox": "BOS",
    "los angeles dodgers": "LAD", "los angeles angels": "LAA", "san diego padres": "SD",
    "san francisco giants": "SF", "atlanta braves": "ATL", "chicago cubs": "CHC",
    "chicago white sox": "CHW", "houston astros": "HOU", "texas rangers": "TEX",
    "toronto blue jays": "TOR", "tampa bay rays": "TB", "baltimore orioles": "BAL",
    "minnesota twins": "MIN", "kansas city royals": "KC", "detroit tigers": "DET",
    "cleveland guardians": "CLE", "milwaukee brewers": "MIL", "st. louis cardinals": "STL",
    "cincinnati reds": "CIN", "pittsburgh pirates": "PIT", "philadelphia phillies": "PHI",
    "miami marlins": "MIA", "washington nationals": "WSH", "colorado rockies": "COL",
    "arizona diamondbacks": "ARI", "seattle mariners": "SEA", "oakland athletics": "OAK",
    "los angeles lakers": "LAL", "los angeles clippers": "LAC", "golden state warriors": "GSW",
    "boston celtics": "BOS", "milwaukee bucks": "MIL", "miami heat": "MIA",
    "philadelphia 76ers": "PHI", "new york knicks": "NYK", "brooklyn nets": "BKN",
    "denver nuggets": "DEN", "phoenix suns": "PHX", "dallas mavericks": "DAL",
    "memphis grizzlies": "MEM", "minnesota timberwolves": "MIN", "oklahoma city thunder": "OKC",
    "sacramento kings": "SAC", "portland trail blazers": "POR", "utah jazz": "UTA",
    "atlanta hawks": "ATL", "charlotte hornets": "CHA", "chicago bulls": "CHI",
    "cleveland cavaliers": "CLE", "detroit pistons": "DET", "indiana pacers": "IND",
    "orlando magic": "ORL", "toronto raptors": "TOR", "washington wizards": "WSH",
    "houston rockets": "HOU", "san antonio spurs": "SAS", "new orleans pelicans": "NOP",
  }
  if (map[m]) return map[m]
  // Fallback: take first letters of each word, max 4 chars
  return t.split(/\s+/).map((w) => w[0]).join("").slice(0, 4).toUpperCase()
}

export function ladderHeight(line?: number, statFamily?: string): "low" | "medium" | "high" {
  if (line == null) return "medium"
  const fam = String(statFamily || "").toLowerCase()
  if (fam.includes("homerun") || fam.includes("hr") || fam.includes("firstbasket")) return "high"
  if (line >= 4) return "high"
  if (line >= 2.5) return "medium"
  return "low"
}

export function urgencyColor(urgency?: string): string {
  switch (String(urgency || "").toLowerCase()) {
    case "immediate": return "var(--ws-urgency-immediate)"
    case "soon":      return "var(--ws-urgency-soon)"
    case "patient":   return "var(--ws-urgency-patient)"
    case "wait":      return "var(--ws-urgency-wait)"
    case "avoid":     return "var(--ws-urgency-avoid)"
    default:          return "var(--ws-text-dim)"
  }
}

export function tierColor(tier?: string): string {
  switch (String(tier || "").toUpperCase()) {
    case "ELITE":    return "var(--ws-tier-elite)"
    case "STRONG":   return "var(--ws-tier-strong)"
    case "PLAYABLE": return "var(--ws-tier-playable)"
    case "LOTTO":    return "var(--ws-tier-lotto)"
    case "FADE":     return "var(--ws-tier-fade)"
    default:         return "var(--ws-text-dim)"
  }
}

export function compactStat(s?: string): string {
  const k = String(s || "").toLowerCase()
  if (k.includes("totalbase")) return "TB"
  if (k.includes("homerun") || k === "hr") return "HR"
  if (k === "rbis" || k === "rbi") return "RBI"
  if (k.includes("strikeout") || k.includes("pitcherk")) return "K"
  if (k.includes("first") && k.includes("basket")) return "FB"
  if (k.includes("rebound")) return "REB"
  if (k.includes("assist")) return "AST"
  if (k.includes("three")) return "3PT"
  if (k.includes("point")) return "PTS"
  if (k.includes("hits") || k === "hits") return "H"
  if (k === "outs") return "OUT"
  return s ? s.slice(0, 4).toUpperCase() : ""
}
