# Phase 2 Edge Spec

## Scope
This spec defines a two-layer edge system for row-level final decisioning without changing surfaced composition rules.

- Phase 2A = internal decision layer (uses existing row fields already in pipeline)
- Phase 2B = external edge overlay (uses trusted external sources)

This document is implementation-oriented and intended to be coded directly in `backend/pipeline/edge/*`.

## Layer Split

### Phase 2A: Internal Decision Layer
Purpose: produce a stable baseline decision from in-pipeline fields only.

- Input: existing normalized row object already flowing through boards
- Output: deterministic baseline decision fields (`finalDecisionScore`, `decisionBucket`, etc.)
- Constraint: no external network dependency

### Phase 2B: External Edge Overlay
Purpose: adjust Phase 2A baseline using trusted external signals that impact true edge quality.

- Input: Phase 2A outputs + external normalized signals
- Output: adjusted final decision fields and override reasoning (`sitReason`)
- Constraint: source confidence weighting + graceful degradation when sources are stale/missing

## Phase 2A Inputs (Internal Row Fields)
Use only fields already present on candidate rows. At minimum:

- `playDecision`
- `decisionSummary`
- `confidenceTier`
- `hitRatePct`
- `adjustedConfidenceScore`
- `playerConfidenceScore`
- `score`
- `marketMovementTag`
- `lineMove`
- `oddsMove`
- `bookValueHint`
- `volatilityFlag`
- `volatilityPenalty`
- `marketKey`
- `propType`
- `propVariant`
- `mustPlayReasonTag`
- `mustPlayContextTag`
- `mustPlayContextScore`

Derived inputs allowed in Phase 2A:

- normalized confidence in $[0,1]$
- normalized hit rate in $[0,1]$
- decision-strength score from `playDecision`
- movement-support score from market movement fields

## Phase 2B Inputs (Trusted External Sources)

Phase 2B consumes normalized source signals (not raw HTML/text) from:

1. NBA official injury report
2. DraftKings live board
3. RotoWire
4. RotoGrinders

Each source should be normalized to structured signals per player/event:

- `availabilityStatus` (`available|questionable|doubtful|out|unknown`)
- `minutesSignal` (`up|flat|down|unknown`)
- `lineupRoleSignal` (`starter|bench|unclear`)
- `marketPriceDirection` (`favorable|neutral|unfavorable`)
- `marketPriceFreshnessMinutes`
- `sourceTimestamp`
- `sourceConfidence` in $[0,1]$

## Output Fields (Decision Layer Contract)
Phase 2 should output these row fields:

- `finalDecisionLabel` (string)
- `finalDecisionScore` (0-100)
- `decisionBucket` (enum)
- `supportEdge` (-100 to 100)
- `marketEdge` (-100 to 100)
- `riskEdge` (-100 to 100)
- `sitReason` (nullable string)

Recommended helper outputs (optional but useful):

- `phase2aBaseScore` (0-100)
- `phase2bOverlayDelta` (-30 to +30)
- `phase2Confidence` (0-1)
- `phase2SourceFlags` (array)

## Standard Decision Buckets
Exactly these buckets:

- `must-play`
- `strong-play`
- `playable`
- `special-only`
- `sit`

Score-to-bucket defaults (before slate strictness adjustment):

- `must-play`: score >= 82
- `strong-play`: 70-81
- `playable`: 55-69
- `special-only`: 42-54
- `sit`: < 42

## Phase 2A Scoring Model
Build score as weighted combination:

$$
	ext{phase2aBaseScore} = 100 \cdot (0.30\cdot D + 0.25\cdot C + 0.20\cdot H + 0.15\cdot M + 0.10\cdot R)
$$

Where:

- $D$ = decision strength from `playDecision` / `decisionSummary`
- $C$ = confidence composite from `adjustedConfidenceScore|playerConfidenceScore|score`
- $H$ = hit-rate signal from `hitRatePct`
- $M$ = market movement support from `marketMovementTag|lineMove|oddsMove|bookValueHint`
- $R$ = role/context support from `mustPlayContextTag|mustPlayContextScore`

Then compute internal edges:

- `supportEdge` from $D,C,H,R$
- `marketEdge` from $M$ and price hints
- `riskEdge` from `volatilityFlag|volatilityPenalty|propVariant`

## Phase 2B Overlay Rules
Apply additive overlay delta after Phase 2A:

- Injury downgrade (`doubtful|out`) => hard demotion to `sit` with `sitReason`
- Questionable + negative minutes signal => subtract 8-18
- Confirmed favorable role uplift + favorable DK price movement => add 4-12
- Stale external data (`sourceTimestamp` older than threshold) => cap absolute overlay impact

Overlay blend:

$$
	ext{phase2bOverlayDelta} = \sum_i w_i \cdot s_i
$$

- $i$ over trusted sources
- $w_i$ = source confidence weight
- $s_i$ = normalized source signal impact

Final score:

$$
	ext{finalDecisionScore} = \text{clip}(\text{phase2aBaseScore} + \text{phase2bOverlayDelta}, 0, 100)
$$

## Slate Strictness Rules (3-game vs 11-game)

### Tight Slate (<= 3 games)
Goal: avoid empty lanes while preserving quality floor.

- Relax bucket thresholds by 3 points
- Allow up to 1 additional `playable` borderline row when support is non-negative
- Never bypass explicit `sit` injury rule

### Medium Slate (4-7 games)
- Use default thresholds
- Standard overlay caps

### Large Slate (>= 11 games)
Goal: be stricter because replacement quality is high.

- Raise `must-play`/`strong-play` thresholds by 4 points
- Require both non-negative `supportEdge` and `marketEdge` for `strong-play+`
- Increase penalty for medium/high risk rows unless offset by strong market edge

## Sit Logic (Hard Stops)
Set `decisionBucket = sit` and fill `sitReason` when any hard-stop condition is true:

- authoritative out/inactive injury status
- major role uncertainty + adverse market move + weak support
- extreme risk profile with no compensating support/market edge

## Implementation Notes

- Keep Phase 2A and Phase 2B in separate modules/functions.
- Treat external sources as optional overlays; system must run with Phase 2A only.
- Add deterministic unit tests for:
	- bucket mapping
	- slate strictness adjustments
	- hard-stop sit overrides
	- stale external data handling
- Preserve existing payloads; add new Phase 2 fields without removing prior fields.

## Initial Build Order

1. Implement Phase 2A score + bucket + edge outputs.
2. Add slate-size strictness adjustment.
3. Implement Phase 2B normalized overlay adapters for the 4 trusted sources.
4. Add hard-stop sit overrides and `sitReason` precedence.
5. Validate against nightly board + specials audit snapshots.
