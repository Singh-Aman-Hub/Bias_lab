"""Gemini-powered narrative report generator.

Requires the GEMINI_API_KEY environment variable to be set.
Endpoint returns an English-readable summary of fairness audit results.
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter

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


def _generate_with_gemini(api_key: str, prompt: str) -> str:
    from google import genai

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
    )
    return response.text


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
