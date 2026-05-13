"use strict"

/**
 * Probability Honesty — calibration-truth utility.
 *
 * Single source of truth for "what does the system do when a probability is
 * absent / unresolved / unknown?". The canonical answer is: it stays null.
 *
 * The audit-identified bug was: at least three scoring paths silently
 * converted a missing/unresolved probability into 0.5 ("synthetic neutral
 * confidence"), which then propagated through scoring, signal weighting,
 * grading summaries, and replay analysis as if it were a real prediction.
 *
 * This module provides:
 *   - `toProbabilityOrNull(v)`            — returns finite number in [0,1] or null
 *   - `clampProbabilityOrNull(v, lo, hi)` — same with explicit bounds
 *   - `pickProbabilityOrNull(...cands)`   — first finite, else null (no synthesis)
 *   - `createProbabilityProbe(label)`     — counter for honesty diagnostics
 *
 * The probe is a small state container that callers update as they observe
 * probabilities, attempt fallbacks, or block synthesis. It returns a
 * structured diagnostics block suitable for embedding in snapshot.diagnostics.
 *
 * Architectural rules honored:
 *   - Pure functions; no I/O, no module-load side effects.
 *   - NEVER returns 0.5 (or any other synthetic midpoint) for missing input.
 *   - Truthful nulls: when the input is non-finite, the output is null.
 *   - Fail-open: probe operations are bounded and side-effect-free aside
 *     from incrementing local counters.
 *   - No AI confidence systems: this module is structural plumbing only;
 *     it never invents probability values from non-probability sources.
 *
 * Out of scope:
 *   - Math utilities (e.g. `sigmoid(NaN) → 0.5`) — defensible mathematical
 *     convention with bounded downstream impact via clamp(floor, ceiling).
 *   - Config defaults (`weights?.score ?? 0.5`) — these are operator-set
 *     scoring coefficients, not probability observations.
 *   - Empty-collection defaults (`if (legs.length === 0) return 0.5`) —
 *     null-from-emptiness is a different semantic question.
 *   - Risk-edge fallback scoring (`scoreRiskEdge.js`) — separate "risk
 *     edge" signal, not the model-probability honesty boundary.
 */

const PROB_PROBE_MAX_FIRST_BLOCK_LOGS = 3

function toProbabilityOrNull(v) {
	// CRITICAL: null/undefined must NOT coerce to 0 via Number(null) === 0.
	// This explicit nullish check preserves "unknown" semantics — otherwise
	// the entire calibration-honesty contract collapses (every null becomes
	// a valid 0% probability).
	if (v == null) return null
	const n = Number(v)
	if (!Number.isFinite(n)) return null
	if (n < 0 || n > 1) return null
	return n
}

function clampProbabilityOrNull(v, lo = 0, hi = 1) {
	if (v == null) return null
	const n = Number(v)
	if (!Number.isFinite(n)) return null
	const fl = Number.isFinite(lo) ? lo : 0
	const cl = Number.isFinite(hi) ? hi : 1
	return Math.max(fl, Math.min(cl, n))
}

/**
 * Returns the first probability candidate that is finite + in [0,1]. Never
 * synthesizes a value. If every candidate is null/undefined/NaN/out-of-range,
 * returns null.
 *
 * @param  {...(number|null|undefined)} candidates
 * @returns {number|null}
 */
function pickProbabilityOrNull(...candidates) {
	for (const c of candidates) {
		const p = toProbabilityOrNull(c)
		if (p != null) return p
	}
	return null
}

/**
 * Honest probability probe — accumulates calibration-honesty diagnostics
 * across many call sites. Returns a small object with `.observe`,
 * `.blockSynthesis`, `.acceptedFallback`, and `.summary` methods.
 *
 * Counters tracked:
 *   - probabilitiesObserved        — total observations attempted
 *   - probabilitiesResolved         — observation yielded a usable number
 *   - probabilitiesUnresolved       — observation returned null
 *   - syntheticConfidenceBlocked    — synthesis attempt was rejected (returns null)
 *   - fallbacksAccepted             — explicit acceptedFallback() calls
 *   - firstUnresolvedSamples        — up to 5 sample contexts (file:label) of first
 *                                     unresolved observations, for diagnostics
 *   - firstSyntheticBlockedSamples  — same, for blocked synthesis attempts
 *
 * Optional `label` is used in the [CALIBRATION-HONESTY] probe log line so
 * the operator can see WHICH scoring path observed unresolved probability.
 */
function createProbabilityProbe(label = "probability") {
	const counters = {
		label,
		probabilitiesObserved: 0,
		probabilitiesResolved: 0,
		probabilitiesUnresolved: 0,
		syntheticConfidenceBlocked: 0,
		fallbacksAccepted: 0,
		firstUnresolvedSamples: [],
		firstSyntheticBlockedSamples: [],
	}
	let firstUnresolvedLogged = false
	let firstSynBlockedLogged = false

	return {
		/**
		 * Record one observation of a probability candidate. Returns the
		 * resolved finite value, or null when unresolved. Never synthesizes.
		 *
		 * @param {string} location   — short tag (e.g. "predSafe@buildMlbPitcherKs")
		 * @param {number|null|undefined} candidate
		 */
		observe(location, candidate) {
			counters.probabilitiesObserved += 1
			const p = toProbabilityOrNull(candidate)
			if (p != null) {
				counters.probabilitiesResolved += 1
				return p
			}
			counters.probabilitiesUnresolved += 1
			if (counters.firstUnresolvedSamples.length < 5) {
				counters.firstUnresolvedSamples.push(location)
			}
			if (!firstUnresolvedLogged && counters.probabilitiesUnresolved <= PROB_PROBE_MAX_FIRST_BLOCK_LOGS) {
				firstUnresolvedLogged = true
				console.log("[CALIBRATION-HONESTY-UNRESOLVED]", JSON.stringify({
					probe: label,
					location,
					message: "probability observed as unresolved; downstream MUST handle null",
				}))
			}
			return null
		},

		/**
		 * Record a synthesis attempt and BLOCK it. Returns null always.
		 * Use at sites where the legacy code did `return 0.5` for missing
		 * input. Migrating callers MUST handle a null return.
		 *
		 * @param {string} location
		 * @param {number} proposedSynthesis   — the value the legacy code would have returned (e.g. 0.5)
		 * @param {string} reason              — brief reason for the synthesis attempt
		 */
		blockSynthesis(location, proposedSynthesis, reason) {
			counters.syntheticConfidenceBlocked += 1
			if (counters.firstSyntheticBlockedSamples.length < 5) {
				counters.firstSyntheticBlockedSamples.push({
					location,
					proposed: Number(proposedSynthesis),
					reason: String(reason || ""),
				})
			}
			if (!firstSynBlockedLogged && counters.syntheticConfidenceBlocked <= PROB_PROBE_MAX_FIRST_BLOCK_LOGS) {
				firstSynBlockedLogged = true
				console.log("[CALIBRATION-HONESTY-BLOCKED]", JSON.stringify({
					probe: label,
					location,
					proposed: Number(proposedSynthesis),
					reason: String(reason || ""),
					message: "synthetic-certainty fallback blocked; null returned to caller",
				}))
			}
			return null
		},

		/**
		 * Record acceptance of a LEGITIMATE non-probability fallback. For
		 * example, when a market-implied probability stands in for an
		 * unavailable model probability — this is observable, not silent.
		 *
		 * @param {string} location
		 * @param {string} fallbackSource  — e.g. "marketImplied", "consensus"
		 * @returns {void}
		 */
		acceptedFallback(location, fallbackSource) {
			counters.fallbacksAccepted += 1
			// no logging — these are normal operations; counter is the audit.
		},

		summary() {
			return {
				label: counters.label,
				probabilitiesObserved: counters.probabilitiesObserved,
				probabilitiesResolved: counters.probabilitiesResolved,
				probabilitiesUnresolved: counters.probabilitiesUnresolved,
				syntheticConfidenceBlocked: counters.syntheticConfidenceBlocked,
				fallbacksAccepted: counters.fallbacksAccepted,
				firstUnresolvedSamples: counters.firstUnresolvedSamples.slice(),
				firstSyntheticBlockedSamples: counters.firstSyntheticBlockedSamples.slice(),
				resolveRate: counters.probabilitiesObserved > 0
					? Number((counters.probabilitiesResolved / counters.probabilitiesObserved).toFixed(4))
					: null,
			}
		},
	}
}

/**
 * Convenience: build an empty honesty diagnostics block for embedding in
 * snapshot.diagnostics when no probe was run. Keeps the shape stable.
 */
function emptyProbabilityHonestyDiagnostics() {
	return {
		label: null,
		probabilitiesObserved: 0,
		probabilitiesResolved: 0,
		probabilitiesUnresolved: 0,
		syntheticConfidenceBlocked: 0,
		fallbacksAccepted: 0,
		firstUnresolvedSamples: [],
		firstSyntheticBlockedSamples: [],
		resolveRate: null,
	}
}

module.exports = {
	toProbabilityOrNull,
	clampProbabilityOrNull,
	pickProbabilityOrNull,
	createProbabilityProbe,
	emptyProbabilityHonestyDiagnostics,
}
