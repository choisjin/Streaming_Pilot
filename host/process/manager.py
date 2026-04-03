# Design Ref: PROJECT_SPEC §4.4 — 프로세스 관리 API
"""윈도우가 있는 프로세스 목록 조회 + 윈도우 정보 관리."""
from __future__ import annotations

import ctypes
import ctypes.wintypes
import logging
from dataclasses import dataclass

import psutil

logger = logging.getLogger(__name__)

user32 = ctypes.windll.user32
dwmapi = ctypes.windll.dwmapi


@dataclass
class WindowInfo:
    hwnd: int
    title: str
    pid: int
    process_name: str
    x: int
    y: int
    width: int
    height: int
    is_visible: bool


def get_window_list() -> list[WindowInfo]:
    """실행중인 프로세스 중 보이는 윈도우가 있는 것만 반환.

    필터: 보이는 윈도우, 타이틀 있음, 크기 > 0, 특수 윈도우 제외.
    """
    windows: list[WindowInfo] = []
    seen_pids: set[int] = set()

    WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_int, ctypes.c_int)

    def _enum_callback(hwnd: int, _: int) -> bool:
        # Must be visible
        if not user32.IsWindowVisible(hwnd):
            return True

        # Must have a title
        length = user32.GetWindowTextLengthW(hwnd)
        if length == 0:
            return True

        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value

        # Skip special windows
        if title in ("Program Manager", "Windows Input Experience"):
            return True

        # Get window rect
        rect = ctypes.wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        width = rect.right - rect.left
        height = rect.bottom - rect.top

        # Skip zero-size windows
        if width <= 1 or height <= 1:
            return True

        # Skip cloaked windows (hidden UWP apps)
        cloaked = ctypes.c_int(0)
        dwmapi.DwmGetWindowAttribute(
            hwnd, 14,  # DWMWA_CLOAKED
            ctypes.byref(cloaked), ctypes.sizeof(cloaked)
        )
        if cloaked.value != 0:
            return True

        # Get PID
        pid = ctypes.wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        pid_val = pid.value

        # Get process name
        try:
            proc = psutil.Process(pid_val)
            process_name = proc.name()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            process_name = "unknown"

        windows.append(WindowInfo(
            hwnd=hwnd,
            title=title,
            pid=pid_val,
            process_name=process_name,
            x=rect.left,
            y=rect.top,
            width=width,
            height=height,
            is_visible=True,
        ))
        return True

    user32.EnumWindows(WNDENUMPROC(_enum_callback), 0)
    return windows


def get_window_by_hwnd(hwnd: int) -> WindowInfo | None:
    """특정 hwnd의 윈도우 정보 조회."""
    for w in get_window_list():
        if w.hwnd == hwnd:
            return w
    return None
