"use strict"

/**
 * Phase 1 — Market + News Adaptation V1 (Session AT).
 *
 * Real market-context deriver. Pure derivation from ALREADY-AVAILABLE snapshot
 * data — no new feed, no scraping, no synthetic CLV, no fake "steam".
 *
 * What we have:
 *   - tonight's snapshot rows (point-in-time per book)
 *   - 230 / 494 unique NBA props quoted by ≥ 2 books on this slate
 *   - `buildLineShoppingIntelligence` already computes consensus + dispersion,
 *     but only surfaces it for the line-shopping UI — never reaches modelProb
 *
 * What we DON'T have:
 *   - opening odds, line history, oddsMove, lineMove, sharp/public flags
 *   - any temporal snapshot persistence (no diff against a prior snapshot)
 *
 * Therefore V1 is honest about what it can know:
 *   - market consensus across books (when ≥ 2 books quote the same prop)
 *   - this row's price vs that consensus (probability units)
 *   - market dispersion (std dev of book-implied probs)
 *
 * V1 cannot reason about LINE MOVEMENT. The user's mandate explicitly forbids
 * inventing steam or fabricating sharp action. Multi-book CONSENSUS is the
 * only honest cross-row market signal we have right now.
 *
 * The shift composes alongside Session-AO matchup and Session-AS teammate
 * shifts via the same `honestWeightedScore` re-normalization in
 * `nbaModelSignals.nbaRowIndependentModelProbability`. Hard-capped ±2 pp.
 *
 * Public surface:
 *   buildSlateMarketContext(snapshotRows) → SlateMarketCtx (build once per request)
 *   getMarketContext(slateCtx, row) → row-level market context | null
 *   enrichRowWithMarketContext(row, slateCtx) → mutates row, returns row
 */

// === Constants — bounded influence, sample-quality dampened ===
const STALE_THRESHOLD             = 0.025  // 2.5¢ — same as buildLineShoppingIntelligence
const MIN_BOOKS_FOR_CONSENSUS     = 2
const HIGH_DISPERSION_THRESHOLD   = 0.025  // std dev across books > this → "books disagree materially"
const MAX_MARKET_SHIFT_PP         = 0.020  // hard cap — smaller than teammate's 3pp because market is noisier
const SHIFT_SHRINKAGE_FACTOR      = 0.50   // half the raw delta as the directional shift
const HIGH_DISP_SHRINKAGE_EXTRA   = 0.40   // when dispersion is high, further halve the shift (uncertainty)

// === Helpers ===

function num(v) { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null }
function r4(x)   { return Math.round(Number(x) * 10000) / 10000 }
function clamp(min, max, v) { return Math.max(min, Math.min(max, v)) }

function impliedFromAmerican(o) {
  const n = num(o); if (!Number.isFinite(n) || n === 0) return null
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100)
}

function normPlayer(s) { return String(s || "").trim().toLowerCase() }
function normPropType(s) { return String(s || "").trim().toLowerCase().replace(/\s+/g, "") }
function normSide(s)   { return String(s || "").trim().toLowerCase() }
function normBook(s)   { return String(s || "").trim().toLowerCase() }

function isBaseLine(r) {
  const mk = String(r?.marketKey || "").toLowerCase()
  const pv = String(r?.propVariant || "").toLowerCase()
  return !(mk.includes("alternate") || mk.includes("_alt") || (pv && pv !== "base" && pv !== "default"))
}

// Group key — books quoting the SAME prop with the SAME line
function propGroupKey(r) {
  return [
    normPlayer(r.player),
    normPropType(r.propType || r.marketKey),
    normSide(r.side),
    String(r.line ?? ""),
  ].join("|")
}

// === Slate-level pre-computation ===

/**
 * Build per-prop consensus / dispersion / per-book implied from tonight's
 * snapshot rows. Pure function. No I/O. One pass.
 *
 * @param {Array<object>} snapshotRows
 * @returns {{
 *   propConsensus: Map<key, {
 *     consensus_implied: number,        // average implied across books
 *     dispersion:        number,        // std dev of implied across books
 *     book_count:        number,        // number of distinct books quoting
 *     books: Array<{book: string, odds: number, implied: number}>,
 *   }>,
 * }}
 */
function buildSlateMarketContext(snapshotRows) {
  const groups = new Map()
  for (const r of snapshotRows || []) {
    if (!r || !r.player || r.odds == null) continue
    if (!isBaseLine(r)) continue   // V1 only operates on base lines (alts have noisy single-book pricing)
    const key = propGroupKey(r)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }

  const propConsensus = new Map()
  for (const [key, rows] of groups) {
    const seenBooks = new Set()
    const entries = []
    for (const r of rows) {
      const book = normBook(r.book)
      if (!book || seenBooks.has(book)) continue   // dedupe per (book, key)
      const implied = impliedFromAmerican(r.odds)
      if (!Number.isFinite(implied)) continue
      seenBooks.add(book)
      entries.push({ book, odds: Number(r.odds), implied })
    }
    if (entries.length < MIN_BOOKS_FOR_CONSENSUS) continue   // single book → no consensus
    const consensus = entries.reduce((s, e) => s + e.implied, 0) / entries.length
    const variance  = entries.reduce((s, e) => s + (e.implied - consensus) ** 2, 0) / entries.length
    const dispersion = Math.sqrt(variance)
    propConsensus.set(key, {
      consensus_implied: r4(consensus),
      dispersion:        r4(dispersion),
      book_count:        entries.length,
      books:             entries.map((e) => ({ book: e.book, odds: e.odds, implied: r4(e.implied) })),
    })
  }
  return { propConsensus }
}

// === Per-row context derivation ===

/**
 * For a single snapshot row, compute its market context against the slate-level
 * consensus.
 *
 * @returns {{
 *   consensus_implied: number,
 *   dispersion:        number,
 *   book_count:        number,
 *   row_implied:       number,
 *   delta_vs_consensus: number,            // row_implied - consensus_implied (>0 = row priced higher than consensus)
 *   market_signal:     "better_than_consensus" | "consensus" | "worse_than_consensus" | "single_book",
 *   high_dispersion:   boolean,             // books materially disagree
 *   source:            "snapshot_multibook",
 * } | null}
 */
function getMarketContext(slateCtx, row) {
  if (!slateCtx || !row) return null
  const key = propGroupKey(row)
  const entry = slateCtx.propConsensus.get(key)
  if (!entry) return null
  const rowImplied = impliedFromAmerican(row.odds)
  if (!Number.isFinite(rowImplied)) return null

  const delta = rowImplied - entry.consensus_implied
  let market_signal
  if (entry.book_count < MIN_BOOKS_FOR_CONSENSUS) market_signal = "single_book"
  else if (delta < -STALE_THRESHOLD)              market_signal = "better_than_consensus"  // bettor's price gives BETTER odds than consensus → consensus thinks side more likely
  else if (delta >  STALE_THRESHOLD)              market_signal = "worse_than_consensus"   // bettor's price gives WORSE odds than consensus → consensus thinks side LESS likely
  else                                            market_signal = "consensus"

  return {
    consensus_implied: entry.consensus_implied,
    dispersion:        entry.dispersion,
    book_count:        entry.book_count,
    row_implied:       r4(rowImplied),
    delta_vs_consensus: r4(delta),
    market_signal,
    high_dispersion:   entry.dispersion > HIGH_DISPERSION_THRESHOLD,
    source:            "snapshot_multibook",
  }
}

/**
 * Mutate row to inject:
 *   - row.marketContext  structured object (always when present)
 *   - row.marketShift    signed probability-units shift consumed by
 *                        nbaRowIndependentModelProbability
 *
 * Mathematics:
 *   Market consensus implies a probability for the bettor's side. If THIS
 *   row's price implies a LOWER probability than consensus, market thinks
 *   the side is MORE likely than this book is pricing → bettor has more
 *   value here AND the model should slightly raise its modelProb (consensus
 *   confirmation). Shift sign:
 *
 *     marketShift = clamp(-CAP, +CAP, -delta_vs_consensus * SHRINKAGE)
 *
 *   negative delta → consensus_implied > row_implied → market consensus
 *     says bettor's side more likely → +shift on modelProb (confirmation)
 *   positive delta → row_implied > consensus_implied → market consensus
 *     says bettor's side less likely → -shift on modelProb (caution)
 *
 *   When dispersion is high (books disagree materially), shrink the shift
 *   further — the consensus itself is uncertain.
 *
 *   Hard cap: ±MAX_MARKET_SHIFT_PP (2 pp). Smaller than the teammate-redist
 *   cap because market signal is noisier.
 *
 * Honest null when row's prop has only one book quoting it.
 */
function enrichRowWithMarketContext(row, slateCtx) {
  if (!row || !slateCtx) return row
  const ctx = getMarketContext(slateCtx, row)
  if (!ctx) return row
  row.marketContext = ctx

  // Single-book props get context info but no shift.
  if (ctx.market_signal === "single_book") {
    row.marketShift = 0
    return row
  }

  // Compute shift. Direction: -delta * shrinkage.
  let shrink = SHIFT_SHRINKAGE_FACTOR
  if (ctx.high_dispersion) shrink *= HIGH_DISP_SHRINKAGE_EXTRA
  let shift = -ctx.delta_vs_consensus * shrink
  shift = clamp(-MAX_MARKET_SHIFT_PP, MAX_MARKET_SHIFT_PP, shift)

  row.marketShift = Number(shift.toFixed(4))
  row.marketContext = Object.assign({}, ctx, {
    applied_shift_pp: Number((shift * 100).toFixed(2)),
    shrinkage_used:   shrink,
  })
  return row
}

module.exports = {
  buildSlateMarketContext,
  getMarketContext,
  enrichRowWithMarketContext,
  // exposed for tests
  STALE_THRESHOLD,
  MIN_BOOKS_FOR_CONSENSUS,
  HIGH_DISPERSION_THRESHOLD,
  MAX_MARKET_SHIFT_PP,
}
