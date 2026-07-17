import {
  MaterialPilotError,
  createEntityId,
  withSnapshotHash,
  type GraphSnapshot,
  type Project,
  type Transaction
} from "@materialpilot/domain";

export type HistoryEntry = {
  transaction: Transaction;
  before: GraphSnapshot;
  after: GraphSnapshot;
};

export type ProjectRecord = {
  project: Project;
  snapshot: GraphSnapshot;
  history: HistoryEntry[];
  redo: HistoryEntry[];
  idempotency: Map<string, { requestHash: string; result: unknown }>;
};

export class InMemoryProjectRepository {
  readonly #projects = new Map<string, ProjectRecord>();
  #activeProjectId: string | null = null;

  create(project: Project, snapshot: GraphSnapshot): ProjectRecord {
    if (this.#projects.has(project.id)) {
      throw new MaterialPilotError("INVALID_REQUEST", `Project ${project.id} already exists.`);
    }
    const record: ProjectRecord = {
      project: structuredClone(project),
      snapshot: structuredClone(snapshot),
      history: [],
      redo: [],
      idempotency: new Map()
    };
    this.#projects.set(project.id, record);
    this.activate(project.id);
    return record;
  }

  list(): Project[] {
    return [...this.#projects.values()].map((record) => structuredClone(record.project));
  }

  active(): ProjectRecord | null {
    return this.#activeProjectId ? this.get(this.#activeProjectId) : null;
  }

  activate(projectId: string): ProjectRecord {
    const target = this.get(projectId);
    for (const record of this.#projects.values()) record.project.active = false;
    target.project.active = true;
    this.#activeProjectId = projectId;
    return target;
  }

  get(projectId: string): ProjectRecord {
    const record = this.#projects.get(projectId);
    if (!record) {
      throw new MaterialPilotError("PROJECT_NOT_FOUND", `Project ${projectId} was not found.`, {
        entityIds: [projectId]
      });
    }
    return record;
  }

  close(projectId: string): void {
    const record = this.get(projectId);
    if (record.project.dirty) {
      throw new MaterialPilotError(
        "PROJECT_DIRTY_CONFLICT",
        `Project ${projectId} has unsaved changes.`
      );
    }
    this.#projects.delete(projectId);
    if (this.#activeProjectId === projectId) {
      this.#activeProjectId = this.#projects.keys().next().value ?? null;
      if (this.#activeProjectId) this.activate(this.#activeProjectId);
    }
  }

  static emptySnapshot(projectId: string, name: string, catalogVersion: string): GraphSnapshot {
    return withSnapshotHash({
      projectId,
      revision: 0,
      graphId: createEntityId("graph"),
      name,
      nodes: [],
      connections: [],
      selection: { nodeIds: [], focusedNodeId: null },
      outputNodeIds: [],
      unresolvedReferences: [],
      catalogVersion
    });
  }
}
