"use strict"

/**
 * Phase Visual-Betting-Intelligence-1A — bettorLanguage.js (VBI-4).
 *
 * Pure function — no I/O, no side-effects, no network, no SQLite.
 *
 * Deterministic bettor-language phrase library for screenshot verdicts.
 *
 * Anti-fabrication discipline (REQUIRED — operator gate):
 *   - NO LLM generation.
 *   - NO freeform GPT commentary.
 *   - NO opaque prose.
 *   - EVERY bettor-facing phrase MUST map to a canonical signal id.
 *   - Phrases are static operator-approved strings — extensible only by
 *     adding new entries to SIGNAL_PHRASES under operator review.
 *   - Renderer assembles output deterministically in PRIORITY_ORDER —
 *     no permutation, no shuffling, no model-driven sequencing.
 *
 * Doctrine:
 *   Bettor-native language must remain:
 *     - replay-safe (same input → same output, byte-for-byte)
 *     - deterministic (no RNG, no time-of-day, no model state)
 *     - intelligence-backed (every phrase traces to a canonical signal id)
 *     - explainable (operator can read SIGNAL_PHRASES + see exactly what fires)
 *     - auditable (signal ids appear in verdict.signals; phrases derive from
 *       that array, never independently)
 */

// ── Canonical signal id taxonomy ────────────────────────────────────────────
//
// Every id listed here MUST also be emitted by buildSlipAnalysis.js when the
// corresponding canonical signal is detected. The library NEVER renders a
// phrase for an id not present in verdict.signals — anti-fabrication.

const SIGNAL_IDS = Object.freeze({
  // Per-pair contradictions (MLB-COV-2 / MLB-COV-3 doctrine bridged from
  // Phase MLB-Correlation-Engine-1A canonical engine).
  SHARED_GAME_SUPPRESSION_EXPOSURE: "shared_game_suppression_exposure",
  MLB_PITCHER_HITTER_CONFLICT:      "mlb_pitcher_hitter_conflict",

  // Per-pair positive covariance (canonical pairCorrelationScore === +0.5).
  POSITIVE_OFFENSIVE_STACK:         "positive_offensive_stack",

  // Per-leg exploitability (Phase Market-Exploitation-1A EXPL-1 doctrine).
  MARKET_SUPPORTED_DISAGREEMENT:    "market_supported_disagreement",
  UNSUPPORTED_SOLO_BOOK_EDGE:       "unsupported_solo_book_edge",

  // Per-leg availability (Phase Market-Exploitation-1A EXPL-4 doctrine).
  HARD_DROP_OUT_PLAYER:             "hard_drop_out_player",

  // Per-leg unresolved (VBI-2 anti-fabrication: explicit annotation when
  // canonical mapping fails).
  UNRESOLVED_LEG:                   "unresolved_leg",

  // Per-slip context.
  MARKET_CONTEXT_UNAVAILABLE:       "market_context_unavailable",
  AVAILABILITY_CONTEXT_UNAVAILABLE: "availability_context_unavailable",

  // Per-slip aggregate (composite verdicts).
  FAKE_SAFE_SAME_GAME_EXPOSURE:     "fake_safe_same_game_exposure",
  COHERENT_OFFENSIVE_STACK:         "coherent_offensive_stack",
  STRUCTURAL_CONTRADICTION:         "structural_contradiction",
  NO_REPO_INTELLIGENCE_AVAILABLE:   "no_repo_intelligence_available",
})

// ── Operator-approved canonical phrase library ──────────────────────────────
//
// Operator review surface: change phrases here. Each phrase is bettor-native
// language designed for the operator-visible screenshot verdict layer.

const SIGNAL_PHRASES = Object.freeze({
  [SIGNAL_IDS.SHARED_GAME_SUPPRESSION_EXPOSURE]:
    "This ticket dies together if the game stays quiet — both legs ride the same pitcher/game environment.",
  [SIGNAL_IDS.MLB_PITCHER_HITTER_CONFLICT]:
    "Structural contradiction: pitcher-strikeout over and opposing hitter over bet against each other.",
  [SIGNAL_IDS.POSITIVE_OFFENSIVE_STACK]:
    "This stack reinforces itself offensively — same-team hitter overs benefit from the same opposing pitcher.",
  [SIGNAL_IDS.MARKET_SUPPORTED_DISAGREEMENT]:
    "Multiple books agree this is a real edge — peer consensus backs the disagreement.",
  [SIGNAL_IDS.UNSUPPORTED_SOLO_BOOK_EDGE]:
    "Single-book edge with no peer-book consensus — this looks like sportsbook noise, not real disagreement.",
  [SIGNAL_IDS.HARD_DROP_OUT_PLAYER]:
    "Heads up — this player is canonically OUT. The line should not be in play.",
  [SIGNAL_IDS.UNRESOLVED_LEG]:
    "Could not map this leg to canonical repo intelligence — analysis skipped for this leg.",
  [SIGNAL_IDS.MARKET_CONTEXT_UNAVAILABLE]:
    "No live cross-book market context — exploitability could not be assessed.",
  [SIGNAL_IDS.AVAILABILITY_CONTEXT_UNAVAILABLE]:
    "No live availability context — player status could not be cross-checked.",
  [SIGNAL_IDS.FAKE_SAFE_SAME_GAME_EXPOSURE]:
    "Fake-safe construction: this looks like multiple independent safety paths but is really one ecological event.",
  [SIGNAL_IDS.COHERENT_OFFENSIVE_STACK]:
    "This is a coherent offensive stack — the legs reinforce each other within one favorable environment.",
  [SIGNAL_IDS.STRUCTURAL_CONTRADICTION]:
    "This ticket carries one or more structural contradictions — the legs are betting against each other.",
  [SIGNAL_IDS.NO_REPO_INTELLIGENCE_AVAILABLE]:
    "No repo-native intelligence could be applied — all legs were unresolved.",
})

// ── Deterministic render priority ───────────────────────────────────────────
//
// Highest-stakes phrases first; ambient context phrases last.
// Operator audit: change order here, NOT in renderer logic.

const PRIORITY_ORDER = Object.freeze([
  SIGNAL_IDS.NO_REPO_INTELLIGENCE_AVAILABLE,
  SIGNAL_IDS.STRUCTURAL_CONTRADICTION,
  SIGNAL_IDS.FAKE_SAFE_SAME_GAME_EXPOSURE,
  SIGNAL_IDS.MLB_PITCHER_HITTER_CONFLICT,
  SIGNAL_IDS.SHARED_GAME_SUPPRESSION_EXPOSURE,
  SIGNAL_IDS.HARD_DROP_OUT_PLAYER,
  SIGNAL_IDS.UNSUPPORTED_SOLO_BOOK_EDGE,
  SIGNAL_IDS.COHERENT_OFFENSIVE_STACK,
  SIGNAL_IDS.POSITIVE_OFFENSIVE_STACK,
  SIGNAL_IDS.MARKET_SUPPORTED_DISAGREEMENT,
  SIGNAL_IDS.UNRESOLVED_LEG,
  SIGNAL_IDS.MARKET_CONTEXT_UNAVAILABLE,
  SIGNAL_IDS.AVAILABILITY_CONTEXT_UNAVAILABLE,
])

// ── Renderer ────────────────────────────────────────────────────────────────

/**
 * Render canonical signals into bettor-language strings.
 *
 * @param {Array<{ id, scope, payload }>} signals — verdict.signals from
 *        buildSlipAnalysis.analyzeSlip(). Each entry's `id` must be a
 *        canonical SIGNAL_IDS value (anti-fabrication: unknown ids are
 *        SILENTLY DROPPED — the library never invents a phrase).
 * @param {object} [opts]
 * @param {boolean} [opts.dedupe=true] — collapse repeat ids to one phrase.
 *
 * @returns {Array<string>}  — phrases in PRIORITY_ORDER. Possibly empty.
 *
 * Pure function. Deterministic. Idempotent.
 */
function renderVerdictPhrases(signals, opts = {}) {
  const { dedupe = true } = opts
  if (!Array.isArray(signals)) return []

  // Collect ids that BOTH appear in signals AND have a canonical phrase.
  // Unknown ids → silently dropped (anti-fabrication).
  const idsPresent = new Set()
  const idsOrdered = []
  for (const s of signals) {
    const id = s?.id
    if (!id || !SIGNAL_PHRASES[id]) continue
    if (dedupe) {
      if (idsPresent.has(id)) continue
      idsPresent.add(id)
    }
    idsOrdered.push(id)
  }

  // Deterministic sort: PRIORITY_ORDER position. Ids not in priority list go
  // to the end in their original insertion order (defensive — should not occur
  // because PRIORITY_ORDER covers all SIGNAL_IDS, but anti-fabrication forces
  // explicit handling rather than silent drop).
  const priorityIndex = new Map(PRIORITY_ORDER.map((id, i) => [id, i]))
  idsOrdered.sort((a, b) => {
    const ai = priorityIndex.has(a) ? priorityIndex.get(a) : Number.POSITIVE_INFINITY
    const bi = priorityIndex.has(b) ? priorityIndex.get(b) : Number.POSITIVE_INFINITY
    return ai - bi
  })

  return idsOrdered.map((id) => SIGNAL_PHRASES[id])
}

/**
 * Compose a single one-line operator-visible summary from canonical signals.
 * Deterministic priority pick: first id present in PRIORITY_ORDER wins.
 *
 * @returns {string|null} — one phrase, or null when no canonical signal fires.
 */
function composeVerdictSummary(signals) {
  if (!Array.isArray(signals) || !signals.length) return null
  const present = new Set(signals.map((s) => s?.id).filter(Boolean))
  for (const id of PRIORITY_ORDER) {
    if (present.has(id) && SIGNAL_PHRASES[id]) return SIGNAL_PHRASES[id]
  }
  return null
}

// ── Phase BNSB-1A (FE-VBI-2) — SHORT_SIGNAL_PHRASES for chip labels ─────────
//
// Short operator-approved phrasings for compact UI affordances (contradiction
// chips, ladder slot suffixes, signal badges). Sibling to SIGNAL_PHRASES;
// every canonical signal id with a full phrase ALSO has a short variant.
// NO LLM. NO generation. NO new logic. Pure dictionary.
//
// Doctrine: when a FE surface has space for ~5 words, it consumes
// SHORT_SIGNAL_PHRASES[id]. When it has room for the full sentence, it
// consumes SIGNAL_PHRASES[id]. Both trace to the same canonical signal id.
const SHORT_SIGNAL_PHRASES = Object.freeze({
  [SIGNAL_IDS.SHARED_GAME_SUPPRESSION_EXPOSURE]: "shared-game suppression",
  [SIGNAL_IDS.MLB_PITCHER_HITTER_CONFLICT]:      "pitcher-K vs hitter-OVER conflict",
  [SIGNAL_IDS.POSITIVE_OFFENSIVE_STACK]:         "same-team offensive stack",
  [SIGNAL_IDS.MARKET_SUPPORTED_DISAGREEMENT]:    "market-supported edge",
  [SIGNAL_IDS.UNSUPPORTED_SOLO_BOOK_EDGE]:       "single-book outlier",
  [SIGNAL_IDS.HARD_DROP_OUT_PLAYER]:             "player is OUT",
  [SIGNAL_IDS.UNRESOLVED_LEG]:                   "unmapped leg",
  [SIGNAL_IDS.MARKET_CONTEXT_UNAVAILABLE]:       "no live market context",
  [SIGNAL_IDS.AVAILABILITY_CONTEXT_UNAVAILABLE]: "no availability context",
  [SIGNAL_IDS.FAKE_SAFE_SAME_GAME_EXPOSURE]:     "fake-safe ecological exposure",
  [SIGNAL_IDS.COHERENT_OFFENSIVE_STACK]:         "coherent offensive stack",
  [SIGNAL_IDS.STRUCTURAL_CONTRADICTION]:         "structural contradiction",
  [SIGNAL_IDS.NO_REPO_INTELLIGENCE_AVAILABLE]:   "no repo-native intelligence",
})

module.exports = {
  SIGNAL_IDS,
  SIGNAL_PHRASES,
  SHORT_SIGNAL_PHRASES,        // Phase BNSB-1A (FE-VBI-2)
  PRIORITY_ORDER,
  renderVerdictPhrases,
  composeVerdictSummary,
}
