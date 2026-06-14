from __future__ import annotations

from typing import Any

import pandas as pd

from .common import resolve_positive_label, risk_from_gap
from .sensitive_attr_processor import preprocess_sensitive_column, MIN_GROUP_SIZE


# Under-representation threshold: share of total dataset
UNDER_REP_SHARE_THRESHOLD = 0.05  # <5% of dataset


def run_data_audit(df: pd.DataFrame, sensitive_cols: list[str], target_col: str, positive_label: Any = None) -> dict[str, Any]:
    group_stats: dict[str, dict[str, Any]] = {}
    under_represented_groups: list[str] = []
    total_rows = max(len(df), 1)  # guard division by zero

    # Resolve the favorable outcome ONCE on the whole target so every group (even a group
    # with a single outcome) is scored against the same label, rather than re-guessing the
    # positive class per slice.
    pos_label = (
        resolve_positive_label(df[target_col], override=positive_label)
        if target_col in df.columns else None
    )

    def _rate(col: pd.Series) -> float:
        col = col.dropna()
        if col.empty:
            return 0.0
        if pd.api.types.is_numeric_dtype(col) and set(pd.unique(col)) <= {0, 1}:
            return float(col.mean())
        return float((col == pos_label).mean()) if pos_label is not None else 0.0

    # Column type metadata keyed by sensitive column
    column_metadata: dict[str, dict[str, Any]] = {}

    for sensitive in sensitive_cols:
        if sensitive not in df.columns:
            continue

        # Use the sensitive_attr_processor to get type-aware grouping
        try:
            proc_result = preprocess_sensitive_column(df, sensitive, strategy="auto")
            processed_series = proc_result["processed_series"]
            col_type = proc_result["column_type"]
            grouping_method = proc_result["grouping_method"]
            group_confidence = proc_result["group_confidence"]  # {label: bool (True=low conf)}
        except Exception:
            # Fallback to raw string cast if preprocessing fails
            processed_series = df[sensitive].astype(str).fillna("Unknown")
            col_type = "categorical"
            grouping_method = "Raw values"
            group_confidence = {}

        column_metadata[sensitive] = {
            "column_type": col_type,
            "grouping_method": grouping_method,
        }

        stats_for_sensitive: dict[str, Any] = {}
        counts = processed_series.value_counts(dropna=False)

        for group_value, count in counts.items():
            # Skip nan/null/unknown groups for representation reporting
            str_val = str(group_value).strip().lower()
            if str_val in ("nan", "null", "none", "unknown", ""):
                continue

            count_int = int(count)
            mask = processed_series == str(group_value)
            group_df = df[mask]

            # Positive rate
            if target_col in group_df.columns and not group_df.empty:
                group_positive_rate = _rate(group_df[target_col])
            else:
                group_positive_rate = 0.0

            missing_rate = float(group_df.isna().mean().mean()) if not group_df.empty else 0.0
            representation_ratio = count_int / total_rows

            # New under-representation rule: n<30 OR share<5%
            is_under_rep = count_int < MIN_GROUP_SIZE or representation_ratio < UNDER_REP_SHARE_THRESHOLD
            is_low_confidence = bool(group_confidence.get(str(group_value), count_int < MIN_GROUP_SIZE))

            stats_for_sensitive[str(group_value)] = {
                "count": count_int,
                "share": round(representation_ratio, 4),
                "positive_rate": round(group_positive_rate, 4),
                "missing_rate": round(missing_rate, 4),
                "under_represented": is_under_rep,
                "low_confidence": is_low_confidence,
            }
            if is_under_rep:
                under_represented_groups.append(f"{sensitive}: {group_value}")

        group_stats[sensitive] = stats_for_sensitive

    # Overall class distribution
    overall_positive_rate = 0.0
    if target_col in df.columns and not df[target_col].empty:
        overall_positive_rate = _rate(df[target_col])

    class_distribution = {
        "approved": round(overall_positive_rate, 4),
        "rejected": round(1.0 - overall_positive_rate, 4),
    }

    missing_data = {
        column: round(float(df[column].isna().mean()), 4)
        for column in df.columns
    }

    # Approval-rate gap across groups (robust to NaN / empty slices).
    # Uses the binned groups for continuous columns — consistent with model_bias.
    max_gap = 0.0
    worst_reason = "No gaps detected"

    for sensitive in sensitive_cols:
        if sensitive not in df.columns or target_col not in df.columns:
            continue
        try:
            # Use the already-processed series if available, otherwise groupby original
            if sensitive in column_metadata:
                proc_result_for_gap = preprocess_sensitive_column(df, sensitive, strategy="auto")
                binned = proc_result_for_gap["processed_series"]
                # Align with target
                aligned_target = df[target_col].reindex(binned.index)
                rates = binned.to_frame(name="group").join(aligned_target).groupby("group")[target_col].apply(_rate).dropna()
            else:
                rates = df.groupby(sensitive)[target_col].apply(_rate).dropna()

            if rates.empty:
                continue
            gap = float(rates.max() - rates.min())
            if gap > max_gap:
                max_gap = gap
                worst_reason = (
                    f"Approval rate gap between {sensitive} groups is {round(gap * 100)}%"
                )
        except Exception:
            continue

    risk_level = risk_from_gap(max_gap)

    return {
        "group_stats": group_stats,
        "column_metadata": column_metadata,
        "class_distribution": class_distribution,
        "under_represented_groups": under_represented_groups,
        "missing_data": missing_data,
        "risk_level": risk_level,
        "risk_reason": worst_reason,
        "max_gap": round(max_gap, 4),
    }
