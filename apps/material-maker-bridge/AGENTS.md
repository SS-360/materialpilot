# Native bridge instructions

- Target Material Maker 1.7 and Godot 4.7.
- Bind only to loopback and require the ephemeral token handshake before any request.
- Never expose raw Godot object references over JSON-RPC.
- Wrap every graph mutation in a serialized pre-state, validation, rollback, and one meaningful native undo entry.
- Avoid blocking rendering or the UI thread with long-running work; expose jobs for future render/export work.
