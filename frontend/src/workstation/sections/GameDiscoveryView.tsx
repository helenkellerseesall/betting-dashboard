import { useMemo, useState } from "react"
import type { SportState, Candidate } from "../types"
import {
  buildGameEcosystems,
  composeExplosiveSentence,
  groupByPropFamily,
  buildPlayerLadders,
  PROP_FAMILIES,
  DISCOVERY_LENSES,
  applyLens,
  type GameEcosystem,
  type DiscoveryLens,
  type PropFamilyKey,
  type PlayerLadder,
} from "../gameEcosystem"
import { fmtOdds, fmtPct, teamAbbrev, compactStat } from "../utils"
import { useBuilder } from "../builderContext"
import { ScreenshotIntake } from "../components/ScreenshotIntake"

/**
 * Phase BNDS-1A — Bettor-Native Discovery Surface.
 *
 * GAME-FIRST discovery view that exposes:
 *   BNDS-1A-1 — Game Environment Hub (cards with rich derived ecology)
 *   BNDS-1A-2 — Expandable prop rails (by family, collapsed by default)
 *   BNDS-1A-3 — Ladder Explorer (per-player ecosystem within expanded game)
 *   BNDS-1A-4 — Explosive game sentence (bettor-readable env compression)
 *   BNDS-1A-5 — Density upgrade (compact cards + expandable surfaces)
 *   BNDS-1A-6 — Discovery navigation lenses (Top / Explosive / Ladder /
 *               Strongest / Contradiction / HR / K)
 *   BNDS-1A-7 — Screenshot intake foundation (cmd+v + drag/drop staging)
 *
 * Anti-fabrication discipline preserved throughout:
 *   • Every derived field comes from canonical candidate fields.
 *   • No env tag is invented; missing tags render dimmed.
 *   • No fake intelligence; no LLM; no hype copy; no emojis-as-marketing.
 *   • Hard filtering NEVER happens upstream — lens is a sort/filter on
 *     the game-card array; underlying prop rails always render full
 *     breadth (BNDS-1A-2 explicit constraint: "Do NOT hard-filter props
 *     away early.").
 */
export function GameDiscoveryView({ state }: { state: SportState | null }) {
  const [lens, setLens]               = useState<DiscoveryLens>("all")
  const [expandedGame, setExpandedGame] = useState<string | null>(null)
  const [search, setSearch]           = useState("")

  // ── Memoized game ecosystems ─────────────────────────────────────────────
  // Phase BNDS-1B: prefer the broader `discoveryCandidates` pool when the
  // backend provides it (canonical-validated, looser per-player/per-game/per-
  // stat caps); gracefully fall back to the elite `candidates` pool on legacy
  // backends that haven't shipped BNDS-1B yet. The Discover surface is the
  // ONLY consumer of discoveryCandidates — every other tab keeps the tight
  // elite pool unchanged.
  const { games, candidates, sourceLabel } = useMemo(() => {
    const broad = state?.discoveryCandidates
    const c = (Array.isArray(broad) && broad.length > 0) ? broad : (state?.candidates || [])
    return {
      candidates: c,
      games:      buildGameEcosystems(c),
      sourceLabel: (Array.isArray(broad) && broad.length > 0)
        ? `discovery pool · ${broad.length} canonical props`
        : `elite pool · ${(state?.candidates || []).length} canonical props (broader pool unavailable from backend)`,
    }
  }, [state])

  const filteredGames = useMemo(() => {
    const lensed = applyLens(games, lens)
    if (!search.trim()) return lensed
    const q = search.trim().toLowerCase()
    return lensed.filter((g) =>
      g.matchup.toLowerCase().includes(q) ||
      g.teams.some((t) => t.toLowerCase().includes(q)) ||
      g.topPlayers.some((p) => p.player.toLowerCase().includes(q))
    )
  }, [games, lens, search])

  if (!state) return <div className="ws-empty">Loading slate…</div>

  return (
    <div>
      {/* ── Section header ──────────────────────────────────────────────── */}
      <h2 className="ws-section-title">
        🗺 Discover
        <small>
          {state.sport.toUpperCase()} · {state.date} · {games.length} game{games.length === 1 ? "" : "s"} · {candidates.length} props
        </small>
      </h2>
      <div className="ws-dim" style={{ fontSize: 11, marginBottom: 8, fontStyle: "italic" }}>
        {sourceLabel}
      </div>

      {/* ── BNDS-1A-7: Screenshot intake foundation ─────────────────────── */}
      <ScreenshotIntake />

      {/* ── BNDS-1A-6: Discovery lenses ─────────────────────────────────── */}
      <div className="ws-card" style={{ marginBottom: 12 }}>
        <div className="ws-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
          Discovery lenses
        </div>
        <div className="ws-filters" style={{ gap: 6, flexWrap: "wrap" }}>
          {DISCOVERY_LENSES.map((l) => (
            <button
              key={l.key}
              className={`ws-pill ${lens === l.key ? "active" : ""}`}
              onClick={() => setLens(l.key)}
              title={l.hint}
              style={{ fontSize: 11 }}
            >
              {l.label}
            </button>
          ))}
          <input
            className="ws-input"
            placeholder="search team or player…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginLeft: "auto", fontSize: 12, minWidth: 200 }}
          />
        </div>
        <div className="ws-dim" style={{ fontSize: 11, marginTop: 6, fontStyle: "italic" }}>
          Lenses sort/filter the game cards only — every game's full prop breadth stays available when expanded.
        </div>
      </div>

      {/* ── BNDS-1A-1: Game cards grid ──────────────────────────────────── */}
      {filteredGames.length === 0 ? (
        <div className="ws-empty">
          No games match this lens / search. Try the All-games lens to see the full slate.
        </div>
      ) : (
        <div
          className="ws-grid"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}
        >
          {filteredGames.map((g) => (
            <GameCard
              key={g.eventId}
              eco={g}
              expanded={expandedGame === g.eventId}
              onToggle={() => setExpandedGame((prev) => prev === g.eventId ? null : g.eventId)}
              candidates={candidates}
            />
          ))}
        </div>
      )}

      {/* ── Footer hint ─────────────────────────────────────────────────── */}
      <div className="ws-dim" style={{ fontSize: 11, marginTop: 18, fontStyle: "italic" }}>
        This view exposes breadth. Curated picks live in Tonight's Edge; analyzed slips live in Check My Slip.
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* BNDS-1A-1 — GameCard                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */
function GameCard({
  eco,
  expanded,
  onToggle,
  candidates,
}: {
  eco:        GameEcosystem
  expanded:   boolean
  onToggle:   () => void
  candidates: Candidate[]
}) {
  const sentence = composeExplosiveSentence(eco)

  // Pre-compute the per-game candidate slice for expanded panels (avoid repeating filter)
  const inGame = useMemo(
    () => candidates.filter((c) => String(c.eventId || "") === eco.eventId),
    [candidates, eco.eventId]
  )

  return (
    <div
      className="ws-card"
      style={{
        padding: 10,
        borderLeft: eco.isExplosive ? "3px solid var(--ws-positive)" : "3px solid transparent",
      }}
    >
      {/* Header — clickable to expand */}
      <button
        onClick={onToggle}
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          width: "100%",
          textAlign: "left",
          cursor: "pointer",
          color: "var(--ws-text, inherit)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{eco.matchup}</span>
          {eco.isExplosive && (
            <span className="ws-mood-pill good" style={{ fontSize: 10 }}>explosive</span>
          )}
          {eco.hasDisagreement && (
            <span className="ws-mood-pill watch" style={{ fontSize: 10 }} title="Books disagree materially on at least one prop (EXPL-1 consensusConfidence < 0.6).">
              book disagreement
            </span>
          )}
          <span className="ws-dim" style={{ fontSize: 11, marginLeft: "auto" }}>
            {expanded ? "▾" : "▸"}
          </span>
        </div>

        {/* Strip line — counts */}
        <div className="ws-dim" style={{ fontSize: 11, marginBottom: 4 }}>
          {eco.candidateCount} prop{eco.candidateCount === 1 ? "" : "s"} ·
          {" "}{eco.bookCount} book{eco.bookCount === 1 ? "" : "s"}
          {eco.startTime ? ` · ${eco.startTime}` : ""}
          {eco.sport ? ` · ${eco.sport.toUpperCase()}` : ""}
        </div>

        {/* Implied totals strip — canonical-only render */}
        {(eco.gameTotal != null || eco.avgImpliedTeamTotal != null) && (
          <div className="ws-dim" style={{ fontSize: 11, marginBottom: 4 }}>
            {eco.gameTotal != null && `game total ${eco.gameTotal.toFixed(1)}`}
            {eco.gameTotal != null && eco.avgImpliedTeamTotal != null && " · "}
            {eco.avgImpliedTeamTotal != null && `avg TT ${eco.avgImpliedTeamTotal.toFixed(1)}`}
          </div>
        )}

        {/* Per-team implied totals (when both present) */}
        {Object.keys(eco.impliedTeamTotals).length > 0 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
            {Object.entries(eco.impliedTeamTotals).map(([team, tt]) => (
              <span key={team} className="ws-pill" style={{ fontSize: 11, pointerEvents: "none" }}>
                {team} {tt.toFixed(1)}
              </span>
            ))}
          </div>
        )}

        {/* Env tag chips — canonical only, never invented */}
        <div style={{ display: "flex", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
          {eco.hrEnvironmentTag === "HR_FRIENDLY" && (
            <span className="ws-pill" style={{ fontSize: 10, pointerEvents: "none", color: "var(--ws-positive)" }}>HR-friendly park</span>
          )}
          {eco.hrEnvironmentTag === "HR_SUPPRESSING" && (
            <span className="ws-pill" style={{ fontSize: 10, pointerEvents: "none", color: "var(--ws-warn)" }}>HR-suppressing</span>
          )}
          {eco.windDirectionTag && (
            <span className="ws-pill" style={{ fontSize: 10, pointerEvents: "none" }}>wind {eco.windDirectionTag.replace(/_/g, " ")}</span>
          )}
          {eco.contextualTags.slice(0, 3).map((t) => (
            <span key={t} className="ws-pill" style={{ fontSize: 10, pointerEvents: "none" }}>{t}</span>
          ))}
        </div>

        {/* BNDS-1A-4: Explosive sentence */}
        {sentence ? (
          <div style={{ fontSize: 12, lineHeight: 1.45, marginTop: 4 }}>
            {sentence}
          </div>
        ) : (
          <div className="ws-dim" style={{ fontSize: 11, fontStyle: "italic", marginTop: 4 }}>
            Standard environment — no canonical signals fired for this game.
          </div>
        )}

        {/* Top players strip */}
        {eco.topPlayers.length > 0 && (
          <div className="ws-dim" style={{ fontSize: 11, marginTop: 6 }}>
            most-propped:{" "}
            {eco.topPlayers.map((p, i) => (
              <span key={p.player}>
                {p.player}
                {p.team && ` ${teamAbbrev(p.team)}`}
                <span className="ws-dim"> ({p.count})</span>
                {i < eco.topPlayers.length - 1 ? " · " : ""}
              </span>
            ))}
          </div>
        )}
      </button>

      {/* ── Expanded content ────────────────────────────────────────────── */}
      {expanded && (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--ws-border, #333)", paddingTop: 10 }}>
          {/* BNDS-1A-2: Prop family rails */}
          <PropRails candidates={inGame} sport={eco.sport} />

          {/* BNDS-1A-3: Ladder explorer */}
          <LadderExplorer eco={eco} candidates={candidates} />
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* BNDS-1A-2 — Prop Family Rails                                               */
/* Each rail collapsed by default; expandable; sortable; locally searchable.    */
/* Critical anti-curation: never hard-filters props upstream.                   */
/* ═══════════════════════════════════════════════════════════════════════════ */
function PropRails({ candidates, sport }: { candidates: Candidate[]; sport: "mlb" | "nba" | null }) {
  const byFamily = useMemo(() => groupByPropFamily(candidates), [candidates])
  const railOrder = PROP_FAMILIES.filter((d) => d.sport === "any" || (sport == null) || d.sport === sport)

  return (
    <div style={{ marginBottom: 10 }}>
      <div className="ws-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
        Prop family rails ({candidates.length} props total)
      </div>
      {railOrder.map((def) => {
        const list = byFamily.get(def.key) || []
        if (list.length === 0) return null
        return <PropRail key={def.key} icon={def.icon} label={def.label} candidates={list} />
      })}
    </div>
  )
}

function PropRail({
  icon,
  label,
  candidates,
}: {
  icon:       string
  label:      string
  candidates: Candidate[]
}) {
  const [open, setOpen]     = useState(false)
  const [sort, setSort]     = useState<"edge" | "odds" | "modelProb" | "line">("edge")
  const [q, setQ]           = useState("")
  const builder = useBuilder()

  const rows = useMemo(() => {
    const filtered = q.trim()
      ? candidates.filter((c) =>
          `${c.player || ""} ${c.team || ""} ${c.book || c.sportsbook || ""}`.toLowerCase().includes(q.trim().toLowerCase())
        )
      : candidates
    return [...filtered].sort((a, b) => {
      const av = sort === "edge"      ? Number(a.edge ?? a.edgeProbability ?? 0)
              : sort === "modelProb"  ? Number(a.modelProb ?? a.predictedProbability ?? 0)
              : sort === "line"       ? Number(a.line ?? 0)
              :                         Number(a.odds ?? 0)
      const bv = sort === "edge"      ? Number(b.edge ?? b.edgeProbability ?? 0)
              : sort === "modelProb"  ? Number(b.modelProb ?? b.predictedProbability ?? 0)
              : sort === "line"       ? Number(b.line ?? 0)
              :                         Number(b.odds ?? 0)
      return bv - av
    })
  }, [candidates, q, sort])

  return (
    <div style={{ marginBottom: 6, border: "1px solid var(--ws-border, #333)", borderRadius: 4 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          padding: "6px 10px",
          textAlign: "left",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: "var(--ws-text, inherit)",
        }}
      >
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontWeight: 600, fontSize: 12 }}>{label}</span>
        <span className="ws-dim" style={{ fontSize: 11 }}>· {candidates.length} prop{candidates.length === 1 ? "" : "s"}</span>
        <span style={{ marginLeft: "auto", fontSize: 11 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={{ borderTop: "1px solid var(--ws-border, #333)", padding: "6px 8px" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
            <input
              className="ws-input"
              placeholder="search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ fontSize: 11, minWidth: 100, flex: 1 }}
            />
            <select
              className="ws-select"
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              style={{ fontSize: 11 }}
            >
              <option value="edge">edge</option>
              <option value="modelProb">model %</option>
              <option value="odds">odds</option>
              <option value="line">line</option>
            </select>
          </div>
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            {rows.map((c) => {
              const id = c.id || `${c.eventId}|${c.player}|${c.statFamily}|${c.side}|${c.line ?? ""}|${c.book ?? ""}`
              const added = builder.isLegAdded(id)
              const edge = Number(c.edge ?? c.edgeProbability ?? 0)
              return (
                <div
                  key={id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto auto auto",
                    gap: 6,
                    fontSize: 11,
                    padding: "2px 0",
                    borderBottom: "1px solid var(--ws-border-faint, #222)",
                  }}
                >
                  <span>
                    <span className="ws-text-strong">{c.player}</span>
                    {c.team && <span className="ws-dim"> {teamAbbrev(c.team)}</span>}
                    <span className="ws-dim"> · {c.side}{c.line != null ? ` ${c.line}` : ""}</span>
                  </span>
                  <span className="ws-mono">{fmtOdds(c.odds ?? c.oddsAmerican)}</span>
                  <span className={edge >= 0 ? "ws-pos" : "ws-neg"}>{fmtPct(edge)}</span>
                  <span className="ws-dim">{c.book || c.sportsbook || ""}</span>
                  <button
                    className={added ? "ws-btn ws-btn-danger ws-btn-icon" : "ws-btn ws-btn-icon"}
                    onClick={() => added ? builder.removeLeg(id) : builder.addLegFromCandidate(c)}
                    title={added ? "Remove from builder" : "Add to builder"}
                    style={{ fontSize: 11 }}
                  >
                    {added ? "−" : "+"}
                  </button>
                </div>
              )
            })}
            {rows.length === 0 && (
              <div className="ws-dim" style={{ fontSize: 11, fontStyle: "italic", padding: "4px 0" }}>
                no props match this search
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* BNDS-1A-3 — Ladder Explorer                                                 */
/* Surfaces per-player relationship ecosystem: families covered + sides +      */
/* survivability + ecology support + contradiction warnings. NOT prediction.   */
/* ═══════════════════════════════════════════════════════════════════════════ */
function LadderExplorer({ eco, candidates }: { eco: GameEcosystem; candidates: Candidate[] }) {
  const ladders = useMemo(() => buildPlayerLadders(eco, candidates), [eco, candidates])
  // Surface ladders with at least 2 legs (truly "ladders"); single-prop players
  // omitted to focus this surface on ecosystem density.
  const surfaceable = ladders.filter((l) => l.legCount >= 2)
  if (surfaceable.length === 0) {
    return (
      <div style={{ marginTop: 10 }}>
        <div className="ws-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
          Ladder explorer
        </div>
        <div className="ws-dim" style={{ fontSize: 11, fontStyle: "italic" }}>
          No player has 2+ props in this game yet — ladder ecology is thin tonight.
        </div>
      </div>
    )
  }
  return (
    <div style={{ marginTop: 10 }}>
      <div className="ws-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
        Ladder explorer ({surfaceable.length} player{surfaceable.length === 1 ? "" : "s"})
      </div>
      {surfaceable.map((l) => <PlayerLadderBlock key={l.player} ladder={l} />)}
    </div>
  )
}

function PlayerLadderBlock({ ladder }: { ladder: PlayerLadder }) {
  const [open, setOpen] = useState(false)
  const survColor =
    ladder.survivability === "high"    ? "var(--ws-positive)" :
    ladder.survivability === "low"     ? "var(--ws-warn)" :
                                          "var(--ws-text-dim, #aaa)"
  const ecoColor =
    ladder.ecologySupport === "supported" ? "var(--ws-positive)" :
    ladder.ecologySupport === "hostile"   ? "var(--ws-warn)" :
                                             "var(--ws-text-dim, #aaa)"
  return (
    <div style={{ marginBottom: 4, border: "1px solid var(--ws-border, #333)", borderRadius: 4 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          padding: "5px 8px",
          textAlign: "left",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: "var(--ws-text, inherit)",
          fontSize: 12,
        }}
      >
        <span style={{ fontWeight: 600 }}>{ladder.player}</span>
        {ladder.team && <span className="ws-dim">{teamAbbrev(ladder.team)}</span>}
        <span className="ws-dim">· {ladder.legCount} legs across {ladder.familiesPresent.length} {ladder.familiesPresent.length === 1 ? "family" : "families"}</span>
        <span className="ws-pill" style={{ fontSize: 10, pointerEvents: "none", color: survColor }}>survivability {ladder.survivability}</span>
        <span className="ws-pill" style={{ fontSize: 10, pointerEvents: "none", color: ecoColor }}>ecology {ladder.ecologySupport}</span>
        {ladder.hasContradiction && (
          <span className="ws-pill" style={{ fontSize: 10, pointerEvents: "none", color: "var(--ws-warn)" }}>OVER + UNDER conflict</span>
        )}
        <span style={{ marginLeft: "auto" }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={{ borderTop: "1px solid var(--ws-border, #333)", padding: "4px 8px" }}>
          {ladder.legs.map((l, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto auto",
                gap: 6,
                fontSize: 11,
                padding: "2px 0",
              }}
            >
              <span>{compactStat(l.statFamily || l.propType)} {l.side}{l.line != null ? ` ${l.line}` : ""}</span>
              <span className="ws-mono">{fmtOdds(l.odds ?? l.oddsAmerican)}</span>
              <span className={Number(l.edge ?? 0) >= 0 ? "ws-pos" : "ws-neg"}>{fmtPct(Number(l.edge ?? 0))}</span>
              <span className="ws-dim">{l.book || l.sportsbook || ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
