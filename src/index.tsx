#!/usr/bin/env bun
/** @jsxImportSource @opentui/react */
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { Command } from "commander"
import stripAnsi from "strip-ansi"
import { App } from "./tui/App"
import { loadConfig, saveConfig } from "./services/configStore"
import { authenticate } from "./services/auth"
import { prompt } from "./services/prompt"

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

export async function resolveConfig(options: CLIOptions) {
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

  return { host, allowInsecure, opItem, opVault, useSessionCache, timeoutMs }
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
  const config = await resolveConfig(options)

  const auth = await authenticate({
    ...config,
    manualFallback: true,
  })

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
