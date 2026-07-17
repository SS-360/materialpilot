# MaterialPilot native bridge

This addon targets Material Maker 1.7 on Godot 4.7. Copy `addon/materialpilot` into the Material Maker project's `addons` directory, enable the plugin once in the Godot editor, and export or run Material Maker. The plugin installs an autoload that starts an authenticated loopback WebSocket bridge at runtime.

The bridge writes `~/.materialpilot/bridge.json` by default, or `bridge.json` under
`MATERIALPILOT_RUNTIME_DIR` when set. The record contains an ephemeral token and must be readable
only by the current user. It is removed on clean shutdown.

The current bridge implements authenticated status, project inspection, raw graph snapshots,
revision-checked patching, idempotency, rollback, native undo/redo integration, and bounded
in-memory PNG rendering for individual node outputs. Full 2D/3D panel capture, export, and painting
mutation capabilities remain unavailable until their adapters have equivalent transaction and
cancellation guarantees.

See the [installation and run guide](../../docs/user/installation.md) for complete setup,
verification, Codex MCP configuration, and live texture examples.
