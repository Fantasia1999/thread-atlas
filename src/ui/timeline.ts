import type { Message } from "../parsers/types.js";
import { escapeHtml, formatDateTimeLong, formatDisplayTime } from "./utils.js";

export function renderTimelineButton(
  message: Message,
  index: number,
  anchorId: string
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "timeline-item";
  button.type = "button";
  button.dataset.target = anchorId;

  const timelineTime = formatDisplayTime(message.createdAt, "unknown time");
  const timelineTimeTitle = formatDateTimeLong(message.createdAt);
  const isSubagent = !!message.subagentNotification;
  const roleLabel = isSubagent ? "subagent" : timelineLabel(message.role);
  const roleEmoji = isSubagent ? "🧵" : timelineEmoji(message.role);

  button.innerHTML = `
    <span class="timeline-index">${String(index + 1).padStart(2, "0")}</span>
    <span class="timeline-role-emoji" title="${escapeHtml(roleLabel)}">${roleEmoji}</span>
    <strong class="timeline-preview">${escapeHtml(buildTimelinePreview(message))}</strong>
    <span class="timeline-time" title="${escapeHtml(timelineTimeTitle)}">${escapeHtml(timelineTime)}</span>
  `;

  return button;
}

export function previewText(text: string, length = 120): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= length) {
    return normalized;
  }
  return `${normalized.slice(0, length - 1)}...`;
}

export function buildAnchorId(message: Message, index: number): string {
  const normalized = `${message.id || index}`.replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `message-${normalized}`;
}

export function buildTimelinePreview(message: Message): string {
  if (message.subagentNotification) {
    const notify = message.subagentNotification;
    const shortId = notify.agentPath.slice(0, 8);
    const statusText = notify.status;
    const contentText = notify.content ? `: ${notify.content}` : "";
    const full = `Subagent [${shortId}] ${statusText}${contentText}`;
    return previewText(full, 86);
  }

  let source = message.text.trim();
  if (source.includes("<USER_REQUEST>")) {
    const match = source.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
    if (match) {
      source = match[1].trim();
    } else {
      source = source.replace(/<\/?USER_REQUEST>/gi, "").trim();
    }
  }
  if (!source) {
    source = message.toolCalls?.[0]?.toolName ?? "tool activity";
  }
  const firstLine = source.split("\n").find((line) => line.trim()) ?? source;
  return firstLine.trim().slice(0, 86) || "Empty message";
}

export function timelineLabel(role: Message["role"]): string {
  if (role === "assistant") {
    return "answer";
  }

  return role;
}

export function timelineEmoji(role: Message["role"]): string {
  switch (role) {
    case "user":
      return "🙂";
    case "assistant":
      return "🤖";
    case "developer":
      return "🛠️";
    case "system":
      return "⚙️";
    case "tool":
      return "🔧";
    default:
      return "•";
  }
}
