Goal:
Fix the final runtime surfaced output path only.

Required method:
1. Find the LAST assignment / final transformation affecting:
   - bestAvailable.bettingNow
   - bestAvailable.topCard.topSpecials
2. Do not patch upstream helpers unless you prove they are the final live path.
3. Add compact diagnostics proving:
   - final source path used
   - final rank 1 type
   - specials in top 3
   - count of surfaced specials
4. Patch only the final live path.
5. Preserve payload shape.
6. Do not touch feed plumbing, metadata polish, singles ranking, or ladders ranking unless required by the exact bug.

Acceptance criteria:
- bettingNow rank 1 is core
- bettingNow max 1 special in top 3
- no surfaced special with avoid/fade
- no surfaced special with null playDecision and null decisionSummary
- surfaced arrays remain populated