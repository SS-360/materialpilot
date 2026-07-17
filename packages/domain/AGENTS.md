# Domain package instructions

- This package is the stable public language shared by the server, bridge, validator, and fixtures.
- Schema changes require round-trip tests. Breaking changes require a new schema major version and an ADR.
- Domain types must not expose Godot objects, Node.js handles, or transport-specific values.
- Canonical hashes must remain deterministic across platforms.
