import { canonicalHash } from "./canonical.js";
import type { GraphSnapshot } from "./schemas.js";

export function withSnapshotHash(snapshot: Omit<GraphSnapshot, "hash">): GraphSnapshot {
  return { ...snapshot, hash: canonicalHash(snapshot) };
}

export function verifySnapshotHash(snapshot: GraphSnapshot): boolean {
  const content = Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== "hash"));
  return canonicalHash(content) === snapshot.hash;
}
