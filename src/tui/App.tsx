/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { TextareaRenderable, ScrollBoxRenderable } from "@opentui/core"
import type { Task } from "../types/synology"
import { SynologyClient, SynologyRequestError, isDestinationRequired } from "../services/SynologyClient"
import { formatBytes, formatProgressBar, formatSpeed, deriveProgress, type ProgressBarSegment } from "../utils/formatting"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import stripAnsi from "strip-ansi"
import { theme } from "./theme"

const BANNER = [
  "█▀▀▀ █  █ █▀▀█ █▀▀█ █    █▀▀█ █▀▀▀ █  █    █▀▀▄ █▀▀▀",
  "▀▀▀█ ▀▀▀█ █  █ █  █ █    █  █ █ ▀█ ▀▀▀█    █  █ ▀▀▀█",
  "▀▀▀▀ ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀    ▀▀▀▀ ▀▀▀▀",
]


const STATUS_GLYPHS: Record<number, string> = {
  1: "◌",
  2: "▼",
  3: "⏸",
  4: "◈",
  5: "✓",
  6: "⟳",
  7: "◈",
  8: "▲",
  9: "◌",
  10: "⟳",
  11: "◌",
  12: "⟳",
  13: "✓",
  14: "◈",
  15: "⚠",
}

const STATUS_LABELS: Record<number, string> = {
  1: "waiting",
  2: "downloading",
  3: "paused",
  4: "finishing",
  5: "finished",
  6: "hash check",
  7: "pre-seeding",
  8: "seeding",
  9: "filehost",
  10: "extracting",
  11: "preprocessing",
  12: "verify",
  13: "downloaded",
  14: "postprocess",
  15: "captcha",
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

interface AppProps {
  client: SynologyClient
  host: string
  username: string
  refreshSession: () => Promise<void>
  initialTasks?: Task[]
  initialDestination?: string
  onDestinationChange?: (destination: string) => void
  relayPort?: number
}

interface StatusMessage {
  text: string
  tone: "info" | "error" | "success"
}

interface PendingConfirm {
  action: "delete" | "clear"
  taskId?: string
}

type CreatePromptMode = "urls" | "destination" | "destinationRetry"

const REFRESH_INTERVAL_MS = 1000
const STATUS_FADE_MS = 3000
const CONFIRM_TIMEOUT_MS = 2000
const SPINNER_INTERVAL_MS = 80
const PAGE_SIZE_FALLBACK = 10

type ColumnWidths = {
  glyph: number
  title: number
  progress: number
  speed: number
  size: number
  total: number
}

export function App({
  client,
  host,
  username,
  refreshSession,
  initialTasks,
  initialDestination,
  onDestinationChange,
  relayPort,
}: AppProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks ?? [])
  const [selectedId, setSelectedId] = useState<string | null>(initialTasks?.[0]?.id ?? null)
  const [status, setStatus] = useState<StatusMessage | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(initialTasks ? new Date() : null)
  const [loading, setLoading] = useState(!initialTasks)
  const [showCreatePrompt, setShowCreatePrompt] = useState(false)
  const [createPromptMode, setCreatePromptMode] = useState<CreatePromptMode>("urls")
  const [pendingCreateUrls, setPendingCreateUrls] = useState<string[]>([])
  const [textareaKey, setTextareaKey] = useState(0)
  const [destinationTextareaKey, setDestinationTextareaKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)
  const [spinnerFrame, setSpinnerFrame] = useState(0)
  const [sortByName, setSortByName] = useState(false)

  const { width, height } = useTerminalDimensions()
  const fetchingRef = useRef(false)
  const textareaRef = useRef<TextareaRenderable | null>(null)
  const destinationTextareaRef = useRef<TextareaRenderable | null>(null)
  const scrollBoxRef = useRef<ScrollBoxRenderable | null>(null)
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const defaultDestinationRef = useRef<string | undefined>(
    initialDestination ??
      initialTasks?.map((task) => task.additional?.detail?.destination).find((value): value is string => Boolean(value)),
  )

  useEffect(() => {
    if (initialDestination) {
      defaultDestinationRef.current = initialDestination
    }
  }, [initialDestination])


  // Spinner animation when busy
  useEffect(() => {
    if (!busy) return
    const interval = setInterval(() => {
      setSpinnerFrame((prev) => (prev + 1) % SPINNER_FRAMES.length)
    }, SPINNER_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [busy])

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    }
  }, [])

  const sortedTasks = useMemo(() => {
    if (!sortByName) return tasks
    return [...tasks].sort((a, b) => a.title.localeCompare(b.title))
  }, [tasks, sortByName])

  const viewportHeight = Math.max(height - 2, 16)

  const columnWidths = useMemo<ColumnWidths>(() => {
    const innerWidth = Math.max(width - 6, 0)
    const glyphW = 2
    const speedW = 10
    const sizeW = 9
    const separators = 4
    const fixed = glyphW + speedW + sizeW + separators
    const flexible = Math.max(innerWidth - fixed, 20)
    const progressW = Math.max(Math.floor(flexible * 0.3), 12)
    const titleW = flexible - progressW
    return { glyph: glyphW, title: titleW, progress: progressW, speed: speedW, size: sizeW, total: innerWidth }
  }, [width])

  // Derive selected index from selectedId
  const selectedIndex = useMemo(() => {
    if (!selectedId) return -1
    const idx = sortedTasks.findIndex((t) => t.id === selectedId)
    return idx >= 0 ? idx : -1
  }, [selectedId, sortedTasks])

  // Status message helpers with auto-clear
  const clearStatusTimer = useCallback(() => {
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current)
      statusTimerRef.current = null
    }
  }, [])

  const setInfo = useCallback(
    (text: string) => {
      clearStatusTimer()
      setStatus({ text, tone: "info" })
      statusTimerRef.current = setTimeout(() => setStatus(null), STATUS_FADE_MS)
    },
    [clearStatusTimer],
  )

  const setError = useCallback(
    (text: string) => {
      clearStatusTimer()
      setStatus({ text, tone: "error" })
      // Errors persist until keypress — no timer
    },
    [clearStatusTimer],
  )

  const setSuccess = useCallback(
    (text: string) => {
      clearStatusTimer()
      setStatus({ text, tone: "success" })
      statusTimerRef.current = setTimeout(() => setStatus(null), STATUS_FADE_MS)
    },
    [clearStatusTimer],
  )

  const withSessionRetry = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action()
      } catch (error) {
        if (error instanceof SynologyRequestError && error.code === 119) {
          setInfo("Session expired. Re-authenticating…")
          await refreshSession()
          return await action()
        }
        throw error
      }
    },
    [refreshSession, setInfo],
  )

  const loadTasks = useCallback(
    async (announce = false) => {
      if (fetchingRef.current && !announce) return
      fetchingRef.current = true
      try {
        setLoading((prev) => prev && !announce)
        const list = await withSessionRetry(() => client.listTasks())
        setTasks(list)
        setLastRefresh(new Date())

        const currentSelectedId = selectedIdRef.current
        if (currentSelectedId && !list.some((t) => t.id === currentSelectedId)) {
          setSelectedId(list[0]?.id ?? null)
        } else if (!currentSelectedId && list.length > 0) {
          setSelectedId(list[0].id)
        }

        const fallback = list
          .map((task) => task.additional?.detail?.destination)
          .find((value): value is string => Boolean(value))
        if (fallback && fallback !== defaultDestinationRef.current) {
          defaultDestinationRef.current = fallback
          onDestinationChange?.(fallback)
        }
        if (announce) {
          setInfo("Tasks refreshed.")
        }
      } catch (error) {
        setError(formatError(error, "Unable to load tasks"))
      } finally {
        fetchingRef.current = false
        setLoading(false)
      }
    },
    [client, onDestinationChange, withSessionRetry, setError, setInfo],
  )

  useEffect(() => {
    if (!initialTasks) {
      void loadTasks()
    }
  }, [initialTasks, loadTasks])

  useEffect(() => {
    const timer = setInterval(() => {
      if (!showCreatePrompt && !busy) {
        void loadTasks()
      }
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [busy, loadTasks, showCreatePrompt])

  // Scroll selected task into view
  useEffect(() => {
    if (selectedId) {
      scrollBoxRef.current?.scrollChildIntoView(selectedId)
    }
  }, [selectedId])

  const handleMove = useCallback(
    (delta: number) => {
      if (sortedTasks.length === 0) return
      setExpandedTaskId(null) // collapse detail on move
      const currentIndex = selectedId ? sortedTasks.findIndex((t) => t.id === selectedId) : 0
      const baseIndex = currentIndex >= 0 ? currentIndex : 0
      const next = Math.max(0, Math.min(baseIndex + delta, sortedTasks.length - 1))
      setSelectedId(sortedTasks[next].id)
    },
    [sortedTasks, selectedId],
  )

  const performAction = useCallback(
    async (action: () => Promise<void>, successMessage: string) => {
      if (selectedIndex === -1) return
      setBusy(true)
      try {
        await withSessionRetry(action)
        setSuccess(successMessage)
        await loadTasks()
      } catch (error) {
        setError(formatError(error, "Action failed"))
      } finally {
        setBusy(false)
      }
    },
    [loadTasks, withSessionRetry, selectedIndex, setError, setSuccess],
  )

  const selectedTask = selectedIndex >= 0 ? sortedTasks[selectedIndex] : undefined

  const cancelConfirm = useCallback(() => {
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = null
    }
    setPendingConfirm(null)
  }, [])

  const togglePause = useCallback(() => {
    if (!selectedTask) return
    cancelConfirm()
    const { id, status } = selectedTask
    if (status === 2) {
      void performAction(() => client.pauseTask(id), "Task paused.")
    } else {
      void performAction(() => client.resumeTask(id), "Task resumed.")
    }
  }, [client, performAction, selectedTask, cancelConfirm])

  const handleDelete = useCallback(() => {
    if (!selectedTask) return

    // Completed tasks delete immediately (R5)
    if (selectedTask.status === 5) {
      void performAction(() => client.deleteTask(selectedTask.id, false), "Task deleted.")
      return
    }

    // Double-press confirmation for active tasks (R4)
    if (pendingConfirm?.action === "delete" && pendingConfirm.taskId === selectedTask.id) {
      cancelConfirm()
      void performAction(() => client.deleteTask(selectedTask.id, false), "Task deleted.")
    } else {
      cancelConfirm()
      const title = truncate(selectedTask.title, 30)
      setInfo(`Press d again to delete "${title}"`)
      confirmTimerRef.current = setTimeout(() => {
        setPendingConfirm(null)
        setStatus(null)
      }, CONFIRM_TIMEOUT_MS)
      setPendingConfirm({ action: "delete", taskId: selectedTask.id })
    }
  }, [client, performAction, selectedTask, pendingConfirm, cancelConfirm, setInfo])

  const handleClear = useCallback(() => {
    // Double-press confirmation for clear (R6)
    if (pendingConfirm?.action === "clear") {
      cancelConfirm()
      void performAction(() => client.clearCompleted(), "Cleared completed tasks.")
    } else {
      cancelConfirm()
      setInfo("Press c again to clear completed tasks")
      confirmTimerRef.current = setTimeout(() => {
        setPendingConfirm(null)
        setStatus(null)
      }, CONFIRM_TIMEOUT_MS)
      setPendingConfirm({ action: "clear" })
    }
  }, [client, performAction, pendingConfirm, cancelConfirm, setInfo])

  const getNewTaskInput = () => textareaRef.current?.plainText ?? ""
  const getDestinationInput = () => destinationTextareaRef.current?.plainText ?? ""
  const resetNewTaskInput = () => {
    setTextareaKey((key) => key + 1)
  }
  const resetDestinationInput = () => {
    setDestinationTextareaKey((key) => key + 1)
  }

  const resetCreatePrompt = useCallback(() => {
    setShowCreatePrompt(false)
    setCreatePromptMode("urls")
    setPendingCreateUrls([])
    resetNewTaskInput()
    resetDestinationInput()
  }, [])

  const openCreatePrompt = useCallback(() => {
    setCreatePromptMode("urls")
    setPendingCreateUrls([])
    resetNewTaskInput()
    resetDestinationInput()
    setShowCreatePrompt(true)
  }, [])

  const createWithDestination = useCallback(
    async (urls: string[], destination: string, retryingDestination: boolean) => {
      setBusy(true)
      try {
        await withSessionRetry(() => client.createTasksFromUrls(urls, destination))
        if (destination && destination !== defaultDestinationRef.current) {
          defaultDestinationRef.current = destination
          onDestinationChange?.(destination)
        }
        setSuccess(urls.length > 1 ? `Created ${urls.length} tasks.` : "Task created.")
        resetCreatePrompt()
        await loadTasks()
      } catch (error) {
        if (isDestinationRequired(error)) {
          if (retryingDestination) {
            resetCreatePrompt()
            setError("Synology rejected that destination (120). Reopen the new download prompt to try a different path.")
            return
          }
          setPendingCreateUrls(urls)
          setCreatePromptMode("destinationRetry")
          resetDestinationInput()
          setError("Synology requires a download destination.")
          return
        }
        setError(formatError(error, "Failed to create task"))
      } finally {
        setBusy(false)
      }
    },
    [client, loadTasks, onDestinationChange, resetCreatePrompt, setError, setSuccess, withSessionRetry],
  )

  const handleUrlSubmit = useCallback(async () => {
    if (busy) return
    const urls = splitUrls(getNewTaskInput())
    if (urls.length === 0) {
      setError("Provide at least one URL.")
      return
    }
    setPendingCreateUrls(urls)
    setBusy(true)
    try {
      let destination = defaultDestinationRef.current
      if (!destination) {
        destination = await withSessionRetry(() => client.getDefaultDestination()) ?? undefined
      }
      if (!destination) {
        setCreatePromptMode("destination")
        resetDestinationInput()
        return
      }
      await createWithDestination(urls, destination, false)
    } catch (error) {
      setError(formatError(error, "Failed to create task"))
    } finally {
      setBusy(false)
    }
  }, [busy, client, createWithDestination, setError, withSessionRetry])

  const handleDestinationSubmit = useCallback(async () => {
    if (busy) return
    const destination = sanitizeDestination(getDestinationInput())
    if (!destination) {
      setError("Enter a download destination.")
      return
    }
    if (pendingCreateUrls.length === 0) {
      setError("Provide at least one URL.")
      setCreatePromptMode("urls")
      return
    }
    await createWithDestination(pendingCreateUrls, destination, createPromptMode === "destinationRetry")
  }, [busy, createPromptMode, createWithDestination, pendingCreateUrls, setError])

  const getPageSize = useCallback((): number => {
    const vpHeight = scrollBoxRef.current?.viewport?.height
    return vpHeight && vpHeight > 0 ? Math.floor(vpHeight) : PAGE_SIZE_FALLBACK
  }, [])

  useKeyboard((key) => {
    if (key.name === "c" && key.ctrl) {
      process.exit(0)
    }

    // Clear error status on any keypress (R8)
    if (status?.tone === "error") {
      clearStatusTimer()
      setStatus(null)
    }

    if (showCreatePrompt) {
      if (key.name === "escape") {
        resetCreatePrompt()
      } else if (key.name === "return" && (key.ctrl || key.meta)) {
        if (createPromptMode === "urls") {
          void handleUrlSubmit()
        } else {
          void handleDestinationSubmit()
        }
      }
      return
    }

    // Cancel pending confirm on non-matching keys
    if (pendingConfirm && key.name !== "d" && key.name !== "c") {
      cancelConfirm()
    }

    switch (key.name) {
      case "up":
        handleMove(-1)
        break
      case "down":
        handleMove(1)
        break
      case "pageup":
        handleMove(-getPageSize())
        break
      case "pagedown":
        handleMove(getPageSize())
        break
      case "home":
        if (sortedTasks.length > 0) {
          setExpandedTaskId(null)
          setSelectedId(sortedTasks[0].id)
        }
        break
      case "end":
        if (sortedTasks.length > 0) {
          setExpandedTaskId(null)
          setSelectedId(sortedTasks[sortedTasks.length - 1].id)
        }
        break
      case "return":
        if (selectedTask) {
          setExpandedTaskId((prev) => (prev === selectedTask.id ? null : selectedTask.id))
        }
        break
      case "space":
        togglePause()
        break
      case "d":
        handleDelete()
        break
      case "c":
        handleClear()
        break
      case "r":
        void loadTasks(true)
        break
      case "s":
        setSortByName((prev) => !prev)
        break
      case "n":
        cancelConfirm()
        openCreatePrompt()
        break
      case "escape":
        setExpandedTaskId(null)
        break
      case "q":
        process.exit(0)
        break
      default:
        break
    }
  })

  const headerText = `${username}@${new URL(host).hostname}`
  const lastRefreshText = lastRefresh ? lastRefresh.toLocaleTimeString() : "…"
  const sortLabel = sortByName ? " ↑" : ""
  const tableTitle = tasks.length > 0 ? ` Downloads (${tasks.length})${sortLabel} ` : " Downloads "

  const spinnerText = busy ? `${SPINNER_FRAMES[spinnerFrame]} Working…` : null

  const statusLine = spinnerText ?? (status ? status.text : "")
  const statusColor = spinnerText ? theme.muted : status?.tone === "error" ? theme.status.error : status?.tone === "success" ? theme.status.finished : theme.muted

  return (
    <box flexDirection="column" style={{ padding: 1, gap: 0, height: viewportHeight, minHeight: height }}>
      {/* Header: banner + connection/status info */}
      <box flexDirection="row" justifyContent="space-between" alignItems="flex-start">
        <box flexDirection="column" style={{ gap: 0 }}>
          {BANNER.map((line, index) => (
            <text key={`banner-${index}`} fg={theme.banner}>
              {line}
            </text>
          ))}
        </box>
        <box flexDirection="column" alignItems="flex-end" style={{ gap: 0 }}>
          <text fg={theme.muted}>{headerText}</text>
          {relayPort && <text fg={theme.muted}>{`relay :${relayPort}`}</text>}
          <text fg={theme.muted}>{lastRefreshText}</text>
          <text fg={statusColor}>{statusLine}</text>
        </box>
      </box>

      {/* Main table */}
      <box
        flexDirection="column"
        title={tableTitle}
        style={{
          border: true,
          borderStyle: "rounded",
          borderColor: theme.border,
          padding: 1,
          flexGrow: 1,
          minHeight: 0,
          marginTop: 1,
        }}
      >
        <text fg={theme.muted} style={{ flexShrink: 0 }}>{formatHeader(columnWidths)}</text>
        <text fg={theme.border} style={{ flexShrink: 0 }}>{"─".repeat(columnWidths.total)}</text>
        {loading && <text fg={theme.muted}>Loading…</text>}
        {!loading && sortedTasks.length === 0 && (
          <box flexDirection="column" alignItems="center" justifyContent="center" style={{ flexGrow: 1 }}>
            <text fg={theme.muted}>No active downloads</text>
            <text fg={theme.emptyState}>Press <span fg={theme.keyhint.key}>n</span> to add a URL</text>
          </box>
        )}
        {!loading && sortedTasks.length > 0 && (
          <scrollbox
            scrollY
            viewportCulling
            ref={scrollBoxRef}
            style={{ flexGrow: 1, minHeight: 0 }}
            verticalScrollbarOptions={{
              trackOptions: {
                foregroundColor: theme.scrollbar.thumb,
                backgroundColor: theme.scrollbar.track,
              },
            }}
          >
            {sortedTasks.map((task) => {
              const isSelected = task.id === selectedId
              const isError = task.status >= 101
              const isExpanded = expandedTaskId === task.id || isError
              return (
                <box
                  key={task.id}
                  id={task.id}
                  flexDirection="column"
                >
                  <box
                    style={{
                      flexDirection: "row",
                      justifyContent: "flex-start",
                      backgroundColor: isSelected ? theme.row.selectedBg : undefined,
                      width: columnWidths.total,
                    }}
                  >
                    <text style={isSelected ? { fg: theme.row.selectedFg } : isError ? { fg: theme.status.error } : undefined}>
                      {renderRow(task, columnWidths, isSelected, isError)}
                    </text>
                  </box>
                  {isExpanded && renderTaskDetail(task)}
                </box>
              )
            })}
          </scrollbox>
        )}
      </box>

      {/* Footer: keybinding hints */}
      <box flexDirection="row" style={{ marginTop: 1 }}>
        <text>
          <span fg={theme.keyhint.key}>↑↓</span><span fg={theme.keyhint.label}> navigate  </span>
          <span fg={theme.keyhint.key}>⏎</span><span fg={theme.keyhint.label}> detail  </span>
          <span fg={theme.keyhint.key}>space</span><span fg={theme.keyhint.label}> pause  </span>
          <span fg={theme.keyhint.key}>n</span><span fg={theme.keyhint.label}> new  </span>
          <span fg={theme.keyhint.key}>d</span><span fg={theme.keyhint.label}> delete  </span>
          <span fg={theme.keyhint.key}>c</span><span fg={theme.keyhint.label}> clear  </span>
          <span fg={theme.keyhint.key}>s</span><span fg={theme.keyhint.label}> sort  </span>
          <span fg={theme.keyhint.key}>r</span><span fg={theme.keyhint.label}> refresh  </span>
          <span fg={theme.keyhint.key}>q</span><span fg={theme.keyhint.label}> quit</span>
        </text>
      </box>

      {/* Create modal */}
      {showCreatePrompt && (
        <box
          style={{
            position: "absolute",
            top: Math.max(Math.floor(viewportHeight / 2) - 7, 2),
            left: Math.max(Math.floor((width - 64) / 2), 2),
            width: Math.min(64, width - 4),
            zIndex: 10,
          }}
        >
          <box
            flexDirection="column"
            title=" New Download "
            style={{
              border: true,
              borderStyle: "rounded",
              borderColor: theme.keyhint.key,
              padding: 1,
              gap: 1,
              backgroundColor: "#181825",
            }}
          >
            {createPromptMode === "urls" ? (
              <>
                <text fg={theme.muted}>Paste one or more URLs, one per line:</text>
                <textarea
                  key={textareaKey}
                  ref={textareaRef}
                  placeholder={"https://example.com/file.iso"}
                  wrapMode="word"
                  style={{ minHeight: 4, maxHeight: 8 }}
                  focused
                />
              </>
            ) : (
              <>
                <text fg={theme.muted}>
                  {createPromptMode === "destinationRetry"
                    ? "Synology still requires a valid destination:"
                    : "Enter the Synology destination path:"}
                </text>
                <text fg={theme.emptyState}>{`${pendingCreateUrls.length} pending URL${pendingCreateUrls.length === 1 ? "" : "s"}`}</text>
                <textarea
                  key={destinationTextareaKey}
                  ref={destinationTextareaRef}
                  placeholder={"/volume1/downloads"}
                  wrapMode="word"
                  style={{ minHeight: 1, maxHeight: 2 }}
                  focused
                />
              </>
            )}
            <text>
              <span fg={theme.keyhint.key}>Ctrl+⏎</span><span fg={theme.keyhint.label}>{createPromptMode === "urls" ? " create  " : " save  "}</span>
              <span fg={theme.keyhint.key}>Esc</span><span fg={theme.keyhint.label}> cancel</span>
            </text>
          </box>
        </box>
      )}
    </box>
  )
}

function renderTaskDetail(task: Task) {
  const detail = task.additional?.detail
  const transfer = task.additional?.transfer
  const errorDetail = task.status_extra?.error_detail
  const statusLabel = STATUS_LABELS[task.status] ?? (task.status >= 101 ? `error ${task.status}` : `status ${task.status}`)

  const fields: Array<{ label: string; value: string; color?: string }> = [
    { label: "Status", value: statusLabel, color: getStatusColor(task.status) },
  ]
  if (detail?.destination) fields.push({ label: "Dest", value: detail.destination })
  if (detail?.uri) fields.push({ label: "URL", value: detail.uri })
  if (detail?.created_time) fields.push({ label: "Created", value: new Date(detail.created_time * 1000).toLocaleString() })
  if (detail?.started_time) fields.push({ label: "Started", value: new Date(detail.started_time * 1000).toLocaleString() })
  if (detail?.completed_time) fields.push({ label: "Done", value: new Date(detail.completed_time * 1000).toLocaleString() })
  if (transfer?.downloaded_pieces !== undefined) fields.push({ label: "Pieces", value: `${transfer.downloaded_pieces}` })
  if (errorDetail) fields.push({ label: "Error", value: errorDetail, color: theme.status.error })

  return (
    <box flexDirection="column" style={{ paddingLeft: 4, paddingBottom: 1 }}>
      {fields.map((field, i) => (
        <text key={`detail-${i}`}>
          <span fg={theme.muted}>{field.label.padEnd(8)} </span>
          <span fg={field.color ?? theme.detail}>{field.value}</span>
        </text>
      ))}
    </box>
  )
}

function formatHeader(widths: ColumnWidths): string {
  const row = [
    "".padEnd(widths.glyph),
    "Name".padEnd(widths.title),
    "Progress".padEnd(widths.progress),
    padStart("Speed", widths.speed),
    padStart("Size", widths.size),
  ].join(" ")
  return padRow(row, widths.total)
}

function renderRow(task: Task, widths: ColumnWidths, isSelected: boolean, isError: boolean) {
  const progress = deriveProgress(task)
  const transfer = task.additional?.transfer
  const glyph = task.status >= 101 ? "✗" : (STATUS_GLYPHS[task.status] ?? "·")
  const glyphColor = isSelected ? undefined : (isError ? theme.status.error : getStatusColor(task.status))
  const progressSegments = formatProgressBar(progress, widths.progress)
  const progressColor = getStatusColor(task.status)

  return (
    <>
      <span fg={glyphColor}>{`${glyph} `}</span>
      <span fg={isSelected ? undefined : (isError ? theme.status.error : theme.row.title)}>{`${truncate(task.title, widths.title)} `}</span>
      {renderProgressSegments(progressSegments, isSelected, isError, progressColor)}
      <span fg={isSelected ? undefined : (isError ? theme.status.error : theme.row.speed)}>{` ${padStart(formatSpeed(transfer?.speed_download || transfer?.speed_upload), widths.speed)}`}</span>
      <span fg={isSelected ? undefined : (isError ? theme.status.error : theme.row.size)}>{` ${padStart(formatBytes(task.size), widths.size)}`}</span>
    </>
  )
}

function renderProgressSegments(segments: ProgressBarSegment[], isSelected: boolean, isError: boolean, progressColor: string) {
  return segments.map((segment, i) => (
    <span
      key={i}
      fg={
        isError
          ? theme.status.error
          : segment.role === "filled"
            ? progressColor
            : segment.role === "label" && isSelected
              ? theme.row.selectedFg
              : segment.role === "label"
                ? theme.muted
                : theme.progress.trackFg
      }
    >
      {segment.text}
    </span>
  ))
}

function padStart(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text.padStart(width)
}

function truncate(text: string, width: number): string {
  if (text.length <= width) {
    return text.padEnd(width)
  }
  return `${text.slice(0, Math.max(0, width - 1))}…`
}

function formatError(error: unknown, fallback: string): string {
  if (error instanceof SynologyRequestError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return fallback
}

function padRow(row: string, totalWidth: number): string {
  if (row.length === totalWidth) {
    return row
  }
  if (row.length > totalWidth) {
    return row.slice(0, totalWidth)
  }
  return row.padEnd(totalWidth, " ")
}

function getStatusColor(status: Task["status"]): string {
  if (status >= 101) return theme.status.error
  switch (status) {
    case 2:
      return theme.status.downloading
    case 3:
      return theme.status.paused
    case 5:
      return theme.status.finished
    case 8:
      return theme.status.seeding
    default:
      return theme.status.default
  }
}

function splitUrls(input: string): string[] {
  return sanitizeInput(input)
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

function sanitizeInput(value: string): string {
  return stripAnsi(value).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B\uFEFF\u202A-\u202E\u2066-\u2069]/g, "")
}

function sanitizeDestination(value: string): string {
  return sanitizeInput(value).trim()
}
