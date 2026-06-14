"""Explainability engine.

Uses SHAP TreeExplainer when the model supports it, automatically
falls back to SHAP KernelExplainer for SVMs, Logistic Regression,
or any non-tree model loaded via joblib.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .common import build_classifier, fit_classifier, prepare_split
from .feature_intelligence import detect_proxy_features


def _get_shap_values(model, X_background: pd.DataFrame, X_explain: pd.DataFrame) -> np.ndarray | None:
    """Try TreeExplainer first; fall back to KernelExplainer for non-tree models."""
    try:
        import shap  # type: ignore
    except ImportError:
        return None

    # Try TreeExplainer (works for RF, XGBoost, LightGBM, ExtraTrees, etc.)
    try:
        # Extract the actual estimator if inside a sklearn Pipeline
        estimator = model
        if hasattr(model, "named_steps"):
            estimator = model.named_steps.get("model", model)

        explainer = shap.TreeExplainer(estimator)
        # Transform features through pipeline preprocessor if present
        X_transformed = (
            model.named_steps["preprocessor"].transform(X_explain)
            if hasattr(model, "named_steps") and "preprocessor" in model.named_steps
            else X_explain.to_numpy()
        )
        sv = explainer.shap_values(X_transformed)
        # Binary classifiers return [class0, class1]; take class1
        if isinstance(sv, list) and len(sv) == 2:
            return sv[1]
        return sv
    except Exception:
        pass

    # KernelExplainer fallback (model-agnostic, slower)
    try:
        import shap  # type: ignore

        # Separate the preprocessor from the final estimator so that
        # predict_fn receives pre-transformed numpy arrays (what KernelExplainer
        # passes) instead of raw DataFrames with named columns.
        has_preprocessor = hasattr(model, "named_steps") and "preprocessor" in model.named_steps
        model_step = (
            model.named_steps.get("model", model)
            if hasattr(model, "named_steps")
            else model
        )

        X_bg_np = (
            model.named_steps["preprocessor"].transform(X_background)
            if has_preprocessor
            else X_background.to_numpy()
        )
        X_ex_np = (
            model.named_steps["preprocessor"].transform(X_explain)
            if has_preprocessor
            else X_explain.to_numpy()
        )

        # Ensure at least 1 background sample (guard for tiny datasets)
        n_bg = max(1, min(50, len(X_bg_np)))
        bg_sample = shap.sample(X_bg_np, n_bg)

        # predict_fn works on pre-transformed numpy arrays → use model_step only
        def predict_fn(data: np.ndarray) -> np.ndarray:
            if hasattr(model_step, "predict_proba"):
                return model_step.predict_proba(data)[:, 1]
            return model_step.predict(data).astype(float)

        explainer = shap.KernelExplainer(predict_fn, bg_sample)
        return explainer.shap_values(X_ex_np, nsamples=100)
    except Exception:
        return None


def explain_flagged_decisions(
    df: pd.DataFrame,
    model,
    sensitive_cols: list[str],
    target_col: str,
    n_samples: int = 15,
    return_all: bool = False,
) -> list[dict[str, Any]]:
    prepared = prepare_split(df, target_col)
    proxy_result = detect_proxy_features(df, sensitive_cols)
    proxy_features = {item["feature"] for item in proxy_result.get("proxy_features", [])}

    pipeline = model if model is not None else _build_default(prepared)

    limit_to_find = len(prepared.X_test) if return_all else n_samples
    # Limit test set to at most 300 to keep KernelExplainer fast for large datasets
    sample_limit = min(len(prepared.X_test), 300) if return_all else min(len(prepared.X_test), max(n_samples * 2, 40))
    test_features = prepared.X_test.iloc[:sample_limit].copy()
    predictions = pd.Series(pipeline.predict(test_features), index=test_features.index)
    
    probs = None
    if hasattr(pipeline, "predict_proba"):
        try:
            probs = pipeline.predict_proba(test_features)[:, 1]
        except Exception:
            pass

    # Pre-calculate binned sensitive group mappings
    from core.sensitive_attr_processor import preprocess_sensitive_column
    binned_series = {}
    for col in sensitive_cols:
        try:
            proc_res = preprocess_sensitive_column(df, col, strategy="auto")
            binned_series[col] = proc_res["processed_series"]
        except Exception:
            binned_series[col] = df[col].astype(str)

    flagged: list[dict[str, Any]] = []

    # ── Attempt SHAP ─────────────────────────────────────────────────────────
    shap_values = _get_shap_values(pipeline, prepared.X_train, test_features)

    # ── Feature importance fallback via pipeline internals ────────────────────
    feature_scores: dict[str, float] = {}
    model_step = (
        pipeline.named_steps.get("model")
        if hasattr(pipeline, "named_steps")
        else pipeline
    )
    if hasattr(pipeline, "named_steps") and "preprocessor" in pipeline.named_steps:
        try:
            feature_names = pipeline.named_steps["preprocessor"].get_feature_names_out()
            if hasattr(model_step, "feature_importances_"):
                importances = model_step.feature_importances_
                feature_scores = {
                    str(name): float(score)
                    for name, score in zip(feature_names, importances)
                }
            elif hasattr(model_step, "coef_"):
                coefs = np.abs(model_step.coef_)
                coefs = coefs[0] if getattr(coefs, "ndim", 1) > 1 else coefs
                feature_scores = {
                    str(name): float(score)
                    for name, score in zip(feature_names, coefs)
                }
        except Exception:
            pass

    ranked_features = sorted(feature_scores.items(), key=lambda x: x[1], reverse=True)[:3]

    def _record_id(value: Any) -> int | str:
        try:
            return int(value)
        except Exception:
            return str(value)

    def _build_reasons(row_pos: int, row: pd.Series) -> list[dict[str, Any]]:
        # Prefer per-record SHAP values
        if shap_values is not None:
            try:
                row_sv = np.asarray(shap_values)[row_pos]
                col_names = list(test_features.columns)
                n = min(len(col_names), len(row_sv))
                pairs = sorted(
                    zip(col_names[:n], row_sv[:n].tolist()),
                    key=lambda x: abs(x[1]),
                    reverse=True,
                )[:3]
                return [
                    {
                        "feature": str(name),
                        "shap_value": round(float(val), 4),
                        "is_proxy_risk": name in proxy_features,
                    }
                    for name, val in pairs
                ]
            except Exception:
                pass

        numeric_row = pd.to_numeric(row, errors='coerce').dropna()
        local_reasons: list[tuple[str, float]] = []
        for feature_name, feature_value in numeric_row.items():
            if feature_name not in prepared.X_train.columns:
                continue
            train_col = pd.to_numeric(prepared.X_train[feature_name], errors='coerce').dropna()
            if train_col.empty:
                continue
            center = float(train_col.median())
            spread = float(train_col.std())
            if spread <= 1e-8:
                continue
            score = abs((float(feature_value) - center) / spread)
            if score == score:
                local_reasons.append((str(feature_name), float(score)))

        if local_reasons:
            return [
                {
                    'feature': feature,
                    'shap_value': round(score, 4),
                    'is_proxy_risk': feature in proxy_features,
                }
                for feature, score in sorted(local_reasons, key=lambda x: x[1], reverse=True)[:3]
            ]

        if ranked_features:
            return [
                {
                    "feature": fname.split("__")[-1],
                    "shap_value": round(score, 4),
                    "is_proxy_risk": fname.split("__")[-1] in proxy_features,
                }
                for fname, score in ranked_features
            ]

        return [
            {
                "feature": fname,
                "shap_value": 0.0,
                "is_proxy_risk": fname in proxy_features,
            }
            for fname in list(test_features.columns)[:3]
        ]

    # Helper to build signature properties for a record
    def _build_record_details(row_idx, row_pos, row, orig_pred, top_reasons, explanation, exp_type):
        score_val = 0.5
        if probs is not None:
            try:
                score_val = float(probs[row_pos])
            except Exception:
                pass
        
        is_near_boundary = (0.35 <= score_val <= 0.65)
        
        group_parts = []
        for col in sensitive_cols:
            if col in df.columns:
                try:
                    val = binned_series[col].loc[row_idx]
                    group_parts.append(f"{col} {val}")
                except Exception:
                    group_parts.append(f"{col} {row[col]}")
        sensitive_group_bin = " + ".join(group_parts) if group_parts else "None"
        
        is_cf_sensitive = False
        for col in sensitive_cols:
            if col in test_features.columns:
                unique_vals = df[col].dropna().unique()
                for alt_val in unique_vals:
                    if alt_val == row[col]:
                        continue
                    perturbed_row = row.copy()
                    perturbed_row[col] = alt_val
                    perturbed_df = pd.DataFrame([perturbed_row])
                    try:
                        pert_pred = pipeline.predict(perturbed_df)[0]
                        if pert_pred != orig_pred:
                            is_cf_sensitive = True
                            break
                    except Exception:
                        pass
            if is_cf_sensitive:
                break
                
        actual_val = None
        is_misclassified = False
        if target_col in df.columns:
            try:
                actual_val = df.loc[row_idx, target_col]
                actual_str = "approved" if int(actual_val) == 1 else "rejected"
                pred_str = "approved" if int(orig_pred) == 1 else "rejected"
                is_misclassified = (actual_str != pred_str)
            except Exception:
                pass

        return {
            "record_id": _record_id(row_idx),
            "decision": "approved" if int(orig_pred) == 1 else "rejected",
            "sensitive_attribute": ", ".join(
                f"{col}={row[col]}" for col in sensitive_cols if col in row.index
            ),
            "top_reasons": top_reasons,
            "human_explanation": explanation,
            "explanation_type": exp_type,
            "score": score_val,
            "sensitive_group_bin": sensitive_group_bin,
            "is_near_boundary": is_near_boundary,
            "is_cf_sensitive": is_cf_sensitive,
            "is_misclassified": is_misclassified,
            "actual_val": actual_val,
        }

    # Pre-extract contrastive info
    other_rows = test_features.copy()
    diffs = other_rows.drop(
        columns=[col for col in sensitive_cols if col in other_rows.columns],
        errors="ignore",
    )
    numeric_columns = diffs.select_dtypes(include=[np.number]).columns

    # Loop through all test set features
    for row_pos in range(len(test_features)):
        row = test_features.iloc[row_pos]
        row_idx = test_features.index[row_pos]
        orig_pred = predictions.loc[row_idx]
        
        top_reasons = _build_reasons(row_pos, row)
        has_proxy = any(r["is_proxy_risk"] for r in top_reasons)
        
        # 1. Near boundary
        score_val = 0.5
        if probs is not None:
            try:
                score_val = float(probs[row_pos])
            except Exception:
                pass
        is_near_boundary = (0.35 <= score_val <= 0.65)
        
        # 2. Counterfactual flip
        is_cf_sensitive = False
        for col in sensitive_cols:
            if col in test_features.columns:
                unique_vals = df[col].dropna().unique()
                for alt_val in unique_vals:
                    if alt_val == row[col]:
                        continue
                    perturbed_row = row.copy()
                    perturbed_row[col] = alt_val
                    perturbed_df = pd.DataFrame([perturbed_row])
                    try:
                        pert_pred = pipeline.predict(perturbed_df)[0]
                        if pert_pred != orig_pred:
                            is_cf_sensitive = True
                            break
                    except Exception:
                        pass
            if is_cf_sensitive:
                break
                
        # 3. Misclassification
        actual_val = None
        is_misclassified = False
        if target_col in df.columns:
            try:
                actual_val = df.loc[row_idx, target_col]
                actual_str = "approved" if int(actual_val) == 1 else "rejected"
                pred_str = "approved" if int(orig_pred) == 1 else "rejected"
                is_misclassified = (actual_str != pred_str)
            except Exception:
                pass
                
        # 4. Contrastive
        is_contrastive = False
        if not diffs.empty and len(numeric_columns) > 0:
            distances = diffs[numeric_columns].sub(row[numeric_columns], axis=1).pow(2).sum(axis=1)
            distances = distances.drop(index=row_idx, errors="ignore")
            if not distances.empty:
                nearest = distances.idxmin()
                if predictions.loc[row_idx] != predictions.loc[nearest]:
                    is_contrastive = True

        # Check if this record meets any bias/risk conditions to flag it
        is_flagged = is_near_boundary or is_cf_sensitive or is_misclassified or is_contrastive or has_proxy
        
        if return_all:
            if is_flagged:
                exp_type = "contrastive" if is_contrastive else "individual"
                explanation = (
                    "This decision differs from a very similar record; proxy features may be influencing the result."
                    if is_contrastive and has_proxy
                    else "The model treats this near-identical case differently, indicating potential bias or threshold sensitivity."
                    if is_contrastive
                    else "No near-identical contrasting case found. Showing top influential features for this individual decision."
                )
                flagged.append(_build_record_details(
                    row_idx, row_pos, row, orig_pred, top_reasons, explanation, exp_type
                ))
        else:
            # Traditional n_samples collection logic
            if is_contrastive:
                explanation = (
                    "This decision differs from a very similar record; proxy features may be influencing the result."
                    if has_proxy
                    else "The model treats this near-identical case differently, indicating potential bias or threshold sensitivity."
                )
                flagged.append(_build_record_details(
                    row_idx, row_pos, row, orig_pred, top_reasons, explanation, "contrastive"
                ))
            if len(flagged) >= limit_to_find:
                break

    # If not returning all and we have no contrastive cases, fall back to individual records
    if not return_all and not flagged:
        for row_pos in range(min(len(test_features), limit_to_find)):
            row = test_features.iloc[row_pos]
            row_idx = test_features.index[row_pos]
            top_reasons = _build_reasons(row_pos, row)
            explanation = (
                "No near-identical contrasting case found. "
                "Showing top influential features for this individual decision."
            )
            flagged.append(_build_record_details(
                row_idx, row_pos, row, predictions.loc[row_idx], top_reasons, explanation, "individual"
            ))

    return flagged


def group_into_patterns(flagged: list[dict]) -> list[dict]:
    """Group flagged records into recurring decision patterns based on a multi-attribute signature."""
    from collections import defaultdict, Counter

    # Group records by broad signature: (risk_type, top_driver, is_proxy)
    buckets = defaultdict(list)
    
    for record in flagged:
        reasons = record.get("top_reasons") or []
        if not reasons:
            top_driver = "unknown"
            is_proxy = False
        else:
            # Prefer proxy-risk feature as driver if any; else just the top one
            proxy_reasons = [r for r in reasons if r.get("is_proxy_risk")]
            top = proxy_reasons[0] if proxy_reasons else reasons[0]
            top_driver = top.get("feature", "unknown")
            is_proxy = bool(top.get("is_proxy_risk", False))
            
        # Determine risk type
        if is_proxy:
            risk_type = "proxy_risk"
        elif record.get("is_near_boundary", False):
            risk_type = "near_boundary"
        elif record.get("is_cf_sensitive", False):
            risk_type = "counterfactual_sensitive"
        elif record.get("is_misclassified", False):
            risk_type = "misclassification"
        else:
            risk_type = "general"
            
        buckets[(risk_type, top_driver, is_proxy)].append(record)

    patterns = []
    pattern_index = 1
    
    for (risk_type, top_driver, is_proxy), records in buckets.items():
        count = len(records)
        
        # Decision type: approved, rejected, mixed
        decisions = [r.get("decision", "unknown") for r in records]
        decision_counts = Counter(decisions)
        dominant = decision_counts.most_common(1)[0][0]
        decision_type = dominant if len(decision_counts) == 1 else "mixed"
        
        # Risk level: high, medium, low
        if is_proxy:
            risk_level = "high"
        elif risk_type in ("near_boundary", "counterfactual_sensitive"):
            risk_level = "medium"
        else:
            risk_level = "low"
            
        # Confidence level
        if count >= 3:
            confidence = "high"
        elif count == 2:
            confidence = "moderate"
        else:
            confidence = "low"
            
        # Sensitive groups involved
        sens_groups = [r.get("sensitive_group_bin", "None") for r in records]
        unique_groups = sorted(list(set(sens_groups)))
        sensitive_group_str = " + ".join(unique_groups)
        
        # Counterfactual flip rate
        cf_count = sum(1 for r in records if r.get("is_cf_sensitive", False))
        cf_flip_rate = round(cf_count / count, 4)
        
        # Top SHAP drivers averaged across all records in this pattern
        feature_shaps = defaultdict(list)
        for r in records:
            for reason in r.get("top_reasons") or []:
                feat = reason.get("feature")
                val = reason.get("shap_value", 0.0)
                feature_shaps[feat].append(val)
                
        top_drivers_list = []
        for feat, vals in feature_shaps.items():
            avg_val = sum(vals) / len(vals)
            direction = "increased approval" if avg_val >= 0 else "reduced approval"
            top_drivers_list.append({
                "feature": feat,
                "avg_shap": round(avg_val, 4),
                "direction": direction
            })
            
        # Sort drivers by absolute avg_shap descending
        top_drivers_list.sort(key=lambda d: abs(d["avg_shap"]), reverse=True)
        top_drivers_list = top_drivers_list[:3]
        
        # Choose representative records (1 to 3)
        representative_records = []
        def _rep_score(rec):
            for r in (rec.get("top_reasons") or []):
                if r.get("feature") == top_driver:
                    return abs(r.get("shap_value", 0.0))
            return 0.0
            
        sorted_records = sorted(records, key=_rep_score, reverse=True)
        for rec in sorted_records[:3]:
            actual_val = rec.get("actual_val")
            actual_outcome = None
            if actual_val is not None:
                actual_outcome = "approved" if int(actual_val) == 1 else "rejected"
                
            representative_records.append({
                "record_id": rec.get("record_id"),
                "prediction": rec.get("decision"),
                "actual": actual_outcome,
                "score": round(rec.get("score", 0.5), 4),
                "sensitive_group": rec.get("sensitive_group_bin", "None"),
                "top_shap": [
                    {"feature": tr.get("feature"), "value": round(tr.get("shap_value", 0.0), 4)}
                    for tr in (rec.get("top_reasons") or [])
                ],
                "counterfactual_sensitive": rec.get("is_cf_sensitive", False)
            })

        # Pattern title formatting
        # Format: “{Top driver}-driven {decision/risk type} decisions”
        if confidence == "low" and count == 1:
            title = f"Individual case: {top_driver}-driven {decision_type} decision"
        else:
            if risk_type == "near_boundary":
                risk_desc = "near-boundary"
            elif risk_type == "counterfactual_sensitive":
                risk_desc = "counterfactual-sensitive"
            elif risk_type == "proxy_risk":
                risk_desc = "proxy-risk"
            else:
                risk_desc = f"{decision_type} decisions"
            
            if risk_desc.endswith("decisions"):
                title = f"{top_driver}-driven {risk_desc}"
            else:
                title = f"{top_driver}-driven {risk_desc} decisions"

        # Plain explanation text (fallback if LLM response is not present)
        if is_proxy:
            plain_explanation = (
                f"This pattern represents {count} decisions where '{top_driver}' was the primary driver. "
                f"Because '{top_driver}' correlates with protected columns, it poses a proxy risk. "
                f"The group consists of {decision_type} decisions, with a counterfactual flip rate of {round(cf_flip_rate * 100)}%."
            )
        else:
            plain_explanation = (
                f"This pattern contains {count} decisions where '{top_driver}' consistently influenced the model outcome in a {decision_type} direction. "
                f"The group involves group(s): {sensitive_group_str}. "
                f"The counterfactual flip rate is {round(cf_flip_rate * 100)}%, indicating how sensitive these outcomes are to demographic changes."
            )
            
        patterns.append({
            "pattern_id": f"P{pattern_index}",
            "title": title,
            "affected_record_count": count,
            "decision_type": decision_type,
            "risk_type": risk_type,
            "risk_level": risk_level,
            "confidence": confidence,
            "sensitive_group": sensitive_group_str,
            "top_drivers": top_drivers_list,
            "proxy_involved": is_proxy,
            "counterfactual_flip_rate": cf_flip_rate,
            "representative_records": representative_records,
            "record_ids": [r.get("record_id") for r in records],
            "plain_explanation": plain_explanation
        })
        pattern_index += 1
        
    # Sort patterns: High-confidence first, then large affected count descending
    patterns.sort(key=lambda p: (
        2 if p["confidence"] == "high" else (1 if p["confidence"] == "moderate" else 0),
        p["affected_record_count"]
    ), reverse=True)
    
    return patterns


def _build_default(prepared):
    pipeline = build_classifier(prepared.X_train)
    pipeline = fit_classifier(pipeline, prepared.X_train, prepared.y_train)
    return pipeline


def generate_narrative_summary(
    flagged_list: list[dict[str, Any]], sensitive_cols: list[str], domain: str
) -> str:
    if not flagged_list:
        return f"No flagged decisions were identified in the {domain} domain analysis."

    proxy_count = sum(
        1 for item in flagged_list
        if any(r.get("is_proxy_risk") for r in item.get("top_reasons", []))
    )
    all_proxy_features = [
        reason.get("feature")
        for item in flagged_list
        for reason in item.get("top_reasons", [])
        if reason.get("is_proxy_risk")
    ]

    if not all_proxy_features:
        return (
            f"Out of {len(flagged_list)} reviewed decisions in the {domain} domain, "
            f"none showed explicit signs of proxy-driven bias. The model decisions appear "
            f"to be based on non-sensitive features with lower correlation to protected attributes."
        )

    from collections import Counter
    top_feature = Counter(all_proxy_features).most_common(1)[0][0]
    sensitive_col = sensitive_cols[0] if sensitive_cols else "sensitive attributes"

    return (
        f"Out of {len(flagged_list)} reviewed decisions in the {domain} domain, "
        f"{proxy_count} showed signs of proxy-driven bias. The most influential feature "
        f"linked to discrimination risk was '{top_feature}', which appears correlated "
        f"with {sensitive_col}. This suggests the model may be using {top_feature} as "
        f"an indirect signal for {sensitive_col} when making decisions."
    )
