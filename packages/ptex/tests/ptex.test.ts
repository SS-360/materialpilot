import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parsePtex, ptexToSnapshot, serializePtex, snapshotToPtex } from "../src/index.js";
import type { RawPtexProject } from "../src/schema.js";

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

  it("normalizes Material Maker gradients into the stable domain and back", () => {
    const project: RawPtexProject = {
      name: "Gradient",
      type: "graph",
      nodes: [
        {
          name: "colorize",
          type: "colorize",
          parameters: {
            gradient: JSON.stringify({
              type: "Gradient",
              interpolation: 1,
              points: [
                { pos: 0, r: 0.1, g: 0.2, b: 0.3, a: 1 },
                { pos: 1, r: 0.8, g: 0.7, b: 0.6, a: 1 }
              ]
            })
          }
        }
      ],
      connections: []
    };
    const snapshot = ptexToSnapshot(project, "mmpr_gradient");
    expect(snapshot.nodes[0]?.parameters.gradient).toEqual({
      kind: "gradient",
      stops: [
        { offset: 0, color: { kind: "color", r: 0.1, g: 0.2, b: 0.3, a: 1 } },
        { offset: 1, color: { kind: "color", r: 0.8, g: 0.7, b: 0.6, a: 1 } }
      ]
    });
    expect(snapshotToPtex(snapshot).nodes[0]?.parameters?.gradient).toEqual({
      type: "Gradient",
      interpolation: 1,
      points: [
        { pos: 0, r: 0.1, g: 0.2, b: 0.3, a: 1 },
        { pos: 1, r: 0.8, g: 0.7, b: 0.6, a: 1 }
      ]
    });
  });

  it("keeps connection IDs stable when serialized connection order changes", () => {
    const project: RawPtexProject = {
      name: "Connections",
      type: "graph",
      nodes: [
        { name: "perlin", type: "perlin" },
        { name: "colorize", type: "colorize" },
        { name: "Material", type: "material" }
      ],
      connections: [
        { from: "perlin", from_port: 0, to: "colorize", to_port: 0 },
        { from: "colorize", from_port: 0, to: "Material", to_port: 0 }
      ]
    };
    const forward = ptexToSnapshot(project, "mmpr_connections");
    const reverse = ptexToSnapshot(
      { ...project, connections: project.connections.toReversed() },
      "mmpr_connections"
    );
    expect(forward.connections.map((connection) => connection.id).toSorted()).toEqual(
      reverse.connections.map((connection) => connection.id).toSorted()
    );
  });
});
