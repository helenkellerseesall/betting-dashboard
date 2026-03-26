import { useEffect, useMemo, useState } from "react"
import "./App.css"

function diversifyByTeam(rows: any[], maxPerTeam = 2, limit = 20) {
  const teamCounts = new Map<string, number>()
  const out: any[] = []

  for (const row of rows) {
    const team = row.team || "UNK"
    const count = teamCounts.get(team) || 0

    if (count >= maxPerTeam) continue

    out.push(row)
    teamCounts.set(team, count + 1)

    if (out.length >= limit) break
  }

  return out
}

function formatDetroitGameDate(gameTime: string) {
  const date = new Date(gameTime)

  return date.toLocaleDateString("en-US", {
    timeZone: "America/Detroit",
    month: "numeric",
    day: "numeric"
  })
}

function formatDetroitGameTime(gameTime: string) {
  const date = new Date(gameTime)

  return date.toLocaleTimeString("en-US", {
    timeZone: "America/Detroit",
    hour: "numeric",
    minute: "2-digit"
  })
}

function getSnapshotFreshness(status: any, source: string) {
  if (!status?.updatedAt) {
    return {
      label: "No snapshot loaded",
      detail: "Refresh snapshot first",
      color: "#6b7280"
    }
  }

  const updatedMs = new Date(status.updatedAt).getTime()
  if (Number.isNaN(updatedMs)) {
    return {
      label: "Unknown snapshot state",
      detail: "Invalid timestamp",
      color: "#6b7280"
    }
  }

  const ageSeconds = Math.max(0, Math.floor((Date.now() - updatedMs) / 1000))
  const ageMinutes = Math.floor(ageSeconds / 60)
  const isLive = source === "Live rebuild"

  if (ageMinutes < 5) {
    return {
      label: isLive ? "Fresh live snapshot" : "Fresh cached snapshot",
      detail: `${ageMinutes}m old`,
      color: "#15803d"
    }
  }

  if (ageMinutes < 30) {
    return {
      label: isLive ? "Recent live snapshot" : "Cached snapshot",
      detail: `${ageMinutes}m old`,
      color: isLive ? "#15803d" : "#ca8a04"
    }
  }

  const ageHours = Math.floor(ageMinutes / 60)
  return {
    label: isLive ? "Older live snapshot" : "Stale cached snapshot",
    detail: ageHours < 24 ? `${ageHours}h old` : `${Math.floor(ageHours / 24)}d old`,
    color: isLive ? "#15803d" : "#dc2626"
  }
}

function getSnapshotSourceStyle(source: string) {
  if (source === "Live rebuild") {
    return { color: "#15803d", fontWeight: "bold" as const }
  }

  if (source === "Cached") {
    return { color: "#2563eb", fontWeight: "bold" as const }
  }

  return { color: "#6b7280", fontWeight: "bold" as const }
}

function toAmericanOdds(value: any) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9+-]/g, "")
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function americanToDecimalOdds(odds: number) {
  if (!Number.isFinite(odds) || odds === 0) return null
  if (odds > 0) return 1 + odds / 100
  return 1 + 100 / Math.abs(odds)
}

function calculateProjectedReturn(rows: any[], stake = 5) {
  if (!rows?.length) return null

  let decimalProduct = 1

  for (const row of rows) {
    const americanOdds = toAmericanOdds(row?.odds)
    if (americanOdds == null) return null

    const decimalOdds = americanToDecimalOdds(americanOdds)
    if (decimalOdds == null) return null

    decimalProduct *= decimalOdds
  }

  return stake * decimalProduct
}

function formatProjectedReturn(value: number | null) {
  if (value == null) return null
  return `$${value.toFixed(2)}`
}

function formatDualParlayTitle(title: string, slip: any) {
  const projectedReturn = formatProjectedReturn(slip?.projectedReturn ?? null)
  return projectedReturn ? `${title} (${projectedReturn})` : title
}

function deriveCooldownEndsAtMs(status: any, baseNow = Date.now()) {
  if (!status || status.forceRefreshAvailable === true) return null

  const remainingMs = Number(status.cooldownRemainingMs ?? 0)
  if (Number.isFinite(remainingMs) && remainingMs > 0) {
    return baseNow + remainingMs
  }

  const remainingSeconds = Number(status.cooldownRemainingSeconds ?? 0)
  if (Number.isFinite(remainingSeconds) && remainingSeconds > 0) {
    return baseNow + remainingSeconds * 1000
  }

  return null
}

function getDualSlip(dualParlays: any, category: string, bookKey: "fanduel" | "draftkings") {
  if (!dualParlays) return null

  const root = dualParlays?.bestAvailable || dualParlays
  const nested = root?.[category]?.[bookKey]
  if (nested?.legs?.length) return nested

  const flat = root?.[category]
  if (!flat) return null

  if (flat?.book) {
    const normalizedBook = String(flat.book).toLowerCase()
    if ((bookKey === "fanduel" && normalizedBook === "fanduel") || (bookKey === "draftkings" && normalizedBook === "draftkings")) {
      return flat
    }
  }

  if (Array.isArray(flat)) {
    const matchingLegs = flat.filter((row: any) => {
      const normalizedBook = String(row?.book || "").toLowerCase()
      return (bookKey === "fanduel" && normalizedBook === "fanduel") || (bookKey === "draftkings" && normalizedBook === "draftkings")
    })

    if (matchingLegs.length) {
      return {
        book: bookKey === "fanduel" ? "FanDuel" : "DraftKings",
        legs: matchingLegs,
        projectedReturn: calculateProjectedReturn(matchingLegs),
        confidence: null,
      }
    }
  }

  return null
}

function getSlipForCategory(
  dualParlays: any,
  category: string,
  bookKey: "fanduel" | "draftkings",
  expectedCount?: number
) {
  const dualSlip = getDualSlip(dualParlays, category, bookKey)
  if (!dualSlip?.legs?.length) return null
  if (expectedCount && dualSlip.legs.length < expectedCount) return null
  return dualSlip
}

function renderSlipRange(
  renderDualTable: (title: string, slip: any) => any,
  dualParlays: any,
  bookKey: "fanduel" | "draftkings",
  prefix: string,
  keyPrefix: string,
  start: number,
  end: number
) {
  const root = dualParlays?.bestAvailable || dualParlays || {}

  const counts = Array.from({ length: end - start + 1 }, (_, index) => start + index).filter((legCount) => {
    const slip = root?.[`${keyPrefix}${legCount}`]?.[bookKey]
    return Boolean(slip?.legs?.length)
  })

  return counts
    .map((legCount) =>
      renderDualTable(
        `${prefix} ${legCount}-Leg`,
        getSlipForCategory(dualParlays, `${keyPrefix}${legCount}`, bookKey, legCount)
      )
    )
    .filter(Boolean)
}

function renderPayoutFitPortfolio(dualParlays: any, bookKey: "fanduel" | "draftkings") {
  const bookName = bookKey === "fanduel" ? "FanDuel" : "DraftKings"
  const portfolio = dualParlays?.payoutFitPortfolio?.[bookKey]

  if (!portfolio) return null

  const bands = ["smallHitters", "midUpside", "bigUpside", "lotto"] as const
  const bandLabels = {
    smallHitters: "Small Hitters ($1-2)",
    midUpside: "Mid Upside ($2-3)",
    bigUpside: "Big Upside ($3-4)",
    lotto: "Lotto ($4-5)"
  }

  const hasAnyOptions = bands.some(band => portfolio[band]?.options?.length > 0)
  if (!hasAnyOptions) return null

  return (
    <div className="portfolio-section">
      <h3 style={{ marginTop: 0, marginBottom: 14 }}>{bookName} Payout-Fit Portfolio</h3>
      {bands.map(band => {
        const bandData = portfolio[band]
        if (!bandData?.options?.length) return null
        return (
          <div key={band} className="portfolio-band">
            <h4 style={{ marginTop: 0, marginBottom: 10 }}>{bandLabels[band]}</h4>
            <div className="portfolio-grid">
              {bandData.options.slice(0, 3).map((option: any, index: number) => (
                <div key={index} className="portfolio-card">
                  <div className="portfolio-card-title">{option.label}</div>
                  <div className="portfolio-card-meta">
                    <div><strong>Stake:</strong> ${option.stake}</div>
                    <div><strong>Projected Return:</strong> {formatProjectedReturn(option.projectedReturn)}</div>
                    <div><strong>Estimated Profit:</strong> ${option.estimatedProfit?.toFixed(2)}</div>
                    <div><strong>Odds (Amer):</strong> {option.oddsAmerican}</div>
                    <div><strong>Confidence:</strong> {option.confidence}</div>
                    <div><strong>Leg Count:</strong> {option.legCount}</div>
                  </div>
                  <div className="portfolio-legs">
                    <strong className="portfolio-legs-title">Legs</strong>
                    <ul className="portfolio-legs-list">
                      {option.legs.map((leg: any, legIndex: number) => (
                        <li key={legIndex} className="portfolio-leg-item">
                          {leg.playerName} <span style={{ color: "#6b7280" }}>{leg.statType}</span> {leg.line} ({leg.odds}/{leg.book}) · Hit: {leg.hitRate}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}


export default function App() {
  const [bestProps, setBestProps] = useState<any[]>([])
  const [compactBest, setCompactBest] = useState<any[]>([])
  const [parlays, setParlays] = useState<any>(null)
  const [dualParlays, setDualParlays] = useState<any>(null)
  const [bestAvailablePayload, setBestAvailablePayload] = useState<any>(null)
  const [todaysCard, setTodaysCard] = useState<any>(null)
  const [snapshotStatus, setSnapshotStatus] = useState<any>(null)
  const [refreshingSnapshot, setRefreshingSnapshot] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)
  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const [snapshotSource, setSnapshotSource] = useState<string>("Unknown")
  const [nowMs, setNowMs] = useState(Date.now())
  const [cooldownEndsAtMs, setCooldownEndsAtMs] = useState<number | null>(null)
  const [labelingInProgress, setLabelingInProgress] = useState(false)
  const [showSingles, setShowSingles] = useState(false)
  const [showCompactBest, setShowCompactBest] = useState(false)
  const [showResearchReference, setShowResearchReference] = useState(false)
  const [showOperations, setShowOperations] = useState(false)
  const [manualResultForm, setManualResultForm] = useState({
    player: "",
    propType: "Points",
    side: "Over",
    line: "",
    book: "FanDuel",
    outcome: 1,
    gameDate: new Date().toISOString().split("T")[0]
  })

  async function fetchJsonWithFallback(url: string, options?: RequestInit) {
    const res = await fetch(url, options)
    let json: any = null
    let text: string | null = null

    try {
      json = await res.json()
    } catch {
      try {
        text = await res.text()
      } catch {
        text = null
      }
    }

    return { res, json, text }
  }

  function describeFetchFailure(url: string, payload: { res: Response; json: any; text: string | null }) {
    const { res, json, text } = payload
    const status = `${res.status} ${res.statusText || ""}`.trim()
    const errorLabel = json?.error || null
    const details = json?.details || null
    const fallback = text ? text.slice(0, 200) : null
    const detail = details || fallback

    if (errorLabel && detail) return `${status}: ${errorLabel} (${detail})`
    if (errorLabel) return `${status}: ${errorLabel}`
    if (detail) return `${status}: ${detail}`
    return `${status} (${url})`
  }

  // Derive Today's Card (daily and lotto slips) from /api/best-available data
  function deriveTodaysCardSlips(payload: any) {
    const root = payload?.bestAvailable || payload
    if (!root) {
      return { FanDuel: { daily: null, lotto: null }, DraftKings: { daily: null, lotto: null } }
    }

    const toRenderableLeg = (leg: any) => ({
      player: leg?.player || leg?.playerName,
      propType: leg?.propType || leg?.statType,
      side: leg?.side,
      line: leg?.line,
      book: leg?.book,
      odds: leg?.odds,
      team: leg?.team,
      gameTime: leg?.gameTime,
      hitRate: leg?.hitRate,
      edge: leg?.edge,
      openingLine: leg?.openingLine,
      openingOdds: leg?.openingOdds,
      lineMove: leg?.lineMove,
      oddsMove: leg?.oddsMove,
      marketMovementTag: leg?.marketMovementTag,
      minutesRisk: leg?.minutesRisk,
      trendRisk: leg?.trendRisk,
      outcome: leg?.outcome,
      eventId: leg?.eventId,
    })

    const legSignature = (legs: any[]) =>
      (legs || [])
        .map((leg) => `${leg?.player || leg?.playerName}|${leg?.propType || leg?.statType}|${leg?.side}|${leg?.line}`)
        .sort()
        .join("||")

    const normalizeSlip = (slip: any, source: string) => {
      const projectedReturn = Number(slip?.projectedReturn)
      if (!Array.isArray(slip?.legs) || slip.legs.length < 2 || !Number.isFinite(projectedReturn)) return null

      return {
        source,
        book: slip.book,
        legs: slip.legs.map(toRenderableLeg),
        legCount: slip.legs.length,
        projectedReturn,
        confidence: slip.confidence || null,
        trueProbability: Number(slip.trueProbability || 0),
        signature: legSignature(slip.legs),
      }
    }

    const getBookPortfolio = (bookKey: "fanduel" | "draftkings") => root?.payoutFitPortfolio?.[bookKey] || {}

    const getBandOptions = (bookKey: "fanduel" | "draftkings", band: "smallHitters" | "midUpside" | "bigUpside" | "lotto") => {
      const options = getBookPortfolio(bookKey)?.[band]?.options || []
      return options
        .map((option: any, index: number) => {
          const source = option?.label || `payoutFit:${band}:${index}`
          return normalizeSlip(option, source)
        })
        .filter(Boolean)
    }

    const pickBestTargetSlip = (
      options: any[],
      minReturn: number,
      maxReturn: number,
      preferredConfidence: "High" | "Medium" | "Low"
    ) => {
      const midpoint = (minReturn + maxReturn) / 2
      const confidenceToRank = (value: any) => {
        const key = String(value || "").toLowerCase()
        if (key === "high") return 3
        if (key === "medium") return 2
        if (key === "low") return 1
        return 0
      }

      const preferredRank = confidenceToRank(preferredConfidence)

      const candidates = (options || [])
        .filter((option) => Number.isFinite(Number(option?.projectedReturn)))
        .filter((option) => {
          const projectedReturn = Number(option.projectedReturn)
          return projectedReturn >= minReturn && projectedReturn <= maxReturn
        })

      if (!candidates.length) return null

      candidates.sort((a, b) => {
        const aConfidence = confidenceToRank(a.confidence)
        const bConfidence = confidenceToRank(b.confidence)

        const aPreferred = aConfidence >= preferredRank ? 1 : 0
        const bPreferred = bConfidence >= preferredRank ? 1 : 0
        if (bPreferred !== aPreferred) return bPreferred - aPreferred

        if (bConfidence !== aConfidence) return bConfidence - aConfidence

        const aDistance = Math.abs(Number(a.projectedReturn) - midpoint)
        const bDistance = Math.abs(Number(b.projectedReturn) - midpoint)
        return aDistance - bDistance
      })

      return candidates[0]
    }

    const result: any = {
      FanDuel: { daily: null, lotto: null },
      DraftKings: { daily: null, lotto: null },
    }

    for (const [book, bookKey] of [["FanDuel", "fanduel"], ["DraftKings", "draftkings"]] as const) {
      const smallHitters = getBandOptions(bookKey, "smallHitters")
      const midUpside = getBandOptions(bookKey, "midUpside")
      const bigUpside = getBandOptions(bookKey, "bigUpside")
      const lottoBand = getBandOptions(bookKey, "lotto")

      const dailyCandidates = [...smallHitters, ...midUpside]
      const lottoCandidates = [...bigUpside, ...lottoBand]

      const resolvedDaily = pickBestTargetSlip(dailyCandidates, 15, 60, "Medium")
      const resolvedLotto = pickBestTargetSlip(lottoCandidates, 60, 150, "Medium")

      result[book].daily = resolvedDaily
      result[book].lotto = resolvedLotto

      console.log(`[TODAY'S CARD] ${book} daily=`, resolvedDaily ? `${resolvedDaily.source} ${resolvedDaily.legCount}L $${resolvedDaily.projectedReturn.toFixed(2)} ${resolvedDaily.confidence || "Unknown"}` : "none")
      console.log(`[TODAY'S CARD] ${book} lotto=`, resolvedLotto ? `${resolvedLotto.source} ${resolvedLotto.legCount}L $${resolvedLotto.projectedReturn.toFixed(2)} ${resolvedLotto.confidence || "Unknown"}` : "none")
    }

    return result
  }

  async function loadDashboardData() {
    setDashboardError(null)
    const errors: string[] = []

    const bestPayload = await fetchJsonWithFallback("http://localhost:4000/props/best")
    const bestJson = bestPayload.res.ok ? bestPayload.json : []
    if (!bestPayload.res.ok) errors.push(describeFetchFailure("http://localhost:4000/props/best", bestPayload))

    const compactBestPayload = await fetchJsonWithFallback("http://localhost:4000/api/best/compact")
    const compactBestJson = compactBestPayload.res.ok ? compactBestPayload.json : {}
    if (!compactBestPayload.res.ok) errors.push(describeFetchFailure("http://localhost:4000/api/best/compact", compactBestPayload))

    const parlaysPayload = await fetchJsonWithFallback("http://localhost:4000/parlays")
    const parlaysJson = parlaysPayload.res.ok ? parlaysPayload.json : {}
    if (!parlaysPayload.res.ok) errors.push(describeFetchFailure("http://localhost:4000/parlays", parlaysPayload))

    const dualPayload = await fetchJsonWithFallback("http://localhost:4000/parlays/dual")
    const dualJson = dualPayload.res.ok ? dualPayload.json : {}
    if (!dualPayload.res.ok) errors.push(describeFetchFailure("http://localhost:4000/parlays/dual", dualPayload))

    const bestAvailablePayloadRes = await fetchJsonWithFallback("http://localhost:4000/api/best-available")
    const bestAvailableJson = bestAvailablePayloadRes.res.ok ? bestAvailablePayloadRes.json : {}
    if (!bestAvailablePayloadRes.res.ok) errors.push(describeFetchFailure("http://localhost:4000/api/best-available", bestAvailablePayloadRes))

    const statusPayload = await fetchJsonWithFallback("http://localhost:4000/snapshot/status")
    const statusJson = statusPayload.res.ok ? statusPayload.json : {}
    if (!statusPayload.res.ok) errors.push(describeFetchFailure("http://localhost:4000/snapshot/status", statusPayload))

    const todaysPayload = await fetchJsonWithFallback("http://localhost:4000/picks/today")
    const todaysJson = todaysPayload.res.ok ? todaysPayload.json : null
    if (!todaysPayload.res.ok) errors.push(describeFetchFailure("http://localhost:4000/picks/today", todaysPayload))

    setBestProps(bestJson)
    setCompactBest(Array.isArray(compactBestJson?.best) ? compactBestJson.best : [])
    setParlays(parlaysJson)
    setDualParlays(dualJson)
    setBestAvailablePayload(bestAvailableJson)
    setSnapshotStatus(statusJson)
    setTodaysCard(todaysJson)
    setCooldownEndsAtMs(deriveCooldownEndsAtMs(statusJson))

    if (statusJson?.updatedAt) {
      setSnapshotSource(statusJson?.snapshotSource || "Unknown")
    }

    if (errors.length > 0) {
      setDashboardError(`Dashboard load errors: ${errors.join("; ")}`)
    }
  }

  async function refreshSnapshot() {
    setRefreshingSnapshot(true)
    setRefreshMessage(null)

    try {
      const url = "http://localhost:4000/refresh-snapshot"
      const payload = await fetchJsonWithFallback(url)
      const json = payload.json

      if (!payload.res.ok) {
        setRefreshMessage(describeFetchFailure(url, payload))
        return
      }

      if (json?.cached) {
        setRefreshMessage("Used cached snapshot")
      } else if (json?.ok) {
        setRefreshMessage("Snapshot refreshed")
      } else if (json?.error) {
        setRefreshMessage(json.error)
      } else {
        setRefreshMessage("Refresh completed")
      }

      const nextNow = Date.now()
      setSnapshotStatus(json || {})
      setCooldownEndsAtMs(deriveCooldownEndsAtMs(json, nextNow))
      setNowMs(nextNow)
      setSnapshotSource(json?.snapshotSource || (json?.cached ? "Cached" : json?.ok ? "Live rebuild" : "Unknown"))
      await loadDashboardData()
    } catch (err) {
      setRefreshMessage("Refresh failed (backend unreachable or non-JSON response)")
    } finally {
      setRefreshingSnapshot(false)
    }
  }

  async function forceRefreshSnapshot() {
    setRefreshingSnapshot(true)
    setRefreshMessage(null)

    try {
      const url = "http://localhost:4000/refresh-snapshot?force=1"
      const payload = await fetchJsonWithFallback(url)
      const json = payload.json

      if (!payload.res.ok) {
        setRefreshMessage(describeFetchFailure(url, payload))
        return
      }

      if (json?.error) {
        if (json?.retryInSeconds) {
          setRefreshMessage(`Cooldown active (${json.retryInSeconds}s remaining)`)
        } else {
          setRefreshMessage(json.error)
        }
      } else if (json?.ok) {
        setRefreshMessage("Forced snapshot rebuild")
      } else {
        setRefreshMessage("Force refresh completed")
      }

      const nextNow = Date.now()
      const mergedStatus = { ...(snapshotStatus || {}), ...(json || {}) }
      setSnapshotStatus(mergedStatus)
      setCooldownEndsAtMs(deriveCooldownEndsAtMs(mergedStatus, nextNow))
      setNowMs(nextNow)
      setSnapshotSource(json?.snapshotSource || (json?.cached ? "Cached" : json?.ok ? "Live rebuild" : snapshotSource))
      await loadDashboardData()
    } catch (err) {
      setRefreshMessage("Force refresh failed (backend unreachable or non-JSON response)")
    } finally {
      setRefreshingSnapshot(false)
    }
  }

  async function labelOutcome(leg: any, outcome: 0 | 1) {
    setLabelingInProgress(true)
    try {
      const res = await fetch("http://localhost:4000/label-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: leg.eventId,
          player: leg.player,
          propType: leg.propType,
          side: leg.side,
          line: leg.line,
          book: leg.book,
          outcome: outcome
        })
      })
      const json = await res.json()
      if (json?.ok) {
        await loadDashboardData()
      }
    } catch (err) {
      console.error("Label outcome failed:", err)
    } finally {
      setLabelingInProgress(false)
    }
  }

  async function submitManualResult() {
    if (!manualResultForm.player.trim()) {
      alert("Please enter player name")
      return
    }
    if (!manualResultForm.line.trim()) {
      alert("Please enter line")
      return
    }
    if (!manualResultForm.gameDate) {
      alert("Please select a game date")
      return
    }

    try {
      const res = await fetch("http://localhost:4000/label-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: `manual-${manualResultForm.gameDate}-${Date.now()}`,
          player: manualResultForm.player.trim(),
          propType: manualResultForm.propType,
          side: manualResultForm.side,
          line: parseFloat(manualResultForm.line),
          book: manualResultForm.book,
          outcome: manualResultForm.outcome,
          gameDate: manualResultForm.gameDate
        })
      })

      const json = await res.json()
      if (json?.ok) {
        alert(
          `Recorded: ${manualResultForm.player} ${manualResultForm.propType} ${manualResultForm.side} ${manualResultForm.line} on ${manualResultForm.gameDate}`
        )
        setManualResultForm({
          player: "",
          propType: "Points",
          side: "Over",
          line: "",
          book: "FanDuel",
          outcome: 1,
          gameDate: new Date().toISOString().split("T")[0]
        })
        await loadDashboardData()
      } else {
        alert("Failed to record outcome")
      }
    } catch (err) {
      console.error("Error submitting manual result:", err)
      alert("Error recording manual result")
    }
  }

  useEffect(() => {
    loadDashboardData()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

  const diversifiedProps = diversifyByTeam(bestProps, 2, 20)
  
  // Derive today's card slips from best available data
  const todaysCardSlips = deriveTodaysCardSlips(bestAvailablePayload)
  
  // Count payout-fit bands for book portfolio summary boxes
  const bestAvailableRoot = bestAvailablePayload?.bestAvailable || {}
  const smallHittersCount = (bestAvailableRoot?.payoutFitPortfolio?.fanduel?.smallHitters?.options?.length || 0) + 
                            (bestAvailableRoot?.payoutFitPortfolio?.draftkings?.smallHitters?.options?.length || 0)
  const midUpsideCount = (bestAvailableRoot?.payoutFitPortfolio?.fanduel?.midUpside?.options?.length || 0) +
                         (bestAvailableRoot?.payoutFitPortfolio?.draftkings?.midUpside?.options?.length || 0)
  const bigUpsideCount = (bestAvailableRoot?.payoutFitPortfolio?.fanduel?.bigUpside?.options?.length || 0) +
                         (bestAvailableRoot?.payoutFitPortfolio?.draftkings?.bigUpside?.options?.length || 0)
  const lottoCount = (bestAvailableRoot?.payoutFitPortfolio?.fanduel?.lotto?.options?.length || 0) +
                     (bestAvailableRoot?.payoutFitPortfolio?.draftkings?.lotto?.options?.length || 0)
  
  console.log(`[TODAY'S CARD] Band counts: Small Hitters=${smallHittersCount}, Mid Upside=${midUpsideCount}, Big Upside=${bigUpsideCount}, Lotto=${lottoCount}`)
  
  const portfolioBandSummary = [
    { label: "Small Hitters", count: smallHittersCount },
    { label: "Balanced", count: midUpsideCount },
    { label: "Big Upside", count: bigUpsideCount },
    { label: "Lotto", count: lottoCount },
  ]
  const snapshotFreshness = getSnapshotFreshness(snapshotStatus, snapshotSource)
  const snapshotSourceStyle = getSnapshotSourceStyle(snapshotSource)

  const liveCooldownSeconds = useMemo(() => {
    if (!cooldownEndsAtMs) return 0
    return Math.max(0, Math.ceil((cooldownEndsAtMs - nowMs) / 1000))
  }, [cooldownEndsAtMs, nowMs])

  useEffect(() => {
    if (cooldownEndsAtMs && nowMs >= cooldownEndsAtMs) {
      setCooldownEndsAtMs(null)
    }
  }, [cooldownEndsAtMs, nowMs])

  const forceRefreshDisabled = refreshingSnapshot || liveCooldownSeconds > 0

  if (!dualParlays || !parlays || !bestAvailablePayload) return <div style={{ padding: 40 }}>Loading betting engine...</div>

  const renderCardTable = (title: string, rows: any[], secondary = false) => (
    <div style={{ marginBottom: secondary ? 16 : 24 }}>
      <h3
        style={{
          marginBottom: 8,
          fontSize: secondary ? "14px" : "18px",
          color: secondary ? "#6b7280" : "inherit",
          fontWeight: secondary ? 600 : 700,
        }}
      >
        {title}
      </h3>
      {!rows?.length ? (
        <div style={{ color: "#6b7280" }}>No picks available</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
        <table border={1} cellPadding={6} style={{ width: "100%", minWidth: 820, fontSize: secondary ? "11px" : "12px" }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Time</th>
              <th>Team</th>
              <th>Player</th>
              <th>Prop</th>
              <th>Side</th>
              <th>Line</th>
              <th>Book</th>
              <th>Odds</th>
              <th>Hit Rate</th>
              <th>Edge</th>
              <th>EV/u</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any, i: number) => (
              <tr key={i}>
                <td style={{ whiteSpace: "nowrap" }}>{formatDetroitGameDate(r.gameTime)}</td>
                <td style={{ whiteSpace: "nowrap" }}>{formatDetroitGameTime(r.gameTime)} ET</td>
                <td>{r.team?.slice(0, 3).toUpperCase()}</td>
                <td style={{ whiteSpace: "nowrap" }}>{r.player}</td>
                <td>{r.propType}</td>
                <td>{r.side}</td>
                <td>{r.line}</td>
                <td>{r.book === "DraftKings" ? "DK" : r.book === "FanDuel" ? "FD" : r.book}</td>
                <td>{r.odds}</td>
                <td>{r.hitRate ?? "—"}</td>
                <td>{r.edge ?? "—"}</td>
                <td>{typeof r.evPerUnit === "number" ? r.evPerUnit.toFixed(3) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )

  const renderSlipCard = (title: string, slip: any) => {
    // Don't render empty placeholder cards - just return null if no valid slip
    if (!slip?.legs?.length || slip.legs.length < 2) {
      return null
    }

    return (
      <div style={{ marginBottom: 18, padding: 12, border: "1px solid #d1d5db", borderRadius: 6, backgroundColor: "#fff" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontWeight: "bold" }}>{title}</div>
          <div style={{ color: "#374151" }}>
            <strong>Return:</strong> {formatProjectedReturn(slip.projectedReturn) ?? "—"} &nbsp; | &nbsp;
            <strong>Confidence:</strong> {slip.confidence || "—"}
          </div>
        </div>
        <div style={{ marginTop: 8, color: "#6b7280" }}>
          {slip.legs.map((leg: any, idx: number) => (
            <div key={idx}>
              {leg.player} {leg.propType} {leg.side} {leg.line} ({leg.book === "DraftKings" ? "DK" : leg.book === "FanDuel" ? "FD" : leg.book} {leg.odds})
            </div>
          ))}
        </div>
      </div>
    )
  }

  const renderTable = (title: string, rows: any[]) => (
    <div style={{ marginBottom: 40 }}>
      <h2>{title}</h2>
      <div style={{ overflowX: "auto", marginBottom: 16 }}>
      <table border={1} cellPadding={6} style={{ minWidth: "100%", tableLayout: "auto" }}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Time</th>
            <th>Team</th>
            <th>Player</th>
            <th>Prop</th>
            <th>Line</th>
            <th>Open</th>
            <th>Move</th>
            <th>Market</th>
            <th>Side</th>
            <th>Book</th>
            <th>Odds</th>
            <th>Open Odds</th>
            <th>Odds Move</th>
            <th>Min Risk</th>
            <th>Trend Risk</th>
            <th>Hit Rate</th>
            <th>Edge</th>
            <th>Score</th>
            <th>Label Outcome</th>
          </tr>
        </thead>
        <tbody>
          {rows?.map((r, i) => (
            <tr key={i}>
              <td style={{ whiteSpace: "nowrap" }}>
                {formatDetroitGameDate(r.gameTime)}
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                {formatDetroitGameTime(r.gameTime)} ET
              </td>
              <td>{r.team?.slice(0, 3).toUpperCase()}</td>
              <td style={{ whiteSpace: "nowrap" }}>{r.player}</td>
              <td>{r.propType}</td>
              <td>{r.line}</td>
              <td>{r.openingLine ?? "—"}</td>
              <td>{r.lineMove ?? 0}</td>
              <td>{r.marketMovementTag || "neutral"}</td>
              <td>{r.side}</td>
              <td>{r.book === "DraftKings" ? "DK" : r.book === "FanDuel" ? "FD" : r.book}</td>
              <td>{r.odds}</td>
              <td>{r.openingOdds ?? "—"}</td>
              <td>{r.oddsMove ?? 0}</td>
              <td>{r.minutesRisk || "unknown"}</td>
              <td>{r.trendRisk || "unknown"}</td>
              <td>{r.hitRate}</td>
              <td>{r.edge}</td>
              <td>{r.score}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {r.outcome !== null && r.outcome !== undefined ? (
                  <span style={{ fontWeight: "bold", color: r.outcome === 1 ? "#15803d" : "#dc2626" }}>
                    {r.outcome === 1 ? "✓ Hit" : "✗ Miss"}
                  </span>
                ) : (
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => labelOutcome(r, 1)}
                      disabled={labelingInProgress}
                      style={{
                        padding: "4px 8px",
                        fontSize: "12px",
                        cursor: "pointer",
                        backgroundColor: "#15803d",
                        color: "white",
                        border: "none",
                        borderRadius: "3px"
                      }}
                    >
                      Hit
                    </button>
                    <button
                      onClick={() => labelOutcome(r, 0)}
                      disabled={labelingInProgress}
                      style={{
                        padding: "4px 8px",
                        fontSize: "12px",
                        cursor: "pointer",
                        backgroundColor: "#dc2626",
                        color: "white",
                        border: "none",
                        borderRadius: "3px"
                      }}
                    >
                      Miss
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )

  const renderDualTable = (title: string, slip: any) => {
    if (!slip?.legs?.length) return null

    return (
      <div style={{ marginBottom: 40 }}>
        <h2>{formatDualParlayTitle(title, slip)}</h2>
        <div style={{ marginBottom: 8 }}>
          <strong>Book:</strong> {slip.book} &nbsp; | &nbsp;
          <strong>Projected Return:</strong> {formatProjectedReturn(slip.projectedReturn) ?? "—"} &nbsp; | &nbsp;
          <strong>Confidence:</strong> {slip.confidence || "—"}
        </div>
        <div style={{ overflowX: "auto", marginBottom: 16 }}>
        <table border={1} cellPadding={6} style={{ minWidth: "100%", whiteSpace: "nowrap" }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Time</th>
              <th>Team</th>
              <th>Player</th>
              <th>Prop</th>
              <th>Line</th>
              <th>Open</th>
              <th>Move</th>
              <th>Market</th>
              <th>Side</th>
              <th>Book</th>
              <th>Odds</th>
              <th>Open Odds</th>
              <th>Odds Move</th>
              <th>Min Risk</th>
              <th>Trend Risk</th>
              <th>Hit Rate</th>
              <th>Edge</th>
              <th>Label Outcome</th>
            </tr>
          </thead>
          <tbody>
            {slip.legs.map((r: any, i: number) => (
              <tr key={i}>
                <td style={{ whiteSpace: "nowrap" }}>
                  {formatDetroitGameDate(r.gameTime)}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {formatDetroitGameTime(r.gameTime)} ET
                </td>
                <td>{r.team?.slice(0, 3).toUpperCase()}</td>
                <td style={{ whiteSpace: "nowrap" }}>{r.player}</td>
                <td>{r.propType}</td>
                <td>{r.line}</td>
                <td>{r.openingLine ?? "—"}</td>
                <td>{r.lineMove ?? 0}</td>
                <td>{r.marketMovementTag || "neutral"}</td>
                <td>{r.side}</td>
                <td>{r.book === "DraftKings" ? "DK" : r.book === "FanDuel" ? "FD" : r.book}</td>
                <td>{r.odds}</td>
                <td>{r.openingOdds ?? "—"}</td>
                <td>{r.oddsMove ?? 0}</td>
                <td>{r.minutesRisk || "unknown"}</td>
                <td>{r.trendRisk || "unknown"}</td>
                <td>{r.hitRate}</td>
                <td>{r.edge}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {r.outcome !== null && r.outcome !== undefined ? (
                    <span style={{ fontWeight: "bold", color: r.outcome === 1 ? "#15803d" : "#dc2626" }}>
                      {r.outcome === 1 ? "✓ Hit" : "✗ Miss"}
                    </span>
                  ) : (
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        onClick={() => labelOutcome(r, 1)}
                        disabled={labelingInProgress}
                        style={{
                          padding: "4px 8px",
                          fontSize: "12px",
                          cursor: "pointer",
                          backgroundColor: "#15803d",
                          color: "white",
                          border: "none",
                          borderRadius: "3px"
                        }}
                      >
                        Hit
                      </button>
                      <button
                        onClick={() => labelOutcome(r, 0)}
                        disabled={labelingInProgress}
                        style={{
                          padding: "4px 8px",
                          fontSize: "12px",
                          cursor: "pointer",
                          backgroundColor: "#dc2626",
                          color: "white",
                          border: "none",
                          borderRadius: "3px"
                        }}
                      >
                        Miss
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    )
  }

  const fanDuelConservativeTables = renderSlipRange(renderDualTable, dualParlays, "fanduel", "FanDuel Conservative", "highestHitRate", 2, 4)
  const draftKingsConservativeTables = renderSlipRange(renderDualTable, dualParlays, "draftkings", "DraftKings Conservative", "highestHitRate", 2, 4)

  const fanDuelBalancedTables = renderSlipRange(renderDualTable, dualParlays, "fanduel", "FanDuel Balanced", "highestHitRate", 5, 6)
  const draftKingsBalancedTables = renderSlipRange(renderDualTable, dualParlays, "draftkings", "DraftKings Balanced", "highestHitRate", 5, 6)

  const fanDuelLottoTables = renderSlipRange(renderDualTable, dualParlays, "fanduel", "FanDuel Lotto", "highestHitRate", 7, 10)
  const draftKingsLottoTables = renderSlipRange(renderDualTable, dualParlays, "draftkings", "DraftKings Lotto", "highestHitRate", 7, 10)

  return (
    <div className="dashboard-shell">
      <div className="dashboard-grid">
        <section className="dashboard-section">
          <h1 style={{ marginTop: 0, marginBottom: 8, fontSize: "26px", lineHeight: 1.2 }}>Betting Engine Dashboard</h1>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, fontSize: "13px" }}>
            <div>
              <strong>Snapshot State:</strong>{" "}
              <span style={{ color: snapshotFreshness.color, fontWeight: "bold" }}>
                {snapshotFreshness.label}
              </span>
              {snapshotFreshness.detail ? ` (${snapshotFreshness.detail})` : ""}
            </div>
            <div>
              <strong>Snapshot Source:</strong>{" "}
              <span style={snapshotSourceStyle}>{snapshotSource}</span>
            </div>
            <div>
              <strong>Slate Date:</strong> {snapshotStatus?.primarySlateDateLocal || "—"}
            </div>
            <div>
              <strong>Slate Mode:</strong> {snapshotStatus?.slateMode || "—"}
            </div>
            <div>
              <strong>Last Refresh:</strong> {snapshotStatus?.updatedAtLocal || "—"}
            </div>
            <div>
              <strong>Events:</strong> {snapshotStatus?.events ?? 0} &nbsp; | &nbsp;
              <strong>Props:</strong> {snapshotStatus?.props ?? 0} &nbsp; | &nbsp;
              <strong>Best Props:</strong> {snapshotStatus?.bestProps ?? 0}
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              {(() => {
                const etfmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })
                const todayEt = etfmt.format(new Date())

                // totalGames: snapshotStatus.events = oddsSnapshot.events.length on the backend.
                // This is the full count of scheduled slate events — not filtered through props.
                const totalGames = (snapshotStatus?.events as number | undefined) ?? 0

                // Canonical active slate date (YYYY-MM-DD in ET).
                const primarySlateDateKey = String(snapshotStatus?.primarySlateDateLocal ?? "").trim()
                const activeDate = /^\d{4}-\d{2}-\d{2}$/.test(primarySlateDateKey) ? primarySlateDateKey : null

                // startedGames: how many slate-day matchups have already started, computed live
                // on the backend at request time via isPregameEligibleRow (gameMs <= Date.now()).
                // When a game starts it ALWAYS has props flagged as started, so this count is
                // reliable as a floor for "started games on today's slate".
                const startedGames = (snapshotStatus?.startedEligibleGames as number | undefined) ?? 0

                // eligibleRemaining = total scheduled events minus confirmed-started games.
                // This avoids prop-derived eventId sets or diagnostics.rawCoverage.uniqueGames.
                //   activeDate > todayEt → rollover: entire slate is future, 0 started
                //   activeDate === todayEt → today: totalGames - startedGames
                //   activeDate < todayEt or null → past / unknown: 0
                let eligibleRemaining = 0
                if (activeDate) {
                  if (activeDate > todayEt) {
                    eligibleRemaining = totalGames
                  } else if (activeDate === todayEt) {
                    eligibleRemaining = Math.max(0, totalGames - startedGames)
                  }
                }

                console.log("[SLATE-EVENTS-DEBUG]", {
                  "events.length": totalGames,
                  "startedEligibleGames": startedGames,
                  "chosenActiveSlateDate": activeDate,
                  todayEt,
                  totalGames,
                  eligibleRemaining,
                })

                return (
                  <>
                    <strong>Total Games:</strong> {totalGames} &nbsp; / &nbsp;
                    <strong>Eligible Games Remaining:</strong> {eligibleRemaining}
                  </>
                )
              })()}
            </div>
          </div>
        </section>

        <section className="dashboard-section">
          <h2 style={{ marginTop: 0, marginBottom: 8, fontSize: "20px" }}>Refresh Controls</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={refreshSnapshot}
            disabled={refreshingSnapshot}
            style={{
              padding: "8px 14px",
              fontWeight: "bold",
              cursor: refreshingSnapshot ? "not-allowed" : "pointer"
            }}
          >
            {refreshingSnapshot ? "Refreshing Snapshot..." : "Refresh Snapshot"}
          </button>

          <button
            onClick={forceRefreshSnapshot}
            disabled={forceRefreshDisabled}
            style={{
              padding: "8px 14px",
              fontWeight: "bold",
              cursor: forceRefreshDisabled ? "not-allowed" : "pointer"
            }}
          >
            {liveCooldownSeconds > 0
              ? `Force Refresh (${liveCooldownSeconds}s)`
              : "Force Refresh"}
          </button>
        </div>

        {refreshMessage ? (
          <div style={{ marginTop: 8 }}>
            <strong>Refresh Result:</strong> {refreshMessage}
          </div>
        ) : null}

        {dashboardError ? (
          <div style={{ marginTop: 8, color: "#dc2626" }}>
            <strong>Dashboard Error:</strong> {dashboardError}
          </div>
        ) : null}
        </section>

        <section className="dashboard-section dashboard-section-accent">
        <h2 style={{ marginTop: 0, marginBottom: 8, fontSize: "22px" }}>Today’s Card</h2>
        <div style={{ color: "#6b7280", marginBottom: 10, fontSize: "13px" }}>
          Mix-and-match: conservative (high hit-rate), balanced (+EV), and lotto (higher payout lines).
        </div>

        <h3 style={{ marginTop: 8, marginBottom: 8, fontSize: "16px" }}>Parlay Strategies</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
          <div style={{ marginBottom: 8 }}>
            {renderSlipCard("FanDuel Best Daily Target", todaysCardSlips?.FanDuel?.daily)}
            {!todaysCardSlips?.FanDuel?.daily ? (
              <div style={{ padding: 12, fontSize: "13px", visibility: "hidden" }}>placeholder</div>
            ) : null}
            {renderSlipCard("FanDuel Best Lotto Target", todaysCardSlips?.FanDuel?.lotto)}
            {!todaysCardSlips?.FanDuel?.lotto ? (
              <div style={{ padding: 12, fontSize: "13px", visibility: "hidden" }}>placeholder</div>
            ) : null}
          </div>
          <div style={{ marginBottom: 8 }}>
            {renderSlipCard("DraftKings Best Daily Target", todaysCardSlips?.DraftKings?.daily)}
            {!todaysCardSlips?.DraftKings?.daily ? (
              <div style={{ padding: 12, fontSize: "13px", visibility: "hidden" }}>placeholder</div>
            ) : null}
            {renderSlipCard("DraftKings Best Lotto Target", todaysCardSlips?.DraftKings?.lotto)}
            {!todaysCardSlips?.DraftKings?.lotto ? (
              <div style={{ padding: 12, fontSize: "13px", visibility: "hidden" }}>placeholder</div>
            ) : null}
          </div>
        </div>

        <div style={{ marginTop: 12, borderTop: "1px solid #e5e7eb", paddingTop: 10 }}>
          <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: "14px", color: "#6b7280", fontWeight: 600 }}>Portfolio Band Counts</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 10 }}>
            {portfolioBandSummary.map((group) => (
              <div key={group.label} style={{ padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, backgroundColor: "#fff", fontSize: "12px" }}>
                <strong>{group.label}</strong>
                <div style={{ color: "#6b7280" }}>{group.count} options</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: "14px", color: "#6b7280", fontWeight: 600 }}>Compact Best</h3>
            <button
              onClick={() => setShowCompactBest((value) => !value)}
              style={{
                padding: "6px 10px",
                fontSize: "12px",
                backgroundColor: "#f3f4f6",
                color: "#374151",
                border: "1px solid #d1d5db",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              {showCompactBest ? "Hide Compact Best" : "Show Compact Best"}
            </button>
          </div>

          {showCompactBest ? (
            compactBest.length ? (
              <div style={{ overflowX: "auto", marginBottom: 12 }}>
                <table border={1} cellPadding={6} style={{ width: "100%", minWidth: 760, fontSize: "12px", backgroundColor: "#fff" }}>
                  <thead>
                    <tr>
                      <th>Team</th>
                      <th>Player</th>
                      <th>Prop</th>
                      <th>Side</th>
                      <th>Line</th>
                      <th>Odds</th>
                      <th>Hit Rate</th>
                      <th>Edge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compactBest.map((row: any, index: number) => (
                      <tr key={`${row?.player || "unknown"}-${row?.propType || "prop"}-${row?.line || index}-${row?.book || "book"}-${index}`}>
                        <td>{row?.team || "-"}</td>
                        <td>{row?.player || "-"}</td>
                        <td>{row?.propType || "-"}</td>
                        <td>{row?.side || "-"}</td>
                        <td>{row?.line ?? "-"}</td>
                        <td>{row?.odds ?? "-"}</td>
                        <td>{row?.hitRate || "-"}</td>
                        <td>{row?.edge ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ color: "#6b7280", fontSize: "13px", marginBottom: 12 }}>No compact props available</div>
            )
          ) : null}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: "14px", color: "#6b7280", fontWeight: 600 }}>Singles</h3>
            <button
              onClick={() => setShowSingles((value) => !value)}
              style={{
                padding: "6px 10px",
                fontSize: "12px",
                backgroundColor: "#f3f4f6",
                color: "#374151",
                border: "1px solid #d1d5db",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              {showSingles ? "Hide Singles" : "Show Singles"}
            </button>
          </div>

          {showSingles ? (
            <div style={{ display: "block", backgroundColor: "#fcfcfd", padding: 10, borderRadius: 6, border: "1px solid #eef2f7" }}>
              {renderCardTable("Conservative Singles", todaysCard?.conservative || [], true)}
              {renderCardTable("Balanced (+EV) Singles", todaysCard?.balanced || [], true)}
              {renderCardTable("Lotto Singles", todaysCard?.lotto || [], true)}
            </div>
          ) : (
            <div style={{ color: "#6b7280", fontSize: "13px" }}>Singles hidden</div>
          )}
        </div>
        </section>

        <section className="dashboard-section dashboard-section-accent">
          <h2 style={{ marginTop: 0, marginBottom: 8, fontSize: "20px" }}>Recommended Slip Portfolio</h2>
          {renderPayoutFitPortfolio(bestAvailableRoot, "fanduel")}
          {renderPayoutFitPortfolio(bestAvailableRoot, "draftkings")}
        </section>

        <section className="dashboard-section">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>Operations & Labeling</h2>
            <button
              onClick={() => setShowOperations((value) => !value)}
              style={{
                padding: "6px 10px",
                fontSize: "12px",
                backgroundColor: "#f3f4f6",
                color: "#374151",
                border: "1px solid #d1d5db",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              {showOperations ? "Hide Operations" : "Show Operations"}
            </button>
          </div>

          {showOperations ? (
            <>
        <div style={{ marginTop: 14, padding: 12, backgroundColor: "#f3f4f6", borderRadius: 6 }}>
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>ML Model & Training</h3>
          <div style={{ fontSize: "14px", lineHeight: "1.6" }}>
            <p>
              <strong>Status:</strong> ML scoring is active on all slip tiers (Best Value, Highest Hit Rate, Safest).
            </p>
            <p>
              <strong>Current Model:</strong> Logistic Regression with StandardScaler. Features: edge, hitRate, avgMin, minStd, valueStd, lineMove, oddsMove, dvpScore, line, odds.
            </p>
            <p>
              <strong>How to Improve:</strong> Label outcomes using the "Label Outcome" buttons below, then retrain the model:
            </p>
            <code style={{ display: "block", padding: 8, backgroundColor: "#fff", borderRadius: 3, fontSize: "12px", overflow: "auto" }}>
              python3 backend/ml/train_simple.py http://localhost:4000/export/training.json
            </code>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => window.open("http://localhost:4000/parlays", "_blank", "noopener,noreferrer")}
            style={{
              padding: "8px 14px",
              fontWeight: "bold",
              cursor: "pointer"
            }}
          >
            Open Parlays JSON
          </button>

          <button
            onClick={() => window.open("http://localhost:4000/parlays/dual", "_blank", "noopener,noreferrer")}
            style={{
              padding: "8px 14px",
              fontWeight: "bold",
              cursor: "pointer"
            }}
          >
            Open Dual JSON
          </button>

          <button
            onClick={() => window.open("http://localhost:4000/export/training.json", "_blank", "noopener,noreferrer")}
            style={{
              padding: "8px 14px",
              fontWeight: "bold",
              cursor: "pointer",
              backgroundColor: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: "4px"
            }}
          >
            Export Training JSON
          </button>

          <button
            onClick={() => {
              const link = document.createElement("a")
              link.href = "http://localhost:4000/export/training.csv"
              link.download = "training-data.csv"
              link.click()
            }}
            style={{
              padding: "8px 14px",
              fontWeight: "bold",
              cursor: "pointer",
              backgroundColor: "#10b981",
              color: "white",
              border: "none",
              borderRadius: "4px"
            }}
          >
            Download Training CSV
          </button>
        </div>

        <div style={{
        marginBottom: 0,
        marginTop: 14,
        padding: 16,
        backgroundColor: "#f3f4f6",
        borderRadius: "6px",
        border: "1px solid #d1d5db"
      }}>
        <h3>Record Settled Outcomes (Manual Entry)</h3>
        <p style={{ color: "#6b7280", fontSize: "14px" }}>
          Use this form to manually record game outcomes for props that have already settled. This lets you label results even after the daily slate refresh clears old props.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ display: "block", marginBottom: 4, fontWeight: "bold" }}>
              Game Date
            </label>
            <input
              type="date"
              value={manualResultForm.gameDate}
              onChange={(e) =>
                setManualResultForm({ ...manualResultForm, gameDate: e.target.value })
              }
              style={{
                width: "100%",
                padding: "6px 8px",
                border: "1px solid #d1d5db",
                borderRadius: "4px",
                fontSize: "14px"
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 4, fontWeight: "bold" }}>
              Player Name
            </label>
            <input
              type="text"
              value={manualResultForm.player}
              onChange={(e) =>
                setManualResultForm({ ...manualResultForm, player: e.target.value })
              }
              placeholder="e.g. LaMelo Ball"
              style={{
                width: "100%",
                padding: "6px 8px",
                border: "1px solid #d1d5db",
                borderRadius: "4px",
                fontSize: "14px"
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 4, fontWeight: "bold" }}>
              Prop Type
            </label>
            <select
              value={manualResultForm.propType}
              onChange={(e) =>
                setManualResultForm({ ...manualResultForm, propType: e.target.value })
              }
              style={{
                width: "100%",
                padding: "6px 8px",
                border: "1px solid #d1d5db",
                borderRadius: "4px",
                fontSize: "14px"
              }}
            >
              <option>Points</option>
              <option>Rebounds</option>
              <option>Assists</option>
              <option>Steals</option>
              <option>Blocks</option>
              <option>3-Pointers Made</option>
              <option>Turnovers</option>
            </select>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 4, fontWeight: "bold" }}>
              Side
            </label>
            <select
              value={manualResultForm.side}
              onChange={(e) =>
                setManualResultForm({ ...manualResultForm, side: e.target.value })
              }
              style={{
                width: "100%",
                padding: "6px 8px",
                border: "1px solid #d1d5db",
                borderRadius: "4px",
                fontSize: "14px"
              }}
            >
              <option>Over</option>
              <option>Under</option>
            </select>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 4, fontWeight: "bold" }}>
              Line
            </label>
            <input
              type="text"
              value={manualResultForm.line}
              onChange={(e) =>
                setManualResultForm({ ...manualResultForm, line: e.target.value })
              }
              placeholder="e.g. 25.5"
              style={{
                width: "100%",
                padding: "6px 8px",
                border: "1px solid #d1d5db",
                borderRadius: "4px",
                fontSize: "14px"
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 4, fontWeight: "bold" }}>
              Book
            </label>
            <select
              value={manualResultForm.book}
              onChange={(e) =>
                setManualResultForm({ ...manualResultForm, book: e.target.value })
              }
              style={{
                width: "100%",
                padding: "6px 8px",
                border: "1px solid #d1d5db",
                borderRadius: "4px",
                fontSize: "14px"
              }}
            >
              <option>FanDuel</option>
              <option>DraftKings</option>
            </select>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 4, fontWeight: "bold" }}>
              Result
            </label>
            <select
              value={manualResultForm.outcome}
              onChange={(e) =>
                setManualResultForm({ ...manualResultForm, outcome: parseInt(e.target.value) })
              }
              style={{
                width: "100%",
                padding: "6px 8px",
                border: "1px solid #d1d5db",
                borderRadius: "4px",
                fontSize: "14px"
              }}
            >
              <option value={1}>Hit</option>
              <option value={0}>Miss</option>
            </select>
          </div>
        </div>

        <button
          onClick={submitManualResult}
          style={{
            padding: "10px 16px",
            fontWeight: "bold",
            cursor: "pointer",
            backgroundColor: "#8b5cf6",
            color: "white",
            border: "none",
            borderRadius: "4px",
            fontSize: "14px"
          }}
        >
          Record Outcome
        </button>
        </div>
            </>
          ) : (
            <div style={{ marginTop: 10, color: "#6b7280", fontSize: "13px" }}>Manual labeling and training tools hidden</div>
          )}
        </section>

      <div className="dashboard-section dashboard-section-muted">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: "24px", color: "#374151" }}>Research & Reference</h1>
          <button
            onClick={() => setShowResearchReference((value) => !value)}
            style={{
              padding: "6px 10px",
              fontSize: "12px",
              backgroundColor: "#f3f4f6",
              color: "#374151",
              border: "1px solid #d1d5db",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            {showResearchReference ? "Hide Research" : "Show Research"}
          </button>
        </div>

        {showResearchReference ? (
          <>
            <h2 style={{ marginTop: 24 }}>Reference: Highest Hit Rate Slips By Book</h2>

            {fanDuelConservativeTables.length > 0 ? (
              <>
                <h1 style={{ marginTop: 40 }}>FanDuel Conservative Strategy (2-4 Legs)</h1>
                {fanDuelConservativeTables}
              </>
            ) : null}

            {draftKingsConservativeTables.length > 0 ? (
              <>
                <h1 style={{ marginTop: 40 }}>DraftKings Conservative Strategy (2-4 Legs)</h1>
                {draftKingsConservativeTables}
              </>
            ) : null}

            {fanDuelBalancedTables.length > 0 ? (
              <>
                <h1 style={{ marginTop: 40 }}>FanDuel Balanced Strategy (3-6 Legs)</h1>
                {fanDuelBalancedTables}
              </>
            ) : null}

            {draftKingsBalancedTables.length > 0 ? (
              <>
                <h1 style={{ marginTop: 40 }}>DraftKings Balanced Strategy (3-6 Legs)</h1>
                {draftKingsBalancedTables}
              </>
            ) : null}

            {fanDuelLottoTables.length > 0 ? (
              <>
                <h1 style={{ marginTop: 40 }}>FanDuel Lotto Strategy (4-8 Legs)</h1>
                {fanDuelLottoTables}
              </>
            ) : null}

            {draftKingsLottoTables.length > 0 ? (
              <>
                <h1 style={{ marginTop: 40 }}>DraftKings Lotto Strategy (4-8 Legs)</h1>
                {draftKingsLottoTables}
              </>
            ) : null}

            {renderTable("Research: Best Props", bestProps.slice(0, 25))}
            {renderTable("Research: Diversified Best Props", diversifiedProps)}
          </>
        ) : (
          <div style={{ marginTop: 10, color: "#6b7280", fontSize: "13px" }}>Research tables hidden</div>
        )}
      </div>
      </div>
    </div>
  )
}
