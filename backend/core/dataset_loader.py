from __future__ import annotations

import csv
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd


@dataclass
class DatasetInfo:
    name: str
    display_name: str
    description: str
    filename: str
    target_col: str
    sensitive_cols: list[str]
    suggested_domain: str
    rows: int
    columns: list[dict[str, str]]


DATASETS_DIR = Path(__file__).resolve().parent.parent.parent / "data"


_BUILT_IN_DATASETS: list[DatasetInfo] = [
    DatasetInfo(
        name="adult_income",
        display_name="UCI Adult Income",
        description="Income prediction from US census data. Classic fairness benchmark for demographic parity analysis.",
        filename="adult_income.csv",
        target_col="income",
        sensitive_cols=["race", "sex"],
        suggested_domain="finance",
        rows=48842,
        columns=[
            {"name": "age", "type": "numeric"},
            {"name": "workclass", "type": "categorical"},
            {"name": "fnlwgt", "type": "numeric"},
            {"name": "education", "type": "categorical"},
            {"name": "education-num", "type": "numeric"},
            {"name": "marital-status", "type": "categorical"},
            {"name": "occupation", "type": "categorical"},
            {"name": "relationship", "type": "categorical"},
            {"name": "race", "type": "categorical"},
            {"name": "sex", "type": "categorical"},
            {"name": "capital-gain", "type": "numeric"},
            {"name": "capital-loss", "type": "numeric"},
            {"name": "hours-per-week", "type": "numeric"},
            {"name": "native-country", "type": "categorical"},
            {"name": "income", "type": "categorical"},
        ],
    ),
    DatasetInfo(
        name="compas",
        display_name="COMPAS Recidivism",
        description="ProPublica's COMPAS risk assessment data. Widely used for criminal justice fairness analysis.",
        filename="compas_prepared.csv",
        target_col="two_year_recid",
        sensitive_cols=["race", "sex"],
        suggested_domain="criminal_justice",
        rows=7214,
        columns=[
            {"name": "age", "type": "numeric"},
            {"name": "sex", "type": "categorical"},
            {"name": "race", "type": "categorical"},
            {"name": "priors_count", "type": "numeric"},
            {"name": "c_charge_degree", "type": "categorical"},
            {"name": "two_year_recid", "type": "categorical"},
        ],
    ),
]


def list_datasets() -> list[dict[str, Any]]:
    result = []
    for ds in _BUILT_IN_DATASETS:
        filepath = DATASETS_DIR / ds.filename
        available = filepath.exists()
        result.append({
            "name": ds.name,
            "display_name": ds.display_name,
            "description": ds.description,
            "target_col": ds.target_col,
            "sensitive_cols": ds.sensitive_cols,
            "suggested_domain": ds.suggested_domain,
            "rows": ds.rows if available else 0,
            "columns": ds.columns,
            "available": available,
            "filepath": str(filepath) if available else None,
        })
    return result


def load_dataset(name: str) -> pd.DataFrame:
    for ds in _BUILT_IN_DATASETS:
        if ds.name == name:
            filepath = DATASETS_DIR / ds.filename
            if not filepath.exists():
                raise FileNotFoundError(
                    f"Dataset '{name}' not found at {filepath}. "
                    f"Run `python backend/data_prep.py` to download it."
                )
            return pd.read_csv(filepath)
    raise ValueError(f"Unknown dataset: {name}. Available: {[d.name for d in _BUILT_IN_DATASETS]}")
