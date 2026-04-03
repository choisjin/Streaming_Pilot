# Streaming MVP Planning Document

> **Summary**: 브라우저에서 원격 PC 전체 화면을 WebRTC로 실시간 스트리밍하는 MVP
>
> **Project**: Ideality Remote Desktop
> **Author**: choi3
> **Date**: 2026-04-03
> **Status**: Draft

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | 원격 PC의 데스크톱 화면을 브라우저에서 실시간으로 확인할 수 없음. 기존 원격 데스크톱 솔루션(RDP, TeamViewer 등)은 안티치트 환경에서 감지되거나 별도 클라이언트 설치가 필요함 |
| **Solution** | DXGI Desktop Duplication으로 화면을 캡처하고, NVENC H.264로 하드웨어 인코딩 후, aiortc WebRTC를 통해 브라우저로 P2P 스트리밍 |
| **Function/UX Effect** | 브라우저 접속만으로 원격 PC 화면을 저지연으로 시청 가능. 적응형 비트레이트와 수동 조절로 네트워크 상황에 맞는 품질 제어 |
| **Core Value** | 설치 없는 웹 기반 원격 화면 스트리밍 — 안티치트 환경에서도 안전한 원격 모니터링의 기반 구축 |

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 안티치트 환경에서도 동작하는 웹 기반 원격 데스크톱 시스템의 핵심 기능(영상 스트리밍) 구현 |
| **WHO** | 원격 PC를 브라우저로 모니터링/제어하려는 개인 사용자 (단일 사용자 시스템) |
| **RISK** | aiortc의 하드웨어 인코딩 미지원으로 인한 인코딩 파이프라인 복잡도 증가 |
| **SUCCESS** | 브라우저에서 원격 PC 전체 화면이 60fps/1080p로 표시되며, 지연 시간 200ms 이하 |
| **SCOPE** | Phase 1 MVP: 화면 캡처 → 인코딩 → WebRTC 전송 → 브라우저 수신/표시 (단일 스트림) |

---

## 1. Overview

### 1.1 Purpose

ideality.kr 도메인에서 접속하여 원격 PC의 전체 데스크톱 화면을 실시간으로 스트리밍하는 MVP를 구현한다. 이후 Phase에서 추가될 입력 시스템, 멀티 스트림, 인증의 기반이 되는 핵심 영상 파이프라인을 확립한다.

### 1.2 Background

- 게임 안티치트(XIGNCODE, GameGuard 등) 환경에서 기존 원격 솔루션(RDP, TeamViewer)은 감지/차단될 수 있음
- Arduino Leonardo USB HID를 통한 물리 입력이 필요하지만, 그 전에 먼저 화면 스트리밍이 동작해야 함
- 호스트 PC: ASUS TUF Gaming A17 (Ryzen 7 6800H, RTX 3070 Laptop 8GB, 32GB RAM, Windows)

### 1.3 Related Documents

- Requirements: `PROJECT_SPEC.md` (Phase 1: 기본 스트리밍 MVP)
- 호스트 에이전트: Python 3.11+ (FastAPI + aiortc)
- 웹 클라이언트: React + TypeScript (Vite)

---

## 2. Scope

### 2.1 In Scope

- [x] FastAPI HTTP 서버 기본 구조 세팅
- [x] DXGI Desktop Duplication 전체 화면 캡처 모듈
- [x] FFmpeg NVENC H.264 하드웨어 인코딩 파이프라인
- [x] aiortc 기반 WebRTC 스트리밍 (시그널링 + 미디어 전송)
- [x] React + Vite 웹 클라이언트 (WebRTC 영상 수신 및 표시)
- [x] 적응형 비트레이트 기본 지원 + 수동 품질 조절 UI
- [x] 시스템 정보 API (해상도, GPU, CPU 사용률)

### 2.2 Out of Scope

- 입력 시스템 (키보드/마우스 → Arduino) — Phase 2
- 프로세스 선택 모드 / 개별 윈도우 캡처 — Phase 3
- 멀티 스트림 (최대 4개 패널) — Phase 3
- JWT 인증 / 비밀번호 보호 — Phase 4
- HTTPS / Nginx / 도메인 배포 — Phase 4
- 오디오 스트리밍 — 향후 확장
- 클립보드 공유 / 파일 전송 — 향후 확장

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | DXGI Desktop Duplication으로 호스트 PC 전체 화면을 캡처한다 | High | Pending |
| FR-02 | FFmpeg NVENC (H.264)으로 캡처된 프레임을 실시간 하드웨어 인코딩한다 | High | Pending |
| FR-03 | aiortc WebRTC를 통해 인코딩된 영상을 브라우저로 P2P 전송한다 | High | Pending |
| FR-04 | WebRTC 시그널링 (offer/answer/ICE candidate) API를 제공한다 | High | Pending |
| FR-05 | 브라우저에서 WebRTC 영상을 수신하여 `<video>` 엘리먼트에 표시한다 | High | Pending |
| FR-06 | FPS, 비트레이트, 해상도를 수동으로 조절할 수 있는 설정 UI를 제공한다 | Medium | Pending |
| FR-07 | 네트워크 상태에 따라 비트레이트/FPS를 자동 조절하는 적응형 모드를 지원한다 | Medium | Pending |
| FR-08 | 시스템 정보 API (해상도, GPU, CPU 사용률)를 제공한다 | Low | Pending |
| FR-09 | NVENC 사용 불가 시 소프트웨어 인코딩(libx264)으로 자동 폴백한다 | Medium | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Performance | 영상 지연시간 200ms 이하 (LAN 환경) | Chrome WebRTC Internals |
| Performance | 캡처 + 인코딩 60fps 유지 (1080p, NVENC) | 호스트 에이전트 로그 |
| Performance | CPU 사용률 30% 이하 (하드웨어 인코딩 시) | psutil 모니터링 |
| Compatibility | Chrome, Edge, Firefox 최신 버전 지원 | 수동 테스트 |
| Reliability | WebRTC 연결 끊김 시 자동 재연결 시도 | 네트워크 단절 시뮬레이션 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] 호스트 에이전트 실행 시 FastAPI 서버가 기동되고, DXGI 화면 캡처가 시작됨
- [ ] 브라우저에서 WebRTC 연결이 수립되고, 원격 PC 전체 화면이 실시간으로 표시됨
- [ ] 60fps / 1080p / 6Mbps 기본 설정에서 안정적으로 스트리밍됨 (LAN 환경)
- [ ] 수동 품질 조절 (FPS, 비트레이트, 해상도)이 실시간 반영됨
- [ ] 적응형 모드에서 네트워크 상태에 따라 품질이 자동 조절됨
- [ ] NVENC 사용 불가 시 libx264로 자동 폴백됨

### 4.2 Quality Criteria

- [ ] Python 호스트: mypy 타입 에러 없음
- [ ] React 클라이언트: TypeScript strict 모드 에러 없음
- [ ] 주요 모듈(capture, encoder, webrtc) 단위 테스트 존재

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| aiortc가 NVENC 하드웨어 인코딩을 직접 지원하지 않음 | High | High | FFmpeg subprocess로 인코딩 후 프레임을 aiortc에 전달하는 파이프라인 구성. 또는 PyAV를 통한 중간 레이어 |
| DXGI Desktop Duplication이 관리자 권한 요구 가능 | Medium | Medium | 호스트 에이전트를 관리자 권한으로 실행하도록 안내. UAC 프롬프트 처리 |
| WebRTC P2P 연결 실패 (NAT/방화벽) | High | Low | LAN 환경에서는 STUN으로 충분. 외부 접속 시 TURN 서버 또는 Cloudflare Tunnel 고려 (Phase 4) |
| 노트북 GPU 열 관리 (RTX 3070 Laptop) | Medium | Medium | NVENC 전용 인코더 사용으로 GPU 코어 부하 최소화. 적응형 비트레이트로 부하 조절 |
| Python GIL로 인한 캡처/인코딩/WebRTC 병목 | Medium | Medium | asyncio 기반 비동기 처리. CPU-bound 작업(캡처, 인코딩)은 별도 스레드/프로세스 |
| 캡처 프레임과 인코딩 프레임 간 동기화 문제 | Medium | Medium | 프레임 큐(Queue) 기반 생산자-소비자 패턴으로 버퍼링 |

---

## 6. Impact Analysis

### 6.1 Changed Resources

| Resource | Type | Change Description |
|----------|------|--------------------|
| host/ 디렉토리 전체 | New Directory | Python 호스트 에이전트 전체 구조 신규 생성 |
| web/ 디렉토리 전체 | New Directory | React 웹 클라이언트 전체 구조 신규 생성 |

### 6.2 Current Consumers

신규 프로젝트이므로 기존 소비자 없음. venv만 존재.

### 6.3 Verification

- [x] 신규 프로젝트이므로 기존 코드 영향 없음

---

## 7. Architecture Considerations

### 7.1 Project Level Selection

| Level | Characteristics | Recommended For | Selected |
|-------|-----------------|-----------------|:--------:|
| **Starter** | Simple structure | Static sites, portfolios | ☐ |
| **Dynamic** | Feature-based modules, BaaS integration | Web apps with backend, fullstack apps | ☑ |
| **Enterprise** | Strict layer separation, DI, microservices | High-traffic systems | ☐ |

> Dynamic 레벨 선정 이유: 프론트엔드(React) + 백엔드(Python FastAPI) 풀스택 구성이지만,
> 단일 사용자 시스템으로 마이크로서비스 수준의 복잡도는 불필요.

### 7.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| 호스트 언어 | Python / C++ / Rust | Python 3.11+ | PROJECT_SPEC 지정. aiortc, pyserial 등 풍부한 라이브러리 |
| HTTP 프레임워크 | FastAPI / Flask / aiohttp | FastAPI | 비동기 지원, 자동 API 문서, WebSocket 내장 |
| 화면 캡처 | DXGI / mss / d3dshot | DXGI (직접 Win32 API) | 최저 지연, GPU 메모리 직접 접근, 60fps 안정 |
| 영상 인코딩 | PyAV / FFmpeg subprocess | PyAV (FFmpeg 바인딩) | Python 내에서 직접 프레임 처리 가능, subprocess 오버헤드 없음 |
| WebRTC | aiortc / GStreamer+webrtcbin | aiortc | Python 네이티브, FastAPI와 자연스러운 통합 |
| 프론트엔드 | React+Vite / Next.js / Vue | React + Vite + TypeScript | PROJECT_SPEC 지정. 빌드 속도, 단순한 SPA |
| 상태 관리 | Zustand / React Context / Redux | Zustand | 경량, 보일러플레이트 적음, 스트리밍 상태에 적합 |
| 스타일링 | Tailwind / CSS Modules | Tailwind CSS | 빠른 프로토타이핑, 유틸리티 기반 |

### 7.3 Clean Architecture Approach

```
Selected Level: Dynamic

Host Agent (Python):
┌─────────────────────────────────────────────┐
│ host/                                        │
│   main.py                   ← FastAPI 진입점 │
│   config.py                 ← 설정 관리      │
│   capture/                                   │
│     desktop.py              ← DXGI 캡처      │
│   encoder/                                   │
│     hw_encoder.py           ← NVENC/libx264  │
│   streaming/                                 │
│     webrtc.py               ← aiortc 관리    │
│     signaling.py            ← 시그널링 API    │
│   requirements.txt                           │
└─────────────────────────────────────────────┘

Web Client (React + TypeScript):
┌─────────────────────────────────────────────┐
│ web/                                         │
│   src/                                       │
│     App.tsx                 ← 메인 앱        │
│     components/                              │
│       StreamViewer.tsx      ← 영상 표시      │
│       SettingsPanel.tsx     ← 품질 조절 UI   │
│     hooks/                                   │
│       useWebRTC.ts          ← WebRTC 연결    │
│     stores/                                  │
│       streamStore.ts        ← Zustand 상태   │
│     types/                                   │
│       index.ts              ← 타입 정의      │
│   index.html                                 │
│   package.json                               │
│   vite.config.ts                             │
└─────────────────────────────────────────────┘
```

---

## 8. Convention Prerequisites

### 8.1 Existing Project Conventions

- [ ] `CLAUDE.md` has coding conventions section
- [ ] `docs/01-plan/conventions.md` exists
- [ ] ESLint configuration (`.eslintrc.*`)
- [ ] Prettier configuration (`.prettierrc`)
- [ ] TypeScript configuration (`tsconfig.json`)

> 신규 프로젝트로 모든 규칙을 새로 정의해야 함

### 8.2 Conventions to Define/Verify

| Category | Current State | To Define | Priority |
|----------|---------------|-----------|:--------:|
| **Python 코딩 스타일** | Missing | PEP 8, black formatter, type hints | High |
| **TypeScript 코딩 스타일** | Missing | ESLint + Prettier, strict mode | High |
| **폴더 구조** | Missing | PROJECT_SPEC 7장 디렉토리 구조 따름 | High |
| **네이밍 규칙** | Missing | Python: snake_case, TS: camelCase/PascalCase | Medium |
| **에러 처리** | Missing | Python: logging, TS: Error boundaries | Medium |

### 8.3 Environment Variables Needed

| Variable | Purpose | Scope | To Be Created |
|----------|---------|-------|:-------------:|
| `HOST_PORT` | FastAPI 서버 포트 (기본 8080) | Host | ☑ |
| `CAPTURE_FPS` | 캡처 프레임레이트 (기본 60) | Host | ☑ |
| `ENCODER_TYPE` | 인코더 선택 (h264_nvenc / libx264) | Host | ☑ |
| `BITRATE` | 영상 비트레이트 (기본 6M) | Host | ☑ |
| `RESOLUTION` | 출력 해상도 (기본 1920x1080) | Host | ☑ |
| `STUN_SERVER` | STUN 서버 주소 | Host | ☑ |
| `VITE_WS_URL` | WebSocket 서버 주소 | Client | ☑ |

---

## 9. Data Flow Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Host Agent                                │
│                                                                  │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌──────────┐     │
│  │  DXGI   │───▶│ Frame   │───▶│ NVENC   │───▶│ aiortc   │──┐  │
│  │ Capture │    │ Queue   │    │ H.264   │    │ WebRTC   │  │  │
│  │ (60fps) │    │ (buffer)│    │ Encoder │    │ Server   │  │  │
│  └─────────┘    └─────────┘    └─────────┘    └──────────┘  │  │
│                                                              │  │
│  ┌──────────────┐    ┌──────────────┐                        │  │
│  │ FastAPI       │    │ Settings     │                        │  │
│  │ /api/offer    │    │ /api/settings│ ← FPS/bitrate/res     │  │
│  │ /api/system   │    │ /api/adaptive│ ← 적응형 모드 제어     │  │
│  └──────────────┘    └──────────────┘                        │  │
└──────────────────────────────────────────────────────────────┼──┘
                                                               │
                          WebRTC P2P (SRTP)                     │
                          STUN: stun.l.google.com:19302         │
                                                               │
┌──────────────────────────────────────────────────────────────┼──┐
│                        Browser Client                        │  │
│                                                              ▼  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ WebRTC API   │───▶│ <video>      │    │ Settings     │      │
│  │ RTCPeer      │    │ StreamViewer │    │ Panel        │      │
│  │ Connection   │    │              │    │ (FPS/bitrate)│      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
└────────────────────────────────────────────────────────────────┘
```

---

## 10. API Design (Preview)

### 10.1 WebRTC Signaling

```
POST /api/offer
  Body: { sdp: string, type: "offer" }
  Response: { sdp: string, type: "answer" }

POST /api/ice-candidate
  Body: { candidate: string, sdpMid: string, sdpMLineIndex: number }
  Response: { status: "ok" }
```

### 10.2 Settings & System

```
GET  /api/system/info
  Response: { resolution, gpu, cpu_usage, encoder, fps, bitrate }

POST /api/settings
  Body: { fps?: number, bitrate?: string, resolution?: string, adaptive?: boolean }
  Response: { status: "ok", applied: { ... } }

GET  /api/settings
  Response: { fps, bitrate, resolution, adaptive, encoder }
```

---

## 11. Dependencies

### 11.1 Host Agent (Python)

```
fastapi>=0.100.0
uvicorn[standard]>=0.23.0
aiortc>=1.6.0
av>=10.0.0              # PyAV - FFmpeg Python bindings
numpy>=1.24.0
psutil>=5.9.0
comtypes>=1.2.0         # DXGI COM interface
```

### 11.2 Web Client (Node.js)

```
react@^18
react-dom@^18
typescript@^5
vite@^5
zustand@^4
tailwindcss@^3
```

---

## 12. Next Steps

1. [ ] Design 문서 작성 (`streaming-mvp.design.md`) — 3가지 아키텍처 옵션 비교
2. [ ] 호스트 에이전트 개발 환경 세팅 (venv + requirements.txt)
3. [ ] 웹 클라이언트 프로젝트 초기화 (Vite + React + TS)
4. [ ] DXGI 화면 캡처 프로토타입
5. [ ] WebRTC 시그널링 + 스트리밍 프로토타입

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-04-03 | Initial draft — Phase 1 MVP Plan | choi3 |
