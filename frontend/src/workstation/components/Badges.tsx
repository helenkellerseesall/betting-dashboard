import type { Candidate, TimingClassification, LineShopGroup } from "../types"

export function Badge({ kind, children }: { kind?: string; children: React.ReactNode }) {
  return <span className={`ws-badge ${kind || ""}`}>{children}</span>
}

export function TimingBadge({ tc }: { tc?: TimingClassification | null }) {
  if (!tc) return null
  const u = String(tc.urgency || "").toLowerCase()
  const s = String(tc.state || "").toLowerCase()
  if (u === "immediate") return <Badge kind="now">🔥 BET NOW</Badge>
  if (s === "stale_window") return <Badge kind="stale">💤 STALE LINE</Badge>
  if (s === "steam") return <Badge kind="steam">⚡ STEAM</Badge>
  if (u === "soon") return <Badge kind="soon">⏰ BET SOON</Badge>
  return null
}

export function CandidateBadges({ c, tc, ls }: {
  c: Candidate
  tc?: TimingClassification | null
  ls?: LineShopGroup | null
}) {
  const out: React.ReactNode[] = []
  if (tc) {
    const u = String(tc.urgency || "").toLowerCase()
    const s = String(tc.state || "").toLowerCase()
    if (u === "immediate") out.push(<Badge key="now" kind="now">🔥 NOW</Badge>)
    else if (s === "stale_window") out.push(<Badge key="stale" kind="stale">💤 STALE</Badge>)
    else if (s === "steam") out.push(<Badge key="steam" kind="steam">⚡ STEAM</Badge>)
    else if (u === "soon") out.push(<Badge key="soon" kind="soon">⏰ SOON</Badge>)
  }
  if (ls?.flags?.includes("soft_book")) out.push(<Badge key="soft" kind="softbook">🎁 SOFT</Badge>)
  if (ls?.flags?.includes("stale_line")) out.push(<Badge key="staleline" kind="stale">🐌 STALE</Badge>)
  const tier = String(c.tier || c.confidenceTier || "").toUpperCase()
  if (tier === "ELITE") out.push(<Badge key="elite" kind="elite">★ ELITE</Badge>)
  else if (tier === "STRONG") out.push(<Badge key="strong" kind="strong">▲ STRONG</Badge>)
  else if (tier === "LOTTO") out.push(<Badge key="lotto" kind="lotto">🎲 LOTTO</Badge>)
  // CLV (only if known)
  if (Number.isFinite(c.clv as number)) {
    const v = c.clv as number
    if (v > 0.02) out.push(<Badge key="clvp" kind="posclv">🟢 +CLV</Badge>)
    else if (v < -0.02) out.push(<Badge key="clvn" kind="negclv">🔴 −CLV</Badge>)
  }
  return <>{out}</>
}
