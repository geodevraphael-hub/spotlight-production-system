# Activity history crash repair — 18 October 2026

## Cause

The browser reported `SyntaxError: "undefined" is not valid JSON` in Operations.
Operations reused one response object across tabs. After switching from Message
delivery to Activity history, the first render attempted to parse a notification's
missing `detail` field before the effect could clear the old rows.

## Repair

- Associate each response with its full request key (section, project and filters).
- Render rows only when the response matches the current request.
- Ignore responses from cancelled requests, including their errors.
- Format missing, null, legacy text and malformed activity details without throwing.
- Explain the history's project scope and timezone, and provide an empty-state message.

No database schema, activity records or notification sending behavior is changed.

## Verification and release

`npm test`: 16 passing tests, including response isolation and safe detail formatting.
Docker recipe: `deploy/Dockerfile.activity-history`.
Production image: `spotlight-planner:20261018-activity-history-r7`.
Previous container retained: `spotlight-before-activity-history-20261018`.
Consistent SQLite backups are retained in the release's `database-backup` directory.
Release smoke checks cover the delivery counts, test SMS reference and history API
for projects 5 and 19; no notification-send endpoint is invoked.
