# Transactions, revisions, and recovery

Every project has a monotonically increasing revision. A patch must include the revision it was planned against and an idempotency key. A stale revision fails with `REVISION_CONFLICT`; reusing a key with different arguments fails with `INVALID_REQUEST`.

The offline engine clones the graph before applying operations. The native adapter serializes `top_generator` before the first native call. Both validate the post-state and leave the original state intact on failure.

Undo and redo also advance the revision so a previously inspected revision can never overwrite a human or recovery edit. Transaction records retain normalized operations, pre/post revisions, changed entities, warnings, snapshot identity, duration, and state.

Current native recovery is in-memory serialization plus Material Maker undo. The next release gate is a disk journal written before native mutation and cleaned after commit.
