// 가상 버튼 패널 — 우클릭, 커스텀 키 매크로, 마우스 모드 토글
import { useState, useCallback, useEffect } from 'react'

interface VirtualButton {
  id: string
  label: string
  icon?: string
  action: ButtonAction
  color?: string
}

type ButtonAction =
  | { type: 'click'; button: 'right' | 'middle' }
  | { type: 'key'; code: string }
  | { type: 'combo'; codes: string[] }
  | { type: 'text'; text: string }

interface VirtualButtonsProps {
  onAction: (action: ButtonAction) => void
  visible: boolean
  onToggle: () => void
  mouseMode: 'L' | 'R' | 'E'
  onMouseModeChange: () => void
}

const FIXED_BUTTON_IDS = new Set([
  'esc', 'esc2', 'enter', 'tab', 'space', 'alt-1', 'alt-2',
])

const DEFAULT_BUTTONS: VirtualButton[] = [
  { id: 'esc', label: 'ESC', action: { type: 'key', code: 'Escape' }, color: 'bg-orange-600/30' },
  { id: 'esc2', label: 'ESCx2', action: { type: 'combo', codes: ['Escape', '_delay50', 'Escape'] }, color: 'bg-orange-600/30' },
  { id: 'enter', label: 'Enter', action: { type: 'key', code: 'Enter' }, color: 'bg-orange-600/30' },
  { id: 'tab', label: 'Tab', action: { type: 'key', code: 'Tab' }, color: 'bg-orange-600/30' },
  { id: 'space', label: 'Space', action: { type: 'key', code: 'Space' }, color: 'bg-orange-600/30' },
  { id: 'alt-1', label: 'Alt+1', action: { type: 'combo', codes: ['AltLeft', 'Digit1'] }, color: 'bg-purple-600/30' },
  { id: 'alt-2', label: 'Alt+2', action: { type: 'combo', codes: ['AltLeft', 'Digit2'] }, color: 'bg-purple-600/30' },
  { id: 'rclick', label: 'R-Click', icon: '🖱️', action: { type: 'click', button: 'right' }, color: 'bg-red-600/30' },
  { id: 'mclick', label: 'M-Click', icon: '🖱️', action: { type: 'click', button: 'middle' }, color: 'bg-yellow-600/30' },
  { id: 'ctrl-c', label: 'Ctrl+C', action: { type: 'combo', codes: ['ControlLeft', 'KeyC'] }, color: 'bg-blue-600/30' },
  { id: 'ctrl-v', label: 'Ctrl+V', action: { type: 'combo', codes: ['ControlLeft', 'KeyV'] }, color: 'bg-blue-600/30' },
  { id: 'ctrl-z', label: 'Ctrl+Z', action: { type: 'combo', codes: ['ControlLeft', 'KeyZ'] }, color: 'bg-blue-600/30' },
  { id: 'ctrl-a', label: 'Ctrl+A', action: { type: 'combo', codes: ['ControlLeft', 'KeyA'] }, color: 'bg-blue-600/30' },
  { id: 'alt-tab', label: 'Alt+Tab', action: { type: 'combo', codes: ['AltLeft', 'Tab'] }, color: 'bg-purple-600/30' },
  { id: 'alt-f4', label: 'Alt+F4', action: { type: 'combo', codes: ['AltLeft', 'F4'] }, color: 'bg-red-600/30' },
  { id: 'del', label: 'Del', action: { type: 'key', code: 'Delete' } },
  { id: 'backspace', label: '←', action: { type: 'key', code: 'Backspace' } },
  { id: 'f5', label: 'F5', action: { type: 'key', code: 'F5' } },
  { id: 'f11', label: 'F11', action: { type: 'key', code: 'F11' } },
]

const STORAGE_KEY = 'ideality_custom_buttons'

const MODE_COLORS = {
  L: 'bg-gray-600 text-gray-200',
  R: 'bg-red-600 text-white',
  E: 'bg-green-600 text-white',
}

export default function VirtualButtons({ onAction, visible, onToggle, mouseMode, onMouseModeChange }: VirtualButtonsProps) {
  const [buttons, setButtons] = useState<VirtualButton[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : DEFAULT_BUTTONS
    } catch { return DEFAULT_BUTTONS }
  })
  const [editing, setEditing] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newAction, setNewAction] = useState('')
  const [newType, setNewType] = useState<'key' | 'combo' | 'text'>('key')

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buttons))
  }, [buttons])

  const handlePress = useCallback((btn: VirtualButton) => {
    onAction(btn.action)
  }, [onAction])

  const handleAdd = useCallback(() => {
    if (!newLabel || !newAction) return
    let action: ButtonAction
    if (newType === 'combo') {
      action = { type: 'combo', codes: newAction.split('+').map((s) => s.trim()) }
    } else if (newType === 'text') {
      action = { type: 'text', text: newAction }
    } else {
      action = { type: 'key', code: newAction }
    }
    setButtons((prev) => [...prev, { id: `custom-${Date.now()}`, label: newLabel, action }])
    setNewLabel('')
    setNewAction('')
    setShowAdd(false)
  }, [newLabel, newAction, newType])

  const handleRemove = useCallback((id: string) => {
    setButtons((prev) => prev.filter((b) => b.id !== id))
  }, [])

  const handleReset = useCallback(() => {
    setButtons(DEFAULT_BUTTONS)
  }, [])

  if (!visible) {
    return (
      <button
        onClick={onToggle}
        className="fixed bottom-4 right-4 w-10 h-10 bg-gray-800 border border-gray-600 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 z-50 shadow-lg"
        title="Virtual buttons"
      >⌨</button>
    )
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-800/95 backdrop-blur border-t border-gray-700 z-50 safe-area-bottom">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-gray-700">
        <span className="text-[10px] text-gray-400">Virtual Buttons</span>
        <div className="flex gap-1">
          <button onClick={() => setEditing(!editing)}
            className={`px-1.5 py-0.5 rounded text-[10px] ${editing ? 'bg-blue-600 text-white' : 'text-gray-400'}`}>
            {editing ? 'Done' : 'Edit'}
          </button>
          <button onClick={onToggle} className="text-gray-400 hover:text-white px-1">▼</button>
        </div>
      </div>

      {/* Buttons grid + mouse mode toggle */}
      <div className="flex gap-1 p-2">
        <div className="flex flex-wrap gap-1 flex-1 max-h-32 overflow-y-auto">
          {buttons.map((btn) => (
            <div key={btn.id} className="relative">
              <button
                onTouchStart={(e) => { e.stopPropagation(); handlePress(btn) }}
                onMouseDown={(e) => { e.stopPropagation(); handlePress(btn) }}
                className={`px-2.5 py-1.5 rounded text-xs font-medium select-none active:scale-95 transition-transform ${
                  btn.color || 'bg-gray-700/50'
                } text-gray-200 hover:brightness-125 border border-gray-600/50`}
              >
                {btn.icon ? `${btn.icon} ${btn.label}` : btn.label}
              </button>
              {editing && !FIXED_BUTTON_IDS.has(btn.id) && (
                <button onClick={() => handleRemove(btn.id)}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 rounded-full text-[8px] text-white flex items-center justify-center">✕</button>
              )}
            </div>
          ))}
          {editing && (
            <button onClick={() => setShowAdd(true)}
              className="px-2.5 py-1.5 rounded text-xs border border-dashed border-gray-500 text-gray-500 hover:text-white hover:border-white">+ Add</button>
          )}
        </div>

        {/* Mouse mode toggle — 우측 고정, 크게 */}
        <button
          onPointerUp={(e) => { e.stopPropagation(); onMouseModeChange() }}
          onTouchStart={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className={`w-14 h-14 rounded-lg flex flex-col items-center justify-center text-lg font-bold shadow-lg border select-none flex-shrink-0 active:scale-95 transition-transform ${MODE_COLORS[mouseMode]}`}
          title={mouseMode === 'L' ? 'Left Click' : mouseMode === 'R' ? 'Right Click' : 'E-Key'}
        >
          {mouseMode}
          <span className="text-[8px] font-normal opacity-70">
            {mouseMode === 'L' ? 'Click' : mouseMode === 'R' ? 'R-Click' : 'E-Key'}
          </span>
        </button>
      </div>

      {/* Add dialog */}
      {showAdd && (
        <div className="p-2 border-t border-gray-700 space-y-2">
          <div className="flex gap-1">
            {(['key', 'combo', 'text'] as const).map((t) => (
              <button key={t} onClick={() => setNewType(t)}
                className={`px-2 py-0.5 rounded text-[10px] ${newType === t ? 'bg-blue-600' : 'bg-gray-700'}`}>{t}</button>
            ))}
          </div>
          <div className="flex gap-1">
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Label" className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs" />
            <input value={newAction} onChange={(e) => setNewAction(e.target.value)}
              placeholder={newType === 'combo' ? 'ControlLeft+KeyC' : newType === 'text' ? 'Hello' : 'F5'}
              className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs" />
            <button onClick={handleAdd} className="px-2 py-1 bg-blue-600 rounded text-xs">Add</button>
            <button onClick={() => setShowAdd(false)} className="px-2 py-1 bg-gray-700 rounded text-xs">Cancel</button>
          </div>
          <button onClick={handleReset} className="text-[10px] text-gray-500 hover:text-red-400">Reset to defaults</button>
        </div>
      )}
    </div>
  )
}
