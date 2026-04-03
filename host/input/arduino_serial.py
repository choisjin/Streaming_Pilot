# Arduino Leonardo 시리얼 통신
from __future__ import annotations

import logging
import threading
import time

import serial  # type: ignore[import-untyped]
import serial.tools.list_ports  # type: ignore[import-untyped]

logger = logging.getLogger(__name__)


class ArduinoHID:
    """Arduino Leonardo USB HID 시리얼 통신."""

    def __init__(self, port: str | None = None, baud: int = 115200) -> None:
        self._port = port
        self._baud = baud
        self._serial: serial.Serial | None = None
        self._lock = threading.Lock()
        self._connected = False

    @property
    def connected(self) -> bool:
        return self._connected

    def connect(self) -> bool:
        port = self._port or self._auto_detect()
        if not port:
            logger.warning("Arduino not found")
            return False

        try:
            self._serial = serial.Serial(port=port, baudrate=self._baud, timeout=1)
            time.sleep(2)  # Wait for Arduino reset

            # Read ready message
            deadline = time.time() + 3
            while time.time() < deadline:
                if self._serial.in_waiting:
                    line = self._serial.readline().decode('utf-8', errors='ignore').strip()
                    if line == "READY":
                        logger.info("Arduino connected on %s", port)
                        self._connected = True
                        return True
                time.sleep(0.1)

            logger.info("Arduino connected on %s (no READY signal)", port)
            self._connected = True
            return True
        except Exception as e:
            logger.error("Arduino connection failed on %s: %s", port, e)
            return False

    def disconnect(self) -> None:
        if self._serial and self._serial.is_open:
            self._send("KA")
            self._serial.close()
        self._serial = None
        self._connected = False
        logger.info("Arduino disconnected")

    # --- Mouse ---

    def mouse_move_relative(self, dx: int, dy: int) -> None:
        self._send(f"MM,{dx},{dy}")

    def mouse_move_absolute(self, x: int, y: int, screen_w: int, screen_h: int) -> None:
        self._send(f"MA,{x},{y},{screen_w},{screen_h}")

    def mouse_click(self, button: str = "L") -> None:
        self._send(f"MC,{button}")

    def mouse_down(self, button: str = "L") -> None:
        self._send(f"MD,{button}")

    def mouse_up(self, button: str = "L") -> None:
        self._send(f"MU,{button}")

    def mouse_wheel(self, delta: int) -> None:
        self._send(f"MW,{delta}")

    # --- Keyboard ---

    def key_down(self, keycode: int) -> None:
        self._send(f"KD,{keycode}")

    def key_up(self, keycode: int) -> None:
        self._send(f"KU,{keycode}")

    def key_type(self, char: str) -> None:
        self._send(f"KT,{char}")

    def key_string(self, text: str) -> None:
        self._send(f"KS,{text}")

    def release_all(self) -> None:
        self._send("KA")

    def ping(self) -> bool:
        self._send("PING")
        if self._serial and self._serial.is_open:
            try:
                line = self._serial.readline().decode('utf-8', errors='ignore').strip()
                return line == "PONG"
            except Exception:
                pass
        return False

    # --- Internal ---

    def _send(self, cmd: str) -> None:
        if not self._serial or not self._serial.is_open:
            return
        with self._lock:
            try:
                # Drain any pending responses to prevent buffer overflow
                while self._serial.in_waiting:
                    self._serial.read(self._serial.in_waiting)
                self._serial.write(f"{cmd}\n".encode('utf-8'))
            except Exception as e:
                logger.warning("Serial send failed: %s", e)
                self._connected = False

    @staticmethod
    def _auto_detect() -> str | None:
        """Arduino Leonardo 자동 감지 (Microsoft 위장 포함)."""
        for port in serial.tools.list_ports.comports():
            # Leonardo VID:PID = 2341:8036 or 2341:0036
            if port.vid == 0x2341 and port.pid in (0x8036, 0x8037, 0x0036):
                logger.info("Arduino Leonardo detected: %s", port.device)
                return port.device
            # Microsoft 위장 VID:PID = 045E:0750
            if port.vid == 0x045E and port.pid == 0x0750:
                logger.info("Arduino (Microsoft disguise) detected: %s", port.device)
                return port.device
            # Generic Arduino
            if port.manufacturer and "Arduino" in port.manufacturer:
                return port.device
        return None
