# Design Ref: §9.3 — WebRTCManager + CustomVideoTrack
from __future__ import annotations

import asyncio
import logging
import time
from fractions import Fraction

import av
import cv2  # type: ignore[import-untyped]
import numpy as np
from aiortc import (
    MediaStreamTrack,
    RTCConfiguration,
    RTCIceServer,
    RTCPeerConnection,
    RTCRtpSender,
    RTCSessionDescription,
)

logger = logging.getLogger(__name__)

# Target resolution for WebRTC streaming
STREAM_WIDTH = 1920
STREAM_HEIGHT = 1080


class CustomVideoTrack(MediaStreamTrack):
    """aiortc용 커스텀 비디오 트랙.

    캡처 큐에서 프레임을 꺼내 av.VideoFrame으로 변환하여 aiortc에 전달.
    aiortc 내부 H.264 인코더가 인코딩 처리.

    Plan SC: SC-2 WebRTC 연결 수립 + 원격 화면 실시간 표시
    """

    kind = "video"

    def __init__(
        self,
        frame_queue: asyncio.Queue[np.ndarray],
        fps: int = 30,
        width: int = STREAM_WIDTH,
        height: int = STREAM_HEIGHT,
    ) -> None:
        super().__init__()
        self._queue = frame_queue
        self._fps = fps
        self._width = width
        self._height = height
        self._start_time: float | None = None
        self._frame_count = 0
        self._last_frame: np.ndarray | None = None  # Cache last frame

    async def recv(self) -> av.VideoFrame:
        """aiortc가 호출. 최신 프레임 사용, 없으면 마지막 프레임 재사용."""
        # Grab the LATEST frame (drop stale ones)
        frame_np = None
        while not self._queue.empty():
            try:
                frame_np = self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        if frame_np is None:
            try:
                frame_np = await asyncio.wait_for(self._queue.get(), timeout=0.1)
            except asyncio.TimeoutError:
                pass

        # Use new frame or reuse last frame
        if frame_np is not None:
            if len(frame_np.shape) == 3 and frame_np.shape[2] == 4:
                frame_np = np.ascontiguousarray(frame_np[:, :, :3])
            self._last_frame = frame_np
            bgr = frame_np
        elif self._last_frame is not None:
            bgr = self._last_frame
        else:
            bgr = np.zeros((self._height, self._width, 3), dtype=np.uint8)

        video_frame = av.VideoFrame.from_ndarray(bgr, format="bgr24")
        video_frame.pts = self._frame_count
        video_frame.time_base = Fraction(1, 90000)

        self._frame_count += 1

        if self._frame_count == 1:
            logger.info(
                "First video frame sent: %dx%d pts=%d",
                video_frame.width, video_frame.height, video_frame.pts,
            )
        if self._frame_count % 300 == 0:
            logger.debug("VideoTrack: %d frames sent", self._frame_count)

        return video_frame

    def update_settings(self, fps: int | None = None) -> None:
        if fps is not None:
            self._fps = fps


def _force_h264_codec(pc: RTCPeerConnection) -> None:
    """Force H.264 codec for video senders to leverage hardware decoding in browsers."""
    for sender in pc.getSenders():
        if sender.track and sender.track.kind == "video":
            caps = RTCRtpSender.getCapabilities("video")
            if caps:
                h264_codecs = [c for c in caps.codecs if c.mimeType == "video/H264"]
                if h264_codecs:
                    transceiver = next(
                        (t for t in pc.getTransceivers() if t.sender == sender), None
                    )
                    if transceiver:
                        transceiver.setCodecPreferences(h264_codecs)
                        logger.info("H.264 codec preference set")
                        return
    logger.warning("Could not set H.264 preference, using default codec")


class WebRTCManager:
    """WebRTC PeerConnection 생명주기 관리.

    Design Ref: §9.3 — WebRTC signaling + media
    Plan SC: SC-2 WebRTC 연결 수립
    """

    def __init__(
        self,
        frame_queue: asyncio.Queue[np.ndarray],
        stun_servers: list[str] | None = None,
        fps: int = 30,
        width: int = STREAM_WIDTH,
        height: int = STREAM_HEIGHT,
    ) -> None:
        self._frame_queue = frame_queue
        self._stun_servers = stun_servers or ["stun:stun.l.google.com:19302"]
        self._fps = fps
        self._width = width
        self._height = height
        self._pc: RTCPeerConnection | None = None
        self._video_track: CustomVideoTrack | None = None

    @property
    def is_connected(self) -> bool:
        return self._pc is not None and self._pc.connectionState == "connected"

    async def create_answer(self, offer_sdp: str, offer_type: str = "offer") -> str:
        """SDP offer를 받아 answer 생성."""
        if self._pc is not None:
            await self.close()

        ice_servers = [RTCIceServer(urls=s) for s in self._stun_servers]
        config = RTCConfiguration(iceServers=ice_servers)
        self._pc = RTCPeerConnection(configuration=config)

        # Filter out link-local addresses to speed up ICE gathering
        import aioice.ice
        _original_get_host_addresses = getattr(aioice.ice, '_get_host_addresses', None)
        if _original_get_host_addresses is None:
            # Patch aioice to skip 169.254.x.x addresses
            original_func = aioice.ice.get_host_addresses
            def _filtered_host_addresses(use_ipv4: bool = True, use_ipv6: bool = True):
                addrs = original_func(use_ipv4, use_ipv6)
                filtered = [a for a in addrs if not a.startswith("169.254.")]
                return filtered
            aioice.ice.get_host_addresses = _filtered_host_addresses
            aioice.ice._get_host_addresses = original_func  # mark as patched

        # Create and add video track
        self._video_track = CustomVideoTrack(
            frame_queue=self._frame_queue,
            fps=self._fps,
            width=self._width,
            height=self._height,
        )
        self._pc.addTrack(self._video_track)

        # Force H.264 codec for better quality at same bitrate
        _force_h264_codec(self._pc)

        @self._pc.on("connectionstatechange")
        async def on_state_change() -> None:
            if self._pc:
                logger.info("WebRTC state: %s", self._pc.connectionState)
                if self._pc.connectionState == "failed":
                    await self.close()

        # Process offer and create answer
        offer = RTCSessionDescription(sdp=offer_sdp, type=offer_type)
        await self._pc.setRemoteDescription(offer)
        answer = await self._pc.createAnswer()
        await self._pc.setLocalDescription(answer)

        logger.info("WebRTC answer created")
        return self._pc.localDescription.sdp  # type: ignore[union-attr]

    async def add_ice_candidate(
        self,
        candidate: str,
        sdp_mid: str | None = None,
        sdp_m_line_index: int | None = None,
    ) -> None:
        """ICE candidate (handled via SDP gathering)."""
        if self._pc is None:
            raise RuntimeError("No active PeerConnection")
        logger.debug("ICE candidate received (handled via SDP): %s", candidate[:60])

    def update_settings(self, fps: int | None = None) -> None:
        if fps is not None:
            self._fps = fps
            if self._video_track:
                self._video_track.update_settings(fps=fps)

    async def close(self) -> None:
        if self._pc:
            await self._pc.close()
            self._pc = None
            self._video_track = None
            logger.info("WebRTC connection closed")
