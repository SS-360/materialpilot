import {
  createEntityId,
  verifySnapshotHash,
  type Diagnostic,
  type GraphNode,
  type GraphSnapshot,
  type ValidationProfile,
  type ValidationReport
} from "@materialpilot/domain";
import { NodeCatalog, isPortCompatible, validateParameterValue } from "@materialpilot/node-catalog";

export type RunnableValidationProfile = Exclude<ValidationProfile, "none">;

const severityRank = { info: 0, warning: 1, error: 2, fatal: 3 } as const;

function diagnostic(
  snapshot: GraphSnapshot,
  code: string,
  severity: Diagnostic["severity"],
  message: string,
  options: {
    entity?: Diagnostic["entity"];
    evidence?: Record<string, unknown>;
    operations?: Diagnostic["suggestedFixes"][number]["operations"];
    fixDescription?: string;
  } = {}
): Diagnostic {
  return {
    id: createEntityId("diagnostic"),
    code,
    severity,
    message,
    projectId: snapshot.projectId,
    ...(options.entity ? { entity: options.entity } : {}),
    evidence: options.evidence ?? {},
    suggestedFixes: options.operations
      ? [
          {
            fixId: `fix_${createEntityId("diagnostic")}`,
            risk: "safe",
            description: options.fixDescription ?? message,
            operations: options.operations
          }
        ]
      : [],
    deterministic: true
  };
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate];
}

function reachableFromOutputs(snapshot: GraphSnapshot): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const connection of snapshot.connections) {
    const sources = incoming.get(connection.toNodeId) ?? [];
    sources.push(connection.fromNodeId);
    incoming.set(connection.toNodeId, sources);
  }
  const reachable = new Set<string>();
  const pending = [...snapshot.outputNodeIds];
  while (pending.length > 0) {
    const nodeId = pending.pop()!;
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    pending.push(...(incoming.get(nodeId) ?? []));
  }
  return reachable;
}

function cycleNodes(snapshot: GraphSnapshot): string[] {
  const outgoing = new Map<string, string[]>();
  for (const connection of snapshot.connections) {
    const targets = outgoing.get(connection.fromNodeId) ?? [];
    targets.push(connection.toNodeId);
    outgoing.set(connection.fromNodeId, targets);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) {
      cycles.add(nodeId);
      return;
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const target of outgoing.get(nodeId) ?? []) visit(target);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const node of snapshot.nodes) visit(node.id);
  return [...cycles];
}

function validateNodeParameters(
  snapshot: GraphSnapshot,
  node: GraphNode,
  catalog: NodeCatalog,
  diagnostics: Diagnostic[]
): void {
  let descriptor;
  try {
    descriptor = catalog.get(node.typeId);
  } catch {
    diagnostics.push(
      diagnostic(
        snapshot,
        "UNSUPPORTED_NODE_TYPE",
        "warning",
        `Node ${node.displayName} has unsupported type ${node.typeId}.`,
        {
          entity: { type: "node", id: node.id },
          evidence: { typeId: node.typeId }
        }
      )
    );
    return;
  }
  const descriptors = new Map(
    descriptor.parameters.map((parameter) => [parameter.name, parameter])
  );
  const dynamicRemoteParameters = node.typeId === "mm.workflow.remote-controls";
  for (const [name, value] of Object.entries(node.parameters)) {
    const parameter = descriptors.get(name);
    if (!parameter) {
      if (dynamicRemoteParameters) continue;
      diagnostics.push(
        diagnostic(
          snapshot,
          "UNKNOWN_PARAMETER",
          "warning",
          `Unknown parameter ${name} on ${node.displayName}.`,
          {
            entity: { type: "parameter", id: `${node.id}:${name}` },
            evidence: { value }
          }
        )
      );
      continue;
    }
    const issues = validateParameterValue(parameter, value);
    for (const issue of issues) {
      diagnostics.push(
        diagnostic(
          snapshot,
          "INVALID_PARAMETER",
          "error",
          `${node.displayName}.${name}: ${issue}`,
          {
            entity: { type: "parameter", id: `${node.id}:${name}` },
            evidence: { value, expected: parameter }
          }
        )
      );
    }
  }
  for (const parameter of descriptor.parameters) {
    if (parameter.required && !(parameter.name in node.parameters)) {
      diagnostics.push(
        diagnostic(
          snapshot,
          "MISSING_PARAMETER",
          "error",
          `${node.displayName} is missing required parameter ${parameter.name}.`,
          {
            entity: { type: "parameter", id: `${node.id}:${parameter.name}` },
            evidence: { default: parameter.default },
            operations: [
              {
                type: "node.set_parameter",
                nodeId: node.id,
                parameter: parameter.name,
                value: parameter.default
              }
            ],
            fixDescription: `Set ${parameter.name} to its catalog default.`
          }
        )
      );
    }
  }
}

export function validateGraph(
  snapshot: GraphSnapshot,
  profile: RunnableValidationProfile = "standard",
  catalog = new NodeCatalog()
): ValidationReport {
  const diagnostics: Diagnostic[] = [];
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const ports = new Map(
    snapshot.nodes
      .flatMap((node) => [...node.inputs, ...node.outputs])
      .map((port) => [port.id, port])
  );

  if (!verifySnapshotHash(snapshot)) {
    diagnostics.push(
      diagnostic(
        snapshot,
        "SNAPSHOT_HASH_MISMATCH",
        "fatal",
        "Snapshot content does not match its canonical hash."
      )
    );
  }
  for (const id of duplicates(snapshot.nodes.map((node) => node.id))) {
    diagnostics.push(
      diagnostic(snapshot, "DUPLICATE_NODE_ID", "fatal", `Duplicate node ID ${id}.`, {
        entity: { type: "node", id }
      })
    );
  }
  for (const id of duplicates(snapshot.connections.map((connection) => connection.id))) {
    diagnostics.push(
      diagnostic(snapshot, "DUPLICATE_CONNECTION_ID", "fatal", `Duplicate connection ID ${id}.`, {
        entity: { type: "connection", id }
      })
    );
  }
  for (const id of duplicates([...ports.keys()])) {
    diagnostics.push(
      diagnostic(snapshot, "DUPLICATE_PORT_ID", "fatal", `Duplicate port ID ${id}.`)
    );
  }

  const inputConnectionCount = new Map<string, number>();
  for (const connection of snapshot.connections) {
    const sourceNode = nodes.get(connection.fromNodeId);
    const targetNode = nodes.get(connection.toNodeId);
    const source = ports.get(connection.fromPortId);
    const target = ports.get(connection.toPortId);
    if (!sourceNode || !targetNode || !source || !target) {
      diagnostics.push(
        diagnostic(
          snapshot,
          "DANGLING_CONNECTION",
          "error",
          `Connection ${connection.id} references a missing node or port.`,
          {
            entity: { type: "connection", id: connection.id },
            evidence: connection,
            operations: [{ type: "connection.delete", connectionId: connection.id }],
            fixDescription: "Remove the dangling connection."
          }
        )
      );
      continue;
    }
    if (source.nodeId !== sourceNode.id || target.nodeId !== targetNode.id) {
      diagnostics.push(
        diagnostic(
          snapshot,
          "PORT_NODE_MISMATCH",
          "error",
          `Connection ${connection.id} uses a port owned by another node.`,
          {
            entity: { type: "connection", id: connection.id }
          }
        )
      );
    }
    if (source.direction !== "output" || target.direction !== "input") {
      diagnostics.push(
        diagnostic(
          snapshot,
          "PORT_DIRECTION_MISMATCH",
          "error",
          `Connection ${connection.id} has invalid port directions.`,
          {
            entity: { type: "connection", id: connection.id }
          }
        )
      );
    }
    if (!isPortCompatible(source.dataType, target.dataType)) {
      diagnostics.push(
        diagnostic(
          snapshot,
          "PORT_TYPE_MISMATCH",
          "error",
          `Cannot connect ${source.dataType} to ${target.dataType}.`,
          {
            entity: { type: "connection", id: connection.id },
            evidence: { sourceType: source.dataType, targetType: target.dataType }
          }
        )
      );
    }
    inputConnectionCount.set(target.id, (inputConnectionCount.get(target.id) ?? 0) + 1);
  }
  for (const [portId, count] of inputConnectionCount) {
    const port = ports.get(portId)!;
    if (count > 1 && !port.variadic) {
      diagnostics.push(
        diagnostic(
          snapshot,
          "MULTIPLE_INPUT_CONNECTIONS",
          "error",
          `Input ${port.name} has ${count} connections.`
        )
      );
    }
  }
  for (const nodeId of cycleNodes(snapshot)) {
    diagnostics.push(
      diagnostic(
        snapshot,
        "PROHIBITED_CYCLE",
        "error",
        `Graph contains a cycle involving ${nodeId}.`,
        {
          entity: { type: "node", id: nodeId }
        }
      )
    );
  }
  for (const outputId of snapshot.outputNodeIds) {
    if (!nodes.has(outputId)) {
      diagnostics.push(
        diagnostic(
          snapshot,
          "MISSING_OUTPUT_NODE",
          "error",
          `Output node ${outputId} does not exist.`
        )
      );
    }
  }
  if (snapshot.outputNodeIds.length === 0) {
    diagnostics.push(
      diagnostic(snapshot, "NO_OUTPUT_NODE", "error", "Graph has no material output node.")
    );
  }

  if (profile !== "structural") {
    for (const node of snapshot.nodes) validateNodeParameters(snapshot, node, catalog, diagnostics);
    const reachable = reachableFromOutputs(snapshot);
    for (const node of snapshot.nodes) {
      const intentionalWorkflowNode =
        node.typeId === "mm.workflow.comment" || node.typeId === "mm.workflow.remote-controls";
      if (!reachable.has(node.id) && !intentionalWorkflowNode) {
        diagnostics.push(
          diagnostic(
            snapshot,
            "UNREACHABLE_NODE",
            "warning",
            `${node.displayName} does not contribute to an output.`,
            {
              entity: { type: "node", id: node.id },
              operations: [{ type: "node.delete", nodeId: node.id, cascade: "disconnect" }],
              fixDescription: `Remove unreachable node ${node.displayName}.`
            }
          )
        );
      }
      for (const input of node.inputs.filter((port) => port.required)) {
        if (!snapshot.connections.some((connection) => connection.toPortId === input.id)) {
          diagnostics.push(
            diagnostic(
              snapshot,
              "REQUIRED_INPUT_DISCONNECTED",
              "warning",
              `${node.displayName}.${input.name} is not connected.`,
              {
                entity: { type: "node", id: node.id },
                evidence: { portId: input.id }
              }
            )
          );
        }
      }
    }
  }

  if (profile === "strict" || profile === "release") {
    for (const outputId of snapshot.outputNodeIds) {
      const output = nodes.get(outputId);
      if (!output || output.typeId !== "mm.output.material") continue;
      const albedo = output.inputs.find((port) => port.name === "albedo");
      const roughness = output.inputs.find((port) => port.name === "roughness");
      if (albedo && !snapshot.connections.some((connection) => connection.toPortId === albedo.id)) {
        diagnostics.push(
          diagnostic(
            snapshot,
            "PBR_ALBEDO_MISSING",
            "warning",
            "Material output has no albedo source."
          )
        );
      }
      if (
        roughness &&
        !snapshot.connections.some((connection) => connection.toPortId === roughness.id)
      ) {
        diagnostics.push(
          diagnostic(
            snapshot,
            "PBR_ROUGHNESS_MISSING",
            "warning",
            "Material output has no roughness source."
          )
        );
      }
    }
  }

  if (profile === "release" && snapshot.unresolvedReferences.length > 0) {
    diagnostics.push(
      diagnostic(
        snapshot,
        "UNRESOLVED_REFERENCES",
        "error",
        "Release validation found unresolved references.",
        {
          evidence: { references: snapshot.unresolvedReferences }
        }
      )
    );
  }

  diagnostics.sort(
    (left, right) =>
      severityRank[right.severity] - severityRank[left.severity] ||
      left.code.localeCompare(right.code)
  );
  return {
    projectId: snapshot.projectId,
    revision: snapshot.revision,
    profile,
    valid: !diagnostics.some((entry) => entry.severity === "error" || entry.severity === "fatal"),
    diagnostics,
    generatedAt: new Date().toISOString()
  };
}
