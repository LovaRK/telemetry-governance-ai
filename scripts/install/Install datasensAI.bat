@echo off
:: ============================================================================
:: datasensAI Installer v1.3.0 — Windows double-click launcher
::
:: Just double-click this file. It will:
::   1. Trigger a UAC prompt (click Yes) so install.ps1 can run as Admin
::   2. Show the installer menu where you pick what you want to do
::
:: You do NOT need to open a terminal or type any commands.
:: ============================================================================

:: Check if running as Administrator
net session >nul 2>&1
if %errorLevel% NEQ 0 (
    echo.
    echo Requesting Administrator access to run the installer...
    echo A UAC prompt will appear -- please click Yes.
    echo.
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

:: Elevated. Show welcome banner then launch the installer.
cls
echo.
echo ===========================================================================
echo.
echo    datasensAI Installer v1.3.0
echo.
echo    A menu will appear in a moment. Choose what you want to do:
echo      1) Install for the first time
echo      2) Start an existing install
echo      3) Repair if something is broken
echo      (and more options)
echo.
echo    You may see install dialogs for Docker Desktop, Git, or Ollama.
echo    First install: 15-25 min (mostly the ~5 GB AI model download).
echo    The installer will NOT show "complete" until login is verified.
echo.
echo    If you need to stop, press Ctrl+C -- safe to re-run later.
echo.
echo ===========================================================================
echo.
timeout /t 3 /nobreak >nul

:: Run install.ps1 from the same directory as this .bat
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*

echo.
echo Press any key to close this window.
pause >nul
