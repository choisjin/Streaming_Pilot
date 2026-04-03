# Design Ref: PROJECT_SPEC §4.2 — 멀티 스트림 관리 (최대 4개)
"""멀티 스트림 관리. 각 스트림은 독립적인 WebRTC PeerConnection."""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from dataclasses import dataclass, field

import cv2  # type: ignore[import-untyped]
import numpy as np

from capture.window import capture_window

logger = logging.getLogger(__name__)

MAX_STREAMS = 4


@dataclass
class StreamInfo:
    stream_id: int
    stream_type: str  # "desktop" | "window"
    hwnd: int | None = None
    title: str = ""
    width: int = 1920
    height: int = 1080
    fps: int = 30
    active: bool = True


class MultiStreamManager:
    """멀티 스트림 관리자.

    - stream 0: 전체 데스크톱 (기존 dxcam/mss 캡처 사용)
    - stream 1~3: 개별 윈도우 캡처 (PrintWindow API)
    """

    def __init__(self) -> None:
        self._streams: dict[int, StreamInfo] = {}
        self._queues: dict[int, asyncio.Queue[np.ndarray]] = {}
        self._capture_threads: dict[int, threading.Thread] = {}
        self._running = False
        self._loop: asyncio.AbstractEventLoop | None = None
        self._next_id = 1  # 0 is reserved for desktop

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop
        self._running = True

    def get_streams(self) -> list[dict]:
        """현재 활성 스트림 목록."""
        return [
            {
                "streamId": s.stream_id,
                "type": s.stream_type,
                "hwnd": s.hwnd,
                "title": s.title,
                "width": s.width,
                "height": s.height,
                "fps": s.fps,
                "active": s.active,
            }
            for s in self._streams.values()
        ]

    def add_window_stream(
        self,
        hwnd: int,
        title: str,
        width: int = 1920,
        height: int = 1080,
        fps: int = 30,
    ) -> int | None:
        """윈도우 스트림 추가. 최대 MAX_STREAMS개."""
        if len(self._streams) >= MAX_STREAMS:
            logger.warning("Max streams (%d) reached", MAX_STREAMS)
            return None

        stream_id = self._next_id
        self._next_id += 1

        info = StreamInfo(
            stream_id=stream_id,
            stream_type="window",
            hwnd=hwnd,
            title=title,
            width=width,
            height=height,
            fps=fps,
        )
        self._streams[stream_id] = info

        # Create queue and start capture thread
        queue: asyncio.Queue[np.ndarray] = asyncio.Queue(maxsize=2)
        self._queues[stream_id] = queue

        thread = threading.Thread(
            target=self._window_capture_loop,
            args=(stream_id, info, queue),
            daemon=True,
            name=f"window-capture-{stream_id}",
        )
        self._capture_threads[stream_id] = thread
        thread.start()

        logger.info("Stream %d added: window hwnd=%d title='%s'", stream_id, hwnd, title)
        return stream_id

    def remove_stream(self, stream_id: int) -> bool:
        """스트림 제거."""
        if stream_id not in self._streams:
            return False

        self._streams[stream_id].active = False

        # Thread will stop when active=False
        if stream_id in self._capture_threads:
            t = self._capture_threads.pop(stream_id)
            t.join(timeout=2.0)

        self._streams.pop(stream_id, None)
        self._queues.pop(stream_id, None)
        logger.info("Stream %d removed", stream_id)
        return True

    def get_queue(self, stream_id: int) -> asyncio.Queue[np.ndarray] | None:
        return self._queues.get(stream_id)

    def stop_all(self) -> None:
        self._running = False
        for sid in list(self._streams.keys()):
            self._streams[sid].active = False
        for t in self._capture_threads.values():
            t.join(timeout=2.0)
        self._streams.clear()
        self._queues.clear()
        self._capture_threads.clear()

    def _window_capture_loop(
        self,
        stream_id: int,
        info: StreamInfo,
        queue: asyncio.Queue[np.ndarray],
    ) -> None:
        """개별 윈도우 캡처 스레드."""
        frame_interval = 1.0 / info.fps
        frame_count = 0

        while info.active and self._running:
            start = time.perf_counter()

            if info.hwnd is None:
                break

            frame = capture_window(info.hwnd, target_size=(info.width, info.height))

            if frame is not None:
                self._put_frame(queue, frame)
                frame_count += 1

                if frame_count == 1:
                    logger.info(
                        "Stream %d first frame: shape=%s", stream_id, frame.shape
                    )
            else:
                # Window might have been closed
                if frame_count > 0:
                    logger.warning("Stream %d: window capture returned None", stream_id)

            elapsed = time.perf_counter() - start
            sleep_time = frame_interval - elapsed
            if sleep_time > 0:
                time.sleep(sleep_time)

        logger.info("Stream %d capture loop ended", stream_id)

    def _put_frame(self, queue: asyncio.Queue[np.ndarray], frame: np.ndarray) -> None:
        if self._loop is None:
            return

        def _safe_put(f: np.ndarray) -> None:
            while queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
            try:
                queue.put_nowait(f)
            except asyncio.QueueFull:
                pass

        try:
            self._loop.call_soon_threadsafe(_safe_put, frame)
        except RuntimeError:
            pass
