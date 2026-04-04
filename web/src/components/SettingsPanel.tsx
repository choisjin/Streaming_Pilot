import { useEffect, useState } from 'react'
import AdminPanel from './AdminPanel'
import { useStreamStore } from '../stores/streamStore'

const RESOLUTIONS = ['1920x1080', '1280x720', '854x480']

export default function SettingsPanel() {
  const settings = useStreamStore((s) => s.settings)
  const systemInfo = useStreamStore((s) => s.systemInfo)
  const settingsOpen = useStreamStore((s) => s.settingsOpen)
  const toggleSettings = useStreamStore((s) => s.toggleSettings)
  const updateSettings = useStreamStore((s) => s.updateSettings)
  const tabs = useStreamStore((s) => s.tabs)
  const activeTabId = useStreamStore((s) => s.activeTabId)
  const setTabLayout = useStreamStore((s) => s.setTabLayout)

  const activeTab = tabs.find((t) => t.id === activeTabId)

  const [turnUsage, setTurnUsage] = useState<any>(null)

  useEffect(() => {
    if (settingsOpen) {
      fetch('/api/turn/usage').then(r => r.json()).then(setTurnUsage).catch(() => {})
    }
  }, [settingsOpen])

  if (!settingsOpen) return null

  const bitrateNum = parseFloat(settings.bitrate) || 6

  return (
    <div className="absolute right-0 top-0 bottom-0 w-72 bg-gray-800/95 backdrop-blur border-l border-gray-700 p-4 z-30 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold">Settings</h2>
        <button onClick={toggleSettings} className="text-gray-400 hover:text-white text-lg">✕</button>
      </div>

      {/* Tab layout (windows tabs only) */}
      {activeTab && activeTab.type === 'windows' && (
        <div className="mb-4 pb-4 border-b border-gray-700">
          <h3 className="text-xs text-gray-400 mb-2 uppercase tracking-wide">Tab: {activeTab.label}</h3>
          {activeTab.layoutMode === 'grid' && (
            <div className="flex gap-3">
              <label className="flex-1">
                <span className="text-xs text-gray-400">Cols: {activeTab.cols}</span>
                <input type="range" min={1} max={4} step={1} value={activeTab.cols}
                  onChange={(e) => setTabLayout(activeTab.id, { cols: Number(e.target.value) })} className="w-full mt-1" />
              </label>
              <label className="flex-1">
                <span className="text-xs text-gray-400">Rows: {activeTab.rows}</span>
                <input type="range" min={1} max={4} step={1} value={activeTab.rows}
                  onChange={(e) => setTabLayout(activeTab.id, { rows: Number(e.target.value) })} className="w-full mt-1" />
              </label>
            </div>
          )}
        </div>
      )}

      {/* Stream settings */}
      <h3 className="text-xs text-gray-400 mb-2 uppercase tracking-wide">Stream</h3>
      <label className="block mb-3">
        <span className="text-xs text-gray-400">FPS: {settings.fps}</span>
        <input type="range" min={1} max={120} step={1} value={settings.fps}
          onChange={(e) => updateSettings({ fps: Number(e.target.value) })} className="w-full mt-1" />
      </label>
      <label className="block mb-3">
        <span className="text-xs text-gray-400">Bitrate: {bitrateNum.toFixed(1)}M</span>
        <input type="range" min={1} max={20} step={0.5} value={bitrateNum}
          onChange={(e) => updateSettings({ bitrate: `${Number(e.target.value)}M` })} className="w-full mt-1" />
      </label>
      <label className="block mb-3">
        <span className="text-xs text-gray-400">Resolution</span>
        <select value={settings.resolution} onChange={(e) => updateSettings({ resolution: e.target.value })}
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm">
          {RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 mb-4 cursor-pointer">
        <input type="checkbox" checked={settings.adaptive}
          onChange={(e) => updateSettings({ adaptive: e.target.checked })} className="w-4 h-4" />
        <span className="text-sm">Adaptive Mode</span>
      </label>

      {/* System info */}
      <div className="border-t border-gray-700 pt-3 space-y-1 text-xs text-gray-400">
        <div><span className="text-gray-500">Encoder: </span>{settings.encoder}</div>
        {systemInfo && (
          <>
            <div><span className="text-gray-500">GPU: </span>{systemInfo.gpu}</div>
            <div><span className="text-gray-500">CPU: </span>{systemInfo.cpuUsage.toFixed(1)}%</div>
          </>
        )}
      </div>

      {/* TURN Usage */}
      {turnUsage && (
        <div className="border-t border-gray-700 pt-3 mt-3">
          <h3 className="text-xs text-gray-400 mb-2 uppercase tracking-wide">TURN Usage</h3>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Total</span>
              <span className="text-gray-300">{turnUsage.totalGB} GB / {turnUsage.freeLimit_GB} GB</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full ${turnUsage.usedPercent > 80 ? 'bg-red-500' : turnUsage.usedPercent > 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{ width: `${Math.min(100, turnUsage.usedPercent)}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-gray-500">{turnUsage.sessions} sessions</span>
              <span className={turnUsage.costUSD > 0 ? 'text-red-400' : 'text-green-400'}>
                {turnUsage.costUSD > 0 ? `$${turnUsage.costUSD}` : 'Free'}
              </span>
            </div>
            {Object.keys(turnUsage.daily || {}).length > 0 && (
              <div className="mt-1">
                <span className="text-[10px] text-gray-500">Daily (MB):</span>
                <div className="flex gap-0.5 mt-0.5 overflow-x-auto">
                  {Object.entries(turnUsage.daily).slice(-7).map(([date, mb]: [string, any]) => (
                    <div key={date} className="text-center min-w-[32px]">
                      <div className="text-[9px] text-gray-400">{mb}</div>
                      <div className="text-[8px] text-gray-600">{date.slice(5)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <AdminPanel />
    </div>
  )
}
