# Codex contribution log

## 2026-07-17 — initial implementation

- Task: implement the production blueprint from an empty workspace.
- Upstream: mapped Material Maker tag `1.7` locally.
- Work: monorepo, stable domain schemas, catalog, validator, transaction engine, PTEX/MMPP adapters, path and permission policy, bridge protocol, native addon, MCP server, CLI, fixtures, CI, and documentation.
- Verification: package builds, TypeScript checks, ESLint, Vitest, MCP linked-transport integration, native-addon safety markers, real Godot 4.7 parse/handshake/status contracts, and a full headless Material Maker 1.7 multi-node commit/rollback/undo/redo contract. The original 4.5.1 assumption was corrected after the Material Maker 1.7 checkout declared Godot 4.7.
- Human changes: none recorded.
- Deferred by honest capability gating: rendered preview, engine export, custom shader write, community network operations, and painting mutation/strokes.
