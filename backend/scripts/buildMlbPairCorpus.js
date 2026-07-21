#!/usr/bin/env node
"use strict"

/**
 * buildMlbPairCorpus.js — G3-L1 PAIR-CORPUS EXTRACTION (2026-07-21, approved scope).
 *
 * READ-ONLY over the graded record (mlb_tracked_bets_*.json, full history —
 * CA answer i: outcomes are era-free). Emits the class-tagged co-occurring
 * settled-pair corpus the L2 ρ-fitter + validator consume, plus MEASURED class
 * counts with a pre/post-G1-flip stability slice (flip era = 2026-07-01).
 *
 * PAIR CLASSES (structural, class-not-identity — Law 27):
 *   same_player_multi_family   same game, same player, different families (d)
 *   batter_batter_same_team    same game, different batters, same team (a)
 *   batter_batter_opposing     same game, batters on opposite teams (b)
 *   batter_pitcher_opposition  same game, batter vs the OPPOSING pitcher (c)
 *   pitcher_pitcher_opposing   same game, both starters (counted, v1-excluded)
 *   cross_game                 same slate, different games — the independence
 *                              class (CERTIFIED, not assumed; deterministic
 *                              seeded sample, cap per slate)
 *
 * LEG UNIT: one leg per (player, family) per game — the row with the MEDIAN
 * line among that tuple's graded rows (canonical reference leg; multi-book
 * duplicates collapse). Only decided win/loss rows pair (push/void excluded).
 * Each leg stores {player, family, side, line, prob (served modelProb),
 * probRaw (raw axis when stamped), won} — fitting uses outcomes; probability
 * validation walk-forwards CURRENT curves per CA answer (i).
 *
 * Deterministic: cross-game sampling uses an LCG seeded from the slate string.
 * Output: runtime/tracking/mlb_pair_corpus.jsonl (compact) +
 *         runtime/tracking/mlb_pair_corpus_summary.json (counts + era slice).
 */

const fs = require("fs")
const path = require("path")

const ROOT = path.join(__dirname, "..")
const TRACKING = process.env.G3_TRACKING_DIR || path.join(ROOT, "runtime", "tracking")
const OUT_JSONL = process.env.G3_PAIR_OUT || path.join(TRACKING, "mlb_pair_corpus.jsonl")
const OUT_SUMMARY = process.env.G3_PAIR_SUMMARY || path.join(TRACKING, "mlb_pair_corpus_summary.json")
const FLIP_DAY = "2026-07-01" // G1 era boundary (era rule) — stability slice, not a filter
const CROSS_GAME_CAP_PER_SLATE = 2000

const BATTER_FAMS = new Set(["hits", "totalBases", "hr", "rbis", "runs", "batterKs", "stolenBases"])
const PITCHER_FAMS = new Set(["ks", "outs", "hitsAllowed", "earnedRuns", "walks"])

function lcg(seedStr) {
  let s = 2166136261
  for (let i = 0; i < seedStr.length; i++) { s ^= seedStr.charCodeAt(i); s = (s * 16777619) >>> 0 }
  return () => { s = (s * 48271) % 2147483647 || 1; return s / 2147483647 }
}

function canonicalLegs(rows) {
  // one leg per (player|family) per event: decided rows only, median line
  const byTuple = new Map()
  for (const r of rows) {
    if (!r || !["win", "loss"].includes(String(r.result))) continue
    const fam = String(r.statFamily || "")
    if (!BATTER_FAMS.has(fam) && !PITCHER_FAMS.has(fam)) continue
    const k = `${String(r.player || "").toLowerCase()}|${fam}|${r.eventId || ""}`
    if (!byTuple.has(k)) byTuple.set(k, [])
    byTuple.get(k).push(r)
  }
  const legs = []
  for (const rows2 of byTuple.values()) {
    rows2.sort((a, b) => Number(a.line) - Number(b.line))
    const r = rows2[Math.floor(rows2.length / 2)] // median line = canonical reference leg
    legs.push({
      player: r.player, family: String(r.statFamily), side: String(r.side || "").toLowerCase(),
      line: Number(r.line), prob: Number.isFinite(Number(r.modelProb)) ? Number(r.modelProb) : null,
      probRaw: Number.isFinite(Number(r.modelProbRaw)) ? Number(r.modelProbRaw) : null,
      won: r.result === "win" ? 1 : 0,
      team: r.team || null, eventId: r.eventId || null,
      kind: PITCHER_FAMS.has(String(r.statFamily)) ? "pitcher" : "batter",
    })
  }
  return legs
}

function classify(a, b) {
  if (a.eventId !== b.eventId) return "cross_game"
  if (a.player === b.player) return a.family !== b.family ? "same_player_multi_family" : null
  if (a.kind === "batter" && b.kind === "batter") {
    if (!a.team || !b.team) return null // team-dependent class needs team truth — never guessed
    return a.team === b.team ? "batter_batter_same_team" : "batter_batter_opposing"
  }
  if (a.kind !== b.kind) {
    if (!a.team || !b.team) return null
    return a.team !== b.team ? "batter_pitcher_opposition" : null // same-team batter/pitcher pairs are not the opposition class
  }
  return "pitcher_pitcher_opposing"
}

// ── main ──
const files = fs.readdirSync(TRACKING).filter((f) => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
const counts = {}
const eraCounts = { pre: {}, post: {} }
let slates = 0
let totalLegs = 0
const out = fs.createWriteStream(OUT_JSONL)
for (const f of files) {
  const slate = f.slice(17, 27)
  let rows
  try { rows = JSON.parse(fs.readFileSync(path.join(TRACKING, f), "utf8")) } catch (_) { continue }
  const legs = canonicalLegs(Array.isArray(rows) ? rows : [])
  if (legs.length < 2) continue
  slates++
  totalLegs += legs.length
  const era = slate < FLIP_DAY ? "pre" : "post"
  const emit = (cls, a, b) => {
    counts[cls] = (counts[cls] || 0) + 1
    eraCounts[era][cls] = (eraCounts[era][cls] || 0) + 1
    out.write(JSON.stringify({ slate, cls, a: { p: a.player, f: a.family, s: a.side, l: a.line, mp: a.prob, mpr: a.probRaw, w: a.won }, b: { p: b.player, f: b.family, s: b.side, l: b.line, mp: b.prob, mpr: b.probRaw, w: b.won }, ev: a.eventId === b.eventId ? a.eventId : null }) + "\n")
  }
  // same-game pairs: all pairs within each event
  const byEvent = new Map()
  for (const l of legs) { if (!l.eventId) continue; if (!byEvent.has(l.eventId)) byEvent.set(l.eventId, []); byEvent.get(l.eventId).push(l) }
  for (const evLegs of byEvent.values()) {
    for (let i = 0; i < evLegs.length; i++) for (let j = i + 1; j < evLegs.length; j++) {
      const cls = classify(evLegs[i], evLegs[j])
      if (cls && cls !== "cross_game") emit(cls, evLegs[i], evLegs[j])
    }
  }
  // cross-game: deterministic seeded sample, capped per slate
  const events = [...byEvent.keys()]
  if (events.length >= 2) {
    const rand = lcg(slate)
    let emitted = 0
    let guard = 0
    while (emitted < CROSS_GAME_CAP_PER_SLATE && guard < CROSS_GAME_CAP_PER_SLATE * 5) {
      guard++
      const e1 = events[Math.floor(rand() * events.length)]
      let e2 = events[Math.floor(rand() * events.length)]
      if (e1 === e2) continue
      const l1 = byEvent.get(e1)[Math.floor(rand() * byEvent.get(e1).length)]
      const l2 = byEvent.get(e2)[Math.floor(rand() * byEvent.get(e2).length)]
      emit("cross_game", l1, l2)
      emitted++
    }
  }
}
out.end()

const summary = {
  generatedAt: new Date().toISOString(),
  version: "g3-l1-v1",
  flipDay: FLIP_DAY,
  slates, totalLegs,
  classCounts: counts,
  eraSlice: eraCounts,
  crossGameCapPerSlate: CROSS_GAME_CAP_PER_SLATE,
  _doc: "Class-tagged settled co-occurring pairs (read-only extraction; deterministic; decided win/loss legs only, one median-line reference leg per player/family/game). L2 fits class ρ_Z from outcomes (full history — era-free); probability validation walk-forwards CURRENT curves; the pre/post-flip slice is the stability report, not a filter.",
}
fs.writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2))
console.log(`buildMlbPairCorpus: ${slates} slates · ${totalLegs} canonical legs`)
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(26)} ${String(v).padStart(8)}   (pre-flip ${eraCounts.pre[k] || 0} / post ${eraCounts.post[k] || 0})`)
console.log(`→ ${path.basename(OUT_JSONL)} + ${path.basename(OUT_SUMMARY)}`)
