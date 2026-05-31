import { randomBytes } from "node:crypto";

export interface AgentConfig {
  host: string;
  port: number;
  token?: string;
  tokenRequired: boolean;
}

export const DEFAULT_AGENT_HOST = "127.0.0.1";
export const DEFAULT_AGENT_PORT = 3030;

interface ParsedArgs {
  host?: string;
  port?: string;
  token?: string;
  noToken?: boolean;
}

function parseArgv(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const takeValue = (inline?: string): string => {
      if (inline !== undefined) {
        return inline;
      }
      const next = argv[i + 1];
      if (next === undefined) {
        throw new Error(`Missing value for ${arg}.`);
      }
      i += 1;
      return next;
    };

    if (arg === "--no-token") {
      parsed.noToken = true;
      continue;
    }

    const match = /^--(host|port|token)(?:=(.*))?$/.exec(arg);
    if (!match) {
      continue;
    }

    const [, key, inline] = match;
    const value = takeValue(inline);
    if (key === "host") {
      parsed.host = value;
    } else if (key === "port") {
      parsed.port = value;
    } else {
      parsed.token = value;
    }
  }

  return parsed;
}

function resolvePort(raw: string | undefined): number {
  if (raw == null || raw === "") {
    return DEFAULT_AGENT_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${raw}`);
  }
  return port;
}

function resolveToken(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }
  if (value === "auto" || value === "generate") {
    return randomBytes(24).toString("hex");
  }
  return value;
}

/**
 * Resolves the agent runtime configuration from CLI args and environment.
 * CLI flags take precedence over env vars. When a token is provided (or
 * requested via `--token auto`), it becomes mandatory for all `/api` calls.
 */
export function resolveAgentConfig(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): AgentConfig {
  const args = parseArgv(argv);

  const host = args.host?.trim() || env.ATLAS_AGENT_HOST?.trim() || DEFAULT_AGENT_HOST;
  const port = resolvePort(args.port ?? env.ATLAS_AGENT_PORT);

  let token: string | undefined;
  if (!args.noToken) {
    token = resolveToken(args.token) ?? resolveToken(env.ATLAS_AGENT_TOKEN);
  }

  return {
    host,
    port,
    token,
    tokenRequired: Boolean(token)
  };
}
