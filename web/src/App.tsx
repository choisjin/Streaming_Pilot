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
  const panels = useStreamStore((s) => s.panels)
  const layout = useStreamStore((s) => s.layout)
  const activeTab = useStreamStore((s) => s.activeTab)
  const setActiveTab = useStreamStore((s) => s.setActiveTab)
  const removePanel = useStreamStore((s) => s.removePanel)
  const deleteStream = useStreamStore((s) => s.deleteStream)
  const fetchSystemInfo = useStreamStore((s) => s.fetchSystemInfo)

  useEffect(() => {
    fetchSystemInfo()
    const id = setInterval(fetchSystemInfo, 5000)
    return () => clearInterval(id)
  }, [fetchSystemInfo])

  const handleClosePanel = useCallback(async (streamId: number) => {
    if (streamId === 0) return
    await deleteStream(streamId)
    removePanel(streamId)
  }, [deleteStream, removePanel])

  return (
    <div className="h-screen flex flex-col bg-gray-950">
      {/* Toolbar */}
      <Toolbar />

      {/* Tab bar */}
      {layout.mode === 'tabs' && (
        <div className="flex bg-gray-800 border-b border-gray-700 overflow-x-auto flex-shrink-0">
          {panels.map((p) => (
            <button
              key={p.streamId}
              onClick={() => setActiveTab(p.streamId)}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs border-r border-gray-700 flex-shrink-0 transition-colors ${
                activeTab === p.streamId ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${
                p.connection.status === 'connected' ? 'bg-green-400' : 'bg-gray-500'
              }`} />
              <span className="truncate max-w-[120px]">{p.title}</span>
              {p.streamId !== 0 && (
                <span onClick={(e) => { e.stopPropagation(); handleClosePanel(p.streamId) }}
                  className="ml-1 text-gray-500 hover:text-red-400 cursor-pointer">✕</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {layout.mode === 'grid' ? (
          <ResizableGrid cols={layout.cols} rows={layout.rows}>
            {panels.map((panel) => (
              <StreamPanel
                key={panel.streamId}
                streamId={panel.streamId}
                title={panel.title}
                active={true}
                onClose={panel.streamId !== 0 ? () => handleClosePanel(panel.streamId) : undefined}
              />
            ))}
          </ResizableGrid>
        ) : (
          <div className="w-full h-full">
            {panels.map((panel) => {
              const isActive = activeTab === panel.streamId
              return (
                <div key={panel.streamId} className="w-full h-full" style={{ display: isActive ? 'block' : 'none' }}>
                  <StreamPanel
                    streamId={panel.streamId}
                    title={panel.title}
                    active={isActive}
                    onClose={panel.streamId !== 0 ? () => handleClosePanel(panel.streamId) : undefined}
                  />
                </div>
              )
            })}
          </div>
        )}

        <SettingsPanel />
        <ProcessList />
      </div>
    </div>
  )
}
