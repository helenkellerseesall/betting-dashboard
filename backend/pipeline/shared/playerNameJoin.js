"use strict"
// playerNameJoin — INSTRUMENT-REPAIR-PACK (2026-07-21). The ONE cross-source
// player-name join for the G2/N1/Daily-3 instrument stack.
//
// MEASURED PROBLEM (07-20 ladder store): 33/334 players (10%) failed the
// instruments' local `norm` joins against the gamelog caches — two half-blind
// normalizers: the caches key by canonical normalizeName (strips suffixes:
// "Bobby Witt Jr."→"bobby witt", but KEEPS diacritics: "teoscar hernández")
// while the instruments folded diacritics but KEPT suffixes. Witt/Acuña-class
// stars silently absent from every curve join; Hernández/Peña-class missed on
// accents.
//
// THE JOIN KEY: canonical normalizeName FIRST (suffix/punct rules — the
// repo's identity authority), THEN diacritic fold (NFD strip) + a-z/space
// only. Applied to BOTH sides.
// ALIAS FALLBACK (nickname class, Josh↔Joshua): if the key misses, match a
// cache entry whose LAST token equals ours AND whose first token prefix-matches
// (≥3 chars, either direction) — accepted ONLY when exactly one candidate
// (ambiguity ⇒ null, never guess). Collisions in the index ⇒ ambiguous ⇒ null.
const normalizeName = require("../../utils/normalizeName")

function joinKey(name) {
  // FOLD DIACRITICS FIRST: normalizeName DELETES accented chars ("Hernández"
  // → "hernndez"), so folding must happen before it. NOTE: the cache MAP KEYS
  // were built by raw normalizeName and are lossy-mangled — indexes must be
  // built from each entry's raw fullName (preserved), never from the map key.
  const folded = String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  return String(normalizeName(folded) || "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim()
}

/** Build a join index from cache keys (already normalizeName'd) or raw names.
 *  values: whatever the caller maps to. Collisions become AMBIGUOUS (null). */
function buildJoinIndex(entries) {
  const idx = new Map()
  const ambiguous = new Set()
  for (const [name, value] of entries) {
    const k = joinKey(name)
    if (!k) continue
    if (idx.has(k) && idx.get(k) !== value) { ambiguous.add(k); continue }
    idx.set(k, value)
  }
  for (const k of ambiguous) idx.delete(k)
  return { idx, ambiguous }
}

/** Resolve a name against the index: exact join key, then unique prefix-alias. */
function resolvePlayer(index, name) {
  const k = joinKey(name)
  if (!k) return null
  if (index.idx.has(k)) return index.idx.get(k)
  const parts = k.split(" ")
  if (parts.length < 2) return null
  const first = parts[0]
  const rest = parts.slice(1).join(" ")
  const candidates = []
  for (const [ck, v] of index.idx) {
    const cp = ck.split(" ")
    if (cp.length < 2) continue
    if (cp.slice(1).join(" ") !== rest) continue
    const cf = cp[0]
    const pref = first.length >= 3 && cf.startsWith(first)
    const prefR = cf.length >= 3 && first.startsWith(cf)
    if (pref || prefR) candidates.push(v)
  }
  return candidates.length === 1 ? candidates[0] : null // ambiguity ⇒ never guess
}

module.exports = { joinKey, buildJoinIndex, resolvePlayer }
