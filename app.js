import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getDatabase, onValue, ref } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAfK9RqXMd9C6ftGQ1zXJbZKjFZKYMNgus",
  authDomain: "khuta-live-monitor.firebaseapp.com",
  databaseURL: "https://khuta-live-monitor-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "khuta-live-monitor",
  storageBucket: "khuta-live-monitor.firebasestorage.app",
  messagingSenderId: "158074807983",
  appId: "1:158074807983:web:d282e4d609fd95cc11965a"
};

const STALE_AFTER_MS = 10000;
const STABLE_LOCATION = Object.freeze({
  latitude: 24.448053,
  longitude: 46.119621,
  label: "موقع الإسطبل"
});
const $ = id => document.getElementById(id);
const state = {
  temperature_c: null,
  acceleration_ms2: null,
  speed_kmh: null,
  latitude: null,
  longitude: null,
  satellites: null,
  timestamp: null,
  connection: "loading"
};

const history = { temp: [], speed: [], accel: [], gps: [] };
const detailMeta = {
  temp: { title: "درجة الحرارة", sensor: "DS18B20", unit: "°C", key: "temperature_c", digits: 2 },
  speed: { title: "السرعة", sensor: "NEO-6M GPS", unit: "km/h", key: "speed_kmh", digits: 1 },
  accel: { title: "التسارع والحركة", sensor: "ADXL345", unit: "m/s²", key: "acceleration_ms2", digits: 2 },
  gps: { title: "الموقع", sensor: "NEO-6M GPS", unit: "°", key: "latitude", digits: 6 }
};

let activeDetail = null;
let focusBeforeDetail = null;
let mainMap = null;
let mainMarker = null;
let detailMap = null;
let detailMarker = null;
let currentLocationUrl = "";
let renderedLocationKey = "";

const isNumber = value => typeof value === "number" && Number.isFinite(value);
const cleanNumber = value => isNumber(value) ? value : null;
const isValidGpsLocation = (latitude, longitude) => (
  isNumber(latitude) &&
  isNumber(longitude) &&
  latitude >= -90 && latitude <= 90 &&
  longitude >= -180 && longitude <= 180 &&
  !(Math.abs(latitude) < 0.000001 && Math.abs(longitude) < 0.000001)
);
const displayLocation = () => {
  if (isValidGpsLocation(state.latitude, state.longitude)) {
    return {
      latitude: state.latitude,
      longitude: state.longitude,
      label: "موقع الجهاز",
      isDevice: true
    };
  }
  return { ...STABLE_LOCATION, isDevice: false };
};
const openStreetMapUrl = location => (
  `https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=17/${location.latitude}/${location.longitude}`
);
const formatValue = (value, digits) => isNumber(value) ? value.toFixed(digits) : "غير متاح";
const readingDate = () => isNumber(state.timestamp) ? new Date(state.timestamp) : null;
const isFresh = () => readingDate() !== null && Date.now() - state.timestamp <= STALE_AFTER_MS;
const formatTimestamp = () => {
  const date = readingDate();
  if (!date) return "لا توجد قراءة";
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(date);
};

function addHistory(key, value) {
  if (!isNumber(value)) return;
  const values = history[key];
  values.push(value);
  if (values.length > 20) values.shift();
}

function recordReading() {
  addHistory("temp", state.temperature_c);
  addHistory("speed", state.speed_kmh);
  addHistory("accel", state.acceleration_ms2);
  addHistory("gps", state.latitude);
}

function statusText() {
  if (state.connection === "error") return "تعذّر الاتصال";
  if (!readingDate()) return "بانتظار الجهاز";
  return isFresh() ? "بيانات مباشرة" : "بيانات قديمة";
}

function renderBars() {
  const samples = history.accel.slice(-8);
  const bars = [...document.querySelectorAll("#bars i")];
  if (!samples.length) {
    bars.forEach(bar => bar.style.height = "4px");
    return;
  }
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const span = Math.max(max - min, 0.01);
  bars.forEach((bar, index) => {
    const value = samples[index - (bars.length - samples.length)];
    bar.style.height = isNumber(value) ? `${20 + ((value - min) / span) * 75}%` : "4px";
  });
}

function renderStatus() {
  const fresh = isFresh();
  const hasReading = readingDate() !== null;
  const label = statusText();
  $("updated").textContent = formatTimestamp();
  $("streamState").textContent = hasReading ? (fresh ? "مباشرة" : "قديمة") : "لا توجد";
  $("heroMode").textContent = fresh ? "متصل" : (hasReading ? "قديم" : "غير متاح");
  $("deviceState").textContent = fresh ? "متصل" : "غير متصل";
  $("ready").textContent = label;
  $("liveText").textContent = label;
  $("pulse").classList.toggle("paused", !fresh);
  document.body.classList.toggle("stale-data", hasReading && !fresh);
}

function renderLocation() {
  const location = displayLocation();
  $("locationLabel").textContent = location.label;
  $("locationCard").setAttribute("aria-label", `خريطة ${location.label}`);
  $("lat").textContent = location.latitude.toFixed(6);
  $("lng").textContent = location.longitude.toFixed(6);
  $("sat").textContent = location.isDevice
    ? (isNumber(state.satellites) ? `${Math.trunc(state.satellites)} أقمار صناعية` : "إحداثيات GPS من الجهاز")
    : "الموقع الثابت";
  currentLocationUrl = openStreetMapUrl(location);
  $("gpsLink").href = currentLocationUrl;
  $("detailMapLink").href = currentLocationUrl;
  updateMaps(location);
}

function createMap(elementId, zoom) {
  const map = window.L.map(elementId, {
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: true
  });
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  map.setView([STABLE_LOCATION.latitude, STABLE_LOCATION.longitude], zoom);
  map.on("click", () => {
    if (currentLocationUrl) window.open(currentLocationUrl, "_blank", "noopener,noreferrer");
  });
  return map;
}

function createMarker(map, location) {
  const icon = window.L.divIcon({
    className: "khuta-marker-wrap",
    html: '<span class="khuta-marker" aria-hidden="true"></span>',
    iconSize: [25, 34],
    iconAnchor: [12, 31]
  });
  return window.L.marker([location.latitude, location.longitude], {
    icon,
    title: location.label,
    keyboard: true
  }).addTo(map);
}

function updateMap(map, marker, location, zoom) {
  const coordinates = [location.latitude, location.longitude];
  if (marker) {
    marker.setLatLng(coordinates);
    marker.options.title = location.label;
    const markerElement = marker.getElement();
    if (markerElement) {
      markerElement.title = location.label;
      markerElement.setAttribute("aria-label", location.label);
    }
  }
  map.setView(coordinates, zoom, { animate: false });
}

function updateMaps(location) {
  if (!window.L) return;
  if (!mainMap) {
    mainMap = createMap("mainMap", 16);
    mainMarker = createMarker(mainMap, location);
  }
  const locationKey = `${location.latitude},${location.longitude},${location.label}`;
  if (renderedLocationKey !== locationKey) {
    updateMap(mainMap, mainMarker, location, 16);
    if (detailMap) updateMap(detailMap, detailMarker, location, 17);
    renderedLocationKey = locationKey;
  }
}

function showDetailMap(location) {
  if (!window.L) return;
  if (!detailMap) {
    detailMap = createMap("detailMap", 17);
    detailMarker = createMarker(detailMap, location);
  }
  updateMap(detailMap, detailMarker, location, 17);
  requestAnimationFrame(() => detailMap.invalidateSize());
}

function renderMain() {
  $("temp").textContent = formatValue(state.temperature_c, 2);
  $("speed").textContent = formatValue(state.speed_kmh, 1);
  $("accel").textContent = formatValue(state.acceleration_ms2, 2);
  renderBars();
  renderLocation();
  renderStatus();
  renderDetail();
}

function chartPath(values) {
  if (values.length < 2) return { line: "", area: "" };
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(high - low, Math.abs(high) * 0.02, 0.000001);
  const coords = values.map((value, index) => [
    9 + index * 322 / (values.length - 1),
    112 - (value - low) / span * 90
  ]);
  const line = coords.map((point, index) => `${index ? "L" : "M"}${point[0].toFixed(2)} ${point[1].toFixed(2)}`).join(" ");
  return { line, area: `${line} L331 124 L9 124 Z` };
}

function metricCard(label, value) {
  const card = document.createElement("div");
  card.className = "detail-metric";
  const name = document.createElement("span");
  name.textContent = label;
  const reading = document.createElement("b");
  reading.textContent = value;
  card.append(name, reading);
  return card;
}

function renderDetail() {
  if (!activeDetail) return;
  const meta = detailMeta[activeDetail];
  const location = displayLocation();
  const value = activeDetail === "gps" ? location.latitude : state[meta.key];
  $("detailTitle").textContent = meta.title;
  $("detailSensor").textContent = activeDetail === "gps" ? location.label : meta.sensor;
  $("detailUnit").textContent = isNumber(value) ? meta.unit : "";
  $("detailMode").textContent = activeDetail === "gps"
    ? (location.isDevice ? (isFresh() ? "GPS مباشر" : "GPS") : "موقع ثابت")
    : (isFresh() ? "مباشر" : "غير مباشر");
  $("detailSubtitle").textContent = activeDetail === "gps"
    ? (location.isDevice ? "الموقع الفعلي من GPS" : "موقع الإسطبل")
    : "سجل القراءات الحقيقية منذ فتح الصفحة";
  $("detailReading").classList.toggle("compact", activeDetail === "gps" || !isNumber(value));
  $("detailValue").textContent = formatValue(value, meta.digits);
  $("detailHistoryLabel").textContent = activeDetail === "gps"
    ? (location.isDevice ? "قراءات GPS منذ فتح الصفحة" : "موقع الإسطبل")
    : "قراءات حقيقية منذ فتح الصفحة";
  $("detailUpdated").textContent = activeDetail === "gps" && !location.isDevice ? "موقع ثابت" : formatTimestamp();
  $("detailChartPanel").hidden = activeDetail === "gps" && !location.isDevice;

  const path = chartPath(history[activeDetail]);
  $("detailLine").setAttribute("d", path.line);
  $("detailArea").setAttribute("d", path.area);

  const cards = activeDetail === "temp"
    ? [["القراءة", isNumber(state.temperature_c) ? `${state.temperature_c.toFixed(2)} °C` : "غير متاح"], ["نوع الحساس", "DS18B20"], ["آخر قراءة", formatTimestamp()], ["الحالة", statusText()]]
    : activeDetail === "speed"
      ? [["السرعة", isNumber(state.speed_kmh) ? `${state.speed_kmh.toFixed(1)} km/h` : "غير متاح"], ["نوع الحساس", "NEO-6M GPS"], ["الأقمار", "متاح"], ["الحالة", statusText()]]
      : activeDetail === "accel"
        ? [["التسارع", isNumber(state.acceleration_ms2) ? `${state.acceleration_ms2.toFixed(2)} m/s²` : "غير متاح"], ["نوع الحساس", "ADXL345"], ["آخر قراءة", formatTimestamp()], ["الحالة", statusText()]]
        : [["خط العرض", location.latitude.toFixed(6)], ["خط الطول", location.longitude.toFixed(6)], ["المصدر", location.label], ["الأقمار", "متاح"]];

  const grid = $("detailGrid");
  grid.replaceChildren(...cards.map(([label, reading]) => metricCard(label, reading)));
  $("detailMapWrap").hidden = activeDetail !== "gps";
  if (activeDetail === "gps") showDetailMap(location);
}

function openDetail(key) {
  if (!detailMeta[key]) return;
  focusBeforeDetail = document.activeElement;
  activeDetail = key;
  $("detailOverlay").hidden = false;
  $("detailOverlay").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  renderDetail();
  $("detailOverlay").scrollTop = 0;
  $("detailBack").focus();
}

function closeDetail() {
  $("detailOverlay").hidden = true;
  $("detailOverlay").setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  activeDetail = null;
  if (focusBeforeDetail?.focus) focusBeforeDetail.focus();
}

document.querySelectorAll("[data-detail]").forEach(element => {
  element.addEventListener("click", event => {
    if (event.target.closest("a")) return;
    openDetail(element.dataset.detail);
  });
  element.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetail(element.dataset.detail);
    }
  });
});
$("gpsDetails").addEventListener("click", () => openDetail("gps"));
$("detailBack").addEventListener("click", closeDetail);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && activeDetail) closeDetail();
});

renderMain();
setInterval(() => {
  renderStatus();
  renderDetail();
}, 1000);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);

signInAnonymously(auth)
  .then(() => {
    state.connection = "connected";
    onValue(ref(database, "devices/khuta-esp32/live"), snapshot => {
      const data = snapshot.val();
      if (!data || typeof data !== "object") {
        state.temperature_c = null;
        state.acceleration_ms2 = null;
        state.speed_kmh = null;
        state.latitude = null;
        state.longitude = null;
        state.satellites = null;
        state.timestamp = null;
        renderMain();
        return;
      }
      state.temperature_c = cleanNumber(data.temperature_c);
      state.acceleration_ms2 = cleanNumber(data.acceleration_ms2);
      state.speed_kmh = cleanNumber(data.speed_kmh);
      state.latitude = cleanNumber(data.latitude);
      state.longitude = cleanNumber(data.longitude);
      state.satellites = cleanNumber(data.satellites);
      state.timestamp = cleanNumber(data.timestamp);
      recordReading();
      renderMain();
    }, error => {
      console.error("Firebase read failed", error);
      state.connection = "error";
      renderMain();
    });
  })
  .catch(error => {
    console.error("Firebase authentication failed", error);
    state.connection = "error";
    renderMain();
  });
