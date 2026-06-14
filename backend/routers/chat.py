"""Chatbot router for context-aware assistance."""
from __future__ import annotations

import json
import os
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/chat", tags=["chat"])

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    context: dict[str, Any] = {}

def _build_chat_prompt(req: ChatRequest) -> str:
    """Build a prompt incorporating chat history and current context."""
    context_json = json.dumps(req.context, indent=2, default=str) if req.context else "None"
    
    # We use a system prompt instructions, followed by the conversation history.
    # Since we are sending a single prompt string to generate_content in gemini-2.5-flash
    # (or using the ChatSession API, but let's stick to simple prompt concatenation for now)
    
    prompt = f"""You are a helpful and knowledgeable AI Fairness Assistant for the 'Bias-Lab' platform.
Your job is to help the user understand their bias metrics, fairness scores, and mitigation options.

CURRENT USER CONTEXT:
{context_json}

INSTRUCTIONS:
- If the user asks about a specific metric or chart, refer to the CURRENT USER CONTEXT.
- Keep your answers concise, practical, and easy to understand for non-technical users.
- Do NOT hallucinate metrics that are not present in the context.
- Use plain English and short paragraphs.

CONVERSATION HISTORY:
"""
    for msg in req.messages:
        role = "User" if msg.role == "user" else "Assistant"
        prompt += f"\n{role}: {msg.content}"
    
    prompt += "\n\nAssistant:"
    return prompt

@router.post("")
async def chat_with_assistant(req: ChatRequest) -> dict[str, str]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return {"response": "Error: GEMINI_API_KEY is missing on the server. Please configure it to enable the Chatbot.", "status": "api_key_missing"}

    prompt = _build_chat_prompt(req)
    
    try:
        from google import genai
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
            contents=prompt,
        )
        return {"response": response.text, "status": "ok"}
    except ImportError:
        return {"response": "Error: google-genai package is not installed.", "status": "import_error"}
    except Exception as exc:
        error_str = str(exc)
        return {"response": f"Error: {error_str}", "status": "error"}
