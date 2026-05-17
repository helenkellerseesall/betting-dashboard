import type { ReactNode } from "react"
import type { VbiVerdict } from "../types"

/**
 * Phase BNSB-1A (FE-VBI-3): VerdictCard
 *
 * Renders the canonical Visual-Betting-Intelligence verdict produced by
 * backend `buildSlipAnalysis` and surfaced through the screenshot ingest
 * route. Pure observational. Every field is rendered exactly as the
 * backend returned it; nothing is computed, inferred, or fabricated on
 * the frontend.
 *
 * Empty/absent fields render an honest "(none surfaced)" — we never
 * invent a placeholder verdict, score, or signal.
 *
 * The canonical 12-field verdict shape lives in types.ts (VbiVerdict)
 * and mirrors backend VERDICT_PAYLOAD_SHAPE exactly.
 */
export function VerdictCard({
  verdict,
  legsParsed,
}: {
  verdict: VbiVerdict | null | undefined
  legsParsed?: Array<Record<string, unknown>>
}) {
  if (!verdict) {
    return (
      <div className="ws-card" style={{ marginBottom: 12 }}>
        <div className="ws-dim" style={{ fontSize: 12, fontStyle: "italic" }}>
          No verdict returned for this slip — backend resolver did not produce a verdict
          payload (slip may be unparsed or unsupported sport).
        </div>
      </div>
    )
  }

  // Helper to describe a leg index using parsed leg context when available.
  const describeLeg = (idx: number): string => {
    if (!Array.isArray(legsParsed) || idx < 0 || idx >= legsParsed.length) return `leg ${idx + 1}`
    const leg = legsParsed[idx] as Record<string, unknown>
    const player = typeof leg.player === "string" ? leg.player : null
    const stat   = typeof leg.statFamily === "string" ? leg.statFamily
                : typeof leg.propType   === "string" ? leg.propType : null
    const side   = typeof leg.side === "string" ? leg.side : null
    const line   = typeof leg.line === "number" ? leg.line : null
    const parts: string[] = [`#${idx + 1}`]
    if (player) parts.push(player)
    if (stat)   parts.push(stat)
    if (side)   parts.push(`${side}${line != null ? ` ${line}` : ""}`)
    return parts.join(" · ")
  }

  const coherencePct = Math.round((verdict.ecologicalCoherence || 0) * 100)
  const coherenceTone =
    coherencePct >= 70 ? "good" :
    coherencePct >= 40 ? "neutral" : "watch"

  const covPos = verdict.covarianceProfile?.positiveStacks      || []
  const covPH  = verdict.covarianceProfile?.pitcherHitterConflicts || []
  const covSG  = verdict.covarianceProfile?.sharedGameSuppression  || []

  const expSup = verdict.exploitabilityProfile?.marketSupported    || []
  const expSol = verdict.exploitabilityProfile?.unsupportedSoloEdge || []

  const avDrop = verdict.availabilityProfile?.hardDropOut || []

  const contras = verdict.contradictionFlags || []
  const unres   = verdict.unresolvedLegs     || []
  const sigs    = verdict.signals            || []
  const lang    = verdict.bettorLanguageSummary || []
  const fakeSafe = verdict.fakeSafeRisk || { detected: false, reasons: [] }

  return (
    <div className="ws-card" style={{ marginBottom: 12 }}>
      {/* Verdict summary — single canonical line */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <span className={`ws-mood-pill ${coherenceTone}`} title="VBI ecologicalCoherence — canonical 0-100 reflection of how well the slip's legs co-exist.">
          🌐 coherence {coherencePct}/100
        </span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{verdict.verdictSummary}</span>
        {fakeSafe.detected && (
          <span className="ws-risk-flag" title="VBI flagged this slip as fake-safe — backend reasons listed below.">
            ⚠️ fake-safe risk
          </span>
        )}
      </div>

      {/* Bettor-language phrases — deterministic VBI-2/VBI-4 output */}
      {lang.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {lang.map((p, i) => (
            <span key={`lang-${i}`} className="ws-risk-flag" style={{ fontSize: 11 }}>
              💬 {p}
            </span>
          ))}
        </div>
      )}

      {/* Strongest / weakest leg call-outs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <div className="ws-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Strongest leg</div>
          {verdict.strongestLeg ? (
            <div style={{ fontSize: 12 }}>
              {describeLeg(verdict.strongestLeg.legIndex)}
              {verdict.strongestLeg.reason && (
                <div className="ws-dim" style={{ fontSize: 11 }}>{verdict.strongestLeg.reason}</div>
              )}
            </div>
          ) : (
            <div className="ws-dim" style={{ fontSize: 11, fontStyle: "italic" }}>(none surfaced)</div>
          )}
        </div>
        <div>
          <div className="ws-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Weakest leg</div>
          {verdict.weakestLeg ? (
            <div style={{ fontSize: 12 }}>
              {describeLeg(verdict.weakestLeg.legIndex)}
              {verdict.weakestLeg.reason && (
                <div className="ws-dim" style={{ fontSize: 11 }}>{verdict.weakestLeg.reason}</div>
              )}
            </div>
          ) : (
            <div className="ws-dim" style={{ fontSize: 11, fontStyle: "italic" }}>(none surfaced)</div>
          )}
        </div>
      </div>

      {/* Covariance profile */}
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

      {/* Exploitability profile */}
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

      {/* Availability profile */}
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

      {/* Contradictions */}
      {contras.length > 0 && (
        <SectionBlock title="Contradictions">
          {contras.map((c, i) => (
            <Row key={`con-${i}`} kind="warn">
              ⚠️ {describeLeg(c.legA)} contradicts {describeLeg(c.legB)} — {c.reason}
            </Row>
          ))}
        </SectionBlock>
      )}

      {/* Fake-safe reasons (only when detected) */}
      {fakeSafe.detected && fakeSafe.reasons.length > 0 && (
        <SectionBlock title="Fake-safe reasons">
          {fakeSafe.reasons.map((r, i) => (
            <Row key={`fs-${i}`} kind="warn">⚠️ {r}</Row>
          ))}
        </SectionBlock>
      )}

      {/* Unresolved legs — anti-fabrication transparency */}
      {unres.length > 0 && (
        <SectionBlock title="Unresolved legs (canonical resolver could not match)">
          {unres.map((u, i) => (
            <Row key={`un-${i}`} kind="dim">
              ❓ leg #{u.legIndex + 1} — {u.unresolvedReason}
            </Row>
          ))}
        </SectionBlock>
      )}

      {/* Raw signals — surfaced compact for advanced operators */}
      {sigs.length > 0 && (
        <SectionBlock title={`Raw VBI signals (${sigs.length})`}>
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
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Layout helpers — local-only, single-file scope                              */
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
