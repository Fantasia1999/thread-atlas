import test from "node:test";
import assert from "node:assert/strict";

import { parseClaudeSession } from "../src/parsers/claude.ts";
import { parseGeminiSession } from "../src/parsers/gemini.ts";
import { parseAntigravitySession } from "../src/parsers/antigravity.ts";
import { parseCodexSession } from "../src/parsers/codex.ts";
import { extractClaudeCwd, extractClaudePreviewTitle } from "../shared/extractors/claude.ts";
import type { SessionBundle } from "../shared/types.ts";

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

test("parseAntigravitySession extracts actual user request from <USER_REQUEST> tags", () => {
  const bundle: SessionBundle = {
    key: "file::antigravity-session.jsonl",
    source: "antigravity",
    title: "antigravity-session.jsonl",
    primaryPath: "/tmp/antigravity-session.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 1,
    mtimeMs: 1,
    metadata: {},
    files: [
      {
        path: "/tmp/antigravity-session.jsonl",
        content: [
          JSON.stringify({
            record_type: "message",
            role: "user",
            created_at: "2026-05-28T16:59:38Z",
            content: "<USER_REQUEST>\nHello world! Help me code.\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nsome metadata\n</ADDITIONAL_METADATA>"
          })
        ].join("\n")
      }
    ]
  };

  const session = parseAntigravitySession(bundle);
  const [message] = session.messages;

  assert.equal(message?.text, "Hello world! Help me code.");
});

test("extractClaudePreviewTitle and parseClaudeSession titles fallback to first user request", () => {
  const fileContent = [
    JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "Please help me implement a custom parser." }]
      }
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Sure! Let's get started." }]
      }
    })
  ].join("\n");

  // Verify extractClaudePreviewTitle extracts first user request
  const extractedTitle = extractClaudePreviewTitle(fileContent);
  assert.equal(extractedTitle, "Please help me implement a custom parser.");

  // Verify parseClaudeSession prefers first user request when cwd is absent
  const bundle: SessionBundle = {
    key: "file::/tmp/claude-session.jsonl",
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
        content: fileContent
      }
    ]
  };

  const session = parseClaudeSession(bundle);
  assert.equal(session.title, "Please help me implement a custom parser.");
});

test("extractClaudeCwd correctly extracts cwd from Claude session content", () => {
  const fileContent = [
    JSON.stringify({
      cwd: "/home/wcl/workspace/my-awesome-project",
      type: "message",
      message: {
        role: "system",
        content: [{ type: "text", text: "hello" }]
      }
    })
  ].join("\n");

  const cwd = extractClaudeCwd(fileContent);
  assert.equal(cwd, "/home/wcl/workspace/my-awesome-project");

  const bundle: SessionBundle = {
    key: "file::/tmp/claude-session.jsonl",
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
        content: fileContent
      }
    ]
  };

  const session = parseClaudeSession(bundle);
  assert.equal(session.cwd, "/home/wcl/workspace/my-awesome-project");
  assert.equal(session.title, "my-awesome-project · Claude");
});

test("parseCodexSession extracts input_image block as markdown image tag", () => {
  const content = JSON.stringify({
    timestamp: "2026-07-05T03:53:02.838Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: "这里是用户请求"
        },
        {
          type: "input_image",
          image_url: "data:image/png;base64,iVBORw0KGgoAAAANS",
          detail: "high"
        }
      ]
    }
  });

  const bundle: SessionBundle = {
    key: "file::/tmp/rollout.jsonl",
    source: "codex",
    title: "rollout.jsonl",
    primaryPath: "/tmp/rollout.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 1,
    mtimeMs: 1,
    metadata: {},
    files: [
      {
        path: "/tmp/rollout.jsonl",
        content
      }
    ]
  };

  const session = parseCodexSession(bundle);
  const [msg] = session.messages;
  assert.ok(msg);
  assert.equal(msg.role, "user");
  assert.match(msg.text, /!\[Image\]\(data:image\/png;base64,iVBORw0KGgoAAAANS\)/);
});

