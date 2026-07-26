# Repository Guide

## Purpose

This repository is a lightweight browser app for browsing AI coding sessions from three inputs:

- local filesystem scans through a localhost API
- browser-side file imports
- SSH sync into a local mirror under `data/remote/`

The app currently supports `codex`, `claude`, `opencode`, `gemini`, `antigravity`, and `copilot` session sources.

## Architecture

- `server/`: Express backend on `localhost:3030` for local scan, bundle loading, SSH test / scan / sync, and static serving of `dist/`
- `src/parsers/`: source detection plus tolerant adapters that normalize raw bundles into one `Session` model
- `src/store/`: in-memory app state for descriptors, parsed sessions, imported bundles, filters, and selection
- `src/ui/`: plain TypeScript DOM UI with sidebar, session detail, import modal, and SSH modal

More specific guidance lives in `server/AGENTS.md` and `src/AGENTS.md`.

## Current Contracts

- `GET /api/local/scan` returns `SessionDescriptor[]` only. It must not inline file contents.
- `GET /api/local/session?key=...` returns one `SessionBundle` with raw file contents.
- `GET`/`PUT /api/local/roots` read and write user-configured scan roots, persisted to `data/scan-roots.json`.
- `POST /api/local/roots/inspect` validates a candidate root; `GET /api/local/browse` lists directory entries for the picker and must never return file contents.
- Antigravity `.pb` is the one exception to "raw file contents":
  the backend may unwrap encrypted protobuf into a generated `#chat.jsonl` bundle so the frontend can keep using the normal parser contract.
- Frontend parsers own normalization from `SessionBundle` to `Session`.
- Imported files stay browser-side in `SessionStore`; they are not uploaded to the backend.
- Remote sync writes only under `data/remote/<user>@<host>/...`.

If you change descriptor or bundle shapes, update `shared/types.ts` first and propagate from there.

## Supported Sources

- Codex: scanned from `~/.codex/sessions`, usually `rollout-*.jsonl`
- Claude Code:
  - scanned from `~/.claude/projects`, usually `.jsonl`
  - archived history copies are scanned too: home-directory siblings whose name looks like a Claude home and that contain a `projects` directory (`server/claudeArchives.ts`), plus any roots listed in `ATLAS_CLAUDE_ROOTS`
  - descriptors from an archived root carry `archiveLabel` so the UI can tell otherwise-identical sessions apart; the live root stays unlabeled
- Gemini CLI: scanned from `~/.gemini/tmp`, usually `.json`
- Antigravity:
  - local scan prefers `transcript_full.jsonl` under `~/.gemini/antigravity*/brain/<session-id>/.system_generated/logs/`
  - if no parseable transcript exists, scan falls back to `.pb` files under `~/.gemini/antigravity*/conversations`
  - backend converts transcripts or decoded `.pb` into generated `#chat.jsonl`
  - descriptor loading prefers the bundled snapshot in the repo and falls back to the locally installed Antigravity `extension.js` when the snapshot is stale
- Copilot:
  - local scan reads `~/.copilot/session-state/<session-id>/events.jsonl`
  - backend loads the session directory as one bundle and may include sibling metadata files such as `workspace.yaml`
  - remote scan and sync also discover Copilot session directories under the same root and mirror known files locally before normal scanning
- OpenCode:
  - local scan reads `~/.local/share/opencode/opencode.db`
  - remote scan and sync also operate on `opencode.db`

Imported browser files can still be source-detected from content and path hints even when they do not come from these scan roots.

## Working Rules

- Keep the app dependency-light. Do not introduce a framework runtime unless the user explicitly asks.
- Treat parser compatibility as best-effort and additive. Unknown or partially parsed inputs should fall back to a readable session instead of hard-failing.
- Keep backend behavior operationally boring: request-scoped work, no database, no long-lived cache.
- Preserve the current separation between scanning and parsing. The backend discovers files and returns raw bundles; parsers own semantic interpretation.
- Antigravity binary decode is an allowed exception: the backend may decrypt / unpack `.pb` into chat-shaped JSONL, but it should not emit final normalized `Session` objects.
- Do not commit real local-sensitive identifiers in code, tests, fixtures, screenshots, or docs. This includes absolute home paths, real usernames, hostnames, workspace roots, SSH targets, and machine-specific directories. Product-default scan roots such as `~/.codex/sessions` are fine, and illustrative example paths are fine when they are clearly generic placeholders.
- Maintain graceful degradation for optional capabilities:
  - missing local directories should just produce no results
- Never let SSH-related code execute remote commands built from unsanitized user shell input.
- When writing or modifying UI modules, ensure they are guarded by appropriate test cases. Use `tests/dom-mock.ts` to simulate a browser DOM environment in Node.js test runner, allowing clean assertion of element classes, event registrations (e.g. click listeners), and structural changes.

## UI Expectations

- Refer to [DESIGN.md](file:///home/wcl/workspace/dev/thread-atlas/DESIGN.md) for all styling guidelines, color systems, fonts, and decorative mesh gradients when modifying or adding UI.
- Keep the SPA framework-free and store-driven.
- Preserve dense log-viewer ergonomics over chat bubbles.
- Keep sidebar workflows centered on quick scan, search, source filtering, and session selection.
- Keep session detail ergonomics centered on readable markdown-like content, tool-call inspection, message filters, and timeline jump navigation.
- Preserve existing user flows unless the task calls for a deliberate UX change:
  - `Rescan local`
  - `Import files`
  - `SSH sync`
  - `Export JSON`
  - light / dark theme toggle

## Implementation Hints

- Source detection lives in `src/parsers/detect.ts`. If you add a new source or new heuristics, keep them tolerant and order-sensitive.
- Scanner heuristics live in `server/scanner.ts`. They are intentionally shallow and capped rather than exhaustive.
- Scan roots resolve in layers: `server/platformRoots.ts` holds the per-OS defaults (every source is a `ScanRootEntry[]`), `server/claudeArchives.ts` discovers archived Claude copies, `server/scanConfig.ts` persists user roots, and `server/scanRoots.ts` composes all three. Add new configurable sources to `CONFIGURABLE_SOURCES`.
- `data/scan-roots.json` is user data, not a cache. Keep reads tolerant so a hand-edited or corrupted file degrades to defaults instead of failing a scan.
- Antigravity protobuf decode lives in `server/antigravity.ts`.
  - Keep the bundled descriptor snapshot in `server/antigravityDescriptors.ts`.
  - Prefer bundled descriptors first.
  - If bundled descriptors cannot decode current `.pb` shape well enough, fall back to extracting descriptors from the local Antigravity `extension.js`.
- SSH discovery and sync live in `server/ssh.ts`. Preserve the rule that sync downloads files first and lets local scan treat them like any other local source.
- Dev mode depends on Vite proxying `/api` to `http://localhost:3030`; production build relies on the Express server serving `dist/`.

## Verification

- `npm run test` to verify all parser, store, markdown and UI tests pass
- `npm run typecheck`
- `npm run build`
- Manual pass through:
  - local import
  - local scan
  - SSH test / scan / sync
  - message filters, timeline jump, and export on a loaded session
