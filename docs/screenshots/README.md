# docs/screenshots/ — bettor-visible evidence directory

Phase BC-1 (Bettor Cognition Backlog Ingestion, 2026-05-19).

Operator-submitted UX evidence attached to BBL-NNNN cognition entries.
Filenames MUST follow the convention so `verifyOperationalOrchestration.js`
Cluster K can verify the link from `screenshots:` field to the file on disk.

## Filename convention (mandatory)

```
docs/screenshots/<BBL-NNNN>-<slug>-<n>.png
```

- `<BBL-NNNN>` — exact backlog id (matches `id:` in the entry).
- `<slug>` — kebab-case short description, ≤ 40 chars; only `[a-z0-9-]`.
- `<n>` — 1, 2, 3, ... when multiple screenshots attach to one entry.
- Extension MUST be `.png` (lossless) or `.jpg` (operator-mobile-screenshot tolerance).

Examples:

```
docs/screenshots/BBL-0010-discover-empty-1.png
docs/screenshots/BBL-0011-curated-slip-mixed-book-1.png
docs/screenshots/BBL-0011-curated-slip-mixed-book-2.png
docs/screenshots/BBL-0012-realism-zero-of-100-1.png
```

## How to attach

When submitting an entry via `cognitionAdd.js`:

```sh
node backend/scripts/ops/cognitionAdd.js \
  --lane "FRONTEND/UX LAB" \
  --title "Curated slip shows mixed book on legs" \
  --cognition sportsbook \
  --sportsbook DraftKings \
  --ux curated-slip-tray \
  --severity high \
  --screenshots docs/screenshots/BBL-0011-curated-slip-mixed-book-1.png,docs/screenshots/BBL-0011-curated-slip-mixed-book-2.png \
  --body "On 2026-05-19 the SAFE curated slip showed DraftKings book chip but one leg actually carried FanDuel odds."
```

The verifier asserts every path in the `screenshots:` array points to an
existing file under this directory. Missing files fail Cluster K.

## "Feels fake" workflow

When the operator screenshots a surface that "feels fake or synthetic",
the entry should:

1. Set `cognitionCategory: feels-fake` OR `realism`.
2. Set `feelsFakeFlag: true`.
3. Optionally set `realismScore: N` where 0 = pure fabricated-looking,
   100 = bettor-trustable.
4. Attach the screenshot under `docs/screenshots/`.

These three signals each add weight in `cognitionRank.js` so the
"feels fake" entry surfaces near the top of the recommendation queue.

## Persistence guarantee

Once a screenshot file is committed to git, it is permanent. The
`screenshots:` field on a CLOSED backlog entry is historical evidence —
the file is never deleted, even after the entry closes.
