# CORE MODEL RULES (PERMANENT)

This document is the permanent source of truth for **ALL MLB prop models** in this repo.

---

## 1. MODEL ARCHITECTURE

All models MUST follow:

**data → scoring → probability → edge → output**

---

## 2. PROBABILITY RULES

- All probabilities MUST be true probabilities in **\[0, 1\]**
- **NO linear scaling** (no `score / X` as the final probability)
- MUST use **compression** (sigmoid/logistic or equivalent) for score → probability
- Expected ranges (guidelines, not guarantees):

### HR (any HR)
- elite: **0.18–0.25**

### Ks (over line)
- typical: **0.45–0.65**

---

## 3. LADDER RULES (CRITICAL)

All **count-based** props MUST use **distribution modeling**.

- Use **Poisson** (or equivalent discrete distribution)
- Lambda (λ) = **expected value**

Compute ladders using:

**P(X ≥ N)** for each ladder rung

Examples:
- Ks: **5+, 6+, 7+, 8+**
- RBI: **1+, 2+, 3+**
- Hits: **1+, 2+, 3+**

Rules:
- Ladder probabilities MUST be **monotonic decreasing** (e.g. \(k5 ≥ k6 ≥ k7 ≥ k8\))
- Ladder probabilities MUST be **never null**
- Ladder probabilities MUST be **never hardcoded**

---

## 4. EDGE RULES

Edge MUST be:

**edge = modelProbability - impliedProbability**

Expected ranges:
- normal: **0.01–0.05**
- strong: **0.05–0.08**

Rules:
- No inflated edges allowed (avoid systematic +0.15+ artifacts)

---

## 5. MODEL DESIGN PRINCIPLES

- DO NOT hardcode outputs
- DO NOT override model data with odds
- DO NOT build rigid slips as “the model”
- Models output **information**, not decisions
- Always allow user control via config / thresholds

---

## 6. REUSE RULE

All future props MUST reuse consistent patterns for:
- probability scaling/compression
- distribution ladder logic
- edge logic

---

## 7. DO NOT MODIFY THESE RULES LIGHTLY

Any changes must be intentional and justified.

