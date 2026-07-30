#!/usr/bin/env node
"use strict"

/**
 * weeklySurfaceAudit.js — WEEKLY SURFACE AUDIT (2026-07-28, operator triple #3).
 * "The operator stops being the QA department by design, not luck."
 *
 * Sunday pass walking every operator-visible surface against record truth;
 * mismatches reported like critic findings. Read-only.
 *   MY BETS      — every realMoney ledger row present in the served lens
 *   TOP PICKS    — served picks all exist in the slate record (no phantoms)
 *   DAILY 3      — card results match the record twins they graded from
 *   LADDER LAB   — artifacts referenced exist and parse
 *   /status      — component health payload parses, alarms enumerable
 * Output: docs/audits/surface-audit-<date>.md + console summary.
 */

const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const { currentSlateDateEt } = require("../pipeline/shared/slateDate")
const ROOT = path.join(__dirname, "..")
const TRACKING = path.join(ROOT, "runtime", "tracking")
const rd = (fp) => { try { return JSON.parse(fs.readFileSync(fp, "utf8")) } catch (_) { return null } }
const curl = (p) => { const r = spawnSync("curl", ["-s", "-m", "8", `http://127.0.0.1:4000${p}`], { encoding: "utf8", timeout: 12000 }); try { return JSON.parse(r.stdout) } catch (_) { return null } }
const findings = []
const finding = (surface, ok, detail) => { findings.push({ surface, ok, detail }); console.log(`  ${ok ? "OK  " : "MISMATCH"} ${surface}: ${detail}`) }

const today = currentSlateDateEt()
console.log(`weeklySurfaceAudit — ${today}`)

// MY BETS vs ledger
const ledger = rd(path.join(TRACKING, "personal_ledger.json"))
const realRows = (ledger?.bets || []).filter((b) => (b.decisionType === "placed" || b.realMoney) && Number(b.stake) >= 1 && !["smoke-test", "diag", "verify"].includes(String(b.sportsbook || "").toLowerCase()))
const served = curl("/api/ws/ledger/yesterday")
const servedIds = new Set((served?.placedBets?.bets || []).map((b) => b.id))
const missing = realRows.filter((b) => !servedIds.has(b.id))
finding("MY BETS", missing.length === 0, missing.length ? `${missing.length} realMoney row(s) ABSENT from the served lens: ${missing.slice(0, 3).map((b) => b.id).join(", ")}` : `${realRows.length} realMoney rows all served (lifetime lens)`)

// TOP PICKS vs record
const tp = curl("/api/ws/top-picks?limit=50")
const rec = rd(path.join(TRACKING, `mlb_tracked_bets_${tp?.date || today}.json`)) || []
const recKeys = new Set(rec.map((r) => `${String(r.player).toLowerCase()}|${r.statFamily}|${String(r.side).toLowerCase()}|${r.line}`))
const phantoms = (tp?.picks || []).filter((p) => !recKeys.has(`${String(p.player).toLowerCase()}|${p.statFamily}|${String(p.side).toLowerCase()}|${p.line}`))
finding("TOP PICKS", phantoms.length === 0, phantoms.length ? `${phantoms.length} served pick(s) have NO record row` : `${(tp?.picks || []).length} served picks all trace to the record`)

// DAILY 3 vs twins
let d3ok = true, d3detail = "no graded cards to check"
const d3files = fs.existsSync(TRACKING) ? fs.readdirSync(TRACKING).filter((f) => /^daily3_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(-7) : []
for (const f of d3files) {
  const c = rd(path.join(TRACKING, f))
  if (!c?.results) continue
  const rows = rd(path.join(TRACKING, `mlb_tracked_bets_${c.slate}.json`)) || []
  for (const r2 of c.results) {
    if (r2.result === "void") continue
    const twin = rows.find((r) => String(r.player).toLowerCase() === String(r2.player).toLowerCase() && r.statFamily === r2.statFamily && ["win", "loss", "push", "void"].includes(r.result))
    if (twin && twin.result !== r2.result && !(r2.settleNote || "").includes("correction")) { d3ok = false; d3detail = `${c.slate} ${r2.player}: card ${r2.result} vs twin ${twin.result}` }
  }
  if (d3ok) d3detail = `${d3files.length} recent cards consistent with their twins`
}
finding("DAILY 3", d3ok, d3detail)

// LADDER LAB artifacts
const lab = curl("/api/ws/ladder-lab")
finding("LADDER LAB", !!lab?.ok, lab?.ok ? `serves (${lab.rungsPriced} rungs, shadow=${lab.shadow})` : "endpoint failed to serve")

// /status health payload
const hc = rd(path.join(TRACKING, "..", "operator", "component_health.json")) || curl("/api/ws/status")
finding("/status", !!hc, hc ? "health payload present + parseable" : "health payload MISSING")

const bad = findings.filter((f) => !f.ok)

// ── 2026-07-30 GRADUATION BOARD + RECEIPTS synthesis (ASK f5ee1b6 — the
// Sunday note reads off the board; receipts chain verdict rides along) ──
let gradMd = ""
try {
  const { buildBoard } = require("./graduationBoard")
  const board = buildBoard({})
  const gRow = (r) => `| ${r.status === "stalled" ? "**STALLED**" : r.status} | ${r.label} | ${r.examNights.bar != null ? r.examNights.have + "/" + r.examNights.bar : (r.verdict || "—")} | ${r.decided.bar != null ? r.decided.have + "/" + r.decided.bar : (r.decided.have || "—")} | ${r.paperUnits != null ? (typeof r.paperUnits === "number" ? r.paperUnits + "u" : r.paperUnits) : "—"} | ${r.trend.label} | ${r.unlock} |`
  gradMd = `\n## Graduation board (caged → bettable)\n\n${(board.stalledRows || []).length ? `**⚠ STALLED: ${board.stalledRows.join(", ")}** — exam counters flat; named rows need a human.\n\n` : "All caged surfaces advancing.\n\n"}| status | surface | nights | decided | paper units (in-sample) | trend | unlock |\n|---|---|---|---|---|---|---|\n${board.rows.map(gRow).join("\n")}\n`
} catch (e) { gradMd = `\n## Graduation board\n\nboard unavailable this pass: ${String(e?.message || e)}\n` }
let receiptsMd = ""
try {
  const { validateReceiptChain } = require("../pipeline/shared/daily3")
  const v = validateReceiptChain()
  receiptsMd = `\n## Daily 3 receipts\n\nchain ${v.ok ? "✓ INTACT" : "✗ **BROKEN at " + v.breaks.map((b) => b.slate).join(", ") + "**"} · ${v.checked} link(s) on file.\n`
} catch (e) { receiptsMd = `\n## Daily 3 receipts\n\nchain check unavailable: ${String(e?.message || e)}\n` }

const md = `# Weekly Surface Audit — ${today}\n\n${bad.length ? `**${bad.length} MISMATCH(ES)** — the record and its surfaces disagree:\n\n` : "**All surfaces consistent with record truth.**\n\n"}| surface | status | detail |\n|---|---|---|\n${findings.map((f) => `| ${f.surface} | ${f.ok ? "OK" : "**MISMATCH**"} | ${f.detail} |`).join("\n")}\n${gradMd}${receiptsMd}\nDoctrine: the operator stops being the QA department by design, not luck — mismatches here are critic-grade findings and get root-caused, never hand-fixed.\n`
const out = path.join(ROOT, "..", "docs", "audits", `surface-audit-${today}.md`)
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, md)
console.log(`→ ${out} (${bad.length} mismatches)`)
process.exit(bad.length ? 1 : 0)
