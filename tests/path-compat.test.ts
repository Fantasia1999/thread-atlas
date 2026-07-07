import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  isScannableAntigravitySessionPath,
  loadAntigravityBundle,
  resolvePreferredAntigravitySessionPath
} from "../server/antigravity.ts";
import { parseClaudeSession } from "../src/parsers/claude.ts";
import { parseCopilotSession } from "../src/parsers/copilot.ts";
import { parseCodexSession } from "../src/parsers/codex.ts";
import { detectSessionSource } from "../src/parsers/detect.ts";
import type { SessionBundle } from "../shared/types.ts";
import { inferSourceFromPath } from "../server/scanner.ts";
import { isWithinPathRoot, normalizePathForMatch } from "../shared/pathUtils.ts";

test("normalizePathForMatch converts Windows separators to lowercase POSIX-style paths", () => {
  assert.equal(
    normalizePathForMatch("C:\\Users\\Alice\\.Codex\\Sessions\\Rollout-1.JSONL"),
    "c:/users/alice/.codex/sessions/rollout-1.jsonl"
  );
});

test("inferSourceFromPath recognizes Windows session roots", () => {
  assert.equal(
    inferSourceFromPath("C:\\Users\\alice\\.codex\\sessions\\rollout-1.jsonl"),
    "codex"
  );
  assert.equal(
    inferSourceFromPath("C:\\Users\\alice\\.claude\\projects\\demo\\session.jsonl"),
    "claude"
  );
  assert.equal(
    inferSourceFromPath("C:\\Users\\alice\\.gemini\\tmp\\chat.json"),
    "gemini"
  );
  assert.equal(
    inferSourceFromPath("C:\\Users\\alice\\.local\\share\\opencode\\opencode.db"),
    "opencode"
  );
  assert.equal(
    inferSourceFromPath("C:\\Users\\alice\\.copilot\\session-state\\demo\\events.jsonl"),
    "copilot"
  );
  assert.equal(
    inferSourceFromPath("C:\\Users\\alice\\.gemini\\antigravity\\conversations\\abc.pb"),
    "antigravity"
  );
  assert.equal(
    inferSourceFromPath("C:\\Users\\alice\\.gemini\\antigravity-cli\\conversations\\abc.pb"),
    "antigravity"
  );
  assert.equal(
    inferSourceFromPath("C:\\Users\\alice\\.gemini\\antigravity-cli\\conversations\\abc.db"),
    "antigravity"
  );
  assert.equal(
    inferSourceFromPath(
      "C:\\Users\\alice\\.gemini\\antigravity-cli\\brain\\abc\\.system_generated\\logs\\transcript_full.jsonl"
    ),
    "antigravity"
  );
});

test("Antigravity loader prefers parseable transcript_full.jsonl over pb", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "thread-atlas-antigravity-"));
  const sessionId = "session-123";
  const conversationPath = path.join(
    root,
    ".gemini",
    "antigravity-cli",
    "conversations",
    `${sessionId}.pb`
  );
  const transcriptPath = path.join(
    root,
    ".gemini",
    "antigravity-cli",
    "brain",
    sessionId,
    ".system_generated",
    "logs",
    "transcript_full.jsonl"
  );
  await fs.mkdir(path.dirname(conversationPath), { recursive: true });
  await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
  await fs.writeFile(conversationPath, "not a protobuf");
  await fs.writeFile(
    transcriptPath,
    [
      JSON.stringify({
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-01-01T00:00:00.000Z",
        content: "hello"
      }),
      JSON.stringify({
        step_index: 1,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-01-01T00:00:01.000Z",
        content: "hi"
      })
    ].join("\n")
  );

  assert.equal(await resolvePreferredAntigravitySessionPath(conversationPath), transcriptPath);

  const bundle = await loadAntigravityBundle(conversationPath, "local");
  assert.equal(bundle.primaryPath, transcriptPath);
  assert.equal(bundle.metadata.loaderBackend, "transcript");
  assert.match(bundle.files[0]?.content ?? "", /"record_type":"message"/);
});

test("Antigravity scanner rejects pb files that cannot decode content", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "thread-atlas-antigravity-pb-"));
  const conversationPath = path.join(
    root,
    ".gemini",
    "antigravity-cli",
    "conversations",
    "broken.pb"
  );
  await fs.mkdir(path.dirname(conversationPath), { recursive: true });
  await fs.writeFile(conversationPath, "not a protobuf");

  assert.equal(await resolvePreferredAntigravitySessionPath(conversationPath), conversationPath);
  assert.equal(await isScannableAntigravitySessionPath(conversationPath), false);
});

test("isWithinPathRoot matches Windows-style remote mirror paths", () => {
  assert.equal(
    isWithinPathRoot(
      "C:\\work\\thread-atlas\\data\\remote\\alice@host\\home\\alice\\.codex\\sessions\\rollout-1.jsonl",
      "C:\\work\\thread-atlas\\data\\remote"
    ),
    true
  );
  assert.equal(
    isWithinPathRoot(
      "C:\\work\\thread-atlas\\data\\remote-other\\alice@host\\home\\alice\\.codex\\sessions\\rollout-1.jsonl",
      "C:\\work\\thread-atlas\\data\\remote"
    ),
    false
  );
});

test("detectSessionSource recognizes Windows bundle paths", () => {
  const bundle: SessionBundle = {
    key: "file::C:\\Users\\alice\\.codex\\sessions\\rollout-1.jsonl",
    source: "unknown",
    title: "rollout-1.jsonl",
    primaryPath: "C:\\Users\\alice\\.codex\\sessions\\rollout-1.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 1,
    mtimeMs: 1,
    metadata: {},
    files: [
      {
        path: "C:\\Users\\alice\\.codex\\sessions\\rollout-1.jsonl",
        content: "{\"type\":\"session_meta\",\"payload\":{\"cwd\":\"C:\\\\repo\\\\atlas\"}}"
      }
    ]
  };

  assert.equal(detectSessionSource(bundle), "codex");
});

test("parseCodexSession uses Windows cwd basename in the title", () => {
  const bundle: SessionBundle = {
    key: "file::C:\\Users\\alice\\.codex\\sessions\\rollout-1.jsonl",
    source: "codex",
    title: "rollout-1.jsonl",
    primaryPath: "C:\\Users\\alice\\.codex\\sessions\\rollout-1.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 1,
    mtimeMs: 1,
    metadata: {},
    files: [
      {
        path: "C:\\Users\\alice\\.codex\\sessions\\rollout-1.jsonl",
        content: [
          JSON.stringify({
            type: "session_meta",
            payload: {
              id: "codex-1",
              cwd: "C:\\repo\\thread-atlas"
            }
          }),
          JSON.stringify({
            type: "message",
            role: "user",
            content: "hello"
          })
        ].join("\n")
      }
    ]
  };

  const session = parseCodexSession(bundle);
  assert.equal(session.title, "thread-atlas · Codex");
});

test("parseClaudeSession uses Windows cwd basename in the title", () => {
  const bundle: SessionBundle = {
    key: "file::C:\\Users\\alice\\.claude\\projects\\demo\\session.jsonl",
    source: "claude",
    title: "session.jsonl",
    primaryPath: "C:\\Users\\alice\\.claude\\projects\\demo\\session.jsonl",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 1,
    size: 1,
    mtimeMs: 1,
    metadata: {},
    files: [
      {
        path: "C:\\Users\\alice\\.claude\\projects\\demo\\session.jsonl",
        content: JSON.stringify({
          cwd: "C:\\repo\\thread-atlas",
          type: "message",
          message: {
            role: "system",
            content: [{ type: "text", text: "hello" }]
          }
        })
      }
    ]
  };

  const session = parseClaudeSession(bundle);
  assert.equal(session.title, "thread-atlas · Claude");
});

test("parseCopilotSession uses Windows cwd basename in the title", () => {
  const bundle: SessionBundle = {
    key: "copilot-dir::C:\\Users\\alice\\.copilot\\session-state\\session-1",
    source: "copilot",
    title: "session-1",
    primaryPath: "C:\\Users\\alice\\.copilot\\session-state\\session-1",
    relatedPaths: [],
    transport: "local-scan",
    origin: "local",
    fileCount: 2,
    size: 1,
    mtimeMs: 1,
    metadata: {},
    files: [
      {
        path: "C:\\Users\\alice\\.copilot\\session-state\\session-1\\events.jsonl",
        content: [
          JSON.stringify({
            type: "session.start",
            timestamp: "2026-04-02T08:58:24.122Z",
            data: {
              sessionId: "session-1",
              producer: "copilot-agent",
              startTime: "2026-04-02T08:58:24.116Z",
              context: {
                cwd: "C:\\repo\\thread-atlas"
              }
            }
          }),
          JSON.stringify({
            type: "user.message",
            timestamp: "2026-04-02T08:59:00.000Z",
            data: {
              content: "hello"
            }
          })
        ].join("\n")
      },
      {
        path: "C:\\Users\\alice\\.copilot\\session-state\\session-1\\workspace.yaml",
        content: ["id: session-1", "cwd: C:\\repo\\thread-atlas"].join("\n")
      }
    ]
  };

  const session = parseCopilotSession(bundle);
  assert.equal(session.title, "thread-atlas · Copilot");
});

test("Antigravity loader handles transcript_full.jsonl with malformed/non-JSON lines gracefully", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "thread-atlas-antigravity-malformed-"));
  const sessionId = "session-456";
  const conversationPath = path.join(
    root,
    ".gemini",
    "antigravity-cli",
    "conversations",
    `${sessionId}.pb`
  );
  const transcriptPath = path.join(
    root,
    ".gemini",
    "antigravity-cli",
    "brain",
    sessionId,
    ".system_generated",
    "logs",
    "transcript_full.jsonl"
  );
  await fs.mkdir(path.dirname(conversationPath), { recursive: true });
  await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
  await fs.writeFile(conversationPath, "not a protobuf");
  await fs.writeFile(
    transcriptPath,
    [
      JSON.stringify({
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-01-01T00:00:00.000Z",
        content: "hello"
      }),
      "this is a malformed line that is not json",
      JSON.stringify({
        step_index: 1,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-01-01T00:00:01.000Z",
        content: "hi"
      })
    ].join("\n")
  );

  assert.equal(await isScannableAntigravitySessionPath(transcriptPath), true);

  const bundle = await loadAntigravityBundle(conversationPath, "local");
  assert.equal(bundle.primaryPath, transcriptPath);
  assert.equal(bundle.metadata.loaderBackend, "transcript");
  assert.match(bundle.files[0]?.content ?? "", /"record_type":"message"/);
  assert.ok(bundle.title.startsWith("⚠️ "));
});

test("Antigravity loader parses task messages from sibling messages directory and matches code_action", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "thread-atlas-antigravity-tasks-"));
  const sessionId = "session-789";
  const conversationPath = path.join(
    root,
    ".gemini",
    "antigravity-cli",
    "conversations",
    `${sessionId}.pb`
  );
  const transcriptPath = path.join(
    root,
    ".gemini",
    "antigravity-cli",
    "brain",
    sessionId,
    ".system_generated",
    "logs",
    "transcript_full.jsonl"
  );
  const messagesDir = path.join(
    root,
    ".gemini",
    "antigravity-cli",
    "brain",
    sessionId,
    ".system_generated",
    "messages"
  );

  await fs.mkdir(path.dirname(conversationPath), { recursive: true });
  await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
  await fs.mkdir(messagesDir, { recursive: true });

  // Write transcript starting from step 252 (rolled over)
  await fs.writeFile(
    transcriptPath,
    [
      JSON.stringify({
        step_index: 252,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-01-01T00:10:00.000Z",
        content: "run next step"
      }),
      JSON.stringify({
        step_index: 253,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-01-01T00:10:01.000Z",
        tool_calls: [{ name: "replace_file_content", args: { file: "a.txt" } }]
      }),
      JSON.stringify({
        step_index: 254,
        source: "MODEL",
        type: "CODE_ACTION",
        status: "DONE",
        created_at: "2026-01-01T00:10:02.000Z",
        content: "diff content"
      })
    ].join("\n")
  );

  // Write a task message under messages/ (step 106, before 252)
  const taskMsg = {
    id: "msg-106",
    recipient: sessionId,
    sender: `${sessionId}/task-106`,
    priority: "MESSAGE_PRIORITY_HIGH",
    timestamp: "2026-01-01T00:05:00.000Z",
    content: "Task failed with error ...",
    sourceMetadata: {
      tool: {
        conversationId: sessionId,
        stepIndex: 106,
        toolCall: {
          id: "toolcall-106",
          name: "run_command",
          argumentsJson: "{\"CommandLine\":\"npm test\"}"
        }
      }
    }
  };
  await fs.writeFile(
    path.join(messagesDir, "task-106.json"),
    JSON.stringify(taskMsg)
  );

  const bundle = await loadAntigravityBundle(conversationPath, "local");
  const parsedRecords = bundle.files[0]?.content
    ? bundle.files[0].content.split("\n").map((line) => JSON.parse(line))
    : [];

  // Verify that the task-106 records were successfully reconstructed and integrated
  const toolCalls106 = parsedRecords.filter((r) => r.record_type === "tool_call" && r.step_index === 106);
  const toolResults106 = parsedRecords.filter((r) => r.record_type === "tool_result" && r.step_index === 106);
  assert.equal(toolCalls106.length, 1);
  assert.equal(toolResults106.length, 1);
  assert.equal(toolCalls106[0].tool_name, "run_command");
  assert.equal(toolCalls106[0].tool_call.id, "toolcall-106");
  assert.equal(toolResults106[0].tool_call.id, "toolcall-106");
  assert.equal(toolResults106[0].content, "Task failed with error ...");

  // Verify chronological ordering: step 106 records should come before step 252
  const indexOf106 = parsedRecords.findIndex((r) => r.step_index === 106);
  const indexOf252 = parsedRecords.findIndex((r) => r.step_index === 252);
  assert.ok(indexOf106 < indexOf252);

  // Verify code_action matching: step 254 (CODE_ACTION) should match step 253's replace_file_content tool call ID
  const toolCall253 = parsedRecords.find((r) => r.record_type === "tool_call" && r.step_index === 253);
  const toolResult254 = parsedRecords.find((r) => r.record_type === "tool_result" && r.step_index === 254);
  assert.ok(toolCall253);
  assert.ok(toolResult254);
  assert.equal(toolCall253.tool_name, "replace_file_content");
  assert.equal(toolResult254.tool_name, "replace_file_content"); // mapped from code_action
  assert.equal(toolResult254.tool_call.id, toolCall253.tool_call.id); // matched successfully!
});

