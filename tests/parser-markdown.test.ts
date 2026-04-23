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
