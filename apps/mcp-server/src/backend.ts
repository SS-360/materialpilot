import { randomUUID } from "node:crypto";
import {
  MaterialPilotError,
  type CapabilityManifest,
  type GraphOperation,
  type GraphPatch,
  type GraphSnapshot,
  type PermissionMode,
  type Project,
  type Transaction,
  type ValidationReport
} from "@materialpilot/domain";
import { GraphEngine, type GraphSummary, type PatchResult } from "@materialpilot/graph-engine";
import { diffGraphs } from "@materialpilot/graph-engine";
import {
  NodeCatalog,
  type CatalogSearch,
  type NodeTypeDescriptor
} from "@materialpilot/node-catalog";
import { BridgeClient, type BridgeInitializeResult } from "@materialpilot/bridge-protocol";
import { parameterValueToRaw, ptexToSnapshot, type RawPtexProject } from "@materialpilot/ptex";
import { validateGraph } from "@materialpilot/validator";

export type Awaitable<T> = T | Promise<T>;

function configuredTimeout(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 5_000 && value <= 900_000 ? value : fallback;
}

export type AppStatus = {
  running: boolean;
  bridgeConnected: boolean;
  offlineMode: boolean;
  materialMakerVersion: string | null;
  godotVersion: string | null;
  bridgeVersion: string;
  activeProjectId: string | null;
  connectedProjectCount: number;
  permissionMode: PermissionMode;
};

export type PreviewImage = {
  mimeType: "image/png";
  data: string;
  width: number;
  height: number;
  nodeId: string;
  outputPort: number;
  revision: number;
};

export type MaterialPreviewImage = Omit<PreviewImage, "nodeId" | "outputPort"> & {
  geometry: "sphere" | "plane";
};

export type NamedSnapshot = {
  id: string;
  name: string;
  projectId: string;
  revision: number;
  hash: string;
  createdAt: string;
  snapshot: GraphSnapshot;
};

export type ExportArtifact = {
  path: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
};

export type MaterialBackend = {
  readonly catalog: NodeCatalog;
  readonly permissionMode: PermissionMode;
  status(): Awaitable<AppStatus>;
  capabilities(): Awaitable<CapabilityManifest>;
  listProjects(): Awaitable<Project[]>;
  activeProject(): Awaitable<Project | null>;
  createMaterialProject(name: string, idempotencyKey?: string): Awaitable<Project>;
  saveProject(
    projectId: string,
    path: string,
    expectedRevision: number,
    idempotencyKey: string,
    overwrite: boolean
  ): Awaitable<Project>;
  getSnapshot(projectId: string): Awaitable<GraphSnapshot>;
  getSummary(projectId: string): Awaitable<GraphSummary>;
  validate(
    projectId: string,
    profile: "structural" | "standard" | "strict" | "release"
  ): Awaitable<ValidationReport>;
  planPatch(patch: GraphPatch): Awaitable<PatchResult>;
  applyPatch(patch: GraphPatch): Awaitable<PatchResult>;
  undo(projectId: string, expectedRevision: number): Awaitable<GraphSnapshot>;
  redo(projectId: string, expectedRevision: number): Awaitable<GraphSnapshot>;
  renderNodePreview(
    projectId: string,
    nodeId: string,
    outputPort: string | number,
    resolution: number
  ): Awaitable<PreviewImage>;
  renderMaterialPreview(
    projectId: string,
    geometry: "sphere" | "plane",
    resolution: number
  ): Awaitable<MaterialPreviewImage>;
  createNamedSnapshot(projectId: string, name: string): Awaitable<NamedSnapshot>;
  listNamedSnapshots(projectId: string): Awaitable<NamedSnapshot[]>;
  exportBlender(
    projectId: string,
    prefix: string,
    expectedRevision: number,
    idempotencyKey: string,
    overwrite: boolean
  ): Awaitable<ExportArtifact[]>;
  listTransactions(projectId: string): Awaitable<Transaction[]>;
  searchCatalog(filter: CatalogSearch): NodeTypeDescriptor[];
};

type NativeGraphResponse = {
  projectId: string;
  revision: number;
  serializedGraph: RawPtexProject;
  hash: string;
  selection?: string[];
};

type NativePatchResponse = {
  status: "planned" | "committed";
  revision: number;
  temporaryIds?: Record<string, string>;
  temporaryNativeIds?: Record<string, string>;
  changedEntityIds?: string[];
  serializedGraph: RawPtexProject;
};

export class NativeBackend implements MaterialBackend {
  readonly catalog = new NodeCatalog();
  readonly permissionMode: PermissionMode;
  readonly #client: BridgeClient;
  readonly #manifest: BridgeInitializeResult;
  readonly #namedSnapshots = new Map<string, NamedSnapshot[]>();

  constructor(
    client: BridgeClient,
    manifest: BridgeInitializeResult,
    permissionMode: PermissionMode
  ) {
    this.#client = client;
    this.#manifest = manifest;
    this.permissionMode = permissionMode;
  }

  async status(): Promise<AppStatus> {
    const value = (await this.#client.request("app.get_status")) as Record<string, unknown>;
    return {
      running: value.running === true,
      bridgeConnected: this.#client.connected,
      offlineMode: false,
      materialMakerVersion: String(
        value.materialMakerVersion ?? this.#manifest.materialMakerVersion
      ),
      godotVersion: String(value.godotVersion ?? this.#manifest.godotVersion),
      bridgeVersion: String(value.bridgeVersion ?? this.#manifest.bridgeVersion),
      activeProjectId: typeof value.activeProjectId === "string" ? value.activeProjectId : null,
      connectedProjectCount: Number(value.connectedProjectCount ?? 0),
      permissionMode: this.permissionMode
    };
  }

  capabilities(): CapabilityManifest {
    return {
      protocolVersion: this.#manifest.protocolVersion,
      bridgeVersion: this.#manifest.bridgeVersion,
      materialMakerVersion: this.#manifest.materialMakerVersion,
      godotVersion: this.#manifest.godotVersion,
      projectTypes: this.#manifest.projectTypes,
      features: this.#manifest.features,
      limits: this.#manifest.limits
    };
  }

  async listProjects(): Promise<Project[]> {
    const projects = (await this.#client.request("project.list")) as Array<Record<string, unknown>>;
    return projects.map((project) => this.#normalizeProject(project));
  }

  async activeProject(): Promise<Project | null> {
    const project = (await this.#client.request("project.get_active")) as Record<string, unknown>;
    return Object.keys(project).length === 0 ? null : this.#normalizeProject(project);
  }

  async createMaterialProject(
    name: string,
    idempotencyKey: string = randomUUID()
  ): Promise<Project> {
    const project = (await this.#client.request(
      "project.create_material",
      { name, idempotencyKey },
      15_000
    )) as Record<string, unknown>;
    return this.#normalizeProject(project);
  }

  async saveProject(
    projectId: string,
    path: string,
    expectedRevision: number,
    idempotencyKey: string,
    overwrite: boolean
  ): Promise<Project> {
    const value = (await this.#client.request(
      "project.save",
      { projectId, path, expectedRevision, idempotencyKey, overwrite },
      60_000
    )) as Record<string, unknown>;
    return this.#normalizeProject(value);
  }

  async getSnapshot(projectId: string): Promise<GraphSnapshot> {
    const response = (await this.#client.request("graph.get_snapshot", {
      projectId
    })) as NativeGraphResponse;
    const snapshot = ptexToSnapshot(response.serializedGraph, response.projectId, {
      catalog: this.catalog,
      revision: response.revision
    });
    snapshot.selection.nodeIds = response.selection ?? [];
    return snapshot;
  }

  async getSummary(projectId: string): Promise<GraphSummary> {
    const snapshot = await this.getSnapshot(projectId);
    const report = validateGraph(snapshot, "standard", this.catalog);
    return {
      projectId,
      revision: snapshot.revision,
      nodeCount: snapshot.nodes.length,
      connectionCount: snapshot.connections.length,
      outputNodeIds: snapshot.outputNodeIds,
      selectedNodeIds: snapshot.selection.nodeIds,
      disconnectedComponents: componentCount(snapshot),
      estimatedComplexity: snapshot.nodes.length + snapshot.connections.length * 0.5,
      warnings: report.diagnostics.filter((entry) => entry.severity === "warning").length
    };
  }

  async validate(projectId: string, profile: "structural" | "standard" | "strict" | "release") {
    return validateGraph(await this.getSnapshot(projectId), profile, this.catalog);
  }

  async planPatch(patch: GraphPatch): Promise<PatchResult> {
    return this.#patch({ ...patch, dryRun: true });
  }

  async applyPatch(patch: GraphPatch): Promise<PatchResult> {
    return this.#patch({ ...patch, dryRun: false });
  }

  async undo(projectId: string, expectedRevision: number): Promise<GraphSnapshot> {
    const response = (await this.#client.request("graph.undo", {
      projectId,
      expectedRevision
    })) as NativeGraphResponse;
    return ptexToSnapshot(response.serializedGraph, projectId, {
      catalog: this.catalog,
      revision: response.revision
    });
  }

  async redo(projectId: string, expectedRevision: number): Promise<GraphSnapshot> {
    const response = (await this.#client.request("graph.redo", {
      projectId,
      expectedRevision
    })) as NativeGraphResponse;
    return ptexToSnapshot(response.serializedGraph, projectId, {
      catalog: this.catalog,
      revision: response.revision
    });
  }

  async renderNodePreview(
    projectId: string,
    nodeId: string,
    outputPort: string | number,
    resolution: number
  ): Promise<PreviewImage> {
    const snapshot = await this.getSnapshot(projectId);
    const node = snapshot.nodes.find(
      (candidate) => candidate.id === nodeId || candidate.nativeId === nodeId
    );
    if (!node) throw new MaterialPilotError("NODE_NOT_FOUND", `Node ${nodeId} was not found.`);
    const port =
      typeof outputPort === "number"
        ? node.outputs.find((candidate) => candidate.index === outputPort)
        : node.outputs.find(
            (candidate) =>
              candidate.id === outputPort ||
              candidate.name.toLocaleLowerCase() === outputPort.toLocaleLowerCase()
          );
    if (!port) {
      throw new MaterialPilotError(
        "PORT_NOT_FOUND",
        `Output ${String(outputPort)} was not found on ${node.displayName}.`
      );
    }
    const response = (await this.#client.request(
      "preview.render_node_output",
      {
        projectId,
        nodeId: node.nativeId,
        outputPort: port.index,
        resolution
      },
      configuredTimeout("MATERIALPILOT_PREVIEW_TIMEOUT_MS", 180_000)
    )) as Omit<PreviewImage, "nodeId" | "outputPort" | "revision">;
    return {
      ...response,
      nodeId: node.id,
      outputPort: port.index,
      revision: snapshot.revision
    };
  }

  async renderMaterialPreview(
    projectId: string,
    geometry: "sphere" | "plane",
    resolution: number
  ): Promise<MaterialPreviewImage> {
    const snapshot = await this.getSnapshot(projectId);
    const response = (await this.#client.request(
      "preview.render_material_3d",
      { projectId, geometry, resolution },
      configuredTimeout("MATERIALPILOT_PREVIEW_TIMEOUT_MS", 180_000)
    )) as Omit<MaterialPreviewImage, "geometry" | "revision">;
    return { ...response, geometry, revision: snapshot.revision };
  }

  async createNamedSnapshot(projectId: string, name: string): Promise<NamedSnapshot> {
    const snapshot = await this.getSnapshot(projectId);
    const record: NamedSnapshot = {
      id: `mmsn_${randomUUID().replaceAll("-", "")}`,
      name,
      projectId,
      revision: snapshot.revision,
      hash: snapshot.hash,
      createdAt: new Date().toISOString(),
      snapshot: structuredClone(snapshot)
    };
    const records = this.#namedSnapshots.get(projectId) ?? [];
    if (records.some((candidate) => candidate.name === name)) {
      throw new MaterialPilotError("INVALID_REQUEST", `Snapshot name already exists: ${name}`);
    }
    records.push(record);
    this.#namedSnapshots.set(projectId, records);
    return structuredClone(record);
  }

  listNamedSnapshots(projectId: string): NamedSnapshot[] {
    return structuredClone(this.#namedSnapshots.get(projectId) ?? []);
  }

  async exportBlender(
    projectId: string,
    prefix: string,
    expectedRevision: number,
    idempotencyKey: string,
    overwrite: boolean
  ): Promise<ExportArtifact[]> {
    return (await this.#client.request(
      "export.blender",
      { projectId, prefix, expectedRevision, idempotencyKey, overwrite },
      configuredTimeout("MATERIALPILOT_EXPORT_TIMEOUT_MS", 900_000)
    )) as ExportArtifact[];
  }

  listTransactions(): Transaction[] {
    return [];
  }

  searchCatalog(filter: CatalogSearch): NodeTypeDescriptor[] {
    return this.catalog.search(filter);
  }

  async #patch(patch: GraphPatch): Promise<PatchResult> {
    const before = await this.getSnapshot(patch.projectId);
    const temporaryTypes = new Map<string, NodeTypeDescriptor>();
    const resolveNode = (nodeId: string): string =>
      before.nodes.find((node) => node.id === nodeId || node.nativeId === nodeId)?.nativeId ??
      nodeId;
    const resolvePort = (
      nodeId: string,
      selector: string | number,
      direction: "input" | "output"
    ): string | number => {
      if (typeof selector === "number") return selector;
      const requested = selector.toLocaleLowerCase();
      const node = before.nodes.find(
        (candidate) => candidate.id === nodeId || candidate.nativeId === nodeId
      );
      const runtimePort = (direction === "input" ? node?.inputs : node?.outputs)?.find(
        (port) => port.id === selector || port.name.toLocaleLowerCase() === requested
      );
      if (runtimePort) return runtimePort.index;
      const descriptor = temporaryTypes.get(nodeId);
      const catalogPorts = direction === "input" ? descriptor?.inputs : descriptor?.outputs;
      const catalogIndex = catalogPorts?.findIndex(
        (port) =>
          port.name.toLocaleLowerCase() === requested ||
          port.label.toLocaleLowerCase() === requested
      );
      return catalogIndex !== undefined && catalogIndex >= 0 ? catalogIndex : selector;
    };
    const nativeOperations = patch.operations.map((operation: GraphOperation) => {
      if (operation.type === "node.create") {
        const descriptor = this.catalog.get(operation.nodeTypeId);
        if (operation.tempId) temporaryTypes.set(operation.tempId, descriptor);
        return {
          ...operation,
          nodeTypeId: descriptor.nativeId,
          ...(operation.remoteControls
            ? {
                remoteControls: operation.remoteControls.map((control) => ({
                  ...control,
                  links: control.links.map((link) => ({
                    ...link,
                    nodeId: resolveNode(link.nodeId)
                  }))
                }))
              }
            : {}),
          ...(operation.parameters
            ? {
                parameters: Object.fromEntries(
                  Object.entries(operation.parameters).map(([name, value]) => [
                    name,
                    parameterValueToRaw(value)
                  ])
                )
              }
            : {})
        };
      }
      if (operation.type === "node.delete" || operation.type === "node.move") {
        return { ...operation, nodeId: resolveNode(operation.nodeId) };
      }
      if (operation.type === "node.rename") {
        return { ...operation, nodeId: resolveNode(operation.nodeId) };
      }
      if (operation.type === "node.set_parameter") {
        return {
          ...operation,
          nodeId: resolveNode(operation.nodeId),
          value: parameterValueToRaw(operation.value)
        };
      }
      if (operation.type === "connection.create") {
        return {
          ...operation,
          fromNodeId: resolveNode(operation.fromNodeId),
          fromPort: resolvePort(operation.fromNodeId, operation.fromPort, "output"),
          toNodeId: resolveNode(operation.toNodeId),
          toPort: resolvePort(operation.toNodeId, operation.toPort, "input")
        };
      }
      if (operation.type === "connection.delete") {
        const connection = before.connections.find(
          (candidate) => candidate.id === operation.connectionId
        );
        if (!connection) return operation;
        const source = before.nodes.find((node) => node.id === connection.fromNodeId);
        const target = before.nodes.find((node) => node.id === connection.toNodeId);
        const fromPort = source?.outputs.find((port) => port.id === connection.fromPortId);
        const toPort = target?.inputs.find((port) => port.id === connection.toPortId);
        return {
          ...operation,
          nativeConnection: {
            from: source?.nativeId,
            fromPort: fromPort?.index,
            to: target?.nativeId,
            toPort: toPort?.index
          }
        };
      }
      return {
        ...operation,
        nodeIds: operation.nodeIds.map(resolveNode),
        ...(operation.focusedNodeId === undefined
          ? {}
          : {
              focusedNodeId:
                operation.focusedNodeId === null ? null : resolveNode(operation.focusedNodeId)
            })
      };
    });
    const nativePatch = {
      ...patch,
      operations: nativeOperations
    };
    const response = (await this.#client.request(
      "graph.apply_patch",
      { patch: nativePatch },
      15_000
    )) as NativePatchResponse;
    const snapshot = ptexToSnapshot(response.serializedGraph, patch.projectId, {
      catalog: this.catalog,
      revision: response.revision
    });
    const profile = patch.validationPolicy === "none" ? "structural" : patch.validationPolicy;
    const validation = validateGraph(snapshot, profile, this.catalog);
    const warnings = validation.diagnostics.filter((entry) => entry.severity === "warning");
    const diff = diffGraphs(before, snapshot);
    const temporaryIds: Record<string, string> = {};
    for (const [tempId, value] of Object.entries(response.temporaryNativeIds ?? {})) {
      temporaryIds[tempId] =
        snapshot.nodes.find((node) => node.nativeId === value)?.id ??
        snapshot.connections.find((connection) => connection.id === value)?.id ??
        value;
    }
    for (const [tempId, value] of Object.entries(response.temporaryIds ?? {})) {
      if (temporaryIds[tempId]) continue;
      temporaryIds[tempId] =
        snapshot.nodes.find((node) => node.id === value || node.nativeId === value)?.id ??
        snapshot.connections.find((connection) => connection.id === value)?.id ??
        value;
    }
    const changedEntityIds = [
      ...new Set([
        ...diff.addedNodes,
        ...diff.removedNodes,
        ...diff.changedNodes,
        ...diff.addedConnections,
        ...diff.removedConnections
      ])
    ];
    return {
      status: response.status,
      dryRun: response.status === "planned",
      revision: response.revision,
      snapshot,
      validation,
      transaction: null,
      temporaryIds,
      changedEntityIds,
      warnings,
      diff
    };
  }

  #normalizeProject(value: Record<string, unknown>): Project {
    return {
      id: String(value.id),
      type: value.type === "painting" ? "painting" : "material",
      name: String(value.name ?? "Untitled"),
      path: typeof value.path === "string" && value.path.length > 0 ? value.path : null,
      revision: Number(value.revision ?? 0),
      dirty: value.dirty === true,
      active: value.active === true,
      graphIds: [],
      compatibility: { materialMakerVersion: this.#manifest.materialMakerVersion }
    };
  }
}

function componentCount(snapshot: GraphSnapshot): number {
  if (snapshot.nodes.length === 0) return 0;
  const adjacency = new Map(snapshot.nodes.map((node) => [node.id, new Set<string>()]));
  for (const connection of snapshot.connections) {
    adjacency.get(connection.fromNodeId)?.add(connection.toNodeId);
    adjacency.get(connection.toNodeId)?.add(connection.fromNodeId);
  }
  const seen = new Set<string>();
  let count = 0;
  for (const node of snapshot.nodes) {
    if (seen.has(node.id)) continue;
    count += 1;
    const pending = [node.id];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      pending.push(...(adjacency.get(id) ?? []));
    }
  }
  return count;
}

export class InMemoryBackend implements MaterialBackend {
  readonly engine: GraphEngine;
  readonly permissionMode: PermissionMode;
  readonly #projectCreations = new Map<string, { name: string; project: Project }>();
  readonly #namedSnapshots = new Map<string, NamedSnapshot[]>();

  constructor(options: { engine?: GraphEngine; permissionMode?: PermissionMode } = {}) {
    this.engine = options.engine ?? new GraphEngine();
    this.permissionMode = options.permissionMode ?? "assisted";
  }

  get catalog(): NodeCatalog {
    return this.engine.catalog;
  }

  status(): AppStatus {
    const active = this.engine.activeProject();
    return {
      running: true,
      bridgeConnected: false,
      offlineMode: true,
      materialMakerVersion: null,
      godotVersion: null,
      bridgeVersion: "0.1.0-reference",
      activeProjectId: active?.id ?? null,
      connectedProjectCount: this.engine.listProjects().length,
      permissionMode: this.permissionMode
    };
  }

  capabilities(): CapabilityManifest {
    return {
      protocolVersion: "1.0",
      bridgeVersion: "0.1.0-reference",
      materialMakerVersion: "offline",
      godotVersion: "offline",
      projectTypes: ["material"],
      features: {
        "application.read": true,
        "project.read": true,
        "project.create": true,
        "graph.read": true,
        "graph.write": true,
        "graph.transactions": true,
        "catalog.read": true,
        "preview.capture": false,
        "export.write": false,
        "painting.read": false,
        "painting.stroke": false,
        "customNode.write": false
      },
      limits: {
        maxPatchOperations: 500,
        maxPayloadBytes: 8 * 1024 * 1024,
        maxConcurrentJobs: 2,
        maxPreviewResolution: 4096
      }
    };
  }

  listProjects() {
    return this.engine.listProjects();
  }
  activeProject() {
    return this.engine.activeProject();
  }
  createMaterialProject(name: string, idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = this.#projectCreations.get(idempotencyKey);
      if (existing) {
        if (existing.name !== name) {
          throw new MaterialPilotError(
            "INVALID_REQUEST",
            "Project creation idempotency key was reused with different arguments."
          );
        }
        return structuredClone(existing.project);
      }
    }
    const project = this.engine.createMaterialProject(name);
    if (idempotencyKey) this.#projectCreations.set(idempotencyKey, { name, project });
    return project;
  }
  saveProject(): Project {
    throw new MaterialPilotError(
      "CAPABILITY_NOT_AVAILABLE",
      "Project save requires the native Material Maker bridge."
    );
  }
  getSnapshot(projectId: string) {
    return this.engine.getSnapshot(projectId);
  }
  getSummary(projectId: string) {
    return this.engine.getSummary(projectId);
  }
  validate(projectId: string, profile: "structural" | "standard" | "strict" | "release") {
    return this.engine.validate(projectId, profile);
  }
  planPatch(patch: GraphPatch) {
    return this.engine.planPatch(patch);
  }
  applyPatch(patch: GraphPatch) {
    return this.engine.applyPatch(patch);
  }
  undo(projectId: string, expectedRevision: number) {
    return this.engine.undo(projectId, expectedRevision);
  }
  redo(projectId: string, expectedRevision: number) {
    return this.engine.redo(projectId, expectedRevision);
  }
  renderNodePreview(): PreviewImage {
    throw new MaterialPilotError(
      "CAPABILITY_NOT_AVAILABLE",
      "Node-output preview requires the native Material Maker bridge."
    );
  }
  renderMaterialPreview(): MaterialPreviewImage {
    throw new MaterialPilotError(
      "CAPABILITY_NOT_AVAILABLE",
      "3D material preview requires the native Material Maker bridge."
    );
  }
  createNamedSnapshot(projectId: string, name: string): NamedSnapshot {
    const snapshot = this.engine.getSnapshot(projectId);
    const record: NamedSnapshot = {
      id: `mmsn_${randomUUID().replaceAll("-", "")}`,
      name,
      projectId,
      revision: snapshot.revision,
      hash: snapshot.hash,
      createdAt: new Date().toISOString(),
      snapshot: structuredClone(snapshot)
    };
    const records = this.#namedSnapshots.get(projectId) ?? [];
    if (records.some((candidate) => candidate.name === name)) {
      throw new MaterialPilotError("INVALID_REQUEST", `Snapshot name already exists: ${name}`);
    }
    records.push(record);
    this.#namedSnapshots.set(projectId, records);
    return structuredClone(record);
  }
  listNamedSnapshots(projectId: string): NamedSnapshot[] {
    return structuredClone(this.#namedSnapshots.get(projectId) ?? []);
  }
  exportBlender(): ExportArtifact[] {
    throw new MaterialPilotError(
      "CAPABILITY_NOT_AVAILABLE",
      "Blender export requires the native Material Maker bridge."
    );
  }
  listTransactions(projectId: string) {
    return this.engine.listTransactions(projectId);
  }
  searchCatalog(filter: CatalogSearch) {
    return this.catalog.search(filter);
  }
}
