import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BridgeInitializeResult } from "@materialpilot/bridge-protocol";
import type { GraphPatch } from "@materialpilot/domain";
import { ptexToSnapshot, type RawPtexProject } from "@materialpilot/ptex";
import { describe, expect, it, vi } from "vitest";
import { NativeBackend } from "../src/backend.js";

const fixturePath = fileURLToPath(
  new URL("../../../fixtures/materials/simple-noise.ptex", import.meta.url)
);
const serializedGraph = JSON.parse(readFileSync(fixturePath, "utf8")) as RawPtexProject;

describe("NativeBackend bridge translation", () => {
  it("translates stable catalog type IDs to Material Maker native IDs", async () => {
    let sentPatch: GraphPatch | undefined;
    const client = {
      connected: true,
      request: vi.fn(async (method: string, params?: Record<string, unknown>) => {
        if (method === "graph.get_snapshot") {
          return {
            projectId: "mmpr_native_test",
            revision: 0,
            serializedGraph,
            hash: "fixture"
          };
        }
        if (method === "graph.apply_patch") {
          sentPatch = (params?.patch as GraphPatch | undefined) ?? undefined;
          return {
            status: "committed",
            revision: 1,
            serializedGraph,
            temporaryIds: {},
            changedEntityIds: []
          };
        }
        throw new Error(`Unexpected method: ${method}`);
      })
    };
    const manifest: BridgeInitializeResult = {
      protocolVersion: "1.0",
      bridgeVersion: "0.1.0",
      instanceId: "mmi_test",
      nonce: "0123456789abcdef",
      materialMakerVersion: "1.7",
      godotVersion: "4.7",
      projectTypes: ["material"],
      features: { "graph.write": true },
      limits: {
        maxPatchOperations: 500,
        maxPayloadBytes: 8 * 1024 * 1024,
        maxConcurrentJobs: 2,
        maxPreviewResolution: 4096
      }
    };
    const backend = new NativeBackend(client as never, manifest, "workspace-autonomous");
    await backend.applyPatch({
      patchVersion: "1",
      projectId: "mmpr_native_test",
      expectedRevision: 0,
      idempotencyKey: "native-test-key",
      label: "Create Perlin",
      dryRun: false,
      validationPolicy: "structural",
      operations: [
        {
          type: "node.create",
          nodeTypeId: "mm.noise.perlin",
          position: { x: 0, y: 0 }
        }
      ]
    });
    expect(sentPatch?.operations[0]).toMatchObject({
      type: "node.create",
      nodeTypeId: "perlin"
    });
  });

  it("translates public node IDs, named ports, and parameter values for the native bridge", async () => {
    let sentPatch: GraphPatch | undefined;
    const client = {
      connected: true,
      request: vi.fn(async (method: string, params?: Record<string, unknown>) => {
        if (method === "graph.get_snapshot") {
          return {
            projectId: "mmpr_native_test",
            revision: 0,
            serializedGraph,
            hash: "fixture"
          };
        }
        if (method === "graph.apply_patch") {
          sentPatch = (params?.patch as GraphPatch | undefined) ?? undefined;
          return {
            status: "planned",
            revision: 0,
            serializedGraph,
            temporaryIds: {}
          };
        }
        throw new Error("Unexpected method: " + method);
      })
    };
    const manifest: BridgeInitializeResult = {
      protocolVersion: "1.0",
      bridgeVersion: "0.1.0",
      instanceId: "mmi_test",
      nonce: "0123456789abcdef",
      materialMakerVersion: "1.7",
      godotVersion: "4.7",
      projectTypes: ["material"],
      features: { "graph.write": true },
      limits: {
        maxPatchOperations: 500,
        maxPayloadBytes: 8 * 1024 * 1024,
        maxConcurrentJobs: 2,
        maxPreviewResolution: 4096
      }
    };
    const snapshot = ptexToSnapshot(serializedGraph, "mmpr_native_test");
    const perlin = snapshot.nodes.find((node) => node.nativeId === "perlin_0")!;
    const material = snapshot.nodes.find((node) => node.nativeId === "Material")!;
    const backend = new NativeBackend(client as never, manifest, "workspace-autonomous");
    await backend.planPatch({
      patchVersion: "1",
      projectId: "mmpr_native_test",
      expectedRevision: 0,
      idempotencyKey: "native-translation-key",
      label: "Translate public selectors",
      dryRun: true,
      validationPolicy: "structural",
      operations: [
        {
          type: "connection.create",
          fromNodeId: perlin.id,
          fromPort: "output",
          toNodeId: material.id,
          toPort: "roughness"
        },
        {
          type: "node.create",
          tempId: "color",
          nodeTypeId: "mm.filter.colorize",
          position: { x: 0, y: 0 },
          parameters: {
            gradient: {
              kind: "gradient",
              stops: [
                { offset: 0, color: { kind: "color", r: 0, g: 0, b: 0, a: 1 } },
                { offset: 1, color: { kind: "color", r: 1, g: 1, b: 1, a: 1 } }
              ]
            }
          }
        }
      ]
    });
    expect(sentPatch?.operations[0]).toEqual({
      type: "connection.create",
      fromNodeId: "perlin_0",
      fromPort: 0,
      toNodeId: "Material",
      toPort: 2
    });
    expect(sentPatch?.operations[1]).toMatchObject({
      type: "node.create",
      nodeTypeId: "colorize",
      parameters: {
        gradient: {
          type: "Gradient",
          interpolation: 1
        }
      }
    });
  });
});
