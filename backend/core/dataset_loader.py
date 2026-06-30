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
        rows=1680,
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
        name="hiring_decision",
        display_name="Hiring Decision Dataset",
        description="Recruitment and candidate evaluation dataset containing demographic, educational, professional, and assessment-based features used to predict hiring decisions. Widely used for hiring outcome prediction, fairness analysis, bias detection, and explainable AI research in recruitment systems.",
        filename="recruitment_data.csv",
        target_col="HiringDecision",
        sensitive_cols=["Gender", "Age"],
        suggested_domain="human_resources",
        rows=1500,
        columns=[
            {"name": "Age", "type": "numeric"},
            {"name": "Gender", "type": "categorical"},
            {"name": "EducationLevel", "type": "categorical"},
            {"name": "ExperienceYears", "type": "numeric"},
            {"name": "PreviousCompanies", "type": "numeric"},
            {"name": "DistanceFromCompany", "type": "numeric"},
            {"name": "InterviewScore", "type": "numeric"},
            {"name": "SkillScore", "type": "numeric"},
            {"name": "PersonalityScore", "type": "numeric"},
            {"name": "RecruitmentStrategy", "type": "categorical"},
            {"name": "HiringDecision", "type": "categorical"},
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
            "filename": ds.filename,
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


def load_dataset_from_path(file_path: str) -> pd.DataFrame:
    """Load a CSV dataset from an arbitrary absolute file path (e.g., user-uploaded files stored in the Project model)."""
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Dataset file not found at: {file_path}")
    if not path.suffix.lower() == ".csv":
        raise ValueError(f"Only CSV files are supported. Got: {path.suffix}")
    return pd.read_csv(path)
