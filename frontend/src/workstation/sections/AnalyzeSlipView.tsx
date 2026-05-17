import { useState } from "react"
import { api } from "../api"
import { VerdictCard } from "../components/VerdictCard"
import type {
  SportState,
  ScreenshotIngestResult,
  ScreenshotIngestResponse,
} from "../types"

/**
 * Phase BNSB-1A (FE-VBI-5..8): AnalyzeSlipView
 *
 * Operator can paste a JSON slip payload OR a free-text slip description and
 * receive the canonical Visual-Betting-Intelligence verdict. Pure pass-through
 * to backend `POST /api/ws/screenshots/ingest`. Frontend does ZERO analysis —
 * the verdict shown comes verbatim from the backend's canonical resolver.
 *
 * Anti-fabrication doctrine:
 *   • If the operator pastes invalid JSON we surface the parse error.
 *   • If a leg cannot be resolved by the canonical resolver, the backend
 *     returns it in `unresolvedLegs` and the verdict renders it transparently.
 *   • The frontend NEVER synthesizes a verdict from text; if backend says
 *     no verdict, we display "no verdict" honestly.
 */
export function AnalyzeSlipView({ state }: { state: SportState | null }) {
  const [text, setText]       = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [resp, setResp]       = useState<ScreenshotIngestResponse | null>(null)

  const sport     = state?.sport
  const slateDate = state?.date

  async function submit() {
    setError(null)
    setResp(null)

    const raw = text.trim()
    if (!raw) {
      setError("Paste a slip JSON object, array, or a free-text slip first.")
      return
    }

    // Try JSON first; fall back to a free-text slip payload that backend
    // resolver will normalize. This is an honest passthrough — no frontend
    // parsing of the text content into prop fields.
    let body: Parameters<typeof api.screenshotsAnalyze>[0] = {
      sport,
      slateDate,
      sourceType: "personal",
      sourceLabel: "AnalyzeSlipView",
      attribution: "operator",
    }
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) body.slips = parsed
      else                       body.slip  = parsed
    } catch {
      // Free-text fallback — backend slip parser will attempt OCR-style parse.
      body.slip = { rawText: raw }
    }

    try {
      setLoading(true)
      const out = await api.screenshotsAnalyze(body)
      setResp(out)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h2 className="ws-section-title">
        📸 Analyze Slip
        <small>
          {sport ? `${sport.toUpperCase()} · ${slateDate}` : "select a sport first"}
        </small>
      </h2>

      <div className="ws-card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, marginBottom: 6 }}>
          Paste a slip as JSON (single object or array), or as free text the
          canonical resolver can normalize. The backend produces the verdict —
          this view is a pure pass-through. Sport &amp; date are pulled from
          the currently selected slate.
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={`Example:\n{\n  "legs": [\n    { "player": "Aaron Judge", "statFamily": "home_runs", "side": "OVER", "line": 0.5, "odds": 320 }\n  ]\n}`}
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
        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
          <button
            className="ws-btn ws-btn-primary"
            onClick={submit}
            disabled={loading}
          >
            {loading ? "Analyzing…" : "🔍 Analyze slip"}
          </button>
          <button
            className="ws-btn"
            onClick={() => { setText(""); setResp(null); setError(null) }}
            disabled={loading}
          >
            Clear
          </button>
          {error && (
            <span style={{ color: "var(--ws-negative)", fontSize: 12 }}>{error}</span>
          )}
        </div>
      </div>

      {resp && (
        <div>
          <div className="ws-dim" style={{ fontSize: 11, marginBottom: 6 }}>
            submissionId {resp.submissionId || "—"} · slipsIngested {resp.slipsIngested ?? 0}
            {resp.error ? ` · error: ${resp.error}` : ""}
          </div>
          {(resp.results || []).map((r, i) => (
            <ResultBlock key={r.slipId || i} result={r} />
          ))}
          {!resp.results?.length && (
            <div className="ws-empty">
              Backend accepted the submission but returned no results — verify the
              slip payload shape (legs[]).
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ResultBlock({ result }: { result: ScreenshotIngestResult }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="ws-supporting-label" style={{ marginBottom: 4 }}>
        Slip #{result.index + 1}
        {result.slipId ? ` · ${result.slipId}` : ""}
        {result.sport ? ` · ${result.sport.toUpperCase()}` : ""}
        {result.archetype ? ` · ${result.archetype}` : ""}
        {typeof result.legs === "number" ? ` · ${result.legs} legs` : ""}
        {result.sharpSignal ? " · 🟢 sharp signal" : ""}
        {result.baitSignal ? " · 🔴 bait signal" : ""}
      </div>
      {result.ok ? (
        <VerdictCard verdict={result.verdict ?? null} legsParsed={result.legsParsed} />
      ) : (
        <div className="ws-card" style={{ borderLeft: "3px solid var(--ws-negative)" }}>
          <strong style={{ color: "var(--ws-negative)" }}>Slip rejected:</strong>{" "}
          {result.error || "backend returned ok=false without error message"}
        </div>
      )}
    </div>
  )
}
