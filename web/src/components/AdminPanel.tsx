import { useCallback, useEffect, useState } from 'react'
import { useStreamStore } from '../stores/streamStore'

interface AdminState {
  streamingActive: boolean
  inputEnabled: Record<number, boolean>
  mouseLocked: Record<number, boolean>
}

export default function AdminPanel() {
  const settingsOpen = useStreamStore((s) => s.settingsOpen)
  const panels = useStreamStore((s) => s.panels)
  const [adminState, setAdminState] = useState<AdminState>({
    streamingActive: true, inputEnabled: {}, mouseLocked: {},
  })

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/state')
      if (res.ok) setAdminState(await res.json())
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (settingsOpen) fetchState()
  }, [settingsOpen, fetchState])

  const toggleInput = async (streamId: number, enabled: boolean) => {
    await fetch(`/api/admin/input/${streamId}?enabled=${enabled}`, { method: 'POST' })
    fetchState()
  }

  const toggleMouseLock = async (streamId: number, locked: boolean) => {
    await fetch(`/api/admin/mouse-lock/${streamId}?locked=${locked}`, { method: 'POST' })
    fetchState()
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.reload()
  }

  if (!settingsOpen) return null

  return (
    <div className="border-t border-gray-700 pt-3 mt-3">
      <h3 className="text-xs text-gray-400 mb-2 uppercase tracking-wide">Admin</h3>

      {/* Per-stream controls */}
      <div className="space-y-2 mb-3">
        {panels.map((p) => (
          <div key={p.streamId} className="flex items-center justify-between text-xs">
            <span className="text-gray-300 truncate max-w-[100px]" title={p.title}>{p.title}</span>
            <div className="flex gap-1">
              <button
                onClick={() => toggleInput(p.streamId, adminState.inputEnabled[p.streamId] === false)}
                className={`px-1.5 py-0.5 rounded text-[10px] ${
                  (adminState.inputEnabled[p.streamId] !== false)
                    ? 'bg-green-700 text-green-200' : 'bg-red-700 text-red-200'
                }`}
                title="Toggle input"
              >
                {(adminState.inputEnabled[p.streamId] !== false) ? 'Input ON' : 'Input OFF'}
              </button>
              <button
                onClick={() => toggleMouseLock(p.streamId, !(adminState.mouseLocked[p.streamId] ?? false))}
                className={`px-1.5 py-0.5 rounded text-[10px] ${
                  (adminState.mouseLocked[p.streamId] ?? false)
                    ? 'bg-yellow-700 text-yellow-200' : 'bg-gray-600 text-gray-300'
                }`}
                title="Toggle mouse lock"
              >
                {(adminState.mouseLocked[p.streamId] ?? false) ? 'Locked' : 'Free'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={handleLogout}
        className="w-full py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded text-xs transition-colors"
      >
        Logout
      </button>
    </div>
  )
}
