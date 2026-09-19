/**
 * Local, redacted audit trail.
 *
 * Every gated decision is recorded, including the ones that were blocked or
 * refused, because "what did it try to do" matters as much as "what did it do".
 * Entries never leave the machine.
 */

import fs from "node:fs";
import path from "node:path";
import { type PolicyConfig, redactForAudit } from "../policy.mjs";

export type AuditDecision = "allow" | "confirm" | "block" | "denied";

export type AuditEntryInput = {
  tool: string;
  decision: AuditDecision;
  reason: string;
  args: unknown;
  ok?: boolean;
  error?: string;
};

export class AuditLog {
  readonly #filePath: string | undefined;
  readonly #policy: PolicyConfig;
  readonly #entries: string[] = [];

  constructor(policy: PolicyConfig, filePath: string | undefined) {
    this.#policy = policy;
    this.#filePath = filePath;

    if (filePath) {
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
      } catch {
        // A missing audit file must never stop the tool from working. The
        // in-memory ring below still holds the session's history.
      }
    }
  }

  /** Entries from this session, newest last. Used by the `audit` tool. */
  get entries(): unknown[] {
    return this.#entries.map((line) => JSON.parse(line) as unknown);
  }

  append(entry: AuditEntryInput): void {
    const record = {
      at: new Date().toISOString(),
      tool: entry.tool,
      decision: entry.decision,
      reason: entry.reason,
      args: redactForAudit(entry.args, this.#policy),
      ...(entry.ok === undefined ? {} : { ok: entry.ok }),
      ...(entry.error === undefined ? {} : { error: redactForAudit(entry.error, this.#policy) }),
    };

    const line = JSON.stringify(record);
    this.#entries.push(line);
    while (this.#entries.length > this.#policy.audit.maxEntries) {
      this.#entries.shift();
    }

    if (!this.#filePath) {
      return;
    }

    try {
      fs.appendFileSync(this.#filePath, `${line}\n`, "utf8");
      this.#trimFileIfLarge();
    } catch {
      // Same reasoning as above: auditing is best effort on disk, guaranteed
      // in memory.
    }
  }

  /**
   * Keep the file near the configured cap.
   *
   * Rewriting on every append would mean reading the whole file for each
   * click, so the file is allowed to overshoot and is trimmed in batches.
   */
  #trimFileIfLarge(): void {
    if (!this.#filePath) {
      return;
    }

    const max = this.#policy.audit.maxEntries;
    const lines = fs.readFileSync(this.#filePath, "utf8").split("\n").filter(Boolean);
    if (lines.length <= max * 2) {
      return;
    }

    fs.writeFileSync(this.#filePath, `${lines.slice(-max).join("\n")}\n`, "utf8");
  }
}
