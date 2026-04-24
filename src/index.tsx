#!/usr/bin/env bun
/** @jsxImportSource @opentui/react */
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { Command } from "commander"
import stripAnsi from "strip-ansi"
import { App } from "./tui/App"
import { loadConfig, saveConfig } from "./services/configStore"
import { authenticate } from "./services/auth"
import { startRelay } from "./services/relay"
import { prompt } from "./services/prompt"

const DEFAULT_RELAY_PORT = 19786

interface CLIOptions {
  host?: string
  insecure?: boolean
  opItem?: string
  opVault?: string
  timeout?: string
  noSessionCache?: boolean
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

interface ResolvedConfig {
  host: string
  allowInsecure: boolean
  opItem?: string
  opVault?: string
  useSessionCache: boolean
  timeoutMs: number
}

export async function resolveConfig(options: CLIOptions & { nonInteractive?: boolean }): Promise<ResolvedConfig> {
  const storedConfig = loadConfig()

  const requireInteractive = (question: string) => {
    if (options.nonInteractive) {
      throw new Error(`Missing configuration: ${question} Run the TUI first to complete onboarding, or pass --host and --op-item flags.`)
    }
  }

  let host = options.host ?? storedConfig.host ?? ""
  if (!host) {
    requireInteractive("no host configured.")
    host = await prompt("Synology URL: ")
  }
  host = normalizeHost(host)

  let allowInsecure = options.insecure ?? storedConfig.allowInsecure ?? false
  if (!options.insecure && storedConfig.allowInsecure === undefined && host.startsWith("https://")) {
    if (!options.nonInteractive) {
      const answer = await prompt("Allow self-signed certificates? (y/N): ", { allowEmpty: true })
      allowInsecure = /^y(es)?$/i.test(answer)
    }
  }

  let opItem = options.opItem ?? storedConfig.opItem
  let opVault = options.opVault ?? storedConfig.opVault
  const useSessionCache = !options.noSessionCache && (storedConfig.sessionCache ?? true)
  const timeoutMs = Number.parseInt(options.timeout ?? "10000", 10)

  if (!options.opItem && !storedConfig.opItem) {
    if (!options.nonInteractive) {
      const choice = await prompt("Use 1Password CLI for credentials? (y/N): ", { allowEmpty: true })
      if (/^y(es)?$/i.test(choice)) {
        opItem = await prompt("1Password item name or ID: ")
        const vaultAnswer = await prompt("1Password vault (press Enter for default): ", { allowEmpty: true })
        opVault = vaultAnswer.trim() !== "" ? vaultAnswer.trim() : undefined
      }
    }
  }

  saveConfig({
    host,
    allowInsecure,
    opItem,
    opVault,
    sessionCache: useSessionCache,
  })

  return { host, allowInsecure, opItem, opVault, useSessionCache, timeoutMs }
}

async function runTui(options: CLIOptions, relayPort: number) {
  ensureBunPolyfills()
  const config = await resolveConfig(options)

  const auth = await authenticate({
    ...config,
    manualFallback: true,
  })

  const { loadSession } = await import("./services/sessionStore")
  let relayServer: ReturnType<typeof startRelay> | undefined
  try {
    relayServer = startRelay({
      client: auth.client,
      host: config.host,
      port: relayPort,
      refreshSession: auth.refreshSession,
      resolveDestination: () => loadSession(config.host)?.destination,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`Warning: relay failed to start on port ${relayPort} (${msg}). Safari extension will not work.`)
  }

  const renderer = await createCliRenderer({ exitOnCtrlC: false })
  createRoot(renderer).render(
    <App
      client={auth.client}
      host={config.host}
      username={auth.username}
      refreshSession={auth.refreshSession}
      initialTasks={auth.initialTasks}
      initialDestination={auth.cachedDestination}
      onDestinationChange={auth.updateDestination}
      relayPort={relayServer?.port}
    />,
  )
}

async function runServe(options: CLIOptions, port: number) {
  const config = await resolveConfig({ ...options, nonInteractive: true })

  const auth = await authenticate({
    ...config,
    manualFallback: false,
  })

  const { loadSession } = await import("./services/sessionStore")
  const server = startRelay({
    client: auth.client,
    host: config.host,
    port,
    refreshSession: auth.refreshSession,
    resolveDestination: () => loadSession(config.host)?.destination,
  })

  console.log(`Relay listening on http://127.0.0.1:${server.port}`)
  console.log(`Connected to ${config.host} as ${auth.username}`)
  console.log("Press Ctrl+C to stop.")

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      server.stop()
      resolve()
    }
    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)
  })
}

async function main() {
  const program = new Command()
    .name("synology-ds")
    .description("Synology Download Station TUI powered by Bun + OpenTUI")
    .option("--host <url>", "Synology URL, e.g. https://nas.local:5001")
    .option("--insecure", "Allow self-signed TLS certificates")
    .option("--op-item <item>", "1Password item name or ID to load credentials from")
    .option("--op-vault <vault>", "1Password vault name or ID")
    .option("--timeout <ms>", "HTTP timeout in milliseconds (default 10000)")
    .option("--no-session-cache", "Disable session caching to disk")

  program
    .command("serve")
    .description("Start the HTTP relay for the Safari extension")
    .option("--port <number>", "Port to listen on", String(DEFAULT_RELAY_PORT))
    .action(async (serveOpts: { port: string }) => {
      const parentOpts = program.opts<CLIOptions>()
      const port = Number.parseInt(serveOpts.port, 10)
      if (Number.isNaN(port) || port < 1 || port > 65535) {
        console.error(`Invalid port: ${serveOpts.port}`)
        process.exit(1)
      }
      await runServe(parentOpts, port)
    })

  program.action(async () => {
    const options = program.opts<CLIOptions>()
    await runTui(options, DEFAULT_RELAY_PORT)
  })

  await program.parseAsync(process.argv)
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
