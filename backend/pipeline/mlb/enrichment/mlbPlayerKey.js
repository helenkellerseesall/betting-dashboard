"use strict"

function normalizeMlbText(value) {
  return String(value || "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
}

function normalizeMlbPlayerKey(playerName) {
  const normalized = normalizeMlbText(playerName)
  if (!normalized) return ""

  return normalized
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
}

module.exports = {
  normalizeMlbText,
  normalizeMlbPlayerKey
}
