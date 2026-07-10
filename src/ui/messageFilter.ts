import type { Message } from "../../shared/types.js";

export type MessageViewFilter = "raw" | "not-tool" | "pure" | "user" | "answer";

export const FILTER_OPTIONS: Array<{ key: MessageViewFilter; label: string }> = [
  { key: "pure", label: "Pure" },
  { key: "raw", label: "Raw" },
  { key: "not-tool", label: "No tools" },
  { key: "user", label: "User" },
  { key: "answer", label: "Answer" }
];

export function getFinalAssistantMessageIds(messages: Message[]): Set<string> {
  const ids = new Set<string>();
  let lastAssistantMsg: Message | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      if (lastAssistantMsg) {
        ids.add(lastAssistantMsg.id);
        lastAssistantMsg = null;
      }
    } else if (message.role === "assistant") {
      lastAssistantMsg = message;
    }
  }

  if (lastAssistantMsg) {
    ids.add(lastAssistantMsg.id);
  }

  return ids;
}
export type RenderBlock =
  | { type: "message"; message: Message; index: number }
  | { type: "commentary-group"; messages: Array<{ message: Message; index: number }> };

export function partitionMessages(
  messages: Message[],
  isPureMode: boolean,
  finalAssistantIds: Set<string>
): RenderBlock[] {
  const blocks: RenderBlock[] = [];
  let currentGroup: Array<{ message: Message; index: number }> = [];

  messages.forEach((message, index) => {
    const isCommentary =
      isPureMode && message.role === "assistant" && !finalAssistantIds.has(message.id);

    if (isCommentary) {
      currentGroup.push({ message, index });
    } else {
      if (currentGroup.length > 0) {
        blocks.push({ type: "commentary-group", messages: currentGroup });
        currentGroup = [];
      }
      blocks.push({ type: "message", message, index });
    }
  });

  if (currentGroup.length > 0) {
    blocks.push({ type: "commentary-group", messages: currentGroup });
  }

  return blocks;
}

export function filterMessagesForView(messages: Message[], filter: MessageViewFilter): Message[] {
  switch (filter) {
    case "not-tool":
    case "pure":
      return messages.filter(
        (message) =>
          !isToolOnlyMessage(message) &&
          message.role !== "system" &&
          message.role !== "developer"
      );
    case "user":
      return messages.filter((message) => message.role === "user");
    case "answer":
      return messages.filter((message) => message.role === "assistant");
    case "raw":
    default:
      return messages;
  }
}

export function isToolOnlyMessage(message: Message): boolean {
  return message.role === "tool" || (!message.text.trim() && (message.toolCalls?.length ?? 0) > 0);
}
