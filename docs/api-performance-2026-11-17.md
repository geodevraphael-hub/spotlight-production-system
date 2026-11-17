# API and coordinate enrichment release — 17 November 2026

## Changes

- Lamp-post and report writes accept the exact HTTPS production origins with and without `www`, including requests behind TLS termination. Unrelated origins remain rejected. Supported native origins require an explicit bearer session.
- Web inventory requests opt into a compact payload. Uploaded raster photos are fetched lazily through a permission-checked, account-specific endpoint with a private 30-day cache. The mobile inventory payload remains backward compatible. Metadata saves restore stored photo bytes before writing; they never replace a photo with its display URL.
- Booking queries are scoped to the requested project while still counting reservations and flights across all memberships of each physical asset. Independent inventory reads run concurrently. Additive indexes cover asset identity, membership, bookings, flights and field-photo lookups.
- Geography authorization reads only asset IDs and coordinates instead of full photos and saved plans. Schema initialization is reused across per-request audit wrappers.
- Initial inventory loading waits for the project list. Secondary panels load when needed; the dashboard no longer downloads unused field-collection photos. Obsolete library requests are cancelled. Authenticated JSON responses explicitly prohibit stale caching.
- New and changed coordinates enter a durable queue in the same transaction as their inventory write. Successful saves start background processing without waiting for the provider. Existing automatic location passes also drain the queue.
- New coordinates take priority over old backlog. A pass makes at most eight fresh provider requests within a 25-second budget, spaced at least one second apart. Exact-coordinate results are reused. Provider denial/rate limits cause backoff, not request storms.
- Location updates merge into the latest asset under a compare-and-update guard. New GPS fixes, manual labels and concurrent edits are preserved. The UI polls compact deltas only while locations need updates and displays queue progress.
- Startup synchronization skips records whose existing values already match their schedules.

## Verification

- Production build passes; standard operations suite: 29 passed.
- Broad test run: 167 passed, six failed. An isolated archive of the previous production source has the same six failures (156 passed before the 11 new tests). These are pre-existing SQL/UI-loader/starter-preview/report-access test expectations, not new release failures. Standalone TypeScript checking also has existing Cloudflare/runtime declaration issues.
- New regression coverage includes origin restrictions, project-scoped booking correctness, protected photo access, photo preservation, queue persistence, provider backoff, overlapping workers, coordinate changes during lookup and schema reuse.
- Isolated authenticated API verification with provider calls disabled: `www` lamp-post creation succeeds (51 ms in the fixture), idempotent retry succeeds, an untrusted origin is rejected, photos remain intact after editing and four saved coordinates appear in the durable queue. No production test records were created.
- Synthetic photo-payload benchmark: 100 uploaded-photo assets, 8,546,185 bytes to 19,177 bytes (99.78% reduction).
- Synthetic 1,000-asset booking benchmark: approximately 104–120 ms before indexes versus approximately 3 ms after. These are local fixture measurements, not live-user latency guarantees.

## Deployment

Use the existing production-branch deployment workflow: isolated preview, verified database backup, live container swap, authenticated read-only report check and retained rollback container. Changes add tables, triggers and indexes; they do not delete or rebuild existing business records. Provider pauses, credentials, coverage and rate limits can still delay enrichment; the queue retains those jobs for retry.
