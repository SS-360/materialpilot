# ADR 0001: Native authenticated bridge

Status: accepted.

Use a loopback WebSocket JSON-RPC bridge inside Material Maker, authenticated by a per-process 256-bit token and nonce. Do not use UI coordinates or expose Godot objects. Keep MCP protocol handling in TypeScript so MCP lifecycle changes do not destabilize GDScript integration.
