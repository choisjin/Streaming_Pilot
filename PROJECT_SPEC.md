# Ideality Remote Desktop — 프로젝트 설계 문서

## 1. 프로젝트 개요

**ideality.kr** 도메인에서 접속하여 원격 PC의 데스크톱 또는 특정 프로세스를 스트리밍하고, 브라우저에서 직접 조작할 수 있는 웹 기반 원격 제어 시스템.

- 입력은 **Arduino Leonardo**(USB HID)를 경유하여 물리 키보드/마우스로 인식되도록 처리
- 게임 안티치트(XIGNCODE, GameGuard 등) 환경에서도 안전하게 동작
- 원격 PC에는 호스트 에이전트만 설치, 클라이언트는 웹 브라우저만 필요

---

## 2. 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                    원격 PC (Host)                         │
│                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────┐ │
│  │ Screen Capture│───▶│  H.264/H.265 │───▶│  WebRTC    │ │
│  │ (DXGI / Win  │    │  HW Encoder  │    │  Server    │─┼──▶ 인터넷
│  │  Capture API)│    │  (NVENC/AMF) │    │            │ │
│  └──────────────┘    └──────────────┘    └────────────┘ │
│                                                          │
│  ┌──────────────┐    ┌──────────────┐                   │
│  │  WebSocket   │◀───│  Serial Comm │◀── Arduino Leonardo│
│  │  Input Recv  │    │  (pyserial)  │    (USB HID)      │
│  └──────────────┘    └──────────────┘                   │
│                                                          │
│  ┌──────────────┐                                       │
│  │ Process List │  ← 실행중인 프로세스 목록 제공 API       │
│  │ Manager      │                                       │
│  └──────────────┘                                       │
└─────────────────────────────────────────────────────────┘
                          │
                          │ WebRTC (영상) + WebSocket (입력/제어)
                          ▼
┌─────────────────────────────────────────────────────────┐
│              클라이언트 (https://ideality.kr)              │
│                                                          │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐           │
│  │ 스트림1 │ │ 스트림2 │ │ 스트림3 │ │ 스트림4 │  ← 최대 4개 │
│  │(전체화면)│ │(프로세스)│ │(프로세스)│ │(프로세스)│           │
│  └────────┘ └────────┘ └────────┘ └────────┘           │
│       ↕ 크기 자유 조절 (드래그 리사이즈)                    │
│                                                          │
│  각 패널 클릭/터치/키보드 → 해당 스트림의 프로세스로 입력 전달 │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 기술 스택

### 3.1 호스트 에이전트 (원격 PC, Windows)

| 구성 요소 | 기술 | 비고 |
|-----------|------|------|
| 언어 | Python 3.11+ | |
| 화면 캡처 | DXGI Desktop Duplication (전체화면), Windows Graphics Capture API (개별 창) | `d3dshot`, `mss`, 또는 직접 Win32 API |
| 영상 인코딩 | FFmpeg (NVENC H.264) | `subprocess` 또는 `PyAV` |
| WebRTC 서버 | `aiortc` | Python WebRTC 라이브러리 |
| WebSocket 서버 | `websockets` 또는 `FastAPI WebSocket` | 입력 수신 + 제어 명령 |
| HTTP API 서버 | `FastAPI` | 프로세스 목록, 스트림 관리 |
| 시리얼 통신 | `pyserial` | Arduino Leonardo 통신 |
| 프로세스 관리 | `psutil`, `win32gui`, `win32process` | 실행중 프로세스 목록 + 윈도우 핸들 |

### 3.2 웹 클라이언트 (브라우저)

| 구성 요소 | 기술 | 비고 |
|-----------|------|------|
| 프레임워크 | React + TypeScript | Vite 빌드 |
| 스트리밍 수신 | 브라우저 내장 WebRTC API | 하드웨어 디코딩 자동 |
| 입력 전송 | WebSocket | 마우스/키보드/터치 이벤트 |
| 레이아웃 | CSS Grid + 드래그 리사이즈 | `react-grid-layout` 또는 커스텀 |
| 상태 관리 | Zustand 또는 React Context | |
| HTTPS | Let's Encrypt (ideality.kr) | WebRTC에 HTTPS 필수 |

### 3.3 Arduino Leonardo

| 구성 요소 | 기술 | 비고 |
|-----------|------|------|
| 펌웨어 | Arduino IDE (C++) | |
| 라이브러리 | `Keyboard.h`, `Mouse.h` | Arduino 내장 HID 라이브러리 |
| 통신 | Serial (115200 baud) | USB CDC over Serial |

---

## 4. 핵심 기능 상세

### 4.1 스트림 모드 (2가지)

#### A. 전체 데스크톱 모드
- DXGI Desktop Duplication으로 화면 전체 캡처
- 해상도: 원본 해상도 또는 지정 해상도로 다운스케일
- 마우스 좌표: 브라우저의 상대좌표 → 원격 PC의 절대좌표로 변환

#### B. 프로세스 선택 모드
- 실행중인 프로세스 목록을 API로 조회 (윈도우가 있는 프로세스만 필터)
- 선택한 프로세스의 윈도우를 **Windows Graphics Capture API** 또는 **BitBlt**로 개별 캡처
- 각 프로세스 스트림은 독립적인 WebRTC 트랙으로 전송
- 마우스 좌표: 브라우저의 상대좌표 → 해당 윈도우의 클라이언트 영역 좌표로 변환

### 4.2 멀티 스트림 (최대 4개)

- 동시에 최대 4개의 스트림 패널을 브라우저에서 표시
- 각 패널은 독립적으로:
  - 전체 데스크톱 또는 특정 프로세스를 선택 가능
  - 드래그로 크기 조절 가능 (자유 리사이즈)
  - 드래그로 위치 이동 가능
  - 최소화/최대화/닫기 가능
- 레이아웃 프리셋 제공: 1x1, 2x2, 1+3 등

### 4.3 입력 시스템

#### 입력 흐름
```
브라우저 이벤트 (click, mousemove, keydown, keyup, wheel, touch)
    ↓
좌표 변환 (브라우저 상대좌표 → 타겟 윈도우/데스크톱 절대좌표)
    ↓
WebSocket 전송 (JSON 메시지)
    ↓
호스트 에이전트 수신
    ↓
Arduino Serial 명령 변환 및 전송
    ↓
Arduino Leonardo가 USB HID로 PC에 입력
```

#### 입력 메시지 포맷 (WebSocket JSON)
```json
// 마우스 이동 (절대 좌표)
{"type": "mouse_move", "stream_id": 1, "x": 500, "y": 300}

// 마우스 클릭
{"type": "mouse_click", "stream_id": 2, "button": "left", "action": "down", "x": 500, "y": 300}

// 키보드
{"type": "key", "stream_id": 1, "key": "a", "action": "down"}

// 마우스 휠
{"type": "mouse_wheel", "stream_id": 1, "delta": -120}
```

#### Arduino Serial 프로토콜
```
명령 형식: <TYPE>,<PARAM1>,<PARAM2>,...\n

마우스 절대 이동:  MA,<x>,<y>          (절대 좌표, 스크린 해상도 기준)
마우스 상대 이동:  MR,<dx>,<dy>        (상대 이동)
마우스 클릭:      MC,<button>,<action>  (button: L/R/M, action: D/U/C)
마우스 휠:        MW,<delta>
키 입력:          KP,<keycode>         (press)
키 해제:          KR,<keycode>         (release)
키 타이핑:        KT,<char>            (press + release)
```

> **참고**: Arduino Leonardo의 Mouse.h는 상대 좌표만 지원함.
> 절대 좌표 이동은 "현재 위치에서 목표까지의 차이"를 계산하여 상대 이동으로 변환하거나,
> `AbsoluteMouse` 라이브러리를 사용하여 절대 좌표를 직접 지원.
> **권장: `HID-Project` 라이브러리의 `AbsoluteMouse` 사용**

### 4.4 프로세스 관리 API

```
GET  /api/processes          → 실행중인 프로세스 목록 (윈도우가 있는 것만)
GET  /api/streams            → 현재 활성 스트림 목록
POST /api/streams            → 새 스트림 생성 (전체화면 또는 프로세스 지정)
DELETE /api/streams/{id}     → 스트림 종료
GET  /api/system/info        → 시스템 정보 (해상도, GPU, CPU 사용률)
GET  /api/arduino/status     → Arduino 연결 상태
```

---

## 5. 포커스 및 좌표 전환 로직

### 5.1 입력 타겟팅
- 사용자가 브라우저에서 특정 패널을 클릭/터치하면 해당 패널이 **활성 패널**이 됨
- 활성 패널에 연결된 프로세스(또는 전체 데스크톱)가 입력 타겟
- 프로세스 모드일 때:
  1. 해당 프로세스 윈도우를 포그라운드로 활성화 (`SetForegroundWindow`)
  2. 브라우저 좌표를 해당 윈도우의 클라이언트 좌표로 변환
  3. Arduino로 변환된 좌표에 마우스 이동 + 클릭 전송

### 5.2 좌표 변환 공식
```
# 브라우저 패널 내 상대 좌표 → 타겟 윈도우 절대 좌표

scale_x = target_window_width / panel_display_width
scale_y = target_window_height / panel_display_height

target_x = target_window_left + (browser_x * scale_x)
target_y = target_window_top + (browser_y * scale_y)
```

---

## 6. 보안 및 인증

- **HTTPS 필수**: WebRTC는 Secure Context에서만 동작
- **인증**: 접속 시 비밀번호 기반 인증 (JWT 토큰)
- **접속 제한**: 동시 접속 1명 (단일 사용자 시스템)
- **CORS**: ideality.kr 도메인만 허용
- **WebSocket 인증**: 연결 시 JWT 토큰 검증

---

## 7. 디렉토리 구조

```
ideality-remote/
├── host/                          # 호스트 에이전트 (원격 PC에 설치)
│   ├── main.py                    # 진입점, FastAPI + WebSocket + WebRTC 서버
│   ├── capture/
│   │   ├── __init__.py
│   │   ├── desktop.py             # DXGI 전체 데스크톱 캡처
│   │   └── window.py              # 개별 윈도우 캡처 (Graphics Capture API)
│   ├── encoder/
│   │   ├── __init__.py
│   │   └── hw_encoder.py          # FFmpeg/PyAV 하드웨어 인코딩
│   ├── streaming/
│   │   ├── __init__.py
│   │   ├── webrtc.py              # aiortc 기반 WebRTC 관리
│   │   └── signaling.py           # WebRTC 시그널링 (offer/answer/ICE)
│   ├── input/
│   │   ├── __init__.py
│   │   ├── input_handler.py       # 입력 메시지 파싱 및 라우팅
│   │   ├── arduino_serial.py      # Arduino Serial 통신
│   │   └── coordinate.py          # 좌표 변환 로직
│   ├── process/
│   │   ├── __init__.py
│   │   └── manager.py             # 프로세스 목록, 윈도우 핸들 관리
│   ├── auth/
│   │   ├── __init__.py
│   │   └── jwt_auth.py            # JWT 인증
│   ├── config.py                  # 설정 (포트, 해상도, Arduino COM 포트 등)
│   └── requirements.txt
│
├── web/                           # 웹 클라이언트
│   ├── src/
│   │   ├── App.tsx                # 메인 앱
│   │   ├── components/
│   │   │   ├── StreamPanel.tsx    # 개별 스트림 패널 (영상 + 입력 캡처)
│   │   │   ├── PanelGrid.tsx     # 멀티 패널 레이아웃 (리사이즈/이동)
│   │   │   ├── ProcessList.tsx   # 프로세스 선택 UI
│   │   │   ├── Toolbar.tsx       # 상단 툴바 (스트림 추가/레이아웃 등)
│   │   │   └── LoginPage.tsx     # 인증 페이지
│   │   ├── hooks/
│   │   │   ├── useWebRTC.ts      # WebRTC 연결 관리
│   │   │   ├── useInputCapture.ts # 마우스/키보드 이벤트 캡처 및 전송
│   │   │   └── useWebSocket.ts   # WebSocket 연결 관리
│   │   ├── utils/
│   │   │   ├── coordinate.ts     # 좌표 변환 유틸
│   │   │   └── auth.ts           # JWT 토큰 관리
│   │   └── types/
│   │       └── index.ts          # 타입 정의
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── arduino/                       # Arduino Leonardo 펌웨어
│   └── hid_bridge/
│       └── hid_bridge.ino         # Serial → HID 변환 펌웨어
│
├── deploy/                        # 배포 설정
│   ├── nginx.conf                 # Nginx 리버스 프록시 (ideality.kr)
│   ├── certbot.sh                 # Let's Encrypt SSL 인증서
│   └── systemd/
│       └── ideality-host.service  # 호스트 에이전트 systemd 서비스
│
└── README.md
```

---

## 8. 구현 순서 (단계별)

### Phase 1: 기본 스트리밍 (MVP)
1. 호스트: FastAPI 서버 기본 구조 세팅
2. 호스트: DXGI 전체 화면 캡처 구현
3. 호스트: aiortc WebRTC 스트리밍 구현
4. 웹: React 앱 기본 구조 + 단일 WebRTC 영상 수신/표시
5. 동작 확인: 브라우저에서 원격 PC 화면이 보이는 것까지

### Phase 2: 입력 시스템
6. Arduino: Serial → HID 펌웨어 작성 및 업로드
7. 호스트: pyserial Arduino 통신 모듈 구현
8. 호스트: WebSocket 입력 수신 → Arduino 전달 파이프라인
9. 웹: 마우스/키보드 이벤트 캡처 → WebSocket 전송
10. 동작 확인: 브라우저에서 클릭하면 원격 PC에서 클릭되는 것까지

### Phase 3: 프로세스 선택 + 멀티 스트림
11. 호스트: psutil + win32gui로 프로세스 목록 API
12. 호스트: 개별 윈도우 캡처 구현 (Windows Graphics Capture API)
13. 호스트: 멀티 스트림 관리 (최대 4개 WebRTC 트랙)
14. 웹: 프로세스 선택 UI
15. 웹: 멀티 패널 레이아웃 (리사이즈, 이동)
16. 웹: 패널별 입력 타겟팅 + 좌표 변환

### Phase 4: 보안 + 배포
17. JWT 인증 구현
18. Nginx 리버스 프록시 + HTTPS (Let's Encrypt)
19. ideality.kr 도메인 DNS 설정
20. systemd 서비스 등록 (자동 시작)

### Phase 5: 최적화 + 편의 기능
21. 적응형 비트레이트 (네트워크 상태에 따라 품질 조절)
22. 레이아웃 프리셋 (1x1, 2x2, 1+3)
23. 전체화면 모드
24. 키보드 단축키 (패널 전환 등)
25. 연결 끊김 시 자동 재연결

---

## 9. 주요 설정 값 (config)

```python
# host/config.py

HOST_CONFIG = {
    # 서버
    "host": "0.0.0.0",
    "port": 8080,
    "domain": "ideality.kr",

    # 영상
    "capture_fps": 60,
    "encoder": "h264_nvenc",        # h264_nvenc | h264_amf | libx264
    "bitrate": "6M",
    "resolution": "1920x1080",      # 원본 또는 다운스케일
    "max_streams": 4,

    # Arduino
    "arduino_port": "COM3",         # Arduino Leonardo 시리얼 포트
    "arduino_baud": 115200,

    # 인증
    "jwt_secret": "CHANGE_THIS_SECRET",
    "password": "CHANGE_THIS_PASSWORD",

    # WebRTC
    "stun_servers": ["stun:stun.l.google.com:19302"],
    "turn_server": None,            # 필요시 TURN 서버 설정
}
```

---

## 10. 핵심 주의사항

### 10.1 Arduino Leonardo 제약
- `Mouse.h`는 상대 좌표만 지원 → `HID-Project` 라이브러리의 `AbsoluteMouse` 사용 권장
- Serial 버퍼 오버플로우 방지: 명령 길이 제한, 적절한 전송 간격
- 마우스 이동이 너무 빈번하면 throttle 필요 (10~16ms 간격)

### 10.2 WebRTC 관련
- 같은 LAN이면 STUN만으로 충분, 외부 접속 시 TURN 서버 필요할 수 있음
- aiortc는 하드웨어 인코딩을 직접 지원하지 않음 → FFmpeg으로 인코딩 후 프레임을 aiortc에 전달하는 방식 필요
- 또는 GStreamer + webrtcbin 조합 고려

### 10.3 윈도우 캡처 관련
- Windows Graphics Capture API는 Windows 10 1903+ 필요
- 일부 보안 프로그램(DRM 등)이 적용된 윈도우는 검은 화면으로 캡처될 수 있음 (넷플릭스 등)
- 게임은 Fullscreen Exclusive 모드일 때 개별 윈도우 캡처가 안 될 수 있음 → Borderless Windowed 권장

### 10.4 좌표 계산
- 멀티 모니터 환경에서는 가상 데스크톱 좌표계 고려 필요
- DPI 스케일링 (100%, 125%, 150%) 보정 필요
- Arduino 절대좌표 범위 (0~32767)와 실제 해상도 매핑 필요

### 10.5 네트워크
- 호스트 PC에서 외부 접속을 받으려면 포트포워딩 또는 VPN 필요
- Cloudflare Tunnel 등을 사용하면 포트포워딩 없이 외부 접속 가능
- WebRTC 미디어 스트림은 P2P이므로 별도 대역폭 고려

---

## 11. 확장 고려사항 (향후)

- 오디오 스트리밍 (WebRTC AudioTrack 추가)
- 클립보드 공유
- 파일 전송
- 모바일 터치 제스처 지원 (핀치 줌, 스와이프)
- 녹화 기능
- 멀티 유저 접속 (관전 모드)
