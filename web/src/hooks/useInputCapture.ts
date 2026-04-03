// 마우스/키보드 이벤트 캡처 → WebSocket으로 호스트에 전송
import { useCallback, useEffect, useRef } from 'react'

const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const WS_URL = `${wsProto}//${window.location.host}/ws/input`

export function useInputCapture(streamId: number) {
  const wsRef = useRef<WebSocket | null>(null)
  const elRef = useRef<HTMLDivElement | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  // WebSocket 연결
  useEffect(() => {
    const ws = new WebSocket(WS_URL)
    ws.onopen = () => console.log('Input WS connected')
    ws.onclose = () => console.log('Input WS closed')
    wsRef.current = ws
    return () => { ws.close(); wsRef.current = null }
  }, [])

  const send = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ ...msg, streamId }))
    }
  }, [streamId])

  // Bind/unbind events when element changes
  const bindPanel = useCallback((el: HTMLDivElement | null) => {
    // Cleanup previous
    if (cleanupRef.current) {
      cleanupRef.current()
      cleanupRef.current = null
    }
    elRef.current = el
    if (!el) return

    const getPos = (e: MouseEvent) => {
      // Find video element inside panel
      const video = el.querySelector('video')
      if (!video || !video.videoWidth || !video.videoHeight) {
        const r = el.getBoundingClientRect()
        return { x: e.clientX - r.left, y: e.clientY - r.top, panelW: r.width, panelH: r.height }
      }

      // Calculate actual video display area (accounting for object-fit: contain)
      const r = video.getBoundingClientRect()
      const videoAspect = video.videoWidth / video.videoHeight
      const containerAspect = r.width / r.height

      let videoX: number, videoY: number, videoW: number, videoH: number

      if (videoAspect > containerAspect) {
        // Video wider than container → letterbox top/bottom
        videoW = r.width
        videoH = r.width / videoAspect
        videoX = r.left
        videoY = r.top + (r.height - videoH) / 2
      } else {
        // Video taller → pillarbox left/right
        videoH = r.height
        videoW = r.height * videoAspect
        videoX = r.left + (r.width - videoW) / 2
        videoY = r.top
      }

      // Mouse position relative to actual video area
      const x = e.clientX - videoX
      const y = e.clientY - videoY

      return { x, y, panelW: videoW, panelH: videoH }
    }

    let lastMove = 0
    const onMouseMove = (e: MouseEvent) => {
      const now = performance.now()
      if (now - lastMove < 16) return
      lastMove = now
      send({ type: 'mouse_move', ...getPos(e) })
    }

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault()
      el.focus()
      // Pointer Lock (마우스 가두기) — 클릭 시 활성화
      if (!document.pointerLockElement && el.dataset.mouseLock === 'true') {
        el.requestPointerLock()
      }
      // Skip input if disabled
      if (el.style.cursor === 'not-allowed') return
      const btn = e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'middle'
      send({ type: 'mouse_click', button: btn, action: 'down', ...getPos(e) })
    }

    const onMouseUp = (e: MouseEvent) => {
      const btn = e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'middle'
      send({ type: 'mouse_click', button: btn, action: 'up', ...getPos(e) })
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      send({ type: 'mouse_wheel', delta: -e.deltaY })
    }

    const onCtx = (e: Event) => e.preventDefault()

    // --- Touch support ---
    let touchTimer: ReturnType<typeof setTimeout> | null = null
    let lastTouchPos = { x: 0, y: 0 }
    let touchStartTime = 0
    let twoFingerY = 0

    const getTouchPos = (t: Touch) => {
      const r = el.getBoundingClientRect()
      const video = el.querySelector('video')
      if (!video || !video.videoWidth) return { x: t.clientX - r.left, y: t.clientY - r.top, panelW: r.width, panelH: r.height }
      const va = video.videoWidth / video.videoHeight
      const ca = r.width / r.height
      let vx: number, vy: number, vw: number, vh: number
      if (va > ca) { vw = r.width; vh = r.width / va; vx = r.left; vy = r.top + (r.height - vh) / 2 }
      else { vh = r.height; vw = r.height * va; vx = r.left + (r.width - vw) / 2; vy = r.top }
      return { x: t.clientX - vx, y: t.clientY - vy, panelW: vw, panelH: vh }
    }

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault()
      el.focus()
      if (el.style.cursor === 'not-allowed') return

      if (e.touches.length === 1) {
        const pos = getTouchPos(e.touches[0])
        lastTouchPos = pos
        touchStartTime = Date.now()
        // Move mouse to touch position
        send({ type: 'mouse_move', ...pos })
        // Long press → right click (500ms)
        touchTimer = setTimeout(() => {
          send({ type: 'mouse_click', button: 'right', action: 'click', ...pos })
          touchTimer = null
        }, 500)
      } else if (e.touches.length === 2) {
        // Two-finger: scroll
        if (touchTimer) { clearTimeout(touchTimer); touchTimer = null }
        twoFingerY = (e.touches[0].clientY + e.touches[1].clientY) / 2
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      if (e.touches.length === 1) {
        // Cancel long press on move
        if (touchTimer) { clearTimeout(touchTimer); touchTimer = null }
        const pos = getTouchPos(e.touches[0])
        lastTouchPos = pos
        send({ type: 'mouse_move', ...pos })
      } else if (e.touches.length === 2) {
        const newY = (e.touches[0].clientY + e.touches[1].clientY) / 2
        const delta = (twoFingerY - newY) * 3
        if (Math.abs(delta) > 5) {
          send({ type: 'mouse_wheel', delta })
          twoFingerY = newY
        }
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault()
      if (touchTimer) {
        clearTimeout(touchTimer)
        touchTimer = null
        // Short tap = left click
        if (Date.now() - touchStartTime < 300) {
          send({ type: 'mouse_click', button: 'left', action: 'click', ...lastTouchPos })
        }
      }
    }

    // e.code가 빈 경우 e.key + e.location으로 추정
    const resolveCode = (e: KeyboardEvent): string => {
      if (e.code) return e.code

      const loc = e.location // 0=standard, 1=left, 2=right, 3=numpad
      const key = e.key

      // Modifier keys
      if (key === 'Shift') return loc === 2 ? 'ShiftRight' : 'ShiftLeft'
      if (key === 'Control') return loc === 2 ? 'ControlRight' : 'ControlLeft'
      if (key === 'Alt') return loc === 2 ? 'AltRight' : 'AltLeft'
      if (key === 'Meta') return loc === 2 ? 'MetaRight' : 'MetaLeft'

      // Common keys by e.key
      if (key === 'Enter') return loc === 3 ? 'NumpadEnter' : 'Enter'
      if (key === 'Backspace') return 'Backspace'
      if (key === 'Tab') return 'Tab'
      if (key === 'Escape') return 'Escape'
      if (key === 'Delete') return 'Delete'
      if (key === ' ') return 'Space'
      if (key === 'ArrowUp') return 'ArrowUp'
      if (key === 'ArrowDown') return 'ArrowDown'
      if (key === 'ArrowLeft') return 'ArrowLeft'
      if (key === 'ArrowRight') return 'ArrowRight'
      if (key === 'Home') return 'Home'
      if (key === 'End') return 'End'
      if (key === 'PageUp') return 'PageUp'
      if (key === 'PageDown') return 'PageDown'
      if (key === 'Insert') return 'Insert'
      if (key === 'CapsLock') return 'CapsLock'
      if (key === 'HangulMode' || key === 'Hangul') return 'Lang1'
      if (key === 'Hanja') return 'Lang2'
      if (key === 'Process') return 'Lang1' // IME 처리 중 한영키

      // F keys
      const fMatch = key.match(/^F(\d+)$/)
      if (fMatch) return `F${fMatch[1]}`

      // Single char → KeyX or DigitX
      if (key.length === 1) {
        const upper = key.toUpperCase()
        if (upper >= 'A' && upper <= 'Z') return `Key${upper}`
        if (upper >= '0' && upper <= '9') return `Digit${upper}`
      }

      // Last resort: keyCode fallback
      const kcMap: Record<number, string> = {
        8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: loc === 2 ? 'ShiftRight' : 'ShiftLeft',
        17: loc === 2 ? 'ControlRight' : 'ControlLeft', 18: loc === 2 ? 'AltRight' : 'AltLeft',
        19: 'Pause', 20: 'CapsLock', 27: 'Escape', 32: 'Space',
        33: 'PageUp', 34: 'PageDown', 35: 'End', 36: 'Home',
        37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown',
        45: 'Insert', 46: 'Delete',
        48: 'Digit0', 49: 'Digit1', 50: 'Digit2', 51: 'Digit3', 52: 'Digit4',
        53: 'Digit5', 54: 'Digit6', 55: 'Digit7', 56: 'Digit8', 57: 'Digit9',
        65: 'KeyA', 66: 'KeyB', 67: 'KeyC', 68: 'KeyD', 69: 'KeyE',
        70: 'KeyF', 71: 'KeyG', 72: 'KeyH', 73: 'KeyI', 74: 'KeyJ',
        75: 'KeyK', 76: 'KeyL', 77: 'KeyM', 78: 'KeyN', 79: 'KeyO',
        80: 'KeyP', 81: 'KeyQ', 82: 'KeyR', 83: 'KeyS', 84: 'KeyT',
        85: 'KeyU', 86: 'KeyV', 87: 'KeyW', 88: 'KeyX', 89: 'KeyY', 90: 'KeyZ',
        91: 'MetaLeft', 92: 'MetaRight',
        112: 'F1', 113: 'F2', 114: 'F3', 115: 'F4', 116: 'F5', 117: 'F6',
        118: 'F7', 119: 'F8', 120: 'F9', 121: 'F10', 122: 'F11', 123: 'F12',
        144: 'NumLock', 145: 'ScrollLock',
        186: 'Semicolon', 187: 'Equal', 188: 'Comma', 189: 'Minus',
        190: 'Period', 191: 'Slash', 192: 'Backquote',
        219: 'BracketLeft', 220: 'Backslash', 221: 'BracketRight', 222: 'Quote',
        229: 'Lang1', // IME processing (한영키)
      }
      return kcMap[e.keyCode] ?? ''
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // CapsLock → 마우스 가두기 토글
      if (e.code === 'CapsLock' || resolveCode(e) === 'CapsLock') {
        if (document.pointerLockElement) {
          document.exitPointerLock()
        } else if (el.dataset.mouseLock === 'true') {
          el.requestPointerLock()
        }
        e.preventDefault()
        return  // CapsLock은 원격에 전달하지 않음
      }
      e.preventDefault()
      e.stopPropagation()
      const code = resolveCode(e)
      if (code) send({ type: 'key', code, action: 'down' })
    }

    const onKeyUp = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const code = resolveCode(e)
      if (code) send({ type: 'key', code, action: 'up' })
    }

    el.tabIndex = 0
    el.addEventListener('mousemove', onMouseMove)
    el.addEventListener('mousedown', onMouseDown)
    el.addEventListener('mouseup', onMouseUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('contextmenu', onCtx)
    el.addEventListener('keydown', onKeyDown)
    el.addEventListener('keyup', onKeyUp)
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: false })

    cleanupRef.current = () => {
      el.removeEventListener('mousemove', onMouseMove)
      el.removeEventListener('mousedown', onMouseDown)
      el.removeEventListener('mouseup', onMouseUp)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('contextmenu', onCtx)
      el.removeEventListener('keydown', onKeyDown)
      el.removeEventListener('keyup', onKeyUp)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [send])

  // Cleanup on unmount
  useEffect(() => {
    return () => { if (cleanupRef.current) cleanupRef.current() }
  }, [])

  // Virtual button action handler
  const sendAction = useCallback((action: {
    type: 'click' | 'key' | 'combo' | 'text'
    button?: string
    code?: string
    codes?: string[]
    text?: string
  }) => {
    if (action.type === 'click') {
      send({ type: 'mouse_click', button: action.button, action: 'click', x: 0, y: 0, panelW: 1, panelH: 1 })
    } else if (action.type === 'key') {
      send({ type: 'key', code: action.code, action: 'down' })
      setTimeout(() => send({ type: 'key', code: action.code, action: 'up' }), 50)
    } else if (action.type === 'combo') {
      const codes = action.codes ?? []
      // Press all keys
      codes.forEach((code, i) => {
        setTimeout(() => send({ type: 'key', code, action: 'down' }), i * 30)
      })
      // Release all keys (reverse order)
      setTimeout(() => {
        codes.reverse().forEach((code, i) => {
          setTimeout(() => send({ type: 'key', code, action: 'up' }), i * 30)
        })
      }, codes.length * 30 + 50)
    } else if (action.type === 'text') {
      const chars = action.text ?? ''
      for (let i = 0; i < chars.length; i++) {
        const c = chars[i]
        const code = c >= 'a' && c <= 'z' ? `Key${c.toUpperCase()}` :
                     c >= 'A' && c <= 'Z' ? `Key${c}` :
                     c >= '0' && c <= '9' ? `Digit${c}` :
                     c === ' ' ? 'Space' : ''
        if (code) {
          setTimeout(() => {
            send({ type: 'key', code, action: 'down' })
            setTimeout(() => send({ type: 'key', code, action: 'up' }), 30)
          }, i * 60)
        }
      }
    }
  }, [send])

  return { bindPanel, sendAction }
}
