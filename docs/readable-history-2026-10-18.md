# Readable activity details

Activity details use a Field / Before / After table instead of raw JSON.
Complete inventory snapshots show changed fields only, including nested uploaded
attributes. Legacy flight and validation events pair the recorded previous status
with the new status; other previous values are labelled Not recorded. No historical
values are invented or rewritten. Empty saved values are labelled Not set.

Dates are formatted in East Africa Time, booleans use Yes/No, and attachment data
is represented by a label instead of displaying encoded bytes. Malformed old
details show a readable explanation without crashing or printing broken code.

Presentation follows Spotlight's existing green, square-edged table design,
including semantic column/row headings, wrapping values and narrow-screen scrolling.

Verification: 19 passing tests covering nested snapshot diffs, legacy flight and
validation records, absent values, empty values, malformed data and tab isolation.
No API, notification, database schema or stored activity changes are included.

Release image: spotlight-planner:20261018-history-details-r8.
Rollback container: spotlight-before-history-details-20261018.
Recipe: deploy/Dockerfile.history-details.
