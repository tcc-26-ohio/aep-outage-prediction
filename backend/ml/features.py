import numpy as np

from .data import ASSET_TYPES, DAMAGE_TYPES, season


def restoration_static(asset_type, damage_type, day_idx, start, event_load) -> np.ndarray:
    """Static vector fed to RestorationRNN; shared by training and inference."""
    a = np.zeros(len(ASSET_TYPES), dtype=np.float32)
    if asset_type in ASSET_TYPES:
        a[ASSET_TYPES.index(asset_type)] = 1
    d = np.zeros(len(DAMAGE_TYPES), dtype=np.float32)
    if damage_type in DAMAGE_TYPES:
        d[DAMAGE_TYPES.index(damage_type)] = 1
    return np.concatenate([a, d, season(day_idx, start), [np.log1p(event_load)]]).astype(np.float32)
