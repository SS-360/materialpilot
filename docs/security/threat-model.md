# Threat model

## Assets

- Material Maker projects and editable graphs
- user models, textures, exports, and libraries
- bridge token and MCP credentials
- filesystem roots and overwrite policy
- generated shaders and downloaded community content

## Trust boundaries

Project labels, comments, shader text, asset metadata, and remote descriptions are untrusted. They may be returned as resources but never become server instructions or permission changes. MCP initialization instructions are static repository code.

## Principal threats and controls

| Threat                             | Control                                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Unauthorized local bridge client   | Loopback bind, 256-bit ephemeral token, nonce echo, runtime record cleanup, payload limit.               |
| Human edit overwritten by an agent | Monotonic revision and required `expectedRevision`.                                                      |
| Partial graph corruption           | Serialized pre-state, atomic patch, post-validation, rollback, one native undo entry.                    |
| Retry duplicates nodes             | Required idempotency key scoped to project and request hash.                                             |
| Path traversal or symlink escape   | Canonical real paths and separate read/write/export roots.                                               |
| Unapproved overwrite               | Deny-by-default overwrite policy and A4 approval.                                                        |
| Prompt injection in project data   | Explicit untrusted resource marker; project text cannot alter server policy.                             |
| Generated shader abuse             | Custom-code feature false by default; A6 and a bounded compiler sandbox are required before enabling it. |
| Public bridge exposure             | Native listener only accepts loopback; HTTP MCP also binds loopback and requires a bearer token.         |
| Denial through large input         | 8 MB bridge payload, 500 operations, parser node/layer limits, render concurrency gates.                 |

Painting strokes, remote asset installation, upload, and custom shader writes are not stable capabilities in this release.
