async function runAll() {
  try {
    console.log("🔄 Refreshing snapshot...");
    await fetch("http://localhost:4000/refresh-snapshot?force=1");

    console.log("🌦️ Building weather...");
    require("../pipeline/mlb/buildMlbWeather");

    console.log("📊 Fetching best available...");
    const res = await fetch("http://localhost:4000/api/best-available?sport=baseball_mlb");
    const data = await res.json();

    const board = data?.mlbInsightBoard || null;
    if (!board || typeof board !== "object") {
      throw new Error("Missing mlbInsightBoard in API response")
    }

    function toNum(v) {
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }

    function fmtSigned(x, digits = 3) {
      const n = toNum(x)
      if (!Number.isFinite(n)) return "n/a"
      const s = n >= 0 ? "+" : ""
      return `${s}${n.toFixed(digits)}`
    }

    function fmtProb(x) {
      const n = toNum(x)
      if (!Number.isFinite(n)) return "n/a"
      return n.toFixed(3)
    }

    function fmtTeam(x) {
      const s = String(x == null ? "" : x).trim()
      return s ? s : "—"
    }

    function fmtOdds(x) {
      if (x == null) return "n/a"
      const s = String(x).trim()
      return s ? s : "n/a"
    }

    function playerName(x) {
      return String(x?.player ?? x?.pitcher ?? "Unknown").trim() || "Unknown"
    }

    function extractLineOddsModelEdge(obj, propType) {
      if (!obj || typeof obj !== "object") return { line: null, odds: null, modelProbability: null, edge: null }

      // Prefer prop-specific aliases (Hits/RBI), else generic.
      if (propType === "Hits") {
        return {
          line: obj.hitLine ?? obj.line ?? null,
          odds: obj.hitOdds ?? obj.odds ?? null,
          modelProbability: obj.hitProb ?? obj.modelProbability ?? null,
          edge: obj.hitEdge ?? obj.edge ?? null,
        }
      }
      if (propType === "RBIs") {
        return {
          line: obj.rbiLine ?? obj.line ?? null,
          odds: obj.rbiOdds ?? obj.odds ?? null,
          modelProbability: obj.rbiProb ?? obj.modelProbability ?? null,
          edge: obj.rbiEdge ?? obj.edge ?? null,
        }
      }
      return {
        line: obj.line ?? null,
        odds: obj.odds ?? null,
        modelProbability: obj.modelProbability ?? null,
        edge: obj.edge ?? null,
      }
    }

    function printSection(title, list, propTypeOverride = null) {
      console.log("\n--------------------------------------------------")
      console.log(title)
      console.log("--------------------------------------------------")

      const arr = Array.isArray(list) ? list : []
      if (!arr.length) {
        console.log("(none)")
        return
      }

      for (const item of arr) {
        const propType =
          propTypeOverride ||
          (item && typeof item === "object" && item.propType ? String(item.propType) : null) ||
          "—"

        const ref = item && typeof item === "object" && item.ref ? item.ref : item
        const { odds, modelProbability, edge } = extractLineOddsModelEdge(ref, propType)

        const team = fmtTeam(ref?.team ?? ref?.teamResolved)
        const oddsStr = odds == null ? "n/a" : fmtOdds(odds)

        console.log(`${playerName(ref)} (${team}) — ${propType}`)
        console.log(`Prob: ${fmtProb(modelProbability)} | Edge: ${fmtSigned(edge)} | Odds: ${oddsStr}`)
        console.log("")
      }
    }

    printSection("🔥 TOP HR", board.topHR, "HR")
    printSection("📈 TOP HITS", board.topHits, "Hits")
    printSection("💥 TOP RBI", board.topRBI, "RBIs")
    printSection("🎯 TOP Ks", board.topKs, "Ks")

    printSection("⭐ BEST OVERALL PLAYS", board.bestOverallPlays)
    printSection("🧠 RR CORE (ROUND ROBIN POOL)", board.rrCandidates)
    printSection("💰 LOTTO PLAYS", board.lottoCandidates)
    printSection("🚫 FADES (AVOID)", board.fades)

    console.log("\n--------------------------------------------------")
    console.log("🎮 GAME INSIGHTS")
    console.log("--------------------------------------------------")
    const games = Array.isArray(board.gameInsights) ? board.gameInsights : []
    if (!games.length) {
      console.log("(none)")
    } else {
      for (const g of games) {
        const id = String(g?.eventId ?? "—")
        const notes = Array.isArray(g?.notes) ? g.notes : []
        const counts = g?.counts && typeof g.counts === "object" ? g.counts : null
        const countsStr = counts ? `HR:${counts.HR || 0} Hits:${counts.Hits || 0} RBI:${counts.RBIs || 0} Ks:${counts.Ks || 0}` : ""
        const noteStr = notes.length ? notes.join(" | ") : "Mixed signals"
        console.log(`${id} ${countsStr}`.trim())
        console.log(`- ${noteStr}`)
        console.log("")
      }
    }

    console.log("\n✅ READY\n");

  } catch (e) {
    console.error("[RUN ERROR]", e);
  }
}

runAll();

