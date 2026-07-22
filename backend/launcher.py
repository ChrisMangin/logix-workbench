"""
Launcher entry point used to build the standalone L5X Editor .exe with
PyInstaller. Runs the FastAPI/uvicorn server in a background thread and
shows a small system tray icon (no console window) with "Open" / "Quit"
actions. The browser is opened automatically on first start.

All output is redirected to a log file next to the .exe (or next to this
script when run from source) since there's no console to see it in.
"""
import os
import socket
import sys
import threading
import time
import traceback
import webbrowser

DEFAULT_PORT = 8123


def _app_dir() -> str:
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def _setup_logging() -> str:
    log_path = os.path.join(_app_dir(), "L5XEditor.log")
    try:
        log_file = open(log_path, "a", buffering=1, encoding="utf-8")
        sys.stdout = log_file
        sys.stderr = log_file
    except Exception:
        pass
    return log_path


def _show_error(message: str) -> None:
    """Best-effort native message box so failures aren't silent with no console."""
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, message, "L5X Editor - Error", 0x10)
    except Exception:
        pass


def find_free_port(preferred: int = DEFAULT_PORT) -> int:
    port = preferred
    while port < preferred + 50:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.2)
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
        port += 1
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _make_tray_icon():
    """Builds a small in-memory icon image (no external asset needed)."""
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((4, 4, 60, 60), radius=12, fill=(59, 130, 246, 255))
    d.text((16, 18), "L5", fill=(255, 255, 255, 255))
    return img


def main() -> None:
    log_path = _setup_logging()
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

    try:
        import uvicorn
        import main as app_module  # the FastAPI app (backend/main.py)

        port = find_free_port()
        url = f"http://127.0.0.1:{port}"

        print("=" * 60)
        print("  L5X Editor for Studio 5000")
        print(f"  Running at: {url}")
        print(f"  Log file: {log_path}")
        print("=" * 60)

        config = uvicorn.Config(app_module.app, host="127.0.0.1", port=port, log_level="info")
        server = uvicorn.Server(config)

        server_thread = threading.Thread(target=server.run, daemon=True)
        server_thread.start()

        def open_browser():
            time.sleep(1.0)
            try:
                webbrowser.open(url)
            except Exception:
                pass

        threading.Thread(target=open_browser, daemon=True).start()

        # System tray icon (keeps the app discoverable/quittable with no console/taskbar window).
        try:
            import pystray

            def on_open(icon, item):
                webbrowser.open(url)

            def on_quit(icon, item):
                icon.stop()
                server.should_exit = True
                os._exit(0)

            icon = pystray.Icon(
                "L5XEditor",
                icon=_make_tray_icon(),
                title=f"L5X Editor ({url})",
                menu=pystray.Menu(
                    pystray.MenuItem("Open L5X Editor", on_open, default=True),
                    pystray.MenuItem(f"Running at {url}", None, enabled=False),
                    pystray.MenuItem("Quit", on_quit),
                ),
            )
            icon.run()  # blocks on the main thread until Quit is clicked
        except Exception:
            # No tray support available (e.g. headless) - just block on the server thread.
            print("Tray icon unavailable, falling back to console-less blocking mode.")
            print(err := traceback.format_exc())
            server_thread.join()

    except Exception:
        err = traceback.format_exc()
        try:
            print(err)
        except Exception:
            pass
        _show_error(
            "L5X Editor failed to start.\n\n"
            f"Details were written to:\n{log_path}\n\n{err[-500:]}"
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
