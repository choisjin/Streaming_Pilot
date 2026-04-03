export interface StreamSettings {
  fps: number
  bitrate: string
  resolution: string
  adaptive: boolean
  encoder: string
}

export interface SystemInfo {
  resolution: string
  gpu: string
  cpuUsage: number
  encoderActive: string
  fpsActual: number
  bitrateActual: string
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'failed'

export interface ConnectionState {
  status: ConnectionStatus
  error?: string
}

export interface WebRTCStats {
  fps: number
  bitrate: number
  latency: number
  packetsLost: number
}

export interface ProcessInfo {
  hwnd: number
  title: string
  pid: number
  processName: string
  width: number
  height: number
}

export interface StreamInfo {
  streamId: number
  type: 'desktop' | 'window'
  hwnd?: number
  title: string
  active: boolean
}
