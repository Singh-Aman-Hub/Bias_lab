from __future__ import annotations

import os
import uuid
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile

from core import store
from core.firebase_auth import get_current_user
from core.authz import require_project
from core.common import get_metric_weights
from .pipeline import _run_pipeline, _store_set

router = APIRouter(prefix="/project", tags=["project"])

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.post("/create")
async def create_project(
    name: str = Form(...),
    domain: str = Form(default="general"),
    sensitive_cols: str | None = Form(None),
    target_col: str = Form(default=""),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    sensitive_list = [col.strip() for col in (sensitive_cols or "").split(",") if col.strip()]
    project = store.create_project(
        name=name,
        domain=domain,
        sensitive_columns=sensitive_list,
        target_column=target_col,
        metric_priority="balanced",
        owner_uid=user["uid"],
    )
    return {"project_id": project["id"], "status": "created"}


@router.post("/{project_id}/upload")
async def upload_assets(
    project_id: int,
    dataset: UploadFile = File(...),
    model_file: UploadFile | None = File(default=None),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    project = require_project(project_id, user)

    dataset_path = os.path.join(UPLOAD_DIR, f"proj_{project_id}_data_{dataset.filename}")
    with open(dataset_path, "wb") as f:
        f.write(await dataset.read())

    update_fields: dict[str, Any] = {"dataset_path": dataset_path, "max_step": 2}

    if model_file and model_file.filename:
        model_path = os.path.join(UPLOAD_DIR, f"proj_{project_id}_model_{model_file.filename}")
        with open(model_path, "wb") as f:
            f.write(await model_file.read())
        update_fields["model_path"] = model_path

    store.update_project(project_id, **update_fields)
    return {"status": "uploaded", "dataset_path": dataset_path}


@router.post("/{project_id}/run")
async def run_project_pipeline(
    project_id: int,
    background_tasks: BackgroundTasks,
    metric_priority: str = Form(default="balanced"),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    project = require_project(project_id, user)

    store.update_project(project_id, max_step=max(project.get("max_step", 1), 3))

    dataset_path = project.get("dataset_path")
    if not dataset_path or not os.path.exists(dataset_path):
        raise HTTPException(status_code=400, detail="No dataset uploaded for this project")

    with open(dataset_path, "rb") as f:
        df_bytes = f.read()

    model_bytes = None
    model_path = project.get("model_path")
    if model_path and os.path.exists(model_path):
        with open(model_path, "rb") as f:
            model_bytes = f.read()

    task_id = str(uuid.uuid4())
    _store_set(task_id, {"status": "queued"})

    metric_weights = get_metric_weights(metric_priority)

    background_tasks.add_task(
        _run_pipeline,
        task_id=task_id,
        df_bytes=df_bytes,
        filename=os.path.basename(dataset_path),
        sensitive_list=project.get("sensitive_columns", []),
        target_col=project.get("target_column", ""),
        project_id=project_id,
        metric_weights=metric_weights,
        model_bytes=model_bytes,
        domain=project.get("domain", "general"),
        owner_uid=user["uid"],
    )

    return {"task_id": task_id, "status": "processing"}


@router.get("/{project_id}/compare")
async def compare_project_runs(
    project_id: int,
    user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    require_project(project_id, user)
    runs = store.list_audit_runs(project_id)
    return [
        {
            "run_id": r["id"],
            "fairness_score": r.get("fairness_score"),
            "accuracy": r.get("accuracy"),
            "decision": r.get("decision"),
            "timestamp": r.get("timestamp"),
        }
        for r in runs
    ]


@router.get("/list")
async def list_projects(user: dict[str, Any] = Depends(get_current_user)) -> list[dict[str, Any]]:
    projects = store.list_projects(user["uid"])
    return [
        {
            "id": p["id"],
            "name": p["name"],
            "domain": p.get("domain", "general"),
            "metric_priority": p.get("metric_priority") or "balanced",
            "sensitive_columns": p.get("sensitive_columns", []),
            "target_column": p.get("target_column"),
            "max_step": p.get("max_step", 1),
        }
        for p in projects
    ]


@router.patch("/{project_id}/config")
async def update_project_config(
    project_id: int,
    sensitive_cols: str = Form(...),
    target_col: str = Form(...),
    domain: str = Form(default=""),
    metric_priority: str = Form(default=""),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    require_project(project_id, user)

    sensitive_list = [col.strip() for col in sensitive_cols.split(",") if col.strip()]
    fields: dict[str, Any] = {
        "sensitive_columns": sensitive_list,
        "target_column": target_col,
        "max_step": 2,
    }
    if domain:
        fields["domain"] = domain
    if metric_priority:
        fields["metric_priority"] = metric_priority

    store.update_project(project_id, **fields)
    return {"status": "updated"}


@router.patch("/{project_id}/step")
async def update_project_step(
    project_id: int,
    step: int = Form(...),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    project = require_project(project_id, user)
    new_step = max(project.get("max_step", 1), step)
    store.update_project(project_id, max_step=new_step)
    return {"status": "success", "max_step": new_step}


@router.get("/{project_id}/latest")
async def get_latest_results(
    project_id: int,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    require_project(project_id, user)
    run = store.latest_audit_run(project_id)
    if not run:
        return {"status": "none"}
    return {
        "status": "complete",
        "result": run.get("full_result_json", {}),
        "fairness_score": run.get("fairness_score"),
        "accuracy": run.get("accuracy"),
    }


@router.delete("/{project_id}")
async def delete_project(
    project_id: int,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    project = require_project(project_id, user)

    # Clean up uploaded files from disk
    for path_key in ("dataset_path", "model_path"):
        p = project.get(path_key)
        if p and os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                pass

    store.delete_project(project_id)
    return {"status": "deleted"}
