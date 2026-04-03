import { useEffect, useCallback, useState } from 'react'
import LoginPage from './components/LoginPage'
import ProcessList from './components/ProcessList'
import ResizableGrid from './components/ResizableGrid'
import SettingsPanel from './components/SettingsPanel'
import StreamPanel from './components/StreamPanel'
import Toolbar from './components/Toolbar'
import { useStreamStore } from './stores/streamStore'

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)

  useEffect(() => {
    fetch('/api/auth/status')
      .then((r) => r.json())
      .then((d) => setAuthenticated(d.authenticated))
      .catch(() => setAuthenticated(false))
  }, [])

  if (authenticated === null) {
    return <div className="h-screen flex items-center justify-center bg-gray-950 text-gray-500">Loading...</div>
  }
  if (!authenticated) {
    return <LoginPage onLogin={() => setAuthenticated(true)} />
  }
  return <MainApp />
}

function MainApp() {
  const tabs = useStreamStore((s) => s.tabs)
  const activeTabId = useStreamStore((s) => s.activeTabId)
  const setActiveTab = useStreamStore((s) => s.setActiveTab)
  const addWindowTab = useStreamStore((s) => s.addWindowTab)
  const removeWindowTab = useStreamStore((s) => s.removeWindowTab)
  const removePanelFromTab = useStreamStore((s) => s.removePanelFromTab)
  const deleteStream = useStreamStore((s) => s.deleteStream)
  const fetchSystemInfo = useStreamStore((s) => s.fetchSystemInfo)

  useEffect(() => {
    fetchSystemInfo()
    const id = setInterval(fetchSystemInfo, 5000)
    return () => clearInterval(id)
  }, [fetchSystemInfo])

  const handleClosePanel = useCallback(async (tabId: string, streamId: number) => {
    await deleteStream(streamId)
    removePanelFromTab(tabId, streamId)
  }, [deleteStream, removePanelFromTab])

  const handleCloseTab = useCallback((tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId)
    if (!tab || tab.type === 'desktop') return
    // Delete all streams in this tab
    tab.panels.forEach((p) => deleteStream(p.streamId))
    removeWindowTab(tabId)
  }, [tabs, deleteStream, removeWindowTab])

  return (
    <div className="h-screen flex flex-col bg-gray-950">
      {/* Toolbar */}
      <Toolbar />

      {/* Tab bar */}
      <div className="flex bg-gray-800 border-b border-gray-700 flex-shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-gray-700 flex-shrink-0 transition-colors ${
              activeTabId === tab.id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-750'
            }`}
          >
            <span>{tab.type === 'desktop' ? '🖥️' : '📁'}</span>
            <span className="truncate max-w-[100px]">{tab.label}</span>
            {tab.type === 'desktop' && (
              <span className="text-[10px] text-gray-500">{tab.panels[0]?.connection.status === 'connected' ? '●' : '○'}</span>
            )}
            {tab.type === 'windows' && (
              <span className="text-[10px] text-gray-500">{tab.panels.length}/4</span>
            )}
            {tab.type === 'windows' && (
              <span
                onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id) }}
                className="ml-0.5 text-gray-500 hover:text-red-400 cursor-pointer"
              >✕</span>
            )}
          </button>
        ))}
        {/* Add window tab button */}
        <button
          onClick={addWindowTab}
          className="px-3 py-1.5 text-xs text-gray-500 hover:text-white hover:bg-gray-700 transition-colors"
          title="Add window tab"
        >
          +
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              className="absolute inset-0"
              style={{ display: isActive ? 'block' : 'none' }}
            >
              {tab.type === 'desktop' ? (
                /* Desktop tab — single full panel */
                <StreamPanel
                  streamId={0}
                  title="Desktop"
                  active={isActive}
                />
              ) : (
                /* Windows tab — grid or inner tabs */
                <WindowTabContent
                  tab={tab}
                  isActive={isActive}
                  onClosePanel={(sid) => handleClosePanel(tab.id, sid)}
                />
              )}
            </div>
          )
        })}

        <SettingsPanel />
        <ProcessList />
      </div>
    </div>
  )
}

// Windows tab content — grid layout with up to 4 panels
function WindowTabContent({
  tab,
  isActive,
  onClosePanel,
}: {
  tab: import('./stores/streamStore').TabState
  isActive: boolean
  onClosePanel: (streamId: number) => void
}) {
  if (tab.panels.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
        <div className="text-center">
          <p className="mb-2">No windows added</p>
          <p className="text-xs text-gray-600">Click "+ Window" in the toolbar to add</p>
        </div>
      </div>
    )
  }

  if (tab.layoutMode === 'tabs') {
    // Inner tab mode — show one panel at a time
    const [innerActive, setInnerActive] = useState(tab.panels[0]?.streamId ?? 0)
    const activeStreamId = tab.panels.find((p) => p.streamId === innerActive) ? innerActive : tab.panels[0]?.streamId

    return (
      <div className="w-full h-full flex flex-col">
        {/* Inner tab bar */}
        <div className="flex bg-gray-850 border-b border-gray-700 flex-shrink-0">
          {tab.panels.map((p) => (
            <button
              key={p.streamId}
              onClick={() => setInnerActive(p.streamId)}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] border-r border-gray-700 ${
                activeStreamId === p.streamId ? 'bg-gray-700 text-white' : 'text-gray-400'
              }`}
            >
              <span className="truncate max-w-[80px]">{p.title}</span>
              <span onClick={(e) => { e.stopPropagation(); onClosePanel(p.streamId) }}
                className="text-gray-500 hover:text-red-400">✕</span>
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0">
          {tab.panels.map((p) => {
            const panelActive = isActive && p.streamId === activeStreamId
            return (
              <div key={p.streamId} className="w-full h-full" style={{ display: p.streamId === activeStreamId ? 'block' : 'none' }}>
                <StreamPanel
                  streamId={p.streamId}
                  title={p.title}
                  active={panelActive}
                  lowQuality={isActive && !panelActive}
                  onClose={() => onClosePanel(p.streamId)}
                />
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Grid mode
  return (
    <ResizableGrid cols={tab.cols} rows={tab.rows}>
      {tab.panels.map((p) => (
        <StreamPanel
          key={p.streamId}
          streamId={p.streamId}
          title={p.title}
          active={isActive}
          lowQuality={false}
          onClose={() => onClosePanel(p.streamId)}
        />
      ))}
    </ResizableGrid>
  )
}
