import test from "node:test";
import assert from "node:assert/strict";

import { resolveAgentConfig, DEFAULT_AGENT_HOST, DEFAULT_AGENT_PORT } from "../server/agentConfig.ts";

test("resolveAgentConfig defaults to loopback host, default port, no token", () => {
  const config = resolveAgentConfig([], {});
  assert.equal(config.host, DEFAULT_AGENT_HOST);
  assert.equal(config.port, DEFAULT_AGENT_PORT);
  assert.equal(config.token, undefined);
  assert.equal(config.tokenRequired, false);
});

test("resolveAgentConfig reads CLI flags with = and space forms", () => {
  const config = resolveAgentConfig(["--host", "0.0.0.0", "--port=4040", "--token=secret"], {});
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 4040);
  assert.equal(config.token, "secret");
  assert.equal(config.tokenRequired, true);
});

test("resolveAgentConfig lets CLI override environment", () => {
  const config = resolveAgentConfig(["--port", "5050"], {
    ATLAS_AGENT_HOST: "10.0.0.1",
    ATLAS_AGENT_PORT: "6060",
    ATLAS_AGENT_TOKEN: "env-token"
  });
  assert.equal(config.host, "10.0.0.1");
  assert.equal(config.port, 5050);
  assert.equal(config.token, "env-token");
});

test("resolveAgentConfig generates a token for --token auto", () => {
  const config = resolveAgentConfig(["--token", "auto"], {});
  assert.equal(config.tokenRequired, true);
  assert.match(config.token ?? "", /^[0-9a-f]{48}$/);
});

test("resolveAgentConfig --no-token disables env token", () => {
  const config = resolveAgentConfig(["--no-token"], { ATLAS_AGENT_TOKEN: "env-token" });
  assert.equal(config.token, undefined);
  assert.equal(config.tokenRequired, false);
});

test("resolveAgentConfig rejects invalid ports", () => {
  assert.throws(() => resolveAgentConfig(["--port", "0"], {}));
  assert.throws(() => resolveAgentConfig(["--port", "70000"], {}));
});
