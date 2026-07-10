import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import test from "node:test";

import { findAvailablePort, waitForHttpServer } from "../scripts/screenshotRuntime.js";

test("findAvailablePort returns a bindable loopback port", async () => {
  const port = await findAvailablePort();
  const server = createHttpServer((_request, response) => response.end("ok"));

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("waitForHttpServer polls until the selected server responds", async () => {
  const port = await findAvailablePort();
  const server = createHttpServer((_request, response) => response.end("ready"));
  const wait = waitForHttpServer(`http://127.0.0.1:${port}`, { exitCode: null }, {
    attempts: 20,
    intervalMs: 10
  });

  setTimeout(() => server.listen(port, "127.0.0.1"), 20);
  await wait;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("waitForHttpServer stops when the child process has exited", async () => {
  const port = await findAvailablePort();
  await assert.rejects(
    waitForHttpServer(`http://127.0.0.1:${port}`, { exitCode: 1 }, { attempts: 2, intervalMs: 1 }),
    /exited before becoming ready/
  );
});
