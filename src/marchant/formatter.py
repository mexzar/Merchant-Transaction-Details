"""Build the human-friendly transaction description used in the slim export."""

from __future__ import annotations

import re
from typing import Optional

from .models import NormalizedItem, NormalizedOrder, NormalizedTransaction

_TRAILING_SEPS = re.compile(r"[\s\-,;:|/]+$")


def truncate_product_name(title: str, max_chars: int = 60) -> str:
    if not title:
        return ""
    name = title.split(",", 1)[0].strip()
    if len(name) <= max_chars:
        return name
    cut = name[: max_chars - 1]
    space = cut.rfind(" ")
    if space > 0:
        cut = cut[:space]
    cut = _TRAILING_SEPS.sub("", cut)
    return f"{cut}…"


def _format_item(item: NormalizedItem, max_chars: int) -> str:
    name = truncate_product_name(item.title or "", max_chars)
    qty = item.quantity
    if isinstance(qty, int) and qty > 1:
        return f"{qty}x {name}"
    return name


def compose_description(
    transaction: NormalizedTransaction,
    order: Optional[NormalizedOrder] = None,
    *,
    max_chars_per_product: int = 60,
) -> str:
    """Build a description like `Product A; 2x Product B - order 111-…`.

    Refunds get a `Return of ` prefix. Transactions with no order number (e.g.
    Prime Video) fall back to the seller name and drop the trailing order tag.
    """
    items = list(order.items) if order else []
    parts = [p for p in (_format_item(i, max_chars_per_product) for i in items) if p]
    body = "; ".join(parts) if parts else (transaction.seller or "(unknown)")
    if transaction.is_refund:
        body = f"Return of {body}"
    if transaction.order_number:
        return f"{body} - order {transaction.order_number}"
    return body
