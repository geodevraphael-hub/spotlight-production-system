# Map symbols and NBS demographic planning

## Source review

Read the provider's OpenAPI and metadata directly on 20 October 2026:

- https://locationiq.co.tz/openapi.json
- https://locationiq.co.tz/v1/demographics/summary
- https://locationiq.co.tz/v1/estimates/building-population/summary
- https://locationiq.co.tz/v1/computed/summary

Verified authenticated response contracts on the already approved IPv4 server using `/v1/reverse` and `/v1/demographics/reverse`. The reverse response already contains official census administration and village building allocations; additional duplicate API calls are unnecessary.

**NBS population is 2022 enumeration, not a current-year estimate.** Official counts include households and male/female population at region, district (derived council groupings), council and ward/shehia levels. Village estimates allocate ward/shehia counts using eligible Open Buildings detections. They are provider-computed NBS-anchored allocations, not measured village census counts. WorldPop radius population remains a separate option.

Verified examples:

- Airport location (-6.222137, 39.221127): Kisauni shehia, census population 17,962, households 3,767, male 8,521, female 9,441. No village estimate in the returned data.
- Public Dar es Salaam probe (-6.8, 39.28): Upanga Mashariki ward population 9,317 / households 2,531. Kitonga village **estimated** population 4,220 / households 1,146, allocated from that ward. This probe is documentation verification, not an inserted billboard.

Raw candidate report rows are unreviewed according to the provider; they are not scoring criteria. Regional welfare assumptions are not used to rank villages within the same region or called measured village purchasing power.

## Behaviour

- New plans default to NBS-based ward/shehia population. Legacy version-1 saved decisions retain WorldPop radius semantics.
- Choose region, district, council, ward/shehia or village. Missing village data is never replaced with a larger area's population.
- Optional household and male/female population criteria; overlapping population counts are flagged as a weighting consideration.
- Group visible ranked billboards by area identity. Display population once per area; never sum it per billboard.
- Curated demographic table shows each available level, basis, year, population, households and sex counts.
- Ambiguous geography, unverified name links, inconsistent counts and stale/mismatched evidence cannot contribute to scoring.
- CSV exports include population source, level, area, year and method. Saved plans retain both population source and geography.
- Existing cached reverse facts are normalized on read without a new external lookup.

## Map design

Format remains the symbol's body colour: muted violet large format, blue digital, ochre dashed fabricated banner, green-grey lamp post. Proportions reflect dimensions within readable screen bounds, not real-world scale. At least 44 px hit targets.

Flight state is separate: small green pulsing dot (flighted), amber diamond (expired), grey dot (unflighted), hollow dot (deflighted). No red. Open selection has a dark stationary outline and a single short confirmation transition. In-plan selection retains its check.

Unchanged marker DOM is reused instead of rebuilt on unrelated React updates. No bouncing or continuous positional animation. Reduced-motion preferences disable animations. All map modes use the same legend and descriptive accessible labels.

Below zoom 12, unselected symbols simplify to compact points; zooming in restores proportions and face counts. Active placement remains legible. Explicit placement focus cancels pending extent fitting so a delayed filter fit cannot override the user's location selection.

## Verification

Production r16 passed 36 focused planner/store/demographic/symbol tests and 27 operations tests, plus the production build. Read-only smoke checks confirmed plans, activity history, 393 distinct planning boards and configured location evidence. Browser verification confirmed Kisauni's 17,962 population / 3,767 households; choosing village correctly changes the result to incomplete/unavailable instead of substituting shehia counts. Follow-up r16b contains overview simplification and focus/extent race protection.
