import { SynologyClient, SynologyRequestError, isDownloadUrl } from "./SynologyClient"

export interface RelayServer {
  readonly port: number
  stop(closeActiveConnections?: boolean): void
}

export interface RelayOptions {
  client: SynologyClient
  host: string
  port: number
  refreshSession: () => Promise<void>
  resolveDestination: () => string | undefined
}

const MAX_BODY_SIZE = 65_536

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  }
}

function isAllowedOrigin(origin: string): boolean {
  return origin.startsWith("safari-web-extension://")
}

function extractFilename(url: string): string | undefined {
  if (url.startsWith("magnet:")) return undefined
  try {
    const name = new URL(url).pathname.split("/").pop()
    return name || undefined
  } catch {
    return undefined
  }
}

function isAddBody(value: unknown): value is { url: string } {
  return typeof value === "object" && value !== null && "url" in value && typeof (value as { url: unknown }).url === "string"
}

async function handleAdd(
  req: Request,
  options: RelayOptions,
  coalesce: { refreshPromise: Promise<void> | null },
): Promise<Response> {
  const origin = req.headers.get("Origin")

  if (!origin || !isAllowedOrigin(origin)) {
    return Response.json({ ok: false, error: "Forbidden origin" }, { status: 403 })
  }

  const headers = corsHeaders(origin)

  const contentLength = req.headers.get("Content-Length")
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return Response.json({ ok: false, error: "Request body too large" }, { status: 413, headers })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400, headers })
  }

  if (!isAddBody(body)) {
    return Response.json({ ok: false, error: "Missing or invalid 'url' field" }, { status: 400, headers })
  }

  const url = body.url
  if (!isDownloadUrl(url)) {
    return Response.json(
      { ok: false, error: "URL must start with http://, https://, or magnet:" },
      { status: 400, headers },
    )
  }

  const filename = extractFilename(url)
  const successBody = { ok: true, ...(filename ? { filename } : {}) }

  async function getDestination(): Promise<string | undefined> {
    try {
      return options.resolveDestination() ?? await options.client.getDefaultDestination()
    } catch {
      return undefined
    }
  }

  async function refreshWithCoalescing(): Promise<void> {
    if (coalesce.refreshPromise) {
      return coalesce.refreshPromise
    }
    coalesce.refreshPromise = options.refreshSession().finally(() => {
      coalesce.refreshPromise = null
    })
    return coalesce.refreshPromise
  }

  try {
    const destination = await getDestination()
    await options.client.createTaskFromUrl(url, destination)
    return Response.json(successBody, { headers })
  } catch (error) {
    if (error instanceof SynologyRequestError && error.code === 119) {
      try {
        await refreshWithCoalescing()
      } catch (reAuthError) {
        const message = reAuthError instanceof Error ? reAuthError.message : "Re-authentication failed"
        console.error("Re-authentication failed:", message)
        return Response.json(
          { ok: false, error: `Re-authentication failed. Run \`eval "$(op signin)"\` in the relay terminal.` },
          { status: 503, headers },
        )
      }
      try {
        const destination = await getDestination()
        await options.client.createTaskFromUrl(url, destination)
        return Response.json(successBody, { headers })
      } catch (retryError) {
        const message = retryError instanceof Error ? retryError.message : "Unknown error"
        return Response.json({ ok: false, error: message }, { status: 502, headers })
      }
    }

    const message = error instanceof Error ? error.message : "Unknown error"
    const isNetwork = message.includes("fetch") || message.includes("timeout") || message.includes("ECONNREFUSED")
    return Response.json(
      { ok: false, error: message },
      { status: isNetwork ? 502 : 500, headers },
    )
  }
}

export function startRelay(options: RelayOptions): RelayServer {
  const coalesce = { refreshPromise: null as Promise<void> | null }

  const server = Bun.serve({
    port: options.port,
    hostname: "127.0.0.1",

    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url)
      const origin = req.headers.get("Origin")

      if (req.method === "OPTIONS") {
        if (origin && isAllowedOrigin(origin)) {
          return new Response(null, { status: 204, headers: corsHeaders(origin) })
        }
        return new Response(null, { status: 204 })
      }

      if (req.method === "POST" && url.pathname === "/add") {
        return handleAdd(req, options, coalesce)
      }

      return Response.json({ error: "Not found" }, { status: 404 })
    },

    error(error: Error): Response {
      console.error("Relay error:", error.message)
      return Response.json({ ok: false, error: "Internal server error" }, { status: 500 })
    },
  })

  return { port: server.port!, stop: (force?: boolean) => server.stop(force) }
}
