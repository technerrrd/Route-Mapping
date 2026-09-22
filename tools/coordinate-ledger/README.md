# Set up the private coordinate ledger

This is the setup guide for Route Mapping's optional single-user coordinate review tool. The code is in [`apps-script/`](apps-script/). It has **not** been installed in your Google account by committing it to GitHub; follow the steps below once to create the Sheet and deploy the private page.

The review page is separate from the existing route map. Every **Save offline** adds an event to the browser's IndexedDB. **Push pending** appends those events to Google Sheets. A scheduled Apps Script function updates one GitHub pull request with the latest coordinate for each stop. The Sheet keeps the full history.

## What you need

- The Google account that will own the Sheet and private review page.
- Write access to [`technerrrd/Route-Mapping`](https://github.com/technerrrd/Route-Mapping).
- Node.js 20+ if you use `clasp` to upload the Apps Script files. [Google's clasp guide](https://developers.google.com/apps-script/guides/clasp) explains the command line setup.
- A fine-grained GitHub personal access token limited to this repository, with repository permissions **Contents: Read and write** and **Pull requests: Read and write**. The token is stored only in Apps Script Script Properties. [GitHub's REST permissions guide](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens) lists the required permissions.

## 1. Create the Sheet and Apps Script project

1. Create a blank Google Sheet, for example **Route coordinate ledger**.
2. From that Sheet, choose **Extensions → Apps Script**. This creates a script *bound to the Sheet*, which `setupLedger` requires.
3. Give the script project a recognizable name.
4. In Apps Script **Project Settings**, copy the **Script ID**. This is different from the Sheet ID and the deployment ID.
5. In [Apps Script user settings](https://script.google.com/home/usersettings), enable the **Google Apps Script API** for the account if `clasp` says it is disabled.

## 2. Upload the source code

From a checkout of this repository, open a terminal in `tools/coordinate-ledger`. Create `.clasp.json` from `.clasp.json.example` and replace the placeholder `scriptId` with the Script ID copied above. Keep `rootDir` as `apps-script`. `.clasp.json` is ignored by Git because it is specific to your Google project.

```sh
cd tools/coordinate-ledger
cp .clasp.json.example .clasp.json
# Edit .clasp.json and set your Script ID.
npx @google/clasp login
npx @google/clasp push
```

Sign in to the same Google account that owns the Sheet. The push uploads `Code.gs`, `Core.gs`, `Ledger.gs`, `GitHubSync.gs`, the three HTML files, and `appsscript.json` to the bound script project. Check that these files appear in the Apps Script editor before continuing. If `clasp` asks whether to overwrite the empty starter `Code.gs`, confirm only after checking that the Script ID points to your newly created project.

The files can also be copied into the Apps Script editor manually. Keep the `.gs` and `.html` file names from this folder, and replace the manifest in **Project Settings → Show `appsscript.json` manifest file**.

## 3. Add the GitHub settings

In Apps Script, open **Project Settings → Script Properties** and add:

| Property | Value |
| --- | --- |
| `GITHUB_TOKEN` | Your repository-limited fine-grained token |
| `GITHUB_OWNER` | `technerrrd` |
| `GITHUB_REPO` | `Route-Mapping` |
| `GITHUB_DEFAULT_BRANCH` | `main` |
| `GITHUB_OVERRIDES_PATH` | `route-overrides.json` |
| `SOURCE_DATA_REVISION` | Optional: the current repository commit SHA or another source revision label |

The first five values are needed for Git sync; `SOURCE_DATA_REVISION` defaults to `unversioned`. Do not put the token in `.clasp.json`, a `.gs` or `.html` file, a Sheet cell, or a Git commit. If GitHub rejects a request, check token expiration, repository selection, and permissions in the GitHub token settings.

## 4. Initialize and deploy

1. In the Apps Script editor, select `setupLedger` from the function picker and click **Run**. Approve the Google permissions requested by your own script.
2. Return to the Sheet. You should see `coordinate_events` and `current_coordinates`. The script also records the Sheet ID and installs a five-minute GitHub sync trigger. The first scheduled sync may report **not configured** if the GitHub properties were not set yet; that is safe.
3. In Apps Script choose **Deploy → New deployment → Web app**. Set **Execute as** to **Me** and **Who has access** to **Only myself**. Copy the `/exec` URL and open it while signed in as the owner. The manifest declares the same `MYSELF` and `USER_DEPLOYING` settings; confirm them in the deployment screen. [Google documents these access choices](https://developers.google.com/apps-script/manifest/web-app-api-executable).
4. Keep the private URL for your own use. If you edit script code later, create a new deployment version or update the existing deployment so the `/exec` URL runs the new code. [Google's web app deployment guide](https://developers.google.com/apps-script/guides/web) covers this step.

## 5. Save, push, and publish a coordinate

1. In the private page, enter a route ID, source sequence, and **exact** stop name. Use the values in `data/routes.json` or the route workbooks. The same spelling and capitalization matter because the existing build looks up overrides by exact stop name.
2. Enter the new latitude and longitude. Leave both previous fields empty for an unplaced stop, or fill both for a move. Click **Save offline**. This records one event in IndexedDB on that device.
3. Repeat for more stops, then click **Push pending** while online. Successful rows appear in `coordinate_events`; `current_coordinates` shows the latest server-received row for each route/sequence/stop key. A failed push leaves the local rows pending so you can retry.
4. Wait up to five minutes or select `syncGitHub` in the Apps Script editor and click **Run**. Open the rolling pull request linked from the private page and inspect `route-overrides.json` before merging it. Sync preserves existing overrides and changes the exact stop-name entries covered by the Sheet.
5. After merging, run `npm run build:offline` in the Route Mapping repository, inspect the generated `data/routes.json` diff, and commit it. This repository does **not** currently have a workflow that regenerates route data automatically after a pull request merges.

The private page is a standalone entry form. It is not yet wired into the existing map's drag, **Adjust**, or **Add point** controls. The public map still saves reviews in its own browser `localStorage`. To connect a future map interaction to this ledger, call `window.CoordinateLedger.recordSave(...)` from code running inside the private Apps Script page; the public static page cannot call that function directly.

## How the data is stored

`coordinate_events` is the append-only history. Each row has a unique event UUID, batch UUID, route ID, sequence, stop name, previous/new coordinate, device timestamp, server timestamp, source revision, and the Git PR/commit that last exported the row. Retrying an event UUID does not append a duplicate. Do not manually edit this sheet. `current_coordinates` is regenerated from the history and can be rebuilt with `refreshCurrentCoordinates` in the Apps Script editor.

The existing `route-overrides.json` format is one entry per exact stop name:

```json
{
  "Old Station Road": {
    "lat": 27.56789,
    "lng": 76.61234,
    "confidence": "reviewed",
    "source": "coordinate-ledger",
    "note": "Reviewed coordinate saved in Google Sheets; event …"
  }
}
```

The Git sync keeps existing entries for stops not in the ledger. Since this repository's build uses the **stop name as a global key**, two route-specific current rows with the same exact stop name and different coordinates cannot be represented in `route-overrides.json`; sync reports an error until those entries are reconciled. Every earlier event stays in the Sheet. **Restore** on a history row creates another new local event.

## Check and troubleshoot

Run the local logic tests from `tools/coordinate-ledger`:

```sh
npm test
```

- **The private page will not load:** confirm you opened the `/exec` URL as the deploying Google account. A different account should be denied.
- **Save worked offline but Push failed:** reconnect and press **Push pending** again. Keep the same browser profile and site data; clearing site data deletes unsent IndexedDB events.
- **Saved to Sheet, Git sync pending or failed:** inspect the `syncGitHub` execution in Apps Script and verify the GitHub properties. The scheduled trigger retries without requiring another push.
- **The PR is open but the map still shows old coordinates:** the PR must be merged, `npm run build:offline` must regenerate `data/routes.json`, and that generated file must be committed. Reload the map afterward.
- **A changed stop is missing from the map:** check route ID, source sequence, and exact stop-name spelling against the workbook and `data/routes.json`.
- **The Sheet and GitHub disagree:** treat the Sheet as the coordinate history. Inspect the current row, then rerun `syncGitHub` after fixing the reported error. Do not edit past events.

An already open Apps Script page can record local events while offline. Opening or reloading the private page requires network access. Verify offline persistence in your browser before relying on it for field work.
