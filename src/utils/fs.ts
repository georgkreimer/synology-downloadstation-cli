import fs from "node:fs"
import path from "node:path"
import os from "node:os"

const CONFIG_DIR = path.join(os.homedir(), ".config", "synology-ds")

export function ensureConfigDir(): string {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  }
  return CONFIG_DIR
}

export function getConfigPath(fileName: string): string {
  return path.join(ensureConfigDir(), fileName)
}

export function readJSONFile<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) return undefined
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

export function writeJSONFile<T>(filePath: string, data: T) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 })
}
