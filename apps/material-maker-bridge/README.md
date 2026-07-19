# MaterialPilot native bridge

This addon targets Material Maker 1.7 on Godot 4.7. Copy `addon/materialpilot` into the Material Maker project's `addons` directory, enable the plugin once in the Godot editor, and export or run Material Maker. The plugin installs an autoload that starts an authenticated loopback WebSocket bridge at runtime.

The bridge writes `~/.materialpilot/bridge.json` by default, or `bridge.json` under
`MATERIALPILOT_RUNTIME_DIR` when set. The record contains an ephemeral token and must be readable
only by the current user. It is removed on clean shutdown.

The current bridge implements authenticated status, multi-tab project inspection, rollback-safe
and idempotent native material creation, raw graph snapshots, revision-checked patching, rollback,
native undo/redo integration, policy-mediated `.ptex` saves, bounded node-output and sphere/plane
material previews, and verified Blender-profile exports. Graph comments and linked remote controls
round-trip through the stable patch model. Native project open/close, additional export profiles,
custom nodes, and painting mutations remain unavailable until their adapters have equivalent
transaction and cancellation guarantees.

See the [installation and run guide](../../docs/user/installation.md) for complete setup,
verification, Codex MCP configuration, and live texture examples.
