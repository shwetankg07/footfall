from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from threadpoolctl import threadpool_limits

from .detect import count_interval, estimate_dispersion


@dataclass(frozen=True)
class Forecast:
    frame: pd.DataFrame
    model: str
    dispersion: float
    rule: str = "count"


class Model(Protocol):
    name: str

    def fit(self, history: pd.Series, timezone: str = "Asia/Kolkata") -> Model: ...

    def predict(self, hours: pd.DatetimeIndex) -> Forecast: ...


def validate_history(history: pd.Series) -> pd.Series:
    if history.empty or not isinstance(history.index, pd.DatetimeIndex) or history.index.tz is None:
        raise ValueError("history must be a nonempty, timezone-aware hourly series")
    values = history.to_numpy(dtype=float)
    if not np.isfinite(values).all() or (values < 0).any() or (values != np.floor(values)).any():
        raise ValueError("history must contain finite, nonnegative integer counts")
    history = history.copy().astype(float)
    history.index = history.index.tz_convert("UTC")
    if not history.index.equals(pd.date_range(history.index[0], periods=len(history), freq="h")):
        raise ValueError("history must be sorted, unique and zero-filled at hourly frequency")
    return history


class BaseModel:
    name = "base"
    rule = "count"

    def _start(self, history: pd.Series, timezone: str) -> None:
        self.history = validate_history(history)
        self.timezone = timezone
        self.dispersion = 0.0

    def _validate_hours(self, hours: pd.DatetimeIndex) -> None:
        if hours.tz is None or (hours <= self.history.index[-1]).any():
            raise ValueError("forecast hours must be timezone-aware and after training history")
        if ((hours - self.history.index[-1]) % pd.Timedelta(hours=1) != pd.Timedelta(0)).any():
            raise ValueError("forecast hours must align with training history's hourly buckets")

    def _forecast(self, hours: pd.DatetimeIndex, expected: np.ndarray) -> Forecast:
        self._validate_hours(hours)
        expected = np.maximum(np.asarray(expected, dtype=float), 0.01)
        lo, hi = count_interval(expected, self.dispersion)
        return Forecast(pd.DataFrame({"expected": expected, "lo": lo, "hi": hi}, index=hours), self.name, self.dispersion, self.rule)


class NaiveThreshold(BaseModel):
    name = "naive_threshold"
    rule = "ratio"

    def fit(self, history: pd.Series, timezone: str = "Asia/Kolkata") -> NaiveThreshold:
        self._start(history, timezone)
        self.mean = float(self.history.iloc[-168:].mean())
        self.dispersion = estimate_dispersion(self.history.iloc[-168:].to_numpy(), np.full(min(168, len(history)), self.mean), 1)
        return self

    def predict(self, hours: pd.DatetimeIndex) -> Forecast:
        return self._forecast(hours, np.full(len(hours), self.mean))


class SeasonalNaive(BaseModel):
    name = "seasonal_naive"

    def fit(self, history: pd.Series, timezone: str = "Asia/Kolkata") -> SeasonalNaive:
        self._start(history, timezone)
        if len(history) < 168:
            raise ValueError("seasonal naive requires at least one week")
        local = self.history.index.tz_convert(timezone)
        slots = local.dayofweek * 24 + local.hour
        self.last_week = self.history.groupby(slots).last()
        self.hourly = self.history.groupby(local.hour).mean()
        previous = self.history.groupby(slots).shift(1).dropna()
        if len(previous):
            self.dispersion = estimate_dispersion(self.history.loc[previous.index].to_numpy(), previous.to_numpy())
        else:
            self.dispersion = 0.25
        return self

    def predict(self, hours: pd.DatetimeIndex) -> Forecast:
        local = hours.tz_convert(self.timezone)
        slots = local.dayofweek * 24 + local.hour
        # Reuse the most recent matching local weekly hour, including across DST.
        values = self.last_week.reindex(slots).to_numpy()
        missing = np.isnan(values)
        values[missing] = self.hourly.reindex(local.hour[missing]).to_numpy()
        return self._forecast(hours, values)


class SeasonalProfile(BaseModel):
    name = "seasonal_profile"

    def _calendar(self, index: pd.DatetimeIndex) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        local = index.tz_convert(self.timezone)
        hour, dow = local.hour.to_numpy(), local.dayofweek.to_numpy()
        return hour, dow, dow * 24 + hour

    def fit(self, history: pd.Series, timezone: str = "Asia/Kolkata") -> SeasonalProfile:
        self._start(history, timezone)
        self._fit_profile()
        # In-sample residuals are too optimistic, especially for busy sites.
        # Calibrate on daily-origin forecasts from the most recent week instead.
        residual_actual, residual_expected = [], []
        calibration_start = len(self.history) - 168 if len(self.history) >= 336 else len(self.history)
        for cutoff in range(calibration_start, len(self.history), 24):
            prior = SeasonalProfile()
            prior._start(self.history.iloc[:cutoff], timezone)
            prior._fit_profile()
            hours = self.history.index[cutoff : cutoff + 24]
            residual_expected.extend((prior.profile[prior._calendar(hours)[2]] * prior.level).tolist())
            residual_actual.extend(self.history.loc[hours].tolist())
        if residual_actual:
            self.dispersion = estimate_dispersion(np.asarray(residual_actual), np.asarray(residual_expected))
        return self

    def _fit_profile(self) -> None:
        y = self.history.to_numpy()
        hour, dow, slot = self._calendar(self.history.index)
        weights = np.exp2(-np.arange(len(y) - 1, -1, -1) / (24 * 21))

        def means(keys: np.ndarray, size: int, values: np.ndarray) -> np.ndarray:
            return np.bincount(keys, weights=weights * values, minlength=size) / np.maximum(np.bincount(keys, weights=weights, minlength=size), 1e-9)

        hourly = means(hour, 24, y)
        hourly = 0.25 * np.roll(hourly, 1) + 0.5 * hourly + 0.25 * np.roll(hourly, -1)
        weekday = means(dow, 7, y) / max(float(np.average(y, weights=weights)), 0.01)
        base = hourly[hour] * weekday[dow]
        # Bound individual spikes before learning a repeating weekly pattern.
        cleaned = np.minimum(y, base + 4 * np.sqrt(base + 0.15 * base**2))
        hourly = means(hour, 24, cleaned)
        hourly = 0.25 * np.roll(hourly, 1) + 0.5 * hourly + 0.25 * np.roll(hourly, -1)
        weekday = means(dow, 7, cleaned) / max(float(np.average(cleaned, weights=weights)), 0.01)
        prior = (weekday[:, None] * hourly[None, :]).ravel()
        mass = np.bincount(slot, weights=weights, minlength=168)
        total = np.bincount(slot, weights=weights * cleaned, minlength=168)
        self.profile = np.maximum((total + 4 * prior) / (mass + 4), 0.01)
        recent = min(168, len(y))
        self.level = float(np.clip(cleaned[-recent:].sum() / max(self.profile[slot[-recent:]].sum(), 1.0), 0.6, 1.6))
        fitted = self.profile[slot] * self.level
        self.dispersion = estimate_dispersion(y, fitted, fitted_parameters=40)

    def predict(self, hours: pd.DatetimeIndex) -> Forecast:
        return self._forecast(hours, self.profile[self._calendar(hours)[2]] * self.level)


def _features(history: pd.Series, timezone: str) -> pd.DataFrame:
    local = history.index.tz_convert(timezone)
    frame = pd.DataFrame(index=history.index)
    frame["hour_of_week"] = local.dayofweek * 24 + local.hour
    frame["hour"] = local.hour
    frame["dow"] = local.dayofweek
    frame["hour_sin"] = np.sin(2 * np.pi * local.hour / 24)
    frame["hour_cos"] = np.cos(2 * np.pi * local.hour / 24)
    frame["lag24"] = history.shift(24)
    frame["lag168"] = history.shift(168)
    frame["mean24"] = history.shift(1).rolling(24).mean()
    frame["mean168"] = history.shift(1).rolling(168).mean()
    return frame


class PoissonBoosting(BaseModel):
    name = "poisson_boosting"

    def fit(self, history: pd.Series, timezone: str = "Asia/Kolkata") -> PoissonBoosting:
        self._start(history, timezone)
        features = _features(self.history, timezone).dropna()
        if len(features) < 72:
            raise ValueError("boosting requires at least ten days of history")
        self.regressor = HistGradientBoostingRegressor(
            loss="poisson", max_iter=80, max_leaf_nodes=12, min_samples_leaf=24,
            l2_regularization=8, learning_rate=0.06, random_state=0, early_stopping=False,
        )
        target = self.history.loc[features.index].to_numpy()
        weights = np.exp2(-np.arange(len(target) - 1, -1, -1) / (24 * 21))
        with threadpool_limits(limits=1):
            self.regressor.fit(features.to_numpy(), target, sample_weight=weights)
            fitted = self.regressor.predict(features.to_numpy())
        self.dispersion = estimate_dispersion(target, fitted, fitted_parameters=45)
        return self

    def predict(self, hours: pd.DatetimeIndex) -> Forecast:
        self._validate_hours(hours)
        if hours.empty:
            return self._forecast(hours, np.array([]))
        # Recursive values, never actual future counts, supply rolling means at h+2 onward.
        all_hours = pd.date_range(self.history.index[-1] + pd.Timedelta(hours=1), hours.max(), freq="h")
        extended = self.history.reindex(self.history.index.append(all_hours))
        with threadpool_limits(limits=1):
            for hour in all_hours:
                features = _features(extended.loc[:hour], self.timezone).iloc[[-1]].to_numpy()
                extended.loc[hour] = max(float(self.regressor.predict(features)[0]), 0.01)
        return self._forecast(hours, extended.loc[hours].to_numpy())


MODEL_TYPES = {model.name: model for model in (NaiveThreshold, SeasonalNaive, SeasonalProfile, PoissonBoosting)}


def make_model(name: str) -> Model:
    try:
        return MODEL_TYPES[name]()
    except KeyError as error:
        raise ValueError(f"unknown model: {name}") from error
