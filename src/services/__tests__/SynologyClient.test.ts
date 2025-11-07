import { afterEach, describe, expect, test } from "bun:test"
import { SynologyClient, SynologyRequestError } from "../SynologyClient"

const originalFetch = globalThis.fetch

const setMockFetch = (
  fn: (input: RequestInfo | URL, init?: RequestInit | BunFetchRequestInit) => Promise<Response>,
) => {
  const mockFn = fn as typeof globalThis.fetch
  mockFn.preconnect =
    originalFetch.preconnect?.bind(originalFetch) ??
    (async () => {
      /* noop */
    })
  globalThis.fetch = mockFn
}

describe("SynologyClient", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("rejects unsupported URL schemes when creating tasks", async () => {
    const client = new SynologyClient({
      host: "https://nas.local:5001",
      allowInsecure: false,
      timeoutMs: 5000,
    })
    await expect(client.createTaskFromUrl("ftp://invalid", undefined)).rejects.toThrow(
      "URL must start with http:// or https://.",
    )
  })

  test("sends destination and SID when creating tasks", async () => {
    const client = new SynologyClient({
      host: "https://nas.local:5001",
      allowInsecure: false,
      timeoutMs: 5000,
    })
    client.sessionId = "abc123"

    let lastBody: string | undefined
    setMockFetch(async (_input, init) => {
      const body = init?.body
      lastBody = body instanceof URLSearchParams ? body.toString() : body?.toString()
      return new Response(JSON.stringify({ success: true, data: { listId: [], taskId: [] } }), { status: 200 })
    })

    await client.createTaskFromUrl("https://example.com/file.iso", "/volume1/downloads")

    expect(lastBody).toBeDefined()
    const params = new URLSearchParams(lastBody)
    expect(params.get("url")).toBe("https://example.com/file.iso")
    expect(params.get("destination")).toBe("/volume1/downloads")
    expect(params.get("_sid")).toBe("abc123")
  })

  test("createTasksFromUrls calls create once per url", async () => {
    const client = new SynologyClient({
      host: "https://nas.local:5001",
      allowInsecure: false,
      timeoutMs: 5000,
    })
    client.sessionId = "xyz789"

    const bodies: string[] = []
    setMockFetch(async (_input, init) => {
      const body = init?.body
      bodies.push(body instanceof URLSearchParams ? body.toString() : body?.toString() ?? "")
      return new Response(JSON.stringify({ success: true, data: { listId: [], taskId: [] } }), { status: 200 })
    })

    await client.createTasksFromUrls(["https://one.example/file1", "https://two.example/file2"], undefined)

    expect(bodies).toHaveLength(2)
    const firstParams = new URLSearchParams(bodies[0])
    const secondParams = new URLSearchParams(bodies[1])
    expect(firstParams.get("url")).toBe("https://one.example/file1")
    expect(secondParams.get("url")).toBe("https://two.example/file2")
  })

  test("wraps API failures in SynologyRequestError", async () => {
    const client = new SynologyClient({
      host: "https://nas.local:5001",
      allowInsecure: false,
      timeoutMs: 5000,
    })
    client.sessionId = "abc123"
    setMockFetch(async () =>
      new Response(JSON.stringify({ success: false, error: { code: 120 } }), {
        status: 200,
      }),
    )

    await expect(client.createTaskFromUrl("https://example.com/file.iso", undefined)).rejects.toBeInstanceOf(
      SynologyRequestError,
    )
  })
})
