export function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes < 0) return "-"
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : size >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

export function formatSpeed(bytesPerSecond?: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return "-"
  return `${formatBytes(bytesPerSecond)}/s`
}

export function formatPercent(percent?: number): string {
  if (percent === undefined || Number.isNaN(percent)) return "-"
  return `${percent.toFixed(0)}%`
}

export interface ProgressBarSegment {
  text: string
  role: "filled" | "track" | "label"
}

export function formatProgressBar(percent: number | undefined, width: number): ProgressBarSegment[] {
  if (width <= 0) return []
  const hasValue = percent !== undefined && !Number.isNaN(percent)
  const normalized = hasValue ? Math.min(100, Math.max(0, percent)) : undefined
  const label = normalized === undefined ? "  --" : `${Math.round(normalized)}%`.padStart(4)

  if (width <= label.length) {
    return [{ text: label.slice(-width), role: "label" }]
  }

  const gap = 1
  const barWidth = Math.max(0, width - label.length - gap)
  const filledCount = normalized === undefined ? 0 : Math.round((normalized / 100) * barWidth)
  const segments: ProgressBarSegment[] = []
  if (filledCount > 0) {
    segments.push({ text: "█".repeat(filledCount), role: "filled" })
  }
  if (filledCount < barWidth) {
    segments.push({ text: "░".repeat(barWidth - filledCount), role: "track" })
  }
  segments.push({ text: " ", role: "track" })
  segments.push({ text: label, role: "label" })
  return segments
}

export function deriveProgress(task: { additional?: { transfer?: { size_downloaded?: number; speed_download?: number } }; size?: number }): number | undefined {
  const total = task.size ?? 0
  const downloaded = task.additional?.transfer?.size_downloaded ?? 0
  if (total <= 0 || downloaded < 0) return undefined
  const ratio = (downloaded / total) * 100
  if (!Number.isFinite(ratio)) return undefined
  return Math.min(100, Math.max(0, ratio))
}
