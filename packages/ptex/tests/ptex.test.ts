import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parsePtex, ptexToSnapshot, serializePtex, snapshotToPtex } from "../src/index.js";

const fixture = fileURLToPath(
  new URL("../../../fixtures/materials/simple-noise.ptex", import.meta.url)
);

describe("PTEX adapter", () => {
  it("round-trips raw projects without semantic changes", () => {
    const parsed = parsePtex(readFileSync(fixture, "utf8"));
    expect(parsePtex(serializePtex(parsed))).toEqual(parsed);
  });

  it("maps PTEX graphs to the stable domain model", () => {
    const parsed = parsePtex(readFileSync(fixture, "utf8"));
    const snapshot = ptexToSnapshot(parsed, "mmpr_fixture");
    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.connections).toHaveLength(1);
    expect(snapshot.outputNodeIds).toHaveLength(1);
    expect(snapshot.hash).toHaveLength(64);
  });

  it("round-trips graph topology through a snapshot", () => {
    const parsed = parsePtex(readFileSync(fixture, "utf8"));
    const snapshot = ptexToSnapshot(parsed, "mmpr_fixture");
    const converted = snapshotToPtex(snapshot);
    expect(converted.connections).toEqual(parsed.connections);
    expect(converted.nodes.map((node) => node.type)).toEqual(parsed.nodes.map((node) => node.type));
  });
});
