import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const sensitiveKeys = /token|secret|password|authorization|cookie/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        sensitiveKeys.test(key) ? "[REDACTED]" : redact(entry)
      ])
    );
  }
  return value;
}

export type AuditEvent = {
  timestamp: string;
  sessionId: string;
  tool: string;
  approvalClass: string;
  decision: "allowed" | "denied";
  arguments: unknown;
  durationMs?: number;
  correlationId?: string;
};

export class AuditLogger {
  constructor(readonly path: string) {}

  async write(event: AuditEvent): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(redact(event))}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
  }
}
