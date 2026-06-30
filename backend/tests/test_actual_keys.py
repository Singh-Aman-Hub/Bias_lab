import os
import re
from core.llm_client import generate_with_fallback

def run():
    with open('backend/.env', 'r') as f:
        env_content = f.read()
    match = re.search(r'^GEMINI_API_KEY=(.*)$', env_content, re.MULTILINE)
    if not match:
        return
    
    os.environ["GEMINI_API_KEY"] = match.group(1)
    
    try:
        res = generate_with_fallback("Say hello")
        print("SUCCESS!")
    except Exception as e:
        print("FAILED!")
        print(repr(e))
        print("Exception message:", str(e))

run()
