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

from .common import MIN_SUBGROUP_SIZE, build_classifier, fit_classifier, fairness_gaps, fairness_score_from_gaps, group_metrics, disparate_impact_ratio, overfit_assessment, prepare_split, risk_from_score


def run_model_bias_analysis(
    df: pd.DataFrame,
    sensitive_cols: list[str],
    target_col: str,
    model=None,
    model_path: str | None = None,
    metric_weights: dict[str, float] | None = None,
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

    metrics = {"demographic_parity_difference": 0.0, "equal_opportunity_difference": 0.0, "fpr_gap": 0.0, "fnr_gap": 0.0}
    for sensitive in sensitive_cols:
        if sensitive not in df.columns:
            continue
        current_metrics = fairness_gaps(y_pred, prepared.y_test, df.loc[prepared.y_test.index, sensitive])
        for key, value in current_metrics.items():
            metrics[key] = max(metrics[key], value)
    fairness_score = fairness_score_from_gaps(metrics, metric_weights=metric_weights)
    risk_level = risk_from_score(fairness_score)

    group_performance: dict[str, Any] = {}
    low_confidence_subgroups: list[dict[str, Any]] = []
    for sensitive in sensitive_cols:
        if sensitive not in df.columns:
            continue
        group_series = df.loc[prepared.y_test.index, sensitive]
        gm = group_metrics(prepared.y_test, y_pred, group_series)
        group_performance[sensitive] = gm
        for group_name, stats in gm.items():
            if stats.get("low_confidence"):
                low_confidence_subgroups.append({
                    "attribute": sensitive,
                    "group": group_name,
                    "sample_size": stats.get("sample_size"),
                })

    # Disparate impact / four-fifths (80%) rule per sensitive attribute; the headline is the
    # worst (lowest) ratio across attributes — the legal ratio standard, not just the gap.
    di_by_attr: dict[str, Any] = {}
    worst_di: dict[str, Any] | None = None
    for sensitive, groups in group_performance.items():
        rates = {g: m["approval_rate"] for g, m in groups.items()}
        di = disparate_impact_ratio(rates)
        di_by_attr[sensitive] = di
        if worst_di is None or di["ratio"] < worst_di["ratio"]:
            worst_di = {**di, "attribute": sensitive}
    disparate_impact = worst_di or {"ratio": 1.0, "passes_four_fifths": True, "attribute": None}
    disparate_impact["by_attribute"] = di_by_attr

    # Fairlearn MetricFrame analysis
    fairlearn_metrics: dict[str, Any] = {}
    for sensitive in sensitive_cols:
        if sensitive not in df.columns:
            continue
        sensitive_features = df.loc[prepared.y_test.index, sensitive]
        # Cast pandas/numpy values to native Python types for JSON safety
        def _to_native(d: dict) -> dict:
            # NaN/Inf mean the metric is undefined for that group (e.g. no positives) —
            # emit None, not a fake 0.0 that reads as a real measured rate.
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

    # Compute intersectional subgroup bias (hidden bias)
    hidden_bias = []
    if len(sensitive_cols) >= 2:
        col_a, col_b = sensitive_cols[0], sensitive_cols[1]
        if col_a in df.columns and col_b in df.columns:
            df_test = df.loc[prepared.y_test.index].copy()
            df_test['_combo'] = df_test[col_a].astype(str) + ' + ' + df_test[col_b].astype(str)
            overall_rate = float(y_pred.mean())
            for combo, group_df in df_test.groupby('_combo'):
                idx = group_df.index
                if len(idx) < MIN_SUBGROUP_SIZE:
                    continue
                group_rate = float(y_pred.loc[idx].mean())
                diff = group_rate - overall_rate
                parts = str(combo).split(' + ')
                hidden_bias.append({
                    "id": str(combo),
                    "definition": str(combo),
                    "attributes": {col_a: parts[0], col_b: parts[1] if len(parts) > 1 else ''},
                    "metricDifference": f"{diff:+.0%}",
                    "metricValue": round(diff, 4),
                    "sampleSize": len(idx),
                    "metricName": "Approval Rate"
                })

    return {
        "overall_accuracy": round(overall_accuracy, 4),
        "overfit": overfit,
        "fairness_score": round(fairness_score),
        "risk_level": risk_level,
        "metrics": {key: round(value, 4) for key, value in metrics.items()},
        "group_performance": group_performance,
        "disparate_impact": disparate_impact,
        "low_confidence_subgroups": low_confidence_subgroups,
        "min_subgroup_size": MIN_SUBGROUP_SIZE,
        "fairlearn_metrics": fairlearn_metrics,
        "model_used": model_used,
        "hidden_bias": sorted(hidden_bias, key=lambda x: abs(x["metricValue"]), reverse=True)[:10]
    }
