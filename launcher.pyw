"""
Ideality Remote Desktop — 트레이 아이콘 런처
더블클릭으로 실행, 트레이에서 시작/중지/브라우저 열기.
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


class IdealityLauncher:
    def __init__(self):
        self.process = None
        self.tunnel_process = None
        self.running = False
        self.auto_restart = True  # API 재시작 요청 시 자동 재시작

        self.root = tk.Tk()
        self.root.title("Ideality Remote Desktop")
        self.root.geometry("400x300")
        self.root.resizable(False, False)
        self.root.configure(bg="#1a1a2e")
        self.root.protocol("WM_DELETE_WINDOW", self.minimize_to_tray)

        # Title
        tk.Label(
            self.root, text="Ideality Remote Desktop",
            font=("Segoe UI", 14, "bold"), fg="#e0e0e0", bg="#1a1a2e"
        ).pack(pady=(20, 5))

        # Status
        self.status_var = tk.StringVar(value="Stopped")
        self.status_label = tk.Label(
            self.root, textvariable=self.status_var,
            font=("Segoe UI", 11), fg="#ff6b6b", bg="#1a1a2e"
        )
        self.status_label.pack(pady=5)

        # URL
        self.url_var = tk.StringVar(value="")
        tk.Label(
            self.root, textvariable=self.url_var,
            font=("Segoe UI", 9), fg="#64b5f6", bg="#1a1a2e", cursor="hand2"
        ).pack(pady=2)

        # Buttons
        btn_frame = tk.Frame(self.root, bg="#1a1a2e")
        btn_frame.pack(pady=20)

        self.start_btn = tk.Button(
            btn_frame, text="▶ Start Server", command=self.start_server,
            font=("Segoe UI", 10), bg="#2d6a4f", fg="white",
            width=14, relief="flat", cursor="hand2"
        )
        self.start_btn.grid(row=0, column=0, padx=5)

        self.stop_btn = tk.Button(
            btn_frame, text="■ Stop Server", command=self.stop_server,
            font=("Segoe UI", 10), bg="#d32f2f", fg="white",
            width=14, relief="flat", state="disabled", cursor="hand2"
        )
        self.stop_btn.grid(row=0, column=1, padx=5)

        tk.Button(
            self.root, text="🌐 Open in Browser", command=self.open_browser,
            font=("Segoe UI", 9), bg="#1a1a2e", fg="#64b5f6",
            relief="flat", cursor="hand2", bd=0
        ).pack(pady=5)

        # Log area
        self.log_text = tk.Text(
            self.root, height=4, bg="#0d1117", fg="#8b949e",
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

    def start_server(self):
        if self.running:
            return

        self.auto_restart = True
        self.log("Starting server...")
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

                # Start Cloudflare Tunnel
                self._start_tunnel()

                for line in self.process.stdout:
                    line = line.strip()
                    if line:
                        self.root.after(0, self.log, line[:80])

                self.running = False

                # Auto-restart if server died (API restart request)
                if self.auto_restart:
                    self.root.after(0, self.log, "Server stopped. Auto-restarting...")
                    import time; time.sleep(1)
                    self.root.after(0, self.start_server)
                else:
                    self.root.after(0, self._update_ui_stopped)

            except Exception as e:
                self.root.after(0, self.log, f"ERROR: {e}")
                self.root.after(0, self._update_ui_stopped)

        threading.Thread(target=run, daemon=True).start()

    def stop_server(self):
        self.auto_restart = False  # 수동 종료 시 재시작 안 함
        if self.tunnel_process:
            self.log("Stopping tunnel...")
            self.tunnel_process.terminate()
            try:
                self.tunnel_process.wait(timeout=3)
            except Exception:
                self.tunnel_process.kill()
            self.tunnel_process = None

        if self.process:
            self.log("Stopping server...")
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except Exception:
                self.process.kill()
            self.process = None
            self.running = False
            self._update_ui_stopped()

    def _start_tunnel(self):
        """Cloudflare Tunnel 시작."""
        try:
            cloudflared = "cloudflared"
            self.tunnel_process = subprocess.Popen(
                [cloudflared, "tunnel", "run", "ideality-remote"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            self.root.after(0, self.log, "Cloudflare Tunnel started (remote.ideality.kr)")
        except FileNotFoundError:
            self.root.after(0, self.log, "cloudflared not found — tunnel disabled")

    def open_browser(self):
        webbrowser.open(f"http://localhost:{PORT}")

    def minimize_to_tray(self):
        if self.running:
            self.root.withdraw()  # Hide window
        else:
            self.root.destroy()

    def _update_ui_running(self):
        self.status_var.set("● Running")
        self.status_label.config(fg="#4caf50")
        self.url_var.set(f"http://localhost:{PORT}  |  https://remote.ideality.kr")
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
        if self.tunnel_process:
            self.tunnel_process.terminate()
        if self.process:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except Exception:
                self.process.kill()


if __name__ == "__main__":
    app = IdealityLauncher()
    app.run()
