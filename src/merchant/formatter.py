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


def _is_generic_amazon_descriptor(seller: str) -> bool:
    # "AMZN Mktp US", "AMZN Digital*ABC123", "Amazon.com*XYZ" — bank-card
    # descriptors Amazon uses on the statement view. Not a product name and
    # not a useful seller, so we'd rather show the order number alone.
    upper = seller.upper()
    return upper.startswith("AMZN ") or upper.startswith("AMAZON.COM*")


def compose_description(
    transaction: NormalizedTransaction,
    order: Optional[NormalizedOrder] = None,
    *,
    max_chars_per_product: int = 60,
) -> str:
    """Build a description listing each product on its own line, e.g.
    `Product A\n2x Product B - order 111-…`.

    Multiple products are separated by newlines so a long order reads as a
    one-product-per-line list rather than one run-on string. Refunds get a
    `Return of ` prefix. Transactions with no order number (e.g. Prime Video)
    fall back to the seller name and drop the trailing order tag.
    """
    items = list(order.items) if order else []
    parts = [p for p in (_format_item(i, max_chars_per_product) for i in items) if p]

    if parts:
        body = "\n".join(parts)
    else:
        seller = (transaction.seller or "").strip()
        body = seller if seller and not _is_generic_amazon_descriptor(seller) else ""

    if body and transaction.is_refund:
        body = f"Return of {body}"

    if body and transaction.order_number:
        return f"{body} - order {transaction.order_number}"
    if body:
        return body
    if transaction.order_number:
        return f"{'Refund on order' if transaction.is_refund else 'Order'} {transaction.order_number}"
    return "(unknown)"
