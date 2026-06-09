"""One-time data preparation script.

Downloads and prepares built-in datasets for BIAS-0.
Run from the backend directory:
    python data_prep.py
"""

from __future__ import annotations

import csv
import os
import urllib.request
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)


def download(url: str, dest: str) -> None:
    path = DATA_DIR / dest
    if path.exists():
        print(f"  [OK] {dest} already exists")
        return
    print(f"  ↓ Downloading {url}...")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    data = urllib.request.urlopen(req, timeout=120).read()
    with open(path, "wb") as f:
        f.write(data)
    print(f"  [OK] {dest} ({len(data) / 1024 / 1024:.1f} MB)")


def prep_adult() -> None:
    dest = "adult_income.csv"
    path = DATA_DIR / dest
    if path.exists():
        print(f"  [OK] {dest} exists")
        return

    url = "https://raw.githubusercontent.com/jbrownlee/Datasets/master/adult-all.csv"
    cols = [
        "age", "workclass", "fnlwgt", "education", "education-num",
        "marital-status", "occupation", "relationship", "race", "sex",
        "capital-gain", "capital-loss", "hours-per-week", "native-country",
        "income",
    ]

    print(f"  ↓ Downloading & preparing {dest}...")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    raw = urllib.request.urlopen(req, timeout=120).read().decode()
    rows = list(csv.reader(raw.splitlines()))
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        w.writerows(rows)
    print(f"  [OK] {dest}: {len(rows)} rows, {len(cols)} columns")


def prep_compas() -> None:
    dest = "compas_prepared.csv"
    path = DATA_DIR / dest
    if path.exists():
        print(f"  [OK] {dest} exists")
        return

    url = "https://raw.githubusercontent.com/propublica/compas-analysis/master/compas-scores-two-years.csv"
    keep_cols = ["age", "sex", "race", "priors_count", "c_charge_degree", "two_year_recid"]

    print(f"  ↓ Downloading & preparing {dest}...")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    raw = urllib.request.urlopen(req, timeout=120).read().decode()
    reader = csv.DictReader(raw.splitlines())
    filtered = []
    for row in reader:
        filtered.append({k: row.get(k, "") for k in keep_cols})
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=keep_cols)
        w.writeheader()
        w.writerows(filtered)
    print(f"  [OK] {dest}: {len(filtered)} rows, {len(keep_cols)} columns")


def main() -> None:
    print("BIAS-0 Data Preparation")
    print("=" * 40)
    prep_adult()
    prep_compas()
    print("=" * 40)
    print("Done. Datasets ready in data/")


if __name__ == "__main__":
    main()
