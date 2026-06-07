# Developer Workflow

These notes are for people changing the code. Normal users should install from npm with:

```bash
bun install --global synology-downloadstation-cli
```

## Build From Source

```bash
git clone https://github.com/georgkreimer/synology-downloadstation-cli.git
cd synology-downloadstation-cli
bun install --frozen-lockfile
bun run build
./dist/index.js --help
```

## Commands

| Task | Command |
|------|---------|
| Install deps | `bun install` |
| Typecheck | `bunx tsc --noEmit` |
| Run tests | `bun test` |
| Run dev build | `bun run dev` |
| Build release | `bun run build` |
| Pack dry-run | `bun pm pack --dry-run` |

## Source Layout

```text
src/
  index.tsx             # CLI entry, onboarding, renderer boot
  services/             # Synology client, config/session stores, prompts, 1Password wrapper
  tui/                  # React components rendered through OpenTUI
  utils/                # Formatting and filesystem helpers
```

Keep TypeScript strict mode happy, prefer async/await, and avoid storing credentials or OTP values anywhere on disk.
