# ThreadAtlas

ThreadAtlas is a lightweight browser app for browsing AI coding sessions from local files, local machine scans, and SSH-synced remote mirrors.

It currently supports `codex`, `claude`, `opencode`, and `gemini` session sources without adding a frontend framework runtime.

## Features

- Browser-side import for local JSON and JSONL session files
- Local scan through a small Express API on `127.0.0.1:3030`
- SSH test, remote scan, and remote sync into `data/remote/<user>@<host>/...`
- Tolerant parsing into a shared session model for mixed sources
- Dense log-viewer UI with source filter, search, message filters, timeline jump, and JSON export
- Light and dark theme toggle

## Supported Sources

- Codex CLI
- Claude Code
- OpenCode
- Gemini CLI

### Local scan roots

- `~/.codex/sessions`
- `~/.claude/projects`
- `~/.gemini/tmp`
- `~/.local/share/opencode/opencode.db`
- `data/remote/` for previously synced remote files

### Remote scan roots

- `~/.codex/sessions`
- `~/.claude/projects`
- `~/.gemini/tmp`
- `~/.local/share/opencode/opencode.db`

## How It Works

- `GET /api/local/scan` returns session descriptors only
- `GET /api/local/session?key=...` returns one raw session bundle
- Frontend parsers normalize raw bundle content into one `Session` model
- Imported browser files stay in the browser store and are not uploaded to the backend
- Remote sync only writes under `data/remote/<user>@<host>/...`

## Development

### Requirements

- Node.js with npm

### Install

```bash
npm install
```

### Run dev mode

```bash
npm run dev
```

Then open `http://127.0.0.1:5173`.

Vite serves the frontend on port `5173` and proxies `/api` requests to the Express backend on `127.0.0.1:3030`.

### Validate

```bash
npm run typecheck
npm run build
```

## Common Workflows

### Browse local sessions

1. Start the app with `npm run dev`.
2. Click `Rescan local`.
3. Filter by source or search by title/path.
4. Open a session from the sidebar.

### Import files from the browser

1. Click `Import files`.
2. Choose one or more local session files.
3. Browse them directly in the UI without uploading them to the server.

### Sync from a remote machine

1. Click `SSH sync`.
2. Fill in host and username, then authenticate with password or private key.
3. Run `Test connection` or `Scan remote`.
4. Select the remote files you want.
5. Click `Sync selected`.
6. The downloaded files are stored under `data/remote/<user>@<host>/...` and appear in the normal local scan results.

## Architecture

- `server/`: Express backend for local scan, bundle loading, SSH workflows, and static serving of `dist/`
- `src/parsers/`: source detection and tolerant adapters
- `src/store/`: in-memory application state
- `src/ui/`: framework-free DOM UI

## Notes

- The backend discovers files and returns raw bundles; semantic parsing stays in the frontend.
- Missing local directories are treated as empty results, not errors.
- OpenCode SQLite scanning is handled through the bundled Node dependency, not a system `sqlite3` command.
- Parser behavior is intentionally best-effort. Unknown or partial data should still render as a readable session when possible.
