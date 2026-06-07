@echo off
REM Launch the Merchant Transaction Details app (Windows).
REM Double-click in File Explorer. The web UI opens in your default browser.
REM Quit the app by closing this console window or pressing Ctrl+C.

setlocal
cd /d "%~dp0"

if not exist ".venv" (
    echo.
    echo   X Not installed yet - run install.bat first.
    echo.
    pause
    exit /b 1
)

".venv\Scripts\merchant.exe"
