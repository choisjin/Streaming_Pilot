// L/R/E 마우스 모드 토글 — 드래그로 위치 이동 가능
import { useState, useRef, useCallback, useEffect } from 'react'

type InputMode = 'L' | 'R' | 'E'
const MODES: InputMode[] = ['L', 'R', 'E']
const MODE_COLORS: Record<InputMode, string> = {
  L: 'bg-gray-800/80 border-gray-600 text-gray-300',
  R: 'bg-red-600/80 border-red-400 text-white',
  E: 'bg-green-600/80 border-green-400 text-white',
}

interface MouseSwapButtonProps {
  streamId: number
}

export default function MouseSwapButton({ streamId }: MouseSwapButtonProps) {
  const [mode, setMode] = useState<InputMode>('L')
  const [pos, setPos] = useState(() => {
    try {
      const saved = localStorage.getItem(`mouseSwapPos_${streamId}`)
      return saved ? JSON.parse(saved) : { x: 16, y: 80 }
    } catch { return { x: 16, y: 80 } }
  })
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 })
  const didDrag = useRef(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>()

  // Sync mode to panel data attribute
  useEffect(() => {
    const panel = document.querySelector(`[data-stream-id="${streamId}"]`) as HTMLElement
    if (panel) {
      const inputArea = panel.querySelector('[data-mouse-lock]') as HTMLElement
      if (inputArea) {
        inputArea.dataset.mouseSwap = mode === 'R' ? 'true' : 'false'
        inputArea.dataset.mouseMode = mode
      }
    }
  }, [mode, streamId])

  useEffect(() => {
    localStorage.setItem(`mouseSwapPos_${streamId}`, JSON.stringify(pos))
  }, [pos, streamId])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    didDrag.current = false
    dragStart.current = { x: e.clientX, y: e.clientY, posX: pos.x, posY: pos.y }
    longPressTimer.current = setTimeout(() => {
      dragging.current = true
      didDrag.current = true
    }, 300)
  }, [pos])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) {
        const dx = e.clientX - dragStart.current.x
        const dy = e.clientY - dragStart.current.y
        if (Math.abs(dx) + Math.abs(dy) > 10) {
          if (longPressTimer.current) clearTimeout(longPressTimer.current)
          dragging.current = true
          didDrag.current = true
        }
        return
      }
      setPos({
        x: Math.max(0, dragStart.current.posX + (e.clientX - dragStart.current.x)),
        y: Math.max(0, dragStart.current.posY + (e.clientY - dragStart.current.y)),
      })
    }
    const onUp = () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current)
      dragging.current = false
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  const handleClick = useCallback(() => {
    if (didDrag.current) return
    setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length])
  }, [])

  return (
    <button
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      className={`fixed z-40 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shadow-lg border select-none touch-none ${MODE_COLORS[mode]}`}
      style={{ left: pos.x, top: pos.y }}
      title={
        mode === 'L' ? 'Left Click mode' :
        mode === 'R' ? 'Right Click mode' :
        'E-Key mode: tap to move + press E'
      }
    >
      {mode}
    </button>
  )
}
