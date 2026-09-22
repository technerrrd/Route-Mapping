const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function makeHarness(options = {}) {
  const propertyValues = {};
  const properties = {
    getProperty(key) { return propertyValues[key] || ""; },
    setProperty(key, value) { propertyValues[key] = String(value); },
    deleteProperty(key) { delete propertyValues[key]; }
  };
  const calls = [];
  const current = [{
    eventId: "evt-12345678",
    routeId: "route-7",
    sequence: 4,
    stopName: "Old Station Road",
    newLat: 27.56789,
    newLng: 76.61234,
    savedAt: "2026-09-22T12:15:00.000Z",
    serverReceivedAt: "2026-09-22T12:20:00.000Z",
    sourceDataRevision: "abc123"
  }];
  const context = vm.createContext({
    console,
    PropertiesService: { getScriptProperties: () => properties },
    Utilities: {
      formatDate: () => "20260922-122000",
      getUuid: () => "12345678-0000-0000-0000-000000000000"
    }
  });
  const core = fs.readFileSync(path.join(__dirname, "..", "apps-script", "Core.gs"), "utf8");
  const github = fs.readFileSync(path.join(__dirname, "..", "apps-script", "GitHubSync.gs"), "utf8");
  vm.runInContext(core + "\n" + github, context);

  const config = {
    token: "secret",
    owner: "owner",
    repo: "repo",
    defaultBranch: "main",
    overridesPath: "route-overrides.json"
  };
  context.getGitHubConfig_ = () => config;
  context.getCurrentCoordinateRecords_ = () => current;
  context.findOpenRollingPr_ = () => options.openPr || null;
  context.getRepositoryFile_ = (_config, _path, ref) => {
    if (ref === "main") return options.defaultFile || { sha: "blob-base", content: '{"Existing stop":{"lat":27,"lng":76}}\n' };
    return options.branchFile || { sha: "blob-branch", content: "{}\n" };
  };
  context.getBranchHeadSha_ = (_config, branch) => branch === "main" ? "base-sha" : "branch-sha";
  context.createRollingBranch_ = () => { calls.push("create-branch"); return "coordinate-ledger/new"; };
  context.putRepositoryFile_ = (_config, _path, branch) => { calls.push("put:" + branch); return "new-commit"; };
  context.createPullRequest_ = () => { calls.push("create-pr"); return { number: 41, html_url: "https://example.test/pr/41", head: { ref: "coordinate-ledger/new" } }; };
  context.updatePullRequest_ = (_config, number) => { calls.push("update-pr:" + number); return { number, html_url: "https://example.test/pr/" + number, head: { ref: "coordinate-ledger/existing" } }; };
  context.markCurrentEventsExported_ = (ids, prUrl, sha) => calls.push({ ids: Array.from(ids), prUrl, sha });
  context.setGitSuccessStatus_ = (status, prUrl, sha) => calls.push({ status, prUrl, sha });

  return { context, properties: propertyValues, calls, current };
}

test("creates a new branch and PR when no rolling PR is open", () => {
  const harness = makeHarness();
  const result = harness.context.syncGitHub_();
  assert.equal(result.status, "synced");
  assert.equal(result.pullRequestUrl, "https://example.test/pr/41");
  assert.ok(harness.calls.includes("create-branch"));
  assert.ok(harness.calls.includes("create-pr"));
  assert.equal(harness.properties.ROLLING_PR_BRANCH, "coordinate-ledger/new");
});

test("updates an existing rolling PR instead of opening another", () => {
  const harness = makeHarness({
    openPr: { number: 17, html_url: "https://example.test/pr/17", head: { ref: "coordinate-ledger/existing" } }
  });
  const result = harness.context.syncGitHub_();
  assert.equal(result.pullRequestUrl, "https://example.test/pr/17");
  assert.ok(harness.calls.includes("put:coordinate-ledger/existing"));
  assert.ok(harness.calls.includes("update-pr:17"));
  assert.equal(harness.calls.includes("create-pr"), false);
});

test("does not create a PR when the default branch already matches", () => {
  const harness = makeHarness();
  const target = JSON.stringify(harness.context.buildOverridesDocument_(harness.current, {}), null, 2) + "\n";
  harness.context.getRepositoryFile_ = () => ({ sha: "blob-base", content: target });
  const result = harness.context.syncGitHub_();
  assert.equal(result.status, "up_to_date");
  assert.equal(harness.calls.includes("create-branch"), false);
  assert.equal(harness.calls.includes("create-pr"), false);
});

test("does not open a formatting-only PR for an empty ledger", () => {
  const harness = makeHarness();
  harness.current.length = 0;
  const result = harness.context.syncGitHub_();
  assert.equal(result.status, "up_to_date");
  assert.equal(harness.calls.includes("create-pr"), false);
});

test("treats missing GitHub properties as not configured rather than a trigger failure", () => {
  const values = {};
  const properties = {
    getProperty(key) { return values[key] || ""; },
    setProperty(key, value) { values[key] = String(value); },
    deleteProperty(key) { delete values[key]; }
  };
  const context = vm.createContext({
    console,
    PropertiesService: { getScriptProperties: () => properties }
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "apps-script", "Core.gs"), "utf8") + "\n" +
    fs.readFileSync(path.join(__dirname, "..", "apps-script", "GitHubSync.gs"), "utf8"),
    context
  );
  const result = context.syncGitHub_();
  assert.equal(result.status, "not_configured");
  assert.equal(values.LAST_GIT_SYNC_STATUS, "not_configured");
});
