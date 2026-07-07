# Frontend Guide

## Scope

`src/` is a framework-free TypeScript SPA built with DOM APIs, a small in-memory store, and tolerant parser adapters.

## Structure

- `parsers/`: `SessionBundle` detection and normalization into the shared `Session` model
- `store/`: descriptor list, imported bundles, parsed sessions, loading state, filters, and selection
- `ui/`: application shell, sidebar, session detail, import modal, SSH modal, markdown rendering

## Current Behavior

- The frontend consumes two backend contracts only:
  - descriptor lists from `/api/local/scan`
  - raw bundles from `/api/local/session`
- Browser-imported files stay in `SessionStore`; they are parsed locally and are not sent to the backend.
- Source detection is heuristic and tolerant. If a parser fails, the UI should still render a readable fallback session.
- Antigravity is the one source whose backend bundle is generated rather than raw:
  the server decrypts `.pb` and returns a `#chat.jsonl` file, then the frontend parser normalizes that JSONL into `Session`.
- The main shell currently includes:
  - local rescan
  - file import
  - SSH sync modal
  - light / dark theme toggle
- Session detail currently includes:
  - message filters
  - timeline jump navigation
  - markdown-like message rendering
  - expandable tool call blocks
  - export to JSON

## Expectations

- Keep rendering functions deterministic and side effects contained.
- Avoid hidden app state outside `SessionStore`, except narrow UI-local state such as scroll position or modal internals.
- Preserve dense log-viewer ergonomics over chat-bubble styling.
- Keep parser behavior additive. Prefer partial readability plus metadata over strict schema rejection.
- When changing shared shapes, update `shared/types.ts` first and then adapt store and UI call sites.
- Antigravity parser logic lives in `src/parsers/antigravity.ts`.
  - Treat the generated `chat JSONL` as the parser input.
  - Keep source detection tolerant in `src/parsers/detect.ts`.
- Preserve the distinction between:
  - `SessionDescriptor` for lists and discovery
  - `SessionBundle` for raw file payloads
  - `Session` for normalized rendering
