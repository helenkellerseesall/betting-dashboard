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
	}
}

module.exports = {
	EDGE_SOURCE_CONFIG
}
