# G3-L2 Correlation Validation — 2026-07-21

Walk-forward (no lookahead): 24 train / 13 held-out slates · 689129 pairs. Bars: n≥500 · joint gap ≤2pp · copula Brier ≤ independence · cross-game |ρ|<0.05 for certification. Era slice = report, not filter.

| class | verdict | ρ_Z | test n | gap | Brier cop/ind | era Δρ | mp coverage |
|---|---|---|---|---|---|---|---|
| batter_pitcher_opposition | **PASS** | -0.0678 | 9751 | 0.59pp | 0.007603/0.007666 | 0.0497 | 100% |
| pitcher_pitcher_opposing | **STOP** | 0.0065 | 147 | 1.62pp | 0.00858/0.008564 | -0.0949 | 100% |
| batter_batter_same_team | **STOP** | 0.1126 | 164867 | 0.57pp | 0.006779/0.006728 | -0.0174 | 100% |
| batter_batter_opposing | **STOP** | 0.0481 | 177498 | 0.65pp | 0.004591/0.004567 | -0.0817 | 100% |
| same_player_multi_family | **STOP** | 0.4502 | 14975 | 0.46pp | 0.016535/0.016426 | -0.0984 | 100% |
| cross_game | **CERTIFIED_INDEPENDENT** | 0.0054 | 22000 | 0.44pp | 0.003931/0.003929 | -0.0294 | 100% |

STOP classes are ABSENT from every consumer until a re-run passes. The live shadow priors file is untouched by this validation.
