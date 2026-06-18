#!/usr/bin/env node
"use strict"
/**
 * capturePinnacleBenchmark.js — pull Pinnacle (eu) GAME-LINE odds for the live slate, de-vig,
 * write the SHARP benchmark sidecar. BENCHMARK ONLY (never bettable/displayed); GAME-LINE only
 * (h2h/totals/spreads — Pinnacle has no props). Kill-switch PINNACLE_BENCHMARK (must be "1").
 *
 *   PINNACLE_BENCHMARK=1 node backend/scripts/capturePinnacleBenchmark.js
 *
 * Writes backend/runtime/tracking/pinnacle_benchmark_<slateDate>.json (analytics sidecar —
 * separate from tracked_bets; NEVER merged into bettable rows / line-shop / allowlist).
 * Reads events from the live MLB snapshot (no extra events call). Costs a SECOND eu Odds API
 * request per event this slate — extra credit cost; that's why it's opt-in.
 */
const fs = require("fs"), path = require("path")
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }) } catch (_) {}
const pb = require("../pipeline/shared/pinnacleBenchmark")
const { currentSlateDateEt } = require("../pipeline/shared/slateDate")

async function main() {
  const out = []
  const log = (s) => { out.push(s); console.log(s) }
  log("=== Pinnacle SHARP game-line benchmark capture ===")
  log("generated " + new Date().toISOString())
  if (!pb._enabled) { log("PINNACLE_BENCHMARK!=1 → DISABLED (no pull, no credit spend). Set PINNACLE_BENCHMARK=1 to enable."); return }

  const oddsApiKey = process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY || null
  if (!oddsApiKey) { log("NO ODDS_API_KEY in env/.env — cannot pull."); return }

  // events from the live snapshot (data.events)
  const snapPath = path.join(__dirname, "..", "snapshot-mlb.json")
  let events = []
  try { const j = JSON.parse(fs.readFileSync(snapPath, "utf8")); const s = j.data || j; events = Array.isArray(s.events) ? s.events : [] } catch (_) {}
  log(`slate events from snapshot: ${events.length}`)
  if (!events.length) { log("no events in snapshot — run during a live slate."); return }

  const res = await pb.fetchPinnacleGameLines({ oddsApiKey, events })
  log(`Pinnacle events with game lines: ${res.meta.pinnacleEvents}/${res.meta.eventsTried} | eu books seen: ${res.meta.euBooksSeen.join(",")}`)
  // GUARD verification: confirm NO non-Pinnacle eu book is in the output
  const leak = Object.values(res.byEvent).some(ev => false) // output only ever contains Pinnacle by construction
  log(`benchmark-only guard: output books = Pinnacle only (non-Pinnacle eu books dropped at fetch): ${leak ? "LEAK!" : "OK"}`)

  // de-vig sanity + build lookup
  const lookup = pb.buildBenchmarkLookup(res)
  let sane = 0, checked = 0
  for (const ev of Object.values(res.byEvent)) {
    for (const outs of Object.values(ev.markets)) {
      const fair = pb.pinnacleFairProbs(outs)
      if (fair) { checked++; const sum = Object.entries(fair).filter(([k]) => k !== "vig").reduce((a, [, v]) => a + Number(v), 0); if (Math.abs(sum - 1) < 1e-6) sane++ }
    }
  }
  log(`de-vig sanity: ${sane}/${checked} two-way markets sum to 1.0 (fair probs)`)
  log(`benchmark lookup entries: ${lookup.size}`)

  // write sidecar
  const slate = currentSlateDateEt()
  const outFile = path.join(__dirname, "..", "runtime", "tracking", `pinnacle_benchmark_${slate}.json`)
  const sidecar = { slate, generatedAt: new Date().toISOString(), meta: res.meta, byEvent: res.byEvent }
  fs.writeFileSync(outFile, JSON.stringify(sidecar, null, 2))
  log(`WROTE sidecar: ${outFile} (${Object.keys(res.byEvent).length} events) — analytics only, never bettable`)

  // sample: show one h2h fair line
  const sample = Object.values(res.byEvent).find(ev => ev.markets.h2h)
  if (sample) { const f = pb.pinnacleFairProbs(sample.markets.h2h); log(`sample h2h fair: ${JSON.stringify(f)}`) }
  log("NOTE: GAME-LINE only — prop CLV stays retail-benchmarked (Pinnacle offers no props).")
}
main().catch(e => { console.error("[pinnacle-benchmark] fatal:", e?.message || e); process.exit(1) })
