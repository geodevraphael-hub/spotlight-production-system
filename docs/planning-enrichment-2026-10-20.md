# Full-inventory enrichment and budget planning

## Scope

Enrich the 393 distinct accessible inventory records via the existing authenticated
Spotlight API, using the default 1,000 m catchment. Administrative demographics are
area-based and not defined by this radius. Other radii remain available on demand.
Shared boards are not processed separately for each project.

The server-side run is sequential, cache-aware and resumable. It retains existing
inventory/plan data and does not send notifications. Provider access denial or rate
limits stop the run; transient failures get one separate, bounded retry after the pass.
The final server report records matched-coordinate coverage, available ward/shehia
and village counts, distinct areas, skipped GPS records and any unresolved failures.

## Recommendations

Budget proposals now compare cost/score combinations instead of only taking boards
in rank order. The objective is maximum combined weighted criteria score subject
to the remaining budget and additional-board limit. Existing plan costs are
subtracted first. Missing active criteria and missing budget prices are excluded.
No population totals are presented as unique campaign reach.

The nondominated frontier is exact until a cardinality-aware state cap is reached.
If pruning occurs, the UI explicitly calls the search bounded rather than claiming
a guaranteed optimum. The rank-first baseline is retained so bounded results cannot
score worse than the old method. Small cases are compared against exhaustive
enumeration in tests; a 393-board case verifies performance and constraints.

## Typography

All app UI text, form controls, dialogs and map controls use the same stack:
Calibri Light, Calibri, Segoe UI, Arial, sans-serif. Body weight is light, with
moderate heading/emphasis weights for readable hierarchy. External Geist loading
was removed. Microsoft font files are not redistributed; devices without Calibri
Light use the fallback stack. Existing colours and component layout are preserved.

## Validation

Production image: `spotlight-planner:20261020-planning-coverage-r17c`.
Build runs 27 operations tests and 44 planner tests (71 total).
Full enrichment coverage and browser QA are verified before handoff.

Completed pass: 393/393 records retrieved, zero failed requests remaining;
392 have verified ward/shehia population across 109 areas; 215 have verified
village estimates across 76 villages. Radius population is available for 392.
One record is partial coverage, not a fully evidenced result. The runtime
deployment smoke checks preserved 393 inventory records and all three saved plans.

Kinazini's reverse lookup succeeds but supplies no verified ward/village population;
its radius catchment returns HTTP 422:
"The coordinate is outside the official Tanzania coverage." For this exact
response only, successful reverse facts are retained as administrative-only
evidence. Radius metrics stay null, and the UI explains the limitation. Other
422 errors, denials and outages still fail without overwriting evidence.
