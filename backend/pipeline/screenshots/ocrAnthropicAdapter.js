"use strict"

/**
 * ocrAnthropicAdapter.js — Anthropic Claude Vision OCR for sportsbook screenshots
 *
 * Mounted via screenshotRoutes.js as POST /api/ws/screenshots/ocr
 *
 * Operator-mandated 2026-05-22 (Session N+1.5):
 *   "anthropic vision ocr pls" — drop a screenshot, get parsed legs back, feed
 *   into the existing /ingest pipeline for verdict scoring. ~$0.005 per call.
 *
 * Body shape (application/json):
 *   {
 *     imageBase64: string  // data URL OR raw base64 (data URL prefix stripped automatically)
 *     mediaType:   "image/jpeg" | "image/png" | "image/webp" | "image/gif"  (default jpeg)
 *   }
 *
 * Response shape:
 *   {
 *     ok: true,
 *     sportsbook: string|null,        // detected book if visible on slip
 *     combinedOdds: number|null,      // American odds if combined-only visible
 *     legs: [
 *       { player, propType, side, line, odds, sportsbook }
 *     ],
 *     rawResponse: string              // raw model text (for debugging)
 *   }
 *
 * Requires env: ANTHROPIC_API_KEY  (operator generates at console.anthropic.com).
 * Returns 503 if key is missing — no synthesized response.
 *
 * Cost estimate: ~$0.005 per typical mobile screenshot at Claude 3.5 Sonnet
 * input rate ($3/1M tokens, image ~1500 tokens).
 */

const axios = require("axios")

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
const ANTHROPIC_MODEL   = "claude-3-5-sonnet-20241022"  // vision-capable
const ANTHROPIC_TIMEOUT_MS = 30000

const OCR_PROMPT = `You are a sportsbook screenshot OCR parser. Extract every betting leg visible in this image.

For each leg, return JSON with these fields:
- player: player name as shown (string)
- propType: one of [Points, Rebounds, Assists, Threes, PRA, Steals, Blocks, "Pts+Reb", "Pts+Ast", "Reb+Ast", Hits, "Home Runs", "Total Bases", RBIs, "Runs Scored", "Stolen Bases", Strikeouts, Walks, "Double-Double", "Triple-Double", "First Basket", "Anytime TD", "Anytime Goal", "Hit a HR", Other]
- side: "over" | "under" | "yes" | "no"  (yes for milestone props like Double-Double, over for "X+ Points" thresholds)
- line: numeric threshold (e.g. 19.5 for "20+ Points") or null for milestone props
- odds: American odds for THIS leg as integer (e.g. -110, +150, +320) — null if only the COMBINED parlay odds are shown, not per-leg

Also extract:
- sportsbook: the book name (DraftKings, FanDuel, Fanatics, BetMGM, "Hard Rock", BetRivers, bet365) — null if not visible
- combinedOdds: the total parlay American odds if shown (e.g. +46627), else null

CRITICAL: respond ONLY with valid JSON in this exact shape, no preamble, no explanation:
{"sportsbook": "...", "combinedOdds": number|null, "legs": [{"player": "...", "propType": "...", "side": "...", "line": number|null, "odds": number|null}, ...]}

If you cannot identify the image as a betting slip, return: {"sportsbook": null, "combinedOdds": null, "legs": []}`

/**
 * Strip data URL prefix if present, return raw base64.
 * "data:image/jpeg;base64,/9j/4AAQ..." -> "/9j/4AAQ..."
 */
function stripDataUrl(input) {
  if (!input || typeof input !== "string") return ""
  const m = input.match(/^data:image\/[a-z]+;base64,(.+)$/i)
  return m ? m[1] : input
}

/**
 * Detect media_type from data URL prefix, fall back to provided hint or jpeg.
 */
function detectMediaType(dataUrl, hint) {
  if (typeof dataUrl === "string") {
    const m = dataUrl.match(/^data:(image\/[a-z]+);base64,/i)
    if (m) return m[1].toLowerCase()
  }
  const h = String(hint || "").toLowerCase()
  if (h === "image/png" || h === "image/jpeg" || h === "image/webp" || h === "image/gif") return h
  return "image/jpeg"
}

/**
 * Extract JSON object from model response text. Model usually returns clean
 * JSON, but sometimes wraps in markdown fences (```json ... ```). Strip those.
 */
function extractJson(text) {
  if (!text || typeof text !== "string") return null
  let cleaned = text.trim()
  // Strip ```json ... ``` fences
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenceMatch) cleaned = fenceMatch[1].trim()
  // Find first { and last }
  const firstBrace = cleaned.indexOf("{")
  const lastBrace = cleaned.lastIndexOf("}")
  if (firstBrace < 0 || lastBrace <= firstBrace) return null
  cleaned = cleaned.slice(firstBrace, lastBrace + 1)
  try {
    return JSON.parse(cleaned)
  } catch (_) {
    return null
  }
}

/**
 * Call Anthropic API with the image, return parsed legs.
 */
async function ocrSlipFromImage({ imageBase64, mediaType }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    const err = new Error("ANTHROPIC_API_KEY not set in .env — operator needs to generate one at console.anthropic.com")
    err.code = "ANTHROPIC_KEY_MISSING"
    throw err
  }

  const rawBase64 = stripDataUrl(imageBase64)
  if (!rawBase64) {
    const err = new Error("Empty or invalid imageBase64")
    err.code = "EMPTY_IMAGE"
    throw err
  }
  const mt = detectMediaType(imageBase64, mediaType)

  const requestBody = {
    model: ANTHROPIC_MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mt, data: rawBase64 }
          },
          { type: "text", text: OCR_PROMPT }
        ]
      }
    ]
  }

  const response = await axios.post(ANTHROPIC_API_URL, requestBody, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    timeout: ANTHROPIC_TIMEOUT_MS
  })

  const rawText = response?.data?.content?.[0]?.text || ""
  const parsed = extractJson(rawText)

  if (!parsed || !Array.isArray(parsed.legs)) {
    return {
      sportsbook:   null,
      combinedOdds: null,
      legs:         [],
      rawResponse:  rawText,
      modelUsage:   response?.data?.usage || null,
      _warning:     "Model response could not be parsed as expected JSON shape"
    }
  }

  // Normalize legs: ensure each has the canonical fields, coerce types
  const normalized = parsed.legs.map((l) => ({
    player:     String(l?.player || "").trim() || null,
    propType:   String(l?.propType || "").trim() || null,
    side:       String(l?.side || "").toLowerCase().trim() || null,
    line:       l?.line == null ? null : Number(l.line),
    odds:       l?.odds == null ? null : Number(l.odds),
    sportsbook: l?.sportsbook == null ? null : String(l.sportsbook).trim()
  })).filter(l => l.player && l.propType)

  return {
    sportsbook:   parsed.sportsbook == null ? null : String(parsed.sportsbook).trim(),
    combinedOdds: parsed.combinedOdds == null ? null : Number(parsed.combinedOdds),
    legs:         normalized,
    rawResponse:  rawText,
    modelUsage:   response?.data?.usage || null
  }
}

module.exports = { ocrSlipFromImage }
