"""Inference helpers for the trained outage / restoration models."""

from functools import lru_cache

import numpy as np
import pandas as pd
import torch

from .data import season
from .features import restoration_static
from .models import OutageLSTM, RestorationRNN
from .train import MODEL_DIR


@lru_cache
def _load():
    o = torch.load(MODEL_DIR / "outage_lstm.pt", weights_only=False)
    r = torch.load(MODEL_DIR / "restoration_rnn.pt", weights_only=False)
    outage = OutageLSTM(); outage.load_state_dict(o["state"]); outage.eval()
    rest = RestorationRNN(n_static=r["n_static"]); rest.load_state_dict(r["state"]); rest.eval()
    return outage, rest, o


def _prep(weather_72h: np.ndarray, meta) -> torch.Tensor:
    """weather_72h: [72, 6] raw (temp C, precip mm, rain mm, snow cm, wind km/h, gust km/h) ending at local midnight."""
    w = np.array(weather_72h, dtype=np.float32)
    w[:, 1:4] = np.log1p(np.clip(w[:, 1:4], 0, None))
    mean, std = np.array(meta["norm"]["mean"]), np.array(meta["norm"]["std"])
    return torch.from_numpy(((w - mean) / std).astype(np.float32))[None]


def predict_outage(weather_72h, date) -> float:
    """Probability of at least one damage report in the city on `date`."""
    outage, _, meta = _load()
    extra = torch.from_numpy(season((pd.Timestamp(date) - pd.Timestamp(meta["start"]).normalize()).days, pd.Timestamp(meta["start"])))[None]
    with torch.no_grad():
        return float(torch.sigmoid(outage(_prep(weather_72h, meta), extra)))


def predict_restoration(weather_72h, date, asset_type="primary", damage_type="Damaged Wire", event_load=1) -> dict:
    """Credible restoration time in days: {'p10', 'p50', 'p90'}."""
    _, rest, meta = _load()
    start = pd.Timestamp(meta["start"])
    day = (pd.Timestamp(date) - start.normalize()).days
    static = torch.from_numpy(restoration_static(asset_type, damage_type, day, start, event_load))[None]
    with torch.no_grad():
        q = np.expm1(rest(_prep(weather_72h, meta), static).numpy()[0])
    return {k: float(max(v, 0)) for k, v in zip(("p10", "p50", "p90"), q)}
