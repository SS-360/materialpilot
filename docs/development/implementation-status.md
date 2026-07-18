# Implementation status

MaterialPilot 0.1.0 is a tested implementation preview, not the stable 1.0 described by the long-range production plan. Unsupported surfaces are omitted or capability-gated instead of being simulated.

## Delivered

- TypeScript monorepo with stable schemas, identifiers, canonical hashing, PTEX/MMPP adapters, a node catalog, deterministic validation, security policy, and an atomic graph engine.
- MCP server over STDIO and authenticated loopback HTTP with 138 schema-defined tools spanning application, project, graph, catalog, node, connection, transaction, layout, PBR, preview, diagnostics, performance, and material workflows, plus resources and prompts.
- Authenticated loopback WebSocket bridge for Material Maker, multi-project discovery, idempotent and rollback-safe native material creation, canonical native snapshots, root-graph patch transactions, revision checks, selection, undo/redo, and exact failure/dry-run rollback.
- Bounded in-memory PNG rendering for individual live node outputs.
- CLI doctor, catalog verification, project linting, project normalization, package scripts, CI, SBOM, checksum, release archive, fixtures, and user/developer documentation.
- Automated validation with unit/integration tests, an official Godot 4.7 parse/handshake contract, and a full Material Maker 1.7 headless multi-node commit/rollback/undo/redo contract.

## Capability-gated in 0.1.0

- Native project open/save/close lifecycle mutations. Native in-memory material creation is available.
- Full material 2D/3D previews, histograms, channel analysis, and visual comparison. Bounded
  node-output PNG rendering is available.
- Native texture export, engine target packaging, and artifact verification.
- Full generated upstream node catalog coverage and custom shader writes.
- Subgraphs, remote controls, libraries, community network operations, and painting mutations/strokes.
- Remote or multi-user deployment; HTTP remains authenticated and loopback-only.

These are later roadmap phases in the production plan and remain disabled until they have native adapters, policy enforcement, and end-to-end tests.
