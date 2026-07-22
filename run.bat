@echo off
title Logix Workbench
cd /d "%~dp0backend"

if not exist ".venv" (
  echo Creating Python virtual environment...
  python -m venv .venv
)

echo Installing / verifying dependencies...
.venv\Scripts\python.exe -m pip install -q -r requirements.txt

echo.
echo  -----------------------------------------------
echo   Logix Workbench  ^|  http://127.0.0.1:8123
echo  -----------------------------------------------
echo  Press Ctrl+C to stop.
echo.
.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8123
