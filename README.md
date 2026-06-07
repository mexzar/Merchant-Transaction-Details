# Marchant Transaction Details

Download your order and transaction details from well-known merchants — starting
with **Amazon** — through a simple local web app, and (next phase) optionally
push the results as JSON to a web endpoint you configure.

You enter your credentials, handle MFA if prompted, pick a time range, and the
app downloads your orders and transactions and writes them to a tidy JSON file
with both a one-line summary and the full details for each entry.

> Credentials and MFA codes are used only for the download and are **never**
> written to disk.

## How it works

The Amazon scraping is built on
[`alexdlaird/amazon-orders`](https://github.com/alexdlaird/amazon-orders) — the
most actively maintained, MIT-licensed library with first-class support for
orders, line items, **transactions**, and **MFA/OTP**. The evaluation that led
to this choice is recorded in
[`notepad/amazon-order-scraper-research.json`](notepad/amazon-order-scraper-research.json).

## Install & run (dev)

Requires Python 3.9+.

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -e ".[dev]"

marchant                          # or: python -m marchant
```

The app starts a local server at <http://127.0.0.1:8765/> and opens your
browser. Use `--no-browser`, `--host`, or `--port` to change behavior.

## Usage

1. Enter your Amazon **email** and **password**.
2. If your account uses MFA, enter the **one-time code**, or paste your **TOTP
   secret key** to have MFA solved automatically.
3. Choose a **time range** (and a year if you pick "A specific year").
4. Pick **Orders**, **Transactions**, or both, and click **Download my data**.
5. View the on-screen summaries and **Download JSON**. Files are also saved to
   `~/Documents/MarchantTransactionDetails/`.

## Exported JSON shape

```jsonc
{
  "merchant": "amazon",
  "account": "you@example.com",
  "generated_at": "2026-06-07T12:00:00",
  "range_label": "Last 3 months",
  "transaction_count": 12,
  "order_count": 9,
  "transactions": [
    {
      "completed_date": "2026-05-30",
      "amount": -19.99,
      "is_refund": false,
      "order_number": "123-4567890-1234567",
      "seller": "Amazon.com",
      "payment_method": "Visa",
      "payment_method_last_4": "1234",
      "summary": "2026-05-30  -19.99 (charge) — Amazon.com via Visa ••1234"
    }
  ],
  "orders": [ { "order_number": "…", "items": [ … ], "summary": "…" } ]
}
```

## Roadmap

- **Phase 1 (this scaffold):** local web UI, Amazon login + MFA, download orders
  & transactions, export formatted JSON, run end-to-end.
- **Phase 2:** optional HTTP **PUT** of the exported JSON to a configured
  endpoint. The plumbing is scaffolded in `src/marchant/pusher.py` and the UI
  config form already saves the endpoint settings.
- **Later:** packaged installers for **macOS** and **Windows**; additional
  merchants behind the same normalized data model.

## Project layout

```
src/marchant/
  __main__.py     # launcher (uvicorn + open browser)
  server.py       # FastAPI app: UI + /api/scrape, /api/config, /download
  scraper.py      # amazon-orders integration -> normalized models
  models.py       # merchant-agnostic data models
  config.py       # persisted settings + paths
  exporter.py     # write/serialize the JSON export
  pusher.py       # phase 2: PUT to endpoint (scaffolded)
  templates/ static/   # the local web UI
notepad/          # research notes (library decision) in JSON
tests/            # scaffold smoke tests
```

## Development

```bash
pytest            # run the scaffold smoke tests
ruff check .      # lint
```

## Disclaimer

This tool downloads **your own** account data for personal record-keeping. It
relies on an unofficial scraper of Amazon's consumer website (English `.com`
locale) and may break when Amazon changes its pages. Use in accordance with the
relevant terms of service.
