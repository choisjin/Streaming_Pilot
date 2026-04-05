"""
Ideality Remote Desktop — 트레이 아이콘 런처
더블클릭으로 실행, 트레이에서 시작/중지/브라우저 열기.
Sunshine + Ideality 서버 동시 실행 지원.
"""
import os
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import messagebox
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
VENV_PYTHON = os.path.join(ROOT, "venv", "Scripts", "python.exe")
HOST_MAIN = os.path.join(ROOT, "host", "main.py")
PORT = 8080

# Sunshine 경로 (설치된 경우)
SUNSHINE_PATHS = [
    os.path.join(ROOT, "sunshine", "sunshine.exe"),         # 포터블 (프로젝트 내)
    os.path.expandvars(r"%ProgramFiles%\Sunshine\sunshine.exe"),  # 기본 설치
    os.path.expandvars(r"%ProgramFiles(x86)%\Sunshine\sunshine.exe"),
]


def _find_sunshine() -> str | None:
    """Sunshine 실행 파일 탐색."""
    for path in SUNSHINE_PATHS:
        if os.path.exists(path):
            return path
    # PATH에서도 찾기
    try:
        result = subprocess.run(
            ["where", "sunshine"], capture_output=True, text=True, timeout=3,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        if result.returncode == 0:
            return result.stdout.strip().split('\n')[0]
    except Exception:
        pass
    return None


def _get_tailscale_ip() -> str | None:
    """Tailscale IPv4 주소 조회."""
    try:
        result = subprocess.run(
            ["tailscale", "ip", "-4"],
            capture_output=True, text=True, timeout=3,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return None


class IdealityLauncher:
    def __init__(self):
        self.process = None
        self.sunshine_process = None
        self.running = False
        self.auto_restart = True
        self.restart_count = 0
        self.max_restarts = 3
        self.sunshine_path = _find_sunshine()

        self.root = tk.Tk()
        self.root.title("Ideality Remote Desktop")
        self.root.geometry("420x340")
        self.root.resizable(False, False)
        self.root.configure(bg="#1a1a2e")
        self.root.protocol("WM_DELETE_WINDOW", self.minimize_to_tray)

        # Title
        tk.Label(
            self.root, text="Ideality Remote Desktop",
            font=("Segoe UI", 14, "bold"), fg="#e0e0e0", bg="#1a1a2e"
        ).pack(pady=(15, 3))

        # Status
        self.status_var = tk.StringVar(value="Stopped")
        self.status_label = tk.Label(
            self.root, textvariable=self.status_var,
            font=("Segoe UI", 11), fg="#ff6b6b", bg="#1a1a2e"
        )
        self.status_label.pack(pady=3)

        # Sunshine status
        self.sunshine_var = tk.StringVar(
            value=f"Sunshine: {'Found' if self.sunshine_path else 'Not found'}"
        )
        tk.Label(
            self.root, textvariable=self.sunshine_var,
            font=("Segoe UI", 8), fg="#888", bg="#1a1a2e"
        ).pack(pady=1)

        # URL
        self.url_var = tk.StringVar(value="")
        tk.Label(
            self.root, textvariable=self.url_var,
            font=("Segoe UI", 9), fg="#64b5f6", bg="#1a1a2e", cursor="hand2"
        ).pack(pady=2)

        # Buttons
        btn_frame = tk.Frame(self.root, bg="#1a1a2e")
        btn_frame.pack(pady=15)

        self.start_btn = tk.Button(
            btn_frame, text="▶ Start All", command=self.start_all,
            font=("Segoe UI", 10), bg="#2d6a4f", fg="white",
            width=14, relief="flat", cursor="hand2"
        )
        self.start_btn.grid(row=0, column=0, padx=5)

        self.stop_btn = tk.Button(
            btn_frame, text="■ Stop All", command=self.stop_all,
            font=("Segoe UI", 10), bg="#d32f2f", fg="white",
            width=14, relief="flat", state="disabled", cursor="hand2"
        )
        self.stop_btn.grid(row=0, column=1, padx=5)

        tk.Button(
            self.root, text="Open in Browser", command=self.open_browser,
            font=("Segoe UI", 9), bg="#1a1a2e", fg="#64b5f6",
            relief="flat", cursor="hand2", bd=0
        ).pack(pady=3)

        # Log area
        self.log_text = tk.Text(
            self.root, height=5, bg="#0d1117", fg="#8b949e",
            font=("Consolas", 8), relief="flat", state="disabled"
        )
        self.log_text.pack(fill="x", padx=10, pady=(5, 10))

        # Check venv
        if not os.path.exists(VENV_PYTHON):
            self.log("ERROR: venv not found. Run setup.bat first.")
            self.start_btn.config(state="disabled")

    def log(self, msg):
        self.log_text.config(state="normal")
        self.log_text.insert("end", msg + "\n")
        self.log_text.see("end")
        self.log_text.config(state="disabled")

    def start_all(self):
        """Start Ideality server + Sunshine (if available)."""
        if self.running:
            return

        # Start Sunshine first (if found)
        if self.sunshine_path:
            self._start_sunshine()

        # Start Ideality server
        self.start_server()

    def stop_all(self):
        """Stop both Ideality server and Sunshine."""
        self.auto_restart = False
        self._stop_sunshine()
        self._stop_server()

    def _start_sunshine(self):
        """Start Sunshine in background."""
        if not self.sunshine_path:
            return
        try:
            self.sunshine_process = subprocess.Popen(
                [self.sunshine_path],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            self.sunshine_var.set(f"Sunshine: Running (PID {self.sunshine_process.pid})")
            self.log(f"Sunshine started: {self.sunshine_path}")
        except Exception as e:
            self.log(f"Sunshine failed: {e}")
            self.sunshine_var.set("Sunshine: Failed to start")

    def _stop_sunshine(self):
        """Stop Sunshine process."""
        if self.sunshine_process:
            self.log("Stopping Sunshine...")
            self.sunshine_process.terminate()
            try:
                self.sunshine_process.wait(timeout=5)
            except Exception:
                self.sunshine_process.kill()
            self.sunshine_process = None
            self.sunshine_var.set(f"Sunshine: {'Found' if self.sunshine_path else 'Not found'}")

    def start_server(self):
        if self.running:
            return

        self.auto_restart = True
        self.restart_count = 0
        self.log("Starting Ideality server...")
        self.start_btn.config(state="disabled")

        def run():
            try:
                self.process = subprocess.Popen(
                    [VENV_PYTHON, HOST_MAIN],
                    cwd=os.path.join(ROOT, "host"),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                )
                self.running = True
                self.root.after(0, self._update_ui_running)

                for line in self.process.stdout:
                    line = line.strip()
                    if line:
                        self.root.after(0, self.log, line[:80])

                self.running = False
                self.process = None

                # Auto-restart if server died
                if self.auto_restart and self.restart_count < self.max_restarts:
                    self.restart_count += 1
                    self.root.after(0, self.log, f"Server stopped. Restarting ({self.restart_count}/{self.max_restarts})...")
                    import time

                    if self.process:
                        try: self.process.kill()
                        except: pass
                        try: self.process.wait(timeout=3)
                        except: pass
                        self.process = None

                    try:
                        subprocess.run(
                            ['cmd.exe', '/c', 'for /f "tokens=5" %a in (\'netstat -ano ^| findstr :8080 ^| findstr LISTENING\') do taskkill /f /pid %a'],
                            capture_output=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW
                        )
                    except: pass

                    time.sleep(5)
                    self.root.after(0, self._do_restart)
                elif self.restart_count >= self.max_restarts:
                    self.root.after(0, self.log, "Max restarts reached. Click Start to retry.")
                    self.root.after(0, self._update_ui_stopped)
                else:
                    self.root.after(0, self._update_ui_stopped)

            except Exception as e:
                self.root.after(0, self.log, f"ERROR: {e}")
                self.root.after(0, self._update_ui_stopped)

        threading.Thread(target=run, daemon=True).start()

    def _do_restart(self):
        count = self.restart_count
        self.running = False
        self.process = None
        self._update_ui_stopped()
        self.start_server()
        self.restart_count = count

    def _stop_server(self):
        if self.process:
            self.log("Stopping Ideality server...")
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except Exception:
                self.process.kill()
            self.process = None
            self.running = False
            self._update_ui_stopped()

    def open_browser(self):
        webbrowser.open(f"http://localhost:{PORT}")

    def minimize_to_tray(self):
        if self.running:
            self.root.withdraw()
        else:
            self.root.destroy()

    def _update_ui_running(self):
        self.status_var.set("● Running")
        self.status_label.config(fg="#4caf50")
        ts_ip = _get_tailscale_ip()
        if ts_ip:
            self.url_var.set(f"Local: localhost:{PORT}  |  Tailscale: {ts_ip}:{PORT}")
        else:
            self.url_var.set(f"Local: localhost:{PORT}  |  Tailscale: not connected")
        self.start_btn.config(state="disabled")
        self.stop_btn.config(state="normal")

    def _update_ui_stopped(self):
        self.status_var.set("○ Stopped")
        self.status_label.config(fg="#ff6b6b")
        self.url_var.set("")
        self.start_btn.config(state="normal")
        self.stop_btn.config(state="disabled")

    def run(self):
        self.root.mainloop()
        # Cleanup on exit
        self._stop_sunshine()
        if self.process:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except Exception:
                self.process.kill()


if __name__ == "__main__":
    app = IdealityLauncher()
    app.run()
