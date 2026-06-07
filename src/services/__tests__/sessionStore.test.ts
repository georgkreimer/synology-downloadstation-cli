import { afterAll, afterEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

const tmpDir = path.join(os.tmpdir(), `synology-ds-test-${Date.now()}`)
fs.mkdirSync(tmpDir, { recursive: true })
process.env.SYNOLOGY_DS_CONFIG_DIR = tmpDir

mock.module("../../utils/fs", () => ({
  getConfigPath: (fileName: string) => path.join(tmpDir, fileName),
  ensureConfigDir: () => tmpDir,
  readJSONFile: <T,>(filePath: string): T | undefined => {
    if (!fs.existsSync(filePath)) return undefined
    try {
      const raw = fs.readFileSync(filePath, "utf8")
      const parsed: unknown = JSON.parse(raw)
      if (parsed === null || typeof parsed !== "object") return undefined
      return parsed as T
    } catch {
      return undefined
    }
  },
  writeJSONFile: <T,>(filePath: string, data: T) => {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 })
  },
}))

const { loadSession, updateSession, deleteSession } = await import("../sessionStore")

const sessionFile = path.join(tmpDir, "sessions.json")

describe("sessionStore", () => {
  afterEach(() => {
    try {
      fs.unlinkSync(sessionFile)
    } catch {
      // ignore
    }
  })

  afterAll(() => {
    delete process.env.SYNOLOGY_DS_CONFIG_DIR
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test("loadSession returns undefined for unknown host", () => {
    const result = loadSession("https://nonexistent.local:5001")
    expect(result).toBeUndefined()
  })

  test("updateSession writes and loadSession reads back", () => {
    const host = "https://test-roundtrip.local:5001"
    updateSession(host, { sid: "test-sid-123", username: "admin" })
    const session = loadSession(host)
    expect(session).toBeDefined()
    expect(session?.sid).toBe("test-sid-123")
    expect(session?.username).toBe("admin")
    expect(session?.updatedAt).toBeDefined()
  })

  test("updateSession merges partial updates", () => {
    const host = "https://test-merge.local:5001"
    updateSession(host, { sid: "sid-1", username: "admin" })
    updateSession(host, { destination: "/volume1/downloads" })
    const session = loadSession(host)
    expect(session?.sid).toBe("sid-1")
    expect(session?.username).toBe("admin")
    expect(session?.destination).toBe("/volume1/downloads")
  })

  test("deleteSession removes the host entry", () => {
    const host = "https://test-delete.local:5001"
    updateSession(host, { sid: "sid-to-delete" })
    deleteSession(host)
    const session = loadSession(host)
    expect(session).toBeUndefined()
  })

  test("host key is normalized (trailing slash, case)", () => {
    const host1 = "https://NAS.Local:5001/"
    const host2 = "https://nas.local:5001"
    updateSession(host1, { sid: "normalized-sid" })
    const session = loadSession(host2)
    expect(session?.sid).toBe("normalized-sid")
  })
})
