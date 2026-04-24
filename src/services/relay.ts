import type { Server } from "bun"
import { SynologyClient, SynologyRequestError } from "./SynologyClient"

export interface RelayOptions {
  client: SynologyClient
  host: string
  port: number
  refreshSession: () => Promise<void>
  resolveDestination: () => string | undefined
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (origin && origin.startsWith("safari-web-extension://")) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }
  }
  return {}
}

function isAllowedScheme(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("magnet:")
}


async function handleAdd(
  req: Request,
  options: RelayOptions,
): Promise<Response> {
  const origin = req.headers.get("Origin")
  const headers = corsHeaders(origin)

  if (origin && !origin.startsWith("safari-web-extension://")) {
    return Response.json({ ok: false, error: "Forbidden origin" }, { status: 403, headers })
  }

  let body: { url?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400, headers })
  }

  const url = body.url
  if (!url || typeof url !== "string") {
    return Response.json({ ok: false, error: "Missing or invalid 'url' field" }, { status: 400, headers })
  }

  if (!isAllowedScheme(url)) {
    return Response.json(
      { ok: false, error: "URL must start with http://, https://, or magnet:" },
      { status: 400, headers },
    )
  }

  const filename = url.startsWith("magnet:") ? undefined : url.split("/").pop()
  const successBody = { ok: true, ...(filename ? { filename } : {}) }

  async function getDestination(): Promise<string | undefined> {
    try {
      return options.resolveDestination() ?? await options.client.getDefaultDestination()
    } catch {
      return undefined
    }
  }

  try {
    const destination = await getDestination()
    await options.client.createTaskFromUrl(url, destination)
    return Response.json(successBody, { headers })
  } catch (error) {
    if (error instanceof SynologyRequestError && error.code === 119) {
      try {
        await options.refreshSession()
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

export function startRelay(options: RelayOptions): Server<unknown> {
  const server = Bun.serve({
    port: options.port,
    hostname: "127.0.0.1",

    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url)
      const origin = req.headers.get("Origin")
      const headers = corsHeaders(origin)

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers })
      }

      if (req.method === "POST" && url.pathname === "/add") {
        return handleAdd(req, options)
      }

      return Response.json({ error: "Not found" }, { status: 404, headers })
    },

    error(error: Error): Response {
      console.error("Relay error:", error.message)
      return Response.json({ ok: false, error: "Internal server error" }, { status: 500 })
    },
  })

  return server
}
