import type { SportState, AiSlips, BuilderLeg, BuilderPreview, LineShopGroup, TimingClassification, Portfolio, Featured } from "./types"

const BASE = (() => {
  // Allow override via Vite env var; default to localhost for dev
  const fromEnv = (import.meta as any)?.env?.VITE_API_BASE
  if (typeof fromEnv === "string" && fromEnv) return fromEnv.replace(/\/+$/, "")
  return "http://localhost:4000"
})()

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.json() as Promise<T>
}

async function postJson<T>(url: string, body: any): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.json() as Promise<T>
}

export const api = {
  state: (sport: string, date?: string | null) =>
    getJson<SportState>(`${BASE}/api/ws/state?sport=${sport}${date ? `&date=${date}` : ""}`),

  aiSlips: (sport: string, date?: string | null) =>
    getJson<{ slips: AiSlips; summary: string; warnings: string[]; candidateCount: number }>(
      `${BASE}/api/ws/ai-slips?sport=${sport}${date ? `&date=${date}` : ""}`
    ),

  lineShopping: (sport: string, date?: string | null, limit = 80) =>
    getJson<{ groups: LineShopGroup[]; meta: any; ladders: any[] }>(
      `${BASE}/api/ws/line-shopping?sport=${sport}${date ? `&date=${date}` : ""}&limit=${limit}`
    ),

  timing: (sport: string, date?: string | null, urgency?: string) =>
    getJson<{ classifications: TimingClassification[]; meta: any }>(
      `${BASE}/api/ws/timing?sport=${sport}${date ? `&date=${date}` : ""}${urgency ? `&urgency=${urgency}` : ""}`
    ),

  portfolio: (sport: string, date?: string | null) =>
    getJson<Portfolio & { sport: string; date: string }>(
      `${BASE}/api/ws/portfolio?sport=${sport}${date ? `&date=${date}` : ""}`
    ),

  ledger: (windowDays = 30, sport?: string) =>
    getJson<{ windowDays: number; report: any; recent: any[]; totals: any; bankroll: any }>(
      `${BASE}/api/ws/ledger?windowDays=${windowDays}${sport ? `&sport=${sport}` : ""}`
    ),

  firstBasket: (sport: string, date?: string | null) =>
    getJson<{ sport: string; supported: boolean; plays: any[] }>(
      `${BASE}/api/ws/first-basket?sport=${sport}${date ? `&date=${date}` : ""}`
    ),

  featured: (sport: string, date?: string | null) =>
    getJson<Featured>(`${BASE}/api/ws/featured?sport=${sport}${date ? `&date=${date}` : ""}`),

  builderPreview: (legs: BuilderLeg[], stake = 10) =>
    postJson<BuilderPreview>(`${BASE}/api/ws/bet-builder/preview`, { legs, stake }),
}
