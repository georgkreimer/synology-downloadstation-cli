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

export function formatProgressBar(percent: number | undefined, width: number): string {
  if (percent === undefined || Number.isNaN(percent)) return "-".padEnd(width)
  // Fixed-width percentage: always 4 chars ("  0%", " 50%", "100%") + 1 space separator
  const pctText = `${Math.round(percent)}%`.padStart(4)
  const barWidth = Math.max(width - 5, 2) // 4 chars pct + 1 space
  const filled = Math.round((percent / 100) * barWidth)
  const empty = barWidth - filled
  return `${"\u2588".repeat(filled)}${"\u2591".repeat(empty)} ${pctText}`
}

export function deriveProgress(task: { additional?: { transfer?: { size_downloaded?: number; speed_download?: number } }; size?: number }): number | undefined {
  const total = task.size ?? 0
  const downloaded = task.additional?.transfer?.size_downloaded ?? 0
  if (total <= 0 || downloaded <= 0) return undefined
  const ratio = (downloaded / total) * 100
  if (!Number.isFinite(ratio)) return undefined
  return Math.min(100, Math.max(0, ratio))
}
