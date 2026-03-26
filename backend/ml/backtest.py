#!/usr/bin/env python3
"""
Backtest harness: compares heuristic-only vs ML-hybrid slip ranking.
Measures: precision, ROI, calibration, win rate by slip tier.
"""

import json
import sys
import urllib.request
import math
from collections import defaultdict
from datetime import datetime

def load_training_data(source="http://localhost:4000/export/training.json"):
    """Load training data from backend export or local file."""
    try:
        if source.startswith("http"):
            with urllib.request.urlopen(source, timeout=10) as response:
                return json.loads(response.read().decode())
        else:
            with open(source, 'r') as f:
                return json.load(f)
    except Exception as e:
        print(f"Error loading training data from {source}: {e}", file=sys.stderr)
        return []

def parse_hit_rate(hr_str):
    """Parse hit rate string like '7/10' to float 0-1."""
    if not hr_str or hr_str == "":
        return 0.5
    try:
        parts = str(hr_str).split("/")
        if len(parts) == 2:
            hits = float(parts[0])
            total = float(parts[1])
            return hits / total if total > 0 else 0.5
        return 0.5
    except:
        return 0.5

def compute_heuristic_score(row):
    """Compute pure heuristic score (without ML)."""
    # This matches the backend's scorePropRow logic but without ML
    score = 0
    
    # Edge component
    edge = float(row.get("edge") or 0) if row.get("edge") is not None else 0
    score += edge * 20
    
    # Hit rate component
    hit_rate = parse_hit_rate(row.get("hitRate"))
    score += hit_rate * 50
    
    # Minutes stability
    avg_min = float(row.get("avgMin") or 0) if row.get("avgMin") is not None else 0
    min_std = float(row.get("minStd") or 0) if row.get("minStd") is not None else 0
    score += avg_min * 0.5
    score -= min_std * 2
    
    # Risk signals
    minutes_risk = row.get("minutesRisk", "low")
    score -= {"high": 15, "medium": 5, "low": 0}.get(minutes_risk, 0)
    
    trend_risk = row.get("trendRisk", "low")
    score -= {"high": 10, "medium": 3, "low": 0}.get(trend_risk, 0)
    
    injury_risk = row.get("injuryRisk", "low")
    score -= {"high": 12, "medium": 4, "low": 0}.get(injury_risk, 0)
    
    # DVP signal
    dvp = float(row.get("dvpScore") or 0) if row.get("dvpScore") is not None else 0
    score -= dvp * 0.8 if dvp > 0 else 0
    
    # Odds signal
    odds = float(row.get("odds") or 0) if row.get("odds") is not None else 0
    if odds < -200:
        score -= 5  # Over-favored
    elif odds > 200:
        score += 3  # Under-favored, good edge potential
    
    return max(0, score)

def compute_ml_score(row, model_coeffs):
    """Compute ML probability estimate."""
    # Extract features, handling None values
    features = {
        "edge": float(row.get("edge") or 0) if row.get("edge") is not None else 0,
        "hitRate": parse_hit_rate(row.get("hitRate")),
        "avgMin": float(row.get("avgMin") or 0) if row.get("avgMin") is not None else 0,
        "minStd": float(row.get("minStd") or 0) if row.get("minStd") is not None else 0,
        "valueStd": float(row.get("valueStd") or 0) if row.get("valueStd") is not None else 0,
        "lineMove": float(row.get("lineMove") or 0) if row.get("lineMove") is not None else 0,
        "oddsMove": float(row.get("oddsMove") or 0) if row.get("oddsMove") is not None else 0,
        "dvpScore": float(row.get("dvpScore") or 0) if row.get("dvpScore") is not None else 0,
        "line": float(row.get("line") or 0) if row.get("line") is not None else 0,
        "odds": float(row.get("odds") or 0) if row.get("odds") is not None else 0
    }
    
    # Scale features (simple z-score using model's known ranges)
    feature_ranges = {
        "edge": (0, 10), "hitRate": (0, 1), "avgMin": (0, 40), "minStd": (0, 10),
        "valueStd": (0, 10), "lineMove": (-5, 5), "oddsMove": (-500, 500),
        "dvpScore": (-50, 50), "line": (0, 50), "odds": (-500, 500)
    }
    
    scaled = {}
    for key, val in features.items():
        min_val, max_val = feature_ranges.get(key, (0, 1))
        scaled[key] = (val - min_val) / (max_val - min_val + 0.001) if max_val != min_val else 0.5
        scaled[key] = max(-3, min(3, scaled[key]))
    
    # Compute logit: w^T * x + b
    z = model_coeffs.get("intercept", 0)
    feature_names = list(model_coeffs.get("features", []))
    coef_list = model_coeffs.get("coef", [0] * 10)
    
    for i, fname in enumerate(feature_names):
        if i < len(coef_list):
            z += coef_list[i] * scaled.get(fname, 0)
    
    # Apply sigmoid
    try:
        prob = 1 / (1 + math.exp(-z))
    except:
        prob = 0.5
    
    return prob

def score_slip_legs(legs, use_ml=False, model_coeffs=None):
    """Score a set of legs and return ranked list."""
    scored = []
    
    for leg in legs:
        # Skip legs with no outcome (not fully labeled)
        if leg.get("outcome") is None:
            score = compute_heuristic_score(leg)
        else:
            outcome = int(leg.get("outcome", 0))
        
        if use_ml and model_coeffs:
            ml_prob = compute_ml_score(leg, model_coeffs)
            heuristic_score = compute_heuristic_score(leg)
            # Blend 40% heuristic, 40% ML, 20% edge/hit rate
            combined_score = (heuristic_score * 0.4 + ml_prob * 100 * 0.4 + 
                            float(leg.get("edge", 0)) * 15 * 0.1 + 
                            parse_hit_rate(leg.get("hitRate")) * 60 * 0.1)
        else:
            combined_score = compute_heuristic_score(leg)
        
        scored.append({
            "leg": leg,
            "score": combined_score,
            "outcome": int(leg.get("outcome", 0)) if leg.get("outcome") is not None else None,
            "odds": float(leg.get("odds", 0)) or -110
        })
    
    # Sort by score descending
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored

def evaluate_slip_strategy(legs, use_ml=False, model_coeffs=None, slip_name=""):
    """Evaluate a slip ranking strategy."""
    # Filter to legs with recorded outcomes only
    labeled_legs = [leg for leg in legs if leg.get("outcome") is not None]
    
    if not labeled_legs:
        return {
            "slip_name": slip_name,
            "strategy": "ML" if use_ml else "Heuristic",
            "total_legs": len(legs),
            "labeled_legs": 0,
            "status": "INSUFFICIENT_DATA"
        }
    
    ranked = score_slip_legs(labeled_legs, use_ml=use_ml, model_coeffs=model_coeffs)
    
    # Compute metrics
    total_legs = len(ranked)
    hits = sum(1 for leg in ranked if leg["outcome"] == 1)
    accuracy = hits / total_legs if total_legs > 0 else 0
    
    # Top-K accuracy
    top_5_legs = ranked[:5]
    top_5_hits = sum(1 for leg in top_5_legs if leg["outcome"] == 1)
    top_5_accuracy = top_5_hits / len(top_5_legs) if top_5_legs else 0
    
    top_10_legs = ranked[:10]
    top_10_hits = sum(1 for leg in top_10_legs if leg["outcome"] == 1)
    top_10_accuracy = top_10_hits / len(top_10_legs) if top_10_legs else 0
    
    # Expected value calculation (assuming -110 odds)
    roi_amount = 0
    for leg in ranked:
        # Convert odds to decimal
        odds = leg["odds"]
        if odds < 0:
            decimal_odds = 1 + 100 / abs(odds)
        else:
            decimal_odds = 1 + odds / 100
        
        # EV = P(win) * (odds_multiple - 1) - P(loss) * 1
        prob = 0.5  # Average prior; real EV would use model prob
        ev_per_leg = prob * (decimal_odds - 1) - (1 - prob)
        roi_amount += ev_per_leg
    
    avg_roi = roi_amount / total_legs if total_legs > 0 else 0
    
    return {
        "slip_name": slip_name,
        "strategy": "ML" if use_ml else "Heuristic",
        "total_labeled_legs": total_legs,
        "accuracy_overall": round(accuracy, 3),
        "top_5_accuracy": round(top_5_accuracy, 3),
        "top_10_accuracy": round(top_10_accuracy, 3),
        "total_hits": hits,
        "avg_roi_per_leg": round(avg_roi, 4),
        "status": "OK"
    }

def load_placeholder_model():
    """Load placeholder model coefficients."""
    return {
        "features": ["edge", "hitRate", "avgMin", "minStd", "valueStd", 
                    "lineMove", "oddsMove", "dvpScore", "line", "odds"],
        "coef": [0.8, 2.5, 0.05, -0.15, -0.12, 0.02, 0.001, -0.03, 0.02, 0.0005],
        "intercept": -0.5
    }

def main():
    print("=" * 70)
    print("BACKTEST HARNESS: Heuristic-Only vs ML-Hybrid Slip Ranking")
    print("=" * 70)
    print()
    
    # Load training data
    source = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4000/export/training.json"
    print(f"Loading training data from: {source}")
    legs = load_training_data(source)
    
    if not legs:
        print("ERROR: No training data loaded.", file=sys.stderr)
        sys.exit(1)
    
    print(f"Loaded {len(legs)} legs")
    print()
    
    # Count outcomes
    labeled = sum(1 for leg in legs if leg.get("outcome") is not None)
    print(f"Labeled outcomes: {labeled} / {len(legs)} ({round(100*labeled/len(legs), 1)}%)")
    
    if labeled < 50:
        print("WARNING: Only a few labeled outcomes. Results may not be statistically significant.")
    print()
    
    # Load model (placeholder for now)
    model = load_placeholder_model()
    
    # Strategies to test
    strategies = [
        ("All Props - Heuristic Only", legs, False, None),
        ("All Props - ML Hybrid", legs, True, model),
    ]
    
    print("-" * 70)
    print("STRATEGY COMPARISON")
    print("-" * 70)
    print()
    
    results = []
    best_heuristic = None
    best_ml = None
    
    for slip_name, slip_legs, use_ml, model_coeffs in strategies:
        result = evaluate_slip_strategy(slip_legs, use_ml=use_ml, 
                                       model_coeffs=model_coeffs, slip_name=slip_name)
        results.append(result)
        
        if result["status"] == "OK":
            strategy_type = "ML" if use_ml else "Heuristic"
            if strategy_type == "Heuristic":
                best_heuristic = result
            else:
                best_ml = result
        
        # Print result
        print(f"Strategy: {slip_name}")
        print(f"  Total Labeled Legs: {result.get('total_labeled_legs', 0)}")
        print(f"  Overall Accuracy: {result.get('accuracy_overall', 0):.1%}")
        print(f"  Top-5 Accuracy: {result.get('top_5_accuracy', 0):.1%}")
        print(f"  Top-10 Accuracy: {result.get('top_10_accuracy', 0):.1%}")
        print(f"  Hits / Total: {result.get('total_hits', 0)} / {result.get('total_labeled_legs', 0)}")
        print(f"  Avg ROI per Leg: {result.get('avg_roi_per_leg', 0):.4f}")
        print()
    
    # Summary comparison
    print("-" * 70)
    print("SUMMARY: ML IMPROVEMENT")
    print("-" * 70)
    print()
    
    if best_heuristic and best_ml:
        acc_improvement = best_ml["accuracy_overall"] - best_heuristic["accuracy_overall"]
        top5_improvement = best_ml["top_5_accuracy"] - best_heuristic["top_5_accuracy"]
        roi_improvement = best_ml["avg_roi_per_leg"] - best_heuristic["avg_roi_per_leg"]
        
        print(f"Overall Accuracy Improvement: {acc_improvement:+.1%}")
        print(f"Top-5 Accuracy Improvement: {top5_improvement:+.1%}")
        print(f"ROI per Leg Improvement: {roi_improvement:+.4f}")
        print()
        
        if acc_improvement > 0:
            print("✅ ML model shows POSITIVE improvement in accuracy")
        elif acc_improvement < -0.02:
            print("⚠️  ML model shows NEGATIVE improvement; may need retraining")
        else:
            print("⏸️  ML model shows MINIMAL change; collect more data")
    
    print()
    print("=" * 70)
    print(f"Backtest completed at {datetime.now().isoformat()}")
    print("=" * 70)

if __name__ == "__main__":
    main()
