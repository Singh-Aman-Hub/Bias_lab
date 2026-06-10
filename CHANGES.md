# What Changed — Session Overview

A detailed summary of everything changed since the last baseline commit (`4a06b8b`),
so you can review the work at a glance instead of reading every diff.

**At a glance:** the UI was rebranded from a templated copper/serif look to a focused
"Instrument" design system, the 9-step workflow was made waterproof (6 real bugs fixed),
a new-user onboarding guide was added, animations were trimmed for performance, and every
page's buttons/links were audited and dead controls fixed.

---

## 🆕 Newly added

| File | What it is |
|------|------------|
| `frontend/src/components/DisparityBar.tsx` | **Signature visualization** — paired group bars that highlight the disparity *gap* between groups (the core idea of the product), risk-colored, with monospace values. Used on Step 3 and Step 4. |
| `frontend/src/components/GettingStarted.tsx` | **New-user onboarding guide** — a progress-aware 5-step checklist on the Dashboard that detects where the user is (no project → data → configured → analyzed → reviewed) and surfaces the next action as a button. |
| `backend/requirements-dev.txt` | Declares `pytest` so the test suite is reproducible (39 tests pass). |
| `CHANGES.md` | This overview document. |

## 🗑️ Removed

| File | Why |
|------|-----|
| `frontend/src/components/animations/BackgroundGrid.tsx` | An always-on animated grid that ran on **every** workflow page — pure GPU/battery cost, no value for a serious audit tool. |
| `frontend/src/components/animations/DataFlowEffect.tsx` | Dead/unused animation component. |
| Landing "Login" button, hero "Book a Demo" button, 6 placeholder footer links | Dead controls with no handlers / `href="#"` (see "Button audit" below). |

---

## 🎨 Changed — Design system (the rebrand)

The biggest visual change. The old look (Cinzel serif + copper `#D4A373` on near-black,
"big number + gradient" cards) read as a generic template. Replaced with the **"Instrument"**
direction — a forensic-measurement aesthetic.

- **`frontend/src/styles/globals.css`** — new token system: ink/slate palette, a single
  **instrument-cyan** accent (`#34D6C4`) for interaction, and **semantic Red/Amber/Green
  reserved strictly for risk**. Fixed broken pill/banner colors (previously "green" rendered
  as copper and "yellow" as red). Big metric numbers are now monospace ("readout" style).
- **Typography** — dropped Cinzel/Josefin → **Geist** everywhere, with **JetBrains Mono for
  all data/metrics**.
- **`frontend/src/components/hero/ExperienceScene.tsx` + `hero.css`** — recolored the 3D hero
  to morph *chaos → biased (red) → trust (cyan)*, and reduced particles 3000→1200 (it was
  already lazy-loaded and reduced-motion aware).
- Every component carrying inline colors was remapped to the new palette for consistency
  (charts, cards, tables, badges, gauges, etc.).

## 🔧 Changed — Workflow correctness (6 real bugs fixed)

| Where | Bug | Fix |
|-------|-----|-----|
| All steps | Step counters said **"of 8"** while the bar said "of 9" | Corrected to "of 9" everywhere |
| **Step 2** (`Step2Config`, `AppContext`) | Model-upload field was a **no-op** — selected `.pkl`/`.joblib` was silently discarded and never sent to the backend | Wired end-to-end so a custom model now reaches the analysis pipeline |
| **Step 3** (`Step3DataAudit`) | "Data Fairness Score" was **always 88** — it compared a risk level against values the backend never emits | Now uses the backend's authoritative score, with human-readable risk labels |
| **Step 4** (`Step4ModelBias`) | Re-derived its own score instead of the backend's | Uses the backend `fairness_score` |
| **Step 7** (`Step7StressTest`) | "Run" was not awaited → loading state broken, errors swallowed | Awaited with proper loading + error handling |
| **Step 8** (`Step8Sandbox`) | "Finish" skipped to the dashboard and left **Step 9 (Monitoring) permanently locked/unreachable** | Now advances to Step 9 |

## ✨ Changed — Onboarding & UX

- **Dashboard** (`Dashboard.tsx`) — empty state now leads with the onboarding guide; the
  no-project call-to-action is a proper disabled state instead of a fake button.
- **Accessibility** (`WorkflowShell.tsx`) — added `aria-current`/`aria-disabled` to the
  navigation; Step 9's fixed-width grids made responsive.
- **DisparityBar** wired into Step 3 (positive-rate-by-group) and Step 4 (approval-rate-by-group).

## 🌐 Changed — Landing page (credibility + button audit)

- **`Trust.tsx`** — replaced fabricated "Trusted By" company logos and a fake testimonial
  ("Sarah Chen, TechFlow") with the **real** fairness methods implemented and the **real**
  public benchmark datasets (UCI Adult, ProPublica COMPAS).
- **`Header.tsx` / `Footer.tsx` / `UIOverlay.tsx`** — removed dead controls and pointed every
  remaining link to a real destination (repo, license, dataset sources).

## ⚙️ Changed — Backend

- `core/common.py`, `core/data_audit.py`, `core/dataset_loader.py`, `core/stress_test.py` —
  audit-engine refinements carried in the working tree (the `Red/Yellow/Green` risk vocabulary
  the frontend now aligns to).

---

## 🔘 Button & link audit (every page checked)

All pages and interactive controls were verified. **6 dead controls found and fixed**;
everything else was already wired correctly (Steps 1–9, ProjectSelector, Dashboard tiles,
workflow navigation).

- Removed: landing **Login** button (no auth), hero **Book a Demo** button (no handler).
- Fixed: **Documentation** link and **6 footer placeholder links** (`href="#"`) now point to
  real destinations.
- Relabeled inaccurate nav/footer "Case Studies"/"Customers" → "Methods".

**Flagged (not changed):** `frontend/src/pages/CreateProject.tsx` is a fully-built page that
is **not routed anywhere** — unreachable dead code (project creation happens via the top-bar
dropdown). Left in place pending a decision to route it or remove it.

---

## 📝 Notes

- Verification on every change: TypeScript compiles cleanly (`tsc --noEmit`), the production
  build succeeds, and the 39 backend tests pass.
- Intentionally **not** committed: `backend/unbiased_ai.db` (runtime data) and a one-character
  trailing-newline change in `README.md`.
