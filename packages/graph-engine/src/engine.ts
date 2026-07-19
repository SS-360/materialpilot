import { EventEmitter } from "node:events";
import {
  MaterialPilotError,
  canonicalHash,
  createEntityId,
  graphPatchSchema,
  withSnapshotHash,
  type Diagnostic,
  type GraphNode,
  type GraphOperation,
  type GraphPatch,
  type GraphSnapshot,
  type ParameterValue,
  type Port,
  type Project,
  type Transaction,
  type ValidationReport
} from "@materialpilot/domain";
import { NodeCatalog, isPortCompatible, validateParameterValue } from "@materialpilot/node-catalog";
import { validateGraph, type RunnableValidationProfile } from "@materialpilot/validator";
import { InMemoryProjectRepository, type HistoryEntry, type ProjectRecord } from "./repository.js";

export type PatchResult = {
  status: "planned" | "committed" | "replayed";
  dryRun: boolean;
  revision: number;
  snapshot: GraphSnapshot;
  validation: ValidationReport;
  transaction: Transaction | null;
  temporaryIds: Record<string, string>;
  changedEntityIds: string[];
  warnings: Diagnostic[];
  diff: GraphDiff;
};

export type GraphDiff = {
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: string[];
  addedConnections: string[];
  removedConnections: string[];
};

export type GraphSummary = {
  projectId: string;
  revision: number;
  nodeCount: number;
  connectionCount: number;
  outputNodeIds: string[];
  selectedNodeIds: string[];
  disconnectedComponents: number;
  estimatedComplexity: number;
  warnings: number;
};

type MutableContext = {
  snapshot: GraphSnapshot;
  temporaryIds: Map<string, string>;
  changedEntityIds: Set<string>;
  nativeNames: Set<string>;
};

export class GraphEngine extends EventEmitter {
  readonly catalog: NodeCatalog;
  readonly repository: InMemoryProjectRepository;

  constructor(options: { catalog?: NodeCatalog; repository?: InMemoryProjectRepository } = {}) {
    super();
    this.catalog = options.catalog ?? new NodeCatalog();
    this.repository = options.repository ?? new InMemoryProjectRepository();
  }

  createMaterialProject(name: string): Project {
    const id = createEntityId("project");
    const snapshot = InMemoryProjectRepository.emptySnapshot(id, name, this.catalog.version);
    const output = this.#instantiateNode(
      "mm.output.material",
      { x: 640, y: 160 },
      "Material",
      snapshot.nodes
    );
    snapshot.nodes.push(output);
    snapshot.outputNodeIds = [output.id];
    const completeSnapshot = this.#rehash(snapshot);
    const now = new Date().toISOString();
    const project: Project = {
      id,
      type: "material",
      name,
      path: null,
      revision: 0,
      dirty: false,
      active: true,
      graphIds: [snapshot.graphId],
      createdAt: now,
      modifiedAt: now,
      compatibility: { materialMakerVersion: "1.7", schemaVersion: "1" }
    };
    this.repository.create(project, completeSnapshot);
    this.emit("project.opened", structuredClone(project));
    return structuredClone(project);
  }

  listProjects(): Project[] {
    return this.repository.list();
  }

  activeProject(): Project | null {
    const active = this.repository.active();
    return active ? structuredClone(active.project) : null;
  }

  activateProject(projectId: string): Project {
    const record = this.repository.activate(projectId);
    this.emit("project.activated", structuredClone(record.project));
    return structuredClone(record.project);
  }

  getSnapshot(projectId: string): GraphSnapshot {
    return structuredClone(this.repository.get(projectId).snapshot);
  }

  getSummary(projectId: string): GraphSummary {
    const snapshot = this.repository.get(projectId).snapshot;
    const report = validateGraph(snapshot, "standard", this.catalog);
    const components = this.#componentCount(snapshot);
    return {
      projectId,
      revision: snapshot.revision,
      nodeCount: snapshot.nodes.length,
      connectionCount: snapshot.connections.length,
      outputNodeIds: [...snapshot.outputNodeIds],
      selectedNodeIds: [...snapshot.selection.nodeIds],
      disconnectedComponents: components,
      estimatedComplexity: snapshot.nodes.length + snapshot.connections.length * 0.5,
      warnings: report.diagnostics.filter((entry) => entry.severity === "warning").length
    };
  }

  validate(projectId: string, profile: RunnableValidationProfile = "standard"): ValidationReport {
    return validateGraph(this.repository.get(projectId).snapshot, profile, this.catalog);
  }

  planPatch(input: unknown): PatchResult {
    const patch = graphPatchSchema.parse(input);
    return this.#executePatch({ ...patch, dryRun: true });
  }

  applyPatch(input: unknown): PatchResult {
    const patch = graphPatchSchema.parse(input);
    return this.#executePatch(patch);
  }

  listTransactions(projectId: string): Transaction[] {
    return this.repository
      .get(projectId)
      .history.map((entry) => structuredClone(entry.transaction))
      .toReversed();
  }

  getTransaction(projectId: string, transactionId: string): Transaction {
    const entry = this.repository
      .get(projectId)
      .history.find((candidate) => candidate.transaction.id === transactionId);
    if (!entry)
      throw new MaterialPilotError(
        "INVALID_REQUEST",
        `Transaction ${transactionId} was not found.`
      );
    return structuredClone(entry.transaction);
  }

  undo(projectId: string, expectedRevision: number): GraphSnapshot {
    const record = this.repository.get(projectId);
    this.#checkRevision(record, expectedRevision);
    const entry = record.history.pop();
    if (!entry)
      throw new MaterialPilotError(
        "INVALID_REQUEST",
        "There is no MaterialPilot transaction to undo."
      );
    record.redo.push(entry);
    record.snapshot = this.#restoreAtNextRevision(entry.before, expectedRevision + 1);
    this.#syncProject(record);
    this.emit("graph.changed", { projectId, revision: record.snapshot.revision, reason: "undo" });
    return structuredClone(record.snapshot);
  }

  redo(projectId: string, expectedRevision: number): GraphSnapshot {
    const record = this.repository.get(projectId);
    this.#checkRevision(record, expectedRevision);
    const entry = record.redo.pop();
    if (!entry)
      throw new MaterialPilotError(
        "INVALID_REQUEST",
        "There is no MaterialPilot transaction to redo."
      );
    record.history.push(entry);
    record.snapshot = this.#restoreAtNextRevision(entry.after, expectedRevision + 1);
    this.#syncProject(record);
    this.emit("graph.changed", { projectId, revision: record.snapshot.revision, reason: "redo" });
    return structuredClone(record.snapshot);
  }

  rollbackTransaction(
    projectId: string,
    transactionId: string,
    expectedRevision: number
  ): GraphSnapshot {
    const record = this.repository.get(projectId);
    this.#checkRevision(record, expectedRevision);
    const index = record.history.findIndex((entry) => entry.transaction.id === transactionId);
    if (index < 0)
      throw new MaterialPilotError(
        "INVALID_REQUEST",
        `Transaction ${transactionId} was not found.`
      );
    if (index !== record.history.length - 1) {
      throw new MaterialPilotError(
        "INVALID_REQUEST",
        "Only the latest transaction can be rolled back safely."
      );
    }
    const [entry] = record.history.splice(index, 1);
    record.snapshot = this.#restoreAtNextRevision(entry!.before, expectedRevision + 1);
    record.redo = [];
    this.#syncProject(record);
    this.emit("transaction.rolled_back", {
      projectId,
      transactionId,
      revision: record.snapshot.revision
    });
    return structuredClone(record.snapshot);
  }

  #executePatch(patch: GraphPatch): PatchResult {
    const started = performance.now();
    const record = this.repository.get(patch.projectId);
    const requestHash = canonicalHash(patch);
    if (!patch.dryRun) {
      const previous = record.idempotency.get(patch.idempotencyKey);
      if (previous) {
        if (previous.requestHash !== requestHash) {
          throw new MaterialPilotError(
            "INVALID_REQUEST",
            "The idempotency key was already used with different arguments."
          );
        }
        return { ...(structuredClone(previous.result) as PatchResult), status: "replayed" };
      }
    }
    this.#checkRevision(record, patch.expectedRevision);
    const before = structuredClone(record.snapshot);
    const context: MutableContext = {
      snapshot: structuredClone(record.snapshot),
      temporaryIds: new Map(),
      changedEntityIds: new Set(),
      nativeNames: new Set(record.snapshot.nodes.map((node) => node.nativeId))
    };

    try {
      for (const operation of patch.operations) this.#applyOperation(context, operation);
      this.#refreshDerivedState(context.snapshot);
      context.snapshot.revision = patch.dryRun
        ? record.snapshot.revision
        : record.snapshot.revision + 1;
      context.snapshot = this.#rehash(context.snapshot);
      const profile = patch.validationPolicy === "none" ? "structural" : patch.validationPolicy;
      const validation = validateGraph(context.snapshot, profile, this.catalog);
      const failures = validation.diagnostics.filter(
        (entry) => entry.severity === "error" || entry.severity === "fatal"
      );
      if (failures.length > 0) {
        throw new MaterialPilotError(
          "TRANSACTION_FAILED",
          "Patch failed post-transaction validation.",
          {
            entityIds: failures.flatMap((entry) => (entry.entity ? [entry.entity.id] : [])),
            repairSuggestion: failures.map((entry) => entry.message).join(" ")
          }
        );
      }
      const warnings = validation.diagnostics.filter((entry) => entry.severity === "warning");
      const rollbackCodes = new Set(patch.rollbackOnWarningCodes ?? []);
      const matchedWarning = warnings.find((entry) => rollbackCodes.has(entry.code));
      if (matchedWarning) {
        throw new MaterialPilotError(
          "TRANSACTION_FAILED",
          `Patch rolled back because warning ${matchedWarning.code} matched rollback policy.`
        );
      }

      const diff = diffGraphs(before, context.snapshot);
      let transaction: Transaction | null = null;
      let status: PatchResult["status"] = "planned";
      if (!patch.dryRun) {
        transaction = {
          id: createEntityId("transaction"),
          label: patch.label,
          actor: { type: "mcp-agent", sessionId: "local" },
          timestamp: new Date().toISOString(),
          preRevision: before.revision,
          postRevision: context.snapshot.revision,
          operations: structuredClone(patch.operations),
          warnings,
          snapshotId: createEntityId("snapshot"),
          changedEntityIds: [...context.changedEntityIds],
          durationMs: performance.now() - started,
          state: "committed"
        };
        const history: HistoryEntry = {
          transaction,
          before,
          after: structuredClone(context.snapshot)
        };
        record.snapshot = structuredClone(context.snapshot);
        record.history.push(history);
        record.redo = [];
        this.#syncProject(record);
        status = "committed";
      }
      const result: PatchResult = {
        status,
        dryRun: patch.dryRun,
        revision: context.snapshot.revision,
        snapshot: structuredClone(context.snapshot),
        validation,
        transaction,
        temporaryIds: Object.fromEntries(context.temporaryIds),
        changedEntityIds: [...context.changedEntityIds],
        warnings,
        diff
      };
      if (!patch.dryRun) {
        record.idempotency.set(patch.idempotencyKey, {
          requestHash,
          result: structuredClone(result)
        });
        this.emit("transaction.committed", structuredClone(transaction));
        this.emit("graph.changed", {
          projectId: patch.projectId,
          revision: record.snapshot.revision,
          changedEntityIds: result.changedEntityIds
        });
      }
      return result;
    } catch (error) {
      if (error instanceof MaterialPilotError) throw error;
      throw new MaterialPilotError("TRANSACTION_FAILED", "Patch failed and was rolled back.", {
        cause: error
      });
    }
  }

  #applyOperation(context: MutableContext, operation: GraphOperation): void {
    switch (operation.type) {
      case "node.create": {
        const node = this.#instantiateNode(
          operation.nodeTypeId,
          operation.position,
          operation.displayName,
          context.snapshot.nodes,
          operation.parameters
        );
        context.snapshot.nodes.push(node);
        if (operation.comment) node.metadata.comment = structuredClone(operation.comment);
        if (operation.remoteControls)
          node.metadata.remoteControls = structuredClone(operation.remoteControls);
        context.nativeNames.add(node.nativeId);
        context.changedEntityIds.add(node.id);
        if (operation.tempId) context.temporaryIds.set(operation.tempId, node.id);
        break;
      }
      case "node.delete": {
        const nodeId = this.#resolveId(context, operation.nodeId);
        this.#requireNode(context.snapshot, nodeId);
        const connections = context.snapshot.connections.filter(
          (connection) => connection.fromNodeId === nodeId || connection.toNodeId === nodeId
        );
        if (connections.length > 0 && operation.cascade === "reject") {
          throw new MaterialPilotError(
            "INVALID_REQUEST",
            `Node ${nodeId} is connected; use cascade=disconnect.`,
            {
              entityIds: [nodeId]
            }
          );
        }
        context.snapshot.connections = context.snapshot.connections.filter(
          (connection) => connection.fromNodeId !== nodeId && connection.toNodeId !== nodeId
        );
        context.snapshot.nodes = context.snapshot.nodes.filter((node) => node.id !== nodeId);
        context.snapshot.selection.nodeIds = context.snapshot.selection.nodeIds.filter(
          (id) => id !== nodeId
        );
        if (context.snapshot.selection.focusedNodeId === nodeId)
          context.snapshot.selection.focusedNodeId = null;
        context.changedEntityIds.add(nodeId);
        for (const connection of connections) context.changedEntityIds.add(connection.id);
        break;
      }
      case "node.move": {
        const node = this.#requireNode(
          context.snapshot,
          this.#resolveId(context, operation.nodeId)
        );
        node.position = structuredClone(operation.position);
        context.changedEntityIds.add(node.id);
        break;
      }
      case "node.rename": {
        const node = this.#requireNode(
          context.snapshot,
          this.#resolveId(context, operation.nodeId)
        );
        node.displayName = operation.displayName;
        context.changedEntityIds.add(node.id);
        break;
      }
      case "node.set_parameter": {
        const node = this.#requireNode(
          context.snapshot,
          this.#resolveId(context, operation.nodeId)
        );
        const descriptor = this.catalog
          .get(node.typeId)
          .parameters.find((parameter) => parameter.name === operation.parameter);
        if (!descriptor) {
          throw new MaterialPilotError(
            "PARAMETER_NOT_FOUND",
            `Parameter ${operation.parameter} does not exist on ${node.typeId}.`,
            { entityIds: [node.id] }
          );
        }
        const issues = validateParameterValue(descriptor, operation.value);
        if (issues.length > 0) {
          throw new MaterialPilotError("PARAMETER_OUT_OF_RANGE", issues.join("; "), {
            entityIds: [node.id]
          });
        }
        node.parameters[operation.parameter] = structuredClone(operation.value);
        context.changedEntityIds.add(node.id);
        break;
      }
      case "connection.create": {
        const fromNode = this.#requireNode(
          context.snapshot,
          this.#resolveId(context, operation.fromNodeId)
        );
        const toNode = this.#requireNode(
          context.snapshot,
          this.#resolveId(context, operation.toNodeId)
        );
        const fromPort = this.#resolvePort(fromNode.outputs, operation.fromPort, "output");
        const toPort = this.#resolvePort(toNode.inputs, operation.toPort, "input");
        if (!isPortCompatible(fromPort.dataType, toPort.dataType)) {
          throw new MaterialPilotError(
            "PORT_TYPE_MISMATCH",
            `Cannot connect ${fromPort.dataType} to ${toPort.dataType}.`,
            { entityIds: [fromPort.id, toPort.id] }
          );
        }
        const duplicate = context.snapshot.connections.find(
          (connection) => connection.fromPortId === fromPort.id && connection.toPortId === toPort.id
        );
        if (duplicate) {
          throw new MaterialPilotError(
            "CONNECTION_ALREADY_EXISTS",
            "The requested connection already exists.",
            {
              entityIds: [duplicate.id]
            }
          );
        }
        const occupied = context.snapshot.connections.find(
          (connection) => connection.toPortId === toPort.id
        );
        if (occupied && !toPort.variadic) {
          throw new MaterialPilotError(
            "INVALID_REQUEST",
            `Input ${toPort.name} already has a connection.`,
            {
              entityIds: [occupied.id, toPort.id]
            }
          );
        }
        const connection = {
          id: createEntityId("connection"),
          fromNodeId: fromNode.id,
          fromPortId: fromPort.id,
          toNodeId: toNode.id,
          toPortId: toPort.id,
          metadata: {}
        };
        context.snapshot.connections.push(connection);
        context.changedEntityIds.add(connection.id);
        context.changedEntityIds.add(fromNode.id);
        context.changedEntityIds.add(toNode.id);
        if (operation.tempId) context.temporaryIds.set(operation.tempId, connection.id);
        break;
      }
      case "connection.delete": {
        const connectionId = this.#resolveId(context, operation.connectionId);
        const index = context.snapshot.connections.findIndex(
          (connection) => connection.id === connectionId
        );
        if (index < 0) {
          throw new MaterialPilotError(
            "INVALID_REQUEST",
            `Connection ${connectionId} was not found.`
          );
        }
        const [connection] = context.snapshot.connections.splice(index, 1);
        context.changedEntityIds.add(connectionId);
        context.changedEntityIds.add(connection!.fromNodeId);
        context.changedEntityIds.add(connection!.toNodeId);
        break;
      }
      case "selection.set": {
        const nodeIds = operation.nodeIds.map((id) => this.#resolveId(context, id));
        for (const nodeId of nodeIds) this.#requireNode(context.snapshot, nodeId);
        const focusedNodeId = operation.focusedNodeId
          ? this.#resolveId(context, operation.focusedNodeId)
          : operation.focusedNodeId === null
            ? null
            : (nodeIds[0] ?? null);
        if (focusedNodeId) this.#requireNode(context.snapshot, focusedNodeId);
        context.snapshot.selection = { nodeIds: [...new Set(nodeIds)], focusedNodeId };
        break;
      }
    }
  }

  #instantiateNode(
    typeId: string,
    position: { x: number; y: number },
    displayName: string | undefined,
    existingNodes: readonly GraphNode[],
    initialParameters: Record<string, ParameterValue> = {}
  ): GraphNode {
    const descriptor = this.catalog.get(typeId);
    const nodeId = createEntityId("node");
    const usedNativeNames = new Set(existingNodes.map((node) => node.nativeId));
    let suffix = 0;
    let nativeId = descriptor.nativeId;
    while (usedNativeNames.has(nativeId)) nativeId = `${descriptor.nativeId}_${suffix++}`;
    const parameters = Object.fromEntries(
      descriptor.parameters.map((parameter) => [parameter.name, structuredClone(parameter.default)])
    );
    for (const [name, value] of Object.entries(initialParameters)) {
      const parameter = descriptor.parameters.find((candidate) => candidate.name === name);
      if (!parameter && descriptor.typeId === "mm.workflow.remote-controls") {
        parameters[name] = structuredClone(value);
        continue;
      }
      if (!parameter)
        throw new MaterialPilotError(
          "PARAMETER_NOT_FOUND",
          `Unknown parameter ${name} for ${typeId}.`
        );
      const issues = validateParameterValue(parameter, value);
      if (issues.length > 0)
        throw new MaterialPilotError("PARAMETER_OUT_OF_RANGE", `${name}: ${issues.join("; ")}`);
      parameters[name] = structuredClone(value);
    }
    const makePorts = (direction: Port["direction"]): Port[] => {
      const descriptors = direction === "input" ? descriptor.inputs : descriptor.outputs;
      return descriptors.map((port, index) => ({
        id: createEntityId("port"),
        nodeId,
        direction,
        index,
        name: port.name,
        dataType: port.dataType,
        required: port.required,
        ...(port.variadic === undefined ? {} : { variadic: port.variadic }),
        connected: false
      }));
    };
    return {
      id: nodeId,
      nativeId,
      typeId: descriptor.typeId,
      displayName: displayName ?? descriptor.displayName,
      position: structuredClone(position),
      minimized: false,
      inputs: makePorts("input"),
      outputs: makePorts("output"),
      parameters,
      metadata: { catalogNativeId: descriptor.nativeId }
    };
  }

  #resolveId(context: MutableContext, id: string): string {
    return context.temporaryIds.get(id) ?? id;
  }

  #requireNode(snapshot: GraphSnapshot, nodeId: string): GraphNode {
    const node = snapshot.nodes.find((candidate) => candidate.id === nodeId);
    if (!node)
      throw new MaterialPilotError("NODE_NOT_FOUND", `Node ${nodeId} was not found.`, {
        entityIds: [nodeId]
      });
    return node;
  }

  #resolvePort(
    ports: readonly Port[],
    selector: string | number,
    direction: Port["direction"]
  ): Port {
    const port =
      typeof selector === "number"
        ? ports.find((candidate) => candidate.index === selector)
        : ports.find((candidate) => candidate.id === selector || candidate.name === selector);
    if (!port)
      throw new MaterialPilotError(
        "PORT_NOT_FOUND",
        `${direction} port ${String(selector)} was not found.`
      );
    return port;
  }

  #refreshDerivedState(snapshot: GraphSnapshot): void {
    const connectedPortIds = new Set(
      snapshot.connections.flatMap((connection) => [connection.fromPortId, connection.toPortId])
    );
    for (const node of snapshot.nodes) {
      for (const port of [...node.inputs, ...node.outputs])
        port.connected = connectedPortIds.has(port.id);
    }
    snapshot.outputNodeIds = snapshot.nodes
      .filter((node) => node.typeId === "mm.output.material")
      .map((node) => node.id);
  }

  #rehash(snapshot: GraphSnapshot): GraphSnapshot {
    const content = Object.fromEntries(
      Object.entries(snapshot).filter(([key]) => key !== "hash")
    ) as Omit<GraphSnapshot, "hash">;
    return withSnapshotHash(content);
  }

  #restoreAtNextRevision(snapshot: GraphSnapshot, revision: number): GraphSnapshot {
    const clone = structuredClone(snapshot);
    clone.revision = revision;
    return this.#rehash(clone);
  }

  #checkRevision(record: ProjectRecord, expectedRevision: number): void {
    if (record.snapshot.revision !== expectedRevision) {
      throw new MaterialPilotError(
        "REVISION_CONFLICT",
        `Expected revision ${expectedRevision}, but the project is at revision ${record.snapshot.revision}.`,
        {
          retryable: true,
          entityIds: [record.project.id],
          repairSuggestion: "Read the latest graph and rebase the patch."
        }
      );
    }
  }

  #syncProject(record: ProjectRecord): void {
    record.project.revision = record.snapshot.revision;
    record.project.dirty = true;
    record.project.modifiedAt = new Date().toISOString();
  }

  #componentCount(snapshot: GraphSnapshot): number {
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
}

export function diffGraphs(before: GraphSnapshot, after: GraphSnapshot): GraphDiff {
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, canonicalHash(node)]));
  const afterNodes = new Map(after.nodes.map((node) => [node.id, canonicalHash(node)]));
  const beforeConnections = new Set(before.connections.map((connection) => connection.id));
  const afterConnections = new Set(after.connections.map((connection) => connection.id));
  return {
    addedNodes: [...afterNodes.keys()].filter((id) => !beforeNodes.has(id)),
    removedNodes: [...beforeNodes.keys()].filter((id) => !afterNodes.has(id)),
    changedNodes: [...afterNodes.keys()].filter(
      (id) => beforeNodes.has(id) && beforeNodes.get(id) !== afterNodes.get(id)
    ),
    addedConnections: [...afterConnections].filter((id) => !beforeConnections.has(id)),
    removedConnections: [...beforeConnections].filter((id) => !afterConnections.has(id))
  };
}
