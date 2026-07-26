import type { SessionDescriptor } from "../../shared/types.js";

/**
 * Parsed representation of a sidebar search query.
 *
 * Supported syntax (whitespace-separated tokens, all lowercase-insensitive):
 * - plain terms:        every term must match somewhere (AND)
 * - `-term`:            excludes sessions matching the term
 * - `#tag`:             session must carry every listed favorite tag
 * - `is:starred`:       favorites only (alias `is:favorite`)
 * - `source:codex`:     match against the session source
 * - `path:foo`:         match against the primary path
 * - `title:foo`:        match against the session title
 * - `project:foo`:      match against the workspace path (aliases `workspace:`, `cwd:`)
 * - `archive:pc1`:      match against the archived history root label
 * - `before:` / `after:` with a `Date.parse`-able value: filter by file mtime
 *
 * Unknown `field:value` tokens degrade to plain terms so paths like `c:/work`
 * still search literally. Unparseable dates are ignored.
 */
export interface ParsedSearchQuery {
  showOnlyStarred: boolean;
  tags: string[];
  terms: string[];
  negatedTerms: string[];
  sourceTerms: string[];
  pathTerms: string[];
  titleTerms: string[];
  projectTerms: string[];
  archiveTerms: string[];
  beforeMs?: number;
  afterMs?: number;
}

export function parseSearchQuery(search: string): ParsedSearchQuery {
  const query: ParsedSearchQuery = {
    showOnlyStarred: false,
    tags: [],
    terms: [],
    negatedTerms: [],
    sourceTerms: [],
    pathTerms: [],
    titleTerms: [],
    projectTerms: [],
    archiveTerms: []
  };

  const raw = search.trim().toLowerCase();
  if (!raw) {
    return query;
  }

  for (const token of raw.split(/\s+/)) {
    if (token === "is:starred" || token === "is:favorite") {
      query.showOnlyStarred = true;
      continue;
    }

    if (token.startsWith("#") && token.length > 1) {
      query.tags.push(token.slice(1));
      continue;
    }

    const colonIndex = token.indexOf(":");
    if (colonIndex > 0 && colonIndex < token.length - 1) {
      const field = token.slice(0, colonIndex);
      const value = token.slice(colonIndex + 1);

      if (field === "source") {
        query.sourceTerms.push(value);
        continue;
      }
      if (field === "path") {
        query.pathTerms.push(value);
        continue;
      }
      if (field === "title") {
        query.titleTerms.push(value);
        continue;
      }
      if (field === "project" || field === "workspace" || field === "cwd") {
        query.projectTerms.push(value);
        continue;
      }
      if (field === "archive") {
        query.archiveTerms.push(value);
        continue;
      }
      if (field === "before" || field === "after") {
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) {
          if (field === "before") {
            query.beforeMs = parsed;
          } else {
            query.afterMs = parsed;
          }
        }
        continue;
      }
      // Unknown field: fall through and treat the whole token as a plain term.
    }

    if (token.startsWith("-") && token.length > 1) {
      query.negatedTerms.push(token.slice(1));
      continue;
    }

    query.terms.push(token);
  }

  return query;
}

export function descriptorMatchesSearch(
  descriptor: SessionDescriptor,
  query: ParsedSearchQuery,
  context: {
    workspacePath: string;
    isFavorite: boolean;
    meta?: { tags: string[]; notes: string };
  }
): boolean {
  if (query.showOnlyStarred && !context.isFavorite) {
    return false;
  }

  if (query.tags.length > 0) {
    if (!context.meta) {
      return false;
    }
    const sessionTags = context.meta.tags.map((tag) => tag.toLowerCase());
    if (!query.tags.every((tag) => sessionTags.includes(tag))) {
      return false;
    }
  }

  if (query.beforeMs !== undefined && descriptor.mtimeMs >= query.beforeMs) {
    return false;
  }
  if (query.afterMs !== undefined && descriptor.mtimeMs < query.afterMs) {
    return false;
  }

  const title = descriptor.title.toLowerCase();
  const path = descriptor.primaryPath.toLowerCase();
  const source = descriptor.source.toLowerCase();
  const workspace = context.workspacePath.toLowerCase();
  const archive = descriptor.archiveLabel?.toLowerCase() ?? "";

  if (!query.archiveTerms.every((term) => archive.includes(term))) {
    return false;
  }
  if (!query.sourceTerms.every((term) => source.includes(term))) {
    return false;
  }
  if (!query.pathTerms.every((term) => path.includes(term))) {
    return false;
  }
  if (!query.titleTerms.every((term) => title.includes(term))) {
    return false;
  }
  if (!query.projectTerms.every((term) => workspace.includes(term))) {
    return false;
  }

  if (query.terms.length === 0 && query.negatedTerms.length === 0) {
    return true;
  }

  const notes = context.meta?.notes?.toLowerCase() ?? "";
  const tagsText = context.meta?.tags?.join(" ").toLowerCase() ?? "";
  const connection = descriptor.connectionLabel?.toLowerCase() ?? "";
  const haystack = `${title}\n${path}\n${workspace}\n${source}\n${connection}\n${archive}\n${notes}\n${tagsText}`;

  if (!query.terms.every((term) => haystack.includes(term))) {
    return false;
  }
  if (query.negatedTerms.some((term) => haystack.includes(term))) {
    return false;
  }

  return true;
}
