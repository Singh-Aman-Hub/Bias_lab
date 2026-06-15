"""Authorization helpers — ownership checks for all resource types.

Uses 404 (not 403) for unauthorized resources so users cannot enumerate IDs.
"""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from core import store


def require_project(project_id: int, user: dict[str, Any]) -> dict[str, Any]:
    project = store.get_owned_project(project_id, user["uid"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def require_audit_run(audit_run_id: int, user: dict[str, Any]) -> dict[str, Any]:
    audit = store.get_audit_run(audit_run_id)
    if not audit:
        raise HTTPException(status_code=404, detail="Audit run not found")
    require_project(audit["project_id"], user)
    return audit


def require_mitigation_run(mitigation_run_id: int, user: dict[str, Any]) -> dict[str, Any]:
    run = store.get_mitigation_run(mitigation_run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Mitigation run not found")
    require_project(run["project_id"], user)
    return run


def require_flag(flag_id: int, user: dict[str, Any]) -> dict[str, Any]:
    flag = store.get_flag(flag_id)
    if not flag:
        raise HTTPException(status_code=404, detail="Flag not found")
    require_project(flag["project_id"], user)
    return flag
