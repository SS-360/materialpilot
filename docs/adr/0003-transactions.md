# ADR 0003: Optimistic atomic graph transactions

Status: accepted.

Every patch requires `expectedRevision` and an idempotency key. The executor snapshots first, applies all operations, validates, and commits one undo entry or restores the original serialized state. Revisions remain monotonic through undo and redo.
