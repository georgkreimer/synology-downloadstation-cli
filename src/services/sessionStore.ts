import { getConfigPath, readJSONFile, writeJSONFile } from "../utils/fs"

export interface SessionState {
  sid?: string
  username?: string
  destination?: string
  updatedAt?: string
}

type SessionStoreData = Record<string, SessionState>

const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

function sessionFile(): string {
  return getConfigPath("sessions.json")
}

function loadAll(): SessionStoreData {
  return readJSONFile<SessionStoreData>(sessionFile()) ?? {}
}

function persist(store: SessionStoreData) {
  writeJSONFile(sessionFile(), store)
}

function keyFor(host: string): string {
  return host.trim().replace(/\/+$/, "").toLowerCase()
}

function isExpired(session: SessionState): boolean {
  if (!session.updatedAt) return true
  return Date.now() - new Date(session.updatedAt).getTime() > SESSION_TTL_MS
}

export function loadSession(host: string): SessionState | undefined {
  const store = loadAll()
  const session = store[keyFor(host)]
  if (!session) return undefined
  if (isExpired(session)) return undefined
  return session
}

export function updateSession(host: string, partial: SessionState) {
  const store = loadAll()
  const key = keyFor(host)
  store[key] = { ...(store[key] ?? {}), ...partial, updatedAt: new Date().toISOString() }
  persist(store)
  return store[key]
}

export function deleteSession(host: string) {
  const store = loadAll()
  delete store[keyFor(host)]
  persist(store)
}
