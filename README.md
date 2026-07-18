# MaterialPilot

MaterialPilot is a local-first Model Context Protocol integration for Material Maker. It exposes editable procedural graphs through a stable TypeScript domain model, deterministic validation, revision-safe transactions, and a native GDScript bridge.

The current server negotiates **138 structured MCP tools** across application health, native project creation, graph observation, catalog discovery, atomic and batch editing, connections, transactions, layout, PBR channels, previews, diagnostics, performance inspection, and procedural texture workflows. Every registered tool has an input schema, read/write annotations, and MaterialPilot safety metadata.

The repository is currently an implementation preview targeting Material Maker 1.7 and Godot 4.7. The long-range production plan extends toward 150+ tools with export, asset-library, custom-node, mesh-map, and painting workflows. Those higher-risk surfaces remain capability-gated until their native transaction and policy contracts are implemented.

## Quick start

From a source checkout:

```bash
pnpm install
pnpm build
pnpm test
pnpm --filter @materialpilot/cli start -- doctor
pnpm --filter @materialpilot/mcp-server start
```

From a packaged release archive:

```bash
node cli/dist/main.js doctor
node server/dist/main.js
```

The MCP server uses STDIO by default. It writes diagnostics to stderr and never mixes logs with protocol output.

See [Tool reference](docs/tools/core-tools.md), [Implementation status](docs/development/implementation-status.md), [Installation](docs/user/installation.md), [Architecture](docs/architecture/overview.md), and [Security](SECURITY.md).
