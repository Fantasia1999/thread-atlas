import test from "node:test";
import assert from "node:assert/strict";

import { describeSshError } from "../server/ssh.ts";

function withCode(code: string): NodeJS.ErrnoException {
  const error = new Error(`connect ${code} 203.0.113.10:22`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

test("describeSshError explains an unreachable host", () => {
  const result = describeSshError(withCode("EHOSTUNREACH"), "203.0.113.10", 22);
  assert.match(result.message, /unreachable/i);
  assert.match(result.message, /203\.0\.113\.10:22/);
});

test("describeSshError explains a refused connection", () => {
  const result = describeSshError(withCode("ECONNREFUSED"), "10.0.0.5", 2222);
  assert.match(result.message, /refused/i);
  assert.match(result.message, /10\.0\.0\.5:2222/);
});

test("describeSshError explains a timeout", () => {
  const result = describeSshError(withCode("ETIMEDOUT"), "host", 22);
  assert.match(result.message, /timed out/i);
});

test("describeSshError explains DNS resolution failures", () => {
  const result = describeSshError(withCode("ENOTFOUND"), "no-such-host", 22);
  assert.match(result.message, /resolve host/i);
  assert.match(result.message, /no-such-host/);
});

test("describeSshError explains authentication failures", () => {
  const error = new Error("All configured authentication methods failed");
  (error as { level?: string }).level = "client-authentication";
  const result = describeSshError(error, "host", 22);
  assert.match(result.message, /authentication failed/i);
});

test("describeSshError falls back to the raw message for unknown errors", () => {
  const result = describeSshError(new Error("weird failure"), "host", 22);
  assert.match(result.message, /weird failure/);
  assert.match(result.message, /host:22/);
});
