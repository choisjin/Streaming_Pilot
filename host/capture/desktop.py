# Design Ref: §9.1 — DesktopCapture (DXGI via dxcam in separate process)
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


def _draw_cursor_on_frame(
    frame: np.ndarray, screen_w: int, screen_h: int
) -> None:
    """Draw mouse cursor on the frame using Win32 API."""
    import ctypes
    import ctypes.wintypes

    try:
        point = ctypes.wintypes.POINT()
        ctypes.windll.user32.GetCursorPos(ctypes.byref(point))

        h, w = frame.shape[:2]
        cx = int(point.x / screen_w * w)
        cy = int(point.y / screen_h * h)

        if 0 <= cx < w and 0 <= cy < h:
            cv2.circle(frame, (cx, cy), 6, (0, 0, 0), 2)
            cv2.circle(frame, (cx, cy), 4, (255, 255, 255), -1)
    except Exception:
        pass


def _dxcam_capture_process(
    shm_name: str,
    frame_shape: tuple[int, int, int],
    fps: int,
    ready_event: mp.Event,
    stop_event: mp.Event,
    frame_ready_event: mp.Event,
) -> None:
    """Separate process for dxcam DXGI capture.

    Writes frames to shared memory. Runs independently from uvicorn.
    """
    import dxcam  # type: ignore[import-untyped]

    h, w, c = frame_shape
    shm = shared_memory.SharedMemory(name=shm_name)
    frame_buffer = np.ndarray((h, w, c), dtype=np.uint8, buffer=shm.buf)

    cam = None
    try:
        cam = dxcam.create(device_idx=0, output_idx=0, output_color="BGR")
        time.sleep(0.3)

        test = cam.grab()
        if test is None:
            time.sleep(0.5)
            test = cam.grab()
        if test is None:
            raise RuntimeError("dxcam grab returned None")

        # Get native screen resolution for cursor coordinate mapping
        screen_w = test.shape[1]
        screen_h = test.shape[0]

        ready_event.set()

        frame_interval = 1.0 / fps

        while not stop_event.is_set():
            start = time.perf_counter()

            frame = cam.grab()
            if frame is not None:
                if frame.shape[1] != w or frame.shape[0] != h:
                    screen_w, screen_h = frame.shape[1], frame.shape[0]
                    frame = cv2.resize(frame, (w, h), interpolation=cv2.INTER_LINEAR)

                # Draw mouse cursor onto the frame
                _draw_cursor_on_frame(frame, screen_w, screen_h)

                np.copyto(frame_buffer, frame)
                frame_ready_event.set()

            elapsed = time.perf_counter() - start
            sleep_time = frame_interval - elapsed
            if sleep_time > 0:
                time.sleep(sleep_time)

    except Exception as e:
        print(f"[dxcam process] Error: {e}")
    finally:
        if cam is not None:
            del cam
        shm.close()


class DesktopCapture:
    """DXGI 캡처 (별도 프로세스) + mss 폴백.

    dxcam은 uvicorn과 같은 프로세스에서 DXGI 충돌이 발생하므로
    별도 프로세스에서 실행하고 shared memory로 프레임을 전달.

    Plan SC: SC-1 FastAPI 서버 기동 + DXGI 화면 캡처 시작
    """

    def __init__(
        self,
        fps: int = 30,
        resolution: tuple[int, int] = (1920, 1080),
    ) -> None:
        self._fps = fps
        self._resolution = resolution  # (width, height)
        self._running = False
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._frame_queue: asyncio.Queue[np.ndarray] | None = None
        self._capture_process: mp.Process | None = None
        self._shm: shared_memory.SharedMemory | None = None

    async def start(self, frame_queue: asyncio.Queue[np.ndarray]) -> None:
        self._frame_queue = frame_queue
        self._loop = asyncio.get_running_loop()
        self._running = True
        self._thread = threading.Thread(
            target=self._capture_loop, daemon=True, name="capture-relay"
        )
        self._thread.start()
        logger.info(
            "DesktopCapture started: %dx%d @ %dfps",
            self._resolution[0], self._resolution[1], self._fps,
        )

    async def stop(self) -> None:
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3.0)
        if self._capture_process and self._capture_process.is_alive():
            self._capture_process.terminate()
            self._capture_process.join(timeout=2.0)
        if self._shm:
            try:
                self._shm.close()
                self._shm.unlink()
            except Exception:
                pass
        logger.info("DesktopCapture stopped")

    def update_settings(
        self,
        fps: int | None = None,
        resolution: tuple[int, int] | None = None,
    ) -> None:
        if fps is not None:
            self._fps = fps
        if resolution is not None:
            self._resolution = resolution

    def _capture_loop(self) -> None:
        """Try dxcam in separate process, fall back to mss."""
        if self._try_dxcam_process():
            logger.info("Using DXGI capture (separate process)")
            self._relay_from_shm()
        else:
            logger.info("DXGI unavailable, using mss capture")
            self._capture_loop_mss()

    def _try_dxcam_process(self) -> bool:
        """Start dxcam in a separate process and verify it works."""
        w, h = self._resolution
        frame_shape = (h, w, 3)
        nbytes = h * w * 3

        # Use unique name to avoid stale shared memory
        import os
        shm_name = f"ideality_cap_{os.getpid()}"

        # Clean up any stale shared memory
        for name in [shm_name, "ideality_capture"]:
            try:
                old = shared_memory.SharedMemory(name=name, create=False)
                old.close()
                old.unlink()
            except Exception:
                pass

        self._shm = shared_memory.SharedMemory(
            create=True, size=nbytes, name=shm_name
        )

        ready_event = mp.Event()
        self._stop_event = mp.Event()
        self._frame_ready_event = mp.Event()

        self._capture_process = mp.Process(
            target=_dxcam_capture_process,
            args=(
                self._shm.name,
                frame_shape,
                self._fps,
                ready_event,
                self._stop_event,
                self._frame_ready_event,
            ),
            daemon=True,
        )
        self._capture_process.start()

        # Wait up to 5 seconds for dxcam process to be ready
        if ready_event.wait(timeout=5.0):
            logger.info("dxcam process started successfully")
            return True
        else:
            logger.warning("dxcam process failed to start")
            self._capture_process.terminate()
            self._capture_process.join(timeout=2.0)
            self._capture_process = None
            try:
                self._shm.close()
                self._shm.unlink()
            except Exception:
                pass
            self._shm = None
            return False

    def _relay_from_shm(self) -> None:
        """Read frames from shared memory and put into asyncio queue."""
        w, h = self._resolution
        frame_shape = (h, w, 3)
        frame_buffer = np.ndarray(
            frame_shape, dtype=np.uint8, buffer=self._shm.buf  # type: ignore[union-attr]
        )

        frame_count = 0
        frame_interval = 1.0 / self._fps

        while self._running:
            start = time.perf_counter()

            # Wait for new frame from capture process
            if self._frame_ready_event.wait(timeout=0.1):
                self._frame_ready_event.clear()
                frame = frame_buffer.copy()
                self._put_frame(frame)
                frame_count += 1

                if frame_count == 1:
                    logger.info(
                        "First DXGI frame relayed: shape=%s", frame.shape
                    )

            # Check if capture process died — auto restart
            if self._capture_process and not self._capture_process.is_alive():
                logger.warning("dxcam process died, restarting...")
                try:
                    self._shm.close()
                    self._shm.unlink()
                except Exception:
                    pass
                time.sleep(1)
                if self._try_dxcam_process():
                    # Update frame buffer reference
                    frame_buffer = np.ndarray(
                        frame_shape, dtype=np.uint8, buffer=self._shm.buf
                    )
                    frame_count = 0
                    logger.info("dxcam process restarted successfully")
                else:
                    logger.warning("dxcam restart failed, switching to mss")
                    self._capture_loop_mss()
                    return

            elapsed = time.perf_counter() - start
            sleep_time = frame_interval - elapsed
            if sleep_time > 0:
                time.sleep(sleep_time)

        # Cleanup
        self._stop_event.set()

    def _capture_loop_mss(self) -> None:
        """mss 폴백 캡처 (+ 마우스 커서 오버레이)."""
        try:
            import mss  # type: ignore[import-untyped]
        except ImportError:
            logger.error("mss not installed.")
            return

        frame_interval = 1.0 / self._fps
        frame_count = 0

        with mss.mss() as sct:
            monitor = sct.monitors[1]
            logger.info("mss capture started: monitor=%s", monitor)

            while self._running:
                start = time.perf_counter()

                img = sct.grab(monitor)
                frame = np.array(img, dtype=np.uint8)

                if frame.shape[2] == 4:
                    frame = frame[:, :, :3].copy()

                target_w, target_h = self._resolution
                if frame.shape[1] != target_w or frame.shape[0] != target_h:
                    frame = cv2.resize(
                        frame, (target_w, target_h),
                        interpolation=cv2.INTER_LINEAR,
                    )

                # Draw mouse cursor
                self._draw_cursor(frame, monitor)

                self._put_frame(frame)
                frame_count += 1

                if frame_count == 1:
                    logger.info("First mss frame captured: shape=%s", frame.shape)

                elapsed = time.perf_counter() - start
                sleep_time = frame_interval - elapsed
                if sleep_time > 0:
                    time.sleep(sleep_time)

    @staticmethod
    def _draw_cursor(frame: np.ndarray, monitor: dict) -> None:
        """Draw mouse cursor position on the frame."""
        try:
            cursor = ctypes.wintypes.POINT()
            ctypes.windll.user32.GetCursorPos(ctypes.byref(cursor))

            # Convert screen coords to frame coords
            h, w = frame.shape[:2]
            mon_w = monitor["width"]
            mon_h = monitor["height"]
            mon_left = monitor["left"]
            mon_top = monitor["top"]

            cx = int((cursor.x - mon_left) / mon_w * w)
            cy = int((cursor.y - mon_top) / mon_h * h)

            if 0 <= cx < w and 0 <= cy < h:
                # Draw a simple cursor (white circle with black outline)
                cv2.circle(frame, (cx, cy), 6, (0, 0, 0), 2)
                cv2.circle(frame, (cx, cy), 4, (255, 255, 255), -1)
        except Exception:
            pass

    def _put_frame(self, frame: np.ndarray) -> None:
        if self._frame_queue is None or self._loop is None:
            return

        def _safe_put(f: np.ndarray) -> None:
            if self._frame_queue is None:
                return
            # Drop oldest frame if full
            while self._frame_queue.full():
                try:
                    self._frame_queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
            try:
                self._frame_queue.put_nowait(f)
            except asyncio.QueueFull:
                pass  # silently drop

        try:
            self._loop.call_soon_threadsafe(_safe_put, frame)
        except RuntimeError:
            pass  # event loop closed
