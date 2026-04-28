"use strict"

const normalizeName = require("../../utils/normalizeName")

function norm(v) {
  return String(v == null ? "" : v).trim()
}

/**
 * Build ONE shared player dataset for the slate.
 * Keyed by normalized player name (single source of truth).
 *
 * Each value is a mutable player object that downstream models
 * (Hits, RBI, etc.) should update IN PLACE.
 */
function buildMlbPlayerDataset(input = {}) {
  const rows = Array.isArray(input?.rows) ? input.rows : []
  const playerMap = new Map()

  for (const r of rows) {
    const raw = norm(r?.player)
    if (!raw) continue
    const key = normalizeName(raw)
    if (!key) continue
    if (!playerMap.has(key)) {
      playerMap.set(key, {
        key,
        player: raw,
        team: r?.teamResolved ?? r?.team ?? null,
      })
    }
  }

  return { playerMap }
}

module.exports = { buildMlbPlayerDataset }

