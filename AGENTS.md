# Route Map Gallery

## Purpose and goals

This repository turns `Route-*.xls`/`Route-*.xlsx` school-bus schedules into a local, interactive Leaflet map gallery. Its main goals are to keep the spreadsheets easy to update, give every stop a reviewable candidate coordinate, always end each route at V.L Memorial Public School, and let a user confirm, deny, adjust, and export location decisions in the browser.

## Architecture

- `scripts/build-routes.mjs` is the data pipeline. It reads the first sheet of every root-level route workbook, resolves coordinates, writes `data/routes.json`, and copies Leaflet distribution files into `vendor/leaflet/`.
- `index.html`, `styles.css`, and `app.js` are a framework-free static client. `app.js` loads `data/routes.json`, renders Leaflet markers and straight-line route polylines, and stores review decisions in browser `localStorage` under `route-map-location-reviews-v1`.
- `scripts/serve.mjs` is a small static HTTP server. There is no backend or database.

## Important files and data

- `Route-*.xls[x]`: authoritative route names, stop names, sequence, pickup time, and drop time. Expected headers are `Route Name`, `Stop Name`, `Sequence`, `Pickup Time`, and `Drop Time`; the current files also have `Id`.
- `route-overrides.json`: hand-maintained, exact-stop-name coordinate overrides; these win over all other coordinate sources.
- `google-maps-candidates.json`: review candidates, not confirmed locations. The build merges these below `route-overrides.json`.
- `.route-geocode-cache.json`: ignored local Nominatim cache; do not commit it.
- `data/routes.json`: generated runtime data, intentionally committed. Regenerate it rather than editing it by hand.
- `vendor/leaflet/`: generated/copied Leaflet browser assets, intentionally committed so Leaflet itself is local.
- `README.md`: short operator instructions. `docs/CODEX_HANDOFF.md`: detailed current state and open work.

## Stack

Modern JavaScript ES modules, HTML, CSS, Node.js, npm, Leaflet 1.9.4, and SheetJS/xlsx 0.18.5. The browser still needs network access for OpenStreetMap tiles. Node 18+ is recommended because the build uses built-in `fetch` and `AbortSignal.timeout`; no engine is currently pinned.

## Commands

Run all commands from the repository root.

```sh
npm ci
npm start                 # online build, then serve at http://localhost:4173
npm run build             # build and geocode unresolved names through Nominatim
npm run build:offline     # deterministic/private build using local candidate files and cache only
npm run serve             # serve existing files; PORT defaults to 4173
```

There are currently no automated test or lint scripts. Before committing, run:

```sh
npm run build:offline
node --check app.js
node --check scripts/build-routes.mjs
node --check scripts/serve.mjs
```

Then serve the site and smoke-test `/` and `/data/routes.json`. An online build sends unresolved stop names plus the location context to Nominatim, writes the ignored cache, waits between requests, and may be slow. Override the search area with `ROUTE_LOCATION_CONTEXT`; override the server port with `PORT`.

## Conventions and decisions

- Use two-space indentation, semicolons, `const`/`let`, async/await, and small plain functions; preserve the no-framework/no-bundler design unless requirements justify a migration.
- Treat all geocoded and Google-sourced coordinates as candidates until a human reviews them. Preserve `confidence`, `source`, and explanatory `note` fields.
- Coordinate lookup keys are exact spreadsheet stop names and are case-sensitive. Keep spelling changes synchronized across workbooks and candidate/override JSON.
- The build sorts workbooks numerically, sorts stops by source sequence, de-duplicates an existing school stop by normalized name, and appends the school with a new final sequence. Do not remove this invariant casually.
- Browser review decisions are local to that browser. `Export review` downloads `route-location-review.json`; it does not update repository files automatically.
- Escape any spreadsheet-derived text before inserting HTML. Do not add secrets or private credentials to route data, notes, client code, or committed configuration.
- Route lines connect accepted candidate points directly; this project does not currently calculate road-following directions.

## Avoid changing without a good reason

Do not hand-edit generated route data or vendored Leaflet files, promote candidates to confirmed locations without human evidence, commit `.route-geocode-cache.json` or `node_modules/`, remove the final-school rule, rename spreadsheet headers, or change the local review key/schema without planning a migration for existing browser data. Preserve root-relative build assumptions unless all scripts and documentation are updated together.

## Platform and workflow notes

The code is cross-platform, but environment-variable syntax differs: PowerShell uses `$env:PORT=4174; npm run serve`, while POSIX shells use `PORT=4174 npm run serve`. A normal data update is: edit/add a workbook, update exact-name candidates or overrides, run the offline build first, optionally run the online build for unresolved stops, inspect the generated diff, test in the browser, and commit source data plus the regenerated `data/routes.json`/vendor changes together. Keep manual review exports outside the repository until deliberately reconciled into candidate or override data.
