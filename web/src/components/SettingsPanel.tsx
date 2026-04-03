import { useCallback } from 'react'
import AdminPanel from './AdminPanel'
import { useStreamStore } from '../stores/streamStore'
import type { LayoutMode } from '../stores/streamStore'

const RESOLUTIONS = ['1920x1080', '1280x720', '854x480']

export default function SettingsPanel() {
  const settings = useStreamStore((s) => s.settings)
  const systemInfo = useStreamStore((s) => s.systemInfo)
  const settingsOpen = useStreamStore((s) => s.settingsOpen)
  const toggleSettings = useStreamStore((s) => s.toggleSettings)
  const updateSettings = useStreamStore((s) => s.updateSettings)
  const layout = useStreamStore((s) => s.layout)
  const setLayout = useStreamStore((s) => s.setLayout)

  const handleFpsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateSettings({ fps: Number(e.target.value) })
    }, [updateSettings])

  const handleBitrateChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateSettings({ bitrate: `${Number(e.target.value)}M` })
    }, [updateSettings])

  const handleResolutionChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateSettings({ resolution: e.target.value })
    }, [updateSettings])

  const handleAdaptiveChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateSettings({ adaptive: e.target.checked })
    }, [updateSettings])

  if (!settingsOpen) return null

  const bitrateNum = parseFloat(settings.bitrate) || 6

  return (
    <div className="absolute right-0 top-0 bottom-0 w-72 bg-gray-800/95 backdrop-blur border-l border-gray-700 p-4 z-30 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold">Settings</h2>
        <button onClick={toggleSettings} className="text-gray-400 hover:text-white text-lg">✕</button>
      </div>

      {/* Layout Settings */}
      <div className="mb-4 pb-4 border-b border-gray-700">
        <h3 className="text-xs text-gray-400 mb-2 uppercase tracking-wide">Layout</h3>

        {/* Mode */}
        <div className="flex gap-1 mb-3">
          {(['grid', 'tabs'] as LayoutMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setLayout({ mode })}
              className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                layout.mode === mode
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
            >
              {mode === 'grid' ? 'Grid' : 'Tabs'}
            </button>
          ))}
        </div>

        {/* Grid rows/cols */}
        {layout.mode === 'grid' && (
          <div className="flex gap-3">
            <label className="flex-1">
              <span className="text-xs text-gray-400">Columns: {layout.cols}</span>
              <input
                type="range" min={1} max={4} step={1}
                value={layout.cols}
                onChange={(e) => setLayout({ cols: Number(e.target.value) })}
                className="w-full mt-1"
              />
            </label>
            <label className="flex-1">
              <span className="text-xs text-gray-400">Rows: {layout.rows}</span>
              <input
                type="range" min={1} max={4} step={1}
                value={layout.rows}
                onChange={(e) => setLayout({ rows: Number(e.target.value) })}
                className="w-full mt-1"
              />
            </label>
          </div>
        )}
      </div>

      {/* Stream Settings */}
      <h3 className="text-xs text-gray-400 mb-2 uppercase tracking-wide">Stream</h3>

      <label className="block mb-3">
        <span className="text-xs text-gray-400">FPS: {settings.fps}</span>
        <input type="range" min={1} max={120} step={1} value={settings.fps}
          onChange={handleFpsChange} className="w-full mt-1" />
      </label>

      <label className="block mb-3">
        <span className="text-xs text-gray-400">Bitrate: {bitrateNum.toFixed(1)}M</span>
        <input type="range" min={1} max={20} step={0.5} value={bitrateNum}
          onChange={handleBitrateChange} className="w-full mt-1" />
      </label>

      <label className="block mb-3">
        <span className="text-xs text-gray-400">Resolution</span>
        <select value={settings.resolution} onChange={handleResolutionChange}
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm">
          {RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>

      <label className="flex items-center gap-2 mb-4 cursor-pointer">
        <input type="checkbox" checked={settings.adaptive}
          onChange={handleAdaptiveChange} className="w-4 h-4" />
        <span className="text-sm">Adaptive Mode</span>
      </label>

      {/* System Info */}
      <div className="border-t border-gray-700 pt-3 space-y-1 text-xs text-gray-400">
        <div><span className="text-gray-500">Encoder: </span>{settings.encoder}</div>
        {systemInfo && (
          <>
            <div><span className="text-gray-500">GPU: </span>{systemInfo.gpu}</div>
            <div><span className="text-gray-500">CPU: </span>{systemInfo.cpuUsage.toFixed(1)}%</div>
          </>
        )}
      </div>

      <AdminPanel />
    </div>
  )
}
