#!/usr/bin/env bash
# Launch the Merchant Transaction Details app.
# Double-click in Finder. The web UI opens in your default browser.
# Quit the app by closing this Terminal window or pressing Ctrl+C.

set -e
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  echo
  echo "  ✗ Not installed yet — run install.command first."
  echo
  read -p "  Press Enter to close…" _
  exit 1
fi

exec ./.venv/bin/merchant
