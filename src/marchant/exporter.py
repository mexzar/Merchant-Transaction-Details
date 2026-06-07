"""Write a ScrapeResult to a slim, easy-to-read JSON file.

Each transaction is reduced to `{date, amount, description}` — the description
is built by `formatter.compose_description` from the line items of the matching
order. The full rich `ScrapeResult` is still kept in memory for the UI; only
the on-disk export is slim.
"""

from __future__ import annotations

import json
from pathlib import Path

from .formatter import compose_description
from .models import ScrapeResult

# Human-readable merchant label written onto each transaction. The internal
# `ScrapeResult.merchant` slug ("amazon") stays lowercase for routing/file
# naming; the per-transaction field is the display name.
_MERCHANT_LABELS = {"amazon": "Amazon"}


def export_filename(result: ScrapeResult) -> str:
    stamp = result.generated_at.strftime("%Y%m%d-%H%M%S")
    return f"{result.merchant}-transactions-{stamp}.json"


def _build_slim_payload(result: ScrapeResult) -> dict:
    orders_by_num = {o.order_number: o for o in result.orders if o.order_number}
    merchant_label = _MERCHANT_LABELS.get(result.merchant, result.merchant.title())
    slim_txns = []
    for t in result.transactions:
        order = orders_by_num.get(t.order_number) if t.order_number else None
        slim_txns.append({
            "merchant": merchant_label,
            "date": t.completed_date.isoformat() if t.completed_date else None,
            "amount": t.amount,
            "description": compose_description(t, order),
        })
    return {
        "merchant": result.merchant,
        "account": result.account,
        "generated_at": result.generated_at.isoformat(),
        "range_label": result.range_label,
        "transaction_count": len(slim_txns),
        "transactions": slim_txns,
    }


def write_export(result: ScrapeResult, export_dir: Path) -> Path:
    export_dir.mkdir(parents=True, exist_ok=True)
    path = export_dir / export_filename(result)
    path.write_text(json.dumps(_build_slim_payload(result), indent=2), encoding="utf-8")
    return path


def to_json(result: ScrapeResult) -> str:
    return json.dumps(_build_slim_payload(result), indent=2)
