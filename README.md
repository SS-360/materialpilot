# MaterialPilot

MaterialPilot is a local-first Model Context Protocol integration for Material Maker. It exposes editable procedural graphs through a stable TypeScript domain model, deterministic validation, revision-safe transactions, and a native GDScript bridge.

The repository is currently an implementation preview targeting Material Maker 1.7 and Godot 4.7. Painting strokes and generated shader writes remain intentionally experimental or disabled.

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

See [Implementation status](docs/development/implementation-status.md), [Installation](docs/user/installation.md), [Architecture](docs/architecture/overview.md), and [Security](SECURITY.md).
