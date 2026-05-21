# VERIFICATION TELEMETRY V1
**Session AK — Permanent operational system.**

---

## PURPOSE

Replaces ad-hoc manual TERM 2 curl commands with a deterministic, artifact-generating, machine-readable verification system. Every Class D session now has a reproducible verification record.

---

## FILES

| File | Purpose |
|---|---|
| `backend/pipeline/verification/verificationSchema.js` | Pure check definitions — NBA_CHECKS + MLB_CHECKS. No I/O. |
| `backend/pipeline/verification/writeVerificationArtifact.js` | Atomic JSON artifact writer → `backend/runtime/verifications/` |
| `backend/scripts/runVerification.js` | CLI runner — hits live server, runs checks, writes artifact, exits 0/1 |
| `backend/runtime/verifications/` | Output directory — one JSON file per sport per session |

---

## USAGE

**Standard Class D verification (NBA):**
```
node backend/scripts/runVerification.js --sport=nba --session=AK
```

**Both sports:**
```
node backend/scripts/runVerification.js --sport=all --session=AK
```

**Verbose (all check details):**
```
node backend/scripts/runVerification.js --sport=nba --session=AK --verbose
```

**Print only, no artifact:**
```
node backend/scripts/runVerification.js --sport=nba --session=AK --no-artifact
```

---

## CLASS D PREREQUISITE SEQUENCE

The runner MUST be called AFTER the full Class D regeneration protocol. Running it against stale state produces false results.

```
STEP 1: cd ~/Desktop/betting-dashboard && node backend/server.js
STEP 2: curl -s "http://localhost:4000/refresh-snapshot/hard-reset"
STEP 3: [wait ~10s]
STEP 4: node backend/scripts/runVerification.js --sport=nba --session=<label>
STEP 5: Only if PASS: node backend/scripts/checkpointRepo.js "Session XX: ..."
STEP 6: cd ~/Desktop/betting-dashboard && bash backend/scripts/finalizeCheckpoint.sh
```

---

## ARTIFACT FORMAT

Written to: `backend/runtime/verifications/verification_<sport>_<date>_<session>.json`

```json
{
  "schema_version": "1",
  "session": "AK",
  "timestamp": "2026-05-10T...",
  "date": "2026-05-10",
  "sport": "nba",
  "overall": "PASS",
  "summary": { "total": 10, "passed": 10, "failed": 0, "warned": 0 },
  "checks": [
    {
      "id": "candidates_populated",
      "pass": true,
      "value": 42,
      "expected": "> 0",
      "message": "42 candidates",
      "severity": "error",
      "description": "NBA candidate pool > 0"
    }
  ],
  "runtime_snapshot": {
    "candidates": 42,
    "total_slips": 8,
    "slips_by_tier": { "safe": 2, "balanced": 2, "aggressive": 2, "lotto": 2 },
    "alt_line_legs_in_slips": 3,
    "alt_line_families": ["pra", "threes"],
    "featured_anchors": 4,
    "correlation_fields": 8,
    "non_zero_correlation": 2
  }
}
```

---

## NBA CHECKS (10 total)

| ID | Severity | What it verifies |
|---|---|---|
| `candidates_populated` | error | Candidate pool > 0 |
| `ai_slips_generated` | error | Total aiSlips > 0 |
| `correlation_score_fields` | error | All slips carry correlationScore field (NBA-2.C) |
| `featured_anchors_present` | warn | Featured anchors populated |
| `safe_lane_present` | warn | SAFE tier slips exist |
| `aggressive_lane_present` | warn | AGGRESSIVE tier slips exist |
| `lotto_lane_present` | warn | LOTTO tier slips exist |
| `alt_line_volatility_valid` | error | Alt-line legs are aggressive/lotto only (NBA-3) |
| `no_ineligible_family_alt_legs` | error | No rebounds/assists/first_basket alt legs (NBA-3) |
| `safe_lane_no_alt_contamination` | error | Zero alt-line legs in SAFE tier (NBA-3) |

## MLB CHECKS (4 total)

| ID | Severity | What it verifies |
|---|---|---|
| `mlb_slips_generated` | error | MLB aiSlips > 0 |
| `mlb_lotto_lane_present` | warn | MLB LOTTO tier present |
| `mlb_featured_anchors` | warn | MLB featured anchors present |
| `mlb_no_correlation_score` | error | MLB slips have no non-null correlationScore (path isolation) |

---

## EXIT CODES

| Code | Meaning |
|---|---|
| 0 | All error-severity checks passed (PASS) |
| 1 | One or more error-severity checks failed (FAIL) |

Warn-severity failures do NOT cause exit code 1. They are advisory.

---

## EXTENDING CHECKS

To add a new check:

1. Add an entry to `NBA_CHECKS` or `MLB_CHECKS` in `verificationSchema.js`
2. Set `severity: "error"` (fails overall) or `severity: "warn"` (advisory)
3. Implement `run(payload)` — must return `checkResult(id, pass, value, expected, message)`
4. `run()` must be pure — no I/O, no side effects, no external calls

---

## ARTIFACT GOVERNANCE

- Artifacts are NOT committed to git (runtime output, not source)
- Add `backend/runtime/verifications/` to `.gitignore` if not already present
- Artifacts persist locally for debugging and retrospective analysis
- Filename is deterministic: same sport + date + session always overwrites the same file
- Atomic write (tmp → rename) prevents partial files on crash

---

## RELATIONSHIP TO CLASS D PROTOCOL

This system operationalizes the CLASS D REGENERATION PROTOCOL from WORKFLOW_RULES.md.
The manual TERM 2 curl is replaced by:

```
node backend/scripts/runVerification.js --sport=nba --session=<label>
```

The script exits 0 (PASS) or 1 (FAIL), making verification machine-checkable.
