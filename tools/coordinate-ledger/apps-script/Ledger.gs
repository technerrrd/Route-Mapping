var EVENT_SHEET_NAME = "coordinate_events";
var CURRENT_SHEET_NAME = "current_coordinates";
var EVENT_HEADERS = [
  "event_id", "batch_id", "route_id", "sequence", "stop_name",
  "previous_lat", "previous_lng", "new_lat", "new_lng",
  "device_saved_at", "server_received_at", "source_data_revision",
  "git_pr_url", "git_commit_sha"
];
var CURRENT_HEADERS = [
  "route_id", "sequence", "stop_name", "lat", "lng", "event_id",
  "device_saved_at", "server_received_at", "source_data_revision",
  "git_pr_url", "git_commit_sha"
];

function setupLedger() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error("Run setupLedger from the Apps Script project bound to the destination Google Sheet.");
  }

  var properties = PropertiesService.getScriptProperties();
  properties.setProperty("SPREADSHEET_ID", spreadsheet.getId());
  if (!properties.getProperty("SOURCE_DATA_REVISION")) {
    properties.setProperty("SOURCE_DATA_REVISION", "unversioned");
  }
  if (!properties.getProperty("LAST_GIT_SYNC_STATUS")) {
    properties.setProperty("LAST_GIT_SYNC_STATUS", "not_configured");
  }

  var eventSheet = ensureSheet_(spreadsheet, EVENT_SHEET_NAME, EVENT_HEADERS);
  var currentSheet = ensureSheet_(spreadsheet, CURRENT_SHEET_NAME, CURRENT_HEADERS);
  configureSheet_(eventSheet, EVENT_HEADERS.length, "Append-only coordinate history");
  configureSheet_(currentSheet, CURRENT_HEADERS.length, "Generated current-coordinate view");
  ensureSyncTrigger_();
  refreshCurrentCoordinates();

  return {
    spreadsheetId: spreadsheet.getId(),
    eventSheet: EVENT_SHEET_NAME,
    currentSheet: CURRENT_SHEET_NAME,
    trigger: "syncGitHub every five minutes"
  };
}

function appendCoordinateBatch(payload) {
  var validation = validateBatch_(payload);
  if (!validation.valid) {
    return {
      sheetSaved: false,
      batchId: payload && payload.batchId ? String(payload.batchId) : "",
      acceptedEventIds: [],
      duplicateEventIds: [],
      validationFailures: validation.errors,
      gitSync: getGitSyncStatus_()
    };
  }

  return withLedgerLock_(function () {
    var sheet = getSpreadsheet_().getSheetByName(EVENT_SHEET_NAME);
    assertSheetHeaders_(sheet, EVENT_HEADERS);
    var records = readEventRecords_(sheet);
    var existingIds = records.map(function (record) { return record.eventId; });
    var partition = partitionNewEvents_(validation.value.events, existingIds);
    var receivedAt = new Date().toISOString();

    if (partition.newEvents.length) {
      var rows = partition.newEvents.map(function (event) {
        return [
          event.eventId,
          validation.value.batchId,
          event.routeId,
          event.sequence,
          event.stopName,
          event.previousLat === null ? "" : event.previousLat,
          event.previousLng === null ? "" : event.previousLng,
          event.newLat,
          event.newLng,
          event.savedAt,
          receivedAt,
          event.sourceDataRevision,
          "",
          ""
        ];
      });
      var startRow = sheet.getLastRow() + 1;
      ensureRowCapacity_(sheet, startRow + rows.length - 1);
      sheet.getRange(startRow, 1, rows.length, EVENT_HEADERS.length).setValues(rows);
    }

    refreshCurrentCoordinatesUnlocked_();
    var properties = PropertiesService.getScriptProperties();
    properties.setProperty("LAST_GIT_SYNC_STATUS", "pending");
    properties.deleteProperty("LAST_GIT_SYNC_ERROR");

    return {
      sheetSaved: true,
      batchId: validation.value.batchId,
      acceptedEventIds: partition.newEvents.map(function (event) { return event.eventId; }),
      duplicateEventIds: partition.duplicateIds,
      validationFailures: [],
      gitSync: getGitSyncStatus_()
    };
  });
}

function getLedgerBootstrap() {
  var spreadsheet = getSpreadsheet_();
  var eventSheet = spreadsheet.getSheetByName(EVENT_SHEET_NAME);
  if (!eventSheet) {
    throw new Error("The ledger is not initialized. Run setupLedger first.");
  }
  var records = readEventRecords_(eventSheet);
  var current = deriveCurrentCoordinates_(records);
  var historyLimit = Number(PropertiesService.getScriptProperties().getProperty("HISTORY_LIMIT") || 500);
  var history = records.slice(Math.max(0, records.length - historyLimit)).reverse();

  return {
    sourceDataRevision: PropertiesService.getScriptProperties().getProperty("SOURCE_DATA_REVISION") || "unversioned",
    currentCoordinates: current.map(publicEventRecord_),
    history: history.map(publicEventRecord_),
    gitSync: getGitSyncStatus_()
  };
}

function refreshCurrentCoordinates() {
  return withLedgerLock_(refreshCurrentCoordinatesUnlocked_);
}

function refreshCurrentCoordinatesUnlocked_() {
  var spreadsheet = getSpreadsheet_();
  var eventSheet = spreadsheet.getSheetByName(EVENT_SHEET_NAME);
  var currentSheet = spreadsheet.getSheetByName(CURRENT_SHEET_NAME);
  if (!eventSheet || !currentSheet) throw new Error("Run setupLedger before refreshing coordinates.");

  var current = deriveCurrentCoordinates_(readEventRecords_(eventSheet));
  if (currentSheet.getLastRow() > 1) {
    currentSheet.getRange(2, 1, currentSheet.getLastRow() - 1, CURRENT_HEADERS.length).clearContent();
  }
  if (current.length) {
    var rows = current.map(function (record) {
      return [
        record.routeId, record.sequence, record.stopName, record.newLat, record.newLng,
        record.eventId, record.savedAt, record.serverReceivedAt, record.sourceDataRevision,
        record.gitPrUrl || "", record.gitCommitSha || ""
      ];
    });
    ensureRowCapacity_(currentSheet, rows.length + 1);
    currentSheet.getRange(2, 1, rows.length, CURRENT_HEADERS.length).setValues(rows);
  }
  return { currentCoordinateCount: current.length };
}

function getCurrentCoordinateRecords_() {
  var sheet = getSpreadsheet_().getSheetByName(EVENT_SHEET_NAME);
  return deriveCurrentCoordinates_(readEventRecords_(sheet));
}

function markCurrentEventsExported_(eventIds, prUrl, commitSha) {
  if (!eventIds || !eventIds.length) return;
  withLedgerLock_(function () {
    var sheet = getSpreadsheet_().getSheetByName(EVENT_SHEET_NAME);
    var rowCount = Math.max(0, sheet.getLastRow() - 1);
    if (!rowCount) return;
    var ids = sheet.getRange(2, 1, rowCount, 1).getValues();
    var gitValues = sheet.getRange(2, 13, rowCount, 2).getValues();
    var targetIds = {};
    eventIds.forEach(function (id) { targetIds[id] = true; });
    ids.forEach(function (row, index) {
      if (targetIds[String(row[0])]) {
        gitValues[index][0] = prUrl || "";
        gitValues[index][1] = commitSha || "";
      }
    });
    sheet.getRange(2, 13, rowCount, 2).setValues(gitValues);
    refreshCurrentCoordinatesUnlocked_();
  });
}

function readEventRecords_(sheet) {
  if (!sheet) return [];
  assertSheetHeaders_(sheet, EVENT_HEADERS);
  var rowCount = Math.max(0, sheet.getLastRow() - 1);
  if (!rowCount) return [];
  return sheet.getRange(2, 1, rowCount, EVENT_HEADERS.length).getValues().map(function (row, index) {
    return {
      eventId: String(row[0]),
      batchId: String(row[1]),
      routeId: String(row[2]),
      sequence: Number(row[3]),
      stopName: String(row[4]),
      previousLat: row[5] === "" ? null : Number(row[5]),
      previousLng: row[6] === "" ? null : Number(row[6]),
      newLat: Number(row[7]),
      newLng: Number(row[8]),
      savedAt: dateCellToIso_(row[9]),
      serverReceivedAt: dateCellToIso_(row[10]),
      sourceDataRevision: String(row[11]),
      gitPrUrl: String(row[12] || ""),
      gitCommitSha: String(row[13] || ""),
      _rowNumber: index + 2
    };
  });
}

function publicEventRecord_(record) {
  return {
    eventId: record.eventId,
    batchId: record.batchId,
    routeId: record.routeId,
    sequence: record.sequence,
    stopName: record.stopName,
    previousLat: record.previousLat,
    previousLng: record.previousLng,
    newLat: record.newLat,
    newLng: record.newLng,
    savedAt: record.savedAt,
    serverReceivedAt: record.serverReceivedAt,
    sourceDataRevision: record.sourceDataRevision,
    gitPrUrl: record.gitPrUrl,
    gitCommitSha: record.gitCommitSha
  };
}

function getGitSyncStatus_() {
  var properties = PropertiesService.getScriptProperties();
  return {
    status: properties.getProperty("LAST_GIT_SYNC_STATUS") || "not_configured",
    lastAttemptAt: properties.getProperty("LAST_GIT_SYNC_AT") || "",
    error: properties.getProperty("LAST_GIT_SYNC_ERROR") || "",
    pullRequestUrl: properties.getProperty("ROLLING_PR_URL") || ""
  };
}

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("SPREADSHEET_ID is missing. Run setupLedger from the bound Sheet.");
  return SpreadsheetApp.openById(id);
}

function ensureSheet_(spreadsheet, name, headers) {
  var sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  assertSheetHeaders_(sheet, headers);
  return sheet;
}

function configureSheet_(sheet, columnCount, description) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, columnCount)
    .setFontWeight("bold")
    .setBackground("#e8eef9")
    .setWrap(true);
  if (!sheet.getFilter() && sheet.getMaxRows() > 1) {
    sheet.getRange(1, 1, sheet.getMaxRows(), columnCount).createFilter();
  }
  var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  var existing = protections.some(function (protection) { return protection.getDescription() === description; });
  if (!existing) sheet.protect().setDescription(description).setWarningOnly(true);
  sheet.autoResizeColumns(1, columnCount);
}

function ensureSyncTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === "syncGitHub";
  });
  if (!exists) ScriptApp.newTrigger("syncGitHub").timeBased().everyMinutes(5).create();
}

function ensureRowCapacity_(sheet, requiredLastRow) {
  if (requiredLastRow > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), requiredLastRow - sheet.getMaxRows());
  }
}

function assertSheetHeaders_(sheet, expectedHeaders) {
  if (!sheet) throw new Error("Required ledger sheet is missing.");
  var actual = sheet.getRange(1, 1, 1, expectedHeaders.length).getValues()[0].map(String);
  if (JSON.stringify(actual) !== JSON.stringify(expectedHeaders)) {
    throw new Error("Unexpected columns in " + sheet.getName() + ". Do not manually change ledger headers.");
  }
}

function withLedgerLock_(callback) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function dateCellToIso_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]") return value.toISOString();
  return String(value || "");
}
