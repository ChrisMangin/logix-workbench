#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/backend"
if [ ! -d ".venv" ]; then python -m venv .venv; fi
if [ -f ".venv/bin/python" ]; then PY=".venv/bin/python"; else PY=".venv/Scripts/python.exe"; fi
"$PY" -m pip install -q -r requirements.txt pyinstaller
"$PY" -m PyInstaller \
  --name L5XEditor --onefile --windowed \
  --add-data "../frontend;frontend" \
  --collect-all uvicorn --collect-all fastapi --collect-all lxml \
  --collect-all pystray --collect-all PIL \
  --hidden-import l5x_handler --clean --noconfirm \
  launcher.py

mkdir -p ../dist

# Kill any running instance so Windows releases the file lock before we copy
echo "Stopping any running L5XEditor.exe..."
powershell.exe -NoProfile -Command "
  \$proc = Get-Process -Name 'L5XEditor' -ErrorAction SilentlyContinue
  if (\$proc) {
    \$proc | Stop-Process -Force
    Start-Sleep -Milliseconds 800
    Write-Host 'L5XEditor stopped.'
  } else {
    Write-Host 'L5XEditor not running.'
  }
" 2>/dev/null || true

cp -f dist/L5XEditor.exe ../dist/L5XEditor.exe
echo "Built: ../dist/L5XEditor.exe"
