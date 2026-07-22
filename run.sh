#!/usr/bin/env bash
# Logix Workbench — run from source (any OS with Python 3.10+)
set -e
cd "$(dirname "$0")/backend"

if [ ! -d ".venv" ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv .venv
fi

if [ -f ".venv/bin/python" ]; then PY=".venv/bin/python"
else PY=".venv/Scripts/python.exe"; fi

echo "Installing / verifying dependencies..."
"$PY" -m pip install -q -r requirements.txt

echo ""
echo "  -----------------------------------------------"
echo "   Logix Workbench  |  http://127.0.0.1:8123"
echo "  -----------------------------------------------"
echo "  Press Ctrl+C to stop."
echo ""
"$PY" -m uvicorn main:app --host 127.0.0.1 --port 8123
