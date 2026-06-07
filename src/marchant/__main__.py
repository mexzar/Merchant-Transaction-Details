"""Launcher: start the local web server and open the browser.

Run with either:
    marchant            # console script (after `pip install -e .`)
    python -m marchant
"""

from __future__ import annotations

import argparse
import threading
import webbrowser

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="Marchant Transaction Details — local web app")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="Port to bind (default: 8765)")
    parser.add_argument("--no-browser", action="store_true", help="Don't auto-open the browser")
    args = parser.parse_args()

    url = f"http://{args.host}:{args.port}/"
    if not args.no_browser:
        # Open the browser shortly after the server starts accepting connections.
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()

    print(f"\n  Marchant Transaction Details is running at {url}")
    print("  Press Ctrl+C to stop.\n")
    uvicorn.run("marchant.server:app", host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
