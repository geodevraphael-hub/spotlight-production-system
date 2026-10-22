# Planning workspace and navigation refresh

Scoped UI release for the existing self-hosted Spotlight system.

## Changes

- Labelled navigation dock with an active state, scrollable overflow, keyboard arrow/Home/End navigation and reduced-motion support.
- Desktop dock below the project header; phone dock at the bottom with safe-area spacing.
- Inventory filters collapsed initially. Existing filters, permissions and project navigation retained.
- Desktop campaign panel sits beside a resized map without a blocking backdrop. On phones, the plan uses the available workspace and background map controls are hidden.
- Costs expand per billboard, with two-column fields on phones. Notes are separately expandable.
- Zero-valued inventory costs are retained. Missing values remain blank and produce an explicit partial-total notice.
- Plan saves show pending, success and failure states and reject empty names and invalid prices.
- Starting a new plan warns before discarding a populated selection.
- Map sizing refreshes when the planning panel opens or closes.

## Validation

- Existing 27 Node regression tests passed locally and in the Linux image build.
- Linux production build passed.
- Read-only production smoke checks passed for plans and activity history.
- Browser checks: sign-in, billboard selection into an unsaved draft, cost expansion, missing-cost notice, blank-name validation, dock switching, keyboard focus, map restoration with loaded tiles.
- Mobile viewport checked at 390 × 844. A second pass fixes a squeezed header button, background zoom controls above the plan, and narrow four-column cost fields.
- No billboard, flighting, notification or contact records were changed by UI tests.
- Repository-wide TypeScript checking still reports existing Cloudflare binding/type errors outside this UI change; it is not a passing gate. The marker narrowing error in the planner was corrected.

## Deployment

Image: `spotlight-planner:20261020-planner-design-r14c`.
Previous containers and SQLite snapshots retained for rollback. Runtime environment, startup command, mounts and ports preserved.
This release does not enable Location IQ or implement multi-criteria ranking; provider access remains a separate blocker.

## Desktop-first clarification

The user explicitly prioritized desktop planning over mobile refinement.

- Planner now uses a separate planning-only placement dialog: image, location, dimensions, faces, vendor, read-only flight status, four plan-price inputs and selection/review actions.
- Inventory has its own dock destination with the existing management dialog. Flight updates, validation assignments, source-attribute editing, image uploads and deletion are not present in the planning dialog.
- Standalone project-assignment management remains in Project tools. Planning now has its own destination-project workflow described below.
- Review includes an explicit Add more billboards action and prioritizes Save plan.
- Comparison sums only shortlisted assets and closes when loading a plan.
- Saved plan costs exclude unselected draft candidates.
- CSV exports retain missing prices as blank, identify partial estimates, include plan name/notes and neutralize formula-leading text.
- Three focused component tests assert planning-only controls, accurate zero/missing cost handling, and selected-placement actions. Run `node --test tests/planner-ui.test.mjs` alongside the existing 27-test suite.

## Inventory-first planning

- The desktop plan panel opens by default, with inventory and map alongside it on wide screens. Users can collapse it deliberately; narrower desktop screens can switch back to browsing.
- Planning inventory spans every accessible project, using database inventory IDs to deduplicate shared billboards. Admin sees the full inventory; creators/planners retain project access restrictions. Viewers and field users cannot call the planning endpoints.
- Optional source-project filtering does not alter the selection. Planning selections and costs are separate from project-management selections and survive navigating to another workspace.
- Destination project is independent of source filtering. Save to an existing accessible project, or create one inside the plan panel (admin/creator).
- One audited transaction creates the project if requested, adds membership and billboard links, and saves the plan. Source memberships, inventory, and flight statuses are unchanged. Failures roll back together.
- Saved plans use explicit inventory-db identity; older plans convert source IDs using project membership. Ambiguous/missing legacy references are reported rather than guessed. Conflicting legacy asset IDs are rejected before linking to prevent downstream tracker collisions.
- No inventory deletion, attribute editing, flight updating, or unrelated sharing controls in the planning workspace.
- Six SQLite integration tests cover access, deduplication, legacy conversion, new-project atomicity/rollback, reassignment, and price validation. All 36 tests passed in the release build.
- Production read-only smoke: 393 unique inventory records and 3 saved plans. Browser checks combined KMK and BwSukari billboards into one unsaved plan, retained the draft across source filters and navigation, and exposed the new-project destination field. Test plans/projects were not written to production.

## Desktop planner design pass

- Applied the frontend-design skill to a restrained three-area workspace: Find billboards, map tools, and Your plan. Preserved Spotlight's green/white palette, square work surfaces and existing navigation.
- Added explicit Add/In plan controls, selection highlighting and marker check badges. Inventory status is distinct from plan selection.
- Condensed category statistics into an expandable summary and labelled the map extent and box-selection tools.
- Separated the plan's scrollable working area from its total, cost breakdown, export and save footer. Destination project, individual estimates and notes remain accessible without scrolling the entire application.
- Kept placement inspection planning-only, removed the overlapping Leaflet popup, improved close controls and Escape dismissal, and made comparison labels and amounts readable.
- Replaced the failing CARTO Light basemap (visually returning API-key-required tiles) with a grayscale Light street presentation of the working OpenStreetMap layer. Restored source attribution.
- All 39 tests pass in the Linux release build (27 operations, 6 planning store, 6 UI).
- Production browser checks at 1280 × 720 and 1366 × 768 covered selection, project filtering with selection retained, live cost recalculation, inspector scrolling, Escape close, selected-only mapping, comparison, cost expansion and notes access. Test changes stayed in an unsaved draft; no production plans or inventory were written.
- The Windows local-preview runtime cannot start with the installed workerd binary. The Linux production build and deployed browser were used for verification instead; dependencies were not reinstalled.
