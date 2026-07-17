import { describe, expect, it } from "vitest";
import { withSnapshotHash, type GraphSnapshot } from "@materialpilot/domain";
import { validateGraph } from "../src/index.js";

function snapshot(content: Partial<Omit<GraphSnapshot, "hash">> = {}): GraphSnapshot {
  return withSnapshotHash({
    projectId: "project",
    revision: 0,
    graphId: "graph",
    name: "Graph",
    nodes: [],
    connections: [],
    selection: { nodeIds: [], focusedNodeId: null },
    outputNodeIds: [],
    unresolvedReferences: [],
    catalogVersion: "test",
    ...content
  });
}

describe("validateGraph", () => {
  it("reports graphs without an output", () => {
    const report = validateGraph(snapshot(), "structural");
    expect(report.valid).toBe(false);
    expect(report.diagnostics.map((entry) => entry.code)).toContain("NO_OUTPUT_NODE");
  });

  it("reports dangling connections with a safe fix", () => {
    const report = validateGraph(
      snapshot({
        connections: [
          {
            id: "connection",
            fromNodeId: "missing-a",
            fromPortId: "missing-port-a",
            toNodeId: "missing-b",
            toPortId: "missing-port-b",
            metadata: {}
          }
        ]
      }),
      "structural"
    );
    const issue = report.diagnostics.find((entry) => entry.code === "DANGLING_CONNECTION");
    expect(issue?.suggestedFixes[0]?.operations[0]?.type).toBe("connection.delete");
  });

  it("detects a tampered snapshot", () => {
    const valid = snapshot();
    const report = validateGraph({ ...valid, name: "tampered" }, "structural");
    expect(report.diagnostics[0]?.severity).toBe("fatal");
  });
});
