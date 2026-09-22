import { mkdir, readFile, readdir, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import XLSX from "xlsx";

const root = process.cwd();
const dataDir = join(root, "data");
const cachePath = join(root, ".route-geocode-cache.json");
const overridePath = join(root, "route-overrides.json");
const googleCandidatePath = join(root, "google-maps-candidates.json");
const context = process.env.ROUTE_LOCATION_CONTEXT || "Alwar, Rajasthan, India";
const offline = process.argv.includes("--offline");
const finalStopName = "V.L Memorial Public School";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value) => String(value ?? "").trim();

function normalizeTime(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") {
    const totalMinutes = Math.round(value * 24 * 60) % (24 * 60);
    return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
  }
  const text = clean(value);
  const match = text.match(/(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : text;
}

async function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(await readFile(path, "utf8"));
}

async function geocode(stopName, cache, overrides) {
  const override = overrides[stopName];
  if (override && Number.isFinite(override.lat) && Number.isFinite(override.lng)) {
    return {
      lat: override.lat,
      lng: override.lng,
      source: override.source || "review-candidate",
      confidence: override.confidence || "manual",
      note: override.note || "Manually supplied candidate",
    };
  }
  const key = `${stopName}|${context}`.toLowerCase();
  if (cache[key]) return cache[key];
  if (offline) return { lat: null, lng: null, source: "unresolved" };

  const query = new URLSearchParams({ q: `${stopName}, ${context}`, format: "jsonv2", limit: "1", countrycodes: "in" });
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${query}`, {
      headers: { "User-Agent": "RouteMapGallery/1.0 (local route visualization)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const results = await response.json();
    const first = results[0];
    cache[key] = first ? { lat: Number(first.lat), lng: Number(first.lon), source: "nominatim", displayName: first.display_name } : { lat: null, lng: null, source: "unresolved" };
  } catch (error) {
    console.warn(`Could not geocode ${stopName}: ${error.message}`);
    cache[key] = { lat: null, lng: null, source: "error" };
  }
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
  await pause(1100);
  return cache[key];
}

const files = (await readdir(root))
  .filter((name) => /^Route[-_ ].*\.xls[x]?$/i.test(name))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

if (!files.length) throw new Error("No Route-*.xls or Route-*.xlsx files found in the project folder.");

const cache = await readJson(cachePath, {});
const googleCandidates = await readJson(googleCandidatePath, {});
const overrides = { ...googleCandidates, ...(await readJson(overridePath, {})) };
const routes = [];

for (const file of files) {
  const workbook = XLSX.readFile(join(root, file), { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
  const stops = [];

  for (const [index, row] of rows.entries()) {
    const stopName = clean(row["Stop Name"]);
    if (!stopName) continue;
    const location = await geocode(stopName, cache, overrides);
    stops.push({
      sequence: Number(row.Sequence) || index + 1,
      stopName,
      pickupTime: normalizeTime(row["Pickup Time"]),
      dropTime: normalizeTime(row["Drop Time"]),
      lat: Number.isFinite(location.lat) ? location.lat : null,
      lng: Number.isFinite(location.lng) ? location.lng : null,
      locationSource: location.source,
      locationConfidence: location.confidence || (location.source === "nominatim" ? "automatic" : "unresolved"),
      locationNote: location.note || location.displayName || "",
    });
  }

  stops.sort((a, b) => a.sequence - b.sequence);
  const existingFinalStopIndex = stops.findIndex(
    (stop) => stop.stopName.toLowerCase().replace(/[^a-z0-9]/g, "") === finalStopName.toLowerCase().replace(/[^a-z0-9]/g, ""),
  );
  const finalStop = existingFinalStopIndex >= 0 ? stops.splice(existingFinalStopIndex, 1)[0] : null;
  const finalLocation = finalStop ? null : await geocode(finalStopName, cache, overrides);
  stops.push({
    sequence: stops.length ? Math.max(...stops.map((stop) => stop.sequence)) + 1 : 1,
    stopName: finalStopName,
    pickupTime: finalStop?.pickupTime || "",
    dropTime: finalStop?.dropTime || "",
    lat: finalStop?.lat ?? (Number.isFinite(finalLocation?.lat) ? finalLocation.lat : null),
    lng: finalStop?.lng ?? (Number.isFinite(finalLocation?.lng) ? finalLocation.lng : null),
    locationSource: finalStop?.locationSource || finalLocation?.source || "unresolved",
    locationConfidence: finalStop?.locationConfidence || finalLocation?.confidence || (finalLocation?.source === "nominatim" ? "automatic" : "unresolved"),
    locationNote: finalStop?.locationNote || finalLocation?.note || finalLocation?.displayName || "",
  });
  routes.push({
    id: basename(file).replace(/\.xlsx?$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name: clean(rows.find((row) => clean(row["Route Name"]))?.["Route Name"]) || basename(file).replace(/\.xlsx?$/i, ""),
    sourceFile: file,
    stops,
  });
}

await mkdir(dataDir, { recursive: true });
await mkdir(join(root, "vendor", "leaflet", "images"), { recursive: true });
await writeFile(join(dataDir, "routes.json"), `${JSON.stringify(routes, null, 2)}\n`);
await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);

const leafletRoot = join(root, "node_modules", "leaflet", "dist");
await copyFile(join(leafletRoot, "leaflet.js"), join(root, "vendor", "leaflet", "leaflet.js"));
await copyFile(join(leafletRoot, "leaflet.css"), join(root, "vendor", "leaflet", "leaflet.css"));
for (const image of ["layers.png", "layers-2x.png", "marker-icon.png", "marker-icon-2x.png", "marker-shadow.png"]) {
  await copyFile(join(leafletRoot, "images", image), join(root, "vendor", "leaflet", "images", image));
}

const unresolved = routes.flatMap((route) => route.stops.filter((stop) => !Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)).map((stop) => `${route.name}: ${stop.stopName}`));
console.log(`Built ${routes.length} routes from ${files.length} workbook(s).`);
console.log(`Mapped ${routes.reduce((sum, route) => sum + route.stops.length, 0) - unresolved.length} of ${routes.reduce((sum, route) => sum + route.stops.length, 0)} stops.`);
if (unresolved.length) console.log(`Needs review:\n- ${unresolved.join("\n- ")}`);
