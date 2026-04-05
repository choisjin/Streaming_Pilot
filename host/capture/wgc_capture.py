# Windows Graphics Capture — 별도 프로세스, shared memory + atomic counter
from __future__ import annotations

import asyncio
import ctypes
import ctypes.wintypes
import logging
import multiprocessing as mp
import threading
import time
from multiprocessing import shared_memory

import cv2  # type: ignore[import-untyped]
import numpy as np

logger = logging.getLogger(__name__)
user32 = ctypes.windll.user32


def _wgc_process(
    shm_name: str,
    frame_shape: tuple[int, int, int],
    fps: int,
    window_name: str,
    stop_event: mp.Event,
    ready_event: mp.Event,
    counter: mp.Value,  # type: ignore
) -> None:
    """별도 프로세스: WGC 캡처 → shared memory."""
    from windows_capture import CaptureControl, Frame, WindowsCapture

    h, w, c = frame_shape
    shm = shared_memory.SharedMemory(name=shm_name)
    buf = np.ndarray((h, w, c), dtype=np.uint8, buffer=shm.buf)

    interval = 1.0 / fps
    last_t = 0.0

    try:
        capture = WindowsCapture(
            cursor_capture=True,
            draw_border=False,
            window_name=window_name,
        )

        @capture.event
        def on_frame_arrived(frame: Frame, cc: CaptureControl) -> None:
            nonlocal last_t

            if stop_event.is_set():
                cc.stop()
                return

            now = time.perf_counter()
            if now - last_t < interval:
                return
            last_t = now

            try:
                bgra = np.ascontiguousarray(frame.frame_buffer)
                bgr = cv2.cvtColor(bgra, cv2.COLOR_BGRA2BGR)

                if bgr.shape[1] != w or bgr.shape[0] != h:
                    bgr = cv2.resize(bgr, (w, h), interpolation=cv2.INTER_LINEAR)

                np.copyto(buf, bgr)
                counter.value += 1

                if counter.value == 1:
                    ready_event.set()
            except Exception as e:
                print(f"[WGC] frame error: {e}")

        @capture.event
        def on_closed() -> None:
            print(f"[WGC] Window closed: {window_name}")
            stop_event.set()

        capture.start()

    except Exception as e:
        print(f"[WGC] Error: {e}")
    finally:
        shm.close()


class WGCCapture:
    def __init__(
        self,
        fps: int = 30,
        resolution: tuple[int, int] = (1920, 1080),
        window_name: str | None = None,
        hwnd: int | None = None,
        cursor: bool = True,
    ) -> None:
        self._fps = fps
        self._resolution = resolution
        self._window_name = window_name or ""
        self._hwnd = hwnd or 0
        self._running = False
        self._loop: asyncio.AbstractEventLoop | None = None
        self._frame_queue: asyncio.Queue[np.ndarray] | None = None
        self._process: mp.Process | None = None
        self._shm: shared_memory.SharedMemory | None = None
        self._stop_event: mp.Event | None = None
        self._counter: mp.Value | None = None  # type: ignore
        self._relay_thread: threading.Thread | None = None

    async def start(self, frame_queue: asyncio.Queue[np.ndarray]) -> None:
        self._frame_queue = frame_queue
        self._loop = asyncio.get_running_loop()
        self._running = True

        if not self._window_name and self._hwnd:
            b = ctypes.create_unicode_buffer(256)
            user32.GetWindowTextW(self._hwnd, b, 256)
            self._window_name = b.value

        w, h = self._resolution
        nbytes = h * w * 3

        shm_name = f"id_wgc_{id(self) % 100000}"
        try:
            self._shm = shared_memory.SharedMemory(create=True, size=nbytes, name=shm_name)
        except FileExistsError:
            try:
                old = shared_memory.SharedMemory(name=shm_name)
                old.close(); old.unlink()
            except Exception:
                pass
            self._shm = shared_memory.SharedMemory(create=True, size=nbytes, name=shm_name)

        self._stop_event = mp.Event()
        ready = mp.Event()
        self._counter = mp.Value('L', 0)

        self._process = mp.Process(
            target=_wgc_process,
            args=(shm_name, (h, w, 3), self._fps, self._window_name,
                  self._stop_event, ready, self._counter),
            daemon=True,
        )
        self._process.start()

        if ready.wait(timeout=5.0):
            logger.info("WGC OK: '%s' %dx%d", self._window_name, w, h)
        else:
            logger.warning("WGC: no frame in 5s")

        self._relay_thread = threading.Thread(target=self._relay, daemon=True)
        self._relay_thread.start()
        logger.info("WGC started: '%s' %dx%d @ %dfps", self._window_name, w, h, self._fps)

    async def stop(self) -> None:
        self._running = False
        if self._stop_event:
            self._stop_event.set()
        if self._relay_thread and self._relay_thread.is_alive():
            self._relay_thread.join(timeout=2.0)
        if self._process and self._process.is_alive():
            self._process.terminate()
            self._process.join(timeout=2.0)
        if self._shm:
            try:
                self._shm.close(); self._shm.unlink()
            except Exception:
                pass
        logger.info("WGC stopped")

    def update_settings(self, fps: int | None = None,
                        resolution: tuple[int, int] | None = None) -> None:
        if fps: self._fps = fps
        if resolution: self._resolution = resolution

    def _relay(self) -> None:
        w, h = self._resolution
        shm_buf = np.ndarray((h, w, 3), dtype=np.uint8, buffer=self._shm.buf)  # type: ignore
        last_count = 0
        sleep_time = 0.5 / max(self._fps, 1)  # Check 2x per frame
        no_frame_count = 0

        while self._running:
            cur = self._counter.value if self._counter else 0
            if cur > last_count:
                last_count = cur
                no_frame_count = 0
                frame = shm_buf.copy()
                self._put_frame(frame)
            else:
                time.sleep(sleep_time)
                no_frame_count += 1

            # Check if capture process died
            if self._process and not self._process.is_alive():
                logger.warning("WGC process died for '%s'", self._window_name)
                break

            # Detect prolonged frame starvation
            if no_frame_count > self._fps * 10:
                logger.warning("WGC no frames for ~10s: '%s'", self._window_name)
                no_frame_count = 0  # Reset to avoid log spam

        logger.info("WGC relay ended for '%s'", self._window_name)

    def _put_frame(self, frame: np.ndarray) -> None:
        if not self._frame_queue or not self._loop:
            return
        def _safe(f: np.ndarray) -> None:
            if not self._frame_queue: return
            while self._frame_queue.full():
                try: self._frame_queue.get_nowait()
                except: break
            try: self._frame_queue.put_nowait(f)
            except: pass
        try:
            self._loop.call_soon_threadsafe(_safe, frame)
        except RuntimeError:
            pass
