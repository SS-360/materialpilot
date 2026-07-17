import { randomUUID } from "node:crypto";

export const entityPrefixes = {
  artifact: "mma",
  connection: "mmc",
  diagnostic: "mmd",
  graph: "mmg",
  instance: "mmi",
  job: "mmj",
  node: "mmn",
  paintLayer: "mml",
  port: "mmp",
  project: "mmpr",
  request: "mmrq",
  session: "mms",
  snapshot: "mmsn",
  transaction: "mmtx"
} as const;

export type EntityKind = keyof typeof entityPrefixes;

export function createEntityId(kind: EntityKind): string {
  return `${entityPrefixes[kind]}_${randomUUID().replaceAll("-", "")}`;
}

export function isEntityId(value: string, kind?: EntityKind): boolean {
  const allowed = kind ? [entityPrefixes[kind]] : Object.values(entityPrefixes);
  return allowed.some((prefix) => new RegExp(`^${prefix}_[0-9a-f]{32}$`, "i").test(value));
}

export function stableNativeId(kind: EntityKind, projectId: string, nativeId: string): string {
  const bytes = new TextEncoder().encode(`${projectId}\u0000${nativeId}`);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${entityPrefixes[kind]}_native_${hash.toString(16).padStart(8, "0")}`;
}
