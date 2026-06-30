"""Firestore client singleton for BIAS LAB backend.

Credential resolution order:
  1. FIREBASE_CREDENTIALS_B64 — the entire service-account JSON, base64-encoded.
     Preferred for Render: one opaque string, no newline/quote mangling.
     Generate with: base64 -i firebase-admin.json | tr -d '\\n'
  2. Individual FIREBASE_SA_* env vars — fallback, kept for compatibility.
  3. JSON file path (FIREBASE_ADMIN_KEY / firebase-admin.json) — local dev only.

The service-account JSON must NOT be committed to git.
"""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_DEFAULT_KEY = "firebase-admin.json"
_client = None


def _build_credentials() -> credentials.Certificate:
    """Return a Certificate credential using the best available source."""

    # ── Option 1: base64-encoded full JSON (safest for Render) ──────────────
    b64 = os.getenv("FIREBASE_CREDENTIALS_B64", "").strip()
    if b64:
        sa_info = json.loads(base64.b64decode(b64).decode("utf-8"))
        return credentials.Certificate(sa_info)

    # ── Option 2: individual FIREBASE_SA_* env vars ──────────────────────────
    private_key = os.getenv("FIREBASE_SA_PRIVATE_KEY", "").strip().strip('"').strip("'")
    if private_key:
        private_key = private_key.replace("\\n", "\n")
        sa_info = {
            "type": os.environ["FIREBASE_SA_TYPE"],
            "project_id": os.environ["FIREBASE_SA_PROJECT_ID"],
            "private_key_id": os.environ["FIREBASE_SA_PRIVATE_KEY_ID"],
            "private_key": private_key,
            "client_email": os.environ["FIREBASE_SA_CLIENT_EMAIL"],
            "client_id": os.environ["FIREBASE_SA_CLIENT_ID"],
            "auth_uri": os.environ["FIREBASE_SA_AUTH_URI"],
            "token_uri": os.environ["FIREBASE_SA_TOKEN_URI"],
            "auth_provider_x509_cert_url": os.environ["FIREBASE_SA_AUTH_PROVIDER_CERT_URL"],
            "client_x509_cert_url": os.environ["FIREBASE_SA_CLIENT_CERT_URL"],
            "universe_domain": os.getenv("FIREBASE_SA_UNIVERSE_DOMAIN", "googleapis.com"),
        }
        return credentials.Certificate(sa_info)

    # ── Option 3: JSON file path (local dev fallback) ────────────────────────
    configured = os.getenv("FIREBASE_ADMIN_KEY", _DEFAULT_KEY)
    p = Path(configured)
    if not p.is_absolute():
        p = _BACKEND_DIR / configured
    return credentials.Certificate(str(p))


def get_client():
    """Return (and cache) the Firestore client."""
    global _client
    if _client is None:
        if not firebase_admin._apps:
            firebase_admin.initialize_app(_build_credentials())
        _client = firestore.client()
    return _client
