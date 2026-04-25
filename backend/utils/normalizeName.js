"use strict"

module.exports = function normalizeName(name) {
  if (!name) return ""

  return String(name)
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/jr|sr|ii|iii/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

