# Offline Pick Evaluation

This folder contains offline-only utilities for evaluating emitted model picks against manually recorded outcomes.

## Script

- `backend/offline/evaluateEmittedPicks.js`

## Usage

```bash
node backend/offline/evaluateEmittedPicks.js \
  --picks backend/snapshot.json \
  --outcomes backend/manual-outcomes.json \
  --output backend/offline/eval-report.json
```

`--output` is optional. Without it, the report is printed to stdout only.

## Expected Input Shapes

### Picks input (`--picks`)

Supported shapes:

1. API-like payload:

```json
{
  "bestAvailable": {
    "firstBasket": [],
    "specials": [],
    "tonightsPlays": { "bestSpecials": [] },
    "bestUpside": [],
    "bestValue": [],
    "mostLikelyToHit": []
  }
}
```

2. Direct bestAvailable object:

```json
{
  "firstBasket": [],
  "specials": [],
  "bestUpside": [],
  "bestValue": [],
  "mostLikelyToHit": []
}
```

3. Flat array with lane/source lane on each row:

```json
[
  {
    "lane": "bestUpside",
    "eventId": "...",
    "player": "...",
    "propType": "...",
    "side": "Over",
    "line": 2.5,
    "book": "FanDuel"
  }
]
```

### Outcomes input (`--outcomes`)

Supported shapes:

1. Array (same style as `backend/manual-outcomes.json`):

```json
[
  {
    "eventId": "...",
    "player": "...",
    "propType": "...",
    "side": "Over",
    "line": 25.5,
    "book": "FanDuel",
    "outcome": 1
  }
]
```

2. Object wrapper:

```json
{
  "outcomes": [ ... ]
}
```

`outcome` values accepted:
- win: `1`, `"win"`, `"w"`, `true`
- loss: `0`, `"loss"`, `"l"`, `false`
- push/void: `"push"`, `"void"`, `0.5`

## Reports Produced

The script prints and can save:

1. Totals:
- total picks
- matched outcomes
- unmatched outcomes

2. Per-lane performance:
- win/loss/push counts and win rate
- includes priority lanes: `firstBasket`, `specials`, `bestUpside`, `bestValue`, `mostLikelyToHit`

3. Per-specialty-type performance:
- `firstBasket`, `firstTeamBasket`, `doubleDouble`, `tripleDouble`, `otherSpecials`, `nonSpecial`

4. Grouped diagnostics:
- by `confidenceTier`
- by `specialtyRankScore` band
- by `lineupContextScore` band
- by `opportunitySpikeScore` band

## Matching Logic

Rows are matched by:
- strict: `eventId + player + propType + side + book + line`
- fallback: same key without line, then nearest line within `0.25`

This keeps the tool useful when manual outcomes have minor line-format differences.
