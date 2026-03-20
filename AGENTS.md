# Repository Guide

## Purpose

This repository is a lightweight browser app for browsing AI coding sessions from three inputs:

- local filesystem scans through a localhost API
- browser-side file imports
- SSH sync into a local mirror under `data/remote/`

The app currently supports `codex`, `claude`, `opencode`, and `gemini` session sources.

## Architecture

- `server/`: Express backend on `127.0.0.1:3030` for local scan, bundle loading, SSH test / scan / sync, and static serving of `dist/`
- `src/parsers/`: source detection plus tolerant adapters that normalize raw bundles into one `Session` model
- `src/store/`: in-memory app state for descriptors, parsed sessions, imported bundles, filters, and selection
- `src/ui/`: plain TypeScript DOM UI with sidebar, session detail, import modal, and SSH modal

More specific guidance lives in `server/AGENTS.md` and `src/AGENTS.md`.

## Current Contracts

- `GET /api/local/scan` returns `SessionDescriptor[]` only. It must not inline file contents.
- `GET /api/local/session?key=...` returns one `SessionBundle` with raw file contents.
- Frontend parsers own normalization from `SessionBundle` to `Session`.
- Imported files stay browser-side in `SessionStore`; they are not uploaded to the backend.
- Remote sync writes only under `data/remote/<user>@<host>/...`.

If you change descriptor or bundle shapes, update `src/parsers/types.ts` first and propagate from there.

## Supported Sources

- Codex: scanned from `~/.codex/sessions`, usually `rollout-*.jsonl`
- Claude Code: scanned from `~/.claude/projects`, usually `.jsonl`
- Gemini CLI: scanned from `~/.gemini/tmp`, usually `.json`
- OpenCode:
  - local scan reads `~/.local/share/opencode/opencode.db`
  - remote scan and sync also operate on `opencode.db`

Imported browser files can still be source-detected from content and path hints even when they do not come from these scan roots.

## Working Rules

- Keep the app dependency-light. Do not introduce a framework runtime unless the user explicitly asks.
- Treat parser compatibility as best-effort and additive. Unknown or partially parsed inputs should fall back to a readable session instead of hard-failing.
- Keep backend behavior operationally boring: request-scoped work, no database, no long-lived cache.
- Preserve the current separation between scanning and parsing. The backend discovers files and returns raw bundles; parsers own semantic interpretation.
- Maintain graceful degradation for optional capabilities:
  - missing local directories should just produce no results
- Never let SSH-related code execute remote commands built from unsanitized user shell input.

## UI Expectations

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
- SSH discovery and sync live in `server/ssh.ts`. Preserve the rule that sync downloads files first and lets local scan treat them like any other local source.
- Dev mode depends on Vite proxying `/api` to `http://127.0.0.1:3030`; production build relies on the Express server serving `dist/`.

## Verification

- `npm run typecheck`
- `npm run build`
- Manual pass through:
  - local import
  - local scan
  - SSH test / scan / sync
  - message filters, timeline jump, and export on a loaded session
