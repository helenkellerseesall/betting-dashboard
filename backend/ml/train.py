#!/usr/bin/env python3
"""
Train a per-leg probabilistic model (logistic regression) for betting prop prediction.
Loads training data from backend export and saves calibrated model to JSON.
"""
import json
import sys
import os
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.calibration import CalibratedClassifierCV

def load_training_data(data_path_or_url):
    """Load training data from JSON export (local file or URL)."""
    if data_path_or_url.startswith("http"):
        import requests
        resp = requests.get(data_path_or_url)
        data = resp.json()
    else:
        with open(data_path_or_url) as f:
            data = json.load(f)
    return pd.DataFrame(data)

def prepare_features(df):
    """Prepare features for modeling. Requires 'outcome' labels."""
    # Feature columns to use
    feature_cols = [
        "edge", "hitRate", "avgMin", "minStd", "valueStd",
        "lineMove", "oddsMove", "dvpScore", "line", "odds"
    ]
    
    # Outcome column
    outcome_col = "outcome"
    
    # Filter to rows with valid outcomes and features
    df_clean = df.dropna(subset=[outcome_col] + feature_cols)
    
    if len(df_clean) == 0:
        print("ERROR: No valid training data rows with outcome labels and features.")
        sys.exit(1)
    
    X = df_clean[feature_cols].values.astype(np.float32)
    y = df_clean[outcome_col].values.astype(int)
    
    # Encode categorical features (if any strings)
    proptype_map = {"Points": 0, "Rebounds": 1, "Assists": 2, "Threes": 3, "PRA": 4}
    side_map = {"Over": 0, "Under": 1}
    book_map = {"FanDuel": 0, "DraftKings": 1}
    
    return X, y, df_clean, feature_cols

def train_model(X, y):
    """Train logistic regression with calibration."""
    # Create pipeline: scale + logistic regression
    pipe = Pipeline([
        ("scaler", StandardScaler()),
        ("lr", LogisticRegression(max_iter=1000, random_state=42))
    ])
    
    # Calibrate probabilities using Platt scaling
    model = CalibratedClassifierCV(pipe, method="sigmoid", cv=5)
    model.fit(X, y)
    
    return model, pipe

def serialize_model(model, feature_cols, output_path):
    """Serialize trained model to JSON for Node.js."""
    # Get the logistic regression coefficients and intercept
    # Note: CalibratedClassifierCV wraps the pipeline, so we extract the underlying estimator
    pipe = model.base_estimator_
    scaler = pipe.named_steps["scaler"]
    lr = pipe.named_steps["lr"]
    
    model_dict = {
        "type": "logistic_regression",
        "features": feature_cols,
        "scaler": {
            "mean": scaler.mean_.tolist(),
            "scale": scaler.scale_.tolist()
        },
        "lr": {
            "coef": lr.coef_[0].tolist(),
            "intercept": float(lr.intercept_[0])
        },
        "calibration": {
            "method": "sigmoid",
            "calibrators": [
                {
                    "coef": float(c.coef_[0]) if len(c.coef_) > 0 else 0,
                    "intercept": float(c.intercept_)
                }
                for c in model.calibrators_
            ]
        }
    }
    
    with open(output_path, "w") as f:
        json.dump(model_dict, f, indent=2)
    
    print(f"Model saved to {output_path}")

def evaluate_model(model, X, y):
    """Print model evaluation metrics."""
    from sklearn.metrics import roc_auc_score, accuracy_score, precision_score, recall_score, brier_score_loss
    
    y_pred = model.predict(X)
    y_proba = model.predict_proba(X)[:, 1]
    
    auc = roc_auc_score(y, y_proba)
    acc = accuracy_score(y, y_pred)
    prec = precision_score(y, y_pred, zero_division=0)
    rec = recall_score(y, y_pred, zero_division=0)
    brier = brier_score_loss(y, y_proba)
    
    print(f"\n=== Model Evaluation ===")
    print(f"Samples: {len(y)}")
    print(f"Positive class: {y.sum()} ({100*y.sum()/len(y):.1f}%)")
    print(f"AUC-ROC: {auc:.4f}")
    print(f"Accuracy: {acc:.4f}")
    print(f"Precision: {prec:.4f}")
    print(f"Recall: {rec:.4f}")
    print(f"Brier Score (calibration): {brier:.4f}")

def main():
    """Main entry point."""
    # Default: load from local JSON or URL
    data_source = "http://localhost:4000/export/training.json"
    if len(sys.argv) > 1:
        data_source = sys.argv[1]
    
    output_dir = Path(__file__).parent
    model_output = output_dir / "model.json"
    
    print(f"Loading training data from: {data_source}")
    df = load_training_data(data_source)
    print(f"Loaded {len(df)} rows")
    
    print("Preparing features...")
    X, y, df_clean, feature_cols = prepare_features(df)
    print(f"Training set: {len(X)} samples, {X.shape[1]} features")
    print(f"Positive class: {y.sum()} ({100*y.sum()/len(y):.1f}%)")
    
    print("Training model...")
    model, pipe = train_model(X, y)
    
    print("Evaluating model...")
    evaluate_model(model, X, y)
    
    print(f"Serializing model to {model_output}")
    serialize_model(model, feature_cols, str(model_output))
    
    print("\nTraining complete! Model ready for scoring.")

if __name__ == "__main__":
    main()
