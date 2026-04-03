@echo off
title Ideality Remote Desktop - Setup
cd /d "%~dp0"

echo ============================================
echo   Ideality Remote Desktop - Initial Setup
echo ============================================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Install Python 3.10+ first.
    pause
    exit /b 1
)

:: Create venv
if not exist "venv\Scripts\python.exe" (
    echo [1/4] Creating virtual environment...
    python -m venv venv
) else (
    echo [1/4] Virtual environment exists.
)

:: Install Python dependencies
echo [2/4] Installing Python packages...
venv\Scripts\pip install -r host\requirements.txt --quiet

:: Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [WARN] Node.js not found. Skipping web build.
    echo Install Node.js 18+ to build the web client.
    goto :done
)

:: Install npm dependencies
echo [3/4] Installing web dependencies...
cd web
call npm install --silent
echo [4/4] Building web client...
call npm run build
cd ..

:done
echo.
echo ============================================
echo   Setup complete!
echo   Run start.bat to launch the server.
echo ============================================
pause
