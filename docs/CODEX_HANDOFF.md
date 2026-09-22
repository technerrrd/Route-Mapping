# Codex project handoff

## Project state

Route Map Gallery is a local static web app for reviewing school-bus stop locations around Alwar, Rajasthan. The repository currently has one commit and no application-code work in progress or uncommitted changes before this documentation update.

Completed functionality:

- Twelve root-level `.xls` workbooks are parsed from their first worksheet.
- The generated dataset contains 12 routes and 143 route-stop records. This includes V.L Memorial Public School appended as the final stop of every route; there are 132 unique stop names.
- Pickup/drop values are normalized, routes and stops are ordered, and route metadata records the source workbook.
- Candidate coordinates come from `google-maps-candidates.json`, higher-priority `route-overrides.json`, the ignored Nominatim cache, or an online Nominatim lookup.
- The responsive browser UI supports route selection, schedule tables, numbered Leaflet markers, candidate confidence/notes, direct route polylines, stop navigation, confirmation/denial, coordinate adjustment, and JSON review export.
- Review state persists in the current browser via `localStorage`.
- Leaflet JS/CSS/images are copied from `node_modules` and committed under `vendor/`; map tiles remain remote OpenStreetMap resources.
- A dependency-free Node static server handles local use and rejects paths outside the repository root.

## Current work and known data gaps

The repository state indicates that the active work is candidate-location validation. Of 143 route-stop records, 127 have a candidate coordinate and 16 are unresolved:

- Route-1: `14 Beegha`
- Route-4: `Vallabhgram`
- Route-6: `Manu marg`, `MANNI KA BARH`, `Swarg Road`, `Scheme No. 1`
- Route-7: `kacheri Mod`, `Old Station Road`, `Jal ka kuan,Barf Khana Road`, `Jubli Bass Circle`, `Aerodrum Road`, `Karamchari Colony I`
- Route-8: `Homepathy College Road`
- Route-9: `Atta mandir`
- Route-10: `khudanpuri`
- Route-11: `Ramhet Ki Kothi`

The 127 mapped records are still candidates: 79 are marked high confidence, 29 medium, 2 medium-high, and 17 low. Confidence is descriptive metadata, not a human confirmation. Several candidate notes explicitly identify representative neighborhood points or ambiguous landmarks that need checking.

The source spreadsheets also contain duplicate and non-contiguous sequence numbers (for example, multiple routes have two sequence `1` entries). The build preserves these values and sorts by them; it does not repair source numbering. Because browser review keys include route ID, sequence, and stop name, identical sequence numbers are safe when names differ, but source cleanup should happen in the workbook rather than generated JSON.

## Design decisions and rationale

- **Spreadsheets remain the schedule source of truth.** Nontechnical operators can update existing files without editing JavaScript. Generated `data/routes.json` is committed so the site can be served without rebuilding in deployment-like environments.
- **Static architecture.** Vanilla browser code and a tiny Node server keep installation and operation simple. There is no API, authentication, database, or framework build step.
- **Candidate-first location model.** Google Maps research is kept in a separate candidate file and loaded as pending review. `route-overrides.json` has final precedence for carefully supplied coordinates, while Nominatim is a fallback. This avoids implying that automated or researched matches are verified pickup points.
- **Privacy-aware build option.** `npm run build:offline` never submits stop names to Nominatim. The online build includes each unresolved name and `ROUTE_LOCATION_CONTEXT` in external requests, uses an India country filter, an eight-second timeout, and a 1.1-second delay.
- **Required final destination.** `V.L Memorial Public School` is normalized for comparison, moved from any earlier source position if present, and appended to every route with `max(sequence) + 1`. Its shared candidate is in `route-overrides.json`.
- **Local review workflow.** Decisions and adjusted coordinates stay in browser storage and can be exported. This avoids a backend, but also means there is no multi-user synchronization or built-in import/reconciliation path.
- **Straight-line visualization.** Polylines connect non-denied candidate coordinates in stop order; they are not driving routes and should not be presented as turn-by-turn routing.

## Known limitations and risks

- Sixteen stops cannot be placed during an offline build, and ambiguous/low-confidence candidates remain across the mapped set.
- Review exports are not consumed by the build. A human must deliberately translate approved coordinates into `route-overrides.json` (or another future persistence/import mechanism).
- Review state is browser- and origin-specific; clearing site storage, changing ports/origins, or moving computers loses it unless it was exported.
- Online builds depend on Nominatim availability and policy, and map display depends on OpenStreetMap tile availability. No offline tile set is included.
- The app shows candidate markers even when denied, although denied points are excluded from the route polyline. Map bounds are computed from all mapped candidates, including denied ones.
- There is no automated test suite, linter, CI configuration, production deployment configuration, or pinned Node version.
- The default port is `4173`; starting another server on that occupied port fails with `EADDRINUSE`. Use `PORT` to select another port.
- Candidate and override matching is an exact, case-sensitive object lookup. Workbook spelling/case changes can silently turn a mapped stop into an unresolved one.

## Configuration and state locations

- `package.json`: scripts and the two runtime/build dependencies.
- `scripts/build-routes.mjs`: workbook schema, default location context, geocoding policy, source precedence, school-appending rule, and generated outputs.
- `scripts/serve.mjs`: static server, MIME types, and `PORT` handling.
- `route-overrides.json`: 9 current higher-priority entries, including the school.
- `google-maps-candidates.json`: 107 current exact-name candidate entries.
- `.route-geocode-cache.json`: local ignored cache; currently not part of shared project state.
- `data/routes.json`: committed generated output loaded by the browser.
- Browser `localStorage`: review records under `route-map-location-reviews-v1`.

## Verified commands

On 2026-09-22, with Node 25.8.1 and installed lockfile dependencies:

- `npm run build:offline` rebuilt 12 routes, mapped 127/143 records, reported the 16 names above, and produced no tracked diff.
- `node --check` passed for `app.js`, `scripts/build-routes.mjs`, and `scripts/serve.mjs`.
- A fresh server on port 4174 returned HTTP 200 for `/` and `/data/routes.json`; the JSON response contained 12 routes. Port 4173 was already occupied by another process at verification time and also served the expected app/data.

There are no `test` or `lint` npm scripts, so do not claim those checks have run.

## Suggested next steps

1. Resolve the 16 missing stops with human-verified coordinates and add exact-name entries to `route-overrides.json` (or to the candidate file if they are still provisional).
2. Review low- and medium-confidence candidates in the UI, export the decisions, and establish a deliberate reconciliation process for approved exports.
3. Correct duplicate/non-contiguous sequences in the source workbooks after confirming the intended pickup order, then regenerate and inspect `data/routes.json`.
4. Add focused automated tests for time normalization, source precedence, workbook parsing, school placement, exact-name behavior, and path traversal rejection.
5. Decide whether denied markers should remain visible and whether bounds should exclude them; document or change the behavior consistently.
6. If the app grows beyond single-browser review, design shared persistence/import before changing the current local-storage schema.

## Assumptions and uncertainty

No prior conversation history beyond the request to create this handoff was available in this session. “Currently working on” is therefore inferred from the checked-in review UI, candidate files, unresolved records, and repository timestamps—not from an explicit roadmap. No hosting target, production environment, required Node version, ownership model for location approval, or intended treatment of duplicate sequences is documented in the repository.
