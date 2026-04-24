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
  filled: boolean
}

export function formatProgressBar(percent: number | undefined, width: number): ProgressBarSegment[] {
  if (width < 4) return [{ text: "░".repeat(width), filled: false }]
  const hasValue = percent !== undefined && !Number.isNaN(percent)
  const pctText = hasValue ? `${Math.round(percent)}%`.padStart(4) : ""
  const labelStart = Math.max(0, Math.floor((width - pctText.length) / 2))
  const filledCount = hasValue ? Math.round((percent / 100) * width) : 0

  let bar = ""
  for (let i = 0; i < width; i++) {
    if (pctText && i >= labelStart && i < labelStart + pctText.length) {
      bar += pctText[i - labelStart]
    } else if (i < filledCount) {
      bar += "█"
    } else {
      bar += "░"
    }
  }
  if (filledCount === 0) return [{ text: bar, filled: false }]
  if (filledCount >= width) return [{ text: bar, filled: true }]
  return [
    { text: bar.slice(0, filledCount), filled: true },
    { text: bar.slice(filledCount), filled: false },
  ]
}

export function deriveProgress(task: { additional?: { transfer?: { size_downloaded?: number; speed_download?: number } }; size?: number }): number | undefined {
  const total = task.size ?? 0
  const downloaded = task.additional?.transfer?.size_downloaded ?? 0
  if (total <= 0 || downloaded <= 0) return undefined
  const ratio = (downloaded / total) * 100
  if (!Number.isFinite(ratio)) return undefined
  return Math.min(100, Math.max(0, ratio))
}
