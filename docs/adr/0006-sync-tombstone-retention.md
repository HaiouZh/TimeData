# ADR 0006: sync_tombstones retention must be watermark-aware

## Status
Accepted

## Context
`sync_tombstones` lets incremental pull communicate deletes to devices that were offline when the delete happened.

## Decision
TimeData will not delete tombstones by a fixed age-only TTL. Any retention implementation must account for client sync watermarks, provide a full repair path, and write an audit log for cleanup decisions.

## Consequences
The table may grow until a safe retention mechanism exists. This is preferable to data resurrection on long-offline devices.
