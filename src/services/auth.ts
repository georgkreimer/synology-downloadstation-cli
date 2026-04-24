import { SynologyClient, SynologyRequestError } from "./SynologyClient"
import * as defaultSessionStore from "./sessionStore"
import type { SessionState } from "./sessionStore"
import * as defaultOnePassword from "./onePassword"
import { prompt, promptHidden } from "./prompt"
import type { Task } from "../types/synology"

export interface AuthDeps {
  loadSession: typeof defaultSessionStore.loadSession
  updateSession: typeof defaultSessionStore.updateSession
  deleteSession: typeof defaultSessionStore.deleteSession
  fetchOnePasswordCredentials: typeof defaultOnePassword.fetchOnePasswordCredentials
  fetchOnePasswordTotp: typeof defaultOnePassword.fetchOnePasswordTotp
}

export interface AuthConfig {
  host: string
  allowInsecure: boolean
  timeoutMs: number
  opItem?: string
  opVault?: string
  useSessionCache: boolean
  manualFallback: boolean
  deps?: Partial<AuthDeps>
}

export interface AuthResult {
  client: SynologyClient
  username: string
  initialTasks: Task[]
  cachedDestination?: string
  refreshSession: () => Promise<void>
  updateDestination: (destination: string) => void
}

export async function authenticate(config: AuthConfig): Promise<AuthResult> {
  const { loadSession, updateSession, deleteSession } = { ...defaultSessionStore, ...config.deps }
  const { fetchOnePasswordCredentials, fetchOnePasswordTotp } = { ...defaultOnePassword, ...config.deps }

  const client = new SynologyClient({
    host: config.host,
    allowInsecure: config.allowInsecure,
    timeoutMs: config.timeoutMs,
  })

  let cachedSession = config.useSessionCache ? loadSession(config.host) : undefined
  if (cachedSession?.sid) {
    client.sessionId = cachedSession.sid
  }

  const mergeSession = (partial: SessionState) => {
    cachedSession = { ...(cachedSession ?? {}), ...partial }
    if (config.useSessionCache) {
      updateSession(config.host, cachedSession)
    }
  }

  let displayUsername: string | undefined = cachedSession?.username
  const usesOnePassword = Boolean(config.opItem)

  async function authenticateWithOnePassword() {
    if (!config.opItem) {
      throw new Error("1Password item not provided.")
    }
    const creds = fetchOnePasswordCredentials(config.opItem, config.opVault)
    displayUsername = creds.username
    const otp = fetchOnePasswordTotp(config.opItem, config.opVault) ?? creds.totp
    await client.login(creds.username, creds.password, otp)
    if (client.sessionId) {
      mergeSession({ sid: client.sessionId, username: creds.username })
    }
  }

  async function authenticateManually() {
    const username = await prompt("Username: ", { defaultValue: displayUsername })
    const password = await promptHidden("Password: ")
    displayUsername = username
    const otpInput = await prompt("One-time code (press Enter to skip): ", { allowEmpty: true })
    const otp = otpInput?.trim() ? otpInput.trim() : undefined
    await client.login(username, password, otp)
    if (client.sessionId) {
      mergeSession({ sid: client.sessionId, username })
    }
  }

  async function doAuthenticate() {
    if (usesOnePassword) {
      await authenticateWithOnePassword()
    } else if (config.manualFallback) {
      await authenticateManually()
    } else {
      throw new Error(
        "Session expired and no 1Password configuration found. " +
        "Configure 1Password with `synology-ds --op-item <item>` or authenticate via the TUI first.",
      )
    }
  }

  let initialTasks: Task[]

  if (client.sessionId) {
    try {
      initialTasks = await client.listTasks()
    } catch (error) {
      if (error instanceof SynologyRequestError && error.code === 119) {
        client.sessionId = undefined
        if (config.useSessionCache) {
          deleteSession(config.host)
        }
        cachedSession = undefined
        await doAuthenticate()
        initialTasks = await client.listTasks()
      } else {
        throw error
      }
    }
  } else {
    await doAuthenticate()
    initialTasks = await client.listTasks()
  }

  return {
    client,
    username: displayUsername ?? "unknown",
    initialTasks,
    cachedDestination: cachedSession?.destination,
    refreshSession: doAuthenticate,
    updateDestination: (destination: string) => mergeSession({ destination }),
  }
}
