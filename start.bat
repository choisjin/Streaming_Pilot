@echo off
title Ideality Remote Desktop
cd /d "%~dp0"

echo ============================================
echo   Ideality Remote Desktop Server
echo ============================================
echo.

:: Check Python venv
if not exist "venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found.
    echo Run setup.bat first.
    pause
    exit /b 1
)

:: Check web build
if not exist "web\dist\index.html" (
    echo [WARN] Web build not found. Building...
    cd web && call npm run build && cd ..
    echo.
)

:: Start Cloudflare Tunnel in background
where cloudflared >nul 2>&1
if not errorlevel 1 (
    echo Starting Cloudflare Tunnel...
    start /b cloudflared tunnel run ideality-remote >nul 2>&1
    echo   https://remote.ideality.kr
    echo.
)

:: Start server
echo Starting server on http://localhost:8080
echo Press Ctrl+C to stop.
echo.
venv\Scripts\python host\main.py

:: Cleanup tunnel on exit
taskkill /f /im cloudflared.exe >nul 2>&1
pause
