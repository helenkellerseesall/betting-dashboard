// Phase BNSB-1B (BNSB-1B-4): Sample Starter Tickets
//
// 4 canonical operator-approved demo slips. Each shape is deliberately built
// to be backend-valid for `normalizeIngestedSlip` (single-leg branch requires
// .player || .statFamily || .propText; alias fields per normalizeLeg lines
// 171-200 of backend/pipeline/screenshots/normalizeIngestedSlip.js).
//
// Purpose: teach bettors what the repo understands. Each ticket maps to a
// canonical VBI signal class the engine demonstrably handles:
//   • coherent HR stack       → POSITIVE_OFFENSIVE_STACK / COHERENT_OFFENSIVE_STACK
//   • fake-safe under slip    → SHARED_GAME_SUPPRESSION_EXPOSURE / FAKE_SAFE_SAME_GAME_EXPOSURE
//   • contradiction slip      → MLB_PITCHER_HITTER_CONFLICT / STRUCTURAL_CONTRADICTION
//   • explosive environment   → POSITIVE_OFFENSIVE_STACK + ecology coherence
//
// Anti-fabrication: every leg uses fields the backend resolver already maps;
// nothing is fabricated. These are the same operator-named fixture archetypes
// used in `backend/scripts/verifyVisualBettingIntelligence1A.js` (the VBI
// canonical engine tests).
//
// NOT used for live betting decisions — these are demo / onboarding tickets.

export interface SampleSlipDef {
  key:         string
  emoji:       string
  title:       string
  blurb:       string   // bettor-readable one-liner
  signalNote:  string   // which canonical signal class this demonstrates
  sport:       "mlb" | "nba"
  payload: {
    legs: Array<{
      player:      string
      team?:       string
      statFamily:  string
      propType?:   string
      side:        "OVER" | "UNDER"
      line:        number
      odds:        number
      sportsbook?: string
      eventId?:    string
      game?:       string
    }>
  }
}

export const SAMPLE_SLIPS: SampleSlipDef[] = [
  {
    key:        "coherent_hr_stack",
    emoji:      "🔋",
    title:      "Coherent HR stack",
    blurb:      "Two top-of-order hitters on the same team, same big-power night.",
    signalNote: "Shows what a positive same-team OVER stack reads like to the engine.",
    sport:      "mlb",
    payload: {
      legs: [
        {
          player:     "Aaron Judge",
          team:       "NYY",
          statFamily: "totalBases",
          propType:   "Total Bases",
          side:       "OVER",
          line:       1.5,
          odds:       -110,
          sportsbook: "DraftKings",
          eventId:    "DEMO_NYY_BOS",
          game:       "NYY @ BOS",
        },
        {
          player:     "Juan Soto",
          team:       "NYY",
          statFamily: "totalBases",
          propType:   "Total Bases",
          side:       "OVER",
          line:       1.5,
          odds:       -105,
          sportsbook: "DraftKings",
          eventId:    "DEMO_NYY_BOS",
          game:       "NYY @ BOS",
        },
      ],
    },
  },
  {
    key:        "fake_safe_under",
    emoji:      "🪤",
    title:      "Fake-safe UNDER stack",
    blurb:      "Two UNDER hitters in the same game — looks safe, dies together.",
    signalNote: "Demonstrates shared-game suppression — both legs ride the same game environment.",
    sport:      "mlb",
    payload: {
      legs: [
        {
          player:     "Ildemaro Vargas",
          team:       "COL",
          statFamily: "hits",
          propType:   "Hits",
          side:       "UNDER",
          line:       1.5,
          odds:       -150,
          sportsbook: "FanDuel",
          eventId:    "DEMO_ARI_COL",
          game:       "ARI @ COL",
        },
        {
          player:     "Hunter Goodman",
          team:       "COL",
          statFamily: "hits",
          propType:   "Hits",
          side:       "UNDER",
          line:       1.5,
          odds:       -140,
          sportsbook: "FanDuel",
          eventId:    "DEMO_ARI_COL",
          game:       "ARI @ COL",
        },
      ],
    },
  },
  {
    key:        "pitcher_hitter_contradiction",
    emoji:      "🆚",
    title:      "Pitcher-K + opposing hitter OVER",
    blurb:      "Pitcher strikes everyone out AND opposing hitter gets hits — pick one.",
    signalNote: "Demonstrates pitcher-K vs hitter-OVER conflict — canonical anti-correlation.",
    sport:      "mlb",
    payload: {
      legs: [
        {
          player:     "Shohei Ohtani",
          team:       "LAD",
          statFamily: "ks",
          propType:   "Strikeouts",
          side:       "OVER",
          line:       8.5,
          odds:       -115,
          sportsbook: "DraftKings",
          eventId:    "DEMO_LAD_SD",
          game:       "LAD @ SD",
        },
        {
          player:     "Manny Machado",
          team:       "SD",
          statFamily: "hits",
          propType:   "Hits",
          side:       "OVER",
          line:       1.5,
          odds:       +135,
          sportsbook: "DraftKings",
          eventId:    "DEMO_LAD_SD",
          game:       "LAD @ SD",
        },
      ],
    },
  },
  {
    key:        "explosive_environment_stack",
    emoji:      "💥",
    title:      "Explosive environment stack",
    blurb:      "High game total + wind out + favorable park — both hitters in the storm.",
    signalNote: "Demonstrates explosive environment + reinforcement-eligible same-team OVERs.",
    sport:      "mlb",
    payload: {
      legs: [
        {
          player:     "Mookie Betts",
          team:       "LAD",
          statFamily: "hits",
          propType:   "Hits",
          side:       "OVER",
          line:       1.5,
          odds:       +115,
          sportsbook: "FanDuel",
          eventId:    "DEMO_LAD_COL",
          game:       "LAD @ COL",
        },
        {
          player:     "Freddie Freeman",
          team:       "LAD",
          statFamily: "totalBases",
          propType:   "Total Bases",
          side:       "OVER",
          line:       1.5,
          odds:       +110,
          sportsbook: "FanDuel",
          eventId:    "DEMO_LAD_COL",
          game:       "LAD @ COL",
        },
      ],
    },
  },
]
