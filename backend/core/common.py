from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.metrics import accuracy_score, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder, OneHotEncoder
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression

try:
    from xgboost import XGBClassifier
    _HAS_XGB = True
except ImportError:  # pragma: no cover - exercised only when xgboost is absent
    _HAS_XGB = False


# Default model for the audit's built-in proxy. Gradient boosting (XGBoost) is the
# current industry standard for tabular credit/risk scoring; Random Forest is kept as
# a fallback (and selectable option) when xgboost is unavailable.
DEFAULT_MODEL_TYPE = "xgb"


# Minimum samples a subgroup needs before its per-group rates are trusted. Subgroups
# smaller than this are excluded from fairness-gap comparisons (a handful of records
# produces noisy rates that inflate max−min gaps) and flagged ``low_confidence`` in
# group_metrics. ~30 is the common rule-of-thumb threshold for sample-mean stability.
MIN_SUBGROUP_SIZE = 30


RISK_LEVELS = {"Green": 75, "Yellow": 50, "Red": 0}


@dataclass
class PreparedData:
    X_train: pd.DataFrame
    X_test: pd.DataFrame
    y_train: pd.Series
    y_test: pd.Series
    feature_columns: list[str]
    numeric_features: list[str]
    categorical_features: list[str]


def risk_from_gap(gap: float) -> str:
    if gap > 0.4:
        return "Red"
    if gap >= 0.15:
        return "Yellow"
    return "Green"


def risk_from_score(score: float) -> str:
    if score >= 75:
        return "Green"
    if score >= 50:
        return "Yellow"
    return "Red"


def encode_sensitive_series(series: pd.Series) -> pd.Series:
    if pd.api.types.is_numeric_dtype(series):
        return series.astype(float)
    codes, _ = pd.factorize(series.astype(str), sort=True)
    return pd.Series(codes, index=series.index, dtype=float)


def infer_numeric_and_categorical(df: pd.DataFrame, sensitive_cols: list[str], target_col: str) -> tuple[list[str], list[str]]:
    feature_cols = [col for col in df.columns if col != target_col]
    numeric_features = [col for col in feature_cols if pd.api.types.is_numeric_dtype(df[col])]
    categorical_features = [col for col in feature_cols if col not in numeric_features]
    return numeric_features, categorical_features


def make_feature_frame(df: pd.DataFrame, target_col: str) -> pd.DataFrame:
    return df.drop(columns=[target_col]).copy()


# Tokens used to recognize the favorable ("positive") outcome of a binary target so the
# tool measures the *approval / good* rate rather than whichever label happens to sort last.
_FAVORABLE_TOKENS = {
    "approved", "approve", "approval", "yes", "y", "true", "t", "good", "accept", "accepted",
    "hire", "hired", "granted", "grant", "positive", "pass", "passed", "success", "successful",
    "eligible", "admit", "admitted", "selected", "funded", ">50k",
}
_UNFAVORABLE_TOKENS = {
    "denied", "deny", "rejected", "reject", "no", "n", "false", "f", "bad", "decline",
    "declined", "fail", "failed", "negative", "ineligible", "unsuccessful", "<=50k", "<50k",
    "churn", "default", "defaulted", "fraud",
}


def _label_polarity(label: Any) -> int:
    """+1 if a label reads as a favorable outcome, -1 if unfavorable, 0 if unknown."""
    s = str(label).strip().lower().strip(".")
    if s.startswith("not ") or s.startswith("non-") or s.startswith("no "):
        return -1
    if s in _FAVORABLE_TOKENS:
        return 1
    if s in _UNFAVORABLE_TOKENS:
        return -1
    if any(tok in s for tok in (">50k", "approv", "accept", "grant", "eligible", "hire")):
        return 1
    if any(tok in s for tok in ("<=50k", "<50k", "reject", "deny", "denied", "declin", "default", "fraud", "ineligibl")):
        return -1
    return 0


# Above this many distinct numeric values, a target is treated as continuous (a score or
# amount) rather than a class label.
_CONTINUOUS_UNIQUE_THRESHOLD = 20


def validate_target_column(series: pd.Series, target_col: str = "target") -> dict[str, Any]:
    """Check that a target column is a usable binary outcome for a fairness audit.

    Returns ``{"valid": bool, "n_classes": int, "classes": [...], "error": str | None}``.
    A binary target (exactly two distinct non-null values, of any type) is valid. Anything
    else is rejected with an actionable message rather than silently producing meaningless
    binary metrics on a multiclass / continuous target.
    """
    s = series.dropna()
    n = int(s.nunique())
    classes = [str(v) for v in list(pd.unique(s))[:10]]

    if n < 2:
        return {
            "valid": False, "n_classes": n, "classes": classes,
            "error": (
                f"Target column '{target_col}' has only {n} distinct value(s). A fairness "
                f"audit needs two outcome classes (e.g. approved vs denied)."
            ),
        }
    if n == 2:
        return {"valid": True, "n_classes": 2, "classes": classes, "error": None}

    if pd.api.types.is_numeric_dtype(s) and n > _CONTINUOUS_UNIQUE_THRESHOLD:
        return {
            "valid": False, "n_classes": n, "classes": classes,
            "error": (
                f"Target column '{target_col}' looks continuous ({n} distinct numeric "
                f"values). This audit measures fairness for binary decisions - choose a "
                f"binary outcome column, or convert this into two classes (e.g. threshold "
                f"it into high / low)."
            ),
        }
    return {
        "valid": False, "n_classes": n, "classes": classes,
        "error": (
            f"Target column '{target_col}' has {n} classes ({', '.join(classes)}). This "
            f"audit supports binary outcomes only - map it to two outcomes (favorable vs "
            f"unfavorable) or pick a binary target column."
        ),
    }


def resolve_positive_label(values: Any, override: Any = None) -> Any:
    """Pick the favorable / "positive" label of a binary target.

    Order of preference: an explicit ``override`` if present in the data; the numeric ``1``
    for a {0,1} target; otherwise the label that reads as favorable (approved/yes/>50K/…).
    When neither label is recognizable it falls back to the alphabetically-last value — the
    tool's historical behavior — so this is never *worse* than before, only better when the
    labels are meaningful.
    """
    uniq = list(pd.Series(values).dropna().unique())
    if not uniq:
        return None
    if override is not None and override in uniq:
        return override
    if set(uniq) == {0, 1}:
        return 1
    # Highest polarity wins; ties (both unknown) fall back to the alphabetically-last label.
    return max(uniq, key=lambda label: (_label_polarity(label), str(label)))


def positive_rate(col: pd.Series, override: Any = None) -> float:
    """Share of records whose target equals the favorable label (0.0 if undefined)."""
    col = col.dropna()
    if col.empty:
        return 0.0
    if pd.api.types.is_numeric_dtype(col) and set(pd.unique(col)) <= {0, 1}:
        return float(col.mean())
    if col.nunique() != 2:
        return 0.0
    pos = resolve_positive_label(col, override=override)
    return float((col == pos).mean())


def prepare_split(df: pd.DataFrame, target_col: str, random_state: int = 42, positive_label: Any = None) -> PreparedData:
    feature_columns = [col for col in df.columns if col != target_col]
    X = df[feature_columns].copy()
    y = df[target_col].copy()
    # Binarize target to 0/1 so all downstream functions get consistent numeric labels.
    # For a 2-class target, map the *favorable* outcome to 1 (not whichever label sorts
    # last) so approval_rate/TPR/etc. measure the outcome users actually care about.
    if not pd.api.types.is_numeric_dtype(y) or set(y.dropna().unique()) != {0, 1}:
        non_null = y.dropna().unique()
        if len(non_null) == 2:
            pos = resolve_positive_label(non_null, override=positive_label)
            y = (y == pos).astype(int)
        else:
            le = LabelEncoder()
            y = pd.Series(le.fit_transform(y), index=y.index, name=y.name)
    numeric_features = [col for col in X.columns if pd.api.types.is_numeric_dtype(X[col])]
    categorical_features = [col for col in X.columns if col not in numeric_features]
    # Use a dynamic test size for very small datasets to ensure at least 1 sample in each
    test_size = 0.2
    if len(df) < 5:
        test_size = 0.5
    if len(df) < 2:
        # Cannot split 1 row, use it for both for metrics (not ideal but avoids crash)
        return PreparedData(X, X, y, y, feature_columns, numeric_features, categorical_features)

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=test_size,
        random_state=random_state,
        stratify=y if y.nunique() > 1 else None,
    )
    return PreparedData(X_train, X_test, y_train, y_test, feature_columns, numeric_features, categorical_features)


def build_classifier(X_train: pd.DataFrame, model_type: str = DEFAULT_MODEL_TYPE, exclude_cols: list[str] | None = None) -> Pipeline:
    # Columns the model must NOT learn from — typically the sensitive attributes, so the
    # model can't make a decision *directly* on race/sex (disparate treatment). They are
    # only dropped from the feature transformers here; callers may still pass frames that
    # contain them (e.g. the counterfactual flip test) — remainder="drop" ignores them.
    exclude = set(exclude_cols or [])
    feature_cols = [c for c in X_train.columns if c not in exclude]
    # Safety: never exclude away every feature (degenerate dataset) — fall back to all.
    if not feature_cols:
        feature_cols = list(X_train.columns)
    numeric_features = [col for col in feature_cols if pd.api.types.is_numeric_dtype(X_train[col])]
    categorical_features = [col for col in feature_cols if col not in numeric_features]
    numeric_pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
        ]
    )
    categorical_pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("encoder", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
        ]
    )
    preprocessor = ColumnTransformer(
        transformers=[
            ("num", numeric_pipeline, numeric_features),
            ("cat", categorical_pipeline, categorical_features),
        ],
        remainder="drop",
    )
    estimator: Any
    if model_type == "linear":
        estimator = LogisticRegression(max_iter=1000)
    elif model_type == "rf":
        estimator = RandomForestClassifier(n_estimators=50, random_state=42, n_jobs=-1)
    elif model_type == "xgb" and _HAS_XGB:
        # bounded depth + subsampling regularize the model; the high n_estimators cap is
        # only fully used when fit() runs *without* early stopping. fit_classifier() carves
        # a validation set and stops early, so the effective tree count is tuned to the data.
        estimator = XGBClassifier(
            n_estimators=1000,
            learning_rate=0.05,
            max_depth=5,
            subsample=0.9,
            colsample_bytree=0.9,
            tree_method="hist",
            eval_metric="logloss",
            random_state=42,
            n_jobs=-1,
        )
    else:
        # xgb requested but unavailable, or unknown type → safe RF fallback.
        estimator = RandomForestClassifier(n_estimators=50, random_state=42, n_jobs=-1)
    return Pipeline(steps=[("preprocessor", preprocessor), ("model", estimator)])


def fit_classifier(pipeline: Pipeline, X_train: pd.DataFrame, y_train: pd.Series) -> Pipeline:
    """Fit a pipeline built by ``build_classifier``.

    For an XGBoost estimator with enough data, carve a stratified validation split,
    transform it through the fitted preprocessor, and fit with early stopping so the
    number of boosting rounds is tuned to the data (regularization against overfit).
    For every other model — or tiny / single-class data, or if early stopping fails —
    fall back to a plain full-data fit. Returns the (now fitted) pipeline.
    """
    model = pipeline.named_steps.get("model") if hasattr(pipeline, "named_steps") else None
    preprocessor = pipeline.named_steps.get("preprocessor") if hasattr(pipeline, "named_steps") else None
    is_xgb = model is not None and model.__class__.__name__ == "XGBClassifier"
    n_classes = int(pd.Series(y_train).nunique())

    if is_xgb and preprocessor is not None and len(X_train) >= 50 and n_classes > 1:
        try:
            X_tr, X_val, y_tr, y_val = train_test_split(
                X_train, y_train, test_size=0.15, random_state=42, stratify=y_train
            )
            X_tr_t = preprocessor.fit_transform(X_tr, y_tr)
            X_val_t = preprocessor.transform(X_val)
            model.set_params(early_stopping_rounds=30)
            model.fit(X_tr_t, y_tr, eval_set=[(X_val_t, y_val)], verbose=False)
            return pipeline
        except Exception:
            # Reset early stopping so the plain fit below does not demand an eval set.
            try:
                model.set_params(early_stopping_rounds=None)
            except Exception:
                pass

    pipeline.fit(X_train, y_train)
    return pipeline


def overfit_assessment(train_accuracy: float, test_accuracy: float) -> dict[str, Any]:
    """Compare train vs test accuracy and flag overfitting.

    A large positive gap (train >> test) means the model fits the training data far
    better than unseen data — it is memorizing rather than generalizing, and any
    fairness metrics it produces may be optimistic relative to production behavior.
    """
    train_accuracy = float(train_accuracy)
    test_accuracy = float(test_accuracy)
    gap = round(train_accuracy - test_accuracy, 4)

    if gap <= 0.05:
        level, warning = "none", None
    elif gap <= 0.10:
        level = "mild"
        warning = (
            f"Training accuracy ({train_accuracy:.1%}) exceeds test accuracy "
            f"({test_accuracy:.1%}) by {gap:.1%} — mild overfitting. The model still "
            f"generalizes reasonably, but monitor its performance on new data."
        )
    else:
        level = "high"
        warning = (
            f"Training accuracy ({train_accuracy:.1%}) exceeds test accuracy "
            f"({test_accuracy:.1%}) by {gap:.1%} — significant overfitting. The model "
            f"may be memorizing the training data, so these fairness metrics could be "
            f"more optimistic than real-world behavior."
        )

    return {
        "train_accuracy": round(train_accuracy, 4),
        "test_accuracy": round(test_accuracy, 4),
        "gap": gap,
        "level": level,
        "warning": warning,
    }


def disparate_impact_ratio(selection_rates: dict[str, float]) -> dict[str, Any]:
    """The EEOC four-fifths (80%) rule — the US legal standard for adverse impact.

    Unlike the additive gap (max − min), this is a *ratio*: the least-favored group's
    selection (positive) rate divided by the most-favored group's. A ratio below 0.80 is
    the legal threshold for adverse impact. Returns the ratio, a pass/fail flag, and which
    groups are most / least favored.
    """
    rates = {str(g): float(r) for g, r in selection_rates.items()}
    if len(rates) < 2:
        return {
            "ratio": 1.0, "passes_four_fifths": True,
            "most_favored": None, "least_favored": None,
            "most_favored_rate": None, "least_favored_rate": None,
        }
    most_favored = max(rates, key=lambda k: rates[k])
    least_favored = min(rates, key=lambda k: rates[k])
    max_rate = rates[most_favored]
    ratio = (rates[least_favored] / max_rate) if max_rate > 0 else 0.0
    return {
        "ratio": round(ratio, 4),
        "passes_four_fifths": ratio >= 0.8,
        "most_favored": most_favored,
        "least_favored": least_favored,
        "most_favored_rate": round(max_rate, 4),
        "least_favored_rate": round(rates[least_favored], 4),
    }


def group_metrics(y_true: pd.Series, y_pred: pd.Series, group: pd.Series) -> dict[str, dict[str, float]]:
    output: dict[str, dict[str, float]] = {}
    for value in group.astype(str).unique():
        mask = group.astype(str) == value
        group_true = y_true[mask]
        group_pred = y_pred[mask]
        
        n = int(len(group_true))
        if n == 0:
            continue

        tn, fp, fn, tp = confusion_matrix(group_true, group_pred, labels=[0, 1]).ravel()
        actual_pos = tp + fn  # actual positives in this group
        actual_neg = fp + tn  # actual negatives in this group
        output[value] = {
            "approval_rate": float(np.mean(group_pred)),
            # TPR/FPR are undefined when a group has no actual positives / negatives — emit
            # None there rather than a fake 0.0 that reads as a real "0% rate".
            "tpr": float(tp / actual_pos) if actual_pos > 0 else None,
            "fpr": float(fp / actual_neg) if actual_neg > 0 else None,
            "accuracy": float(accuracy_score(group_true, group_pred)),
            "sample_size": n,
            "low_confidence": n < MIN_SUBGROUP_SIZE,
        }
    return output


def fairness_gaps(y_pred: pd.Series, y_true: pd.Series, group: pd.Series) -> dict[str, float]:
    group_values = group.astype(str).unique()
    stats: list[dict[str, float]] = []
    for value in group_values:
        mask = group.astype(str) == value
        group_true = y_true[mask]
        group_pred = y_pred[mask]

        n = int(len(group_true))
        if n == 0:
            continue

        tn, fp, fn, tp = confusion_matrix(group_true, group_pred, labels=[0, 1]).ravel()
        actual_pos, actual_neg = tp + fn, fp + tn
        stats.append({
            "size": n,
            "approval": float(np.mean(group_pred)),
            # None where undefined (no actual positives/negatives) so a group with no
            # positives can't inject a fake 0.0 TPR that fabricates a gap.
            "tpr": (tp / actual_pos) if actual_pos > 0 else None,
            "fpr": (fp / actual_neg) if actual_neg > 0 else None,
            "fnr": (fn / actual_pos) if actual_pos > 0 else None,
        })

    # Include ALL groups in the gap — never silently drop a protected minority just
    # because it is small, or the tool would hide the very bias it exists to surface.
    # The size guard instead drives the ``low_confidence`` flags in group_metrics so
    # the UI can caveat gaps that are driven by statistically thin subgroups.
    if not stats:
        return {"demographic_parity_difference": 0.0, "equal_opportunity_difference": 0.0, "fpr_gap": 0.0, "fnr_gap": 0.0}

    def _gap(key: str) -> float:
        # Compare only groups where the rate is defined; an undefined rate isn't a gap.
        vals = [s[key] for s in stats if s[key] is not None]
        return float(max(vals) - min(vals)) if vals else 0.0

    approval_rates = [s["approval"] for s in stats]
    return {
        "demographic_parity_difference": float(max(approval_rates) - min(approval_rates)),
        "equal_opportunity_difference": _gap("tpr"),
        "fpr_gap": _gap("fpr"),
        "fnr_gap": _gap("fnr"),
    }


def fairness_score_from_gaps(gaps: dict[str, float], metric_weights: dict[str, float] | None = None) -> float:
    if metric_weights is None:
        metric_weights = {
            "demographic_parity_difference": 25,
            "equal_opportunity_difference": 20,
            "fpr_gap": 15,
            "fnr_gap": 15,
        }
    raw_penalty = (
        metric_weights.get("demographic_parity_difference", 25) * gaps.get("demographic_parity_difference", 0.0)
        + metric_weights.get("equal_opportunity_difference", 20) * gaps.get("equal_opportunity_difference", 0.0)
        + metric_weights.get("fpr_gap", 15) * gaps.get("fpr_gap", 0.0)
        + metric_weights.get("fnr_gap", 15) * gaps.get("fnr_gap", 0.0)
    )
    return float(max(0.0, min(100.0, 100.0 - raw_penalty)))


def get_metric_weights(metric_priority: str = "balanced") -> dict[str, float]:
    """Convert metric priority string to weights dictionary.

    Shared across pipeline and legacy bias endpoints.
    """
    if metric_priority == "equal_opportunity_first":
        return {
            "demographic_parity_difference": 15,
            "equal_opportunity_difference": 45,
            "fpr_gap": 15,
        }
    elif metric_priority == "demographic_parity_first":
        return {
            "demographic_parity_difference": 45,
            "equal_opportunity_difference": 15,
            "fpr_gap": 15,
        }
    else:  # "balanced" or default
        return {
            "demographic_parity_difference": 30,
            "equal_opportunity_difference": 25,
            "fpr_gap": 20,
        }


def top_correlated_feature(features: pd.DataFrame, sensitive_cols: list[str]) -> tuple[str | None, float]:
    best_feature = None
    best_score = 0.0
    for column in features.columns:
        if column in sensitive_cols:
            continue
        for sensitive in sensitive_cols:
            sens = features[sensitive] if sensitive in features.columns else None
            if sens is None:
                continue
            if pd.api.types.is_numeric_dtype(features[column]) and pd.api.types.is_numeric_dtype(sens):
                correlation = abs(features[column].corr(sens))
            else:
                encoded_feature = pd.factorize(features[column].astype(str))[0]
                encoded_sensitive = pd.factorize(sens.astype(str))[0]
                if encoded_feature.size == 0:
                    correlation = 0.0
                else:
                    correlation = abs(pd.Series(encoded_feature).corr(pd.Series(encoded_sensitive)))
            if correlation > best_score:
                best_score = float(correlation if pd.notna(correlation) else 0.0)
                best_feature = column
    return best_feature, best_score
