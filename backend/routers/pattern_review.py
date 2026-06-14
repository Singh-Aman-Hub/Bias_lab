"""Pattern review and explanation router."""
from __future__ import annotations

import os
from typing import Any
from fastapi import APIRouter, Form
from core.pattern_discovery import discover_intersectional_patterns
from core.dataset_loader import load_dataset_from_path
from models.db import SessionLocal, Project

router = APIRouter(prefix="/patterns", tags=["patterns"])

@router.post("/discover")
async def discover_patterns(project_id: int = Form(...)) -> dict[str, Any]:
    with SessionLocal() as db:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.dataset_path:
            return {"error": "Project or dataset not found", "patterns": []}

        try:
            df = load_dataset_from_path(project.dataset_path)
            sensitive_cols = project.sensitive_columns
            target_col = project.target_column

            # Get positive label logic
            # For simplicity, if we don't have positive_label stored, we'll try to infer it
            # usually it's '1' or the most frequent class, or we can use value counts
            if target_col and target_col in df.columns:
                val_counts = df[target_col].value_counts()
                positive_label = val_counts.index[0] # assuming most frequent or 1
                if 1 in val_counts.index:
                    positive_label = 1
                elif 'Yes' in val_counts.index:
                    positive_label = 'Yes'
                
                patterns = discover_intersectional_patterns(df, sensitive_cols, target_col, positive_label)
                return {"patterns": patterns}
            else:
                return {"patterns": []}
        except Exception as e:
            return {"error": str(e), "patterns": []}

@router.post("/explain")
async def explain_pattern(pattern_description: str = Form(...), affected_records: int = Form(...)) -> dict[str, str]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return {"explanation": "GEMINI_API_KEY is missing. Cannot generate explanation."}

    prompt = f"""You are an AI fairness expert. A bias detection system found a demographic pattern with high disparity:
Pattern: {pattern_description}
Affected Records: {affected_records}

Explain why dropping these records could be harmful (e.g., loss of representation) or when it might be acceptable. Provide a recommendation on whether to exclude these records from training. Keep it to 2-3 short, plain English paragraphs."""

    try:
        from google import genai
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
            contents=prompt,
        )
        return {"explanation": response.text}
    except Exception as exc:
        return {"explanation": f"Failed to generate explanation: {str(exc)}"}
