"""Mitigation router for Sandbox Fixes flow."""
from __future__ import annotations

import io
import json
import uuid
import os
import pandas as pd
from typing import Any, List
from datetime import datetime

from fastapi import APIRouter, Form, HTTPException, BackgroundTasks, Body
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.dataset_loader import load_dataset_from_path
from models.db import SessionLocal, Project, AuditRun, MitigationRun
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
async def get_mitigation_candidates(audit_run_id: int) -> dict[str, Any]:
    with SessionLocal() as db:
        audit = db.query(AuditRun).filter(AuditRun.id == audit_run_id).first()
        if not audit:
            raise HTTPException(status_code=404, detail="Audit run not found")

        full_res = audit.full_result_json or {}
        patterns = full_res.get("explanation_patterns", [])
        
        # Calculate totals
        candidate_count = 0
        for p in patterns:
            candidate_count += len(p.get("record_ids", []))
            
        data_audit = full_res.get("data_audit", {})
        original_rows = full_res.get("dataset_row_count")
        if not original_rows:
            original_rows = data_audit.get("total_rows")
        if not original_rows:
            original_rows = data_audit.get("summary", {}).get("total_rows")
        if not original_rows:
            project = db.query(Project).filter(Project.id == audit.project_id).first()
            if project and project.dataset_path:
                try:
                    df = load_dataset_from_path(project.dataset_path)
                    original_rows = len(df)
                except Exception:
                    pass
        original_rows = original_rows or 0

        # Basic recommendation logic
        recommendation_msg = "Record exclusion is an option, but use caution."
        if original_rows > 0:
            if candidate_count / original_rows > 0.1:
                recommendation_msg = "Not recommended: Excluding over 10% of the dataset may cause severe data loss."
            elif candidate_count > 0:
                recommendation_msg = "Recommended: Exclusion impact is low enough to safely apply."

        return {
            "audit_run_id": audit.id,
            "project_id": audit.project_id,
            "original_dataset_rows": original_rows,
            "patterns": patterns,
            "candidate_record_count": candidate_count,
            "recommendations": {
                "status": "warning" if "Not recommended" in recommendation_msg else "ok",
                "message": recommendation_msg
            }
        }

@router.post("/apply")
async def apply_mitigation(
    background_tasks: BackgroundTasks,
    request: ApplyMitigationRequest
) -> dict[str, Any]:
    with SessionLocal() as db:
        project = db.query(Project).filter(Project.id == request.project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
            
        original_audit = db.query(AuditRun).filter(AuditRun.id == request.audit_run_id).first()
        if not original_audit:
            raise HTTPException(status_code=404, detail="Original audit run not found")

        # If project is missing dataset_path, try to recover from the full_result_json or error clearly
        if not project.dataset_path:
            raise HTTPException(
                status_code=400,
                detail="The original dataset file is not stored on this project. Please re-run the audit pipeline so the dataset is saved to disk, then try the sandbox fix again."
            )


        df = load_dataset_from_path(project.dataset_path)
        original_count = len(df)
        
        # Resolve patterns into record IDs
        pattern_record_ids = []
        if request.selected_pattern_ids:
            patterns = (original_audit.full_result_json or {}).get("explanation_patterns", [])
            for p in patterns:
                if p.get("pattern_id") in request.selected_pattern_ids:
                    pattern_record_ids.extend(p.get("record_ids", []))
                    
        # Combine explicitly passed record IDs with pattern-resolved IDs
        combined_ids = set(request.selected_record_ids).union(set(pattern_record_ids))
        
        try:
            drop_indices = [int(idx) for idx in combined_ids]
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid record IDs provided.")

        # Drop the records safely
        valid_drops = [idx for idx in drop_indices if idx in df.index]
        filtered_df = df.drop(index=valid_drops)
        
        new_count = len(filtered_df)
        dropped_count = original_count - new_count
        
        if new_count < 50:
            raise HTTPException(status_code=400, detail="Safety check failed: Dataset would have fewer than 50 records remaining.")
            
        # Ensure target column is still valid
        if project.target_column in filtered_df.columns:
            if filtered_df[project.target_column].nunique() < 2:
                raise HTTPException(status_code=400, detail="Safety check failed: Mitigation removes all records of one class. Target column must remain binary.")

        mitigated_path = project.dataset_path.replace(".csv", f"_mitigated_{uuid.uuid4().hex[:6]}.csv")
        filtered_df.to_csv(mitigated_path, index=False)
        
        # Save Mitigated DataFrame for pipeline
        csv_buffer = io.StringIO()
        filtered_df.to_csv(csv_buffer, index=False)
        df_bytes = csv_buffer.getvalue().encode('utf-8')

        task_id = str(uuid.uuid4())
        
        # Create MitigationRun record
        mitigation_run = MitigationRun(
            project_id=project.id,
            original_audit_run_id=original_audit.id,
            original_dataset_path=project.dataset_path,
            mitigated_dataset_path=mitigated_path,
            strategy=request.strategy,
            selected_pattern_ids_json=request.selected_pattern_ids,
            selected_record_ids_json=[str(x) for x in valid_drops],
            removed_records_count=dropped_count,
            original_row_count=original_count,
            mitigated_row_count=new_count,
            retention_percentage=round((new_count / max(original_count, 1)) * 100, 2),
            status="running",
            task_id=task_id
        )
        db.add(mitigation_run)
        db.commit()
        db.refresh(mitigation_run)
        
        # Trigger Pipeline
        metric_weights = get_metric_weights(project.metric_priority or "balanced")
        _store_get(task_id) # Init store if needed (actually it initializes in _run_pipeline)
        
        background_tasks.add_task(
            _run_pipeline,
            task_id=task_id,
            df_bytes=df_bytes,
            filename=os.path.basename(mitigated_path),
            sensitive_list=project.sensitive_columns,
            target_col=project.target_column,
            project_id=project.id,
            metric_weights=metric_weights,
            model_bytes=None, 
            domain=project.domain,
            positive_label=None,
            exclude_sensitive=True,
        )

        return {
            "mitigation_run_id": mitigation_run.id,
            "task_id": task_id,
            "status": "running"
        }

@router.get("/status/{task_id}")
async def get_mitigation_status(task_id: str) -> dict[str, Any]:
    task = _store_get(task_id)
    
    with SessionLocal() as db:
        m_run = db.query(MitigationRun).filter(MitigationRun.task_id == task_id).first()
        if not m_run:
            raise HTTPException(status_code=404, detail="Mitigation run not found")
            
        status = task.get("status") if task else "unknown"
        
        if status == "complete":
            # Link the newly created audit run
            new_audit = db.query(AuditRun).filter(AuditRun.task_id == task_id).first()
            if new_audit and not m_run.mitigated_audit_run_id:
                m_run.mitigated_audit_run_id = new_audit.id
                m_run.status = "completed"
                m_run.completed_at = datetime.utcnow()
                db.commit()
                status = "completed"
                
        elif status == "error":
            m_run.status = "failed"
            db.commit()

        return {
            "status": m_run.status,
            "mitigation_run_id": m_run.id,
            "message": task.get("error") if status == "error" else None,
            "progress": 100 if m_run.status == "completed" else 50
        }

@router.get("/result/{mitigation_run_id}")
async def get_mitigation_result(mitigation_run_id: int) -> dict[str, Any]:
    with SessionLocal() as db:
        m_run = db.query(MitigationRun).filter(MitigationRun.id == mitigation_run_id).first()
        if not m_run:
            raise HTTPException(status_code=404, detail="Mitigation run not found")
            
        orig_audit = db.query(AuditRun).filter(AuditRun.id == m_run.original_audit_run_id).first()
        new_audit = db.query(AuditRun).filter(AuditRun.id == m_run.mitigated_audit_run_id).first()
        
        if not orig_audit or not new_audit:
            raise HTTPException(status_code=400, detail="Both original and mitigated audits must be complete to view results.")
            
        orig_res = orig_audit.full_result_json or {}
        new_res = new_audit.full_result_json or {}
        
        orig_metrics = orig_res.get("model_bias", {})
        new_metrics = new_res.get("model_bias", {})
        
        # Prepare Delta View
        return {
            "mitigation_run_id": m_run.id,
            "project_id": m_run.project_id,
            "original_audit_run_id": m_run.original_audit_run_id,
            "mitigated_audit_run_id": m_run.mitigated_audit_run_id,
            "removed_records_count": m_run.removed_records_count,
            "retention_percentage": m_run.retention_percentage,
            "original_summary": {
                "fairness_score": orig_audit.fairness_score,
                "accuracy": orig_audit.accuracy,
                "dataset_rows": m_run.original_row_count,
                "demographic_parity_gap": orig_metrics.get("metrics", {}).get("demographic_parity_difference", 0),
                "equal_opportunity_gap": orig_metrics.get("metrics", {}).get("equal_opportunity_difference", 0),
                "predictive_parity_gap": orig_metrics.get("metrics", {}).get("predictive_parity_difference", 0),
                "disparate_impact": orig_metrics.get("disparate_impact", {}).get("ratio", 0),
                "counterfactual_flip_rate": orig_res.get("counterfactual", {}).get("flip_rate", 0),
                "decision_patterns_count": len(orig_res.get("explanation_patterns", [])),
                "proxy_risk_score": orig_res.get("proxy", {}).get("proxy_score", 0)
            },
            "mitigated_summary": {
                "fairness_score": new_audit.fairness_score,
                "accuracy": new_audit.accuracy,
                "dataset_rows": m_run.mitigated_row_count,
                "demographic_parity_gap": new_metrics.get("metrics", {}).get("demographic_parity_difference", 0),
                "equal_opportunity_gap": new_metrics.get("metrics", {}).get("equal_opportunity_difference", 0),
                "predictive_parity_gap": new_metrics.get("metrics", {}).get("predictive_parity_difference", 0),
                "disparate_impact": new_metrics.get("disparate_impact", {}).get("ratio", 0),
                "counterfactual_flip_rate": new_res.get("counterfactual", {}).get("flip_rate", 0),
                "decision_patterns_count": len(new_res.get("explanation_patterns", [])),
                "proxy_risk_score": new_res.get("proxy", {}).get("proxy_score", 0)
            },
            "new_audit_result": new_res # For frontend to extract full details
        }

@router.get("/download/{mitigation_run_id}")
async def download_mitigated_dataset(mitigation_run_id: int):
    with SessionLocal() as db:
        m_run = db.query(MitigationRun).filter(MitigationRun.id == mitigation_run_id).first()
        if not m_run:
            raise HTTPException(status_code=404, detail="Mitigation run not found")
        
        path = m_run.mitigated_dataset_path
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="Mitigated dataset file not found on server.")
            
        def iterfile():
            with open(path, mode="rb") as file_like:
                yield from file_like

        return StreamingResponse(
            iterfile(), 
            media_type="text/csv", 
            headers={"Content-Disposition": f"attachment; filename=mitigated_dataset.csv"}
        )
