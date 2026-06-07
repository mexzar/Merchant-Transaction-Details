#!/usr/bin/env bash
# One-click installer for Marchant Transaction Details (macOS).
# Double-click this file in Finder. A Terminal window opens, sets up the
# Python virtual environment, installs all dependencies, and downloads the
# browser used to log in to Amazon. Re-run anytime to refresh.

set -e
cd "$(dirname "$0")"

echo
echo "=========================================="
echo "  Marchant Transaction Details — installer"
echo "=========================================="
echo

# --- Locate a usable Python 3.9+ ---------------------------------------------
PYTHON=""
for cand in python3.12 python3.11 python3.10 python3.9 python3; do
  if command -v "$cand" >/dev/null 2>&1; then
    ver=$("$cand" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
    major=${ver%.*}; minor=${ver#*.}
    if [ "$major" -eq 3 ] && [ "$minor" -ge 9 ]; then
      PYTHON="$cand"
      break
    fi
  fi
done

if [ -z "$PYTHON" ]; then
  echo "  ✗ Python 3.9 or newer was not found."
  echo
  echo "  Install Python from https://www.python.org/downloads/macos/"
  echo "  Then re-run this installer."
  echo
  read -p "  Press Enter to close…" _
  exit 1
fi

echo "  Using $($PYTHON --version) at $(command -v "$PYTHON")"
echo

# --- Build venv --------------------------------------------------------------
if [ ! -d ".venv" ]; then
  echo "  Creating virtual environment in .venv/ …"
  "$PYTHON" -m venv .venv
fi

# --- Upgrade pip toolchain (Python 3.9 ships a too-old pip) ------------------
echo "  Updating pip toolchain…"
./.venv/bin/python -m pip install --quiet --upgrade pip setuptools wheel

# --- Install the package + all dependencies (incl. amazon-orders[browser]) ---
echo "  Installing app dependencies (one-time, ~1–2 min)…"
./.venv/bin/python -m pip install --quiet --upgrade -e .

# --- Download Playwright's Chromium (used for Amazon's JS login challenge) ---
echo "  Downloading the browser used to handle Amazon's login challenge…"
./.venv/bin/python -m playwright install chromium

echo
echo "  ✓ Done."
echo
echo "  To start the app, double-click  launch.command"
echo "  To update later,                double-click  update.command"
echo
read -p "  Press Enter to close…" _
