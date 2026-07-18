import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  MaterialPilotError,
  graphPatchSchema,
  type Connection,
  type GraphNode,
  type GraphOperation,
  type GraphSnapshot,
  type ParameterValue,
  type Port
} from "@materialpilot/domain";
import { isPortCompatible, validateParameterValue } from "@materialpilot/node-catalog";
import { PermissionPolicy } from "@materialpilot/security";
import type { MaterialBackend } from "./backend.js";

type Awaitable<T> = T | Promise<T>;
type ApprovalClass = "A0" | "A1";
type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  approvalClass: ApprovalClass;
  sideEffects: string[];
  destructive: boolean;
  execute: (input: unknown) => Awaitable<unknown>;
};

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};
const editAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function defineTool<S extends z.ZodRawShape>(
  name: string,
  description: string,
  schema: z.ZodObject<S>,
  execute: (input: z.infer<z.ZodObject<S>>) => Awaitable<unknown>,
  options: {
    approvalClass?: ApprovalClass;
    sideEffects?: string[];
    destructive?: boolean;
  } = {}
): ToolDefinition {
  return {
    name,
    description,
    inputSchema: schema.shape,
    approvalClass: options.approvalClass ?? "A0",
    sideEffects: options.sideEffects ?? [],
    destructive: options.destructive ?? false,
    execute: (input) => execute(schema.parse(input))
  };
}

const projectIdSchema = z.object({ projectId: z.string().min(1) });
const nodeIdSchema = z.object({ projectId: z.string().min(1), nodeId: z.string().min(1) });
const editBaseShape = {
  projectId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: z
    .string()
    .min(8)
    .max(200)
    .default(() => randomUUID()),
  approvalToken: z.string().optional()
};

function getNode(snapshot: GraphSnapshot, nodeId: string): GraphNode {
  const node = snapshot.nodes.find(
    (candidate) => candidate.id === nodeId || candidate.nativeId === nodeId
  );
  if (!node) throw new MaterialPilotError("NODE_NOT_FOUND", `Node ${nodeId} was not found.`);
  return node;
}

function getPort(node: GraphNode, selector: string | number, direction?: "input" | "output"): Port {
  const ports =
    direction === "input"
      ? node.inputs
      : direction === "output"
        ? node.outputs
        : [...node.inputs, ...node.outputs];
  const requested = typeof selector === "string" ? selector.toLocaleLowerCase() : null;
  const port = ports.find(
    (candidate) =>
      (typeof selector === "number" && candidate.index === selector) ||
      (requested !== null &&
        (candidate.id.toLocaleLowerCase() === requested ||
          candidate.name.toLocaleLowerCase() === requested))
  );
  if (!port) {
    throw new MaterialPilotError(
      "PORT_NOT_FOUND",
      `${direction ?? "Node"} port ${String(selector)} was not found on ${node.displayName}.`
    );
  }
  return port;
}

function incoming(snapshot: GraphSnapshot, nodeId: string): Connection[] {
  return snapshot.connections.filter((connection) => connection.toNodeId === nodeId);
}

function outgoing(snapshot: GraphSnapshot, nodeId: string): Connection[] {
  return snapshot.connections.filter((connection) => connection.fromNodeId === nodeId);
}

function upstreamReachable(snapshot: GraphSnapshot): Set<string> {
  const reachable = new Set<string>();
  const pending = [...snapshot.outputNodeIds];
  while (pending.length > 0) {
    const nodeId = pending.pop()!;
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    pending.push(...incoming(snapshot, nodeId).map((connection) => connection.fromNodeId));
  }
  return reachable;
}

function connectedComponents(snapshot: GraphSnapshot): string[][] {
  const adjacency = new Map(snapshot.nodes.map((node) => [node.id, new Set<string>()]));
  for (const connection of snapshot.connections) {
    adjacency.get(connection.fromNodeId)?.add(connection.toNodeId);
    adjacency.get(connection.toNodeId)?.add(connection.fromNodeId);
  }
  const seen = new Set<string>();
  const result: string[][] = [];
  for (const node of snapshot.nodes) {
    if (seen.has(node.id)) continue;
    const component: string[] = [];
    const pending = [node.id];
    while (pending.length > 0) {
      const nodeId = pending.pop()!;
      if (seen.has(nodeId)) continue;
      seen.add(nodeId);
      component.push(nodeId);
      pending.push(...(adjacency.get(nodeId) ?? []));
    }
    result.push(component);
  }
  return result;
}

function shortestPath(snapshot: GraphSnapshot, fromNodeId: string, toNodeId: string): string[] {
  getNode(snapshot, fromNodeId);
  getNode(snapshot, toNodeId);
  const pending: string[][] = [[fromNodeId]];
  const seen = new Set([fromNodeId]);
  while (pending.length > 0) {
    const path = pending.shift()!;
    const last = path.at(-1)!;
    if (last === toNodeId) return path;
    const adjacent = snapshot.connections
      .filter((connection) => connection.fromNodeId === last || connection.toNodeId === last)
      .map((connection) =>
        connection.fromNodeId === last ? connection.toNodeId : connection.fromNodeId
      );
    for (const candidate of adjacent) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      pending.push([...path, candidate]);
    }
  }
  return [];
}

function relativeNodeCost(
  backend: MaterialBackend,
  node: GraphNode
): "low" | "medium" | "high" | "unknown" {
  try {
    return backend.catalog.get(node.typeId).relativeCost;
  } catch {
    return "unknown";
  }
}

async function applyOperations(
  backend: MaterialBackend,
  input: {
    projectId: string;
    expectedRevision: number;
    idempotencyKey: string;
    approvalToken?: string | undefined;
  },
  operations: GraphOperation[],
  label: string,
  policy: PermissionPolicy
) {
  policy.authorize("A1", input.approvalToken);
  return await backend.applyPatch({
    patchVersion: "1",
    projectId: input.projectId,
    expectedRevision: input.expectedRevision,
    idempotencyKey: input.idempotencyKey,
    label,
    dryRun: false,
    operations,
    validationPolicy: "structural"
  });
}

function appProjectGraphCatalogTools(backend: MaterialBackend): ToolDefinition[] {
  return [
    defineTool(
      "app_get_version",
      "Return MaterialPilot and negotiated runtime versions.",
      z.object({}),
      async () => {
        const status = await backend.status();
        return {
          materialPilotVersion: "0.1.0",
          bridgeVersion: status.bridgeVersion,
          materialMakerVersion: status.materialMakerVersion,
          godotVersion: status.godotVersion
        };
      }
    ),
    defineTool(
      "app_get_runtime_health",
      "Return a compact live/offline runtime health assessment.",
      z.object({}),
      async () => {
        const status = await backend.status();
        return {
          healthy: status.running,
          mode: status.offlineMode ? "offline" : "native",
          bridgeConnected: status.bridgeConnected,
          activeProject: status.activeProjectId,
          openProjects: status.connectedProjectCount
        };
      }
    ),
    defineTool(
      "app_get_feature_matrix",
      "Group negotiated capabilities into enabled and disabled feature lists.",
      z.object({}),
      async () => {
        const capabilities = await backend.capabilities();
        const entries = Object.entries(capabilities.features);
        return {
          enabled: entries.filter(([, enabled]) => enabled).map(([name]) => name),
          disabled: entries.filter(([, enabled]) => !enabled).map(([name]) => name),
          limits: capabilities.limits
        };
      }
    ),
    defineTool(
      "project_get",
      "Return one open project by stable project ID.",
      projectIdSchema,
      async ({ projectId }) => {
        const project = (await backend.listProjects()).find(
          (candidate) => candidate.id === projectId
        );
        if (!project)
          throw new MaterialPilotError("PROJECT_NOT_FOUND", `Project ${projectId} was not found.`);
        return project;
      }
    ),
    defineTool(
      "project_get_metadata",
      "Return project lifecycle and graph metadata.",
      projectIdSchema,
      async ({ projectId }) => {
        const projects = await backend.listProjects();
        const project = projects.find((candidate) => candidate.id === projectId);
        if (!project)
          throw new MaterialPilotError("PROJECT_NOT_FOUND", `Project ${projectId} was not found.`);
        if (!project.active) {
          return {
            ...project,
            graphId: null,
            graphHash: null,
            catalogVersion: backend.catalog.version,
            graphAvailable: false
          };
        }
        const snapshot = await backend.getSnapshot(projectId);
        return {
          ...project,
          graphId: snapshot.graphId,
          graphHash: snapshot.hash,
          catalogVersion: snapshot.catalogVersion,
          graphAvailable: true
        };
      }
    ),
    defineTool(
      "project_get_graphs",
      "List graph identities currently exposed by a project.",
      projectIdSchema,
      async ({ projectId }) => {
        const project = (await backend.listProjects()).find(
          (candidate) => candidate.id === projectId
        );
        if (!project)
          throw new MaterialPilotError("PROJECT_NOT_FOUND", `Project ${projectId} was not found.`);
        if (!project.active) return [];
        const snapshot = await backend.getSnapshot(projectId);
        return [
          { id: snapshot.graphId, name: snapshot.name, revision: snapshot.revision, root: true }
        ];
      }
    ),
    defineTool(
      "project_is_dirty",
      "Report whether an open project has unsaved native changes.",
      projectIdSchema,
      async ({ projectId }) => {
        const project = (await backend.listProjects()).find(
          (candidate) => candidate.id === projectId
        );
        if (!project)
          throw new MaterialPilotError("PROJECT_NOT_FOUND", `Project ${projectId} was not found.`);
        return { projectId, dirty: project.dirty };
      }
    ),
    defineTool(
      "project_get_compatibility",
      "Return the negotiated project compatibility declaration.",
      projectIdSchema,
      async ({ projectId }) => {
        const project = (await backend.listProjects()).find(
          (candidate) => candidate.id === projectId
        );
        if (!project)
          throw new MaterialPilotError("PROJECT_NOT_FOUND", `Project ${projectId} was not found.`);
        return project.compatibility;
      }
    ),
    defineTool(
      "project_assert_revision",
      "Check an expected project revision without mutating the graph.",
      z.object({ projectId: z.string(), expectedRevision: z.number().int().nonnegative() }),
      async ({ projectId, expectedRevision }) => {
        const snapshot = await backend.getSnapshot(projectId);
        return {
          projectId,
          expectedRevision,
          actualRevision: snapshot.revision,
          matches: snapshot.revision === expectedRevision
        };
      }
    ),
    defineTool(
      "graph_get_hierarchy",
      "Return the root graph and its node membership as a hierarchy.",
      projectIdSchema,
      async ({ projectId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        return {
          id: snapshot.graphId,
          name: snapshot.name,
          type: "root",
          nodeIds: snapshot.nodes.map((node) => node.id),
          children: []
        };
      }
    ),
    defineTool(
      "graph_get_selection",
      "Return selected and focused graph entities.",
      projectIdSchema,
      async ({ projectId }) => (await backend.getSnapshot(projectId)).selection
    ),
    defineTool(
      "graph_get_bounds",
      "Calculate graph node-position bounds.",
      projectIdSchema,
      async ({ projectId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        if (snapshot.nodes.length === 0)
          return { empty: true, minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
        const xs = snapshot.nodes.map((node) => node.position.x);
        const ys = snapshot.nodes.map((node) => node.position.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        return { empty: false, minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
      }
    ),
    defineTool(
      "graph_get_statistics",
      "Return graph counts grouped by node type, category, and connectivity.",
      projectIdSchema,
      async ({ projectId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        const byType = Object.fromEntries(
          [...new Set(snapshot.nodes.map((node) => node.typeId))].map((typeId) => [
            typeId,
            snapshot.nodes.filter((node) => node.typeId === typeId).length
          ])
        );
        return {
          revision: snapshot.revision,
          nodes: snapshot.nodes.length,
          connections: snapshot.connections.length,
          outputs: snapshot.outputNodeIds.length,
          components: connectedComponents(snapshot).length,
          byType
        };
      }
    ),
    defineTool(
      "graph_get_outputs",
      "List graph output nodes.",
      projectIdSchema,
      async ({ projectId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        return snapshot.outputNodeIds.map((nodeId) => getNode(snapshot, nodeId));
      }
    ),
    defineTool(
      "graph_get_connections",
      "List every canonical graph connection.",
      projectIdSchema,
      async ({ projectId }) => (await backend.getSnapshot(projectId)).connections
    ),
    defineTool(
      "graph_get_adjacency",
      "Return incoming and outgoing adjacency for every graph node.",
      projectIdSchema,
      async ({ projectId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        return Object.fromEntries(
          snapshot.nodes.map((node) => [
            node.id,
            {
              incoming: incoming(snapshot, node.id).map((connection) => connection.fromNodeId),
              outgoing: outgoing(snapshot, node.id).map((connection) => connection.toNodeId)
            }
          ])
        );
      }
    ),
    defineTool(
      "graph_get_connected_components",
      "Return undirected connected components in the graph.",
      projectIdSchema,
      async ({ projectId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        return connectedComponents(snapshot).map((nodeIds, index) => ({ index, nodeIds }));
      }
    ),
    defineTool(
      "graph_get_revision",
      "Return the current revision and canonical graph hash.",
      projectIdSchema,
      async ({ projectId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        return { projectId, revision: snapshot.revision, hash: snapshot.hash };
      }
    ),
    defineTool(
      "graph_explain_path",
      "Find the shortest undirected node path between two graph nodes.",
      z.object({ projectId: z.string(), fromNodeId: z.string(), toNodeId: z.string() }),
      async ({ projectId, fromNodeId, toNodeId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        const nodeIds = shortestPath(snapshot, fromNodeId, toNodeId);
        return {
          found: nodeIds.length > 0,
          nodeIds,
          nodes: nodeIds.map((nodeId) => getNode(snapshot, nodeId))
        };
      }
    ),
    defineTool(
      "graph_find_unreachable_nodes",
      "Find nodes that do not contribute to a material output.",
      projectIdSchema,
      async ({ projectId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        const reachable = upstreamReachable(snapshot);
        return snapshot.nodes.filter((node) => !reachable.has(node.id));
      }
    ),
    defineTool(
      "graph_find_redundant_nodes",
      "Find nodes with identical type and parameters as safe optimization candidates.",
      projectIdSchema,
      async ({ projectId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        const groups = new Map<string, GraphNode[]>();
        for (const node of snapshot.nodes) {
          const key = `${node.typeId}:${JSON.stringify(node.parameters)}`;
          groups.set(key, [...(groups.get(key) ?? []), node]);
        }
        return [...groups.values()]
          .filter((nodes) => nodes.length > 1)
          .map((nodes) => ({ typeId: nodes[0]!.typeId, nodeIds: nodes.map((node) => node.id) }));
      }
    ),
    defineTool(
      "graph_find_expensive_chains",
      "Find high-cost catalog nodes and their immediate consumers.",
      projectIdSchema,
      async ({ projectId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        return snapshot.nodes
          .filter((node) => relativeNodeCost(backend, node) === "high")
          .map((node) => ({
            node,
            consumers: outgoing(snapshot, node.id).map((connection) => connection.toNodeId)
          }));
      }
    ),
    defineTool(
      "catalog_list_nodes",
      "List every negotiated stable node descriptor.",
      z.object({}),
      () => backend.catalog.list()
    ),
    defineTool(
      "catalog_get_inputs",
      "List input descriptors for a node type.",
      z.object({ typeId: z.string() }),
      ({ typeId }) => backend.catalog.get(typeId).inputs
    ),
    defineTool(
      "catalog_get_outputs",
      "List output descriptors for a node type.",
      z.object({ typeId: z.string() }),
      ({ typeId }) => backend.catalog.get(typeId).outputs
    ),
    defineTool(
      "catalog_get_parameters",
      "List parameter descriptors for a node type.",
      z.object({ typeId: z.string() }),
      ({ typeId }) => backend.catalog.get(typeId).parameters
    ),
    defineTool(
      "catalog_find_by_alias",
      "Resolve an upstream native name or compatibility alias.",
      z.object({ alias: z.string() }),
      ({ alias }) => backend.catalog.get(alias)
    ),
    defineTool(
      "catalog_find_by_tag",
      "Find node descriptors carrying one semantic tag.",
      z.object({ tag: z.string() }),
      ({ tag }) =>
        backend.catalog.list().filter((descriptor) => descriptor.semanticTags.includes(tag))
    ),
    defineTool("catalog_list_sources", "List source-category node descriptors.", z.object({}), () =>
      backend.catalog.list().filter((descriptor) => descriptor.category === "source")
    ),
    defineTool("catalog_list_filters", "List filter-category node descriptors.", z.object({}), () =>
      backend.catalog.list().filter((descriptor) => descriptor.category === "filter")
    ),
    defineTool("catalog_list_outputs", "List output-category node descriptors.", z.object({}), () =>
      backend.catalog.list().filter((descriptor) => descriptor.category === "output")
    ),
    defineTool(
      "catalog_check_connection",
      "Check compatibility between two catalog port descriptors.",
      z.object({
        fromTypeId: z.string(),
        fromPort: z.union([z.string(), z.number().int().nonnegative()]),
        toTypeId: z.string(),
        toPort: z.union([z.string(), z.number().int().nonnegative()])
      }),
      ({ fromTypeId, fromPort, toTypeId, toPort }) => {
        const from = backend.catalog.get(fromTypeId);
        const to = backend.catalog.get(toTypeId);
        const output =
          typeof fromPort === "number"
            ? from.outputs[fromPort]
            : from.outputs.find(
                (port) => port.name.toLocaleLowerCase() === fromPort.toLocaleLowerCase()
              );
        const input =
          typeof toPort === "number"
            ? to.inputs[toPort]
            : to.inputs.find(
                (port) => port.name.toLocaleLowerCase() === toPort.toLocaleLowerCase()
              );
        if (!output || !input)
          throw new MaterialPilotError("PORT_NOT_FOUND", "Catalog port was not found.");
        return { compatible: isPortCompatible(output.dataType, input.dataType), output, input };
      }
    )
  ];
}

function nodeAndConnectionTools(
  backend: MaterialBackend,
  policy: PermissionPolicy
): ToolDefinition[] {
  const connectionEndpointSchema = z.object({
    fromNodeId: z.string(),
    fromPort: z.union([z.string(), z.number().int().nonnegative()]),
    toNodeId: z.string(),
    toPort: z.union([z.string(), z.number().int().nonnegative()])
  });
  return [
    defineTool(
      "node_get",
      "Return one graph node by stable or native ID.",
      nodeIdSchema,
      async ({ projectId, nodeId }) => getNode(await backend.getSnapshot(projectId), nodeId)
    ),
    defineTool(
      "node_get_parameters",
      "Return all current parameters for one node.",
      nodeIdSchema,
      async ({ projectId, nodeId }) =>
        getNode(await backend.getSnapshot(projectId), nodeId).parameters
    ),
    defineTool(
      "node_get_parameter",
      "Return one current node parameter and its catalog descriptor.",
      z.object({ projectId: z.string(), nodeId: z.string(), parameter: z.string() }),
      async ({ projectId, nodeId, parameter }) => {
        const node = getNode(await backend.getSnapshot(projectId), nodeId);
        const descriptor = backend.catalog
          .get(node.typeId)
          .parameters.find((candidate) => candidate.name === parameter);
        if (!(parameter in node.parameters))
          throw new MaterialPilotError(
            "PARAMETER_NOT_FOUND",
            `Parameter ${parameter} was not found on ${node.displayName}.`
          );
        return { value: node.parameters[parameter], descriptor: descriptor ?? null };
      }
    ),
    defineTool(
      "node_list_ports",
      "List all input and output ports for one node.",
      nodeIdSchema,
      async ({ projectId, nodeId }) => {
        const node = getNode(await backend.getSnapshot(projectId), nodeId);
        return { inputs: node.inputs, outputs: node.outputs };
      }
    ),
    defineTool(
      "node_get_input",
      "Return one node input port by name, ID, or index.",
      z.object({
        projectId: z.string(),
        nodeId: z.string(),
        port: z.union([z.string(), z.number().int().nonnegative()])
      }),
      async ({ projectId, nodeId, port }) => {
        const node = getNode(await backend.getSnapshot(projectId), nodeId);
        return getPort(node, port, "input");
      }
    ),
    defineTool(
      "node_get_output",
      "Return one node output port by name, ID, or index.",
      z.object({
        projectId: z.string(),
        nodeId: z.string(),
        port: z.union([z.string(), z.number().int().nonnegative()])
      }),
      async ({ projectId, nodeId, port }) => {
        const node = getNode(await backend.getSnapshot(projectId), nodeId);
        return getPort(node, port, "output");
      }
    ),
    defineTool(
      "node_list_connections",
      "List incoming and outgoing connections for one node.",
      nodeIdSchema,
      async ({ projectId, nodeId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        const node = getNode(snapshot, nodeId);
        return { incoming: incoming(snapshot, node.id), outgoing: outgoing(snapshot, node.id) };
      }
    ),
    defineTool(
      "node_get_dependencies",
      "List immediate upstream dependency nodes.",
      nodeIdSchema,
      async ({ projectId, nodeId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        const node = getNode(snapshot, nodeId);
        return incoming(snapshot, node.id).map((connection) =>
          getNode(snapshot, connection.fromNodeId)
        );
      }
    ),
    defineTool(
      "node_get_consumers",
      "List immediate downstream consumer nodes.",
      nodeIdSchema,
      async ({ projectId, nodeId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        const node = getNode(snapshot, nodeId);
        return outgoing(snapshot, node.id).map((connection) =>
          getNode(snapshot, connection.toNodeId)
        );
      }
    ),
    defineTool(
      "node_is_reachable",
      "Report whether a node contributes to any material output.",
      nodeIdSchema,
      async ({ projectId, nodeId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        const node = getNode(snapshot, nodeId);
        return { nodeId: node.id, reachable: upstreamReachable(snapshot).has(node.id) };
      }
    ),
    defineTool(
      "node_validate",
      "Validate current node parameters against its catalog descriptor.",
      nodeIdSchema,
      async ({ projectId, nodeId }) => {
        const node = getNode(await backend.getSnapshot(projectId), nodeId);
        const descriptor = backend.catalog.get(node.typeId);
        const issues = descriptor.parameters.flatMap((parameter) => {
          const value = node.parameters[parameter.name];
          if (value === undefined)
            return parameter.required
              ? [{ parameter: parameter.name, issues: ["Missing required parameter"] }]
              : [];
          const parameterIssues = validateParameterValue(parameter, value);
          return parameterIssues.length > 0
            ? [{ parameter: parameter.name, issues: parameterIssues }]
            : [];
        });
        return { valid: issues.length === 0, nodeId: node.id, issues };
      }
    ),
    defineTool(
      "node_describe",
      "Return a node together with its catalog semantics and live connectivity.",
      nodeIdSchema,
      async ({ projectId, nodeId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        const node = getNode(snapshot, nodeId);
        return {
          node,
          descriptor: backend.catalog.get(node.typeId),
          incoming: incoming(snapshot, node.id),
          outgoing: outgoing(snapshot, node.id)
        };
      }
    ),
    defineTool(
      "node_set_parameters",
      "Set multiple parameters on one node in one atomic transaction.",
      z.object({
        ...editBaseShape,
        nodeId: z.string(),
        parameters: z
          .record(z.string(), z.unknown())
          .refine((value) => Object.keys(value).length > 0, "At least one parameter is required")
      }),
      async (input) =>
        applyOperations(
          backend,
          input,
          Object.entries(input.parameters).map(([parameter, value]) => ({
            type: "node.set_parameter" as const,
            nodeId: input.nodeId,
            parameter,
            value: value as ParameterValue
          })),
          "Set node parameters",
          policy
        ),
      { approvalClass: "A1", sideEffects: ["mutates node parameters"] }
    ),
    defineTool(
      "node_reset_parameter",
      "Reset one node parameter to its catalog default.",
      z.object({ ...editBaseShape, nodeId: z.string(), parameter: z.string() }),
      async (input) => {
        const node = getNode(await backend.getSnapshot(input.projectId), input.nodeId);
        const descriptor = backend.catalog
          .get(node.typeId)
          .parameters.find((parameter) => parameter.name === input.parameter);
        if (!descriptor)
          throw new MaterialPilotError(
            "PARAMETER_NOT_FOUND",
            `Catalog parameter ${input.parameter} was not found.`
          );
        return applyOperations(
          backend,
          input,
          [
            {
              type: "node.set_parameter",
              nodeId: node.id,
              parameter: descriptor.name,
              value: descriptor.default
            }
          ],
          "Reset node parameter",
          policy
        );
      },
      { approvalClass: "A1", sideEffects: ["mutates node parameter"] }
    ),
    defineTool(
      "node_move",
      "Move one node atomically.",
      z.object({
        ...editBaseShape,
        nodeId: z.string(),
        position: z.object({ x: z.number().finite(), y: z.number().finite() })
      }),
      async (input) =>
        applyOperations(
          backend,
          input,
          [{ type: "node.move", nodeId: input.nodeId, position: input.position }],
          "Move node",
          policy
        ),
      { approvalClass: "A1", sideEffects: ["changes graph layout"] }
    ),
    defineTool(
      "node_duplicate",
      "Duplicate a node with its current parameters at an offset position.",
      z.object({
        ...editBaseShape,
        nodeId: z.string(),
        offset: z
          .object({ x: z.number().finite(), y: z.number().finite() })
          .default({ x: 40, y: 40 })
      }),
      async (input) => {
        const node = getNode(await backend.getSnapshot(input.projectId), input.nodeId);
        return applyOperations(
          backend,
          input,
          [
            {
              type: "node.create",
              tempId: "duplicate",
              nodeTypeId: node.typeId,
              position: {
                x: node.position.x + input.offset.x,
                y: node.position.y + input.offset.y
              },
              parameters: node.parameters
            }
          ],
          "Duplicate node",
          policy
        );
      },
      { approvalClass: "A1", sideEffects: ["creates node"] }
    ),
    defineTool(
      "node_select",
      "Replace the current selection with one node.",
      z.object({ ...editBaseShape, nodeId: z.string() }),
      async (input) =>
        applyOperations(
          backend,
          input,
          [{ type: "selection.set", nodeIds: [input.nodeId], focusedNodeId: input.nodeId }],
          "Select node",
          policy
        ),
      { approvalClass: "A1", sideEffects: ["changes selection"] }
    ),
    defineTool(
      "node_select_all",
      "Select every node in the root graph.",
      z.object(editBaseShape),
      async (input) => {
        const snapshot = await backend.getSnapshot(input.projectId);
        return applyOperations(
          backend,
          input,
          [
            {
              type: "selection.set",
              nodeIds: snapshot.nodes.map((node) => node.id),
              focusedNodeId: snapshot.nodes[0]?.id ?? null
            }
          ],
          "Select all nodes",
          policy
        );
      },
      { approvalClass: "A1", sideEffects: ["changes selection"] }
    ),
    defineTool(
      "node_clear_selection",
      "Clear the current node selection.",
      z.object(editBaseShape),
      async (input) =>
        applyOperations(
          backend,
          input,
          [{ type: "selection.set", nodeIds: [], focusedNodeId: null }],
          "Clear selection",
          policy
        ),
      { approvalClass: "A1", sideEffects: ["changes selection"] }
    ),
    defineTool(
      "node_delete_many",
      "Delete multiple nodes atomically with explicit cascade behavior.",
      z.object({
        ...editBaseShape,
        nodeIds: z.array(z.string()).min(1).max(100),
        cascade: z.enum(["reject", "disconnect"]).default("reject")
      }),
      async (input) =>
        applyOperations(
          backend,
          input,
          input.nodeIds.map((nodeId) => ({
            type: "node.delete" as const,
            nodeId,
            cascade: input.cascade
          })),
          "Delete nodes",
          policy
        ),
      { approvalClass: "A1", sideEffects: ["removes nodes"], destructive: true }
    ),
    defineTool(
      "node_move_many",
      "Move multiple nodes to explicit positions atomically.",
      z.object({
        ...editBaseShape,
        moves: z
          .array(
            z.object({
              nodeId: z.string(),
              position: z.object({ x: z.number().finite(), y: z.number().finite() })
            })
          )
          .min(1)
          .max(100)
      }),
      async (input) =>
        applyOperations(
          backend,
          input,
          input.moves.map((move) => ({
            type: "node.move" as const,
            nodeId: move.nodeId,
            position: move.position
          })),
          "Move nodes",
          policy
        ),
      { approvalClass: "A1", sideEffects: ["changes graph layout"] }
    ),
    defineTool(
      "port_get",
      "Return one live port by node and port selector.",
      z.object({
        projectId: z.string(),
        nodeId: z.string(),
        port: z.union([z.string(), z.number().int().nonnegative()]),
        direction: z.enum(["input", "output"]).optional()
      }),
      async ({ projectId, nodeId, port, direction }) =>
        getPort(getNode(await backend.getSnapshot(projectId), nodeId), port, direction)
    ),
    defineTool(
      "port_list_connections",
      "List connections attached to one live port.",
      z.object({
        projectId: z.string(),
        nodeId: z.string(),
        port: z.union([z.string(), z.number().int().nonnegative()]),
        direction: z.enum(["input", "output"])
      }),
      async ({ projectId, nodeId, port, direction }) => {
        const snapshot = await backend.getSnapshot(projectId);
        const node = getNode(snapshot, nodeId);
        const resolved = getPort(node, port, direction);
        return snapshot.connections.filter((connection) =>
          direction === "input"
            ? connection.toPortId === resolved.id
            : connection.fromPortId === resolved.id
        );
      }
    ),
    defineTool(
      "connection_get",
      "Return one connection by stable connection ID.",
      z.object({ projectId: z.string(), connectionId: z.string() }),
      async ({ projectId, connectionId }) => {
        const connection = (await backend.getSnapshot(projectId)).connections.find(
          (candidate) => candidate.id === connectionId
        );
        if (!connection)
          throw new MaterialPilotError(
            "INVALID_REQUEST",
            `Connection ${connectionId} was not found.`
          );
        return connection;
      }
    ),
    defineTool(
      "connection_validate",
      "Validate one existing connection against current port types.",
      z.object({ projectId: z.string(), connectionId: z.string() }),
      async ({ projectId, connectionId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        const connection = snapshot.connections.find((candidate) => candidate.id === connectionId);
        if (!connection)
          throw new MaterialPilotError(
            "INVALID_REQUEST",
            `Connection ${connectionId} was not found.`
          );
        const from = getNode(snapshot, connection.fromNodeId).outputs.find(
          (port) => port.id === connection.fromPortId
        )!;
        const to = getNode(snapshot, connection.toNodeId).inputs.find(
          (port) => port.id === connection.toPortId
        )!;
        return { valid: isPortCompatible(from.dataType, to.dataType), connection, from, to };
      }
    ),
    defineTool(
      "connection_find_open_inputs",
      "List currently disconnected node inputs.",
      z.object({ projectId: z.string(), requiredOnly: z.boolean().default(false) }),
      async ({ projectId, requiredOnly }) => {
        const snapshot = await backend.getSnapshot(projectId);
        return snapshot.nodes.flatMap((node) =>
          node.inputs
            .filter((port) => !port.connected && (!requiredOnly || port.required))
            .map((port) => ({ nodeId: node.id, nodeName: node.displayName, port }))
        );
      }
    ),
    defineTool(
      "connection_find_output_consumers",
      "List consumers of one node output.",
      z.object({
        projectId: z.string(),
        nodeId: z.string(),
        outputPort: z.union([z.string(), z.number().int().nonnegative()])
      }),
      async ({ projectId, nodeId, outputPort }) => {
        const snapshot = await backend.getSnapshot(projectId);
        const node = getNode(snapshot, nodeId);
        const port = getPort(node, outputPort, "output");
        return snapshot.connections
          .filter((connection) => connection.fromPortId === port.id)
          .map((connection) => ({ connection, consumer: getNode(snapshot, connection.toNodeId) }));
      }
    ),
    defineTool(
      "connection_list_for_node",
      "List all connections touching one node.",
      nodeIdSchema,
      async ({ projectId, nodeId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        const node = getNode(snapshot, nodeId);
        return snapshot.connections.filter(
          (connection) => connection.fromNodeId === node.id || connection.toNodeId === node.id
        );
      }
    ),
    defineTool(
      "connection_can_create",
      "Check live endpoints, direction, occupancy, and type compatibility before connecting.",
      z.object({ projectId: z.string(), ...connectionEndpointSchema.shape }),
      async ({ projectId, ...endpoint }) => {
        const snapshot = await backend.getSnapshot(projectId);
        const fromNode = getNode(snapshot, endpoint.fromNodeId);
        const toNode = getNode(snapshot, endpoint.toNodeId);
        const from = getPort(fromNode, endpoint.fromPort, "output");
        const to = getPort(toNode, endpoint.toPort, "input");
        return {
          canCreate: !to.connected && isPortCompatible(from.dataType, to.dataType),
          occupied: to.connected,
          compatible: isPortCompatible(from.dataType, to.dataType),
          from,
          to
        };
      }
    ),
    defineTool(
      "connection_replace",
      "Replace the current connection to an input atomically.",
      z.object({ ...editBaseShape, ...connectionEndpointSchema.shape }),
      async (input) => {
        const snapshot = await backend.getSnapshot(input.projectId);
        const toNode = getNode(snapshot, input.toNodeId);
        const toPort = getPort(toNode, input.toPort, "input");
        const deletes = snapshot.connections
          .filter((connection) => connection.toPortId === toPort.id)
          .map((connection) => ({
            type: "connection.delete" as const,
            connectionId: connection.id
          }));
        return applyOperations(
          backend,
          input,
          [
            ...deletes,
            {
              type: "connection.create",
              fromNodeId: input.fromNodeId,
              fromPort: input.fromPort,
              toNodeId: input.toNodeId,
              toPort: input.toPort
            }
          ],
          "Replace connection",
          policy
        );
      },
      { approvalClass: "A1", sideEffects: ["mutates graph connections"] }
    ),
    defineTool(
      "connection_disconnect_input",
      "Disconnect every connection feeding one input port.",
      z.object({
        ...editBaseShape,
        nodeId: z.string(),
        inputPort: z.union([z.string(), z.number().int().nonnegative()])
      }),
      async (input) => {
        const snapshot = await backend.getSnapshot(input.projectId);
        const port = getPort(getNode(snapshot, input.nodeId), input.inputPort, "input");
        const connections = snapshot.connections.filter(
          (connection) => connection.toPortId === port.id
        );
        if (connections.length === 0)
          throw new MaterialPilotError("INVALID_REQUEST", "The input is already disconnected.");
        return applyOperations(
          backend,
          input,
          connections.map((connection) => ({
            type: "connection.delete",
            connectionId: connection.id
          })),
          "Disconnect input",
          policy
        );
      },
      { approvalClass: "A1", sideEffects: ["removes graph connections"] }
    ),
    defineTool(
      "connection_disconnect_node",
      "Disconnect every connection touching one node atomically.",
      z.object({ ...editBaseShape, nodeId: z.string() }),
      async (input) => {
        const snapshot = await backend.getSnapshot(input.projectId);
        const node = getNode(snapshot, input.nodeId);
        const connections = snapshot.connections.filter(
          (connection) => connection.fromNodeId === node.id || connection.toNodeId === node.id
        );
        if (connections.length === 0)
          throw new MaterialPilotError("INVALID_REQUEST", "The node is already disconnected.");
        return applyOperations(
          backend,
          input,
          connections.map((connection) => ({
            type: "connection.delete",
            connectionId: connection.id
          })),
          "Disconnect node",
          policy
        );
      },
      { approvalClass: "A1", sideEffects: ["removes graph connections"] }
    ),
    defineTool(
      "connection_create_many",
      "Create multiple connections in one atomic transaction.",
      z.object({
        ...editBaseShape,
        connections: z.array(connectionEndpointSchema).min(1).max(100)
      }),
      async (input) =>
        applyOperations(
          backend,
          input,
          input.connections.map((connection) => ({
            type: "connection.create" as const,
            ...connection
          })),
          "Create connections",
          policy
        ),
      { approvalClass: "A1", sideEffects: ["creates graph connections"] }
    ),
    defineTool(
      "connection_delete_many",
      "Delete multiple connections in one atomic transaction.",
      z.object({ ...editBaseShape, connectionIds: z.array(z.string()).min(1).max(100) }),
      async (input) =>
        applyOperations(
          backend,
          input,
          input.connectionIds.map((connectionId) => ({
            type: "connection.delete" as const,
            connectionId
          })),
          "Delete connections",
          policy
        ),
      { approvalClass: "A1", sideEffects: ["removes graph connections"], destructive: true }
    )
  ];
}

function transactionLayoutMaterialTools(
  backend: MaterialBackend,
  policy: PermissionPolicy
): ToolDefinition[] {
  const layoutSelectionShape = {
    ...editBaseShape,
    nodeIds: z.array(z.string()).min(1).max(100)
  };
  const materialOutput = (snapshot: GraphSnapshot, outputNodeId?: string) => {
    if (outputNodeId) return getNode(snapshot, outputNodeId);
    const node = snapshot.outputNodeIds
      .map((nodeId) => getNode(snapshot, nodeId))
      .find((candidate) => candidate.typeId === "mm.output.material");
    if (!node)
      throw new MaterialPilotError("NODE_NOT_FOUND", "The graph has no Material output node.");
    return node;
  };
  const channelDetails = (snapshot: GraphSnapshot, output: GraphNode, channel: string) => {
    const port = getPort(output, channel, "input");
    const connection =
      snapshot.connections.find((candidate) => candidate.toPortId === port.id) ?? null;
    return {
      port,
      connection,
      source: connection ? getNode(snapshot, connection.fromNodeId) : null
    };
  };
  return [
    defineTool(
      "graph_get_transaction",
      "Return one recorded MaterialPilot transaction by ID.",
      z.object({ projectId: z.string(), transactionId: z.string() }),
      async ({ projectId, transactionId }) => {
        const transaction = (await backend.listTransactions(projectId)).find(
          (candidate) => candidate.id === transactionId
        );
        if (!transaction)
          throw new MaterialPilotError(
            "INVALID_REQUEST",
            `Transaction ${transactionId} was not found.`
          );
        return transaction;
      }
    ),
    defineTool(
      "graph_estimate_patch_cost",
      "Estimate patch operation count and mutation risk without applying it.",
      z.object({ patch: graphPatchSchema }),
      ({ patch }) => {
        const destructive = patch.operations.filter(
          (operation) => operation.type === "node.delete" || operation.type === "connection.delete"
        ).length;
        return {
          operationCount: patch.operations.length,
          destructiveOperations: destructive,
          estimatedCost:
            patch.operations.length <= 10
              ? "low"
              : patch.operations.length <= 100
                ? "medium"
                : "high",
          withinLimit: patch.operations.length <= 500
        };
      }
    ),
    defineTool(
      "graph_validate_patch",
      "Dry-run a complete graph patch and return deterministic validation and diff evidence.",
      z.object({ patch: graphPatchSchema }),
      async ({ patch }) => backend.planPatch({ ...patch, dryRun: true })
    ),
    defineTool(
      "layout_align_left",
      "Align selected nodes to their leftmost X coordinate.",
      z.object(layoutSelectionShape),
      async (input) => {
        const snapshot = await backend.getSnapshot(input.projectId);
        const nodes = input.nodeIds.map((nodeId) => getNode(snapshot, nodeId));
        const x = Math.min(...nodes.map((node) => node.position.x));
        return applyOperations(
          backend,
          input,
          nodes.map((node) => ({
            type: "node.move",
            nodeId: node.id,
            position: { x, y: node.position.y }
          })),
          "Align nodes left",
          policy
        );
      },
      { approvalClass: "A1", sideEffects: ["changes graph layout"] }
    ),
    defineTool(
      "layout_align_top",
      "Align selected nodes to their topmost Y coordinate.",
      z.object(layoutSelectionShape),
      async (input) => {
        const snapshot = await backend.getSnapshot(input.projectId);
        const nodes = input.nodeIds.map((nodeId) => getNode(snapshot, nodeId));
        const y = Math.min(...nodes.map((node) => node.position.y));
        return applyOperations(
          backend,
          input,
          nodes.map((node) => ({
            type: "node.move",
            nodeId: node.id,
            position: { x: node.position.x, y }
          })),
          "Align nodes top",
          policy
        );
      },
      { approvalClass: "A1", sideEffects: ["changes graph layout"] }
    ),
    defineTool(
      "layout_distribute_horizontal",
      "Distribute selected nodes evenly between their minimum and maximum X positions.",
      z.object(layoutSelectionShape),
      async (input) => {
        const snapshot = await backend.getSnapshot(input.projectId);
        const nodes = input.nodeIds
          .map((nodeId) => getNode(snapshot, nodeId))
          .toSorted((left, right) => left.position.x - right.position.x);
        const min = nodes[0]!.position.x;
        const max = nodes.at(-1)!.position.x;
        const step = nodes.length === 1 ? 0 : (max - min) / (nodes.length - 1);
        return applyOperations(
          backend,
          input,
          nodes.map((node, index) => ({
            type: "node.move",
            nodeId: node.id,
            position: { x: min + step * index, y: node.position.y }
          })),
          "Distribute nodes horizontally",
          policy
        );
      },
      { approvalClass: "A1", sideEffects: ["changes graph layout"] }
    ),
    defineTool(
      "layout_distribute_vertical",
      "Distribute selected nodes evenly between their minimum and maximum Y positions.",
      z.object(layoutSelectionShape),
      async (input) => {
        const snapshot = await backend.getSnapshot(input.projectId);
        const nodes = input.nodeIds
          .map((nodeId) => getNode(snapshot, nodeId))
          .toSorted((left, right) => left.position.y - right.position.y);
        const min = nodes[0]!.position.y;
        const max = nodes.at(-1)!.position.y;
        const step = nodes.length === 1 ? 0 : (max - min) / (nodes.length - 1);
        return applyOperations(
          backend,
          input,
          nodes.map((node, index) => ({
            type: "node.move",
            nodeId: node.id,
            position: { x: node.position.x, y: min + step * index }
          })),
          "Distribute nodes vertically",
          policy
        );
      },
      { approvalClass: "A1", sideEffects: ["changes graph layout"] }
    ),
    defineTool(
      "layout_grid",
      "Arrange selected nodes on a deterministic grid.",
      z.object({
        ...layoutSelectionShape,
        columns: z.number().int().min(1).max(20).default(4),
        origin: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
        spacing: z
          .object({ x: z.number().positive(), y: z.number().positive() })
          .default({ x: 260, y: 180 })
      }),
      async (input) =>
        applyOperations(
          backend,
          input,
          input.nodeIds.map((nodeId, index) => ({
            type: "node.move",
            nodeId,
            position: {
              x: input.origin.x + (index % input.columns) * input.spacing.x,
              y: input.origin.y + Math.floor(index / input.columns) * input.spacing.y
            }
          })),
          "Arrange nodes on grid",
          policy
        ),
      { approvalClass: "A1", sideEffects: ["changes graph layout"] }
    ),
    defineTool(
      "layout_offset",
      "Offset selected nodes by one vector.",
      z.object({ ...layoutSelectionShape, offset: z.object({ x: z.number(), y: z.number() }) }),
      async (input) => {
        const snapshot = await backend.getSnapshot(input.projectId);
        const nodes = input.nodeIds.map((nodeId) => getNode(snapshot, nodeId));
        return applyOperations(
          backend,
          input,
          nodes.map((node) => ({
            type: "node.move",
            nodeId: node.id,
            position: { x: node.position.x + input.offset.x, y: node.position.y + input.offset.y }
          })),
          "Offset nodes",
          policy
        );
      },
      { approvalClass: "A1", sideEffects: ["changes graph layout"] }
    ),
    defineTool(
      "layout_center",
      "Center selected nodes around a target graph position.",
      z.object({
        ...layoutSelectionShape,
        target: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 })
      }),
      async (input) => {
        const snapshot = await backend.getSnapshot(input.projectId);
        const nodes = input.nodeIds.map((nodeId) => getNode(snapshot, nodeId));
        const center = {
          x: nodes.reduce((sum, node) => sum + node.position.x, 0) / nodes.length,
          y: nodes.reduce((sum, node) => sum + node.position.y, 0) / nodes.length
        };
        return applyOperations(
          backend,
          input,
          nodes.map((node) => ({
            type: "node.move",
            nodeId: node.id,
            position: {
              x: node.position.x + input.target.x - center.x,
              y: node.position.y + input.target.y - center.y
            }
          })),
          "Center nodes",
          policy
        );
      },
      { approvalClass: "A1", sideEffects: ["changes graph layout"] }
    ),
    defineTool(
      "material_list_outputs",
      "List Material output nodes in the graph.",
      projectIdSchema,
      async ({ projectId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        return snapshot.outputNodeIds
          .map((nodeId) => getNode(snapshot, nodeId))
          .filter((node) => node.typeId === "mm.output.material");
      }
    ),
    defineTool(
      "material_get_output",
      "Return one Material output node, defaulting to the primary output.",
      z.object({ projectId: z.string(), outputNodeId: z.string().optional() }),
      async ({ projectId, outputNodeId }) =>
        materialOutput(await backend.getSnapshot(projectId), outputNodeId)
    ),
    defineTool(
      "material_list_channels",
      "List Material input channels and their current sources.",
      z.object({ projectId: z.string(), outputNodeId: z.string().optional() }),
      async ({ projectId, outputNodeId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        const output = materialOutput(snapshot, outputNodeId);
        return output.inputs.map((port) => ({
          channel: port.name,
          ...channelDetails(snapshot, output, port.name)
        }));
      }
    ),
    defineTool(
      "material_get_channel",
      "Inspect one Material PBR channel and its direct source.",
      z.object({ projectId: z.string(), channel: z.string(), outputNodeId: z.string().optional() }),
      async ({ projectId, channel, outputNodeId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        const output = materialOutput(snapshot, outputNodeId);
        return { outputNodeId: output.id, channel, ...channelDetails(snapshot, output, channel) };
      }
    ),
    defineTool(
      "material_connect_channel",
      "Connect or replace one Material PBR channel atomically.",
      z.object({
        ...editBaseShape,
        channel: z.string(),
        sourceNodeId: z.string(),
        sourcePort: z.union([z.string(), z.number().int().nonnegative()]).default(0),
        outputNodeId: z.string().optional()
      }),
      async (input) => {
        const snapshot = await backend.getSnapshot(input.projectId);
        const output = materialOutput(snapshot, input.outputNodeId);
        const details = channelDetails(snapshot, output, input.channel);
        const operations: GraphOperation[] = details.connection
          ? [{ type: "connection.delete", connectionId: details.connection.id }]
          : [];
        operations.push({
          type: "connection.create",
          fromNodeId: input.sourceNodeId,
          fromPort: input.sourcePort,
          toNodeId: output.id,
          toPort: details.port.name
        });
        return applyOperations(
          backend,
          input,
          operations,
          `Connect ${input.channel} channel`,
          policy
        );
      },
      { approvalClass: "A1", sideEffects: ["mutates material channel"] }
    ),
    defineTool(
      "material_disconnect_channel",
      "Disconnect one Material PBR channel atomically.",
      z.object({ ...editBaseShape, channel: z.string(), outputNodeId: z.string().optional() }),
      async (input) => {
        const snapshot = await backend.getSnapshot(input.projectId);
        const output = materialOutput(snapshot, input.outputNodeId);
        const details = channelDetails(snapshot, output, input.channel);
        if (!details.connection)
          throw new MaterialPilotError(
            "INVALID_REQUEST",
            `Material channel ${input.channel} is already disconnected.`
          );
        return applyOperations(
          backend,
          input,
          [{ type: "connection.delete", connectionId: details.connection.id }],
          `Disconnect ${input.channel} channel`,
          policy
        );
      },
      { approvalClass: "A1", sideEffects: ["mutates material channel"] }
    ),
    defineTool(
      "material_get_channel_lineage",
      "Trace all upstream nodes feeding one Material channel.",
      z.object({ projectId: z.string(), channel: z.string(), outputNodeId: z.string().optional() }),
      async ({ projectId, channel, outputNodeId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        const output = materialOutput(snapshot, outputNodeId);
        const details = channelDetails(snapshot, output, channel);
        if (!details.source) return { channel, nodeIds: [], nodes: [], connections: [] };
        const visited = new Set<string>();
        const pending = [details.source.id];
        while (pending.length > 0) {
          const nodeId = pending.pop()!;
          if (visited.has(nodeId)) continue;
          visited.add(nodeId);
          pending.push(...incoming(snapshot, nodeId).map((connection) => connection.fromNodeId));
        }
        return {
          channel,
          nodeIds: [...visited],
          nodes: [...visited].map((nodeId) => getNode(snapshot, nodeId)),
          connections: snapshot.connections.filter(
            (connection) =>
              visited.has(connection.fromNodeId) &&
              (visited.has(connection.toNodeId) || connection.toNodeId === output.id)
          )
        };
      }
    ),
    defineTool(
      "material_validate_pbr",
      "Run standard deterministic PBR validation for a material graph.",
      projectIdSchema,
      ({ projectId }) => backend.validate(projectId, "standard")
    ),
    defineTool(
      "material_configure_output",
      "Set multiple Material output parameters atomically.",
      z.object({
        ...editBaseShape,
        outputNodeId: z.string().optional(),
        parameters: z
          .record(z.string(), z.unknown())
          .refine((value) => Object.keys(value).length > 0)
      }),
      async (input) => {
        const output = materialOutput(
          await backend.getSnapshot(input.projectId),
          input.outputNodeId
        );
        return applyOperations(
          backend,
          input,
          Object.entries(input.parameters).map(([parameter, value]) => ({
            type: "node.set_parameter",
            nodeId: output.id,
            parameter,
            value: value as ParameterValue
          })),
          "Configure Material output",
          policy
        );
      },
      { approvalClass: "A1", sideEffects: ["mutates Material output"] }
    ),
    defineTool(
      "material_set_resolution",
      "Set the Material output resolution using a power-of-two pixel size.",
      z.object({
        ...editBaseShape,
        outputNodeId: z.string().optional(),
        resolution: z
          .number()
          .int()
          .min(16)
          .max(4096)
          .refine((value) => (value & (value - 1)) === 0, "Resolution must be a power of two")
      }),
      async (input) => {
        const output = materialOutput(
          await backend.getSnapshot(input.projectId),
          input.outputNodeId
        );
        return applyOperations(
          backend,
          input,
          [
            {
              type: "node.set_parameter",
              nodeId: output.id,
              parameter: "size",
              value: Math.log2(input.resolution)
            }
          ],
          "Set material resolution",
          policy
        );
      },
      { approvalClass: "A1", sideEffects: ["mutates Material output"] }
    ),
    defineTool(
      "material_set_transparency",
      "Enable or disable Material transparency.",
      z.object({ ...editBaseShape, outputNodeId: z.string().optional(), transparent: z.boolean() }),
      async (input) => {
        const output = materialOutput(
          await backend.getSnapshot(input.projectId),
          input.outputNodeId
        );
        return applyOperations(
          backend,
          input,
          [
            {
              type: "node.set_parameter",
              nodeId: output.id,
              parameter: "flags_transparent",
              value: input.transparent
            }
          ],
          "Set material transparency",
          policy
        );
      },
      { approvalClass: "A1", sideEffects: ["mutates Material output"] }
    ),
    defineTool(
      "material_set_depth_scale",
      "Set the Material depth/parallax scale.",
      z.object({
        ...editBaseShape,
        outputNodeId: z.string().optional(),
        depthScale: z.number().min(0).max(1)
      }),
      async (input) => {
        const output = materialOutput(
          await backend.getSnapshot(input.projectId),
          input.outputNodeId
        );
        return applyOperations(
          backend,
          input,
          [
            {
              type: "node.set_parameter",
              nodeId: output.id,
              parameter: "depth_scale",
              value: input.depthScale
            }
          ],
          "Set material depth scale",
          policy
        );
      },
      { approvalClass: "A1", sideEffects: ["mutates Material output"] }
    )
  ];
}

function previewDiagnosticTools(backend: MaterialBackend): ToolDefinition[] {
  const validationTool = (
    name: string,
    profile: "structural" | "standard" | "strict" | "release"
  ) =>
    defineTool(
      name,
      `Run the ${profile} deterministic validation profile.`,
      projectIdSchema,
      ({ projectId }) => backend.validate(projectId, profile)
    );
  return [
    defineTool(
      "preview_get_configuration",
      "Return negotiated preview capabilities and resolution limits.",
      z.object({}),
      async () => {
        const capabilities = await backend.capabilities();
        return {
          capture: capabilities.features["preview.capture"] === true,
          nodeOutput: capabilities.features["preview.nodeOutput"] === true,
          maxResolution: capabilities.limits.maxPreviewResolution,
          formats: ["image/png"]
        };
      }
    ),
    defineTool(
      "preview_can_render_node",
      "Check whether a live node exposes a renderable output.",
      nodeIdSchema,
      async ({ projectId, nodeId }) => {
        const capabilities = await backend.capabilities();
        const node = getNode(await backend.getSnapshot(projectId), nodeId);
        return {
          canRender:
            capabilities.features["preview.nodeOutput"] === true && node.outputs.length > 0,
          outputs: node.outputs
        };
      }
    ),
    defineTool(
      "preview_list_renderable_nodes",
      "List graph nodes with at least one output suitable for node preview.",
      projectIdSchema,
      async ({ projectId }) =>
        (await backend.getSnapshot(projectId)).nodes.filter((node) => node.outputs.length > 0)
    ),
    defineTool(
      "preview_list_node_outputs",
      "List previewable outputs for one node.",
      nodeIdSchema,
      async ({ projectId, nodeId }) => getNode(await backend.getSnapshot(projectId), nodeId).outputs
    ),
    validationTool("diagnostics_validate_structural", "structural"),
    validationTool("diagnostics_validate_standard", "standard"),
    validationTool("diagnostics_validate_strict", "strict"),
    validationTool("diagnostics_validate_release", "release"),
    defineTool(
      "diagnostics_get_errors",
      "Return standard-validation errors and fatal diagnostics.",
      projectIdSchema,
      async ({ projectId }) =>
        (await backend.validate(projectId, "standard")).diagnostics.filter(
          (diagnostic) => diagnostic.severity === "error" || diagnostic.severity === "fatal"
        )
    ),
    defineTool(
      "diagnostics_get_warnings",
      "Return standard-validation warnings.",
      projectIdSchema,
      async ({ projectId }) =>
        (await backend.validate(projectId, "standard")).diagnostics.filter(
          (diagnostic) => diagnostic.severity === "warning"
        )
    ),
    defineTool(
      "diagnostics_summarize",
      "Summarize deterministic diagnostics by severity and code.",
      projectIdSchema,
      async ({ projectId }) => {
        const report = await backend.validate(projectId, "standard");
        const bySeverity = Object.fromEntries(
          ["info", "warning", "error", "fatal"].map((severity) => [
            severity,
            report.diagnostics.filter((diagnostic) => diagnostic.severity === severity).length
          ])
        );
        const byCode = Object.fromEntries(
          [...new Set(report.diagnostics.map((diagnostic) => diagnostic.code))].map((code) => [
            code,
            report.diagnostics.filter((diagnostic) => diagnostic.code === code).length
          ])
        );
        return { valid: report.valid, bySeverity, byCode };
      }
    ),
    defineTool(
      "performance_get_graph_metrics",
      "Return deterministic graph-size and catalog cost metrics.",
      projectIdSchema,
      async ({ projectId }) => {
        const snapshot = await backend.getSnapshot(projectId);
        const costs = { low: 0, medium: 0, high: 0, unknown: 0 };
        for (const node of snapshot.nodes) costs[relativeNodeCost(backend, node)] += 1;
        return {
          nodeCount: snapshot.nodes.length,
          connectionCount: snapshot.connections.length,
          componentCount: connectedComponents(snapshot).length,
          catalogCosts: costs,
          estimatedComplexity: snapshot.nodes.length + snapshot.connections.length * 0.5
        };
      }
    )
  ];
}

type TextureRecipe = {
  scale: number;
  iterations: number;
  persistence: number;
  normalStrength: number;
  depthScale: number;
  metallic: number;
  emission: boolean;
  stops: Array<{ offset: number; color: [number, number, number] }>;
};

const textureRecipes: Record<string, TextureRecipe> = {
  cracked_stone: {
    scale: 18,
    iterations: 7,
    persistence: 0.62,
    normalStrength: 2.2,
    depthScale: 0.14,
    metallic: 0,
    emission: false,
    stops: [
      { offset: 0, color: [0.015, 0.012, 0.01] },
      { offset: 0.2, color: [0.055, 0.05, 0.045] },
      { offset: 0.48, color: [0.18, 0.17, 0.155] },
      { offset: 0.76, color: [0.34, 0.32, 0.29] },
      { offset: 1, color: [0.58, 0.55, 0.5] }
    ]
  },
  basalt: {
    scale: 12,
    iterations: 6,
    persistence: 0.55,
    normalStrength: 1.5,
    depthScale: 0.08,
    metallic: 0,
    emission: false,
    stops: [
      { offset: 0, color: [0.015, 0.02, 0.025] },
      { offset: 0.5, color: [0.075, 0.085, 0.095] },
      { offset: 0.75, color: [0.17, 0.18, 0.19] },
      { offset: 1, color: [0.38, 0.4, 0.42] }
    ]
  },
  sandstone: {
    scale: 8,
    iterations: 5,
    persistence: 0.45,
    normalStrength: 0.8,
    depthScale: 0.05,
    metallic: 0,
    emission: false,
    stops: [
      { offset: 0, color: [0.16, 0.075, 0.025] },
      { offset: 0.45, color: [0.48, 0.26, 0.08] },
      { offset: 0.75, color: [0.72, 0.49, 0.2] },
      { offset: 1, color: [0.9, 0.72, 0.42] }
    ]
  },
  lava: {
    scale: 10,
    iterations: 6,
    persistence: 0.6,
    normalStrength: 2,
    depthScale: 0.12,
    metallic: 0,
    emission: true,
    stops: [
      { offset: 0, color: [0.005, 0.002, 0.002] },
      { offset: 0.48, color: [0.08, 0.005, 0.001] },
      { offset: 0.66, color: [0.55, 0.025, 0.002] },
      { offset: 0.84, color: [1, 0.22, 0.01] },
      { offset: 1, color: [1, 0.8, 0.15] }
    ]
  },
  oxidized_metal: {
    scale: 7,
    iterations: 5,
    persistence: 0.5,
    normalStrength: 1.1,
    depthScale: 0.04,
    metallic: 0.78,
    emission: false,
    stops: [
      { offset: 0, color: [0.08, 0.025, 0.012] },
      { offset: 0.4, color: [0.3, 0.09, 0.025] },
      { offset: 0.62, color: [0.035, 0.22, 0.18] },
      { offset: 0.82, color: [0.08, 0.42, 0.36] },
      { offset: 1, color: [0.32, 0.55, 0.48] }
    ]
  }
};

function recipeOperations(
  snapshot: GraphSnapshot,
  recipe: TextureRecipe,
  resolution: number
): GraphOperation[] {
  const outputNodeId = snapshot.outputNodeIds[0];
  if (!outputNodeId) throw new MaterialPilotError("NODE_NOT_FOUND", "Material output is missing.");
  const operations: GraphOperation[] = [
    {
      type: "node.set_parameter",
      nodeId: outputNodeId,
      parameter: "size",
      value: Math.log2(resolution)
    },
    {
      type: "node.set_parameter",
      nodeId: outputNodeId,
      parameter: "depth_scale",
      value: recipe.depthScale
    },
    {
      type: "node.set_parameter",
      nodeId: outputNodeId,
      parameter: "metallic",
      value: recipe.metallic
    },
    {
      type: "node.create",
      tempId: "height",
      nodeTypeId: "mm.noise.perlin",
      position: { x: -320, y: 20 },
      parameters: {
        scale_x: recipe.scale,
        scale_y: recipe.scale,
        iterations: recipe.iterations,
        persistence: recipe.persistence
      }
    },
    {
      type: "node.create",
      tempId: "albedo",
      nodeTypeId: "mm.filter.colorize",
      position: { x: 0, y: -120 },
      parameters: {
        gradient: {
          kind: "gradient",
          stops: recipe.stops.map(({ offset, color }) => ({
            offset,
            color: { kind: "color", r: color[0], g: color[1], b: color[2], a: 1 }
          }))
        }
      }
    },
    {
      type: "node.create",
      tempId: "normal",
      nodeTypeId: "mm.filter.normal-map",
      position: { x: 0, y: 180 },
      parameters: { strength: recipe.normalStrength, size: Math.log2(resolution) }
    },
    {
      type: "connection.create",
      fromNodeId: "height",
      fromPort: "output",
      toNodeId: "albedo",
      toPort: "input"
    },
    {
      type: "connection.create",
      fromNodeId: "height",
      fromPort: "output",
      toNodeId: "normal",
      toPort: "input"
    },
    {
      type: "connection.create",
      fromNodeId: "albedo",
      fromPort: "output",
      toNodeId: outputNodeId,
      toPort: "albedo"
    },
    {
      type: "connection.create",
      fromNodeId: "height",
      fromPort: "output",
      toNodeId: outputNodeId,
      toPort: "roughness"
    },
    {
      type: "connection.create",
      fromNodeId: "normal",
      fromPort: "normal",
      toNodeId: outputNodeId,
      toPort: "normal"
    },
    {
      type: "connection.create",
      fromNodeId: "height",
      fromPort: "output",
      toNodeId: outputNodeId,
      toPort: "depth"
    }
  ];
  if (recipe.emission) {
    operations.push({
      type: "connection.create",
      fromNodeId: "albedo",
      fromPort: "output",
      toNodeId: outputNodeId,
      toPort: "emission"
    });
  }
  return operations;
}

function workflowTools(backend: MaterialBackend, policy: PermissionPolicy): ToolDefinition[] {
  const applyRecipe = async (
    recipeName: string,
    input: {
      projectId: string;
      expectedRevision: number;
      idempotencyKey: string;
      resolution: number;
      approvalToken?: string | undefined;
    }
  ) => {
    const snapshot = await backend.getSnapshot(input.projectId);
    return applyOperations(
      backend,
      input,
      recipeOperations(snapshot, textureRecipes[recipeName]!, input.resolution),
      `Apply ${recipeName.replaceAll("_", " ")} material recipe`,
      policy
    );
  };
  const createRecipe = async (
    recipeName: string,
    input: {
      name: string;
      idempotencyKey: string;
      resolution: number;
      approvalToken?: string | undefined;
    }
  ) => {
    policy.authorize("A1", input.approvalToken);
    const project = await backend.createMaterialProject(input.name, input.idempotencyKey);
    const snapshot = await backend.getSnapshot(project.id);
    if (snapshot.revision > 0) {
      return {
        project: (await backend.activeProject()) ?? project,
        result: {
          status: "replayed",
          revision: snapshot.revision,
          snapshot,
          validation: await backend.validate(project.id, "standard")
        }
      };
    }
    const result = await backend.applyPatch({
      patchVersion: "1",
      projectId: project.id,
      expectedRevision: snapshot.revision,
      idempotencyKey: `${input.idempotencyKey}:graph`,
      label: `Create ${recipeName.replaceAll("_", " ")} material`,
      dryRun: false,
      operations: recipeOperations(snapshot, textureRecipes[recipeName]!, input.resolution),
      validationPolicy: "standard"
    });
    return { project, result };
  };
  const createSchema = z.object({
    name: z.string().min(1).max(120),
    idempotencyKey: z
      .string()
      .min(8)
      .max(190)
      .default(() => randomUUID()),
    resolution: z
      .number()
      .int()
      .min(16)
      .max(4096)
      .default(1024)
      .refine((value) => (value & (value - 1)) === 0),
    approvalToken: z.string().optional()
  });
  const applySchema = z.object({
    ...editBaseShape,
    resolution: z
      .number()
      .int()
      .min(16)
      .max(4096)
      .default(1024)
      .refine((value) => (value & (value - 1)) === 0)
  });
  const definitions: ToolDefinition[] = [];
  for (const recipeName of Object.keys(textureRecipes)) {
    const label = recipeName.replaceAll("_", " ");
    definitions.push(
      defineTool(
        `workflow_create_${recipeName}`,
        `Create a new editable ${label} material project and populate its PBR graph atomically.`,
        createSchema,
        (input) => createRecipe(recipeName, input),
        { approvalClass: "A1", sideEffects: ["creates project", "mutates graph"] }
      ),
      defineTool(
        `workflow_apply_${recipeName}`,
        `Apply a deterministic ${label} PBR recipe to the active root graph atomically.`,
        applySchema,
        (input) => applyRecipe(recipeName, input),
        { approvalClass: "A1", sideEffects: ["mutates graph"] }
      )
    );
  }
  return definitions;
}

export function registerExpandedTools(
  server: McpServer,
  backend: MaterialBackend,
  policy: PermissionPolicy
): string[] {
  const definitions = [
    ...appProjectGraphCatalogTools(backend),
    ...nodeAndConnectionTools(backend, policy),
    ...transactionLayoutMaterialTools(backend, policy),
    ...previewDiagnosticTools(backend),
    ...workflowTools(backend, policy)
  ];
  for (const definition of definitions) {
    server.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations:
          definition.approvalClass === "A0"
            ? readAnnotations
            : { ...editAnnotations, destructiveHint: definition.destructive },
        _meta: {
          "materialpilot/safety": {
            approvalClass: definition.approvalClass,
            sideEffects: definition.sideEffects
          }
        }
      },
      async (input) => json(await definition.execute(input))
    );
  }
  return definitions.map((definition) => definition.name);
}
