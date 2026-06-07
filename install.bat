@echo off
REM One-click installer for Marchant Transaction Details (Windows).
REM Double-click this file in File Explorer. A console window opens, sets up
REM the Python virtual environment, installs all dependencies, and downloads
REM the browser used to log in to Amazon. Re-run anytime to refresh.

setlocal enabledelayedexpansion
cd /d "%~dp0"

REM Pinned standalone Python, fetched only if the system has no usable Python.
REM Bump these two together from
REM https://github.com/astral-sh/python-build-standalone/releases
set "PBS_TAG=20260602"
set "PBS_PYVER=3.12.13"

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

REM --- No system Python? Fetch a private copy (no admin, no PATH changes) ------
REM A self-contained build is downloaded into .python\ inside this folder and
REM used only by this app. Delete the folder to remove it; nothing else on the
REM PC is touched. Reused on re-runs once present.
if "%PYTHON%"=="" if exist ".python\python.exe" set "PYTHON=.python\python.exe"

if "%PYTHON%"=="" (
    set "ARCH=x86_64"
    if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=aarch64"
    if /i "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "ARCH=aarch64"
    set "ASSET=cpython-%PBS_PYVER%+%PBS_TAG%-!ARCH!-pc-windows-msvc-install_only.tar.gz"
    set "URL=https://github.com/astral-sh/python-build-standalone/releases/download/%PBS_TAG%/!ASSET!"

    echo   No Python found on this PC - fetching a private copy ^(no admin needed^).
    echo   Downloading Python %PBS_PYVER% ^(~45 MB^)...
    if exist ".python" rmdir /s /q ".python"
    mkdir ".python"
    curl.exe -fL --retry 3 -o ".python\python.tar.gz" "!URL!"
    if errorlevel 1 (
        echo   X Download failed. Check your internet connection and re-run.
        pause
        exit /b 1
    )
    echo   Unpacking...
    tar.exe -xzf ".python\python.tar.gz" -C ".python" --strip-components=1
    del /q ".python\python.tar.gz"
    if not exist ".python\python.exe" (
        echo   X Bundled Python is missing after unpack. Please re-run the installer.
        pause
        exit /b 1
    )
    set "PYTHON=.python\python.exe"
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
