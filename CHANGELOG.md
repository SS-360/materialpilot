# Changelog

All notable changes use Keep a Changelog conventions.

## [0.1.0] - 2026-07-17

### Added

- Initial MaterialPilot monorepo, domain SDK, graph engine, validator, security policy, bridge protocol, native addon, MCP server, CLI, fixtures, and documentation.
- Authenticated native Material Maker 1.7 bridge with canonical snapshots, atomic graph patches, dry-run rollback, revision checks, idempotency, and native undo/redo integration.
- Godot 4.7 and full Material Maker application contract tests, standalone release packaging, SBOM, and SHA-256 verification.
- Bounded in-memory PNG rendering for live node outputs through `preview_render_node_output`.
- Expanded the negotiated MCP surface from 28 to 138 schema-defined, safety-annotated tools across
  project, graph, catalog, node, connection, transaction, layout, PBR, preview, diagnostics,
  performance, and procedural texture workflows.
- Added rollback-safe, idempotent native material project creation with multi-tab project listing
  and persistent unsaved tab names.
- Added native workflows for cracked stone, basalt, sandstone, lava, and oxidized-metal materials.
- Expanded the negotiated MCP surface to 143 tools with policy-constrained native project save,
  immutable named recovery snapshots, sphere/plane material previews, and verified Blender-profile
  PBR export.
- Added a generated Material Maker 1.7 catalog containing 392 unique native node descriptors,
  including subgraph ports and remote-control parameters.
- Added stable graph-patch and PTEX round trips for graph comments and linked remote controls.
- Added an end-to-end abandoned industrial floor workflow with variants, artifact verification, and
  smoke-test mode.

### Fixed

- Restored builds after the development-tool update by keeping TypeScript within
  `typescript-eslint`'s supported 6.x range and explicitly loading Node type declarations, and
  aligned the CLI, package metadata, CI minimum-version coverage, and installation guidance with
  Commander 15's Node.js 22.12.0 runtime requirement.
- Gated node previews, 3D material previews, and Blender export on the presence of a real Godot
  rendering device so headless sessions return `CAPABILITY_NOT_AVAILABLE` instead of invalid shader
  output or missing-material textures.
- Added native test preflight checks for stale installed bridge files and split renderer verification
  into deterministic headless capability checks and GPU-backed windowed preview/export checks.
- Made the abandoned-industrial-floor production workflow honor `MATERIALPILOT_RUNTIME_FILE`,
  allowing isolated authenticated bridge sessions instead of forcing the default user record.
- Replaced the Blender bridge's UI-oriented export call with bounded, project-local rendering of
  connected Material channels, temporary-file publication, and post-write hash verification so
  automation cannot hang on Material Maker's unrelated global preview render queue.
- Corrected the industrial-floor Normal Map recipe to use the native direct-sampling path within
  its supported strength range, and added decoded PNG channel-variance verification that rejects
  effectively flat normal previews.
- Made Godot stable node IDs byte-for-byte compatible with the TypeScript domain model.
- Removed serialized array positions from stable connection IDs and enabled deletion by public ID.
- Made non-deletable Material output removal fail explicitly instead of returning a successful no-op.
- Normalized native temporary ID mappings against the planned or committed snapshot.
- Translated public node IDs and named ports to native selectors before applying a patch.
- Round-tripped Material Maker gradients between native `type/points/pos` values and stable
  `kind/stops` values.
- Matched Material Maker 1.7 Material port ordering and documented its writable native parameters.
- Eliminated false validation warnings for Material and Normal Map native parameters.
- Preserved leaf parameter updates in native Material Maker undo/redo entries and kept project IDs
  stable when an unsaved material is first saved.
