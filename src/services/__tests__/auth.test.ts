import { afterEach, describe, expect, mock, test } from "bun:test"
import { authenticate, type AuthConfig, type AuthDeps } from "../auth"

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

function successResponse(data: unknown = { task: [] }): Response {
  return new Response(JSON.stringify({ success: true, data }), { status: 200 })
}

function loginResponse(sid: string): Response {
  return successResponse({ sid })
}

function makeDeps(overrides: Partial<AuthDeps> = {}): AuthDeps {
  return {
    loadSession: mock(() => undefined),
    updateSession: mock(() => ({}) as ReturnType<AuthDeps["updateSession"]>),
    deleteSession: mock(() => {}),
    fetchOnePasswordCredentials: mock(() => ({ username: "admin", password: "pass", totp: "123456" })),
    fetchOnePasswordTotp: mock(() => undefined),
    ...overrides,
  }
}

const baseConfig: AuthConfig = {
  host: "https://nas.local:5001",
  allowInsecure: false,
  timeoutMs: 5000,
  useSessionCache: false,
  manualFallback: false,
}

describe("authenticate", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("authenticates with valid cached session", async () => {
    const tasks = [{ id: "task1", title: "test.iso", size: 100, status: 2, additional: {} }]
    setMockFetch(async () => successResponse({ task: tasks }))

    const deps = makeDeps({
      loadSession: mock(() => ({ sid: "cached-sid", username: "admin" })),
    })

    const result = await authenticate({ ...baseConfig, useSessionCache: true, deps })

    expect(result.client.sessionId).toBe("cached-sid")
    expect(result.username).toBe("admin")
    expect(result.initialTasks).toHaveLength(1)
  })

  test("re-authenticates via 1Password on expired session", async () => {
    let callIndex = 0
    setMockFetch(async (_input, init) => {
      callIndex++
      if (callIndex === 1) {
        return new Response(JSON.stringify({ success: false, error: { code: 119 } }), { status: 200 })
      }
      const body = init?.body
      const params = body instanceof URLSearchParams ? body : new URLSearchParams(body?.toString())
      if (params.get("method") === "login") {
        return loginResponse("new-sid")
      }
      return successResponse({ task: [] })
    })

    const fetchCreds = mock(() => ({ username: "admin", password: "pass123", totp: "123456" }))
    const deps = makeDeps({
      loadSession: mock(() => ({ sid: "expired-sid", username: "admin" })),
      fetchOnePasswordCredentials: fetchCreds,
    })

    const result = await authenticate({
      ...baseConfig,
      opItem: "NAS",
      useSessionCache: true,
      deps,
    })

    expect(result.client.sessionId).toBe("new-sid")
    expect(fetchCreds).toHaveBeenCalledWith("NAS", undefined)
  })

  test("throws when no 1Password and manualFallback is false", async () => {
    setMockFetch(async () => {
      return new Response(JSON.stringify({ success: false, error: { code: 119 } }), { status: 200 })
    })

    const deps = makeDeps({
      loadSession: mock(() => ({ sid: "expired-sid" })),
    })

    await expect(
      authenticate({ ...baseConfig, useSessionCache: true, manualFallback: false, deps }),
    ).rejects.toThrow("Session expired and no 1Password configuration found")
  })

  test("authenticates fresh via 1Password when no cached session", async () => {
    setMockFetch(async (_input, init) => {
      const body = init?.body
      const params = body instanceof URLSearchParams ? body : new URLSearchParams(body?.toString())
      if (params.get("method") === "login") {
        return loginResponse("fresh-sid")
      }
      return successResponse({ task: [] })
    })

    const deps = makeDeps()

    const result = await authenticate({
      ...baseConfig,
      opItem: "NAS",
      useSessionCache: true,
      deps,
    })

    expect(result.client.sessionId).toBe("fresh-sid")
    expect(result.username).toBe("admin")
  })
})
