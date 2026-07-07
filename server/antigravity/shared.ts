export interface AntigravityData {
  cascadeId: string;
  summary: Record<string, unknown>;
  trajectory: Record<string, unknown>;
}
export const ANTIGRAVITY_KEY = Buffer.from("safeCodeiumworldKeYsecretBalloon", "utf8");
export function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
