import test from "node:test";
import assert from "node:assert/strict";

import { filterMessagesForView, isToolOnlyMessage } from "../src/ui/chatView.ts";
import type { Message } from "../src/parsers/types.ts";

test("isToolOnlyMessage matches empty assistant tool placeholders", () => {
  const message: Message = {
    id: "assistant-tool-only",
    role: "assistant",
    text: "",
    toolCalls: [
      {
        id: "tool-1",
        toolName: "bash",
        kind: "function",
        status: "completed"
      }
    ]
  };

  assert.equal(isToolOnlyMessage(message), true);
});

test("filterMessagesForView removes Copilot-style tool-only assistant messages for not-tool", () => {
  const messages: Message[] = [
    {
      id: "user-1",
      role: "user",
      text: "帮我看一下"
    },
    {
      id: "assistant-tool-only",
      role: "assistant",
      text: "",
      toolCalls: [
        {
          id: "tool-1",
          toolName: "bash",
          kind: "function",
          status: "completed",
          output: "done"
        }
      ]
    },
    {
      id: "assistant-1",
      role: "assistant",
      text: "这是结果",
      toolCalls: [
        {
          id: "tool-2",
          toolName: "bash",
          kind: "function",
          status: "completed",
          output: "done"
        }
      ]
    },
    {
      id: "tool-standalone",
      role: "tool",
      text: "",
      toolCalls: [
        {
          id: "tool-3",
          toolName: "web",
          kind: "search",
          status: "completed"
        }
      ]
    }
  ];

  const filtered = filterMessagesForView(messages, "not-tool");

  assert.deepEqual(
    filtered.map((message) => message.id),
    ["user-1", "assistant-1"]
  );
});
