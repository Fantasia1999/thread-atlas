# Frontend Guide

## Scope

`src/` is a framework-free TypeScript SPA built with DOM APIs, a small in-memory store, and tolerant parser adapters.

## Structure

- `parsers/`: `SessionBundle` detection and normalization into the shared `Session` model
- `sources/`: per-source adapters (`detect`, `parse`, optional `buildResumeCommand`) and the registry that orders them
- `store/`:
  - `sessionStore.ts` — descriptors, imported bundles, parsed sessions, loading state, filters, selection, pins and favorites
  - `connection.ts` — which agent the UI talks to (local, or a remote agent through the local proxy) and the auth token
  - `searchQuery.ts` — sidebar search query parsing and descriptor matching
  - `scanRootsClient.ts` — client for the agent's scan-root and path-browser endpoints
- `ui/`: application shell (`app.ts`), sidebar, session detail (`chatView.ts`), message and markdown rendering, and the modals — import, SSH, connections, scan paths + directory picker, file preview, Markdown export

## Current Behavior

- Session data comes from two backend contracts only:
  - descriptor lists from `/api/local/scan`
  - raw bundles from `/api/local/session`
- Auxiliary endpoints exist for things other than session content: `/api/local/roots` (+ `inspect`) and `/api/local/browse` for scan-path configuration, `/api/local/file` for the preview modal, and `/api/remote/*` for talking to a connected remote agent. None of them return normalized sessions.
- Browser-imported files stay in `SessionStore`; they are parsed locally and are not sent to the backend.
- Source detection is heuristic and tolerant. If a parser fails, the UI should still render a readable fallback session.
- Antigravity is the one source whose backend bundle is generated rather than raw:
  the server decrypts `.pb` and returns a `#chat.jsonl` file, then the frontend parser normalizes that JSONL into `Session`.
- The main shell currently includes:
  - local rescan
  - scan-path configuration (per source, with a directory picker)
  - file import
  - SSH sync modal
  - remote agent connections
  - light / dark theme toggle
- The sidebar currently includes:
  - debounced search with a query syntax (terms, `-term`, `#tag`, `is:starred`, `source:` / `path:` / `title:` / `project:` / `archive:`, `before:` / `after:`) and inline match highlighting
  - source filter, favorites and tag chips
  - pinned sessions, a subagent tree for child sessions, and archive badges for non-default history roots
- Session detail currently includes:
  - message filters and timeline jump navigation
  - markdown-like message rendering with syntax highlighting, math, and Mermaid diagrams
  - expandable tool call blocks
  - copy as Markdown or rich text
  - resume-command copy, parent/back navigation
  - export to JSON or Markdown

## Expectations

- Keep rendering functions deterministic and side effects contained.
- Avoid hidden app state outside `SessionStore`, except narrow UI-local state such as scroll position or modal internals.
- Preserve dense log-viewer ergonomics over chat-bubble styling.
- Keep parser behavior additive. Prefer partial readability plus metadata over strict schema rejection.
- When adding a source, follow the registry and test flow in [docs/adding-a-source.md](../docs/adding-a-source.md).
- When changing shared shapes, update `shared/types.ts` first and then adapt store and UI call sites.
- Antigravity parser logic lives in `src/parsers/antigravity.ts`.
  - Treat the generated `chat JSONL` as the parser input.
  - Keep source detection tolerant in `src/parsers/detect.ts`.
- Preserve the distinction between:
  - `SessionDescriptor` for lists and discovery
  - `SessionBundle` for raw file payloads
  - `Session` for normalized rendering
- Rendering a large session is a hot path. The chat view renders in chunks and bails out when its list leaves the DOM; `app.ts` rebuilds messages only when the session identity or filter actually changes. Keep both properties when editing render code.
- Guard UI modules with tests using `tests/dom-mock.ts`, which simulates enough DOM for class, listener, and structure assertions under the Node test runner.
