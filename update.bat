@echo off
REM Pull the latest changes from GitHub and refresh dependencies (Windows).

setlocal
cd /d "%~dp0"

echo.
echo ==========================================
echo   Merchant Transaction Details - updater
echo ==========================================
echo.

if not exist ".venv" (
    echo   X No virtual environment found. Run install.bat first.
    echo.
    pause
    exit /b 1
)

if exist ".git" (
    echo   Pulling latest from GitHub...
    git pull --ff-only
    if errorlevel 1 (
        echo.
        echo   X git pull failed. If you have local changes, commit or stash them first.
        pause
        exit /b 1
    )
) else (
    echo   (Not a git checkout - skipping git pull.)
)

echo.
echo   Updating app dependencies...
".venv\Scripts\python.exe" -m pip install --quiet --upgrade pip setuptools wheel
".venv\Scripts\python.exe" -m pip install --quiet --upgrade -e .

echo   Refreshing the browser binary if a new version is needed...
".venv\Scripts\python.exe" -m playwright install chromium

echo.
echo   Up to date.
echo.
pause
