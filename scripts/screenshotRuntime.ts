import { createServer } from "node:net";

interface ExitAwareProcess {
  exitCode: number | null;
}

interface WaitOptions {
  attempts?: number;
  intervalMs?: number;
}

export async function findAvailablePort(host = "127.0.0.1"): Promise<number> {
  const server = createServer();
  server.unref();

  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a screenshot server port."));
        return;
      }

      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

export async function waitForHttpServer(
  url: string,
  child: ExitAwareProcess,
  options: WaitOptions = {}
): Promise<void> {
  const attempts = options.attempts ?? 50;
  const intervalMs = options.intervalMs ?? 100;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Screenshot server exited before becoming ready (code ${child.exitCode}).`);
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        return;
      }
    } catch {
      // The listener may not be bound yet; retry within the bounded window.
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Screenshot server did not become ready at ${url}.`);
}
