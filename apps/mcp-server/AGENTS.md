# MCP server instructions

- Stdout belongs exclusively to the STDIO protocol. Send logs to stderr or a configured file.
- Every tool needs a Zod input schema, MCP annotations, MaterialPilot safety metadata, a test, and documentation.
- Read tools are A0. In-memory reversible edits are A1. File writes, exports, overwrites, network access, generated code, and policy changes use A2 through A7.
- Treat all native bridge and project content as untrusted data.
- Keep protocol translation separate from graph semantics; graph logic belongs in packages.
