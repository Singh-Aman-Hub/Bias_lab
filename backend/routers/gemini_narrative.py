"""Gemini-powered narrative report generator.

Requires the GEMINI_API_KEY environment variable to be set.
Endpoint returns an English-readable summary of fairness audit results.
"""

from __future__ import annotations

import json
import os
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from core.llm_client import generate_with_fallback, APIKeyExhaustedError
from core import store

router = APIRouter(prefix="/narrative", tags=["narrative"])


def _build_prompt(results: dict[str, Any]) -> str:
    scores = results.get("scores", {})
    fairness_score = results.get("fairness_score", "N/A")
    decision = results.get("decision", "N/A")
    recommendations = results.get("recommendations", [])
    explain_summary = results.get("explain_summary", "")

    recs_text = "\n".join(
        f"- {r.get('title', '')}: {r.get('description', '')}" for r in recommendations
    ) or "No specific recommendations."

    prompt = f"""You are a fairness compliance analyst. Write a concise executive summary of the following AI fairness audit results. Use plain English suitable for a compliance officer or non-technical stakeholder.

Fairness Score: {fairness_score}/100
Overall Decision: {decision}

Scores by Dimension:
- Data Bias: {scores.get('data_bias_score', 'N/A')}/100
- Model Bias: {scores.get('model_bias_score', 'N/A')}/100
- Proxy Risk: {scores.get('proxy_risk_score', 'N/A')}/100
- Counterfactual: {scores.get('counterfactual_score', 'N/A')}/100
- Stress Test: {scores.get('stress_test_score', 'N/A')}/100

Recommendations:
{recs_text}

SHAP Summary: {explain_summary or 'Not available.'}

Write 3-4 paragraphs covering: (1) overall risk assessment, (2) key fairness gaps found, (3) recommended remediation steps, (4) operational impact. Do not use technical jargon without explaining it."""
    return prompt


class ExplainMetricRequest(BaseModel):
    """One already-computed metric the LLM should explain (never compute)."""

    metric: str                       # machine key, e.g. "predictive_parity_difference"
    label: str                        # human label, e.g. "Predictive Parity Gap"
    value: float | str | None = None  # the computed value as shown on the card
    interpretation: str | None = None  # the engine's verdict, e.g. "High disparity"
    domain: str | None = None         # audit context, e.g. "hiring"
    facts: dict[str, Any] = {}         # grounding data: group rates, suspected proxy, thresholds...


def _build_metric_prompt(req: ExplainMetricRequest) -> str:
    """Build a STRICTLY-GROUNDED prompt. The LLM only explains the numbers we pass in —
    it must never decide whether bias exists or invent any statistic."""
    facts_json = json.dumps(req.facts, indent=2, default=str) if req.facts else "{}"
    value_str = "not provided" if req.value is None else str(req.value)
    return f"""You are a fairness analyst explaining ONE already-computed metric to a non-technical user.

You are NOT deciding whether bias exists — a separate statistical engine already computed every number below. Your ONLY job is to explain those numbers in plain English.

STRICT RULES:
- Use ONLY the numbers provided below. Never invent, estimate, or assume any statistic.
- If a fact needed for a point is missing, skip that point — do not guess.
- No jargon without a plain-language gloss. No markdown headings. 4-6 short sentences total.

METRIC: {req.label} ({req.metric})
COMPUTED VALUE: {value_str}
ENGINE VERDICT: {req.interpretation or "not provided"}
AUDIT DOMAIN: {req.domain or "general"}
SUPPORTING FACTS (the only data you may cite):
{facts_json}

In one short plain-English paragraph, cover whichever of these the facts support:
1) what this metric means, 2) why this particular value is or isn't a concern,
3) which group is most affected, 4) which feature may be responsible,
5) one concrete next step the user could take."""


class ExplainBatchRequest(BaseModel):
    """Many already-computed metrics to explain in ONE Gemini call (pre-fetch on analysis)."""

    items: list[ExplainMetricRequest]
    project_id: str | int | None = None


def _build_batch_prompt(items: list[ExplainMetricRequest]) -> str:
    """One prompt covering every metric. Returns a JSON object keyed by metric id,
    each value being a rich structured explanation object."""
    blocks = []
    for it in items:
        facts_json = json.dumps(it.facts, default=str) if it.facts else "{}"
        value_str = "not provided" if it.value is None else str(it.value)
        blocks.append(
            f'- id "{it.metric}" | label: "{it.label}" | value: {value_str} | '
            f'verdict: {it.interpretation or "n/a"} | domain: {it.domain or "general"} | facts: {facts_json}'
        )
    metrics_block = "\n".join(blocks)
    return f"""You are a fairness analyst explaining ALREADY-COMPUTED audit metrics to a non-technical compliance officer.

A separate statistical engine computed every number below. You are NOT deciding whether bias exists — you ONLY explain what the numbers mean in plain English.

STRICT RULES:
- Use ONLY the numbers in each item's facts. Never invent, estimate, or assume a statistic.
- If a fact needed for a point is missing, skip that point — do not guess.
- Use cautious language: "may indicate", "should be reviewed", "possible disparity", "not conclusive on its own", "requires domain validation".
- Never claim definite discrimination. Never give legal advice.
- Be specific and contextual — avoid generic text like "This metric shows fairness across groups."
- Mention actual values and affected groups when available.

For each metric, return a JSON object with these 6 fields:
  "plain_summary"              - One sentence (≤ 20 words) non-technical summary for non-experts.
  "technical_meaning"          - 1-2 sentences defining what this metric mathematically measures.
  "current_value_interpretation" - 2-3 sentences interpreting this specific computed value and what it signals.
  "affected_groups"            - Which group(s) are most affected, if data is available. Otherwise "Not available from current data."
  "risk_reason"                - 1-2 sentences explaining why this value is low/moderate/high risk and what threshold was used.
  "recommended_review"         - 1 actionable sentence the user should do next.

AUDIT DOMAIN: {items[0].domain if items else "general"}

METRICS TO EXPLAIN:
{metrics_block}

Return ONLY a valid JSON object mapping each metric id (exactly as written in quotes above) to an object with those 6 fields.
Example format:
{{"some_metric_id": {{"plain_summary": "...", "technical_meaning": "...", "current_value_interpretation": "...", "affected_groups": "...", "risk_reason": "...", "recommended_review": "..."}}, ...}}"""


# _generate_with_gemini function removed, using core.llm_client.generate_with_fallback instead


def _safe_generate(prompt: str, *, key_missing_msg: str) -> dict[str, str]:
    """Run a prompt through Gemini with graceful degradation. The explanation is a bonus
    layer — if the key/package/quota isn't there, return a clear status, never an exception."""
    try:
        return {"explanation": generate_with_fallback(prompt), "status": "ok"}
    except ValueError:
        return {"explanation": key_missing_msg, "status": "api_key_missing"}
    except ImportError:
        return {
            "explanation": "AI explanations need the google-genai package. Run: pip install google-genai",
            "status": "import_error",
        }
    except APIKeyExhaustedError as exc:
        error_str = str(exc)
        if "429" in error_str or "quota" in error_str.lower():
            return {
                "explanation": "The AI explanation service is rate-limited right now (all available keys exhausted). Please wait a minute and try again.",
                "status": "rate_limited",
            }
        return {"explanation": f"AI explanation authentication error: {error_str}", "status": "error"}
    except Exception as exc:
        return {"explanation": f"AI explanation error: {str(exc)}", "status": "error"}


@router.post("/explain-metric")
def explain_metric(req: ExplainMetricRequest) -> dict[str, str]:
    """Explain ONE already-computed metric in plain English. The value and supporting facts
    come from the deterministic pipeline — the LLM only narrates them, it never decides bias."""
    result = _safe_generate(
        _build_metric_prompt(req),
        key_missing_msg=(
            "Plain-English AI explanations need a Gemini API key. Set GEMINI_API_KEY on the "
            "server (free key at https://aistudio.google.com/apikey) to enable them."
        ),
    )
    result["metric"] = req.metric
    return result


@router.post("/explain-batch")
def explain_batch(req: ExplainBatchRequest) -> dict[str, Any]:
    """Explain MANY metrics in a single Gemini call. Returns structured explanation objects
    keyed by metric id. The frontend pre-fetches this once after analysis so each
    'Explain this' click is an instant cache read, not a new API call."""
    if not req.items:
        return {"explanations": {}, "status": "ok"}

    try:
        raw = generate_with_fallback(_build_batch_prompt(req.items), as_json=True)
        data = json.loads(raw)
        # Accept both legacy string values and new structured dict values
        explanations: dict[str, Any] = {}
        for k, v in data.items():
            if isinstance(v, dict):
                # New structured format: {plain_summary, technical_meaning, ...}
                explanations[str(k)] = v
            elif isinstance(v, (str, int, float)):
                # Legacy plain-string format — wrap in a minimal structure
                explanations[str(k)] = {"plain_summary": str(v)}
                
        # --- NEW CODE TO SAVE TO DB ---
        if req.project_id:
            try:
                run = store.latest_audit_run(int(req.project_id))
                if run and run.get("full_result_json"):
                    full_result = run["full_result_json"]
                    full_result["explain_batch_cache"] = explanations
                    store.update_audit_run(run["id"], full_result_json=full_result)
            except Exception as e:
                pass # Just ignore if caching fails
        # ------------------------------

        return {"explanations": explanations, "status": "ok"}
    except ImportError:
        return {"explanations": {}, "status": "import_error"}
    except ValueError:
        return {"explanations": {}, "status": "api_key_missing"}
    except json.JSONDecodeError:
        # Model returned non-JSON; clients fall back to lazy per-metric calls.
        return {"explanations": {}, "status": "parse_error"}
    except APIKeyExhaustedError as exc:
        error_str = str(exc)
        status = "rate_limited" if ("429" in error_str or "quota" in error_str.lower()) else "error"
        return {"explanations": {}, "status": status}
    except Exception as exc:
        return {"explanations": {}, "status": "error"}



@router.post("/generate")
def generate_narrative(payload: dict[str, Any]):
    results = payload.get("results", {})
    prompt = _build_prompt(results)

    try:
        narrative = generate_with_fallback(prompt)
        return {
            "narrative": narrative,
            "prompt": prompt,
            "status": "ok",
        }
    except ValueError:
        return {
            "narrative": (
                "Executive summary generation requires a Gemini API key. "
                "Set the GEMINI_API_KEY environment variable and try again.\n\n"
                "To get a key, visit: https://aistudio.google.com/apikey"
            ),
            "prompt": prompt,
            "status": "api_key_missing",
        }
    except ImportError:
        return {
            "narrative": "The google-genai package is not installed. Run: pip install google-genai",
            "prompt": prompt,
            "status": "import_error",
        }
    except APIKeyExhaustedError as exc:
        error_str = str(exc)
        if "429" in error_str or "quota" in error_str.lower():
            return {
                "narrative": "Gemini API rate limit exceeded (all keys exhausted). Please wait about 1 minute and try again, or add more API keys.",
                "prompt": prompt,
                "status": "rate_limited",
            }
        return {
            "narrative": f"Gemini API authentication error: {error_str}",
            "prompt": prompt,
            "status": "error",
        }


class ExplainMitigationRequest(BaseModel):
    mitigation_run_id: int | str
    removed_records_count: int
    retention_percentage: float
    original_summary: dict[str, Any]
    mitigated_summary: dict[str, Any]

@router.post("/explain-mitigation")
def explain_mitigation(req: ExplainMitigationRequest) -> dict[str, Any]:

    prompt = f"""You are a fairness analyst reviewing a sandbox mitigation experiment.
The user excluded some records to mitigate bias. Compare the original vs. mitigated results and explain the outcome.

Original Results:
{json.dumps(req.original_summary, indent=2)}

Mitigation details: 
Excluded {req.removed_records_count} records. Retention rate is {req.retention_percentage}%.

Mitigated Results:
{json.dumps(req.mitigated_summary, indent=2)}

Return ONLY a valid JSON object with EXACTLY this structure:
{{
  "summary": "High-level summary of what happened.",
  "fairness_change_explanation": "Explain how the fairness score and gaps changed.",
  "accuracy_tradeoff_explanation": "Explain any change in accuracy relative to the fairness gains.",
  "remaining_risks": "Mention if any metrics are still concerning.",
  "recommended_next_steps": "One or two next steps."
}}"""

    try:
        raw = generate_with_fallback(prompt, as_json=True)
        data = json.loads(raw)
        return {"mitigation_results": data, "status": "ok"}
    except ValueError:
        return {"mitigation_results": {}, "status": "api_key_missing"}
    except APIKeyExhaustedError as exc:
        error_str = str(exc)
        status = "rate_limited" if ("429" in error_str or "quota" in error_str.lower()) else "error"
        return {"mitigation_results": {}, "status": status}
    except Exception as exc:
        return {"mitigation_results": {}, "status": "error"}

