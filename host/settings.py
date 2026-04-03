# Design Ref: §9.4 — SettingsManager
from __future__ import annotations

import logging
from dataclasses import replace

from config import StreamSettings

logger = logging.getLogger(__name__)

# Plan SC: SC-4 수동 품질 조절 실시간 반영
# Plan SC: SC-5 적응형 모드 자동 품질 조절
FPS_MIN, FPS_MAX = 1, 120
BITRATE_MIN, BITRATE_MAX = 1_000_000, 20_000_000  # 1M ~ 20M
VALID_RESOLUTIONS = [(1920, 1080), (1280, 720), (854, 480)]


class SettingsManager:
    """스트림 설정 상태 관리 + 유효성 검증."""

    def __init__(self, initial: StreamSettings | None = None) -> None:
        self._settings = initial or StreamSettings()
        self._max_fps = self._settings.fps
        self._max_bitrate_bps = self._settings.bitrate_bps()

    def get_current(self) -> StreamSettings:
        return self._settings

    def update(self, **kwargs: object) -> StreamSettings:
        """설정 변경. 유효성 검증 포함.

        Raises:
            ValueError: if any value is out of valid range.
        """
        if "fps" in kwargs:
            fps = int(kwargs["fps"])  # type: ignore[arg-type]
            if not (FPS_MIN <= fps <= FPS_MAX):
                raise ValueError(f"FPS must be {FPS_MIN}~{FPS_MAX}, got {fps}")
            self._settings = replace(self._settings, fps=fps)
            self._max_fps = fps

        if "bitrate" in kwargs:
            raw = str(kwargs["bitrate"])
            tmp = replace(self._settings, bitrate=raw)
            bps = tmp.bitrate_bps()
            if not (BITRATE_MIN <= bps <= BITRATE_MAX):
                raise ValueError(
                    f"Bitrate must be 1M~20M, got {raw}"
                )
            self._settings = tmp
            self._max_bitrate_bps = bps

        if "resolution" in kwargs:
            res = kwargs["resolution"]
            if isinstance(res, str):
                parts = res.split("x")
                res = (int(parts[0]), int(parts[1]))
            if res not in VALID_RESOLUTIONS:
                raise ValueError(
                    f"Resolution must be one of {VALID_RESOLUTIONS}, got {res}"
                )
            self._settings = replace(self._settings, resolution=res)  # type: ignore[arg-type]

        if "adaptive" in kwargs:
            self._settings = replace(self._settings, adaptive=bool(kwargs["adaptive"]))

        logger.info("Settings updated: %s", self._settings)
        return self._settings

    def apply_adaptive(self, packet_loss: float, rtt_ms: float) -> StreamSettings:
        """적응형 비트레이트 조절. WebRTC 통계 기반.

        Design Ref: §9.4 — 적응형 비트레이트 로직
        """
        if not self._settings.adaptive:
            return self._settings

        current_bps = self._settings.bitrate_bps()
        current_fps = self._settings.fps

        if packet_loss > 0.05 or rtt_ms > 150:
            new_bps = max(int(current_bps * 0.7), BITRATE_MIN)
            new_fps = max(current_fps - 10, 15)
            logger.info(
                "Adaptive: quality DOWN (loss=%.2f%%, rtt=%.0fms)",
                packet_loss * 100,
                rtt_ms,
            )
        elif packet_loss < 0.01 and rtt_ms < 50:
            new_bps = min(int(current_bps * 1.1), self._max_bitrate_bps)
            new_fps = min(current_fps + 5, self._max_fps)
            logger.debug("Adaptive: quality UP")
        else:
            return self._settings

        bps_m = f"{new_bps / 1_000_000:.1f}M"
        self._settings = replace(self._settings, fps=new_fps, bitrate=bps_m)
        return self._settings
