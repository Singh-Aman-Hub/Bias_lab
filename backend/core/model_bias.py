from __future__ import annotations

from typing import Any

import joblib
import numpy as np
import pandas as pd
import sklearn.metrics
from sklearn.metrics import accuracy_score
from fairlearn.metrics import (
    MetricFrame,
    false_positive_rate,
    true_positive_rate,
)

from .common import (
    MIN_SUBGROUP_SIZE,
    build_classifier,
    fit_classifier,
    fairness_gaps,
    fairness_score_from_gaps,
    group_metrics,
    disparate_impact_ratio,
    overfit_assessment,
    prepare_split,
    risk_from_score,
)
from .sensitive_attr_processor import preprocess_sensitive_column


def run_model_bias_analysis(
    df: pd.DataFrame,
    sensitive_cols: list[str],
    target_col: str,
    model=None,
    model_path: str | None = None,
    metric_weights: dict[str, float] | None = None,
    binning_strategy: str = "auto",
    custom_bins_map: dict[str, list[float]] | None = None,
) -> dict[str, Any]:
    prepared = prepare_split(df, target_col)
    if model is not None:
        model_used = "shared_pipeline"
        # Do NOT re-fit a pre-trained model.
    elif model_path:
        model = joblib.load(model_path)
        model_used = "user_provided"
        # Do NOT refit — assume the loaded model is already trained.
    else:
        model = build_classifier(prepared.X_train)
        model = fit_classifier(model, prepared.X_train, prepared.y_train)
        model_used = "built_in_xgb"

    y_pred = pd.Series(model.predict(prepared.X_test), index=prepared.y_test.index)
    overall_accuracy = float(accuracy_score(prepared.y_test, y_pred))

    # Train-vs-test gap → overfit signal. Guarded so a mismatched user-provided model
    # never breaks the audit.
    try:
        train_pred = pd.Series(model.predict(prepared.X_train), index=prepared.y_train.index)
        train_accuracy = float(accuracy_score(prepared.y_train, train_pred))
        overfit = overfit_assessment(train_accuracy, overall_accuracy)
    except Exception:
        overfit = {"train_accuracy": None, "test_accuracy": round(overall_accuracy, 4),
                   "gap": None, "level": "unknown", "warning": None}

    # ── Preprocess sensitive columns (bin continuous ones) ────────────────────
    custom_bins_map = custom_bins_map or {}
    sensitive_attr_metadata: dict[str, Any] = {}
    processed_series_map: dict[str, pd.Series] = {}

    for sensitive in sensitive_cols:
        if sensitive not in df.columns:
            continue
        try:
            result = preprocess_sensitive_column(
                df,
                sensitive,
                strategy=binning_strategy,
                custom_bins=custom_bins_map.get(sensitive),
            )
            # Align to y_test index (test split)
            processed_series_map[sensitive] = result["processed_series"].loc[prepared.y_test.index]
            sensitive_attr_metadata[sensitive] = {
                "column_type": result["column_type"],
                "grouping_method": result["grouping_method"],
                "bin_labels": result["bin_labels"],
                "num_groups": result["num_groups"],
                "min_group_size": result["min_group_size"],
                "any_low_confidence": result["any_low_confidence"],
                "group_confidence": result["group_confidence"],
            }
        except Exception:
            # Fall back to raw values if preprocessing fails
            processed_series_map[sensitive] = df.loc[prepared.y_test.index, sensitive].astype(str)
            sensitive_attr_metadata[sensitive] = {
                "column_type": "categorical",
                "grouping_method": "By category (fallback)",
                "bin_labels": [],
                "num_groups": 0,
                "min_group_size": 0,
                "any_low_confidence": False,
                "group_confidence": {},
            }

    # ── Fairness gaps (use processed/binned series) ───────────────────────────
    metrics = {"demographic_parity_difference": 0.0, "equal_opportunity_difference": 0.0,
               "fpr_gap": 0.0, "predictive_parity_difference": 0.0}
    raw_metrics = {"demographic_parity_difference": 0.0, "equal_opportunity_difference": 0.0,
                   "fpr_gap": 0.0, "predictive_parity_difference": 0.0}

    for sensitive in sensitive_cols:
        if sensitive not in processed_series_map:
            continue
        series_clean = processed_series_map[sensitive]

        # Calculate raw gaps (all groups)
        raw_curr = fairness_gaps(y_pred, prepared.y_test, series_clean)
        for key, value in raw_curr.items():
            raw_metrics[key] = max(raw_metrics[key], value)

        # Calculate reliable gaps (exclude low confidence groups)
        meta = sensitive_attr_metadata.get(sensitive, {})
        group_confidence = meta.get("group_confidence", {})
        low_confidence_groups = [g for g, is_low in group_confidence.items() if is_low]

        mask_reliable = ~series_clean.isin(low_confidence_groups)

        # Guard: if no reliable groups remain, fall back to raw gaps
        if mask_reliable.any():
            rel_curr = fairness_gaps(
                y_pred[mask_reliable],
                prepared.y_test[mask_reliable],
                series_clean[mask_reliable]
            )
        else:
            rel_curr = raw_curr

        for key, value in rel_curr.items():
            metrics[key] = max(metrics[key], value)

    fairness_score = fairness_score_from_gaps(metrics, metric_weights=metric_weights)
    risk_level = risk_from_score(fairness_score)

    # ── Group performance (use processed/binned series) ───────────────────────
    group_performance: dict[str, Any] = {}
    low_confidence_subgroups: list[dict[str, Any]] = []
    for sensitive in sensitive_cols:
        if sensitive not in processed_series_map:
            continue
        gm = group_metrics(prepared.y_test, y_pred, processed_series_map[sensitive])
        group_performance[sensitive] = gm
        for group_name, stats in gm.items():
            if stats.get("low_confidence"):
                low_confidence_subgroups.append({
                    "attribute": sensitive,
                    "group": group_name,
                    "sample_size": stats.get("sample_size"),
                })

    # Disparate impact / four-fifths (80%) rule per sensitive attribute
    di_by_attr: dict[str, Any] = {}
    worst_di: dict[str, Any] | None = None
    for sensitive, groups in group_performance.items():
        # Exclude low confidence groups from driving disparate impact
        reliable_rates = {
            g: m["approval_rate"]
            for g, m in groups.items()
            if not m.get("low_confidence")
        }
        # Fall back if no reliable groups
        if not reliable_rates:
            reliable_rates = {g: m["approval_rate"] for g, m in groups.items()}
        di = disparate_impact_ratio(reliable_rates)
        di_by_attr[sensitive] = di
        if worst_di is None or di["ratio"] < worst_di["ratio"]:
            worst_di = {**di, "attribute": sensitive}
    disparate_impact = worst_di or {"ratio": 1.0, "passes_four_fifths": True, "attribute": None}
    disparate_impact["by_attribute"] = di_by_attr

    # ── Fairlearn MetricFrame analysis ────────────────────────────────────────
    fairlearn_metrics: dict[str, Any] = {}
    for sensitive in sensitive_cols:
        if sensitive not in processed_series_map:
            continue
        sensitive_features = processed_series_map[sensitive]

        def _to_native(d: dict) -> dict:
            clean: dict[str, float | None] = {}
            for k, v in d.items():
                try:
                    val = float(v)
                    clean[str(k)] = None if (pd.isna(val) or np.isinf(val)) else val
                except (ValueError, TypeError):
                    clean[str(k)] = None
            return clean

        try:
            mf = MetricFrame(
                metrics={
                    "accuracy": sklearn.metrics.accuracy_score,
                    "tpr": true_positive_rate,
                    "fpr": false_positive_rate,
                },
                y_true=prepared.y_test,
                y_pred=y_pred,
                sensitive_features=sensitive_features,
            )
            fairlearn_metrics[sensitive] = {
                "by_group": {metric: _to_native(vals) for metric, vals in mf.by_group.to_dict().items()},
                "overall": _to_native(mf.overall.to_dict()),
                "difference": _to_native(mf.difference().to_dict()),
            }
        except Exception:
            fairlearn_metrics[sensitive] = {
                "by_group": {},
                "overall": {},
                "difference": {},
                "error": "Fairlearn metric calculation failed due to insufficient subgroup samples."
            }

    # ── Intersectional subgroup bias (hidden bias) ────────────────────────────
    hidden_bias = []
    if len(sensitive_cols) >= 2:
        col_a, col_b = sensitive_cols[0], sensitive_cols[1]
        if col_a in processed_series_map and col_b in processed_series_map:
            ser_a = processed_series_map[col_a]
            ser_b = processed_series_map[col_b]
            combo_series = ser_a.astype(str) + " + " + ser_b.astype(str)
            overall_rate = float(y_pred.mean())
            for combo, group_idx in combo_series.groupby(combo_series).groups.items():
                if len(group_idx) < MIN_SUBGROUP_SIZE:
                    continue
                group_rate = float(y_pred.loc[group_idx].mean())
                diff = group_rate - overall_rate
                parts = str(combo).split(" + ")
                hidden_bias.append({
                    "id": str(combo),
                    "definition": str(combo),
                    "attributes": {col_a: parts[0], col_b: parts[1] if len(parts) > 1 else ""},
                    "metricDifference": f"{diff:+.0%}",
                    "metricValue": round(diff, 4),
                    "sampleSize": len(group_idx),
                    "metricName": "Approval Rate"
                })

    return {
        "overall_accuracy": round(overall_accuracy, 4),
        "overfit": overfit,
        "fairness_score": round(fairness_score),
        "risk_level": risk_level,
        "metrics": {key: round(value, 4) for key, value in metrics.items()},
        "raw_metrics": {key: round(value, 4) for key, value in raw_metrics.items()},
        "group_performance": group_performance,
        "disparate_impact": disparate_impact,
        "low_confidence_subgroups": low_confidence_subgroups,
        "min_subgroup_size": MIN_SUBGROUP_SIZE,
        "fairlearn_metrics": fairlearn_metrics,
        "model_used": model_used,
        "hidden_bias": sorted(hidden_bias, key=lambda x: abs(x["metricValue"]), reverse=True)[:10],
        "sensitive_attr_metadata": sensitive_attr_metadata,
    }
