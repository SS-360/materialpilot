# Architecture overview

MaterialPilot has four boundaries:

1. The MCP server translates MCP tools, resources, prompts, progress, cancellation, and policy decisions.
2. The native bridge is an authenticated loopback JSON-RPC service inside Material Maker.
3. Stable packages model graphs, parse projects, validate state, enforce paths, and execute offline transactions without Godot dependencies.
4. Fixtures and compatibility tests pin behavior to Material Maker 1.7 and Godot 4.7.

The server automatically connects to a runtime discovery record when `MATERIALPILOT_RUNTIME_FILE` points to one. If no live bridge is available it degrades to an offline reference graph engine; live-only capabilities remain false.

Graph mutations flow through one boundary:

```text
inspect revision -> validate patch -> snapshot -> apply operations
                 -> structural validation -> commit one undo entry
                 -> emit revision, diff, diagnostics, correlation evidence

failure at any point -> deserialize snapshot -> report structured error
```

The public domain package contains no Godot or MCP transport objects. This lets offline linting, fuzzing, schema tests, and native contract tests share the same graph language.
