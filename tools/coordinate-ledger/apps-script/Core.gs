var LEDGER_SCHEMA_VERSION = 1;
var MAX_BATCH_SIZE = 500;

function validateBatch_(payload) {
  var errors = [];
  var normalized = { batchId: "", events: [] };

  if (!payload || typeof payload !== "object") {
    return { valid: false, errors: ["The push payload must be an object."], value: normalized };
  }

  normalized.batchId = cleanIdentifier_(payload.batchId);
  if (!normalized.batchId) {
    errors.push("batchId is required and must be 8-128 safe identifier characters.");
  }

  if (!Array.isArray(payload.events) || payload.events.length === 0) {
    errors.push("events must contain at least one coordinate event.");
  } else if (payload.events.length > MAX_BATCH_SIZE) {
    errors.push("A batch cannot contain more than " + MAX_BATCH_SIZE + " events.");
  } else {
    payload.events.forEach(function (event, index) {
      var result = validateEvent_(event, index);
      if (result.errors.length) {
        errors = errors.concat(result.errors);
      } else {
        normalized.events.push(result.value);
      }
    });
  }

  return { valid: errors.length === 0, errors: errors, value: normalized };
}

function validateEvent_(event, index) {
  var prefix = "events[" + index + "]";
  var errors = [];
  var value = {};

  if (!event || typeof event !== "object") {
    return { errors: [prefix + " must be an object."], value: value };
  }

  value.eventId = cleanIdentifier_(event.eventId);
  if (!value.eventId) errors.push(prefix + ".eventId is invalid.");

  value.routeId = cleanText_(event.routeId, 160);
  if (!value.routeId) errors.push(prefix + ".routeId is required.");

  value.sequence = event.sequence === "" || event.sequence === null || event.sequence === undefined
    ? NaN : Number(event.sequence);
  if (!Number.isInteger(value.sequence) || value.sequence < 0) {
    errors.push(prefix + ".sequence must be a non-negative integer.");
  }

  value.stopName = cleanText_(event.stopName, 240);
  if (!value.stopName) errors.push(prefix + ".stopName is required.");

  value.previousLat = nullableNumber_(event.previousLat);
  value.previousLng = nullableNumber_(event.previousLng);
  if (hasSuppliedValue_(event.previousLat) && value.previousLat === null) {
    errors.push(prefix + ".previousLat must be a finite number.");
  }
  if (hasSuppliedValue_(event.previousLng) && value.previousLng === null) {
    errors.push(prefix + ".previousLng must be a finite number.");
  }
  var hasPreviousLat = value.previousLat !== null;
  var hasPreviousLng = value.previousLng !== null;
  if (hasPreviousLat !== hasPreviousLng) {
    errors.push(prefix + ".previousLat and previousLng must both be supplied or both be empty.");
  } else if (hasPreviousLat) {
    if (!validLatitude_(value.previousLat)) errors.push(prefix + ".previousLat is outside -90..90.");
    if (!validLongitude_(value.previousLng)) errors.push(prefix + ".previousLng is outside -180..180.");
  }

  value.newLat = nullableNumber_(event.newLat);
  value.newLng = nullableNumber_(event.newLng);
  if (!validLatitude_(value.newLat)) errors.push(prefix + ".newLat is outside -90..90.");
  if (!validLongitude_(value.newLng)) errors.push(prefix + ".newLng is outside -180..180.");

  value.savedAt = cleanIsoDate_(event.savedAt);
  if (!value.savedAt) errors.push(prefix + ".savedAt must be an ISO date.");

  value.sourceDataRevision = cleanText_(event.sourceDataRevision, 200);
  if (!value.sourceDataRevision) errors.push(prefix + ".sourceDataRevision is required.");

  return { errors: errors, value: value };
}

function partitionNewEvents_(events, existingEventIds) {
  var seen = {};
  (existingEventIds || []).forEach(function (id) { seen[id] = true; });
  var newEvents = [];
  var duplicateIds = [];

  events.forEach(function (event) {
    if (seen[event.eventId]) {
      duplicateIds.push(event.eventId);
      return;
    }
    seen[event.eventId] = true;
    newEvents.push(event);
  });

  return { newEvents: newEvents, duplicateIds: duplicateIds };
}

function deriveCurrentCoordinates_(eventRecords) {
  var latestByStop = {};
  (eventRecords || []).forEach(function (record) {
    var key = coordinateKey_(record.routeId, record.sequence, record.stopName);
    var current = latestByStop[key];
    if (!current || compareEventOrder_(record, current) > 0) {
      latestByStop[key] = record;
    }
  });

  return Object.keys(latestByStop).map(function (key) {
    return latestByStop[key];
  }).sort(compareStopOrder_);
}

function buildOverridesDocument_(currentRecords, existingOverrides) {
  var overrides = {};
  var source = existingOverrides || {};
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("route-overrides.json must be an object keyed by exact stop name.");
  }
  Object.keys(source).forEach(function (name) {
    var entry = source[name];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Invalid existing override for " + name + ".");
    }
    overrides[name] = entry;
  });

  var latestByName = {};
  (currentRecords || []).forEach(function (record) {
    var name = String(record.stopName);
    var prior = latestByName[name];
    if (prior && (Number(prior.newLat) !== Number(record.newLat) || Number(prior.newLng) !== Number(record.newLng))) {
      throw new Error("Conflicting current coordinates for exact stop name: " + name);
    }
    if (!prior || compareEventOrder_(record, prior) > 0) latestByName[name] = record;
  });

  Object.keys(latestByName).forEach(function (name) {
    var record = latestByName[name];
    var existing = overrides[name] || {};
    overrides[name] = Object.assign({}, existing, {
      lat: Number(record.newLat),
      lng: Number(record.newLng),
      confidence: "reviewed",
      source: "coordinate-ledger",
      note: "Reviewed coordinate saved in Google Sheets; event " + record.eventId
    });
  });

  return overrides;
}

function compareEventOrder_(a, b) {
  var timeA = String(a.serverReceivedAt || "");
  var timeB = String(b.serverReceivedAt || "");
  if (timeA < timeB) return -1;
  if (timeA > timeB) return 1;
  return Number(a._rowNumber || 0) - Number(b._rowNumber || 0);
}

function compareStopOrder_(a, b) {
  var route = String(a.routeId).localeCompare(String(b.routeId));
  if (route) return route;
  var sequence = Number(a.sequence) - Number(b.sequence);
  if (sequence) return sequence;
  return String(a.stopName).localeCompare(String(b.stopName));
}

function coordinateKey_(routeId, sequence, stopName) {
  return String(routeId) + "\u001f" + String(sequence) + "\u001f" + String(stopName);
}

function cleanIdentifier_(value) {
  var text = String(value == null ? "" : value).trim();
  return /^[A-Za-z0-9._:-]{8,128}$/.test(text) ? text : "";
}

function cleanText_(value, maxLength) {
  var text = String(value == null ? "" : value).trim();
  if (!text || text.length > maxLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) return "";
  return text;
}

function nullableNumber_(value) {
  if (!hasSuppliedValue_(value)) return null;
  var number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasSuppliedValue_(value) {
  return value !== null && value !== undefined && value !== "" &&
    !(typeof value === "string" && value.trim() === "");
}

function validLatitude_(value) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function validLongitude_(value) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function cleanIsoDate_(value) {
  var text = String(value == null ? "" : value).trim();
  if (!text || !Number.isFinite(Date.parse(text))) return "";
  return new Date(text).toISOString();
}
