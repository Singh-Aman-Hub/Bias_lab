"""Firestore repository layer — replaces SQLAlchemy/SQLite for all app data.

Collections:
    projects            — Project metadata + config
    audit_runs          — Full pipeline results JSON
    monitoring_logs     — Fairness score time-series
    monitoring_events   — Granular monitoring events
    alerts              — BIAS / DRIFT / DEGRADATION alerts
    mitigation_runs     — Sandbox fix run records
    fairness_flags      — User-flagged records
    user_state          — Per-user active project/task state
    counters            — Auto-increment integer IDs (transactional)

Integer IDs are preserved so existing API URL params (/project/3, etc.) keep
working without a frontend rewrite.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from google.cloud.firestore_v1 import DocumentSnapshot, Transaction
from google.cloud import firestore as fs

from core.firestore_db import get_client


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _snap_to_dict(snap: DocumentSnapshot) -> dict[str, Any] | None:
    if not snap.exists:
        return None
    d = snap.to_dict() or {}
    d["id"] = int(snap.id)
    return d


def _next_id(collection: str) -> int:
    """Transactionally increment and return the next integer ID."""
    db = get_client()
    counter_ref = db.collection("counters").document(collection)

    @fs.transactional
    def _txn(transaction: Transaction) -> int:
        snap = counter_ref.get(transaction=transaction)
        current = snap.to_dict().get("value", 0) if snap.exists else 0
        new_val = current + 1
        transaction.set(counter_ref, {"value": new_val})
        return new_val

    return _txn(db.transaction())


# ─── Projects ─────────────────────────────────────────────────────────────────

def create_project(
    name: str,
    domain: str,
    sensitive_columns: list[str],
    target_column: str | None,
    metric_priority: str,
    owner_uid: str,
    dataset_path: str | None = None,
    model_path: str | None = None,
    max_step: int = 1,
) -> dict[str, Any]:
    db = get_client()
    pid = _next_id("projects")
    data = {
        "name": name,
        "domain": domain,
        "sensitive_columns": sensitive_columns,
        "target_column": target_column,
        "metric_priority": metric_priority,
        "owner_uid": owner_uid,
        "dataset_path": dataset_path,
        "model_path": model_path,
        "max_step": max_step,
        "created_at": _now(),
    }
    db.collection("projects").document(str(pid)).set(data)
    data["id"] = pid
    return data


def get_project(project_id: int) -> dict[str, Any] | None:
    db = get_client()
    snap = db.collection("projects").document(str(project_id)).get()
    return _snap_to_dict(snap)


def get_owned_project(project_id: int, owner_uid: str) -> dict[str, Any] | None:
    project = get_project(project_id)
    if not project or project.get("owner_uid") != owner_uid:
        return None
    return project


def list_projects(owner_uid: str) -> list[dict[str, Any]]:
    db = get_client()
    snaps = db.collection("projects").where("owner_uid", "==", owner_uid).stream()
    results = []
    for snap in snaps:
        d = snap.to_dict() or {}
        d["id"] = int(snap.id)
        results.append(d)
    results.sort(key=lambda p: p.get("created_at", ""), reverse=True)
    return results


def update_project(project_id: int, **fields: Any) -> None:
    db = get_client()
    db.collection("projects").document(str(project_id)).update(fields)


def delete_project(project_id: int) -> None:
    """Delete project and all child records."""
    db = get_client()
    project_str = str(project_id)
    # Child collections to clean up
    for coll in ("audit_runs", "monitoring_logs", "monitoring_events", "alerts",
                 "mitigation_runs", "fairness_flags"):
        snaps = db.collection(coll).where("project_id", "==", project_id).stream()
        for snap in snaps:
            snap.reference.delete()
    db.collection("projects").document(project_str).delete()


# ─── Audit Runs ───────────────────────────────────────────────────────────────

def create_audit_run(
    project_id: int,
    fairness_score: float,
    accuracy: float,
    risk_level: str,
    decision: str,
    full_result_json: dict,
    task_id: str | None = None,
) -> dict[str, Any]:
    db = get_client()
    rid = _next_id("audit_runs")
    data = {
        "project_id": project_id,
        "fairness_score": fairness_score,
        "accuracy": accuracy,
        "risk_level": risk_level,
        "decision": decision,
        "full_result_json": full_result_json,
        "task_id": task_id,
        "timestamp": _now(),
    }
    db.collection("audit_runs").document(str(rid)).set(data)
    data["id"] = rid
    return data


def get_audit_run(audit_run_id: int) -> dict[str, Any] | None:
    db = get_client()
    snap = db.collection("audit_runs").document(str(audit_run_id)).get()
    return _snap_to_dict(snap)


def get_audit_run_by_task(task_id: str) -> dict[str, Any] | None:
    db = get_client()
    snaps = list(db.collection("audit_runs").where("task_id", "==", task_id).limit(1).stream())
    if not snaps:
        return None
    return _snap_to_dict(snaps[0])


def list_audit_runs(project_id: int) -> list[dict[str, Any]]:
    db = get_client()
    snaps = db.collection("audit_runs").where("project_id", "==", project_id).stream()
    results = []
    for snap in snaps:
        d = snap.to_dict() or {}
        d["id"] = int(snap.id)
        results.append(d)
    results.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
    return results


def latest_audit_run(project_id: int) -> dict[str, Any] | None:
    runs = list_audit_runs(project_id)
    return runs[0] if runs else None


def update_audit_run(audit_run_id: int, **fields: Any) -> None:
    db = get_client()
    db.collection("audit_runs").document(str(audit_run_id)).update(fields)


# ─── Monitoring ───────────────────────────────────────────────────────────────

def create_monitoring_log(project_id: int, fairness_score: float, key_metrics: dict) -> dict[str, Any]:
    db = get_client()
    lid = _next_id("monitoring_logs")
    data = {
        "project_id": project_id,
        "fairness_score": fairness_score,
        "data_drift_score": 0.0,
        "prediction_drift_score": 0.0,
        "key_metrics": key_metrics,
        "timestamp": _now(),
    }
    db.collection("monitoring_logs").document(str(lid)).set(data)
    data["id"] = lid
    return data


def list_monitoring_logs(project_id: int, limit: int | None = None) -> list[dict[str, Any]]:
    db = get_client()
    q = db.collection("monitoring_logs").where("project_id", "==", project_id)
    snaps = q.stream()
    results = []
    for snap in snaps:
        d = snap.to_dict() or {}
        d["id"] = int(snap.id)
        results.append(d)
    results.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
    if limit:
        results = results[:limit]
    return results


def create_monitoring_event(project_id: int, fairness_score: float, alert_triggered: bool, note: str, group_breakdown: dict | None = None) -> dict[str, Any]:
    db = get_client()
    eid = _next_id("monitoring_events")
    data = {
        "project_id": project_id,
        "fairness_score": fairness_score,
        "alert_triggered": alert_triggered,
        "note": note,
        "group_breakdown": group_breakdown,
        "timestamp": _now(),
    }
    db.collection("monitoring_events").document(str(eid)).set(data)
    data["id"] = eid
    return data


def list_monitoring_events(project_id: int, limit: int | None = None) -> list[dict[str, Any]]:
    db = get_client()
    snaps = db.collection("monitoring_events").where("project_id", "==", project_id).stream()
    results = []
    for snap in snaps:
        d = snap.to_dict() or {}
        d["id"] = int(snap.id)
        results.append(d)
    results.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
    if limit:
        results = results[:limit]
    return results


def delete_monitoring_events(project_id: int) -> None:
    db = get_client()
    snaps = db.collection("monitoring_events").where("project_id", "==", project_id).stream()
    for snap in snaps:
        snap.reference.delete()


# ─── Alerts ───────────────────────────────────────────────────────────────────

def create_alert(project_id: int, type: str, message: str, severity: str) -> dict[str, Any]:
    db = get_client()
    aid = _next_id("alerts")
    data = {
        "project_id": project_id,
        "type": type,
        "message": message,
        "severity": severity,
        "timestamp": _now(),
    }
    db.collection("alerts").document(str(aid)).set(data)
    data["id"] = aid
    return data


def list_alerts(project_id: int) -> list[dict[str, Any]]:
    db = get_client()
    snaps = db.collection("alerts").where("project_id", "==", project_id).stream()
    results = []
    for snap in snaps:
        d = snap.to_dict() or {}
        d["id"] = int(snap.id)
        results.append(d)
    results.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
    return results


# ─── Mitigation Runs ──────────────────────────────────────────────────────────

def create_mitigation_run(**fields: Any) -> dict[str, Any]:
    db = get_client()
    mid = _next_id("mitigation_runs")
    data = {"timestamp": _now(), **fields}
    db.collection("mitigation_runs").document(str(mid)).set(data)
    data["id"] = mid
    return data


def get_mitigation_run(mitigation_run_id: int) -> dict[str, Any] | None:
    db = get_client()
    snap = db.collection("mitigation_runs").document(str(mitigation_run_id)).get()
    return _snap_to_dict(snap)


def get_mitigation_run_by_task(task_id: str) -> dict[str, Any] | None:
    db = get_client()
    snaps = list(db.collection("mitigation_runs").where("task_id", "==", task_id).limit(1).stream())
    if not snaps:
        return None
    return _snap_to_dict(snaps[0])


def update_mitigation_run(mitigation_run_id: int, **fields: Any) -> None:
    db = get_client()
    db.collection("mitigation_runs").document(str(mitigation_run_id)).update(fields)


# ─── Fairness Flags ───────────────────────────────────────────────────────────

def create_flag(project_id: int, record_id: str, reason: str, flagged_by: str = "user") -> dict[str, Any]:
    db = get_client()
    fid = _next_id("fairness_flags")
    data = {
        "project_id": project_id,
        "record_id": record_id,
        "reason": reason,
        "flagged_by": flagged_by,
        "resolved": False,
        "timestamp": _now(),
    }
    db.collection("fairness_flags").document(str(fid)).set(data)
    data["id"] = fid
    return data


def get_flag(flag_id: int) -> dict[str, Any] | None:
    db = get_client()
    snap = db.collection("fairness_flags").document(str(flag_id)).get()
    return _snap_to_dict(snap)


def list_unresolved_flags(project_id: int) -> list[dict[str, Any]]:
    db = get_client()
    snaps = (
        db.collection("fairness_flags")
        .where("project_id", "==", project_id)
        .where("resolved", "==", False)
        .stream()
    )
    results = []
    for snap in snaps:
        d = snap.to_dict() or {}
        d["id"] = int(snap.id)
        results.append(d)
    return results


def update_flag(flag_id: int, **fields: Any) -> None:
    db = get_client()
    db.collection("fairness_flags").document(str(flag_id)).update(fields)


# ─── User State ───────────────────────────────────────────────────────────────

def get_user_state(uid: str) -> dict[str, Any]:
    db = get_client()
    snap = db.collection("user_state").document(uid).get()
    if not snap.exists:
        return {}
    return snap.to_dict() or {}


def set_user_state(uid: str, **fields: Any) -> dict[str, Any]:
    db = get_client()
    db.collection("user_state").document(uid).set(fields, merge=True)
    return get_user_state(uid)
