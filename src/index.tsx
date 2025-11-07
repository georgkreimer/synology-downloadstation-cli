#!/usr/bin/env bun
/** @jsxImportSource @opentui/react */
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { Command } from "commander"
import stripAnsi from "strip-ansi"
import { App } from "./tui/App"
import { SynologyClient, SynologyRequestError } from "./services/SynologyClient"
import { loadConfig, saveConfig } from "./services/configStore"
import { deleteSession, loadSession, updateSession, type SessionState } from "./services/sessionStore"
import { fetchOnePasswordCredentials, fetchOnePasswordTotp } from "./services/onePassword"
import { prompt, promptHidden } from "./services/prompt"

interface CLIOptions {
  host?: string
  insecure?: boolean
  opItem?: string
  opVault?: string
  timeout?: string
  noSessionCache?: boolean
}

interface Credentials {
  username: string
  password: string
}

function ensureBunPolyfills() {
  const bunGlobal = globalThis as typeof globalThis & {
    Bun?: typeof import("bun") & { stripANSI?: (input: string) => string }
  }
  const bun = bunGlobal.Bun
  if (bun && typeof bun.stripANSI !== "function") {
    bun.stripANSI = (input: string) => stripAnsi(input)
  }
}

async function main() {
  ensureBunPolyfills()
  const program = new Command()
    .name("synology-ds")
    .description("Synology Download Station TUI powered by Bun + OpenTUI")
    .option("--host <url>", "Synology URL, e.g. https://nas.local:5001")
    .option("--insecure", "Allow self-signed TLS certificates")
    .option("--op-item <item>", "1Password item name or ID to load credentials from")
    .option("--op-vault <vault>", "1Password vault name or ID")
    .option("--timeout <ms>", "HTTP timeout in milliseconds (default 10000)")
    .option("--no-session-cache", "Disable session caching to disk")

  const options = program.parse(process.argv).opts<CLIOptions>()
  const storedConfig = loadConfig()

  let host = options.host ?? storedConfig.host ?? ""
  if (!host) {
    host = await prompt("Synology URL: ")
  }
  host = normalizeHost(host)

  let allowInsecure = options.insecure ?? storedConfig.allowInsecure ?? false
  if (!options.insecure && storedConfig.allowInsecure === undefined && host.startsWith("https://")) {
    const answer = await prompt("Allow self-signed certificates? (y/N): ", { allowEmpty: true })
    allowInsecure = /^y(es)?$/i.test(answer)
  }

  let opItem = options.opItem ?? storedConfig.opItem
  let opVault = options.opVault ?? storedConfig.opVault
  const useSessionCache = !options.noSessionCache && (storedConfig.sessionCache ?? true)
  const timeoutMs = Number.parseInt(options.timeout ?? "10000", 10)

  if (!options.opItem && !storedConfig.opItem) {
    const choice = await prompt("Use 1Password CLI for credentials? (y/N): ", { allowEmpty: true })
    if (/^y(es)?$/i.test(choice)) {
      opItem = await prompt("1Password item name or ID: ")
      const vaultAnswer = await prompt("1Password vault (press Enter for default): ", { allowEmpty: true })
      opVault = vaultAnswer.trim() !== "" ? vaultAnswer.trim() : undefined
    }
  }

  saveConfig({
    host,
    allowInsecure,
    opItem,
    opVault,
    sessionCache: useSessionCache,
  })

  const client = new SynologyClient({ host, allowInsecure, timeoutMs })
  let cachedSession = useSessionCache ? loadSession(host) : undefined
  if (cachedSession?.sid) {
    client.sessionId = cachedSession.sid
  }

  const mergeSession = (partial: SessionState) => {
    cachedSession = { ...(cachedSession ?? {}), ...partial }
    if (useSessionCache) {
      updateSession(host, cachedSession)
    }
  }

  let credentialCache: Credentials | undefined
  let displayUsername: string | undefined = cachedSession?.username
  const usesOnePassword = Boolean(opItem)
  let initialTasks: Awaited<ReturnType<SynologyClient["listTasks"]>> | undefined

  async function authenticateWithOnePassword() {
    if (!opItem) {
      throw new Error("1Password item not provided.")
    }
    const creds = fetchOnePasswordCredentials(opItem, opVault)
    credentialCache = { username: creds.username, password: creds.password }
    displayUsername = creds.username
    const otp = fetchOnePasswordTotp(opItem, opVault) ?? creds.totp
    await client.login(creds.username, creds.password, otp)
    if (client.sessionId) {
      mergeSession({ sid: client.sessionId, username: creds.username })
    }
  }

  async function authenticateManually() {
    const username = await prompt("Username: ", { defaultValue: displayUsername })
    const password = await promptHidden("Password: ")
    credentialCache = { username, password }
    displayUsername = username
    const otpInput = await prompt("One-time code (press Enter to skip): ", { allowEmpty: true })
    const otp = otpInput?.trim() ? otpInput.trim() : undefined
    await client.login(username, password, otp)
    if (client.sessionId) {
      mergeSession({ sid: client.sessionId, username })
    }
  }

  async function authenticateInteractive() {
    if (usesOnePassword) {
      await authenticateWithOnePassword()
    } else {
      await authenticateManually()
    }
  }

  async function ensureSessionValid() {
    if (client.sessionId) {
      try {
        initialTasks = await client.listTasks()
        return
      } catch (error) {
        if (error instanceof SynologyRequestError && error.code === 119) {
          client.sessionId = undefined
          if (useSessionCache) {
            deleteSession(host)
          }
          cachedSession = undefined
        } else {
          throw error
        }
      }
    }
    await authenticateInteractive()
    initialTasks = await client.listTasks()
  }

  await ensureSessionValid()

  const refreshSession = async () => {
    if (usesOnePassword) {
      await authenticateWithOnePassword()
    } else {
      await authenticateManually()
    }
  }

  const handleDestinationChange = (destination: string) => {
    mergeSession({ destination })
  }

  const renderer = await createCliRenderer({ exitOnCtrlC: false })
  createRoot(renderer).render(
    <App
      client={client}
      host={host}
      username={displayUsername ?? credentialCache?.username ?? "unknown"}
      refreshSession={refreshSession}
      initialTasks={initialTasks}
      initialDestination={cachedSession?.destination}
      onDestinationChange={handleDestinationChange}
    />,
  )
}

function normalizeHost(host: string): string {
  const trimmed = host.trim()
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed.replace(/\/+$/, "")
  }
  return `https://${trimmed.replace(/\/+$/, "")}`
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
