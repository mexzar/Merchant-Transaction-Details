"""Write a ScrapeResult to a nicely formatted JSON file."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from .models import ScrapeResult


def export_filename(result: ScrapeResult) -> str:
    stamp = result.generated_at.strftime("%Y%m%d-%H%M%S")
    return f"{result.merchant}-transactions-{stamp}.json"


def write_export(result: ScrapeResult, export_dir: Path) -> Path:
    """Serialize `result` to a timestamped JSON file in `export_dir`."""
    export_dir.mkdir(parents=True, exist_ok=True)
    path = export_dir / export_filename(result)
    path.write_text(
        result.model_dump_json(indent=2),
        encoding="utf-8",
    )
    return path


def to_json(result: ScrapeResult) -> str:
    """Return the JSON string (same shape that gets written / pushed)."""
    return result.model_dump_json(indent=2)
