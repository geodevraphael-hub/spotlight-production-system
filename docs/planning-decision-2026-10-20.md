# Planning decision support

## Provider and verified contract

This integration is for **https://locationiq.co.tz**, not locationiq.com. The existing `tz_live_` credential belongs to the Tanzania provider; it must never be sent to the unrelated service.

Read on 20 October 2026:

- https://locationiq.co.tz/dashboard#docs — authentication, server IP requirements, query interpretation, limits, and data caveats.
- https://locationiq.co.tz/openapi.json — exact parameters for reverse and radius catchment.
- https://locationiq.co.tz/v1/catalog — fields, source metadata, categories and coverage.
- https://locationiq.co.tz/static/catchment-example.json — **documentation fixture only**, never loaded into live billboard evidence.
- https://locationiq.co.tz/static/app.js?v=growth-1 — provider's public client confirms catchment field semantics.
- https://locationiq.co.tz/static/data-credits.html — source attribution link exposed in the decision panel.

Documented data:

- Linked administrative boundaries and nearby named facilities; missing geography is not guessed.
- Road characteristics; nearest road is not verified viewing direction or a postal address.
- Historical vehicle volumes are 2004 records, not present-day traffic. They are excluded from ranking.
- Catchment population is a WorldPop 2022 spatial estimate, not billboard audience, impressions, or current population.
- Google Open Buildings detections are not confirmed homes or households.
- Regional welfare rates, village allocations and modelled travel times must not be represented as observed demand, personal income or live travel times.

## Implemented workflow

Planner → **Decision support**:

1. Starts with the current inventory filters, across all accessible projects.
2. Six configurable weights (0–5): lower complete cost, recorded faces, estimated nearby population, commercial facilities, transport facilities and building detections.
3. Fixed comparable radius choices: 500 m, 1 km or 2 km.
4. Rank explanation shows raw value, unit, source, weight, contribution and evidence completeness. Fully evidenced boards sort first; missing data never receives favourable points.
5. Scores are relative to the current filtered candidates, not absolute performance predictions. Equal known values receive 50; zero total weights yields no score.
6. Budget-aware greedy suggestions subtract existing plan costs, skip existing selections, and require complete evidence. Users review and explicitly add proposed placements. This is not an optimal-allocation guarantee.
7. Settings persist with the saved plan. A CSV export captures current scores, criteria, radius, retrieval dates and caveats. Spreadsheet formula-leading text is neutralized.
8. Detailed provider facts load on demand; the list endpoint returns small summaries. At most 25 ranking rows initially render.

## Provider integration and safety

- Server-only X-API-Key header, fixed provider origin, no arbitrary URL/coordinates from the client.
- Each request authorizes the inventory database ID against the user's accessible projects before lookup.
- Reverse lookup + 1-radius catchment; retain raw source facts and nulls without changing inventory.
- 7-day cache is keyed by inventory ID, exact coordinates and radius. Changed GPS or radius cannot silently reuse evidence.
- One provider lookup lease at a time across clients. UI batches at most 20 boards and stops on errors; 401/403/429 cause cooldown, no automatic credential retries.
- Timeout, response-size guard, redirect rejection, no secret/provider error-body echo.
- No notifications, contact changes, flights, bookings or inventory changes are triggered by scoring.
- Source datasets have uneven coverage and some licensing limitations. Review the provider's credits before redistributing raw data.

## Production access verification

On 20 October 2026 the provider owner cleared the initial Cloudflare Error 1010 block. A normal host request then returned `SERVER_IP_MISMATCH`: this host also has IPv6, whereas the key is approved for IPv4 `161.97.145.64`.

Explicitly using that approved IPv4 connection returned HTTP 200 for both live reverse lookup and radius catchment. No access restrictions, headers or credentials were bypassed or broadened. The root-only staged key is imported into the runtime, never source or browser code. The production container must use the approved IPv4 egress.

Verified live point: latitude -6.222137, longitude 39.221127, radius 1 km:

- 17,603 modelled residents (2022), 17 commercial facilities, 6 transport facilities and 2,507 building detections.
- Legacy administration fields are null; official census boundaries identify Kisauni shehia, Magharibi B, Mjini Magharibi. Both source structures remain separate.
- These are provider estimates/records, not verified billboard reach.

Deployment supports `--locationiq --locationiq-active` after successful provider verification. Omitting the active flag pauses enrichment explicitly. The application applies a cooldown if the provider subsequently denies access.

## Validation

- 54 Node tests across operations, planner UI, planning store, scoring and decision UI passed in the Linux production build.
- Tests cover weights, zero/unknown prices, budget accounting, missing evidence, coordinate/radius/freshness checks, source years, access restrictions, caching, denial cooldown, exports and saved settings.
- Deployed `spotlight-planner:20261020-planning-decision-r15c`. Database snapshots and prior containers retained for rollback.
- Read-only production checks passed for plans, activity history, planning workspace (393 distinct inventory records / 3 saved plans), and evidence.
- Live in-app enrichment verified for Airport Terminal 3 Exit Gate in KZK-OOH-2026: 17,603 modelled residents, 17 commercial facilities and 6 transport facilities at 1 km. Closing/reopening loads the same cached evidence and retrieval date.
- Browser checks confirmed incomplete-data labelling, inventory-only priorities, a TZS 4,000,000 budget proposal, explicit addition to an unsaved plan with all four prices totalling TZS 3,150,000, and keyboard focus returning to the launcher. No test plan was saved and no notification was sent.
- Runtime compatibility: Worker fetch uses `redirect: manual` and rejects non-2xx without following redirects. A regression test checks that the server key is never forwarded. The existing runtime secret whitelist was extended only with the three Location IQ configuration names.
- Inventory-wide enrichment is not precomputed: users request filtered batches of up to 20, with seven-day caching.
- Repository-wide TypeScript retains unrelated Cloudflare binding errors; changed planner components are checked separately.
