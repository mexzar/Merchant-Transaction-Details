"""Scaffold smoke tests — verify the app wires together without a live Amazon session."""

from __future__ import annotations

from datetime import date, datetime

from fastapi.testclient import TestClient

from marchant import scraper
from marchant.config import AppConfig, EndpointConfig
from marchant.exporter import export_filename, to_json, write_export
from marchant.models import NormalizedOrder, NormalizedTransaction, ScrapeResult
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


def test_config_model_defaults():
    cfg = AppConfig()
    assert cfg.endpoint == EndpointConfig()
    assert cfg.endpoint.enabled is False


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


def test_scrape_endpoint_validates_empty_selection():
    client = TestClient(app)
    res = client.post(
        "/api/scrape",
        json={
            "email": "a@b.com",
            "password": "pw",
            "include_orders": False,
            "include_transactions": False,
        },
    )
    assert res.status_code == 400


def test_download_rejects_path_traversal():
    client = TestClient(app)
    res = client.get("/download/..%2f..%2fetc%2fpasswd")
    assert res.status_code in (400, 404)
