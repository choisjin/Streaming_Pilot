import { create } from 'zustand'
import type { ConnectionState, ProcessInfo, StreamSettings, SystemInfo, WebRTCStats } from '../types'

const API_BASE = ''

export type LayoutMode = 'grid' | 'tabs'

export interface PanelState {
  streamId: number
  title: string
  connection: ConnectionState
  stats: WebRTCStats
  inputEnabled: boolean
  mouseLocked: boolean
}

export interface TabState {
  id: string
  label: string
  type: 'desktop' | 'windows'
  panels: PanelState[]
  layoutMode: LayoutMode  // grid/tabs within this tab
  cols: number
  rows: number
}

interface StreamStore {
  settings: StreamSettings
  systemInfo: SystemInfo | null
  settingsOpen: boolean
  processListOpen: boolean

  tabs: TabState[]
  activeTabId: string
  activePanel: number  // streamId of selected panel (for toolbar)

  processes: ProcessInfo[]

  // Tab actions
  setActiveTab: (tabId: string) => void
  addWindowTab: () => string  // returns new tab id
  removeWindowTab: (tabId: string) => void
  setTabLayout: (tabId: string, layout: Partial<{ mode: LayoutMode; cols: number; rows: number }>) => void

  // Panel actions within tabs
  addPanelToTab: (tabId: string, streamId: number, title: string) => void
  removePanelFromTab: (tabId: string, streamId: number) => void
  setActivePanel: (streamId: number) => void
  updatePanelConnection: (streamId: number, state: Partial<ConnectionState>) => void
  updatePanelStats: (streamId: number, stats: Partial<WebRTCStats>) => void
  togglePanelInput: (streamId: number) => void
  togglePanelMouseLock: (streamId: number) => void

  // Settings
  setSettings: (settings: StreamSettings) => void
  setSystemInfo: (info: SystemInfo) => void
  toggleSettings: () => void
  toggleProcessList: () => void

  // API
  updateSettings: (settings: Partial<StreamSettings>) => Promise<void>
  fetchSystemInfo: () => Promise<void>
  fetchProcesses: () => Promise<void>
  createWindowStream: (hwnd: number, title: string) => Promise<number | null>
  deleteStream: (streamId: number) => Promise<void>
}

let nextTabId = 1

export const useStreamStore = create<StreamStore>((set) => ({
  settings: { fps: 30, bitrate: '4M', resolution: '1920x1080', adaptive: true, encoder: 'auto', game_mode: false },
  systemInfo: null,
  settingsOpen: false,
  processListOpen: false,

  tabs: [
    {
      id: 'desktop',
      label: 'Desktop',
      type: 'desktop',
      panels: [{
        streamId: 0, title: 'Desktop',
        connection: { status: 'disconnected' },
        stats: { fps: 0, bitrate: 0, latency: 0, packetsLost: 0 },
        inputEnabled: true, mouseLocked: false,
      }],
      layoutMode: 'grid',
      cols: 1, rows: 1,
    },
  ],
  activeTabId: 'desktop',
  activePanel: 0,
  processes: [],

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  addWindowTab: () => {
    const id = `win-${nextTabId++}`
    set((s) => ({
      tabs: [...s.tabs, {
        id,
        label: `Windows ${nextTabId - 1}`,
        type: 'windows',
        panels: [],
        layoutMode: 'grid',
        cols: 2, rows: 2,
      }],
      activeTabId: id,
    }))
    return id
  },

  removeWindowTab: (tabId) =>
    set((s) => ({
      tabs: s.tabs.filter((t) => t.id !== tabId),
      activeTabId: s.activeTabId === tabId ? 'desktop' : s.activeTabId,
    })),

  setTabLayout: (tabId, layout) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, ...layout, layoutMode: layout.mode ?? t.layoutMode } : t
      ),
    })),

  addPanelToTab: (tabId, streamId, title) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t
        if (t.panels.length >= 4) return t  // max 4 per tab
        return {
          ...t,
          panels: [...t.panels, {
            streamId, title,
            connection: { status: 'disconnected' },
            stats: { fps: 0, bitrate: 0, latency: 0, packetsLost: 0 },
            inputEnabled: true, mouseLocked: false,
          }],
        }
      }),
    })),

  removePanelFromTab: (tabId, streamId) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? { ...t, panels: t.panels.filter((p) => p.streamId !== streamId) }
          : t
      ),
    })),

  setActivePanel: (streamId) => set({ activePanel: streamId }),

  updatePanelConnection: (streamId, state) =>
    set((s) => ({
      tabs: s.tabs.map((t) => ({
        ...t,
        panels: t.panels.map((p) =>
          p.streamId === streamId ? { ...p, connection: { ...p.connection, ...state } } : p
        ),
      })),
    })),

  updatePanelStats: (streamId, stats) =>
    set((s) => ({
      tabs: s.tabs.map((t) => ({
        ...t,
        panels: t.panels.map((p) =>
          p.streamId === streamId ? { ...p, stats: { ...p.stats, ...stats } } : p
        ),
      })),
    })),

  togglePanelInput: (streamId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => ({
        ...t,
        panels: t.panels.map((p) =>
          p.streamId === streamId ? { ...p, inputEnabled: !p.inputEnabled } : p
        ),
      })),
    }))
    const store = useStreamStore.getState()
    const panel = store.tabs.flatMap((t) => t.panels).find((p) => p.streamId === streamId)
    if (panel) {
      fetch(`${API_BASE}/api/admin/input/${streamId}?enabled=${panel.inputEnabled}`, { method: 'POST' })
    }
  },

  togglePanelMouseLock: (streamId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => ({
        ...t,
        panels: t.panels.map((p) =>
          p.streamId === streamId ? { ...p, mouseLocked: !p.mouseLocked } : p
        ),
      })),
    })),

  setSettings: (settings) => set({ settings }),
  setSystemInfo: (info) => set({ systemInfo: info }),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  toggleProcessList: () => set((s) => ({ processListOpen: !s.processListOpen })),

  updateSettings: async (partial) => {
    try {
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      })
      if (!res.ok) return
      set({ settings: (await res.json()).applied })
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
