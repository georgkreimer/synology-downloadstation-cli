import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"

interface PromptOptions {
  allowEmpty?: boolean
  defaultValue?: string
}

export async function prompt(question: string, options?: PromptOptions): Promise<string> {
  const rl = readline.createInterface({ input, output })
  try {
    while (true) {
      const suffix = options?.defaultValue ? ` (${options.defaultValue})` : ""
      const answer = await rl.question(`${question}${suffix ? suffix : ""}`)
      const trimmed = answer.trim()
      if (!trimmed && options?.defaultValue) {
        return options.defaultValue
      }
      if (trimmed.length === 0 && !options?.allowEmpty) {
        continue
      }
      return trimmed
    }
  } finally {
    rl.close()
  }
}

export async function promptHidden(question: string): Promise<string> {
  const silentOutput = new Proxy(output, {
    get(target, prop) {
      if (prop === "write") {
        return function writeSilent(this: typeof target, data: string) {
          if (data.includes("\n")) {
            return target.write.call(this, data)
          }
          return true
        }
      }
      return Reflect.get(target, prop)
    },
  })
  const rl = readline.createInterface({ input, output: silentOutput as typeof output })
  try {
    const answer = await rl.question(question)
    output.write("\n")
    return answer.trim()
  } finally {
    rl.close()
  }
}
