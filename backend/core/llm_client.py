import os
import json
from typing import Any

# Global index to remember which key is currently working, 
# preventing the system from retrying exhausted keys on every request.
_active_key_index = 0

class APIKeyExhaustedError(Exception):
    pass

def _get_raw_keys() -> str:
    """Read directly from .env to bypass uvicorn os.environ caching."""
    try:
        env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
        if os.path.exists(env_path):
            with open(env_path, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line.startswith('GEMINI_API_KEY=') and not line.startswith('#'):
                        return line.split('=', 1)[1].strip()
    except Exception:
        pass
    return os.getenv("GEMINI_API_KEY", "")

def generate_with_fallback(prompt: str, as_json: bool = False) -> str:
    """Generate content using Gemini, falling back across multiple keys if rate limited or invalid."""
    global _active_key_index
    try:
        from google import genai
        from google.genai import types
        from google.genai.errors import APIError
    except ImportError:
        raise ImportError("The google-genai package is not installed. Run: pip install google-genai")

    keys_env = _get_raw_keys()
    if not keys_env:
        raise ValueError("GEMINI_API_KEY environment variable is missing.")

    # Split keys and clean up whitespace
    keys = [k.strip() for k in keys_env.split(",") if k.strip()]
    if not keys:
        raise ValueError("No valid keys found in GEMINI_API_KEY.")

    model_name = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    config = types.GenerateContentConfig(response_mime_type="application/json") if as_json else None

    last_error = None
    
    # Ensure active index is within bounds (in case keys were removed)
    if _active_key_index >= len(keys):
        _active_key_index = 0

    # Start attempting keys from the last known good index, wrapping around
    for i in range(len(keys)):
        current_index = (_active_key_index + i) % len(keys)
        key = keys[current_index]
        
        try:
            client = genai.Client(api_key=key)
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=config,
            )
            # If successful, permanently update the active index to this working key
            _active_key_index = current_index
            return response.text
        
        except APIError as e:
            error_str = str(e).lower()
            if any(term in error_str for term in ["429", "quota", "rate limit", "401", "403", "unauthorized", "invalid_argument", "api_key_invalid"]):
                last_error = e
                continue
            raise e
        
        except Exception as e:
            error_str = str(e).lower()
            if any(term in error_str for term in ["429", "quota", "rate limit", "401", "403", "unauthorized", "invalid_argument", "api_key_invalid"]):
                last_error = e
                continue
            raise e

    # If we exhaust all keys, raise the last exception caught
    if last_error:
        raise APIKeyExhaustedError(f"All {len(keys)} Gemini API keys failed or were rate-limited. Last error: {str(last_error)}")
    
    raise APIKeyExhaustedError("All Gemini API keys failed.")

