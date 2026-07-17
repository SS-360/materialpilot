# Changelog

All notable changes use Keep a Changelog conventions.

## [0.1.0] - 2026-07-17

### Added

- Initial MaterialPilot monorepo, domain SDK, graph engine, validator, security policy, bridge protocol, native addon, MCP server, CLI, fixtures, and documentation.
- Authenticated native Material Maker 1.7 bridge with canonical snapshots, atomic graph patches, dry-run rollback, revision checks, idempotency, and native undo/redo integration.
- Godot 4.7 and full Material Maker application contract tests, standalone release packaging, SBOM, and SHA-256 verification.
- Bounded in-memory PNG rendering for live node outputs through `preview_render_node_output`.

### Fixed

- Made Godot stable node IDs byte-for-byte compatible with the TypeScript domain model.
- Removed serialized array positions from stable connection IDs and enabled deletion by public ID.
- Made non-deletable Material output removal fail explicitly instead of returning a successful no-op.
- Normalized native temporary ID mappings against the planned or committed snapshot.
- Translated public node IDs and named ports to native selectors before applying a patch.
- Round-tripped Material Maker gradients between native `type/points/pos` values and stable
  `kind/stops` values.
- Matched Material Maker 1.7 Material port ordering and documented its writable native parameters.
- Eliminated false validation warnings for Material and Normal Map native parameters.
