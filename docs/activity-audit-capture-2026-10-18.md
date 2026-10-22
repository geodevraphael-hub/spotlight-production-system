# Complete activity capture (schema version 2)

## Coverage

New project operational writes capture structured before/after snapshots and the
authenticated editor: billboard attributes and image replacement, flight schedules,
validation assignments/reports, corrective issue tasks, reservations, actual costs,
project billboard assignments, plans, missions, field collections/photos, project
contacts/settings and membership. Creates and deletes have an explicitly absent
side rather than fabricated prior values. Credential values and share codes are
not included in snapshots. Encoded image bytes are represented as attachment
changes, not duplicated into every historical entry.

The history API prefers the saved actor name over the current user record, so
renames/deletions do not erase attribution. Automated writes without a request
context are recorded as System automation, never as the original record creator.
Shared inventory edits are recorded in every linked project's history.

## Atomicity

Authenticated API writes use `auditedDatabase`. Each D1 batch inserts a singleton
request context, executes the writes (and audit triggers), and removes the context
inside one SQLite transaction. It is not global in-memory request state. Failed
writes roll back the context and their audit rows. Returned statement metadata
retains the original result indexes. Read queries are unchanged.

`installActivityAudit` atomically replaces four legacy triggers with 42 versioned
triggers and records migration version 2. It does not backfill or rewrite history.
Operational timestamp-only/notification-worker updates do not create false edits.
Legacy activity remains readable and may still say Not recorded. Version 2 details
show Not set, Not yet created or Removed where appropriate.

## Verification

- 24 automated tests: snapshot fields, identity spoof resistance, two users editing
  the same records, project membership isolation, photo changes, rollback, no-op
  suppression, name preservation, initialization idempotency, API inventory/flight/
  validation flows, plus prior operations and message delivery regression tests.
- An isolated network-disabled container tests the migration and a flight edit on
  a copy of production SQLite before cutover. No live business data is used for
  mutation testing and no notifications are sent.
- Live smoke checks confirm notification counts/reference, history endpoints,
  migration version, 42 installed triggers, and an empty write-context table.

Image: `spotlight-planner:20261018-audit-capture-r9`.
Recipe: `deploy/Dockerfile.audit-capture`.
Rollback container: `spotlight-before-audit-capture-20261018`.
The release retains consistent SQLite backups and restores legacy trigger
definitions (not the database contents) if cutover verification fails.
