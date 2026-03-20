# Server Guide

## Scope

`server/` is a thin Express backend for local scan, on-demand bundle loading, SSH workflows, and static serving of the built frontend.

## Key Responsibilities

- `GET /api/local/scan`: scan known local roots and the `data/remote/` mirror, then return `SessionDescriptor[]`
- `GET /api/local/session`: load one raw `SessionBundle` by key
- `POST /api/ssh/test`: verify SSH connectivity
- `POST /api/ssh/scan`: list remote session candidates from known paths
- `POST /api/ssh/sync`: download selected remote files into `data/remote/<user>@<host>/...`

## Current Constraints

- Keep the server stateless beyond request-local work.
- Do not move parsing responsibility into the backend; it should return descriptors and raw bundles, not normalized sessions.
- Keep all filesystem writes under `data/remote/`.
- Local and remote scan behavior is heuristic and intentionally bounded rather than exhaustive.
- OpenCode scan support is SQLite-backed through the Node dependency. If a database query fails, return no OpenCode results rather than crashing.

## Implementation Notes

- Local scan currently looks in:
  - `~/.codex/sessions`
  - `~/.claude/projects`
  - `~/.gemini/tmp`
  - `~/.local/share/opencode/opencode.db`
  - mirrored files under `data/remote/`
- Remote scan currently probes fixed known paths for Codex, Claude, Gemini, and `~/.local/share/opencode/opencode.db`.
- Session keys have two active forms:
  - `file::...`
  - `opencode-sqlite::<dbPath>::<sessionId>`
- Remote sync should download files first and let the normal local scanner pick them up afterward.
- Preserve stable response shapes with `src/parsers/types.ts` as the source of truth.

## Safety

- Never execute remote commands built from unsanitized user shell fragments.
- Keep SSH credential handling minimal and request-scoped.
- Sanitize host-derived local mirror path segments before writing files.
