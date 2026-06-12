from __future__ import annotations

from typing import Any

import pandas as pd

from .common import resolve_positive_label, risk_from_gap


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

    for sensitive in sensitive_cols:
        if sensitive not in df.columns:
            continue
        stats_for_sensitive: dict[str, Any] = {}
        counts = df[sensitive].value_counts(dropna=False)

        for group_value, count in counts.items():
            # Skip nan/null groups for under-representation reporting
            if pd.isna(group_value) or str(group_value).lower() == "nan":
                continue
                
            count_int = int(count)
            mask = df[sensitive].astype(str) == str(group_value)
            group_df = df[mask]

            # Guard: positive rate safe even when target_col missing or group empty
            if target_col in group_df.columns and not group_df.empty:
                group_positive_rate = _rate(group_df[target_col])
            else:
                group_positive_rate = 0.0

            missing_rate = float(group_df.isna().mean().mean()) if not group_df.empty else 0.0
            representation_ratio = count_int / total_rows  # total_rows >= 1, safe

            stats_for_sensitive[str(group_value)] = {
                "count": count_int,
                "positive_rate": round(group_positive_rate, 4),
                "missing_rate": round(missing_rate, 4),
                "under_represented": bool(representation_ratio < 0.2),
            }
            if representation_ratio < 0.2:
                under_represented_groups.append(str(group_value))


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

    # Approval-rate gap across groups (robust to NaN / empty slices). Reuses the _rate
    # helper defined above, which scores against the once-resolved favorable label.
    max_gap = 0.0
    worst_reason = "No gaps detected"

    for sensitive in sensitive_cols:
        if sensitive not in df.columns or target_col not in df.columns:
            continue
        try:
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
        "class_distribution": class_distribution,
        "under_represented_groups": under_represented_groups,
        "missing_data": missing_data,
        "risk_level": risk_level,
        "risk_reason": worst_reason,
        "max_gap": round(max_gap, 4),
    }
