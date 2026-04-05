// Vibeshine WebRTC 클라이언트 — 영상만 수신, 입력은 별도 Arduino 경로
import { useCallback, useRef } from 'react'
import { useStreamStore } from '../stores/streamStore'

// Vibeshine API 기본 주소 (같은 PC에서 실행)
const VIBE_BASE = 'https://localhost:47990'

interface VibeSession {
  sessionId: string
  iceServers: RTCIceServer[]
}

export function useVibeshine() {
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const candidateStopRef = useRef<(() => void) | null>(null)
  const connectingRef = useRef(false)

  const cleanup = useCallback(() => {
    if (candidateStopRef.current) {
      candidateStopRef.current()
      candidateStopRef.current = null
    }
    if (pcRef.current) {
      pcRef.current.ontrack = null
      pcRef.current.onconnectionstatechange = null
      pcRef.current.onicecandidate = null
      pcRef.current.close()
      pcRef.current = null
    }
    // End Vibeshine session
    if (sessionIdRef.current) {
      fetch(`${VIBE_BASE}/api/webrtc/sessions/${sessionIdRef.current}`, {
        method: 'DELETE',
        keepalive: true,
      }).catch(() => {})
      sessionIdRef.current = null
    }
    connectingRef.current = false
  }, [])

  const connect = useCallback(async (config?: {
    width?: number
    height?: number
    fps?: number
    bitrateKbps?: number
    codec?: string
  }) => {
    if (connectingRef.current) return
    connectingRef.current = true
    cleanup()

    useStreamStore.getState().updatePanelConnection(0, { status: 'connecting', error: undefined })

    try {
      // 1. Create Vibeshine session
      const sessionRes = await fetch(`${VIBE_BASE}/api/webrtc/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio: true,
          video: true,
          encoded: true,
          host_audio: false,
          width: config?.width ?? 1920,
          height: config?.height ?? 1080,
          fps: config?.fps ?? 60,
          bitrate_kbps: config?.bitrateKbps ?? 6000,
          codec: config?.codec ?? 'h264',
        }),
      })

      if (!sessionRes.ok) throw new Error(`Session create failed: ${sessionRes.status}`)
      const sessionData = await sessionRes.json()
      const session: VibeSession = {
        sessionId: sessionData.session.id,
        iceServers: sessionData.ice_servers ?? [],
      }
      sessionIdRef.current = session.sessionId

      // 2. Create RTCPeerConnection
      const pc = new RTCPeerConnection({
        iceServers: session.iceServers,
      })
      pcRef.current = pc

      // Video + Audio transceiver (receive only)
      pc.addTransceiver('video', { direction: 'recvonly' })
      pc.addTransceiver('audio', { direction: 'recvonly' })

      // Do NOT create input data channel — we use our own Arduino path

      // Handle remote tracks
      const remoteStream = new MediaStream()
      pc.ontrack = (event) => {
        const track = event.track
        // Remove existing track of same kind
        for (const existing of remoteStream.getTracks()) {
          if (existing.kind === track.kind) {
            remoteStream.removeTrack(existing)
            existing.stop()
          }
        }
        remoteStream.addTrack(track)
        if (videoRef.current) {
          videoRef.current.srcObject = remoteStream
        }
      }

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState
        if (state === 'connected') {
          useStreamStore.getState().updatePanelConnection(0, { status: 'connected' })
          connectingRef.current = false
        } else if (state === 'failed' || state === 'disconnected') {
          connectingRef.current = false
          useStreamStore.getState().updatePanelConnection(0, { status: 'failed', error: 'Connection lost' })
        }
      }

      // Collect ICE candidates to send to Vibeshine
      const pendingCandidates: RTCIceCandidateInit[] = []
      let candidateTimer: ReturnType<typeof setTimeout> | null = null

      const flushCandidates = async () => {
        if (!pendingCandidates.length || !sessionIdRef.current) return
        const batch = pendingCandidates.splice(0)
        await fetch(`${VIBE_BASE}/api/webrtc/sessions/${sessionIdRef.current}/ice`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            candidates: batch.map(c => ({
              sdpMid: c.sdpMid,
              sdpMLineIndex: c.sdpMLineIndex,
              candidate: c.candidate,
            })),
          }),
        }).catch(() => {})
      }

      pc.onicecandidate = (event) => {
        if (!event.candidate) return
        pendingCandidates.push(event.candidate.toJSON())
        if (candidateTimer) clearTimeout(candidateTimer)
        candidateTimer = setTimeout(flushCandidates, 75)
      }

      // 3. Create offer
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      // 4. Send offer to Vibeshine
      const offerRes = await fetch(`${VIBE_BASE}/api/webrtc/sessions/${session.sessionId}/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sdp: pc.localDescription!.sdp,
          type: pc.localDescription!.type,
        }),
      })

      if (!offerRes.ok) throw new Error(`Offer failed: ${offerRes.status}`)
      const offerData = await offerRes.json()

      // 5. Set remote answer
      let answerSdp = offerData.sdp
      let answerType = offerData.type ?? 'answer'

      // If answer not ready, poll for it
      if (!answerSdp) {
        const start = Date.now()
        while (Date.now() - start < 30000) {
          const ansRes = await fetch(`${VIBE_BASE}/api/webrtc/sessions/${session.sessionId}/answer`)
          if (ansRes.ok) {
            const ansData = await ansRes.json()
            if (ansData.sdp) {
              answerSdp = ansData.sdp
              answerType = ansData.type ?? 'answer'
              break
            }
          }
          await new Promise(r => setTimeout(r, 300))
        }
      }

      if (!answerSdp) throw new Error('No answer received from Vibeshine')
      await pc.setRemoteDescription(new RTCSessionDescription({ sdp: answerSdp, type: answerType }))

      // 6. Subscribe to remote ICE candidates
      let stopped = false
      let lastIndex = 0
      const pollRemoteCandidates = async () => {
        while (!stopped && sessionIdRef.current) {
          try {
            const res = await fetch(
              `${VIBE_BASE}/api/webrtc/sessions/${sessionIdRef.current}/ice?since=${lastIndex}`
            )
            if (res.ok) {
              const data = await res.json()
              if (Array.isArray(data.candidates)) {
                for (const c of data.candidates) {
                  await pc.addIceCandidate(new RTCIceCandidate({
                    sdpMid: c.sdpMid,
                    sdpMLineIndex: c.sdpMLineIndex,
                    candidate: c.candidate,
                  }))
                  if (typeof c.index === 'number') lastIndex = Math.max(lastIndex, c.index)
                }
                if (typeof data.next_since === 'number') lastIndex = Math.max(lastIndex, data.next_since)
              }
            }
          } catch { /* ignore */ }
          await new Promise(r => setTimeout(r, 1000))
        }
      }
      pollRemoteCandidates()
      candidateStopRef.current = () => { stopped = true }

    } catch (e) {
      connectingRef.current = false
      const msg = e instanceof Error ? e.message : 'Vibeshine connection failed'
      useStreamStore.getState().updatePanelConnection(0, { status: 'failed', error: msg })
    }
  }, [cleanup])

  const disconnect = useCallback(() => {
    cleanup()
    useStreamStore.getState().updatePanelConnection(0, { status: 'disconnected' })
  }, [cleanup])

  return { videoRef, connect, disconnect }
}
