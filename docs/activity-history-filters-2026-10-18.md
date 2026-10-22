# Activity history filters and export

Deployed to https://spotlight.co.tz/ on 18 October 2026.
Production image: `spotlight-planner:20261018-history-filters-r10b`.

## Behaviour

- Operations > Activity history filters by actor ID, event type, billboard, search, and inclusive EAT date range.
- Database filtering replaces the 500-row cap. Results are paginated in groups of 50.
- Users and event types come from the selected project's history, including historical actor snapshots.
- Admin-only Excel export uses exactly the same database filter and includes every matching activity, not just the visible page.
- The Excel SpreadsheetML `.xls` report follows the existing application's export format. It contains filter metadata and one row per changed field, with date, actor, event, billboard, before and after values. Text cells cannot execute spreadsheet formulas.
- Older records retain honest missing-value labels. This release does not modify stored activity or send notifications.

## Verification

- 27 automated tests pass locally and in the Linux production build.
- New tests cover EAT midnight boundaries, invalid dates/ranges, combined filters, user and project access, non-admin export denial, safe XML text, pagination, and a 505-activity export.
- Live authenticated checks verified history and notification counts, audit triggers and context, and parsed the Excel export.
- Edge UI verified user/type filters, a date returning no matches, the inclusive 18 October range, and the actual downloaded report with one activity and four field-change rows.
- Local Windows build remains blocked by a pre-existing workerd binary problem. The production Linux build passed.

## Rollback

Release directory: `/srv/apps/spotlight-planner/releases/20261018-history-filters`.
Consistent SQLite backups are retained in `database-backup` and `database-backup-final`.
Previous containers are retained as `spotlight-before-history-filters-20261018` (r9) and `spotlight-before-history-filters-final-20261018` (initial r10).
No schema migration is required for this release. Preserve current database mounts when rolling back.
