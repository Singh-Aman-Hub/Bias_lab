# BIAS LAB — Firebase Multi-User Auth + Firestore Cloud Persistence Implementation Guide

## Purpose

This README is the implementation blueprint for adding a **multi-user Firebase environment** to BIAS LAB.

The target behavior is:

1. Users can sign up, log in, log out, and log in with Google using Firebase Authentication.
2. Every private API request is authenticated with a Firebase ID token.
3. Every project, audit run, mitigation run, monitoring record, alert, and fairness flag is scoped to the logged-in user.
4. User A must never see, update, delete, or download User B's projects or audit outputs.
5. User state such as active project, active analysis task, latest task, and latest mitigation run must survive refresh and device changes through Firestore-backed cloud user state.
6. Persistent app data must move from local SQLite/server-local DB state to Firestore.
7. Existing API shapes should remain as stable as possible so the frontend does not need a full rewrite.

This guide is based on two reference commits:

- Commit 1: `feat: multi-user Firebase auth with per-user data isolation`
- Commit 2: `refactor: migrate storage from SQLite to Firestore + cloud user state`

The correct final implementation should combine both commits. The second commit is critical because the first commit added multi-user ownership on top of local SQLite, while the second commit moved the persistence layer into Firestore.

---

## The Core Lesson

Do **not** stop at Firebase login.

Firebase Authentication only answers:

```text
Who is this user?
```

It does not automatically answer:

```text
Which projects belong to this user?
Which audit runs can this user access?
Where are results stored permanently?
Can this data survive a backend restart or different device?
```

For BIAS LAB, you need three layers:

```text
Authentication  -> Firebase Auth verifies identity
Authorization   -> Backend checks ownership of project/run/flag
Persistence     -> Firestore stores cloud data, not local SQLite
```

The first commit solved authentication and user scoping. The second commit solved the storage/persistence problem.

---

## High-Level Architecture

```text
React Frontend
  |
  | Firebase Web SDK login
  | obtains Firebase ID token
  v
Axios / formApi interceptor
  |
  | Authorization: Bearer <Firebase ID token>
  v
FastAPI Backend
  |
  | verifies Firebase token
  | extracts uid/email
  v
Authorization layer
  |
  | validates requested project/audit/run/flag belongs to uid
  v
Firestore Store Repository
  |
  | projects
  | audit_runs
  | mitigation_runs
  | monitoring_logs
  | monitoring_events
  | alerts
  | fairness_flags
  | user_state
  | counters
```

---

## Final Target Stack

### Frontend

- Firebase Web SDK
- React `AuthContext`
- Email/password signup and login
- Google sign-in
- Route gating
- Logout button
- Axios token interceptor
- Cloud-backed user state through `/api/user/state`

### Backend

- FastAPI
- Firebase ID token verification
- PyJWT for verifying Firebase Auth ID tokens
- Firebase Admin SDK for Firestore
- Firestore repository layer
- Ownership helper layer
- Router-wide authentication dependencies
- Per-resource authorization checks

### Cloud Persistence

Firestore stores:

- `projects`
- `audit_runs`
- `mitigation_runs`
- `monitoring_logs`
- `monitoring_events`
- `alerts`
- `fairness_flags`
- `user_state`
- `counters`

### Important Limitation

The reference Firestore migration still keeps uploaded CSV/model files on the backend disk.

So the reference design is:

```text
Firestore = application records, metadata, result JSON, user state
Backend disk = uploaded CSV/model files and generated CSV outputs
```

This is acceptable for local/MVP if matching the reference commit. But on Render/stateless hosting, backend disk may be ephemeral. For full cloud portability, add Firebase Storage or Google Cloud Storage later.

Do **not** store large CSV files inside Firestore documents. Store files in object storage; store metadata and paths in Firestore.

---

# Phase 1 — Frontend Firebase Auth

## 1. Install Firebase Web SDK

```bash
cd frontend
npm install firebase
```

Expected dependency:

```json
"firebase": "^12.14.0"
```

## 2. Add frontend environment variables

Create/update `frontend/.env`:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MEASUREMENT_ID=...
```

Update `frontend/src/vite-env.d.ts`:

```ts
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

## 3. Add `frontend/src/firebase.ts`

```ts
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
```

The Firebase web `apiKey` is not a secret. Backend token verification and ownership checks provide real security.

## 4. Add `frontend/src/context/AuthContext.tsx`

Purpose:

- Track Firebase user
- Expose login/signup/google/logout helpers
- Block app rendering until Firebase has resolved persisted auth state

Required interface:

```ts
interface AuthContextType {
  user: User | null;
  loading: boolean;
  signup: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}
```

Use:

```ts
onAuthStateChanged
signInWithEmailAndPassword
createUserWithEmailAndPassword
signInWithPopup
signOut
```

Expose:

```ts
export function useAuth(): AuthContextType
```

## 5. Wrap app with `AuthProvider`

In `frontend/src/main.tsx`:

```tsx
<AuthProvider>
  <AppProvider>
    <ChatProvider>
      <App />
    </ChatProvider>
  </AppProvider>
</AuthProvider>
```

`AuthProvider` must wrap `AppProvider` because `AppContext` needs `useAuth()`.

## 6. Add Login page

Create `frontend/src/pages/Login.tsx`.

Features:

- Email input
- Password input
- Login mode
- Signup mode
- Google login button
- Error display
- Loading state

Use:

```ts
const { login, signup, loginWithGoogle } = useAuth();
```

## 7. Gate routes in `App.tsx`

Behavior:

- `/login` is public.
- Landing page `/` can remain public if desired.
- Everything below workflow/dashboard requires login.
- Chatbot should render only for logged-in users.
- While Firebase auth state is loading, show existing loading animation.

Example:

```tsx
const { user, loading: authLoading } = useAuth();

if (authLoading) {
  return <AnalysisLoading />;
}
```

Login route:

```tsx
<Route
  path="/login"
  element={user ? <Navigate to="/dashboard" replace /> : <Login />}
/>
```

Protected app route:

```tsx
<Route
  path="/*"
  element={
    !user ? (
      <Navigate to="/login" replace />
    ) : (
      <WorkflowShell>
        ...
      </WorkflowShell>
    )
  }
/>
```

---

# Phase 2 — Frontend API Token Attachment

Update `frontend/src/api/client.ts`.

Every private API request must carry:

```http
Authorization: Bearer <Firebase ID token>
```

Use an Axios interceptor for both `api` and `formApi`:

```ts
api.interceptors.request.use(async (config) => {
  const user = auth.currentUser;

  if (user) {
    const token = await user.getIdToken();
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});
```

Repeat for `formApi`.

Replace direct `axios` calls with `api` or `formApi`.

Bad:

```ts
axios.post('http://localhost:8000/api/mitigate/export-as-project', formData)
```

Good:

```ts
formApi.post('/mitigate/export-as-project', formData)
```

This prevents missing-token bugs.

---

# Phase 3 — Backend Firebase Token Verification

## 1. Add backend dependencies

In `backend/requirements.txt`:

```text
PyJWT>=2.8
cryptography
firebase-admin>=6.5
```

## 2. Add backend environment variables

In backend `.env`:

```env
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_ADMIN_KEY=firebase-admin.json
```

For local bypass only:

```env
DISABLE_AUTH=1
```

Never use `DISABLE_AUTH=1` in production.

## 3. Add `.gitignore` protections

```gitignore
# Firebase Admin service-account keys (SECRET — never commit)
*firebase-adminsdk*.json
backend/firebase-admin.json
backend/*-firebase-adminsdk-*.json
```

## 4. Add `backend/core/firebase_auth.py`

Purpose:

- Verify Firebase ID token from `Authorization` header
- Return `{ uid, email }`
- Support local bypass with `DISABLE_AUTH=1`

Core design:

```python
PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "")
_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
_jwk_client = PyJWKClient(_JWKS_URL)
```

Verification:

```python
jwt.decode(
    id_token,
    signing_key.key,
    algorithms=["RS256"],
    audience=PROJECT_ID,
    issuer=f"https://securetoken.google.com/{PROJECT_ID}",
    options={"require": ["exp", "iat", "sub"]},
)
```

Dependency:

```python
async def get_current_user(authorization: str = Header(default="")) -> dict[str, Any]:
    ...
    return {"uid": uid, "email": claims.get("email", "")}
```

---

# Phase 4 — Firestore Persistence Migration

This is the important second-commit correction.

## 1. Add `backend/core/firestore_db.py`

Purpose:

- Initialize Firebase Admin SDK
- Return cached Firestore client
- Use service-account key

Recommended:

```python
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
    global _client
    if _client is None:
        if not firebase_admin._apps:
            cred = credentials.Certificate(_key_path())
            firebase_admin.initialize_app(cred)
        _client = firestore.client()
    return _client
```

## 2. Add `backend/core/store.py`

Purpose:

Replace SQLAlchemy/SQLite calls with Firestore repository functions.

Collections:

```text
projects
audit_runs
monitoring_logs
monitoring_events
alerts
mitigation_runs
fairness_flags
user_state
counters
```

Keep integer IDs using a transactional `counters` collection so existing URL params do not require a full rewrite.

Required repository functions:

```python
create_project(...)
get_project(project_id)
get_owned_project(project_id, owner_uid)
list_projects(owner_uid)
update_project(project_id, **fields)
delete_project(project_id)

create_audit_run(...)
get_audit_run(audit_run_id)
get_audit_run_by_task(task_id)
list_audit_runs(project_id)
latest_audit_run(project_id)
update_audit_run(audit_run_id, **fields)

create_monitoring_log(...)
list_monitoring_logs(project_id, limit=None)
create_monitoring_event(...)
list_monitoring_events(project_id, limit=None)
delete_monitoring_events(project_id)

create_alert(project_id, type, message, severity)
list_alerts(project_id)

create_mitigation_run(**fields)
get_mitigation_run(mitigation_run_id)
get_mitigation_run_by_task(task_id)
update_mitigation_run(mitigation_run_id, **fields)

create_flag(project_id, record_id, reason, flagged_by="user")
get_flag(flag_id)
list_unresolved_flags(project_id)
update_flag(flag_id, **fields)

get_user_state(uid)
set_user_state(uid, **fields)
```

---

# Phase 5 — Backend Authorization Layer

Add `backend/core/authz.py`.

Purpose: ownership checks.

Use `404`, not `403`, for unauthorized resources so users cannot enumerate IDs.

```python
from core import store
from fastapi import HTTPException


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
```

---

# Phase 6 — Update FastAPI `main.py`

Remove SQLite startup:

```python
# remove Base.metadata.create_all(bind=engine)
```

Warm Firestore instead:

```python
from core.firestore_db import get_client

@app.on_event("startup")
def startup_seed() -> None:
    get_client()
```

Add auth dependency:

```python
from fastapi import Depends
from core.firebase_auth import get_current_user

_auth = [Depends(get_current_user)]
```

Protect routers:

```python
app.include_router(audit.router, prefix="/api", dependencies=_auth)
app.include_router(bias.router, prefix="/api", dependencies=_auth)
app.include_router(fixes.router, prefix="/api", dependencies=_auth)
app.include_router(sandbox.router, prefix="/api", dependencies=_auth)
app.include_router(monitoring.router, prefix="/api", dependencies=_auth)
app.include_router(colab.router, prefix="/api", dependencies=_auth)
app.include_router(gemini_narrative.router, prefix="/api", dependencies=_auth)
app.include_router(chat.router, prefix="/api", dependencies=_auth)
app.include_router(pattern_review.router, prefix="/api", dependencies=_auth)
app.include_router(mitigate.router, prefix="/api", dependencies=_auth)
app.include_router(user.router, prefix="/api", dependencies=_auth)
```

Special:

```python
app.include_router(project.router, prefix="/api")
app.include_router(pipeline.router, prefix="/api")
app.include_router(datasets.router, prefix="/api")  # public sample data
```

`project` and `pipeline` can declare auth per endpoint because some pipeline status/result endpoints may intentionally remain token-free due to unguessable UUID task IDs.

---

# Phase 7 — Update Routers

## Project Router

- Create projects with `owner_uid=user["uid"]`.
- List only current user's projects.
- Get/update/delete only owned projects.
- Latest result only for owned project.
- Delete project should also delete child Firestore records through `store.delete_project(project_id)`.

## Pipeline Router

- `run_all` must require logged-in user.
- Pass `owner_uid=user["uid"]` into background worker.
- Auto-created project must store owner UID.
- Existing project ID must be ownership-checked.
- Save audit runs to Firestore through `store.create_audit_run`.
- Save monitoring logs/alerts through `store.create_monitoring_log` and `store.create_alert`.
- Recover task results from Firestore through `store.get_audit_run_by_task(task_id)`.

Important: uploaded CSVs can still be saved to backend disk for now, but the path must be stored in Firestore project record.

## Audit Router

- Require logged-in user.
- `require_project(project_id, user)` before audit work.

## Monitoring Router

- Require ownership for history/simulate/ingest.
- Replace DB calls with `store` calls.

## Mitigation Router

All endpoints must ownership-check:

```text
GET /mitigation/candidates/{audit_run_id}
POST /mitigation/apply
GET /mitigation/status/{task_id}
GET /mitigation/result/{mitigation_run_id}
GET /mitigation/download/{mitigation_run_id}
```

Never download a file until the mitigation run ownership is verified.

## Pattern Review / Fairness Flags

Use:

```python
require_project(project_id, user)
require_flag(flag_id, user)
```

---

# Phase 8 — Add User State Router

Create `backend/routers/user.py`.

Endpoints:

```http
GET /api/user/state
PATCH /api/user/state
```

Schema:

```python
class UserStatePatch(BaseModel):
    active_project_id: str | None = None
    active_analysis_task: str | None = None
    latest_task_id: str | None = None
    latest_mitigation_run_id: str | None = None
```

Handlers:

```python
@router.get("/state")
async def get_state(user: dict[str, Any] = Depends(get_current_user)):
    return store.get_user_state(user["uid"])

@router.patch("/state")
async def patch_state(patch: UserStatePatch, user: dict[str, Any] = Depends(get_current_user)):
    data = patch.model_dump(exclude_unset=True)
    return store.set_user_state(user["uid"], **data)
```

---

# Phase 9 — Frontend AppContext Cloud State Migration

Remove user-specific localStorage bookmarks.

Old likely keys:

```text
active_project_id
active_analysis_task
latest_task_id
latest_mitigation_run_id
max_step_{project_id}
```

Use `/api/user/state` instead.

Add helpers:

```ts
const fetchUserState = async () => {
  const res = await api.get('/user/state');
  return res.data;
};

const persistUserState = async (patch: Partial<UserState>) => {
  await api.patch('/user/state', patch);
};
```

On login:

1. Fetch `/user/state`.
2. Restore active project/task/mitigation IDs.
3. Refresh projects for that user.
4. Resume workflow if relevant.

On logout:

Clear all user-scoped React state:

- projects
- projectId
- pipelineResults
- active task IDs
- latest task IDs
- mitigation IDs

No previous user's data should remain visible after logout.

Persist changes:

```ts
persistUserState({ active_project_id: projectId ?? null });
persistUserState({ active_analysis_task: taskId });
persistUserState({ active_analysis_task: null, latest_task_id: taskId });
persistUserState({ latest_mitigation_run_id: mitigationRunId });
```

Use a `userStateLoaded` ref so hydration does not immediately echo-write stale/null values back to Firestore.

---

# Phase 10 — Testing Checklist

## Authentication

- Email signup works.
- Email login works.
- Google login works.
- Logout clears UI state.
- Refresh keeps logged-in session.
- Unauthenticated protected routes redirect to `/login`.

## API Token

- Requests include `Authorization: Bearer <token>`.
- Expired/missing token returns 401.
- `DISABLE_AUTH=1` works only locally.

## Data Isolation

- User A sees only User A projects.
- User B sees only User B projects.
- Guessing another project ID returns 404.
- Guessing another audit run ID returns 404.
- Guessing another mitigation run ID returns 404.
- Guessing another flag ID returns 404.

## Firestore Persistence

- Project appears in Firestore.
- Audit run appears in Firestore.
- Monitoring logs appear in Firestore.
- Mitigation runs appear in Firestore.
- User state appears under `user_state/{uid}`.
- Reload restores active project.
- Login from another browser restores active project.

## Pipeline

- `/pipeline/run-all` requires login.
- Auto Project is created with owner UID.
- Audit result is written to Firestore.
- Status/result can recover after backend restart through Firestore task lookup.

## Mitigation

- Candidate endpoint checks audit ownership.
- Apply endpoint checks project and audit ownership.
- Status endpoint checks mitigation run ownership.
- Result endpoint checks mitigation run ownership.
- Download endpoint checks mitigation run ownership before streaming file.

## Regression

Do not break:

- attribute-aware default model training
- counterfactual age binning
- counterfactual truthful flip card
- model bias output-collapse warning
- 9-step workflow count
- analysis progress screen timing fix
- mitigation separation from explanation page
- safe mitigated dataset copy behavior

---

# Expected Changed Files

## Frontend

```text
frontend/package.json
frontend/package-lock.json
frontend/src/firebase.ts
frontend/src/context/AuthContext.tsx
frontend/src/pages/Login.tsx
frontend/src/main.tsx
frontend/src/App.tsx
frontend/src/api/client.ts
frontend/src/context/AppContext.tsx
frontend/src/components/WorkflowShell.tsx
frontend/src/vite-env.d.ts
```

Possibly:

```text
frontend/src/pages/workflow/Step8Sandbox.tsx
frontend/src/pages/workflow/Step9MitigationResults.tsx
```

Only if they use localStorage or direct axios calls.

## Backend

```text
backend/requirements.txt
backend/core/firebase_auth.py
backend/core/firestore_db.py
backend/core/store.py
backend/core/authz.py
backend/core/monitoring.py
backend/main.py
backend/routers/project.py
backend/routers/pipeline.py
backend/routers/audit.py
backend/routers/monitoring.py
backend/routers/mitigate.py
backend/routers/pattern_review.py
backend/routers/user.py
backend/.gitignore
```

Stop using:

```text
backend/models/db.py
backend/unbiased_ai.db
```

Only if doing full Firestore migration.

---

# Final Agent Command

```text
Implement Firebase multi-user authentication and Firestore-backed persistence in BIAS LAB using the two attached reference commits as blueprint.

Use commit 40e3691 for:
- Firebase Web SDK frontend login/signup/Google login/logout
- AuthContext
- route gating
- axios/formApi ID-token interceptor
- backend Firebase ID-token verification
- router-wide login enforcement
- per-resource ownership checks

Use commit 56df49e for:
- migrating persistence from SQLite/models/db.py to Firestore
- adding core/firestore_db.py
- adding core/store.py
- replacing SQLAlchemy DB reads/writes in project, pipeline, audit, monitoring, mitigation, and pattern-review routers
- adding Firestore-backed user_state
- replacing frontend localStorage bookmarks with GET/PATCH /api/user/state
- keeping integer IDs through Firestore counters so the API shape stays mostly unchanged

Important:
Do not stop after Firebase login only. The first commit still stores records in SQLite/server-local DB. The target implementation must use Firestore for app persistence.

Do not store large CSV/model files directly in Firestore. For now, keep uploaded files on backend disk and store paths in Firestore, matching the reference commit. If full cloud file persistence is required later, use Firebase Storage / Google Cloud Storage as a separate phase.

Preserve all recent project fixes:
- default model training must remain attribute-aware
- counterfactual fixes must remain
- model bias output-collapse fixes must remain
- 9-step workflow count must remain
- analysis progress timing fix must remain
- mitigation pages must remain logically unchanged

Before coding:
1. Inspect current codebase.
2. List current files that still import SQLAlchemy/models/db.py.
3. List current frontend localStorage keys related to project/task/mitigation state.
4. List direct axios calls that bypass api/formApi.
5. Then implement in the phase order described in this README.

After coding:
1. Provide final changed-files list.
2. Confirm authentication works.
3. Confirm User A cannot see User B data.
4. Confirm audit results persist in Firestore.
5. Confirm active project/task state persists across refresh/login.
6. Confirm no Firebase Admin service account JSON is committed.
```

---

## Strong Warning

This migration is not “just login.”

If the agent only adds Firebase Auth and leaves SQLite/local server persistence as-is, it has not completed the job. That would be like putting a biometric lock on a suitcase with a hole cut in the bottom. Looks secure. Very dramatic. Still leaks everything.
