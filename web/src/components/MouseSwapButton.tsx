// L/R 마우스 버튼 스왑 토글 — 드래그로 위치 이동 가능
import { useState, useRef, useCallback, useEffect } from 'react'

interface MouseSwapButtonProps {
  streamId: number
}

export default function MouseSwapButton({ streamId }: MouseSwapButtonProps) {
  const [swapped, setSwapped] = useState(false)
  const [pos, setPos] = useState(() => {
    try {
      const saved = localStorage.getItem(`mouseSwapPos_${streamId}`)
      return saved ? JSON.parse(saved) : { x: 16, y: 80 }
    } catch {
      return { x: 16, y: 80 }
    }
  })
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 })
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>()
  const didDrag = useRef(false)

  // Sync swap state to panel's data attribute
  useEffect(() => {
    const panel = document.querySelector(`[data-stream-id="${streamId}"]`) as HTMLElement
    if (panel) {
      const inputArea = panel.querySelector('[data-mouse-lock]') as HTMLElement
      if (inputArea) inputArea.dataset.mouseSwap = swapped ? 'true' : 'false'
    }
  }, [swapped, streamId])

  // Save position
  useEffect(() => {
    localStorage.setItem(`mouseSwapPos_${streamId}`, JSON.stringify(pos))
  }, [pos, streamId])

  // Drag start (long press)
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
        // Check if moved enough to start drag immediately
        const dx = e.clientX - dragStart.current.x
        const dy = e.clientY - dragStart.current.y
        if (Math.abs(dx) + Math.abs(dy) > 10) {
          if (longPressTimer.current) clearTimeout(longPressTimer.current)
          dragging.current = true
          didDrag.current = true
        }
        return
      }
      const dx = e.clientX - dragStart.current.x
      const dy = e.clientY - dragStart.current.y
      setPos({
        x: Math.max(0, dragStart.current.posX + dx),
        y: Math.max(0, dragStart.current.posY + dy),
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
    if (didDrag.current) return // Ignore click after drag
    setSwapped((s) => !s)
  }, [])

  return (
    <button
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      className={`fixed z-40 w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shadow-lg border select-none touch-none ${
        swapped
          ? 'bg-red-600/80 border-red-400 text-white'
          : 'bg-gray-800/80 border-gray-600 text-gray-300'
      }`}
      style={{ left: pos.x, top: pos.y }}
      title={swapped ? 'Mouse: R=Click, L=Context (tap to swap back)' : 'Mouse: L=Click, R=Context (tap to swap)'}
    >
      {swapped ? 'R' : 'L'}
    </button>
  )
}
