const EDGE_SOURCE_CONFIG = {
	version: "phase-2b",
	trustedSourceStack: [
		"nba_official_injury_report",
		"draftkings_live_board",
		"rotowire",
		"rotogrinders"
	],
	sources: {
		nba_official_injury_report: {
			label: "NBA Official Injury Report",
			priority: 1,
			influences: {
				availability: true,
				starterStatus: true,
				marketValidity: true,
				contextTag: true
			}
		},
		draftkings_live_board: {
			label: "DraftKings Live Board",
			priority: 2,
			influences: {
				availability: false,
				starterStatus: false,
				marketValidity: true,
				contextTag: true
			}
		},
		rotowire: {
			label: "RotoWire",
			priority: 3,
			influences: {
				availability: true,
				starterStatus: true,
				marketValidity: false,
				contextTag: true
			}
		},
		rotogrinders: {
			label: "RotoGrinders",
			priority: 4,
			influences: {
				availability: true,
				starterStatus: true,
				marketValidity: false,
				contextTag: true
			}
		}
	},

	// ---------------------------------------------------------------------------
	// MLB source registry — Phase 0 scaffolding only.
	// Not read by any existing NBA code path.
	// Phase 1 will wire these into a sport-scoped buildExternalEdgeOverlay call.
	// ---------------------------------------------------------------------------
	mlbTrustedSourceStack: [
		"mlb_api_sports",
		"mlb_official_injury_report",
		"rotowire_mlb",
		"fangraphs_lineups"
	],
	mlbSources: {
		mlb_api_sports: {
			label: "API-Sports MLB",
			priority: 0,
			influences: {
				availability: true,
				starterStatus: true,
				marketValidity: false,
				contextTag: true
			}
		},
		mlb_official_injury_report: {
			label: "MLB Official IL / Injury Report",
			priority: 1,
			influences: {
				availability: true,
				starterStatus: false,
				marketValidity: true,
				contextTag: true
			}
		},
		rotowire_mlb: {
			label: "RotoWire MLB",
			priority: 2,
			influences: {
				availability: true,
				starterStatus: true,
				marketValidity: false,
				contextTag: true
			}
		},
		fangraphs_lineups: {
			label: "FanGraphs Confirmed Lineups",
			priority: 3,
			influences: {
				availability: false,
				starterStatus: true,
				marketValidity: false,
				contextTag: true
			}
		},
		mlb_official_lineups: {
			label: "MLB.com Official Lineup Feed",
			priority: 4,
			influences: {
				availability: false,
				starterStatus: true,
				marketValidity: false,
				contextTag: true
			}
		}
	}
}

module.exports = {
	EDGE_SOURCE_CONFIG
}
