import { afterEach, describe, expect, mock, test } from "bun:test"
import { startRelay, type RelayOptions } from "../relay"
import { SynologyClient, SynologyRequestError } from "../SynologyClient"

const originalFetch = globalThis.fetch
const TEST_PORT = 19787
const SAFARI_ORIGIN = "safari-web-extension://ABC123-DEF456"

function makeMockClient() {
  return {
    createTaskFromUrl: mock(async (_url: string, _dest?: string) => {}),
    getDefaultDestination: mock(async () => "/volume1/downloads" as string | undefined),
    sessionId: "test-sid",
    login: mock(async () => {}),
    listTasks: mock(async () => []),
  } as unknown as SynologyClient
}

function makeOptions(overrides: Partial<RelayOptions> = {}): RelayOptions {
  return {
    client: makeMockClient(),
    host: "https://nas.local:5001",
    port: TEST_PORT,
    refreshSession: mock(async () => {}),
    resolveDestination: mock(() => "/volume1/downloads" as string | undefined),
    ...overrides,
  }
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return originalFetch(`http://127.0.0.1:${TEST_PORT}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: SAFARI_ORIGIN, ...headers },
    body: JSON.stringify(body),
  })
}

describe("relay", () => {
  let server: ReturnType<typeof startRelay>

  afterEach(() => {
    server?.stop(true)
  })

  test("POST /add with valid http URL returns ok", async () => {
    const options = makeOptions()
    server = startRelay(options)

    const res = await post("/add", { url: "https://example.com/file.iso" })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.filename).toBe("file.iso")
    expect((options.client.createTaskFromUrl as ReturnType<typeof mock>)).toHaveBeenCalled()
  })

  test("POST /add strips query string from filename", async () => {
    const options = makeOptions()
    server = startRelay(options)

    const res = await post("/add", { url: "https://example.com/file.iso?token=abc&v=2" })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.filename).toBe("file.iso")
  })

  test("POST /add with magnet URI returns ok", async () => {
    const options = makeOptions()
    server = startRelay(options)

    const res = await post("/add", { url: "magnet:?xt=urn:btih:abc123" })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.filename).toBeUndefined()
  })

  test("POST /add with javascript: URL returns 400", async () => {
    const options = makeOptions()
    server = startRelay(options)

    const res = await post("/add", { url: "javascript:alert(1)" })
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.ok).toBe(false)
    expect(json.error).toContain("http://")
  })

  test("POST /add with missing url field returns 400", async () => {
    const options = makeOptions()
    server = startRelay(options)

    const res = await post("/add", { notUrl: "test" })
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.ok).toBe(false)
    expect(json.error).toContain("url")
  })

  test("POST /add with NAS error returns 500", async () => {
    const client = makeMockClient()
    ;(client.createTaskFromUrl as ReturnType<typeof mock>).mockImplementation(async () => {
      throw new SynologyRequestError("Failed to create task.", 120)
    })
    const options = makeOptions({ client })
    server = startRelay(options)

    const res = await post("/add", { url: "https://example.com/file.iso" })
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.ok).toBe(false)
  })

  test("session expired triggers re-auth and retry", async () => {
    let callCount = 0
    const client = makeMockClient()
    ;(client.createTaskFromUrl as ReturnType<typeof mock>).mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        throw new SynologyRequestError("Session expired", 119)
      }
    })
    const refreshSession = mock(async () => {})
    const options = makeOptions({ client, refreshSession })
    server = startRelay(options)

    const res = await post("/add", { url: "https://example.com/file.iso" })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(refreshSession).toHaveBeenCalled()
    expect(callCount).toBe(2)
  })

  test("re-auth failure returns 503", async () => {
    const client = makeMockClient()
    ;(client.createTaskFromUrl as ReturnType<typeof mock>).mockImplementation(async () => {
      throw new SynologyRequestError("Session expired", 119)
    })
    const refreshSession = mock(async () => {
      throw new Error("Failed to invoke 1Password CLI")
    })
    const options = makeOptions({ client, refreshSession })
    server = startRelay(options)

    const res = await post("/add", { url: "https://example.com/file.iso" })
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json.ok).toBe(false)
    expect(json.error).toContain("Re-authentication failed")
  })

  test("OPTIONS preflight returns CORS headers for safari-web-extension origin", async () => {
    const options = makeOptions()
    server = startRelay(options)

    const res = await originalFetch(`http://127.0.0.1:${TEST_PORT}/add`, {
      method: "OPTIONS",
      headers: { Origin: SAFARI_ORIGIN },
    })

    expect(res.status).toBe(204)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(SAFARI_ORIGIN)
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST")
  })

  test("OPTIONS without allowed origin returns no CORS headers", async () => {
    const options = makeOptions()
    server = startRelay(options)

    const res = await originalFetch(`http://127.0.0.1:${TEST_PORT}/add`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.com" },
    })

    expect(res.status).toBe(204)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })

  test("request without Origin header returns 403", async () => {
    const options = makeOptions()
    server = startRelay(options)

    const res = await originalFetch(`http://127.0.0.1:${TEST_PORT}/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/file.iso" }),
    })
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.ok).toBe(false)
  })

  test("request with evil origin returns 403", async () => {
    const options = makeOptions()
    server = startRelay(options)

    const res = await post("/add", { url: "https://example.com/file.iso" }, {
      Origin: "https://evil.com",
    })
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.ok).toBe(false)
  })

  test("GET /add returns 404", async () => {
    const options = makeOptions()
    server = startRelay(options)

    const res = await originalFetch(`http://127.0.0.1:${TEST_PORT}/add`)

    expect(res.status).toBe(404)
  })

  test("POST /nonexistent returns 404", async () => {
    const options = makeOptions()
    server = startRelay(options)

    const res = await post("/nonexistent", { url: "https://example.com" })
    const json = await res.json()

    expect(res.status).toBe(404)
  })
})
