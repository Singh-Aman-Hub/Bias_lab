from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter
from fastapi.responses import Response

router = APIRouter(prefix="/colab", tags=["colab"])


@router.post("/export")
async def export_notebook(payload: dict[str, Any]):
    results = payload.get("results", {})
    dataset_name = payload.get("dataset_name", "uploaded_data")

    notebook = {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {
            "kernelspec": {
                "display_name": "Python 3",
                "language": "python",
                "name": "python3",
            },
            "language_info": {"name": "python", "version": "3.12.0"},
        },
        "cells": [
            {
                "cell_type": "markdown",
                "metadata": {},
                "source": [
                    f"# BIAS-0 Fairness Audit Report\n",
                    f"**Dataset:** {dataset_name}\n",
                    f"**Generated:** {datetime.now(timezone.utc).isoformat()}\n",
                    f"\n",
                    f"This notebook contains the complete fairness audit results from BIAS-0.\n",
                    f"All data and model outputs are embedded.\n",
                ],
            },
            {
                "cell_type": "markdown",
                "metadata": {},
                "source": ["## Overall Fairness Score\n", f"**Score:** {results.get('fairness_score', 'N/A')}/100\n", f"**Decision:** {results.get('decision', 'N/A')}\n"],
            },
            {
                "cell_type": "code",
                "metadata": {},
                "source": [
                    "import json\n",
                    "import pandas as pd\n",
                    "import matplotlib.pyplot as plt\n",
                    "import seaborn as sns\n",
                    "\n",
                    "# ── Audit Results ─────────────────────────────────\n",
                ],
            },
            {
                "cell_type": "code",
                "metadata": {},
                "source": [
                    f"results = {json.dumps(results, indent=2, default=str)}\n",
                    f"print('Fairness Score:', results.get('fairness_score'))\n",
                    f"print('Decision:', results.get('decision'))\n",
                ],
            },
            {
                "cell_type": "markdown",
                "metadata": {},
                "source": ["## Fairness Scores Breakdown\n"],
            },
            {
                "cell_type": "code",
                "metadata": {},
                "source": [
                    "scores = results.get('scores', {})\n",
                    "if scores:\n",
                    "    pd.DataFrame([scores]).T.plot(kind='bar', legend=False, title='Fairness Scores by Dimension')\n",
                    "    plt.ylabel('Score (0-100)')\n",
                    "    plt.xticks(rotation=45)\n",
                    "    plt.tight_layout()\n",
                    "    plt.show()\n",
                ],
            },
            {
                "cell_type": "markdown",
                "metadata": {},
                "source": ["## Recommendations\n"],
            },
            {
                "cell_type": "code",
                "metadata": {},
                "source": [
                    "recs = results.get('recommendations', [])\n",
                    "for r in recs:\n",
                    "    print(f\"  - [{r.get('fix_id', '?')}] {r.get('title', '')}: {r.get('description', '')}\")\n",
                ],
            },
        ],
    }

    content = json.dumps(notebook, indent=1)
    return Response(
        content=content,
        media_type="application/x-ipynb+json",
        headers={
            "Content-Disposition": f'attachment; filename="bias0_audit_{dataset_name}.ipynb"',
        },
    )
