import { describe, expect, it } from "vitest";
import { MaterialPilotError } from "@materialpilot/domain";
import { GraphEngine } from "../src/index.js";

function createPatch(engine: GraphEngine, projectId: string, key: string) {
  const snapshot = engine.getSnapshot(projectId);
  return {
    patchVersion: "1" as const,
    projectId,
    expectedRevision: snapshot.revision,
    idempotencyKey: key,
    label: "Add roughness noise",
    dryRun: false,
    operations: [
      {
        type: "node.create" as const,
        tempId: "noise",
        nodeTypeId: "mm.noise.perlin",
        position: { x: 100, y: 100 },
        parameters: { scale_x: 16, scale_y: 16 }
      },
      {
        type: "connection.create" as const,
        fromNodeId: "noise",
        fromPort: "output",
        toNodeId: snapshot.outputNodeIds[0]!,
        toPort: "roughness"
      }
    ],
    validationPolicy: "standard" as const
  };
}

describe("GraphEngine transactions", () => {
  it("applies a multi-operation patch atomically and resolves temporary ids", () => {
    const engine = new GraphEngine();
    const project = engine.createMaterialProject("Test");
    const result = engine.applyPatch(createPatch(engine, project.id, "idem-create-0001"));
    expect(result.status).toBe("committed");
    expect(result.revision).toBe(1);
    expect(result.temporaryIds.noise).toMatch(/^mmn_/);
    expect(result.snapshot.nodes).toHaveLength(2);
    expect(result.snapshot.connections).toHaveLength(1);
  });

  it("returns the original result for an idempotent retry", () => {
    const engine = new GraphEngine();
    const project = engine.createMaterialProject("Test");
    const patch = createPatch(engine, project.id, "idem-retry-0001");
    const first = engine.applyPatch(patch);
    const second = engine.applyPatch(patch);
    expect(first.snapshot.hash).toBe(second.snapshot.hash);
    expect(second.status).toBe("replayed");
    expect(engine.getSnapshot(project.id).nodes).toHaveLength(2);
  });

  it("rejects stale revisions", () => {
    const engine = new GraphEngine();
    const project = engine.createMaterialProject("Test");
    engine.applyPatch(createPatch(engine, project.id, "idem-revision-0001"));
    const stale = createPatch(engine, project.id, "idem-revision-0003");
    stale.expectedRevision = 0;
    expect(() => engine.applyPatch(stale)).toThrowError(MaterialPilotError);
  });

  it("leaves the graph unchanged when a later operation fails", () => {
    const engine = new GraphEngine();
    const project = engine.createMaterialProject("Test");
    const before = engine.getSnapshot(project.id);
    const patch = createPatch(engine, project.id, "idem-rollback-0001");
    patch.operations.push({
      type: "connection.create",
      fromNodeId: "noise",
      fromPort: "output",
      toNodeId: before.outputNodeIds[0]!,
      toPort: "roughness"
    });
    expect(() => engine.applyPatch(patch)).toThrow();
    expect(engine.getSnapshot(project.id).hash).toBe(before.hash);
    expect(engine.listTransactions(project.id)).toHaveLength(0);
  });

  it("supports monotonic undo and redo", () => {
    const engine = new GraphEngine();
    const project = engine.createMaterialProject("Test");
    engine.applyPatch(createPatch(engine, project.id, "idem-undo-0001"));
    const undone = engine.undo(project.id, 1);
    expect(undone.revision).toBe(2);
    expect(undone.nodes).toHaveLength(1);
    const redone = engine.redo(project.id, 2);
    expect(redone.revision).toBe(3);
    expect(redone.nodes).toHaveLength(2);
  });

  it("plans without changing state", () => {
    const engine = new GraphEngine();
    const project = engine.createMaterialProject("Test");
    const before = engine.getSnapshot(project.id);
    const result = engine.planPatch(createPatch(engine, project.id, "idem-plan-0001"));
    expect(result.status).toBe("planned");
    expect(result.snapshot.nodes).toHaveLength(2);
    expect(engine.getSnapshot(project.id).hash).toBe(before.hash);
  });
});
