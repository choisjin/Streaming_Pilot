import { create } from 'zustand'
import type { ConnectionState, ProcessInfo, StreamSettings, SystemInfo, WebRTCStats } from '../types'

const API_BASE = ''

export type LayoutMode = 'grid' | 'tabs'

interface PanelState {
  streamId: number
  title: string
  connection: ConnectionState
  stats: WebRTCStats
  inputEnabled: boolean
  mouseLocked: boolean
}

interface LayoutSettings {
  mode: LayoutMode
  cols: number
  rows: number
}

interface StreamStore {
  settings: StreamSettings
  systemInfo: SystemInfo | null
  settingsOpen: boolean
  processListOpen: boolean
  layout: LayoutSettings
  activeTab: number
  activePanel: number  // 현재 선택된 패널 (하이라이트용)

  panels: PanelState[]
  processes: ProcessInfo[]

  setSettings: (settings: StreamSettings) => void
  setSystemInfo: (info: SystemInfo) => void
  toggleSettings: () => void
  toggleProcessList: () => void
  setLayout: (layout: Partial<LayoutSettings>) => void
  setActiveTab: (streamId: number) => void
  setActivePanel: (streamId: number) => void

  addPanel: (streamId: number, title: string) => void
  removePanel: (streamId: number) => void
  updatePanelConnection: (streamId: number, state: Partial<ConnectionState>) => void
  updatePanelStats: (streamId: number, stats: Partial<WebRTCStats>) => void
  togglePanelInput: (streamId: number) => void
  togglePanelMouseLock: (streamId: number) => void

  updateSettings: (settings: Partial<StreamSettings>) => Promise<void>
  fetchSystemInfo: () => Promise<void>
  fetchProcesses: () => Promise<void>
  createWindowStream: (hwnd: number, title: string) => Promise<number | null>
  deleteStream: (streamId: number) => Promise<void>
}

export const useStreamStore = create<StreamStore>((set) => ({
  settings: { fps: 30, bitrate: '4M', resolution: '1920x1080', adaptive: true, encoder: 'auto' },
  systemInfo: null,
  settingsOpen: false,
  processListOpen: false,
  layout: { mode: 'grid', cols: 2, rows: 2 },
  activeTab: 0,
  activePanel: 0,

  panels: [{ streamId: 0, title: 'Desktop', connection: { status: 'disconnected' }, stats: { fps: 0, bitrate: 0, latency: 0, packetsLost: 0 }, inputEnabled: true, mouseLocked: false }],
  processes: [],

  setSettings: (settings) => set({ settings }),
  setSystemInfo: (info) => set({ systemInfo: info }),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  toggleProcessList: () => set((s) => ({ processListOpen: !s.processListOpen })),
  setLayout: (layout) => set((s) => ({ layout: { ...s.layout, ...layout } })),
  setActiveTab: (streamId) => set({ activeTab: streamId }),
  setActivePanel: (streamId) => set({ activePanel: streamId }),

  addPanel: (streamId, title) =>
    set((s) => ({
      panels: [...s.panels, {
        streamId, title,
        connection: { status: 'disconnected' },
        stats: { fps: 0, bitrate: 0, latency: 0, packetsLost: 0 },
        inputEnabled: true, mouseLocked: false,
      }],
    })),

  removePanel: (streamId) =>
    set((s) => ({
      panels: s.panels.filter((p) => p.streamId !== streamId),
      activeTab: s.activeTab === streamId ? (s.panels[0]?.streamId ?? 0) : s.activeTab,
      activePanel: s.activePanel === streamId ? (s.panels[0]?.streamId ?? 0) : s.activePanel,
    })),

  updatePanelConnection: (streamId, state) =>
    set((s) => ({
      panels: s.panels.map((p) =>
        p.streamId === streamId ? { ...p, connection: { ...p.connection, ...state } } : p
      ),
    })),

  updatePanelStats: (streamId, stats) =>
    set((s) => ({
      panels: s.panels.map((p) =>
        p.streamId === streamId ? { ...p, stats: { ...p.stats, ...stats } } : p
      ),
    })),

  togglePanelInput: (streamId) => {
    set((s) => ({
      panels: s.panels.map((p) =>
        p.streamId === streamId ? { ...p, inputEnabled: !p.inputEnabled } : p
      ),
    }))
    // Sync to server
    const panel = useStreamStore.getState().panels.find((p) => p.streamId === streamId)
    if (panel) {
      fetch(`${API_BASE}/api/admin/input/${streamId}?enabled=${panel.inputEnabled}`, { method: 'POST' })
    }
  },

  togglePanelMouseLock: (streamId) =>
    set((s) => ({
      panels: s.panels.map((p) =>
        p.streamId === streamId ? { ...p, mouseLocked: !p.mouseLocked } : p
      ),
    })),

  updateSettings: async (partial) => {
    try {
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      })
      if (!res.ok) return
      const data = await res.json()
      set({ settings: data.applied })
    } catch { /* ignore */ }
  },

  fetchSystemInfo: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/system/info`)
      if (!res.ok) return
      set({ systemInfo: await res.json() })
    } catch { /* ignore */ }
  },

  fetchProcesses: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/processes`)
      if (!res.ok) return
      set({ processes: await res.json() })
    } catch { /* ignore */ }
  },

  createWindowStream: async (hwnd, title) => {
    try {
      const res = await fetch(`${API_BASE}/api/streams`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hwnd, title, width: 0, height: 0, fps: 30 }),
      })
      if (!res.ok) return null
      return (await res.json()).streamId as number
    } catch { return null }
  },

  deleteStream: async (streamId) => {
    try {
      await fetch(`${API_BASE}/api/streams/${streamId}`, { method: 'DELETE' })
    } catch { /* ignore */ }
  },
}))
