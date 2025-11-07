export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "-"
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

export function deriveProgress(task: { additional?: { transfer?: { size_downloaded?: number; speed_download?: number } }; size?: number }): number | undefined {
  const total = task.size ?? 0
  const downloaded = task.additional?.transfer?.size_downloaded ?? 0
  if (total <= 0 || downloaded <= 0) return undefined
  const ratio = (downloaded / total) * 100
  if (!Number.isFinite(ratio)) return undefined
  return Math.min(100, Math.max(0, ratio))
}
