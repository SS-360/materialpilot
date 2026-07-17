import {
  MaterialPilotError,
  canonicalJson,
  stableNativeId,
  withSnapshotHash,
  type GraphNode,
  type GraphSnapshot,
  type ParameterValue,
  type Port
} from "@materialpilot/domain";
import { NodeCatalog } from "@materialpilot/node-catalog";
import { rawPtexProjectSchema, type RawPtexNode, type RawPtexProject } from "./schema.js";

export type ParsePtexOptions = { maxBytes?: number; maxNodes?: number };

function countNodes(nodes: readonly RawPtexNode[]): number {
  return nodes.reduce((count, node) => count + 1 + countNodes(node.nodes ?? []), 0);
}

export function parsePtex(text: string, options: ParsePtexOptions = {}): RawPtexProject {
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new MaterialPilotError(
      "INVALID_REQUEST",
      `PTEX exceeds the ${maxBytes}-byte parser limit.`
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new MaterialPilotError("INVALID_REQUEST", "PTEX is not valid JSON.", { cause });
  }
  const project = rawPtexProjectSchema.parse(value) as RawPtexProject;
  const maxNodes = options.maxNodes ?? 10_000;
  if (countNodes(project.nodes) > maxNodes) {
    throw new MaterialPilotError(
      "INVALID_REQUEST",
      `PTEX exceeds the ${maxNodes}-node parser limit.`
    );
  }
  return project;
}

export function serializePtex(project: RawPtexProject, pretty = true): string {
  const parsed = rawPtexProjectSchema.parse(project) as RawPtexProject;
  return pretty ? `${JSON.stringify(parsed, null, "\t")}\n` : canonicalJson(parsed);
}

function rawToParameter(value: unknown): ParameterValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new MaterialPilotError("INVALID_REQUEST", "PTEX contains a non-finite parameter.");
    return value;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (object.type === "Color") {
      return {
        kind: "color",
        r: Number(object.r ?? 0),
        g: Number(object.g ?? 0),
        b: Number(object.b ?? 0),
        a: Number(object.a ?? 1)
      };
    }
    if (object.type === "Vector2") {
      return { kind: "vector2", x: Number(object.x ?? 0), y: Number(object.y ?? 0) };
    }
    if (object.type === "Vector3") {
      return {
        kind: "vector3",
        x: Number(object.x ?? 0),
        y: Number(object.y ?? 0),
        z: Number(object.z ?? 0)
      };
    }
  }
  return JSON.stringify(value);
}

function parameterToRaw(value: ParameterValue): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value.kind === "color")
    return { type: "Color", r: value.r, g: value.g, b: value.b, a: value.a };
  if (value.kind === "vector2") return { type: "Vector2", x: value.x, y: value.y };
  if (value.kind === "vector3") return { type: "Vector3", x: value.x, y: value.y, z: value.z };
  return value;
}

function makeUnknownPorts(nodeId: string, direction: Port["direction"], count: number): Port[] {
  return Array.from({ length: count }, (_, index) => ({
    id: stableNativeId("port", nodeId, `${direction}:${index}`),
    nodeId,
    direction,
    index,
    name: `${direction}_${index}`,
    dataType: "unknown",
    required: false,
    connected: false
  }));
}

export function ptexToSnapshot(
  project: RawPtexProject,
  projectId: string,
  options: { catalog?: NodeCatalog; revision?: number; name?: string } = {}
): GraphSnapshot {
  const catalog = options.catalog ?? new NodeCatalog();
  const rawNodes = project.nodes;
  const maxInputs = new Map<string, number>();
  const maxOutputs = new Map<string, number>();
  for (const connection of project.connections) {
    maxOutputs.set(
      connection.from,
      Math.max(maxOutputs.get(connection.from) ?? 0, connection.from_port + 1)
    );
    maxInputs.set(
      connection.to,
      Math.max(maxInputs.get(connection.to) ?? 0, connection.to_port + 1)
    );
  }
  const nodes: GraphNode[] = rawNodes.map((raw) => {
    const nodeId = stableNativeId("node", projectId, raw.name);
    let descriptor;
    try {
      descriptor = catalog.get(raw.type);
    } catch {
      descriptor = undefined;
    }
    const makePorts = (direction: Port["direction"]): Port[] => {
      const descriptors = direction === "input" ? descriptor?.inputs : descriptor?.outputs;
      const requiredCount =
        direction === "input" ? (maxInputs.get(raw.name) ?? 0) : (maxOutputs.get(raw.name) ?? 0);
      if (!descriptors) return makeUnknownPorts(nodeId, direction, requiredCount);
      const count = Math.max(descriptors.length, requiredCount);
      return Array.from({ length: count }, (_, index) => {
        const port = descriptors[index];
        return {
          id: stableNativeId("port", nodeId, `${direction}:${index}`),
          nodeId,
          direction,
          index,
          name: port?.name ?? `${direction}_${index}`,
          dataType: port?.dataType ?? "unknown",
          required: port?.required ?? false,
          ...(port?.variadic === undefined ? {} : { variadic: port.variadic }),
          connected: false
        };
      });
    };
    return {
      id: nodeId,
      nativeId: raw.name,
      typeId: descriptor?.typeId ?? `mm.unknown.${raw.type.replaceAll("_", "-")}`,
      displayName: raw.name,
      position: raw.node_position ?? { x: 0, y: 0 },
      minimized: false,
      ...(raw.seed_int === undefined ? {} : { seed: raw.seed_int }),
      inputs: makePorts("input"),
      outputs: makePorts("output"),
      parameters: Object.fromEntries(
        Object.entries(raw.parameters ?? {}).map(([name, value]) => [name, rawToParameter(value)])
      ),
      metadata: { rawType: raw.type, ...(raw.nodes ? { nestedGraph: raw.nodes } : {}) }
    };
  });
  const byNativeId = new Map(nodes.map((node) => [node.nativeId, node]));
  const unresolvedReferences: string[] = [];
  const connections = project.connections.flatMap((raw, index) => {
    const source = byNativeId.get(raw.from);
    const target = byNativeId.get(raw.to);
    const fromPort = source?.outputs[raw.from_port];
    const toPort = target?.inputs[raw.to_port];
    if (!source || !target || !fromPort || !toPort) {
      unresolvedReferences.push(`${raw.from}:${raw.from_port}->${raw.to}:${raw.to_port}`);
      return [];
    }
    fromPort.connected = true;
    toPort.connected = true;
    return [
      {
        id: stableNativeId(
          "connection",
          projectId,
          `${index}:${raw.from}:${raw.from_port}:${raw.to}:${raw.to_port}`
        ),
        fromNodeId: source.id,
        fromPortId: fromPort.id,
        toNodeId: target.id,
        toPortId: toPort.id,
        metadata: {}
      }
    ];
  });
  return withSnapshotHash({
    projectId,
    revision: options.revision ?? 0,
    graphId: stableNativeId("graph", projectId, "root"),
    name: options.name ?? project.label?.toString() ?? project.name,
    nodes,
    connections,
    selection: { nodeIds: [], focusedNodeId: null },
    outputNodeIds: nodes
      .filter((node) => node.typeId === "mm.output.material")
      .map((node) => node.id),
    unresolvedReferences,
    catalogVersion: catalog.version
  });
}

export function snapshotToPtex(
  snapshot: GraphSnapshot,
  catalog = new NodeCatalog()
): RawPtexProject {
  const nodes: RawPtexNode[] = snapshot.nodes.map((node) => {
    let rawType = typeof node.metadata.rawType === "string" ? node.metadata.rawType : undefined;
    if (!rawType) {
      try {
        rawType = catalog.get(node.typeId).nativeId;
      } catch {
        rawType = node.typeId.replace(/^mm\.unknown\./, "").replaceAll("-", "_");
      }
    }
    return {
      name: node.nativeId,
      type: rawType,
      node_position: structuredClone(node.position),
      parameters: Object.fromEntries(
        Object.entries(node.parameters).map(([name, value]) => [name, parameterToRaw(value)])
      ),
      ...(node.seed === undefined ? {} : { seed_int: node.seed })
    };
  });
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const connections = snapshot.connections.map((connection) => {
    const source = byId.get(connection.fromNodeId);
    const target = byId.get(connection.toNodeId);
    const fromPort = source?.outputs.find((port) => port.id === connection.fromPortId);
    const toPort = target?.inputs.find((port) => port.id === connection.toPortId);
    if (!source || !target || !fromPort || !toPort) {
      throw new MaterialPilotError(
        "INVALID_REQUEST",
        `Cannot serialize dangling connection ${connection.id}.`
      );
    }
    return {
      from: source.nativeId,
      from_port: fromPort.index,
      to: target.nativeId,
      to_port: toPort.index
    };
  });
  return {
    name: "Material",
    type: "graph",
    label: snapshot.name,
    node_position: { x: 0, y: 0 },
    parameters: {},
    nodes,
    connections
  };
}
