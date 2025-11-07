import { getConfigPath, readJSONFile, writeJSONFile } from "../utils/fs"

export interface SessionState {
  sid?: string
  username?: string
  destination?: string
  updatedAt?: string
}

type SessionStoreData = Record<string, SessionState>

const SESSION_FILE = getConfigPath("sessions.json")

function loadAll(): SessionStoreData {
  return readJSONFile<SessionStoreData>(SESSION_FILE) ?? {}
}

function persist(store: SessionStoreData) {
  writeJSONFile(SESSION_FILE, store)
}

function keyFor(host: string): string {
  return host.trim().replace(/\/+$/, "").toLowerCase()
}

export function loadSession(host: string): SessionState | undefined {
  const store = loadAll()
  return store[keyFor(host)]
}

export function saveSession(host: string, session: SessionState) {
  const store = loadAll()
  store[keyFor(host)] = session
  persist(store)
}

export function updateSession(host: string, partial: SessionState) {
  const store = loadAll()
  const key = keyFor(host)
  store[key] = { ...(store[key] ?? {}), ...partial }
  persist(store)
  return store[key]
}

export function deleteSession(host: string) {
  const store = loadAll()
  delete store[keyFor(host)]
  persist(store)
}
