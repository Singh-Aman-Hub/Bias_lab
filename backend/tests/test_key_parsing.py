import re
def run():
    with open('backend/.env', 'r') as f:
        env_content = f.read()
    
    match = re.search(r'^GEMINI_API_KEY=(.*)$', env_content, re.MULTILINE)
    if match:
        raw_val = match.group(1)
        print(f"Raw GEMINI_API_KEY value length: {len(raw_val)}")
        keys = [k.strip() for k in raw_val.split(",") if k.strip()]
        print(f"Number of keys detected: {len(keys)}")
        for i, k in enumerate(keys):
            print(f"Key {i+1} starts with: {k[:10]}... length: {len(k)}")
    else:
        print("GEMINI_API_KEY not found in .env")

run()
