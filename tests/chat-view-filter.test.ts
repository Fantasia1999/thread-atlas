import test from "node:test";
import assert from "node:assert/strict";

import { filterMessagesForView, isToolOnlyMessage } from "../src/ui/messageFilter.ts";
import type { Message } from "../shared/types.ts";

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

test("filterMessagesForView returns same messages for pure as not-tool", () => {
  const messages: Message[] = [
    {
      id: "user-1",
      role: "user",
      text: "hello"
    },
    {
      id: "assistant-1",
      role: "assistant",
      text: "commentary"
    },
    {
      id: "tool-1",
      role: "tool",
      text: "",
      toolCalls: [{ id: "t1", toolName: "x", kind: "y", status: "completed" }]
    },
    {
      id: "assistant-2",
      role: "assistant",
      text: "final reply"
    }
  ];

  const filteredNotTool = filterMessagesForView(messages, "not-tool");
  const filteredPure = filterMessagesForView(messages, "pure");

  assert.deepEqual(
    filteredPure.map((m) => m.id),
    ["user-1", "assistant-1", "assistant-2"]
  );
  assert.deepEqual(filteredPure, filteredNotTool);
});
