import test from "node:test";
import assert from "node:assert/strict";

import { parseClaudeSession } from "../src/parsers/claude.ts";
import { parseGeminiSession } from "../src/parsers/gemini.ts";
import type { SessionBundle } from "../src/parsers/types.ts";

test("parseClaudeSession preserves tool_result content as a fenced code block", () => {
  const bundle: SessionBundle = {
    key: "file::claude-session.jsonl",
    source: "claude",
    title: "claude-session.jsonl",
    primaryPath: "/tmp/claude-session.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 1,
    mtimeMs: 1,
    metadata: {},
    files: [
      {
        path: "/tmp/claude-session.jsonl",
        content: JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "text",
                text: "先看一下扫描结果。"
              },
              {
                type: "tool_result",
                tool_use_id: "tool-1",
                content: "./deps/lance/test_debug.py\n./deps/lance/vbench/__init__.py"
              }
            ]
          }
        })
      }
    ]
  };

  const session = parseClaudeSession(bundle);
  const [message] = session.messages;

  assert.equal(
    message?.text,
    [
      "先看一下扫描结果。",
      "",
      "```",
      "./deps/lance/test_debug.py",
      "./deps/lance/vbench/__init__.py",
      "```"
    ].join("\n")
  );
  assert.equal(
    message?.toolCalls?.[0]?.output,
    "./deps/lance/test_debug.py\n./deps/lance/vbench/__init__.py"
  );
});

test("parseClaudeSession stitches tool_use and tool_result across adjacent rows", () => {
  const bundle: SessionBundle = {
    key: "file::claude-tool-pair.jsonl",
    source: "claude",
    title: "claude-tool-pair.jsonl",
    primaryPath: "/tmp/claude-tool-pair.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 1,
    mtimeMs: 1,
    metadata: {},
    files: [
      {
        path: "/tmp/claude-tool-pair.jsonl",
        content: [
          JSON.stringify({
            type: "assistant",
            timestamp: "2026-04-21T06:29:49.678Z",
            message: {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: "先看一下项目结构。"
                },
                {
                  type: "tool_use",
                  id: "tool-1",
                  name: "Bash",
                  input: {
                    command: "find . -name \"*.py\" | head -5"
                  }
                }
              ]
            }
          }),
          JSON.stringify({
            type: "user",
            timestamp: "2026-04-21T06:29:49.799Z",
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "tool-1",
                  content: "./deps/lance/test_debug.py\n./deps/lance/vbench/__init__.py"
                }
              ]
            }
          })
        ].join("\n")
      }
    ]
  };

  const session = parseClaudeSession(bundle);
  const [message] = session.messages;

  assert.equal(session.messages.length, 1);
  assert.equal(message?.role, "assistant");
  assert.equal(message?.text, "先看一下项目结构。");
  assert.equal(message?.toolCalls?.length, 1);
  assert.equal(message?.toolCalls?.[0]?.toolName, "Bash");
  assert.equal(message?.toolCalls?.[0]?.args, "find . -name \"*.py\" | head -5");
  assert.equal(
    message?.toolCalls?.[0]?.output,
    "./deps/lance/test_debug.py\n./deps/lance/vbench/__init__.py"
  );
});

test("parseClaudeSession stitches queue-operation updates onto background tool calls", () => {
  const bundle: SessionBundle = {
    key: "file::claude-queue-operation.jsonl",
    source: "claude",
    title: "claude-queue-operation.jsonl",
    primaryPath: "/tmp/claude-queue-operation.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 1,
    mtimeMs: 1,
    metadata: {},
    files: [
      {
        path: "/tmp/claude-queue-operation.jsonl",
        content: [
          JSON.stringify({
            type: "assistant",
            timestamp: "2026-04-21T06:20:58.183Z",
            message: {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: "编译成功！验证分布式模式并运行项目。"
                },
                {
                  type: "tool_use",
                  id: "tool-e3b84198417b4dd48c4b447f0c4e6949",
                  name: "Bash",
                  input: {
                    command: "cargo check -p gaussinfra-framework --features distributed 2>&1 | tail -10",
                    description: "验证分布式模式编译"
                  }
                }
              ]
            }
          }),
          JSON.stringify({
            type: "user",
            timestamp: "2026-04-21T06:22:58.385Z",
            message: {
              role: "user",
              content: [
                {
                  tool_use_id: "tool-e3b84198417b4dd48c4b447f0c4e6949",
                  type: "tool_result",
                  content:
                    "Command running in background with ID: b1hl27n04. Output is being written to: /tmp/claude-1000/tasks/b1hl27n04.output"
                }
              ]
            },
            toolUseResult: {
              backgroundTaskId: "b1hl27n04",
              assistantAutoBackgrounded: false
            }
          }),
          JSON.stringify({
            type: "queue-operation",
            operation: "enqueue",
            timestamp: "2026-04-21T06:23:01.075Z",
            sessionId: "350dc8cf-0431-4cb1-90d6-117bd1aaeec5",
            content: [
              "<task-notification>",
              "<task-id>b1hl27n04</task-id>",
              "<tool-use-id>tool-e3b84198417b4dd48c4b447f0c4e6949</tool-use-id>",
              "<output-file>/tmp/claude-1000/tasks/b1hl27n04.output</output-file>",
              "<status>completed</status>",
              "<summary>Background command \"验证分布式模式编译\" completed (exit code 0)</summary>",
              "</task-notification>"
            ].join("\n")
          }),
          JSON.stringify({
            type: "queue-operation",
            operation: "remove",
            timestamp: "2026-04-21T06:23:01.824Z",
            sessionId: "350dc8cf-0431-4cb1-90d6-117bd1aaeec5"
          })
        ].join("\n")
      }
    ]
  };

  const session = parseClaudeSession(bundle);
  const [message] = session.messages;
  const [toolCall] = message?.toolCalls ?? [];

  assert.equal(session.messages.length, 1);
  assert.equal(message?.role, "assistant");
  assert.equal(message?.text, "编译成功！验证分布式模式并运行项目。");
  assert.equal(toolCall?.toolName, "Bash");
  assert.equal(toolCall?.status, "completed");
  assert.equal(
    toolCall?.output,
    "Command running in background with ID: b1hl27n04. Output is being written to: /tmp/claude-1000/tasks/b1hl27n04.output"
  );
  assert.deepEqual(toolCall?.backgroundTask, {
    taskId: "b1hl27n04",
    toolUseId: "tool-e3b84198417b4dd48c4b447f0c4e6949",
    status: "completed",
    summary: "Background command \"验证分布式模式编译\" completed (exit code 0)",
    outputFile: "/tmp/claude-1000/tasks/b1hl27n04.output"
  });
});

test("parseGeminiSession preserves functionResponse content as a fenced code block", () => {
  const bundle: SessionBundle = {
    key: "file::gemini-session.json",
    source: "gemini",
    title: "gemini-session.json",
    primaryPath: "/tmp/gemini-session.json",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 1,
    mtimeMs: 1,
    metadata: {},
    files: [
      {
        path: "/tmp/gemini-session.json",
        content: JSON.stringify([
          {
            role: "model",
            parts: [
              {
                text: "这是工具返回的路径。"
              },
              {
                functionCall: {
                  id: "call-1",
                  name: "read_paths",
                  args: {
                    path: "./deps/lance/test_debug.py"
                  }
                }
              },
              {
                functionResponse: {
                  id: "call-1",
                  name: "read_paths",
                  response: {
                    output: "./deps/lance/test_debug.py\n./deps/lance/vbench/__init__.py"
                  }
                }
              }
            ]
          }
        ])
      }
    ]
  };

  const session = parseGeminiSession(bundle);
  const [message] = session.messages;

  assert.equal(
    message?.text,
    [
      "这是工具返回的路径。",
      "",
      "```",
      "./deps/lance/test_debug.py",
      "./deps/lance/vbench/__init__.py",
      "```"
    ].join("\n")
  );
  assert.equal(message?.toolCalls?.[0]?.toolName, "read_paths");
  assert.equal(
    message?.toolCalls?.[1]?.output,
    "./deps/lance/test_debug.py\n./deps/lance/vbench/__init__.py"
  );
});
