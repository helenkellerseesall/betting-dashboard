"use strict"

const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

const STORAGE_PATH = path.join(__dirname, "betStorage.json")

function normalizeArray(value) {
  return Array.isArray(value) ? value : []
}

function todayKey(date = new Date()) {
  try {
    return new Date(date).toISOString().slice(0, 10)
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

function betDedupeKey(bet) {
  const date = String(bet?.date || "").trim()
  const player = String(bet?.player || "").trim().toLowerCase()
  const propType = String(bet?.propType || "").trim().toLowerCase()
  return `${date}|${player}|${propType}`
}

async function loadBets() {
  try {
    const raw = await fs.promises.readFile(STORAGE_PATH, "utf8")
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return normalizeArray(parsed)
  } catch (err) {
    if (err && err.code === "ENOENT") return []
    return []
  }
}

async function saveBets(bets) {
  const payload = JSON.stringify(normalizeArray(bets), null, 2)
  const tmp = `${STORAGE_PATH}.tmp`
  await fs.promises.writeFile(tmp, payload)
  await fs.promises.rename(tmp, STORAGE_PATH)
}

function normalizeIncomingBet(bet) {
  const nowDate = todayKey()
  return {
    id: String(bet?.id || "").trim() || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
    date: String(bet?.date || nowDate).trim() || nowDate,
    player: String(bet?.player || "").trim() || null,
    team: String(bet?.team || "").trim() || null,
    propType: String(bet?.propType || "").trim() || null,
    odds: bet?.odds ?? null,
    stake: bet?.stake ?? null,
    edge: bet?.edge ?? null,
    playType: String(bet?.playType || "").trim() || null,
    result: bet?.result ?? null,
    payout: bet?.payout ?? null
  }
}

async function logBet(bet) {
  const normalized = normalizeIncomingBet(bet)
  if (!normalized.player || !normalized.propType) return null

  const bets = await loadBets()
  const key = betDedupeKey(normalized)
  const existing = bets.find((b) => betDedupeKey(b) === key)
  if (existing) return existing

  bets.unshift(normalized)
  await saveBets(bets)
  return normalized
}

async function settleBet(id, result, payout) {
  const betId = String(id || "").trim()
  if (!betId) return null

  const bets = await loadBets()
  const idx = bets.findIndex((b) => String(b?.id || "").trim() === betId)
  if (idx < 0) return null

  const r = String(result || "").trim().toLowerCase()
  const normalizedResult = r === "win" ? "win" : r === "loss" ? "loss" : null
  bets[idx] = {
    ...bets[idx],
    result: normalizedResult,
    payout: payout ?? null
  }
  await saveBets(bets)
  return bets[idx]
}

module.exports = {
  STORAGE_PATH,
  loadBets,
  saveBets,
  logBet,
  settleBet
}

