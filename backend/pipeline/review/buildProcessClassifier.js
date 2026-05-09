"use strict"

/**
 * Process Classifier (Session W)
 *
 * Pure functions. No IO. No side effects.
 *
 * Classifies each bet outcome by PROCESS QUALITY, not just win/loss.
 * This is the core intelligence evolution layer: understanding WHY we won
 * or lost matters more than whether we won or lost on any given day.
 *
 * 10 Process Archetypes:
 *
 *   good_process_bad_variance
 *     Model had the right read (strong edge, high confidence, correct direction)
 *     but variance produced a narrow miss. Would repeat the bet every time.
 *
 *   bad_process_lucky_hit
 *     Low confidence, thin edge, high odds. Won anyway. Do NOT repeat this process.
 *
 *   suppressed_winner
 *     Good-edge candidate was in the pool but filtered before slip construction.
 *     Result hit. System should have surfaced this → review suppression logic.
 *
 *   fake_sharp_trap
 *     Steam signal was present and we acted on it, but the line move was fake
 *     (public panic, liquidity event, not real sharp action). Lost.
 *
 *   offensive_eruption_miss
 *     High-implied environment, game erupted offensively, but we had 0 slips
 *     covering that environment. Loss via context blindness.
 *
 *   overconfident_suppression
 *     High confidence UNDER. The stat line blew out to the OVER by 2+ units.
 *     Model was systematically wrong on environment read.
 *
 *   hidden_sharpness
 *     Low-profile candidate (BASE tier or thin edge). Actually had strong real
 *     signal (high actual result). Quiet winner.
 *
 *   correlated_success
 *     Multiple legs from the same game/player cluster all hit together.
 *     Validates correlated slate construction.
 *
 *   correlated_failure
 *     Multiple legs from the same game/player cluster all missed together.
 *     Validates the risk of correlated slate exposure.
 *
 *   stale_line_exploitation_success / stale_line_exploitation_failure
 *     We identified a stale line and exploited it. Win or loss.
 *
 * Process Score (0.0 – 1.0):
 *   How well does the process align with long-run positive-EV betting?
 *   1.0 = would repeat this exact process in every parallel universe
 *   0.0 = never repeat this — lucky or sloppy
 *
 *   Key insight: a high-process-score loss is MORE valuable than a low-process-score win.
 *   The system evolves by learning from both.
 */

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function round4(x) {
  return Math.round(Number(x) * 10000) / 10000
}

function isHit(bet) {
  const r = String(bet.result || "").toLowerCase()
  if (r === "win") return true
  if (r === "loss") return false
  const stat = num(bet.actualStat ?? bet.actual_stat)
  const line = num(bet.line)
  const side = String(bet.side || "").toLowerCase()
  if (Number.isFinite(stat) && Number.isFinite(line)) {
    if (side.startsWith("o") || side === "yes") return stat > line
    if (side.startsWith("u") || side === "no") return stat < line
  }
  return null
}

function statFam(b) {
  return String(b?.statFamily || b?.stat_family || "").toLowerCase()
}

// ── Core classification ───────────────────────────────────────────────────────

/**
 * Classify a single bet by process archetype.
 *
 * @param {object} bet     — tracked bet object
 * @param {object} context — {
 *   slipped: bool,           — was this bet in any slip?
 *   steamEvent: bool,        — was there a steam signal on this bet?
 *   staleLine: bool,         — was this identified as a stale line?
 *   eruptionGame: bool,      — did this game have an offensive eruption?
 *   gameGroup: Array,        — all other settled bets in the same game
 * }
 * @returns {object} classification result
 */
function classifyBetProcess(bet, context = {}) {
  const hit = isHit(bet)
  const edge = num(bet.edge)
  const modelProb = num(bet.modelProb ?? bet.model_prob)
  const confidence = num(bet.confidence)
  const tier = String(bet.tier || "").toUpperCase()
  const side = String(bet.side || "").toLowerCase()
  const odds = num(bet.odds)

  const stat = num(bet.actualStat ?? bet.actual_stat)
  const line = num(bet.line)
  const rawDelta = Number.isFinite(stat) && Number.isFinite(line) ? stat - line : null
  // Signed delta: positive = in bettor's favor
  const signedDelta =
    rawDelta != null
      ? side.startsWith("o") ? rawDelta : -rawDelta
      : null

  const {
    slipped = true,
    steamEvent = false,
    staleLine = false,
    eruptionGame = false,
    gameGroup = [],
  } = context

  const archetypes = []
  let processScore = 0.5  // neutral baseline
  const rationale = []

  // ── 1. Good process / bad variance ─────────────────────────────────────────
  // Strong edge, high confidence, correct direction, narrow miss (<= 0.5 units)
  if (
    hit === false &&
    (confidence || edge || 0) >= 0.05 &&
    (edge || 0) >= 0.07 &&
    rawDelta !== null &&
    Math.abs(rawDelta) <= 0.5
  ) {
    archetypes.push("good_process_bad_variance")
    processScore = 0.87
    rationale.push(
      `Near-line miss |delta|=${Math.abs(rawDelta).toFixed(2)}, edge=${edge?.toFixed(3)}`
    )
  }

  // ── 2. Bad process / lucky hit ──────────────────────────────────────────────
  // Won but the process was thin: low edge, low tier, high odds
  if (
    hit === true &&
    (edge || 0) < 0.04 &&
    (tier === "BASE" || (confidence || 1) < 0.42) &&
    (odds == null || odds >= 200)
  ) {
    archetypes.push("bad_process_lucky_hit")
    processScore = 0.22
    rationale.push(
      `Lucky hit: edge=${edge?.toFixed(3)}, tier=${tier}, odds=${odds}`
    )
  }

  // ── 3. Suppressed winner ────────────────────────────────────────────────────
  // Good-edge bet, in the pool, NOT in any slip, result hit
  if (
    hit === true &&
    !slipped &&
    (edge || 0) >= 0.06 &&
    (tier === "STRONG" || tier === "ELITE" || tier === "PLAYABLE")
  ) {
    archetypes.push("suppressed_winner")
    // Good process to have identified it; bad that slip construction filtered it
    processScore = 0.72
    rationale.push(
      `Suppressed winner: in pool (edge=${edge?.toFixed(3)}, ${tier}) but not slipped`
    )
  }

  // ── 4. Fake sharp trap ──────────────────────────────────────────────────────
  if (steamEvent && hit === false) {
    archetypes.push("fake_sharp_trap")
    processScore = 0.28
    rationale.push("Steam signal present; result missed — potentially fake steam")
  }

  // ── 5. Offensive eruption miss ──────────────────────────────────────────────
  // Game had an eruption, we had the bet, it missed and we had no coverage
  if (eruptionGame && hit === false && !slipped) {
    archetypes.push("offensive_eruption_miss")
    processScore = 0.35
    rationale.push("Game erupted offensively; we had no slip coverage for this environment")
  }

  // ── 6. Overconfident suppression ────────────────────────────────────────────
  // High-confidence UNDER, stat blew out to the OVER by 2+ units
  if (
    side.startsWith("u") &&
    hit === false &&
    (confidence || 0) >= 0.60 &&
    rawDelta !== null &&
    rawDelta >= 2
  ) {
    archetypes.push("overconfident_suppression")
    processScore = 0.18
    rationale.push(
      `Overconfident suppression: conf=${confidence?.toFixed(3)}, stat exceeded line by ${rawDelta.toFixed(2)}`
    )
  }

  // ── 7. Hidden sharpness ─────────────────────────────────────────────────────
  // Low-profile (BASE tier or odds >= +150) with real signal, hit
  if (
    hit === true &&
    (tier === "BASE" || (odds != null && odds >= 150)) &&
    (edge || 0) >= 0.08
  ) {
    archetypes.push("hidden_sharpness")
    processScore = 0.78
    rationale.push(
      `Hidden sharp: low profile but edge=${edge?.toFixed(3)}, odds=${odds}`
    )
  }

  // ── 8 & 9. Correlated success / failure ─────────────────────────────────────
  if (gameGroup.length >= 1 && hit !== null) {
    const settled = gameGroup.filter((b) => isHit(b) !== null)
    if (settled.length >= 1) {
      const groupHits = settled.filter((b) => isHit(b) === true).length
      const totalSettled = settled.length
      // All legs in game hit (including this bet)
      const allHit = groupHits === totalSettled && hit === true
      const allMiss = groupHits === 0 && hit === false

      if (allHit && totalSettled >= 2) {
        archetypes.push("correlated_success")
        processScore = Math.min(1.0, processScore + 0.12)
        rationale.push(`Correlated success: all ${totalSettled + 1} game legs hit`)
      } else if (allMiss && totalSettled >= 2) {
        archetypes.push("correlated_failure")
        processScore = Math.max(0, processScore - 0.10)
        rationale.push(`Correlated failure: all ${totalSettled + 1} game legs missed`)
      }
    }
  }

  // ── 10. Stale line exploitation ─────────────────────────────────────────────
  if (staleLine) {
    const type =
      hit === true
        ? "stale_line_exploitation_success"
        : "stale_line_exploitation_failure"
    archetypes.push(type)
    processScore = hit === true ? 0.83 : 0.45
    rationale.push(`Stale line exploited: ${hit === true ? "WON" : "lost"}`)
  }

  // ── Default fallback (settled, no special archetype) ────────────────────────
  if (!archetypes.length && hit !== null) {
    if (hit === true && (edge || 0) >= 0.06) {
      archetypes.push("standard_process_win")
      processScore = 0.70
    } else if (hit === false && (edge || 0) >= 0.06) {
      archetypes.push("standard_process_loss")
      processScore = 0.65  // good process — losing day is fine
    } else if (hit === true) {
      archetypes.push("thin_edge_win")
      processScore = 0.50
    } else if (hit === false) {
      archetypes.push("thin_edge_loss")
      processScore = 0.40
    }
  }

  return {
    processPrimary: archetypes[0] || "pending",
    processSecondary: archetypes[1] || null,
    processScore: round4(Math.max(0, Math.min(1, processScore))),
    flags: {
      isSuppressedWinner: archetypes.includes("suppressed_winner") ? 1 : 0,
      isEruptionMiss: archetypes.includes("offensive_eruption_miss") ? 1 : 0,
      isFakeSharp: archetypes.includes("fake_sharp_trap") ? 1 : 0,
      isStaleLine: staleLine ? 1 : 0,
      isCorrelated:
        archetypes.includes("correlated_success") ||
        archetypes.includes("correlated_failure")
          ? 1
          : 0,
    },
    rationale: rationale.join("; ") || "Standard outcome — no special classification",
  }
}

// ── Batch classification ──────────────────────────────────────────────────────

/**
 * Classify all bets for one day.
 *
 * Builds game groups automatically for correlation analysis.
 *
 * @param {Array}  bets
 * @param {object} opts
 *   slippedSet      — Set of "player|statFamily" strings that were in slips
 *   steamBetIds     — Set of bet IDs that had a steam signal
 *   staleLineBetIds — Set of bet IDs identified as stale lines
 *   eruptionEventIds — Set of event IDs (games) that erupted
 * @returns {Array} classified bet objects
 */
function classifyAllBets(bets, opts = {}) {
  const {
    slippedSet = new Set(),
    steamBetIds = new Set(),
    staleLineBetIds = new Set(),
    eruptionEventIds = new Set(),
  } = opts

  // Build game groups for correlation analysis
  const gameGroups = {}
  for (const bet of bets) {
    const key = bet.eventId || bet.event_id || bet.matchup || "unknown"
    if (!gameGroups[key]) gameGroups[key] = []
    gameGroups[key].push(bet)
  }

  return bets.map((bet) => {
    const playerKey = `${String(bet.player || "").toLowerCase()}|${statFam(bet)}`
    const gameKey = bet.eventId || bet.event_id || bet.matchup || "unknown"
    const gameGroup = (gameGroups[gameKey] || []).filter((b) => b !== bet)

    const context = {
      slipped: slippedSet.has(playerKey),
      steamEvent: steamBetIds.has(bet.id),
      staleLine: staleLineBetIds.has(bet.id),
      eruptionGame: eruptionEventIds.has(gameKey),
      gameGroup: gameGroup.filter((b) => isHit(b) !== null),
    }

    const classification = classifyBetProcess(bet, context)

    const rawDelta = (() => {
      const s = num(bet.actualStat ?? bet.actual_stat)
      const l = num(bet.line)
      return Number.isFinite(s) && Number.isFinite(l) ? round4(s - l) : null
    })()

    const side = String(bet.side || "").toLowerCase()
    const signedDelta =
      rawDelta != null ? (side.startsWith("o") ? rawDelta : -rawDelta) : null

    return {
      id: bet.id,
      player: bet.player,
      statFamily: bet.statFamily,
      side: bet.side,
      line: num(bet.line),
      modelProb: num(bet.modelProb ?? bet.model_prob),
      edge: num(bet.edge),
      tier: bet.tier,
      volatility: bet.volatility,
      ecologyBucket: bet.ecologyBucket,
      hit: isHit(bet),
      actualValue: num(bet.actualStat ?? bet.actual_stat),
      delta: rawDelta,
      signedDelta: signedDelta != null ? round4(signedDelta) : null,
      ...classification,
    }
  })
}

/**
 * Build a slipped player-stat set from tracked slips.
 */
function buildSlippedSet(slips) {
  const set = new Set()
  for (const slip of slips || []) {
    for (const leg of slip.legs || []) {
      set.add(`${String(leg.player || "").toLowerCase()}|${statFam(leg)}`)
    }
  }
  return set
}

/**
 * Build eruption event ID set from eruption analysis output.
 */
function buildEruptionEventIds(eruptionAnalysis) {
  const set = new Set()
  for (const event of eruptionAnalysis?.events || []) {
    if (event.eventId) set.add(event.eventId)
  }
  return set
}

/**
 * Summarize process classifications across all bets.
 */
function summarizeProcessClassifications(classified) {
  const counts = {}
  let scoreSum = 0
  let scoreN = 0

  for (const c of classified) {
    const p = String(c.processPrimary || "pending")
    counts[p] = (counts[p] || 0) + 1
    if (c.processScore != null) {
      scoreSum += c.processScore
      scoreN += 1
    }
  }

  return {
    counts,
    avgProcessScore: scoreN > 0 ? round4(scoreSum / scoreN) : null,
    suppressedWinners: classified.filter((c) => c.flags?.isSuppressedWinner).length,
    eruptionMisses: classified.filter((c) => c.flags?.isEruptionMiss).length,
    fakeSharps: classified.filter((c) => c.flags?.isFakeSharp).length,
    staleLines: classified.filter((c) => c.flags?.isStaleLine).length,
    correlatedEvents: classified.filter((c) => c.flags?.isCorrelated).length,
  }
}

module.exports = {
  classifyBetProcess,
  classifyAllBets,
  buildSlippedSet,
  buildEruptionEventIds,
  summarizeProcessClassifications,
}
