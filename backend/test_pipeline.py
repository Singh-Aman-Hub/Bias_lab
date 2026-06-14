import requests
import time

url = "http://localhost:8000/api/project/create"
res = requests.post(url, data={"name": "TestProj2", "target_col": "target", "domain": "loan"})
project_id = res.json()["project_id"]

# Use 1 and 0 for target to make it binary
csv_data = "target,age,gender\n" + "1,30,Male\n0,25,Female\n1,40,Female\n0,35,Male\n" * 20
with open("test2.csv", "w") as f:
    f.write(csv_data)

url2 = "http://localhost:8000/api/pipeline/run-all"
with open("test2.csv", "rb") as f:
    files = {"file": f}
    data = {"project_id": str(project_id), "target_col": "target", "sensitive_cols": "gender", "metric_priority": "balanced", "domain": "loan"}
    res2 = requests.post(url2, files=files, data=data)

if "task_id" not in res2.json():
    print("FAILED KICKOFF:", res2.json())
else:
    task_id = res2.json()["task_id"]
    print("TASK ID:", task_id)
    for _ in range(10):
        time.sleep(1)
        res3 = requests.get(f"http://localhost:8000/api/pipeline/status/{task_id}")
        status = res3.json()
        print("STATUS:", status.get("status"), status.get("error"))
        if status.get("status") in ["complete", "error"]:
            break
