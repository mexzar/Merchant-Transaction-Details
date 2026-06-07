"""Normalized, merchant-agnostic data models.

The Amazon-specific scraper maps the upstream `amazon-orders` objects into these
models so that the rest of the app (export, UI, the future endpoint push) never
depends on a particular library's shape. When we add more merchants, they map
into the same models.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class NormalizedItem(BaseModel):
    """A single line item within an order."""

    title: Optional[str] = None
    link: Optional[str] = None
    price: Optional[float] = None
    quantity: Optional[int] = None
    seller: Optional[str] = None


class NormalizedTransaction(BaseModel):
    """A money movement (charge or refund) tied to an order."""

    completed_date: Optional[date] = None
    amount: Optional[float] = None
    is_refund: Optional[bool] = None
    order_number: Optional[str] = None
    seller: Optional[str] = None
    payment_method: Optional[str] = None
    payment_method_last_4: Optional[str] = None
    order_details_link: Optional[str] = None
    summary: str = ""


class NormalizedOrder(BaseModel):
    """An order, with line items and (optionally) full cost breakdown."""

    order_number: Optional[str] = None
    order_placed_date: Optional[date] = None
    grand_total: Optional[float] = None
    recipient: Optional[str] = None
    items: list[NormalizedItem] = Field(default_factory=list)
    full_details: bool = False
    # Extra cost-breakdown fields (subtotal, tax, shipping, etc.) when full_details
    # was requested. Kept as a free-form map so we capture everything upstream
    # exposes without coupling our schema to it.
    details: dict[str, Any] = Field(default_factory=dict)
    summary: str = ""


class ScrapeResult(BaseModel):
    """The full payload produced by one scrape run.

    This is also the exact shape that gets written to the exported JSON file and,
    in phase 2, PUT to the configured web endpoint.
    """

    merchant: str = "amazon"
    account: Optional[str] = None
    generated_at: datetime = Field(default_factory=datetime.now)
    range_label: Optional[str] = None
    transaction_count: int = 0
    order_count: int = 0
    transactions: list[NormalizedTransaction] = Field(default_factory=list)
    orders: list[NormalizedOrder] = Field(default_factory=list)
