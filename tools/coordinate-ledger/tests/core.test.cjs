const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "apps-script", "Core.gs"), "utf8");
const context = vm.createContext({ console });
vm.runInContext(source + `
  this.core = {
    validateBatch_,
    partitionNewEvents_,
    deriveCurrentCoordinates_,
    buildOverridesDocument_,
    coordinateKey_
  };
`, context);
const core = context.core;

function event(overrides = {}) {
  return {
    eventId: "evt-12345678",
    routeId: "route-7",
    sequence: 4,
    stopName: "Old Station Road",
    previousLat: 27.56611,
    previousLng: 76.61092,
    newLat: 27.56789,
    newLng: 76.61234,
    savedAt: "2026-09-22T12:15:00.000Z",
    sourceDataRevision: "abc123",
    ...overrides
  };
}

test("validates and normalizes a complete push batch", () => {
  const result = core.validateBatch_({ batchId: "batch-12345678", events: [event()] });
  assert.equal(result.valid, true);
  assert.equal(result.value.events[0].newLat, 27.56789);
  assert.equal(result.value.events[0].savedAt, "2026-09-22T12:15:00.000Z");
});

test("rejects the whole batch when any coordinate is invalid", () => {
  const result = core.validateBatch_({
    batchId: "batch-12345678",
    events: [event(), event({ eventId: "evt-87654321", newLat: 91 })]
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /newLat/);
});

test("requires previous latitude and longitude as a pair", () => {
  const result = core.validateBatch_({
    batchId: "batch-12345678",
    events: [event({ previousLng: null })]
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /both be supplied/);
});

test("rejects missing or invalid numeric values instead of coercing them to zero", () => {
  for (const changed of [
    { newLat: null },
    { newLng: "" },
    { sequence: "" },
    { previousLat: "abc", previousLng: "" }
  ]) {
    const result = core.validateBatch_({ batchId: "batch-12345678", events: [event(changed)] });
    assert.equal(result.valid, false, JSON.stringify(changed));
  }
});

test("deduplicates both stored IDs and repeated IDs within a retry", () => {
  const first = event();
  const second = event({ eventId: "evt-87654321" });
  const result = core.partitionNewEvents_([first, second, second], [first.eventId]);
  assert.deepEqual(Array.from(result.newEvents, (item) => item.eventId), [second.eventId]);
  assert.deepEqual(Array.from(result.duplicateIds), [first.eventId, second.eventId]);
});

test("derives the newest server-received event for each exact stop key", () => {
  const older = event({ serverReceivedAt: "2026-09-22T12:20:00.000Z", _rowNumber: 2 });
  const newer = event({ eventId: "evt-87654321", newLat: 28, serverReceivedAt: "2026-09-22T12:21:00.000Z", _rowNumber: 3 });
  const anotherStop = event({ eventId: "evt-abcdefgh", stopName: "Market", serverReceivedAt: "2026-09-22T12:22:00.000Z", _rowNumber: 4 });
  const result = core.deriveCurrentCoordinates_([newer, anotherStop, older]);
  assert.equal(result.length, 2);
  assert.equal(result.find((item) => item.stopName === "Old Station Road").newLat, 28);
});

test("uses row order to preserve multiple saves received in one batch", () => {
  const first = event({ serverReceivedAt: "2026-09-22T12:20:00.000Z", _rowNumber: 2 });
  const second = event({ eventId: "evt-87654321", newLng: 77, serverReceivedAt: "2026-09-22T12:20:00.000Z", _rowNumber: 3 });
  const result = core.deriveCurrentCoordinates_([first, second]);
  assert.equal(result[0].newLng, 77);
});

test("builds the repository's exact-name override map without losing existing entries", () => {
  const current = [event({ serverReceivedAt: "2026-09-22T12:20:00.000Z", _rowNumber: 2 })];
  const existing = {
    "Old Station Road": { lat: 1, lng: 2, confidence: "low", source: "candidate" },
    "V.L Memorial Public School": { lat: 27.6252383, lng: 76.6070767, source: "manual" }
  };
  const first = core.buildOverridesDocument_(current, existing);
  const second = core.buildOverridesDocument_(current, existing);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first["Old Station Road"].lat, 27.56789);
  assert.equal(first["Old Station Road"].source, "coordinate-ledger");
  assert.equal(first["V.L Memorial Public School"].lat, 27.6252383);
  assert.equal(existing["Old Station Road"].lat, 1);
});

test("rejects route-specific coordinate conflicts that cannot fit the repository schema", () => {
  const current = [
    event({ serverReceivedAt: "2026-09-22T12:20:00.000Z", _rowNumber: 2 }),
    event({ routeId: "route-8", newLat: 28, serverReceivedAt: "2026-09-22T12:21:00.000Z", _rowNumber: 3 })
  ];
  assert.throws(() => core.buildOverridesDocument_(current, {}), /Conflicting current coordinates/);
});
