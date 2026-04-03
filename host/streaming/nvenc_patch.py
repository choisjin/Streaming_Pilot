# Design Ref: §9.2 — NVENC direct encoding via aiortc monkey-patch
"""
Patches aiortc's H264Encoder to use NVENC hardware encoding instead of libx264.

This replaces the software encoder with GPU-accelerated encoding,
providing significantly better quality and performance at the same bitrate.

Plan SC: SC-3 60fps/1080p/6Mbps 안정 스트리밍
Plan SC: SC-6 NVENC → libx264 자동 폴백
"""
from __future__ import annotations

import fractions
import logging
from typing import Iterator

import av

logger = logging.getLogger(__name__)

_nvenc_available: bool | None = None


def check_nvenc() -> bool:
    """Check if NVENC is available on this system."""
    global _nvenc_available
    if _nvenc_available is not None:
        return _nvenc_available

    try:
        codec = av.CodecContext.create("h264_nvenc", "w")
        codec.width = 1920
        codec.height = 1080
        codec.pix_fmt = "yuv420p"
        codec.bit_rate = 6_000_000
        codec.time_base = fractions.Fraction(1, 30)
        codec.options = {"preset": "p4", "tune": "ull"}
        codec.open()
        # Release GPU resources immediately
        del codec

        _nvenc_available = True
        logger.info("NVENC hardware encoder is available")
    except Exception as e:
        _nvenc_available = False
        logger.warning("NVENC not available: %s", e)

    return _nvenc_available


def patch_aiortc_h264_encoder() -> bool:
    """Monkey-patch aiortc's H264Encoder to use NVENC.

    Returns True if NVENC is used, False if falling back to libx264.
    """
    if not check_nvenc():
        logger.info("Keeping default libx264 encoder")
        return False

    from aiortc.codecs import h264

    original_encode_frame = h264.H264Encoder._encode_frame

    def _nvenc_encode_frame(
        self: h264.H264Encoder, frame: av.VideoFrame, force_keyframe: bool
    ) -> Iterator[bytes]:
        # Never recreate encoder — reuse once created
        if self.codec and (
            frame.width != self.codec.width
            or frame.height != self.codec.height
        ):
            # Only reset if resolution actually changed
            self.buffer_data = b""
            self.buffer_pts = None
            self.codec = None

        if force_keyframe:
            frame.pict_type = av.video.frame.PictureType.I
        else:
            frame.pict_type = av.video.frame.PictureType.NONE

        if self.codec is None:
            try:
                self.codec = av.CodecContext.create("h264_nvenc", "w")
                self.codec.width = frame.width
                self.codec.height = frame.height
                self.codec.bit_rate = self.target_bitrate
                self.codec.pix_fmt = "yuv420p"
                self.codec.framerate = fractions.Fraction(h264.MAX_FRAME_RATE, 1)
                self.codec.time_base = fractions.Fraction(1, h264.MAX_FRAME_RATE)
                self.codec.gop_size = 30  # Keyframe every 30 frames (~1 sec)
                self.codec.max_b_frames = 0  # No B-frames for low latency
                self.codec.options = {
                    "preset": "p4",
                    "tune": "ull",
                }
                self.codec.open()
                logger.info(
                    "NVENC encoder created: %dx%d @ %dbps",
                    frame.width, frame.height, self.target_bitrate,
                )
            except Exception as e:
                logger.warning("NVENC codec creation failed: %s, falling back to libx264", e)
                # Fall back to original libx264
                yield from original_encode_frame(self, frame, force_keyframe)
                return

        data_to_send = b""
        for package in self.codec.encode(frame):
            data_to_send += bytes(package)

        if data_to_send:
            yield from self._split_bitstream(data_to_send)

    # Apply patch
    h264.H264Encoder._encode_frame = _nvenc_encode_frame  # type: ignore[assignment]

    # Also increase default bitrate for NVENC (can handle more)
    h264.DEFAULT_BITRATE = 6_000_000  # 6 Mbps (was ~3 Mbps)
    h264.MAX_BITRATE = 20_000_000  # 20 Mbps

    logger.info("aiortc H264Encoder patched to use NVENC (6Mbps default)")
    return True
