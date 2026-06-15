"""Firestore client singleton for BIAS LAB backend.

Reads key path from FIREBASE_ADMIN_KEY env var (default: firebase-admin.json
relative to the backend directory).

The service-account JSON must NOT be committed to git.
"""
from __future__ import annotations

import os
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_DEFAULT_KEY = "firebase-admin.json"
_client = None


def _key_path() -> str:
    configured = os.getenv("FIREBASE_ADMIN_KEY", _DEFAULT_KEY)
    p = Path(configured)
    if not p.is_absolute():
        p = _BACKEND_DIR / configured
    return str(p)


def get_client():
    """Return (and cache) the Firestore client."""
    global _client
    if _client is None:
        if not firebase_admin._apps:
            cred = credentials.Certificate(_key_path())
            firebase_admin.initialize_app(cred)
        _client = firestore.client()
    return _client
