"""User state router — cloud-backed session state."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from core.firebase_auth import get_current_user
from core import store

router = APIRouter(prefix="/user", tags=["user"])


class UserStatePatch(BaseModel):
    active_project_id: str | None = None
    active_analysis_task: str | None = None
    latest_task_id: str | None = None
    latest_mitigation_run_id: str | None = None


@router.get("/state")
async def get_state(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    return store.get_user_state(user["uid"])


@router.patch("/state")
async def patch_state(
    patch: UserStatePatch,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    data = patch.model_dump(exclude_unset=True)
    return store.set_user_state(user["uid"], **data)
