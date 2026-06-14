"""
sensitive_attr_processor.py
============================
Generic sensitive-attribute preprocessor for fairness analysis.

Detects whether a column is categorical or continuous-numeric, then:
- Categorical  → uses raw category values; marks rare groups low-confidence
- Continuous   → bins into interpretable ranges; validates sample sizes;
                 merges or marks small bins

Returns a processed Series suitable for group_metrics / fairness_gaps,
plus structured metadata consumed by the frontend summary card.
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

# Minimum samples per group for a result to be considered "reliable"
MIN_GROUP_SIZE: int = 30

# If a numeric column has ≤ this many distinct values treat it as categorical-like
CATEGORICAL_LIKE_THRESHOLD: int = 10

# Maximum bins to produce from auto binning (prevents explosion for large ranges)
MAX_AUTO_BINS: int = 12


# ── Helpers ──────────────────────────────────────────────────────────────────

def _is_age_like(series: pd.Series) -> bool:
    """Heuristic: integer column, values mostly in [0, 120]."""
    if not pd.api.types.is_integer_dtype(series):
        return False
    q5, q95 = series.quantile(0.05), series.quantile(0.95)
    return (q5 >= 0) and (q95 <= 130)


def _bin_to_labels(series: pd.Series, bins: list) -> pd.Series:
    """Cut series into bins and return string labels like '20–24'."""
    labels = []
    for i in range(len(bins) - 1):
        if i == len(bins) - 2:
            labels.append(f"{int(bins[i])}+")
        else:
            labels.append(f"{int(bins[i])}–{int(bins[i+1]) - 1}")
    cut = pd.cut(series, bins=bins, labels=labels, right=False, include_lowest=True)
    return cut.astype(str)


def _auto_bins_age(series: pd.Series, step: int = 5) -> list:
    """Build nice decade-aligned 5-year bins for age-like columns."""
    lo = int(math.floor(series.min() / step) * step)
    hi = int(math.ceil((series.max() + 1) / step) * step)
    bins = list(range(lo, hi + step, step))
    return bins


def _quantile_bins(series: pd.Series, q: int = 4) -> pd.Series:
    """Bin into q roughly equal-population groups; returns labelled string Series."""
    try:
        cut, bins = pd.qcut(series, q=q, retbins=True, duplicates="drop")
        labels = [f"{bins[i]:.1f}–{bins[i+1]:.1f}" for i in range(len(bins) - 1)]
        return pd.cut(series, bins=bins, labels=labels, right=True,
                      include_lowest=True).astype(str)
    except Exception:
        return series.astype(str)


def _equal_width_bins(series: pd.Series, n: int = 5) -> pd.Series:
    """Bin into n equal-width groups; returns labelled string Series."""
    try:
        cut, bins = pd.cut(series, bins=n, retbins=True)
        labels = [f"{bins[i]:.1f}–{bins[i+1]:.1f}" for i in range(len(bins) - 1)]
        return pd.cut(series, bins=bins, labels=labels, right=True,
                      include_lowest=True).astype(str)
    except Exception:
        return series.astype(str)


def _merge_small_bins(series: pd.Series, min_size: int = MIN_GROUP_SIZE) -> pd.Series:
    """
    Iteratively merge the smallest bin into its nearest neighbour until every
    remaining bin has at least `min_size` samples, or only 2 groups remain.
    Uses a simple span-range label for merged groups (e.g. '20–29').
    """
    counts = series.value_counts()
    # Don't merge if we already have 2 or fewer groups
    while counts.min() < min_size and len(counts) > 2:
        smallest = counts.idxmin()
        idx_list = list(counts.index)
        idx = idx_list.index(smallest)
        neighbour_idx = idx + 1 if idx == 0 else idx - 1
        neighbour = idx_list[neighbour_idx]
        # Build a readable merged label using the first and last parts of both labels
        # e.g. '20–24' + '25–29' → '20–29'
        def _range_start(label: str) -> str:
            return label.split('–')[0].split('/')[0].strip().replace('+', '')

        def _range_end(label: str) -> str:
            parts = label.split('–')
            val = parts[-1].split('/')[0].strip() if len(parts) > 1 else label
            return val.replace('+', '')

        start = min(_range_start(smallest), _range_start(neighbour), key=lambda x: int(x) if x.isdigit() else 0)
        end = max(_range_end(smallest), _range_end(neighbour), key=lambda x: int(x) if x.isdigit() else 0)
        if start == end or not start.isdigit():
            new_label = f"{smallest}/{neighbour}"
        else:
            new_label = f"{start}–{end}"
        series = series.replace({smallest: new_label, neighbour: new_label})
        counts = series.value_counts()
    return series


# ── Public API ────────────────────────────────────────────────────────────────

def preprocess_sensitive_column(
    df: pd.DataFrame,
    col: str,
    strategy: str = "auto",
    custom_bins: list[float] | None = None,
) -> dict[str, Any]:
    """
    Preprocess a sensitive column for fairness analysis.

    Parameters
    ----------
    df         : Full dataframe (original, before train/test split).
    col        : Column name to process.
    strategy   : One of 'auto', 'equal_width', 'quantile', 'custom', 'raw'.
    custom_bins: For strategy='custom', list of numeric bin edges.

    Returns
    -------
    dict with:
        processed_series : pd.Series  – labelled series, aligned with df.index
        column_type      : str        – 'categorical' or 'continuous'
        grouping_method  : str        – human-readable description
        bin_labels       : list[str]  – ordered group labels
        num_groups       : int
        min_group_size   : int        – smallest group count in the full df
        any_low_confidence: bool
        group_confidence : dict[str, bool]  – per-group low_confidence flag
    """
    if col not in df.columns:
        raise ValueError(f"Column '{col}' not found in dataframe.")

    series: pd.Series = df[col].copy()
    n_unique = int(series.dropna().nunique())
    is_numeric = pd.api.types.is_numeric_dtype(series)

    # ── Decide column type ────────────────────────────────────────────────────
    if is_numeric and n_unique > CATEGORICAL_LIKE_THRESHOLD and strategy != "raw":
        column_type = "continuous"
    else:
        column_type = "categorical"

    # ── Apply transformation ──────────────────────────────────────────────────
    if column_type == "categorical" or strategy == "raw":
        processed = series.astype(str).fillna("Unknown")
        grouping_method = "By category" if column_type == "categorical" else "Raw values (diagnostic only)"

    elif strategy == "equal_width":
        processed = _equal_width_bins(series.dropna().reindex(series.index), n=6)
        processed = processed.fillna("Unknown")
        grouping_method = "Equal-width bins"

    elif strategy == "quantile":
        processed = _quantile_bins(series.dropna().reindex(series.index), q=4)
        processed = processed.fillna("Unknown")
        grouping_method = "Quantile bins (equal population)"

    elif strategy == "custom" and custom_bins:
        processed = _bin_to_labels(series, custom_bins)
        processed = processed.fillna("Unknown")
        grouping_method = f"Custom bins ({len(custom_bins)-1} ranges)"

    else:
        # strategy == 'auto'
        if _is_age_like(series.dropna()):
            bins = _auto_bins_age(series.dropna())
            processed = _bin_to_labels(series.dropna().reindex(series.index), bins)
            processed = processed.fillna("Unknown")
            grouping_method = "Auto-binned into 5-year ranges"
        else:
            # General numeric → 5 quantile bins, merged if too small
            processed = _quantile_bins(series.dropna().reindex(series.index), q=5)
            processed = processed.fillna("Unknown")
            grouping_method = "Auto-binned (quantile-based)"

        # Merge tiny bins
        processed = _merge_small_bins(processed, min_size=MIN_GROUP_SIZE)

    # ── Build metadata ────────────────────────────────────────────────────────
    counts = processed.value_counts()
    bin_labels = list(counts.index)  # sorted by frequency; caller can sort differently
    group_confidence: dict[str, bool] = {
        label: int(counts.get(label, 0)) < MIN_GROUP_SIZE for label in bin_labels
    }
    any_low_confidence = any(group_confidence.values())
    min_group_size = int(counts.min()) if not counts.empty else 0

    return {
        "processed_series": processed,
        "column_type": column_type,
        "grouping_method": grouping_method,
        "bin_labels": bin_labels,
        "num_groups": len(bin_labels),
        "min_group_size": min_group_size,
        "any_low_confidence": any_low_confidence,
        "group_confidence": group_confidence,
    }
