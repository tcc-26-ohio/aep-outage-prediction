"""Train the outage-likelihood LSTM and the restoration-time GRU.

Run from the repository root: .venv/bin/python -m backend.ml.train [--holdout]

Demo-grade by design: the models are allowed to overfit the single historical dataset.
--holdout trains on the first ~80% of days / reports and prints metrics on the rest.
"""

import argparse
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import average_precision_score, roc_auc_score

from .data import WINDOW_HOURS, load, season, window
from .features import restoration_static
from .models import QUANTILES, OutageLSTM, RestorationRNN, pinball_loss

MODEL_DIR = Path(__file__).resolve().parents[1] / "models"


def batches(n, size, rng):
    order = rng.permutation(n)
    for i in range(0, n, size):
        yield order[i : i + size]


def build_outage(ds):
    n_days = ds.weather.shape[1] // 24
    pos = set(zip(ds.damage.city_idx, ds.damage.day_idx))
    xs, ex, ys, keys = [], [], [], []
    for c in range(len(ds.cities)):
        for d in range(1, n_days - 1):
            xs.append(window(ds.weather, c, d))
            ex.append(season(d, ds.start))
            ys.append(float((c, d) in pos))
            keys.append(d)
    return np.stack(xs), np.stack(ex), np.array(ys, dtype=np.float32), np.array(keys)


def train_outage(ds, holdout, epochs, rng):
    x, ex, y, day = build_outage(ds)
    cut = np.quantile(day, 0.8) if holdout else np.inf
    tr, te = day <= cut, day > cut
    print(f"outage: {len(y)} city-days, {int(y.sum())} positive")
    model = OutageLSTM()
    opt = torch.optim.Adam(model.parameters(), lr=2e-3)
    pw = torch.tensor(min((1 - y[tr].mean()) / max(y[tr].mean(), 1e-6), 50.0))
    X, E, Y = map(torch.from_numpy, (x, ex, y))
    idx = np.flatnonzero(tr)
    for ep in range(epochs):
        model.train()
        total = 0.0
        for b in batches(len(idx), 512, rng):
            j = idx[b]
            loss = torch.nn.functional.binary_cross_entropy_with_logits(model(X[j], E[j]), Y[j], pos_weight=pw)
            opt.zero_grad(); loss.backward(); opt.step()
            total += loss.item() * len(j)
        if ep % 5 == 4 or ep == epochs - 1:
            print(f"  epoch {ep + 1:3d} loss {total / len(idx):.4f}")
    model.eval()
    with torch.no_grad():
        p = torch.sigmoid(torch.cat([model(X[i : i + 4096], E[i : i + 4096]) for i in range(0, len(X), 4096)])).numpy()
    for name, m in (("train", tr), ("holdout", te)):
        if m.any() and 0 < y[m].sum() < m.sum():
            print(f"  {name}: AUC {roc_auc_score(y[m], p[m]):.3f}  AP {average_precision_score(y[m], p[m]):.3f}  (base rate {y[m].mean():.4f})")
    return model, float(pw)


def train_restoration(ds, holdout, epochs, rng):
    dm = ds.damage[~ds.damage.censored].reset_index(drop=True)
    load_ = ds.damage.groupby(["city_idx", "day_idx"]).size()
    x = np.stack([window(ds.weather, r.city_idx, r.day_idx) for r in dm.itertuples()])
    st = np.stack([
        restoration_static(r.Asset_Type, r.Inform_Wor, r.day_idx, ds.start, load_[(r.city_idx, r.day_idx)])
        for r in dm.itertuples()
    ])
    y = np.log1p(dm.days_to_repair.to_numpy(dtype=np.float32))
    cut = np.quantile(dm.day_idx, 0.8) if holdout else np.inf
    tr, te = (dm.day_idx <= cut).to_numpy(), (dm.day_idx > cut).to_numpy()
    print(f"restoration: {len(y)} repaired reports ({len(ds.damage) - len(y)} still-open dropped)")
    model = RestorationRNN(n_static=st.shape[1])
    opt = torch.optim.Adam(model.parameters(), lr=3e-3)
    X, S, Y = map(torch.from_numpy, (x, st, y))
    idx = np.flatnonzero(tr)
    for ep in range(epochs):
        model.train()
        total = 0.0
        for b in batches(len(idx), 128, rng):
            j = idx[b]
            loss = pinball_loss(model(X[j], S[j]), Y[j])
            opt.zero_grad(); loss.backward(); opt.step()
            total += loss.item() * len(j)
        if ep % 20 == 19 or ep == epochs - 1:
            print(f"  epoch {ep + 1:3d} pinball {total / len(idx):.4f}")
    model.eval()
    with torch.no_grad():
        q = model(X, S).numpy()
    for name, m in (("train", tr), ("holdout", te)):
        if m.any():
            days = np.expm1(y[m])
            lo, med, hi = (np.expm1(q[m, i]) for i in range(3))
            print(f"  {name}: median MAE {np.abs(med - days).mean():.2f} d, 10-90% coverage {np.mean((days >= lo - 0.5) & (days <= hi + 0.5)):.2f}")
    return model


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--holdout", action="store_true")
    ap.add_argument("--outage-epochs", type=int, default=30)
    ap.add_argument("--restoration-epochs", type=int, default=200)
    a = ap.parse_args()
    torch.manual_seed(0)
    rng = np.random.default_rng(0)
    ds = load()
    print(f"{len(ds.cities)} cities, {ds.weather.shape[1]} hours from {ds.start}, {len(ds.damage)} damage reports")
    outage, pos_weight = train_outage(ds, a.holdout, a.outage_epochs, rng)
    restoration = train_restoration(ds, a.holdout, a.restoration_epochs, rng)
    if a.holdout:
        return
    MODEL_DIR.mkdir(exist_ok=True)
    meta = {"cities": ds.cities, "norm": ds.norm, "start": str(ds.start), "window_hours": WINDOW_HOURS, "quantiles": QUANTILES}
    torch.save({"state": outage.state_dict(), **meta}, MODEL_DIR / "outage_lstm.pt")
    torch.save({"state": restoration.state_dict(), "n_static": restoration.head[0].in_features - 64, **meta}, MODEL_DIR / "restoration_rnn.pt")
    print(f"saved to {MODEL_DIR}")


if __name__ == "__main__":
    main()
