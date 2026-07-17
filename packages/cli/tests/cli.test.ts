import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lintPtexText } from "../src/main.js";

describe("CLI linter", () => {
  it("lints a PTEX fixture offline", () => {
    const path = fileURLToPath(
      new URL("../../../fixtures/materials/simple-noise.ptex", import.meta.url)
    );
    const report = lintPtexText(readFileSync(path, "utf8"), "structural");
    expect(report.valid).toBe(true);
  });

  it("surfaces unresolved references in release mode", () => {
    const path = fileURLToPath(
      new URL(
        "../../../fixtures/invalid-projects/invalid-dangling-connection.ptex",
        import.meta.url
      )
    );
    const report = lintPtexText(readFileSync(path, "utf8"), "release");
    expect(report.valid).toBe(false);
    expect(report.diagnostics.map((entry) => entry.code)).toContain("UNRESOLVED_REFERENCES");
  });
});
