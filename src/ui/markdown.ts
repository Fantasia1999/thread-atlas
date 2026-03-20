import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";

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

    if (line.startsWith("```")) {
      const fence = line;
      const language = fence.slice(3).trim();
      const normalizedLanguage = normalizeCodeLanguage(language);
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
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

      if (language) {
        const caption = document.createElement("figcaption");
        caption.className = "md-code-frame-header";
        caption.textContent = language;
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

    if (/^[-*+]\s+/.test(line)) {
      const list = document.createElement("ul");
      list.className = "md-list";
      while (index < lines.length && /^[-*+]\s+/.test(lines[index])) {
        const item = document.createElement("li");
        item.append(renderInline(lines[index].replace(/^[-*+]\s+/, "")));
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const list = document.createElement("ol");
      list.className = "md-list md-list-ordered";
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        const item = document.createElement("li");
        item.append(renderInline(lines[index].replace(/^\d+\.\s+/, "")));
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].startsWith("```") &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^>\s?/.test(lines[index]) &&
      !/^[-*+]\s+/.test(lines[index]) &&
      !/^\d+\.\s+/.test(lines[index]) &&
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
    /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_)/g;
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
