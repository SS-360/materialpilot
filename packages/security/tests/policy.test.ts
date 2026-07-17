import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MaterialPilotError } from "@materialpilot/domain";
import { PermissionPolicy, WorkspacePolicy, redact } from "../src/index.js";

describe("WorkspacePolicy", () => {
  it("allows roots and rejects escaped paths", () => {
    const root = mkdtempSync(join(tmpdir(), "materialpilot-"));
    const exports = join(root, "exports");
    mkdirSync(exports);
    const policy = new WorkspacePolicy({
      readRoots: [root],
      writeRoots: [root],
      exportRoots: [exports]
    });
    expect(policy.authorize(join(root, "material.ptex"), "write")).toContain("material.ptex");
    expect(() => policy.authorize(join(root, "..", "escaped.ptex"), "write")).toThrowError(
      MaterialPilotError
    );
  });

  it("requires explicit overwrite permission", () => {
    const root = mkdtempSync(join(tmpdir(), "materialpilot-"));
    const path = join(root, "existing.ptex");
    writeFileSync(path, "{}");
    const policy = new WorkspacePolicy({
      readRoots: [root],
      writeRoots: [root],
      exportRoots: [root]
    });
    expect(() => policy.authorize(path, "write")).toThrowError(MaterialPilotError);
  });
});

describe("PermissionPolicy", () => {
  it("requires a single-use approval in assisted mode", () => {
    const policy = new PermissionPolicy({ mode: "assisted" });
    expect(() => policy.authorize("A1")).toThrow();
    policy.registerApproval({
      value: "approved",
      approvalClass: "A1",
      expiresAt: Date.now() + 1000
    });
    expect(() => policy.authorize("A1", "approved")).not.toThrow();
    expect(() => policy.authorize("A1", "approved")).toThrow();
  });

  it("redacts nested secrets", () => {
    expect(redact({ token: "secret", nested: { password: "secret" }, safe: 1 })).toEqual({
      token: "[REDACTED]",
      nested: { password: "[REDACTED]" },
      safe: 1
    });
  });
});
