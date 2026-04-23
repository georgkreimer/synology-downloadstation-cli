/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { TextareaRenderable, ScrollBoxRenderable } from "@opentui/core"
import type { Task } from "../types/synology"
import { SynologyClient, SynologyRequestError } from "../services/SynologyClient"
import { formatBytes, formatProgressBar, formatSpeed, deriveProgress } from "../utils/formatting"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import stripAnsi from "strip-ansi"
import { theme } from "./theme"

const BANNER = [
  "███████╗██╗   ██╗███╗   ██╗ ██████╗ ██╗      ██████╗  ██████╗██╗   ██╗    ██████╗ ███████╗",
  "██╔════╝╚██╗ ██╔╝████╗  ██║██╔═══██╗██║     ██╔═══██╗██╔════╝╚██╗ ██╔╝    ██╔══██╗██╔════╝",
  "███████╗ ╚████╔╝ ██╔██╗ ██║██║   ██║██║     ██║   ██║██║  ███╗╚████╔╝     ██║  ██║███████╗",
  "╚════██║  ╚██╔╝  ██║╚██╗██║██║   ██║██║     ██║   ██║██║   ██║ ╚██╔╝      ██║  ██║╚════██║",
  "███████║   ██║   ██║ ╚████║╚██████╔╝███████╗╚██████╔╝╚██████╔╝  ██║       ██████╔╝███████║",
  "╚══════╝   ╚═╝   ╚═╝  ╚═══╝ ╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝   ╚═╝       ╚═════╝ ╚══════╝",
]

const EMPTY_STATE_ART = [
  "    ╭──────╮",
  "    │  ↓↓  │",
  "    │  ↓↓  │",
  "    ╰──────╯",
]

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
}

interface StatusMessage {
  text: string
  tone: "info" | "error" | "success"
}

interface PendingConfirm {
  action: "delete" | "clear"
  taskId?: string
  timer: ReturnType<typeof setTimeout>
}

const REFRESH_INTERVAL_MS = 1000
const STATUS_FADE_MS = 3000
const CONFIRM_TIMEOUT_MS = 2000
const SPINNER_INTERVAL_MS = 80
const BANNER_COLLAPSE_MS = 3000
const PAGE_SIZE_FALLBACK = 10

const COLUMN_MIN_WIDTHS = {
  indicator: 2,
  title: 20,
  status: 12,
  progress: 10,
  speed: 12,
  size: 10,
  destination: 18,
}

const COLUMN_ABSOLUTE_MIN = {
  indicator: 2,
  title: 12,
  status: 9,
  progress: 8,
  speed: 10,
  size: 8,
  destination: 12,
}

type ColumnWidths = {
  indicator: number
  title: number
  status: number
  progress: number
  speed: number
  size: number
  destination: number
  separatorCount: number
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
}: AppProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks ?? [])
  const [selectedId, setSelectedId] = useState<string | null>(initialTasks?.[0]?.id ?? null)
  const [status, setStatus] = useState<StatusMessage | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(initialTasks ? new Date() : null)
  const [loading, setLoading] = useState(!initialTasks)
  const [showCreatePrompt, setShowCreatePrompt] = useState(false)
  const [textareaKey, setTextareaKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [bannerExpanded, setBannerExpanded] = useState(true)
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)
  const [spinnerFrame, setSpinnerFrame] = useState(0)

  const { width, height } = useTerminalDimensions()
  const fetchingRef = useRef(false)
  const textareaRef = useRef<TextareaRenderable | null>(null)
  const scrollBoxRef = useRef<ScrollBoxRenderable | null>(null)
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const defaultDestinationRef = useRef<string | undefined>(
    initialDestination ??
      initialTasks?.map((task) => task.additional?.detail?.destination).find((value): value is string => Boolean(value)),
  )

  useEffect(() => {
    if (initialDestination) {
      defaultDestinationRef.current = initialDestination
    }
  }, [initialDestination])

  // Banner auto-collapse after 3 seconds
  useEffect(() => {
    const timer = setTimeout(() => setBannerExpanded(false), BANNER_COLLAPSE_MS)
    return () => clearTimeout(timer)
  }, [])

  // Spinner animation when busy
  useEffect(() => {
    if (!busy) return
    const interval = setInterval(() => {
      setSpinnerFrame((prev) => (prev + 1) % SPINNER_FRAMES.length)
    }, SPINNER_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [busy])

  const viewportHeight = Math.max(height - 2, 16)

  const columnWidths = useMemo<ColumnWidths>(() => {
    const separatorCount = 6
    const innerWidth = Math.max(width - 6, 0)
    const widths: ColumnWidths = {
      indicator: COLUMN_MIN_WIDTHS.indicator,
      title: COLUMN_MIN_WIDTHS.title,
      status: COLUMN_MIN_WIDTHS.status,
      progress: COLUMN_MIN_WIDTHS.progress,
      speed: COLUMN_MIN_WIDTHS.speed,
      size: COLUMN_MIN_WIDTHS.size,
      destination: COLUMN_MIN_WIDTHS.destination,
      separatorCount,
      total: innerWidth,
    }

    const sumColumns =
      widths.indicator +
      widths.title +
      widths.status +
      widths.progress +
      widths.speed +
      widths.size +
      widths.destination +
      separatorCount

    if (innerWidth >= sumColumns) {
      const extra = innerWidth - sumColumns
      const titleExtra = Math.floor(extra * 0.85)
      const destinationExtra = extra - titleExtra
      widths.title += titleExtra
      widths.destination += destinationExtra
      widths.total = innerWidth
      return widths
    }

    let deficit = sumColumns - innerWidth
    const reduceOrder: (keyof typeof COLUMN_MIN_WIDTHS)[] = [
      "title",
      "destination",
      "speed",
      "size",
      "status",
      "progress",
    ]
    for (const key of reduceOrder) {
      while (deficit > 0 && widths[key] > COLUMN_ABSOLUTE_MIN[key]) {
        widths[key] -= 1
        deficit -= 1
        if (deficit === 0) {
          break
        }
      }
      if (deficit === 0) {
        break
      }
    }
    widths.total = innerWidth
    return widths
  }, [width])

  const tableWidth = columnWidths.total

  // Derive selected index from selectedId
  const selectedIndex = useMemo(() => {
    if (!selectedId) return tasks.length > 0 ? 0 : -1
    const idx = tasks.findIndex((t) => t.id === selectedId)
    return idx >= 0 ? idx : Math.min(tasks.length - 1, 0)
  }, [selectedId, tasks])

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

        // Preserve selection by ID across refresh
        if (selectedId && !list.some((t) => t.id === selectedId)) {
          setSelectedId(list[0]?.id ?? null)
        } else if (!selectedId && list.length > 0) {
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
    [client, onDestinationChange, selectedId, withSessionRetry, setError, setInfo],
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
      if (tasks.length === 0) return
      setExpandedTaskId(null) // collapse detail on move
      const currentIndex = selectedId ? tasks.findIndex((t) => t.id === selectedId) : 0
      const baseIndex = currentIndex >= 0 ? currentIndex : 0
      const next = Math.max(0, Math.min(baseIndex + delta, tasks.length - 1))
      setSelectedId(tasks[next].id)
    },
    [tasks, selectedId],
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

  const selectedTask = selectedIndex >= 0 ? tasks[selectedIndex] : undefined

  const cancelConfirm = useCallback(() => {
    if (pendingConfirm) {
      clearTimeout(pendingConfirm.timer)
      setPendingConfirm(null)
    }
  }, [pendingConfirm])

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
      const timer = setTimeout(() => {
        setPendingConfirm(null)
        setStatus(null)
      }, CONFIRM_TIMEOUT_MS)
      setPendingConfirm({ action: "delete", taskId: selectedTask.id, timer })
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
      const timer = setTimeout(() => {
        setPendingConfirm(null)
        setStatus(null)
      }, CONFIRM_TIMEOUT_MS)
      setPendingConfirm({ action: "clear", timer })
    }
  }, [client, performAction, pendingConfirm, cancelConfirm, setInfo])

  const handleCreate = useCallback(async () => {
    const urls = splitUrls(getNewTaskInput())
    if (urls.length === 0) {
      setError("Provide at least one URL.")
      return
    }
    setBusy(true)
    try {
      // Resolve destination: cached > query NAS default > undefined (let API decide)
      let destination = defaultDestinationRef.current
      if (!destination) {
        destination = await withSessionRetry(() => client.getDefaultDestination()) ?? undefined
        if (destination) {
          defaultDestinationRef.current = destination
          onDestinationChange?.(destination)
        }
      }
      await withSessionRetry(() => client.createTasksFromUrls(urls, destination))
      setSuccess(urls.length > 1 ? `Created ${urls.length} tasks.` : "Task created.")
      setShowCreatePrompt(false)
      resetNewTaskInput()
      await loadTasks()
    } catch (error) {
      setError(formatError(error, "Failed to create task"))
    } finally {
      setBusy(false)
    }
  }, [client, loadTasks, onDestinationChange, withSessionRetry, setError, setSuccess])

  const getPageSize = useCallback((): number => {
    const vpHeight = scrollBoxRef.current?.viewport?.height
    return vpHeight && vpHeight > 0 ? Math.floor(vpHeight) : PAGE_SIZE_FALLBACK
  }, [])

  useKeyboard((key) => {
    if (key.name === "c" && key.ctrl) {
      process.exit(0)
    }

    // Collapse banner on any keypress
    if (bannerExpanded) {
      setBannerExpanded(false)
    }

    // Clear error status on any keypress (R8)
    if (status?.tone === "error") {
      clearStatusTimer()
      setStatus(null)
    }

    if (showCreatePrompt) {
      if (key.name === "escape") {
        setShowCreatePrompt(false)
        resetNewTaskInput()
      } else if (key.name === "return" && (key.ctrl || key.meta)) {
        void handleCreate()
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
        if (tasks.length > 0) {
          setExpandedTaskId(null)
          setSelectedId(tasks[0].id)
        }
        break
      case "end":
        if (tasks.length > 0) {
          setExpandedTaskId(null)
          setSelectedId(tasks[tasks.length - 1].id)
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
      case "n":
        cancelConfirm()
        resetNewTaskInput()
        setShowCreatePrompt(true)
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

  const headerText = `Connected to ${host} as ${username}`
  const lastRefreshText = lastRefresh ? `Last refresh: ${lastRefresh.toLocaleTimeString()}` : "Fetching tasks…"
  const instructions = "↑/↓ move · PgUp/PgDn page · ⏎ detail · space pause · n new · d del · c clear · r refresh · q quit"
  const getNewTaskInput = () => textareaRef.current?.plainText ?? ""
  const resetNewTaskInput = () => {
    setTextareaKey((key) => key + 1)
  }

  const spinnerText = busy ? `${SPINNER_FRAMES[spinnerFrame]} Working…` : null

  return (
    <box flexDirection="column" style={{ padding: 1, gap: 1, height: viewportHeight, minHeight: height }}>
      {bannerExpanded ? (
        <box flexDirection="row" justifyContent="space-between" alignItems="flex-start">
          <box flexDirection="column" style={{ gap: 0 }}>
            {BANNER.map((line, index) => (
              <text key={`banner-${index}`} fg={theme.banner}>
                {line}
              </text>
            ))}
          </box>
          <box flexDirection="column" alignItems="flex-end" style={{ gap: 0 }}>
            <text fg={theme.header}>{headerText}</text>
            <text>{lastRefreshText}</text>
            {renderStatusArea(status, spinnerText)}
          </box>
        </box>
      ) : (
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.banner}>SYNOLOGY DS</text>
          <box flexDirection="row" style={{ gap: 2 }}>
            <text fg={theme.header}>{headerText}</text>
            <text>{lastRefreshText}</text>
            {renderStatusArea(status, spinnerText)}
          </box>
        </box>
      )}

      <box flexDirection="column" style={{ flexGrow: 1, gap: 1, minHeight: 0 }}>
        <box flexDirection="column" style={{ border: true, padding: 1, flexGrow: 1, minHeight: 0 }}>
          <text>
            <strong fg={theme.tableHeader}>{formatHeader(columnWidths, tableWidth)}</strong>
          </text>
          {loading && <text>Loading…</text>}
          {!loading && tasks.length === 0 && (
            <box flexDirection="column" alignItems="center" justifyContent="center" style={{ flexGrow: 1 }}>
              {EMPTY_STATE_ART.map((line, i) => (
                <text key={`empty-${i}`} fg={theme.emptyState}>
                  {line}
                </text>
              ))}
              <text fg={theme.muted}>No downloads. Press n to add a URL.</text>
            </box>
          )}
          {!loading && tasks.length > 0 && (
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
              {tasks.map((task, index) => {
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
                        backgroundColor: isSelected ? theme.row.selectedBg : theme.row.bg,
                        width: columnWidths.total,
                      }}
                    >
                      <text style={isSelected ? { fg: theme.row.selectedFg } : isError ? { fg: theme.status.error } : undefined}>
                        {renderRow(task, columnWidths, tableWidth, isSelected, isError)}
                      </text>
                    </box>
                    {isExpanded && renderTaskDetail(task)}
                  </box>
                )
              })}
            </scrollbox>
          )}
        </box>
      </box>

      <text style={{ marginTop: "auto" }}>{instructions}</text>

      {showCreatePrompt && (
        <box
          style={{
            position: "absolute",
            top: Math.max(Math.floor(viewportHeight / 2) - 7, 2),
            left: Math.max(Math.floor((width - 60) / 2), 2),
            width: Math.min(60, width - 4),
            zIndex: 10,
          }}
        >
          <box
            flexDirection="column"
            style={{
              border: true,
              padding: 1,
              gap: 1,
              backgroundColor: "#1e1e2e",
            }}
          >
            <text fg={theme.tableHeader}>New Download Task</text>
            <text>Enter URL(s):</text>
            <textarea
              key={textareaKey}
              ref={textareaRef}
              placeholder={"https://example.com/file.iso"}
              wrapMode="word"
              style={{ minHeight: 4, maxHeight: 8 }}
              focused
            />
            <text style={{ fg: theme.muted }}>Ctrl+Enter to create · Esc to cancel</text>
          </box>
        </box>
      )}
    </box>
  )
}

function renderStatusArea(status: StatusMessage | null, spinnerText: string | null) {
  if (spinnerText) {
    return <text style={{ fg: theme.muted }}>{spinnerText}</text>
  }
  if (status) {
    return (
      <text style={{ fg: status.tone === "error" ? "red" : status.tone === "success" ? "green" : theme.muted }}>
        {status.text}
      </text>
    )
  }
  return null
}

function renderTaskDetail(task: Task) {
  const detail = task.additional?.detail
  const transfer = task.additional?.transfer
  const errorDetail = task.status_extra?.error_detail
  const lines: string[] = []

  if (detail?.uri) {
    lines.push(`  URL: ${detail.uri}`)
  }
  const times: string[] = []
  if (detail?.created_time) times.push(`Created: ${new Date(detail.created_time * 1000).toLocaleString()}`)
  if (detail?.started_time) times.push(`Started: ${new Date(detail.started_time * 1000).toLocaleString()}`)
  if (detail?.completed_time) times.push(`Done: ${new Date(detail.completed_time * 1000).toLocaleString()}`)
  if (times.length > 0) lines.push(`  ${times.join(" · ")}`)

  const extras: string[] = []
  if (transfer?.downloaded_pieces !== undefined) extras.push(`Pieces: ${transfer.downloaded_pieces}`)
  if (errorDetail) extras.push(`Error: ${errorDetail}`)
  if (extras.length > 0) lines.push(`  ${extras.join(" · ")}`)

  if (lines.length === 0) {
    lines.push("  No additional detail available.")
  }

  return (
    <box flexDirection="column" style={{ backgroundColor: "#1e1e2e", paddingLeft: 3 }}>
      {lines.map((line, i) => (
        <text key={`detail-${i}`} fg={theme.detail}>
          {line}
        </text>
      ))}
    </box>
  )
}

function formatHeader(widths: ColumnWidths, totalWidth: number): string {
  const row = [
    "".padEnd(widths.indicator),
    "Title".padEnd(widths.title),
    "Status".padEnd(widths.status),
    "Progress".padEnd(widths.progress),
    "Speed".padEnd(widths.speed),
    "Size".padEnd(widths.size),
    "Destination".padEnd(widths.destination),
  ].join(" ")
  return padRow(row, totalWidth)
}

function renderRow(task: Task, widths: ColumnWidths, totalWidth: number, isSelected: boolean, isError: boolean) {
  const statusText = describeStatus(task.status)
  const progress = deriveProgress(task)
  const transfer = task.additional?.transfer
  const destination = task.additional?.detail?.destination ?? "-"
  const indicator = isSelected ? "➤" : " "

  const defaultFg = isError ? theme.status.error : undefined
  const segments = [
    { text: indicator.padEnd(widths.indicator), fg: isSelected ? undefined : (isError ? theme.status.error : theme.row.indicator) },
    { text: truncate(task.title, widths.title), fg: isSelected ? undefined : (isError ? theme.status.error : theme.row.title) },
    { text: statusText.padEnd(widths.status), fg: isSelected ? undefined : (isError ? theme.status.error : getStatusColor(task.status)) },
    { text: formatProgressBar(progress, widths.progress), fg: isSelected ? undefined : (isError ? theme.status.error : theme.row.progress) },
    { text: formatSpeed(transfer?.speed_download || transfer?.speed_upload).padEnd(widths.speed), fg: isSelected ? undefined : (isError ? theme.status.error : theme.row.speed) },
    { text: formatBytes(task.size).padEnd(widths.size), fg: isSelected ? undefined : (isError ? theme.status.error : theme.row.size) },
    { text: truncate(destination, widths.destination), fg: isSelected ? undefined : (isError ? theme.status.error : theme.row.destination) },
  ]

  const rawSegments = segments.map((segment, index) =>
    index === segments.length - 1 ? segment.text : `${segment.text} `,
  )
  const padded = padRow(rawSegments.join(""), totalWidth)
  let cursor = 0
  return rawSegments.map((segmentText, index) => {
    const length = segmentText.length
    const text = padded.slice(cursor, cursor + length)
    cursor += length
    return (
      <span key={index} fg={isSelected ? undefined : segments[index].fg}>
        {text}
      </span>
    )
  })
}

function truncate(text: string, width: number): string {
  if (text.length <= width) {
    return text.padEnd(width)
  }
  return `${text.slice(0, Math.max(0, width - 1))}…`
}

function describeStatus(status: Task["status"]): string {
  return STATUS_LABELS[status] ?? (status >= 101 ? `error ${status}` : `status ${status}`)
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
  return stripAnsi(value).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
}
