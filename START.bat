@echo off
setlocal enabledelayedexpansion
title FlowAir - Initializing...
color 0A

set PROJECT_DIR=%~dp0
cd /d "%PROJECT_DIR%"

echo.
echo ========================================
echo           FLOWAIR
echo    Professional Broadcast System
echo ========================================
echo.
echo [STEP 1/8] Checking system requirements...
echo.

where node >nul 2>nul
if !errorlevel! neq 0 (
    echo [ERROR] Node.js is not installed
    echo.
    echo Please install Node.js LTS from: https://nodejs.org/
    echo Recommended version: 18.x or higher
    echo.
    pause
    exit /b 1
)
echo [OK] Node.js found

where python >nul 2>nul
if !errorlevel! neq 0 (
    echo [ERROR] Python is not installed
    echo.
    echo Please install Python 3.11+ from: https://www.python.org/
    echo IMPORTANT: Check "Add Python to PATH" during installation
    echo.
    pause
    exit /b 1
)
echo [OK] Python found

echo.
echo [STEP 2/8] Checking FFmpeg...
echo.

if exist "%PROJECT_DIR%ffmpeg\bin\ffmpeg.exe" (
    echo [OK] FFmpeg found in project folder
    set "PATH=%PROJECT_DIR%ffmpeg\bin;%PATH%"
) else (
    where ffmpeg >nul 2>nul
    if !errorlevel! neq 0 (
        echo [WARNING] FFmpeg not found - video validation will not work
        echo Download from: https://github.com/BtbN/FFmpeg-Builds/releases
    ) else (
        echo [OK] FFmpeg found in system PATH
    )
)

echo.
echo [STEP 3/8] Setting up Python virtual environment...
echo.

cd /d "%PROJECT_DIR%backend"

if not exist "venv" (
    echo [SETUP] Creating virtual environment...
    python -m venv venv
    if !errorlevel! neq 0 (
        echo [ERROR] Failed to create virtual environment
        echo.
        pause
        exit /b 1
    )
    echo [OK] Virtual environment created
) else (
    echo [OK] Virtual environment already exists
)

echo [SETUP] Activating virtual environment...
call venv\Scripts\activate.bat
if !errorlevel! neq 0 (
    echo [ERROR] Failed to activate virtual environment
    echo.
    pause
    exit /b 1
)

echo.
echo [STEP 4/8] Installing Python dependencies...
echo.

pip --version >nul 2>nul
if !errorlevel! neq 0 (
    echo [WARNING] pip not found, upgrading pip...
    python -m ensurepip --upgrade
    python -m pip install --upgrade pip
)

if not exist "venv\Lib\site-packages\fastapi" (
    echo [SETUP] Installing backend dependencies (this may take a few minutes^)...
    pip install -r requirements.txt --quiet
    if !errorlevel! neq 0 (
        echo [ERROR] Failed to install Python dependencies
        echo.
        echo Retrying without cache...
        pip install -r requirements.txt --no-cache-dir
        if !errorlevel! neq 0 (
            echo [ERROR] Installation failed. Please check your internet connection.
            pause
            exit /b 1
        )
    )
    echo [OK] Python dependencies installed
) else (
    echo [OK] Python dependencies already installed
)

if not exist "venv\Lib\site-packages\psutil" (
    echo [SETUP] Installing psutil...
    pip install psutil==5.9.8 --quiet
    echo [OK] psutil installed
)

echo.
echo [STEP 5/8] Installing Node.js dependencies...
echo.

cd /d "%PROJECT_DIR%frontend"

if not exist "node_modules" (
    echo [SETUP] Installing frontend dependencies (this may take a few minutes^)...
    call npm install
    if !errorlevel! neq 0 (
        echo [ERROR] Failed to install Node.js dependencies
        echo.
        echo Retrying with clean cache...
        call npm cache clean --force
        call npm install
        if !errorlevel! neq 0 (
            echo [ERROR] Installation failed. Please check your internet connection.
            pause
            exit /b 1
        )
    )
    echo [OK] Node.js dependencies installed
) else (
    echo [OK] Node.js dependencies already installed
)

if not exist "node_modules\electron" (
    echo [WARNING] Electron not found, reinstalling...
    call npm install electron --save-dev
)

if not exist "node_modules\vite" (
    echo [WARNING] Vite not found, reinstalling...
    call npm install vite --save-dev
)

echo.
echo [STEP 6/8] Cleaning previous processes...
echo.

taskkill /F /IM python.exe >nul 2>nul
if !errorlevel! equ 0 (
    echo [OK] Stopped previous Python processes
)

taskkill /F /IM node.exe >nul 2>nul
if !errorlevel! equ 0 (
    echo [OK] Stopped previous Node.js processes
)

taskkill /F /IM electron.exe >nul 2>nul
if !errorlevel! equ 0 (
    echo [OK] Stopped previous Electron processes
)

echo [OK] Cleaning ports 3000-8000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":300" 2^>nul') do taskkill /F /PID %%a >nul 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000" 2^>nul') do taskkill /F /PID %%a >nul 2>nul

del /f /q "%PROJECT_DIR%.flowair.lock" 2>nul

timeout /t 2 /nobreak >nul

echo.
echo [STEP 7/7] Configuring Windows Firewall...
echo.

netsh advfirewall firewall show rule name="FlowAir Backend" >nul 2>nul
if !errorlevel! neq 0 (
    echo [SETUP] Adding firewall rule for port 8000...
    netsh advfirewall firewall add rule name="FlowAir Backend" dir=in action=allow protocol=TCP localport=8000 >nul 2>nul
    if !errorlevel! equ 0 (
        echo [OK] Firewall rule created successfully
    ) else (
        echo [WARNING] Could not create firewall rule automatically
        echo [INFO] You may need to allow port 8000 manually in Windows Firewall
    )
) else (
    echo [OK] Firewall rule already exists
)

echo.
echo [STEP 8/8] Starting FlowAir...
echo.

title FlowAir - Running

echo [START] Launching Python Backend...
cd /d "%PROJECT_DIR%backend"
start /B cmd /c "call venv\Scripts\activate.bat && python main.py"

timeout /t 3 /nobreak >nul

echo [START] Launching Vite Dev Server...
cd /d "%PROJECT_DIR%frontend"
start /B cmd /c "npx vite"

timeout /t 3 /nobreak >nul

echo [START] Opening FlowAir Application...
echo.
echo ========================================
echo      FlowAir is now running!
echo ========================================
echo.

call npm start

echo.
echo ========================================
echo      FlowAir closed
echo ========================================
echo.
echo Cleaning up...
del /f /q "%PROJECT_DIR%.flowair.lock" 2>nul
taskkill /F /IM python.exe >nul 2>nul
taskkill /F /IM node.exe >nul 2>nul

echo.
echo Cleanup complete. Press any key to exit...
pause >nul
