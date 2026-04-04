// 가상 버튼 패널 — 매크로, 키보드, 숫자패드, 마우스 모드
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

type PanelTab = 'macro' | 'keyboard' | 'numpad'

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
  { id: 'rclick', label: 'R-Click', action: { type: 'click', button: 'right' }, color: 'bg-red-600/30' },
  { id: 'mclick', label: 'M-Click', action: { type: 'click', button: 'middle' }, color: 'bg-yellow-600/30' },
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

// Keyboard layouts
const KB_ROW1 = 'QWERTYUIOP'.split('').map((c) => ({ label: c, code: `Key${c}` }))
const KB_ROW2 = 'ASDFGHJKL'.split('').map((c) => ({ label: c, code: `Key${c}` }))
const KB_ROW3 = 'ZXCVBNM'.split('').map((c) => ({ label: c, code: `Key${c}` }))

const NUM_KEYS = [
  ['7','8','9'], ['4','5','6'], ['1','2','3'], ['0','.','-']
]

export default function VirtualButtons({ onAction, visible, onToggle, mouseMode, onMouseModeChange }: VirtualButtonsProps) {
  const [buttons, setButtons] = useState<VirtualButton[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : DEFAULT_BUTTONS
    } catch { return DEFAULT_BUTTONS }
  })
  const [panelTab, setPanelTab] = useState<PanelTab>('macro')
  const [editing, setEditing] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newAction, setNewAction] = useState('')
  const [newType, setNewType] = useState<'key' | 'combo' | 'text'>('key')
  const [shift, setShift] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buttons))
  }, [buttons])

  const pressKey = useCallback((code: string) => {
    if (shift) {
      onAction({ type: 'combo', codes: ['ShiftLeft', code] })
      setShift(false)
    } else {
      onAction({ type: 'key', code })
    }
  }, [onAction, shift])

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
    setNewLabel(''); setNewAction(''); setShowAdd(false)
  }, [newLabel, newAction, newType])

  if (!visible) {
    return (
      <button onClick={onToggle}
        className="fixed bottom-4 right-4 w-10 h-10 bg-gray-800 border border-gray-600 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 z-50 shadow-lg">
        ⌨
      </button>
    )
  }

  const KeyBtn = ({ label, code, wide }: { label: string; code: string; wide?: boolean }) => (
    <button
      onTouchStart={(e) => { e.stopPropagation(); pressKey(code) }}
      onMouseDown={(e) => { e.stopPropagation(); pressKey(code) }}
      className={`${wide ? 'px-3' : 'px-1.5'} py-2 rounded text-xs font-medium bg-gray-700/60 text-gray-200 active:bg-gray-500 border border-gray-600/50 select-none min-w-[28px] text-center`}
    >{label}</button>
  )

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-800/95 backdrop-blur border-t border-gray-700 z-50 safe-area-bottom">
      {/* Tab bar */}
      <div className="flex items-center border-b border-gray-700">
        <div className="flex flex-1">
          {(['macro', 'keyboard', 'numpad'] as PanelTab[]).map((t) => (
            <button key={t} onClick={() => setPanelTab(t)}
              className={`px-3 py-1 text-[10px] ${panelTab === t ? 'text-white border-b-2 border-blue-500' : 'text-gray-500'}`}>
              {t === 'macro' ? '⚡ Macro' : t === 'keyboard' ? '⌨ ABC' : '🔢 123'}
            </button>
          ))}
        </div>
        <div className="flex gap-1 px-1">
          {panelTab === 'macro' && (
            <button onClick={() => setEditing(!editing)}
              className={`px-1.5 py-0.5 rounded text-[10px] ${editing ? 'bg-blue-600 text-white' : 'text-gray-400'}`}>
              {editing ? 'Done' : 'Edit'}
            </button>
          )}
          <button onClick={onToggle} className="text-gray-400 hover:text-white px-1 text-xs">▼</button>
        </div>
      </div>

      <div className="flex gap-1 p-1.5">
        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Macro tab */}
          {panelTab === 'macro' && (
            <>
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                {buttons.map((btn) => (
                  <div key={btn.id} className="relative">
                    <button
                      onTouchStart={(e) => { e.stopPropagation(); handlePress(btn) }}
                      onMouseDown={(e) => { e.stopPropagation(); handlePress(btn) }}
                      className={`px-2 py-1.5 rounded text-[11px] font-medium select-none active:scale-95 ${btn.color || 'bg-gray-700/50'} text-gray-200 border border-gray-600/50`}>
                      {btn.icon ? `${btn.icon} ${btn.label}` : btn.label}
                    </button>
                    {editing && !FIXED_BUTTON_IDS.has(btn.id) && (
                      <button onClick={() => setButtons((p) => p.filter((b) => b.id !== btn.id))}
                        className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-600 rounded-full text-[7px] text-white flex items-center justify-center">✕</button>
                    )}
                  </div>
                ))}
                {editing && (
                  <button onClick={() => setShowAdd(true)}
                    className="px-2 py-1.5 rounded text-[11px] border border-dashed border-gray-500 text-gray-500">+ Add</button>
                )}
              </div>
              {showAdd && (
                <div className="mt-1 flex gap-1 flex-wrap">
                  <div className="flex gap-0.5">
                    {(['key', 'combo', 'text'] as const).map((t) => (
                      <button key={t} onClick={() => setNewType(t)}
                        className={`px-1.5 py-0.5 rounded text-[9px] ${newType === t ? 'bg-blue-600' : 'bg-gray-700'}`}>{t}</button>
                    ))}
                  </div>
                  <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="Label" className="w-16 bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-[10px]" />
                  <input value={newAction} onChange={(e) => setNewAction(e.target.value)}
                    placeholder="Code" className="w-24 bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-[10px]" />
                  <button onClick={handleAdd} className="px-1.5 py-0.5 bg-blue-600 rounded text-[10px]">+</button>
                  <button onClick={() => setShowAdd(false)} className="px-1.5 py-0.5 bg-gray-700 rounded text-[10px]">✕</button>
                  <button onClick={() => setButtons(DEFAULT_BUTTONS)} className="text-[9px] text-gray-500">Reset</button>
                </div>
              )}
            </>
          )}

          {/* Keyboard tab */}
          {panelTab === 'keyboard' && (
            <div className="space-y-1">
              <div className="flex gap-0.5 justify-center">
                {KB_ROW1.map((k) => <KeyBtn key={k.code} label={shift ? k.label : k.label.toLowerCase()} code={k.code} />)}
              </div>
              <div className="flex gap-0.5 justify-center">
                {KB_ROW2.map((k) => <KeyBtn key={k.code} label={shift ? k.label : k.label.toLowerCase()} code={k.code} />)}
              </div>
              <div className="flex gap-0.5 justify-center">
                <button onMouseDown={(e) => { e.stopPropagation(); setShift(!shift) }}
                  onTouchStart={(e) => { e.stopPropagation(); setShift(!shift) }}
                  className={`px-2 py-2 rounded text-[10px] font-medium select-none border border-gray-600/50 ${shift ? 'bg-blue-600 text-white' : 'bg-gray-700/60 text-gray-400'}`}>
                  ⇧
                </button>
                {KB_ROW3.map((k) => <KeyBtn key={k.code} label={shift ? k.label : k.label.toLowerCase()} code={k.code} />)}
                <KeyBtn label="←" code="Backspace" wide />
              </div>
              <div className="flex gap-0.5 justify-center">
                <KeyBtn label="Ctrl" code="ControlLeft" wide />
                <KeyBtn label="Alt" code="AltLeft" wide />
                <button onTouchStart={(e) => { e.stopPropagation(); pressKey('Space') }}
                  onMouseDown={(e) => { e.stopPropagation(); pressKey('Space') }}
                  className="flex-1 py-2 rounded text-xs bg-gray-700/60 text-gray-200 active:bg-gray-500 border border-gray-600/50 select-none">
                  Space
                </button>
                <KeyBtn label="Enter" code="Enter" wide />
              </div>
            </div>
          )}

          {/* Numpad tab */}
          {panelTab === 'numpad' && (
            <div className="space-y-1">
              {NUM_KEYS.map((row, i) => (
                <div key={i} className="flex gap-0.5 justify-center">
                  {row.map((k) => (
                    <button key={k}
                      onTouchStart={(e) => { e.stopPropagation(); pressKey(k >= '0' && k <= '9' ? `Digit${k}` : k === '.' ? 'Period' : 'Minus') }}
                      onMouseDown={(e) => { e.stopPropagation(); pressKey(k >= '0' && k <= '9' ? `Digit${k}` : k === '.' ? 'Period' : 'Minus') }}
                      className="w-12 py-2.5 rounded text-sm font-medium bg-gray-700/60 text-gray-200 active:bg-gray-500 border border-gray-600/50 select-none text-center">
                      {k}
                    </button>
                  ))}
                </div>
              ))}
              <div className="flex gap-0.5 justify-center">
                <KeyBtn label="←" code="Backspace" wide />
                <KeyBtn label="Enter" code="Enter" wide />
                <KeyBtn label="Tab" code="Tab" wide />
              </div>
            </div>
          )}
        </div>

        {/* Mouse mode toggle — right side */}
        <button
          onPointerUp={(e) => { e.stopPropagation(); onMouseModeChange() }}
          onTouchStart={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className={`w-12 rounded-lg flex flex-col items-center justify-center text-lg font-bold shadow-lg border select-none flex-shrink-0 active:scale-95 ${MODE_COLORS[mouseMode]}`}
          title={mouseMode === 'L' ? 'Left Click' : mouseMode === 'R' ? 'Right Click' : 'E-Key'}>
          {mouseMode}
          <span className="text-[7px] font-normal opacity-70">
            {mouseMode === 'L' ? 'Click' : mouseMode === 'R' ? 'R-Click' : 'E-Key'}
          </span>
        </button>
      </div>
    </div>
  )
}
