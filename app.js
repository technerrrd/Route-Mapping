const routePicker = document.querySelector("#routePicker");
const routeTitle = document.querySelector("#routeTitle");
const routeStats = document.querySelector("#routeStats");
const stopRail = document.querySelector("#stopRail");
const scheduleBody = document.querySelector("#scheduleBody");
const scheduleTitle = document.querySelector("#scheduleTitle");
const mapMessage = document.querySelector("#mapMessage");
const exportReview = document.querySelector("#exportReview");
const pointEditor = document.querySelector("#pointEditor");
const pointEditorTitle = document.querySelector("#pointEditorTitle");
const pointLatitude = document.querySelector("#pointLatitude");
const pointLongitude = document.querySelector("#pointLongitude");
const pointEditorError = document.querySelector("#pointEditorError");

const map = L.map("map", { zoomControl: false, attributionControl: true }).setView([27.56, 76.63], 12);
L.control.zoom({ position: "topright" }).addTo(map);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const storageKey = "route-map-location-reviews-v1";
const historyStorageKey = "route-map-location-review-history-v1";
const maxSavedVersions = 20;
let routes = [];
let reviews = loadReviews();
let reviewHistory = loadReviewHistory();
let routeLayer = L.layerGroup().addTo(map);
let markerByIndex = new Map();
let selectedRouteIndex = 0;
let activePointEdit = null;
let previewMarker = null;

function loadReviews() {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "{}");
  } catch {
    return {};
  }
}

function saveReviews() {
  localStorage.setItem(storageKey, JSON.stringify(reviews));
}

function loadReviewHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(historyStorageKey) || "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

function saveReviewHistory() {
  localStorage.setItem(historyStorageKey, JSON.stringify(reviewHistory));
}

function reviewKey(route, stop) {
  return `${route.id}::${stop.sequence}::${stop.stopName}`;
}

function formatTime(value) {
  return value || "—";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

function candidateFor(route, stop) {
  const saved = reviews[reviewKey(route, stop)];
  const lat = Number.isFinite(saved?.lat) ? saved.lat : stop.lat;
  const lng = Number.isFinite(saved?.lng) ? saved.lng : stop.lng;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function decisionFor(route, stop) {
  const saved = reviews[reviewKey(route, stop)];
  if (saved?.decision === "confirmed" || saved?.decision === "denied") return saved.decision;
  return candidateFor(route, stop) ? "pending" : "missing";
}

function decisionLabel(decision) {
  return ({ confirmed: "Confirmed", denied: "Denied", pending: "Pending review", missing: "Needs candidate" })[decision];
}

function previousReview(route, stop) {
  const saved = reviews[reviewKey(route, stop)];
  if (saved) return { ...saved };
  const candidate = candidateFor(route, stop);
  if (!candidate) return null;
  return { decision: "pending", lat: candidate.lat, lng: candidate.lng, adjusted: false, updatedAt: null };
}

function saveReview(route, stop, nextReview) {
  const key = reviewKey(route, stop);
  const versions = Array.isArray(reviewHistory[key]) ? reviewHistory[key] : [];
  reviewHistory[key] = [...versions, { savedAt: new Date().toISOString(), review: previousReview(route, stop) }].slice(-maxSavedVersions);
  reviews[key] = nextReview;
  saveReviewHistory();
  saveReviews();
  renderPicker();
  renderRoute(selectedRouteIndex);
}

function restorePrevious(route, stop) {
  const key = reviewKey(route, stop);
  const versions = reviewHistory[key];
  if (!Array.isArray(versions) || !versions.length) return;
  const previous = versions.pop().review;
  if (previous === null) delete reviews[key];
  else reviews[key] = previous;
  if (!versions.length) delete reviewHistory[key];
  saveReviewHistory();
  saveReviews();
  renderPicker();
  renderRoute(selectedRouteIndex);
}

function setDecision(route, stop, decision) {
  const key = reviewKey(route, stop);
  const candidate = candidateFor(route, stop);
  saveReview(route, stop, {
    ...(reviews[key] || {}),
    decision,
    lat: candidate?.lat ?? null,
    lng: candidate?.lng ?? null,
    updatedAt: new Date().toISOString(),
  });
}

function validPoint() {
  if (!pointLatitude.value.trim() || !pointLongitude.value.trim()) return null;
  const lat = Number(pointLatitude.value);
  const lng = Number(pointLongitude.value);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? { lat, lng } : null;
}

function showPreview(point) {
  if (!previewMarker) {
    previewMarker = L.marker([point.lat, point.lng], { draggable: true, icon: makeIcon(activePointEdit.displayNumber, "pending") }).addTo(map);
    previewMarker.on("dragend", () => {
      const location = previewMarker.getLatLng();
      pointLatitude.value = location.lat.toFixed(7);
      pointLongitude.value = location.lng.toFixed(7);
    });
  } else {
    previewMarker.setLatLng([point.lat, point.lng]);
  }
}

function pickPoint(event) {
  pointLatitude.value = event.latlng.lat.toFixed(7);
  pointLongitude.value = event.latlng.lng.toFixed(7);
  pointEditorError.hidden = true;
  showPreview(event.latlng);
}

function closePointEditor() {
  map.off("click", pickPoint);
  if (previewMarker) map.removeLayer(previewMarker);
  previewMarker = null;
  activePointEdit = null;
  pointEditor.hidden = true;
  document.querySelector("#map").classList.remove("point-picking");
}

function openPointEditor(route, stop, displayNumber) {
  closePointEditor();
  activePointEdit = { route, stop, displayNumber };
  const current = candidateFor(route, stop);
  pointEditorTitle.textContent = `${current ? "Adjust" : "Add"} point: ${stop.stopName}`;
  pointLatitude.value = current?.lat ?? "";
  pointLongitude.value = current?.lng ?? "";
  pointEditorError.hidden = true;
  pointEditor.hidden = false;
  mapMessage.hidden = true;
  document.querySelector("#map").classList.add("point-picking");
  if (current) showPreview(current);
  map.on("click", pickPoint);
  document.querySelector(".map-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function makeIcon(displayNumber, decision) {
  return L.divIcon({
    className: "",
    html: `<div class="numbered-marker ${decision}"><span>${displayNumber}</span></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 31],
    popupAnchor: [0, -29],
  });
}

function selectStop(index) {
  document.querySelectorAll(".stop-card").forEach((card, cardIndex) => {
    card.classList.toggle("active", cardIndex === index);
  });
  const marker = markerByIndex.get(index);
  if (marker) {
    map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 15), { duration: 0.65 });
    marker.openPopup();
  }
}

function makeReviewActions(route, stop, hasCandidate, displayNumber) {
  const actions = document.createElement("div");
  actions.className = "review-actions";

  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "review-button confirm";
  confirm.textContent = "Confirm";
  confirm.disabled = !hasCandidate;
  confirm.addEventListener("click", () => setDecision(route, stop, "confirmed"));

  const deny = document.createElement("button");
  deny.type = "button";
  deny.className = "review-button deny";
  deny.textContent = "Deny";
  deny.disabled = !hasCandidate;
  deny.addEventListener("click", () => setDecision(route, stop, "denied"));

  const adjust = document.createElement("button");
  adjust.type = "button";
  adjust.className = "review-button adjust";
  adjust.textContent = hasCandidate ? "Adjust" : "Add point";
  adjust.addEventListener("click", () => openPointEditor(route, stop, displayNumber));

  const restore = document.createElement("button");
  restore.type = "button";
  restore.className = "review-button restore";
  restore.textContent = "Restore previous";
  const savedVersions = Array.isArray(reviewHistory[reviewKey(route, stop)]) ? reviewHistory[reviewKey(route, stop)].length : 0;
  restore.disabled = savedVersions === 0;
  restore.title = savedVersions ? `${savedVersions} earlier saved version${savedVersions === 1 ? "" : "s"} in this browser` : "No earlier saved version in this browser";
  restore.addEventListener("click", () => restorePrevious(route, stop));

  actions.append(confirm, deny, adjust, restore);
  return actions;
}

function renderRoute(index) {
  if (activePointEdit) closePointEditor();
  selectedRouteIndex = index;
  const route = routes[index];
  routeLayer.clearLayers();
  markerByIndex = new Map();
  mapMessage.hidden = true;

  routePicker.querySelectorAll("button").forEach((button, buttonIndex) => {
    button.setAttribute("aria-selected", String(buttonIndex === index));
  });

  const displayStops = route.stops.map((stop, stopIndex) => ({
    stop,
    stopIndex,
    candidate: candidateFor(route, stop),
    decision: decisionFor(route, stop),
  }));
  const mappedStops = displayStops.filter((item) => item.candidate);
  const confirmed = displayStops.filter((item) => item.decision === "confirmed").length;
  const denied = displayStops.filter((item) => item.decision === "denied").length;
  const missing = displayStops.filter((item) => item.decision === "missing").length;

  routeTitle.textContent = route.name;
  scheduleTitle.textContent = `${route.name} location review`;
  routeStats.innerHTML = `
    <div class="summary-stat"><span>Stops</span><b>${route.stops.length}</b></div>
    <div class="summary-stat"><span>Confirmed</span><b>${confirmed}</b></div>
    <div class="summary-stat"><span>Denied</span><b>${denied}</b></div>`;

  stopRail.replaceChildren();
  scheduleBody.replaceChildren();

  displayStops.forEach(({ stop, stopIndex, candidate, decision }) => {
    const displayNumber = stopIndex + 1;
    const card = document.createElement("button");
    card.className = `stop-card ${decision}`;
    card.innerHTML = `
      <span class="stop-number">${displayNumber}</span>
      <span>
        <strong>${escapeHtml(stop.stopName)}</strong>
        <small class="${decision}">${escapeHtml(decisionLabel(decision))} · ${escapeHtml(formatTime(stop.pickupTime))}/${escapeHtml(formatTime(stop.dropTime))}</small>
      </span>`;
    card.addEventListener("click", () => selectStop(stopIndex));
    stopRail.append(card);

    const row = document.createElement("tr");
    row.className = `review-row ${decision}`;
    row.innerHTML = `
      <td>${displayNumber}. ${escapeHtml(stop.stopName)}</td>
      <td>${escapeHtml(formatTime(stop.pickupTime))}</td>
      <td>${escapeHtml(formatTime(stop.dropTime))}</td>
      <td class="candidate-coord">${candidate ? `${candidate.lat.toFixed(5)}, ${candidate.lng.toFixed(5)}` : "—"}</td>
      <td><span class="confidence">${escapeHtml(stop.locationConfidence || "unresolved")}</span></td>
      <td><span class="status ${decision}">${escapeHtml(decisionLabel(decision))}</span></td>`;
    row.lastElementChild.append(makeReviewActions(route, stop, Boolean(candidate), displayNumber));
    scheduleBody.append(row);

    if (!candidate) return;
    const marker = L.marker([candidate.lat, candidate.lng], { icon: makeIcon(displayNumber, decision) })
      .bindPopup(`
        <div class="popup-title">${escapeHtml(stop.stopName)}</div>
        <div class="popup-time">${escapeHtml(decisionLabel(decision))} · ${candidate.lat.toFixed(5)}, ${candidate.lng.toFixed(5)}</div>
        <div class="popup-time">${escapeHtml(stop.locationNote || "Candidate location")}</div>`)
      .addTo(routeLayer);
    marker.on("click", () => {
      card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      document.querySelectorAll(".stop-card").forEach((item) => item.classList.remove("active"));
      card.classList.add("active");
    });
    markerByIndex.set(stopIndex, marker);
  });

  const routePoints = mappedStops.filter((item) => item.decision !== "denied").map((item) => [item.candidate.lat, item.candidate.lng]);
  if (routePoints.length >= 2) {
    L.polyline(routePoints, { color: "#1f6a4b", weight: 5, opacity: 0.78, dashArray: "2 10", lineCap: "round" }).addTo(routeLayer);
    map.fitBounds(mappedStops.map((item) => [item.candidate.lat, item.candidate.lng]), { paddingTopLeft: [55, 120], paddingBottomRight: [55, 180], maxZoom: 15 });
  } else if (mappedStops.length > 1) {
    map.fitBounds(mappedStops.map((item) => [item.candidate.lat, item.candidate.lng]), { paddingTopLeft: [55, 120], paddingBottomRight: [55, 180], maxZoom: 15 });
  } else if (mappedStops.length === 1) {
    map.setView([mappedStops[0].candidate.lat, mappedStops[0].candidate.lng], 15);
  } else {
    map.setView([27.56, 76.63], 12);
  }

  const notices = [];
  if (missing) notices.push(`${missing} stop${missing === 1 ? "" : "s"} need a candidate point`);
  if (denied) notices.push(`${denied} candidate${denied === 1 ? "" : "s"} denied`);
  if (notices.length) {
    mapMessage.textContent = `${notices.join("; ")}. Use Add point or Adjust to supply a better location.`;
    mapMessage.hidden = false;
  }
}

function renderPicker() {
  routePicker.replaceChildren();
  routes.forEach((route, index) => {
    const confirmed = route.stops.filter((stop) => decisionFor(route, stop) === "confirmed").length;
    const button = document.createElement("button");
    button.className = "route-tab";
    button.type = "button";
    button.textContent = confirmed ? `${route.name} ${confirmed}/${route.stops.length}` : route.name;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(index === selectedRouteIndex));
    button.addEventListener("click", () => renderRoute(index));
    routePicker.append(button);
  });
}

function exportReviewFile() {
  const output = {
    exportedAt: new Date().toISOString(),
    routes: routes.map((route) => ({
      id: route.id,
      name: route.name,
      stops: route.stops.map((stop) => {
        const candidate = candidateFor(route, stop);
        const saved = reviews[reviewKey(route, stop)] || {};
        return {
          sequence: stop.sequence,
          stopName: stop.stopName,
          decision: decisionFor(route, stop),
          lat: candidate?.lat ?? null,
          lng: candidate?.lng ?? null,
          adjusted: Boolean(saved.adjusted),
          confidence: stop.locationConfidence || "unresolved",
          source: stop.locationSource,
          note: stop.locationNote || "",
          updatedAt: saved.updatedAt || null,
        };
      }),
    })),
  };
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(output, null, 2)}\n`], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "route-location-review.json";
  link.click();
  URL.revokeObjectURL(url);
}

document.querySelector("#previousStop").addEventListener("click", () => stopRail.scrollBy({ left: -300, behavior: "smooth" }));
document.querySelector("#nextStop").addEventListener("click", () => stopRail.scrollBy({ left: 300, behavior: "smooth" }));
exportReview.addEventListener("click", exportReviewFile);
pointEditor.addEventListener("submit", (event) => {
  event.preventDefault();
  const point = validPoint();
  if (!point) {
    pointEditorError.textContent = "Enter a valid latitude from -90 to 90 and longitude from -180 to 180, or click the map.";
    pointEditorError.hidden = false;
    return;
  }
  const { route, stop } = activePointEdit;
  const key = reviewKey(route, stop);
  saveReview(route, stop, {
    ...(reviews[key] || {}),
    decision: "pending",
    lat: point.lat,
    lng: point.lng,
    adjusted: true,
    updatedAt: new Date().toISOString(),
  });
});
document.querySelector("#cancelPointEdit").addEventListener("click", () => {
  closePointEditor();
  renderRoute(selectedRouteIndex);
});
[pointLatitude, pointLongitude].forEach((input) => input.addEventListener("input", () => {
  pointEditorError.hidden = true;
  const point = validPoint();
  if (point && activePointEdit) showPreview(point);
}));

try {
  const response = await fetch("data/routes.json");
  if (!response.ok) throw new Error(`Route data returned ${response.status}`);
  routes = await response.json();
  if (!routes.length) throw new Error("No Route-*.xls files were found");
  renderPicker();
  renderRoute(Math.min(2, routes.length - 1));
} catch (error) {
  routeTitle.textContent = "Route data unavailable";
  mapMessage.textContent = `${error.message}. Run npm run build, then reload this page.`;
  mapMessage.hidden = false;
}
