import { useState, useEffect, useRef, useCallback } from "react";
import {
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Crosshair,
  Eye,
  EyeOff,
  Image,
  LayoutGrid,
  LogOut,
  LoaderCircle,
  MapPin,
  Navigation,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Capacitor } from "@capacitor/core";

/* ─── Types ─── */
interface User {
  id: number;
  name: string;
  email: string;
  role: string;
}

interface Mission {
  id: number;
  name: string;
  description: string;
  status: string;
  config: string;
  boundary_id: number | null;
  assigned_users: string;
  assigned_groups: string;
}

interface MissionConfig {
  requiredFields?: string[];
  photoRequired?: boolean;
  minPhotos?: number;
  lamppostCapture?: boolean;
}

interface PhotoItem {
  data: string;
  type: "billboard" | "lamppost" | "panorama";
  caption: string;
}

interface ValidationAssignment {
  id: number;
  project_id: number;
  project_name: string;
  asset_id: number;
  status: string;
  latitude: number;
  longitude: number;
  asset: {
    id: number;
    lat?: number;
    lng?: number;
    street: string;
    district: string;
    from?: string;
    to?: string;
    owner?: string;
    mediaType?: string;
    width?: number;
    height?: number;
    faces?: number;
    photoUrl?: string;
  } | null;
}

interface BoundaryFeature {
  type: string;
  properties: Record<string, string>;
  geometry: { type: string; coordinates: number[][][] | number[][][][] };
}

/* ─── API base ─── */
const API_BASE = import.meta.env.VITE_API_URL || (Capacitor.isNativePlatform() ? "https://spotlight.co.tz" : "");

function apiFetch(path: string, init: RequestInit = {}) {
  const token = localStorage.getItem("kmk_mobile_token");
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers, credentials: "include" });
}

/* ─── Helpers ─── */
function pointInPolygon(
  lat: number,
  lng: number,
  coords: number[][][],
): boolean {
  const ring = coords[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][1],
      yi = ring[i][0];
    const xj = ring[j][1],
      yj = ring[j][0];
    if (yi > lng !== yj > lng && lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function reverseGeocode(
  lat: number,
  lng: number,
  features: BoundaryFeature[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const f of features) {
    const geom = f.geometry;
    let match = false;
    if (geom.type === "Polygon") {
      match = pointInPolygon(lat, lng, geom.coordinates as number[][][]);
    } else if (geom.type === "MultiPolygon") {
      match = (geom.coordinates as number[][][][]).some((poly) =>
        pointInPolygon(lat, lng, poly),
      );
    }
    if (match) {
      const props = f.properties;
      for (const key of ["Region", "District", "Ward", "Shehia", "Street", "Village", "Mtaa"]) {
        if (props[key]) result[key.toLowerCase()] = props[key];
      }
      break;
    }
  }
  return result;
}

const GPS_TARGET_METERS = 10;

const FIELD_SELECT_OPTIONS: Record<string, string[]> = {
  media_type: ["Lamp post", "Large format", "Digital screen", "Fabricated banner"],
  faces: ["1", "2", "3", "4", "5", "6"],
  arrangement: ["Single face", "Back to back", "V-shape", "Cluster", "Road median", "Wall mounted", "Other"],
  brackets: ["Installed", "Missing", "Damaged", "Needs repair", "Not applicable"],
  occupancy: ["Available", "Occupied", "Partially occupied", "Unknown"],
};

function fieldLabel(field: string) {
  return field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, " ");
}

function gpsQuality(accuracy: number, locked: boolean) {
  if (!locked) return { label: "Waiting", className: "gps-quality--waiting", detail: "Waiting for GPS fix" };
  if (accuracy <= 5) return { label: "Excellent", className: "gps-quality--excellent", detail: "Approved for capture" };
  if (accuracy <= GPS_TARGET_METERS) return { label: "Good", className: "gps-quality--good", detail: "Within collection target" };
  if (accuracy <= 20) return { label: "Review", className: "gps-quality--review", detail: "Wait briefly or move to open sky" };
  return { label: "Poor", className: "gps-quality--poor", detail: "Improve GPS before submitting" };
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  if (!aLat && !aLng) return Number.POSITIVE_INFINITY;
  const toRad = (value: number) => value * Math.PI / 180;
  const earth = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return earth * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function distanceLabel(meters: number) {
  if (!Number.isFinite(meters)) return "Distance pending";
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km away` : `${Math.round(meters)} m away`;
}

/* ─── App ─── */
export default function App() {
  const [screen, setScreen] = useState<"login" | "missions" | "collect" | "dashboard" | "validations">("login");
  const [user, setUser] = useState<User | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [validationAssignments, setValidationAssignments] = useState<ValidationAssignment[]>([]);
  const [activeValidation, setActiveValidation] = useState<ValidationAssignment | null>(null);
  const [collections, setCollections] = useState<any[]>([]);
  const [activeMission, setActiveMission] = useState<Mission | null>(null);
  const [missionConfig, setMissionConfig] = useState<MissionConfig>({});
  const [boundaryFeatures, setBoundaryFeatures] = useState<BoundaryFeature[]>([]);

  // Collection state
  const [lat, setLat] = useState(0);
  const [lng, setLng] = useState(0);
  const [accuracy, setAccuracy] = useState(0);
  const [gpsLocked, setGpsLocked] = useState(false);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [toast, setToast] = useState("");
  const [lamppostMode, setLamppostMode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [missionsLoading, setMissionsLoading] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [missionsRefresh, setMissionsRefresh] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [pullStart, setPullStart] = useState<number | null>(null);
  const [validationVerdict, setValidationVerdict] = useState<"ok" | "issue" | "">("");
  const [issueType, setIssueType] = useState("");
  const [issueDetail, setIssueDetail] = useState("");
  const [customIssue, setCustomIssue] = useState("");
  const [validationPhoto, setValidationPhoto] = useState("");

  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const watchIdRef = useRef<number | null>(null);

  // Auto-login check
  useEffect(() => {
    apiFetch(`/api/app?action=me`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.user) {
          setUser(d.user);
          setScreen("missions");
        }
      });
  }, []);

  // Load missions
  useEffect(() => {
    if (!user) return;
    refreshAssignmentsAndMissions();
    }, [user, missionsRefresh]);

  async function refreshAssignmentsAndMissions() {
    if (!user) return;
    setMissionsLoading(true);
    setRefreshing(true);
    setConnectionError("");
    try {
      const [missionResponse, assignmentResponse] = await Promise.all([
        apiFetch(`/api/app?action=missions`),
        apiFetch(`/api/app?action=validation-assignments`),
      ]);
      if (!missionResponse.ok) throw new Error(`Unable to load missions (${missionResponse.status})`);
      const missionData = await missionResponse.json();
      const assignmentData = assignmentResponse.ok ? await assignmentResponse.json() : { assignments: [] };
      setMissions(missionData.missions ?? []);
      setValidationAssignments(assignmentData.assignments ?? []);
      await loadCollections();
    } catch {
      setConnectionError("Cannot reach the planner. Check the connection and try again.");
    } finally {
      setMissionsLoading(false);
      setRefreshing(false);
    }
  }

  function handlePullStart(event: React.TouchEvent<HTMLElement>) {
    if (event.currentTarget.scrollTop <= 0) setPullStart(event.touches[0].clientY);
  }

  function handlePullEnd(event: React.TouchEvent<HTMLElement>) {
    if (pullStart === null) return;
    const delta = event.changedTouches[0].clientY - pullStart;
    setPullStart(null);
    if (delta > 70 && !refreshing) void refreshAssignmentsAndMissions();
  }

  // Load collections for dashboard
  async function loadCollections() {
    try {
      const r = await apiFetch(`/api/app?action=field-collections`);
      const d = await r.json();
      if (d?.collections) {
        const mine = d.collections.filter((c: any) => c.user_id === user?.id || c.collector === user?.name);
        setCollections(mine);
      }
    } catch { /* ignore */ }
  }

  // Load boundary GeoJSON when mission selected
  useEffect(() => {
    if (!activeMission?.boundary_id) { setBoundaryFeatures([]); return; }
    apiFetch(`/api/app?action=boundary-geojson&id=${activeMission.boundary_id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.geojson?.features) setBoundaryFeatures(d.geojson.features);
      });
  }, [activeMission]);

  // GPS watcher for collect and validation screens
  useEffect(() => {
    if (!["collect", "missions", "validations"].includes(screen)) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setAccuracy(pos.coords.accuracy);
        setGpsLocked(true);
        if (markerRef.current) {
          markerRef.current.setLatLng([pos.coords.latitude, pos.coords.longitude]);
        }
        if (mapRef.current && !mapRef.current.getBounds().contains([pos.coords.latitude, pos.coords.longitude])) {
          mapRef.current.panTo([pos.coords.latitude, pos.coords.longitude]);
        }
      },
      (err) => {
        console.error("GPS error", err);
        setToast("GPS unavailable — enter coordinates manually");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [screen]);

  // Init map for collect screen
  useEffect(() => {
    if (screen !== "collect" || !mapNode.current || mapRef.current) return;
    const map = L.map(mapNode.current, { zoomControl: false, attributionControl: false }).setView([-6.1455, 39.2269], 15);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20 }).addTo(map);
    L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20 }).addTo(map);
    const icon = L.divIcon({ className: "gps-marker", html: '<span class="gps-dot"></span>', iconSize: [20, 20], iconAnchor: [10, 10] });
    markerRef.current = L.marker([-6.1455, 39.2269], { icon }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
  }, [screen]);

  // Auto reverse-geocode when GPS locks and boundary features available
  const autoGeocode = useCallback(() => {
    if (!gpsLocked || !boundaryFeatures.length) return;
    const result = reverseGeocode(lat, lng, boundaryFeatures);
    if (Object.keys(result).length) {
      setFormData((prev) => ({ ...prev, ...result }));
      setToast("Location auto-detected from boundary");
      setTimeout(() => setToast(""), 2500);
    }
  }, [lat, lng, gpsLocked, boundaryFeatures]);

  useEffect(() => { autoGeocode(); }, [autoGeocode]);

  /* ─── Login ─── */
  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoginLoading(true);
    const fd = new FormData(e.currentTarget);
    try {
      const r = await apiFetch(`/api/app?action=login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }),
      });
      if (!r.ok) { setToast("Invalid email or password"); setTimeout(() => setToast(""), 3000); return; }
      const d = await r.json();
      if (d.token) localStorage.setItem("kmk_mobile_token", d.token);
      setUser(d.user);
      setScreen("missions");
    } catch {
      setToast("Connection failed — check your network");
      setTimeout(() => setToast(""), 3000);
    } finally {
      setLoginLoading(false);
    }
  }

  async function logout() {
    await apiFetch(`/api/app?action=logout`, { method: "POST" });
    localStorage.removeItem("kmk_mobile_token");
    setUser(null);
    setScreen("login");
  }

  /* ─── Photo capture ─── */
  function capturePhoto(type: PhotoItem["type"] = "billboard") {
    if (fileInputRef.current) {
      fileInputRef.current.setAttribute("data-photo-type", type);
      fileInputRef.current.click();
    }
  }

  async function optimizePhoto(file: File): Promise<string> {
    const source = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = document.createElement("img");
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = source;
    });
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.78);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    const type = (e.target.getAttribute("data-photo-type") || "billboard") as PhotoItem["type"];
    if (screen === "validations") {
      optimizePhoto(files[0])
        .then((data) => {
          setValidationPhoto(data);
          setPhotos([{ data, type: "billboard", caption: "Validation photo" }]);
        })
        .catch(() => setToast("Could not process this photo"));
      e.target.value = "";
      return;
    }
    Array.from(files).forEach((file) => {
      optimizePhoto(file)
        .then((data) => setPhotos((prev) => [...prev, { data, type, caption: "" }]))
        .catch(() => setToast("Could not process this photo"));
    });
    e.target.value = "";
  }

  function removePhoto(idx: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  }

  /* ─── Start collection ─── */
  function startCollect(mission: Mission) {
    setActiveMission(mission);
    let config: MissionConfig = {};
    try { config = JSON.parse(mission.config); } catch { /* empty */ }
    setMissionConfig(config);
    setPhotos([]);
    setFormData({});
    setGpsLocked(false);
    setLat(0);
    setLng(0);
    setAccuracy(0);
    setLamppostMode(false);
    setScreen("collect");
  }

  function startValidation(assignment: ValidationAssignment) {
    setActiveValidation(assignment);
    setValidationVerdict("");
    setIssueType("");
    setIssueDetail("");
    setCustomIssue("");
    setValidationPhoto("");
    setPhotos([]);
    setScreen("validations");
  }

  function openDirections(assignment: ValidationAssignment) {
    const asset = assignment.asset;
    const targetLat = Number(asset?.lat ?? assignment.latitude);
    const targetLng = Number(asset?.lng ?? assignment.longitude);
    if (!targetLat || !targetLng) {
      setToast("No GPS location for this billboard");
      setTimeout(() => setToast(""), 2500);
      return;
    }
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${targetLat},${targetLng}`, "_blank");
  }

  /* ─── Submit ─── */
  async function submitCollection() {
    setSubmitSuccess(false);
    if (!activeMission) return;
    if (!lat && !lng) { setToast("Waiting for GPS fix…"); setTimeout(() => setToast(""), 2000); return; }
    const required = missionConfig.requiredFields ?? ["district", "street"];
    const missing = required.filter((f) => !formData[f]?.trim());
    if (missing.length) { setToast(`Required: ${missing.join(", ")}`); setTimeout(() => setToast(""), 2500); return; }
    if (missionConfig.photoRequired && photos.length < (missionConfig.minPhotos ?? 1)) {
      setToast(`Need at least ${missionConfig.minPhotos ?? 1} photo(s)`);
      setTimeout(() => setToast(""), 2500);
      return;
    }
    setSubmitting(true);
    try {
      const r = await apiFetch(`/api/app?action=field-collections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          missionId: activeMission.id,
          latitude: lat,
          longitude: lng,
          accuracy,
          data: formData,
          photos: photos.map((p) => ({ data: p.data, type: p.type, caption: p.caption })),
        }),
      });
      if (r.ok) {
        setSubmitSuccess(true);
        setToast("Billboard submitted successfully!");
        setTimeout(() => { setToast(""); setSubmitSuccess(false); loadCollections(); setScreen("dashboard"); }, 1500);
      } else {
        setToast("Submission failed");
        setTimeout(() => setToast(""), 2500);
      }
    } catch {
      setToast("Network error");
      setTimeout(() => setToast(""), 2500);
    }
    setSubmitting(false);
  }

  async function submitValidationReport() {
    if (!activeValidation) return;
    if (!validationVerdict) {
      setToast("Confirm if the billboard is okay or has a problem");
      setTimeout(() => setToast(""), 2500);
      return;
    }
    const photo = validationPhoto || photos[0]?.data || "";
    if (validationVerdict === "ok" && !photo) {
      setToast("Take one confirmation photo");
      setTimeout(() => setToast(""), 2500);
      return;
    }
    if (validationVerdict === "issue" && !issueType) {
      setToast("Select the main problem");
      setTimeout(() => setToast(""), 2500);
      return;
    }
    setSubmitting(true);
    try {
      const r = await apiFetch(`/api/app?action=submit-validation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          assignmentId: activeValidation.id,
          verdict: validationVerdict,
          issueType,
          issueDetail,
          customIssue,
          photo,
          latitude: lat,
          longitude: lng,
          accuracy,
        }),
      });
      if (!r.ok) throw new Error("Validation failed");
      setToast(validationVerdict === "ok" ? "Validated and photo uploaded" : "Problem report submitted");
      await refreshAssignmentsAndMissions();
      setTimeout(() => { setToast(""); setScreen("missions"); }, 1200);
    } catch {
      setToast("Could not submit validation");
      setTimeout(() => setToast(""), 2500);
    } finally {
      setSubmitting(false);
    }
  }

  /* ─── Center on GPS ─── */
  function centerOnGps() {
    if (mapRef.current && gpsLocked) {
      mapRef.current.flyTo([lat, lng], 18, { duration: 0.5 });
    }
  }

  /* ─── Set field ─── */
  function setField(key: string, value: string) {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }

  /* ─── Lamppost bulk capture ─── */
  function captureLamppost() {
    capturePhoto("lamppost");
  }

  /* ─── Render ─── */

  // Login screen
  if (screen === "login") {
    return (
      <div className="mobile-screen login-screen">
        <div className="login-splash">
          <div className="login-splash-icon">
            <svg viewBox="0 0 48 48" width="48" height="48" fill="none">
              <rect x="10" y="12" width="28" height="16" rx="2" fill="white" />
              <rect x="10" y="12" width="28" height="3" fill="#0D9668" />
              <rect x="18" y="28" width="2" height="8" fill="#ccc" />
              <rect x="28" y="28" width="2" height="8" fill="#ccc" />
              <rect x="14" y="36" width="20" height="1.5" fill="#ccc" />
              <circle cx="24" cy="8" r="4" fill="none" stroke="#10B981" strokeWidth="1.5" />
              <circle cx="24" cy="8" r="1.5" fill="white" />
            </svg>
          </div>
          <h1 className="login-splash-title">Billboard 360</h1>
          <p className="login-splash-sub">Field Collection &amp; Validation</p>
        </div>
        <div className="login-card">
          <form onSubmit={login}>
            <div className="login-field">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" required autoComplete="username" placeholder="you@example.com" />
            </div>
            <div className="login-field">
              <label htmlFor="password">Password</label>
              <div className="password-wrap">
                <input id="password" name="password" type={showPassword ? "text" : "password"} required autoComplete="current-password" placeholder="••••••••" />
                <button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <button type="submit" className="btn-primary" disabled={loginLoading}>
              {loginLoading ? <span className="login-spinner" /> : "Sign In"}
            </button>
          </form>
        </div>
        <p className="login-footer">Billboard 360 · Spotlight OOH</p>
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  // Missions list
  if (screen === "missions") {
    const sortedValidations = [...validationAssignments]
      .map((assignment) => ({
        assignment,
        distance: distanceMeters(lat, lng, Number(assignment.asset?.lat ?? assignment.latitude), Number(assignment.asset?.lng ?? assignment.longitude)),
      }))
      .sort((a, b) => a.distance - b.distance);
    return (
      <div className="mobile-screen">
        <header className="mobile-header">
          <div>
            <strong>Billboard 360</strong>
            <small>{user?.name}</small>
          </div>
          <button className="icon-btn" onClick={logout}><LogOut size={20} /></button>
        </header>
        <div className="mission-list" onTouchStart={handlePullStart} onTouchEnd={handlePullEnd}>
          <section className="mission-intro">
            <span className="field-eyebrow">ASSIGNED WORK</span>
            <h1>Your missions</h1>
            <p>Select a mission or validation task. Pull down to refresh.</p>
            <div className="mission-summary"><strong>{missions.length + validationAssignments.length}</strong><span>{refreshing ? "Refreshing..." : "Available now"}</span></div>
            <button className="refresh-strip" onClick={() => refreshAssignmentsAndMissions()} disabled={refreshing}>
              <RefreshCw size={16} className={refreshing ? "spin" : ""} /> Refresh assignments
            </button>
          </section>
          {missionsLoading && <p className="empty-text">Loading assigned missions…</p>}
          {connectionError && <div className="mobile-error"><strong>Connection problem</strong><p>{connectionError}</p><button onClick={() => setMissionsRefresh((value) => value + 1)}>Try again</button></div>}
          {!missionsLoading && !connectionError && missions.length === 0 && sortedValidations.length === 0 && <p className="empty-text">No missions or validation tasks assigned to you yet.</p>}
          {sortedValidations.length > 0 && (
            <section className="validation-task-section">
              <div className="validation-section-title">
                <span>VALIDATION</span>
                <strong>{sortedValidations.length} billboard{sortedValidations.length === 1 ? "" : "s"}</strong>
              </div>
              <div className="mission-cards">
                {sortedValidations.map(({ assignment, distance }, index) => (
                  <article key={assignment.id} className="mission-card validation-card">
                    <button className="mission-card-main" onClick={() => startValidation(assignment)}>
                      <span className="mission-card-index">{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <strong>{assignment.asset?.street || `Billboard #${assignment.asset_id}`}</strong>
                        <small>{assignment.project_name} · {assignment.asset?.district || "Location pending"}</small>
                        <span className="mission-card-action"><MapPin size={13} /> {distanceLabel(distance)}</span>
                      </div>
                    </button>
                    <button className="directions-btn" onClick={() => openDirections(assignment)}><Navigation size={15} /> Directions</button>
                  </article>
                ))}
              </div>
            </section>
          )}
          <div className="mission-cards">
          {missions.map((m, index) => (
            <button key={m.id} className="mission-card" onClick={() => startCollect(m)}>
              <span className="mission-card-index">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{m.name}</strong>
                <small>{m.description || "Collect billboard data"}</small>
                <span className="mission-card-action"><MapPin size={13} /> Open field map</span>
              </div>
              <span className="mission-chevron"><ChevronRight size={18} /></span>
            </button>
          ))}
          </div>
        </div>
        <nav className="bottom-nav">
          <button className="bottom-nav-btn active" onClick={() => setScreen("missions")}>
            <ClipboardList size={22} /><span>Missions</span>
          </button>
          <button className="bottom-nav-btn" onClick={() => setScreen("dashboard")}>
            <LayoutGrid size={22} /><span>Dashboard</span>
          </button>
        </nav>
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  // Validation screen
  if (screen === "validations" && activeValidation) {
    const asset = activeValidation.asset;
    const issueTypes = ["Billboard not found", "Wrong GPS location", "Damaged structure", "Blocked visibility", "Wrong dimensions", "Wrong owner/vendor", "Unsafe access", "Other"];
    const issueDetails: Record<string, string[]> = {
      "Billboard not found": ["No structure at location", "Removed", "Cannot identify board"],
      "Wrong GPS location": ["Point is far from structure", "Coordinates are on wrong road", "Needs relocation"],
      "Damaged structure": ["Frame damaged", "Panel damaged", "Needs maintenance"],
      "Blocked visibility": ["Tree obstruction", "Building obstruction", "Vehicle/stall obstruction"],
      "Wrong dimensions": ["Size differs", "Faces differ", "Format differs"],
      "Wrong owner/vendor": ["Vendor name differs", "Owner unknown", "No vendor marking"],
      "Unsafe access": ["Traffic risk", "Restricted area", "Weather/access issue"],
      Other: ["Explain in custom note"],
    };
    return (
      <div className="mobile-screen collect-screen">
        <header className="mobile-header compact">
          <button className="icon-btn" onClick={() => setScreen("missions")}><ChevronLeft size={20} /></button>
          <div>
            <strong>Validate billboard</strong>
            <small>{asset?.street || `Billboard #${activeValidation.asset_id}`}</small>
          </div>
          <button className="icon-btn" onClick={() => openDirections(activeValidation)}><Navigation size={20} /></button>
        </header>
        <div className="collect-form validation-form">
          <section className="capture-brief">
            <div>
              <span>{activeValidation.project_name}</span>
              <strong>{asset?.street || `Billboard #${activeValidation.asset_id}`}</strong>
              <small>{asset?.district || "Location pending"} · {asset?.from || "From"} → {asset?.to || "To"}</small>
            </div>
          </section>

          <div className="form-section">
            <div className="form-section-title"><span>01</span><div><h3>Confirm status</h3><p>First say if this billboard is okay or not.</p></div></div>
            <div className="verdict-grid">
              <button className={validationVerdict === "ok" ? "verdict-card active ok" : "verdict-card"} onClick={() => setValidationVerdict("ok")}>
                <CheckCircle2 size={22} /><strong>Okay</strong><small>Only take one photo and submit.</small>
              </button>
              <button className={validationVerdict === "issue" ? "verdict-card active issue" : "verdict-card"} onClick={() => setValidationVerdict("issue")}>
                <ClipboardList size={22} /><strong>Not okay</strong><small>Fill structured problem report.</small>
              </button>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title"><span>02</span><div><h3>Evidence photo</h3><p>Photo is saved into the billboard image field when marked okay.</p></div></div>
            <button className="btn-secondary" onClick={() => capturePhoto("billboard")}><Camera size={16} /> Take validation photo</button>
            <input ref={fileInputRef} type="file" accept="image/*" capture="environment" hidden onChange={handleFileInput} />
            {validationPhoto && <div className="photo-preview single"><img src={validationPhoto} alt="Validation" /><button className="photo-remove" onClick={() => { setValidationPhoto(""); setPhotos([]); }}><Trash2 size={14} /></button></div>}
          </div>

          {validationVerdict === "issue" && (
            <div className="form-section">
              <div className="form-section-title"><span>03</span><div><h3>Problem report</h3><p>Choose the most important issue; add a note only if needed.</p></div></div>
              <label><span>Main issue</span>
                <select value={issueType} onChange={(event) => { setIssueType(event.target.value); setIssueDetail(""); }}>
                  <option value="">Select issue</option>
                  {issueTypes.map((option) => <option key={option}>{option}</option>)}
                </select>
              </label>
              {issueType && (
                <label><span>Detail</span>
                  <select value={issueDetail} onChange={(event) => setIssueDetail(event.target.value)}>
                    <option value="">Select detail</option>
                    {(issueDetails[issueType] ?? []).map((option) => <option key={option}>{option}</option>)}
                  </select>
                </label>
              )}
              <label><span>Other / custom note</span><textarea value={customIssue} onChange={(event) => setCustomIssue(event.target.value)} placeholder="Short explanation if the predefined answers are not enough" /></label>
            </div>
          )}

          <button className={`submit-btn ${submitting ? "is-submitting" : ""}`} onClick={submitValidationReport} disabled={submitting}>
            <span className="submit-icon">{submitting ? <LoaderCircle className="submit-loader" size={22} /> : <Send size={20} />}</span>
            <span className="submit-copy"><strong>{submitting ? "Submitting..." : "Submit validation"}</strong><small>Save report to planner</small></span>
          </button>
        </div>
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  // Dashboard screen
  if (screen === "dashboard") {
    const pending = collections.filter((c) => c.status === "pending").length;
    const validated = collections.filter((c) => c.status === "validated").length;
    const rejected = collections.filter((c) => c.status === "rejected").length;

    return (
      <div className="mobile-screen">
        <header className="mobile-header">
          <div>
            <strong>Dashboard</strong>
            <small>{user?.name}</small>
          </div>
          <button className="icon-btn" onClick={logout}><LogOut size={20} /></button>
        </header>
        <div className="dashboard-content">
          <section className="field-welcome">
            <div>
              <span className="field-eyebrow">FIELD WORKSPACE</span>
              <h1>Hello, {user?.name?.split(" ")[0]}</h1>
              <p>{missions.length > 0 ? `${missions.length} mission${missions.length === 1 ? "" : "s"} ready for collection.` : "You are signed in and ready for assignments."}</p>
            </div>
            <button className="start-field-btn" onClick={() => setScreen("missions")}>
              <MapPin size={18} /> View missions
            </button>
          </section>

          <div className="dash-section-heading">
            <div>
              <span>MY ACTIVITY</span>
              <h2>Collection status</h2>
            </div>
            <strong>{collections.length}</strong>
          </div>
          <div className="dash-stats-row">
            <div className="dash-stat-card">
              <span className="dash-stat-num">{collections.length}</span>
              <span className="dash-stat-label">Total</span>
            </div>
            <div className="dash-stat-card dash-stat--pending">
              <span className="dash-stat-num">{pending}</span>
              <span className="dash-stat-label">Pending</span>
            </div>
            <div className="dash-stat-card dash-stat--ok">
              <span className="dash-stat-num">{validated}</span>
              <span className="dash-stat-label">Validated</span>
            </div>
            <div className="dash-stat-card dash-stat--bad">
              <span className="dash-stat-num">{rejected}</span>
              <span className="dash-stat-label">Rejected</span>
            </div>
          </div>

          <div className="dash-section-heading recent-heading">
            <div><span>LATEST</span><h2>Recent collections</h2></div>
          </div>
          {collections.length === 0 && (
            <div className="dashboard-empty">
              <div className="dashboard-empty-icon"><ClipboardList size={24} /></div>
              <strong>No collections yet</strong>
              <p>Open an assigned mission to collect your first billboard.</p>
              <button onClick={() => setScreen("missions")}>Open missions <ChevronRight size={16} /></button>
            </div>
          )}
          <div className="collection-list">
            {collections.map((c) => {
              const data = typeof c.data === "string" ? JSON.parse(c.data) : c.data;
              return (
                <div key={c.id} className="collection-card">
                  <div className="collection-card-top">
                    <strong>{data?.street || data?.district || "Collection #" + c.id}</strong>
                    <span className={`collection-status collection-status--${c.status}`}>{c.status}</span>
                  </div>
                  <small>
                    {data?.region && `${data.region}, `}
                    {data?.district && `${data.district}`}
                    {data?.owner && ` · ${data.owner}`}
                  </small>
                  <small className="collection-meta">
                    {new Date(c.created_at).toLocaleDateString()} · {c.collector || "You"}
                  </small>
                </div>
              );
            })}
          </div>
        </div>
        <nav className="bottom-nav">
          <button className="bottom-nav-btn" onClick={() => setScreen("missions")}>
            <ClipboardList size={22} /><span>Missions</span>
          </button>
          <button className="bottom-nav-btn active" onClick={() => setScreen("dashboard")}>
            <LayoutGrid size={22} /><span>Dashboard</span>
          </button>
        </nav>
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  // Collection form
  if (screen === "collect") {
    const fields = missionConfig.requiredFields ?? ["district", "street"];
    const standardFields = ["region", "district", "ward", "shehia", "street", "from", "to", "owner", "dimensions", "faces", "media_type", "occupancy", "photo_url", "remarks"];
    const allFields = [...new Set([...fields, ...standardFields])];
    const gpsStatus = gpsQuality(accuracy, gpsLocked);
    const primaryFieldGroups = [
      { title: "Area", hint: "Administrative location", fields: ["region", "district", "ward", "shehia"] },
      { title: "Road segment", hint: "Where the board is seen from and towards", fields: ["street", "from", "to"] },
      { title: "Board profile", hint: "Format, size, faces and owner", fields: ["media_type", "dimensions", "faces", "owner", "occupancy"] },
      { title: "Media links & notes", hint: "Optional image link and remarks", fields: ["photo_url", "remarks"] },
    ];
    const groupedFieldNames = new Set(primaryFieldGroups.flatMap((group) => group.fields));
    const fieldGroups = [
      ...primaryFieldGroups,
      { title: "Additional fields", hint: "Configured for this mission", fields: allFields.filter((field) => !groupedFieldNames.has(field)) },
    ].map((group) => ({ ...group, fields: group.fields.filter((field) => allFields.includes(field)) })).filter((group) => group.fields.length);
    const renderField = (field: string) => (
      <label key={field} className={fields.includes(field) ? "required-field" : ""}>
        <span>{fieldLabel(field)}{fields.includes(field) ? " *" : ""}</span>
        {FIELD_SELECT_OPTIONS[field] ? (
          <select
            value={formData[field] ?? ""}
            onChange={(e) => setField(field, e.target.value)}
            required={fields.includes(field)}
          >
            <option value="">{fields.includes(field) ? "Select required value" : "Select optional value"}</option>
            {FIELD_SELECT_OPTIONS[field].map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        ) : (
          <input
            value={formData[field] ?? ""}
            onChange={(e) => setField(field, e.target.value)}
            placeholder={field === "dimensions" ? "e.g. 12x4 or 1x1" : fields.includes(field) ? "Required" : "Optional"}
          />
        )}
      </label>
    );

    return (
      <div className="mobile-screen collect-screen">
        <header className="mobile-header compact">
          <button className="icon-btn" onClick={() => setScreen("missions")}><ChevronLeft size={20} /></button>
          <div>
            <strong>{activeMission?.name}</strong>
            <small className={`gps-status ${gpsLocked ? "gps-ok" : "gps-waiting"}`}>
              {gpsLocked ? `GPS ready · ±${accuracy.toFixed(0)}m` : "Acquiring GPS…"}
            </small>
          </div>
          <button className="icon-btn" onClick={centerOnGps}><Crosshair size={20} /></button>
        </header>

        {/* Map */}
        <div ref={mapNode} className="collect-map" />

        {/* Form */}
        <div className="collect-form">
          <section className="capture-brief">
            <div>
              <span>Field capture</span>
              <strong>{formData.media_type || "Select board type"}</strong>
              <small>{formData.street ? `${formData.street}${formData.from || formData.to ? ` · ${formData.from || "From"} → ${formData.to || "To"}` : ""}` : "Capture location, road segment and billboard details."}</small>
            </div>
            <div className="capture-score">
              <b>{photos.length}</b>
              <small>photos</small>
            </div>
          </section>

          <div className="form-section">
            <div className="form-section-title"><span>01</span><div><h3>Location</h3><p>Confirm the captured GPS position.</p></div></div>
            <div className={`gps-accuracy-card ${gpsStatus.className}`}>
              <div>
                <span>GPS Accuracy</span>
                <strong>{gpsLocked ? `±${accuracy.toFixed(0)} m` : "No fix"}</strong>
              </div>
              <div>
                <span>Resolution</span>
                <strong>{gpsStatus.label}</strong>
              </div>
              <p>{gpsStatus.detail}. Target is ±{GPS_TARGET_METERS} m or better.</p>
            </div>
            <div className="form-row">
              <label><span>Lat</span><input type="number" step="any" value={lat || ""} onChange={(e) => setLat(Number(e.target.value))} /></label>
              <label><span>Lng</span><input type="number" step="any" value={lng || ""} onChange={(e) => setLng(Number(e.target.value))} /></label>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title"><span>02</span><div><h3>Billboard details</h3><p>Add the required inventory attributes.</p></div></div>
            <div className="form-groups">
              {fieldGroups.map((group) => (
                <section className="form-group-card" key={group.title}>
                  <div className="form-group-head">
                    <strong>{group.title}</strong>
                    <small>{group.hint}</small>
                  </div>
                  <div className="form-fields">
                    {group.fields.map(renderField)}
                  </div>
                </section>
              ))}
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title"><span>03</span><div><h3>Field photos <b>{photos.length}</b></h3><p>Capture clear evidence of the structure and surroundings.</p></div></div>
            <div className="photo-actions">
              <button className="btn-secondary" onClick={() => capturePhoto("billboard")}>
                <Camera size={16} /> Billboard photo
              </button>
              {missionConfig.lamppostCapture && (
                <button className="btn-secondary" onClick={captureLamppost}>
                  <Image size={16} /> Lamppost (bulk)
                </button>
              )}
              <button className="btn-secondary" onClick={() => capturePhoto("panorama")}>
                <MapPin size={16} /> Panorama
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple={lamppostMode}
              hidden
              onChange={handleFileInput}
            />
            {photos.length > 0 && (
              <div className="photo-preview-grid">
                {photos.map((p, i) => (
                  <div key={i} className="photo-preview">
                    <img src={p.data} alt={p.type} />
                    <span className="photo-label">{p.type}</span>
                    <button className="photo-remove" onClick={() => removePhoto(i)}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            className={`submit-btn ${submitting ? "is-submitting" : ""} ${submitSuccess ? "is-success" : ""}`}
            onClick={submitCollection}
            disabled={submitting || submitSuccess}
          >
            <span className="submit-icon">
              {submitSuccess ? <CheckCircle2 size={22} /> : submitting ? <LoaderCircle className="submit-loader" size={22} /> : <Send size={20} />}
            </span>
            <span className="submit-copy">
              <strong>{submitSuccess ? "Billboard submitted" : submitting ? "Sending to planner…" : "Submit billboard"}</strong>
              <small>{submitSuccess ? "Saved successfully" : submitting ? "Keep the app open" : "Save GPS, details and photos"}</small>
            </span>
            {!submitting && !submitSuccess && <span className="submit-arrow"><ChevronRight size={19} /></span>}
          </button>
        </div>

        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  return null;
}
