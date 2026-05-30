"use strict"

/**
 * One-shot probe — tries ALL known ESPN NBA injury endpoint variants and
 * reports which one returns real data. Used to debug the silent failure where
 * populateNbaInjuryReport produces a 0-player cache.
 *
 *   node backend/scripts/probeEspnInjuryEndpoints.js > .scratch/last.txt 2>&1
 *
 * No persistence — read-only probe.
 */

const axios = require("axios")
const TIMEOUT = 12000
const LAL = 13

const URLS = [
	{
		label: "current populator URL (site/v2 per-team)",
		url:   `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${LAL}/injuries`,
	},
	{
		label: "site/v2 slate-wide (no team)",
		url:   `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries`,
	},
	{
		label: "core/v2 per-team injuries (current season)",
		url:   `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2026/teams/${LAL}/injuries`,
	},
	{
		label: "core/v2 per-team injuries (no season — defaults to current)",
		url:   `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/teams/${LAL}/injuries`,
	},
	{
		label: "core/v3 per-team injuries",
		url:   `https://sports.core.api.espn.com/v3/sports/basketball/leagues/nba/teams/${LAL}/injuries`,
	},
	{
		label: "web/v1 team (often has athlete + injury status nested)",
		url:   `https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${LAL}`,
	},
	{
		label: "common/v3/sports athletes per-team",
		url:   `https://sports.core.api.espn.com/v3/sports/basketball/leagues/nba/teams/${LAL}/athletes`,
	},
	// Slate-wide injuries via fantasy endpoint (often the real source on espn.com pages)
	{
		label: "fantasy injuries (sports.core)",
		url:   `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/injuries`,
	},
]

async function probe(entry) {
	console.log("\n────────────────────────────────────────────────────────────")
	console.log("LABEL:", entry.label)
	console.log("URL:  ", entry.url)
	try {
		const r = await axios.get(entry.url, { timeout: TIMEOUT, headers: { "User-Agent": "Mozilla/5.0" } })
		console.log("STATUS:", r.status)
		const data = r.data
		if (data && typeof data === "object") {
			const keys = Object.keys(data)
			console.log("TOP KEYS:", keys.length ? keys.join(",") : "(empty)")
			// Look for arrays of interest
			for (const k of ["injuries", "items", "athletes", "entries", "team", "ref"]) {
				if (data[k] !== undefined) {
					const v = data[k]
					if (Array.isArray(v)) console.log(`  ${k} = array(${v.length})`)
					else if (typeof v === "object" && v !== null) console.log(`  ${k} = object keys=[${Object.keys(v).slice(0,8).join(",")}]`)
					else console.log(`  ${k} = ${typeof v} ${String(v).slice(0, 80)}`)
				}
			}
			// If items is a ref-array (ESPN's core endpoints pattern), surface the first ref URL
			if (Array.isArray(data.items) && data.items.length && data.items[0]?.$ref) {
				console.log("  FIRST REF:", data.items[0].$ref)
			}
			// Print a small snippet for debugging shape changes
			const snippet = JSON.stringify(data, null, 2).slice(0, 600)
			console.log("SNIPPET:", snippet)
		} else {
			console.log("BODY:", String(data).slice(0, 200))
		}
	} catch (e) {
		console.log("ERR:", e?.response?.status, e?.message)
	}
}

async function main() {
	console.log("Probing ESPN injury endpoint variants for Lakers (team id 13)...")
	for (const e of URLS) {
		await probe(e)
	}
	console.log("\n=== DONE ===")
	console.log("Look for: STATUS=200 with a real injuries/items array or athlete refs.")
}

main().catch((e) => { console.error("fatal:", e?.message || e); process.exit(1) })
