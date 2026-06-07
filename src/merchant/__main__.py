"""Launcher: start the local web server and open the browser.

Run with either:
    merchant            # console script (after `pip install -e .`)
    python -m merchant
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

import uvicorn


def _playwright_chromium_installed() -> bool:
    """Cheap check for a Playwright Chromium binary in its cache.

    Playwright stores browsers in a per-OS cache directory. We just look for
    any `chromium-*` folder; if present we skip the install step.
    """
    candidates = [
        Path.home() / "Library" / "Caches" / "ms-playwright",  # macOS
        Path.home() / ".cache" / "ms-playwright",  # Linux
        Path.home() / "AppData" / "Local" / "ms-playwright",  # Windows
    ]
    for root in candidates:
        if root.exists() and any(p.name.startswith("chromium-") for p in root.iterdir()):
            return True
    return False


def _ensure_chromium() -> None:
    """Install Playwright's Chromium on first run.

    Amazon throws a JavaScript auth challenge that we solve with a real browser.
    This keeps the experience one-click for non-technical users — no terminal
    incantations needed.
    """
    if _playwright_chromium_installed():
        return
    print("\n  First-time setup: downloading the browser used for Amazon's login challenge")
    print("  (~170 MB, one-time). This can take a minute…\n")
    try:
        subprocess.run(
            [sys.executable, "-m", "playwright", "install", "chromium"],
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        print(
            f"\n  Browser install failed (exit {exc.returncode}). You can retry by running:\n"
            f"    {sys.executable} -m playwright install chromium\n",
            file=sys.stderr,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Merchant Transaction Details — local web app")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="Port to bind (default: 8765)")
    parser.add_argument("--no-browser", action="store_true", help="Don't auto-open the browser")
    args = parser.parse_args()

    _ensure_chromium()

    url = f"http://{args.host}:{args.port}/"
    if not args.no_browser:
        # Open the browser shortly after the server starts accepting connections.
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()

    print(f"\n  Merchant Transaction Details is running at {url}")
    print("  Press Ctrl+C to stop.\n")
    uvicorn.run("merchant.server:app", host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
