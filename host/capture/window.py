# Design Ref: PROJECT_SPEC §4.1B — 개별 윈도우 캡처 (PrintWindow)
"""특정 윈도우만 캡처하는 모듈. BitBlt/PrintWindow API 사용."""
from __future__ import annotations

import ctypes
import ctypes.wintypes
import logging

import cv2  # type: ignore[import-untyped]
import numpy as np

logger = logging.getLogger(__name__)

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32

# PrintWindow flags
PW_RENDERFULLCONTENT = 0x00000002


def capture_window(hwnd: int, target_size: tuple[int, int] | None = None) -> np.ndarray | None:
    """특정 윈도우를 캡처하여 BGR numpy array로 반환.

    Args:
        hwnd: 캡처할 윈도우 핸들
        target_size: (width, height) 리사이즈 타겟. None이면 원본 크기.

    Returns:
        BGR numpy array or None if capture failed.
    """
    try:
        # Get window rect (DPI-aware client area)
        rect = ctypes.wintypes.RECT()
        # Use DwmGetWindowAttribute for accurate bounds (excludes shadow)
        dwmapi = ctypes.windll.dwmapi
        hr = dwmapi.DwmGetWindowAttribute(
            hwnd, 9,  # DWMWA_EXTENDED_FRAME_BOUNDS
            ctypes.byref(rect), ctypes.sizeof(rect)
        )
        if hr != 0:
            user32.GetWindowRect(hwnd, ctypes.byref(rect))

        width = rect.right - rect.left
        height = rect.bottom - rect.top

        if width <= 0 or height <= 0:
            return None

        # Create compatible DC and bitmap
        hwnd_dc = user32.GetDC(hwnd)
        if not hwnd_dc:
            return None

        mem_dc = gdi32.CreateCompatibleDC(hwnd_dc)
        bitmap = gdi32.CreateCompatibleBitmap(hwnd_dc, width, height)
        old_bitmap = gdi32.SelectObject(mem_dc, bitmap)

        # Capture using PrintWindow (works with most windows, including DX)
        result = user32.PrintWindow(hwnd, mem_dc, PW_RENDERFULLCONTENT)

        if not result:
            # Fallback to BitBlt
            gdi32.BitBlt(
                mem_dc, 0, 0, width, height,
                hwnd_dc, 0, 0,
                0x00CC0020,  # SRCCOPY
            )

        # Read bitmap data
        bmi = ctypes.create_string_buffer(40)
        ctypes.memmove(bmi, ctypes.c_uint32(40), 4)  # biSize
        ctypes.memmove(ctypes.addressof(ctypes.c_char.from_buffer(bmi, 4)), ctypes.c_int32(width), 4)
        ctypes.memmove(ctypes.addressof(ctypes.c_char.from_buffer(bmi, 8)), ctypes.c_int32(-height), 4)  # top-down
        ctypes.memmove(ctypes.addressof(ctypes.c_char.from_buffer(bmi, 12)), ctypes.c_uint16(1), 2)  # biPlanes
        ctypes.memmove(ctypes.addressof(ctypes.c_char.from_buffer(bmi, 14)), ctypes.c_uint16(32), 2)  # biBitCount

        buf = ctypes.create_string_buffer(width * height * 4)
        gdi32.GetDIBits(mem_dc, bitmap, 0, height, buf, bmi, 0)

        # Cleanup GDI
        gdi32.SelectObject(mem_dc, old_bitmap)
        gdi32.DeleteObject(bitmap)
        gdi32.DeleteDC(mem_dc)
        user32.ReleaseDC(hwnd, hwnd_dc)

        # Convert to numpy (BGRA)
        frame = np.frombuffer(buf, dtype=np.uint8).reshape(height, width, 4)
        # BGRA → BGR
        frame = frame[:, :, :3].copy()

        # Resize if needed
        if target_size and (frame.shape[1], frame.shape[0]) != target_size:
            frame = cv2.resize(frame, target_size, interpolation=cv2.INTER_LINEAR)

        return frame

    except Exception:
        logger.debug("Window capture failed for hwnd=%d", hwnd, exc_info=True)
        return None
