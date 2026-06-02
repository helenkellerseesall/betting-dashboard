"use strict"

/**
 * screenshotRoutes.js
 *
 * Express router — Screenshot Intelligence Layer
 * Mounted at: /api/ws/screenshots  (via workstationRoutes.js)
 *
 * Routes:
 *   POST /ingest         — ingest a JSON slip payload (one slip or array of slips)
 *   GET  /list           — paginated list of parsed slips + classification scores
 *   GET  /submission/:id — full submission record + all parsed slips
 *   GET  /:id            — single parsed slip with classification
 *
 * Design:
 *   - JSON-only ingestion for now (no multer/image upload — deferred to future phase)
 *   - Normalizer + classifier run synchronously before writing to SQLite
 *   - SQLite unavailability degrades gracefully — returns 503 with explanation
 *   - All writes are additive — no existing data is modified or deleted
 *   - Submission IDs are SHA-256 hash-based (stable, idempotent)
 *
 * Dependencies:
 *   normalizeIngestedSlip.js — pure function: raw → canonical parsed_slip shape
 *   classifyIngestedSlip.js  — pure function: parsed_slip → classification row
 *   screenshotSchema.js      — applyScreenshotSchema(db) — adds tables if absent
 *   ../../../storage/db.js   — tryGetDb() — graceful SQLite access
 */

const express  = require("express")
const crypto   = require("crypto")
const router   = express.Router()

const { normalizeIngestedSlip, normalizeIngestedSlips } = require("./normalizeIngestedSlip")
const { classifyIngestedSlip }                          = require("./classifyIngestedSlip")
// Phase Screenshot-Loop-Close-2A — post-classification bettor profile updater
const { upsertBettorProfileForSlip }                    = require("./bettorProfilesUpdater")
const { applyScreenshotSchema }                         = require("../../storage/screenshotSchema")
const { tryGetDb }                                      = require("../../storage/db")
// v0.2.3: Anthropic Vision OCR for real image upload (Session N+1.5)
const { ocrSlipFromImage }                              = require("./ocrAnthropicAdapter")
// Phase BNSB-1A (FE-VBI-1): wire canonical VBI analyzeSlip into the ingest
// response so the FE upload card receives the deterministic verdict payload
// (verdictSummary / strongestLeg / weakestLeg / contradictionFlags /
// ecologicalCoherence / signals / bettorLanguageSummary). Pure additive on
// the existing response shape — back-compat preserved.
const { analyzeSlip }                                   = require("../shared/buildSlipAnalysis")
// v0.2.6 (Session N+1.6): load FULL snapshot rows to build shopMap for slip
// analysis. Operator 2026-05-22 hit "1/100 UNKNOWN" verdict because only 2 of
// 7 slip players (Cason Wallace, Dort) were in the elite candidate pool —
// Wemby, SGA, Luke Kornet weren't (their props were chalk, didn't make the
// edge cut). The FULL snapshot has every prop on every player tonight, so
// every star CAN be looked up. shopMap is keyed off the line-shopping result.
const fs   = require("fs")
const path = require("path")
const { resolveSnapshotRows } = require("../shared/responseShapeResolvers")
const { buildLineShopping }   = require("../shared/buildLineShoppingIntelligence")
const { normFam }             = require("../shared/normalizers")

/**
 * Build shopMap from the on-disk snapshot for a given sport, indexed by the
 * canonical lookup key that marketSupportFor() consumes:
 *   `${player.toLowerCase().trim()}|${normFam(propType)}|${side}|${line ?? "any"}`
 *
 * buildLineShopping returns `byProp` as an ARRAY of per-prop entries (each
 * carries player/propType/side/line/bookCount/consensusConfidence). We pivot
 * that into a Map for O(1) lookup at marketSupportFor() call sites.
 *
 * Fail-safe (null on any error) → analyzeSlip emits "*_unavailable" signals.
 */
function loadSnapshotShopMap(sport) {
  try {
    if (!sport) return null
    const file = sport === "mlb"
      ? path.join(__dirname, "..", "..", "snapshot-mlb.json")
      : path.join(__dirname, "..", "..", "snapshot.json")  // NBA default
    if (!fs.existsSync(file)) return null
    const snap = JSON.parse(fs.readFileSync(file, "utf8"))
    const rows = resolveSnapshotRows(snap)
    if (!Array.isArray(rows) || rows.length === 0) return null

    const ls = buildLineShopping(rows, { sport })
    if (!ls || !Array.isArray(ls.byProp)) return null

    // Pivot ARRAY → MAP keyed by canonical lookup key
    const m = new Map()
    let added = 0
    for (const entry of ls.byProp) {
      if (!entry?.player) continue
      const playerKey = String(entry.player).toLowerCase().trim()
      const famKey    = normFam(entry.propType || "")
      const sideKey   = String(entry.side || "").toLowerCase()
      const lineKey   = entry.line == null ? "any" : entry.line
      const key       = [playerKey, famKey, sideKey, lineKey].join("|")
      m.set(key, entry)
      added++
    }
    console.log("[screenshotRoutes] shopMap loaded:", { sport, rows: rows.length, entries: added })
    return m
  } catch (err) {
    console.warn("[screenshotRoutes] loadSnapshotShopMap failed:", err?.message || err)
    return null
  }
}

// ── Schema bootstrap ──────────────────────────────────────────────────────────
// Called once when the router module is first loaded.
// applyScreenshotSchema uses CREATE TABLE IF NOT EXISTS — always safe.

let _schemaApplied = false

function ensureSchema(db) {
  if (_schemaApplied) return
  try {
    applyScreenshotSchema(db)
    _schemaApplied = true
  } catch (err) {
    console.warn("[screenshotRoutes] schema bootstrap warning:", err.message)
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function makeSubmissionId(payload) {
  // Stable hash of the raw payload so re-submitting the same slip is idempotent
  const key = typeof payload === "string" ? payload : JSON.stringify(payload)
  return "ss_" + crypto.createHash("sha256").update(key).digest("hex").slice(0, 16)
}

function dbRequired(res) {
  const db = tryGetDb()
  if (!db) {
    res.status(503).json({
      ok:    false,
      error: "SQLite unavailable — screenshot intelligence layer degraded",
    })
    return null
  }
  ensureSchema(db)
  return db
}

// ── POST /ingest ──────────────────────────────────────────────────────────────
/**
 * Ingest one or more slip payloads.
 *
 * Body (application/json):
 * {
 *   sourceType:   "internal" | "personal" | "screenshot" | "twitter" | "discord" | "viral" | "guru" | "sportsbook"
 *   sourceLabel:  string (optional) — e.g. "@SomeGuru", "DraftKings promo"
 *   sport:        "mlb" | "nba" | null (optional — auto-detected from stat families)
 *   slateDate:    "YYYY-MM-DD" (optional)
 *   attribution:  string (optional) — poster name
 *   slips:        array of raw slip objects  (mutually exclusive with `slip`)
 *   slip:         single raw slip object     (mutually exclusive with `slips`)
 * }
 *
 * Each slip can be:
 *   - Internal AI slip: { legs: [...], tier, combinedAmericanOdds, ... }
 *   - Personal ledger bet: { player, statFamily, side, line, odds, sportsbook, ... }
 *   - Pasted text parsed object (same shapes)
 *   - Single-leg or multi-leg
 *
 * Response:
 * {
 *   ok: true,
 *   submissionId: "ss_...",
 *   slipsIngested: 2,
 *   results: [{ slipId, legs, sport, archetype, compositeScore, status }]
 * }
 */
router.post("/ingest", (req, res) => {
  try {
    const db = dbRequired(res)
    if (!db) return

    const {
      sourceType  = "unknown",
      sourceLabel = null,
      sport       = null,
      slateDate   = null,
      attribution = null,
      slip        = null,
      slips       = null,
    } = req.body || {}

    // Validate we have at least one slip
    if (!slip && (!Array.isArray(slips) || slips.length === 0)) {
      return res.status(400).json({
        ok:    false,
        error: "Body must include `slip` (object) or `slips` (non-empty array)",
      })
    }

    // Build raw slip list
    const rawSlips = slip ? [slip] : slips

    // Generate stable submission ID from full payload
    const submissionId = makeSubmissionId({ sourceType, sourceLabel, sport, slateDate, attribution, rawSlips })

    // ── Write submission row ───────────────────────────────────────────────────
    const insertSubmission = db.prepare(`
      INSERT OR IGNORE INTO screenshot_submissions
        (id, source_type, source_label, sport, slate_date, raw_json, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `)
    insertSubmission.run(
      submissionId,
      sourceType,
      sourceLabel,
      sport || null,
      slateDate || null,
      JSON.stringify(req.body)
    )

    // ── Normalize + classify each slip ────────────────────────────────────────
    const opts = { submissionId, sourceType, sourceLabel, sport, slateDate, attribution }

    const insertSlip = db.prepare(`
      INSERT OR IGNORE INTO parsed_slips
        (id, submission_id, sport, slate_date, source_type, total_legs,
         legs_json, combined_odds, combined_dec, potential_payout, stake,
         currency, sportsbook, attribution, linked_internal_id, status, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `)

    const insertClassification = db.prepare(`
      INSERT OR IGNORE INTO slip_classifications
        (id, slip_id, classifier_version,
         realism_score, structural_quality, correlation_quality,
         hidden_sharpness, emotional_bait, volatility_structure,
         payout_realism, exploit_potential, appeal_score, ecology_fit,
         composite_score, sharp_signal, bait_signal, viral_signal,
         archetype, archetype_tags, ecology_tags, rationale, raw_json)
      VALUES (?, ?, ?,
              ?, ?, ?,
              ?, ?, ?,
              ?, ?, ?, ?,
              ?, ?, ?, ?,
              ?, ?, ?, ?, ?)
    `)

    const updateSlipStatus = db.prepare(`
      UPDATE parsed_slips SET status = 'classified' WHERE id = ?
    `)

    const results = []

    for (let i = 0; i < rawSlips.length; i++) {
      const slipOpts = {
        ...opts,
        submissionId: rawSlips.length > 1 ? `${submissionId}_${i}` : submissionId,
      }

      const normalized = normalizeIngestedSlip(rawSlips[i], slipOpts)
      if (!normalized) {
        results.push({ index: i, ok: false, error: "Could not normalize slip — insufficient leg data" })
        continue
      }

      // Write parsed_slip row
      insertSlip.run(
        normalized.id,
        normalized.submission_id,
        normalized.sport,
        normalized.slate_date,
        normalized.source_type,
        normalized.total_legs,
        normalized.legs_json,
        normalized.combined_odds,
        normalized.combined_dec,
        normalized.potential_payout,
        normalized.stake,
        normalized.currency || "USD",
        normalized.sportsbook,
        normalized.attribution,
        normalized.linked_internal_id,
        normalized.raw_json
      )

      // Classify
      const classification = classifyIngestedSlip(normalized, null)
      const classId = "sc_" + crypto.createHash("sha256")
        .update(normalized.id + "|v1")
        .digest("hex")
        .slice(0, 16)

      insertClassification.run(
        classId,
        normalized.id,
        classification.classifier_version || "v1",
        classification.realism_score,
        classification.structural_quality,
        classification.correlation_quality,
        classification.hidden_sharpness,
        classification.emotional_bait,
        classification.volatility_structure,
        classification.payout_realism,
        classification.exploit_potential,
        classification.appeal_score,
        classification.ecology_fit,
        classification.composite_score,
        classification.sharp_signal ? 1 : 0,
        classification.bait_signal  ? 1 : 0,
        classification.viral_signal ? 1 : 0,
        classification.archetype,
        JSON.stringify(classification.archetype_tags || []),
        JSON.stringify(classification.ecology_tags   || []),
        classification.rationale || null,
        JSON.stringify(classification)
      )

      updateSlipStatus.run(normalized.id)

      // Phase Screenshot-Loop-Close-2A (2026-06-02) — update bettor profile.
      // Tier 3 learning loop: every classified slip updates the source's
      // archetype distribution + preference signals. Anti-fabrication: wrapped
      // in try/catch so any profile update failure NEVER blocks the ingest
      // response — slip persistence + classification stays as the canonical
      // operation, profile update is best-effort observational layer.
      let profileUpdate = null
      try {
        profileUpdate = upsertBettorProfileForSlip(db, normalized, { ...classification, id: classId })
      } catch (e) {
        console.warn("[Screenshot-Loop-Close-2A] bettor profile update failed (non-fatal):", e?.message || e)
      }

      // Phase BNSB-1A (FE-VBI-1): compute canonical VBI verdict from the
      // already-normalized slip + canonical sport/slateDate. Pure additive on
      // the response. Tolerates failures (anti-fabrication: verdict=null when
      // engine cannot resolve, never a synthesized verdict). Down-stream FE
      // (AnalyzeSlipView / VerdictCard) reads the verdict to render the
      // canonical 12-field shape. legs[] preserved on result so the FE can
      // resolve strongestLeg.legIndex / weakestLeg.legIndex to player names.
      //
      // Phase Screenshot-FE-Ingest-Fix-1B (2026-06-02 ~05:00 ET) — multi-file
      // ingest hangs on this step (sport projection + leg resolution can take
      // 10-30s per slip). Add skipVerdict flag — multi-file path sets it true
      // (loop closure only needs classification + bettor_profile, not verdict).
      // Solo-analyze path keeps verdict on (operator wants projection score).
      let verdict = null
      const skipVerdict = req.body?.skipVerdict === true
      if (!skipVerdict) {
        try {
          // v0.2.6: load full-snapshot shopMap so EVERY player with props
          // tonight can be looked up — not just our elite edge candidates.
          // Cached per-sport per-request below would be a perf win if /ingest
          // ever takes batched slips; for now one slip per call is fine.
          const shopMap = loadSnapshotShopMap(normalized.sport)
          verdict = analyzeSlip(normalized, {
            sport:     normalized.sport,
            slateDate: normalized.slate_date,
            shopMap,
            // availabilityIndex still null — wire that next session
          })
        } catch (e) {
          console.warn("[screenshotRoutes] analyzeSlip failed:", e?.message || e)
          verdict = null
        }
      }

      results.push({
        index:          i,
        ok:             true,
        slipId:         normalized.id,
        legs:           normalized.total_legs,
        legsParsed:     normalized._legs || [],   // BNSB-1A: leg shape for FE legIndex resolution
        sport:          normalized.sport,
        archetype:      classification.archetype,
        compositeScore: classification.composite_score,
        sharpSignal:    !!classification.sharp_signal,
        baitSignal:     !!classification.bait_signal,
        verdict,                                  // Phase BNSB-1A (FE-VBI-1): canonical VBI verdict payload
      })
    }

    // Update submission status
    const allOk = results.every(r => r.ok)
    db.prepare("UPDATE screenshot_submissions SET status = ? WHERE id = ?")
      .run(allOk ? "parsed" : "pending", submissionId)

    res.json({
      ok:            true,
      submissionId,
      slipsIngested: results.filter(r => r.ok).length,
      results,
    })

  } catch (err) {
    console.error("[screenshotRoutes] /ingest error:", err)
    res.status(500).json({ ok: false, error: err.message })
  }
})

// ── POST /ocr ────────────────────────────────────────────────────────────────
/**
 * v0.2.3 (Session N+1.5): Image OCR via Anthropic Claude Vision.
 *
 * Body (application/json, up to 10 MB to fit base64-encoded screenshots):
 *   {
 *     imageBase64: string   // data URL OR raw base64 (data URL prefix auto-stripped)
 *     mediaType:   string?  // optional hint — "image/jpeg" | "image/png" | etc.
 *   }
 *
 * Response (200):
 *   {
 *     ok: true,
 *     sportsbook:    string|null,
 *     combinedOdds:  number|null,
 *     legs: [{ player, propType, side, line, odds, sportsbook }, ...],
 *     modelUsage:    { input_tokens, output_tokens } | null
 *   }
 *
 * Response (503 if ANTHROPIC_API_KEY missing):
 *   { ok: false, error: "ANTHROPIC_KEY_MISSING", ... }
 *
 * Cost: ~$0.005 per call at Claude 3.5 Sonnet vision rates. Operator gets
 * API key from console.anthropic.com (separate from Claude Max subscription).
 *
 * Mounted with a per-route express.json({ limit: "10mb" }) override so this
 * specific endpoint can accept full-resolution mobile screenshots without
 * affecting the global JSON limit (which stays at the default 100KB for
 * everything else — safer for the rest of the API surface).
 */
// v0.2.4b: health ping — confirms ANTHROPIC_API_KEY is loaded + well-formed
// without consuming an API call. Operator hits this from terminal to verify
// .env setup before debugging upload failures.
router.get("/ocr-health", (req, res) => {
  const raw = String(process.env.ANTHROPIC_API_KEY || "")
  const cleaned = raw.replace(/[ -\s]/g, "").trim()
  res.json({
    ok: true,
    keyPresent:           cleaned.length > 0,
    keyFormatValid:       /^sk-ant-/.test(cleaned),
    keyLength:            cleaned.length,
    keyPreview:           cleaned ? cleaned.slice(0, 14) + "…" + cleaned.slice(-4) : null,
    hadHiddenWhitespace:  raw.length !== cleaned.length,
    rawLength:            raw.length,
  })
})

router.post("/ocr", express.json({ limit: "10mb" }), async (req, res) => {
  try {
    const { imageBase64, mediaType } = req.body || {}
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Body must include `imageBase64` (string — data URL or raw base64)"
      })
    }

    const result = await ocrSlipFromImage({ imageBase64, mediaType })
    return res.json({ ok: true, ...result })

  } catch (err) {
    console.error("[screenshotRoutes] /ocr error:", err?.message || err)
    const code = err?.code || "OCR_FAILED"
    const status = code === "ANTHROPIC_KEY_MISSING" ? 503
                 : code === "EMPTY_IMAGE" ? 400
                 : 500
    return res.status(status).json({
      ok: false,
      error: err?.message || String(err),
      code
    })
  }
})

// ── GET /taste-profile ────────────────────────────────────────────────────────
// Phase Screenshot-Operator-Visible-1A (2026-06-02) — operator-facing endpoint
// returning everything the engine has learned about the operator's taste from
// ingested slips. Backs the "Your Taste Profile" card on the ANALYZE tab.
//
// Anti-fabrication: returns hasSignal=false when no profiles exist. Never
// synthesizes a fake profile. Honestly reports what's wired vs what's pending
// (active biasing still Phase 2C-2 — surfaced as `engineBehavior.activeBias`).
router.get("/taste-profile", (req, res) => {
  try {
    const db = tryGetDb()
    if (!db) return res.json({ ok: false, error: "sqlite_unavailable" })

    const { getOperatorTasteSignal } = require("./bettorTasteSignal")
    const taste = getOperatorTasteSignal(db)

    // Recent ingest activity for the timeline view
    const recentSlips = db.prepare(`
      SELECT p.id, p.source_type, p.sport, p.total_legs, p.combined_dec, p.sportsbook,
             p.created_at, c.archetype, c.composite_score
      FROM parsed_slips p
      LEFT JOIN slip_classifications c ON c.slip_id = p.id
      ORDER BY p.created_at DESC
      LIMIT 10
    `).all()

    // Outcome stats — how many graded vs ungraded
    const outcomeCounts = db.prepare(`
      SELECT
        COUNT(*) as total_legs,
        SUM(CASE WHEN hit IS NOT NULL THEN 1 ELSE 0 END) as graded_legs,
        SUM(CASE WHEN hit = 1 THEN 1 ELSE 0 END) as hit_legs
      FROM outcome_links
    `).get()

    return res.json({
      ok: true,
      taste,
      recentSlips,
      outcomeCounts,
      engineBehavior: {
        activeBias: false,  // Phase 2C-2 not yet shipped
        biasNote: "Engine LOGS your taste signal on every pick-gen run but does not yet shape picks toward your pattern. Active biasing is Phase Screenshot-Loop-Close-2C-2 (deferred).",
        biasPhase: "Screenshot-Loop-Close-2C-2",
        loggedAs: "[BETTOR-TASTE] in backend stdout per pick-gen run",
      },
      outcomeBehavior: {
        gradingActive: true,
        gradingNote: "Each leg attempts match against engine's tracked_bets for the slip's slate_date. Currently 0 legs graded because slip slate dates do not yet overlap with engine's tracked picks. As you ingest slips for current dates with players the engine also tracks, outcomes will populate.",
        graded: outcomeCounts.graded_legs || 0,
        total: outcomeCounts.total_legs || 0,
      },
      generatedAt: new Date().toISOString(),
    })
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) })
  }
})

// ── GET /list ─────────────────────────────────────────────────────────────────
/**
 * Paginated list of parsed slips with their classification scores.
 *
 * Query params:
 *   limit       (default 50, max 200)
 *   offset      (default 0)
 *   sport       filter: mlb | nba | mixed
 *   sourceType  filter: internal | personal | twitter | discord | viral | guru | sportsbook
 *   archetype   filter: sharp_aggressive | recreational_chase | guru_bait | viral_lotto | safe_grind | sportsbook_trap | unknown
 *   minScore    filter: minimum composite_score (0.0–1.0)
 *   sharpOnly   filter: "1" → only slips with sharp_signal=1
 *   baitOnly    filter: "1" → only slips with bait_signal=1
 *   date        filter: YYYY-MM-DD slate_date
 */
router.get("/list", (req, res) => {
  try {
    const db = dbRequired(res)
    if (!db) return

    const limit      = Math.min(parseInt(req.query.limit  || "50",  10), 200)
    const offset     = Math.max(parseInt(req.query.offset || "0",   10), 0)
    const sport      = req.query.sport      || null
    const sourceType = req.query.sourceType || null
    const archetype  = req.query.archetype  || null
    const minScore   = req.query.minScore   != null ? parseFloat(req.query.minScore) : null
    const sharpOnly  = req.query.sharpOnly  === "1"
    const baitOnly   = req.query.baitOnly   === "1"
    const date       = req.query.date       || null

    const conditions = []
    const params     = []

    if (sport)      { conditions.push("p.sport = ?");        params.push(sport) }
    if (sourceType) { conditions.push("p.source_type = ?");  params.push(sourceType) }
    if (date)       { conditions.push("p.slate_date = ?");   params.push(date) }
    if (archetype)  { conditions.push("c.archetype = ?");    params.push(archetype) }
    if (minScore != null && !isNaN(minScore)) {
      conditions.push("c.composite_score >= ?")
      params.push(minScore)
    }
    if (sharpOnly)  { conditions.push("c.sharp_signal = 1") }
    if (baitOnly)   { conditions.push("c.bait_signal = 1") }

    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : ""

    const rows = db.prepare(`
      SELECT
        p.id,
        p.submission_id,
        p.sport,
        p.slate_date,
        p.source_type,
        p.total_legs,
        p.combined_odds,
        p.sportsbook,
        p.attribution,
        p.status,
        p.created_at,
        c.archetype,
        c.composite_score,
        c.sharp_signal,
        c.bait_signal,
        c.viral_signal,
        c.realism_score,
        c.structural_quality,
        c.hidden_sharpness,
        c.emotional_bait,
        c.ecology_fit,
        c.ecology_tags,
        c.archetype_tags,
        c.rationale
      FROM parsed_slips p
      LEFT JOIN slip_classifications c ON c.slip_id = p.id
      ${where}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset)

    const total = db.prepare(`
      SELECT COUNT(*) AS n
      FROM parsed_slips p
      LEFT JOIN slip_classifications c ON c.slip_id = p.id
      ${where}
    `).get(...params)

    res.json({
      ok:     true,
      total:  total ? total.n : 0,
      limit,
      offset,
      slips:  rows.map(r => ({
        ...r,
        ecology_tags:   safeJson(r.ecology_tags,   []),
        archetype_tags: safeJson(r.archetype_tags, []),
      })),
    })

  } catch (err) {
    console.error("[screenshotRoutes] /list error:", err)
    res.status(500).json({ ok: false, error: err.message })
  }
})

// ── GET /submission/:id ───────────────────────────────────────────────────────
/**
 * Full submission record + all parsed slips + classifications for a submission.
 */
router.get("/submission/:id", (req, res) => {
  try {
    const db = dbRequired(res)
    if (!db) return

    const submission = db.prepare(
      "SELECT * FROM screenshot_submissions WHERE id = ?"
    ).get(req.params.id)

    if (!submission) {
      return res.status(404).json({ ok: false, error: "Submission not found" })
    }

    const slips = db.prepare(`
      SELECT p.*, c.archetype, c.composite_score, c.sharp_signal, c.bait_signal,
             c.viral_signal, c.realism_score, c.structural_quality, c.correlation_quality,
             c.hidden_sharpness, c.emotional_bait, c.volatility_structure,
             c.payout_realism, c.exploit_potential, c.appeal_score, c.ecology_fit,
             c.ecology_tags, c.archetype_tags, c.rationale, c.classified_at
      FROM parsed_slips p
      LEFT JOIN slip_classifications c ON c.slip_id = p.id
      WHERE p.submission_id = ?
      ORDER BY p.created_at ASC
    `).all(req.params.id)

    res.json({
      ok:         true,
      submission: {
        ...submission,
        raw_json: safeJson(submission.raw_json, null),
      },
      slips: slips.map(enrichSlip),
    })

  } catch (err) {
    console.error("[screenshotRoutes] /submission/:id error:", err)
    res.status(500).json({ ok: false, error: err.message })
  }
})

// ── GET /:id ──────────────────────────────────────────────────────────────────
/**
 * Single parsed slip with legs and full classification.
 */
router.get("/:id", (req, res) => {
  try {
    const db = dbRequired(res)
    if (!db) return

    const slip = db.prepare(`
      SELECT p.*, c.archetype, c.composite_score, c.sharp_signal, c.bait_signal,
             c.viral_signal, c.realism_score, c.structural_quality, c.correlation_quality,
             c.hidden_sharpness, c.emotional_bait, c.volatility_structure,
             c.payout_realism, c.exploit_potential, c.appeal_score, c.ecology_fit,
             c.ecology_tags, c.archetype_tags, c.rationale, c.classified_at,
             c.id AS classification_id
      FROM parsed_slips p
      LEFT JOIN slip_classifications c ON c.slip_id = p.id
      WHERE p.id = ?
    `).get(req.params.id)

    if (!slip) {
      return res.status(404).json({ ok: false, error: "Slip not found" })
    }

    res.json({ ok: true, slip: enrichSlip(slip) })

  } catch (err) {
    console.error("[screenshotRoutes] /:id error:", err)
    res.status(500).json({ ok: false, error: err.message })
  }
})

// ── helpers ───────────────────────────────────────────────────────────────────

function safeJson(v, fallback) {
  if (v == null) return fallback
  try { return JSON.parse(v) } catch (_) { return fallback }
}

function enrichSlip(row) {
  return {
    ...row,
    legs_json:      safeJson(row.legs_json,      []),
    raw_json:       safeJson(row.raw_json,        null),
    ecology_tags:   safeJson(row.ecology_tags,    []),
    archetype_tags: safeJson(row.archetype_tags,  []),
  }
}

module.exports = router
