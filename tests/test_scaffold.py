"""Scaffold smoke tests — verify the app wires together without a live Amazon session."""

from __future__ import annotations

import json
from datetime import date, datetime

from fastapi.testclient import TestClient

from marchant import scraper
from marchant.config import AppConfig
from marchant.exporter import export_filename, to_json, write_export
from marchant.formatter import compose_description, truncate_product_name
from marchant.models import NormalizedItem, NormalizedOrder, NormalizedTransaction, ScrapeResult
from marchant.server import app


def test_time_ranges_have_required_keys():
    for key, spec in scraper.TIME_RANGES.items():
        assert "label" in spec
        assert "days" in spec
        assert "time_filter" in spec


def test_transaction_summary_formats_charge_and_refund():
    charge = NormalizedTransaction(
        completed_date=date(2025, 3, 1),
        amount=-19.99,
        is_refund=False,
        seller="Amazon.com",
        payment_method="Visa",
        payment_method_last_4="1234",
    )
    summary = scraper._transaction_summary(charge)
    assert "2025-03-01" in summary
    assert "-19.99" in summary
    assert "charge" in summary
    assert "1234" in summary

    refund = NormalizedTransaction(completed_date=date(2025, 3, 2), amount=5.0, is_refund=True)
    assert "refund" in scraper._transaction_summary(refund)


def test_order_summary_includes_item_count():
    order = NormalizedOrder(
        order_number="123-456",
        order_placed_date=date(2025, 1, 5),
        grand_total=42.50,
    )
    order.items = []
    summary = scraper._order_summary(order)
    assert "123-456" in summary
    assert "42.50" in summary


def test_scrape_requires_credentials():
    try:
        scraper.scrape("", "")
        raise AssertionError("expected ScrapeError")
    except scraper.ScrapeError:
        pass


def test_year_range_requires_year():
    try:
        scraper.scrape("a@b.com", "pw", time_range="year")
        raise AssertionError("expected ScrapeError")
    except scraper.ScrapeError:
        pass


def test_export_roundtrip(tmp_path):
    result = ScrapeResult(
        merchant="amazon",
        account="a@b.com",
        generated_at=datetime(2025, 5, 1, 12, 0, 0),
        transaction_count=0,
        order_count=0,
    )
    path = write_export(result, tmp_path)
    assert path.exists()
    assert path.name == export_filename(result)
    assert "amazon" in to_json(result)


def test_truncate_product_name_drops_after_first_comma():
    assert truncate_product_name(
        "ASICS Men's NOVABLAST 5 Running Shoes, 10, Arctic Blue/Aegean Blue"
    ) == "ASICS Men's NOVABLAST 5 Running Shoes"


def test_truncate_product_name_caps_at_word_boundary():
    out = truncate_product_name(
        "Brooks Men's Ghost 17 Neutral Running Shoe - Peacoat/Lime/Blue - 10 Medium",
        max_chars=60,
    )
    assert out.endswith("…")
    # Drops the trailing " -" separator before the ellipsis.
    assert out == "Brooks Men's Ghost 17 Neutral Running Shoe…"


def test_truncate_product_name_passes_through_short_title():
    assert truncate_product_name("Crayola Dry Erase Marker") == "Crayola Dry Erase Marker"


def test_compose_description_multi_item_charge():
    order = NormalizedOrder(
        order_number="111-8884051-9545826",
        items=[
            NormalizedItem(title="ASICS Men's NOVABLAST 5 Running Shoes, 10, Arctic Blue/Aegean Blue"),
            NormalizedItem(title="Brooks Men's Ghost 17 Neutral Running Shoe - Peacoat/Lime/Blue - 10 Medium"),
        ],
    )
    txn = NormalizedTransaction(
        completed_date=date(2026, 6, 4),
        amount=-372.22,
        is_refund=False,
        order_number="111-8884051-9545826",
    )
    desc = compose_description(txn, order)
    assert desc == (
        "ASICS Men's NOVABLAST 5 Running Shoes\n"
        "Brooks Men's Ghost 17 Neutral Running Shoe… "
        "- order 111-8884051-9545826"
    )


def test_compose_description_refund_prefixes_return_of():
    order = NormalizedOrder(
        order_number="111-3428399-4335447",
        items=[NormalizedItem(title="kate spade new york Womens Kiya/S Square Sunglasses, Peach, 53mm")],
    )
    txn = NormalizedTransaction(
        completed_date=date(2026, 6, 1),
        amount=94.95,
        is_refund=True,
        order_number="111-3428399-4335447",
    )
    desc = compose_description(txn, order)
    assert desc.startswith("Return of kate spade new york Womens Kiya/S Square Sunglasses")
    assert desc.endswith("- order 111-3428399-4335447")


def test_compose_description_qty_prefix_when_more_than_one():
    order = NormalizedOrder(
        order_number="X-1",
        items=[NormalizedItem(title="Crayola Dry Erase Marker", quantity=3)],
    )
    txn = NormalizedTransaction(
        completed_date=date(2026, 5, 30),
        amount=-44.97,
        is_refund=False,
        order_number="X-1",
    )
    assert compose_description(txn, order) == "3x Crayola Dry Erase Marker - order X-1"


def test_compose_description_falls_back_to_seller_when_no_order():
    txn = NormalizedTransaction(
        completed_date=date(2026, 6, 3),
        amount=-6.48,
        is_refund=False,
        seller="Prime Video TVOD",
    )
    # No order, no items → use seller, no trailing order tag.
    assert compose_description(txn, None) == "Prime Video TVOD"


def test_compose_description_skips_generic_amzn_descriptor():
    # Order wasn't backfilled (e.g. get_order failed) so we have only the
    # statement seller "AMZN Mktp US". That string is bank-noise, not a
    # product name — the description should fall through to "Order <number>".
    charge = NormalizedTransaction(
        completed_date=date(2026, 5, 30),
        amount=-101.42,
        is_refund=False,
        order_number="111-7595432-9412208",
        seller="AMZN Mktp US",
    )
    assert compose_description(charge, None) == "Order 111-7595432-9412208"

    refund = NormalizedTransaction(
        completed_date=date(2026, 6, 1),
        amount=10.81,
        is_refund=True,
        order_number="111-7595432-9412208",
        seller="AMZN Mktp US",
    )
    assert compose_description(refund, None) == "Refund on order 111-7595432-9412208"


def test_export_slim_shape_has_expected_fields_per_transaction(tmp_path):
    order = NormalizedOrder(
        order_number="111-1928049-3306648",
        items=[NormalizedItem(title="Speedo Unisex-Adult Swim Goggles Mirrored Vanquisher 2.0")],
    )
    txn = NormalizedTransaction(
        completed_date=date(2026, 5, 29),
        amount=-34.63,
        is_refund=False,
        order_number="111-1928049-3306648",
    )
    result = ScrapeResult(
        merchant="amazon",
        account="a@b.com",
        generated_at=datetime(2026, 6, 7, 12, 0, 0),
        transactions=[txn],
        orders=[order],
    )
    payload = json.loads(to_json(result))
    assert payload["transaction_count"] == 1
    (entry,) = payload["transactions"]
    assert set(entry.keys()) == {"merchant", "date", "amount", "description"}
    assert entry == {
        "merchant": "Amazon",
        "date": "2026-05-29",
        "amount": -34.63,
        "description": "Speedo Unisex-Adult Swim Goggles Mirrored Vanquisher 2.0 - order 111-1928049-3306648",
    }


def test_config_model_defaults():
    cfg = AppConfig()
    assert cfg.export_dir is None


def test_health_endpoint():
    client = TestClient(app)
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_index_renders():
    client = TestClient(app)
    res = client.get("/")
    assert res.status_code == 200
    assert "Marchant Transaction Details" in res.text


def test_download_rejects_path_traversal():
    client = TestClient(app)
    res = client.get("/download/..%2f..%2fetc%2fpasswd")
    assert res.status_code in (400, 404)
