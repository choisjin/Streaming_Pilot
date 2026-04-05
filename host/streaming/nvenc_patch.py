# Design Ref: §9.2 — Hardware encoder auto-detection + aiortc monkey-patch
"""
Patches aiortc's H264Encoder to use hardware encoding (NVENC/AMF/QSV).

Auto-detects available GPU encoder in order:
  1. h264_nvenc (NVIDIA)
  2. h264_amf (AMD)
  3. h264_qsv (Intel QuickSync)
  4. libx264 fallback (CPU, no patch needed)

Plan SC: SC-3 60fps/1080p/6Mbps 안정 스트리밍
Plan SC: SC-6 하드웨어 인코더 → libx264 자동 폴백
"""
from __future__ import annotations

import fractions
import logging
from typing import Iterator

import av

logger = logging.getLogger(__name__)

# Encoder detection order
_HW_ENCODERS = [
    ("h264_nvenc", "NVIDIA NVENC", {"preset": "p4", "tune": "ull"}),
    ("h264_amf", "AMD AMF", {"quality": "speed", "rc": "cbr"}),
    ("h264_qsv", "Intel QSV", {"preset": "fast"}),
]

_detected_encoder: str | None = None
_detected_name: str | None = None
_detected_options: dict[str, str] | None = None


def check_hw_encoder() -> tuple[str | None, str | None, dict[str, str] | None]:
    """Check available hardware encoders in priority order.

    Returns (codec_name, display_name, options) or (None, None, None).
    """
    global _detected_encoder, _detected_name, _detected_options
    if _detected_encoder is not None:
        return _detected_encoder, _detected_name, _detected_options

    for codec, name, options in _HW_ENCODERS:
        try:
            ctx = av.CodecContext.create(codec, "w")
            ctx.width = 1920
            ctx.height = 1080
            ctx.pix_fmt = "yuv420p"
            ctx.bit_rate = 6_000_000
            ctx.time_base = fractions.Fraction(1, 30)
            ctx.options = options
            ctx.open()
            del ctx

            _detected_encoder = codec
            _detected_name = name
            _detected_options = options
            logger.info("Hardware encoder available: %s (%s)", name, codec)
            return codec, name, options
        except Exception as e:
            logger.debug("%s not available: %s", codec, e)

    _detected_encoder = ""  # Mark as checked but none found
    logger.info("No hardware encoder available, using libx264 (CPU)")
    return None, None, None


def get_active_encoder() -> str:
    """Return the name of the active encoder for display."""
    codec, name, _ = check_hw_encoder()
    if codec:
        return f"{name} ({codec})"
    return "libx264 (CPU)"


def patch_aiortc_hw_encoder() -> bool:
    """Monkey-patch aiortc's H264Encoder to use hardware encoding.

    Returns True if hardware encoder is used, False if falling back to libx264.
    """
    codec, name, options = check_hw_encoder()
    if not codec:
        logger.info("Keeping default libx264 encoder")
        return False

    from aiortc.codecs import h264

    original_encode_frame = h264.H264Encoder._encode_frame

    def _hw_encode_frame(
        self: h264.H264Encoder, frame: av.VideoFrame, force_keyframe: bool
    ) -> Iterator[bytes]:
        if self.codec and (
            frame.width != self.codec.width
            or frame.height != self.codec.height
        ):
            self.buffer_data = b""
            self.buffer_pts = None
            self.codec = None

        if force_keyframe:
            frame.pict_type = av.video.frame.PictureType.I
        else:
            frame.pict_type = av.video.frame.PictureType.NONE

        if self.codec is None:
            try:
                self.codec = av.CodecContext.create(codec, "w")
                self.codec.width = frame.width
                self.codec.height = frame.height
                self.codec.bit_rate = self.target_bitrate
                self.codec.pix_fmt = "yuv420p"
                self.codec.framerate = fractions.Fraction(h264.MAX_FRAME_RATE, 1)
                self.codec.time_base = fractions.Fraction(1, h264.MAX_FRAME_RATE)
                self.codec.gop_size = 30
                self.codec.max_b_frames = 0
                self.codec.options = dict(options)  # copy
                self.codec.open()
                logger.info(
                    "%s encoder created: %dx%d @ %dbps",
                    name, frame.width, frame.height, self.target_bitrate,
                )
            except Exception as e:
                logger.warning("%s codec creation failed: %s, falling back to libx264", name, e)
                yield from original_encode_frame(self, frame, force_keyframe)
                return

        data_to_send = b""
        for package in self.codec.encode(frame):
            data_to_send += bytes(package)

        if data_to_send:
            yield from self._split_bitstream(data_to_send)

    h264.H264Encoder._encode_frame = _hw_encode_frame  # type: ignore[assignment]

    h264.DEFAULT_BITRATE = 6_000_000  # 6 Mbps
    h264.MAX_BITRATE = 20_000_000  # 20 Mbps

    logger.info("aiortc H264Encoder patched to use %s (6Mbps default)", name)
    return True


# Backward compatibility alias
patch_aiortc_h264_encoder = patch_aiortc_hw_encoder
check_nvenc = lambda: check_hw_encoder()[0] == "h264_nvenc"
