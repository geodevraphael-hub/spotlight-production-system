# Delivery and performance release — 18 October 2026

## Implemented

- Meta App Secret configured in the server's private runtime configuration, not source control. `.dev.vars*` is ignored by Git.
- Webhook verifies the raw request's HMAC-SHA256 signature, limits payload size, checks the configured sender ID, and rejects unsigned requests. Webhook verification no longer has a public default token.
- Durable WhatsApp receipt inbox retains callbacks that arrive before their outbound provider IDs. Duplicate/out-of-order callbacks cannot regress read/delivered states. Recipient matching prevents a receipt updating another recipient's job. Queue processing reconciles saved receipts after restarts.
- Operations → Message delivery shows Delivered and Read timestamps, refreshing every 15 seconds only while the page is visible. Acceptance is not presented as delivery. Manual retries clear the previous failed attempt's provider ID so an old receipt cannot cancel the retry.
- Database initialization and reconciliation run once per runtime instance, with concurrent-request sharing and retry on failure. User/project/authentication data is never globally cached.
- Inventory loads independently of secondary panels, stale project requests are aborted, failures have a visible retry action, and opening an empty project no longer silently reimports KML.
- Dashboard notification statistics use SQL aggregation instead of downloading all audit payloads. Validation responses no longer duplicate the serialized asset alongside its parsed object.
- The VPS serves the compiled Workers build through the pinned Cloudflare/Vite runtime instead of the development module server. The existing SQLite identity, data mount, sessions and cron workers are preserved. Public assets are included, runtime secrets are installed beside the compiled Worker configuration, debugger/explorer are disabled, and Spotlight responses use gzip/zstd compression. This preserves the existing VPS/Miniflare architecture; it is not a migration to managed Cloudflare D1.

## Verification

- `npm test`: nine tests pass, including signed/unsigned callbacks, early receipts, duplicates, out-of-order delivery, wrong sender/recipient isolation, retry behavior, and concurrent initialization/failure recovery.
- Linux application build passes. Isolated API tests pass for sign-in, project permissions, import GPS/duplicates, booking conflicts, actual costs and offline submission replay.
- Production-data shadow uses an isolated SQLite backup and no live messaging credentials. An empty signed callback tests runtime-secret wiring without creating a fake delivered/read event or sending a message.
- Public webhook: unsigned request **401**, correctly signed empty event **200**.
- Meta accepted the app-level `messages` webhook subscription (`success: true`). App-to-phone/WABA registration remains the blocker described below. Public debugger/explorer routes return 404; homepage and favicon return 200 with gzip.
- Five sequential loopback authenticated requests per endpoint, same project/data, before vs final release median:

| Endpoint | Before | After |
|---|---:|---:|
| Page HTML | 114 ms | 26 ms |
| Current user | 568 ms | 24 ms |
| Project inventory | 579 ms | 50 ms |
| Notification summary | 495 ms | 23 ms |
| Message delivery list | 464 ms | 30 ms |

These are server-response measurements, not browser paint times or a guarantee about third-party basemap/image networks. The sampled project's message list was empty.

## WhatsApp account blocker

The access token identifies Spotlight app `2051910988764874` and is valid, but its configured phone-number object is inaccessible. The three Spotlight WABAs inspected returned empty phone lists. The user confirmed **+255680343600** as the desired sender. Meta's registration dialog reports that this number is already used by another WhatsApp account (error **2388103**).

Do not delete/disconnect the existing WhatsApp account. Obtain access to its current WhatsApp Business Account or arrange an explicitly approved, supported connection/migration, then update the runtime phone-number ID, confirm app-to-WABA `messages` subscription and approved template availability. Only then send a single agreed test and verify genuine delivered/read callbacks. No real-message delivery/read result is claimed by this release; no bulk tests were sent.

## Deployment and recovery

- Image: `spotlight-planner:20261018-performance-r4`.
- Release directory: `/srv/apps/spotlight-planner/releases/20261018-performance`.
- Prior live container: `spotlight-before-performance-20261018`. SQLite backup passed integrity checks; preserve the live data mount when rolling back, rather than overwriting newer records.
- Secret source: `/srv/apps/spotlight-planner/meta-webhook.env`, mode 0600. Container environment is retained, and startup writes protected `.dev.vars` files to both `/app/.dev.vars` and `/app/dist/server/.dev.vars`.
- The first compiled candidate was rolled back after secret-wiring checks failed; no queue jobs were processed during that interval. Final checks include secret wiring before activation.
- `/company/index.html` and the Genesiss reverse-proxy destination returned 404 in the restored pre-existing release too. This unrelated missing company page is not repaired or claimed as part of this release.
- No Git push or new APK is included in this request.
