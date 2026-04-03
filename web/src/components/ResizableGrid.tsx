import { useCallback, useEffect, useRef, useState } from 'react'

interface ResizableGridProps {
  cols: number
  rows: number
  children: React.ReactNode[]
}

export default function ResizableGrid({ cols, rows, children }: ResizableGridProps) {
  const [colSizes, setColSizes] = useState<number[]>(() => Array(cols).fill(1 / cols))
  const [rowSizes, setRowSizes] = useState<number[]>(() => Array(rows).fill(1 / rows))
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef<{ type: 'col' | 'row'; index: number } | null>(null)

  // Reset when grid dimensions change
  useEffect(() => { setColSizes(Array(cols).fill(1 / cols)) }, [cols])
  useEffect(() => { setRowSizes(Array(rows).fill(1 / rows)) }, [rows])

  const handleMouseDown = useCallback((type: 'col' | 'row', index: number) => {
    dragging.current = { type, index }
    document.body.style.cursor = type === 'col' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const { type, index } = dragging.current

      if (type === 'col') {
        const ratio = (e.clientX - rect.left) / rect.width
        setColSizes((prev) => {
          const next = [...prev]
          let cum = 0
          for (let i = 0; i <= index; i++) cum += prev[i]
          const newLeft = Math.max(0.1, Math.min(ratio, cum + prev[index + 1] - 0.1))
          next[index] = prev[index] + (newLeft - cum)
          next[index + 1] = prev[index + 1] - (newLeft - cum)
          return next
        })
      } else {
        const ratio = (e.clientY - rect.top) / rect.height
        setRowSizes((prev) => {
          const next = [...prev]
          let cum = 0
          for (let i = 0; i <= index; i++) cum += prev[i]
          const newTop = Math.max(0.1, Math.min(ratio, cum + prev[index + 1] - 0.1))
          next[index] = prev[index] + (newTop - cum)
          next[index + 1] = prev[index + 1] - (newTop - cum)
          return next
        })
      }
    }

    const onUp = () => {
      dragging.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // Use fr units for proper grid sizing
  const gridTemplateColumns = colSizes.map((s) => `${s}fr`).join(' ')
  const gridTemplateRows = rowSizes.map((s) => `${s}fr`).join(' ')

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden">
      <div
        className="w-full h-full"
        style={{
          display: 'grid',
          gridTemplateColumns,
          gridTemplateRows,
          gap: '2px',
        }}
      >
        {children.map((child, i) => (
          <div key={i} className="overflow-hidden min-w-0 min-h-0">
            {child}
          </div>
        ))}
      </div>

      {/* Column dividers */}
      {Array.from({ length: cols - 1 }, (_, i) => {
        let left = 0
        for (let j = 0; j <= i; j++) left += colSizes[j]
        const totalFr = colSizes.reduce((a, b) => a + b, 0)
        const pct = (left / totalFr) * 100
        return (
          <div
            key={`col-${i}`}
            className="absolute top-0 bottom-0 w-3 -ml-1.5 cursor-col-resize z-10 group"
            style={{ left: `${pct}%` }}
            onMouseDown={() => handleMouseDown('col', i)}
          >
            <div className="w-0.5 h-full mx-auto bg-transparent group-hover:bg-blue-500 transition-colors" />
          </div>
        )
      })}

      {/* Row dividers */}
      {Array.from({ length: rows - 1 }, (_, i) => {
        let top = 0
        for (let j = 0; j <= i; j++) top += rowSizes[j]
        const totalFr = rowSizes.reduce((a, b) => a + b, 0)
        const pct = (top / totalFr) * 100
        return (
          <div
            key={`row-${i}`}
            className="absolute left-0 right-0 h-3 -mt-1.5 cursor-row-resize z-10 group"
            style={{ top: `${pct}%` }}
            onMouseDown={() => handleMouseDown('row', i)}
          >
            <div className="h-0.5 w-full my-auto bg-transparent group-hover:bg-blue-500 transition-colors" />
          </div>
        )
      })}
    </div>
  )
}
