# Design Ref: §3.1 — Host-Side Data Structures
from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass
class StreamSettings:
    fps: int = 30
    bitrate: str = "4M"
    resolution: tuple[int, int] = (1920, 1080)
    adaptive: bool = True
    encoder: str = "auto"  # auto | h264_nvenc | h264_subprocess | libx264

    def bitrate_bps(self) -> int:
        """Convert bitrate string like '6M' to bits per second."""
        s = self.bitrate.strip().upper()
        if s.endswith("M"):
            return int(float(s[:-1]) * 1_000_000)
        if s.endswith("K"):
            return int(float(s[:-1]) * 1_000)
        return int(s)


@dataclass
class SystemInfo:
    resolution: tuple[int, int] = (1920, 1080)
    gpu: str = ""
    cpu_usage: float = 0.0
    encoder_active: str = ""
    fps_actual: float = 0.0
    bitrate_actual: str = ""


@dataclass
class SignalingMessage:
    sdp: str = ""
    type: str = ""  # "offer" | "answer"


@dataclass
class IceCandidate:
    candidate: str = ""
    sdpMid: str | None = None
    sdpMLineIndex: int | None = None


@dataclass
class HostConfig:
    host: str = "0.0.0.0"
    port: int = int(os.environ.get("HOST_PORT", "8080"))
    stun_servers: list[str] = field(
        default_factory=lambda: ["stun:stun.l.google.com:19302"]
    )
    max_streams: int = 4
    game_mode: bool = False
