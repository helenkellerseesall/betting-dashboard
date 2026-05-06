import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react"
import type { ReactNode } from "react"
import type { BuilderLeg, BuilderPreview, AiSlipLeg, Candidate } from "./types"
import { api } from "./api"
import { statKey } from "./utils"

interface BuilderState {
  legs: BuilderLeg[]
  stake: number
  preview: BuilderPreview | null
  loading: boolean
}

interface BuilderApi {
  state: BuilderState
  addLegFromCandidate: (c: Candidate) => void
  addLegFromAiSlipLeg: (l: AiSlipLeg, slipId?: string) => void
  removeLeg: (id: string) => void
  clear: () => void
  setStake: (s: number) => void
  isLegAdded: (key: string) => boolean
  loadAllSlipLegs: (legs: AiSlipLeg[]) => void
}

const BuilderContext = createContext<BuilderApi | null>(null)

function legKey(l: { player?: string; statFamily?: string; side?: string; line?: number; eventId?: string }): string {
  return [
    String(l.eventId || ""),
    String(l.player || "").toLowerCase().trim(),
    statKey(l as any),
    String(l.side || "").toLowerCase(),
    String(l.line ?? ""),
  ].join("|")
}

export function BuilderProvider({ children }: { children: ReactNode }) {
  const [legs, setLegs] = useState<BuilderLeg[]>([])
  const [stake, setStake] = useState<number>(10)
  const [preview, setPreview] = useState<BuilderPreview | null>(null)
  const [loading, setLoading] = useState<boolean>(false)

  // Debounced preview fetch
  useEffect(() => {
    if (!legs.length) {
      setPreview(null)
      return
    }
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const p = await api.builderPreview(legs, stake)
        setPreview(p)
      } catch (e) {
        setPreview({ legs: legs.length, summary: "Preview failed: backend unreachable" })
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [legs, stake])

  const addLegFromCandidate = useCallback((c: Candidate) => {
    const fam = statKey(c)
    const player = c.player || ""
    const side = String(c.side || "").toLowerCase()
    const line = c.line
    const odds = Number(c.odds ?? c.oddsAmerican)
    if (!player || !fam || !Number.isFinite(odds)) return
    const id = legKey({ player, statFamily: fam, side, line, eventId: c.eventId })
    setLegs((prev) => {
      if (prev.some((p) => p.id === id)) return prev
      const leg: BuilderLeg = {
        id, player,
        team: c.team,
        eventId: c.eventId,
        matchup: c.matchup,
        statFamily: fam,
        side,
        line,
        odds,
        modelProb: c.modelProb ?? c.predictedProbability,
        sportsbook: c.sportsbook ?? c.book,
        book: c.book ?? c.sportsbook,
      }
      return [...prev, leg]
    })
  }, [])

  const addLegFromAiSlipLeg = useCallback((l: AiSlipLeg) => {
    const id = legKey({ player: l.player, statFamily: l.statFamily, side: l.side, line: l.line, eventId: l.eventId })
    setLegs((prev) => {
      if (prev.some((p) => p.id === id)) return prev
      const leg: BuilderLeg = {
        id, player: l.player,
        team: l.team,
        eventId: l.eventId,
        matchup: l.matchup,
        statFamily: l.statFamily,
        side: l.side,
        line: l.line,
        odds: l.odds,
        modelProb: l.modelProb,
        sportsbook: l.book,
        book: l.book,
      }
      return [...prev, leg]
    })
  }, [])

  const loadAllSlipLegs = useCallback((slipLegs: AiSlipLeg[]) => {
    setLegs((prev) => {
      const next = [...prev]
      const existingIds = new Set(prev.map((p) => p.id))
      for (const l of slipLegs) {
        const id = legKey({ player: l.player, statFamily: l.statFamily, side: l.side, line: l.line, eventId: l.eventId })
        if (existingIds.has(id)) continue
        next.push({
          id, player: l.player, team: l.team, eventId: l.eventId, matchup: l.matchup,
          statFamily: l.statFamily, side: l.side, line: l.line, odds: l.odds,
          modelProb: l.modelProb, sportsbook: l.book, book: l.book,
        })
        existingIds.add(id)
      }
      return next
    })
  }, [])

  const removeLeg = useCallback((id: string) => {
    setLegs((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const clear = useCallback(() => setLegs([]), [])

  const isLegAdded = useCallback((key: string) => legs.some((l) => l.id === key), [legs])

  const value = useMemo<BuilderApi>(() => ({
    state: { legs, stake, preview, loading },
    addLegFromCandidate,
    addLegFromAiSlipLeg,
    removeLeg,
    clear,
    setStake,
    isLegAdded,
    loadAllSlipLegs,
  }), [legs, stake, preview, loading, addLegFromCandidate, addLegFromAiSlipLeg, removeLeg, clear, isLegAdded, loadAllSlipLegs])

  return <BuilderContext.Provider value={value}>{children}</BuilderContext.Provider>
}

export function useBuilder() {
  const ctx = useContext(BuilderContext)
  if (!ctx) throw new Error("useBuilder must be used within BuilderProvider")
  return ctx
}

export { legKey }
