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


def _generate_with_gemini(api_key: str, prompt: str) -> str:
    from google import genai

    client = genai.Client(api_key=api_key)
    # gemini-2.5-flash has free-tier quota; gemini-2.0-flash returns limit:0 on free keys.
    response = client.models.generate_content(
        model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        contents=prompt,
    )
    return response.text


def _safe_generate(prompt: str, *, key_missing_msg: str) -> dict[str, str]:
    """Run a prompt through Gemini with graceful degradation. The explanation is a bonus
    layer — if the key/package/quota isn't there, return a clear status, never an exception."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return {"explanation": key_missing_msg, "status": "api_key_missing"}
    try:
        return {"explanation": _generate_with_gemini(api_key, prompt), "status": "ok"}
    except ImportError:
        return {
            "explanation": "AI explanations need the google-genai package. Run: pip install google-genai",
            "status": "import_error",
        }
    except Exception as exc:
        error_str = str(exc)
        if "429" in error_str or "quota" in error_str.lower():
            return {
                "explanation": "The AI explanation service is rate-limited right now. Please wait a minute and try again.",
                "status": "rate_limited",
            }
        return {"explanation": f"AI explanation error: {error_str}", "status": "error"}


@router.post("/explain-metric")
async def explain_metric(req: ExplainMetricRequest) -> dict[str, str]:
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


@router.post("/generate")
async def generate_narrative(payload: dict[str, Any]):
    results = payload.get("results", {})
    prompt = _build_prompt(results)

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return {
            "narrative": (
                "Executive summary generation requires a Gemini API key. "
                "Set the GEMINI_API_KEY environment variable and try again.\n\n"
                "To get a key, visit: https://aistudio.google.com/apikey"
            ),
            "prompt": prompt,
            "status": "api_key_missing",
        }

    try:
        narrative = _generate_with_gemini(api_key, prompt)
        return {
            "narrative": narrative,
            "prompt": prompt,
            "status": "ok",
        }
    except ImportError:
        return {
            "narrative": "The google-genai package is not installed. Run: pip install google-genai",
            "prompt": prompt,
            "status": "import_error",
        }
    except Exception as exc:
        error_str = str(exc)
        if "429" in error_str or "quota" in error_str.lower():
            return {
                "narrative": "Gemini API rate limit exceeded. The free tier quota has been used up for this API key. Please wait about 1 minute and try again, or use a different API key.",
                "prompt": prompt,
                "status": "rate_limited",
            }
        return {
            "narrative": f"Gemini API error: {error_str}",
            "prompt": prompt,
            "status": "error",
        }
