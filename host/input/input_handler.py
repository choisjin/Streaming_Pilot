# 입력 핸들러 — WebSocket 메시지 → 좌표 변환 → Arduino HID
from __future__ import annotations

import ctypes
import ctypes.wintypes
import logging
from typing import Any

from input.arduino_serial import ArduinoHID

logger = logging.getLogger(__name__)
user32 = ctypes.windll.user32

# JavaScript event.code → Arduino Keyboard.h keycode
# ASCII 문자는 그대로, 특수키만 매핑
JS_TO_KEYCODE: dict[str, int] = {
    # Letters (lowercase ASCII)
    "KeyA": 97, "KeyB": 98, "KeyC": 99, "KeyD": 100, "KeyE": 101,
    "KeyF": 102, "KeyG": 103, "KeyH": 104, "KeyI": 105, "KeyJ": 106,
    "KeyK": 107, "KeyL": 108, "KeyM": 109, "KeyN": 110, "KeyO": 111,
    "KeyP": 112, "KeyQ": 113, "KeyR": 114, "KeyS": 115, "KeyT": 116,
    "KeyU": 117, "KeyV": 118, "KeyW": 119, "KeyX": 120, "KeyY": 121, "KeyZ": 122,
    # Numbers
    "Digit0": 48, "Digit1": 49, "Digit2": 50, "Digit3": 51, "Digit4": 52,
    "Digit5": 53, "Digit6": 54, "Digit7": 55, "Digit8": 56, "Digit9": 57,
    # Symbols
    "Space": 32, "Minus": 45, "Equal": 61, "BracketLeft": 91,
    "BracketRight": 93, "Backslash": 92, "Semicolon": 59, "Quote": 39,
    "Backquote": 96, "Comma": 44, "Period": 46, "Slash": 47,
    # Special keys (Arduino Keyboard.h defines)
    "Enter": 0xB0, "Escape": 0xB1, "Backspace": 0xB2, "Tab": 0xB3,
    "CapsLock": 0xC1, "Delete": 0xD4, "Insert": 0xD1,
    "Home": 0xD2, "End": 0xD5, "PageUp": 0xD3, "PageDown": 0xD6,
    "ArrowUp": 0xDA, "ArrowDown": 0xD9, "ArrowLeft": 0xD8, "ArrowRight": 0xD7,
    # Modifiers
    "ShiftLeft": 0x81, "ShiftRight": 0x85,
    "ControlLeft": 0x80, "ControlRight": 0x84,
    "AltLeft": 0x82, "AltRight": 0x86,
    "MetaLeft": 0x83, "MetaRight": 0x87,
    # Function keys
    "F1": 0xC2, "F2": 0xC3, "F3": 0xC4, "F4": 0xC5, "F5": 0xC6, "F6": 0xC7,
    "F7": 0xC8, "F8": 0xC9, "F9": 0xCA, "F10": 0xCB, "F11": 0xCC, "F12": 0xCD,
    # Numpad
    "Numpad0": 0xEA, "Numpad1": 0xE1, "Numpad2": 0xE2, "Numpad3": 0xE3,
    "Numpad4": 0xE4, "Numpad5": 0xE5, "Numpad6": 0xE6, "Numpad7": 0xE7,
    "Numpad8": 0xE8, "Numpad9": 0xE9,
    "NumpadMultiply": 0xDD, "NumpadAdd": 0xDB, "NumpadSubtract": 0xDE,
    "NumpadDecimal": 0xEB, "NumpadDivide": 0xDC, "NumpadEnter": 0xB0,
}

# 한영키 등 특수 키 — Arduino Keyboard.h로 처리 불가, 별도 처리
# 이 키들은 Arduino에 키코드 대신 특수 명령으로 전송
SPECIAL_KEYS: dict[str, str] = {
    "Lang1": "HANGUL",      # 한영 (한글)
    "Lang2": "HANJA",       # 한자
    "HangulMode": "HANGUL",
    "Hanja": "HANJA",
}


class InputHandler:
    """WebSocket 입력 → 좌표 변환 → Arduino HID."""

    def __init__(self, arduino: ArduinoHID, screen_w: int = 2560, screen_h: int = 1440) -> None:
        self._arduino = arduino
        self._screen_w = screen_w
        self._screen_h = screen_h
        self._active_hwnd: int | None = None

    def update_screen_size(self, w: int, h: int) -> None:
        self._screen_w = w
        self._screen_h = h

    def handle_message(self, msg: dict[str, Any]) -> None:
        """WebSocket 입력 메시지 처리."""
        msg_type = msg.get("type")
        hwnd = msg.get("hwnd")

        # 윈도우 활성화
        if hwnd and hwnd != self._active_hwnd:
            self._activate_window(hwnd)

        if msg_type == "mouse_move":
            self._mouse_move(msg, hwnd)
        elif msg_type == "mouse_click":
            self._mouse_click(msg, hwnd)
        elif msg_type == "mouse_wheel":
            self._mouse_wheel(msg)
        elif msg_type == "key":
            self._key(msg)

    def _mouse_move(self, msg: dict, hwnd: int | None) -> None:
        x, y = msg.get("x", 0), msg.get("y", 0)
        panel_w, panel_h = msg.get("panelW", 1), msg.get("panelH", 1)

        screen_x, screen_y = self._to_screen(x, y, panel_w, panel_h, hwnd)

        # Get current cursor position and compute relative delta
        cur = ctypes.wintypes.POINT()
        user32.GetCursorPos(ctypes.byref(cur))
        dx = screen_x - cur.x
        dy = screen_y - cur.y

        if dx != 0 or dy != 0:
            self._arduino.mouse_move_relative(dx, dy)

    def _mouse_click(self, msg: dict, hwnd: int | None) -> None:
        x, y = msg.get("x", 0), msg.get("y", 0)
        panel_w, panel_h = msg.get("panelW", 1), msg.get("panelH", 1)
        button = {"left": "L", "right": "R", "middle": "M"}.get(msg.get("button", "left"), "L")
        action = msg.get("action", "click")

        screen_x, screen_y = self._to_screen(x, y, panel_w, panel_h, hwnd)

        # Move to position using relative delta
        cur = ctypes.wintypes.POINT()
        user32.GetCursorPos(ctypes.byref(cur))
        dx = screen_x - cur.x
        dy = screen_y - cur.y
        if dx != 0 or dy != 0:
            self._arduino.mouse_move_relative(dx, dy)

        if action == "down":
            self._arduino.mouse_down(button)
        elif action == "up":
            self._arduino.mouse_up(button)
        else:
            self._arduino.mouse_click(button)

    def _mouse_wheel(self, msg: dict) -> None:
        delta = msg.get("delta", 0)
        wheel = max(-5, min(5, delta // 24)) if abs(delta) >= 24 else (1 if delta > 0 else -1)
        if wheel != 0:
            self._arduino.mouse_wheel(wheel)

    def _key(self, msg: dict) -> None:
        code = msg.get("code", "")
        action = msg.get("action", "")

        # 한영키 — down에서만 토글 (up 무시)
        if code in SPECIAL_KEYS:
            special = SPECIAL_KEYS[code]
            if special == "HANGUL" and action == "down":
                # 오른쪽 Alt press → release (한영 토글)
                self._arduino.key_down(0x86)
                import time; time.sleep(0.05)
                self._arduino.key_up(0x86)
                return
            elif special == "HANJA" and action == "down":
                self._arduino.key_down(0x84)
                import time; time.sleep(0.05)
                self._arduino.key_up(0x84)
                return
            elif action == "up":
                return  # up 이벤트 무시

        keycode = JS_TO_KEYCODE.get(code)
        if keycode is None:
            logger.info("Unknown key: %s", code)
            return

        logger.info("Key: %s %s → keycode=%d (0x%02X)", code, action, keycode, keycode)
        if action == "down":
            self._arduino.key_down(keycode)
        elif action == "up":
            self._arduino.key_up(keycode)

    def _to_screen(
        self, x: float, y: float, panel_w: float, panel_h: float, hwnd: int | None
    ) -> tuple[int, int]:
        """패널 좌표 → 화면 절대좌표."""
        if hwnd:
            rect = ctypes.wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(rect))
            win_w = rect.right - rect.left
            win_h = rect.bottom - rect.top
            sx = rect.left + int(x / max(panel_w, 1) * win_w)
            sy = rect.top + int(y / max(panel_h, 1) * win_h)
        else:
            sx = int(x / max(panel_w, 1) * self._screen_w)
            sy = int(y / max(panel_h, 1) * self._screen_h)
        return sx, sy

    def _activate_window(self, hwnd: int) -> None:
        try:
            if user32.IsIconic(hwnd):
                user32.ShowWindow(hwnd, 9)  # SW_RESTORE

            # AttachThreadInput trick to bypass foreground restrictions
            fore_thread = user32.GetWindowThreadProcessId(
                user32.GetForegroundWindow(), None
            )
            target_thread = user32.GetWindowThreadProcessId(hwnd, None)
            current_thread = ctypes.windll.kernel32.GetCurrentThreadId()

            if fore_thread != current_thread:
                user32.AttachThreadInput(current_thread, fore_thread, True)
            if target_thread != current_thread:
                user32.AttachThreadInput(current_thread, target_thread, True)

            user32.SetForegroundWindow(hwnd)
            user32.BringWindowToTop(hwnd)

            if fore_thread != current_thread:
                user32.AttachThreadInput(current_thread, fore_thread, False)
            if target_thread != current_thread:
                user32.AttachThreadInput(current_thread, target_thread, False)

            self._active_hwnd = hwnd
        except Exception:
            pass
