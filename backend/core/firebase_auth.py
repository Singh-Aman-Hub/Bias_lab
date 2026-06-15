"""Firebase ID-token verification for FastAPI.

Design:
- Uses PyJWT + JWKS to verify RS256 Firebase ID tokens without Firebase Admin SDK.
- DISABLE_AUTH=1 bypasses verification for local dev only.
- Returns { uid, email } on success; raises HTTP 401 on failure.
"""
from __future__ import annotations

import os
from typing import Any

import jwt
from jwt import PyJWKClient
from fastapi import Header, HTTPException

_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "")
_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
_DISABLE_AUTH = os.getenv("DISABLE_AUTH", "0") == "1"

# Lazily initialized so it is not created at import time (avoids network call at startup)
_jwk_client: PyJWKClient | None = None


def _get_jwk_client() -> PyJWKClient:
    global _jwk_client
    if _jwk_client is None:
        _jwk_client = PyJWKClient(_JWKS_URL, cache_keys=True)
    return _jwk_client


async def get_current_user(authorization: str = Header(default="")) -> dict[str, Any]:
    """FastAPI dependency that extracts and verifies the Firebase ID token.

    Usage:
        @router.get("/...")
        async def handler(user: dict = Depends(get_current_user)):
            uid = user["uid"]
    """
    if _DISABLE_AUTH:
        # Local bypass — return a stable fake user so routers work without Firebase
        return {"uid": "local-dev-user", "email": "dev@localhost"}

    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header.")

    id_token = authorization.removeprefix("Bearer ").strip()

    try:
        signing_key = _get_jwk_client().get_signing_key_from_jwt(id_token)
        claims = jwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=_PROJECT_ID,
            issuer=f"https://securetoken.google.com/{_PROJECT_ID}",
            options={"require": ["exp", "iat", "sub"]},
        )
        uid: str = claims["sub"]
        email: str = claims.get("email", "")
        return {"uid": uid, "email": email}

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Firebase token has expired.")
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid Firebase token: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Token verification failed: {exc}")
