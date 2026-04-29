"use strict"

async function runAll() {
  try {
    console.log("Refreshing snapshot...")
    await fetch("http://localhost:4000/refresh-snapshot?force=1")

    console.log("Building weather...")
    require("../pipeline/mlb/buildMlbWeather")

    console.log("Fetching best available...")
    const res = await fetch("http://localhost:4000/api/best-available?sport=baseball_mlb")
    const data = await res.json()

    const opp = data?.mlbOpportunityBoard && typeof data.mlbOpportunityBoard === "object" ? data.mlbOpportunityBoard : null
    const insight = data?.mlbInsightBoard && typeof data.mlbInsightBoard === "object" ? data.mlbInsightBoard : null
    const snapshot = data?.snapshot && typeof data.snapshot === "object" ? data.snapshot : null

    if (!opp) throw new Error("Missing mlbOpportunityBoard in API response")
    if (!insight) throw new Error("Missing mlbInsightBoard in API response")

    function toNum(v) {
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }

    function fmtTeam(x) {
      const s = String(x == null ? "" : x).trim()
      return s ? s : "—"
    }

    function normalizeName(v) {
      return String(v == null ? "" : v)
        .toLowerCase()
        .replace(/\./g, " ")
        .replace(/\b(jr|sr|ii|iii|iv)\b/g, " ")
        .replace(/[^a-z\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    }

    function fmtProb(x) {
      const n = toNum(x)
      if (!Number.isFinite(n)) return "n/a"
      return n.toFixed(3)
    }

    function fmtSignedEdge(x) {
      const n = toNum(x)
      if (!Number.isFinite(n)) return "n/a"
      const s = n >= 0 ? "+" : ""
      return `${s}${n.toFixed(3)}`
    }

    function sortByProbDesc(a, b) {
      return (toNum(b?.probability) ?? -1) - (toNum(a?.probability) ?? -1)
    }

    // Team fallback map from snapshot rows for display hygiene.
    const teamByPlayer = new Map()
    const rowsForTeam = Array.isArray(snapshot?.rows) ? snapshot.rows : []
    const eventTeams = new Map()
    for (const r of rowsForTeam) {
      const key = normalizeName(r?.player)
      if (!key) continue
      if (!teamByPlayer.has(key)) {
        const t = String(r?.teamResolved ?? r?.team ?? "").trim()
        if (t) teamByPlayer.set(key, t)
      }
      const eid = String(r?.eventId || "").trim()
      const home = String(r?.homeTeam || "").trim()
      const away = String(r?.awayTeam || "").trim()
      if (eid && !eventTeams.has(eid) && (home || away)) {
        eventTeams.set(eid, { home, away })
      }
    }

    function resolveTeam(candidate) {
      const direct = String(candidate?.team || "").trim()
      if (direct) return direct
      const key = normalizeName(candidate?.player)
      if (key && teamByPlayer.has(key)) return teamByPlayer.get(key)

      const eid = String(candidate?.eventId || "").trim()
      if (eid && eventTeams.has(eid)) {
        const t = eventTeams.get(eid)
        const opp = String(candidate?.opponent || "").trim()
        if (opp) {
          if (t.home && t.home === opp && t.away) return t.away
          if (t.away && t.away === opp && t.home) return t.home
        }
        return t.home || t.away || "—"
      }
      return "—"
    }

    function gameKey(c) {
      const eid = String(c?.eventId || "").trim()
      if (eid) return `e:${eid}`
      const away = String(c?.opponent || "").trim()
      const home = String(c?.team || "").trim()
      if (away && home) return `m:${away}@${home}`
      return `t:${String(c?.team || "").trim().toUpperCase()}`
    }

    function pickDiverse(sortedCandidates, targetCount, opts = {}) {
      const maxPerTeam = toNum(opts.maxPerTeam) ?? 3
      const minGames = toNum(opts.minGames) ?? 7
      const pool = Array.isArray(sortedCandidates) ? [...sortedCandidates] : []
      const out = []
      const usedKeys = new Set()
      const teamPlayerCounts = new Map() // team -> Set(players)

      function teamKey(c) {
        return String(c?.team || "").trim().toUpperCase()
      }

      function playerKey(c) {
        return String(c?.player || "")
          .trim()
          .toLowerCase()
      }

      function uniqKey(c) {
        return `${playerKey(c)}__${gameKey(c)}__${String(c?.ladder || "").trim()}`
      }

      function gamesUsedCount() {
        return new Set(out.map((x) => gameKey(x))).size
      }

      function teamCountFor(team) {
        if (!team) return 0
        return teamPlayerCounts.get(team)?.size || 0
      }

      function addPick(c) {
        const k = uniqKey(c)
        if (usedKeys.has(k)) return false
        const t = teamKey(c)
        const pk = playerKey(c)
        if (t && pk) {
          const set = teamPlayerCounts.get(t) || new Set()
          if (set.has(pk)) return false
          set.add(pk)
          teamPlayerCounts.set(t, set)
        }
        usedKeys.add(k)
        out.push(c)
        return true
      }

      function scorePick(c, cap) {
        const p = toNum(c?.probability) ?? 0
        const e = toNum(c?.edge) ?? 0
        const gk = gameKey(c)
        const games = new Set(out.map((x) => gameKey(x)))
        const newGame = games.has(gk) ? 0 : 1
        const t = teamKey(c)
        const tc = t ? teamCountFor(t) : 0
        const overCap = t && tc >= cap ? 1 : 0
        return p * 1000 + e * 50 + newGame * 35 - overCap * 500 - tc * 10
      }

      function pickPass(cap) {
        const remaining = pool.filter((c) => !usedKeys.has(uniqKey(c)))
        remaining.sort((a, b) => scorePick(b, cap) - scorePick(a, cap))
        for (const c of remaining) {
          if (out.length >= targetCount) return
          const t = teamKey(c)
          if (t && teamCountFor(t) >= cap) continue
          addPick(c)
        }
      }

      // Primary pass
      pickPass(maxPerTeam)

      // Relax caps / push game coverage
      let relax = 0
      while (out.length < targetCount && relax < 4) {
        relax += 1
        const cap = maxPerTeam + relax
        if (gamesUsedCount() >= minGames && out.length >= Math.min(targetCount, pool.length)) break
        pickPass(cap)
      }

      // Final deterministic fill by original sort order (probability)
      for (const c of pool) {
        if (out.length >= targetCount) break
        addPick(c)
      }

      // Re-rank after constraints.
      out.sort(sortByProbDesc)
      return out.slice(0, targetCount)
    }

    function printHeader(title) {
      console.log("\n==== " + title + " ====")
    }

    // 1) SLATED TO HIT
    printHeader("SLATED TO HIT")

    const hit1 = Array.isArray(opp.hit1plusCandidates) ? [...opp.hit1plusCandidates].sort(sortByProbDesc) : []
    const hit2 = Array.isArray(opp.hit2plusCandidates) ? [...opp.hit2plusCandidates].sort(sortByProbDesc) : []

    if (!hit1.length && !hit2.length) {
      console.log("(none)")
    } else {
      // Hits 1+ (requested pool size ~20–25)
      pickDiverse(hit1, 25, { maxPerTeam: 3, minGames: 8 }).forEach((c) => {
        console.log(`- ${fmtTeam(c.player)} (${fmtTeam(resolveTeam(c))}) — "1+ Hit" — ${fmtProb(c.probability)} — ${fmtSignedEdge(c.edge)}`)
      })

      // Hits 2+ (requested pool size ~10–15)
      pickDiverse(hit2, 15, { maxPerTeam: 3, minGames: 8 }).forEach((c) => {
        console.log(`- ${fmtTeam(c.player)} (${fmtTeam(resolveTeam(c))}) — "2+ Hits" — ${fmtProb(c.probability)} — ${fmtSignedEdge(c.edge)}`)
      })
    }

    // 2) HR BOARD
    printHeader("HR BOARD")

    const hr = Array.isArray(opp.hrCandidates) ? [...opp.hrCandidates].sort(sortByProbDesc) : []
    if (!hr.length) console.log("(none)")
    else
      hr.slice(0, 30).forEach((c) => {
        console.log(`- ${fmtTeam(c.player)} (${fmtTeam(resolveTeam(c))}) — HR — ${fmtProb(c.probability)} — ${fmtSignedEdge(c.edge)}`)
      })

    // 3) RBI BOARD
    printHeader("RBI BOARD")

    const rbi1 = Array.isArray(opp.rbi1plusCandidates) ? [...opp.rbi1plusCandidates].sort(sortByProbDesc) : []
    const rbi2 = Array.isArray(opp.rbi2plusCandidates) ? [...opp.rbi2plusCandidates].sort(sortByProbDesc) : []

    if (!rbi1.length && !rbi2.length) {
      console.log("(none)")
    } else {
      rbi1.slice(0, 15).forEach((c) => {
        console.log(`- ${fmtTeam(c.player)} (${fmtTeam(resolveTeam(c))}) — "1+ RBI" — ${fmtProb(c.probability)} — ${fmtSignedEdge(c.edge)}`)
      })
      rbi2.slice(0, 10).forEach((c) => {
        console.log(`- ${fmtTeam(c.player)} (${fmtTeam(resolveTeam(c))}) — "2+ RBI" — ${fmtProb(c.probability)} — ${fmtSignedEdge(c.edge)}`)
      })
    }

    // ADDITIONAL: TOTAL BASES
    printHeader("TOTAL BASES")
    const tb = Array.isArray(opp.tbCandidates) ? [...opp.tbCandidates].sort(sortByProbDesc) : []
    if (!tb.length) console.log("(none)")
    else {
      tb.slice(0, 30).forEach((c) => {
        console.log(`- ${fmtTeam(c.player)} (${fmtTeam(resolveTeam(c))}) — "${fmtTeam(c.ladder)}" — ${fmtProb(c.probability)} — ${fmtSignedEdge(c.edge)}`)
      })
    }

    // ADDITIONAL: H+R+RBI
    printHeader("H+R+RBI")
    const hrrbi = Array.isArray(opp.hrrbiCandidates) ? [...opp.hrrbiCandidates].sort(sortByProbDesc) : []
    if (!hrrbi.length) console.log("(none)")
    else {
      hrrbi.slice(0, 25).forEach((c) => {
        console.log(`- ${fmtTeam(c.player)} (${fmtTeam(resolveTeam(c))}) — "${fmtTeam(c.ladder)}" — ${fmtProb(c.probability)} — ${fmtSignedEdge(c.edge)}`)
      })
    }

    // ADDITIONAL: EXTRA BASE HITS
    printHeader("EXTRA BASE HITS")
    const xbh = Array.isArray(opp.xbhCandidates) ? [...opp.xbhCandidates].sort(sortByProbDesc) : []
    if (!xbh.length) console.log("(none)")
    else {
      xbh.slice(0, 25).forEach((c) => {
        console.log(`- ${fmtTeam(c.player)} (${fmtTeam(resolveTeam(c))}) — "${fmtTeam(c.ladder)}" — ${fmtProb(c.probability)} — ${fmtSignedEdge(c.edge)}`)
      })
    }

    // 4) Ks BOARD
    printHeader("Ks BOARD")

    const ks = Array.isArray(opp.ksCandidates) ? [...opp.ksCandidates] : []
    ks.sort(sortByProbDesc)

    const ksGood = ks.filter((c) => (toNum(c?.edge) ?? 0) > 0)
    const ksNo = ks.filter((c) => (toNum(c?.edge) ?? 0) <= 0)

    console.log("GOOD EDGE (edge > 0)")
    if (!ksGood.length) console.log("(none)")
    else
      ksGood.forEach((c) => {
        console.log(`- ${fmtTeam(c.player)} (${fmtTeam(resolveTeam(c))}) — ${fmtTeam(c.ladder)} — ${fmtProb(c.probability)} — ${fmtSignedEdge(c.edge)}`)
      })

    console.log("\nNO EDGE (edge ≤ 0)")
    if (!ksNo.length) console.log("(none)")
    else
      ksNo.forEach((c) => {
        console.log(`- ${fmtTeam(c.player)} (${fmtTeam(resolveTeam(c))}) — ${fmtTeam(c.ladder)} — ${fmtProb(c.probability)} — ${fmtSignedEdge(c.edge)}`)
      })

    // 5) GAME ENVIRONMENT (derive from snapshot rows; show ALL games)
    printHeader("GAME ENVIRONMENT")

    const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : []
    const byEvent = new Map()
    for (const r of rows) {
      const eid = r?.eventId
      if (!eid) continue
      const g = byEvent.get(eid) || {
        eventId: eid,
        homeTeam: r?.homeTeam ?? null,
        awayTeam: r?.awayTeam ?? null,
        gameTotals: [],
        teamTotals: [],
      }
      if (!g.homeTeam && r?.homeTeam) g.homeTeam = r.homeTeam
      if (!g.awayTeam && r?.awayTeam) g.awayTeam = r.awayTeam
      const gt = toNum(r?.gameTotal)
      if (Number.isFinite(gt)) g.gameTotals.push(gt)
      const itt = toNum(r?.impliedTeamTotal)
      if (Number.isFinite(itt)) g.teamTotals.push(itt)
      byEvent.set(eid, g)
    }

    const games = [...byEvent.values()].map((g) => {
      const gtMax = g.gameTotals.length ? Math.max(...g.gameTotals) : null
      const ttMax = g.teamTotals.length ? Math.max(...g.teamTotals) : null
      const matchup = `${fmtTeam(g.awayTeam)} @ ${fmtTeam(g.homeTeam)}`
      let label = "Neutral environment"
      if (Number.isFinite(gtMax) && gtMax >= 9.5) label = "Hitting environment"
      else if (Number.isFinite(gtMax) && gtMax <= 8.0) label = "Pitching environment"
      else if (Number.isFinite(ttMax) && ttMax >= 5.5) label = "Hitting environment"
      return { matchup, gtMax, ttMax, label }
    })

    games.sort((a, b) => (toNum(b.gtMax) ?? -1) - (toNum(a.gtMax) ?? -1))

    if (!games.length) {
      console.log("(no snapshot rows available for game environment)")
    } else {
      games.forEach((g) => {
        const gt = Number.isFinite(g.gtMax) ? g.gtMax.toFixed(1) : "n/a"
        const tt = Number.isFinite(g.ttMax) ? g.ttMax.toFixed(1) : "n/a"
        console.log(`- ${g.matchup} | gameTotal(max): ${gt} | impliedTeamTotals(max): ${tt} | ${g.label}`)
      })
    }

    // 6) MUST PLAYS
    printHeader("MUST PLAYS")

    function pickMustPlaysMixed(insightObj) {
      const best = Array.isArray(insightObj?.bestOverallPlays) ? insightObj.bestOverallPlays : []
      const hits = Array.isArray(insightObj?.hitsBoard) ? insightObj.hitsBoard : []
      const hr = Array.isArray(insightObj?.hrBoard) ? insightObj.hrBoard : []
      const ks = Array.isArray(insightObj?.ksBoard) ? insightObj.ksBoard : []
      const rbi = Array.isArray(insightObj?.rbiBoard) ? insightObj.rbiBoard : []

      const normalize = (x, cat) => ({
        player: x?.player ?? null,
        team: x?.team ?? null,
        prediction:
          x?.prediction ??
          (cat === "hr" ? "HR" : x?.propType ?? "play"),
        probability: toNum(x?.probability ?? x?.modelProbability),
        edge: toNum(x?.edge),
        why: x?.why ?? x?.reason ?? x?.note ?? "AI curated",
        cat,
      })

      const pool = [
        ...best.map((x) => normalize(x, "best")),
        ...hits.map((x) => normalize(x, "hits")),
        ...hr.map((x) => normalize(x, "hr")),
        ...ks.map((x) => normalize(x, "ks")),
        ...rbi.map((x) => normalize(x, "rbi")),
      ].filter((x) => x.player)

      pool.sort((a, b) => {
        const be = toNum(b.edge) ?? -999
        const ae = toNum(a.edge) ?? -999
        if (be !== ae) return be - ae
        return (toNum(b.probability) ?? 0) - (toNum(a.probability) ?? 0)
      })

      const min = { hits: 2, hr: 2, ks: 1, rbi: 1 }
      const max = { hits: 3, hr: 3, ks: 2, rbi: 2, best: 10 }
      const used = new Set()
      const teamCount = new Map()
      const catCount = { hits: 0, hr: 0, ks: 0, rbi: 0, best: 0 }
      const out = []

      function key(x) {
        return `${String(x.player).toLowerCase()}__${String(x.prediction)}`
      }
      function canAdd(x) {
        const t = String(resolveTeam(x) || "").toUpperCase()
        if (t && (teamCount.get(t) || 0) >= 3) return false
        if ((catCount[x.cat] || 0) >= (max[x.cat] || 99)) return false
        return true
      }
      function add(x) {
        const k = key(x)
        if (used.has(k)) return false
        if (!canAdd(x)) return false
        used.add(k)
        const t = String(resolveTeam(x) || "").toUpperCase()
        if (t) teamCount.set(t, (teamCount.get(t) || 0) + 1)
        catCount[x.cat] = (catCount[x.cat] || 0) + 1
        out.push(x)
        return true
      }

      // hard minimum mix first
      for (const cat of ["hr", "hits", "ks", "rbi"]) {
        let need = min[cat] || 0
        for (const x of pool) {
          if (need <= 0) break
          if (x.cat !== cat) continue
          if (add(x)) need -= 1
        }
      }

      // fill remainder to top 10
      for (const x of pool) {
        if (out.length >= 10) break
        add(x)
      }

      return out.slice(0, 10)
    }

    const must = pickMustPlaysMixed(insight)

    if (!must.length) console.log("(none)")
    else {
      must.forEach((p) => {
        const prop =
          typeof p?.prediction === "string" && p.prediction.trim()
            ? p.prediction.trim()
            : String(p?.propType || "play").trim() || "play"
        const reason =
          typeof p?.why === "string" && p.why.trim()
            ? p.why.trim()
            : typeof p?.note === "string" && p.note.trim()
              ? p.note.trim()
              : "AI curated"
        const prob = toNum(p?.probability ?? p?.modelProbability)
        console.log(
          `- ${fmtTeam(p.player)} (${fmtTeam(resolveTeam(p))}) — ${prop} — ${fmtProb(prob)} — ${fmtSignedEdge(p.edge)} — ${reason}`
        )
      })
    }

    // 7) FREE BUILD POOL
    printHeader("FREE BUILD POOL")

    const hrCount = Array.isArray(opp.hrCandidates) ? opp.hrCandidates.length : 0
    const hit2Count = Array.isArray(opp.hit2plusCandidates) ? opp.hit2plusCandidates.length : 0
    const rbi1Count = Array.isArray(opp.rbi1plusCandidates) ? opp.rbi1plusCandidates.length : 0
    const rbi2Count = Array.isArray(opp.rbi2plusCandidates) ? opp.rbi2plusCandidates.length : 0
    const ksCount = Array.isArray(opp.ksCandidates) ? opp.ksCandidates.length : 0
    const tbCount = Array.isArray(opp.tbCandidates) ? opp.tbCandidates.length : 0
    const hrrbiCount = Array.isArray(opp.hrrbiCandidates) ? opp.hrrbiCandidates.length : 0
    const xbhCount = Array.isArray(opp.xbhCandidates) ? opp.xbhCandidates.length : 0

    console.log(`- HR candidates: ${hrCount}`)
    console.log(`- 2+ hit candidates: ${hit2Count}`)
    console.log(`- RBI 1+ candidates: ${rbi1Count}`)
    console.log(`- RBI 2+ candidates: ${rbi2Count}`)
    console.log(`- Ks candidates: ${ksCount}`)
    console.log(`- TB candidates: ${tbCount}`)
    console.log(`- H+R+RBI candidates: ${hrrbiCount}`)
    console.log(`- XBH candidates: ${xbhCount}`)

    console.log("\nDAILY REPORT COMPLETE\n")
  } catch (e) {
    console.error("[RUN ERROR]", e)
  }
}

runAll()
