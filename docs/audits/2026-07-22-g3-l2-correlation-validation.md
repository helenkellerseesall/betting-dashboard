# G3-L2 Correlation Validation — 2026-07-22

Walk-forward (no lookahead): 24 train / 13 held-out slates · 689129 pairs. Bars: n≥500 · joint gap ≤2pp · copula Brier ≤ independence · cross-game |ρ|<0.05 for certification. Era slice = report, not filter.

| class | verdict | ρ_Z | test n | gap | Brier cop/ind | era Δρ | mp coverage |
|---|---|---|---|---|---|---|---|
| batter_pitcher_opposition | **PASS** | -0.0678 | 9751 | 0.59pp | 0.007603/0.007666 | 0.0497 | 100% |
| pitcher_pitcher_opposing | **STOP** | 0.0065 | 147 | 1.62pp | 0.00858/0.008564 | -0.0949 | 100% |
| batter_batter_same_team | **STOP** | 0.1126 | 164867 | 0.57pp | 0.006779/0.006728 | -0.0174 | 100% |
| batter_batter_opposing | **STOP** | 0.0481 | 177498 | 0.65pp | 0.004591/0.004567 | -0.0817 | 100% |
| same_player_multi_family | **STOP** | 0.4502 | 14975 | 0.46pp | 0.016535/0.016426 | -0.0984 | 100% |
| same_player__hitsxtotalBases | **PASS** | 0.528 | 2171 | 0.17pp | 0.015953/0.015983 | -0.254 | 100% |
| same_player__hitsxruns | **STOP** | 0.2788 | 1181 | 1.67pp | 0.017404/0.016863 | -0.1896 | 100% |
| same_player__hitsxhr | **STOP** | 0.1069 | 1544 | 1.42pp | 0.005702/0.005562 | -0.3569 | 100% |
| same_player__hitsxrbis | **STOP** | 0.3423 | 1519 | 0.41pp | 0.013834/0.013789 | -0.2065 | 100% |
| same_player__runsxtotalBases | **PASS** | 0.4998 | 1571 | 0.7pp | 0.024378/0.024659 | 0.053 | 100% |
| same_player__hrxtotalBases | **PASS** | 0.6251 | 1843 | 0.24pp | 0.019719/0.019923 | -0.0419 | 100% |
| same_player__rbisxtotalBases | **PASS** | 0.6189 | 1740 | 0.83pp | 0.023692/0.024039 | 0.2149 | 100% |
| same_player__rbisxruns | **PASS** | 0.1133 | 923 | 0.46pp | 0.015019/0.015037 | 0.2725 | 100% |
| same_player__hrxruns | **STOP** | 0.3528 | 1220 | 1.22pp | 0.013429/0.013241 | -0.0769 | 100% |
| same_player__hrxrbis | **STOP** | 0.5728 | 1234 | 1.39pp | 0.010737/0.010479 | -0.1057 | 100% |
| same_player__ksxouts | **STOP** | 0.1013 | 29 | 0.41pp | 0.054005/0.054419 | — | 100% |
| same_player__earnedRunsxks | **STOP** | — | — | —pp | —/— | — | —% |
| same_player__earnedRunsxouts | **STOP** | — | — | —pp | —/— | — | —% |
| cross_game | **CERTIFIED_INDEPENDENT** | 0.0054 | 22000 | 0.44pp | 0.003931/0.003929 | -0.0294 | 100% |
| same_player__outsxwalks | **STOP** | — | — | —pp | —/— | — | —% |
| same_player__ksxwalks | **STOP** | — | — | —pp | —/— | — | —% |
| same_player__ksxrbis | **STOP** | — | — | —pp | —/— | — | —% |
| same_player__hitsxks | **STOP** | — | — | —pp | —/— | — | —% |

STOP classes are ABSENT from every consumer until a re-run passes. The live shadow priors file is untouched by this validation.
