import { useEffect, useState } from "react"
import { api } from "../api"
import { VerdictCard } from "../components/VerdictCard"
import { SAMPLE_SLIPS, type SampleSlipDef } from "../sampleSlips"
import type {
  AiSlip,
  AiSlips,
  SportState,
  ScreenshotIngestResult,
  ScreenshotIngestResponse,
} from "../types"
import { fmtOdds, compactStat, teamAbbrev } from "../utils"

/**
 * Phase BNSB-1B (BNSB-1B-1 + 1B-2 + 1B-3 + 1B-4 + 1B-8 + 1B-9 + 1B-10):
 * AnalyzeSlipView — bettor-native interaction architecture.
 *
 * What changed vs BNSB-1A:
 *   • BNSB-1B-1: Path picker is the landing surface. No JSON wall first.
 *                Four cards: Build / Borrow / Paste / Sample. The Build card
 *                routes to the existing Bet Builder tab — anti-fabrication:
 *                we do not pretend a build-leg-by-leg flow exists here.
 *   • BNSB-1B-2: Free-text fallback REMOVED — `{ rawText: raw }` was a
 *                fabricated UX promise (backend has no rawText handler;
 *                see normalizeIngestedSlip.js:260). Paste path is JSON-only
 *                with honest copy.
 *   • BNSB-1B-3: Borrow path lists state.aiSlips (already in workstation
 *                state — NO new fetches) for 1-click analysis.
 *   • BNSB-1B-4: Sample starter cards consume canonical fixture slips from
 *                sampleSlips.ts. 1-click loads + auto-analyzes.
 *   • BNSB-1B-8: Accepts optional `pendingSlip` prop. When non-null, the slip
 *                is auto-loaded + analyzed (consumed once, then cleared via
 *                onPendingConsumed callback). Drives the "Analyze this"
 *                affordance on SlipCard.
 *   • BNSB-1B-9: Internal IDs / archetype taxonomy stripped from bettor view.
 *                Submission hash + archetype string only shown in forensic
 *                drill-down.
 *   • BNSB-1B-10: Loading / empty / error states re-toned bettor-native.
 *
 * Anti-fabrication doctrine (preserved):
 *   • Frontend does ZERO slip parsing. Every path produces a backend-valid
 *     payload (no rawText fabrication).
 *   • If backend returns `verdict = null` we render that honestly.
 *   • Every visible string traces to a canonical source.
 */

type PathChoice = "menu" | "build" | "borrow" | "paste" | "sample" | "result"

export function AnalyzeSlipView({
  state,
  pendingSlip,
  onPendingConsumed,
  onNavigate,
}: {
  state: SportState | null
  pendingSlip?: AiSlip | null
  onPendingConsumed?: () => void
  onNavigate?: (section: string) => void
}) {
  const [path, setPath]       = useState<PathChoice>("menu")
  const [text, setText]       = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [resp, setResp]       = useState<ScreenshotIngestResponse | null>(null)

  const sport     = state?.sport
  const slateDate = state?.date

  // ── BNSB-1B-8: consume pending slip from cross-section nav ─────────────────
  useEffect(() => {
    if (!pendingSlip) return
    // Convert the AI slip into a backend-valid ingest payload + auto-submit.
    void submitPayload({
      slip: aiSlipToIngestShape(pendingSlip),
      sourceType:  "internal",
      sourceLabel: `borrowed from AI ${pendingSlip.tier} parlay`,
    })
    setPath("result")
    onPendingConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSlip])

  async function submitPayload(body: Parameters<typeof api.screenshotsAnalyze>[0]) {
    setError(null)
    setResp(null)
    try {
      setLoading(true)
      const out = await api.screenshotsAnalyze({
        sport,
        slateDate,
        sourceType:  body.sourceType  ?? "personal",
        sourceLabel: body.sourceLabel ?? "AnalyzeSlipView",
        attribution: body.attribution ?? "operator",
        slip:  body.slip,
        slips: body.slips,
      })
      setResp(out)
      setPath("result")
    } catch (e: any) {
      // BNSB-1B-10: bettor-native error copy. Engineer-detail kept for forensic
      // mode via tooltip on the friendly headline.
      const detail = String(e?.message || e)
      if (/fail|fetch|network|503|connection|refused/i.test(detail)) {
        setError("The analysis service is offline right now. Try again in a moment.")
      } else if (/parse|JSON|syntax/i.test(detail)) {
        setError("That slip wasn't in a shape I could read. Try the Borrow or Sample path.")
      } else {
        setError("Something went wrong analyzing this slip. Try the Borrow or Sample path.")
      }
      // Console-only forensic detail.
      console.warn("[AnalyzeSlipView] submit error:", detail)
    } finally {
      setLoading(false)
    }
  }

  async function submitPasted() {
    const raw = text.trim()
    if (!raw) {
      setError("Paste a slip first — JSON shape only (Borrow or Sample if you don't have JSON).")
      return
    }
    // BNSB-1B-2: free-text fallback REMOVED. JSON-only — honest about it.
    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch {
      setError("That isn't valid JSON. Try the Borrow path (one click on tonight's parlays) or load a Sample.")
      return
    }
    const body: Parameters<typeof api.screenshotsAnalyze>[0] = {}
    if (Array.isArray(parsed)) body.slips = parsed
    else                       body.slip  = parsed
    body.sourceType  = "personal"
    body.sourceLabel = "pasted JSON"
    await submitPayload(body)
  }

  function reset() {
    setText("")
    setResp(null)
    setError(null)
    setPath("menu")
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <h2 className="ws-section-title">
        📸 Check My Slip
        <small>
          {sport ? `${sport.toUpperCase()} · ${slateDate}` : "select a sport first"}
        </small>
      </h2>

      {/* Path picker — BNSB-1B-1 */}
      {path === "menu" && (
        <PathPicker
          state={state}
          onChoose={(p) => {
            setError(null)
            setResp(null)
            if (p === "build") {
              // BNSB-1B-1: Build path routes to the existing Bet Builder tab
              // (which actually IS a build flow — anti-fabrication: we don't
              // invent a new build flow here; BNSB-1B-5 is operator-deferred).
              onNavigate?.("builder")
              return
            }
            setPath(p)
          }}
        />
      )}

      {/* Borrow Tonight's Slip — BNSB-1B-3 */}
      {path === "borrow" && (
        <BorrowTonight
          aiSlips={state?.aiSlips}
          loading={loading}
          onCancel={() => setPath("menu")}
          onPick={(slip) => {
            void submitPayload({
              slip: aiSlipToIngestShape(slip),
              sourceType:  "internal",
              sourceLabel: `borrowed from AI ${slip.tier} parlay`,
            })
          }}
        />
      )}

      {/* Sample Starter Tickets — BNSB-1B-4 */}
      {path === "sample" && (
        <SampleStarters
          loading={loading}
          onCancel={() => setPath("menu")}
          onPick={(s) => {
            void submitPayload({
              slip: s.payload,
              sourceType:  "internal",
              sourceLabel: `sample · ${s.title}`,
              sport:       s.sport,
            })
          }}
        />
      )}

      {/* Paste Structured Slip — BNSB-1B-2 (honest, JSON-only, no rawText) */}
      {path === "paste" && (
        <PastePanel
          value={text}
          onChange={setText}
          loading={loading}
          onCancel={() => setPath("menu")}
          onSubmit={submitPasted}
        />
      )}

      {/* Result — BNSB-1B-9 + 1B-10 (taxonomy stripped, bettor-native tone) */}
      {path === "result" && (
        <ResultPanel
          loading={loading}
          error={error}
          resp={resp}
          onAnalyzeAnother={reset}
        />
      )}

      {/* Error surface for non-result paths (paste path inline) */}
      {error && path !== "result" && (
        <div className="ws-card" style={{ borderLeft: "3px solid var(--ws-negative)", marginTop: 8 }}>
          <span style={{ color: "var(--ws-negative)", fontSize: 12 }}>{error}</span>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* PathPicker — BNSB-1B-1                                                      */
/* ─────────────────────────────────────────────────────────────────────────── */
function PathPicker({
  state,
  onChoose,
}: {
  state: SportState | null
  onChoose: (p: Exclude<PathChoice, "menu" | "result">) => void
}) {
  const tonightCount = state
    ? state.aiSlips.safe.length + state.aiSlips.balanced.length +
      state.aiSlips.aggressive.length + state.aiSlips.lotto.length
    : 0

  return (
    <div className="ws-card" style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, marginBottom: 10 }}>
        How do you want to check a slip?
      </div>
      <div
        className="ws-grid"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 10,
        }}
      >
        <PickerCard
          icon="🛠"
          title="Build a slip"
          blurb="Compose legs from tonight's board in the Bet Builder."
          onClick={() => onChoose("build")}
        />
        <PickerCard
          icon="🔁"
          title="Borrow tonight's slip"
          blurb={
            tonightCount > 0
              ? `Pick one of tonight's ${tonightCount} AI parlay${tonightCount === 1 ? "" : "s"} — analyzed in one click.`
              : "No AI parlays loaded yet — refresh tonight's slate first."
          }
          disabled={tonightCount === 0}
          onClick={() => onChoose("borrow")}
        />
        <PickerCard
          icon="📋"
          title="Paste a slip (JSON)"
          blurb="Paste a structured slip JSON from your sportsbook or notes."
          onClick={() => onChoose("paste")}
        />
        <PickerCard
          icon="🎯"
          title="Try a sample"
          blurb="Four canonical demo slips — see what the engine reads."
          onClick={() => onChoose("sample")}
        />
      </div>
    </div>
  )
}

function PickerCard({
  icon,
  title,
  blurb,
  disabled,
  onClick,
}: {
  icon:    string
  title:   string
  blurb:   string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      className="ws-card"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        textAlign: "left",
        padding: 12,
        cursor:    disabled ? "not-allowed" : "pointer",
        opacity:   disabled ? 0.55 : 1,
        background: "transparent",
        border:    "1px solid var(--ws-border, #444)",
      }}
    >
      <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
      <div className="ws-dim" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>
        {blurb}
      </div>
    </button>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* BorrowTonight — BNSB-1B-3                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */
function BorrowTonight({
  aiSlips,
  loading,
  onCancel,
  onPick,
}: {
  aiSlips: AiSlips | undefined
  loading: boolean
  onCancel: () => void
  onPick:   (slip: AiSlip) => void
}) {
  const tiers: Array<{ key: keyof AiSlips; label: string; emoji: string }> = [
    { key: "safe",       label: "Core",       emoji: "🛡️" },
    { key: "balanced",   label: "Value Mix",  emoji: "⚖️" },
    { key: "aggressive", label: "Fire Shots", emoji: "🔥" },
    { key: "lotto",      label: "Moon Shots", emoji: "🌙" },
  ]
  return (
    <div className="ws-card" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Borrow tonight's slip</span>
        <button className="ws-btn" onClick={onCancel} disabled={loading} style={{ fontSize: 11 }}>
          ← back
        </button>
      </div>
      {tiers.map((t) => {
        const slips = (aiSlips?.[t.key] || []) as AiSlip[]
        if (!slips.length) return null
        return (
          <div key={t.key} style={{ marginBottom: 10 }}>
            <div className="ws-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
              {t.emoji} {t.label}
            </div>
            {slips.slice(0, 4).map((s) => (
              <BorrowRow key={s.id} slip={s} loading={loading} onPick={() => onPick(s)} />
            ))}
          </div>
        )
      })}
      {tiers.every((t) => !(aiSlips?.[t.key] || []).length) && (
        <div className="ws-empty">No AI parlays loaded yet — refresh tonight's slate first.</div>
      )}
    </div>
  )
}

function BorrowRow({
  slip,
  loading,
  onPick,
}: {
  slip:    AiSlip
  loading: boolean
  onPick:  () => void
}) {
  const american = slip.combinedAmericanOdds >= 0 ? `+${slip.combinedAmericanOdds}` : `${slip.combinedAmericanOdds}`
  return (
    <div
      style={{
        display:        "flex",
        alignItems:     "center",
        gap:            8,
        padding:        "6px 4px",
        borderTop:      "1px solid var(--ws-border, #333)",
        fontSize:       12,
      }}
    >
      <span className="ws-mono">{american}</span>
      <span className="ws-dim">{slip.legCount}-leg</span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {slip.legs.map((l) => `${l.player} ${l.side}${l.line != null ? ` ${l.line}` : ""}`).join(" + ")}
      </span>
      <button className="ws-btn ws-btn-primary" disabled={loading} onClick={onPick} style={{ fontSize: 11 }}>
        🔍 Check this
      </button>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* SampleStarters — BNSB-1B-4                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */
function SampleStarters({
  loading,
  onCancel,
  onPick,
}: {
  loading: boolean
  onCancel: () => void
  onPick:   (s: SampleSlipDef) => void
}) {
  return (
    <div className="ws-card" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Try a sample ticket</span>
        <button className="ws-btn" onClick={onCancel} disabled={loading} style={{ fontSize: 11 }}>
          ← back
        </button>
      </div>
      <div className="ws-dim" style={{ fontSize: 11, marginBottom: 8 }}>
        Each sample demonstrates a canonical signal class the engine reads.
        Useful for learning what the analysis surfaces.
      </div>
      <div
        className="ws-grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}
      >
        {SAMPLE_SLIPS.map((s) => (
          <button
            key={s.key}
            className="ws-card"
            disabled={loading}
            onClick={() => onPick(s)}
            style={{
              textAlign: "left",
              padding: 10,
              cursor: loading ? "wait" : "pointer",
              background: "transparent",
              border: "1px solid var(--ws-border, #444)",
            }}
          >
            <div style={{ fontSize: 18, marginBottom: 2 }}>{s.emoji}</div>
            <div style={{ fontWeight: 600, fontSize: 12 }}>{s.title}</div>
            <div className="ws-dim" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>
              {s.blurb}
            </div>
            <div className="ws-dim" style={{ fontSize: 10, marginTop: 6, fontStyle: "italic" }}>
              {s.signalNote}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* PastePanel — BNSB-1B-2 (rawText fabrication removed)                        */
/* ─────────────────────────────────────────────────────────────────────────── */
function PastePanel({
  value,
  onChange,
  loading,
  onCancel,
  onSubmit,
}: {
  value:    string
  onChange: (v: string) => void
  loading:  boolean
  onCancel: () => void
  onSubmit: () => void
}) {
  return (
    <div className="ws-card" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Paste a structured slip</span>
        <button className="ws-btn" onClick={onCancel} disabled={loading} style={{ fontSize: 11 }}>
          ← back
        </button>
      </div>
      <div style={{ fontSize: 12, marginBottom: 6 }}>
        Paste a slip as JSON. The analyzer needs structured fields (player, statFamily, side, line, odds) —
        if you don't have JSON, try the <strong>Borrow</strong> or <strong>Sample</strong> path instead.
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={8}
        placeholder={`{\n  "legs": [\n    { "player": "Aaron Judge", "statFamily": "totalBases", "side": "OVER", "line": 1.5, "odds": -110 }\n  ]\n}`}
        style={{
          width: "100%",
          fontFamily: "var(--ws-mono)",
          fontSize: 12,
          padding: 8,
          border: "1px solid var(--ws-border, #444)",
          background: "var(--ws-input-bg, transparent)",
          color: "var(--ws-text, inherit)",
          borderRadius: 4,
          resize: "vertical",
        }}
      />
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        <button className="ws-btn ws-btn-primary" onClick={onSubmit} disabled={loading}>
          {loading ? "Reading your slip…" : "🔍 Check this slip"}
        </button>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* ResultPanel — BNSB-1B-9 (taxonomy stripped) + 1B-10 (tone)                  */
/* ─────────────────────────────────────────────────────────────────────────── */
function ResultPanel({
  loading,
  error,
  resp,
  onAnalyzeAnother,
}: {
  loading: boolean
  error:   string | null
  resp:    ScreenshotIngestResponse | null
  onAnalyzeAnother: () => void
}) {
  if (loading) {
    return (
      <div className="ws-card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13 }}>Reading your slip…</div>
        <div className="ws-dim" style={{ fontSize: 11, marginTop: 4 }}>
          The analyzer is mapping each leg to canonical signals.
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="ws-card" style={{ marginBottom: 12, borderLeft: "3px solid var(--ws-negative)" }}>
        <div style={{ color: "var(--ws-negative)", fontSize: 13 }}>{error}</div>
        <div style={{ marginTop: 8 }}>
          <button className="ws-btn" onClick={onAnalyzeAnother} style={{ fontSize: 12 }}>
            ← Try a different path
          </button>
        </div>
      </div>
    )
  }

  if (!resp) {
    return (
      <div className="ws-card" style={{ marginBottom: 12 }}>
        <div className="ws-dim" style={{ fontSize: 12 }}>Pick a path above to check a slip.</div>
      </div>
    )
  }

  const results = resp.results || []
  return (
    <div>
      {results.map((r, i) => (
        <ResultBlock key={r.slipId || i} result={r} />
      ))}
      {!results.length && (
        <div className="ws-card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13 }}>I couldn't read that one.</div>
          <div className="ws-dim" style={{ fontSize: 12, marginTop: 4 }}>
            Try the <strong>Borrow</strong> path (1-click on tonight's parlays) or a <strong>Sample</strong>.
          </div>
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <button className="ws-btn" onClick={onAnalyzeAnother} style={{ fontSize: 12 }}>
          ← Check another slip
        </button>
      </div>
    </div>
  )
}

function ResultBlock({ result }: { result: ScreenshotIngestResult }) {
  // BNSB-1B-9: internal hashes + archetype taxonomy never reach the default
  // bettor surface. They remain available in tooltip / forensic mode.
  const legCount = typeof result.legs === "number" ? result.legs : null
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        className="ws-supporting-label"
        style={{ marginBottom: 4 }}
        title={
          // Forensic detail in hover only — preserves ops access without
          // surfacing build-server vocabulary to the bettor.
          `slipId ${result.slipId || "—"}\n` +
          `sport ${result.sport || "—"}\n` +
          `archetype ${result.archetype || "—"}\n` +
          `compositeScore ${typeof result.compositeScore === "number" ? result.compositeScore.toFixed(2) : "—"}`
        }
      >
        Your slip
        {result.sport ? ` · ${result.sport.toUpperCase()}` : ""}
        {legCount != null ? ` · ${legCount}-leg` : ""}
        {result.sharpSignal ? " · 🟢 sharp construction" : ""}
        {result.baitSignal ? " · ⚠ bait construction" : ""}
      </div>
      {result.ok ? (
        <VerdictCard verdict={result.verdict ?? null} legsParsed={result.legsParsed} />
      ) : (
        <div className="ws-card" style={{ borderLeft: "3px solid var(--ws-negative)" }}>
          <div style={{ color: "var(--ws-negative)", fontSize: 13 }}>I couldn't read that slip.</div>
          <div className="ws-dim" style={{ fontSize: 11, marginTop: 4 }}>
            Try the Borrow or Sample path for a known-good shape.
          </div>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* AI slip → backend ingest shape helper                                       */
/* (BNSB-1B-3 + 1B-8 — canonical-only field projection)                        */
/* ─────────────────────────────────────────────────────────────────────────── */
function aiSlipToIngestShape(slip: AiSlip): Record<string, unknown> {
  return {
    legs: slip.legs.map((l) => ({
      player:      l.player,
      team:        l.team,
      statFamily:  l.statFamily,
      propType:    l.propType,
      side:        l.side,
      line:        l.line,
      odds:        l.odds,
      sportsbook:  l.book,
      eventId:     l.eventId,
      game:        l.matchup,
    })),
    sportsbook: slip.legs[0]?.book,
  }
}

// Re-export utilities used in the borrow row for label tightness — kept local
// to avoid an unused-import noise warning.
void fmtOdds; void compactStat; void teamAbbrev
