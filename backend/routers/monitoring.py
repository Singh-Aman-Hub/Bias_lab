from __future__ import annotations

from typing import Any

import json

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field

from core.common import fairness_score_from_gaps, risk_from_score
from core.monitoring import check_alert_condition, get_monitoring_history, log_monitoring_event
from core import store


class IngestPrediction(BaseModel):
    record_id: int
    prediction: float
    sensitive_attrs: dict[str, Any]
    timestamp: str

class IngestPayload(BaseModel):
    project_id: int = Field(..., description="Project identifier")
    predictions: list[IngestPrediction]


router = APIRouter(prefix="/monitoring", tags=["monitoring"])


def _get_events_from_store(project_id: int) -> list[dict[str, Any]]:
    events = store.list_monitoring_events(project_id)
    # Return in ascending order for timeline use
    return sorted(events, key=lambda e: e.get("timestamp", ""))


@router.get("/{project_id}")
def monitoring_history(project_id: int) -> dict[str, Any]:
    events = _get_events_from_store(project_id)
    baseline = events[0]["fairness_score"] if events else 72
    latest = events[-1]["fairness_score"] if events else baseline
    check = check_alert_condition(latest, baseline)
    trend = "declining" if latest < baseline - 3 else "improving" if latest > baseline + 3 else "stable"
    return {
        "project_id": project_id,
        "events": events,
        "current_risk_level": risk_from_score(latest),
        "trend": trend,
        "alert": check,
    }


@router.post("/{project_id}/simulate")
def simulate_monitoring(project_id: int) -> dict[str, Any]:
    store.delete_monitoring_events(project_id)
    base = 76.0
    for day in range(30):
        fairness = base - day * 0.55 + (1 if day % 7 < 3 else -2) + (0.8 if day < 8 else -0.5)
        breakdown = {
            "gender": {"male": round(0.72 + (day % 5) * 0.02, 2), "female": round(0.68 - (day % 3) * 0.03, 2)},
            "caste": {"general": 0.75, "sc": round(0.70 - (day % 4) * 0.01, 2)}
        }
        note = "Score dropped from baseline." if fairness < base - 15 else ""
        store.create_monitoring_event(
            project_id=project_id,
            fairness_score=fairness,
            alert_triggered=False,
            note=note,
            group_breakdown=breakdown,
        )
    return monitoring_history(project_id)


@router.post("/ingest")
def ingest_monitoring(payload: IngestPayload) -> dict[str, Any]:
    project = store.get_project(payload.project_id)
    sensitive_columns: list[str] = project.get("sensitive_columns", []) if project else []

    group_rates: dict[str, list[float]] = {}
    for pred in payload.predictions:
        group_key = json.dumps(pred.sensitive_attrs, sort_keys=True)
        group_rates.setdefault(group_key, []).append(float(pred.prediction))
    approval_rates = {k: sum(v) / len(v) for k, v in group_rates.items()}
    rates = list(approval_rates.values())
    dp_gap = max(rates) - min(rates) if rates else 0.0
    gaps = {
        "demographic_parity_difference": dp_gap,
        "equal_opportunity_difference": 0.0,
        "fpr_gap": 0.0,
    }
    fairness_score = fairness_score_from_gaps(gaps)

    breakdown: dict[str, dict[str, float]] = {}
    for attr in sensitive_columns:
        attr_rates: dict[str, list[float]] = {}
        for pred in payload.predictions:
            val = str(pred.sensitive_attrs.get(attr, "unknown"))
            attr_rates.setdefault(val, []).append(float(pred.prediction))
        if attr_rates:
            breakdown[attr] = {k: sum(v) / len(v) for k, v in attr_rates.items()}

    store.create_monitoring_event(
        project_id=payload.project_id,
        fairness_score=fairness_score,
        alert_triggered=False,
        note="Ingest batch",
        group_breakdown=breakdown,
    )
    events = _get_events_from_store(payload.project_id)
    baseline = events[0]["fairness_score"] if events else fairness_score
    latest = events[-1]["fairness_score"] if events else fairness_score
    alert = check_alert_condition(latest, baseline)
    return {"fairness_score": fairness_score, "alerts": alert}


@router.post("/project/{project_id}/simulate-data")
async def simulate_monitoring_data(
    project_id: int,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    from utils.data_io import upload_file_to_dataframe
    from core.monitoring import detect_data_drift
    import pandas as pd
    import os

    project = store.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.get("dataset_path") or not os.path.exists(project["dataset_path"]):
        raise HTTPException(status_code=400, detail="Baseline dataset not found for this project")

    baseline_df = pd.read_csv(project["dataset_path"])
    simulation_df = await upload_file_to_dataframe(file)

    drift_results = detect_data_drift(
        baseline_df,
        simulation_df,
        project.get("sensitive_columns", []),
        project.get("target_column", ""),
    )

    sensitive_columns = project.get("sensitive_columns", [])
    avg_shift = sum(drift_results.get("sensitive_distribution_shift", {}).values()) / max(len(sensitive_columns), 1)
    predicted_fairness = max(0.0, 80.0 - (avg_shift * 100))

    return {
        "status": "simulation_complete",
        "predicted_fairness": round(predicted_fairness, 1),
        "drift_results": drift_results,
        "is_safe_to_deploy": not drift_results["drift_alert"],
    }


class FlagPayload(BaseModel):
    project_id: int
    record_id: str
    reason: str

@router.post("/flag")
def create_flag(payload: FlagPayload) -> dict[str, Any]:
    flag = store.create_flag(
        project_id=payload.project_id,
        record_id=payload.record_id,
        reason=payload.reason,
        flagged_by="user",
    )
    return {"id": flag["id"], "message": "Flag created"}

@router.get("/flags/{project_id}")
def get_unresolved_flags(project_id: int) -> list[dict[str, Any]]:
    flags = store.list_unresolved_flags(project_id)
    return [
        {
            "id": f["id"],
            "record_id": f["record_id"],
            "reason": f["reason"],
            "flagged_by": f.get("flagged_by"),
            "timestamp": f.get("timestamp"),
        }
        for f in flags
    ]

@router.patch("/flag/{flag_id}")
def resolve_flag(flag_id: int) -> dict[str, Any]:
    flag = store.get_flag(flag_id)
    if not flag:
        raise HTTPException(status_code=404, detail="Flag not found")
    store.update_flag(flag_id, resolved=True)
    return {"message": "Flag resolved"}

@router.get("/project/{project_id}/monitor")
def get_project_monitoring(project_id: int) -> dict[str, Any]:
    events = _get_events_from_store(project_id)
    trend = [
        {"timestamp": e.get("timestamp"), "score": e.get("fairness_score")}
        for e in events
    ]
    drift_detected = False
    if len(events) >= 2:
        latest = events[-1]["fairness_score"]
        previous = events[-2]["fairness_score"]
        if previous > 0 and (previous - latest) / previous > 0.15:
            drift_detected = True
    return {"trend": trend, "drift_detected": drift_detected}

@router.get("/logs/{project_id}")
def get_monitoring_logs(project_id: int, limit: int = 10) -> list[dict[str, Any]]:
    logs = store.list_monitoring_logs(project_id, limit=limit)
    return [
        {
            "id": log["id"],
            "timestamp": log.get("timestamp"),
            "fairness_score": log.get("fairness_score"),
            "data_drift_score": log.get("data_drift_score", 0.0),
            "prediction_drift_score": log.get("prediction_drift_score", 0.0),
            "key_metrics": log.get("key_metrics", {}),
        }
        for log in logs
    ]


@router.post("/drift")
async def detect_drift(
    baseline_file: UploadFile = File(...),
    current_file: UploadFile = File(...),
    sensitive_cols: str = Form(...),
    target_col: str = Form(...),
):
    from core.monitoring import detect_data_drift
    import pandas as pd
    import io

    baseline_bytes = await baseline_file.read()
    current_bytes = await current_file.read()
    baseline_df = pd.read_csv(io.BytesIO(baseline_bytes))
    current_df = pd.read_csv(io.BytesIO(current_bytes))
    sensitive_list = [s.strip() for s in sensitive_cols.split(",") if s.strip()]
    return detect_data_drift(baseline_df, current_df, sensitive_list, target_col)


@router.get("/project/{project_id}/trend")
def get_project_trend(project_id: int, limit: int = 10) -> dict[str, Any]:
    import numpy as np

    logs = store.list_monitoring_logs(project_id, limit=limit)
    if not logs:
        return {"trend": "STABLE", "stability_score": 100.0, "degradation_detected": False}

    # list_monitoring_logs returns newest-first; reverse for chronological
    scores = [log.get("fairness_score", 0) for log in reversed(logs)]

    if len(scores) < 2:
        trend = "STABLE"
    else:
        diff = scores[-1] - scores[0]
        trend = "UP" if diff > 5 else "DOWN" if diff < -5 else "STABLE"

    stability_score = max(0.0, round(100.0 - float(np.std(scores)), 2)) if len(scores) >= 2 else 100.0

    degradation_detected = False
    if len(scores) >= 3:
        last_three = scores[-3:]
        if last_three[0] > last_three[1] > last_three[2]:
            degradation_detected = True

    return {
        "trend": trend,
        "stability_score": stability_score,
        "degradation_detected": degradation_detected,
        "recent_scores": scores,
    }


@router.get("/project/{project_id}/alerts")
def get_project_alerts(project_id: int) -> list[dict[str, Any]]:
    alerts = store.list_alerts(project_id)
    return [
        {
            "id": a["id"],
            "type": a.get("type"),
            "message": a.get("message"),
            "severity": a.get("severity"),
            "timestamp": a.get("timestamp"),
        }
        for a in alerts
    ]
