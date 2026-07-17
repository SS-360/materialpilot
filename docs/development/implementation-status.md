# Implementation status

MaterialPilot 0.1.0 is a tested implementation preview, not the stable 1.0 described by the long-range production plan. Unsupported surfaces are omitted or capability-gated instead of being simulated.

## Delivered

- TypeScript monorepo with stable schemas, identifiers, canonical hashing, PTEX/MMPP adapters, a node catalog, deterministic validation, security policy, and an atomic graph engine.
- MCP server over STDIO and authenticated loopback HTTP, with application, project, graph, node, connection, catalog, validation, layout, transaction, and baseline workflow tools plus resources and prompts.
- Authenticated loopback WebSocket bridge for Material Maker, active-project discovery, canonical native snapshots, root-graph patch transactions, revision checks, idempotency, selection, undo/redo, and exact failure/dry-run rollback.
- CLI doctor, catalog verification, project linting, project normalization, package scripts, CI, SBOM, checksum, release archive, fixtures, and user/developer documentation.
- Automated validation with unit/integration tests, an official Godot 4.7 parse/handshake contract, and a full Material Maker 1.7 headless multi-node commit/rollback/undo/redo contract.

## Capability-gated in 0.1.0

- Native project create/open/save/close lifecycle mutations.
- Rendered 2D/3D previews, histograms, and visual regression.
- Native texture export, engine target packaging, and artifact verification.
- Full generated upstream node catalog coverage and custom shader writes.
- Subgraphs, remote controls, libraries, community network operations, and painting mutations/strokes.
- Remote or multi-user deployment; HTTP remains authenticated and loopback-only.

These are later roadmap phases in the production plan and remain disabled until they have native adapters, policy enforcement, and end-to-end tests.
