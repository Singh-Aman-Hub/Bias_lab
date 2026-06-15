"""Counterfactual fairness testing.

For continuous sensitive attributes (e.g. Age) we group raw values into
meaningful display bins and use a representative raw numeric value when
mutating the test copy. This means the model still receives realistic
numbers while the UI shows human-readable band labels (25-34 → 35-44).

Categorical attributes continue to work exactly as before.

IMPORTANT — why a separate attribute-aware model is built here
--------------------------------------------------------------
The shared pipeline model is trained attribute-blind: the sensitive
columns are explicitly excluded from the ColumnTransformer (remainder="drop").
That means changing flipped[sensitive_col] has ZERO effect on predictions —
the column is dropped before the first tree is evaluated.

To make counterfactual testing meaningful we therefore train a lightweight
second model that INCLUDES the sensitive column.  This is only used for the
counterfactual flip test; all other audit stages still use the attribute-blind
model so disparate-treatment guarantees are preserved.
"""
from __future__ import annotations

import logging
from typing import Any

import pandas as pd
import numpy as np
from sklearn.metrics import accuracy_score

from .common import (
    build_classifier,
    fit_classifier,
    fairness_gaps,
    fairness_score_from_gaps,
    prepare_split,
)

logger = logging.getLogger(__name__)


# ── Age / continuous binning helpers ─────────────────────────────────────────

# Fixed age bands with representative raw values for model input.
AGE_BANDS: list[tuple[str, float, float, float]] = [
    # (label, low_inclusive, high_exclusive, representative_raw)
    ("18-24",  18.0, 25.0, 22.0),
    ("25-34",  25.0, 35.0, 30.0),
    ("35-44",  35.0, 45.0, 40.0),
    ("45-54",  45.0, 55.0, 50.0),
    ("55+",    55.0, 999.0, 58.0),
]

# Pairs that are "adjacent" in the age-band ordering (index-distance == 1).
_AGE_BAND_LABELS = [b[0] for b in AGE_BANDS]

_CONTINUOUS_NUNIQUE_THRESHOLD = 10


def _is_continuous(series: pd.Series) -> bool:
    try:
        pd.to_numeric(series, errors="raise")
    except (ValueError, TypeError):
        return False
    return series.nunique() > _CONTINUOUS_NUNIQUE_THRESHOLD


def _make_age_bins(series: pd.Series) -> list[dict[str, Any]]:
    bins = []
    for label, lo, hi, rep in AGE_BANDS:
        members = series[(series >= lo) & (series < hi)]
        if not members.empty:
            bins.append({
                "label": label,
                "lo": lo,
                "hi": hi,
                "representative": rep,
                "index": members.index,
                "band_index": _AGE_BAND_LABELS.index(label),
            })
    return bins


def _make_generic_bins(series: pd.Series, n_bins: int = 5) -> list[dict[str, Any]]:
    lo_val = float(series.min())
    hi_val = float(series.max())
    if lo_val == hi_val:
        return [{
            "label": str(lo_val), "lo": lo_val, "hi": hi_val + 1,
            "representative": lo_val, "index": series.index, "band_index": 0,
        }]
    step = (hi_val - lo_val) / n_bins
    bins = []
    for i in range(n_bins):
        lo = lo_val + i * step
        hi = lo_val + (i + 1) * step if i < n_bins - 1 else hi_val + 1
        label = f"{lo:.0f}-{hi:.0f}"
        members = series[(series >= lo) & (series < hi)]
        if not members.empty:
            bins.append({
                "label": label,
                "lo": lo,
                "hi": hi,
                "representative": float((lo + hi) / 2),
                "index": members.index,
                "band_index": i,
            })
    return bins


def _classify_risk(flip_rate: float) -> str:
    if flip_rate >= 0.10:
        return "high"
    if flip_rate >= 0.03:
        return "medium"
    return "low"


def _is_adjacent(from_bin: dict, to_bin: dict) -> bool:
    """True if these two bins are exactly 1 step apart in the ordered band list."""
    return abs(from_bin.get("band_index", -99) - to_bin.get("band_index", -99)) == 1


# ── Main entry point ─────────────────────────────────────────────────────────

def run_counterfactual_test(
    df: pd.DataFrame,
    model,
    sensitive_col: str,
    target_col: str,
    metric_weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    warnings_list: list[str] = []

    prepared = prepare_split(df, target_col)

    if model is None:
        try:
            cf_pipeline = build_classifier(prepared.X_train, exclude_cols=None)
            cf_pipeline = fit_classifier(cf_pipeline, prepared.X_train, prepared.y_train)
        except Exception as exc:
            warnings_list.append(f"Failed to build model: {exc}")
            cf_pipeline = None
    else:
        cf_pipeline = model

    if cf_pipeline is None:
        warnings_list.append("No model available for counterfactual testing.")
        return _empty_result(
            sensitive_col=sensitive_col,
            baseline_score=0,
            baseline_accuracy=0.0,
            warnings=warnings_list,
        )

    # ── Baseline metrics (on the original shared model for consistency) ──────
    try:
        y_pred_base = pd.Series(
            cf_pipeline.predict(prepared.X_test), index=prepared.y_test.index
        )
    except Exception as exc:
        warnings_list.append(f"Baseline prediction failed: {exc}.")
        y_pred_base = pd.Series([0] * len(prepared.y_test), index=prepared.y_test.index)

    baseline_accuracy = float(accuracy_score(prepared.y_test, y_pred_base))
    baseline_gaps = (
        fairness_gaps(y_pred_base, prepared.y_test, df.loc[prepared.y_test.index, sensitive_col])
        if sensitive_col in df.columns
        else {"demographic_parity_difference": 0.0, "equal_opportunity_difference": 0.0, "fpr_gap": 0.0}
    )
    baseline_score = fairness_score_from_gaps(baseline_gaps, metric_weights=metric_weights)

    # ── Determine binning strategy ────────────────────────────────────────────
    col_in_X = sensitive_col in prepared.X_test.columns
    raw_series = prepared.X_test[sensitive_col].dropna() if col_in_X else pd.Series(dtype=float)

    was_binned = False
    binning_strategy = "categorical"
    bins: list[dict[str, Any]] = []

    if col_in_X and _is_continuous(raw_series):
        was_binned = True
        col_lower = sensitive_col.lower()
        if any(kw in col_lower for kw in ("age", "yr", "year")):
            numeric_series = pd.to_numeric(raw_series, errors="coerce").dropna()
            bins = _make_age_bins(numeric_series)
            binning_strategy = "age_bands"
        else:
            numeric_series = pd.to_numeric(raw_series, errors="coerce").dropna()
            bins = _make_generic_bins(numeric_series)
            binning_strategy = "equal_width"
        if not bins:
            warnings_list.append(
                "Continuous sensitive attribute was tested using raw values. Binned testing is recommended."
            )
            was_binned = False
    elif col_in_X:
        unique_vals = list(prepared.X_test[sensitive_col].dropna().astype(str).unique())
        for idx_v, v in enumerate(unique_vals):
            idx = prepared.X_test[prepared.X_test[sensitive_col].astype(str) == v].index
            bins.append({"label": v, "lo": None, "hi": None, "representative": v, "index": idx, "band_index": idx_v})
    else:
        warnings_list.append(
            f"Sensitive column '{sensitive_col}' not found in model features. "
            "Counterfactual test skipped. (This is expected when exclude_sensitive=True "
            "prevents the sensitive column from being used as a model feature.)"
        )

    if not bins:
        if not warnings_list:
            warnings_list.append("No records were available for counterfactual testing.")
        return _empty_result(
            sensitive_col=sensitive_col,
            baseline_score=round(baseline_score),
            baseline_accuracy=round(baseline_accuracy, 4),
            warnings=warnings_list,
        )

    logger.info(
        "Counterfactual [%s]: %d bins found (%s), binning=%s",
        sensitive_col, len(bins), [b["label"] for b in bins], binning_strategy,
    )

    # ── Per-bin-pair loop ──────────────────────────────────────────────────
    flip_breakdown_legacy: dict[str, dict[str, float]] = {}
    breakdown: list[dict[str, Any]] = []
    sample_flips: list[dict[str, Any]] = []
    total_flips = 0
    total_records = 0
    _debug_logged = 0  # how many sample rows we've debug-logged

    for from_bin in bins:
        from_label = from_bin["label"]
        from_idx = from_bin["index"]
        from_rep = from_bin["representative"]

        subset = prepared.X_test.loc[from_idx].copy() if len(from_idx) > 0 else pd.DataFrame()
        if subset.empty:
            continue

        for to_bin in bins:
            to_label = to_bin["label"]
            if from_label == to_label:
                continue

            to_rep = to_bin["representative"]

            flipped = subset.copy()
            if was_binned:
                flipped[sensitive_col] = float(to_rep) if isinstance(to_rep, (int, float)) else to_rep
            else:
                flipped[sensitive_col] = to_rep

            # Verify the column was actually mutated (paranoia check).
            actual_val = flipped[sensitive_col].iloc[0] if not flipped.empty else None
            if was_binned and actual_val != float(to_rep):
                logger.warning(
                    "Counterfactual: flipped[%s] mutation failed! Expected %s, got %s",
                    sensitive_col, float(to_rep), actual_val,
                )

            try:
                original_pred = cf_pipeline.predict(subset)
                flipped_pred = cf_pipeline.predict(flipped)
            except Exception as exc:
                warnings_list.append(f"Prediction failed for {from_label}→{to_label}: {exc}")
                logger.exception("Counterfactual prediction error: %s→%s", from_label, to_label)
                continue

            flip_mask = original_pred != flipped_pred
            flips = int(flip_mask.sum())
            tested = int(len(subset))
            total_flips += flips
            total_records += tested
            adjacent = _is_adjacent(from_bin, to_bin)
            pair_rate = round(flips / max(tested, 1), 4)

            # ── Debug logging — first 3 rows of each pair ──────────────────
            if _debug_logged < 30:
                for pos in range(min(3, tested)):
                    real_idx = subset.index[pos]
                    orig_raw = float(subset[sensitive_col].iloc[pos]) if was_binned else str(subset[sensitive_col].iloc[pos])
                    logger.info(
                        "Counterfactual debug: record_id=%s attribute=%s "
                        "from_group=%s to_group=%s "
                        "original_raw_value=%s flipped_raw_value=%s "
                        "original_prediction=%s flipped_prediction=%s changed=%s",
                        int(real_idx), sensitive_col,
                        from_label, to_label,
                        orig_raw, float(to_rep) if was_binned else to_rep,
                        int(original_pred[pos]), int(flipped_pred[pos]),
                        bool(flip_mask[pos]),
                    )
                    _debug_logged += 1

            legacy_key = f"{from_label}_to_{to_label}"
            flip_breakdown_legacy[legacy_key] = {"flips": flips, "total": tested, "rate": pair_rate}

            breakdown.append({
                "from_group": from_label,
                "to_group": to_label,
                "tested": tested,
                "flips": flips,
                "flip_rate": pair_rate,
                "adjacent": adjacent,
            })

            if flips > 0 and len(sample_flips) < 5:
                flip_positions = np.where(flip_mask)[0]
                for pos in flip_positions[:max(1, 5 - len(sample_flips))]:
                    real_idx = subset.index[pos]
                    orig_raw = float(subset[sensitive_col].iloc[pos]) if was_binned else str(subset[sensitive_col].iloc[pos])
                    flip_raw = float(to_rep) if was_binned else str(to_rep)
                    orig_pred_label = "approved" if int(original_pred[pos]) == 1 else "rejected"
                    flip_pred_label = "approved" if int(flipped_pred[pos]) == 1 else "rejected"
                    sample_flips.append({
                        "record_id": int(real_idx),
                        "original_value": from_label,
                        "flipped_value": to_label,
                        "original_raw_value": orig_raw,
                        "flipped_raw_value": flip_raw,
                        "original_prediction": orig_pred_label,
                        "flipped_prediction": flip_pred_label,
                        "original_decision": orig_pred_label,
                        "flipped_decision": flip_pred_label,
                        "changed": True,
                    })

    logger.info(
        "Counterfactual [%s]: total_flips=%d total_records=%d flip_rate=%.4f",
        sensitive_col, total_flips, total_records,
        total_flips / max(total_records, 1) if total_records else 0.0,
    )

    if total_records == 0:
        warnings_list.append("No records were available for counterfactual testing.")

    if sample_flips and total_flips == 0:
        warnings_list.append(
            "Inconsistent counterfactual output: sample flips exist but total_flips is zero."
        )

    flip_rate = float(total_flips / max(total_records, 1)) if total_records else 0.0
    counterfactual_fairness_score = round(100 * (1 - flip_rate))
    risk_level = _classify_risk(flip_rate)

    # Sort: adjacent pairs first (ordered), then non-adjacent by flip_rate desc.
    adjacent_rows = sorted(
        [r for r in breakdown if r.get("adjacent")],
        key=lambda r: r.get("band_index_from", 0),
    )
    non_adjacent_rows = sorted(
        [r for r in breakdown if not r.get("adjacent")],
        key=lambda r: r["flip_rate"],
        reverse=True,
    )
    breakdown_sorted = adjacent_rows + non_adjacent_rows

    if flip_rate == 0.0 and total_records > 0:
        interp = (
            f"The model found no decision flips out of {total_records} tested records "
            f"when changing {sensitive_col} bands. "
            f"A 0% flip rate means this test did not observe prediction changes after changing "
            f"{sensitive_col} bands. This does not prove the full model is unbiased; it only "
            f"means the current counterfactual test did not detect direct decision sensitivity "
            f"to {sensitive_col}. Consider whether the attribute influences predictions indirectly "
            f"through correlated proxy features."
        )
    else:
        interp = (
            f"In {round(flip_rate * 100, 1)}% of cases, changing {sensitive_col} alone flips "
            f"the model decision — indicating the model is "
            f"{'not ' if flip_rate > 0.03 else ''}counterfactually fair "
            f"with respect to {sensitive_col}."
        )

    return {
        # ── New enriched fields ─────────────────────────────
        "attribute_tested": sensitive_col,
        "was_binned": was_binned,
        "binning_strategy": binning_strategy,
        "total_records_tested": total_records,
        "total_flips": total_flips,
        "risk_level": risk_level,
        "warnings": warnings_list,
        "breakdown": breakdown_sorted,
        # ── Legacy fields (preserved for backward compat) ───
        "sensitive_col": sensitive_col,
        "flip_rate": round(flip_rate, 4),
        "counterfactual_fairness_score": counterfactual_fairness_score,
        "flip_breakdown": flip_breakdown_legacy,
        "sample_flips": sample_flips,
        "interpretation": interp,
        "baseline": {"fairness_score": round(baseline_score), "accuracy": round(baseline_accuracy, 4)},
    }


def _empty_result(
    sensitive_col: str,
    baseline_score: float,
    baseline_accuracy: float,
    warnings: list[str],
) -> dict[str, Any]:
    return {
        "attribute_tested": sensitive_col,
        "was_binned": False,
        "binning_strategy": "none",
        "total_records_tested": 0,
        "total_flips": 0,
        "risk_level": "unknown",
        "warnings": warnings,
        "breakdown": [],
        "sensitive_col": sensitive_col,
        "flip_rate": 0.0,
        "counterfactual_fairness_score": 0,
        "flip_breakdown": {},
        "sample_flips": [],
        "interpretation": "Counterfactual test could not be completed. See warnings.",
        "baseline": {"fairness_score": baseline_score, "accuracy": baseline_accuracy},
    }
