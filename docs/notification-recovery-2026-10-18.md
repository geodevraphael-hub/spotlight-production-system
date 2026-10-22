# Notification delivery recovery — 18 October 2026

## Cause and production repair

The reported `internal error; reference = ...` values match workerd log entries stating `TLS peer's certificate is not trusted; unable to get local issuer certificate`. The Debian production container had no `/etc/ssl/certs/ca-certificates.crt`. Node's bundled trust store worked, but the application's workerd outbound HTTPS requests did not.

Installed the OS certificate package in the running container, then built and deployed `spotlight-planner:20261018-notifications-r5` with the package included permanently. TLS verification remains enabled. An isolated workerd probe successfully connected to MShastra, Meta and Resend without sending messages. The public Spotlight homepage returns HTTP 200.

## Application safeguards

- Independent SMS, email and WhatsApp lanes, up to ten jobs per channel per worker run; a WhatsApp backlog does not consume the entire SMS allocation.
- Bounded provider requests and a per-run scheduling budget; remaining unclaimed jobs wait for the next automatic worker run.
- Receipt-reconciliation failures do not stop SMS/email processing.
- MShastra success requires a message ID, matching destination and `Send Successful`. Blank/unrecognized HTTP 200 responses are not treated as success. Provider IDs are saved for new accepted SMS.
- Unknown transport outcomes are held for investigation rather than automatically duplicated. Permanent Meta configuration failures stop retrying.
- Twelve automated tests pass, including acknowledgement parsing, independent channels, queue claims/deduplication, unknown delivery, receipt races and existing project permissions.

The acknowledgement format is corroborated by historical successful provider responses and [MShastra's API documentation](https://www.mshastra.com/download/api_configuration.pdf). Provider acceptance is not a handset delivery receipt.

## Recovery performed

- Six deflighting SMS for Michenzani Round About resumed automatically after certificate installation, recorded accepted at 14:44 Tanzania time. These were not resent. They were processed by the prior parser before the release activation, so their provider IDs were not retained.
- Today's six failed reminder SMS were matched to certificate-handshake failures in retained container logs. Recovered the existing jobs instead of inserting duplicates.
- Rebuilt today's reminder from current schedules: 35 still-flighted boards, excluding the board deflighted today. Preserved the application's message formatting and refreshed the email subject count.
- Before recovering today's ten email jobs, the authenticated Resend listing returned an empty list with `has_more=false`. Recovered five deflighting and five current-reminder emails; no additional test campaign.
- Recovery worker returned `processed: 16, accepted: 16`. All six reminder SMS have numeric MShastra message IDs; all ten emails have Resend IDs. This is provider acceptance, not proof every recipient read or received a message.
- Subsequent authenticated Resend history confirms all ten recovered emails have `last_event: delivered`. SMS handset delivery remains unconfirmed pending carrier receipts or recipient confirmation.
- Older 16–17 October failed/unknown reminders were not replayed. Original job data was saved privately before changes.

## Remaining WhatsApp dependency

The configured old sender ID is unavailable (Meta code 100, subcode 33). The replacement number's phone-code verification does not complete business approval or Cloud API registration. Do not label these WhatsApp messages delivered or change them to successful merely because SMS works. Complete Meta business/account approval and phone registration, then confirm the sender ID, approved templates and WABA subscription before a real WhatsApp test.

Fresh read-only Meta checks after deployment confirm replacement phone `+255790609071` is `VERIFIED` for its phone code but still `PENDING`; WABA review is `PENDING` and business verification is `pending_submission`.

## Deployment and rollback

- Build recipe: `deploy/Dockerfile.notification-fix` (uses the existing release as its base).
- Release directory: `/srv/apps/spotlight-planner/releases/20261018-notifications`.
- Previous container retained: `spotlight-before-notifications-20261018`.
- SQLite backups passed integrity checks. Existing bind mounts, environment, sessions, Caddy configuration and scheduled workers were preserved.
- Runtime credentials were not included in the upload/build context or written to this document.
- No Git push or APK rebuild was performed as part of this notification repair.
