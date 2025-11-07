import { spawnSync } from "node:child_process"

export interface OnePasswordCredentials {
  username: string
  password: string
  totp?: string
}

interface OnePasswordField {
  id?: string
  label?: string
  value?: string
  purpose?: string
}

interface OnePasswordItem {
  fields?: OnePasswordField[]
  sections?: { fields?: OnePasswordField[] }[]
  totp?: string
}

export function fetchOnePasswordCredentials(item: string, vault?: string): OnePasswordCredentials {
  const args = ["op", "item", "get", item, "--format", "json"]
  if (vault) {
    args.push("--vault", vault)
  }
  const result = spawnSync("env", args, { encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || "Failed to invoke 1Password CLI. Ensure you ran `eval \"$(op signin)\"`.")
  }

  const itemJson = JSON.parse(result.stdout) as OnePasswordItem
  const username = findField(itemJson, ["username", "user"])
  const password = findField(itemJson, ["password"])

  if (!username || !password) {
    throw new Error("1Password item must contain username and password fields.")
  }

  const totp = itemJson.totp ?? findField(itemJson, ["otp", "totp", "one-time password", "2fa", "mfa"])
  return { username, password, totp }
}

export function fetchOnePasswordTotp(item: string, vault?: string): string | undefined {
  const args = ["op", "item", "get", item, "--otp"]
  if (vault) {
    args.push("--vault", vault)
  }
  const result = spawnSync("env", args, { encoding: "utf8" })
  if (result.status !== 0) {
    return undefined
  }
  const code = result.stdout.trim()
  return code.length > 0 ? code : undefined
}

function findField(item: OnePasswordItem, keys: string[]): string | undefined {
  const lowered = keys.map((k) => k.toLowerCase())
  const fields = [...(item.fields ?? []), ...(item.sections?.flatMap((section) => section.fields ?? []) ?? [])]
  for (const field of fields) {
    if (!field) continue
    const candidates = [field.id, field.label, field.purpose].filter(Boolean).map((value) => value!.toLowerCase())
    if (candidates.some((value) => lowered.includes(value))) {
      return field.value ?? undefined
    }
  }
  return undefined
}
