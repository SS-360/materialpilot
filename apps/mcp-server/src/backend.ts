import {
  MaterialPilotError,
  type CapabilityManifest,
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
import { ptexToSnapshot, type RawPtexProject } from "@materialpilot/ptex";
import { validateGraph } from "@materialpilot/validator";

export type Awaitable<T> = T | Promise<T>;

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

export type MaterialBackend = {
  readonly catalog: NodeCatalog;
  readonly permissionMode: PermissionMode;
  status(): Awaitable<AppStatus>;
  capabilities(): Awaitable<CapabilityManifest>;
  listProjects(): Awaitable<Project[]>;
  activeProject(): Awaitable<Project | null>;
  createMaterialProject(name: string): Awaitable<Project>;
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
  changedEntityIds?: string[];
  serializedGraph: RawPtexProject;
};

export class NativeBackend implements MaterialBackend {
  readonly catalog = new NodeCatalog();
  readonly permissionMode: PermissionMode;
  readonly #client: BridgeClient;
  readonly #manifest: BridgeInitializeResult;

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

  createMaterialProject(): Project {
    throw new MaterialPilotError(
      "CAPABILITY_NOT_AVAILABLE",
      "The native bridge does not yet expose project creation."
    );
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

  listTransactions(): Transaction[] {
    return [];
  }

  searchCatalog(filter: CatalogSearch): NodeTypeDescriptor[] {
    return this.catalog.search(filter);
  }

  async #patch(patch: GraphPatch): Promise<PatchResult> {
    const before = await this.getSnapshot(patch.projectId);
    const nativePatch: GraphPatch = {
      ...patch,
      operations: patch.operations.map((operation) =>
        operation.type === "node.create"
          ? { ...operation, nodeTypeId: this.catalog.get(operation.nodeTypeId).nativeId }
          : operation
      )
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
    return {
      status: response.status,
      dryRun: response.status === "planned",
      revision: response.revision,
      snapshot,
      validation,
      transaction: null,
      temporaryIds: response.temporaryIds ?? {},
      changedEntityIds: response.changedEntityIds ?? [],
      warnings,
      diff: diffGraphs(before, snapshot)
    };
  }

  #normalizeProject(value: Record<string, unknown>): Project {
    return {
      id: String(value.id),
      type: value.type === "painting" ? "painting" : "material",
      name: String(value.name ?? "Untitled"),
      path: typeof value.path === "string" ? value.path : null,
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
  createMaterialProject(name: string) {
    return this.engine.createMaterialProject(name);
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
  listTransactions(projectId: string) {
    return this.engine.listTransactions(projectId);
  }
  searchCatalog(filter: CatalogSearch) {
    return this.catalog.search(filter);
  }
}
