# Server Guide

## Scope

`server/` is a thin Express backend for local scan, on-demand bundle loading, SSH workflows, and static serving of the built frontend.

## Key Responsibilities

- `GET /api/local/scan`: scan known local roots and the `data/remote/` mirror, then return `SessionDescriptor[]`
- `GET /api/local/session`: load one `SessionBundle` by key
  - most sources return raw files directly
  - Antigravity `.pb` returns a generated `#chat.jsonl` bundle produced from local decode
- `POST /api/ssh/test`: verify SSH connectivity
- `POST /api/ssh/scan`: list remote session candidates from known paths
- `POST /api/ssh/sync`: download selected remote files into `data/remote/<user>@<host>/...`

## Current Constraints

- Keep the server stateless beyond request-local work.
- Do not move parsing responsibility into the backend; it should return descriptors and raw bundles, not normalized sessions.
- Antigravity binary transport decode is allowed on the backend because the browser does not parse encrypted protobuf directly.
- Keep all filesystem writes under `data/remote/`.
- Local and remote scan behavior is heuristic and intentionally bounded rather than exhaustive.
- OpenCode scan support is SQLite-backed through the Node dependency. If a database query fails, return no OpenCode results rather than crashing.
- Antigravity descriptor decode prefers the bundled snapshot in `server/antigravity/descriptorSnapshot.ts` and only falls back to extracting descriptors from a local `extension.js` when needed.

## Implementation Notes

- Local scan currently looks in:
  - `~/.codex/sessions`
  - `~/.claude/projects`
  - `~/.gemini/tmp`
  - `~/.gemini/antigravity/conversations`
  - `~/.gemini/antigravity/brain`
  - `~/.gemini/antigravity-cli`
  - `~/.copilot/session-state`
  - `~/.local/share/opencode/opencode.db`
  - mirrored files under `data/remote/`
- Remote scan currently probes fixed known paths for Codex, Claude, Gemini, Antigravity, Copilot session directories, and `~/.local/share/opencode/opencode.db`.
- Session keys have two active forms:
  - `file::...`
  - `copilot-dir::...`
  - `opencode-sqlite::<dbPath>::<sessionId>`
- Remote sync should download files first and let the normal local scanner pick them up afterward.
  - Copilot is still mirrored as files even though SSH scan presents a session-directory selection.
- Preserve stable response shapes with `src/parsers/types.ts` as the source of truth.
- `server/antigravity/descriptorSnapshot.ts` is a checked-in snapshot of protobuf descriptors.
  - Refresh it when upstream Antigravity descriptors change.
  - Runtime fallback may still read the installed Antigravity `extension.js` if the bundled snapshot is stale.

## Safety

- Never execute remote commands built from unsanitized user shell fragments.
- Keep SSH credential handling minimal and request-scoped.
- Sanitize host-derived local mirror path segments before writing files.
