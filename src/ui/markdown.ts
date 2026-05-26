import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import { escapeHtml } from "./utils.js";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);

const AUTO_DETECT_LANGUAGES = [
  "javascript",
  "typescript",
  "json",
  "bash",
  "diff",
  "xml",
  "css",
  "markdown"
] as const;

const LANGUAGE_ALIASES = new Map<string, string>([
  ["js", "javascript"],
  ["jsx", "javascript"],
  ["javascript", "javascript"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["ts", "typescript"],
  ["tsx", "typescript"],
  ["typescript", "typescript"],
  ["json", "json"],
  ["jsonc", "json"],
  ["sh", "bash"],
  ["shell", "bash"],
  ["bash", "bash"],
  ["zsh", "bash"],
  ["fish", "bash"],
  ["diff", "diff"],
  ["patch", "diff"],
  ["html", "xml"],
  ["xml", "xml"],
  ["svg", "xml"],
  ["vue", "xml"],
  ["svelte", "xml"],
  ["css", "css"],
  ["scss", "css"],
  ["less", "css"],
  ["md", "markdown"],
  ["markdown", "markdown"]
]);

interface CodeFence {
  indent: number;
  marker: string;
  markerChar: "`" | "~";
  language: string;
}

interface ListMarker {
  ordered: boolean;
  indent: number;
  contentStart: number;
  content: string;
}

export function renderMarkdown(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const openingFence = parseCodeFence(line);
    if (openingFence) {
      const normalizedLanguage = normalizeCodeLanguage(openingFence.language);
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !isClosingCodeFence(lines[index], openingFence)) {
        codeLines.push(removeFenceIndent(lines[index], openingFence.indent));
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      const figure = document.createElement("figure");
      figure.className = "md-code-frame";

      if (normalizedLanguage) {
        figure.dataset.language = normalizedLanguage;
      }

      if (openingFence.language) {
        const caption = document.createElement("figcaption");
        caption.className = "md-code-frame-header";
        caption.textContent = openingFence.language;
        figure.append(caption);
      }

      const pre = document.createElement("pre");
      pre.className = "code-block";

      const code = document.createElement("code");
      code.className = normalizedLanguage
        ? `md-code hljs language-${normalizedLanguage}`
        : "md-code hljs";
      code.innerHTML = highlightCode(codeLines.join("\n").trimEnd(), normalizedLanguage);

      pre.append(code);
      figure.append(pre);
      fragment.append(figure);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = Math.min(6, headingMatch[1].length);
      const element = document.createElement(`h${level}`);
      element.className = `md-heading md-heading-${level}`;
      element.append(renderInline(headingMatch[2].trim()));
      fragment.append(element);
      index += 1;
      continue;
    }

    if (isHorizontalRule(line)) {
      const rule = document.createElement("hr");
      rule.className = "md-rule";
      fragment.append(rule);
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const [table, nextIndex] = renderTable(lines, index);
      fragment.append(table);
      index = nextIndex;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }

      const blockquote = document.createElement("blockquote");
      blockquote.className = "md-blockquote";
      blockquote.append(renderMarkdown(quoteLines.join("\n")));
      fragment.append(blockquote);
      continue;
    }

    const listMarker = parseListMarker(line);
    if (listMarker) {
      const [list, nextIndex] = renderList(lines, index, listMarker);
      fragment.append(list);
      index = nextIndex;
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !parseCodeFence(lines[index]) &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !isHorizontalRule(lines[index]) &&
      !/^>\s?/.test(lines[index]) &&
      !parseListMarker(lines[index]) &&
      !isTableStart(lines, index)
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    const paragraph = document.createElement("div");
    paragraph.className = "message-text md-paragraph";
    paragraph.append(renderInline(paragraphLines.join("\n").trim()));
    fragment.append(paragraph);
  }

  if (!fragment.childNodes.length) {
    const fallback = document.createElement("div");
    fallback.className = "message-text md-paragraph";
    fallback.textContent = text.trim();
    fragment.append(fallback);
  }

  return fragment;
}

function parseListMarker(line: string): ListMarker | null {
  const match = /^( {0,3})([-*+]|\d+\.)\s+(.*)$/.exec(line);
  if (!match) {
    return null;
  }

  return {
    ordered: /^\d+\.$/.test(match[2]),
    indent: match[1].length,
    contentStart: match[1].length + match[2].length + 1,
    content: match[3]
  };
}

function renderList(
  lines: string[],
  startIndex: number,
  firstMarker: ListMarker
): [HTMLOListElement | HTMLUListElement, number] {
  const list = document.createElement(firstMarker.ordered ? "ol" : "ul");
  list.className = firstMarker.ordered ? "md-list md-list-ordered" : "md-list";
  let index = startIndex;

  while (index < lines.length) {
    const marker = parseListMarker(lines[index]);
    if (
      !marker ||
      marker.ordered !== firstMarker.ordered ||
      marker.indent !== firstMarker.indent
    ) {
      break;
    }

    const itemLines = [marker.content];
    index += 1;

    while (index < lines.length) {
      const nextLine = lines[index];
      const nextMarker = parseListMarker(nextLine);

      if (
        nextMarker &&
        nextMarker.ordered === firstMarker.ordered &&
        nextMarker.indent === firstMarker.indent
      ) {
        break;
      }

      if (!nextLine.trim()) {
        const followingMarker = parseListMarker(lines[index + 1] ?? "");
        if (
          followingMarker &&
          followingMarker.ordered === firstMarker.ordered &&
          followingMarker.indent === firstMarker.indent
        ) {
          index += 1;
          break;
        }
        if (isIndentedListContinuation(lines[index + 1], marker.contentStart)) {
          itemLines.push("");
          index += 1;
          continue;
        }
        break;
      }

      if (isIndentedListContinuation(nextLine, marker.contentStart)) {
        itemLines.push(removeListContinuationIndent(nextLine, marker.contentStart));
        index += 1;
        continue;
      }

      break;
    }

    const item = document.createElement("li");
    item.append(renderMarkdown(itemLines.join("\n").trimEnd()));
    list.append(item);
  }

  return [list, index];
}

function isIndentedListContinuation(line: string | undefined, contentStart: number): boolean {
  if (!line?.trim()) {
    return false;
  }
  return countLeadingSpaces(line) >= contentStart;
}

function isHorizontalRule(line: string): boolean {
  return /^( {0,3})([-*_])(?:\s*\2){2,}\s*$/.test(line);
}

function removeListContinuationIndent(line: string, contentStart: number): string {
  const removable = Math.min(countLeadingSpaces(line), contentStart);
  return line.slice(removable);
}

function countLeadingSpaces(line: string): number {
  let count = 0;
  while (count < line.length && line[count] === " ") {
    count += 1;
  }
  return count;
}

function parseCodeFence(line: string): CodeFence | null {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) {
    return null;
  }

  const marker = match[2];
  const markerChar = marker[0] as "`" | "~";
  const language = match[3].trim();

  if (markerChar === "`" && language.includes("`")) {
    return null;
  }

  return {
    indent: match[1].length,
    marker,
    markerChar,
    language
  };
}

function isClosingCodeFence(line: string, openingFence: CodeFence): boolean {
  const match = /^( {0,3})(`{3,}|~{3,})\s*$/.exec(line);
  if (!match) {
    return false;
  }

  const marker = match[2];
  return (
    marker[0] === openingFence.markerChar &&
    marker.length >= openingFence.marker.length
  );
}

function removeFenceIndent(line: string, indent: number): string {
  if (!indent) {
    return line;
  }

  let removable = 0;
  while (removable < indent && line[removable] === " ") {
    removable += 1;
  }

  return line.slice(removable);
}

function highlightCode(text: string, language?: string): string {
  if (!text) {
    return "";
  }

  try {
    if (language) {
      return hljs.highlight(text, {
        language,
        ignoreIllegals: true
      }).value;
    }

    return hljs.highlightAuto(text, [...AUTO_DETECT_LANGUAGES]).value;
  } catch {
    return escapeHtml(text);
  }
}

function normalizeCodeLanguage(value: string): string | undefined {
  if (!value.trim()) {
    return undefined;
  }
  return LANGUAGE_ALIASES.get(value.trim().toLowerCase());
}

function renderInline(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const tokenPattern =
    /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|(?<![\\/.\w])__([^_]+)__(?![\w\\/]|[.][A-Za-z0-9])|\*([^*]+)\*|(?<![\\/.\w])_([^_\s](?:[^_]*[^_\s])?)_(?![\w\\/]|[.][A-Za-z0-9]))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(text))) {
    if (match.index > cursor) {
      fragment.append(document.createTextNode(text.slice(cursor, match.index)));
    }

    if (match[2] && match[3]) {
      const link = document.createElement("a");
      link.className = "md-link";
      link.href = match[3];
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = match[2];
      fragment.append(link);
    } else if (match[4]) {
      const code = document.createElement("code");
      code.className = "inline-code";
      code.textContent = match[4];
      fragment.append(code);
    } else if (match[5] || match[6]) {
      const strong = document.createElement("strong");
      strong.textContent = match[5] ?? match[6] ?? "";
      fragment.append(strong);
    } else if (match[7] || match[8]) {
      const emphasis = document.createElement("em");
      emphasis.textContent = match[7] ?? match[8] ?? "";
      fragment.append(emphasis);
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    fragment.append(document.createTextNode(text.slice(cursor)));
  }

  return fragment;
}

function isTableStart(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) {
    return false;
  }

  return (
    lines[index].includes("|") &&
    /^\s*\|?[:\- ]+\|[:\-| ]+\s*$/.test(lines[index + 1])
  );
}

function renderTable(lines: string[], startIndex: number): [HTMLTableElement, number] {
  const table = document.createElement("table");
  table.className = "md-table";

  const headerCells = splitTableRow(lines[startIndex]);
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const cellText of headerCells) {
    const cell = document.createElement("th");
    cell.append(renderInline(cellText));
    headRow.append(cell);
  }
  head.append(headRow);
  table.append(head);

  const body = document.createElement("tbody");
  let index = startIndex + 2;
  while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
    const row = document.createElement("tr");
    for (const cellText of splitTableRow(lines[index])) {
      const cell = document.createElement("td");
      cell.append(renderInline(cellText));
      row.append(cell);
    }
    body.append(row);
    index += 1;
  }

  table.append(body);
  return [table, index];
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}
