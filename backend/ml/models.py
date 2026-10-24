import torch
from torch import nn

QUANTILES = (0.1, 0.5, 0.9)


class OutageLSTM(nn.Module):
    """Hourly weather window (+ season) -> logit that a city has >=1 damage report that day."""

    def __init__(self, n_weather=6, n_extra=2, hidden=96):
        super().__init__()
        self.lstm = nn.LSTM(n_weather, hidden, num_layers=2, batch_first=True, dropout=0.1)
        self.head = nn.Sequential(nn.Linear(hidden + n_extra, hidden), nn.ReLU(), nn.Linear(hidden, 1))

    def forward(self, x, extra):
        out, _ = self.lstm(x)
        return self.head(torch.cat([out[:, -1], extra], dim=1)).squeeze(1)


class RestorationRNN(nn.Module):
    """Weather window + asset/damage/season/event-load -> P10/P50/P90 of log1p(days to repair)."""

    def __init__(self, n_weather=6, n_static=17, hidden=64):
        super().__init__()
        self.gru = nn.GRU(n_weather, hidden, num_layers=2, batch_first=True, dropout=0.1)
        self.head = nn.Sequential(nn.Linear(hidden + n_static, 128), nn.ReLU(), nn.Linear(128, 64), nn.ReLU(), nn.Linear(64, len(QUANTILES)))

    def forward(self, x, static):
        out, _ = self.gru(x)
        raw = self.head(torch.cat([out[:, -1], static], dim=1))
        # cumulative softplus keeps quantiles ordered; the first output is unconstrained
        return torch.cumsum(torch.cat([raw[:, :1], nn.functional.softplus(raw[:, 1:])], dim=1), dim=1)


def pinball_loss(pred, target):
    q = torch.tensor(QUANTILES, device=pred.device)
    err = target.unsqueeze(1) - pred
    return torch.maximum(q * err, (q - 1) * err).mean()
