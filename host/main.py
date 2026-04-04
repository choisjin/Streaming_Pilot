# Design Ref: §9.5 — FastAPI Server (진입점, 라이프사이클)
from __future__ import annotations

import asyncio
import ctypes
import logging
import sys
from contextlib import asynccontextmanager
from typing import Any

import json

import psutil
import uvicorn
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware

from auth.auth_manager import AuthManager
from capture.desktop import DesktopCapture
from capture.wgc_capture import WGCCapture
from config import HostConfig, StreamSettings
from encoder.encoder_manager import EncoderManager
from input.arduino_serial import ArduinoHID
from input.input_handler import InputHandler
from process.manager import get_window_list
from settings import SettingsManager
from streaming.nvenc_patch import patch_aiortc_h264_encoder
from streaming.webrtc import WebRTCManager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# --- Global State ---
host_config = HostConfig()
settings_manager = SettingsManager()
frame_queue: asyncio.Queue = asyncio.Queue(maxsize=2)
desktop_capture: DesktopCapture | None = None
encoder_manager: EncoderManager | None = None
webrtc_manager: WebRTCManager | None = None
# Window streams: stream_id -> (WGCCapture, asyncio.Queue, WebRTCManager)
window_streams: dict[int, dict] = {}
next_stream_id = 1
arduino = ArduinoHID(port="COM6")
input_handler: InputHandler | None = None
auth = AuthManager()

# 관리 설정
class AdminState:
    streaming_active: bool = True
    input_enabled: dict[int, bool] = {}  # streamId → input 허용 여부
    mouse_locked: dict[int, bool] = {}   # streamId → 마우스 가두기 여부

admin = AdminState()


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
    global desktop_capture, encoder_manager, webrtc_manager

    settings = settings_manager.get_current()

    # Desktop capture (dxcam DXGI, separate process)
    desktop_capture = DesktopCapture(
        fps=settings.fps,
        resolution=settings.resolution,
    )
    await desktop_capture.start(frame_queue)

    await asyncio.sleep(1.0)

    # Patch aiortc to use NVENC (after dxcam grabs GPU)
    patch_aiortc_h264_encoder()

    # Initialize encoder
    encoder_manager = EncoderManager(settings)
    encoder_name = await encoder_manager.initialize()
    logger.info("Encoder initialized: %s", encoder_name)

    # Desktop WebRTC manager (stream 0)
    webrtc_manager = WebRTCManager(
        frame_queue=frame_queue,
        stun_servers=host_config.stun_servers,
        fps=settings.fps,
        width=settings.resolution[0],
        height=settings.resolution[1],
    )

    # Arduino HID input
    global input_handler
    if arduino.connect():
        logger.info("Arduino HID connected")
    else:
        logger.warning("Arduino not found — input disabled")
    # Get actual screen resolution for coordinate mapping
    screen_w = ctypes.windll.user32.GetSystemMetrics(0)
    screen_h = ctypes.windll.user32.GetSystemMetrics(1)
    input_handler = InputHandler(
        arduino=arduino,
        screen_w=screen_w,
        screen_h=screen_h,
    )
    logger.info("Screen resolution: %dx%d", screen_w, screen_h)

    logger.info(
        "Ideality Remote Desktop started on %s:%d",
        host_config.host,
        host_config.port,
    )

    yield

    # Shutdown
    for sid, ws in list(window_streams.items()):
        await ws["webrtc"].close()
        await ws["capture"].stop()
    window_streams.clear()
    if webrtc_manager:
        await webrtc_manager.close()
    if encoder_manager:
        await encoder_manager.close()
    if desktop_capture:
        await desktop_capture.stop()
    arduino.disconnect()
    logger.info("Server shutdown complete")


app = FastAPI(title="Ideality Remote Desktop", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 공개 경로 (인증 불필요)
PUBLIC_PATHS = {"/api/auth/login", "/api/auth/status", "/assets", "/", "/login"}


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore
        path = request.url.path

        # 정적 파일, 로그인 페이지, 인증 API, WebSocket은 통과
        if path in PUBLIC_PATHS or path.startswith("/assets/") or path == "/favicon.ico" or path.startswith("/ws/"):
            return await call_next(request)

        # JWT 토큰 확인
        token = request.cookies.get("token") or request.headers.get("Authorization", "").replace("Bearer ", "")
        if not token or not auth.verify_token(token):
            # API 요청은 401, 페이지 요청은 로그인으로 리다이렉트
            if path.startswith("/api/") or path.startswith("/ws/"):
                from fastapi.responses import JSONResponse
                return JSONResponse({"error": "Unauthorized"}, status_code=401)
            from fastapi.responses import RedirectResponse
            return RedirectResponse("/login")

        return await call_next(request)


app.add_middleware(AuthMiddleware)


# --- Pydantic Models ---

class LoginRequest(BaseModel):
    password: str
    otp: str


class OfferRequest(BaseModel):
    sdp: str
    type: str = "offer"
    streamId: int = 0  # 0 = desktop


class IceCandidateRequest(BaseModel):
    candidate: str
    sdpMid: str | None = None
    sdpMLineIndex: int | None = None


class SettingsRequest(BaseModel):
    fps: int | None = None
    bitrate: str | None = None
    resolution: str | None = None
    adaptive: bool | None = None


class CreateStreamRequest(BaseModel):
    hwnd: int
    title: str = ""
    width: int = 0   # 0 = use window's native size
    height: int = 0
    fps: int = 30


# --- Auth API ---

@app.post("/api/auth/login")
async def login(req: LoginRequest) -> dict[str, Any]:
    """비밀번호 + OTP 로그인."""
    token = auth.authenticate(req.password, req.otp)
    if not token:
        raise HTTPException(status_code=401, detail="Invalid password or OTP")

    from fastapi.responses import JSONResponse
    response = JSONResponse({"status": "ok"})
    response.set_cookie("token", token, httponly=True, max_age=86400, samesite="lax")
    return response  # type: ignore


@app.get("/api/auth/status")
async def auth_status(request: Request) -> dict[str, Any]:
    """현재 인증 상태 확인."""
    token = request.cookies.get("token", "")
    return {"authenticated": auth.verify_token(token)}


@app.post("/api/auth/logout")
async def logout(request: Request) -> dict[str, str]:
    token = request.cookies.get("token", "")
    auth.logout(token)
    from fastapi.responses import JSONResponse
    response = JSONResponse({"status": "ok"})
    response.delete_cookie("token")
    return response  # type: ignore


# --- Admin API ---

@app.get("/api/admin/state")
async def get_admin_state() -> dict[str, Any]:
    return {
        "streamingActive": admin.streaming_active,
        "inputEnabled": admin.input_enabled,
        "mouseLocked": admin.mouse_locked,
    }


@app.post("/api/admin/streaming")
async def toggle_streaming(active: bool = True) -> dict[str, Any]:
    admin.streaming_active = active
    logger.info("Streaming %s", "started" if active else "stopped")
    return {"streamingActive": admin.streaming_active}


@app.post("/api/admin/input/{stream_id}")
async def toggle_input(stream_id: int, enabled: bool = True) -> dict[str, Any]:
    admin.input_enabled[stream_id] = enabled
    logger.info("Input for stream %d: %s", stream_id, "enabled" if enabled else "disabled")
    return {"streamId": stream_id, "inputEnabled": enabled}


@app.post("/api/admin/mouse-lock/{stream_id}")
async def toggle_mouse_lock(stream_id: int, locked: bool = True) -> dict[str, Any]:
    admin.mouse_locked[stream_id] = locked
    logger.info("Mouse lock for stream %d: %s", stream_id, "locked" if locked else "unlocked")
    return {"streamId": stream_id, "mouseLocked": locked}


# --- API Endpoints ---

@app.post("/api/offer")
async def handle_offer(offer: OfferRequest) -> dict[str, str]:
    """WebRTC offer/answer. streamId로 어떤 스트림에 연결할지 지정."""
    if not offer.sdp:
        raise HTTPException(status_code=400, detail="SDP is required")

    if offer.streamId == 0:
        # Desktop stream
        if webrtc_manager is None:
            raise HTTPException(status_code=500, detail="WebRTC not initialized")
        wm = webrtc_manager
    else:
        # Window stream
        ws = window_streams.get(offer.streamId)
        if ws is None:
            raise HTTPException(status_code=404, detail=f"Stream {offer.streamId} not found")
        wm = ws["webrtc"]

    try:
        answer_sdp = await wm.create_answer(offer_sdp=offer.sdp, offer_type=offer.type)
    except Exception as e:
        logger.exception("Failed to create WebRTC answer for stream %d", offer.streamId)
        raise HTTPException(status_code=500, detail=str(e))

    return {"sdp": answer_sdp, "type": "answer"}


@app.post("/api/ice-candidate")
async def handle_ice(candidate: IceCandidateRequest) -> dict[str, str]:
    if webrtc_manager is None:
        raise HTTPException(status_code=500, detail="WebRTC not initialized")
    try:
        await webrtc_manager.add_ice_candidate(
            candidate=candidate.candidate,
            sdp_mid=candidate.sdpMid,
            sdp_m_line_index=candidate.sdpMLineIndex,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "ok"}


# --- Process / Stream APIs ---

@app.get("/api/processes")
async def list_processes() -> list[dict[str, Any]]:
    """윈도우가 있는 프로세스 목록."""
    windows = get_window_list()
    return [
        {
            "hwnd": w.hwnd,
            "title": w.title,
            "pid": w.pid,
            "processName": w.process_name,
            "width": w.width,
            "height": w.height,
        }
        for w in windows
    ]


@app.get("/api/streams")
async def list_streams() -> list[dict[str, Any]]:
    """현재 활성 스트림 목록. stream 0 = desktop 항상 포함."""
    streams = [
        {
            "streamId": 0,
            "type": "desktop",
            "title": "Desktop",
            "active": True,
        }
    ]
    for sid, ws in window_streams.items():
        streams.append({
            "streamId": sid,
            "type": "window",
            "hwnd": ws["hwnd"],
            "title": ws["title"],
            "width": ws["width"],
            "height": ws["height"],
            "active": True,
        })
    return streams


@app.post("/api/streams")
async def create_stream(req: CreateStreamRequest) -> dict[str, Any]:
    """새 윈도우 스트림 생성 (WGC API)."""
    global next_stream_id

    # No hard limit — user controls layout

    stream_id = next_stream_id
    next_stream_id += 1

    # Get window native size if not specified
    win_w, win_h = req.width, req.height
    if win_w == 0 or win_h == 0:
        from process.manager import get_window_by_hwnd
        winfo = get_window_by_hwnd(req.hwnd)
        if winfo:
            win_w, win_h = winfo.width, winfo.height
        else:
            win_w, win_h = 800, 600

    # Ensure dimensions are even (required by video encoders)
    win_w = win_w - (win_w % 2)
    win_h = win_h - (win_h % 2)

    # Minimum 640 width for stable encoding
    if win_w < 640:
        scale = 640 / win_w
        win_w = 640
        win_h = int(win_h * scale)
        win_h = win_h - (win_h % 2)

    # Create WGC capture for this window (native resolution)
    q: asyncio.Queue = asyncio.Queue(maxsize=2)
    cap = WGCCapture(
        fps=req.fps,
        resolution=(win_w, win_h),
        window_name=req.title if req.title else None,
        hwnd=req.hwnd,
        cursor=True,
    )
    await cap.start(q)

    # Create WebRTC manager for this stream
    wm = WebRTCManager(
        frame_queue=q,
        stun_servers=host_config.stun_servers,
        fps=req.fps,
        width=win_w,
        height=win_h,
    )

    window_streams[stream_id] = {
        "capture": cap,
        "queue": q,
        "webrtc": wm,
        "hwnd": req.hwnd,
        "title": req.title,
        "width": win_w,
        "height": win_h,
    }

    logger.info("Window stream %d created: hwnd=%d title='%s'", stream_id, req.hwnd, req.title)
    return {"streamId": stream_id, "status": "created"}


@app.delete("/api/streams/{stream_id}")
async def delete_stream(stream_id: int) -> dict[str, str]:
    """스트림 종료."""
    if stream_id == 0:
        raise HTTPException(status_code=400, detail="Cannot delete desktop stream")

    ws = window_streams.pop(stream_id, None)
    if ws is None:
        raise HTTPException(status_code=404, detail="Stream not found")

    await ws["webrtc"].close()
    await ws["capture"].stop()
    logger.info("Window stream %d deleted", stream_id)
    return {"status": "deleted"}


# --- Settings / System ---

@app.get("/api/settings")
async def get_settings() -> dict[str, Any]:
    s = settings_manager.get_current()
    return {
        "fps": s.fps,
        "bitrate": s.bitrate,
        "resolution": f"{s.resolution[0]}x{s.resolution[1]}",
        "adaptive": s.adaptive,
        "encoder": encoder_manager.active_encoder_name if encoder_manager else "none",
    }


@app.post("/api/settings")
async def update_settings(req: SettingsRequest) -> dict[str, Any]:
    kwargs: dict[str, Any] = {}
    if req.fps is not None:
        kwargs["fps"] = req.fps
    if req.bitrate is not None:
        kwargs["bitrate"] = req.bitrate
    if req.resolution is not None:
        kwargs["resolution"] = req.resolution
    if req.adaptive is not None:
        kwargs["adaptive"] = req.adaptive

    if not kwargs:
        raise HTTPException(status_code=400, detail="No settings to update")

    try:
        new_settings = settings_manager.update(**kwargs)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if desktop_capture and ("fps" in kwargs or "resolution" in kwargs):
        desktop_capture.update_settings(
            fps=new_settings.fps,
            resolution=new_settings.resolution,
        )
    if encoder_manager and ("bitrate" in kwargs or "fps" in kwargs):
        encoder_manager.update_settings(
            bitrate_bps=new_settings.bitrate_bps(),
            fps=new_settings.fps,
        )
    if webrtc_manager and "fps" in kwargs:
        webrtc_manager.update_settings(fps=new_settings.fps)

    return {
        "status": "ok",
        "applied": {
            "fps": new_settings.fps,
            "bitrate": new_settings.bitrate,
            "resolution": f"{new_settings.resolution[0]}x{new_settings.resolution[1]}",
            "adaptive": new_settings.adaptive,
            "encoder": encoder_manager.active_encoder_name if encoder_manager else "none",
        },
    }


@app.get("/api/system/info")
async def get_system_info() -> dict[str, Any]:
    s = settings_manager.get_current()
    gpu_name = _get_gpu_name()
    return {
        "resolution": f"{s.resolution[0]}x{s.resolution[1]}",
        "gpu": gpu_name,
        "cpuUsage": psutil.cpu_percent(interval=None),
        "encoderActive": encoder_manager.active_encoder_name if encoder_manager else "none",
        "fpsActual": s.fps,
        "bitrateActual": s.bitrate,
    }


_gpu_name_cache: str | None = None

def _get_gpu_name() -> str:
    global _gpu_name_cache
    if _gpu_name_cache is not None:
        return _gpu_name_cache
    try:
        import subprocess
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3,
        )
        if result.returncode == 0:
            _gpu_name_cache = result.stdout.strip()
            return _gpu_name_cache
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    _gpu_name_cache = "Unknown"
    return _gpu_name_cache


# --- WebSocket Input ---

@app.websocket("/ws/input")
async def ws_input(ws: WebSocket) -> None:
    """WebSocket 입력 수신 — 인증 + 관리 상태 확인 후 Arduino 전달."""
    # WebSocket 인증: 쿠키에서 토큰 확인
    token = ws.cookies.get("token", "")
    if not auth.verify_token(token):
        await ws.close(code=4001, reason="Unauthorized")
        return

    await ws.accept()
    logger.info("Input WebSocket connected (authenticated)")

    try:
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)
            stream_id = msg.get("streamId", 0)

            # 입력 차단 확인
            if not admin.input_enabled.get(stream_id, True):
                continue

            if input_handler:
                if stream_id > 0 and stream_id in window_streams:
                    msg["hwnd"] = window_streams[stream_id]["hwnd"]
                input_handler.handle_message(msg)
    except WebSocketDisconnect:
        logger.info("Input WebSocket disconnected")
    except Exception:
        logger.exception("Input WebSocket error")


@app.post("/api/admin/focus/{stream_id}")
async def focus_window(stream_id: int) -> dict[str, str]:
    """해당 스트림의 윈도우를 포그라운드로 활성화."""
    if stream_id == 0:
        return {"status": "desktop"}
    ws = window_streams.get(stream_id)
    if ws and input_handler:
        input_handler._activate_window(ws["hwnd"])
        return {"status": "focused"}
    return {"status": "not_found"}


@app.post("/api/admin/restart")
async def restart_server() -> dict[str, str]:
    """서버 재시작 — 강제 종료."""
    import os
    logger.info("Server restart requested — force exit")

    async def _force_exit():
        await asyncio.sleep(0.5)
        os._exit(0)  # 강제 종료, 모든 자식 프로세스도 종료됨

    asyncio.create_task(_force_exit())
    return {"status": "restarting"}


@app.get("/api/turn/credentials")
async def get_turn_credentials() -> dict[str, Any]:
    """Cloudflare TURN credentials 생성."""
    import httpx
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"https://rtc.live.cloudflare.com/v1/turn/keys/{host_config.turn_key_id}/credentials/generate-ice-servers",
                headers={
                    "Authorization": f"Bearer {host_config.turn_api_token}",
                    "Content-Type": "application/json",
                },
                json={"ttl": 86400},
                timeout=10,
            )
            if resp.status_code == 201:
                return resp.json()
            logger.warning("TURN credentials failed: %d", resp.status_code)
    except Exception as e:
        logger.warning("TURN credentials error: %s", e)

    # Fallback: STUN only
    return {
        "iceServers": [
            {"urls": ["stun:stun.cloudflare.com:3478"]},
        ]
    }


@app.get("/api/arduino/status")
async def get_arduino_status() -> dict[str, Any]:
    """Arduino 연결 상태."""
    return {
        "connected": arduino.connected,
    }


# --- Static file serving (production build) ---
WEB_DIST = Path(__file__).parent.parent / "web" / "dist"
if WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(WEB_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> FileResponse:
        """SPA fallback — serve index.html for all non-API routes."""
        file = WEB_DIST / full_path
        if file.exists() and file.is_file():
            return FileResponse(str(file))
        return FileResponse(str(WEB_DIST / "index.html"))


def _kill_port(port: int) -> None:
    """Kill any process using the given port."""
    import subprocess as sp
    try:
        result = sp.run(
            f'netstat -ano | findstr :{port} | findstr LISTENING',
            shell=True, capture_output=True, text=True, timeout=5,
        )
        for line in result.stdout.strip().split('\n'):
            parts = line.split()
            if parts:
                pid = parts[-1]
                if pid.isdigit() and int(pid) != os.getpid():
                    sp.run(f'taskkill /f /pid {pid}', shell=True, capture_output=True, timeout=5)
                    logger.info("Killed process %s on port %d", pid, port)
    except Exception:
        pass


if __name__ == "__main__":
    import os
    _kill_port(host_config.port)
    import time; time.sleep(1)

    uvicorn.run(
        "main:app",
        host=host_config.host,
        port=host_config.port,
        reload=False,
        log_level="info",
    )
