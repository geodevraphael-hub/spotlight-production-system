# Spotlight operations release — 15 October 2026

## Where to find the seven improvements

Choose a project, then open **Operations**:

1. **Message delivery** — durable email/SMS/WhatsApp text queues, per-recipient state, retry attempts and error details. Administrators can retry failed messages. An uncertain acknowledgement requires checking the provider before retrying to avoid duplicates.
2. **Offline field work** — Android 1.1.0 caches previously loaded assignments and saves collection/validation photos and corrective work in IndexedDB. Open the missions page or use **Sync saved work** to retry uploads; reconnecting while that page is open also triggers synchronization. Sign in online at least once. Offline maps are not downloaded.
3. **Activity history** — project and billboard changes, flight schedules, validation decisions, reservations and recorded costs. New activity is recorded from this release onward; earlier history is not fabricated.
4. **Issue resolution** — assign corrective work and a deadline, submit a photo and note in the APK, then have an administrator approve or return it. Approval marks validation okay and updates the billboard photo.
5. **Booking calendar** — reserve an individual face for an inclusive date range. Overlapping reservations are blocked across projects sharing the same physical inventory record. Existing overlapping flight schedules also block new reservations. Cancelled reservations remain visible.
6. **Import review** — CSV field mapping now leads to an editable review. Correct names, coordinates, board types and photo URLs, or exclude flagged rows. The server rechecks coordinates and duplicates; accepted rows are inserted in a database batch.
7. **Budget & actuals** — record rental, printing, transport and flighting costs in TZS, compare with a saved plan and export CSV. Selecting a plan scopes actual costs to its billboards in the current project, across all recorded dates; it does not allocate costs to a particular campaign period.

## Delivery status and configuration

- `pending`, `sending`, `retry`, `accepted`, `failed`, `unknown` describe queue/provider state. `accepted` does not mean the recipient received the message.
- WhatsApp signed delivery receipts can update messages to `delivered` or `read`. Configure the Meta app's **WHATSAPP_APP_SECRET** in the runtime and subscribe its webhook to `/api/whatsapp/webhook`. This secret was not available in the production environment at deployment. Unsigned callbacks are rejected.
- Email and SMS jobs currently show provider acceptance, not final delivery receipts.
- A minute-by-minute server worker drains the queue. The existing daily expiry-reminder schedule is retained. Both use an internal automation credential; no secret belongs in the browser or Git.
- Notification jobs do not backfill old provider deliveries. Historical email/SMS audit records remain in the existing audit view.

## Release and verification

- Web image: `spotlight-planner:20261015-operations-r3`.
- APK: `https://spotlight.co.tz/downloads/Spotlight-1.1.0-20261015.apk`.
- Android version: 1.1.0, version code 20261015. Uses the existing debug-signing build workflow, not a Play Store release signing key.
- APK SHA-256: `f96f2217c60dd4338bc8677c87ad4c18fb3248dc1302528d284cd2eeeebff129`.
- Eight automated workflow tests pass (`npm test`). Linux web build and Android Gradle build pass.
- Isolated API tests cover authentication, permissions, import GPS/duplicates, bookings, costs, and idempotent offline collection replay. No production messages were sent by these tests.
- Browser checks cover the operations navigation and reservation calendar, including imported inventory missing an area name.
- No Android device was connected. Physical camera capture, GPS and airplane-mode tests on a Pixel remain to be performed.
- The main repository's broad TypeScript check still includes pre-existing Cloudflare type and Leaflet-marker errors, plus ignored work/mobile directories. The Linux application build passes.

## Recovery

The pre-release container `spotlight-planner-before-operations-20261015` and an integrity-checked SQLite backup under `/srv/apps/spotlight-planner/releases/20261015-operations/database-backup` are retained. The immediately preceding operations container is `spotlight-operations-before-audit-summary`. Preserve the production data mount and runtime environment when rolling back; do not restore an old database over new field work without a reconciliation plan. The internal worker environment is stored privately on the server, not in source control.
