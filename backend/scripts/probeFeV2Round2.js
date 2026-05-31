#!/usr/bin/env node
// probeFeV2Round2.js
//
// One-shot probe for the FE v2 round 2 wave:
//   1. /api/ws/top-picks       — counts + reasoning attached?
//   2. /api/ws/games-browser   — sport-grouped, dedup with bookOptions[]?
//   3. /api/ws/grades-health   — CLV stamping proof?
//
// Operator-friendly output written via console (and captured into
// `.scratch/last.txt` by the operator's run wrapper).

const http = require("http")

const PORT = process.env.PORT || 5050
const HOST = "127.0.0.1"

function fetchJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, path, method: "GET", timeout: 60000 }, (res) => {
      let body = ""
      res.on("data", (chunk) => (body += chunk))
      res.on("end", () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(body) }) }
        catch (e) { resolve({ status: res.statusCode, raw: body, parseError: String(e) }) }
      })
    })
    req.on("error", reject)
    req.on("timeout", () => { req.destroy(new Error("timeout")) })
    req.end()
  })
}

function _short(s, n = 60) { return String(s || "").slice(0, n) }

async function main() {
  console.log("=== FE v2 round 2 probe — " + new Date().toISOString() + " ===\n")

  // 1. TOP PICKS
  console.log("--- /api/ws/top-picks?limit=15 ---")
  try {
    const r = await fetchJson("/api/ws/top-picks?limit=15")
    if (r.status !== 200) { console.log("HTTP", r.status, r.raw || r.json); }
    else {
      const d = r.json
      const picks = d.picks || []
      console.log(`returned ${picks.length} picks (ELITE ${d.counts?.ELITE}, STRONG ${d.counts?.STRONG}, PLAYABLE ${d.counts?.PLAYABLE} total)`)
      const withReasoning = picks.filter((p) => p.reasoning && (p.reasoning.l5 || p.reasoning.opp || p.reasoning.propSpec))
      console.log(`reasoning attached on: ${withReasoning.length}/${picks.length}`)
      console.log("Sample picks (first 5):")
      for (const p of picks.slice(0, 5)) {
        const r = p.reasoning || {}
        console.log(`  · [${p.sport?.toUpperCase()}] ${p.player} ${p.statFamily} ${p.side} ${p.line} @ ${p.sportsbook} (${p.tier})`)
        console.log(`      conf ${(p.modelProb * 100).toFixed(1)}% · edge ${(p.edge * 100).toFixed(1)}%`)
        if (r.l5) console.log(`      L5: ${r.l5.label} = ${r.l5.value}`)
        if (r.opp) console.log(`      Opp: ${r.opp.label} → ${r.opp.value}`)
        if (r.propSpec) console.log(`      Spec: ${r.propSpec.label} → ${r.propSpec.value}`)
        if (r.drivers?.length) console.log(`      Drivers: ${r.drivers.slice(0, 3).join(" · ")}`)
      }
    }
  } catch (e) { console.log("ERROR:", String(e?.message || e)) }

  // 2. GAMES BROWSER
  console.log("\n--- /api/ws/games-browser ---")
  try {
    const r = await fetchJson("/api/ws/games-browser")
    if (r.status !== 200) { console.log("HTTP", r.status, r.raw || r.json); }
    else {
      const d = r.json
      const games = d.games || []
      const sports = {}
      let totalProps = 0, propsWithMultiBook = 0
      for (const g of games) {
        sports[g.sport] = (sports[g.sport] || 0) + 1
        for (const p of g.players) {
          for (const prop of p.props) {
            totalProps++
            if (prop.bookOptions && prop.bookOptions.length > 1) propsWithMultiBook++
          }
        }
      }
      console.log(`${d.gameCount} games · ${totalProps} deduped props · ${propsWithMultiBook} have multiple-book options`)
      const sportOrder = games.map((g) => g.sport)
      console.log(`Sport order in payload: ${sportOrder.slice(0, 6).join(", ")}${sportOrder.length > 6 ? "..." : ""}`)
      // Check NBA-first ordering
      let lastSport = ""
      let sportSwitches = 0
      for (const s of sportOrder) {
        if (s !== lastSport && lastSport) sportSwitches++
        lastSport = s
      }
      console.log(`Sport ordering interleaving: ${sportSwitches === 1 ? "✓ clean (NBA → MLB, one switch)" : sportSwitches === 0 ? "✓ single sport" : `⚠ ${sportSwitches} switches (interleaved?)`}`)
      // Sample first game
      if (games.length) {
        const g = games[0]
        console.log(`\nSample game: [${g.sport.toUpperCase()}] ${g.matchup}`)
        console.log(`  gameTime: ${g.gameTime}`)
        console.log(`  players: ${g.players.length}`)
        if (g.players.length) {
          const pl = g.players[0]
          console.log(`  first player: ${pl.player} → ${pl.props.length} deduped props`)
          if (pl.props.length) {
            const pr = pl.props[0]
            console.log(`    prop: ${pr.statFamily} ${pr.side} ${pr.line}`)
            console.log(`    bookOptions: ${(pr.bookOptions || []).map((o) => `${o.book}:${o.odds}`).join(", ")}`)
            console.log(`    reasoning attached: ${pr.reasoning ? "✓" : "✗"}`)
          }
        }
      }
    }
  } catch (e) { console.log("ERROR:", String(e?.message || e)) }

  // 3. GRADES HEALTH
  console.log("\n--- /api/ws/grades-health?days=7 ---")
  try {
    const r = await fetchJson("/api/ws/grades-health?days=7")
    if (r.status !== 200) { console.log("HTTP", r.status, r.raw || r.json); }
    else {
      const d = r.json
      console.log(`window: last ${d.days} days · today ${d.today}`)
      for (const sport of ["nba", "mlb"]) {
        const w = d.sports?.[sport]; if (!w) continue
        console.log(`\n  [${sport.toUpperCase()}] ${w.total} picks across ${w.days.length} days`)
        console.log(`    CLV stamped:  ${w.clvStamped}/${w.total} (${w.clvStampRate != null ? (w.clvStampRate * 100).toFixed(1) + "%" : "—"})`)
        console.log(`    Avg CLV:      ${w.avgClvCents != null ? (w.avgClvCents > 0 ? "+" : "") + w.avgClvCents.toFixed(1) + "¢" : "—"}`)
        console.log(`    Beat market:  ${w.beatMarketRate != null ? (w.beatMarketRate * 100).toFixed(1) + "%" : "—"}`)
        console.log(`    Hit rate:     ${w.wins}W ${w.losses}L${w.pushes ? " " + w.pushes + "P" : ""} ${w.pending ? "· " + w.pending + " pending" : ""} → ${w.hitRate != null ? (w.hitRate * 100).toFixed(1) + "%" : "—"}`)
      }
    }
  } catch (e) { console.log("ERROR:", String(e?.message || e)) }

  console.log("\n=== probe complete ===")
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1) })
