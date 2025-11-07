import { describe, expect, test } from "bun:test"
import { deriveProgress, formatBytes, formatPercent, formatSpeed } from "../formatting"

describe("formatting helpers", () => {
  test("formatBytes handles common ranges", () => {
    expect(formatBytes(0)).toBe("-")
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

  test("deriveProgress returns bounded percentage", () => {
    const progress = deriveProgress({
      size: 1_000,
      additional: {
        transfer: { size_downloaded: 750 },
      },
    })
    expect(progress).toBe(75)
  })
})
