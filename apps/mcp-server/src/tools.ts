import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { graphPatchSchema, type GraphOperation } from "@materialpilot/domain";
import { PermissionPolicy, WorkspacePolicy } from "@materialpilot/security";
import type { MaterialBackend } from "./backend.js";
import { registerExpandedTools } from "./expanded-tools.js";

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

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

export function registerTools(
  server: McpServer,
  backend: MaterialBackend,
  policy: PermissionPolicy,
  workspacePolicy: WorkspacePolicy
): void {
  server.registerTool(
    "app_get_status",
    {
      description:
        "Return Material Maker bridge, active project, capability, and permission status.",
      annotations: readAnnotations,
      _meta: { "materialpilot/safety": { approvalClass: "A0", sideEffects: [] } }
    },
    async () => json(await backend.status())
  );
  server.registerTool(
    "app_get_capabilities",
    {
      description:
        "Return the negotiated MaterialPilot capability manifest and operational limits.",
      annotations: readAnnotations,
      _meta: { "materialpilot/safety": { approvalClass: "A0", sideEffects: [] } }
    },
    async () => json(await backend.capabilities())
  );
  server.registerTool(
    "app_ping",
    {
      description: "Measure local server health and return a timestamp.",
      annotations: readAnnotations,
      _meta: { "materialpilot/safety": { approvalClass: "A0", sideEffects: [] } }
    },
    async () =>
      json({ ok: true, timestamp: new Date().toISOString(), status: await backend.status() })
  );
  server.registerTool(
    "project_list",
    {
      description: "List projects visible to the current MaterialPilot session.",
      annotations: readAnnotations,
      _meta: { "materialpilot/safety": { approvalClass: "A0", sideEffects: [] } }
    },
    async () => json(await backend.listProjects())
  );
  server.registerTool(
    "project_get_active",
    {
      description: "Return the active project summary, or null when no project is active.",
      annotations: readAnnotations,
      _meta: { "materialpilot/safety": { approvalClass: "A0", sideEffects: [] } }
    },
    async () => json(await backend.activeProject())
  );
  server.registerTool(
    "project_create_material",
    {
      description: "Create a new editable material project with a standard PBR output node.",
      inputSchema: {
        name: z.string().min(1).max(120),
        idempotencyKey: z
          .string()
          .min(8)
          .max(200)
          .default(() => randomUUID()),
        approvalToken: z.string().optional()
      },
      annotations: editAnnotations,
      _meta: {
        "materialpilot/safety": { approvalClass: "A1", sideEffects: ["creates in-memory project"] }
      }
    },
    async ({ name, idempotencyKey, approvalToken }) => {
      policy.authorize("A1", approvalToken);
      return json(await backend.createMaterialProject(name, idempotencyKey));
    }
  );
  server.registerTool(
    "project_validate",
    {
      description: "Run deterministic graph validation using a selected profile.",
      inputSchema: {
        projectId: z.string(),
        profile: z.enum(["structural", "standard", "strict", "release"]).default("standard")
      },
      annotations: readAnnotations,
      _meta: { "materialpilot/safety": { approvalClass: "A0", sideEffects: [] } }
    },
    async ({ projectId, profile }) => json(await backend.validate(projectId, profile))
  );
  server.registerTool(
    "project_save",
    {
      description:
        "Save the active editable Material Maker project to a policy-approved .ptex path.",
      inputSchema: {
        projectId: z.string().min(1),
        path: z.string().min(1),
        expectedRevision: z.number().int().nonnegative(),
        idempotencyKey: z.string().min(8).max(200),
        overwrite: z.boolean().default(false),
        approvalToken: z.string().optional()
      },
      annotations: editAnnotations,
      _meta: {
        "materialpilot/safety": { approvalClass: "A2", sideEffects: ["writes project file"] }
      }
    },
    async ({ projectId, path, expectedRevision, idempotencyKey, overwrite, approvalToken }) => {
      policy.authorize("A2", approvalToken);
      const authorized = workspacePolicy.authorize(path, "write", { overwrite });
      return json(
        await backend.saveProject(
          projectId,
          authorized,
          expectedRevision,
          idempotencyKey,
          overwrite
        )
      );
    }
  );
  server.registerTool(
    "graph_create_named_snapshot",
    {
      description: "Capture the current canonical graph as an immutable named recovery snapshot.",
      inputSchema: { projectId: z.string().min(1), name: z.string().min(1).max(120) },
      annotations: editAnnotations,
      _meta: {
        "materialpilot/safety": { approvalClass: "A1", sideEffects: ["stores recovery snapshot"] }
      }
    },
    async ({ projectId, name }) => {
      policy.authorize("A1");
      return json(await backend.createNamedSnapshot(projectId, name));
    }
  );
  server.registerTool(
    "graph_list_named_snapshots",
    {
      description: "List named recovery snapshots for one project.",
      inputSchema: { projectId: z.string().min(1) },
      annotations: readAnnotations,
      _meta: { "materialpilot/safety": { approvalClass: "A0", sideEffects: [] } }
    },
    async ({ projectId }) => json(await backend.listNamedSnapshots(projectId))
  );
  server.registerTool(
    "preview_render_node_output",
    {
      description:
        "Render a bounded PNG preview of one live Material Maker node output without writing a file.",
      inputSchema: {
        projectId: z.string(),
        nodeId: z.string(),
        outputPort: z.union([z.string(), z.number().int().nonnegative()]).default(0),
        resolution: z.number().int().min(16).max(1024).default(64)
      },
      annotations: readAnnotations,
      _meta: {
        "materialpilot/safety": {
          approvalClass: "A0",
          sideEffects: ["bounded transient GPU render"]
        }
      }
    },
    async ({ projectId, nodeId, outputPort, resolution }) => {
      const preview = await backend.renderNodePreview(projectId, nodeId, outputPort, resolution);
      return {
        content: [
          { type: "image" as const, data: preview.data, mimeType: preview.mimeType },
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                nodeId: preview.nodeId,
                outputPort: preview.outputPort,
                revision: preview.revision,
                width: preview.width,
                height: preview.height
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
  server.registerTool(
    "preview_render_material_3d",
    {
      description:
        "Render the live material on Material Maker's sphere or plane preview without writing a file.",
      inputSchema: {
        projectId: z.string().min(1),
        geometry: z.enum(["sphere", "plane"]),
        resolution: z.number().int().min(64).max(2048).default(1024)
      },
      annotations: readAnnotations,
      _meta: {
        "materialpilot/safety": {
          approvalClass: "A0",
          sideEffects: ["bounded transient GPU render"]
        }
      }
    },
    async ({ projectId, geometry, resolution }) => {
      const preview = await backend.renderMaterialPreview(projectId, geometry, resolution);
      return {
        content: [
          { type: "image" as const, data: preview.data, mimeType: preview.mimeType },
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                projectId,
                geometry: preview.geometry,
                revision: preview.revision,
                width: preview.width,
                height: preview.height
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
  server.registerTool(
    "material_export_blender",
    {
      description: "Export Blender-profile PBR textures and return verified artifact hashes.",
      inputSchema: {
        projectId: z.string().min(1),
        prefix: z.string().min(1),
        expectedRevision: z.number().int().nonnegative(),
        idempotencyKey: z.string().min(8).max(200),
        overwrite: z.boolean().default(false),
        approvalToken: z.string().optional()
      },
      annotations: editAnnotations,
      _meta: {
        "materialpilot/safety": { approvalClass: "A3", sideEffects: ["writes exported textures"] }
      }
    },
    async ({ projectId, prefix, expectedRevision, idempotencyKey, overwrite, approvalToken }) => {
      policy.authorize("A3", approvalToken);
      const authorized = workspacePolicy.authorize(`${prefix}.tres`, "export", { overwrite });
      const normalizedPrefix = authorized.slice(0, -".tres".length);
      return json(
        await backend.exportBlender(
          projectId,
          normalizedPrefix,
          expectedRevision,
          idempotencyKey,
          overwrite
        )
      );
    }
  );
  server.registerTool(
    "graph_get_summary",
    {
      description: "Return compact graph counts, outputs, selection, connectivity, and complexity.",
      inputSchema: { projectId: z.string() },
      annotations: readAnnotations,
      _meta: { "materialpilot/safety": { approvalClass: "A0", sideEffects: [] } }
    },
    async ({ projectId }) => json(await backend.getSummary(projectId))
  );
  server.registerTool(
    "graph_get_snapshot",
    {
      description: "Return the complete canonical graph snapshot at its current revision.",
      inputSchema: { projectId: z.string() },
      annotations: readAnnotations,
      _meta: { "materialpilot/safety": { approvalClass: "A0", sideEffects: [] } }
    },
    async ({ projectId }) => json(await backend.getSnapshot(projectId))
  );
  server.registerTool(
    "graph_find_nodes",
    {
      description: "Find graph nodes by type, display name, connectivity, or selected state.",
      inputSchema: {
        projectId: z.string(),
        typeId: z.string().optional(),
        name: z.string().optional(),
        connectedToOutput: z.boolean().optional(),
        selected: z.boolean().optional()
      },
      annotations: readAnnotations,
      _meta: { "materialpilot/safety": { approvalClass: "A0", sideEffects: [] } }
    },
    async ({ projectId, typeId, name, connectedToOutput, selected }) => {
      const snapshot = await backend.getSnapshot(projectId);
      const reachable = upstreamReachable(snapshot);
      const nameQuery = name?.toLocaleLowerCase();
      return json(
        snapshot.nodes.filter(
          (node) =>
            (!typeId || node.typeId === typeId) &&
            (!nameQuery || node.displayName.toLocaleLowerCase().includes(nameQuery)) &&
            (connectedToOutput === undefined || reachable.has(node.id) === connectedToOutput) &&
            (selected === undefined || snapshot.selection.nodeIds.includes(node.id) === selected)
        )
      );
    }
  );
  server.registerTool(
    "graph_trace_dependencies",
    {
      description: "Traverse node dependencies upstream or downstream from a node.",
      inputSchema: {
        projectId: z.string(),
        nodeId: z.string(),
        direction: z.enum(["upstream", "downstream"]),
        maxDepth: z.number().int().min(1).max(100).default(20)
      },
      annotations: readAnnotations,
      _meta: { "materialpilot/safety": { approvalClass: "A0", sideEffects: [] } }
    },
    async ({ projectId, nodeId, direction, maxDepth }) => {
      const snapshot = await backend.getSnapshot(projectId);
      return json(trace(snapshot, nodeId, direction, maxDepth));
    }
  );
  server.registerTool(
    "graph_plan_patch",
    {
      description:
        "Dry-run an atomic graph patch, resolving temporary IDs and returning validation and diff evidence.",
      inputSchema: { patch: graphPatchSchema },
      annotations: readAnnotations,
      _meta: { "materialpilot/safety": { approvalClass: "A0", sideEffects: [] } }
    },
    async ({ patch }) => json(await backend.planPatch(patch))
  );
  server.registerTool(
    "graph_apply_patch",
    {
      description:
        "Apply a revision-checked, idempotent graph patch atomically; validation failure rolls it back.",
      inputSchema: { patch: graphPatchSchema, approvalToken: z.string().optional() },
      annotations: editAnnotations,
      _meta: {
        "materialpilot/safety": {
          approvalClass: "A1",
          sideEffects: ["mutates graph", "adds undo entry"]
        }
      }
    },
    async ({ patch, approvalToken }) => {
      policy.authorize("A1", approvalToken);
      return json(await backend.applyPatch({ ...patch, dryRun: false }));
    }
  );
  server.registerTool(
    "graph_undo",
    {
      description:
        "Undo the latest MaterialPilot transaction while preserving monotonic project revisions.",
      inputSchema: {
        projectId: z.string(),
        expectedRevision: z.number().int().nonnegative(),
        approvalToken: z.string().optional()
      },
      annotations: editAnnotations,
      _meta: { "materialpilot/safety": { approvalClass: "A1", sideEffects: ["mutates graph"] } }
    },
    async ({ projectId, expectedRevision, approvalToken }) => {
      policy.authorize("A1", approvalToken);
      return json(await backend.undo(projectId, expectedRevision));
    }
  );
  server.registerTool(
    "graph_redo",
    {
      description: "Redo the latest undone MaterialPilot transaction.",
      inputSchema: {
        projectId: z.string(),
        expectedRevision: z.number().int().nonnegative(),
        approvalToken: z.string().optional()
      },
      annotations: editAnnotations,
      _meta: { "materialpilot/safety": { approvalClass: "A1", sideEffects: ["mutates graph"] } }
    },
    async ({ projectId, expectedRevision, approvalToken }) => {
      policy.authorize("A1", approvalToken);
      return json(await backend.redo(projectId, expectedRevision));
    }
  );
  server.registerTool(
    "graph_list_transactions",
    {
      description:
        "List committed MaterialPilot graph transactions in reverse chronological order.",
      inputSchema: { projectId: z.string() },
      annotations: readAnnotations,
      _meta: { "materialpilot/safety": { approvalClass: "A0", sideEffects: [] } }
    },
    async ({ projectId }) => json(await backend.listTransactions(projectId))
  );
  server.registerTool(
    "catalog_list_categories",
    {
      description: "List categories available in the negotiated Material Maker node catalog.",
      annotations: readAnnotations,
      _meta: { "materialpilot/safety": { approvalClass: "A0", sideEffects: [] } }
    },
    () => json(backend.catalog.categories())
  );
  server.registerTool(
    "catalog_search_nodes",
    {
      description: "Search node descriptions, aliases, semantic tags, ports, and parameters.",
      inputSchema: {
        query: z.string().optional(),
        category: z.string().optional(),
        tags: z.array(z.string()).optional(),
        inputType: z
          .enum([
            "grayscale",
            "color",
            "rgba",
            "sdf2d",
            "sdf3d",
            "sdf3d_color",
            "material",
            "boolean",
            "number",
            "vector2",
            "vector3",
            "unknown"
          ])
          .optional(),
        outputType: z
          .enum([
            "grayscale",
            "color",
            "rgba",
            "sdf2d",
            "sdf3d",
            "sdf3d_color",
            "material",
            "boolean",
            "number",
            "vector2",
            "vector3",
            "unknown"
          ])
          .optional()
      },
      annotations: readAnnotations,
      _meta: { "materialpilot/safety": { approvalClass: "A0", sideEffects: [] } }
    },
    (filter) =>
      json(
        backend.searchCatalog({
          ...(filter.query === undefined ? {} : { query: filter.query }),
          ...(filter.category === undefined ? {} : { category: filter.category }),
          ...(filter.tags === undefined ? {} : { tags: filter.tags }),
          ...(filter.inputType === undefined ? {} : { inputType: filter.inputType }),
          ...(filter.outputType === undefined ? {} : { outputType: filter.outputType })
        })
      )
  );
  server.registerTool(
    "catalog_get_node_type",
    {
      description: "Return the complete descriptor for a stable node type or upstream alias.",
      inputSchema: { typeId: z.string() },
      annotations: readAnnotations,
      _meta: { "materialpilot/safety": { approvalClass: "A0", sideEffects: [] } }
    },
    ({ typeId }) => json(backend.catalog.get(typeId))
  );
  server.registerTool(
    "catalog_get_compatible_nodes",
    {
      description: "Return node descriptors with inputs compatible with a given output data type.",
      inputSchema: {
        outputType: z.enum([
          "grayscale",
          "color",
          "rgba",
          "sdf2d",
          "sdf3d",
          "sdf3d_color",
          "material",
          "boolean",
          "number",
          "vector2",
          "vector3",
          "unknown"
        ])
      },
      annotations: readAnnotations,
      _meta: { "materialpilot/safety": { approvalClass: "A0", sideEffects: [] } }
    },
    ({ outputType }) => json(backend.catalog.compatibleTargets(outputType))
  );
  server.registerTool(
    "catalog_get_version",
    {
      description: "Return the deterministic node catalog version hash.",
      annotations: readAnnotations,
      _meta: { "materialpilot/safety": { approvalClass: "A0", sideEffects: [] } }
    },
    () => json({ version: backend.catalog.version, descriptorCount: backend.catalog.list().length })
  );

  registerAtomicTools(server, backend, policy);
  registerWorkflowTools(server, backend, policy);
  registerExpandedTools(server, backend, policy);
}

function registerAtomicTools(
  server: McpServer,
  backend: MaterialBackend,
  policy: PermissionPolicy
): void {
  const common = {
    projectId: z.string(),
    expectedRevision: z.number().int().nonnegative(),
    idempotencyKey: z
      .string()
      .min(8)
      .default(() => randomUUID()),
    approvalToken: z.string().optional()
  };
  server.registerTool(
    "node_create",
    {
      description:
        "Create one typed node through the same atomic transaction engine used by graph patches.",
      inputSchema: {
        ...common,
        nodeTypeId: z.string(),
        position: z.object({ x: z.number(), y: z.number() }),
        displayName: z.string().optional(),
        parameters: z.record(z.string(), z.unknown()).optional()
      },
      annotations: editAnnotations,
      _meta: { "materialpilot/safety": { approvalClass: "A1", sideEffects: ["mutates graph"] } }
    },
    async ({ projectId, expectedRevision, idempotencyKey, approvalToken, ...operation }) => {
      policy.authorize("A1", approvalToken);
      return json(
        await applyAtomic(backend, projectId, expectedRevision, idempotencyKey, {
          type: "node.create",
          ...operation,
          parameters: operation.parameters as never
        })
      );
    }
  );
  server.registerTool(
    "node_delete",
    {
      description:
        "Delete one node, rejecting connected nodes unless cascade disconnect is explicitly selected.",
      inputSchema: {
        ...common,
        nodeId: z.string(),
        cascade: z.enum(["reject", "disconnect"]).default("reject")
      },
      annotations: { ...editAnnotations, destructiveHint: true },
      _meta: { "materialpilot/safety": { approvalClass: "A1", sideEffects: ["removes node"] } }
    },
    async ({ projectId, expectedRevision, idempotencyKey, approvalToken, nodeId, cascade }) => {
      policy.authorize("A1", approvalToken);
      return json(
        await applyAtomic(backend, projectId, expectedRevision, idempotencyKey, {
          type: "node.delete",
          nodeId,
          cascade
        })
      );
    }
  );
  server.registerTool(
    "node_set_parameter",
    {
      description: "Set one catalog-validated node parameter atomically.",
      inputSchema: { ...common, nodeId: z.string(), parameter: z.string(), value: z.unknown() },
      annotations: editAnnotations,
      _meta: {
        "materialpilot/safety": { approvalClass: "A1", sideEffects: ["mutates node parameter"] }
      }
    },
    async ({
      projectId,
      expectedRevision,
      idempotencyKey,
      approvalToken,
      nodeId,
      parameter,
      value
    }) => {
      policy.authorize("A1", approvalToken);
      return json(
        await applyAtomic(backend, projectId, expectedRevision, idempotencyKey, {
          type: "node.set_parameter",
          nodeId,
          parameter,
          value: value as never
        })
      );
    }
  );
  server.registerTool(
    "connection_create",
    {
      description: "Create one direction- and type-checked connection atomically.",
      inputSchema: {
        ...common,
        fromNodeId: z.string(),
        fromPort: z.union([z.string(), z.number().int().nonnegative()]),
        toNodeId: z.string(),
        toPort: z.union([z.string(), z.number().int().nonnegative()])
      },
      annotations: editAnnotations,
      _meta: {
        "materialpilot/safety": { approvalClass: "A1", sideEffects: ["mutates graph connection"] }
      }
    },
    async ({ projectId, expectedRevision, idempotencyKey, approvalToken, ...operation }) => {
      policy.authorize("A1", approvalToken);
      return json(
        await applyAtomic(backend, projectId, expectedRevision, idempotencyKey, {
          type: "connection.create",
          ...operation
        })
      );
    }
  );
  server.registerTool(
    "connection_delete",
    {
      description: "Delete one connection atomically.",
      inputSchema: { ...common, connectionId: z.string() },
      annotations: editAnnotations,
      _meta: {
        "materialpilot/safety": { approvalClass: "A1", sideEffects: ["removes graph connection"] }
      }
    },
    async ({ projectId, expectedRevision, idempotencyKey, approvalToken, connectionId }) => {
      policy.authorize("A1", approvalToken);
      return json(
        await applyAtomic(backend, projectId, expectedRevision, idempotencyKey, {
          type: "connection.delete",
          connectionId
        })
      );
    }
  );
}

function registerWorkflowTools(
  server: McpServer,
  backend: MaterialBackend,
  policy: PermissionPolicy
): void {
  server.registerTool(
    "workflow_create_material",
    {
      description:
        "Create a deterministic editable baseline material with noise, albedo, roughness, and normal stages.",
      inputSchema: {
        name: z.string().min(1).max(120),
        idempotencyKey: z
          .string()
          .min(8)
          .max(200)
          .default(() => randomUUID()),
        resolution: z.number().int().min(16).max(4096).default(1024),
        scale: z.number().min(1).max(256).default(8),
        approvalToken: z.string().optional()
      },
      annotations: editAnnotations,
      _meta: {
        "materialpilot/safety": {
          approvalClass: "A1",
          sideEffects: ["creates project", "mutates graph"]
        }
      }
    },
    async ({ name, idempotencyKey, resolution, scale, approvalToken }) => {
      policy.authorize("A1", approvalToken);
      const project = await backend.createMaterialProject(name, idempotencyKey);
      const snapshot = await backend.getSnapshot(project.id);
      if (snapshot.revision > 0) {
        return json({
          project: (await backend.activeProject()) ?? project,
          status: "replayed",
          snapshot,
          validation: await backend.validate(project.id, "standard")
        });
      }
      const size = Math.round(Math.log2(resolution));
      const result = await backend.applyPatch({
        patchVersion: "1",
        projectId: project.id,
        expectedRevision: snapshot.revision,
        idempotencyKey: `workflow-${randomUUID()}`,
        label: `Create ${name} baseline material`,
        dryRun: false,
        operations: [
          {
            type: "node.set_parameter",
            nodeId: snapshot.outputNodeIds[0]!,
            parameter: "size",
            value: size
          },
          {
            type: "node.create",
            tempId: "height",
            nodeTypeId: "mm.noise.perlin",
            position: { x: 0, y: 100 },
            parameters: { scale_x: scale, scale_y: scale }
          },
          {
            type: "node.create",
            tempId: "albedo",
            nodeTypeId: "mm.filter.colorize",
            position: { x: 260, y: 0 }
          },
          {
            type: "node.create",
            tempId: "normal",
            nodeTypeId: "mm.filter.normal-map",
            position: { x: 260, y: 260 }
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
            toNodeId: snapshot.outputNodeIds[0]!,
            toPort: "albedo"
          },
          {
            type: "connection.create",
            fromNodeId: "height",
            fromPort: "output",
            toNodeId: snapshot.outputNodeIds[0]!,
            toPort: "roughness"
          },
          {
            type: "connection.create",
            fromNodeId: "normal",
            fromPort: "normal",
            toNodeId: snapshot.outputNodeIds[0]!,
            toPort: "normal"
          }
        ],
        validationPolicy: "standard"
      });
      return json({
        project,
        transaction: result.transaction,
        snapshot: result.snapshot,
        validation: result.validation
      });
    }
  );
}

async function applyAtomic(
  backend: MaterialBackend,
  projectId: string,
  expectedRevision: number,
  idempotencyKey: string,
  operation: GraphOperation
): Promise<Awaited<ReturnType<MaterialBackend["applyPatch"]>>> {
  return await backend.applyPatch({
    patchVersion: "1",
    projectId,
    expectedRevision,
    idempotencyKey,
    label: operation.type,
    dryRun: false,
    operations: [operation],
    validationPolicy: "structural"
  });
}

function upstreamReachable(
  snapshot: Awaited<ReturnType<MaterialBackend["getSnapshot"]>>
): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const connection of snapshot.connections) {
    incoming.set(connection.toNodeId, [
      ...(incoming.get(connection.toNodeId) ?? []),
      connection.fromNodeId
    ]);
  }
  const reachable = new Set<string>();
  const pending = [...snapshot.outputNodeIds];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    pending.push(...(incoming.get(id) ?? []));
  }
  return reachable;
}

function trace(
  snapshot: Awaited<ReturnType<MaterialBackend["getSnapshot"]>>,
  start: string,
  direction: "upstream" | "downstream",
  maxDepth: number
) {
  const visited = new Set([start]);
  const levels: string[][] = [[start]];
  let frontier = [start];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next = snapshot.connections
      .filter((connection) =>
        direction === "upstream"
          ? frontier.includes(connection.toNodeId)
          : frontier.includes(connection.fromNodeId)
      )
      .map((connection) => (direction === "upstream" ? connection.fromNodeId : connection.toNodeId))
      .filter((nodeId) => !visited.has(nodeId));
    for (const nodeId of next) visited.add(nodeId);
    if (next.length > 0) levels.push(next);
    frontier = next;
  }
  return {
    start,
    direction,
    nodeIds: [...visited],
    levels,
    connections: snapshot.connections.filter(
      (connection) => visited.has(connection.fromNodeId) && visited.has(connection.toNodeId)
    )
  };
}
