import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import katex from "katex";
import markdown from "highlight.js/lib/languages/markdown";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import { escapeHtml, ansiToHtml } from "./utils.js";


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

      if (openingFence.language.trim().toLowerCase() === "mermaid") {
        const card = document.createElement("div");
        card.className = "mermaid-diagram-card";

        // Header
        const header = document.createElement("div");
        header.className = "mermaid-card-header";

        const title = document.createElement("span");
        title.className = "mermaid-card-title";
        title.innerHTML = `
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
            <polyline points="2 17 12 22 22 17"></polyline>
            <polyline points="2 12 12 17 22 12"></polyline>
          </svg>
          Mermaid Diagram
        `;

        const tabs = document.createElement("div");
        tabs.className = "mermaid-card-tabs";

        const btnPreview = document.createElement("button");
        btnPreview.className = "mermaid-tab-btn active";
        btnPreview.type = "button";
        btnPreview.textContent = "Preview";

        const btnCode = document.createElement("button");
        btnCode.className = "mermaid-tab-btn";
        btnCode.type = "button";
        btnCode.textContent = "Code";

        tabs.append(btnPreview, btnCode);
        header.append(title, tabs);

        // Body
        const body = document.createElement("div");
        body.className = "mermaid-card-body";

        const previewContainer = document.createElement("div");
        previewContainer.className = "mermaid-diagram-container mermaid-preview-content active";
        
        const preMermaid = document.createElement("pre");
        preMermaid.className = "mermaid";
        preMermaid.textContent = codeLines.join("\n").trimEnd();
        previewContainer.append(preMermaid);

        const codeContainer = document.createElement("div");
        codeContainer.className = "mermaid-code-content";
        codeContainer.style.display = "none";

        const preCode = document.createElement("pre");
        preCode.className = "code-block";
        const codeElement = document.createElement("code");
        codeElement.className = "md-code hljs language-mermaid";
        codeElement.innerHTML = escapeHtml(codeLines.join("\n").trimEnd());
        preCode.append(codeElement);
        codeContainer.append(preCode);

        body.append(previewContainer, codeContainer);
        card.append(header, body);

        // Event listeners for tabs switching
        btnPreview.addEventListener("click", () => {
          btnPreview.classList.add("active");
          btnCode.classList.remove("active");
          previewContainer.style.display = "";
          codeContainer.style.display = "none";
        });

        btnCode.addEventListener("click", () => {
          btnCode.classList.add("active");
          btnPreview.classList.remove("active");
          previewContainer.style.display = "none";
          codeContainer.style.display = "";
        });

        fragment.append(card);
        continue;
      }

      const figure = document.createElement("figure");
      figure.className = "md-code-frame";

      if (normalizedLanguage) {
        figure.dataset.language = normalizedLanguage;
      }

      if (openingFence.language) {
        const caption = document.createElement("figcaption");
        caption.className = "md-code-frame-header";
        
        const langSpan = document.createElement("span");
        langSpan.className = "code-frame-lang";
        langSpan.textContent = openingFence.language;
        caption.append(langSpan);

        const toggleSpan = document.createElement("span");
        toggleSpan.className = "code-frame-toggle";
        toggleSpan.innerHTML = `
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z"/>
          </svg>
        `;
        caption.append(toggleSpan);

        caption.addEventListener("click", () => {
          figure.classList.toggle("collapsed");
        });

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

    if (isOpeningMathBlock(line)) {
      const [mathBlock, nextIndex] = renderMathBlock(lines, index);
      fragment.append(mathBlock);
      index = nextIndex;
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
      !isOpeningMathBlock(lines[index]) &&
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
    const paragraphText = paragraphLines.join("\n").trim();
    if (paragraphText.includes("\u001b") || paragraphText.includes("\x1b")) {
      paragraph.innerHTML = ansiToHtml(paragraphText);
    } else {
      paragraph.append(renderInline(paragraphText));
    }
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

    // Only auto-detect if the text is small (under 1000 characters)
    // to prevent blocking the main thread for long logs/outputs
    if (text.length < 1000) {
      return hljs.highlightAuto(text, [...AUTO_DETECT_LANGUAGES]).value;
    }

    return escapeHtml(text);
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

function isOpeningMathBlock(line: string): boolean {
  return /^( {0,3})\$\$/.test(line);
}

function renderMathBlock(lines: string[], startIndex: number): [HTMLElement, number] {
  const openingLine = lines[startIndex].replace(/^( {0,3})\$\$\s?/, "");
  const inlineClose = openingLine.match(/^(.*?)(?:\s?)\$\$\s*$/);

  if (inlineClose) {
    return [renderMath(inlineClose[1], true), startIndex + 1];
  }

  const mathLines: string[] = [];
  if (openingLine) {
    mathLines.push(openingLine);
  }

  let index = startIndex + 1;
  while (index < lines.length) {
    const closeMatch = /^(.*?)(?:\s?)\$\$\s*$/.exec(lines[index]);
    if (closeMatch) {
      if (closeMatch[1]) {
        mathLines.push(closeMatch[1]);
      }
      index += 1;
      break;
    }

    mathLines.push(lines[index]);
    index += 1;
  }

  return [renderMath(mathLines.join("\n").trim(), true), index];
}

function renderMath(text: string, displayMode: boolean): HTMLElement {
  const element = document.createElement(displayMode ? "div" : "span");
  element.className = displayMode ? "md-math-block" : "md-math-inline";

  try {
    element.innerHTML = katex.renderToString(text, {
      displayMode,
      output: "html",
      throwOnError: false,
      trust: false
    });
  } catch {
    element.textContent = displayMode ? `$$\n${text}\n$$` : `$${text}$`;
  }

  return element;
}

function renderInline(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const tokenPattern =
    /(\[([^\]]+)\]\(((?:https?|file):\/\/[^\s)]+|[^\s)]+)\)|`([^`]+)`|(?<![\\\w])\$(?![\s$])([^$\n]*?\S)(?<!\\)\$(?!\w)|\*\*((?:[^*]|`[^`]+`|\*(?!\*))+?)\*\*|(?<![\\/.\w])__([^_]+)__(?![\w\\/]|[.][A-Za-z0-9])|\*((?:[^*]|`[^`]+`)+?)\*|(?<![\\/.\w])_([^_\s](?:[^_]*[^_\s])?)_(?![\w\\/]|[.][A-Za-z0-9]))/g;
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
    } else if (match[5]) {
      fragment.append(renderMath(match[5], false));
    } else if (match[6] || match[7]) {
      const strong = document.createElement("strong");
      strong.append(renderInline(match[6] ?? match[7] ?? ""));
      fragment.append(strong);
    } else if (match[8] || match[9]) {
      const emphasis = document.createElement("em");
      emphasis.append(renderInline(match[8] ?? match[9] ?? ""));
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
