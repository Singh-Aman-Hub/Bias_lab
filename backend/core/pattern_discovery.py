import pandas as pd
from typing import Any

def _get_confidence_label(count: int) -> str:
    """Return a confidence label based on subgroup sample size (plan item 9)."""
    if count >= 100:
        return "High confidence"
    elif count >= 30:
        return "Medium confidence"
    elif count >= 10:
        return "Low confidence"
    else:
        return "Insufficient sample size"


def discover_intersectional_patterns(df: pd.DataFrame, sensitive_cols: list[str], target_col: str, positive_label: Any) -> list[dict[str, Any]]:
    """Discover intersectional subgroups with high disparity compared to the overall population."""
    if not sensitive_cols or target_col not in df.columns:
        return []

    # Filter out missing target values
    valid_df = df.dropna(subset=[target_col])
    if len(valid_df) == 0:
        return []

    # Binarize target
    try:
        if isinstance(positive_label, (int, float)):
            target_binary = (valid_df[target_col] == positive_label).astype(int)
        else:
            target_binary = (valid_df[target_col].astype(str) == str(positive_label)).astype(int)
    except Exception:
        return []

    overall_positive_rate = target_binary.mean()
    overall_count = len(valid_df)
    
    patterns = []
    
    # We will look at pairs of sensitive columns if there are multiple
    # and single sensitive columns.
    
    # 1. Single attribute patterns
    for col in sensitive_cols:
        if col not in valid_df.columns:
            continue
        grouped = target_binary.groupby(valid_df[col].fillna("Unknown").astype(str))
        for name, group in grouped:
            count = len(group)
            if count < 10:  # Skip very small groups
                continue
            rate = group.mean()
            disparity = overall_positive_rate - rate
            
            # If the group has a lower positive rate than the overall
            if disparity > 0.05:
                patterns.append({
                    "pattern": {col: name},
                    "description": f"{col} = {name}",
                    "affected_records": count,
                    "positive_rate": float(rate),
                    "overall_positive_rate": float(overall_positive_rate),
                    "disparity": float(disparity),
                    "confidence": _get_confidence_label(count)
                })

    # 2. Intersectional pairs
    if len(sensitive_cols) >= 2:
        for i in range(len(sensitive_cols)):
            for j in range(i + 1, len(sensitive_cols)):
                col1, col2 = sensitive_cols[i], sensitive_cols[j]
                if col1 not in valid_df.columns or col2 not in valid_df.columns:
                    continue
                
                # Group by both
                grouped = target_binary.groupby([valid_df[col1].fillna("Unknown").astype(str), valid_df[col2].fillna("Unknown").astype(str)])
                for (name1, name2), group in grouped:
                    count = len(group)
                    if count < 10:
                        continue
                    rate = group.mean()
                    disparity = overall_positive_rate - rate
                    
                    if disparity > 0.08:  # Slightly higher threshold for intersections
                        patterns.append({
                            "pattern": {col1: name1, col2: name2},
                            "description": f"{col1} = {name1} AND {col2} = {name2}",
                            "affected_records": count,
                            "positive_rate": float(rate),
                            "overall_positive_rate": float(overall_positive_rate),
                            "disparity": float(disparity),
                            "confidence": _get_confidence_label(count)
                        })

    # Sort patterns by disparity (highest first)
    patterns.sort(key=lambda x: x["disparity"], reverse=True)
    
    # Return top 10 most disparaged patterns
    return patterns[:10]
