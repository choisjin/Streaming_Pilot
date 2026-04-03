import { useStreamStore } from '../stores/streamStore'

export default function AdminPanel() {
  const settingsOpen = useStreamStore((s) => s.settingsOpen)
  const tabs = useStreamStore((s) => s.tabs)
  const togglePanelInput = useStreamStore((s) => s.togglePanelInput)
  const togglePanelMouseLock = useStreamStore((s) => s.togglePanelMouseLock)

  if (!settingsOpen) return null

  const allPanels = tabs.flatMap((t) => t.panels)

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.reload()
  }

  return (
    <div className="border-t border-gray-700 pt-3 mt-3">
      <h3 className="text-xs text-gray-400 mb-2 uppercase tracking-wide">Admin</h3>
      <div className="space-y-2 mb-3">
        {allPanels.map((p) => (
          <div key={p.streamId} className="flex items-center justify-between text-xs">
            <span className="text-gray-300 truncate max-w-[100px]" title={p.title}>{p.title}</span>
            <div className="flex gap-1">
              <button
                onClick={() => togglePanelInput(p.streamId)}
                className={`px-1.5 py-0.5 rounded text-[10px] ${
                  p.inputEnabled ? 'bg-green-700 text-green-200' : 'bg-red-700 text-red-200'
                }`}
              >
                {p.inputEnabled ? 'Input ON' : 'Input OFF'}
              </button>
              <button
                onClick={() => togglePanelMouseLock(p.streamId)}
                className={`px-1.5 py-0.5 rounded text-[10px] ${
                  p.mouseLocked ? 'bg-yellow-700 text-yellow-200' : 'bg-gray-600 text-gray-300'
                }`}
              >
                {p.mouseLocked ? 'Locked' : 'Free'}
              </button>
            </div>
          </div>
        ))}
      </div>
      <button onClick={handleLogout}
        className="w-full py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded text-xs transition-colors">
        Logout
      </button>
    </div>
  )
}
