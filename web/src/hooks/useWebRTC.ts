// WebRTC 연결 관리 — streamId별 독립 연결 지원
import { useCallback, useRef } from 'react'
import { useStreamStore } from '../stores/streamStore'

const API_BASE = ''

export function useWebRTC(streamId: number) {
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const statsInterval = useRef<ReturnType<typeof setInterval>>()
  const connectingRef = useRef(false)

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
      // Fetch TURN credentials from server
      let iceServers: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }]
      try {
        const turnRes = await fetch(`${API_BASE}/api/turn/credentials`)
        if (turnRes.ok) {
          const turnData = await turnRes.json()
          if (turnData.iceServers) {
            iceServers = turnData.iceServers
          }
        }
      } catch { /* fallback to STUN only */ }

      const pc = new RTCPeerConnection({ iceServers })
      pcRef.current = pc

      pc.addTransceiver('video', { direction: 'recvonly' })

      pc.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track])
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
      }

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState
        if (state === 'connected') {
          useStreamStore.getState().updatePanelConnection(streamId, { status: 'connected' })
          connectingRef.current = false
          startStatsPolling(pc)
        } else if (state === 'failed') {
          connectingRef.current = false
          useStreamStore.getState().updatePanelConnection(streamId, { status: 'failed', error: 'Connection failed' })
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
    }
  }, [streamId, cleanup])

  const disconnect = useCallback(() => {
    cleanup()
    useStreamStore.getState().updatePanelConnection(streamId, { status: 'disconnected' })
  }, [streamId, cleanup])

  const startStatsPolling = useCallback((pc: RTCPeerConnection) => {
    if (statsInterval.current) clearInterval(statsInterval.current)
    let prevBytes = 0, prevTs = 0

    statsInterval.current = setInterval(async () => {
      if (pc.connectionState !== 'connected') return
      try {
        const stats = await pc.getStats()
        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            if (prevTs > 0) {
              const dt = (report.timestamp - prevTs) / 1000
              const bitrate = ((report.bytesReceived - prevBytes) * 8) / dt
              useStreamStore.getState().updatePanelStats(streamId, {
                fps: report.framesPerSecond ?? 0,
                bitrate: Math.round(bitrate / 1000),
                packetsLost: report.packetsLost ?? 0,
              })
            }
            prevBytes = report.bytesReceived ?? 0
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
  }, [streamId])

  return { videoRef, connect, disconnect }
}
