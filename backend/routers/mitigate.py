"""Mitigation router for Sandbox Fixes flow."""
from __future__ import annotations

import io
import os
import uuid
from typing import Any
from datetime import datetime, timezone

import pandas as pd
from fastapi import APIRouter, Depends, Form, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.dataset_loader import load_dataset_from_path
from core import store
from core.firebase_auth import get_current_user
from core.authz import require_project, require_audit_run, require_mitigation_run
from routers.pipeline import _run_pipeline, _store_get
from core.common import get_metric_weights

router = APIRouter(prefix="/mitigation", tags=["mitigation"])


class ApplyMitigationRequest(BaseModel):
    project_id: int
    audit_run_id: int
    selected_pattern_ids: list[str]
    selected_record_ids: list[str] | list[int]
    strategy: str = "exclude_records"


@router.get("/candidates/{audit_run_id}")
async def get_mitigation_candidates(
    audit_run_id: int,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    audit = require_audit_run(audit_run_id, user)
    project = store.get_project(audit["project_id"])

    full_res = audit.get("full_result_json") or {}
    patterns = full_res.get("explanation_patterns", [])

    candidate_count = sum(len(p.get("record_ids", [])) for p in patterns)

    data_audit = full_res.get("data_audit", {})
    original_rows = (
        full_res.get("dataset_row_count")
        or data_audit.get("total_rows")
        or (data_audit.get("summary") or {}).get("total_rows")
    )
    if not original_rows and project and project.get("dataset_path"):
        try:
            df = load_dataset_from_path(project["dataset_path"])
            original_rows = len(df)
        except Exception:
            pass
    original_rows = original_rows or 0

    recommendation_msg = "Record exclusion is an option, but use caution."
    if original_rows > 0:
        if candidate_count / original_rows > 0.1:
            recommendation_msg = "Not recommended: Excluding over 10% of the dataset may cause severe data loss."
        elif candidate_count > 0:
            recommendation_msg = "Recommended: Exclusion impact is low enough to safely apply."

    return {
        "audit_run_id": audit["id"],
        "project_id": audit["project_id"],
        "original_dataset_rows": original_rows,
        "patterns": patterns,
        "candidate_record_count": candidate_count,
        "recommendations": {
            "status": "warning" if "Not recommended" in recommendation_msg else "ok",
            "message": recommendation_msg,
        },
    }


@router.post("/apply")
async def apply_mitigation(
    background_tasks: BackgroundTasks,
    request: ApplyMitigationRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    project = require_project(request.project_id, user)
    original_audit = require_audit_run(request.audit_run_id, user)

    if not project.get("dataset_path"):
        raise HTTPException(
            status_code=400,
            detail="The original dataset file is not stored on this project. Please re-run the audit pipeline so the dataset is saved to disk, then try the sandbox fix again.",
        )

    df = load_dataset_from_path(project["dataset_path"])
    original_count = len(df)

    # Resolve patterns into record IDs
    pattern_record_ids: list[str] = []
    if request.selected_pattern_ids:
        patterns = (original_audit.get("full_result_json") or {}).get("explanation_patterns", [])
        for p in patterns:
            if p.get("pattern_id") in request.selected_pattern_ids:
                pattern_record_ids.extend(p.get("record_ids", []))

    combined_ids = set(request.selected_record_ids).union(set(pattern_record_ids))

    try:
        drop_indices = [int(idx) for idx in combined_ids]
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid record IDs provided.")

    valid_drops = [idx for idx in drop_indices if idx in df.index]
    filtered_df = df.drop(index=valid_drops)

    new_count = len(filtered_df)
    dropped_count = original_count - new_count

    if new_count < 50:
        raise HTTPException(status_code=400, detail="Safety check failed: Dataset would have fewer than 50 records remaining.")

    target_col = project.get("target_column", "")
    if target_col in filtered_df.columns:
        if filtered_df[target_col].nunique() < 2:
            raise HTTPException(status_code=400, detail="Safety check failed: Mitigation removes all records of one class. Target column must remain binary.")

    dataset_path = project["dataset_path"]
    mitigated_path = dataset_path.replace(".csv", f"_mitigated_{uuid.uuid4().hex[:6]}.csv")
    filtered_df.to_csv(mitigated_path, index=False)

    csv_buffer = io.StringIO()
    filtered_df.to_csv(csv_buffer, index=False)
    df_bytes = csv_buffer.getvalue().encode("utf-8")

    task_id = str(uuid.uuid4())

    # ── Create shadow project ──────────────────────────────────────────────────
    existing_count = len([
        r for r in store.list_monitoring_logs(request.project_id)
        if True  # count placeholder — use mitigation run count
    ])
    # Count actual mitigation runs for this project
    shadow_name = f"{project['name']} (Mitigated {existing_count + 1})"

    shadow_project = store.create_project(
        name=shadow_name,
        domain=project.get("domain", "general"),
        sensitive_columns=project.get("sensitive_columns", []),
        target_column=project.get("target_column"),
        metric_priority=project.get("metric_priority") or "balanced",
        owner_uid=user["uid"],
        dataset_path=mitigated_path,
        max_step=9,
    )

    # ── Create MitigationRun record ────────────────────────────────────────────
    mitigation_run = store.create_mitigation_run(
        project_id=request.project_id,
        original_audit_run_id=request.audit_run_id,
        original_dataset_path=dataset_path,
        mitigated_dataset_path=mitigated_path,
        strategy=request.strategy,
        selected_pattern_ids_json=request.selected_pattern_ids,
        selected_record_ids_json=[str(x) for x in valid_drops],
        removed_records_count=dropped_count,
        original_row_count=original_count,
        mitigated_row_count=new_count,
        retention_percentage=round((new_count / max(original_count, 1)) * 100, 2),
        status="running",
        task_id=task_id,
        result_json={"shadow_project_id": shadow_project["id"]},
    )

    # ── Trigger pipeline under the shadow project ──────────────────────────────
    # exclude_sensitive is ALWAYS False — audit model must train with sensitive
    # columns to detect direct attribute bias correctly.
    metric_weights = get_metric_weights(project.get("metric_priority") or "balanced")

    background_tasks.add_task(
        _run_pipeline,
        task_id=task_id,
        df_bytes=df_bytes,
        filename=os.path.basename(mitigated_path),
        sensitive_list=project.get("sensitive_columns", []),
        target_col=target_col,
        project_id=shadow_project["id"],
        metric_weights=metric_weights,
        model_bytes=None,
        domain=project.get("domain", "general"),
        positive_label=None,
        exclude_sensitive=False,
        owner_uid=user["uid"],
    )

    return {
        "mitigation_run_id": mitigation_run["id"],
        "task_id": task_id,
        "status": "running",
        "shadow_project_id": shadow_project["id"],
    }


@router.get("/status/{task_id}")
async def get_mitigation_status(
    task_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    task = _store_get(task_id)

    m_run = store.get_mitigation_run_by_task(task_id)
    if not m_run:
        raise HTTPException(status_code=404, detail="Mitigation run not found")

    # Verify ownership
    require_project(m_run["project_id"], user)

    status = task.get("status") if task else "unknown"

    if status == "complete":
        new_audit = store.get_audit_run_by_task(task_id)
        if new_audit and not m_run.get("mitigated_audit_run_id"):
            store.update_mitigation_run(
                m_run["id"],
                mitigated_audit_run_id=new_audit["id"],
                status="completed",
                completed_at=datetime.now(timezone.utc).isoformat(),
            )
            status = "completed"

    elif status == "error":
        store.update_mitigation_run(m_run["id"], status="failed")

    return {
        "status": m_run.get("status", status),
        "mitigation_run_id": m_run["id"],
        "message": task.get("error") if status == "error" else None,
        "progress": 100 if m_run.get("status") == "completed" else 50,
    }


@router.get("/result/{mitigation_run_id}")
async def get_mitigation_result(
    mitigation_run_id: int,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    m_run = require_mitigation_run(mitigation_run_id, user)

    orig_audit = store.get_audit_run(m_run["original_audit_run_id"])
    mitigated_audit_id = m_run.get("mitigated_audit_run_id")
    new_audit = store.get_audit_run(mitigated_audit_id) if mitigated_audit_id else None

    if not orig_audit or not new_audit:
        raise HTTPException(status_code=400, detail="Both original and mitigated audits must be complete to view results.")

    orig_res = orig_audit.get("full_result_json") or {}
    new_res = new_audit.get("full_result_json") or {}

    orig_metrics = orig_res.get("model_bias", {})
    new_metrics = new_res.get("model_bias", {})

    return {
        "mitigation_run_id": m_run["id"],
        "project_id": m_run["project_id"],
        "original_audit_run_id": m_run["original_audit_run_id"],
        "mitigated_audit_run_id": mitigated_audit_id,
        "removed_records_count": m_run.get("removed_records_count"),
        "retention_percentage": m_run.get("retention_percentage"),
        "original_summary": {
            "fairness_score": orig_audit.get("fairness_score"),
            "accuracy": orig_audit.get("accuracy"),
            "dataset_rows": m_run.get("original_row_count"),
            "demographic_parity_gap": orig_metrics.get("metrics", {}).get("demographic_parity_difference", 0),
            "equal_opportunity_gap": orig_metrics.get("metrics", {}).get("equal_opportunity_difference", 0),
            "predictive_parity_gap": orig_metrics.get("metrics", {}).get("predictive_parity_difference", 0),
            "disparate_impact": orig_metrics.get("disparate_impact", {}).get("ratio", 0),
            "counterfactual_flip_rate": orig_res.get("counterfactual", {}).get("flip_rate", 0),
            "decision_patterns_count": len(orig_res.get("explanation_patterns", [])),
            "proxy_risk_score": orig_res.get("proxy", {}).get("proxy_score", 0),
        },
        "mitigated_summary": {
            "fairness_score": new_audit.get("fairness_score"),
            "accuracy": new_audit.get("accuracy"),
            "dataset_rows": m_run.get("mitigated_row_count"),
            "demographic_parity_gap": new_metrics.get("metrics", {}).get("demographic_parity_difference", 0),
            "equal_opportunity_gap": new_metrics.get("metrics", {}).get("equal_opportunity_difference", 0),
            "predictive_parity_gap": new_metrics.get("metrics", {}).get("predictive_parity_difference", 0),
            "disparate_impact": new_metrics.get("disparate_impact", {}).get("ratio", 0),
            "counterfactual_flip_rate": new_res.get("counterfactual", {}).get("flip_rate", 0),
            "decision_patterns_count": len(new_res.get("explanation_patterns", [])),
            "proxy_risk_score": new_res.get("proxy", {}).get("proxy_score", 0),
        },
        "new_audit_result": new_res,
    }


@router.get("/download/{mitigation_run_id}")
async def download_mitigated_dataset(
    mitigation_run_id: int,
    user: dict[str, Any] = Depends(get_current_user),
):
    m_run = require_mitigation_run(mitigation_run_id, user)
    path = m_run.get("mitigated_dataset_path")
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Mitigated dataset file not found on server.")

    def iterfile():
        with open(path, mode="rb") as file_like:
            yield from file_like

    return StreamingResponse(
        iterfile(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=mitigated_dataset.csv"},
    )
