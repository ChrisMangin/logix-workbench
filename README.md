<div align="center">
  <h1>⚙ Logix Workbench</h1>
  <p><strong>Studio 5000-style editor &amp; diff tool for Allen-Bradley .L5X files</strong></p>
  <p>
    <img src="https://img.shields.io/badge/platform-Windows-blue?logo=windows" alt="Platform">
    <img src="https://img.shields.io/badge/python-3.10%2B-blue?logo=python" alt="Python">
    <img src="https://img.shields.io/github/v/release/ChrisMangin/logix-workbench" alt="Release">
    <img src="https://img.shields.io/github/license/ChrisMangin/logix-workbench" alt="License">
  </p>
  <br>
  <img src="docs/screenshots/home.png" alt="Logix Workbench Home Screen" width="850">
</div>

---

Logix Workbench is a **standalone Windows app** (no Studio 5000 required) that lets you open, edit, and diff Rockwell Automation `.L5X` controller export files from any browser — with a clean dark UI, visual ladder diagram rendering, and a full side-by-side comparison engine.

## Features

### Editor
- **Open any `.L5X` file** via native Windows file picker — no uploading, reads directly from disk
- **Controller Organizer** sidebar with collapse/expand all — navigate programs, routines, tags, data types, AOIs, I/O, tasks, and trends
- **Visual Ladder Diagram** — renders rungs as graphical diagrams with click-to-edit; switch to Raw Text mode any time
- **Tags** — full CRUD for controller and program-scoped tags; drill into UDT/array members and individual DINT bits with live values; right-click to copy name or value
- **AOI Editor** — tabbed view of Parameters, Local Tags, and Logic with full inline editing
- **Data Types** — view and edit UDT member tables inline
- **I/O Configuration**, **Tasks**, and **Trends** panels
- **Multiple editor tabs** — work on several files at once; `Ctrl+Tab` to cycle
- **Save** downloads the modified `.L5X` back to disk; unsaved-change indicator on every tab

### Compare
- **Side-by-side diff** of any two `.L5X` files — tags, routines, AOIs, data types, programs, I/O, and trends
- **Diff tree** with change counts; filter by name; click any item to render it in A/B panes
- **Rung-level diff** — detects changed rung content even when rung counts are identical
- **Find in diff** — search rung text, tag names, routine names across the entire result; navigates and scrolls to the exact rung in the correct panel (A or B)
- **📋 Copy Diff** — one click copies a plain-text summary of all changes to clipboard
- Visual / Raw Text toggle for all rung cards without rerunning the comparison

### Quality of Life
- **Keyboard shortcuts** — `Ctrl+S/O/N/W/F/G/Tab` + `?` + `Ctrl+/` cheatsheet
- **Recent files** on the home screen with live filter
- **Jump to rung** (`Ctrl+G`) — prompts for a number and scrolls directly there
- **User Guide** opens in a separate browser tab (`?` key)
- Runs 100% locally — nothing is sent over the internet

---

## Screenshots

<table>
<tr>
  <td><img src="docs/screenshots/home.png" alt="Home Screen" width="420"></td>
  <td><img src="docs/screenshots/editor_empty.png" alt="Editor" width="420"></td>
</tr>
<tr>
  <td align="center"><em>Home screen with feature cards &amp; recent files</em></td>
  <td align="center"><em>Editor with Controller Organizer sidebar</em></td>
</tr>
<tr>
  <td><img src="docs/screenshots/shortcuts.png" alt="Keyboard Shortcuts" width="420"></td>
  <td><img src="docs/screenshots/user_guide.png" alt="User Guide" width="420"></td>
</tr>
<tr>
  <td align="center"><em>Keyboard shortcut cheatsheet (Ctrl+/)</em></td>
  <td align="center"><em>Built-in User Guide (opens in new tab)</em></td>
</tr>
</table>

---

## Quick Start

### Option 1 — Standalone EXE (Windows, no Python needed)

1. Download **`L5XEditor.exe`** from the [latest release](https://github.com/ChrisMangin/logix-workbench/releases/latest)
2. Double-click it — a browser tab opens automatically at `http://127.0.0.1:8123`
3. Click **+ Editor**, then **Open** to load your `.L5X` file

> Close the console window (or press `Ctrl+C` in it) to stop the server.

### Option 2 — Run from Source

**Requirements:** Python 3.10+

**Windows:**
```bat
run.bat
```

**macOS / Linux:**
```bash
./run.sh
```

Both scripts create a virtual environment on first run, install dependencies, and open the app at `http://127.0.0.1:8123`.

**Manual start:**
```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8123
```

### Option 3 — Rebuild the EXE

```bash
./build_exe.sh
```

Requires Python 3.10+ with PyInstaller. Produces `dist/L5XEditor.exe` (~30 MB, self-contained).

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+S` | Save file |
| `Ctrl+O` | Open file |
| `Ctrl+N` | New file |
| `Ctrl+W` | Close current tab |
| `Ctrl+F` | Focus find / search box |
| `Ctrl+Tab` | Next tab |
| `Ctrl+Shift+Tab` | Previous tab |
| `Ctrl+G` | Jump to rung number |
| `Ctrl+/` | Keyboard shortcut cheatsheet (toggle) |
| `?` | Open User Guide in new tab |
| `Esc` | Close open dialogs |

---

## Project Layout

```
logix-workbench/
├── backend/
│   ├── main.py             FastAPI REST API + serves the frontend
│   ├── l5x_handler.py      Core L5X XML engine (lxml-based)
│   ├── launcher.py         EXE entry point (starts server + opens browser)
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── style.css
│   ├── app.js              UI logic (~5000 lines, no build step)
│   ├── ladder.js           Visual ladder diagram renderer
│   └── guide.html          Standalone user guide page
├── docs/
│   └── screenshots/
├── dist/
│   └── L5XEditor.exe       Prebuilt Windows executable
├── build_exe.sh            Rebuild the EXE via PyInstaller
├── run.bat                 One-click launcher (Windows)
└── run.sh                  One-click launcher (macOS/Linux)
```

---

## Tech Stack

| Layer | Tech |
|---|---|
| Backend | Python 3.10+, FastAPI, uvicorn |
| XML parsing | lxml |
| Frontend | Vanilla HTML/CSS/JS — no framework, no build step |
| Packaging | PyInstaller (single-file EXE) |
| System tray | pystray + Pillow |

---

## License

MIT — see [LICENSE](LICENSE)
