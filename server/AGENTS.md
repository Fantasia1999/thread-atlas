# Server Guide

## Scope

`server/` is a thin Express backend for local scan, on-demand bundle loading, scan-root configuration, SSH workflows, remote agent proxying, and static serving of the built frontend.

The same code also ships as a standalone agent (`server/agent.ts`, bundled to `dist/agent/atlas-agent.mjs`) that can be deployed to a remote host. It serves a subset of the routes over plain `node:http` with no Express dependency.

## Key Responsibilities

### Sessions

- `GET /api/local/scan`: scan the effective scan roots and the `data/remote/` mirror, then return `SessionDescriptor[]`
- `GET /api/local/session?key=...`: load one `SessionBundle` by key
  - most sources return raw files directly
  - Antigravity `.pb` returns a generated `#chat.jsonl` bundle produced from local decode
- `GET /api/local/file?path=...`: serve one file for the preview modal, restricted to allowed bases

### Scan roots

- `GET /api/local/roots`: describe every configured root (built-in, discovered, custom) plus the raw config and the configurable source list
- `PUT /api/local/roots`: persist user roots to `data/scan-roots.json`
- `POST /api/local/roots/inspect`: check a candidate path — existence, kind, session count, detected source
- `GET /api/local/browse?path=...`: list directory entries for the UI path picker

### SSH and remote agents

- `POST /api/ssh/test` / `POST /api/ssh/scan` / `POST /api/ssh/sync`: legacy mirror workflow; sync writes into `data/remote/<user>@<host>/...`
- `POST /api/remote/connect`, `GET /api/remote/list`, `DELETE /api/remote/:id`: deploy and manage remote agents
- `GET /api/remote/:id/{scan,session,file}`: proxy to a connected remote agent

### Agent info

- `GET /api/agent/info`: platform, version, capabilities, and the resolved scan roots

## Current Constraints

- Keep the server stateless beyond request-local work. The one persisted file is `data/scan-roots.json`; treat it as user data, not a cache.
- Do not move parsing responsibility into the backend; it should return descriptors and raw bundles, not normalized sessions.
- Antigravity binary transport decode is allowed on the backend because the browser does not parse encrypted protobuf directly.
- Keep filesystem writes under `data/` — `data/remote/` for the SSH mirror and `data/scan-roots.json` for scan configuration. Nothing else is written.
- `GET /api/local/browse` returns names and types only. It must never return file contents.
- Local and remote scan behavior is heuristic and intentionally bounded rather than exhaustive.
- OpenCode scan support is SQLite-backed through the Node dependency. If a database query fails, return no OpenCode results rather than crashing.
- Antigravity descriptor decode prefers the bundled snapshot in `server/antigravity/descriptorSnapshot.ts` and only falls back to extracting descriptors from a local `extension.js` when needed.

## Scan roots

Roots resolve in layers, composed by `server/scanRoots.ts`:

1. `server/platformRoots.ts` — per-OS product defaults. Every source is a `ScanRootEntry[]` (`{ path, label? }`), so any source can hold several histories. `ATLAS_CLAUDE_ROOTS` adds Claude roots from the environment.
2. `server/claudeArchives.ts` — archived Claude copies discovered next to the home directory (a claude-like directory name that also contains `projects`).
3. `server/scanConfig.ts` — user roots persisted from the UI, plus the built-in roots the user switched off.

`resolveEffectiveScanRoots(...)` produces what a scan actually uses; `describeScanRoots(...)` produces what the UI shows, including disabled entries so they can be switched back on.

A root's `label` becomes `SessionDescriptor.archiveLabel`, which the UI badges so sessions from different machines stay distinguishable. Built-in roots stay unlabeled.

Config reads are deliberately tolerant: unknown sources, blank paths and duplicates are dropped, and an unreadable or corrupted file falls back to defaults rather than failing a scan.

## Implementation Notes

- Default scan roots (all user-overridable through the UI):
  - `~/.codex/sessions`
  - `~/.claude/projects`
  - `~/.gemini/tmp`
  - `~/.gemini/antigravity`, `~/.gemini/antigravity-cli`
  - `~/.copilot/session-state`
  - `~/.local/share/opencode/opencode.db` (XDG / platform conventions apply)
  - mirrored files under `data/remote/`
- Remote scan currently probes fixed known paths for Codex, Claude, Gemini, Antigravity, Copilot session directories, and `~/.local/share/opencode/opencode.db`. It does not read the configured roots.
- Session keys have three active forms:
  - `file::<absolutePath>`
  - `copilot-dir::<sessionDir>`
  - `opencode-sqlite::<dbPath>::<sessionId>`
  - (`import::` exists too, but is browser-side only and never reaches the backend)
- `loadLocalSessionBundle(...)` maps a path back to its owning configured root, so a session in a user-added directory keeps the right source and archive label regardless of where that directory lives.
- Remote sync should download files first and let the normal local scanner pick them up afterward.
  - Copilot is still mirrored as files even though SSH scan presents a session-directory selection.
- Preserve stable response shapes with `shared/types.ts` as the source of truth.
- `server/antigravity/descriptorSnapshot.ts` is a checked-in snapshot of protobuf descriptors.
  - Refresh it when upstream Antigravity descriptors change.
  - Runtime fallback may still read the installed Antigravity `extension.js` if the bundled snapshot is stale.

## Safety

- Never execute remote commands built from unsanitized user shell fragments.
- Keep SSH credential handling minimal and request-scoped.
- Sanitize host-derived local mirror path segments before writing files.
- `PUT /api/local/roots` rejects relative paths and unknown sources rather than storing them.
- The agent owns filesystem access by design. When binding to anything other than loopback, require a token (`--token`).
