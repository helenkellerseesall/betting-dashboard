#!/usr/bin/env python3
"""
Simple ML training script: trains logistic regression on betting props.
Fast version without CalibratedClassifierCV (avoids scipy imports).
"""

import json
import sys
import urllib.request
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

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
        print(f"Error loading training data: {e}", file=sys.stderr)
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

def prepare_features(legs):
    """Extract features and outcomes from legs."""
    X = []
    y = []
    
    feature_names = ["edge", "hitRate", "avgMin", "minStd", "valueStd", 
                    "lineMove", "oddsMove", "dvpScore", "line", "odds"]
    
    for leg in legs:
        # Skip if no outcome
        if leg.get("outcome") is None:
            continue
        
        # Extract features
        features = [
            float(leg.get("edge") or 0) if leg.get("edge") is not None else 0,
            parse_hit_rate(leg.get("hitRate")),
            float(leg.get("avgMin") or 0) if leg.get("avgMin") is not None else 0,
            float(leg.get("minStd") or 0) if leg.get("minStd") is not None else 0,
            float(leg.get("valueStd") or 0) if leg.get("valueStd") is not None else 0,
            float(leg.get("lineMove") or 0) if leg.get("lineMove") is not None else 0,
            float(leg.get("oddsMove") or 0) if leg.get("oddsMove") is not None else 0,
            float(leg.get("dvpScore") or 0) if leg.get("dvpScore") is not None else 0,
            float(leg.get("line") or 0) if leg.get("line") is not None else 0,
            float(leg.get("odds") or 0) if leg.get("odds") is not None else 0
        ]
        
        X.append(features)
        y.append(int(leg.get("outcome", 0)))
    
    return np.array(X), np.array(y), feature_names

def train_model(X, y):
    """Train logistic regression model."""
    if len(X) < 5:
        print(f"ERROR: Only {len(X)} labeled samples. Need at least 5.", file=sys.stderr)
        return None, None, None
    
    # Scale features
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    # Train logistic regression
    model = LogisticRegression(max_iter=1000, random_state=42)
    model.fit(X_scaled, y)
    
    return model, scaler, X_scaled

def serialize_model(model, scaler, feature_names):
    """Serialize model to JSON-compatible dict."""
    return {
        "type": "logistic_regression",
        "features": feature_names,
        "scaler": {
            "mean": scaler.mean_.tolist(),
            "scale": scaler.scale_.tolist()
        },
        "lr": {
            "coef": model.coef_[0].tolist(),
            "intercept": float(model.intercept_[0])
        }
    }

def main():
    print("=" * 60)
    print("ML Training: Logistic Regression on Betting Props")
    print("=" * 60)
    print()
    
    # Load data
    source = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4000/export/training.json"
    print(f"Loading training data from: {source}")
    legs = load_training_data(source)
    
    if not legs:
        print("ERROR: No training data loaded.", file=sys.stderr)
        sys.exit(1)
    
    print(f"Loaded {len(legs)} total legs")
    
    # Prepare features
    print("\nPreparing features...")
    X, y, feature_names = prepare_features(legs)
    
    labeled_count = len(X)
    hit_count = sum(y)
    miss_count = labeled_count - hit_count
    
    print(f"  Total labeled samples: {labeled_count}")
    print(f"  Hits: {hit_count} ({100*hit_count/labeled_count:.1f}%)")
    print(f"  Misses: {miss_count} ({100*miss_count/labeled_count:.1f}%)")
    print(f"  Features: {', '.join(feature_names)}")
    
    if labeled_count < 5:
        print(f"\nERROR: Need at least 5 labeled samples, got {labeled_count}")
        sys.exit(1)
    
    # Train model
    print("\nTraining logistic regression model...")
    model, scaler, X_scaled = train_model(X, y)
    
    if model is None:
        sys.exit(1)
    
    # Evaluate
    from sklearn.metrics import accuracy_score, precision_score, recall_score, roc_auc_score
    
    y_pred = model.predict(X_scaled)
    y_pred_proba = model.predict_proba(X_scaled)[:, 1]
    
    acc = accuracy_score(y, y_pred)
    prec = precision_score(y, y_pred, zero_division=0)
    recall = recall_score(y, y_pred, zero_division=0)
    
    try:
        auc = roc_auc_score(y, y_pred_proba)
    except:
        auc = 0.0
    
    print(f"\nModel Performance (on training data):")
    print(f"  Accuracy:  {acc:.3f}")
    print(f"  Precision: {prec:.3f}")
    print(f"  Recall:    {recall:.3f}")
    print(f"  AUC-ROC:   {auc:.3f}")
    
    # Serialize model
    serialized = serialize_model(model, scaler, feature_names)
    
    # Save model
    model_path = "ml/model.json"
    with open(model_path, 'w') as f:
        json.dump(serialized, f, indent=2)
    
    print(f"\n✅ Model saved to {model_path}")
    print()
    print("=" * 60)

if __name__ == "__main__":
    main()
