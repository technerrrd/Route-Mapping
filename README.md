# Route map gallery

This project turns the consolidated `All-route-stops.xls` workbook into a selectable route map. Every worksheet is read, and rows are grouped by the exact value in `Route Name`.

`V.L Memorial Public School` is automatically added as the final stop of every route, including routes added later.

The map numbers stops 1, 2, 3… in displayed route order, including the final school stop. The workbook's original `Sequence` values remain in the generated data and review exports, even when the source contains duplicate numbers.

## Use it

1. Replace or edit `All-route-stops.xls` in this folder. Keep the columns `Route Name`, `Stop Name`, `Sequence`, `Pickup Time`, and `Drop Time`.
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

Each save also keeps the previous value for that stop in this browser. Use **Restore previous** on its row to undo the last save; repeat to step back through up to 20 saved versions. This works after reloading the page. The history is local to the same browser and site address, so keep an exported review if you need a backup before clearing browser data or switching devices.

For a stop marked **Needs candidate**, click **Add point** in its review row. The map will scroll into view. Click the pickup location on the OpenStreetMap map, drag the preview marker if needed, then click **Save candidate**. You can also type latitude and longitude into the same panel. **Adjust** uses the same map picker for an existing point. New or moved points remain pending review until confirmed.

Candidate points are available across all routes. Any stop that Google Maps could not identify reliably remains marked **Needs candidate** until coordinates are added to `route-overrides.json`, entered with **Add point**, or obtained during an online build. V.L Memorial Public School is always appended as the final stop and uses the shared school candidate on every route.

Google Maps review candidates are kept separately in `google-maps-candidates.json`. They are loaded as pending candidates, never as confirmed stops. Lower-confidence entries identify neighborhood centers or representative landmarks and should be checked carefully in the website.

An online build sends unresolved stop names and the configured location context to OpenStreetMap's Nominatim search service. Use `npm run build:offline` when you do not want to send names to an external service.

## Private coordinate ledger

The optional [coordinate ledger setup guide](tools/coordinate-ledger/README.md) explains how to save location changes offline, push their history to a private Google Sheet, and maintain a rolling GitHub pull request. It is a separate owner-only review page; the map above continues to use its existing browser review flow.
