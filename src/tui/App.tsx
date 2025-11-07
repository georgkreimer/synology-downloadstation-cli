/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { TextareaRenderable } from "@opentui/core"
import type { Task } from "../types/synology"
import { SynologyClient, SynologyRequestError } from "../services/SynologyClient"
import { formatBytes, formatPercent, formatSpeed, deriveProgress } from "../utils/formatting"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import stripAnsi from "strip-ansi"

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

const REFRESH_INTERVAL_MS = 1000

const COLUMN_MIN_WIDTHS = {
  indicator: 2,
  title: 20,
  status: 12,
  progress: 8,
  speed: 12,
  size: 10,
  destination: 18,
}

const COLUMN_ABSOLUTE_MIN = {
  indicator: 2,
  title: 12,
  status: 9,
  progress: 6,
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
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [status, setStatus] = useState<StatusMessage | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(initialTasks ? new Date() : null)
  const [loading, setLoading] = useState(!initialTasks)
  const [showCreatePrompt, setShowCreatePrompt] = useState(false)
  const [textareaKey, setTextareaKey] = useState(0)
  const [busy, setBusy] = useState(false)

  const { width, height } = useTerminalDimensions()
  const textareaRef = useRef<TextareaRenderable | null>(null)
  const defaultDestinationRef = useRef<string | undefined>(
    initialDestination ??
      initialTasks?.map((task) => task.additional?.detail?.destination).find((value): value is string => Boolean(value)),
  )
  useEffect(() => {
    if (initialDestination) {
      defaultDestinationRef.current = initialDestination
    }
  }, [initialDestination])
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
      const titleExtra = Math.floor(extra * 0.6)
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

  const setInfo = useCallback((text: string) => setStatus({ text, tone: "info" }), [])
  const setError = useCallback((text: string) => setStatus({ text, tone: "error" }), [])
  const setSuccess = useCallback((text: string) => setStatus({ text, tone: "success" }), [])

  const loadTasks = useCallback(
    async (announce = false) => {
      try {
        setLoading((prev) => prev && !announce)
        const list = await client.listTasks()
        setTasks(list)
        setLastRefresh(new Date())
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
        if (error instanceof SynologyRequestError && error.code === 119) {
          setInfo("Session expired. Re-authenticating…")
          await refreshSession()
          return loadTasks(announce)
        }
        setError(formatError(error, "Unable to load tasks"))
      } finally {
        setLoading(false)
      }
    },
    [client, onDestinationChange, refreshSession, setError, setInfo],
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

  const selectionClamped = useMemo(
    () => (tasks.length === 0 ? -1 : Math.min(Math.max(selectedIndex, 0), tasks.length - 1)),
    [selectedIndex, tasks.length],
  )

  const handleMove = useCallback(
    (delta: number) => {
      if (tasks.length === 0) return
      setSelectedIndex((prev) => {
        const next = prev + delta
        if (next < 0) return 0
        if (next >= tasks.length) return tasks.length - 1
        return next
      })
    },
    [tasks.length],
  )

  const performAction = useCallback(
    async (action: () => Promise<void>, successMessage: string) => {
      if (selectionClamped === -1) return
      setBusy(true)
      try {
        await action()
        setSuccess(successMessage)
        await loadTasks()
      } catch (error) {
        if (error instanceof SynologyRequestError && error.code === 119) {
          setInfo("Session expired. Re-authenticating…")
          await refreshSession()
          await action()
          setSuccess(successMessage)
          await loadTasks()
          return
        }
        setError(formatError(error, "Action failed"))
      } finally {
        setBusy(false)
      }
    },
    [loadTasks, refreshSession, selectionClamped, setError, setInfo, setSuccess],
  )

  const selectedTask = selectionClamped >= 0 ? tasks[selectionClamped] : undefined

  const togglePause = useCallback(() => {
    if (!selectedTask) return
    const { id, status } = selectedTask
    if (status === 2) {
      void performAction(() => client.pauseTask(id), "Task paused.")
    } else {
      void performAction(() => client.resumeTask(id), "Task resumed.")
    }
  }, [client, performAction, selectedTask])

  const handleDelete = useCallback(() => {
    if (!selectedTask) return
    void performAction(() => client.deleteTask(selectedTask.id, false), "Task deleted.")
  }, [client, performAction, selectedTask])

  const handleClear = useCallback(() => {
    void performAction(() => client.clearCompleted(), "Cleared completed tasks.")
  }, [client, performAction])

  const handleCreate = useCallback(async () => {
    const urls = splitUrls(getNewTaskInput())
    if (urls.length === 0) {
      setError("Provide at least one URL.")
      return
    }
    const destination = defaultDestinationRef.current
    setBusy(true)
    try {
      await client.createTasksFromUrls(urls, destination)
      if (!defaultDestinationRef.current && destination) {
        defaultDestinationRef.current = destination
        onDestinationChange?.(destination)
      }
      setSuccess(urls.length > 1 ? `Created ${urls.length} tasks.` : "Task created.")
      setShowCreatePrompt(false)
      resetNewTaskInput()
      await loadTasks()
    } catch (error) {
      if (error instanceof SynologyRequestError && error.code === 119) {
        await refreshSession()
        await client.createTasksFromUrls(urls, destination)
        if (!defaultDestinationRef.current && destination) {
          defaultDestinationRef.current = destination
          onDestinationChange?.(destination)
        }
        setSuccess(urls.length > 1 ? `Created ${urls.length} tasks.` : "Task created.")
        setShowCreatePrompt(false)
        resetNewTaskInput()
        await loadTasks()
        return
      }
      setError(formatError(error, "Failed to create task"))
    } finally {
      setBusy(false)
    }
  }, [client, loadTasks, onDestinationChange, refreshSession, setError, setSuccess])

  useKeyboard((key) => {
    if (key.name === "c" && key.ctrl) {
      process.exit(0)
    }
    if (showCreatePrompt) {
      if (key.name === "escape") {
        setShowCreatePrompt(false)
        resetNewTaskInput()
      } else if (key.name === "return" && (key.ctrl || key.meta || key.option)) {
        void handleCreate()
      }
      return
    }
    switch (key.name) {
      case "up":
        handleMove(-1)
        break
      case "down":
        handleMove(1)
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
        resetNewTaskInput()
        setShowCreatePrompt(true)
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
  const instructions = "Keys: ↑/↓ move · space pause/resume · n new task · d delete · c clear finished · r refresh · q quit"
  const banner = [
    "███████╗██╗   ██╗███╗   ██╗ ██████╗ ██╗      ██████╗  ██████╗██╗   ██╗    ██████╗ ███████╗",
    "██╔════╝╚██╗ ██╔╝████╗  ██║██╔═══██╗██║     ██╔═══██╗██╔════╝╚██╗ ██╔╝    ██╔══██╗██╔════╝",
    "███████╗ ╚████╔╝ ██╔██╗ ██║██║   ██║██║     ██║   ██║██║  ███╗╚████╔╝     ██║  ██║███████╗",
    "╚════██║  ╚██╔╝  ██║╚██╗██║██║   ██║██║     ██║   ██║██║   ██║ ╚██╔╝      ██║  ██║╚════██║",
    "███████║   ██║   ██║ ╚████║╚██████╔╝███████╗╚██████╔╝╚██████╔╝  ██║       ██████╔╝███████║",
    "╚══════╝   ╚═╝   ╚═╝  ╚═══╝ ╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝   ╚═╝       ╚═════╝ ╚══════╝",
  ]
  const getNewTaskInput = () => textareaRef.current?.plainText ?? ""
  const resetNewTaskInput = () => {
    setTextareaKey((key) => key + 1)
  }

  return (
    <box flexDirection="column" style={{ padding: 1, gap: 1, height: viewportHeight, minHeight: height }}>
      <box flexDirection="row" justifyContent="space-between" alignItems="flex-start">
        <box flexDirection="column" style={{ gap: 0 }}>
          {banner.map((line, index) => (
            <text key={`banner-${index}`} fg="#8be9fd">
              {line}
            </text>
          ))}
        </box>
        <box flexDirection="column" alignItems="flex-end" style={{ gap: 0 }}>
          <text fg="#cdd6f4">{headerText}</text>
          <text>{lastRefreshText}</text>
          {status && (
            <text style={{ fg: status.tone === "error" ? "red" : status.tone === "success" ? "green" : "#999999" }}>
              {status.text}
            </text>
          )}
        </box>
      </box>

      <box flexDirection="column" style={{ flexGrow: 1, gap: 1, minHeight: 0 }}>
        <box flexDirection="column" style={{ border: true, padding: 1, flexGrow: 1, minHeight: 0 }}>
          <text>
            <strong fg="#88c0d0">{formatHeader(columnWidths, tableWidth)}</strong>
          </text>
          {loading && <text>Loading…</text>}
          {!loading && tasks.length === 0 && <text>No tasks found.</text>}
          {!loading &&
            tasks.map((task, index) => {
              const isSelected = index === selectionClamped
              return (
                <box
                  key={task.id}
                  style={{
                    flexDirection: "row",
                    justifyContent: "flex-start",
                    backgroundColor: isSelected ? "#2F3C51" : "#1B1D2A",
                    width: columnWidths.total,
                  }}
                >
                  <text style={isSelected ? { fg: "#E7F6F2" } : undefined}>
                    {renderRow(task, columnWidths, tableWidth, isSelected)}
                  </text>
                </box>
              )
            })}
        </box>
      </box>

      {showCreatePrompt && (
      <box flexDirection="column" style={{ border: true, padding: 1, gap: 1, maxHeight: 14 }}>
        <text>Enter download URL(s):</text>
        <textarea
          key={textareaKey}
          ref={textareaRef}
          placeholder={"https://example.com/file.iso"}
          wrapMode="word"
          style={{ minHeight: 6, maxHeight: 10 }}
          focused
        />
          <text style={{ fg: "#999999" }}>Press Option+Enter to create or Esc to cancel.</text>
      </box>
      )}

      <text style={{ marginTop: "auto" }}>{instructions}</text>
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

function renderRow(task: Task, widths: ColumnWidths, totalWidth: number, isSelected: boolean) {
  const statusText = describeStatus(task.status)
  const progress = deriveProgress(task)
  const transfer = task.additional?.transfer
  const destination = task.additional?.detail?.destination ?? "-"
  const indicator = isSelected ? "➤" : " "
  const segments = [
    { text: indicator.padEnd(widths.indicator), fg: isSelected ? undefined : "#4ee1c1" },
    { text: truncate(task.title, widths.title), fg: isSelected ? undefined : "#8be9fd" },
    { text: statusText.padEnd(widths.status), fg: isSelected ? undefined : getStatusColor(task.status) },
    { text: formatPercent(progress).padEnd(widths.progress), fg: isSelected ? undefined : "#ffd369" },
    { text: formatSpeed(transfer?.speed_download || transfer?.speed_upload).padEnd(widths.speed), fg: isSelected ? undefined : "#a6e3a1" },
    { text: formatBytes(task.size).padEnd(widths.size), fg: isSelected ? undefined : "#f1fa8c" },
    { text: truncate(destination, widths.destination), fg: isSelected ? undefined : "#89b4fa" },
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
  const map: Record<number, string> = {
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
  return map[status] ?? (status >= 101 ? `error ${status}` : `status ${status}`)
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
  switch (status) {
    case 2:
      return "#4ee1c1" // downloading
    case 3:
      return "#ffb86c" // paused
    case 5:
      return "#a6e3a1" // finished
    case 8:
      return "#84ffff" // seeding
    default:
      return "#cdd6f4"
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
