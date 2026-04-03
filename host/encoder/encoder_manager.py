# Design Ref: §9.2 — EncoderManager (Strategy pattern, 3-tier fallback)
from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
from abc import ABC, abstractmethod
from fractions import Fraction
from typing import TYPE_CHECKING

import av
import numpy as np

if TYPE_CHECKING:
    from config import StreamSettings

logger = logging.getLogger(__name__)


class BaseEncoder(ABC):
    """인코더 추상 베이스 클래스."""

    name: str = "base"

    @abstractmethod
    def encode(self, frame: np.ndarray, pts: int) -> list[av.Packet]:
        """Encode a BGRA numpy frame to H.264 packets."""
        ...

    @abstractmethod
    def update_settings(self, bitrate_bps: int, fps: int) -> None:
        """Update encoding parameters at runtime."""
        ...

    @abstractmethod
    def close(self) -> None:
        """Release encoder resources."""
        ...


class NvencEncoder(BaseEncoder):
    """PyAV 기반 NVENC H.264 인코더.

    Plan SC: SC-6 NVENC → libx264 자동 폴백 (1순위 시도)
    """

    name = "h264_nvenc"

    def __init__(self, width: int, height: int, fps: int, bitrate_bps: int) -> None:
        self._width = width
        self._height = height
        self._codec = av.CodecContext.create("h264_nvenc", "w")
        self._codec.width = width
        self._codec.height = height
        self._codec.pix_fmt = "yuv420p"
        self._codec.time_base = Fraction(1, fps)
        self._codec.bit_rate = bitrate_bps
        self._codec.options = {
            "preset": "p4",
            "tune": "ull",
        }
        self._codec.open()
        logger.info("NvencEncoder initialized: %dx%d @ %dfps", width, height, fps)

    def encode(self, frame: np.ndarray, pts: int) -> list[av.Packet]:
        video_frame = self._numpy_to_frame(frame, pts)
        return list(self._codec.encode(video_frame))

    def update_settings(self, bitrate_bps: int, fps: int) -> None:
        self._codec.bit_rate = bitrate_bps
        self._codec.time_base = Fraction(1, fps)

    def close(self) -> None:
        pass  # PyAV CodecContext doesn't have close(); GC handles cleanup

    def _numpy_to_frame(self, bgra: np.ndarray, pts: int) -> av.VideoFrame:
        """Convert BGRA numpy array to YUV420P av.VideoFrame."""
        # BGRA → BGR (drop alpha)
        if bgra.shape[2] == 4:
            bgr = bgra[:, :, :3]
        else:
            bgr = bgra

        frame = av.VideoFrame.from_ndarray(bgr, format="bgr24")
        frame = frame.reformat(
            width=self._width, height=self._height, format="yuv420p"
        )
        frame.pts = pts
        return frame


class SubprocessEncoder(BaseEncoder):
    """FFmpeg subprocess 기반 인코더. NVENC 폴백용.

    Design Ref: §9.2 — 2순위 폴백
    """

    name = "h264_subprocess"

    def __init__(self, width: int, height: int, fps: int, bitrate_bps: int) -> None:
        self._width = width
        self._height = height
        self._fps = fps

        ffmpeg_path = shutil.which("ffmpeg")
        if ffmpeg_path is None:
            raise FileNotFoundError("ffmpeg not found in PATH")

        bitrate_str = f"{bitrate_bps // 1000}k"
        self._process = subprocess.Popen(
            [
                ffmpeg_path,
                "-f", "rawvideo",
                "-pix_fmt", "bgr24",
                "-s", f"{width}x{height}",
                "-r", str(fps),
                "-i", "pipe:0",
                "-c:v", "h264_nvenc",
                "-preset", "llhq",
                "-tune", "ull",
                "-b:v", bitrate_str,
                "-f", "h264",
                "-an",
                "pipe:1",
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        logger.info(
            "SubprocessEncoder initialized: %dx%d @ %dfps", width, height, fps
        )

    def encode(self, frame: np.ndarray, pts: int) -> list[av.Packet]:
        if self._process.stdin is None or self._process.stdout is None:
            return []

        # BGRA → BGR
        if frame.shape[2] == 4:
            bgr = frame[:, :, :3].copy()
        else:
            bgr = frame

        # Resize if needed
        if (bgr.shape[1], bgr.shape[0]) != (self._width, self._height):
            try:
                import cv2  # type: ignore[import-untyped]
                bgr = cv2.resize(bgr, (self._width, self._height))
            except ImportError:
                pass

        try:
            self._process.stdin.write(bgr.tobytes())
            self._process.stdin.flush()
        except BrokenPipeError:
            return []

        # Read available encoded data (non-blocking)
        packets: list[av.Packet] = []
        try:
            data = self._process.stdout.read1(65536)  # type: ignore[attr-defined]
            if data:
                pkt = av.Packet(data)
                pkt.pts = pts
                pkt.dts = pts
                packets.append(pkt)
        except Exception:
            pass

        return packets

    def update_settings(self, bitrate_bps: int, fps: int) -> None:
        # Subprocess encoder requires restart for setting changes
        logger.debug("SubprocessEncoder: settings update requires restart")

    def close(self) -> None:
        if self._process.stdin:
            self._process.stdin.close()
        self._process.terminate()
        self._process.wait(timeout=3)


class SoftwareEncoder(BaseEncoder):
    """PyAV 기반 libx264 소프트웨어 인코더.

    Design Ref: §9.2 — 3순위 폴백 (항상 성공)
    """

    name = "libx264"

    def __init__(self, width: int, height: int, fps: int, bitrate_bps: int) -> None:
        self._width = width
        self._height = height
        self._codec = av.CodecContext.create("libx264", "w")
        self._codec.width = width
        self._codec.height = height
        self._codec.pix_fmt = "yuv420p"
        self._codec.time_base = Fraction(1, fps)
        self._codec.bit_rate = bitrate_bps
        self._codec.options = {
            "preset": "ultrafast",
            "tune": "zerolatency",
        }
        self._codec.open()
        logger.info("SoftwareEncoder initialized: %dx%d @ %dfps", width, height, fps)

    def encode(self, frame: np.ndarray, pts: int) -> list[av.Packet]:
        video_frame = self._numpy_to_frame(frame, pts)
        return list(self._codec.encode(video_frame))

    def update_settings(self, bitrate_bps: int, fps: int) -> None:
        self._codec.bit_rate = bitrate_bps
        self._codec.time_base = Fraction(1, fps)

    def close(self) -> None:
        pass  # PyAV CodecContext doesn't have close(); GC handles cleanup

    def _numpy_to_frame(self, bgra: np.ndarray, pts: int) -> av.VideoFrame:
        if bgra.shape[2] == 4:
            bgr = bgra[:, :, :3]
        else:
            bgr = bgra
        frame = av.VideoFrame.from_ndarray(bgr, format="bgr24")
        frame = frame.reformat(
            width=self._width, height=self._height, format="yuv420p"
        )
        frame.pts = pts
        return frame


class EncoderManager:
    """Strategy 패턴으로 최적 인코더 자동 선택 및 폴백 관리.

    Design Ref: §9.2 — 폴백 순서: NVENC → subprocess → libx264
    Plan SC: SC-6 NVENC 사용 불가 시 자동 폴백
    """

    def __init__(self, settings: StreamSettings) -> None:
        self._settings = settings
        self._encoder: BaseEncoder | None = None
        self._pts_counter: int = 0

    @property
    def active_encoder_name(self) -> str:
        return self._encoder.name if self._encoder else "none"

    async def initialize(self) -> str:
        """인코더 초기화. 순서: NVENC → subprocess → libx264."""
        w, h = self._settings.resolution
        fps = self._settings.fps
        bps = self._settings.bitrate_bps()

        # 1. Try NVENC
        if self._settings.encoder in ("auto", "h264_nvenc"):
            try:
                self._encoder = NvencEncoder(w, h, fps, bps)
                logger.info("Using NVENC hardware encoder")
                return self._encoder.name
            except Exception as e:
                logger.warning("NVENC unavailable: %s", e)

        # 2. Try FFmpeg subprocess
        if self._settings.encoder in ("auto", "h264_subprocess"):
            try:
                self._encoder = SubprocessEncoder(w, h, fps, bps)
                logger.info("Using FFmpeg subprocess encoder")
                return self._encoder.name
            except FileNotFoundError:
                logger.warning("FFmpeg not found in PATH")

        # 3. Fallback to libx264 (always works)
        self._encoder = SoftwareEncoder(w, h, fps, bps)
        logger.info("Using libx264 software encoder (fallback)")
        return self._encoder.name

    def encode_frame(self, frame: np.ndarray) -> list[av.Packet]:
        """Encode a BGRA numpy array to H.264 packets."""
        if self._encoder is None:
            raise RuntimeError("Encoder not initialized. Call initialize() first.")

        packets = self._encoder.encode(frame, self._pts_counter)
        self._pts_counter += 1
        return packets

    def update_settings(self, bitrate_bps: int | None = None, fps: int | None = None) -> None:
        """런타임 인코딩 설정 변경."""
        if self._encoder is None:
            return
        self._encoder.update_settings(
            bitrate_bps=bitrate_bps or self._settings.bitrate_bps(),
            fps=fps or self._settings.fps,
        )

    async def close(self) -> None:
        if self._encoder:
            self._encoder.close()
            self._encoder = None
