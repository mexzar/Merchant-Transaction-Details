#!/usr/bin/env bash
# Pull the latest changes from GitHub and refresh dependencies.

set -e
cd "$(dirname "$0")"

echo
echo "=========================================="
echo "  Merchant Transaction Details — updater"
echo "=========================================="
echo

if [ ! -d ".venv" ]; then
  echo "  ✗ No virtual environment found. Run install.command first."
  echo
  read -p "  Press Enter to close…" _
  exit 1
fi

if [ -d ".git" ]; then
  echo "  Pulling latest from GitHub…"
  git pull --ff-only || {
    echo
    echo "  ✗ git pull failed. If you have local changes, commit or stash them first."
    read -p "  Press Enter to close…" _
    exit 1
  }
else
  echo "  (Not a git checkout — skipping git pull.)"
fi

echo
echo "  Updating app dependencies…"
./.venv/bin/python -m pip install --quiet --upgrade pip setuptools wheel
./.venv/bin/python -m pip install --quiet --upgrade -e .

echo "  Refreshing the browser binary if a new version is needed…"
./.venv/bin/python -m playwright install chromium

echo
echo "  ✓ Up to date."
echo
read -p "  Press Enter to close…" _
