# Safari Extension Setup

The optional Safari Web Extension adds two context-menu actions:

- **Send link to NAS**
- **Send selected links to NAS**

The extension sends URLs to the local relay exposed by `synology-ds`.

## Requirements

- macOS
- Xcode
- `synology-ds` installed

## Build the Wrapper App

From a source checkout:

```bash
xcrun safari-web-extension-converter extension/ \
  --app-name "Send to NAS" \
  --bundle-identifier com.synology-ds.send-to-nas \
  --copy-resources --no-open
```

Then:

1. Open the generated Xcode project.
2. Run it with Product -> Run.
3. In Safari, open Settings -> Extensions.
4. Enable "Send to NAS".
5. Grant permission for "All Websites".

## Usage

- Right-click a link and choose **Send link to NAS**.
- Select text containing URLs, right-click, and choose **Send selected links to NAS**.

The extension connects to port `19786`. The TUI starts that relay automatically. For relay-only use:

```bash
synology-ds serve --port 19786
```
