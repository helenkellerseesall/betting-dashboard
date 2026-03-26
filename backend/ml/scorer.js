/**
 * ML Scorer: Loads trained logistic regression model and scores individual prop legs.
 * Provides calibrated hit probability estimates for each candidate leg.
 */
const fs = require("fs")
const path = require("path")

class MLScorer {
  constructor(modelPath) {
    this.modelPath = modelPath
    this.model = null
    this.loaded = false
    this.loadModel()
  }

  loadModel() {
    try {
      if (!fs.existsSync(this.modelPath)) {
        console.warn(`ML model not found at ${this.modelPath}. Scorer disabled.`)
        return
      }

      const raw = fs.readFileSync(this.modelPath, "utf8")
      this.model = JSON.parse(raw)
      this.loaded = true
      console.log(`ML Scorer loaded with ${this.model.features.length} features`)
    } catch (error) {
      console.error(`Failed to load ML model: ${error.message}`)
    }
  }

  /**
   * Scale features using fitted scaler mean/std.
   */
  scaleFeatures(featureValues) {
    if (!this.model) return null
    const { mean, scale } = this.model.scaler
    return featureValues.map((val, i) => (val - mean[i]) / scale[i])
  }

  /**
   * Compute logistic sigmoid probability.
   */
  sigmoid(z) {
    return 1 / (1 + Math.exp(-z))
  }

  /**
   * Score a single leg using the trained logistic regression model.
   * Returns calibrated probability of hitting (0-1).
   */
  scoreRow(row) {
    if (!this.loaded || !this.model) {
      return null
    }

    try {
      // Extract feature values in order
      const featureValues = this.model.features.map((feat) => {
        const val = Number(row[feat] || 0)
        return Number.isFinite(val) ? val : 0
      })

      // Scale using fitted scaler
      const scaled = this.scaleFeatures(featureValues)

      // Linear combination: w^T * x + b
      const { coef, intercept } = this.model.lr
      let z = intercept
      for (let i = 0; i < scaled.length; i++) {
        z += coef[i] * scaled[i]
      }

      // Logistic sigmoid
      const rawProb = this.sigmoid(z)

      // Apply Platt calibration (if available)
      let calibratedProb = rawProb
      if (this.model.calibration && this.model.calibration.calibrators.length > 0) {
        const cal = this.model.calibration.calibrators[0]
        const logit = cal.coef * Math.log(rawProb / (1 - rawProb)) + cal.intercept
        calibratedProb = this.sigmoid(logit)
      }

      // Clamp to [0, 1]
      return Math.max(0, Math.min(1, calibratedProb))
    } catch (error) {
      console.error(`Scorer error for row: ${error.message}`)
      return null
    }
  }

  /**
   * Score multiple rows and return list with predictedProb added.
   */
  scoreRows(rows) {
    if (!this.loaded) return rows

    return rows.map((row) => ({
      ...row,
      mlPredictedProb: this.scoreRow(row)
    }))
  }

  /**
   * Compute expected value of a leg assuming Kelly sizing.
   * EV = prob * payout_multiple - (1 - prob) * stake
   */
  computeLegEV(row) {
    const prob = this.scoreRow(row)
    if (prob === null) return null

    const odds = Number(row.odds || 0)
    const stake = 1
    const payoutMultiple = odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds)

    return prob * payoutMultiple - (1 - prob) * stake
  }
}

module.exports = MLScorer
