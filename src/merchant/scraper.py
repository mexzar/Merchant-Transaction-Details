"""Amazon scraping, built on the `amazon-orders` library.

This module is the only place that touches `amazon-orders`. It logs in (handling
MFA), pulls orders and transactions, and maps them into our normalized models.

The `amazon-orders` import is deferred into the functions so the rest of the app
(and the test suite) can import this module even when the dependency or a live
Amazon session isn't available.
"""

from __future__ import annotations

from typing import Any, Optional

from .models import (
    NormalizedItem,
    NormalizedOrder,
    NormalizedTransaction,
    ScrapeResult,
)

# Preset time ranges offered in the UI. Each maps to the `time_filter` that
# `amazon-orders` uses for order history and an approximate `days` window for
# transactions.
TIME_RANGES: dict[str, dict[str, Any]] = {
    "last30": {"label": "Last 30 days", "time_filter": "last30", "days": 30},
    "months-3": {"label": "Last 3 months", "time_filter": "months-3", "days": 90},
    "months-6": {"label": "Last 6 months", "time_filter": "months-6", "days": 180},
    "year": {"label": "A specific year", "time_filter": None, "days": 366},
}


class ScrapeError(RuntimeError):
    """Raised when scraping cannot proceed (missing dep, login failure, etc.)."""


def _build_io(otp: Optional[str]):
    """Return an `amazon-orders` IO handler that feeds a one-time MFA code.

    When the user supplies a TOTP secret key instead, `amazon-orders` solves MFA
    automatically and this prompt is never hit.
    """
    from amazonorders.session import IODefault

    class PresetIO(IODefault):  # type: ignore[misc]
        def __init__(self, otp_code: Optional[str]) -> None:
            super().__init__()
            self._otp = otp_code

        def prompt(self, msg: str = "", **kwargs: Any) -> Any:  # noqa: D401
            lowered = (msg or "").lower()
            wants_code = any(
                kw in lowered for kw in ("otp", "passcode", "code", "verification", "2sv")
            )
            if self._otp and wants_code and "choices" not in kwargs:
                return self._otp
            return super().prompt(msg, **kwargs)

    return PresetIO(otp)


def _f(value: Any) -> Optional[float]:
    """Coerce an amount-like value (float, or object with .amount) to float."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    amount = getattr(value, "amount", None)
    if amount is not None:
        try:
            return float(amount)
        except (TypeError, ValueError):
            return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _map_item(item: Any) -> NormalizedItem:
    return NormalizedItem(
        title=getattr(item, "title", None),
        link=getattr(item, "link", None),
        price=_f(getattr(item, "price", None)),
        quantity=getattr(item, "quantity", None),
        seller=_seller_name(getattr(item, "seller", None)),
    )


def _seller_name(seller: Any) -> Optional[str]:
    if seller is None:
        return None
    if isinstance(seller, str):
        return seller
    return getattr(seller, "name", None) or str(seller)


def _map_transaction(txn: Any) -> NormalizedTransaction:
    amount = _f(getattr(txn, "grand_total", None))
    nt = NormalizedTransaction(
        completed_date=getattr(txn, "completed_date", None),
        amount=amount,
        is_refund=getattr(txn, "is_refund", None),
        order_number=getattr(txn, "order_number", None),
        seller=_seller_name(getattr(txn, "seller", None)),
        payment_method=getattr(txn, "payment_method", None),
        payment_method_last_4=getattr(txn, "payment_method_last_4", None),
        order_details_link=getattr(txn, "order_details_link", None),
    )
    nt.summary = _transaction_summary(nt)
    return nt


# Extra cost-breakdown attributes captured when full_details=True.
_ORDER_DETAIL_FIELDS = (
    "subtotal",
    "shipping_total",
    "free_shipping",
    "promotion_applied",
    "coupon_savings",
    "subscription_discount",
    "total_before_tax",
    "estimated_tax",
    "refund_total",
    "gift_card",
    "gift_wrap",
)


def _map_order(order: Any) -> NormalizedOrder:
    items = [_map_item(i) for i in getattr(order, "items", []) or []]
    details: dict[str, Any] = {}
    for field in _ORDER_DETAIL_FIELDS:
        value = getattr(order, field, None)
        if value is not None:
            details[field] = _f(value) if not isinstance(value, bool) else value

    no = NormalizedOrder(
        order_number=getattr(order, "order_number", None),
        order_placed_date=getattr(order, "order_placed_date", None),
        grand_total=_f(getattr(order, "grand_total", None)),
        recipient=_recipient_name(getattr(order, "recipient", None)),
        items=items,
        full_details=bool(getattr(order, "full_details", False)),
        details=details,
    )
    no.summary = _order_summary(no)
    return no


def _recipient_name(recipient: Any) -> Optional[str]:
    if recipient is None:
        return None
    return getattr(recipient, "name", None) or str(recipient)


def _transaction_summary(t: NormalizedTransaction) -> str:
    when = t.completed_date.isoformat() if t.completed_date else "unknown date"
    amount = f"{t.amount:+.2f}" if t.amount is not None else "?"
    who = t.seller or t.order_number or "Amazon"
    pay = ""
    if t.payment_method:
        pay = f" via {t.payment_method}"
        if t.payment_method_last_4:
            pay += f" ••{t.payment_method_last_4}"
    kind = "refund" if t.is_refund else "charge"
    return f"{when}  {amount} ({kind}) — {who}{pay}"


def _order_summary(o: NormalizedOrder) -> str:
    when = o.order_placed_date.isoformat() if o.order_placed_date else "unknown date"
    total = f"{o.grand_total:.2f}" if o.grand_total is not None else "?"
    n = len(o.items)
    first = o.items[0].title if o.items and o.items[0].title else None
    items_part = ""
    if n:
        items_part = f" — {n} item(s)"
        if first:
            more = f" (+{n - 1} more)" if n > 1 else ""
            items_part += f": {first}{more}"
    return f"{when}  {total} — order {o.order_number or '?'}{items_part}"


def scrape(
    email: str,
    password: str,
    *,
    otp: Optional[str] = None,
    otp_secret_key: Optional[str] = None,
    time_range: str = "months-3",
    year: Optional[int] = None,
    full_details: bool = True,
    include_orders: bool = True,
    include_transactions: bool = True,
) -> ScrapeResult:
    """Log in to Amazon and download orders and/or transactions.

    Args:
        email: Amazon account email.
        password: Amazon account password.
        otp: A one-time MFA code typed by the user (used if MFA is prompted).
        otp_secret_key: TOTP secret for fully automated MFA (preferred).
        time_range: One of TIME_RANGES keys.
        year: Required when time_range == "year".
        full_details: Fetch per-order line items / cost breakdown (slower).
        include_orders / include_transactions: Toggle each dataset.

    Raises:
        ScrapeError: on missing dependency or login/scrape failure.
    """
    if not email or not password:
        raise ScrapeError("Amazon email and password are required.")
    if time_range not in TIME_RANGES:
        raise ScrapeError(f"Unknown time range: {time_range!r}")
    if time_range == "year" and not year:
        raise ScrapeError("A year is required when the range is 'A specific year'.")

    try:
        from amazonorders.conf import AmazonOrdersConfig
        from amazonorders.orders import AmazonOrders
        from amazonorders.session import AmazonSession
        from amazonorders.transactions import AmazonTransactions
    except ImportError as exc:  # pragma: no cover - depends on install
        raise ScrapeError(
            "The 'amazon-orders' package is not installed. Run: pip install -e ."
        ) from exc

    spec = TIME_RANGES[time_range]
    range_label = spec["label"] if time_range != "year" else f"Year {year}"

    # Register the Playwright-backed solvers so Amazon's JS-based auth challenges
    # (ACIC, JS bot-detection, AWS WAF CAPTCHA) get handled in a real browser
    # rather than raising AmazonOrdersAuthError. Requires the [browser] extra +
    # `playwright install chromium`.
    #
    # Two of these forms (VisibleJSAuthForm, PlaywrightManualWafForm) open a
    # visible window and wait for the user to solve a challenge by hand. The
    # upstream `browser_timeout` (added in amazon-orders 4.4.0) defaults to 30s,
    # which is too short for a human; bump it so manual solving doesn't time out.
    config = AmazonOrdersConfig(data={
        "auth_forms_classes": [
            "amazonorders.contrib.browser.playwright.PlaywrightAcicForm",
            "merchant._browser_forms.VisibleJSAuthForm",
            "amazonorders.contrib.browser.playwright.PlaywrightManualWafForm",
        ],
        "browser_timeout": 180,
    })

    session = AmazonSession(
        email,
        password,
        config=config,
        otp_secret_key=otp_secret_key or None,
        io=_build_io(otp),
    )

    try:
        session.login()
    except Exception as exc:  # noqa: BLE001 - surface a clean message to the UI
        raise ScrapeError(f"Amazon login failed: {exc}") from exc

    result = ScrapeResult(merchant="amazon", account=email, range_label=range_label)

    try:
        if include_orders:
            orders_api = AmazonOrders(session)
            if time_range == "year":
                raw_orders = orders_api.get_order_history(
                    year=year, full_details=full_details
                )
            else:
                raw_orders = orders_api.get_order_history(
                    time_filter=spec["time_filter"], full_details=full_details
                )
            result.orders = [_map_order(o) for o in raw_orders]

        if include_transactions:
            txns_api = AmazonTransactions(session)
            raw_txns = txns_api.get_transactions(days=int(spec["days"]))
            result.transactions = [_map_transaction(t) for t in raw_txns]

        if include_orders and include_transactions:
            # Transactions can post for orders placed just outside the order time
            # window (Amazon's "Last 3 months" filter ≠ the 90-day txn window).
            # Fetch those one-by-one so descriptions get product names instead
            # of falling back to the generic "AMZN Mktp US" descriptor.
            known = {o.order_number for o in result.orders if o.order_number}
            referenced = {t.order_number for t in result.transactions if t.order_number}
            for order_id in sorted(referenced - known):
                try:
                    extra = orders_api.get_order(order_id)
                except Exception:  # noqa: BLE001
                    continue
                result.orders.append(_map_order(extra))
    except Exception as exc:  # noqa: BLE001
        raise ScrapeError(f"Failed while downloading data: {exc}") from exc
    finally:
        # Best-effort logout so we don't leave a session lingering.
        try:
            session.logout()
        except Exception:  # noqa: BLE001
            pass

    result.order_count = len(result.orders)
    result.transaction_count = len(result.transactions)
    return result
