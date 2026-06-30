"""Firestore client singleton for BIAS LAB backend.

Credential resolution order:
  1. Individual FIREBASE_SA_* env vars (preferred — works on Render without
     any sidecar JSON file).
  2. Path pointed at by FIREBASE_ADMIN_KEY env var (default: firebase-admin.json
     relative to the backend directory) — kept for local dev convenience.

The service-account JSON must NOT be committed to git.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_DEFAULT_KEY = "firebase-admin.json"
_client = None


def _build_credentials() -> credentials.Certificate:
    """Return a Certificate credential.

    Prefer the individual FIREBASE_SA_* env vars so no JSON file is required
    on the server.  Fall back to the JSON file path for local development.
    """
    private_key = os.getenv("FIREBASE_SA_PRIVATE_KEY", "")

    if private_key:
        # Strip surrounding quotes that get included when copying from a .env file.
        # e.g. Render stores the value literally if pasted as: "-----BEGIN PRIVATE KEY-----\n..."
        private_key = private_key.strip().strip('"').strip("'")

        # Normalise \n: convert literal backslash-n sequences to real newlines.
        # Safe to call even if the key already has real newlines (no-op then).
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

    # Fallback: load from JSON file (local dev)
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
