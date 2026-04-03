# Streaming MVP Design Document

> **Summary**: 브라우저에서 원격 PC 전체 화면을 WebRTC로 실시간 스트리밍하는 MVP 설계
>
> **Project**: Ideality Remote Desktop
> **Author**: choi3
> **Date**: 2026-04-03
> **Status**: Draft
> **Planning Doc**: [streaming-mvp.plan.md](../../01-plan/features/streaming-mvp.plan.md)

---

## Context Anchor

> Copied from Plan document. Ensures strategic context survives Design→Do handoff.

| Key | Value |
|-----|-------|
| **WHY** | 안티치트 환경에서도 동작하는 웹 기반 원격 데스크톱 시스템의 핵심 기능(영상 스트리밍) 구현 |
| **WHO** | 원격 PC를 브라우저로 모니터링/제어하려는 개인 사용자 (단일 사용자 시스템) |
| **RISK** | aiortc의 하드웨어 인코딩 미지원으로 인한 인코딩 파이프라인 복잡도 증가 |
| **SUCCESS** | 브라우저에서 원격 PC 전체 화면이 60fps/1080p로 표시되며, 지연 시간 200ms 이하 |
| **SCOPE** | Phase 1 MVP: 화면 캡처 → 인코딩 → WebRTC 전송 → 브라우저 수신/표시 (단일 스트림) |

---

## 1. Overview

### 1.1 Design Goals

- **저지연 영상 파이프라인**: DXGI 캡처 → NVENC 인코딩 → WebRTC 전송을 200ms 이하로 구현
- **유연한 인코딩**: PyAV NVENC 우선, FFmpeg subprocess / libx264 자동 폴백
- **실시간 품질 조절**: 적응형 + 수동 모드로 FPS/비트레이트/해상도를 런타임에 변경
- **확장 가능한 구조**: Phase 2(입력), Phase 3(멀티 스트림)으로 자연스럽게 확장 가능

### 1.2 Design Principles

- **Producer-Consumer 패턴**: 캡처/인코딩/전송을 비동기 큐로 분리하여 병목 방지
- **Strategy 패턴**: EncoderManager가 인코딩 전략을 런타임에 교체 (NVENC → subprocess → libx264)
- **단일 책임**: 각 모듈(캡처, 인코딩, WebRTC, API)이 독립적으로 동작

---

## 2. Architecture

### 2.0 Architecture Comparison

| Criteria | Option A: Minimal | Option B: Clean | **Option C: Pragmatic** |
|----------|:-:|:-:|:-:|
| **Approach** | FFmpeg subprocess only | PyAV NVENC only | PyAV 우선 + 다단계 폴백 |
| **New Files** | ~8 | ~12 | **~10** |
| **Complexity** | Low | High | **Medium** |
| **Maintainability** | Medium | High | **High** |
| **Effort** | Low | High | **Medium** |
| **Risk** | Medium (프로세스 관리) | High (환경 의존) | **Low (폴백 존재)** |
| **Recommendation** | 빠른 프로토타입 | 이상적이지만 리스크 | **Default choice** |

**Selected**: Option C — **Rationale**: PyAV 네이티브의 성능 이점을 취하면서, NVENC 환경 세팅 실패 시 FFmpeg subprocess와 libx264로 자동 폴백하여 어떤 환경에서든 동작을 보장. 적응형/수동 품질 조절 요구사항에도 가장 적합.

### 2.1 System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Host Agent (Python 3.11+)                       │
│                                                                     │
│  ┌───────────┐    ┌───────────┐    ┌─────────────────┐             │
│  │  DXGI     │    │  Frame    │    │ EncoderManager  │             │
│  │  Desktop  │───▶│  Queue    │───▶│                 │             │
│  │  Capture  │    │ (asyncio) │    │ ┌─────────────┐ │             │
│  │           │    │           │    │ │ PyAV NVENC  │←─ 1순위       │
│  │ Thread    │    │ maxsize=2 │    │ ├─────────────┤ │             │
│  └───────────┘    └───────────┘    │ │ FFmpeg proc │←─ 2순위 폴백  │
│                                    │ ├─────────────┤ │             │
│                                    │ │ PyAV x264   │←─ 3순위 폴백  │
│                                    │ └─────────────┘ │             │
│                                    └────────┬────────┘             │
│                                             │ H.264 packets        │
│                                             ▼                      │
│  ┌───────────────┐              ┌───────────────────┐              │
│  │  FastAPI       │              │ WebRTC Manager    │              │
│  │  ┌───────────┐│              │ ┌───────────────┐ │              │
│  │  │/api/offer ││◀────────────▶│ │ aiortc        │ │              │
│  │  │/api/ice   ││  signaling   │ │ PeerConnection│─┼──▶ Browser   │
│  │  │/api/settings│              │ │ VideoTrack    │ │   (WebRTC)  │
│  │  │/api/system││              │ └───────────────┘ │              │
│  │  └───────────┘│              └───────────────────┘              │
│  └───────────────┘                                                 │
│                                                                     │
│  ┌───────────────┐                                                 │
│  │ SettingsManager│ ← FPS/bitrate/resolution/adaptive 상태 관리     │
│  └───────────────┘                                                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ WebRTC P2P (SRTP/DTLS)
                              │ STUN: stun.l.google.com:19302
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Browser Client (React + TS)                     │
│                                                                     │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────┐   │
│  │ useWebRTC     │  │ StreamViewer  │  │ SettingsPanel         │   │
│  │               │  │               │  │                       │   │
│  │ - createOffer │  │ - <video>     │  │ - FPS slider          │   │
│  │ - addIce      │  │ - stats       │  │ - Bitrate slider      │   │
│  │ - reconnect   │  │ - fullscreen  │  │ - Resolution select   │   │
│  └───────┬───────┘  └───────────────┘  │ - Adaptive toggle     │   │
│          │                              │ - Encoder info        │   │
│          ▼                              └───────────────────────┘   │
│  ┌───────────────┐                                                  │
│  │ streamStore   │ ← Zustand: 연결 상태, 스트림 설정, 통계          │
│  └───────────────┘                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

```
1. 캡처:   DXGI Desktop Duplication → numpy array (BGRA, 1920x1080)
2. 큐:     asyncio.Queue (maxsize=2, 오래된 프레임 드롭)
3. 변환:   numpy array → av.VideoFrame (yuv420p 색공간 변환)
4. 인코딩: EncoderManager → H.264 packets (av.Packet 또는 bytes)
5. 전송:   CustomVideoTrack → aiortc PeerConnection → WebRTC SRTP
6. 수신:   Browser RTCPeerConnection → MediaStream → <video> element
```

### 2.3 Dependencies

| Component | Depends On | Purpose |
|-----------|-----------|---------|
| DesktopCapture | comtypes (DXGI COM) | Windows 화면 캡처 |
| EncoderManager | PyAV (av), subprocess | H.264 인코딩 (NVENC/x264) |
| WebRTCManager | aiortc, EncoderManager | WebRTC 스트리밍 |
| FastAPI Server | WebRTCManager, SettingsManager | HTTP API + 시그널링 |
| SettingsManager | — | FPS/bitrate/resolution 상태 관리 |
| StreamViewer | useWebRTC hook | 영상 표시 |
| SettingsPanel | streamStore | 품질 조절 UI |

---

## 3. Data Model

### 3.1 Host-Side Data Structures

```python
# host/config.py
from dataclasses import dataclass, field

@dataclass
class StreamSettings:
    fps: int = 60
    bitrate: str = "6M"
    resolution: tuple[int, int] = (1920, 1080)
    adaptive: bool = True
    encoder: str = "auto"  # auto | h264_nvenc | h264_subprocess | libx264

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
```

### 3.2 Client-Side Types

```typescript
// web/src/types/index.ts

export interface StreamSettings {
  fps: number;
  bitrate: string;
  resolution: string;      // "1920x1080"
  adaptive: boolean;
  encoder: string;
}

export interface SystemInfo {
  resolution: string;
  gpu: string;
  cpuUsage: number;
  encoderActive: string;
  fpsActual: number;
  bitrateActual: string;
}

export interface ConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'failed';
  error?: string;
}

export interface StreamStore {
  // State
  connection: ConnectionState;
  settings: StreamSettings;
  systemInfo: SystemInfo | null;
  
  // Actions
  connect: (serverUrl: string) => Promise<void>;
  disconnect: () => void;
  updateSettings: (settings: Partial<StreamSettings>) => Promise<void>;
  fetchSystemInfo: () => Promise<void>;
}
```

---

## 4. API Specification

### 4.1 Endpoint List

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/offer` | WebRTC SDP offer → answer 교환 | None (MVP) |
| POST | `/api/ice-candidate` | ICE candidate 추가 | None (MVP) |
| GET | `/api/settings` | 현재 스트림 설정 조회 | None (MVP) |
| POST | `/api/settings` | 스트림 설정 변경 (FPS, bitrate 등) | None (MVP) |
| GET | `/api/system/info` | 시스템 정보 조회 | None (MVP) |

### 4.2 Detailed Specification

#### `POST /api/offer` — WebRTC 시그널링

**Request:**
```json
{
  "sdp": "v=0\r\no=- ...",
  "type": "offer"
}
```

**Response (200 OK):**
```json
{
  "sdp": "v=0\r\no=- ...",
  "type": "answer"
}
```

**Error:**
- `400`: Invalid SDP format
- `409`: Already connected (단일 사용자)

#### `POST /api/ice-candidate`

**Request:**
```json
{
  "candidate": "candidate:...",
  "sdpMid": "0",
  "sdpMLineIndex": 0
}
```

**Response (200 OK):**
```json
{ "status": "ok" }
```

#### `GET /api/settings`

**Response (200 OK):**
```json
{
  "fps": 60,
  "bitrate": "6M",
  "resolution": "1920x1080",
  "adaptive": true,
  "encoder": "h264_nvenc"
}
```

#### `POST /api/settings`

**Request (all fields optional):**
```json
{
  "fps": 30,
  "bitrate": "4M",
  "resolution": "1280x720",
  "adaptive": false
}
```

**Response (200 OK):**
```json
{
  "status": "ok",
  "applied": {
    "fps": 30,
    "bitrate": "4M",
    "resolution": "1280x720",
    "adaptive": false,
    "encoder": "h264_nvenc"
  }
}
```

#### `GET /api/system/info`

**Response (200 OK):**
```json
{
  "resolution": "1920x1080",
  "gpu": "NVIDIA GeForce RTX 3070 Laptop GPU",
  "cpuUsage": 15.2,
  "encoderActive": "h264_nvenc",
  "fpsActual": 59.8,
  "bitrateActual": "5.8M"
}
```

---

## 5. UI/UX Design

### 5.1 Screen Layout

```
┌────────────────────────────────────────────────────────┐
│  Ideality Remote Desktop              [⚙ Settings] [⛶]│  ← Header (40px)
├────────────────────────────────────────────────────────┤
│                                                        │
│                                                        │
│                                                        │
│              <video> Stream Viewer                     │
│              (16:9, 전체 영역 사용)                      │
│                                                        │
│                                                        │
│                                                        │
├────────────────────────────────────────────────────────┤
│  🟢 Connected │ 59.8fps │ 5.8Mbps │ NVENC │ 12ms     │  ← Status Bar (32px)
└────────────────────────────────────────────────────────┘

Settings Panel (토글, 우측 슬라이드):
┌────────────────────┐
│ ⚙ Stream Settings  │
├────────────────────┤
│ FPS:    [====●==] 60│
│ Bitrate:[====●==] 6M│
│ Resolution: [▼ 1080p]│
│                    │
│ [✓] Adaptive Mode  │
│                    │
│ Encoder: NVENC ✅   │
│ GPU: RTX 3070      │
│ CPU: 15%           │
└────────────────────┘
```

### 5.2 User Flow

```
페이지 접속 → 자동 WebRTC 연결 시도 → 연결 성공 → 영상 표시
                                    → 연결 실패 → 에러 표시 + 재연결 버튼
                                    
영상 시청 중 → Settings 버튼 → 품질 조절 → 실시간 반영
            → 전체화면 버튼 → 브라우저 전체화면
```

### 5.3 Component List

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `App.tsx` | `src/App.tsx` | 메인 레이아웃, 라우팅 없음 (SPA) |
| `StreamViewer.tsx` | `src/components/StreamViewer.tsx` | `<video>` 렌더링, WebRTC 스트림 연결, 전체화면 |
| `SettingsPanel.tsx` | `src/components/SettingsPanel.tsx` | FPS/bitrate/해상도 슬라이더, 적응형 토글 |
| `StatusBar.tsx` | `src/components/StatusBar.tsx` | 연결 상태, 실시간 통계 표시 |
| `ConnectionOverlay.tsx` | `src/components/ConnectionOverlay.tsx` | 연결 중/실패 오버레이 UI |

### 5.4 Page UI Checklist

#### Main Page (StreamViewer)

- [ ] Video: `<video>` element (autoplay, playsInline, 16:9 비율 유지)
- [ ] Button: Settings 토글 버튼 (우측 상단 기어 아이콘)
- [ ] Button: 전체화면 버튼 (우측 상단)
- [ ] StatusBar: 연결 상태 인디케이터 (🟢 Connected / 🔴 Disconnected / 🟡 Connecting)
- [ ] StatusBar: 실시간 FPS 표시
- [ ] StatusBar: 실시간 비트레이트 표시
- [ ] StatusBar: 인코더 종류 표시 (NVENC / x264 / subprocess)
- [ ] StatusBar: 지연 시간 표시 (ms)
- [ ] Overlay: 연결 중 스피너 + "Connecting..." 텍스트
- [ ] Overlay: 연결 실패 시 에러 메시지 + "Reconnect" 버튼

#### Settings Panel

- [ ] Slider: FPS (1~120, step 1, 기본값 60)
- [ ] Slider: Bitrate (1M~20M, step 0.5M, 기본값 6M)
- [ ] Select: Resolution (1920x1080, 1280x720, 854x480)
- [ ] Toggle: Adaptive Mode (기본 On)
- [ ] Display: 현재 인코더 정보 (읽기 전용)
- [ ] Display: GPU 이름 (읽기 전용)
- [ ] Display: CPU 사용률 (실시간 갱신)

---

## 6. Error Handling

### 6.1 Host-Side Errors

| Error | Cause | Handling |
|-------|-------|----------|
| DXGI 캡처 실패 | 권한 부족 / 드라이버 | 로그 경고 + 재시도 (3회) → 실패 시 에러 로그 |
| NVENC 초기화 실패 | GPU 미지원 / 드라이버 | FFmpeg subprocess로 폴백 → libx264 폴백 |
| FFmpeg subprocess 실패 | FFmpeg 미설치 | libx264 폴백 |
| WebRTC 연결 실패 | 네트워크 / STUN 실패 | 클라이언트에 에러 전달, 재연결 대기 |
| 프레임 큐 오버플로우 | 인코딩이 캡처보다 느림 | 오래된 프레임 드롭 (maxsize=2) |

### 6.2 Client-Side Errors

| Error | Cause | Handling |
|-------|-------|----------|
| WebRTC offer 실패 | 서버 미응답 | ConnectionOverlay에 에러 표시 + 재연결 버튼 |
| ICE 연결 실패 | NAT/방화벽 | 에러 메시지 + "서버 주소 확인" 안내 |
| 영상 끊김 | 네트워크 불안정 | 자동 재연결 시도 (5초 간격, 최대 5회) |
| Settings API 실패 | 서버 에러 | Toast 알림 + 이전 설정 유지 |

### 6.3 Error Response Format

```json
{
  "error": {
    "code": "ENCODER_FALLBACK",
    "message": "NVENC unavailable, using libx264",
    "details": { "original": "h264_nvenc", "fallback": "libx264" }
  }
}
```

---

## 7. Security Considerations

> Phase 1 MVP는 인증 없이 동작 (Phase 4에서 JWT 추가)

- [ ] CORS: 개발 시 `*`, 배포 시 `ideality.kr`만 허용
- [ ] WebRTC: DTLS/SRTP로 미디어 스트림 암호화 (기본 제공)
- [ ] Settings API: 값 범위 검증 (FPS 1~120, bitrate 1M~20M)
- [x] 단일 사용자: 동시 WebRTC 연결 1개로 제한
- [ ] 입력 검증: SDP/ICE candidate 포맷 검증

---

## 8. Test Plan

### 8.1 Test Scope

| Type | Target | Tool | Phase |
|------|--------|------|-------|
| L1: API Tests | FastAPI endpoints | pytest + httpx | Do |
| L2: Unit Tests | Encoder, Capture, WebRTC 모듈 | pytest | Do |
| L3: Integration | 캡처→인코딩→WebRTC 파이프라인 | pytest + 수동 | Do |

### 8.2 L1: API Test Scenarios

| # | Endpoint | Method | Test Description | Expected Status |
|---|----------|--------|-----------------|:--------------:|
| 1 | `/api/offer` | POST | 유효한 SDP offer → answer 반환 | 200 |
| 2 | `/api/offer` | POST | 빈 SDP → 에러 | 400 |
| 3 | `/api/ice-candidate` | POST | 유효한 ICE candidate 추가 | 200 |
| 4 | `/api/settings` | GET | 현재 설정 조회 | 200 |
| 5 | `/api/settings` | POST | FPS 변경 (30) | 200 |
| 6 | `/api/settings` | POST | 범위 초과 FPS (999) → 에러 | 400 |
| 7 | `/api/system/info` | GET | 시스템 정보 반환 | 200 |

### 8.3 L2: Unit Test Scenarios

| # | Module | Test Description | Expected Result |
|---|--------|-----------------|----------------|
| 1 | EncoderManager | NVENC 사용 가능 시 NVENC 선택 | encoder_type == "h264_nvenc" |
| 2 | EncoderManager | NVENC 불가 시 subprocess 폴백 | encoder_type == "h264_subprocess" |
| 3 | EncoderManager | subprocess 불가 시 libx264 폴백 | encoder_type == "libx264" |
| 4 | EncoderManager | 설정 변경 시 인코더 파라미터 반영 | 새 bitrate 적용됨 |
| 5 | SettingsManager | 유효 범위 내 FPS 변경 | fps == 30 |
| 6 | SettingsManager | 유효 범위 초과 → ValueError | exception raised |

### 8.4 L3: Integration Test Scenarios

| # | Scenario | Steps | Success Criteria |
|---|----------|-------|-----------------|
| 1 | 기본 스트리밍 | 서버 시작 → 브라우저 접속 → 영상 표시 | 영상이 60fps로 재생됨 |
| 2 | 품질 변경 | 스트리밍 중 → FPS 30으로 변경 | 체감 FPS 감소 확인 |
| 3 | 인코더 폴백 | NVENC 비활성화 → 서버 시작 | libx264로 자동 전환, 영상 정상 |
| 4 | 연결 끊김 | 스트리밍 중 → 네트워크 차단 → 복구 | 자동 재연결 후 영상 복귀 |

---

## 9. Module Design

### 9.1 DesktopCapture (`host/capture/desktop.py`)

```python
class DesktopCapture:
    """DXGI Desktop Duplication을 사용한 전체 화면 캡처.
    별도 스레드에서 실행되며 asyncio.Queue로 프레임 전달."""
    
    def __init__(self, fps: int = 60, resolution: tuple[int, int] = (1920, 1080)):
        ...
    
    async def start(self, frame_queue: asyncio.Queue) -> None:
        """캡처 루프 시작. 프레임을 numpy array(BGRA)로 큐에 넣음."""
        ...
    
    async def stop(self) -> None:
        """캡처 루프 정지."""
        ...
    
    def update_settings(self, fps: int = None, resolution: tuple = None) -> None:
        """런타임 설정 변경."""
        ...
```

**DXGI 캡처 흐름:**
1. `IDXGIOutputDuplication` COM 인터페이스 초기화
2. `AcquireNextFrame()` 으로 GPU 텍스처 획득
3. GPU 텍스처 → CPU 메모리 복사 (staging texture)
4. numpy array (BGRA, HxWx4)로 변환
5. `frame_queue.put()` (큐가 가득 차면 오래된 프레임 드롭)

### 9.2 EncoderManager (`host/encoder/encoder_manager.py`)

```python
class BaseEncoder(ABC):
    """인코더 추상 베이스 클래스."""
    @abstractmethod
    async def encode(self, frame: av.VideoFrame) -> list[av.Packet]: ...
    @abstractmethod
    def update_settings(self, bitrate: str, fps: int) -> None: ...
    @abstractmethod
    async def close(self) -> None: ...

class NvencEncoder(BaseEncoder):
    """PyAV 기반 NVENC H.264 인코더."""
    ...

class SubprocessEncoder(BaseEncoder):
    """FFmpeg subprocess 기반 인코더."""
    ...

class SoftwareEncoder(BaseEncoder):
    """PyAV 기반 libx264 소프트웨어 인코더."""
    ...

class EncoderManager:
    """Strategy 패턴으로 최적 인코더 자동 선택 및 폴백 관리."""
    
    def __init__(self, settings: StreamSettings):
        ...
    
    async def initialize(self) -> str:
        """인코더 초기화. 순서: NVENC → subprocess → libx264.
        Returns: 선택된 인코더 이름."""
        ...
    
    async def encode_frame(self, frame: numpy.ndarray) -> list[av.Packet]:
        """numpy array → H.264 packets."""
        ...
    
    def update_settings(self, **kwargs) -> None:
        """런타임 인코딩 설정 변경."""
        ...
```

**폴백 순서:**
```
1. NvencEncoder 초기화 시도
   ├─ 성공 → NVENC 사용
   └─ 실패 (RuntimeError)
       ├─ 2. SubprocessEncoder 초기화 시도
       │   ├─ 성공 → FFmpeg subprocess 사용
       │   └─ 실패 (FileNotFoundError: ffmpeg not found)
       │       └─ 3. SoftwareEncoder 초기화
       │           └─ 항상 성공 (libx264는 PyAV에 내장)
       └─ (로그: "NVENC unavailable, falling back to ...")
```

### 9.3 WebRTCManager (`host/streaming/webrtc.py`)

```python
class CustomVideoTrack(MediaStreamTrack):
    """aiortc용 커스텀 비디오 트랙.
    EncoderManager에서 받은 H.264 패킷을 RTP로 변환."""
    
    kind = "video"
    
    def __init__(self, encoder_manager: EncoderManager, 
                 frame_queue: asyncio.Queue):
        ...
    
    async def recv(self) -> av.VideoFrame:
        """aiortc가 호출. 큐에서 프레임을 꺼내 인코딩 후 반환."""
        ...

class WebRTCManager:
    """WebRTC PeerConnection 생명주기 관리."""
    
    def __init__(self, encoder_manager: EncoderManager,
                 frame_queue: asyncio.Queue):
        ...
    
    async def create_answer(self, offer_sdp: str) -> str:
        """SDP offer를 받아 answer 생성."""
        ...
    
    async def add_ice_candidate(self, candidate: dict) -> None:
        """ICE candidate 추가."""
        ...
    
    async def close(self) -> None:
        """PeerConnection 종료."""
        ...
```

### 9.4 SettingsManager (`host/settings.py`)

```python
class SettingsManager:
    """스트림 설정 상태 관리 + 적응형 비트레이트 로직."""
    
    def __init__(self, initial: StreamSettings):
        ...
    
    def update(self, **kwargs) -> StreamSettings:
        """설정 변경. 유효성 검증 포함.
        Raises ValueError if out of range."""
        ...
    
    def get_current(self) -> StreamSettings:
        """현재 설정 반환."""
        ...
    
    async def adaptive_loop(self) -> None:
        """적응형 모드: WebRTC 통계 기반 자동 품질 조절 루프."""
        ...
```

**적응형 비트레이트 로직:**
```
매 2초마다:
  packet_loss = webrtc_stats.packets_lost / packets_sent
  rtt = webrtc_stats.round_trip_time
  
  if packet_loss > 5% or rtt > 150ms:
    bitrate *= 0.7  (30% 감소)
    fps = max(fps - 10, 15)
  elif packet_loss < 1% and rtt < 50ms:
    bitrate = min(bitrate * 1.1, max_bitrate)  (10% 증가)
    fps = min(fps + 5, max_fps)
```

### 9.5 FastAPI Server (`host/main.py`)

```python
app = FastAPI(title="Ideality Remote Desktop")

# 글로벌 인스턴스
settings_manager: SettingsManager
encoder_manager: EncoderManager
webrtc_manager: WebRTCManager
frame_queue: asyncio.Queue

@app.on_event("startup")
async def startup():
    """서버 시작 시: 캡처 시작 → 인코더 초기화."""
    ...

@app.on_event("shutdown")
async def shutdown():
    """서버 종료 시: 캡처/인코더/WebRTC 정리."""
    ...

@app.post("/api/offer")
async def handle_offer(offer: SignalingMessage) -> dict: ...

@app.post("/api/ice-candidate")
async def handle_ice(candidate: IceCandidate) -> dict: ...

@app.get("/api/settings")
async def get_settings() -> dict: ...

@app.post("/api/settings")  
async def update_settings(settings: dict) -> dict: ...

@app.get("/api/system/info")
async def get_system_info() -> dict: ...
```

---

## 10. Coding Convention

### 10.1 Python (Host)

| Item | Convention |
|------|-----------|
| Style | PEP 8, black formatter |
| Typing | Type hints 필수 (mypy strict) |
| Naming | snake_case (함수, 변수), PascalCase (클래스) |
| Async | asyncio 기반, CPU-bound는 `run_in_executor` |
| Logging | `logging` 모듈, 레벨별 구분 (DEBUG/INFO/WARNING/ERROR) |
| Import | stdlib → third-party → local, isort 정렬 |

### 10.2 TypeScript (Web Client)

| Item | Convention |
|------|-----------|
| Components | PascalCase 함수형 컴포넌트 |
| Hooks | `use` prefix, camelCase |
| Types | PascalCase interface, `types/index.ts`에 집중 |
| State | Zustand store, `stores/` 디렉토리 |
| Styling | Tailwind CSS utility classes |
| Import | React → third-party → components → hooks → stores → types |

---

## 11. Implementation Guide

### 11.1 File Structure

```
host/
├── main.py                          # FastAPI 진입점, 라이프사이클 관리
├── config.py                        # StreamSettings, SystemInfo 데이터클래스
├── settings.py                      # SettingsManager (설정 관리 + 적응형)
├── capture/
│   ├── __init__.py
│   └── desktop.py                   # DesktopCapture (DXGI)
├── encoder/
│   ├── __init__.py
│   └── encoder_manager.py           # BaseEncoder, NvencEncoder, SubprocessEncoder, SoftwareEncoder, EncoderManager
├── streaming/
│   ├── __init__.py
│   └── webrtc.py                    # CustomVideoTrack, WebRTCManager
└── requirements.txt

web/
├── src/
│   ├── App.tsx                      # 메인 앱, 레이아웃
│   ├── components/
│   │   ├── StreamViewer.tsx          # <video>, WebRTC 스트림 표시
│   │   ├── SettingsPanel.tsx         # 품질 조절 UI
│   │   ├── StatusBar.tsx             # 연결 상태, 통계
│   │   └── ConnectionOverlay.tsx     # 연결 중/실패 오버레이
│   ├── hooks/
│   │   └── useWebRTC.ts             # WebRTC 연결 관리 훅
│   ├── stores/
│   │   └── streamStore.ts           # Zustand 상태 관리
│   └── types/
│       └── index.ts                 # 타입 정의
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
└── postcss.config.js
```

### 11.2 Implementation Order

1. [ ] **host/config.py** — 데이터클래스 정의 (StreamSettings, SystemInfo)
2. [ ] **host/settings.py** — SettingsManager (설정 관리, 유효성 검증)
3. [ ] **host/capture/desktop.py** — DXGI 캡처 모듈
4. [ ] **host/encoder/encoder_manager.py** — 인코더 (NVENC + 폴백)
5. [ ] **host/streaming/webrtc.py** — WebRTC 매니저 + 커스텀 비디오 트랙
6. [ ] **host/main.py** — FastAPI 서버 통합 + API 엔드포인트
7. [ ] **host/requirements.txt** — Python 의존성
8. [ ] **web/ 프로젝트 초기화** — Vite + React + TS + Tailwind
9. [ ] **web/src/types/index.ts** — 타입 정의
10. [ ] **web/src/stores/streamStore.ts** — Zustand 스토어
11. [ ] **web/src/hooks/useWebRTC.ts** — WebRTC 연결 훅
12. [ ] **web/src/components/** — UI 컴포넌트 (StreamViewer → StatusBar → SettingsPanel → ConnectionOverlay)
13. [ ] **web/src/App.tsx** — 메인 앱 통합

### 11.3 Session Guide

> Module 단위로 세션을 분리하여 구현 가능. `/pdca do streaming-mvp --scope module-N`

#### Module Map

| Module | Scope Key | Description | Estimated Effort |
|--------|-----------|-------------|:----------------:|
| Host Core | `module-1` | config.py, settings.py, requirements.txt | Small |
| Screen Capture | `module-2` | DXGI Desktop Duplication 캡처 모듈 | Medium |
| Encoder Pipeline | `module-3` | EncoderManager + 3 인코더 (NVENC/subprocess/x264) | Large |
| WebRTC Streaming | `module-4` | CustomVideoTrack, WebRTCManager, 시그널링 | Large |
| FastAPI Server | `module-5` | main.py 통합, API 엔드포인트, 라이프사이클 | Medium |
| Web Client | `module-6` | React 앱 전체 (components, hooks, stores) | Medium |

#### Recommended Session Plan

| Session | Scope | Description |
|---------|-------|-------------|
| Session 1 | `--scope module-1,module-2` | Host 기반 + DXGI 캡처 |
| Session 2 | `--scope module-3` | 인코더 파이프라인 (핵심, 가장 복잡) |
| Session 3 | `--scope module-4,module-5` | WebRTC + FastAPI 서버 통합 |
| Session 4 | `--scope module-6` | React 웹 클라이언트 전체 |
| Session 5 | Check + Report | Gap 분석 + 완료 보고서 |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-04-03 | Initial draft — Option C Pragmatic architecture | choi3 |
