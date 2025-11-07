import { URL } from "node:url"
import type { AuthData, SynologyResponse, Task, TasksResponse, TaskOperation } from "../types/synology"

export class SynologyRequestError extends Error {
  constructor(message: string, public readonly code?: number) {
    super(code ? `${message} (${code})` : message)
  }
}

export interface SynologyClientOptions {
  host: string
  allowInsecure?: boolean
  timeoutMs?: number
}

export class SynologyClient {
  private sid?: string

  private readonly host: string

  private readonly timeout: number

  constructor(private readonly options: SynologyClientOptions) {
    this.host = options.host.replace(/\/+$/, "")
    this.timeout = Math.max(options.timeoutMs ?? 10_000, 1)
    if (options.allowInsecure) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
    }
  }

  get sessionId(): string | undefined {
    return this.sid
  }

  set sessionId(value: string | undefined) {
    this.sid = value
  }

  async login(username: string, password: string, otp?: string) {
    const params: Record<string, string> = {
      api: "SYNO.API.Auth",
      version: "7",
      method: "login",
      account: username,
      passwd: password,
      format: "sid",
    }
    if (otp) {
      params.otp_code = otp
    }

    const response = await this.post<AuthData>(params, false)
    if (!response.success || !response.data?.sid) {
      const code = response.error?.code ?? -1
      throw new SynologyRequestError("Authentication failed", code)
    }
    this.sid = response.data.sid
  }

  async listTasks(): Promise<Task[]> {
    const response = await this.post<TasksResponse>({
      api: "SYNO.DownloadStation2.Task",
      version: "2",
      method: "list",
      additional: '["transfer","detail"]',
    })
    return this.parseData(response, "Failed to list tasks.").task
  }

  async pauseTask(id: string) {
    await this.requireSuccess(
      this.post<TaskOperation>({
        api: "SYNO.DownloadStation2.Task",
        version: "2",
        method: "pause",
        id,
      }),
      "Failed to pause task.",
    )
  }

  async resumeTask(id: string) {
    await this.requireSuccess(
      this.post<TaskOperation>({
        api: "SYNO.DownloadStation2.Task",
        version: "2",
        method: "resume",
        id,
      }),
      "Failed to resume task.",
    )
  }

  async deleteTask(id: string, force = false) {
    await this.requireSuccess(
      this.post<TaskOperation>({
        api: "SYNO.DownloadStation2.Task",
        version: "2",
        method: "delete",
        id,
        force_complete: force ? "true" : "false",
      }),
      "Failed to delete task.",
    )
  }

  async clearCompleted() {
    await this.requireSuccess(
      this.post<TaskOperation>({
        api: "SYNO.DownloadStation2.Task",
        version: "2",
        method: "delete_condition",
        status: "5",
      }),
      "Failed to clear tasks.",
    )
  }

  async createTaskFromUrl(url: string, destination?: string) {
    if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("magnet:")) {
      throw new Error("URL must start with http://, https://, or magnet:.")
    }
    const params: Record<string, string> = {
      api: "SYNO.DownloadStation2.Task",
      version: "2",
      method: "create",
      type: '"url"',
      url,
      create_list: "false",
    }
    if (destination) {
      params.destination = destination
    }
    await this.requireSuccess(this.post(params), "Failed to create task.")
  }

  private async post<T>(params: Record<string, string>, includeSid = true): Promise<SynologyResponse<T>> {
    const payload = new URLSearchParams(params)
    if (includeSid) {
      if (!this.sid) {
        throw new Error("Not authorized. Call login() first.")
      }
      payload.append("_sid", this.sid)
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeout)
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        body: payload,
        signal: controller.signal,
      })
      if (!response.ok) {
        if (response.status === 401) {
          this.sid = undefined
          throw new SynologyRequestError("Session expired", 119)
        }
        const body = await response.text()
        throw new SynologyRequestError(`HTTP ${response.status}: ${body}`, response.status)
      }
      return (await response.json()) as SynologyResponse<T>
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Request timed out")
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  private get endpoint() {
    return new URL("/webapi/entry.cgi", this.host).toString()
  }

  private parseData<T>(response: SynologyResponse<T>, context: string): T {
    if (response.success && response.data) {
      return response.data
    }
    const code = response.error?.code ?? -1
    if (code === 119) {
      this.sid = undefined
    }
    throw new SynologyRequestError(context, code)
  }

  private async requireSuccess(promise: Promise<SynologyResponse<unknown>>, context: string) {
    const response = await promise
    if (!response.success) {
      const code = response.error?.code ?? -1
      if (code === 119) {
        this.sid = undefined
      }
      throw new SynologyRequestError(context, code)
    }
  }
}
