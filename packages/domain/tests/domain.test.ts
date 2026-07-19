import { describe, expect, it } from "vitest";
import {
  canonicalHash,
  canonicalJson,
  createEntityId,
  graphPatchSchema,
  isEntityId,
  verifySnapshotHash,
  withSnapshotHash
} from "../src/index.js";

describe("domain primitives", () => {
  it("creates typed entity identifiers", () => {
    const id = createEntityId("node");
    expect(isEntityId(id, "node")).toBe(true);
    expect(isEntityId(id, "project")).toBe(false);
  });

  it("canonicalizes object key order", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 4 }, b: 2 })
    );
    expect(canonicalHash({ b: 2, a: 1 })).toHaveLength(64);
  });

  it("hashes and verifies snapshots", () => {
    const snapshot = withSnapshotHash({
      projectId: "mmpr_test",
      revision: 0,
      graphId: "mmg_test",
      name: "Test",
      nodes: [],
      connections: [],
      selection: { nodeIds: [], focusedNodeId: null },
      outputNodeIds: [],
      unresolvedReferences: [],
      catalogVersion: "test"
    });
    expect(verifySnapshotHash(snapshot)).toBe(true);
    expect(verifySnapshotHash({ ...snapshot, name: "Changed" })).toBe(false);
  });

  it("rejects malformed graph patches", () => {
    expect(() =>
      graphPatchSchema.parse({
        patchVersion: "1",
        projectId: "p",
        expectedRevision: 0,
        idempotencyKey: "short",
        label: "Broken",
        dryRun: false,
        operations: [],
        validationPolicy: "structural"
      })
    ).toThrow();
  });

  it("round-trips comment and remote-control node creation metadata", () => {
    const parsed = graphPatchSchema.parse({
      patchVersion: "1",
      projectId: "mmpr_test",
      expectedRevision: 0,
      idempotencyKey: "documented-controls-round-trip",
      label: "Document and expose controls",
      dryRun: false,
      validationPolicy: "structural",
      operations: [
        {
          type: "node.create",
          tempId: "comment",
          nodeTypeId: "mm.workflow.comment",
          position: { x: -100, y: -100 },
          comment: {
            title: "Surface controls",
            text: "Artist-facing controls for the material.",
            size: { width: 480, height: 260 }
          }
        },
        {
          type: "node.create",
          nodeTypeId: "mm.workflow.remote-controls",
          position: { x: -300, y: 0 },
          remoteControls: [
            {
              name: "surface_scale",
              label: "Surface scale",
              description: "Controls the procedural source frequency.",
              links: [{ nodeId: "noise", parameter: "scale_x" }]
            }
          ]
        }
      ]
    });

    expect(graphPatchSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });
});
