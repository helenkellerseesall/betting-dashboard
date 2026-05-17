import { useState, type ReactNode } from "react"
import type { VbiVerdict } from "../types"

/**
 * Phase BNSB-1B (BNSB-1B-6): VerdictCard hero re-shape.
 *
 * Previous (BNSB-1A): flat 12-section encyclopedia rendered top-to-bottom
 * with equal visual weight.
 *
 * New: hero-first compression with collapsible forensic drill-down.
 *   HERO:
 *     • Big coherence ring (canonical ecologicalCoherence 0-100)
 *     • Big verdictSummary headline
 *     • Top-priority bettor-language phrase (the loudest signal)
 *     • Compact "strongest leg" + "weakest leg" line
 *     • Survivability / reinforcement / contradiction summary chips
 *     • Fake-safe risk callout (when detected)
 *   DETAIL (collapsible):
 *     • Full covariance / exploitability / availability sections
 *     • Contradictions list
 *     • Unresolved legs (anti-fabrication transparency)
 *     • Raw VBI signals (forensic — preserves BNSB-1A 12-section render)
 *
 * Anti-fabrication doctrine:
 *   • Every visible bettor-readable string comes from a canonical backend
 *     field (verdictSummary, bettorLanguageSummary, ecologicalCoherence).
 *   • Empty sections render "(none surfaced)" honestly — never invented.
 *   • Forensic detail is opt-in, not default.
 *   • Backend `verdict = null` renders a transparent "no verdict" surface.
 */
export function VerdictCard({
  verdict,
  legsParsed,
}: {
  verdict: VbiVerdict | null | undefined
  legsParsed?: Array<Record<string, unknown>>
}) {
  const [showDetail, setShowDetail] = useState(false)

  if (!verdict) {
    return (
      <div className="ws-card" style={{ marginBottom: 12 }}>
        <div className="ws-dim" style={{ fontSize: 12, fontStyle: "italic" }}>
          The analyzer didn't return a verdict for this slip. The backend resolver
          couldn't map the legs to canonical predictions — this usually means the
          slip's sport or stat families aren't supported yet.
        </div>
      </div>
    )
  }

  const describeLeg = (idx: number): string => {
    if (!Array.isArray(legsParsed) || idx < 0 || idx >= legsParsed.length) return `leg ${idx + 1}`
    const leg = legsParsed[idx] as Record<string, unknown>
    const player = typeof leg.player === "string" ? leg.player : null
    const stat   = typeof leg.statFamily === "string" ? leg.statFamily
                : typeof leg.propType   === "string" ? leg.propType : null
    const side   = typeof leg.side === "string" ? leg.side : null
    const line   = typeof leg.line === "number" ? leg.line : null
    const parts: string[] = []
    if (player) parts.push(player)
    if (side)   parts.push(`${side}${line != null ? ` ${line}` : ""}`)
    if (stat)   parts.push(stat)
    return parts.length ? parts.join(" ") : `leg ${idx + 1}`
  }

  const coherencePct = Math.round((verdict.ecologicalCoherence || 0) * 100)
  const coherenceTone =
    coherencePct >= 70 ? "good" :
    coherencePct >= 40 ? "neutral" : "watch"
  const coherenceColor =
    coherencePct >= 70 ? "var(--ws-positive)" :
    coherencePct >= 40 ? "var(--ws-warn)"     :
                         "var(--ws-negative)"

  const lang     = verdict.bettorLanguageSummary || []
  const topPhrase = lang[0] || null
  const restPhrases = lang.slice(1)

  const covPos = verdict.covarianceProfile?.positiveStacks      || []
  const covPH  = verdict.covarianceProfile?.pitcherHitterConflicts || []
  const covSG  = verdict.covarianceProfile?.sharedGameSuppression  || []
  const expSup = verdict.exploitabilityProfile?.marketSupported    || []
  const expSol = verdict.exploitabilityProfile?.unsupportedSoloEdge || []
  const avDrop = verdict.availabilityProfile?.hardDropOut           || []
  const contras = verdict.contradictionFlags || []
  const unres   = verdict.unresolvedLegs     || []
  const sigs    = verdict.signals            || []
  const fakeSafe = verdict.fakeSafeRisk || { detected: false, reasons: [] }

  // Summary chip counts for the HERO summary line
  const reinforcementCount = covPos.length
  const contradictionCount = covPH.length + covSG.length + contras.length

  return (
    <div className="ws-card" style={{ marginBottom: 12 }}>
      {/* ─── HERO ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
        <CoherenceRing pct={coherencePct} color={coherenceColor} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={`ws-mood-pill ${coherenceTone}`} style={{ fontSize: 10, marginBottom: 6 }}>
            coherence {coherencePct}/100
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.35 }}>
            {verdict.verdictSummary || "(no verdict summary surfaced)"}
          </div>
          {topPhrase && (
            <div className="ws-dim" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.45 }}>
              The biggest takeaway: <span style={{ color: "var(--ws-text, inherit)" }}>{topPhrase}</span>
            </div>
          )}
        </div>
      </div>

      {/* Fake-safe pill — only when detected */}
      {fakeSafe.detected && (
        <div
          className="ws-risk-flag"
          style={{
            marginBottom: 10,
            fontSize: 12,
            padding: "6px 10px",
            borderLeft: "3px solid var(--ws-warn)",
            background: "var(--ws-card-2-bg, transparent)",
          }}
          title={fakeSafe.reasons.join(" · ")}
        >
          ⚠️ Fake-safe construction detected — looks safer than it actually is.
        </div>
      )}

      {/* Strongest / weakest leg — compact two-line summary */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 10 }}>
        <HeroLegLine label="Strongest leg"  icon="💪" leg={verdict.strongestLeg} describe={describeLeg} />
        <HeroLegLine label="Weakest leg"    icon="🪶" leg={verdict.weakestLeg}   describe={describeLeg} />
      </div>

      {/* Survivability / reinforcement / contradiction summary chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        <SummaryChip
          tone={coherenceTone}
          icon="🌐"
          label={`survivability ${coherencePct}/100`}
          tooltip="VBI ecologicalCoherence — canonical 0-100 reflection of how well the slip's legs survive together."
        />
        {reinforcementCount > 0 && (
          <SummaryChip
            tone="good"
            icon="🔗"
            label={`${reinforcementCount} positive stack${reinforcementCount === 1 ? "" : "s"}`}
            tooltip="Same-team OVER pairs the engine sees as ecologically reinforcing."
          />
        )}
        {contradictionCount > 0 && (
          <SummaryChip
            tone="watch"
            icon="⚠"
            label={`${contradictionCount} contradiction${contradictionCount === 1 ? "" : "s"}`}
            tooltip="Pairs of legs the engine sees as conflicting (shared-game / pitcher-hitter / structural)."
          />
        )}
        {avDrop.length > 0 && (
          <SummaryChip
            tone="watch"
            icon="🚫"
            label={`${avDrop.length} availability concern${avDrop.length === 1 ? "" : "s"}`}
            tooltip="Legs riding on players with availability risk (OUT / questionable per canonical roster)."
          />
        )}
        {expSol.length > 0 && (
          <SummaryChip
            tone="watch"
            icon="🎲"
            label={`${expSol.length} single-book outlier${expSol.length === 1 ? "" : "s"}`}
            tooltip="Legs whose edge appears at only one book — market support is thin."
          />
        )}
        {expSup.length > 0 && (
          <SummaryChip
            tone="good"
            icon="📊"
            label={`${expSup.length} market-supported edge${expSup.length === 1 ? "" : "s"}`}
            tooltip="Legs whose edge is corroborated by multiple books — real market disagreement."
          />
        )}
        {unres.length > 0 && (
          <SummaryChip
            tone="neutral"
            icon="❓"
            label={`${unres.length} unmapped leg${unres.length === 1 ? "" : "s"}`}
            tooltip="Legs the canonical resolver couldn't match (anti-fabrication: never silently inferred)."
          />
        )}
      </div>

      {/* Additional bettor-language phrases (compact list, not chips) */}
      {restPhrases.length > 0 && (
        <div style={{ marginBottom: 10, fontSize: 12, lineHeight: 1.55 }}>
          {restPhrases.map((p, i) => (
            <div key={`p-${i}`} style={{ color: "var(--ws-text-dim, #999)" }}>
              • {p}
            </div>
          ))}
        </div>
      )}

      {/* ─── DETAIL TOGGLE ────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
        <button
          className="ws-link"
          style={{ fontSize: 12, padding: 0, background: "transparent", border: "none", cursor: "pointer" }}
          onClick={() => setShowDetail((v) => !v)}
        >
          {showDetail ? "▾ Hide full breakdown" : "▸ Show the full breakdown"}
        </button>
      </div>

      {/* ─── FORENSIC DETAIL ─────────────────────────────────────────────── */}
      {showDetail && (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--ws-border, #333)", paddingTop: 10 }}>
          <SectionBlock title="Covariance profile">
            {covPos.length === 0 && covPH.length === 0 && covSG.length === 0 ? (
              <Dim>(no covariance signals)</Dim>
            ) : (
              <>
                {covPos.map((p, i) => (
                  <Row key={`pos-${i}`} kind="positive">
                    ✅ positive stack: {describeLeg(p.legA)} ↔ {describeLeg(p.legB)}
                    <Dim> · score {Math.round((p.score || 0) * 100) / 100}</Dim>
                  </Row>
                ))}
                {covPH.map((p, i) => (
                  <Row key={`ph-${i}`} kind="warn">
                    🆚 pitcher-hitter conflict: {describeLeg(p.legA)} ↔ {describeLeg(p.legB)}
                  </Row>
                ))}
                {covSG.map((p, i) => (
                  <Row key={`sg-${i}`} kind="warn">
                    🛑 shared-game suppression: {describeLeg(p.legA)} ↔ {describeLeg(p.legB)}
                  </Row>
                ))}
              </>
            )}
          </SectionBlock>

          <SectionBlock title="Exploitability profile">
            {expSup.length === 0 && expSol.length === 0 ? (
              <Dim>(no exploitability signals)</Dim>
            ) : (
              <>
                {expSup.map((leg, i) => (
                  <Row key={`sup-${i}`} kind="positive">
                    📊 market-supported: {describeLeg(leg.legIndex)}
                    {leg.reason && <Dim> · {leg.reason}</Dim>}
                  </Row>
                ))}
                {expSol.map((leg, i) => (
                  <Row key={`sol-${i}`} kind="warn">
                    🎲 unsupported solo edge: {describeLeg(leg.legIndex)}
                    {leg.reason && <Dim> · {leg.reason}</Dim>}
                  </Row>
                ))}
              </>
            )}
          </SectionBlock>

          <SectionBlock title="Availability profile">
            {avDrop.length === 0 ? (
              <Dim>(no availability concerns)</Dim>
            ) : (
              avDrop.map((leg, i) => (
                <Row key={`av-${i}`} kind="warn">
                  🚫 hard dropout risk: {describeLeg(leg.legIndex)}
                  {leg.reason && <Dim> · {leg.reason}</Dim>}
                </Row>
              ))
            )}
          </SectionBlock>

          {contras.length > 0 && (
            <SectionBlock title="Contradictions">
              {contras.map((c, i) => (
                <Row key={`con-${i}`} kind="warn">
                  ⚠️ {describeLeg(c.legA)} contradicts {describeLeg(c.legB)} — {c.reason}
                </Row>
              ))}
            </SectionBlock>
          )}

          {fakeSafe.detected && fakeSafe.reasons.length > 0 && (
            <SectionBlock title="Fake-safe reasons">
              {fakeSafe.reasons.map((r, i) => (
                <Row key={`fs-${i}`} kind="warn">⚠️ {r}</Row>
              ))}
            </SectionBlock>
          )}

          {unres.length > 0 && (
            <SectionBlock title="Unresolved legs (canonical resolver could not match)">
              {unres.map((u, i) => (
                <Row key={`un-${i}`} kind="dim">
                  ❓ leg #{u.legIndex + 1} — {u.unresolvedReason}
                </Row>
              ))}
            </SectionBlock>
          )}

          {sigs.length > 0 && (
            <SectionBlock title={`Raw VBI signals (${sigs.length}) — forensic only`}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {sigs.map((s, i) => (
                  <span
                    key={`sig-${i}`}
                    className="ws-pill"
                    style={{ fontSize: 10, pointerEvents: "none" }}
                    title={JSON.stringify(s.payload || {}, null, 2)}
                  >
                    [{s.scope}] {s.id}
                  </span>
                ))}
              </div>
            </SectionBlock>
          )}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Hero subcomponents                                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

function CoherenceRing({ pct, color }: { pct: number; color: string }) {
  // Simple inline-SVG donut. Pure presentational; no animation; no library.
  const r = 28
  const c = 2 * Math.PI * r
  const dash = (pct / 100) * c
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" style={{ flexShrink: 0 }} aria-hidden>
      <circle cx="36" cy="36" r={r} fill="none" stroke="var(--ws-border, #333)" strokeWidth="6" />
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`}
        transform="rotate(-90 36 36)"
      />
      <text
        x="36"
        y="40"
        textAnchor="middle"
        fontSize="14"
        fontWeight="600"
        fill="var(--ws-text, #ddd)"
        fontFamily="var(--ws-mono, monospace)"
      >
        {pct}
      </text>
    </svg>
  )
}

function HeroLegLine({
  label,
  icon,
  leg,
  describe,
}: {
  label:    string
  icon:     string
  leg:      { legIndex: number; reason?: string } | null
  describe: (idx: number) => string
}) {
  return (
    <div>
      <div className="ws-dim" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>
        {label}
      </div>
      {leg ? (
        <div style={{ fontSize: 13 }}>
          {icon} {describe(leg.legIndex)}
          {leg.reason && (
            <div className="ws-dim" style={{ fontSize: 11, marginTop: 2 }}>{leg.reason}</div>
          )}
        </div>
      ) : (
        <div className="ws-dim" style={{ fontSize: 11, fontStyle: "italic" }}>(none clearly stand out)</div>
      )}
    </div>
  )
}

function SummaryChip({
  tone,
  icon,
  label,
  tooltip,
}: {
  tone: "good" | "neutral" | "watch"
  icon: string
  label: string
  tooltip?: string
}) {
  const color =
    tone === "good"  ? "var(--ws-positive)" :
    tone === "watch" ? "var(--ws-warn)" :
                       "var(--ws-text-dim, #aaa)"
  return (
    <span
      className="ws-pill"
      title={tooltip}
      style={{ fontSize: 11, pointerEvents: tooltip ? "auto" : "none", borderColor: color, color }}
    >
      {icon} {label}
    </span>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Detail subcomponents (preserved verbatim from BNSB-1A for forensic mode)    */
/* ─────────────────────────────────────────────────────────────────────────── */
function SectionBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div className="ws-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Row({ kind, children }: { kind: "positive" | "warn" | "dim"; children: ReactNode }) {
  const color =
    kind === "positive" ? "var(--ws-positive)" :
    kind === "warn"     ? "var(--ws-warn)" :
                          "var(--ws-text-dim)"
  return (
    <div style={{ fontSize: 12, lineHeight: 1.5, color }}>
      {children}
    </div>
  )
}

function Dim({ children }: { children: ReactNode }) {
  return <span className="ws-dim" style={{ fontSize: 11, fontStyle: "italic" }}>{children}</span>
}
