import { useCallback, useEffect } from 'react'
import { useWebRTC } from '../hooks/useWebRTC'
import { useInputCapture } from '../hooks/useInputCapture'
import { useStreamStore } from '../stores/streamStore'

interface StreamPanelProps {
  streamId: number
  title: string
  active?: boolean
  onClose?: () => void
}

export default function StreamPanel({ streamId, title, active = true, onClose }: StreamPanelProps) {
  const { videoRef, connect, disconnect } = useWebRTC(streamId)
  const { bindPanel } = useInputCapture(streamId)
  const panel = useStreamStore((s) => s.panels.find((p) => p.streamId === streamId))
  const activePanel = useStreamStore((s) => s.activePanel)
  const setActivePanel = useStreamStore((s) => s.setActivePanel)
  const isSelected = activePanel === streamId

  useEffect(() => {
    if (active) { connect() } else { disconnect() }
    return () => disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamId, active])

  const handleFullscreen = useCallback(() => {
    videoRef.current?.requestFullscreen()
  }, [videoRef])

  const handleFocus = useCallback(() => {
    setActivePanel(streamId)
  }, [streamId, setActivePanel])

  const status = panel?.connection.status ?? 'disconnected'
  const stats = panel?.stats

  // Combine ref: bindPanel for input + data attributes
  const setRef = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      el.dataset.mouseLock = panel?.mouseLocked ? 'true' : 'false'
      el.dataset.streamId = String(streamId)
    }
    bindPanel(el)
  }, [bindPanel, panel?.mouseLocked, streamId])

  return (
    <div
      className={`flex flex-col bg-gray-900 rounded overflow-hidden h-full transition-all ${
        isSelected ? 'ring-2 ring-blue-500' : 'ring-1 ring-gray-700'
      }`}
      onMouseDown={handleFocus}
      data-stream-id={streamId}
    >
      {/* Header */}
      <div className={`flex items-center justify-between px-2 py-0.5 text-xs select-none ${
        isSelected ? 'bg-blue-900/40' : 'bg-gray-800'
      }`}>
        <div className="flex items-center gap-1 truncate">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            status === 'connected' ? 'bg-green-400' : status === 'connecting' ? 'bg-yellow-400' : 'bg-red-400'
          }`} />
          <span className="truncate text-gray-300" title={title}>{title}</span>
        </div>
        <div className="flex items-center gap-0.5 ml-1 flex-shrink-0">
          {status === 'connected' && stats && (
            <span className="text-gray-500 text-[10px]">{stats.fps}fps</span>
          )}
          {panel && !panel.inputEnabled && (
            <span className="text-red-400 text-[10px]" title="Input disabled">🚫</span>
          )}
          {panel?.mouseLocked && (
            <span className="text-yellow-400 text-[10px]" title="Mouse locked">🔒</span>
          )}
          <button onClick={handleFullscreen} className="text-gray-500 hover:text-white px-0.5 text-[11px]">⛶</button>
          {onClose && (
            <button onClick={onClose} className="text-gray-500 hover:text-red-400 px-0.5 text-[11px]">✕</button>
          )}
        </div>
      </div>

      {/* Video + Input */}
      <div
        ref={setRef}
        className="flex-1 relative bg-black min-h-0 outline-none"
        style={{ cursor: panel?.inputEnabled ? 'crosshair' : 'not-allowed' }}
      >
        <video
          ref={videoRef}
          autoPlay playsInline muted
          style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
        />
        {status === 'connecting' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {status === 'failed' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
            <p className="text-red-400 text-xs mb-2">{panel?.connection.error ?? 'Failed'}</p>
            <button onClick={connect} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs">Retry</button>
          </div>
        )}
        {!active && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <p className="text-gray-500 text-xs">Paused</p>
          </div>
        )}
      </div>
    </div>
  )
}
