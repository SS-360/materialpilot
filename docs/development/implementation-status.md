# Implementation status

MaterialPilot 0.1.0 is a tested implementation preview, not the stable 1.0 described by the long-range production plan. Unsupported surfaces are omitted or capability-gated instead of being simulated.

## Delivered

- TypeScript monorepo with stable schemas, identifiers, canonical hashing, PTEX/MMPP adapters, a node catalog, deterministic validation, security policy, and an atomic graph engine.
- MCP server over STDIO and authenticated loopback HTTP with 143 schema-defined tools spanning application, project, graph, catalog, node, connection, transaction, layout, PBR, preview, export, diagnostics, performance, and material workflows, plus resources and prompts.
- Authenticated loopback WebSocket bridge for Material Maker, multi-project discovery, idempotent and rollback-safe native material creation, policy-constrained project save, canonical and named recovery snapshots, root-graph patch transactions, revision checks, selection, undo/redo, and exact failure/dry-run rollback.
- Generated coverage for 392 unique Material Maker 1.7 node definitions, plus stable graph comments and linked remote controls.
- Bounded in-memory PNG rendering for individual live node outputs and sphere/plane material previews, plus verified Blender-profile PBR export.
- CLI doctor, catalog verification, project linting, project normalization, package scripts, CI, SBOM, checksum, release archive, fixtures, and user/developer documentation.
- Automated validation with unit/integration tests, an official Godot 4.7 parse/handshake contract, and a full Material Maker 1.7 headless multi-node commit/rollback/undo/redo contract.

## Capability-gated in 0.1.0

- Native project open/close lifecycle mutations. Native creation and policy-constrained `.ptex` save
  are available.
- Histograms, channel analysis, automated visual comparison, and arbitrary panel capture. Bounded
  node-output and sphere/plane material PNG rendering are available.
- Export profiles beyond Blender, engine target packaging, and asset installation.
- Custom shader writes and arbitrary subgraph mutation. Generated subgraph descriptors are readable.
- Libraries, community network operations, and painting mutations/strokes.
- Remote or multi-user deployment; HTTP remains authenticated and loopback-only.

These are later roadmap phases in the production plan and remain disabled until they have native adapters, policy enforcement, and end-to-end tests.
