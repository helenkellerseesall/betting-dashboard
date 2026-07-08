"use strict"

/**
 * deeplinkCompose.js — server-side betslip-link composition (2026-07-07,
 * TEST-LINKS panel). Composes per-book single + cross-game multi links from
 * CAPTURED snapshot artifacts (betLink/betSid — vendor-supplied, DEEPLINK-2A)
 * per CC's verified templates (docs/research/2026-07-07-multileg-betslip-links.md §2).
 *
 * FIELD-TEST DOCTRINE (07-07, operator desktop test — both lessons recorded in
 * the research doc): (1) SIDs/links die when markets start or move — links MUST
 * be composed FRESH from the live snapshot at tap time, never printed hours
 * ahead; (2) desktop web largely ignores app-oriented prefill links — the phone
 * is the only honest test surface.
 *
 * Twin note: frontend/mobile/index.html carries a display-side composer for the
 * slip tray (client state). THIS module is the canonical server-side composer
 * (test-links endpoint + scratch scripts); consolidation candidate once the
 * matrix stabilizes. Never prefills stakes anywhere.
 */

const norm = (b) => { const k = String(b || "").toLowerCase().replace(/[^a-z]/g, ""); return k === "hardrock" ? "hardrockbet" : k }

function fillPlaceholders(url, cfg, opts = {}) {
  if (!url) return null
  let u = String(url)
  if (/\{state\}/.test(u)) {
    if (!cfg || !cfg.state) return null
    u = u.split("{state}").join(cfg.state)
  }
  u = u.split("{pickType}").join(opts.pickType || "single")
  u = u.split("{wagerAmount}").join("") // stakes are NEVER prefilled (survival doctrine)
  if (/\{[a-zA-Z]+\}/.test(u)) return null
  return u
}

/** Single-leg link for one snapshot row (vendor link + placeholder fills). */
function composeSingle(row, cfg) {
  if (!row || !row.betLink) return null
  return fillPlaceholders(row.betLink, cfg)
}

/**
 * Cross-game multi-leg link for same-book legs, per CC §2. Returns
 * { url, syntax } or null when the book's syntax is unknown/artifacts missing.
 * Caller enforces the matrix gate + cross-game rule; this is pure composition.
 */
function composeMulti(bookDisplay, legs, cfg) {
  const key = norm(bookDisplay)
  if (!Array.isArray(legs) || legs.length < 2) return null
  try {
    if (key === "fanduel") {
      const parts = legs.map((l) => (String(l.betLink || "").match(/marketId=([\d.]+)&selectionId=(\d+)/) || []))
      if (!parts.every((m) => m[1] && m[2])) return null
      return { url: "https://sportsbook.fanduel.com/addToBetslip?" + parts.map((m, i) => `marketId%5B${i}%5D=${m[1]}&selectionId%5B${i}%5D=${m[2]}`).join("&"), syntax: "array-form (PARTIAL — phone test)" }
    }
    if (key === "draftkings") {
      const toks = legs.map((l) => (l.betSid ? encodeURIComponent(String(l.betSid)) : null))
      if (!toks.every(Boolean)) return null
      return { url: `https://sportsbook.draftkings.com/?outcomes=${toks.join(",")}`, syntax: "comma candidate (UNKNOWN — share-discovery pending)" }
    }
    if (key === "betmgm") {
      const trips = legs.map((l) => (String(l.betLink || "").match(/options=(\d+-\d+-\d+)/) || [])[1])
      if (!trips.every(Boolean) || !cfg || !cfg.state) return null
      return { url: `https://sports.${cfg.state}.betmgm.com/en/sports?options=${trips.join(",")}&type=combo`, syntax: "comma combo (CONFIRMED — official docs)" }
    }
    if (key === "betrivers") {
      const sids = legs.map((l) => l.betSid).filter(Boolean)
      const ev = (String(legs[0].betLink || "").match(/#event\/(\d+)/) || [])[1]
      if (sids.length !== legs.length || !ev || !cfg || !cfg.state) return null
      return { url: `https://${cfg.state}.betrivers.com/?page=sportsbook#event/${ev}?coupon=combination|${sids.join(",")}|`, syntax: "Kambi coupon ladder (UNKNOWN)" }
    }
    if (key === "hardrockbet") {
      const sids = legs.map((l) => l.betSid).filter(Boolean)
      if (sids.length !== legs.length) return null
      return { url: `https://app.hardrock.bet/?deep_link_value=betslip/${sids.join(",")}`, syntax: "sid ladder (SPECULATIVE)" }
    }
  } catch (_) { return null }
  return null
}

module.exports = { composeSingle, composeMulti, fillPlaceholders, normBookKey: norm }
