"use strict"

/**
 * Intelligence Presentation Layer.
 *
 * Takes existing backend outputs (board bets, line shopping, timing, CLV,
 * ledger, review state) and formats them into a clean, high-signal terminal
 * board. Zero backend logic, zero API calls — pure formatting.
 *
 * Sections (in order):
 *   ⚡  URGENT PLAYS          timing = immediate
 *   🎯  BEST EDGE             top model edge + CLV signal
 *   🏪  LINE SHOPPING WINS    best sportsbook arbitrage
 *   ⚡  STEAM / SHARP MONEY   dispersion + sharp signals
 *   🛡️  SAFEST PLAYS          stable + high confidence
 *   🎲  LOTTO / HIGH UPSIDE   long odds + good process
 *   🏀  FIRST BASKET          NBA opening-possession intel
 *   💰  PORTFOLIO              exposure + allocation summary
 *   🧠  PROCESS REVIEW        CLV, good-process bets, variance
 *   ⚠️  ALERTS                stale books, overcorrected, risk
 *
 * Entry points:
 *   buildBoard({ bets, slipBets, lineShopping, timingResult, bookState,
 *                ledgerReport, reviewSummary, sport, date })
 *   → returns { sections, raw, printable: string }
 *
 *   printBoard(opts)  → writes directly to stdout
 */

// ── badge system ──────────────────────────────────────────────────────────────

const BADGES = {
  // Timing
  NOW:           "🔥 BET NOW",
  SOON:          "⏰ BET SOON",
  WAIT:          "⌛ WAIT",
  AVOID:         "🚫 AVOID",
  // Market state
  STEAM:         "⚡ STEAM",
  STALE:         "💤 STALE LINE",
  SOFT:          "🎁 SOFT BOOK",
  DRIFTING:      "📉 DRIFTING",
  STABLE:        "✅ STABLE",
  OVERCORRECTED: "⚠️  OVERCORRECTED",
  CONTESTED:     "🔀 CONTESTED",
  // Value
  POS_CLV:       "🟢 +CLV",
  NEG_CLV:       "🔴 -CLV",
  EDGE:          "🎯 EDGE",
  MKT_AGREE:     "🤝 MKT AGREE",
  MKT_DISAGREE:  "❌ MKT DISAGREE",
  SHARP:         "🦈 SHARP",
  // Process
  GOOD_PROCESS:  "🧠 GOOD PROCESS",
  LUCKY_WIN:     "🍀 LUCKY WIN",
  VARIANCE_LOSS: "📉 VARIANCE LOSS",
  BAD_PROCESS:   "🚩 BAD PROCESS",
  // Confidence
  ELITE:         "🏆 ELITE",
  STRONG:        "💪 STRONG",
  PLAYABLE:      "📊 PLAYABLE",
  LOTTO:         "🎲 LOTTO",
  // FB
  OPENER:        "🏀 OPENER",
  TIP_EDGE:      "⬆️  TIP EDGE",
  TIP_RISK:      "⬇️  TIP RISK",
  FIRST_TOUCH:   "👆 FIRST TOUCH",
  DEFERRED:      "🔄 DEFERRED",
  // Ladder
  SAFE_LADDER:   "🛡️  SAFE LADDER",
  RISKY_LADDER:  "⚠️  RISKY LADDER",
  DEEP_MARKET:   "📚 DEEP MARKET",
  // Archetype
  ARCHETYPE:     "🎯 ARCHETYPE",
}

/**
 * Compute badges for a single play object.
 * Returns array of badge strings — max 3 to avoid clutter.
 */
function badgesForPlay(play, opts = {}) {
  const { timingMap = null, shopMap = null } = opts
  const tags = []

  // Timing urgency (priority 1)
  const timingKey  = buildTimingKey(play)
  const timingData = timingMap?.get(timingKey)
  if (timingData) {
    if (timingData.urgency === "immediate") tags.push(BADGES.NOW)
    else if (timingData.urgency === "soon") tags.push(BADGES.SOON)
    else if (timingData.urgency === "wait") tags.push(BADGES.WAIT)
    else if (timingData.urgency === "avoid") tags.push(BADGES.AVOID)
    // Market state
    if (timingData.state === "steam")         tags.push(BADGES.STEAM)
    else if (timingData.state === "stale_window") tags.push(BADGES.STALE)
    else if (timingData.state === "drifting") tags.push(BADGES.DRIFTING)
    else if (timingData.state === "overcorrected") tags.push(BADGES.OVERCORRECTED)
  }

  // Line shopping (priority 2)
  const shopData = shopMap?.get(buildShopKey(play))
  if (shopData) {
    const oddsSpread = shopData.oddsSpread ?? 0
    if (Math.abs(oddsSpread) >= 20) tags.push(BADGES.SOFT)
  }

  // Confidence tier (priority 3 — only if no timing badge yet)
  if (tags.length < 2) {
    const tier = String(play.tier || play.confidenceTier || "").toUpperCase()
    if (tier === "ELITE")    tags.push(BADGES.ELITE)
    else if (tier === "STRONG")   tags.push(BADGES.STRONG)
    else if (tier === "PLAYABLE") tags.push(BADGES.PLAYABLE)
    else if (tier === "LOTTO")    tags.push(BADGES.LOTTO)
  }

  // CLV / process (from settled ledger data)
  const clvQuality = play.clvQuality || play.clvSnapshot?.clv?.quality
  if (clvQuality && tags.length < 3) {
    if (clvQuality === "positive")        tags.push(BADGES.POS_CLV)
    else if (clvQuality === "negative")   tags.push(BADGES.NEG_CLV)
  }

  // Edge strength signal
  const edge = num(play.edge || play.edgeProbability)
  if (edge != null && tags.length < 3) {
    if (edge >= 0.12) tags.push(BADGES.EDGE)
    else if (edge <= -0.03) tags.push(BADGES.MKT_DISAGREE)
  }

  return tags.slice(0, 3)
}

/**
 * Compute CLV process badge for a settled bet.
 */
function processBadge(bet) {
  const q = bet?.clvSnapshot?.clv?.quality
  const r = bet?.result
  if (!q) return null
  if (q === "positive" && r === "win")   return BADGES.GOOD_PROCESS
  if (q === "positive" && r === "loss")  return BADGES.VARIANCE_LOSS
  if (q === "negative" && r === "win")   return BADGES.LUCKY_WIN
  if (q === "negative" && r === "loss")  return BADGES.BAD_PROCESS
  return null
}

// ── formatting utilities ──────────────────────────────────────────────────────

function num(v) { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null }
function r2(x)  { return Math.round(Number(x) * 100) / 100 }
function pad(s, n) { return String(s ?? "").padEnd(n) }
function fmtOdds(o) { const n = num(o); if (n == null) return "n/a"; return (n > 0 ? "+" : "") + n }
function fmtProb(p) { const n = num(p); if (n == null) return "n/a"; return (n * 100).toFixed(1) + "%" }
function fmtEdge(e) { const n = num(e); if (n == null) return ""; return (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%" }
function fmtClv(c)  { const n = num(c); if (n == null) return ""; return (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "¢" }
function divider(label = "", w = 68) {
  if (!label) return "─".repeat(w)
  const side = Math.floor((w - label.length - 2) / 2)
  return "─".repeat(Math.max(2, side)) + " " + label + " " + "─".repeat(Math.max(2, w - side - label.length - 2))
}

// ── key builders ──────────────────────────────────────────────────────────────

/** Normalize stat family: lowercase, strip spaces + underscores for comparison. */
function normFam(v) {
  return String(v || "").toLowerCase().replace(/[\s_]+/g, "")
}

function buildTimingKey(play) {
  return [
    String(play.eventId || ""),
    String(play.player || "").toLowerCase().trim(),
    normFam(play.statFamily || play.propFamilyKey || play.propType || ""),
    String(play.side || "").toLowerCase(),
    String(play.line ?? "any"),
  ].join("|")
}

/** Short key (no eventId) — used as fallback when eventId missing. */
function buildTimingKeyShort(play) {
  return [
    String(play.player || "").toLowerCase().trim(),
    normFam(play.statFamily || play.propFamilyKey || play.propType || ""),
    String(play.side || "").toLowerCase(),
    String(play.line ?? "any"),
  ].join("|")
}

function buildShopKey(play) {
  return [
    String(play.eventId || ""),
    String(play.player || "").toLowerCase().trim(),
    normFam(play.statFamily || play.propFamilyKey || play.propType || ""),
    String(play.side || "").toLowerCase(),
    String(play.line ?? "any"),
  ].join("|")
}

function buildShopKeyShort(play) {
  return [
    String(play.player || "").toLowerCase().trim(),
    normFam(play.statFamily || play.propFamilyKey || play.propType || ""),
    String(play.side || "").toLowerCase(),
    String(play.line ?? "any"),
  ].join("|")
}

// ── section builders ──────────────────────────────────────────────────────────

/**
 * Build urgency maps from timing result and line shopping for fast lookup.
 */
function buildLookupMaps(timingResult, lineShopping) {
  // Primary map: full key (with eventId)
  // Fallback map: short key (no eventId) for bets that lack eventId (e.g. tracked_best)
  const timingMap      = new Map()
  const timingMapShort = new Map()
  for (const tc of timingResult?.timingClassifications || []) {
    timingMap.set(tc.key, tc)
    // Also index without eventId component
    const shortKey = tc.key.split("|").slice(1).join("|")
    if (!timingMapShort.has(shortKey)) timingMapShort.set(shortKey, tc)
  }

  const shopMap      = new Map()
  const shopMapShort = new Map()
  for (const entry of lineShopping?.bestByProp || []) {
    const base = { player: entry.player, statFamily: entry.propFamilyKey, side: entry.side, line: entry.line }
    const k      = buildShopKey({ eventId: entry.eventId || "", ...base })
    const kShort = buildShopKeyShort(base)
    shopMap.set(k, entry)
    if (!shopMapShort.has(kShort)) shopMapShort.set(kShort, entry)
  }

  // Wrapper: transparent fallback to short key when full key misses
  const timingLookup = {
    get: (k) => timingMap.get(k) ?? timingMapShort.get(k.split("|").slice(1).join("|")),
    has: (k) => timingMap.has(k) || timingMapShort.has(k.split("|").slice(1).join("|")),
  }
  const shopLookup = {
    get: (k) => shopMap.get(k) ?? shopMapShort.get(k.split("|").slice(1).join("|")),
  }

  return { timingMap: timingLookup, shopMap: shopLookup }
}

function sectionUrgent(bets, maps, limit = 12) {
  const lines = []
  const { timingMap } = maps
  const urgent = bets.filter((b) => {
    const tc = timingMap?.get(buildTimingKey(b))
    return tc?.urgency === "immediate"
  }).slice(0, limit)

  if (!urgent.length) return null

  lines.push(divider("⚡  URGENT — BET NOW"))
  for (const b of urgent) {
    const tc      = timingMap.get(buildTimingKey(b))
    const badges  = badgesForPlay(b, maps)
    const sigStr  = (tc?.signals || []).slice(0, 2).join("  ")
    const tierStr = String(b.tier || b.confidenceTier || "").padEnd(8)
    lines.push(
      `  ${pad(b.player, 22)} ${pad(formatProp(b), 30)} ${pad(fmtOdds(b.odds || b.oddsAmerican), 7)} ` +
      `${pad(tierStr, 10)} ${badges.join("  ")}` +
      (sigStr ? `\n    ${sigStr}` : "")
    )
  }
  return lines.join("\n")
}

function sectionBestEdge(bets, maps, limit = 10) {
  const lines = []
  const sorted = [...bets]
    .filter((b) => num(b.edge || b.edgeProbability) != null)
    .sort((a, b) => (num(b.edge || b.edgeProbability) ?? 0) - (num(a.edge || a.edgeProbability) ?? 0))
    .slice(0, limit)

  if (!sorted.length) return null

  lines.push(divider("🎯  BEST EDGE PLAYS"))
  for (const b of sorted) {
    const badges = badgesForPlay(b, maps)
    const edge   = fmtEdge(b.edge || b.edgeProbability)
    const prob   = fmtProb(b.modelProb || b.predictedProbability)
    const shop   = maps.shopMap?.get(buildShopKey(b))
    const bestBook = shop ? ` → best: ${shop.bestBook} ${fmtOdds(shop.bestOdds)}` : ""
    lines.push(
      `  ${pad(b.player, 22)} ${pad(formatProp(b), 30)} ` +
      `edge:${pad(edge, 8)} prob:${pad(prob, 8)} ${badges.slice(0,2).join("  ")}${bestBook}`
    )
  }
  return lines.join("\n")
}

function sectionLineShopping(lineShopping, limit = 10) {
  const lines = []
  const best = (lineShopping?.bestByProp || []).filter((p) => Math.abs(p.oddsSpread ?? 0) >= 10).slice(0, limit)
  if (!best.length) return null

  lines.push(divider("🏪  LINE SHOPPING — BEST BOOK VALUE"))
  for (const p of best) {
    const spread = p.oddsSpread != null ? `spread ${fmtOdds(p.oddsSpread)}` : ""
    const delta  = p.bestImpDelta != null ? ` (${fmtClv(p.bestImpDelta)} vs consensus)` : ""
    lines.push(
      `  ${pad(p.player, 22)} ${pad(p.prop, 33)}  BEST: ${pad(p.bestBook, 13)} ${fmtOdds(p.bestOdds)}` +
      `  WORST: ${pad(p.worstBook, 13)} ${fmtOdds(p.worstOdds)}  ${spread}${delta}`
    )
  }
  return lines.join("\n")
}

function sectionSteam(timingResult, limit = 8) {
  const lines = []
  const steam = (timingResult?.steamPlays || []).slice(0, limit)
  if (!steam.length) return null

  lines.push(divider("⚡  STEAM — SHARP MONEY DETECTED"))
  for (const c of steam) {
    const disp = c.dispersion != null ? ` disp:${(c.dispersion * 100).toFixed(1)}%` : ""
    lines.push(
      `  ${BADGES.STEAM}  ${pad(c.player, 22)} ${pad(c.prop, 33)}  book:${pad(c.bestBook, 12)}  @${fmtOdds(c.bestOdds)}${disp}`
    )
  }
  return lines.join("\n")
}

function sectionSafest(bets, maps, limit = 8) {
  const lines = []
  const safe = bets.filter((b) => {
    const tier = String(b.tier || b.confidenceTier || "").toUpperCase()
    return (tier === "ELITE" || tier === "STRONG") && num(b.edge || b.edgeProbability) > 0
  }).slice(0, limit)

  if (!safe.length) return null

  lines.push(divider("🛡️   SAFEST PLAYS"))
  for (const b of safe) {
    const badges  = badgesForPlay(b, maps)
    const edge    = fmtEdge(b.edge || b.edgeProbability)
    const conf    = num(b.confidence)
    const confStr = conf != null ? ` conf:${(conf * 100).toFixed(0)}%` : ""
    lines.push(
      `  ${pad(b.player, 22)} ${pad(formatProp(b), 33)} ` +
      `edge:${pad(edge, 8)}${confStr}  ${badges.slice(0,2).join("  ")}`
    )
  }
  return lines.join("\n")
}

function sectionLotto(bets, maps, limit = 8) {
  const lines = []
  const lottos = bets.filter((b) => {
    const odds = num(b.odds || b.oddsAmerican)
    return odds != null && odds >= 200 && num(b.edge || b.edgeProbability) > 0
  }).slice(0, limit)

  if (!lottos.length) return null

  lines.push(divider("🎲  LOTTO / HIGH UPSIDE"))
  for (const b of lottos) {
    const badges = badgesForPlay(b, maps)
    const edge   = fmtEdge(b.edge || b.edgeProbability)
    lines.push(
      `  ${pad(b.player, 22)} ${pad(formatProp(b), 33)} ` +
      `${pad(fmtOdds(b.odds || b.oddsAmerican), 8)} edge:${pad(edge, 8)} ${badges.slice(0,2).join("  ")}`
    )
  }
  return lines.join("\n")
}

function sectionFirstBasket(bets, maps, limit = 8) {
  const fbBets = bets.filter((b) => {
    const fam = String(b.statFamily || b.propFamilyKey || "").toLowerCase()
    return fam === "firstbasket" || fam.includes("first_basket") || fam.includes("first basket")
  }).slice(0, limit)

  if (!fbBets.length) return null

  const lines = [divider("🏀  FIRST BASKET INTELLIGENCE")]
  for (const b of fbBets) {
    const fb  = b.firstBasketSnapshot || b.fbSnap || null
    const badges = []

    if (fb) {
      const arch = fb.archetype || ""
      if (arch.includes("scripted_opener") || arch.includes("initiator"))    badges.push(BADGES.OPENER)
      if (arch.includes("initiator_deferring") || arch.includes("deferred")) badges.push(BADGES.DEFERRED)
      const pTip = num(fb.tipWinExpectation || fb.components?.pTipWin)
      if (pTip != null) {
        if (pTip >= 0.55)  badges.push(BADGES.TIP_EDGE)
        else if (pTip < 0.4) badges.push(BADGES.TIP_RISK)
      }
      const pFT = num(fb.projectedFirstTouchProb || fb.components?.pFirstTouch)
      if (pFT != null && pFT >= 0.4) badges.push(BADGES.FIRST_TOUCH)
    } else {
      badges.push(...badgesForPlay(b, maps))
    }

    const archLabel = fb?.archetype ? `  arch:${fb.archetype.replace(/_/g," ")}` : ""
    const pFB       = num(fb?.pFirstBasket)
    const pFBStr    = pFB != null ? `  p(FB):${fmtProb(pFB)}` : ""
    lines.push(
      `  ${pad(b.player, 22)} ${pad(formatProp(b), 30)} ` +
      `${fmtOdds(b.odds || b.oddsAmerican)}  ${badges.slice(0,3).join("  ")}${archLabel}${pFBStr}`
    )
  }
  return lines.join("\n")
}

function sectionPortfolio(bets, slipBets = [], bankrollInfo = null) {
  const lines = [divider("💰  PORTFOLIO SNAPSHOT")]

  // Exposure by stat
  const byStatExposure = {}
  for (const b of bets) {
    const fam = String(b.statFamily || b.propFamilyKey || b.propType || "other").toLowerCase()
    byStatExposure[fam] = (byStatExposure[fam] || 0) + 1
  }
  const statEntries = Object.entries(byStatExposure).sort((a, b) => b[1] - a[1])
  lines.push(`  STAT DISTRIBUTION  ${statEntries.map(([f, n]) => `${f}:${n}`).join("  ")}`)

  // Tier distribution
  const byTier = {}
  for (const b of bets) {
    const t = String(b.tier || b.confidenceTier || "?").toUpperCase()
    byTier[t] = (byTier[t] || 0) + 1
  }
  const tierEntries = Object.entries(byTier).sort((a, b) => b[1] - a[1])
  lines.push(`  TIER DISTRIBUTION  ${tierEntries.map(([t, n]) => `${t}:${n}`).join("  ")}`)

  // Slip count
  if (slipBets.length) {
    lines.push(`  SLIPS  total:${slipBets.length}`)
    const byType = {}
    for (const s of slipBets) { const t = s.type || "?"; byType[t] = (byType[t] || 0) + 1 }
    lines.push(`    ${Object.entries(byType).map(([t, n]) => `${t}:${n}`).join("  ")}`)
  }

  // Bankroll
  if (bankrollInfo) {
    const risk    = num(bankrollInfo.totalRisk)
    const budget  = num(bankrollInfo.dailyRiskBudget)
    const util    = num(bankrollInfo.riskUtilization)
    const bankStr = bankrollInfo.bankroll != null ? `bankroll:$${r2(bankrollInfo.bankroll)}` : ""
    const riskStr = risk != null ? `  risk:$${r2(risk)}` : ""
    const budgStr = budget != null ? `  budget:$${r2(budget)}` : ""
    const utilStr = util != null ? `  utilization:${(util * 100).toFixed(0)}%` : ""
    if (bankStr || riskStr) lines.push(`  BANKROLL  ${bankStr}${riskStr}${budgStr}${utilStr}`)
  }

  return lines.join("\n")
}

function sectionProcessReview(ledgerReport) {
  if (!ledgerReport) return null
  const lines = []
  const s  = ledgerReport.summary || {}
  const clv = ledgerReport.clv || {}

  lines.push(divider("🧠  PROCESS REVIEW"))

  // P&L
  if (s.settled > 0) {
    const roi     = s.roi != null ? `ROI:${(s.roi * 100).toFixed(1)}%` : "ROI:n/a"
    const winRate = s.winRate != null ? `W/R:${(s.winRate * 100).toFixed(0)}%` : ""
    const profit  = s.totalProfit != null ? `profit:${s.totalProfit >= 0 ? "+" : ""}$${r2(s.totalProfit)}` : ""
    lines.push(`  P&L     settled:${s.settled}  ${roi}  ${winRate}  ${profit}`)
  }

  // CLV
  if (clv.count > 0) {
    const avgClv = clv.avgClvPct != null ? `avgCLV:${clv.avgClvPct >= 0 ? "+" : ""}${clv.avgClvPct}¢` : ""
    lines.push(`  CLV     tracked:${clv.count}  ${avgClv}`)
  }

  // Best bets
  const bestBets = (ledgerReport.bestBets || []).filter((b) => b.result && b.result !== "pending")
  if (bestBets.length) {
    lines.push(`  BEST BETS (this window):`)
    bestBets.slice(0, 4).forEach((b) => {
      const pb   = processBadge(b)
      const clvS = fmtClv(b.clvSnapshot?.clv?.clvScore)
      lines.push(`    ${pad(b.player, 22)} ${pad(b.prop || b.statFamily, 30)} ${pb || ""}  CLV:${clvS || "n/a"}  result:${b.result}`)
    })
  }

  // Model-agreed losses (good process)
  const goodProcessLosses = (ledgerReport.bestBets || []).filter(
    (b) => b.result === "loss" && b.clvSnapshot?.clv?.quality === "positive"
  )
  if (goodProcessLosses.length) {
    lines.push(`  GOOD PROCESS — missed outcomes (${goodProcessLosses.length} bets):`)
    goodProcessLosses.slice(0, 3).forEach((b) => {
      lines.push(`    ${BADGES.VARIANCE_LOSS}  ${pad(b.player, 22)} ${formatProp(b)}  CLV:${fmtClv(b.clvSnapshot?.clv?.clvScore)}`)
    })
  }

  return lines.length > 1 ? lines.join("\n") : null
}

function sectionAlerts(lineShopping, timingResult, bookState) {
  const lines = [divider("⚠️   ALERTS")]
  let any = false

  // Overcorrected plays
  const overcorrected = (timingResult?.timingClassifications || [])
    .filter((c) => c.state === "overcorrected")
    .slice(0, 5)
  if (overcorrected.length) {
    any = true
    lines.push(`  ${BADGES.OVERCORRECTED}  Overcorrected props (skip these):`)
    overcorrected.forEach((c) => lines.push(`    ${pad(c.player, 22)} ${c.prop}`))
  }

  // Stale book windows
  const stale = (lineShopping?.staleRows || []).filter((s) => s.tag === "stale_line").slice(0, 5)
  if (stale.length) {
    any = true
    lines.push(`  ${BADGES.STALE}  Stale books (move to better book):`)
    stale.forEach((s) => lines.push(`    ${pad(s.book, 14)} ${pad(s.player, 22)} ${s.prop}  Δ${(s.delta * 100).toFixed(1)}¢`))
  }

  // Rolling book warnings
  const badBooks = Object.entries(bookState?.books || {})
    .filter(([, bp]) => bp.settled >= 5 && bp.avgClv != null && bp.avgClv < -0.02)
    .map(([book, bp]) => ({ book, avgClv: bp.avgClv }))
  if (badBooks.length) {
    any = true
    lines.push(`  ⚠️  Underperforming books (historically negative CLV):`)
    badBooks.forEach((b) => lines.push(`    ${pad(b.book, 14)} avgCLV:${fmtClv(b.avgClv)}`))
  }

  if (!any) lines.push("  No significant alerts")
  return lines.join("\n")
}

function sectionStaleWindows(lineShopping, limit = 8) {
  const soft = (lineShopping?.staleRows || []).filter((s) => s.tag === "soft_line").slice(0, limit)
  if (!soft.length) return null

  const lines = [divider("🎁  SOFT LINE WINDOWS — VALUE AVAILABLE")]
  for (const s of soft) {
    lines.push(
      `  ${pad(s.book, 14)} ${pad(s.player, 22)} ${pad(s.prop, 35)}  ` +
      `impl:${(s.impliedProb * 100).toFixed(1)}% vs ${(s.consensus * 100).toFixed(1)}%  ${fmtClv(s.delta)}`
    )
  }
  return lines.join("\n")
}

function sectionByStatFamily(bets, maps, sport) {
  // Group bets by stat family, show counts + best plays per group
  const grouped = {}
  for (const b of bets) {
    const fam = String(b.statFamily || b.propFamilyKey || b.propType || "other").toLowerCase()
    if (!grouped[fam]) grouped[fam] = []
    grouped[fam].push(b)
  }

  const lines = [divider(`📊  STAT BREAKDOWN (${String(sport || "").toUpperCase()})`)]
  for (const [fam, plays] of Object.entries(grouped).sort((a, b) => b[1].length - a[1].length)) {
    const topPlay = plays.sort((a, b) => (num(b.edge || b.edgeProbability) ?? -99) - (num(a.edge || a.edgeProbability) ?? -99))[0]
    const edgeStr = fmtEdge(topPlay.edge || topPlay.edgeProbability)
    const badges  = badgesForPlay(topPlay, maps).slice(0, 1)
    lines.push(
      `  ${pad(fam, 18)} plays:${String(plays.length).padStart(3)}  top: ${pad(topPlay.player, 20)} ${pad(formatProp(topPlay), 28)} ${edgeStr.padEnd(8)} ${badges.join("")}`
    )
  }
  return lines.join("\n")
}

// ── prop formatting ───────────────────────────────────────────────────────────

function formatProp(b) {
  if (b.prop && typeof b.prop === "string") return b.prop.slice(0, 30)
  const side = String(b.side || "").toLowerCase()
  const line = b.line != null ? ` ${b.line}` : ""
  const fam  = String(b.statFamily || b.propType || "").replace(/([a-z])([A-Z])/g, "$1 $2")
  return `${fam} ${side}${line}`.trim().slice(0, 30)
}

// ── MAIN BOARD BUILDER ────────────────────────────────────────────────────────

/**
 * Build the full intelligence board.
 *
 * @param {object} opts
 * @param {Array}   opts.bets          Ranked single bets (from board output)
 * @param {Array}   [opts.slipBets]    Slip bets
 * @param {object}  [opts.lineShopping] From buildLineShopping()
 * @param {object}  [opts.timingResult] From buildMarketTiming()
 * @param {object}  [opts.bookState]   Rolling book intelligence
 * @param {object}  [opts.ledgerReport] From buildNightlyReport()
 * @param {object}  [opts.reviewSummary] From nightly review summary
 * @param {string}  [opts.sport]
 * @param {string}  [opts.date]
 * @param {object}  [opts.bankrollInfo] boardOutput meta
 * @param {boolean} [opts.compact]     Shorter output
 * @returns {{ sections: string[], printable: string }}
 */
function buildBoard(opts = {}) {
  const {
    bets          = [],
    slipBets      = [],
    lineShopping  = null,
    timingResult  = null,
    bookState     = null,
    ledgerReport  = null,
    reviewSummary = null,
    sport         = "mlb",
    date          = todayKey(),
    bankrollInfo  = null,
    compact       = false,
  } = opts

  const maps    = buildLookupMaps(timingResult, lineShopping)
  const sections = []

  const header = [
    divider("", 68),
    `  ⚡  BETTING INTELLIGENCE BOARD   ${String(sport).toUpperCase()}  ${date}`,
    divider("", 68),
    `  Plays: ${bets.length}  Slips: ${slipBets.length}  ` +
    (timingResult ? `Urgent: ${timingResult.meta?.immediateCount ?? 0}  ` : "") +
    (lineShopping ? `Line shops: ${lineShopping.meta?.propsWithMultiBook ?? 0}` : ""),
    "",
  ].join("\n")
  sections.push(header)

  // 1. Urgent
  const urgentSection = sectionUrgent(bets, maps, compact ? 6 : 12)
  if (urgentSection) sections.push(urgentSection)

  // 2. Best edge
  const edgeSection = sectionBestEdge(bets, maps, compact ? 6 : 10)
  if (edgeSection) sections.push(edgeSection)

  // 3. Line shopping
  const shopSection = sectionLineShopping(lineShopping, compact ? 6 : 10)
  if (shopSection) sections.push(shopSection)

  // 4. Steam
  if (!compact) {
    const steamSection = sectionSteam(timingResult, 6)
    if (steamSection) sections.push(steamSection)
  }

  // 5. Soft windows
  const softSection = sectionStaleWindows(lineShopping, compact ? 4 : 8)
  if (softSection) sections.push(softSection)

  // 6. Safest
  const safeSection = sectionSafest(bets, maps, compact ? 4 : 8)
  if (safeSection) sections.push(safeSection)

  // 7. Lotto
  if (!compact) {
    const lottoSection = sectionLotto(bets, maps, 6)
    if (lottoSection) sections.push(lottoSection)
  }

  // 8. First basket (NBA only or whenever FB bets present)
  const fbSection = sectionFirstBasket(bets, maps, 8)
  if (fbSection) sections.push(fbSection)

  // 9. Stat breakdown
  if (!compact && bets.length > 5) {
    sections.push(sectionByStatFamily(bets, maps, sport))
  }

  // 10. Portfolio
  if (!compact) {
    sections.push(sectionPortfolio(bets, slipBets, bankrollInfo))
  }

  // 11. Process review
  if (ledgerReport) {
    const processSection = sectionProcessReview(ledgerReport)
    if (processSection) sections.push(processSection)
  }

  // 12. Alerts
  sections.push(sectionAlerts(lineShopping, timingResult, bookState || {}))

  // Footer
  sections.push(divider("", 68) + "\n")

  const printable = sections.join("\n\n")
  return { sections, printable }
}

/**
 * Print board to stdout.
 */
function printBoard(opts = {}) {
  const { printable } = buildBoard(opts)
  console.log(printable)
}

// ── standalone board from runtime files ──────────────────────────────────────

/**
 * Load all available intelligence for a sport+date from runtime files
 * and build the board. Used by scripts/board.js.
 */
function loadAndBuildBoard({ sport = "mlb", date = null, compact = false } = {}) {
  const path = require("path")
  const fs   = require("fs")
  const d    = date || todayKey()
  const dir  = path.join(__dirname, "..", "..", "runtime", "tracking")

  function safeRequire(p) {
    try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null } catch (_) { return null }
  }

  // Load snapshot rows
  let snapshotRows = []
  try {
    const snapPath = path.join(__dirname, "..", "..", `snapshot-${sport}.json`)
    const snap = safeRequire(snapPath)
    snapshotRows = snap?.data?.rows || snap?.rows || []
  } catch (_) {}

  // Load tracked bets
  const trackedBets = safeRequire(path.join(dir, `${sport}_tracked_bets_${d}.json`)) || []
  const trackedBest = safeRequire(path.join(dir, `${sport}_tracked_best_${d}.json`))
  const entries = trackedBest?.entries || []

  // Line shopping + timing
  let lineShopping = null
  let timingResult = null
  let bookState    = null

  try {
    const { buildLineShopping, loadBookState } = require("./buildLineShoppingIntelligence")
    const { buildMarketTiming, loadTimingState } = require("./buildMarketTimingIntelligence")
    bookState = loadBookState()
    if (snapshotRows.length) {
      lineShopping = buildLineShopping(snapshotRows, { sport, bookState })
      timingResult = buildMarketTiming(snapshotRows, { lineShopping, timingState: loadTimingState(), bookState })
    }
  } catch (_) {}

  // Ledger report
  let ledgerReport = null
  try {
    const { buildNightlyReport } = require("./buildPersonalLedger")
    ledgerReport = buildNightlyReport({ sport, date: d, windowDays: 30 })
  } catch (_) {}

  // Bankroll from tracked bets
  const bankrollInfo = trackedBest?.metadata
    ? { bankroll: trackedBest.metadata.bankroll, dailyRiskBudget: trackedBest.metadata.dailyRiskBudget }
    : null

  // Use tracked_best entries enriched with tracked_bet data
  const betMap = new Map()
  for (const b of trackedBets) betMap.set(b.id, b)
  const bets = entries.map((e) => {
    const tb = trackedBets.find(
      (b) => b.player === e.player && b.statFamily?.toLowerCase() === (e.propType || "").toLowerCase().replace(/\s+/g, "") && b.side?.[0] === (e.side || "")[0]?.toLowerCase()
    )
    return {
      ...e,
      edge:         e.edgeProbability,
      modelProb:    e.predictedProbability,
      statFamily:   e.propType?.toLowerCase().replace(/\s+/g, ""),
      confidenceTier: e.bucket?.split(".").pop()?.toUpperCase() || "PLAYABLE",
      sportsbook:   e.book,
      odds:         e.odds,
      confidence:   tb?.confidence,
      tier:         tb?.tier,
      oddsAmerican: e.odds,
    }
  })

  return buildBoard({ bets, lineShopping, timingResult, bookState, ledgerReport, sport, date: d, bankrollInfo, compact })
}

function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
}

module.exports = {
  buildBoard,
  printBoard,
  loadAndBuildBoard,
  badgesForPlay,
  processBadge,
  BADGES,
  divider,
  formatProp,
  fmtOdds,
  fmtEdge,
  fmtClv,
  fmtProb,
}
