// 상단 아이콘 툴바 — 선택된 패널에 대한 빠른 설정
import { useStreamStore } from '../stores/streamStore'

export default function Toolbar() {
  const activePanel = useStreamStore((s) => s.activePanel)
  const panels = useStreamStore((s) => s.panels)
  const togglePanelInput = useStreamStore((s) => s.togglePanelInput)
  const togglePanelMouseLock = useStreamStore((s) => s.togglePanelMouseLock)
  const toggleProcessList = useStreamStore((s) => s.toggleProcessList)
  const toggleSettings = useStreamStore((s) => s.toggleSettings)

  const panel = panels.find((p) => p.streamId === activePanel)
  if (!panel) return null

  return (
    <header className="flex items-center gap-1 px-2 py-1.5 bg-gray-800 border-b border-gray-700 flex-shrink-0">
      {/* Left: active panel info */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-xs font-semibold text-gray-200 truncate">{panel.title}</span>
        {panel.connection.status === 'connected' && panel.stats && (
          <span className="text-[10px] text-gray-500">
            {panel.stats.fps}fps · {panel.stats.bitrate > 1000 ? `${(panel.stats.bitrate / 1000).toFixed(1)}M` : `${panel.stats.bitrate}k`} · {panel.stats.latency}ms
          </span>
        )}
      </div>

      {/* Center: panel controls */}
      <div className="flex items-center gap-0.5">
        {/* Input toggle */}
        <button
          onClick={() => togglePanelInput(activePanel)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
            panel.inputEnabled
              ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
              : 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
          }`}
          title={panel.inputEnabled ? 'Input enabled — click to disable' : 'Input disabled — click to enable'}
        >
          {panel.inputEnabled ? '🖱️ Input ON' : '🚫 Input OFF'}
        </button>

        {/* Mouse lock toggle */}
        <button
          onClick={() => togglePanelMouseLock(activePanel)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
            panel.mouseLocked
              ? 'bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30'
              : 'bg-gray-600/20 text-gray-400 hover:bg-gray-600/30'
          }`}
          title={panel.mouseLocked ? 'Mouse locked — ESC to unlock' : 'Mouse free — click to lock'}
        >
          {panel.mouseLocked ? '🔒 Locked' : '🔓 Free'}
        </button>

        <div className="w-px h-4 bg-gray-700 mx-1" />

        {/* Fullscreen */}
        <button
          onClick={() => {
            const video = document.querySelector(`[data-stream-id="${activePanel}"] video`)
            video?.requestFullscreen()
          }}
          className="px-2 py-1 rounded text-[11px] text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
          title="Fullscreen"
        >
          ⛶
        </button>
      </div>

      <div className="w-px h-4 bg-gray-700 mx-1" />

      {/* Right: global controls */}
      <div className="flex items-center gap-0.5">
        <span className="text-[10px] text-gray-600 mr-1">{panels.length} panels</span>
        <button
          onClick={toggleProcessList}
          className="px-2 py-1 rounded text-[11px] text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
          title="Add window"
        >
          + Window
        </button>
        <button
          onClick={toggleSettings}
          className="px-1.5 py-1 rounded text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
          title="Settings"
        >
          ⚙
        </button>
      </div>
    </header>
  )
}
