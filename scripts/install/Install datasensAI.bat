@echo off
:: ============================================================================
:: Windows double-click wrapper: triggers UAC, then runs install.ps1.
:: Users never have to type in a terminal - just double-click this file.
::
:: How it works:
::   1. If not elevated, re-launch itself via PowerShell Start-Process -Verb RunAs
::      (this is what triggers the UAC prompt the user sees)
::   2. Once elevated, set ExecutionPolicy Bypass for THIS process only and
::      exec install.ps1 sitting next to this .bat file
:: ============================================================================

:: Check if running as Administrator
net session >nul 2>&1
if %errorLevel% NEQ 0 (
    echo.
    echo Re-launching as Administrator to install Docker Desktop and friends...
    echo You will see a UAC prompt - please click Yes.
    echo.
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

:: We're elevated. Show the welcome banner.
cls
echo ==================================================================
echo.
echo     datasensAI installer is starting in this PowerShell window.
echo.
echo     You may see additional install dialogs for Docker Desktop,
echo     Git, and Ollama (all via winget).
echo.
echo     The whole thing takes 15-25 min on a clean Windows machine
echo     (mostly the Ollama model download). Once it finishes, the
echo     success message will tell you where to log in.
echo.
echo     If you need to stop, press Ctrl+C and re-run later - the
echo     installer is safe to re-run.
echo.
echo ==================================================================
echo.
timeout /t 5 /nobreak >nul

:: Run install.ps1 from the same directory as this .bat
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*

echo.
echo Press any key to close this window.
pause >nul
