# Security package instructions

- Canonicalize and resolve symlinks before path authorization.
- Default to loopback, assisted mode, denied overwrite, disabled network, and disabled custom code.
- Approval tokens are scoped, expiring, and single-use.
- Audit data must redact credentials and must not contain full projects or texture data.
