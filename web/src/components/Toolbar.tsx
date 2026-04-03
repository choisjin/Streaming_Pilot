import { useStreamStore } from '../stores/streamStore'
import type { LayoutMode } from '../stores/streamStore'

export default function Toolbar() {
  const activePanel = useStreamStore((s) => s.activePanel)
  const tabs = useStreamStore((s) => s.tabs)
  const activeTabId = useStreamStore((s) => s.activeTabId)
  const togglePanelInput = useStreamStore((s) => s.togglePanelInput)
  const togglePanelMouseLock = useStreamStore((s) => s.togglePanelMouseLock)
  const toggleProcessList = useStreamStore((s) => s.toggleProcessList)
  const toggleSettings = useStreamStore((s) => s.toggleSettings)
  const setTabLayout = useStreamStore((s) => s.setTabLayout)

  const allPanels = tabs.flatMap((t) => t.panels)
  const panel = allPanels.find((p) => p.streamId === activePanel)
  const activeTab = tabs.find((t) => t.id === activeTabId)

  return (
    <header className="flex items-center gap-1 px-2 py-1.5 bg-gray-800 border-b border-gray-700 flex-shrink-0">
      {/* Left: active panel info */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {panel ? (
          <>
            <span className="text-xs font-semibold text-gray-200 truncate">{panel.title}</span>
            {panel.connection.status === 'connected' && panel.stats && (
              <span className="text-[10px] text-gray-500">
                {panel.stats.fps}fps · {panel.stats.bitrate > 1000 ? `${(panel.stats.bitrate / 1000).toFixed(1)}M` : `${panel.stats.bitrate}k`} · {panel.stats.latency}ms
              </span>
            )}
          </>
        ) : (
          <span className="text-xs text-gray-500">No panel selected</span>
        )}
      </div>

      {/* Center: panel + tab controls */}
      <div className="flex items-center gap-0.5">
        {panel && (
          <>
            <button
              onClick={() => togglePanelInput(activePanel)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
                panel.inputEnabled
                  ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
                  : 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
              }`}
            >
              {panel.inputEnabled ? '🖱️ ON' : '🚫 OFF'}
            </button>
            <button
              onClick={() => togglePanelMouseLock(activePanel)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
                panel.mouseLocked
                  ? 'bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30'
                  : 'bg-gray-600/20 text-gray-400 hover:bg-gray-600/30'
              }`}
            >
              {panel.mouseLocked ? '🔒' : '🔓'}
            </button>
            <button
              onClick={() => {
                const video = document.querySelector(`[data-stream-id="${activePanel}"] video`)
                video?.requestFullscreen()
              }}
              className="px-2 py-1 rounded text-[11px] text-gray-400 hover:bg-gray-700 hover:text-white"
            >⛶</button>
          </>
        )}

        {/* Tab layout controls (windows tabs only) */}
        {activeTab && activeTab.type === 'windows' && activeTab.panels.length > 0 && (
          <>
            <div className="w-px h-4 bg-gray-700 mx-1" />
            <div className="flex gap-0.5">
              {(['grid', 'tabs'] as LayoutMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setTabLayout(activeTab.id, { mode })}
                  className={`px-1.5 py-0.5 rounded text-[10px] ${
                    activeTab.layoutMode === mode
                      ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'
                  }`}
                >
                  {mode === 'grid' ? '⊞' : '⊟'}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="w-px h-4 bg-gray-700 mx-1" />

      {/* Right: global */}
      <div className="flex items-center gap-0.5">
        <button onClick={toggleProcessList} className="px-2 py-1 rounded text-[11px] text-gray-400 hover:bg-gray-700 hover:text-white">+ Window</button>
        <button onClick={toggleSettings} className="px-1.5 py-1 rounded text-gray-400 hover:bg-gray-700 hover:text-white">⚙</button>
      </div>
    </header>
  )
}
