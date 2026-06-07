# Marchant Transaction Details

Download your Amazon orders and transactions to a tidy JSON file, through a
local web app on your Mac. Credentials and MFA codes are used only for the
download and are **never written to disk**.

## Install (non-technical user)

You need Python 3.9 or newer.

- **macOS** ships Python; if you hit an error saying it's missing, install the
  latest from <https://www.python.org/downloads/macos/>.
- **Windows** does not ship Python — install it from
  <https://www.python.org/downloads/windows/> first, and **tick "Add python.exe
  to PATH"** during install.

Then:

1. Click the green **Code** button on this GitHub page → **Download ZIP**.
2. Double-click the ZIP to unpack it, then move the folder anywhere you like.
3. Inside the folder, double-click the installer for your OS:
   - **macOS:** `install.command`
   - **Windows:** `install.bat`

   A console window opens, sets everything up (Python venv, dependencies,
   browser), and tells you when it's done.
4. To start the app, double-click the launcher for your OS:
   - **macOS:** `launch.command`
   - **Windows:** `launch.bat`

   The web UI opens in your browser at <http://127.0.0.1:8765/>.
5. To update later when the app changes, double-click `update.command` (macOS)
   or `update.bat` (Windows).

> The first time you launch, if the browser binary was not installed during
> setup, the app will download it (~170 MB, one minute) before opening the UI.

If macOS Gatekeeper blocks the `.command` files the first time, right-click →
**Open** to confirm. On Windows, SmartScreen may show "Windows protected your
PC" — click **More info → Run anyway**.

## Using the app

1. Enter your Amazon **email** and **password**.
2. Pick a **time range**.
3. Click **Download my data**. Every run pulls the same dataset: orders,
   transactions, and full per-order details.
4. When it finishes, copy the saved path (there's a one-click copy button) or
   click **Download JSON** to grab the file directly. Files are saved to
   `~/Documents/MarchantTransactionDetails/`.

For accounts with two-step verification (2SV), open the **Advanced
configuration** section at the bottom. You can either type a one-time code
each run, or paste your TOTP secret key once for fully automated MFA. The UI
explains how to find your TOTP secret.

## Remembering credentials (optional)

You can opt in to saving your Amazon password and/or TOTP secret on this
device. Secrets are stored in the operating system's encrypted credential
store via the [`keyring`](https://github.com/jaraco/keyring) library —
**never** in a file:

| OS | Backend |
|---|---|
| macOS | Keychain |
| Windows | Credential Manager (Credential Locker) |
| Linux | Secret Service (GNOME Keyring / KWallet) |

- The **password** and the **TOTP secret key** have **separate** opt-ins, so
  you can remember one without the other.
- A saved-account picker prefills your email and pulls the secrets from the
  keychain at run time; **Forget this account** removes them.
- Only non-secret bookkeeping (which emails were remembered) lives in
  `config.json`; the secrets themselves stay in the keychain.
- If no OS keychain is available (e.g. some headless Linux setups), the
  "remember" options are hidden automatically and the app runs without saving.

> **Security note:** remembering the **TOTP secret** means this device holds
> both your password and your second factor. The keychain encrypts it at rest
> and gates it behind your OS login, but it does reduce what 2FA buys you if
> the machine is compromised — hence the separate, explicit opt-in.

## Exported JSON shape

```jsonc
{
  "merchant": "amazon",
  "account": "you@example.com",
  "generated_at": "2026-06-07T12:00:00",
  "range_label": "Last 3 months",
  "transaction_count": 12,
  "transactions": [
    {
      "merchant": "Amazon",
      "date": "2026-05-30",
      "amount": -19.99,
      "description": "Crayola Dry Erase Marker - order 111-8745446-4149023"
    },
    {
      "merchant": "Amazon",
      "date": "2026-06-01",
      "amount": 16.23,
      "description": "Return of 24 Pack Mini Slime\nCheerland Flower Party… - order 111-1554910-8678669"
    }
  ]
}
```

- `merchant` is the display name of the source merchant; future merchants will
  use the same per-transaction field so downstream tools can route by it.
- `amount` is negative for charges and positive for refunds.
- `description` lists one product per line, `"[Return of ]Product A\nProduct B\n… - order <number>"`
  (the trailing `- order <number>` rides the last product line). Product names
  are truncated to 60 characters at word boundaries.

## Project layout

```
src/marchant/
  __main__.py          launcher (uvicorn + open browser, auto-installs Chromium)
  server.py            FastAPI app: UI + /api/scrape + keychain endpoints
  scraper.py           amazon-orders integration -> normalized models
  formatter.py         builds the human-friendly transaction description
  exporter.py          writes the slim JSON export
  models.py            merchant-agnostic data models
  config.py            persisted settings + paths + saved-account bookkeeping
  credentials.py       OS-keychain credential storage (via keyring)
  _browser_forms.py    visible Playwright form for Amazon's JS challenge
  templates/ static/   the local web UI
install.command        one-click installer (macOS)
update.command         one-click updater (macOS)
launch.command         one-click launcher (macOS)
install.bat            one-click installer (Windows)
update.bat             one-click updater (Windows)
launch.bat             one-click launcher (Windows)
notepad/               research notes (library decision) in JSON
tests/                 smoke tests
```

## Development

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest
ruff check .
```

## Credits

The Amazon scraping is powered by
[`alexdlaird/amazon-orders`](https://github.com/alexdlaird/amazon-orders) — the
actively maintained, MIT-licensed library with first-class support for orders,
line items, transactions, and MFA / OTP. Marchant Transaction Details adds a
non-technical install path, a local web UI, MFA helpers, and a slim,
human-readable JSON export on top of it. The evaluation that led to picking
that library is recorded in
[`notepad/amazon-order-scraper-research.json`](notepad/amazon-order-scraper-research.json).

## Disclaimer

This tool downloads **your own** account data for personal record-keeping. It
relies on an unofficial scraper of Amazon's consumer website (English `.com`
locale) and may break when Amazon changes its pages. Use in accordance with
the relevant terms of service.
