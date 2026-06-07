#!/usr/bin/env bash
# One-click installer for Marchant Transaction Details (macOS).
# Double-click this file in Finder. A Terminal window opens, sets up the
# Python virtual environment, installs all dependencies, and downloads the
# browser used to log in to Amazon. Re-run anytime to refresh.

set -e
cd "$(dirname "$0")"

# Pinned standalone Python, fetched only if the system has no usable Python.
# Bump these two together from https://github.com/astral-sh/python-build-standalone/releases
PBS_TAG="20260602"
PBS_PYVER="3.12.13"

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

# --- No system Python? Fetch a private copy (no admin, no PATH changes) -------
# A self-contained build is downloaded into .python/ inside this folder and used
# only by this app. Delete the folder to remove it; nothing else on the Mac is
# touched. Reused on re-runs once present.
if [ -z "$PYTHON" ] && [ -x ".python/bin/python3" ]; then
  PYTHON="$PWD/.python/bin/python3"
fi

if [ -z "$PYTHON" ]; then
  case "$(uname -m)" in
    arm64|aarch64) triple="aarch64-apple-darwin" ;;
    x86_64)        triple="x86_64-apple-darwin" ;;
    *) echo "  ✗ Unsupported CPU type: $(uname -m)"; read -p "  Press Enter to close…" _; exit 1 ;;
  esac
  asset="cpython-${PBS_PYVER}+${PBS_TAG}-${triple}-install_only.tar.gz"
  url="https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/${asset}"

  echo "  No Python found on this Mac — fetching a private copy (no admin needed)."
  echo "  Downloading Python ${PBS_PYVER} (~45 MB)…"
  rm -rf .python && mkdir -p .python
  if ! curl -fL --retry 3 -o .python/python.tar.gz "$url"; then
    echo "  ✗ Download failed. Check your internet connection and re-run."
    read -p "  Press Enter to close…" _
    exit 1
  fi
  echo "  Unpacking…"
  tar -xzf .python/python.tar.gz -C .python --strip-components=1
  rm -f .python/python.tar.gz
  PYTHON="$PWD/.python/bin/python3"
  if [ ! -x "$PYTHON" ]; then
    echo "  ✗ Bundled Python is missing after unpack. Please re-run the installer."
    read -p "  Press Enter to close…" _
    exit 1
  fi
fi

echo "  Using $("$PYTHON" --version) at $PYTHON"
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
