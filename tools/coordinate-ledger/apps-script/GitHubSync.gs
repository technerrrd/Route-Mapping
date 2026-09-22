var ROLLING_BRANCH_PREFIX = "coordinate-ledger/";

function syncGitHub() {
  var properties = PropertiesService.getScriptProperties();
  properties.setProperty("LAST_GIT_SYNC_AT", new Date().toISOString());
  try {
    var result = syncGitHub_();
    return result;
  } catch (error) {
    properties.setProperty("LAST_GIT_SYNC_STATUS", "failed");
    properties.setProperty("LAST_GIT_SYNC_ERROR", safeErrorMessage_(error));
    console.error(error && error.stack ? error.stack : error);
    throw error;
  }
}

function syncGitHub_() {
  var config = getGitHubConfig_();
  if (!config) {
    return { status: "not_configured", pullRequestUrl: "", commitSha: "" };
  }
  var current = getCurrentCoordinateRecords_();
  var properties = PropertiesService.getScriptProperties();
  var openPr = findOpenRollingPr_(config);
  var defaultFile = getRepositoryFile_(config, config.overridesPath, config.defaultBranch);
  if (!defaultFile) throw new Error("Missing " + config.overridesPath + " on " + config.defaultBranch + ".");
  var baseOverrides = parseOverrides_(defaultFile.content);
  var document = buildOverridesDocument_(current, baseOverrides);
  var targetContent = JSON.stringify(document, null, 2) + "\n";
  var branch;
  var pr;
  var file;
  var commitSha;

  if (!current.length && !openPr) {
    properties.deleteProperty("ROLLING_PR_BRANCH");
    properties.deleteProperty("ROLLING_PR_URL");
    setGitSuccessStatus_("up_to_date", "", getBranchHeadSha_(config, config.defaultBranch));
    return { status: "up_to_date", pullRequestUrl: "", commitSha: "" };
  }

  if (openPr) {
    pr = openPr;
    branch = pr.head.ref;
    file = getRepositoryFile_(config, config.overridesPath, branch);
    if (!file) throw new Error("Missing " + config.overridesPath + " on rolling branch " + branch + ".");
    if (file.content !== targetContent) {
      commitSha = putRepositoryFile_(config, config.overridesPath, branch, targetContent, file.sha);
    } else {
      commitSha = getBranchHeadSha_(config, branch);
    }
    pr = updatePullRequest_(config, pr.number, current);
  } else {
    var defaultHeadSha = getBranchHeadSha_(config, config.defaultBranch);
    if (defaultFile.content === targetContent) {
      properties.deleteProperty("ROLLING_PR_BRANCH");
      properties.deleteProperty("ROLLING_PR_URL");
      setGitSuccessStatus_("up_to_date", "", defaultHeadSha);
      markCurrentEventsExported_(current.map(function (record) { return record.eventId; }), "", defaultHeadSha);
      return { status: "up_to_date", pullRequestUrl: "", commitSha: defaultHeadSha };
    }

    branch = createRollingBranch_(config, defaultHeadSha);
    file = getRepositoryFile_(config, config.overridesPath, branch);
    commitSha = putRepositoryFile_(config, config.overridesPath, branch, targetContent, file && file.sha);
    pr = createPullRequest_(config, branch, current);
  }

  properties.setProperty("ROLLING_PR_BRANCH", branch);
  properties.setProperty("ROLLING_PR_URL", pr.html_url);
  markCurrentEventsExported_(current.map(function (record) { return record.eventId; }), pr.html_url, commitSha);

  var latestContent = JSON.stringify(buildOverridesDocument_(getCurrentCoordinateRecords_(), baseOverrides), null, 2) + "\n";
  var finalStatus = latestContent === targetContent ? "synced" : "pending";
  setGitSuccessStatus_(finalStatus, pr.html_url, commitSha);
  return { status: finalStatus, pullRequestUrl: pr.html_url, commitSha: commitSha };
}

function getGitHubConfig_() {
  var properties = PropertiesService.getScriptProperties();
  var config = {
    token: properties.getProperty("GITHUB_TOKEN") || "",
    owner: properties.getProperty("GITHUB_OWNER") || "",
    repo: properties.getProperty("GITHUB_REPO") || "",
    defaultBranch: properties.getProperty("GITHUB_DEFAULT_BRANCH") || "main",
    overridesPath: properties.getProperty("GITHUB_OVERRIDES_PATH") || "route-overrides.json"
  };
  var missing = [];
  ["token", "owner", "repo"].forEach(function (key) { if (!config[key]) missing.push(key); });
  if (missing.length) {
    PropertiesService.getScriptProperties().setProperty("LAST_GIT_SYNC_STATUS", "not_configured");
    PropertiesService.getScriptProperties().setProperty("LAST_GIT_SYNC_ERROR", "Missing: " + missing.join(", "));
    return null;
  }
  return config;
}

function findOpenRollingPr_(config) {
  var storedBranch = PropertiesService.getScriptProperties().getProperty("ROLLING_PR_BRANCH");
  var path = "/repos/" + encodeURIComponent(config.owner) + "/" + encodeURIComponent(config.repo) +
    "/pulls?state=open&base=" + encodeURIComponent(config.defaultBranch) + "&per_page=100";
  var pulls = githubRequest_(config, "get", path, null, [200]).data;
  var candidates = pulls.filter(function (pull) {
    return pull.head && pull.head.ref && pull.head.ref.indexOf(ROLLING_BRANCH_PREFIX) === 0;
  });
  if (storedBranch) {
    var stored = candidates.filter(function (pull) { return pull.head.ref === storedBranch; })[0];
    if (stored) return stored;
  }
  candidates.sort(function (a, b) { return Number(b.number) - Number(a.number); });
  return candidates[0] || null;
}

function createRollingBranch_(config, baseSha) {
  var stamp = Utilities.formatDate(new Date(), "UTC", "yyyyMMdd-HHmmss");
  var suffix = Utilities.getUuid().slice(0, 8);
  var branch = ROLLING_BRANCH_PREFIX + stamp + "-" + suffix;
  var path = "/repos/" + encodeURIComponent(config.owner) + "/" + encodeURIComponent(config.repo) + "/git/refs";
  githubRequest_(config, "post", path, { ref: "refs/heads/" + branch, sha: baseSha }, [201]);
  return branch;
}

function createPullRequest_(config, branch, currentRecords) {
  var path = "/repos/" + encodeURIComponent(config.owner) + "/" + encodeURIComponent(config.repo) + "/pulls";
  return githubRequest_(config, "post", path, {
    title: "Update reviewed route coordinates",
    head: branch,
    base: config.defaultBranch,
    body: pullRequestBody_(currentRecords, config.overridesPath)
  }, [201]).data;
}

function updatePullRequest_(config, number, currentRecords) {
  var path = "/repos/" + encodeURIComponent(config.owner) + "/" + encodeURIComponent(config.repo) + "/pulls/" + number;
  return githubRequest_(config, "patch", path, {
    title: "Update reviewed route coordinates",
    body: pullRequestBody_(currentRecords, config.overridesPath)
  }, [200]).data;
}

function pullRequestBody_(currentRecords, overridesPath) {
  var latestTimestamp = "";
  currentRecords.forEach(function (record) {
    if (String(record.serverReceivedAt || "") > latestTimestamp) {
      latestTimestamp = String(record.serverReceivedAt || "");
    }
  });
  return [
    "Automated coordinate snapshot from the private Google Sheets ledger.",
    "",
    "- Current reviewed coordinates: " + currentRecords.length,
    "- Ledger snapshot: " + (latestTimestamp || "empty"),
    "- Generated file: `" + overridesPath + "`",
    "",
    "The Sheet remains the complete append-only history. Merging this PR publishes its latest-coordinate snapshot."
  ].join("\n");
}

function parseOverrides_(content) {
  var value = JSON.parse(content);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("route-overrides.json must be an object keyed by exact stop name.");
  }
  return value;
}

function getRepositoryFile_(config, filePath, ref) {
  var path = "/repos/" + encodeURIComponent(config.owner) + "/" + encodeURIComponent(config.repo) +
    "/contents/" + encodePath_(filePath) + "?ref=" + encodeURIComponent(ref);
  var response = githubRequest_(config, "get", path, null, [200, 404]);
  if (response.status === 404) return null;
  var raw = String(response.data.content || "").replace(/\s/g, "");
  return {
    sha: response.data.sha,
    content: Utilities.newBlob(Utilities.base64Decode(raw)).getDataAsString("UTF-8")
  };
}

function putRepositoryFile_(config, filePath, branch, content, existingSha) {
  var path = "/repos/" + encodeURIComponent(config.owner) + "/" + encodeURIComponent(config.repo) +
    "/contents/" + encodePath_(filePath);
  var body = {
    message: "chore: sync reviewed coordinates",
    content: Utilities.base64Encode(content, Utilities.Charset.UTF_8),
    branch: branch
  };
  if (existingSha) body.sha = existingSha;
  var response = githubRequest_(config, "put", path, body, [200, 201]);
  return response.data.commit.sha;
}

function getBranchHeadSha_(config, branch) {
  var path = "/repos/" + encodeURIComponent(config.owner) + "/" + encodeURIComponent(config.repo) +
    "/git/ref/heads/" + encodePath_(branch);
  return githubRequest_(config, "get", path, null, [200]).data.object.sha;
}

function githubRequest_(config, method, path, body, expectedStatuses) {
  var options = {
    method: method,
    muteHttpExceptions: true,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + config.token,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  };
  if (body !== null && body !== undefined) {
    options.contentType = "application/json";
    options.payload = JSON.stringify(body);
  }
  var response = UrlFetchApp.fetch("https://api.github.com" + path, options);
  var status = response.getResponseCode();
  var text = response.getContentText();
  var data = text ? JSON.parse(text) : null;
  if (expectedStatuses.indexOf(status) === -1) {
    var detail = data && data.message ? data.message : text.slice(0, 500);
    throw new Error("GitHub API " + method.toUpperCase() + " " + path + " returned " + status + ": " + detail);
  }
  return { status: status, data: data };
}

function setGitSuccessStatus_(status, prUrl, commitSha) {
  var properties = PropertiesService.getScriptProperties();
  properties.setProperty("LAST_GIT_SYNC_STATUS", status);
  properties.setProperty("LAST_GIT_SYNC_AT", new Date().toISOString());
  properties.deleteProperty("LAST_GIT_SYNC_ERROR");
  if (prUrl) properties.setProperty("ROLLING_PR_URL", prUrl);
  properties.setProperty("LAST_GIT_COMMIT_SHA", commitSha || "");
}

function encodePath_(path) {
  return String(path).split("/").map(encodeURIComponent).join("/");
}

function safeErrorMessage_(error) {
  var message = error && error.message ? error.message : String(error);
  return message.slice(0, 1000);
}
