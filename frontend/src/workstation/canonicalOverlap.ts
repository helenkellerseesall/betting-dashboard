// ─────────────────────────────────────────────────────────────────────────────
// canonicalOverlap.ts — Phase P1A-T1 canonical overlap-helper authority.
//
// Single canonical authority for "does this Candidate appear in a canonical
// FeaturedPlay bucket?" lookups. Established by MCR Option A ruling and
// codified in ARCHITECTURE_LAWS.md.
//
// Doctrine (immutable post-T1):
//   - The ONLY join-key is `id`. Candidate.id ↔ FeaturedPlay.id. No
//     approximate matching, no composite-key fallback, no fuzzy normalization
//     across player / side / line / book. If a Candidate has no `id`, it has
//     no canonical overlap — full stop.
//   - The index is built ONLY from canonical `state.featured.*` surfaces. No
//     FE-side ladder synthesis. No backend mutation. No Candidate widening.
//   - Conviction fields surfaced by the lookup are read VERBATIM off the
//     overlapping FeaturedPlay — no recomputation, no reinterpretation, no
//     phrase widening, no survivability recompute.
//   - Absence is honest: a Candidate with no canonical overlap returns null.
//     The ConvictionNote helper (which already owns absence rendering) is
//     never called with synthesized values; consumers gate it on a non-null
//     overlap.
//
// Battlefield doctrine alignment:
//   PropRail / LadderExplorer expose battlefield breadth. The overlap index
//   marks the SUBSET that the curated FeaturedPlay surfaces have already
//   ratified. Conviction therefore concentrates around the canonical edge —
//   this is exactly the battlefield → curated edge → AI compression model,
//   not a regression toward "here are 5 props."
// ─────────────────────────────────────────────────────────────────────────────

import type { Candidate, Featured, FeaturedPlay } from "./types"

// Subset of FeaturedPlay carried by the overlap index. Deliberately narrow:
// consumers must NOT read other FeaturedPlay fields off the overlap lookup —
// that would be a covert FeaturedPlay-vs-Candidate type reinterpretation.
// Only the canonical conviction surface is exposed.
export interface FeaturedOverlapEntry {
  convictionNote?:     FeaturedPlay["convictionNote"]
  convictionReasonTag?: FeaturedPlay["convictionReasonTag"]
  // Phase CA-3d Item 0001 — Survivability dimension extension. Law 21
  // Invariant 3: narrow-interface extension is the canonical evolution path.
  // Extends only what the survivability gate emits; never widens to other
  // FeaturedPlay fields.
  survivabilityFlag?:      FeaturedPlay["survivabilityFlag"]
  survivabilityReasonTag?: FeaturedPlay["survivabilityReasonTag"]
  survivabilityPhrase?:    FeaturedPlay["survivabilityPhrase"]
}

// ReadonlyMap so the index is structurally immutable to consumers. Stable
// empty singleton (below) is returned for nullish input to keep memo deps
// referentially clean.
export type FeaturedOverlapIndex = ReadonlyMap<string, FeaturedOverlapEntry>

const EMPTY_OVERLAP_INDEX: FeaturedOverlapIndex = new Map()

// Canonical FeaturedPlay-bearing array buckets on the Featured interface.
// Mirrors types.ts `Featured` shape — extend this list if a new canonical
// bucket is added there. We list explicitly (not duck-typed) so this helper
// can be audited against the canonical type definition in one diff.
const FEATURED_PLAY_ARRAY_KEYS = [
  "anchors",
  "tonightsBest",
  "bestHr",
  "bestPra",
  "bestFirstBasket",
  "bestLadders",
  "smartAggression",
  "safest",
  "bestClv",
  "marketAgreement",
  "timingWindows",
  // Phase Operator-Experience-1A
  "bestBalanced",
  "bestAggressive",
  "bestUnders",
  "bestAltLadders",
  "bestDisagreementEdges",
  "staleLineOpportunities",
  "trapLadders",
  "inflatedSuperstarSpots",
  // Phase BC-1A / OE-1A
  "believableUpsideTickets",
  "explosiveUpsideTickets",
] as const satisfies ReadonlyArray<keyof Featured>

/**
 * Build the canonical FeaturedPlay overlap index from `state.featured`.
 *
 * Memoize the caller on `featured` reference identity. Returns a stable empty
 * singleton when `featured` is nullish so callers can safely depend on the
 * returned reference without churn.
 */
export function buildFeaturedOverlapIndex(
  featured: Featured | null | undefined,
): FeaturedOverlapIndex {
  if (!featured) return EMPTY_OVERLAP_INDEX
  const out = new Map<string, FeaturedOverlapEntry>()

  const register = (play: FeaturedPlay | null | undefined): void => {
    if (!play) return
    const id = play.id
    if (typeof id !== "string" || id.length === 0) return
    // First-wins: identical canonical conviction across buckets (same compactPlay
    // emission), so the first encounter is the canonical entry. Re-registering
    // would just overwrite with byte-identical values; skipping avoids waste.
    if (out.has(id)) return
    out.set(id, {
      convictionNote:         play.convictionNote,
      convictionReasonTag:    play.convictionReasonTag,
      survivabilityFlag:      play.survivabilityFlag,
      survivabilityReasonTag: play.survivabilityReasonTag,
      survivabilityPhrase:    play.survivabilityPhrase,
    })
  }

  // 1) Plain FeaturedPlay[] buckets.
  for (const key of FEATURED_PLAY_ARRAY_KEYS) {
    const bucket = featured[key]
    if (!Array.isArray(bucket)) continue
    for (const play of bucket) register(play)
  }

  // 2) bestBooks is FeaturedBook[] — each book may carry a topPlay FeaturedPlay.
  if (Array.isArray(featured.bestBooks)) {
    for (const book of featured.bestBooks) {
      register(book?.topPlay ?? undefined)
    }
  }

  // 3) recommendationLadder is a 9-slot object, each slot FeaturedPlay | null.
  const ladder = featured.recommendationLadder
  if (ladder && typeof ladder === "object") {
    for (const slot of Object.values(ladder)) {
      register(slot as FeaturedPlay | null | undefined)
    }
  }

  return out
}

/**
 * Look up a Candidate in the canonical overlap index. Returns the canonical
 * overlap entry (conviction subset) or null when the Candidate has no
 * canonical id or no FeaturedPlay overlap.
 *
 * Doctrine: this is the ONLY supported overlap-lookup. Do not reimplement it
 * in any consumer. Do not extend it to composite-key matching.
 */
export function lookupOverlap(
  index: FeaturedOverlapIndex,
  candidate: Candidate,
): FeaturedOverlapEntry | null {
  const id = candidate.id
  if (typeof id !== "string" || id.length === 0) return null
  return index.get(id) ?? null
}
