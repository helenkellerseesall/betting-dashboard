"use strict"
// verifySelfHeal — SELF-HEAL PACK (2026-08-26): after TWO reboots where the
// backend LaunchAgent never auto-started (launchd log: zero launch attempts in
// both boot windows) while the scheduler survived, the survivor becomes the
// resurrector. Pins: restartBackend bootstraps a not-loaded agent before
// kickstarting; the scheduler probes the serve lens every cycle and fires
// bounded resurrection; DARK NIGHTS are stamped on the record (8/24+8/25) and
// NEVER backfilled — the write-once doctrine holds as a testable invariant.
const fs = require("fs")
const path = require("path")
const os = require("os")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }
const rb = rd("scripts/restartBackend.sh")
const sch = rd("scripts/scheduler.sh")

// ── resurrector mechanics ──
check("restartBackend: bootstrap-before-kickstart — print check, enable, bootstrap, legacy load -w fallback (kickstart alone cannot revive a not-loaded agent)",
  /if ! launchctl print "gui\/\$UID\/\$\{LABEL\}"/.test(rb) && /launchctl enable "gui\/\$UID\/\$\{LABEL\}"/.test(rb) &&
  /launchctl bootstrap "gui\/\$UID" "\$PLIST"/.test(rb) && /launchctl load -w "\$PLIST"/.test(rb) &&
  rb.indexOf("launchctl bootstrap") < rb.indexOf("launchctl kickstart -k \"gui"))
check("scheduler: per-cycle serve-lens probe — curl /version 5s cap, 3 consecutive misses, shared 900s rate-limit lock, drift_alerts stamp, counter resets on success AND after fire",
  /curl -s -m 5 -o \/dev\/null "http:\/\/127\.0\.0\.1:4000\/api\/ws\/version"/.test(sch) &&
  /serve_lens_misses=0/.test(sch) && /-ge 3 \]/.test(sch) && /\.auto_recovery_lock/.test(sch) &&
  /-ge 900 \]/.test(sch) && /SELF-HEAL - serve lens dead/.test(sch) &&
  (sch.match(/serve_lens_misses=0/g) || []).length >= 2)
check("doctrine continuity: the hourly sysAudit auto-recovery path (183071c lineage) remains intact alongside the new per-cycle path",
  /sysAudit RED is BACKEND-DOWN — firing restartBackend\.sh/.test(sch) && /Phase Backend-AutoRecovery-1A/.test(sch))

// ── dark nights: stamped, surfaced, never backfilled ──
const dn = (() => { try { return JSON.parse(rd("runtime/tracking/dark_nights.json")) } catch (_) { return null } })()
check("dark_nights.json: 8/24 + 8/25 stamped machine_dark with real evidence strings (scheduler line counts + launchd boot-window silence)",
  dn && Array.isArray(dn.nights) && dn.nights.map((n) => n.date).join(",") === "2026-08-24,2026-08-25" &&
  dn.nights.every((n) => n.class === "machine_dark" && /scheduler\.log/.test(n.evidence)) &&
  /never locked or graded retroactively|Nothing is ever locked/.test(dn.doc))
check("NEVER BACKFILLED (the testable write-once invariant): no daily3 card and no lab tickets exist for either dark date",
  !fs.existsSync(path.join(ROOT, "runtime/tracking/daily3_2026-08-24.json")) &&
  !fs.existsSync(path.join(ROOT, "runtime/tracking/daily3_2026-08-25.json")) &&
  !fs.existsSync(path.join(ROOT, "runtime/tracking/lab_tickets_2026-08-24.json")) &&
  !fs.existsSync(path.join(ROOT, "runtime/tracking/lab_tickets_2026-08-25.json")))
check("public record carries the gap: buildDaily3PublicPayload emits darkNights from the stamp (hermetic + live)",
  (() => {
    const d3 = require("../pipeline/shared/daily3")
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "dn-"))
    fs.writeFileSync(path.join(T, "dark_nights.json"), JSON.stringify({ nights: [{ date: "2026-01-01", class: "machine_dark" }] }))
    const herm = d3.buildDaily3PublicPayload({ trackingDir: T, receiptsDir: T, criticDir: T })
    const live = d3.buildDaily3PublicPayload()
    return herm.darkNights.length === 1 && herm.darkNights[0].date === "2026-01-01" &&
      live.darkNights.map((n) => n.date).join(",") === "2026-08-24,2026-08-25"
  })())
check("payload source doctrine: absent stamp file claims NO dark nights (never invented)",
  /Absent file = no dark\n  \/\/ nights claimed/.test(rd("pipeline/shared/daily3.js").replace(/\r/g, "")) || /Absent file = no dark/.test(rd("pipeline/shared/daily3.js")))

console.log(`\nverifySelfHeal: ${pass}/${pass + fail} checks passed`)
if (fail) { console.log("FAILURES:"); for (const f of failures) console.log("  ✗ " + f); process.exit(1) }
