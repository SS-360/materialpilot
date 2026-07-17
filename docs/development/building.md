# Building and testing

Run `pnpm check` for type checking, lint, and all unit/integration tests. Run `pnpm build` to emit ESM packages in each `dist` directory.

The test suite covers schemas, canonical hashing, catalog lookup and compatibility, deterministic diagnostics, atomic rollback, revision conflicts, idempotency, undo/redo, path policy, bridge handshake, PTEX and MMPP round trips, CLI linting, and MCP conformance through linked in-memory transports.

Godot is not bundled. `apps/material-maker-bridge/scripts/validate-addon.mjs` provides static safety-contract checks. Set `GODOT_BIN` to an official Godot 4.7 executable and run `pnpm test:godot` for the real parse, handshake, and status contract. `pnpm compatibility` runs this automatically when `GODOT_BIN` or the ignored local `.tools/godot-4.7` runtime is available.

For the full upstream application contract, install the add-on/autoload into a Material Maker 1.7 source checkout, build the TypeScript packages, set `MATERIAL_MAKER_PROJECT` and `GODOT_BIN`, then run `pnpm test:material-maker`. The test opens the real application headlessly, reads its active graph, creates and connects a representative multi-node graph, verifies native parameters, proves exact dry-run rollback, and exercises commit, undo, redo, and final restoration through Material Maker's own journal. `pnpm compatibility` includes this contract whenever both environment variables are set.
