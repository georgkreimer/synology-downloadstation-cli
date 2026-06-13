# Release Checklist

For maintainers publishing a new version.

## Preflight

1. Update `version` in `package.json`.
2. Run:

   ```bash
   bunx tsc --noEmit
   bun test
   bun pm pack --dry-run
   ```

3. Confirm the dry-run package includes:
   - `dist/index.js`
   - `README.md`
   - `LICENSE`
   - Safari extension files

   `dist/index.js` should keep package imports external. Native-backed dependencies such as
   `@opentui/core` must be resolved from the user's installed `node_modules` so the JavaScript
   bindings and platform dylib stay version-aligned.

## Publish to npm

```bash
bun publish --access public
```

If npm requires an OTP and the account uses passkeys instead of authenticator codes, create a granular npm access token with **Bypass two-factor authentication** enabled, then publish with `NPM_CONFIG_TOKEN` set for that shell:

```bash
NPM_CONFIG_TOKEN=<npm-token> bun publish --access public
```

After publishing, verify:

```bash
npm view synology-downloadstation-cli version dist-tags --json
```

## Tag and GitHub Release

```bash
git tag v$(bun -e 'console.log(require("./package.json").version)')
git push origin --tags
```

Create a GitHub release from the pushed tag with:

- user-facing changes
- validation commands
- install command:

  ```bash
  bun install --global synology-downloadstation-cli@latest
  ```
