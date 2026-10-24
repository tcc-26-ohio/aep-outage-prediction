"""Smoke-test training pipeline with synthetic data, NOT an outage predictor.

Run from the repository root: python backend/train.py
Replace synthetic examples with validated, event-split data before deployment.
"""

from pathlib import Path

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

FEATURES = ["wind_gust_mph", "rainfall_inches", "overhead_fraction"]


def main():
    rng = np.random.default_rng(42)
    x = np.column_stack((rng.uniform(5, 80, 500), rng.uniform(0, 5, 500), rng.uniform(0, 1, 500)))
    score = -5 + 0.07 * x[:, 0] + 0.4 * x[:, 1] + 1.5 * x[:, 2]
    y = rng.binomial(1, 1 / (1 + np.exp(-score)))
    model = make_pipeline(StandardScaler(), LogisticRegression(solver="liblinear", random_state=42))
    model.fit(x, y)
    output = Path(__file__).parent / "models" / "synthetic_baseline.joblib"
    output.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "features": FEATURES, "synthetic": True}, output)
    print(f"Saved synthetic pipeline smoke test to {output}. Not used by the API; not validated for outage prediction.")


if __name__ == "__main__":
    main()
