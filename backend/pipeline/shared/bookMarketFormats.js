"use strict"
// bookMarketFormats — OBTAINABILITY-GATE-1 (2026-07-17, operator field catch).
// Reads the committed per-book per-family market-format map. The contract:
//   - formatFor(book, family) → the config entry or null (unknown).
//   - underPurchasable(book, family) → false ONLY for explicit over_only
//     entries. Unknown pairs return true — we never guess a book into
//     restriction; enforcement expands only via committed field truth.
// Config reloads lazily (mtime check) so a config edit + no restart is live
// within a minute on the next lens request.
const fs = require("fs")
const path = require("path")

const CONFIG_PATH = path.join(__dirname, "..", "..", "config", "bookMarketFormats.json")
let _cache = null
let _mtime = 0
let _checkedAt = 0

function _load() {
  const now = Date.now()
  if (_cache && now - _checkedAt < 60000) return _cache
  _checkedAt = now
  try {
    const st = fs.statSync(CONFIG_PATH)
    if (!_cache || st.mtimeMs !== _mtime) {
      _cache = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"))
      _mtime = st.mtimeMs
    }
  } catch (_) { _cache = _cache || {} }
  return _cache
}

const normBook = (b) => String(b || "").toLowerCase().replace(/[^a-z0-9]/g, "")
const normFam = (f) => {
  const s = String(f || "").trim()
  const MAP = { "Hits": "hits", "Total Bases": "totalBases", "RBIs": "rbis", "Runs": "runs", "Home Runs": "hr" }
  return MAP[s] || s
}

function formatFor(book, family) {
  const cfg = _load()
  const b = cfg[normBook(book)]
  if (!b || typeof b !== "object") return null
  const e = b[normFam(family)]
  return e && typeof e === "object" ? e : null
}

function underPurchasable(book, family) {
  const e = formatFor(book, family)
  return !(e && e.sides === "over_only")
}

module.exports = { formatFor, underPurchasable, normBook, normFam }
