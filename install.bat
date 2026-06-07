@echo off
REM One-click installer for Marchant Transaction Details (Windows).
REM Double-click this file in File Explorer. A console window opens, sets up
REM the Python virtual environment, installs all dependencies, and downloads
REM the browser used to log in to Amazon. Re-run anytime to refresh.

setlocal
cd /d "%~dp0"

echo.
echo ==========================================
echo   Marchant Transaction Details - installer
echo ==========================================
echo.

REM --- Locate Python 3.9+ -----------------------------------------------------
REM Prefer the Windows Python launcher (`py -3`), which is what the official
REM Python.org installer registers; fall back to `python` on PATH.
set PYTHON=
py -3 --version >nul 2>&1
if not errorlevel 1 (
    set "PYTHON=py -3"
) else (
    python --version >nul 2>&1
    if not errorlevel 1 (
        set "PYTHON=python"
    )
)

if "%PYTHON%"=="" (
    echo   X Python 3.9 or newer was not found.
    echo.
    echo   Install Python from https://www.python.org/downloads/windows/
    echo   IMPORTANT: tick "Add python.exe to PATH" during install.
    echo   Then re-run this installer.
    echo.
    pause
    exit /b 1
)

echo   Using:
%PYTHON% --version
echo.

REM --- Build venv -------------------------------------------------------------
if not exist ".venv" (
    echo   Creating virtual environment in .venv\ ...
    %PYTHON% -m venv .venv
    if errorlevel 1 (
        echo   X Failed to create virtual environment.
        pause
        exit /b 1
    )
)

REM --- Upgrade pip toolchain --------------------------------------------------
echo   Updating pip toolchain...
".venv\Scripts\python.exe" -m pip install --quiet --upgrade pip setuptools wheel

REM --- Install package + all dependencies (incl. amazon-orders[browser]) -----
echo   Installing app dependencies (one-time, ~1-2 min)...
".venv\Scripts\python.exe" -m pip install --quiet --upgrade -e .
if errorlevel 1 (
    echo   X Dependency install failed.
    pause
    exit /b 1
)

REM --- Download Playwright Chromium ------------------------------------------
echo   Downloading the browser used to handle Amazon's login challenge...
".venv\Scripts\python.exe" -m playwright install chromium

echo.
echo   Done.
echo.
echo   To start the app, double-click  launch.bat
echo   To update later,                double-click  update.bat
echo.
pause
