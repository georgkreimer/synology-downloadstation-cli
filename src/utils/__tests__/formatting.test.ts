import { describe, expect, test } from "bun:test"
import { deriveProgress, formatBytes, formatPercent, formatProgressBar, formatSpeed } from "../formatting"

describe("formatting helpers", () => {
  test("formatBytes handles common ranges", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(undefined)).toBe("-")
    expect(formatBytes(-1)).toBe("-")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(2048)).toBe("2.00 KB")
    expect(formatBytes(5_242_880)).toBe("5.00 MB")
    expect(formatBytes(21_474_836_480)).toBe("20.0 GB")
  })

  test("formatSpeed appends per-second suffix", () => {
    expect(formatSpeed(undefined)).toBe("-")
    expect(formatSpeed(1024)).toBe("1.00 KB/s")
  })

  test("formatPercent rounds to whole numbers", () => {
    expect(formatPercent()).toBe("-")
    expect(formatPercent(63.4)).toBe("63%")
    expect(formatPercent(99.9)).toBe("100%")
  })

  test("formatProgressBar renders segments with percentage", () => {
    const segments = formatProgressBar(50, 10)
    const full = segments.map((s) => s.text).join("")
    expect(full).toBe("███░░  50%")
    expect(full).toHaveLength(10)
    expect(segments.some((s) => s.role === "filled")).toBe(true)
    expect(segments.some((s) => s.role === "track")).toBe(true)
    expect(segments.at(-1)?.role).toBe("label")

    const empty = formatProgressBar(undefined, 10)
    expect(empty.map((s) => s.text).join("")).toBe("░░░░░   --")
    expect(empty.some((s) => s.role === "filled")).toBe(false)

    const done = formatProgressBar(100, 10)
    expect(done.map((s) => s.text).join("")).toBe("█████ 100%")
    expect(done.some((s) => s.role === "filled")).toBe(true)
  })

  test("deriveProgress returns bounded percentage", () => {
    const progress = deriveProgress({
      size: 1_000,
      additional: {
        transfer: { size_downloaded: 750 },
      },
    })
    expect(progress).toBe(75)
    expect(deriveProgress({ size: 1_000, additional: { transfer: { size_downloaded: 0 } } })).toBe(0)
    expect(deriveProgress({ size: 1_000, additional: { transfer: { size_downloaded: 1_250 } } })).toBe(100)
  })
})
