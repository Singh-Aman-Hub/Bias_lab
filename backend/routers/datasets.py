from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from core.dataset_loader import list_datasets, load_dataset

router = APIRouter(prefix="/datasets", tags=["datasets"])


@router.get("")
async def get_datasets():
    return {"datasets": list_datasets()}


@router.get("/download/{name}")
async def download_builtin_dataset(name: str):
    try:
        info_list = [d for d in list_datasets() if d["name"] == name]
        if not info_list:
            raise HTTPException(status_code=404, detail=f"Dataset '{name}' not found")
        info = info_list[0]

        df = load_dataset(name)
        csv_bytes = df.to_csv(index=False).encode("utf-8")

        return Response(
            content=csv_bytes,
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="{info["filename"]}"',
                "X-Dataset-Name": name,
                "X-Dataset-Target-Col": info["target_col"],
                "X-Dataset-Sensitive-Cols": ",".join(info["sensitive_cols"]),
                "X-Dataset-Domain": info["suggested_domain"],
                "X-Dataset-Rows": str(len(df)),
                "X-Dataset-Columns": ",".join(str(c["name"]) for c in info["columns"]),
            },
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/load/{name}")
async def load_builtin_dataset(name: str):
    try:
        df = load_dataset(name)
        info = [d for d in list_datasets() if d["name"] == name][0]
        return {
            "status": "ok",
            "dataset": name,
            "rows": len(df),
            "columns": list(df.columns),
            "preview": df.head(5).to_dict(orient="records"),
            "target_col": info["target_col"],
            "sensitive_cols": info["sensitive_cols"],
            "suggested_domain": info["suggested_domain"],
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
