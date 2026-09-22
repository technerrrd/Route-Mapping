# Route map gallery

This project turns every `Route-*.xls` or `Route-*.xlsx` file in this folder into a selectable route map.

`V.L Memorial Public School` is automatically added as the final stop of every route, including routes added later.

## Use it

1. Add route workbooks to this folder. Keep the columns `Route Name`, `Stop Name`, `Sequence`, `Pickup Time`, and `Drop Time`.
2. Run `npm install` once.
3. Run `npm start` after adding or changing workbooks.
4. Open `http://localhost:4173`.

The build searches for each stop in the context `Alwar, Rajasthan, India`, caches successful lookups, and shows unplaced stops as **Needs review**. To confirm a difficult location, add its coordinates to `route-overrides.json`:

```json
{
  "Exact stop name from Excel": { "lat": 27.5601, "lng": 76.6250 }
}
```

Set a different search area before building with the `ROUTE_LOCATION_CONTEXT` environment variable.

## Review candidate locations

Each route has a location-review table. Use **Confirm**, **Deny**, or **Adjust** for every candidate point. Decisions are saved in this browser. Use **Export review** to download all decisions and adjusted coordinates as `route-location-review.json`.

Candidate points are available across all routes. Any stop that Google Maps could not identify reliably remains marked **Needs candidate** until coordinates are added to `route-overrides.json`, entered with **Add point**, or obtained during an online build. V.L Memorial Public School is always appended as the final stop and uses the shared school candidate on every route.

Google Maps review candidates are kept separately in `google-maps-candidates.json`. They are loaded as pending candidates, never as confirmed stops. Lower-confidence entries identify neighborhood centers or representative landmarks and should be checked carefully in the website.

An online build sends unresolved stop names and the configured location context to OpenStreetMap's Nominatim search service. Use `npm run build:offline` when you do not want to send names to an external service.
