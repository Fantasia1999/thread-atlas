# Adding a Session Source

Source support crosses shared contracts, frontend parsing, and optionally backend local scanning. Browser imports need only the shared and frontend steps. A source that should appear in `Rescan local` also needs a backend adapter.

Keep the existing boundary intact: the backend discovers sessions and returns `SessionDescriptor` or `SessionBundle` values, while frontend parsers normalize bundles into `Session` values. Antigravity binary decoding is the only current backend exception, and it still produces a generated bundle rather than a normalized session.

## 1. Extend the shared source type

Add the new literal to `SessionSource` in `shared/types.ts`. This is the source of truth for frontend adapters, backend adapters, descriptors, bundles, sessions, filters, and SSH records.

Do not replace or repurpose `"unknown"`; detection and readable fallback behavior depend on it.

## 2. Create the frontend parser

Create `src/parsers/<source>.ts` and export a parser with the same contract as the existing parsers:

```ts
export function parseExampleSession(bundle: SessionBundle): Session {
  // Normalize the source bundle into the shared Session shape.
}
```

Keep the parser tolerant. Missing files, malformed records, and unsupported partial shapes should return `buildFallbackSession(...)` from `src/parsers/utils.ts` instead of throwing. Preserve useful raw content and metadata when only part of the input is understood.

## 3. Create and register the frontend adapter

Create `src/sources/<source>.ts` with a `SourceAdapter` from `src/sources/types.ts`. The adapter owns:

- `id`: the new `SessionSource` literal
- `label`: the UI display label
- `detect(bundle, context)`: path and content heuristics
- `parse(bundle)`: the parser from step 2
- optional `buildResumeCommand(session, options)`: a default command and, when supported, an unsafe variant selected through `options?.unsafe`

Import the adapter and add it to `SOURCE_ADAPTERS` in `src/sources/registry.ts`. UI labels and resume actions already read this registry through `getSourceLabel(...)` and `getAdapter(...)`.

Add the source to `sidebarSourceOrder` in `src/ui/sidebar.ts` at its intended filter-menu position. The list keeps a deliberate UI order separate from detection priority; its labels still come from the adapter registry.

> **Detection order is behavior.** `detectSessionSource(...)` checks `SOURCE_ADAPTERS` from first to last and accepts the first match. The fixed current priority is `codex → copilot → claude → opencode → antigravity → gemini`. Insert a new adapter deliberately and add an overlap test; do not alphabetize or casually append it. An explicit non-`unknown` `bundle.source` bypasses heuristic detection, and the generic Gemini, OpenCode, and Claude fallback chain remains in `src/parsers/detect.ts` after all adapters.

## 4. Add backend local scanning when needed

Skip this step for an import-only source. To support local scan, implement the `ServerSourceAdapter` contract in `server/sources/types.ts`:

- If the source needs a new product-default root, add a field to `LocalScanRoots` and fill it in `resolveLocalScanRoots(...)` in `server/platformRoots.ts`, preserving the existing platform and environment-override conventions. Every root field is a `ScanRootEntry[]` (`{ path, label? }`), never a bare string — a source can hold several histories at once. Add the new field name to `SCAN_ROOT_FIELDS`.
- To let users configure the root in the UI, add an entry to `CONFIGURABLE_SOURCES` in `server/scanConfig.ts` with its root field, a one-line hint, and whether it points at a directory or a single file. Everything else — persistence, the picker, enable/disable, badge labels — is then automatic.
- For an ordinary filesystem source, add an adapter to `server/sources/fileSources.ts`. Define `scanRoots(...)` and `matchPath(...)`, then register it in `FILE_SOURCE_ADAPTERS`. `scanRoots(...)` returns `ScanRoot[]` (`{ path, archiveLabel? }`); use the `toScanRoots(...)` helper to map root entries onto it so archive labels survive.
- For a source with custom discovery or bundle loading, first register its file adapter as above. Then create `server/sources/<source>.ts`, reuse or extend the file adapter, implement `scan(...)` and/or `loadBundle(...)`, and add it to `specialAdapters` in `server/sources/registry.ts`. The special adapter replaces the same-id file adapter without changing its registry position. A custom `scan(...)` receives every root for its source, so iterate the list and thread each root's label into the descriptors it produces.

`server/scanner.ts` resolves the effective roots (defaults + discovered archives + user config), runs plain file roots through `scanDefaultFileTree({ root, source, archiveLabel })`, invokes special `scan(...)` methods, and asks adapters with `loadBundle(...)` to claim a key before using the default raw-text bundle loader.

Set `archiveLabel` on descriptors that come from a non-default root. It is what the sidebar badges so sessions restored from another machine stay distinguishable, and it is what the `archive:` search filter matches.

Backend path matching is also first-match ordered. `SERVER_SOURCE_ADAPTERS` currently follows `antigravity → codex → claude → opencode → copilot → gemini`, derived from `FILE_SOURCE_ADAPTERS`. Preserve that priority unless a tested behavior change is intentional.

SSH discovery remains separate. `collectRemotePaths(...)` in `server/ssh.ts` uses its own fixed, sanitized remote discovery scripts and does not read `SERVER_SOURCE_ADAPTERS`. Registering a backend source therefore does not add it to SSH scan or sync. If SSH support is required, treat it as a separate change: update the safe remote discovery and sync rules, test them, and continue writing only to `data/remote/<user>@<host>/...` so the normal local scanner can consume the mirror.

## 5. Add coverage and verify

Cover each new boundary:

- Parser: add a representative successful bundle test and a malformed or partial bundle test that returns a readable fallback session.
- Detection: extend `tests/source-registry.test.ts` with the registry position, a positive detection case, an overlapping-heuristic priority case, explicit-source bypass, and the existing generic fallback expectations.
- Scanning: test any new root resolution in `tests/platform-roots.test.ts`, then test `scanRoots(...)`, `matchPath(...)` on POSIX and Windows-style paths, unknown-path behavior, and actual descriptor/bundle routing. Add a focused test alongside `tests/scanner-mtime-slice.test.ts` or the existing source-specific server tests when custom `scan(...)` or `loadBundle(...)` behavior is involved.
- Configurable roots: if you added a `CONFIGURABLE_SOURCES` entry, extend `tests/scan-roots-config.test.ts` so a user-added root reaches the scanner and its `archiveLabel` lands on the resulting descriptors.
- Resume command and label: when present, test the registered label, default command, unsafe command, and `null` behavior for the wrong source or missing metadata.

Run the phase boundary checks:

```bash
npm run typecheck
npm test
npm run build
```
