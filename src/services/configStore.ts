import { getConfigPath, readJSONFile, writeJSONFile } from "../utils/fs"

export interface StoredConfig {
  host?: string
  allowInsecure?: boolean
  opItem?: string
  opVault?: string
  sessionCache?: boolean
}

const CONFIG_FILE = getConfigPath("config.json")

export function loadConfig(): StoredConfig {
  return readJSONFile<StoredConfig>(CONFIG_FILE) ?? {}
}

export function saveConfig(config: StoredConfig) {
  const current = loadConfig()
  writeJSONFile(CONFIG_FILE, { ...current, ...config })
}
