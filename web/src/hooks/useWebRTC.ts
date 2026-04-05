// WebRTC 연결 관리 — streamId별 독립 연결 지원
import { useCallback, useRef } from 'react'
import { useStreamStore } from '../stores/streamStore'

const API_BASE = ''
const MAX_RETRIES = 5

export function useWebRTC(streamId: number) {
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const statsInterval = useRef<ReturnType<typeof setInterval>>()
  const connectingRef = useRef(false)
  const retryCountRef = useRef(0)

  const cleanup = useCallback(() => {
    if (statsInterval.current) {
      clearInterval(statsInterval.current)
      statsInterval.current = undefined
    }
    if (pcRef.current) {
      pcRef.current.ontrack = null
      pcRef.current.onconnectionstatechange = null
      pcRef.current.onicecandidate = null
      pcRef.current.close()
      pcRef.current = null
    }
    connectingRef.current = false
  }, [])

  const connect = useCallback(async () => {
    if (connectingRef.current) return
    if (pcRef.current && pcRef.current.connectionState === 'connected') return
    connectingRef.current = true
    cleanup()

    useStreamStore.getState().updatePanelConnection(streamId, { status: 'connecting', error: undefined })

    try {
      // STUN only — Tailscale handles P2P connectivity
      const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
      const pc = new RTCPeerConnection({ iceServers })
      pcRef.current = pc

      pc.addTransceiver('video', { direction: 'recvonly' })

      pc.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track])
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
        // Track-level event handlers for detecting dead streams
        const track = event.track
        track.onended = () => {
          console.warn('Video track ended, triggering reconnect')
          scheduleReconnect()
        }
        track.onmute = () => {
          console.warn('Video track muted')
        }
      }

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState
        if (state === 'connected') {
          useStreamStore.getState().updatePanelConnection(streamId, { status: 'connected' })
          connectingRef.current = false
          retryCountRef.current = 0
          startStatsPolling(pc)
        } else if (state === 'failed' || state === 'disconnected') {
          connectingRef.current = false
          useStreamStore.getState().updatePanelConnection(streamId, { status: 'failed', error: 'Connection lost' })
          scheduleReconnect()
        }
      }

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      // Wait for ICE gathering
      if (pc.iceGatheringState !== 'complete') {
        await new Promise<void>((resolve) => {
          const check = () => {
            if (pc.iceGatheringState === 'complete') {
              pc.removeEventListener('icegatheringstatechange', check)
              resolve()
            }
          }
          pc.addEventListener('icegatheringstatechange', check)
          setTimeout(resolve, 2000)
        })
      }

      const res = await fetch(`${API_BASE}/api/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sdp: pc.localDescription!.sdp,
          type: pc.localDescription!.type,
          streamId,
        }),
      })

      if (!res.ok) throw new Error(`Server error: ${res.status}`)

      const answer = await res.json()
      await pc.setRemoteDescription(new RTCSessionDescription({ sdp: answer.sdp, type: answer.type }))
    } catch (e) {
      connectingRef.current = false
      const msg = e instanceof Error ? e.message : 'Connection failed'
      useStreamStore.getState().updatePanelConnection(streamId, { status: 'failed', error: msg })
      scheduleReconnect()
    }
  }, [streamId, cleanup])

  const scheduleReconnect = useCallback(() => {
    if (retryCountRef.current >= MAX_RETRIES) {
      useStreamStore.getState().updatePanelConnection(streamId, {
        status: 'failed',
        error: `Max retries (${MAX_RETRIES}) reached`,
      })
      return
    }
    const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000)
    retryCountRef.current += 1
    console.log(`WebRTC reconnect #${retryCountRef.current} in ${delay}ms`)
    setTimeout(() => connect(), delay)
  }, [streamId, connect])

  const disconnect = useCallback(() => {
    retryCountRef.current = MAX_RETRIES // Prevent auto-reconnect
    cleanup()
    useStreamStore.getState().updatePanelConnection(streamId, { status: 'disconnected' })
  }, [streamId, cleanup])

  const startStatsPolling = useCallback((pc: RTCPeerConnection) => {
    if (statsInterval.current) clearInterval(statsInterval.current)
    let prevBytes = 0, prevTs = 0
    let zeroFpsCount = 0
    let hadFirstFrame = false

    statsInterval.current = setInterval(async () => {
      if (pc.connectionState !== 'connected') return
      try {
        const stats = await pc.getStats()
        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            const cur = report.bytesReceived ?? 0
            const fps = report.framesPerSecond ?? 0

            if (prevTs > 0) {
              const dt = (report.timestamp - prevTs) / 1000
              const bitrate = ((cur - prevBytes) * 8) / dt
              useStreamStore.getState().updatePanelStats(streamId, {
                fps,
                bitrate: Math.round(bitrate / 1000),
                packetsLost: report.packetsLost ?? 0,
              })
            }

            // FPS-based health check: detect frozen streams
            if (fps > 0) {
              hadFirstFrame = true
              zeroFpsCount = 0
            } else if (hadFirstFrame) {
              zeroFpsCount += 1
              if (zeroFpsCount >= 5) {
                console.warn('0 FPS for 5s, triggering reconnect')
                zeroFpsCount = 0
                cleanup()
                scheduleReconnect()
              }
            }

            prevBytes = cur
            prevTs = report.timestamp
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            useStreamStore.getState().updatePanelStats(streamId, {
              latency: Math.round((report.currentRoundTripTime ?? 0) * 1000),
            })
          }
        })
      } catch { /* ignore */ }
    }, 1000)
  }, [streamId, cleanup, scheduleReconnect])

  return { videoRef, connect, disconnect }
}
