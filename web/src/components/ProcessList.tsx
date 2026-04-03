// 프로세스 선택 UI — 윈도우가 있는 프로세스 목록 표시 + 스트림 추가
import { useEffect } from 'react'
import { useStreamStore } from '../stores/streamStore'

export default function ProcessList() {
  const processListOpen = useStreamStore((s) => s.processListOpen)
  const toggleProcessList = useStreamStore((s) => s.toggleProcessList)
  const processes = useStreamStore((s) => s.processes)
  const fetchProcesses = useStreamStore((s) => s.fetchProcesses)
  const createWindowStream = useStreamStore((s) => s.createWindowStream)
  const addPanel = useStreamStore((s) => s.addPanel)

  useEffect(() => {
    if (processListOpen) {
      fetchProcesses()
    }
  }, [processListOpen, fetchProcesses])

  if (!processListOpen) return null

  const handleAdd = async (hwnd: number, title: string) => {
    const streamId = await createWindowStream(hwnd, title)
    if (streamId !== null) {
      addPanel(streamId, title)
    }
  }

  return (
    <div className="absolute right-0 top-0 bottom-0 w-80 bg-gray-800/95 backdrop-blur border-l border-gray-700 z-30 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <h2 className="text-sm font-semibold">Windows</h2>
        <div className="flex gap-2">
          <button
            onClick={fetchProcesses}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            Refresh
          </button>
          <button
            onClick={toggleProcessList}
            className="text-gray-400 hover:text-white text-lg leading-none"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {processes.length === 0 && (
          <p className="text-gray-500 text-sm p-4 text-center">Loading...</p>
        )}
        {processes.map((proc) => (
          <div
            key={proc.hwnd}
            className="flex items-center justify-between px-3 py-2 hover:bg-gray-700/50 border-b border-gray-700/50"
          >
            <div className="flex-1 min-w-0 mr-2">
              <p className="text-sm truncate text-gray-200" title={proc.title}>
                {proc.title}
              </p>
              <p className="text-xs text-gray-500">
                {proc.processName} · {proc.width}x{proc.height}
              </p>
            </div>
            <button
              onClick={() => handleAdd(proc.hwnd, proc.title)}
              className="px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs flex-shrink-0"
            >
              + Add
            </button>
          </div>
        ))}
      </div>

    </div>
  )
}
