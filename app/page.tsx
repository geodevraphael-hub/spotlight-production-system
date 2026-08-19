"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Check,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  FileUp,
  Layers3,
  LocateFixed,
  LockKeyhole,
  MapPin,
  Maximize2,
  Move,
  PanelLeftClose,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserCog,
  X,
} from "lucide-react";
import type {
  Map as LeafletMap,
  Marker as LeafletMarker,
  TileLayer,
} from "leaflet";
import "leaflet/dist/leaflet.css";

const DISTRICT_RENAMES: Record<string, string> = {
  Kariakooo: "Gaden",
  Kariakoo: "Gaden",
};

function renameDistrict(name: string) {
  return DISTRICT_RENAMES[name.trim()] ?? name;
}

type Billboard = {
  id: number;
  district: string;
  street: string;
  owner: string;
  vendor?: string;
  from: string;
  to: string;
  brackets: string;
  height: number;
  width: number;
  occupied: boolean;
  advert: string;
  faces: number;
  arrangement: string;
  lampPosts: number;
  lat: number;
  lng: number;
  mediaType?: "lamp-post" | "large-format" | "digital-screen" | "fabricated-banner";
  status?: "selected" | "not-selected" | string;
  orientation?: string;
  areaSqm?: number;
  photoUrl?: string;
  photoOriginalUrl?: string;
  sourceAttributes?: Record<string, string>;
  flightStatus?: string;
  flightStage?: string;
  flightExpiry?: number | string;
  validationStatus?: string;
  validatedAt?: number;
  validatedBy?: number;
  inventoryDbId?: number;
  projectId?: number;
  projectName?: string;
  originalAssetId?: number;
  rentalPrice?: number;
  printingPrice?: number;
  transportPrice?: number;
  flightingPrice?: number;
};

type BoardType = NonNullable<Billboard["mediaType"]>;

type Project = {
  id: number;
  name: string;
  project_type: string;
  share_token: string;
  created_by?: number;
  share_code?: string;
  share_protected?: number | boolean;
};

type CostBreakdown = {
  rental: string;
  printing: string;
  transport: string;
  flighting: string;
};

type CampaignPlan = {
  id: number;
  name: string;
  creator?: string;
  note: string;
  data: { shortlist: number[]; costs: Record<number, CostBreakdown> };
};

type FlightSchedule = {
  id?: number;
  project_id: number;
  asset_id: number;
  stage: string;
  flight_status: string;
  start_at?: number;
  end_at?: number;
  duration_days: number;
  reminder_days: number;
  note?: string;
  last_notified_at?: number;
};

type ProjectContact = {
  id?: number;
  project_id: number;
  name: string;
  emails: string;
  phones: string;
  is_default?: number;
};

type ValidationAssignment = {
  id: number;
  project_id: number;
  asset_id: number;
  assigned_to: number;
  status: string;
  assignee_name?: string;
  assignee_email?: string;
  asset?: Billboard | null;
  report?: Record<string, unknown>;
  updated_at: number;
};

const EXECUTION_STATUS_OPTIONS = {
  artworkDelivery: ["RECEIVED", "PENDING", "NOT RECEIVED", "CXD"],
  artworkApproval: ["APPROVED", "RETURNED", "CXD", "PENDING"],
  artworkToVendor: ["SENT", "RETURNED", "CXD", "PENDING"],
  printingStatus: ["COMPLETE", "IN PROGRESS", "PENDING", "CXD", "NOT STARTED", "N/A"],
  deliveredToDestination: ["RECEIVED", "PENDING", "NOT FOUND", "NOT RECEIVED", "CXD"],
};

const TRACKER_ATTR_KEYS: Record<string, string[]> = {
  artworkDelivery: ["ARTWORK DELIVERY", "artworkDelivery"],
  artworkApproval: ["ARTWORK APPROVAL", "artworkApproval"],
  artworkToVendor: ["ARTWORK TO VENDOR", "artworkToVendor"],
  printingStatus: ["PRINTING STATUS", "printingStatus"],
  printerRemarks: ["REMARKS FROM PRINTER", "printerRemarks"],
  reprintReason: ["REASONS FOR RE-PRINT", "reprintReason"],
  changeComment: ["COMMENT OF CHANGE", "changeComment"],
  deliveredToDestination: ["DELIVERED TO DESTINATION", "deliveredToDestination"],
};

function textValue(node: Element, field: string) {
  return (
    Array.from(node.querySelectorAll("Data")).find(
      (item) => item.getAttribute("name") === field,
    )?.querySelector("value")?.textContent?.trim() ?? ""
  );
}

function normalizeMediaType(value: string): BoardType {
  const text = value.trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (text.includes("digital") || text.includes("screen") || text.includes("led")) return "digital-screen";
  if (text.includes("fabricated") || text.includes("banner") || text.includes("baner") || text.includes("barnner")) return "fabricated-banner";
  if (text.includes("large") || text.includes("billboard") || text.includes("format")) return "large-format";
  return "lamp-post";
}

function mediaTypeLabel(value?: Billboard["mediaType"]) {
  if (value === "fabricated-banner") return "Fabricated banner";
  if (value === "digital-screen") return "Digital screen";
  if (value === "large-format") return "Large format";
  return "Lamp post";
}

function normalizeUploadStatus(value: string) {
  const text = value.trim().toLowerCase().replace(/[_\s-]+/g, " ");
  if (!text) return "not-selected";
  if (text.includes("not") || text.includes("unselected") || text === "no" || text === "0" || text === "false") return "not-selected";
  if (text.includes("selected") || text === "yes" || text === "1" || text === "true") return "selected";
  return text;
}

function statusLabel(value?: Billboard["status"]) {
  if (value === "selected") return "Selected";
  if (value === "not-selected" || !value) return "Not selected";
  return String(value);
}

function validationStatusLabel(value?: string) {
  if (value === "issue") return "Not okay";
  if (value === "ok") return "Okay";
  if (value === "in_progress") return "In progress";
  if (value === "assigned") return "Assigned";
  return value || "Not assigned";
}

function validationReportLines(report?: Record<string, unknown>) {
  if (!report) return [];
  const lines: Array<[string, string]> = [
    ["Main issue", String(report.issueType ?? "")],
    ["Detail", String(report.issueDetail ?? "")],
    ["Note", String(report.customIssue ?? "")],
    ["GPS", report.latitude && report.longitude ? `${Number(report.latitude).toFixed(6)}, ${Number(report.longitude).toFixed(6)}` : ""],
    ["Accuracy", report.accuracy ? `${Number(report.accuracy).toFixed(1)}m` : ""],
    ["Admin remark", String(report.adminRemark ?? "")],
  ];
  return lines.filter(([, value]) => value.trim());
}

function parseJsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  try {
    const parsed = JSON.parse(String(value ?? "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_/-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, "")
    .replace(/\s+/g, " ");
}

function parseNumber(value: string) {
  const cleaned = String(value ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/)?.[0] ?? "";
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseDimensions(value: string) {
  const parts = String(value ?? "")
    .toLowerCase()
    .replace(/[×*]/g, "x")
    .split("x")
    .map(parseNumber)
    .filter((item) => item > 0);
  return { width: parts[0] ?? 0, height: parts[1] ?? 0 };
}

function csvEscape(value: string | number) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeHtml(value: string | number | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function imageErrorHandler() {
  return "this.closest('button')?.classList.add('image-load-failed');this.remove();";
}

function googleDriveFileId(value: string | undefined) {
  const text = String(value ?? "").trim();
  if (!text || text.startsWith("data:")) return "";
  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase();
    if (!host.includes("drive.google.com") && !host.includes("docs.google.com")) return "";
    const id = url.searchParams.get("id");
    if (id) return id;
    const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
    if (fileMatch?.[1]) return fileMatch[1];
    const foldersMatch = url.pathname.match(/\/folders\/([^/]+)/);
    if (foldersMatch?.[1]) return foldersMatch[1];
  } catch {
    return "";
  }
  return "";
}

function normalizeImageUrl(value: string | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const driveId = googleDriveFileId(text);
  if (driveId) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveId)}&sz=w1200`;
  return text;
}

function originalImageUrl(value: string | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const driveId = googleDriveFileId(text);
  if (driveId) return `https://drive.google.com/file/d/${encodeURIComponent(driveId)}/view`;
  return text;
}

function billboardImageUrl(item: Billboard) {
  return normalizeImageUrl(item.photoUrl || item.photoOriginalUrl);
}

function billboardOriginalImageUrl(item: Billboard) {
  return originalImageUrl(item.photoOriginalUrl || item.photoUrl);
}

function sourceAttrValue(attrs: Record<string, string>, keys: string[], fallback = "") {
  for (const key of keys) {
    const exact = attrs[key];
    if (exact !== undefined && String(exact).trim() !== "") return String(exact).trim();
    const normalizedKey = normalizeHeader(key);
    const matched = Object.entries(attrs).find(([candidate]) => normalizeHeader(candidate) === normalizedKey);
    if (matched && String(matched[1]).trim() !== "") return String(matched[1]).trim();
  }
  return fallback;
}

function applySourceAttributesToBillboard(item: Billboard, attrs: Record<string, string>): Billboard {
  const dimension = parseDimensions(sourceAttrValue(attrs, ["DIMENSION", "SIZE", "FORMAT", "TOTAL SQ.M /DURATION"], ""));
  const lat = parseNumber(sourceAttrValue(attrs, ["Latitude", "LATITUDE", "lat"], ""));
  const lng = parseNumber(sourceAttrValue(attrs, ["Longitude", "LONGITUDE", "lng", "lon"], ""));
  const photoUrl = sourceAttrValue(attrs, ["Photo URL", "PHOTO URL", "IMAGE URL", "Image URL", "photoUrl"], item.photoOriginalUrl || item.photoUrl || "");
  const height = parseNumber(sourceAttrValue(attrs, ["HEIGHT (M)", "HEIGHT", "height"], ""));
  const width = parseNumber(sourceAttrValue(attrs, ["WIDTH (M)", "WIDTH", "width"], ""));
  const faces = parseNumber(sourceAttrValue(attrs, ["FACES", "faces"], ""));
  const lampPosts = parseNumber(sourceAttrValue(attrs, ["LAMP POSTS", "LAMPPOSTS", "INSTALLATION", "lampPosts"], ""));
  const mediaType = sourceAttrValue(attrs, ["MEDIA TYPE", "TYPE", "BOARD TYPE", "mediaType"], "");
  const status = sourceAttrValue(attrs, ["STATUS", "status"], "");
  return {
    ...item,
    sourceAttributes: attrs,
    district: sourceAttrValue(attrs, ["DISTRICT", "district"], item.district),
    street: sourceAttrValue(attrs, ["SPECIFIC LOCATION", "specificLocation", "ROAD/STREET", "ROAD (From - To)", "STREET", "street"], item.street),
    owner: sourceAttrValue(attrs, ["VENDOR", "OWNER", "owner"], item.owner),
    vendor: sourceAttrValue(attrs, ["VENDOR", "OWNER", "vendor"], item.vendor || item.owner),
    from: sourceAttrValue(attrs, ["Traffic Visibility (From)", "FROM", "from"], item.from),
    to: sourceAttrValue(attrs, ["Traffic Visibility (To)", "TO", "to"], item.to),
    brackets: sourceAttrValue(attrs, ["BRACKETS", "brackets"], item.brackets),
    arrangement: sourceAttrValue(attrs, ["ARRANGEMENT", "ORIENTATION", "orientation"], item.arrangement),
    advert: sourceAttrValue(attrs, ["CURRENT ADVERT", "ADVERT", "advert"], item.advert),
    height: height || dimension.height || item.height,
    width: width || dimension.width || item.width,
    faces: faces || item.faces,
    lampPosts: lampPosts || item.lampPosts,
    lat: lat || item.lat,
    lng: lng || item.lng,
    mediaType: mediaType ? normalizeMediaType(mediaType) : item.mediaType,
    status: status ? normalizeUploadStatus(status) : item.status,
    photoUrl: normalizeImageUrl(photoUrl),
    photoOriginalUrl: photoUrl && normalizeImageUrl(photoUrl) !== photoUrl ? originalImageUrl(photoUrl) : item.photoOriginalUrl,
  };
}

function markerSize(item: Billboard) {
  const ratio = item.height > 0 ? item.width / item.height : 1;
  const markerWidth = Math.max(24, Math.min(58, 30 * Math.sqrt(Math.max(ratio, 0.2))));
  const markerHeight = Math.max(22, Math.min(48, markerWidth / Math.max(ratio, 0.4)));
  return { markerWidth, markerHeight };
}

function markerHtml(item: Billboard, active: boolean) {
  const available = !item.occupied;
  const flighted = String(item.flightStatus ?? "").toLowerCase() === "flighted";
  const expired = flighted && Boolean(Number(item.flightExpiry || 0) && Number(item.flightExpiry || 0) <= Date.now());
  const { markerWidth, markerHeight } = markerSize(item);
  return `<span style="width:${markerWidth}px;height:${markerHeight}px" class="asset-marker ${item.mediaType === "large-format" ? "asset-marker--large" : item.mediaType === "digital-screen" ? "asset-marker--digital" : item.mediaType === "fabricated-banner" ? "asset-marker--fabricated" : "asset-marker--lamp"} ${available ? "asset-marker--available" : ""} ${flighted ? "asset-marker--flighted" : ""} ${expired ? "asset-marker--expired" : ""} ${active ? "asset-marker--active" : ""}"><i></i><b>${escapeHtml(item.faces)}</b></span>`;
}

function popupHtml(item: Billboard) {
  const imageUrl = billboardImageUrl(item);
  const image = imageUrl
    ? `<button type="button" class="asset-popup-image" data-image-url="${escapeHtml(imageUrl)}"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.street)} image" loading="lazy" onerror="${imageErrorHandler()}" /><em>Image unavailable</em><span>Open image</span></button>`
    : `<div class="asset-popup-empty">No image link</div>`;
  const project = item.projectName ? `<small>${escapeHtml(item.projectName)}</small>` : "";
  return `<div class="asset-popup">${image}<strong>${escapeHtml(item.street)}</strong>${project}<small>${escapeHtml(mediaTypeLabel(item.mediaType))} · ${escapeHtml(item.district)}</small><span>${escapeHtml(item.from)} → ${escapeHtml(item.to)}</span></div>`;
}

function markImageFailed(event: React.SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.display = "none";
  event.currentTarget.parentElement?.classList.add("image-load-failed");
}

function imageFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read image"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Unable to process image"));
      image.onload = () => {
        const maxSide = 1280;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Unable to process image"));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.src = String(reader.result ?? "");
    };
    reader.readAsDataURL(file);
  });
}

function parseBillboards(xmlText: string): Billboard[] {
  const xml = new DOMParser().parseFromString(xmlText, "text/xml");
  return Array.from(xml.querySelectorAll("Placemark")).map((node, index) => ({
    id: Number(textValue(node, "index")) || index + 1,
    district: renameDistrict(node.querySelector("name")?.textContent?.trim() || "Unknown"),
    street: textValue(node, "Jina la Eneo/Mtaa") || "Unspecified street",
    owner: textValue(node, "Jina la Mmiliki") || "Unknown",
    from: textValue(node, "Kutoka") || "—",
    to: textValue(node, "Kwenda") || "—",
    brackets: textValue(node, "Brackets") || "—",
    height: Number(textValue(node, "Urefu (M)")) || 0,
    width: Number(textValue(node, "Upana (M)")) || 0,
    occupied:
      textValue(node, "Kunatangazo kwenye Lampost").toLowerCase() === "ndio",
    advert:
      textValue(node, "Tangazo gani lipo kwenye Lampost?") || "No advert recorded",
    faces: Number(textValue(node, "Faces")) || 0,
    arrangement: textValue(node, "Mpangililo") || "Not recorded",
    lampPosts:
      Number(textValue(node, "Idadi ya Lampost kwenye Mtaa/Barabara")) || 0,
    lat: Number(textValue(node, "latitude")),
    lng: Number(textValue(node, "longitude")),
  })).filter((item) =>
    Number.isFinite(item.lat) &&
    Number.isFinite(item.lng) &&
    item.lat !== 0 &&
    item.lng !== 0
  );
}

function parseCompleteInventory(xmlText: string): Billboard[] {
  const xml = new DOMParser().parseFromString(xmlText, "text/xml");
  return Array.from(xml.querySelectorAll("Placemark"))
    .map((node, index) => {
      const large = Boolean(textValue(node, "SN"));
      const typeValue =
        textValue(node, "TYPE") ||
        textValue(node, "Type") ||
        textValue(node, "MEDIA TYPE") ||
        textValue(node, "Media Type") ||
        textValue(node, "FORMAT") ||
        textValue(node, "Format");
      const photoUrl =
        textValue(node, "PHOTO URL") ||
        textValue(node, "Photo URL") ||
        textValue(node, "IMAGE URL") ||
        textValue(node, "Image URL") ||
        textValue(node, "PHOTO_URL") ||
        textValue(node, "IMAGE_URL");
      const statusValue =
        textValue(node, "STATUS") ||
        textValue(node, "Status") ||
        textValue(node, "Selection Status");
      return {
        id: large
          ? 1000 + Number(textValue(node, "SN"))
          : Number(textValue(node, "index")) || index + 1,
        district: renameDistrict(
          large
            ? textValue(node, "REGION")
            : node.querySelector("name")?.textContent?.trim() || "Unknown",
        ),
        street: large
          ? node.querySelector("name")?.textContent?.trim() || "Large format"
          : textValue(node, "Jina la Eneo/Mtaa") || "Unspecified street",
        owner: large
          ? textValue(node, "VENDOR") || "Unknown"
          : textValue(node, "Jina la Mmiliki") || "Unknown",
        from: large
          ? textValue(node, "ROAD (From - To)") || "—"
          : textValue(node, "Kutoka") || "—",
        to: large
          ? textValue(node, "VISIBILITY") || "—"
          : textValue(node, "Kwenda") || "—",
        brackets: large ? "Installed" : textValue(node, "Brackets") || "—",
        height:
          Number(textValue(node, large ? "HEIGHT (M)" : "Urefu (M)")) || 0,
        width:
          Number(textValue(node, large ? "WIDTH (M)" : "Upana (M)")) || 0,
        occupied: large
          ? false
          : textValue(node, "Kunatangazo kwenye Lampost").toLowerCase() ===
            "ndio",
        advert: large
          ? "Large-format inventory"
          : textValue(node, "Tangazo gani lipo kwenye Lampost?") ||
            "No advert recorded",
        faces: Number(textValue(node, large ? "FACES" : "Faces")) || 1,
        arrangement: large
          ? textValue(node, "ORIENTATION") || "Not recorded"
          : textValue(node, "Mpangililo") || "Not recorded",
        lampPosts: large
          ? 0
          : Number(
              textValue(node, "Idadi ya Lampost kwenye Mtaa/Barabara"),
            ) || 0,
        lat: Number(textValue(node, large ? "LATITUDE" : "latitude")),
        lng: Number(textValue(node, large ? "LONGITUDE" : "longitude")),
        mediaType: typeValue ? normalizeMediaType(typeValue) : large ? ("large-format" as const) : ("lamp-post" as const),
        status: normalizeUploadStatus(statusValue),
        orientation: large ? textValue(node, "ORIENTATION") : undefined,
        areaSqm: large ? Number(textValue(node, "TOTAL SQ.M")) || 0 : undefined,
        photoUrl: normalizeImageUrl(photoUrl),
        photoOriginalUrl: photoUrl && normalizeImageUrl(photoUrl) !== photoUrl ? originalImageUrl(photoUrl) : undefined,
      };
    })
    .filter(
      (item) =>
        Number.isFinite(item.lat) &&
        Number.isFinite(item.lng) &&
        item.lat !== 0 &&
        item.lng !== 0,
    );
}

function Metric({
  value,
  label,
  accent,
}: {
  value: string | number;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className={accent ? "metric metric--accent" : "metric"}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function shortDate(value?: number) {
  return value ? new Date(value).toLocaleDateString() : "Not set";
}

function remainingDays(value?: number) {
  if (!value) return "Not set";
  const days = Math.ceil((value - Date.now()) / 86400000);
  if (days < 0) return `${Math.abs(days)} overdue`;
  if (days === 0) return "Due today";
  return `${days} day(s)`;
}

function remainingDaysNumber(value?: number) {
  return value ? Math.ceil((value - Date.now()) / 86400000) : null;
}

function trackerValue(item: Billboard, field: string, fallback = "") {
  const keys = TRACKER_ATTR_KEYS[field] ?? [field];
  for (const key of keys) {
    const value = item.sourceAttributes?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value);
  }
  return fallback;
}

function miniMapUrl(item: Billboard) {
  const pad = 0.0025;
  const west = item.lng - pad;
  const south = item.lat - pad;
  const east = item.lng + pad;
  const north = item.lat + pad;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${west}%2C${south}%2C${east}%2C${north}&layer=mapnik&marker=${item.lat}%2C${item.lng}`;
}

export default function Home() {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const tileRef = useRef<TileLayer | null>(null);
  const labelsRef = useRef<TileLayer | null>(null);
  const markersRef = useRef<Map<number, LeafletMarker>>(new Map());
  const leafletRef = useRef<any>(null);
  const lastExtentFitRef = useRef("");
  const [billboards, setBillboards] = useState<Billboard[]>([]);
  const [selected, setSelected] = useState<Billboard | null>(null);
  const [query, setQuery] = useState("");
  const [district, setDistrict] = useState("All areas");
  const [availability, setAvailability] = useState("All status");
  const [boardTypeFilter, setBoardTypeFilter] = useState("All types");
  const [mapFlightFilter, setMapFlightFilter] = useState("All flight status");
  const [allProjectsProjectFilter, setAllProjectsProjectFilter] = useState("All projects");
  const [shortlist, setShortlist] = useState<number[]>([]);
  const [costs, setCosts] = useState<Record<number, CostBreakdown>>({});
  const [planOpen, setPlanOpen] = useState(false);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ id: number; name: string; email: string; role: string } | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [adminOpen, setAdminOpen] = useState(false);
  const [users, setUsers] = useState<Array<{ id: number; name: string; email: string; role: string }>>([]);
  const [baseMap, setBaseMap] = useState("street");
  const [mapReady, setMapReady] = useState(false);
  const [planNote, setPlanNote] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState(1);
  const [projectOpen, setProjectOpen] = useState(false);
  const [plans, setPlans] = useState<CampaignPlan[]>([]);
  const [currentPlanId, setCurrentPlanId] = useState<number | null>(null);
  const [planName, setPlanName] = useState("Campaign Plan 1");
  const [compareOpen, setCompareOpen] = useState(false);
  const [flightSchedules, setFlightSchedules] = useState<FlightSchedule[]>([]);
  const [projectContacts, setProjectContacts] = useState<ProjectContact[]>([]);
  const [flightDraft, setFlightDraft] = useState({ stage: "design", flightStatus: "unflighted", durationDays: "30", reminderDays: "3", note: "" });
  const [contactDraft, setContactDraft] = useState<{ id?: number; name: string; emails: string; phones: string; projectId: string }>({ name: "", emails: "", phones: "", projectId: "project" });
  const [flightSaving, setFlightSaving] = useState(false);
  const [flightAssetPopup, setFlightAssetPopup] = useState<Billboard | null>(null);
  const [flightSearch, setFlightSearch] = useState("");
  const [flightStatusFilter, setFlightStatusFilter] = useState("all");
  const [flightColumnFilters, setFlightColumnFilters] = useState({ billboard: "", type: "", location: "", stage: "", status: "", endDate: "" });
  const [trackerSavingId, setTrackerSavingId] = useState<number | null>(null);
  const [trackerFilters, setTrackerFilters] = useState({
    search: "",
    type: "All",
    vendor: "All",
    artworkDelivery: "All",
    artworkApproval: "All",
    artworkToVendor: "All",
    printingStatus: "All",
    deliveredToDestination: "All",
    flightStatus: "All",
    rentalMin: "",
    rentalMax: "",
    totalMin: "",
    totalMax: "",
    remainingMin: "",
    remainingMax: "",
  });
  const [facesFilter, setFacesFilter] = useState("All faces");
  const [csvImport, setCsvImport] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [csvMap, setCsvMap] = useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [editingPosition, setEditingPosition] = useState(false);
  const [placingAsset, setPlacingAsset] = useState(false);
  const [boxSelectMode, setBoxSelectMode] = useState(false);
  const [assetDraft, setAssetDraft] = useState<Partial<Billboard>>({});
  const [positionHint, setPositionHint] = useState<string | null>(null);
  const [addressQuery, setAddressQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"planner" | "dashboard" | "library" | "flighting" | "tracker" | "field">("planner");
  const [fieldCollections, setFieldCollections] = useState<any[]>([]);
  const [missions, setMissions] = useState<any[]>([]);
  const [userGroups, setUserGroups] = useState<any[]>([]);
  const [boundaries, setBoundaries] = useState<any[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<any | null>(null);
  const [collectionPhotos, setCollectionPhotos] = useState<any[]>([]);
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  const [photoLinkDraft, setPhotoLinkDraft] = useState("");
  const [photoSaving, setPhotoSaving] = useState(false);
  const [sourceAttrDraft, setSourceAttrDraft] = useState<Record<string, string>>({});
  const [sourceAttrSaving, setSourceAttrSaving] = useState(false);
  const [missionFormOpen, setMissionFormOpen] = useState(false);
  const [editingMission, setEditingMission] = useState<any | null>(null);
  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<any | null>(null);
  const [sharedToken, setSharedToken] = useState<string | null>(null);
  const [shareCodeInput, setShareCodeInput] = useState("");
  const [shareError, setShareError] = useState("");
  const [sharedProject, setSharedProject] = useState<Project | null>(null);
  const [sharePanelOpen, setSharePanelOpen] = useState(false);
  const [shareRequiresCode, setShareRequiresCode] = useState(false);
  const [shareChecking, setShareChecking] = useState(false);
  const [assignProjectOpen, setAssignProjectOpen] = useState(false);
  const [assignTargetProjectId, setAssignTargetProjectId] = useState("");
  const [assignNewProjectName, setAssignNewProjectName] = useState("");
  const [assignProjectSaving, setAssignProjectSaving] = useState(false);
  const [validationAssignments, setValidationAssignments] = useState<ValidationAssignment[]>([]);
  const [validationAssigneeId, setValidationAssigneeId] = useState("");
  const [validationSaving, setValidationSaving] = useState(false);
  const [validationApprovalDrafts, setValidationApprovalDrafts] = useState<Record<number, string>>({});
  const [validationApprovalSaving, setValidationApprovalSaving] = useState<Record<number, boolean>>({});
  const [notificationSummary, setNotificationSummary] = useState({ records: 0, recipientEmails: 0, sent: 0, failed: 0, skipped: 0 });
  const selectionBoxRef = useRef<any>(null);
  const selectionStartRef = useRef<any>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("share") ?? params.get("project");
    if (token) {
      setSharedToken(token);
      setAuthReady(true);
      setLoading(false);
      return;
    }
    fetch("/api/app?action=me")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()).user;
      })
      .then((current) => setUser(current))
      .finally(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (!sharedToken || sharedProject || shareRequiresCode) return;
    let cancelled = false;
    setShareChecking(true);
    setLoading(true);
    fetch(`/api/app?action=shared-project&token=${encodeURIComponent(sharedToken)}`)
      .then(async (response) => {
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          if (response.status === 401) {
            setShareRequiresCode(true);
            setShareError("");
          } else {
            setShareError(data.error ?? "Unable to open shared map");
          }
          setLoading(false);
          setShareChecking(false);
          return;
        }
        applySharedMapData(data);
        setShareChecking(false);
      })
      .catch(() => {
        if (cancelled) return;
        setShareError("Unable to open shared map");
        setLoading(false);
        setShareChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sharedToken, sharedProject, shareRequiresCode]);

  useEffect(() => {
    if (!user) return;
    fetch("/api/app?action=projects")
      .then((response) => response.ok ? response.json() : null)
      .then((projectData) => {
      if (projectData?.projects?.length) {
        setProjects(projectData.projects);
        setCurrentProjectId(projectData.projects[0].id);
      }
    });
  }, [user]);

  useEffect(() => {
    if (!user || currentProjectId === null || currentProjectId === undefined) return;
    let cancelled = false;
    setLoading(true);
    setBillboards([]);
    setSelected(null);
    setShortlist([]);
    setCosts({});
    setCurrentPlanId(null);
    setPlanName("Campaign Plan 1");
    setPlanNote("");
    if (user.role === "admin" && currentProjectId === 0) {
      fetch("/api/app?action=inventory&allProjects=1")
        .then((response) => response.ok ? response.json() : null)
        .then((inventoryData) => {
          if (cancelled) return;
          const inventory = inventoryData?.inventory ?? [];
          setBillboards(
            inventory.map((item: Billboard) => ({
              ...item,
              district: renameDistrict(item.district),
            })),
          );
          setPlans([]);
          setFlightSchedules([]);
          setProjectContacts([]);
          setValidationAssignments([]);
          setNotificationSummary({ records: 0, recipientEmails: 0, sent: 0, failed: 0, skipped: 0 });
          setLoading(false);
        });
      return () => { cancelled = true; };
    }
    Promise.all([
      fetch(`/api/app?action=inventory&projectId=${currentProjectId}`).then((response) => response.ok ? response.json() : null),
      fetch(`/api/app?action=plans&projectId=${currentProjectId}`).then((response) => response.ok ? response.json() : null),
      fetch(`/api/app?action=flight-schedules&projectId=${currentProjectId}`).then((response) => response.ok ? response.json() : null),
      fetch(`/api/app?action=project-contacts&projectId=${currentProjectId}`).then((response) => response.ok ? response.json() : null),
      fetch(`/api/app?action=validation-assignments&projectId=${currentProjectId}`).then((response) => response.ok ? response.json() : null),
      fetch(`/api/app?action=notification-audit&projectId=${currentProjectId}&from=0&to=${Date.now()}`).then((response) => response.ok ? response.json() : null),
    ]).then(async ([inventoryData, planData, flightData, contactData, validationData, notificationData]) => {
      if (cancelled) return;
      let inventory = inventoryData?.inventory ?? [];
      if (!inventory.length && currentProjectId === 1 && user.role !== "viewer") {
        const text = await fetch("/billboards.kml").then((response) => response.text());
        const parsed = parseCompleteInventory(text);
        await fetch("/api/app?action=inventory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: parsed, projectId: 1 }),
        });
        const seeded = await fetch("/api/app?action=inventory&projectId=1").then((response) => response.ok ? response.json() : null);
        inventory = seeded?.inventory ?? parsed;
      }
      if (cancelled) return;
      if (inventoryData) {
        setBillboards(
          inventory.map((item: Billboard) => ({
            ...item,
            district: renameDistrict(item.district),
          })),
        );
      }
      if (planData) setPlans(planData.plans ?? []);
      setFlightSchedules(flightData?.schedules ?? []);
      setProjectContacts(contactData?.contacts ?? []);
      setValidationAssignments(validationData?.assignments ?? []);
      setNotificationSummary(notificationData?.summary ?? { records: 0, recipientEmails: 0, sent: 0, failed: 0, skipped: 0 });
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [user, currentProjectId]);

  const districts = useMemo(
    () => Array.from(new Set(billboards.map((item) => item.district))).sort(),
    [billboards],
  );

  const allProjectNames = useMemo(
    () => Array.from(new Set(billboards.map((item) => item.projectName).filter(Boolean) as string[])).sort(),
    [billboards],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const allProjectsMode = user?.role === "admin" && currentProjectId === 0;
    return billboards.filter((item) => {
      const matchesSearch =
        !term ||
        [item.projectName, item.district, item.street, item.owner, item.advert]
          .join(" ")
          .toLowerCase()
          .includes(term);
      const matchesDistrict =
        district === "All areas" || item.district === district;
      const matchesProject =
        !allProjectsMode ||
        allProjectsProjectFilter === "All projects" ||
        item.projectName === allProjectsProjectFilter;
      const matchesAvailability =
        availability === "All status" ||
        (availability === "not-selected" ? (item.status ?? "not-selected") === "not-selected" : item.status === availability);
      const matchesBoardType =
        boardTypeFilter === "All types" ||
        item.mediaType === boardTypeFilter;
      const matchesFaces =
        facesFilter === "All faces" ||
        (facesFilter === "3+ faces"
          ? item.faces >= 3
          : item.faces === Number(facesFilter.split(" ")[0]));
      const expiry = Number(item.flightExpiry || 0);
      const storedFlightStatus = String(item.flightStatus || "unflighted");
      const matchesFlightStatus =
        mapFlightFilter === "All flight status" ||
        (mapFlightFilter === "expired"
          ? storedFlightStatus === "flighted" && Boolean(expiry && expiry <= Date.now())
          : mapFlightFilter === storedFlightStatus);
      return matchesSearch && matchesProject && matchesDistrict && matchesAvailability && matchesBoardType && matchesFaces && matchesFlightStatus;
    });
  }, [billboards, query, user?.role, currentProjectId, allProjectsProjectFilter, district, availability, boardTypeFilter, facesFilter, mapFlightFilter]);

  const visibleAssets = useMemo(
    () =>
      showSelectedOnly
        ? filtered.filter((item) => shortlist.includes(item.id))
        : filtered,
    [filtered, shortlist, showSelectedOnly],
  );

  function fitMapToBillboardExtent(assets = visibleAssets, force = false) {
    if (!mapRef.current || !mapReady || !assets.length) return;
    const validAssets = assets.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
    if (!validAssets.length) return;
    const signature = validAssets
      .map((item) => `${item.id}:${Number(item.lat).toFixed(6)},${Number(item.lng).toFixed(6)}`)
      .join("|");
    if (!force && signature === lastExtentFitRef.current) return;
    lastExtentFitRef.current = signature;
    const map = mapRef.current;
    window.setTimeout(() => {
      map.invalidateSize();
      if (validAssets.length === 1) {
        const onlyAsset = validAssets[0];
        if (onlyAsset) map.flyTo([onlyAsset.lat, onlyAsset.lng], 17, { duration: 0.9, easeLinearity: 0.2 });
        return;
      }
      const L = leafletRef.current;
      if (!L) return;
      const bounds = L.latLngBounds(validAssets.map((item) => [item.lat, item.lng]));
      if (bounds.isValid()) {
        const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
        map.flyToBounds(bounds, {
          paddingTopLeft: isMobile ? [28, 110] : [sidebarOpen ? 420 : 70, 80],
          paddingBottomRight: isMobile ? [28, 92] : [80, 80],
          maxZoom: 16,
          duration: force ? 0.9 : 0.75,
        });
      }
    }, 120);
  }

  useEffect(() => {
    setPhotoLinkDraft(selected ? billboardOriginalImageUrl(selected) : "");
  }, [selected?.id, selected?.photoUrl, selected?.photoOriginalUrl]);

  useEffect(() => {
    setSourceAttrDraft(selected?.sourceAttributes ?? {});
  }, [selected?.id, selected?.sourceAttributes]);

  const flightByAssetId = useMemo(
    () => new Map(flightSchedules.map((item) => [item.asset_id, item])),
    [flightSchedules],
  );

  useEffect(() => {
    const schedule = selected ? flightByAssetId.get(selected.id) : null;
    setFlightDraft({
      stage: schedule?.stage ?? "design",
      flightStatus: schedule?.flight_status ?? "unflighted",
      durationDays: String(schedule?.duration_days || 30),
      reminderDays: String(schedule?.reminder_days || 3),
      note: schedule?.note ?? "",
    });
  }, [selected?.id, flightByAssetId]);

  const imageLibraryItems = useMemo(() => {
    const fromInventory = billboards
      .map((item) => {
        const image = billboardImageUrl(item);
        if (!image) return null;
        return {
          id: `billboard-${item.id}`,
          title: item.street,
          subtitle: `${mediaTypeLabel(item.mediaType)} · ${item.district}`,
          image,
          originalImage: billboardOriginalImageUrl(item),
          lat: item.lat,
          lng: item.lng,
          assetId: item.id,
          area: item.district || "Unassigned area",
          source: "Inventory",
        };
      })
      .filter(Boolean) as Array<{ id: string; title: string; subtitle: string; image: string; originalImage: string; lat: number; lng: number; assetId: number | null; area: string; source: string }>;
    const fromCollections = fieldCollections
      .map((collection) => {
        const data = collection.data ?? {};
        const rawImage = String(data.photo_url || data.photoUrl || data.image_url || data.imageUrl || data.photo || data.image || "");
        const image = normalizeImageUrl(rawImage);
        if (!image) return null;
        return {
          id: `collection-${collection.id}`,
          title: data.street || data.district || `Collection #${collection.id}`,
          subtitle: `${collection.collector ?? "Field user"} · ${collection.status}`,
          image,
          originalImage: originalImageUrl(rawImage),
          lat: collection.latitude,
          lng: collection.longitude,
          assetId: null as number | null,
          area: String(data.district || data.area || data.region || collection.mission_name || "Unassigned area"),
          source: "Field collection",
        };
      })
      .filter(Boolean) as Array<{ id: string; title: string; subtitle: string; image: string; originalImage: string; lat: number; lng: number; assetId: number | null; area: string; source: string }>;
    return [...fromInventory, ...fromCollections];
  }, [billboards, fieldCollections]);

  const imageLibraryGroups = useMemo(() => {
    const grouped = new Map<string, typeof imageLibraryItems>();
    imageLibraryItems.forEach((item) => {
      const area = item.area?.trim() || "Unassigned area";
      const items = grouped.get(area) ?? [];
      items.push(item);
      grouped.set(area, items);
    });
    return Array.from(grouped.entries())
      .map(([area, items]) => ({ area, items }))
      .sort((a, b) => a.area.localeCompare(b.area));
  }, [imageLibraryItems]);

  const plannedAssets = useMemo(
    () =>
      shortlist
        .map((id) => billboards.find((item) => item.id === id))
        .filter(Boolean) as Billboard[],
    [billboards, shortlist],
  );

  const itemTotal = (id: number) => {
    const item = costs[id];
    if (!item) return 0;
    return Number(item.rental || 0) + Number(item.printing || 0) +
      Number(item.transport || 0) + Number(item.flighting || 0);
  };
  const totalCost = plannedAssets.reduce((sum, item) => sum + itemTotal(item.id), 0);

  useEffect(() => {
    if ((!user && !sharedProject) || !mapNode.current || mapRef.current) return;
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !mapNode.current || mapRef.current) return;
      leafletRef.current = L;
      const map = L.map(mapNode.current, {
        zoomControl: false,
        attributionControl: false,
        zoomAnimation: true,
        fadeAnimation: true,
        markerZoomAnimation: true,
        zoomAnimationThreshold: 8,
      }).setView([-6.1455, 39.2269], 14);
      tileRef.current = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(map);
      labelsRef.current = L.tileLayer(
        "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, opacity: 0 },
      ).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      mapRef.current = map;
      setMapReady(true);
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [user, sharedProject]);

  useEffect(() => {
    const urls: Record<string, string> = {
      street: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    };
    tileRef.current?.setUrl(urls[baseMap]);
    labelsRef.current?.setOpacity(baseMap === "satellite" ? 1 : 0);
  }, [baseMap]);

  function focusItem(item: Billboard) {
    setSelected(item);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches) {
      setSidebarOpen(false);
    }
    mapRef.current?.flyTo([item.lat, item.lng], 17, {
      duration: 1.35,
      easeLinearity: 0.18,
    });
  }

  function generateAssetId() {
    return Date.now() + Math.floor(Math.random() * 1000);
  }

  async function persistAsset(item: Billboard) {
    const response = await fetch("/api/app?action=inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [item], projectId: currentProjectId }),
    });
    if (!response.ok) {
      console.error("Failed to save asset", await response.text());
      setImportMessage("Could not save asset to server");
    }
  }

  async function saveSelectedPhoto(nextPhotoUrl: string) {
    if (!selected || !canManage) return;
    const rawPhotoUrl = nextPhotoUrl.trim();
    const normalizedPhotoUrl = normalizeImageUrl(rawPhotoUrl);
    const updated = {
      ...selected,
      photoUrl: normalizedPhotoUrl,
      photoOriginalUrl: rawPhotoUrl && normalizedPhotoUrl !== rawPhotoUrl ? originalImageUrl(rawPhotoUrl) : undefined,
    };
    setPhotoSaving(true);
    setBillboards((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setSelected(updated);
    setPhotoLinkDraft(updated.photoOriginalUrl || updated.photoUrl || "");
    await persistAsset(updated);
    setPhotoSaving(false);
    setImportMessage(updated.photoUrl ? "Billboard image saved" : "Billboard image removed");
    window.setTimeout(() => setImportMessage(""), 2500);
  }

  async function uploadSelectedPhoto(file: File | undefined) {
    if (!file) return;
    try {
      setPhotoSaving(true);
      const photoUrl = await imageFileToDataUrl(file);
      await saveSelectedPhoto(photoUrl);
    } catch (error) {
      console.error(error);
      setPhotoSaving(false);
      setImportMessage("Could not upload image");
      window.setTimeout(() => setImportMessage(""), 2500);
    }
  }

  async function attachSelectedPhotoLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveSelectedPhoto(photoLinkDraft);
  }

  async function saveSelectedSourceAttributes() {
    if (!selected || !canManage) return;
    const cleaned = Object.fromEntries(
      Object.entries(sourceAttrDraft).map(([key, value]) => [key, String(value ?? "")]),
    );
    const updated = applySourceAttributesToBillboard(selected, cleaned);
    setSourceAttrSaving(true);
    setBillboards((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setSelected(updated);
    await persistAsset(updated);
    setSourceAttrSaving(false);
    setImportMessage("Uploaded attributes saved");
    window.setTimeout(() => setImportMessage(""), 2500);
  }

  async function refreshFlighting() {
    if (!currentProjectId) return;
    const [scheduleData, contactData] = await Promise.all([
      fetch(`/api/app?action=flight-schedules&projectId=${currentProjectId}`).then((response) => response.ok ? response.json() : null),
      fetch(`/api/app?action=project-contacts&projectId=${currentProjectId}`).then((response) => response.ok ? response.json() : null),
    ]);
    setFlightSchedules(scheduleData?.schedules ?? []);
    setProjectContacts(contactData?.contacts ?? []);
  }

  async function saveFlightSchedule(assetIds: number[]) {
    if (!assetIds.length) return;
    setFlightSaving(true);
    const now = Date.now();
    const effectiveFlightStatus = flightDraft.stage === "flighted"
      ? "flighted"
      : flightDraft.stage === "removed"
        ? "deflighted"
        : flightDraft.flightStatus;
    const response = await fetch("/api/app?action=flight-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: currentProjectId,
        assetIds,
        stage: flightDraft.stage,
        flightStatus: effectiveFlightStatus,
        startAt: effectiveFlightStatus === "flighted" ? now : null,
        durationDays: Number(flightDraft.durationDays) || 0,
        reminderDays: Number(flightDraft.reminderDays) || 0,
        note: flightDraft.note,
      }),
    });
    const data = await response.json();
    setFlightSaving(false);
    if (!response.ok) {
      setImportMessage(data.error ?? "Could not save flight schedule");
      window.setTimeout(() => setImportMessage(""), 2500);
      return;
    }
    await refreshFlighting();
    const endAt = effectiveFlightStatus === "flighted" && Number(flightDraft.durationDays)
      ? now + Number(flightDraft.durationDays) * 86400000
      : "";
    setBillboards((current) => current.map((asset) => assetIds.includes(asset.id)
      ? { ...asset, flightStatus: effectiveFlightStatus, flightStage: flightDraft.stage, flightExpiry: endAt }
      : asset));
    if (selected && assetIds.includes(selected.id)) {
      setSelected({ ...selected, flightStatus: effectiveFlightStatus, flightStage: flightDraft.stage, flightExpiry: endAt });
    }
    if (data.whatsapp?.length) {
      window.open(data.whatsapp[0].link, "_blank", "noopener,noreferrer");
    }
    setImportMessage(`${assetIds.length} billboard(s) flight schedule updated`);
    window.setTimeout(() => setImportMessage(""), 3000);
  }

  function openFlightAsset(asset: Billboard) {
    const schedule = flightByAssetId.get(asset.id);
    setSelected(asset);
    setFlightDraft({
      stage: schedule?.stage ?? "design",
      flightStatus: schedule?.flight_status ?? "unflighted",
      durationDays: String(schedule?.duration_days || 30),
      reminderDays: String(schedule?.reminder_days || 3),
      note: schedule?.note ?? "",
    });
    setFlightAssetPopup(asset);
  }

  function showFlightAssetOnMap(asset: Billboard) {
    setFlightAssetPopup(null);
    setActiveTab("planner");
    window.setTimeout(() => focusItem(asset), 100);
  }

  async function saveTrackerField(asset: Billboard, field: string, value: string) {
    if (!canPlan) return;
    const key = TRACKER_ATTR_KEYS[field]?.[1] ?? field;
    const updated = {
      ...asset,
      sourceAttributes: {
        ...(asset.sourceAttributes ?? {}),
        [key]: value,
      },
    };
    setTrackerSavingId(asset.id);
    setBillboards((current) => current.map((item) => (item.id === asset.id ? updated : item)));
    if (selected?.id === asset.id) setSelected(updated);
    await persistAsset(updated);
    setTrackerSavingId(null);
  }

  function exportTracker(type: "design" | "cost" | "comprehensive") {
    window.open(`/api/app?action=export-tracker&projectId=${currentProjectId}&type=${type}`, "_blank", "noopener,noreferrer");
  }

  async function saveProjectContact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/app?action=project-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: contactDraft.id,
        projectId: contactDraft.projectId === "global" ? 0 : currentProjectId,
        name: contactDraft.name,
        emails: contactDraft.emails,
        phones: contactDraft.phones,
        isDefault: true,
      }),
    });
    const data = await response.json();
    if (response.ok) {
      setProjectContacts(data.contacts ?? []);
      setContactDraft({ name: "", emails: "", phones: "", projectId: "project" });
      setImportMessage("Contact saved");
    } else {
      setImportMessage(data.error ?? "Could not save contact");
    }
    window.setTimeout(() => setImportMessage(""), 2500);
  }

  function editProjectContact(contact: ProjectContact) {
    setContactDraft({
      id: contact.id,
      name: contact.name,
      emails: contact.emails,
      phones: contact.phones,
      projectId: contact.project_id === 0 ? "global" : "project",
    });
  }

  async function sendDueFlightReminders() {
    const response = await fetch("/api/app?action=send-flight-reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: currentProjectId }),
    });
    const data = await response.json();
    if (data.whatsapp?.length) window.open(data.whatsapp[0].link, "_blank", "noopener,noreferrer");
    const smsRecipients = Array.isArray(data.sms) ? data.sms.length : 0;
    setImportMessage(`${data.sent ?? 0} billboard(s) included in expiry reminders · SMS recipients: ${smsRecipients}`);
    window.setTimeout(() => setImportMessage(""), 3000);
    await refreshFlighting();
  }

  function updateAssetPosition(item: Billboard, lat: number, lng: number) {
    const roundedLat = Math.round(lat * 1_000_000) / 1_000_000;
    const roundedLng = Math.round(lng * 1_000_000) / 1_000_000;
    const updated = { ...item, lat: roundedLat, lng: roundedLng };
    setBillboards((current) =>
      current.map((asset) => (asset.id === item.id ? updated : asset)),
    );
    if (selected?.id === item.id) setSelected(updated);
    setPositionHint(`Updated ${updated.street} position`);
    window.setTimeout(() => setPositionHint(null), 2500);
    persistAsset(updated);
  }

  function resetAssetDraft() {
    const center = mapRef.current?.getCenter();
    setAssetDraft({
      street: "",
      district: "",
      owner: "",
      from: "",
      to: "",
      height: 0,
      width: 0,
      faces: 1,
      mediaType: "lamp-post",
      status: "not-selected",
      occupied: false,
      advert: "",
      lampPosts: 1,
      photoUrl: "",
      lat: center?.lat ?? -6.1455,
      lng: center?.lng ?? 39.2269,
      rentalPrice: 0,
      printingPrice: 0,
      transportPrice: 0,
      flightingPrice: 0,
    });
  }

  async function saveNewAsset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft = assetDraft;
    const newAsset: Billboard = {
      id: generateAssetId(),
      street: draft.street?.trim() || "Unnamed billboard",
      district: draft.district?.trim() || "Unspecified area",
      owner: draft.owner?.trim() || "Unknown",
      from: draft.from?.trim() || "—",
      to: draft.to?.trim() || "—",
      brackets: "—",
      height: Number(draft.height) || 0,
      width: Number(draft.width) || 0,
      faces: Number(draft.faces) || 1,
      occupied: Boolean(draft.occupied),
      advert: draft.advert?.trim() || "No advert recorded",
      lampPosts:
        draft.mediaType === "lamp-post"
          ? Number(draft.lampPosts) || 1
          : 0,
      arrangement: "Not recorded",
      lat: Number(draft.lat),
      lng: Number(draft.lng),
      mediaType: draft.mediaType || "lamp-post",
      status: normalizeUploadStatus(String(draft.status ?? "not-selected")),
      photoUrl: normalizeImageUrl(String(draft.photoUrl ?? "")),
      photoOriginalUrl: normalizeImageUrl(String(draft.photoUrl ?? "")) !== String(draft.photoUrl ?? "").trim()
        ? originalImageUrl(String(draft.photoUrl ?? ""))
        : undefined,
      projectId: currentProjectId,
      rentalPrice: Number(draft.rentalPrice) || 0,
      printingPrice: Number(draft.printingPrice) || 0,
      transportPrice: Number(draft.transportPrice) || 0,
      flightingPrice: Number(draft.flightingPrice) || 0,
    };
    if (
      !Number.isFinite(newAsset.lat) ||
      !Number.isFinite(newAsset.lng) ||
      newAsset.lat === 0 ||
      newAsset.lng === 0
    ) {
      setImportMessage("Please provide valid latitude and longitude");
      return;
    }
    await persistAsset(newAsset);
    setBillboards((current) => [...current, newAsset]);
    setSelected(newAsset);
    setAddOpen(false);
    focusItem(newAsset);
  }

  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    const L = leafletRef.current;
    if (!L) return;
    if (!billboards.length) {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current.clear();
      return;
    }
    const assetsById = new Map(visibleAssets.map((item) => [item.id, item]));
    markersRef.current.forEach((marker, id) => {
      if (!assetsById.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });
    visibleAssets.forEach((item) => {
      let marker = markersRef.current.get(item.id);
      if (!marker) {
        const { markerWidth, markerHeight } = markerSize(item);
        marker = L.marker([item.lat, item.lng], {
          icon: L.divIcon({
            className: "asset-marker-wrap",
            html: markerHtml(item, selected?.id === item.id),
            iconSize: [markerWidth + 18, markerHeight + 20],
            iconAnchor: [(markerWidth + 18) / 2, (markerHeight + 20) / 2],
          }),
        });
        marker.on("click", (event: any) => {
          if ((event.originalEvent as MouseEvent)?.shiftKey) {
            toggleShortlist(item.id);
            setImportMessage(`${item.street} added to plan`);
            window.setTimeout(() => setImportMessage(""), 1600);
            return;
          }
          setSelected(item);
        });
        marker.on("popupopen", () => {
          const element = marker?.getPopup()?.getElement();
          element?.querySelector<HTMLButtonElement>("[data-image-url]")?.addEventListener("click", (event) => {
            const imageUrl = (event.currentTarget as HTMLButtonElement).dataset.imageUrl;
            if (imageUrl) {
              setViewingPhoto(imageUrl);
              setPhotoViewerOpen(true);
            }
          }, { once: true });
        });
        markersRef.current.set(item.id, marker);
      }
      const active = selected?.id === item.id;
      const { markerWidth, markerHeight } = markerSize(item);
      marker.setLatLng([item.lat, item.lng]);
      marker.setIcon(
        L.divIcon({
          className: "asset-marker-wrap",
          html: markerHtml(item, active),
          iconSize: [markerWidth + 18, markerHeight + 20],
          iconAnchor: [(markerWidth + 18) / 2, (markerHeight + 20) / 2],
        }),
      );
      marker.off("click");
      marker.on("click", (event: any) => {
        if ((event.originalEvent as MouseEvent)?.shiftKey) {
          toggleShortlist(item.id);
          setImportMessage(`${item.street} ${shortlist.includes(item.id) ? "removed from" : "added to"} plan`);
          window.setTimeout(() => setImportMessage(""), 1600);
          return;
        }
        setSelected(item);
      });
      marker.unbindPopup();
      marker.bindPopup(popupHtml(item), { closeButton: false, minWidth: 210, maxWidth: 250 });
      const draggable = editingPosition && active;
      const markerAny = marker as any;
      if (markerAny.dragging) {
        if (draggable) markerAny.dragging.enable();
        else markerAny.dragging.disable();
      }
      marker.off("dragend");
      if (draggable) {
        marker.on("dragend", (event) => {
          const { lat, lng } = (event.target as LeafletMarker).getLatLng();
          updateAssetPosition(item, lat, lng);
        });
      }
      if (!mapRef.current!.hasLayer(marker)) marker.addTo(mapRef.current!);
    });
  }, [visibleAssets, selected?.id, mapReady, editingPosition, shortlist]);

  useEffect(() => {
    if (!boxSelectMode || !mapRef.current || !mapReady) return;
    const map = mapRef.current;
    let cancelled = false;
    let onDownHandler: ((event: any) => void) | null = null;
    let onMoveHandler: ((event: any) => void) | null = null;
    let onUpHandler: ((event: any) => void) | null = null;
    setImportMessage("Drag a box around billboards to add them to the current plan");
    map.dragging.disable();
    import("leaflet").then((L) => {
      if (cancelled) return;
      const clearBox = () => {
        selectionBoxRef.current?.remove();
        selectionBoxRef.current = null;
      };
      const onDown = (event: any) => {
        if (event.originalEvent?.button !== 0) return;
        selectionStartRef.current = event.latlng;
        clearBox();
        map.on("mousemove", onMove);
        map.on("mouseup", onUp);
      };
      const onMove = (event: any) => {
        if (!selectionStartRef.current) return;
        const bounds = L.latLngBounds(selectionStartRef.current, event.latlng);
        if (!selectionBoxRef.current) {
          selectionBoxRef.current = L.rectangle(bounds, {
            color: "#0d9668",
            weight: 2,
            fillColor: "#0d9668",
            fillOpacity: 0.08,
            dashArray: "6 5",
          }).addTo(map);
        } else {
          selectionBoxRef.current.setBounds(bounds);
        }
      };
      const onUp = (event: any) => {
        if (!selectionStartRef.current) return;
        const bounds = L.latLngBounds(selectionStartRef.current, event.latlng);
        const selectedAssets = visibleAssets.filter((asset) => bounds.contains([asset.lat, asset.lng]));
        addAssetsToPlan(selectedAssets);
        setImportMessage(`${selectedAssets.length} billboard${selectedAssets.length === 1 ? "" : "s"} added to plan`);
        window.setTimeout(() => setImportMessage(""), 1800);
        selectionStartRef.current = null;
        clearBox();
        map.off("mousemove", onMove);
        map.off("mouseup", onUp);
        setBoxSelectMode(false);
      };
      onDownHandler = onDown;
      onMoveHandler = onMove;
      onUpHandler = onUp;
      map.on("mousedown", onDown);
    });
    return () => {
      cancelled = true;
      if (onDownHandler) map.off("mousedown", onDownHandler);
      if (onMoveHandler) map.off("mousemove", onMoveHandler);
      if (onUpHandler) map.off("mouseup", onUpHandler);
      selectionStartRef.current = null;
      selectionBoxRef.current?.remove();
      selectionBoxRef.current = null;
      map.dragging.enable();
      setImportMessage("");
    };
  }, [boxSelectMode, mapReady, visibleAssets]);

  useEffect(() => {
    if (!placingAsset || !mapRef.current) return;
    const map = mapRef.current;
    const handler = (event: { latlng: { lat: number; lng: number } }) => {
      const { lat, lng } = event.latlng;
      setAssetDraft((current) => ({ ...current, lat, lng }));
      setPlacingAsset(false);
      setAddOpen(true);
    };
    map.on("click", handler);
    return () => { map.off("click", handler); };
  }, [placingAsset]);

  useEffect(() => {
    if (activeTab !== "planner" || !mapReady || !visibleAssets.length) return;
    fitMapToBillboardExtent(visibleAssets, true);
  }, [activeTab, mapReady, visibleAssets, sidebarOpen]);

  useEffect(() => {
    setTimeout(() => mapRef.current?.invalidateSize(), 260);
  }, [sidebarOpen]);

  useEffect(() => {
    if (activeTab !== "planner") return;
    const timers = [80, 260, 650].map((delay) =>
      window.setTimeout(() => mapRef.current?.invalidateSize(), delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [activeTab, currentProjectId, sharedProject, billboards.length]);

  useEffect(() => {
    if (!user || (activeTab !== "dashboard" && activeTab !== "library")) return;
    setFieldCollections([]);
    setSelectedCollection(null);
    setCollectionPhotos([]);
    fetch(`/api/app?action=field-collections&projectId=${currentProjectId}`).then((r) => r.ok ? r.json() : null).then((d) => {
      if (d?.collections) setFieldCollections(d.collections);
    });
  }, [user, activeTab, currentProjectId]);

  useEffect(() => {
    if (!user || activeTab !== "field") return;
    if (user.role !== "admin" && user.role !== "creator") return;
    Promise.all([
      fetch(`/api/app?action=missions&projectId=${currentProjectId}`).then((r) => r.ok ? r.json() : null),
      fetch("/api/app?action=user-groups").then((r) => r.ok ? r.json() : null),
      fetch("/api/app?action=boundaries").then((r) => r.ok ? r.json() : null),
      fetch("/api/app?action=users").then((r) => r.ok ? r.json() : null),
    ]).then(([mData, gData, bData, uData]) => {
      if (mData?.missions) setMissions(mData.missions);
      if (gData?.groups) setUserGroups(gData.groups);
      if (bData?.boundaries) setBoundaries(bData.boundaries);
      if (uData?.users) setUsers(uData.users);
    });
  }, [user, activeTab, currentProjectId]);

  async function loadPhoto(photoId: number) {
    const r = await fetch(`/api/app?action=photo&id=${photoId}`);
    const d = await r.json();
    setViewingPhoto(d.photo ?? null);
    setPhotoViewerOpen(true);
  }

  async function validateCollection(id: number, status: "validated" | "rejected") {
    await fetch("/api/app?action=validate-collection", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    setFieldCollections((prev) => prev.map((c) => c.id === id ? { ...c, status } : c));
    setSelectedCollection((prev: any) => prev?.id === id ? { ...prev, status } : prev);
  }

  async function saveMission(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const assignedUsers = form.getAll("assignedUsers").map(Number).filter(Boolean);
    const assignedGroups = form.getAll("assignedGroups").map(Number).filter(Boolean);
    const config = {
      requiredFields: String(form.get("requiredFields") || "district,street").split(",").map((s) => s.trim()),
      photoRequired: form.get("photoRequired") === "on",
      minPhotos: Number(form.get("minPhotos")) || 1,
      lamppostCapture: form.get("lamppostCapture") === "on",
    };
    await fetch("/api/app?action=missions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editingMission?.id, projectId: currentProjectId, name: form.get("name"), description: form.get("description"), status: form.get("status") || "active", assignedUsers, assignedGroups, config, boundaryId: Number(form.get("boundaryId")) || null }),
    });
    setMissionFormOpen(false);
    setEditingMission(null);
    const r = await fetch(`/api/app?action=missions&projectId=${currentProjectId}`);
    const d = await r.json();
    setMissions(d.missions ?? []);
  }

  async function deleteMission(mission: any) {
    const name = mission?.name ?? "this mission";
    if (!window.confirm(`Delete mission "${name}"?\n\nSubmitted field reports will be kept, but this mission will no longer appear for field users.`)) return;
    const response = await fetch("/api/app?action=delete-mission", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: mission.id, projectId: currentProjectId }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setImportMessage(data.error || "Unable to delete mission");
      window.setTimeout(() => setImportMessage(""), 2500);
      return;
    }
    setMissions((current) => current.filter((item) => item.id !== mission.id));
    setImportMessage("Mission deleted");
    window.setTimeout(() => setImportMessage(""), 2500);
  }

  async function saveGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/app?action=user-groups", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editingGroup?.id, name: form.get("name"), description: form.get("description") }),
    });
    const result = await response.json();
    const groupId = editingGroup?.id ?? result.id;
    if (groupId) {
      await fetch("/api/app?action=group-members", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, userIds: form.getAll("memberIds").map(Number).filter(Boolean) }),
      });
    }
    setGroupFormOpen(false);
    setEditingGroup(null);
    const r = await fetch("/api/app?action=user-groups");
    const d = await r.json();
    setUserGroups(d.groups ?? []);
  }

  async function deleteGroup(id: number) {
    if (!window.confirm("Delete this group? Field users will remain available.")) return;
    await fetch(`/api/app?action=group&id=${id}`, { method: "DELETE" });
    const response = await fetch("/api/app?action=user-groups");
    const data = await response.json();
    setUserGroups(data.groups ?? []);
  }

  async function uploadBoundary(file: File) {
    const text = await file.text();
    const name = file.name.replace(/\.geojson$/i, "");
    const isZanzibar = text.includes("Shehia");
    await fetch("/api/app?action=boundaries", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, geojson: text, boundaryType: isZanzibar ? "zanzibar" : "mainland" }),
    });
    const r = await fetch("/api/app?action=boundaries");
    const d = await r.json();
    setBoundaries(d.boundaries ?? []);
  }

  function applySharedMapData(data: any) {
    setSharedProject(data.project);
    setCurrentProjectId(data.project.id);
    setProjects([data.project]);
    setBillboards(
      (data.inventory ?? []).map((item: Billboard) => ({
        ...item,
        district: renameDistrict(item.district),
      })),
    );
    setActiveTab("planner");
    setShareRequiresCode(false);
    setLoading(false);
  }

  async function openSharedMap(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sharedToken) return;
    setShareError("");
    setLoading(true);
    const response = await fetch(`/api/app?action=shared-project&token=${encodeURIComponent(sharedToken)}&code=${encodeURIComponent(shareCodeInput)}`);
    const data = await response.json();
    if (!response.ok) {
      setShareError(data.error ?? "Unable to open shared map");
      setLoading(false);
      return;
    }
    applySharedMapData(data);
  }

  async function copyProjectShare(protectedMode: boolean) {
    const project = projects.find((item) => item.id === currentProjectId);
    if (!project) return;
    setImportMessage("");
    const response = await fetch("/api/app?action=share-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: currentProjectId, protected: protectedMode }),
    });
    const data = await response.json();
    if (!response.ok) {
      setImportMessage(data.error ?? "Unable to generate share link");
      window.setTimeout(() => setImportMessage(""), 2500);
      return;
    }
    const updatedProject = data.project as Project;
    setProjects((current) => current.map((item) => item.id === updatedProject.id ? { ...item, ...updatedProject } : item));
    const link = `${location.origin}/?share=${updatedProject.share_token}`;
    const shareText = protectedMode
      ? `Project map: ${link}\nSecret code: ${updatedProject.share_code ?? ""}`
      : `Project map: ${link}`;
    await navigator.clipboard.writeText(shareText);
    setSharePanelOpen(false);
    setImportMessage(protectedMode ? "Protected share link and secret code copied" : "Unprotected share link copied");
    window.setTimeout(() => setImportMessage(""), 2500);
  }

  const isSharedView = Boolean(sharedProject && !user);
  const isAllProjectsMap = Boolean(user?.role === "admin" && currentProjectId === 0);
  const canManage = !isAllProjectsMap && (user?.role === "admin" || user?.role === "creator");
  const canPlan = Boolean(user && user.role !== "viewer" && !isAllProjectsMap);
  const currentProject = projects.find((item) => item.id === currentProjectId);
  const canDeleteCurrentProject = Boolean(
    currentProject && (user?.role === "admin" || (user?.role === "creator" && Number(currentProject.created_by) === user.id)),
  );
  const fieldUsers = users.filter((account) => account.role === "field_user");
  const activeMissions = missions.filter((mission) => mission.status === "active");
  const inactiveMissions = missions.filter((mission) => mission.status !== "active");
  const missionAssignedUserCount = missions.reduce((sum, mission) => sum + parseJsonArray(mission.assigned_users).length, 0);
  const missionAssignedGroupCount = missions.reduce((sum, mission) => sum + parseJsonArray(mission.assigned_groups).length, 0);
  const selectedValidationAssignments = selected
    ? validationAssignments.filter((assignment) => Number(assignment.asset_id) === selected.id)
    : [];

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 760px)");
    const applyMobileMapLayout = () => {
      if (media.matches) {
        setSidebarOpen(false);
      }
      window.setTimeout(() => mapRef.current?.invalidateSize(), 180);
    };
    applyMobileMapLayout();
    media.addEventListener("change", applyMobileMapLayout);
    return () => media.removeEventListener("change", applyMobileMapLayout);
  }, [isSharedView]);

  const largeFormatFaces = filtered
    .filter((item) => item.mediaType === "large-format")
    .reduce((sum, item) => sum + item.faces, 0);
  const digitalScreenFaces = filtered
    .filter((item) => item.mediaType === "digital-screen")
    .reduce((sum, item) => sum + item.faces, 0);
  const fabricatedBannerFaces = filtered
    .filter((item) => item.mediaType === "fabricated-banner")
    .reduce((sum, item) => sum + item.faces, 0);
  const filteredLampPosts = filtered
    .filter((item) => item.mediaType === "lamp-post")
    .reduce((sum, item) => sum + (Number(item.lampPosts) || Number(item.faces) || 1), 0);
  const filteredTotalFaces = filtered.reduce((sum, item) => sum + item.faces, 0);
  const totalFaces = billboards.reduce((sum, item) => sum + item.faces, 0);
  const flightedSchedules = flightSchedules.filter((item) => item.flight_status === "flighted");
  const deflightedSchedules = flightSchedules.filter((item) => item.flight_status === "deflighted");
  const dueFlightSchedules = flightedSchedules.filter((item) => item.end_at && item.end_at <= Date.now());
  const stagedSchedules = flightSchedules.filter((item) => item.stage && item.stage !== "flighted" && item.stage !== "removed");
  const flightScheduleStats = {
    flighted: flightedSchedules.length,
    expired: dueFlightSchedules.length,
    expiringSoon: flightedSchedules.filter((item) => item.end_at && item.end_at > Date.now() && item.end_at <= Date.now() + 7 * 86400000).length,
    deflighted: deflightedSchedules.length,
    unflighted: Math.max(0, billboards.length - flightedSchedules.length - deflightedSchedules.length),
  };
  const validationIssues = validationAssignments.filter((assignment) => assignment.status === "issue");
  const validationOk = validationAssignments.filter((assignment) => assignment.status === "ok");
  const validationPending = validationAssignments.filter((assignment) => ["assigned", "in_progress"].includes(assignment.status));
  const rejectedCollections = fieldCollections.filter((collection) => collection.status === "rejected");
  const dashboardIssueCount = validationIssues.length + rejectedCollections.length;
  const issueTypeCounts = validationIssues.reduce<Record<string, number>>((acc, assignment) => {
    const issueType = String(assignment.report?.issueType || "Unspecified issue");
    acc[issueType] = (acc[issueType] || 0) + 1;
    return acc;
  }, {});
  const mediaBreakdown = [
    { label: "Large format", value: billboards.filter((item) => item.mediaType === "large-format").reduce((sum, item) => sum + item.faces, 0) },
    { label: "Digital screens", value: billboards.filter((item) => item.mediaType === "digital-screen").reduce((sum, item) => sum + item.faces, 0) },
    { label: "Fabricated banner", value: billboards.filter((item) => item.mediaType === "fabricated-banner").reduce((sum, item) => sum + item.faces, 0) },
    { label: "Lamp posts", value: billboards.filter((item) => item.mediaType === "lamp-post").reduce((sum, item) => sum + (Number(item.lampPosts) || Number(item.faces) || 1), 0) },
  ];
  const recentFieldReports = [...fieldCollections]
    .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0))
    .slice(0, 8);
  const recentValidationIssues = validationIssues.slice(0, 8);
  const filteredFlightAssets = useMemo(() => {
    const term = flightSearch.trim().toLowerCase();
    return billboards.filter((asset) => {
      const deliveredStatus = trackerValue(asset, "deliveredToDestination", "PENDING").trim().toUpperCase();
      if (deliveredStatus !== "RECEIVED") return false;
      const schedule = flightByAssetId.get(asset.id);
      const status = schedule?.flight_status ?? "unflighted";
      const stage = schedule?.stage ?? "not-started";
      const isDue = status === "flighted" && Boolean(schedule?.end_at && schedule.end_at <= Date.now());
      const matchesStatus =
        flightStatusFilter === "all" ||
        flightStatusFilter === status ||
        flightStatusFilter === stage ||
        (flightStatusFilter === "due" && isDue);
      const matchesSearch =
        !term ||
        [
          asset.street,
          asset.district,
          asset.from,
          asset.to,
          asset.vendor,
          mediaTypeLabel(asset.mediaType),
          stage,
          status,
        ]
          .join(" ")
          .toLowerCase()
          .includes(term);
      const endDate = shortDate(schedule?.end_at).toLowerCase();
      const matchesColumnFilters =
        (!flightColumnFilters.billboard || [asset.street, asset.district, asset.vendor, asset.owner].join(" ").toLowerCase().includes(flightColumnFilters.billboard.toLowerCase())) &&
        (!flightColumnFilters.type || mediaTypeLabel(asset.mediaType).toLowerCase().includes(flightColumnFilters.type.toLowerCase())) &&
        (!flightColumnFilters.location || [asset.from, asset.to, asset.lat, asset.lng].join(" ").toLowerCase().includes(flightColumnFilters.location.toLowerCase())) &&
        (!flightColumnFilters.stage || stage.toLowerCase().includes(flightColumnFilters.stage.toLowerCase())) &&
        (!flightColumnFilters.status || status.toLowerCase().includes(flightColumnFilters.status.toLowerCase())) &&
        (!flightColumnFilters.endDate || endDate.includes(flightColumnFilters.endDate.toLowerCase()));
      return matchesStatus && matchesSearch && matchesColumnFilters;
    });
  }, [billboards, flightByAssetId, flightSearch, flightStatusFilter, flightColumnFilters]);
  const readyForFlightAssets = useMemo(
    () => visibleAssets.filter((asset) => trackerValue(asset, "deliveredToDestination", "PENDING").trim().toUpperCase() === "RECEIVED"),
    [visibleAssets],
  );
  const trackerRows = useMemo(() => {
    return billboards.map((asset) => {
      const schedule = flightByAssetId.get(asset.id);
      const total =
        Number(asset.rentalPrice || 0) +
        Number(asset.printingPrice || 0) +
        Number(asset.flightingPrice || 0) +
        Number(asset.transportPrice || 0);
      return {
        asset,
        schedule,
        total,
        vendor: asset.vendor || asset.owner || "UNKNOWN",
        flightStatus: schedule?.flight_status ?? "unflighted",
        expiryDate: schedule?.end_at,
        remaining: remainingDaysNumber(schedule?.end_at),
      };
    });
  }, [billboards, flightByAssetId]);
  const trackerFilterOptions = useMemo(() => ({
    types: Array.from(new Set(trackerRows.map((row) => mediaTypeLabel(row.asset.mediaType)))).sort(),
    vendors: Array.from(new Set(trackerRows.map((row) => row.vendor))).sort(),
  }), [trackerRows]);
  const filteredTrackerRows = useMemo(() => {
    const term = trackerFilters.search.trim().toLowerCase();
    const withinRange = (value: number | null, min: string, max: string) => {
      if (value === null || Number.isNaN(value)) return !min && !max;
      const minNumber = min === "" ? null : Number(min);
      const maxNumber = max === "" ? null : Number(max);
      return (minNumber === null || value >= minNumber) && (maxNumber === null || value <= maxNumber);
    };
    return trackerRows.filter((row) => {
      const asset = row.asset;
      const matchesSearch =
        !term ||
        [asset.street, asset.district, asset.from, asset.to, row.vendor]
          .join(" ")
          .toLowerCase()
          .includes(term);
      return (
        matchesSearch &&
        (trackerFilters.type === "All" || mediaTypeLabel(asset.mediaType) === trackerFilters.type) &&
        (trackerFilters.vendor === "All" || row.vendor === trackerFilters.vendor) &&
        (trackerFilters.artworkDelivery === "All" || trackerValue(asset, "artworkDelivery", "PENDING") === trackerFilters.artworkDelivery) &&
        (trackerFilters.artworkApproval === "All" || trackerValue(asset, "artworkApproval", "PENDING") === trackerFilters.artworkApproval) &&
        (trackerFilters.artworkToVendor === "All" || trackerValue(asset, "artworkToVendor", "PENDING") === trackerFilters.artworkToVendor) &&
        (trackerFilters.printingStatus === "All" || trackerValue(asset, "printingStatus", "NOT STARTED") === trackerFilters.printingStatus) &&
        (trackerFilters.deliveredToDestination === "All" || trackerValue(asset, "deliveredToDestination", "PENDING") === trackerFilters.deliveredToDestination) &&
        (trackerFilters.flightStatus === "All" || row.flightStatus === trackerFilters.flightStatus) &&
        withinRange(Number(asset.rentalPrice || 0), trackerFilters.rentalMin, trackerFilters.rentalMax) &&
        withinRange(row.total, trackerFilters.totalMin, trackerFilters.totalMax) &&
        withinRange(row.remaining, trackerFilters.remainingMin, trackerFilters.remainingMax)
      );
    });
  }, [trackerRows, trackerFilters]);
  const trackerSummary = useMemo(() => ({
    totalRows: filteredTrackerRows.length,
    flighted: filteredTrackerRows.filter((row) => row.flightStatus === "flighted").length,
    due: filteredTrackerRows.filter((row) => row.remaining !== null && row.remaining <= 0).length,
    totalCost: filteredTrackerRows.reduce((sum, row) => sum + row.total, 0),
  }), [filteredTrackerRows]);

  function toggleShortlist(id: number) {
    if (!shortlist.includes(id)) {
      const asset = billboards.find((item) => item.id === id);
      setCosts((current) => ({
        ...current,
        [id]: current[id] ?? {
          rental: String(asset?.rentalPrice || ""),
          printing: String(asset?.printingPrice || ""),
          transport: String(asset?.transportPrice || ""),
          flighting: String(asset?.flightingPrice || ""),
        },
      }));
    }
    setShortlist((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  function addAssetsToPlan(assets: Billboard[]) {
    if (!assets.length) return;
    setShortlist((current) => Array.from(new Set([...current, ...assets.map((item) => item.id)])));
    setCosts((current) => {
      const next = { ...current };
      assets.forEach((asset) => {
        next[asset.id] = next[asset.id] ?? {
          rental: String(asset.rentalPrice || ""),
          printing: String(asset.printingPrice || ""),
          transport: String(asset.transportPrice || ""),
          flighting: String(asset.flightingPrice || ""),
        };
      });
      return next;
    });
  }

  function removeFromPlan(id: number) {
    setShortlist((current) => current.filter((item) => item !== id));
    setCosts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function exportPlan() {
    const rows = plannedAssets.map((item) => [
      item.id,
      item.street,
      item.district,
      item.from,
      item.to,
      `${item.width} x ${item.height} m`,
      item.faces,
      item.owner,
      costs[item.id]?.rental || "0",
      costs[item.id]?.printing || "0",
      costs[item.id]?.transport || "0",
      costs[item.id]?.flighting || "0",
      itemTotal(item.id),
      item.lat,
      item.lng,
    ]);
    const header = [
      "ID", "Street", "Area", "From", "To", "Format", "Faces",
      "Owner", "Rental TZS", "Printing TZS", "Transport TZS",
      "Flighting TZS", "Total TZS", "Latitude", "Longitude",
    ];
    const csv = [header, ...rows]
      .map((row) =>
        row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    link.download = "spotlight-ooh-campaign-plan.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function searchAddress(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = addressQuery.trim();
    if (!term || !mapRef.current) return;
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(term)}&limit=1&accept-language=en`,
        { headers: { Accept: "application/json" } },
      );
      if (!response.ok) {
        setImportMessage("Address search failed");
        return;
      }
      const results = await response.json() as Array<{ lat: string; lon: string; display_name: string }>;
      if (!results?.length) {
        setImportMessage("Address not found");
        return;
      }
      const { lat, lon, display_name: displayName } = results[0];
      mapRef.current.flyTo([Number(lat), Number(lon)], 16, { duration: 1.5 });
      setImportMessage(`Found: ${displayName}`);
      window.setTimeout(() => setImportMessage(""), 3500);
    } catch (error) {
      console.error("Address search error", error);
      setImportMessage("Address search failed");
    }
  }

  async function deleteBillboard(id: number) {
    if (!confirm("Delete this billboard?")) return;
    try {
      const response = await fetch("/api/app?action=delete-inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, projectId: currentProjectId }),
      });
      if (!response.ok) throw new Error("Delete failed");
      setBillboards((current) => current.filter((item) => item.id !== id));
      if (selected?.id === id) setSelected(null);
      removeFromPlan(id);
      setImportMessage("Billboard deleted");
      window.setTimeout(() => setImportMessage(""), 2000);
    } catch (error) {
      console.error(error);
      setImportMessage("Failed to delete billboard");
      window.setTimeout(() => setImportMessage(""), 2000);
    }
  }

  async function clearProjectBillboards() {
    const project = projects.find((item) => item.id === currentProjectId);
    const name = project?.name ?? "this project";
    if (!confirm(`Clear all billboards from ${name}? This keeps the project, users, missions, and plans.`)) return;
    try {
      const response = await fetch("/api/app?action=clear-inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: currentProjectId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Clear failed");
      setBillboards([]);
      setSelected(null);
      setShortlist([]);
      setCosts({});
      setImportMessage(`${result.deleted ?? 0} billboards cleared from ${name}`);
      window.setTimeout(() => setImportMessage(""), 3000);
    } catch (error) {
      console.error(error);
      setImportMessage("Failed to clear project billboards");
      window.setTimeout(() => setImportMessage(""), 2500);
    }
  }

  async function deleteProject() {
    const project = projects.find((item) => item.id === currentProjectId);
    if (!project) return;
    const canDelete = user?.role === "admin" || (user?.role === "creator" && Number(project.created_by) === user.id);
    if (!canDelete) {
      setImportMessage("Only admins or the project creator can delete this project");
      window.setTimeout(() => setImportMessage(""), 3000);
      return;
    }
    const typedName = window.prompt(`Delete project "${project.name}" and all its data? This removes billboards, plans, missions, field collections, contacts, flight schedules, and user assignments.\n\nType DELETE to confirm.`);
    if (typedName !== "DELETE") return;
    try {
      const response = await fetch("/api/app?action=delete-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: currentProjectId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Delete failed");
      const refreshed = await fetch("/api/app?action=projects").then((value) => value.json());
      const nextProjects = refreshed.projects ?? [];
      setProjects(nextProjects);
      const nextProjectId = nextProjects[0]?.id ?? 0;
      setCurrentProjectId(nextProjectId);
      setBillboards([]);
      setSelected(null);
      setShortlist([]);
      setCosts({});
      setPlans([]);
      setFlightSchedules([]);
      setProjectContacts([]);
      setImportMessage(`${result.deletedProject ?? project.name} deleted`);
      if (!nextProjectId && canManage) setProjectOpen(true);
      window.setTimeout(() => setImportMessage(""), 3000);
    } catch (error) {
      console.error(error);
      setImportMessage(error instanceof Error ? error.message : "Failed to delete project");
      window.setTimeout(() => setImportMessage(""), 3000);
    }
  }

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/app?action=login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setLoginError(data.error ?? "Unable to sign in");
      return;
    }
    setUser(data.user);
    setLoginError("");
  }

  async function logout() {
    await fetch("/api/app?action=logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    setUser(null);
  }

  async function savePlan() {
    const response = await fetch("/api/app?action=plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: currentPlanId,
        projectId: currentProjectId,
        name: planName,
        data: { shortlist, costs },
        note: planNote,
      }),
    });
    const result = await response.json();
    if (!currentPlanId && result.id) setCurrentPlanId(result.id);
    const refreshed = await fetch(`/api/app?action=plans&projectId=${currentProjectId}`).then((value) => value.json());
    setPlans(refreshed.plans ?? []);
  }

  function newPlan() {
    setCurrentPlanId(null);
    setPlanName(`Campaign Plan ${plans.length + 1}`);
    setShortlist([]);
    setCosts({});
    setPlanNote("");
    setPlanOpen(true);
  }

  function loadPlan(plan: CampaignPlan) {
    setCurrentPlanId(plan.id);
    setPlanName(plan.name);
    setShortlist(plan.data.shortlist ?? []);
    setCosts(plan.data.costs ?? {});
    setPlanNote(plan.note ?? "");
    setPlanOpen(true);
  }

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/app?action=projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (response.ok) {
      const data = await response.json();
      const refreshed = await fetch("/api/app?action=projects").then((value) => value.json());
      setProjects(refreshed.projects ?? []);
      setCurrentProjectId(data.project.id);
      setProjectOpen(false);
    }
  }

  async function assignSelectedToProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentProjectId || !shortlist.length) return;
    setAssignProjectSaving(true);
    setImportMessage("");
    try {
      let targetProjectId = Number(assignTargetProjectId) || 0;
      const newProjectName = assignNewProjectName.trim();
      if (newProjectName) {
        const createResponse = await fetch("/api/app?action=projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newProjectName, projectType: "Outdoor media" }),
        });
        const created = await createResponse.json();
        if (!createResponse.ok) throw new Error(created.error ?? "Failed to create project");
        targetProjectId = Number(created.project?.id) || 0;
      }
      if (!targetProjectId) throw new Error("Choose a target project or enter a new project name");
      const response = await fetch("/api/app?action=assign-billboards-to-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceProjectId: currentProjectId,
          targetProjectId,
          assetIds: shortlist,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Failed to assign billboards");
      const refreshed = await fetch("/api/app?action=projects").then((value) => value.json());
      setProjects(refreshed.projects ?? []);
      setAssignProjectOpen(false);
      setAssignTargetProjectId("");
      setAssignNewProjectName("");
      setShortlist([]);
      setShowSelectedOnly(false);
      setImportMessage(`${result.assigned ?? shortlist.length} billboard(s) assigned to ${result.project?.name ?? "target project"}`);
      window.setTimeout(() => setImportMessage(""), 3000);
    } catch (error) {
      console.error(error);
      setImportMessage(error instanceof Error ? error.message : "Failed to assign billboards");
      window.setTimeout(() => setImportMessage(""), 3000);
    } finally {
      setAssignProjectSaving(false);
    }
  }

  async function importInventory(file: File) {
    const text = await file.text();
    let items: Billboard[] = [];
    if (file.name.toLowerCase().endsWith(".kml")) {
      items = parseCompleteInventory(text);
    } else {
      const parsedRows = parseCsvRows(text);
      const headers = parsedRows.shift() ?? [];
      const rows = parsedRows;
      const normalized = headers.map(normalizeHeader);
      const aliases: Record<string, string[]> = {
        street: ["street", "street name", "road", "road name", "route", "name", "site", "billboard", "billboard name", "location name", "jina la eneo", "mtaa"],
        district: ["area", "district", "location", "region", "ward"],
        from: ["from", "road from", "route from", "start", "origin"],
        to: ["to", "road to", "route to", "end", "destination"],
        latitude: ["latitude", "lat", "gps latitude", "gps lat", "y", "y coordinate"],
        longitude: ["longitude", "lng", "lon", "long", "gps longitude", "gps long", "x", "x coordinate"],
        width: ["width", "width m", "w"],
        height: ["height", "height m", "h"],
        dimensions: ["dimensions", "dimension", "size", "format", "format size"],
        faces: ["faces", "face", "number of faces"],
        owner: ["owner", "vendor", "supplier"],
        mediaType: ["type", "board type", "billboard type", "media type", "format type", "screen type"],
        status: ["status", "selection status", "selected", "planning status"],
        photoUrl: ["photo url", "image url", "photo", "image", "photo_url", "image_url", "picture url", "media url"],
        rental: ["rental", "rental price", "space price", "space rental price"],
        printing: ["printing", "printing price"],
        transport: ["transport", "transport price"],
        flighting: ["flighting", "flighting price", "installation price"],
      };
      const automatic: Record<string, string> = {};
      Object.entries(aliases).forEach(([field, names]) => {
        const normalizedNames = names.map(normalizeHeader);
        const match = normalized.findIndex((header) => normalizedNames.includes(header) || normalizedNames.some((name) => header.includes(name)));
        if (match >= 0) automatic[field] = headers[match];
      });
      setCsvMap(automatic);
      setCsvImport({ headers, rows });
      return;
    }
    const valid = items.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng) && item.lat !== 0 && item.lng !== 0);
    const response = await fetch("/api/app?action=inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, projectId: currentProjectId }),
    });
    const result = await response.json();
    if (response.ok) {
      const all = await fetch(`/api/app?action=inventory&projectId=${currentProjectId}`).then((value) => value.json());
      setBillboards(all.inventory);
      setImportMessage(`${result.imported} imported · ${items.length - valid.length} without GPS skipped`);
    }
  }

  async function commitMappedCsv() {
    if (!csvImport) return;
    const indexOf = (field: string) => csvImport.headers.indexOf(csvMap[field]);
    const value = (row: string[], field: string) => {
      const index = indexOf(field);
      return index >= 0 ? row[index] ?? "" : "";
    };
    const items: Billboard[] = csvImport.rows.map((row, index) => {
      const dimensions = parseDimensions(value(row, "dimensions"));
      const sourceAttributes = csvImport.headers.reduce((acc, header, headerIndex) => {
        acc[header] = row[headerIndex] ?? "";
        return acc;
      }, {} as Record<string, string>);
      const sourceValue = (preferredHeaders: string[]) => {
        const preferred = preferredHeaders.map(normalizeHeader);
        const index = csvImport.headers.findIndex((header) => {
          const normalized = normalizeHeader(header);
          return preferred.some((name) => normalized === name || normalized.includes(name));
        });
        return index >= 0 ? String(row[index] ?? "").trim() : "";
      };
      const firstMeaningfulValue =
        row.find((cell, cellIndex) => {
          const text = String(cell ?? "").trim();
          const header = normalizeHeader(csvImport.headers[cellIndex] ?? "");
          return Boolean(text) && !["latitude", "longitude", "lat", "lng", "lon", "photo url", "image url"].some((name) => header.includes(name));
        })?.trim() ?? "";
      const mediaType = normalizeMediaType(value(row, "mediaType"));
      const rawPhotoUrl = value(row, "photoUrl").trim();
      const normalizedPhotoUrl = normalizeImageUrl(rawPhotoUrl);
      const ownerName =
        value(row, "owner").trim() ||
        sourceValue(["owner", "vendor", "supplier", "company", "agency"]) ||
        "Unknown";
      const routeName = [value(row, "from"), value(row, "to")]
        .map((item) => item.trim())
        .filter(Boolean)
        .join(" → ");
      const streetName =
        value(row, "street").trim() ||
        sourceValue(["street name", "road name", "route", "billboard name", "site name", "name", "site", "location", "street", "address", "road", "jina la eneo", "mtaa"]) ||
        routeName ||
        sourceValue(["vendor", "owner", "supplier", "company", "agency"]) ||
        (ownerName !== "Unknown" ? ownerName : "") ||
        firstMeaningfulValue ||
        `${mediaTypeLabel(mediaType)} ${index + 1}`;
      const districtName =
        value(row, "district").trim() ||
        sourceValue(["area", "district", "region", "ward", "location"]) ||
        "Unspecified area";
      const imported: Billboard = {
      id: Date.now() + index,
      district: renameDistrict(districtName),
      street: streetName,
      owner: ownerName,
      from: "—",
      to: "—",
      brackets: "—",
      height: parseNumber(value(row, "height")) || dimensions.height,
      width: parseNumber(value(row, "width")) || dimensions.width,
      occupied: false,
      advert: "No advert recorded",
      faces: parseNumber(value(row, "faces")) || 1,
      arrangement: "Not recorded",
      lampPosts: 0,
      lat: parseNumber(value(row, "latitude")),
      lng: parseNumber(value(row, "longitude")),
      mediaType,
      status: normalizeUploadStatus(value(row, "status")),
      photoUrl: normalizedPhotoUrl,
      photoOriginalUrl: rawPhotoUrl && normalizedPhotoUrl !== rawPhotoUrl ? originalImageUrl(rawPhotoUrl) : undefined,
      sourceAttributes,
      rentalPrice: parseNumber(value(row, "rental")),
      printingPrice: parseNumber(value(row, "printing")),
      transportPrice: parseNumber(value(row, "transport")),
      flightingPrice: parseNumber(value(row, "flighting")),
      projectId: currentProjectId,
      };
      return {
        ...imported,
        from: value(row, "from") || imported.from,
        to: value(row, "to") || imported.to,
      };
    });
    const response = await fetch("/api/app?action=inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, projectId: currentProjectId }),
    });
    const result = await response.json();
    const all = await fetch(`/api/app?action=inventory&projectId=${currentProjectId}`).then((value) => value.json());
    setBillboards(all.inventory ?? []);
    setImportMessage(`${result.imported} imported · ${result.rejected} without GPS skipped`);
    setCsvImport(null);
  }

  function downloadCsvTemplate() {
    const rows = [
      ["Billboard Name", "Area", "From", "To", "Latitude", "Longitude", "TYPE", "Status", "Dimensions", "Width", "Height", "Faces", "Owner", "Photo URL", "Rental Price", "Printing Price", "Transport Price", "Flighting Price", "Remarks"],
      ["Example - Morocco Junction", "Kinondoni", "Morocco", "Mwenge", "-6.781234", "39.223456", "Large format", "Selected", "12x4", "12", "4", "2", "Vendor name", "https://example.com/photo.jpg", "1500000", "250000", "100000", "80000", "Optional note"],
      ["Example - Ali Hassan Mwinyi Lamp Post", "Ilala", "Kariakoo", "Posta", "-6.812345", "39.278901", "Lamp post", "Not selected", "1x1", "1", "1", "1", "Vendor name", "", "300000", "70000", "50000", "40000", ""],
      ["Example - Digital Screen", "Masaki", "Oysterbay", "Slipway", "-6.746012", "39.279988", "Digital screen", "Selected", "6x3", "6", "3", "1", "Vendor name", "https://example.com/screen.jpg", "2200000", "0", "150000", "120000", ""],
      ["Example - Fabricated Banner", "Zanzibar", "Airport", "Kariakoo", "-6.165400", "39.202200", "Fabricated banner", "Not selected", "8x4", "8", "4", "1", "Vendor name", "", "900000", "180000", "100000", "60000", ""],
    ];
    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "billboard-import-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function loadUsers() {
    const response = await fetch("/api/app?action=users");
    if (response.ok) setUsers((await response.json()).users);
    setAdminOpen(true);
  }

  async function ensureUsersLoaded() {
    if (users.length) return users;
    const response = await fetch("/api/app?action=users");
    if (!response.ok) return [];
    const data = await response.json();
    setUsers(data.users ?? []);
    return data.users ?? [];
  }

  async function assignSelectedForValidation() {
    if (!selected || !validationAssigneeId) {
      setImportMessage("Select a field user for validation");
      window.setTimeout(() => setImportMessage(""), 2500);
      return;
    }
    setValidationSaving(true);
    try {
      const response = await fetch("/api/app?action=assign-validations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: currentProjectId, assetIds: [selected.id], userIds: [Number(validationAssigneeId)] }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Assignment failed");
      const refreshed = await fetch(`/api/app?action=validation-assignments&projectId=${currentProjectId}`).then((value) => value.json());
      setValidationAssignments(refreshed.assignments ?? []);
      setImportMessage("Billboard assigned for validation");
      window.setTimeout(() => setImportMessage(""), 2500);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "Unable to assign validation");
      window.setTimeout(() => setImportMessage(""), 3000);
    } finally {
      setValidationSaving(false);
    }
  }

  async function approveValidationAssignment(assignment: ValidationAssignment) {
    const remark = (validationApprovalDrafts[assignment.id] ?? "").trim();
    if (!remark) {
      setImportMessage("Write approval remark before marking okay");
      window.setTimeout(() => setImportMessage(""), 2500);
      return;
    }
    setValidationApprovalSaving((current) => ({ ...current, [assignment.id]: true }));
    try {
      const response = await fetch("/api/app?action=approve-validation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: assignment.id, remark }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Approval failed");
      const refreshed = await fetch(`/api/app?action=validation-assignments&projectId=${currentProjectId}`).then((value) => value.json());
      setValidationAssignments(refreshed.assignments ?? []);
      setBillboards((current) => current.map((item) => item.id === Number(assignment.asset_id)
        ? { ...item, validationStatus: "ok", validatedAt: Date.now() }
        : item));
      setValidationApprovalDrafts((current) => ({ ...current, [assignment.id]: "" }));
      setImportMessage("Validation marked as okay");
      window.setTimeout(() => setImportMessage(""), 2500);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "Unable to approve validation");
      window.setTimeout(() => setImportMessage(""), 3000);
    } finally {
      setValidationApprovalSaving((current) => ({ ...current, [assignment.id]: false }));
    }
  }

  async function addUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/app?action=users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (response.ok) {
      event.currentTarget.reset();
      loadUsers();
    }
  }

  async function removeUser(id: number) {
    const account = users.find((item) => item.id === id);
    if (!window.confirm(`Remove ${account?.name ?? "this user"}? Their sessions and group/project assignments will also be removed.`)) return;
    const response = await fetch(`/api/app?id=${id}`, { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      window.alert(data.error ?? "Unable to remove user");
      return;
    }
    setUsers((current) => current.filter((item) => item.id !== id));
    setUserGroups((current) => current.map((group) => ({ ...group, members: group.members?.filter((member: any) => member.id !== id) ?? [] })));
  }

  function resetFilters() {
    setQuery("");
    setDistrict("All areas");
    setAvailability("All status");
    setBoardTypeFilter("All types");
    setFacesFilter("All faces");
    setMapFlightFilter("All flight status");
    setAllProjectsProjectFilter("All projects");
  }

  if (!authReady) {
    return <main className="auth-screen"><div className="auth-loading">Loading inventory…</div></main>;
  }

  if (sharedToken && !sharedProject) {
    return (
      <main className="auth-screen">
        {shareChecking && !shareRequiresCode ? (
          <div className="login-card share-access-card">
            <span className="brand-mark">360</span>
            <span className="eyebrow">Shared map</span>
            <h1>Opening map</h1>
            <p>Checking the project sharing settings.</p>
            {shareError && <div className="login-error">{shareError}</div>}
          </div>
        ) : (
        <form className="login-card share-access-card" onSubmit={openSharedMap}>
          <span className="brand-mark">360</span>
          <span className="eyebrow">Shared map</span>
          <h1>Billboard 360</h1>
          <p>Enter the secret code supplied with this project map link.</p>
          <label>
            <span>Secret code</span>
            <input
              value={shareCodeInput}
              onChange={(event) => setShareCodeInput(event.target.value.toUpperCase())}
              placeholder="ABC123"
              required
              autoComplete="off"
            />
          </label>
          {shareError && <div className="login-error">{shareError}</div>}
          <button className="primary-button" type="submit">
            <LockKeyhole size={16} /> Open map
          </button>
        </form>
        )}
      </main>
    );
  }

  if (!user && !sharedProject) {
    return (
      <main className="auth-screen">
        <form className="login-card" onSubmit={login}>
          <span className="brand-mark">S</span>
          <span className="eyebrow">Secure access</span>
          <h1>Spotlight OOH</h1>
          <p>Sign in to manage inventory and campaign plans.</p>
          <label><span>Email</span><input name="email" type="email" required autoComplete="username" /></label>
          <label><span>Password</span><input name="password" type="password" required autoComplete="current-password" /></label>
          {loginError && <div className="login-error">{loginError}</div>}
          <button className="primary-button" type="submit">Sign in</button>
        </form>
      </main>
    );
  }

  return (
    <main className={isSharedView ? "app-shell app-shell--shared-view" : "app-shell"}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">S</span>
          <span>
            <strong>Spotlight OOH</strong>
            <small>Inventory management</small>
          </span>
        </div>
        <div className="topbar-actions">
          {user ? <label className="project-select">
            <span>Project</span>
            <select value={currentProjectId} onChange={(event) => setCurrentProjectId(Number(event.target.value))}>
              {user.role === "admin" && <option value={0}>All projects map</option>}
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label> : (
            <div className="project-view-label">
              <span>Project</span>
              <strong>{sharedProject?.name}</strong>
            </div>
          )}
          {canManage && (
            <>
              <button className="text-button" onClick={() => setProjectOpen(true)}><Plus size={15} /> Project</button>
              {canDeleteCurrentProject && (
                <button className="text-button clear-project-button" onClick={deleteProject}>
                  <Trash2 size={15} /> Delete project
                </button>
              )}
              <button className="text-button" onClick={() => { resetAssetDraft(); setPlacingAsset(true); }}>
                <Plus size={15} /> Add billboard
              </button>
              <button className="text-button" onClick={() => setActiveTab("flighting")}>
                <Check size={15} /> Flighting
              </button>
              {shortlist.length > 0 && (
                <button className="text-button" onClick={() => setAssignProjectOpen(true)}>
                  <Plus size={15} /> Assign selected
                </button>
              )}
            </>
          )}
          {user && (
            <button
              className="text-button"
              onClick={() => setSharePanelOpen(true)}
            >
              Share link
            </button>
          )}
          <label className="basemap-select">
            <Layers3 size={15} />
            <select value={baseMap} onChange={(event) => setBaseMap(event.target.value)} aria-label="Basemap">
              <option value="street">Street</option>
              <option value="light">Light</option>
              <option value="satellite">Satellite</option>
            </select>
          </label>
          <form className="address-search" onSubmit={searchAddress}>
            <Search size={15} />
            <input
              value={addressQuery}
              onChange={(event) => setAddressQuery(event.target.value)}
              placeholder="Search address"
              aria-label="Search address"
            />
            <button type="submit" aria-label="Go to address"><LocateFixed size={15} /></button>
          </form>
          {user?.role === "admin" && (
            <>
              <label className="text-button import-button">
                <FileUp size={16} /> Import
                <input
                  type="file"
                  accept=".csv,.kml"
                  onChange={(event) => event.target.files?.[0] && importInventory(event.target.files[0])}
                />
              </label>
              <button className="text-button" onClick={downloadCsvTemplate}>
                <Download size={16} /> Template
              </button>
              <button className="text-button clear-project-button" onClick={clearProjectBillboards}>
                <Trash2 size={16} /> Clear
              </button>
              <button className="text-button" onClick={loadUsers}>
                <UserCog size={16} /> Users
              </button>
            </>
          )}
          {canPlan && (
            <button className="primary-button" onClick={() => setPlanOpen(true)}>
              <Sparkles size={16} /> Build a plan
              {shortlist.length > 0 && <span>{shortlist.length}</span>}
            </button>
          )}
          {user ? (
            <button className="user-button" onClick={logout} title="Sign out">
              {user.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}
            </button>
          ) : (
            <span className="view-only-pill">View only</span>
          )}
        </div>
      </header>

      <nav className="tab-bar">
        <button
          className={activeTab === "planner" && !isAllProjectsMap ? "tab-btn tab-btn--active" : "tab-btn"}
          onClick={() => { if (isAllProjectsMap && projects[0]) setCurrentProjectId(projects[0].id); setActiveTab("planner"); }}
        >
          Planner
        </button>
        {user?.role === "admin" && (
          <button
            className={isAllProjectsMap && activeTab === "planner" ? "tab-btn tab-btn--active" : "tab-btn"}
            onClick={() => { setCurrentProjectId(0); setActiveTab("planner"); }}
          >
            All Projects Map
          </button>
        )}
        {user && <button className={activeTab === "dashboard" ? "tab-btn tab-btn--active" : "tab-btn"} onClick={() => setActiveTab("dashboard")}>Dashboard</button>}
        <button className={activeTab === "library" ? "tab-btn tab-btn--active" : "tab-btn"} onClick={() => setActiveTab("library")}>Image Library</button>
        {canPlan && <button className={activeTab === "flighting" ? "tab-btn tab-btn--active" : "tab-btn"} onClick={() => setActiveTab("flighting")}>Flighting</button>}
        {canPlan && <button className={activeTab === "tracker" ? "tab-btn tab-btn--active" : "tab-btn"} onClick={() => setActiveTab("tracker")}>Execution & Cost Tracker</button>}
        {canManage && (
          <button className={activeTab === "field" ? "tab-btn tab-btn--active" : "tab-btn"} onClick={() => setActiveTab("field")}>Field Management</button>
        )}
      </nav>

      <div className={activeTab === "planner" ? "workspace" : "workspace workspace--hidden"} aria-hidden={activeTab !== "planner"}>
        <aside className={sidebarOpen ? "sidebar" : "sidebar sidebar--closed"}>
          <div className="sidebar-inner">
            <section className="sidebar-head">
              <div>
                <span className="eyebrow">Billboard inventory</span>
                {importMessage && <p className="import-message">{importMessage}</p>}
                {isAllProjectsMap && <p className="import-message">Central map showing all projects</p>}
              </div>
              <div className="metrics-grid">
                <Metric value={largeFormatFaces} label="Large format faces" />
                <Metric value={digitalScreenFaces} label="Digital screen faces" accent />
                <Metric value={fabricatedBannerFaces} label="Fabricated banner faces" />
                <Metric value={filteredLampPosts} label="Lamp posts" />
                <Metric value={filteredTotalFaces} label="Total faces" />
              </div>
            </section>

            <section className="controls">
              <label className="search-box">
                <Search size={17} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search area, street or owner"
                />
                {query && (
                  <button onClick={() => setQuery("")} aria-label="Clear search">
                    <X size={15} />
                  </button>
                )}
              </label>
              <button
                className={showFilters ? "filter-toggle active" : "filter-toggle"}
                onClick={() => setShowFilters(!showFilters)}
              >
                <SlidersHorizontal size={16} /> Filters
                <ChevronDown size={14} />
              </button>
              {showFilters && (
                <div className="filter-grid">
                  {isAllProjectsMap && (
                    <label>
                      <span>Project</span>
                      <select
                        value={allProjectsProjectFilter}
                        onChange={(event) => setAllProjectsProjectFilter(event.target.value)}
                      >
                        <option>All projects</option>
                        {allProjectNames.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    <span>Area</span>
                    <select
                      value={district}
                      onChange={(event) => setDistrict(event.target.value)}
                    >
                      <option>All areas</option>
                      {districts.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Status</span>
                    <select
                      value={availability}
                      onChange={(event) => setAvailability(event.target.value)}
                    >
                      <option>All status</option>
                      <option value="selected">Selected</option>
                      <option value="not-selected">Not selected</option>
                    </select>
                  </label>
                  <label>
                    <span>Board type</span>
                    <select
                      value={boardTypeFilter}
                      onChange={(event) => setBoardTypeFilter(event.target.value)}
                    >
                      <option value="All types">All types</option>
                      <option value="lamp-post">Lamp post</option>
                      <option value="large-format">Large format</option>
                      <option value="digital-screen">Digital screen</option>
                      <option value="fabricated-banner">Fabricated banner</option>
                    </select>
                  </label>
                  <label>
                    <span>Faces</span>
                    <select value={facesFilter} onChange={(event) => setFacesFilter(event.target.value)}>
                      <option>All faces</option>
                      <option>1 face</option>
                      <option>2 faces</option>
                      <option>3+ faces</option>
                    </select>
                  </label>
                  <label>
                    <span>Flight status</span>
                    <select value={mapFlightFilter} onChange={(event) => setMapFlightFilter(event.target.value)}>
                      <option>All flight status</option>
                      <option value="flighted">Flighted</option>
                      <option value="unflighted">Unflighted</option>
                      <option value="deflighted">Deflighted</option>
                      <option value="expired">Expired</option>
                    </select>
                  </label>
                </div>
              )}
            </section>

            <div className="result-heading">
              <span>{filtered.length} results</span>
              {(query ||
                district !== "All areas" ||
                availability !== "All status" ||
                boardTypeFilter !== "All types" ||
                facesFilter !== "All faces" ||
                mapFlightFilter !== "All flight status" ||
                allProjectsProjectFilter !== "All projects") && (
                <button onClick={resetFilters}>Reset</button>
              )}
            </div>

            <section className="result-list">
              {loading && <div className="empty-state">Loading inventory…</div>}
              {!loading && !filtered.length && (
                <div className="empty-state">
                  No assets match these filters.
                  <button onClick={resetFilters}>Clear filters</button>
                </div>
              )}
              {filtered.map((item) => (
                <div
                  key={item.id}
                  className={
                    selected?.id === item.id
                      ? "asset-row asset-row--selected"
                      : "asset-row"
                  }
                >
                  <button className="asset-row-main" onClick={() => focusItem(item)}>
                    <span
                      className={
                        item.mediaType === "large-format"
                          ? "row-icon row-icon--large"
                          : item.mediaType === "digital-screen"
                            ? "row-icon row-icon--digital"
                            : item.mediaType === "fabricated-banner"
                              ? "row-icon row-icon--fabricated"
                          : item.occupied ? "row-icon" : "row-icon row-icon--available"
                      }
                    >
                      <MapPin size={16} />
                    </span>
                    <span className="row-copy">
                      <strong>{item.street}</strong>
                      <small>
                        {isAllProjectsMap && item.projectName ? `${item.projectName} · ` : ""}{item.district} · {item.from} → {item.to}
                      </small>
                      <span>
                        {item.width} × {item.height} m · {item.faces} faces
                      </span>
                    </span>
                    <span
                      className={
                        (item.status ?? "not-selected") === "selected" ? "status status--selected" : "status status--not-selected"
                      }
                    >
                      {statusLabel(item.status)}
                    </span>
                  </button>
                  {canManage && (
                    <button
                      className="asset-row-delete"
                      onClick={(event) => { event.stopPropagation(); deleteBillboard(item.id); }}
                      aria-label="Delete billboard"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </section>
          </div>
          <button
            className="collapse-button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label={sidebarOpen ? "Close inventory panel" : "Open inventory panel"}
          >
            <PanelLeftClose size={18} />
          </button>
        </aside>

        <section className="map-area">
          <div ref={mapNode} className="map" />
          <div className="map-key">
            <span>
              <i className="dot dot--available" /> Available
            </span>
            <span>
              <i className="dot" /> Occupied
            </span>
            <span>
              <i className="dot dot--large" /> Large format
            </span>
            <span>
              <i className="dot dot--digital" /> Digital screen
            </span>
            <span>
              <i className="dot dot--fabricated" /> Fabricated banner
            </span>
            <small>Number = faces</small>
          </div>
          <button
            className="map-control locate"
            onClick={() => fitMapToBillboardExtent(visibleAssets.length ? visibleAssets : billboards, true)}
            aria-label="Zoom to billboard extent"
            title="Zoom to billboard extent"
          >
            <LocateFixed size={18} />
          </button>
          {canPlan && (
            <button
              className={boxSelectMode ? "map-control bulk-select active" : "map-control bulk-select"}
              onClick={() => setBoxSelectMode((current) => !current)}
              aria-label="Box select billboards"
              title="Drag a box around billboards to add them to the plan"
            >
              Box
            </button>
          )}
          <div className="map-summary">
            <BarChart3 size={16} />
            <span>
              Showing <strong>{visibleAssets.length}</strong> of {billboards.length} assets
            </span>
          </div>

          {editingPosition && selected && (
            <div className="position-edit-hint">
              Drag the marker to reposition <strong>{selected.street}</strong>
              <button type="button" onClick={() => setEditingPosition(false)}>Done</button>
            </div>
          )}

          {positionHint && (
            <div className="position-toast">{positionHint}</div>
          )}

          {placingAsset && (
            <div className="position-edit-hint place-hint">
              Click on the map to place the new billboard
              <button type="button" onClick={() => setPlacingAsset(false)}>Cancel</button>
            </div>
          )}

          {boxSelectMode && (
            <div className="position-edit-hint bulk-select-hint">
              Drag a box around billboards to add them to the current plan. Shift-click markers for one-by-one selection.
              <button type="button" onClick={() => setBoxSelectMode(false)}>Cancel</button>
            </div>
          )}

          {selected && (
            <article className="detail-card detail-card--asset">
              <button
                className="close-detail"
                onClick={() => setSelected(null)}
                aria-label="Close details"
              >
                <X size={17} />
              </button>
              <div className="detail-title">
                <span
                  className={
                    selected.occupied
                      ? "detail-pin"
                      : "detail-pin detail-pin--available"
                  }
                >
                  <MapPin size={18} />
                </span>
                <div>
                  <span className="eyebrow">{mediaTypeLabel(selected.mediaType)} · {selected.district}</span>
                  <h2>{selected.street}</h2>
                  <p>
                    {isAllProjectsMap && selected.projectName ? `${selected.projectName} · ` : ""}{selected.from} → {selected.to}
                  </p>
                </div>
              </div>
              <div className="detail-stats">
                <div>
                  <span>Format</span>
                  <strong>
                    {selected.width} × {selected.height} m
                  </strong>
                </div>
                <div>
                  <span>Faces</span>
                  <strong>{selected.faces}</strong>
                </div>
                <div>
                  <span>Lamp posts</span>
                  <strong>{selected.lampPosts}</strong>
                </div>
              </div>
              <dl className="attributes">
                <div>
                  <dt>Arrangement</dt>
                  <dd>{selected.arrangement}</dd>
                </div>
                <div>
                  <dt>Brackets</dt>
                  <dd>{selected.brackets}</dd>
                </div>
                <div>
                  <dt>Owner</dt>
                  <dd>{selected.owner}</dd>
                </div>
                {isAllProjectsMap && selected.projectName && (
                  <div>
                    <dt>Project</dt>
                    <dd>{selected.projectName}</dd>
                  </div>
                )}
                <div>
                  <dt>Status</dt>
                  <dd>{statusLabel(selected.status)}</dd>
                </div>
                <div>
                  <dt>Current advert</dt>
                  <dd>{selected.advert}</dd>
                </div>
                {billboardImageUrl(selected) && (
                  <div>
                    <dt>Photo URL</dt>
                    <dd><a href={billboardOriginalImageUrl(selected)} target="_blank" rel="noreferrer">Open image</a></dd>
                  </div>
                )}
              </dl>
              {canPlan && (
                <section className="flight-card">
                  <div className="flight-card-head">
                    <span className="eyebrow">Flight schedule</span>
                    <strong>{flightByAssetId.get(selected.id)?.flight_status ?? "unflighted"}</strong>
                  </div>
                  <div className="flight-grid">
                    <label><span>Stage</span>
                      <select value={flightDraft.stage} onChange={(event) => setFlightDraft((current) => ({ ...current, stage: event.target.value, flightStatus: event.target.value === "flighted" ? "flighted" : event.target.value === "removed" ? "deflighted" : current.flightStatus }))}>
                        <option value="design">Design</option>
                        <option value="printing">Printing</option>
                        <option value="transport">Transport</option>
                        <option value="ready">Ready</option>
                        <option value="flighted">Flighted</option>
                        <option value="removed">Deflighted / removed</option>
                      </select>
                    </label>
                    <label><span>Status</span>
                      <select value={flightDraft.stage === "flighted" ? "flighted" : flightDraft.flightStatus} onChange={(event) => {
                        const value = event.target.value;
                        setFlightDraft((current) => ({
                          ...current,
                          stage: value === "flighted" ? "flighted" : value === "deflighted" ? "removed" : current.stage,
                          flightStatus: current.stage === "flighted" ? "flighted" : value,
                        }));
                      }}>
                        <option value="unflighted" disabled={flightDraft.stage === "flighted"}>Unflighted</option>
                        <option value="flighted">Flighted</option>
                        <option value="deflighted" disabled={flightDraft.stage === "flighted"}>Deflighted</option>
                      </select>
                    </label>
                    <label><span>Days flighted</span><input type="number" min="0" value={flightDraft.durationDays} onChange={(event) => setFlightDraft((current) => ({ ...current, durationDays: event.target.value }))} /></label>
                    <label><span>Reminder days</span><input type="number" min="0" value={flightDraft.reminderDays} onChange={(event) => setFlightDraft((current) => ({ ...current, reminderDays: event.target.value }))} /></label>
                  </div>
                  <label className="flight-note"><span>Note</span><input value={flightDraft.note} onChange={(event) => setFlightDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Removal notes or memo" /></label>
                  <small>Expiry: {shortDate(flightByAssetId.get(selected.id)?.end_at)}</small>
                  <button className="primary-button" disabled={flightSaving} onClick={() => saveFlightSchedule([selected.id])}>
                    {flightSaving ? "Saving..." : "Save flight status"}
                  </button>
                </section>
              )}
              <div className="selected-media-panel">
                {billboardImageUrl(selected) ? (
                  <button className="linked-image-preview" onClick={() => { setViewingPhoto(billboardImageUrl(selected)); setPhotoViewerOpen(true); }}>
                    <img src={billboardImageUrl(selected)} alt={`${selected.street} linked media`} onError={markImageFailed} />
                    <em>Image unavailable. Replace it by uploading a photo or attaching a new link.</em>
                    <span><Eye size={14} /> Preview linked photo</span>
                  </button>
                ) : (
                  <div className="linked-image-empty">No image attached</div>
                )}
                {canManage && (
                  <div className="selected-media-tools">
                    <label className={photoSaving ? "photo-upload-button disabled" : "photo-upload-button"}>
                      <FileUp size={14} /> Upload image
                      <input
                        type="file"
                        accept="image/*"
                        disabled={photoSaving}
                        onChange={(event) => uploadSelectedPhoto(event.target.files?.[0])}
                      />
                    </label>
                    <form className="photo-link-form" onSubmit={attachSelectedPhotoLink}>
                      <input
                        value={photoLinkDraft}
                        onChange={(event) => setPhotoLinkDraft(event.target.value)}
                        placeholder="Paste image URL"
                        disabled={photoSaving}
                      />
                      <button type="submit" disabled={photoSaving}>
                        {photoSaving ? "Saving..." : "Attach link"}
                      </button>
                    </form>
                    {billboardImageUrl(selected) && (
                      <button className="remove-photo-button" type="button" disabled={photoSaving} onClick={() => saveSelectedPhoto("")}>
                        Remove image
                      </button>
                    )}
                  </div>
                )}
              </div>
              {canManage && (
                <section className="validation-panel">
                  <div className="flight-card-head">
                    <span className="eyebrow">Field validation</span>
                    <strong>{selectedValidationAssignments.length}</strong>
                  </div>
                  <div className="validation-assign-row">
                    <select
                      value={validationAssigneeId}
                      onFocus={() => { void ensureUsersLoaded(); }}
                      onChange={(event) => setValidationAssigneeId(event.target.value)}
                    >
                      <option value="">Select field user</option>
                      {fieldUsers.map((account) => (
                        <option key={account.id} value={account.id}>{account.name} · {account.email}</option>
                      ))}
                    </select>
                    <button className="primary-button" type="button" disabled={validationSaving || !validationAssigneeId} onClick={assignSelectedForValidation}>
                      {validationSaving ? "Assigning..." : "Assign"}
                    </button>
                  </div>
                  <div className="validation-list">
                    {selectedValidationAssignments.map((assignment) => (
                      <div key={assignment.id} className="validation-row">
                        <span>{assignment.assignee_name || assignment.assignee_email || `User ${assignment.assigned_to}`}</span>
                        <strong>{validationStatusLabel(assignment.status)}</strong>
                        {(assignment.status === "issue" || Boolean(assignment.report?.adminRemark)) && (
                          <div className="validation-report-details">
                            {validationReportLines(assignment.report).map(([label, value]) => (
                              <span key={label}><b>{label}</b>{String(value)}</span>
                            ))}
                            {Boolean(assignment.report?.photo) && (
                              <button type="button" onClick={() => { setViewingPhoto(String(assignment.report?.photo)); setPhotoViewerOpen(true); }}>
                                <Eye size={13} /> View issue photo
                              </button>
                            )}
                            {user?.role === "admin" && assignment.status === "issue" && (
                              <div className="validation-approval-box">
                                <label>
                                  <span>Admin remark</span>
                                  <textarea
                                    value={validationApprovalDrafts[assignment.id] ?? ""}
                                    onChange={(event) => setValidationApprovalDrafts((current) => ({ ...current, [assignment.id]: event.target.value }))}
                                    placeholder="Write why this issue is approved as okay"
                                  />
                                </label>
                                <button
                                  type="button"
                                  className="primary-button"
                                  disabled={Boolean(validationApprovalSaving[assignment.id])}
                                  onClick={() => approveValidationAssignment(assignment)}
                                >
                                  {validationApprovalSaving[assignment.id] ? "Approving..." : "Mark approved / okay"}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {!selectedValidationAssignments.length && <small>No validation assignment yet.</small>}
                  </div>
                </section>
              )}
              {selected.sourceAttributes && Object.keys(selected.sourceAttributes).length > 0 && (
                <details className="source-attributes" open>
                  <summary>Uploaded CSV attributes · {Object.keys(sourceAttrDraft).length} fields</summary>
                  <div className="source-attributes-grid">
                    {Object.entries(sourceAttrDraft)
                      .filter(([key, value]) => key.trim() || String(value ?? "").trim())
                      .map(([key, value]) => (
                        <label key={key}>
                          <span>{key}</span>
                          <input
                            value={String(value ?? "")}
                            disabled={!canManage || sourceAttrSaving}
                            onChange={(event) =>
                              setSourceAttrDraft((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                          />
                        </label>
                      ))}
                  </div>
                  {canManage && (
                    <div className="source-attributes-actions">
                      <button type="button" className="text-button" disabled={sourceAttrSaving} onClick={() => setSourceAttrDraft(selected.sourceAttributes ?? {})}>
                        Reset
                      </button>
                      <button type="button" className="primary-button" disabled={sourceAttrSaving} onClick={saveSelectedSourceAttributes}>
                        {sourceAttrSaving ? "Saving..." : "Save attributes"}
                      </button>
                    </div>
                  )}
                </details>
              )}
              <div className="detail-actions">
                {canPlan && <button
                  className={
                    shortlist.includes(selected.id)
                      ? "primary-button selected-plan"
                      : "primary-button"
                  }
                  onClick={() => toggleShortlist(selected.id)}
                >
                  {shortlist.includes(selected.id) ? (
                    <>
                      <Check size={16} /> Added to plan
                    </>
                  ) : (
                    <>
                      <Plus size={16} /> Add to plan
                    </>
                  )}
                </button>}
                <button
                  className="icon-button"
                  onClick={() =>
                    mapRef.current?.flyTo([selected.lat, selected.lng], 18)
                  }
                  aria-label="Zoom to asset"
                >
                  <Maximize2 size={17} />
                </button>
                {canManage && <button
                    className={editingPosition ? "icon-button active" : "icon-button"}
                    onClick={() => setEditingPosition(!editingPosition)}
                    aria-label="Edit position"
                    title="Edit position"
                  >
                    <Move size={17} />
                  </button>}
                {canManage && (
                  <button
                    className="icon-button"
                    onClick={() => selected && deleteBillboard(selected.id)}
                    aria-label="Delete billboard"
                    title="Delete billboard"
                  >
                    <Trash2 size={17} />
                  </button>
                )}
              </div>
            </article>
          )}

          {planOpen && (
            <>
              <button
                className="plan-backdrop"
                onClick={() => setPlanOpen(false)}
                aria-label="Close campaign plan"
              />
              <aside className="plan-panel">
                <div className="plan-head">
                  <div>
                    <span className="eyebrow">Campaign workspace</span>
                    <input className="plan-name-input" value={planName} onChange={(event) => setPlanName(event.target.value)} aria-label="Plan name" />
                    <p>{plannedAssets.length} assets in this plan</p>
                  </div>
                  <button
                    className="close-detail"
                    onClick={() => setPlanOpen(false)}
                    aria-label="Close campaign plan"
                  >
                    <X size={17} />
                  </button>
                </div>
                <div className="plan-switcher">
                  <select value={currentPlanId ?? ""} onChange={(event) => {
                    const plan = plans.find((item) => item.id === Number(event.target.value));
                    if (plan) loadPlan(plan);
                  }}>
                    <option value="">Current unsaved plan</option>
                    {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
                  </select>
                  <button onClick={newPlan}><Plus size={14} /> New</button>
                  <button onClick={() => setCompareOpen(true)}><BarChart3 size={14} /> Compare</button>
                </div>

                <button
                  className={
                    showSelectedOnly
                      ? "selected-map-toggle active"
                      : "selected-map-toggle"
                  }
                  onClick={() => setShowSelectedOnly(!showSelectedOnly)}
                >
                  {showSelectedOnly ? <Eye size={16} /> : <EyeOff size={16} />}
                  {showSelectedOnly
                    ? "Showing selected only on map"
                    : "Show selected only on map"}
                </button>
                {canManage && shortlist.length > 0 && (
                  <button
                    className="selected-map-toggle assign-project-toggle"
                    onClick={() => setAssignProjectOpen(true)}
                  >
                    <Plus size={16} /> Assign selected billboards to another project
                  </button>
                )}

                <div className="plan-list">
                  {!plannedAssets.length && (
                    <div className="empty-plan">
                      <span><Plus size={19} /></span>
                      <strong>No billboards selected</strong>
                      <p>Close this panel and choose assets from the map or inventory.</p>
                    </div>
                  )}
                  {plannedAssets.map((item, index) => (
                    <article className="plan-item" key={item.id}>
                      <button
                        className="plan-item-main"
                        onClick={() => focusItem(item)}
                      >
                        <span className="plan-index">{index + 1}</span>
                        <span>
                          <strong>{item.street}</strong>
                          <small>
                            {item.district} · {item.width} × {item.height} m ·{" "}
                            {item.faces} faces
                          </small>
                        </span>
                      </button>
                      <div className="cost-grid">
                        {(["rental", "printing", "transport", "flighting"] as const).map((costType) => (
                          <label key={costType}>
                            <span>{costType}</span>
                            <input
                              type="number"
                              min="0"
                              step="1000"
                              value={costs[item.id]?.[costType] ?? ""}
                              onChange={(event) => setCosts((current) => ({
                                ...current,
                                [item.id]: {
                                  ...(current[item.id] ?? { rental: "", printing: "", transport: "", flighting: "" }),
                                  [costType]: event.target.value,
                                },
                              }))}
                              placeholder="0"
                              aria-label={`${costType} price for ${item.street}`}
                            />
                          </label>
                        ))}
                        <strong className="item-cost-total">TZS {itemTotal(item.id).toLocaleString("en-US")}</strong>
                      </div>
                      <button
                        className="remove-plan"
                        onClick={() => removeFromPlan(item.id)}
                        aria-label={`Remove ${item.street} from plan`}
                      >
                        <Trash2 size={15} /> Remove
                      </button>
                    </article>
                  ))}
                </div>

                <footer className="plan-footer">
                  <label className="plan-note">
                    <span>Planning memo / notes</span>
                    <textarea
                      value={planNote}
                      onChange={(event) => setPlanNote(event.target.value)}
                      placeholder="Add placement notes, approvals, deadlines or reminders…"
                    />
                  </label>
                  <div className="plan-total">
                    <span>Total campaign cost</span>
                    <strong>TZS {totalCost.toLocaleString("en-US")}</strong>
                  </div>
                  <div className="cost-digest">
                    {(["rental", "printing", "transport", "flighting"] as const).map((type) => (
                      <span key={type}><small>{type}</small><strong>{plannedAssets.reduce((sum, item) => sum + Number(costs[item.id]?.[type] || 0), 0).toLocaleString("en-US")}</strong></span>
                    ))}
                  </div>
                  <button
                    className="primary-button export-button"
                    onClick={exportPlan}
                    disabled={!plannedAssets.length}
                  >
                    <Download size={16} /> Export plan
                  </button>
                  <button className="save-plan-button" onClick={savePlan}>
                    <Check size={15} /> Save plan
                  </button>
                </footer>
              </aside>
            </>
          )}

          {adminOpen && (
            <>
              <button className="plan-backdrop" onClick={() => setAdminOpen(false)} aria-label="Close user management" />
              <aside className="admin-panel">
                <div className="plan-head">
                  <span className="eyebrow">Administration</span>
                  <h2>User management</h2>
                  <p>Assign creators and viewers to a project.</p>
                  <button className="close-detail" onClick={() => setAdminOpen(false)} aria-label="Close user management"><X size={17} /></button>
                </div>
                <form className="add-user-form" onSubmit={addUser} autoComplete="off">
                  <input name="name" placeholder="Full name" required autoComplete="off" />
                  <input name="email" type="email" placeholder="Email" required autoComplete="off" />
                  <input name="password" type="password" placeholder="Temporary password" minLength={8} required autoComplete="new-password" />
                  <select name="role"><option value="viewer">Viewer</option><option value="creator">Creator</option><option value="field_user">Field User</option><option value="admin">Administrator</option></select>
                  <select name="projectId" required>
                    {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                  <button className="primary-button" type="submit"><Plus size={15} /> Add user</button>
                </form>
                <div className="user-list">
                  {users.map((account) => (
                    <article key={account.id}>
                      <span className="user-avatar">{account.name.slice(0, 1).toUpperCase()}</span>
                      <span><strong>{account.name}</strong><small>{account.email} · {account.role}</small></span>
                      {account.id !== user?.id && <button onClick={() => removeUser(account.id)} aria-label={`Remove ${account.name}`}><Trash2 size={15} /></button>}
                    </article>
                  ))}
                </div>
              </aside>
            </>
          )}

          {projectOpen && (
            <>
              <button className="plan-backdrop" onClick={() => setProjectOpen(false)} aria-label="Close project form" />
              <form className="modal-card compact-modal" onSubmit={createProject}>
                <button type="button" className="close-detail" onClick={() => setProjectOpen(false)} aria-label="Close project form"><X size={17} /></button>
                <span className="eyebrow">New project</span>
                <h2>Create a project map</h2>
                <label><span>Project name</span><input name="name" placeholder="e.g. Spotlight OOH" required /></label>
                <label><span>Project type</span><input name="projectType" placeholder="e.g. Outdoor media audit" required /></label>
                <button className="primary-button" type="submit"><Plus size={15} /> Create project</button>
              </form>
            </>
          )}

          {addOpen && (
            <>
              <button className="plan-backdrop" onClick={() => setAddOpen(false)} aria-label="Close add billboard form" />
              <form className="modal-card asset-form" onSubmit={saveNewAsset}>
                <button type="button" className="close-detail" onClick={() => setAddOpen(false)} aria-label="Close add billboard form"><X size={17} /></button>
                <span className="eyebrow">Add asset</span>
                <h2>Add a new billboard</h2>
                <div className="mapping-grid">
                  <label><span>Street / name *</span><input name="street" value={assetDraft.street ?? ""} onChange={(event) => setAssetDraft((current) => ({ ...current, street: event.target.value }))} required /></label>
                  <label><span>Area / district</span><input name="district" value={assetDraft.district ?? ""} onChange={(event) => setAssetDraft((current) => ({ ...current, district: event.target.value }))} /></label>
                  <label><span>Owner / vendor</span><input name="owner" value={assetDraft.owner ?? ""} onChange={(event) => setAssetDraft((current) => ({ ...current, owner: event.target.value }))} /></label>
                  <label><span>From</span><input name="from" value={assetDraft.from ?? ""} onChange={(event) => setAssetDraft((current) => ({ ...current, from: event.target.value }))} /></label>
                  <label><span>To</span><input name="to" value={assetDraft.to ?? ""} onChange={(event) => setAssetDraft((current) => ({ ...current, to: event.target.value }))} /></label>
                  <label><span>Media type</span>
                    <select value={assetDraft.mediaType ?? "lamp-post"} onChange={(event) => setAssetDraft((current) => ({ ...current, mediaType: event.target.value as Billboard["mediaType"] }))}>
                      <option value="lamp-post">Lamp post</option>
                      <option value="large-format">Large format</option>
                      <option value="digital-screen">Digital screen</option>
                      <option value="fabricated-banner">Fabricated banner</option>
                    </select>
                  </label>
                  <label><span>Status</span>
                    <select value={assetDraft.status ?? "not-selected"} onChange={(event) => setAssetDraft((current) => ({ ...current, status: event.target.value }))}>
                      <option value="selected">Selected</option>
                      <option value="not-selected">Not selected</option>
                    </select>
                  </label>
                  <label><span>Faces</span><input type="number" min="1" value={assetDraft.faces ?? 1} onChange={(event) => setAssetDraft((current) => ({ ...current, faces: Number(event.target.value) }))} /></label>
                  <label><span>Width (m)</span><input type="number" min="0" step="0.1" value={assetDraft.width ?? 0} onChange={(event) => setAssetDraft((current) => ({ ...current, width: Number(event.target.value) }))} /></label>
                  <label><span>Height (m)</span><input type="number" min="0" step="0.1" value={assetDraft.height ?? 0} onChange={(event) => setAssetDraft((current) => ({ ...current, height: Number(event.target.value) }))} /></label>
                  {assetDraft.mediaType === "lamp-post" && (
                    <label><span>Lamp posts</span><input type="number" min="0" value={assetDraft.lampPosts ?? 1} onChange={(event) => setAssetDraft((current) => ({ ...current, lampPosts: Number(event.target.value) }))} /></label>
                  )}
                  <label className="checkbox-label"><input type="checkbox" checked={Boolean(assetDraft.occupied)} onChange={(event) => setAssetDraft((current) => ({ ...current, occupied: event.target.checked }))} /> Occupied</label>
                  <label><span>Current advert</span><input value={assetDraft.advert ?? ""} onChange={(event) => setAssetDraft((current) => ({ ...current, advert: event.target.value }))} /></label>
                  <label><span>Photo URL</span><input value={assetDraft.photoUrl ?? ""} onChange={(event) => setAssetDraft((current) => ({ ...current, photoUrl: event.target.value }))} placeholder="https://..." /></label>
                </div>
                <div className="mapping-grid">
                  <label><span>Latitude *</span><input type="number" step="any" required value={assetDraft.lat ?? ""} onChange={(event) => setAssetDraft((current) => ({ ...current, lat: Number(event.target.value) }))} /></label>
                  <label><span>Longitude *</span><input type="number" step="any" required value={assetDraft.lng ?? ""} onChange={(event) => setAssetDraft((current) => ({ ...current, lng: Number(event.target.value) }))} /></label>
                </div>
                <div className="mapping-grid">
                  <label><span>Rental price (TZS)</span><input type="number" min="0" step="1000" value={assetDraft.rentalPrice ?? ""} onChange={(event) => setAssetDraft((current) => ({ ...current, rentalPrice: Number(event.target.value) }))} /></label>
                  <label><span>Printing price (TZS)</span><input type="number" min="0" step="1000" value={assetDraft.printingPrice ?? ""} onChange={(event) => setAssetDraft((current) => ({ ...current, printingPrice: Number(event.target.value) }))} /></label>
                  <label><span>Transport price (TZS)</span><input type="number" min="0" step="1000" value={assetDraft.transportPrice ?? ""} onChange={(event) => setAssetDraft((current) => ({ ...current, transportPrice: Number(event.target.value) }))} /></label>
                  <label><span>Flighting price (TZS)</span><input type="number" min="0" step="1000" value={assetDraft.flightingPrice ?? ""} onChange={(event) => setAssetDraft((current) => ({ ...current, flightingPrice: Number(event.target.value) }))} /></label>
                </div>
                <div className="asset-form-actions">
                  <button type="button" className="text-button use-center" onClick={() => { const center = mapRef.current?.getCenter(); if (center) setAssetDraft((current) => ({ ...current, lat: center.lat, lng: center.lng })); }}>Use current map center</button>
                  <button className="primary-button" type="submit"><Plus size={15} /> Add billboard</button>
                </div>
              </form>
            </>
          )}

          {csvImport && (
            <>
              <button className="plan-backdrop" onClick={() => setCsvImport(null)} aria-label="Close field mapping" />
              <aside className="mapping-panel">
                <div className="plan-head">
                  <span className="eyebrow">CSV import</span>
                  <h2>Map your fields</h2>
                  <p>{csvImport.rows.length} rows detected. Latitude and longitude are required.</p>
                  <button className="close-detail" onClick={() => setCsvImport(null)} aria-label="Close field mapping"><X size={17} /></button>
                </div>
                <div className="mapping-grid">
                  {[
                    ["street", "Billboard / street"], ["district", "Area / region"],
                    ["from", "From"], ["to", "To"],
                    ["latitude", "Latitude *"], ["longitude", "Longitude *"],
                    ["dimensions", "Dimensions"], ["width", "Width"], ["height", "Height"], ["faces", "Faces"],
                    ["owner", "Owner / vendor"], ["mediaType", "Media type"], ["status", "Status"],
                    ["photoUrl", "Photo / image URL"],
                    ["rental", "Rental / space price"], ["printing", "Printing price"],
                    ["transport", "Transport price"], ["flighting", "Flighting price"],
                  ].map(([field, label]) => (
                    <label key={field}><span>{label}</span><select value={csvMap[field] ?? ""} onChange={(event) => setCsvMap((current) => ({ ...current, [field]: event.target.value }))}>
                      <option value="">Not mapped</option>
                      {csvImport.headers.map((header) => <option key={header}>{header}</option>)}
                    </select></label>
                  ))}
                </div>
                <button className="primary-button mapping-import" disabled={!csvMap.latitude || !csvMap.longitude} onClick={commitMappedCsv}>Import mapped billboards</button>
              </aside>
            </>
          )}

          {compareOpen && (
            <>
              <button className="plan-backdrop" onClick={() => setCompareOpen(false)} aria-label="Close plan comparison" />
              <aside className="compare-panel">
                <div className="plan-head">
                  <span className="eyebrow">Plan comparison</span>
                  <h2>Campaign cost analysis</h2>
                  <p>Compare saved plans by total and cost category.</p>
                  <button className="close-detail" onClick={() => setCompareOpen(false)} aria-label="Close plan comparison"><X size={17} /></button>
                </div>
                <div className="comparison-list">
                  {!plans.length && <div className="empty-plan"><strong>No saved plans yet</strong><p>Save two or more plans to compare their cost structure.</p></div>}
                  {plans.map((plan) => {
                    const digest = (["rental", "printing", "transport", "flighting"] as const).reduce((acc, type) => {
                      acc[type] = Object.values(plan.data.costs ?? {}).reduce((sum, cost) => sum + Number(cost[type] || 0), 0);
                      return acc;
                    }, {} as Record<string, number>);
                    const total = Object.values(digest).reduce((sum, value) => sum + value, 0);
                    return <article key={plan.id} onClick={() => loadPlan(plan)}>
                      <div><strong>{plan.name}</strong><small>{plan.data.shortlist?.length ?? 0} billboards · {plan.creator ?? "Creator"}</small></div>
                      <b>TZS {total.toLocaleString("en-US")}</b>
                      <div className="comparison-bars">{Object.entries(digest).map(([type, value]) => <span key={type}><i style={{ width: `${total ? Math.max(3, value / total * 100) : 0}%` }} /><small>{type} · {value.toLocaleString("en-US")}</small></span>)}</div>
                    </article>;
                  })}
                </div>
              </aside>
            </>
          )}
        </section>
      </div>

      {activeTab === "flighting" && canPlan && (
        <div className="workspace flighting-workspace">
          <section className="flighting-page">
            <div className="flighting-hero">
              <div>
                <span className="eyebrow">Project flighting</span>
                <h2>Schedules, stages and reminders</h2>
                <p>Manage billboard stages, flighted duration, expiry reminders, and notification contacts for the selected project.</p>
              </div>
              <div className="flighting-hero-actions">
                <button className="text-button" onClick={() => setActiveTab("planner")}>Back to map</button>
                <button className="text-button" onClick={() => exportTracker("design")}><Download size={15} /> Design tracker</button>
                <button className="text-button" onClick={() => exportTracker("cost")}><Download size={15} /> Cost tracker</button>
                <button className="text-button" onClick={() => exportTracker("comprehensive")}><Download size={15} /> Full workbook</button>
                <button className="primary-button" onClick={sendDueFlightReminders}>Send 3-day expiry reminders</button>
              </div>
            </div>

            <div className="flighting-stats">
              <Metric value={readyForFlightAssets.length} label="Ready for flighting" />
              <Metric value={flightedSchedules.length} label="Currently flighted" accent />
              <Metric value={stagedSchedules.length} label="Before flighting" />
              <Metric value={dueFlightSchedules.length} label="Due for removal" />
            </div>

            <div className="flighting-layout">
              <section className="flighting-card flighting-card--wide">
                <div className="flighting-card-head">
                  <div>
                    <span className="eyebrow">Bulk schedule</span>
                    <h3>Update ready billboard list</h3>
                  </div>
                  <small>{readyForFlightAssets.length} delivered / received billboard(s)</small>
                </div>
                <div className="flight-grid flight-grid--wide">
                  <label><span>Stage</span><select value={flightDraft.stage} onChange={(event) => setFlightDraft((current) => ({ ...current, stage: event.target.value, flightStatus: event.target.value === "flighted" ? "flighted" : event.target.value === "removed" ? "deflighted" : current.flightStatus }))}><option value="design">Design</option><option value="printing">Printing</option><option value="transport">Transport</option><option value="ready">Ready</option><option value="flighted">Flighted</option><option value="removed">Deflighted / removed</option></select></label>
                  <label><span>Status</span><select value={flightDraft.stage === "flighted" ? "flighted" : flightDraft.flightStatus} onChange={(event) => { const value = event.target.value; setFlightDraft((current) => ({ ...current, stage: value === "flighted" ? "flighted" : value === "deflighted" ? "removed" : current.stage, flightStatus: current.stage === "flighted" ? "flighted" : value })); }}><option value="unflighted" disabled={flightDraft.stage === "flighted"}>Unflighted</option><option value="flighted">Flighted</option><option value="deflighted" disabled={flightDraft.stage === "flighted"}>Deflighted</option></select></label>
                  <label><span>Days flighted</span><input type="number" min="0" value={flightDraft.durationDays} onChange={(event) => setFlightDraft((current) => ({ ...current, durationDays: event.target.value }))} /></label>
                  <label><span>Reminder days</span><input type="number" min="0" value={flightDraft.reminderDays} onChange={(event) => setFlightDraft((current) => ({ ...current, reminderDays: event.target.value }))} /></label>
                </div>
                <label className="flight-note"><span>Bulk note</span><input value={flightDraft.note} onChange={(event) => setFlightDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Optional flighting or removal note" /></label>
                <button className="primary-button" disabled={flightSaving || !readyForFlightAssets.length} onClick={() => saveFlightSchedule(readyForFlightAssets.map((item) => item.id))}>
                  {flightSaving ? "Saving..." : `Apply to ${readyForFlightAssets.length} ready billboard(s)`}
                </button>
              </section>

              <section className="flighting-card">
                <div className="flighting-card-head">
                  <div>
                    <span className="eyebrow">Contacts</span>
                    <h3>Notification recipients</h3>
                  </div>
                </div>
                <form className="contact-form" onSubmit={saveProjectContact}>
                  <label><span>Name</span><input value={contactDraft.name} onChange={(event) => setContactDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Operations team" required /></label>
                  <label><span>Emails</span><textarea value={contactDraft.emails} onChange={(event) => setContactDraft((current) => ({ ...current, emails: event.target.value }))} placeholder="one@email.com, two@email.com" /></label>
                  <label><span>WhatsApp phones</span><textarea value={contactDraft.phones} onChange={(event) => setContactDraft((current) => ({ ...current, phones: event.target.value }))} placeholder="2557..." /></label>
                  {user?.role === "admin" && <label><span>Scope</span><select value={contactDraft.projectId} onChange={(event) => setContactDraft((current) => ({ ...current, projectId: event.target.value }))}><option value="project">This project</option><option value="global">Global default</option></select></label>}
                  <button className="primary-button" type="submit">{contactDraft.id ? "Update contact" : "Save contact"}</button>
                  {contactDraft.id && <button className="text-button" type="button" onClick={() => setContactDraft({ name: "", emails: "", phones: "", projectId: "project" })}>Cancel edit</button>}
                </form>
              </section>

              <section className="flighting-card contact-directory">
                <div className="flighting-card-head">
                  <div>
                    <span className="eyebrow">Directory</span>
                    <h3>Saved contacts</h3>
                  </div>
                </div>
                <div className="contact-list">
                  {projectContacts.map((contact) => (
                    <article key={contact.id}>
                      <strong>{contact.name}</strong>
                      <small>{contact.project_id === 0 ? "Global default" : "Project contact"}</small>
                      <span>{contact.emails || "No email"}</span>
                      <span>{contact.phones || "No WhatsApp"}</span>
                      {user?.role === "admin" && <button onClick={() => editProjectContact(contact)}>Edit contact</button>}
                    </article>
                  ))}
                  {!projectContacts.length && <div className="empty-state">No contacts yet.</div>}
                </div>
              </section>
            </div>

            <section className="flighting-card billboard-flight-table-card">
              <div className="flighting-card-head">
                <div>
                  <span className="eyebrow">Billboard register</span>
                  <h3>Ready for flighting list</h3>
                </div>
                <small>{filteredFlightAssets.length} ready · Delivered must be RECEIVED</small>
              </div>
              <div className="flight-table-toolbar">
                <label className="search-box flight-search">
                  <Search size={16} />
                  <input value={flightSearch} onChange={(event) => setFlightSearch(event.target.value)} placeholder="Search billboard, route, vendor or stage" />
                </label>
                <select className="flight-status-select" value={flightStatusFilter} onChange={(event) => setFlightStatusFilter(event.target.value)}>
                  <option value="all">All statuses</option>
                  <option value="flighted">Flighted</option>
                  <option value="unflighted">Unflighted</option>
                  <option value="deflighted">Deflighted</option>
                  <option value="due">Due for removal</option>
                  <option value="design">Design stage</option>
                  <option value="printing">Printing stage</option>
                  <option value="transport">Transport stage</option>
                  <option value="ready">Ready stage</option>
                  <option value="removed">Deflighted / removed stage</option>
                </select>
              </div>
              <div className="billboard-flight-table">
                <div className="billboard-flight-row billboard-flight-row--head">
                  <span>Billboard</span><span>Type</span><span>Location</span><span>Stage</span><span>Status</span><span>End date</span><span>Remaining</span><span>Action</span>
                </div>
                <div className="billboard-flight-row billboard-flight-row--filters">
                  <span><input value={flightColumnFilters.billboard} onChange={(event) => setFlightColumnFilters((current) => ({ ...current, billboard: event.target.value }))} placeholder="Filter billboard" /></span>
                  <span><input value={flightColumnFilters.type} onChange={(event) => setFlightColumnFilters((current) => ({ ...current, type: event.target.value }))} placeholder="Type" /></span>
                  <span><input value={flightColumnFilters.location} onChange={(event) => setFlightColumnFilters((current) => ({ ...current, location: event.target.value }))} placeholder="Location" /></span>
                  <span><input value={flightColumnFilters.stage} onChange={(event) => setFlightColumnFilters((current) => ({ ...current, stage: event.target.value }))} placeholder="Stage" /></span>
                  <span><input value={flightColumnFilters.status} onChange={(event) => setFlightColumnFilters((current) => ({ ...current, status: event.target.value }))} placeholder="Status" /></span>
                  <span><input value={flightColumnFilters.endDate} onChange={(event) => setFlightColumnFilters((current) => ({ ...current, endDate: event.target.value }))} placeholder="End date" /></span>
                  <span><small>Auto</small></span>
                  <button onClick={() => setFlightColumnFilters({ billboard: "", type: "", location: "", stage: "", status: "", endDate: "" })}>Clear</button>
                </div>
                {filteredFlightAssets.map((asset) => {
                  const schedule = flightByAssetId.get(asset.id);
                  return (
                    <div className="billboard-flight-row" key={asset.id} role="button" tabIndex={0} onClick={() => openFlightAsset(asset)} onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") openFlightAsset(asset);
                    }}>
                      <span><strong>{asset.street}</strong><small>{asset.district}</small></span>
                      <span>{mediaTypeLabel(asset.mediaType)}</span>
                      <span><small>{asset.lat.toFixed(5)}, {asset.lng.toFixed(5)}</small></span>
                      <span>{schedule?.stage ?? "Not started"}</span>
                      <span className={schedule?.flight_status === "flighted" ? "flight-pill flight-pill--on" : "flight-pill"}>{schedule?.flight_status ?? "unflighted"}</span>
                      <span>{shortDate(schedule?.end_at)}</span>
                      <span>{remainingDays(schedule?.end_at)}</span>
                      <button onClick={(event) => { event.stopPropagation(); openFlightAsset(asset); }}>Manage</button>
                    </div>
                  );
                })}
                {!filteredFlightAssets.length && <div className="empty-state">No billboard is ready for flighting. Set Delivered to RECEIVED in Execution & Cost Tracker first.</div>}
              </div>
            </section>

            <section className="flighting-card tracker-table-card">
              <div className="flighting-card-head">
                <div>
                  <span className="eyebrow">Execution and cost tracker</span>
                  <h3>Project tracker working table</h3>
                </div>
                <small>{filteredFlightAssets.length} visible row(s)</small>
              </div>
              <div className="tracker-table">
                <div className="tracker-row tracker-row--head">
                  <span>Billboard</span>
                  <span>Vendor</span>
                  <span>Artwork delivery</span>
                  <span>Approval</span>
                  <span>To vendor</span>
                  <span>Printing</span>
                  <span>Delivered</span>
                  <span>Rental</span>
                  <span>Printing cost</span>
                  <span>Flighting cost</span>
                  <span>Transport</span>
                  <span>Total</span>
                </div>
                {filteredFlightAssets.map((asset) => {
                  const total =
                    Number(asset.rentalPrice || 0) +
                    Number(asset.printingPrice || 0) +
                    Number(asset.flightingPrice || 0) +
                    Number(asset.transportPrice || 0);
                  return (
                    <div className="tracker-row" key={`tracker-${asset.id}`}>
                      <span><strong>{asset.street}</strong><small>{asset.district} · {mediaTypeLabel(asset.mediaType)}</small></span>
                      <span>{asset.vendor || asset.owner || "UNKNOWN"}</span>
                      <select value={trackerValue(asset, "artworkDelivery", "PENDING")} onChange={(event) => saveTrackerField(asset, "artworkDelivery", event.target.value)}>{EXECUTION_STATUS_OPTIONS.artworkDelivery.map((option) => <option key={option} value={option}>{option}</option>)}</select>
                      <select value={trackerValue(asset, "artworkApproval", "PENDING")} onChange={(event) => saveTrackerField(asset, "artworkApproval", event.target.value)}>{EXECUTION_STATUS_OPTIONS.artworkApproval.map((option) => <option key={option} value={option}>{option}</option>)}</select>
                      <select value={trackerValue(asset, "artworkToVendor", "PENDING")} onChange={(event) => saveTrackerField(asset, "artworkToVendor", event.target.value)}>{EXECUTION_STATUS_OPTIONS.artworkToVendor.map((option) => <option key={option} value={option}>{option}</option>)}</select>
                      <select value={trackerValue(asset, "printingStatus", "NOT STARTED")} onChange={(event) => saveTrackerField(asset, "printingStatus", event.target.value)}>{EXECUTION_STATUS_OPTIONS.printingStatus.map((option) => <option key={option} value={option}>{option}</option>)}</select>
                      <select value={trackerValue(asset, "deliveredToDestination", "PENDING")} onChange={(event) => saveTrackerField(asset, "deliveredToDestination", event.target.value)}>{EXECUTION_STATUS_OPTIONS.deliveredToDestination.map((option) => <option key={option} value={option}>{option}</option>)}</select>
                      <span>{Number(asset.rentalPrice || 0).toLocaleString("en-US")}</span>
                      <span>{Number(asset.printingPrice || 0).toLocaleString("en-US")}</span>
                      <span>{Number(asset.flightingPrice || 0).toLocaleString("en-US")}</span>
                      <span>{Number(asset.transportPrice || 0).toLocaleString("en-US")}</span>
                      <strong>{total.toLocaleString("en-US")}</strong>
                    </div>
                  );
                })}
                {!filteredFlightAssets.length && <div className="empty-state">No tracker rows match the current filters.</div>}
              </div>
              {trackerSavingId && <small className="tracker-saving">Saving tracker update…</small>}
            </section>
          </section>
        </div>
      )}

      {activeTab === "tracker" && canPlan && (
        <div className="workspace flighting-workspace tracker-workspace">
          <section className="flighting-page tracker-page">
            <div className="flighting-hero tracker-hero">
              <div>
                <span className="eyebrow">Project execution</span>
                <h2>Execution and cost tracker</h2>
                <p>Track artwork, printing, delivery, expiry dates, remaining days, and project costs in one clean working table.</p>
              </div>
              <div className="flighting-hero-actions">
                <button className="text-button" onClick={() => setActiveTab("flighting")}>Flighting schedule</button>
                <button className="text-button" onClick={() => exportTracker("design")}><Download size={15} /> Design tracker</button>
                <button className="text-button" onClick={() => exportTracker("cost")}><Download size={15} /> Cost tracker</button>
                <button className="primary-button" onClick={() => exportTracker("comprehensive")}><Download size={15} /> Full workbook</button>
              </div>
            </div>

            <div className="flighting-stats">
              <Metric value={trackerSummary.totalRows} label="Filtered rows" />
              <Metric value={trackerSummary.flighted} label="Flighted" accent />
              <Metric value={trackerSummary.due} label="Due / expired" />
              <Metric value={`TZS ${trackerSummary.totalCost.toLocaleString("en-US")}`} label="Filtered cost" />
            </div>

            <section className="flighting-card tracker-filter-card">
              <div className="flighting-card-head">
                <div>
                  <span className="eyebrow">Filters</span>
                  <h3>Narrow the tracker table</h3>
                </div>
                <button className="text-button" onClick={() => setTrackerFilters({
                  search: "",
                  type: "All",
                  vendor: "All",
                  artworkDelivery: "All",
                  artworkApproval: "All",
                  artworkToVendor: "All",
                  printingStatus: "All",
                  deliveredToDestination: "All",
                  flightStatus: "All",
                  rentalMin: "",
                  rentalMax: "",
                  totalMin: "",
                  totalMax: "",
                  remainingMin: "",
                  remainingMax: "",
                })}>Clear filters</button>
              </div>
              <div className="tracker-filter-grid">
                <label className="search-box tracker-search"><Search size={16} /><input value={trackerFilters.search} onChange={(event) => setTrackerFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search billboard, location, vendor" /></label>
                <label><span>Board type</span><select value={trackerFilters.type} onChange={(event) => setTrackerFilters((current) => ({ ...current, type: event.target.value }))}><option>All</option>{trackerFilterOptions.types.map((option) => <option key={option}>{option}</option>)}</select></label>
                <label><span>Vendor</span><select value={trackerFilters.vendor} onChange={(event) => setTrackerFilters((current) => ({ ...current, vendor: event.target.value }))}><option>All</option>{trackerFilterOptions.vendors.map((option) => <option key={option}>{option}</option>)}</select></label>
                <label><span>Artwork delivery</span><select value={trackerFilters.artworkDelivery} onChange={(event) => setTrackerFilters((current) => ({ ...current, artworkDelivery: event.target.value }))}><option>All</option>{EXECUTION_STATUS_OPTIONS.artworkDelivery.map((option) => <option key={option}>{option}</option>)}</select></label>
                <label><span>Approval</span><select value={trackerFilters.artworkApproval} onChange={(event) => setTrackerFilters((current) => ({ ...current, artworkApproval: event.target.value }))}><option>All</option>{EXECUTION_STATUS_OPTIONS.artworkApproval.map((option) => <option key={option}>{option}</option>)}</select></label>
                <label><span>To vendor</span><select value={trackerFilters.artworkToVendor} onChange={(event) => setTrackerFilters((current) => ({ ...current, artworkToVendor: event.target.value }))}><option>All</option>{EXECUTION_STATUS_OPTIONS.artworkToVendor.map((option) => <option key={option}>{option}</option>)}</select></label>
                <label><span>Printing</span><select value={trackerFilters.printingStatus} onChange={(event) => setTrackerFilters((current) => ({ ...current, printingStatus: event.target.value }))}><option>All</option>{EXECUTION_STATUS_OPTIONS.printingStatus.map((option) => <option key={option}>{option}</option>)}</select></label>
                <label><span>Delivered</span><select value={trackerFilters.deliveredToDestination} onChange={(event) => setTrackerFilters((current) => ({ ...current, deliveredToDestination: event.target.value }))}><option>All</option>{EXECUTION_STATUS_OPTIONS.deliveredToDestination.map((option) => <option key={option}>{option}</option>)}</select></label>
                <label><span>Flight status</span><select value={trackerFilters.flightStatus} onChange={(event) => setTrackerFilters((current) => ({ ...current, flightStatus: event.target.value }))}><option>All</option><option>flighted</option><option>unflighted</option><option>deflighted</option></select></label>
                <label><span>Rental range</span><div className="range-filter"><input type="number" value={trackerFilters.rentalMin} onChange={(event) => setTrackerFilters((current) => ({ ...current, rentalMin: event.target.value }))} placeholder="Min" /><input type="number" value={trackerFilters.rentalMax} onChange={(event) => setTrackerFilters((current) => ({ ...current, rentalMax: event.target.value }))} placeholder="Max" /></div></label>
                <label><span>Total range</span><div className="range-filter"><input type="number" value={trackerFilters.totalMin} onChange={(event) => setTrackerFilters((current) => ({ ...current, totalMin: event.target.value }))} placeholder="Min" /><input type="number" value={trackerFilters.totalMax} onChange={(event) => setTrackerFilters((current) => ({ ...current, totalMax: event.target.value }))} placeholder="Max" /></div></label>
                <label><span>Remaining days range</span><div className="range-filter"><input type="number" value={trackerFilters.remainingMin} onChange={(event) => setTrackerFilters((current) => ({ ...current, remainingMin: event.target.value }))} placeholder="Min" /><input type="number" value={trackerFilters.remainingMax} onChange={(event) => setTrackerFilters((current) => ({ ...current, remainingMax: event.target.value }))} placeholder="Max" /></div></label>
              </div>
            </section>

            <section className="flighting-card tracker-table-card">
              <div className="flighting-card-head">
                <div>
                  <span className="eyebrow">Working table</span>
                  <h3>{filteredTrackerRows.length} billboard task row(s)</h3>
                </div>
                {trackerSavingId && <small className="tracker-saving">Saving tracker update…</small>}
              </div>
              <div className="tracker-table">
                <div className="tracker-row tracker-row--head">
                  <span>Billboard</span><span>Vendor</span><span>Artwork delivery</span><span>Approval</span><span>To vendor</span><span>Printing</span><span>Delivered</span><span>Flight status</span><span>Expiry date</span><span>Remaining days</span><span>Rental</span><span>Printing cost</span><span>Flighting cost</span><span>Transport</span><span>Total</span><span>Action</span>
                </div>
                {filteredTrackerRows.map(({ asset, schedule, total, vendor }) => (
                  <div className="tracker-row" key={`tracker-${asset.id}`}>
                    <span><strong>{asset.street}</strong><small>{asset.district} · {mediaTypeLabel(asset.mediaType)}</small></span>
                    <span>{vendor}</span>
                    <select value={trackerValue(asset, "artworkDelivery", "PENDING")} onChange={(event) => saveTrackerField(asset, "artworkDelivery", event.target.value)}>{EXECUTION_STATUS_OPTIONS.artworkDelivery.map((option) => <option key={option} value={option}>{option}</option>)}</select>
                    <select value={trackerValue(asset, "artworkApproval", "PENDING")} onChange={(event) => saveTrackerField(asset, "artworkApproval", event.target.value)}>{EXECUTION_STATUS_OPTIONS.artworkApproval.map((option) => <option key={option} value={option}>{option}</option>)}</select>
                    <select value={trackerValue(asset, "artworkToVendor", "PENDING")} onChange={(event) => saveTrackerField(asset, "artworkToVendor", event.target.value)}>{EXECUTION_STATUS_OPTIONS.artworkToVendor.map((option) => <option key={option} value={option}>{option}</option>)}</select>
                    <select value={trackerValue(asset, "printingStatus", "NOT STARTED")} onChange={(event) => saveTrackerField(asset, "printingStatus", event.target.value)}>{EXECUTION_STATUS_OPTIONS.printingStatus.map((option) => <option key={option} value={option}>{option}</option>)}</select>
                    <select value={trackerValue(asset, "deliveredToDestination", "PENDING")} onChange={(event) => saveTrackerField(asset, "deliveredToDestination", event.target.value)}>{EXECUTION_STATUS_OPTIONS.deliveredToDestination.map((option) => <option key={option} value={option}>{option}</option>)}</select>
                    <span className={schedule?.flight_status === "flighted" ? "flight-pill flight-pill--on" : "flight-pill"}>{schedule?.flight_status ?? "unflighted"}</span>
                    <span>{shortDate(schedule?.end_at)}</span>
                    <strong>{remainingDays(schedule?.end_at)}</strong>
                    <span>{Number(asset.rentalPrice || 0).toLocaleString("en-US")}</span>
                    <span>{Number(asset.printingPrice || 0).toLocaleString("en-US")}</span>
                    <span>{Number(asset.flightingPrice || 0).toLocaleString("en-US")}</span>
                    <span>{Number(asset.transportPrice || 0).toLocaleString("en-US")}</span>
                    <strong>{total.toLocaleString("en-US")}</strong>
                    <button onClick={() => openFlightAsset(asset)}>Update flight</button>
                  </div>
                ))}
                {!filteredTrackerRows.length && <div className="empty-state">No tracker rows match the current filters.</div>}
              </div>
            </section>
          </section>
        </div>
      )}

      {flightAssetPopup && (
        <>
          <button className="plan-backdrop" onClick={() => setFlightAssetPopup(null)} aria-label="Close billboard flighting popup" />
          <aside className="modal-card flight-asset-modal" aria-label="Selected billboard flighting">
            <button className="close-detail" onClick={() => setFlightAssetPopup(null)} aria-label="Close billboard flighting popup"><X size={17} /></button>
            <span className="eyebrow">Selected billboard</span>
            <h2>{flightAssetPopup.street}</h2>
            <p className="muted-line">{mediaTypeLabel(flightAssetPopup.mediaType)} · {flightAssetPopup.faces} face(s)</p>

            <div className="flight-location-card">
              <MapPin size={18} />
              <div>
                <strong>{flightAssetPopup.district}</strong>
                <span>{flightAssetPopup.from || "From not set"} → {flightAssetPopup.to || "To not set"}</span>
                <small>Latitude {flightAssetPopup.lat.toFixed(6)} · Longitude {flightAssetPopup.lng.toFixed(6)}</small>
              </div>
            </div>

            <iframe className="flight-mini-map" title={`${flightAssetPopup.street} location map`} src={miniMapUrl(flightAssetPopup)} loading="lazy" />

            <div className="flight-current">
              <span>Current status</span>
              <strong>{flightByAssetId.get(flightAssetPopup.id)?.flight_status ?? "unflighted"}</strong>
              <small>Expiry: {shortDate(flightByAssetId.get(flightAssetPopup.id)?.end_at)}</small>
            </div>

            <div className="flight-grid">
              <label><span>Stage</span><select value={flightDraft.stage} onChange={(event) => setFlightDraft((current) => ({ ...current, stage: event.target.value, flightStatus: event.target.value === "flighted" ? "flighted" : event.target.value === "removed" ? "deflighted" : current.flightStatus }))}><option value="design">Design</option><option value="printing">Printing</option><option value="transport">Transport</option><option value="ready">Ready</option><option value="flighted">Flighted</option><option value="removed">Deflighted / removed</option></select></label>
              <label><span>Status</span><select value={flightDraft.stage === "flighted" ? "flighted" : flightDraft.flightStatus} onChange={(event) => { const value = event.target.value; setFlightDraft((current) => ({ ...current, stage: value === "flighted" ? "flighted" : value === "deflighted" ? "removed" : current.stage, flightStatus: current.stage === "flighted" ? "flighted" : value })); }}><option value="unflighted" disabled={flightDraft.stage === "flighted"}>Unflighted</option><option value="flighted">Flighted</option><option value="deflighted" disabled={flightDraft.stage === "flighted"}>Deflighted</option></select></label>
              <label><span>Days flighted</span><input type="number" min="0" value={flightDraft.durationDays} onChange={(event) => setFlightDraft((current) => ({ ...current, durationDays: event.target.value }))} /></label>
              <label><span>Reminder days</span><input type="number" min="0" value={flightDraft.reminderDays} onChange={(event) => setFlightDraft((current) => ({ ...current, reminderDays: event.target.value }))} /></label>
            </div>
            <label className="flight-note"><span>Memo / removal note</span><input value={flightDraft.note} onChange={(event) => setFlightDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Example: remove creative after campaign end" /></label>
            <div className="flight-modal-actions">
              <button className="text-button" onClick={() => showFlightAssetOnMap(flightAssetPopup)}><MapPin size={15} /> Show on main map</button>
              <button className="primary-button" disabled={flightSaving} onClick={() => saveFlightSchedule([flightAssetPopup.id])}>
                {flightSaving ? "Saving..." : "Save flight status"}
              </button>
            </div>
          </aside>
        </>
      )}

      {activeTab === "library" && (
        <div className="workspace image-library-workspace">
          <section className="library-panel">
            <div className="library-head">
              <div>
                <span className="eyebrow">Image library</span>
                <h2>{imageLibraryGroups.length} areas · {imageLibraryItems.length} linked images</h2>
                <p>Browse billboard image links grouped by area, then preview or jump back to the map.</p>
              </div>
              <button className="text-button" onClick={() => setActiveTab("planner")}>Back to map</button>
            </div>
            {!imageLibraryItems.length && (
              <div className="empty-state library-empty">
                No image links yet.
                <small>Add Photo URL values during CSV import, manual billboard entry, or field collection.</small>
              </div>
            )}
            <div className="image-library-groups">
              {imageLibraryGroups.map((group) => (
                <section className="image-library-area" key={group.area}>
                  <div className="image-library-area-head">
                    <div>
                      <span className="eyebrow">Area</span>
                      <h3>{group.area}</h3>
                    </div>
                    <strong>{group.items.length} image{group.items.length === 1 ? "" : "s"}</strong>
                  </div>
                  <div className="image-library-grid">
                    {group.items.map((item) => (
                      <article className="image-library-card" key={item.id}>
                        <button className="image-library-thumb" onClick={() => { setViewingPhoto(item.image); setPhotoViewerOpen(true); }}>
                          <img src={item.image} alt={item.title} loading="lazy" onError={markImageFailed} />
                          <em>Image unavailable</em>
                          <span><Eye size={14} /> Preview</span>
                        </button>
                        <div className="image-library-copy">
                          <span>{item.source}</span>
                          <strong>{item.title}</strong>
                          <small>{item.subtitle}</small>
                        </div>
                        <div className="image-library-actions">
                          <button onClick={() => { setActiveTab("planner"); window.setTimeout(() => {
                            if (item.assetId) {
                              const asset = billboards.find((assetItem) => assetItem.id === item.assetId);
                              if (asset) focusItem(asset);
                            } else if (Number.isFinite(item.lat) && Number.isFinite(item.lng)) {
                              mapRef.current?.flyTo([item.lat, item.lng], 17, { duration: 0.7 });
                            }
                          }, 120); }}>Map</button>
                          <a href={item.originalImage || item.image} target="_blank" rel="noreferrer">Open URL</a>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>
        </div>
      )}

      {activeTab === "dashboard" && (
        <div className="workspace dashboard-workspace dashboard-workspace--summary">
          <section className="dashboard-page">
            <div className="dashboard-hero">
              <div>
                <span className="eyebrow">Project dashboard</span>
                <h2>{currentProject?.name ?? "Selected project"}</h2>
                <p>Operational view for inventory, flighting, validation issues, field reports, and notifications.</p>
              </div>
              <button className="text-button" onClick={() => setActiveTab("planner")}><MapPin size={15} /> Open planning map</button>
            </div>

            <div className="dashboard-kpis">
              <Metric value={billboards.length} label="Mapped assets" />
              <Metric value={totalFaces} label="Total faces" accent />
              <Metric value={flightScheduleStats.flighted} label="Flighted" />
              <Metric value={dashboardIssueCount} label="Validation issues" />
              <Metric value={notificationSummary.sent} label="Notifications sent" accent />
            </div>

            <div className="dashboard-grid">
              <section className="dashboard-card">
                <div className="dashboard-card-head">
                  <div>
                    <span className="eyebrow">Inventory mix</span>
                    <h3>Faces by board type</h3>
                  </div>
                  <span className="dashboard-pill">{totalFaces} total faces</span>
                </div>
                <div className="dashboard-bars">
                  {mediaBreakdown.map((row) => {
                    const percent = totalFaces ? Math.max(4, Math.round((row.value / totalFaces) * 100)) : 0;
                    return (
                      <div className="dashboard-bar-row" key={row.label}>
                        <span>{row.label}</span>
                        <strong>{row.value}</strong>
                        <i style={{ width: `${percent}%` }} />
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="dashboard-card">
                <div className="dashboard-card-head">
                  <div>
                    <span className="eyebrow">Flighting</span>
                    <h3>Status control</h3>
                  </div>
                  <button className="text-button" onClick={() => setActiveTab("flighting")}>Manage</button>
                </div>
                <div className="dashboard-mini-grid">
                  <div><b>{flightScheduleStats.flighted}</b><span>Flighted</span></div>
                  <div><b>{flightScheduleStats.expired}</b><span>Expired</span></div>
                  <div><b>{flightScheduleStats.expiringSoon}</b><span>Expiring soon</span></div>
                  <div><b>{flightScheduleStats.deflighted}</b><span>Deflighted</span></div>
                  <div><b>{flightScheduleStats.unflighted}</b><span>Unflighted</span></div>
                </div>
              </section>

              <section className="dashboard-card dashboard-card--wide">
                <div className="dashboard-card-head">
                  <div>
                    <span className="eyebrow">Field validation</span>
                    <h3>Issues reported by field users</h3>
                  </div>
                  <span className="dashboard-pill">{validationAssignments.length} assignments</span>
                </div>
                <div className="issue-summary-grid">
                  <div><b>{validationOk.length}</b><span>Confirmed okay</span></div>
                  <div><b>{validationPending.length}</b><span>Pending / in progress</span></div>
                  <div><b>{validationIssues.length}</b><span>Billboard issues</span></div>
                  <div><b>{rejectedCollections.length}</b><span>Rejected collections</span></div>
                </div>
                <div className="issue-type-list">
                  {Object.entries(issueTypeCounts).map(([label, value]) => (
                    <span key={label}><b>{value}</b>{label}</span>
                  ))}
                  {!Object.keys(issueTypeCounts).length && <small>No structured validation issues reported yet.</small>}
                </div>
              </section>

              <section className="dashboard-card">
                <div className="dashboard-card-head">
                  <div>
                    <span className="eyebrow">Notifications</span>
                    <h3>Email and SMS audit</h3>
                  </div>
                  <span className="dashboard-pill">{notificationSummary.records} batches</span>
                </div>
                <div className="dashboard-mini-grid">
                  <div><b>{notificationSummary.sent}</b><span>Sent</span></div>
                  <div><b>{notificationSummary.failed}</b><span>Failed</span></div>
                  <div><b>{notificationSummary.skipped}</b><span>Skipped</span></div>
                  <div><b>{notificationSummary.recipientEmails}</b><span>Recipients</span></div>
                </div>
              </section>

              <section className="dashboard-card dashboard-card--wide">
                <div className="dashboard-card-head">
                  <div>
                    <span className="eyebrow">Recent field reports</span>
                    <h3>Collected and validation records</h3>
                  </div>
                  <button className="text-button" onClick={() => setActiveTab("field")}>Open field work</button>
                </div>
                <div className="dashboard-report-list">
                  {recentValidationIssues.map((assignment) => (
                    <button key={`validation-${assignment.id}`} onClick={() => {
                      if (!assignment.asset) return;
                      setActiveTab("planner");
                      window.setTimeout(() => focusItem(assignment.asset!), 120);
                    }}>
                      <span className="status status--occupied">Issue</span>
                      <strong>{assignment.asset ? (assignment.asset.street || `${assignment.asset.from} → ${assignment.asset.to}`) : `Assignment #${assignment.id}`}</strong>
                      <small>{String(assignment.report?.issueType || "Issue reported")} · {String(assignment.report?.issueDetail || "No detail")} · {assignment.assignee_name ?? "Field user"}</small>
                    </button>
                  ))}
                  {recentFieldReports.map((collection) => (
                    <button key={`collection-${collection.id}`} onClick={() => {
                      setSelectedCollection(collection);
                      fetch(`/api/app?action=collection-photos&collectionId=${collection.id}`).then((r) => r.json()).then((d) => setCollectionPhotos(d.photos ?? []));
                    }}>
                      <span className={`status ${collection.status === "validated" ? "" : "status--occupied"}`}>{collection.status}</span>
                      <strong>{collection.data?.specificLocation || collection.data?.street || collection.data?.district || `Collection #${collection.id}`}</strong>
                      <small>{collection.collector} ? {new Date(collection.created_at).toLocaleDateString()}</small>
                    </button>
                  ))}
                  {!recentValidationIssues.length && !recentFieldReports.length && <div className="empty-state">No field reports yet.</div>}
                </div>
              </section>
            </div>

            {selectedCollection && (
              <aside className="dashboard-inspector">
                <button className="close-detail" onClick={() => setSelectedCollection(null)}><X size={17} /></button>
                <span className="eyebrow">{selectedCollection.status} ? {selectedCollection.collector}</span>
                <h3>{selectedCollection.data?.specificLocation || selectedCollection.data?.street || selectedCollection.data?.district || `Collection #${selectedCollection.id}`}</h3>
                <div className="detail-stats">
                  <div><span>Latitude</span><strong>{selectedCollection.latitude?.toFixed(6)}</strong></div>
                  <div><span>Longitude</span><strong>{selectedCollection.longitude?.toFixed(6)}</strong></div>
                  <div><span>Accuracy</span><strong>{selectedCollection.accuracy?.toFixed(1)}m</strong></div>
                </div>
                {selectedCollection.data && (
                  <dl className="attributes">
                    {Object.entries(selectedCollection.data).filter(([k]) => !["lat","lng","projectId"].includes(k)).map(([key, value]) => (
                      <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>
                    ))}
                  </dl>
                )}
                <div className="photo-grid">
                  {collectionPhotos.map((p) => (
                    <button key={p.id} className="photo-thumb" onClick={() => loadPhoto(p.id)}>
                      <Eye size={14} /> <span>{p.photo_type}</span>
                    </button>
                  ))}
                  {!collectionPhotos.length && <small>No photos attached</small>}
                </div>
                {canManage && selectedCollection.status === "pending" && (
                  <div className="validation-actions">
                    <button className="primary-button" onClick={() => validateCollection(selectedCollection.id, "validated")}><Check size={15} /> Validate</button>
                    <button className="text-button" onClick={() => validateCollection(selectedCollection.id, "rejected")}>Reject</button>
                  </div>
                )}
              </aside>
            )}
          </section>
        </div>
      )}

      {activeTab === "field" && canManage && (
        <div className="workspace field-workspace field-workspace--command">
          <div className="field-command-page">
            <section className="field-command-hero">
              <div>
                <span className="eyebrow">Field Management</span>
                <h2>{currentProject?.name ?? "Selected project"}</h2>
                <p>Manage collection missions, field users, groups, and admin boundaries for this project.</p>
              </div>
              <div className="field-command-actions">
                <button className="primary-button" onClick={() => { setEditingMission(null); setMissionFormOpen(true); }}><Plus size={15} /> New mission</button>
                <button className="text-button" onClick={() => { setEditingGroup(null); setGroupFormOpen(true); }}><Plus size={15} /> New group</button>
              </div>
            </section>

            <section className="field-kpis">
              <Metric value={missions.length} label="Total missions" />
              <Metric value={activeMissions.length} label="Active missions" accent />
              <Metric value={fieldUsers.length} label="Field users" />
              <Metric value={userGroups.length} label="Groups" />
              <Metric value={boundaries.length} label="Boundaries" />
            </section>

            <section className="field-management-grid">
              <section className="field-panel field-panel--wide">
                <div className="field-panel-head field-panel-head--table">
                  <div>
                    <span className="eyebrow">Missions</span>
                    <h3>{missions.length} missions - {inactiveMissions.length} inactive</h3>
                    <small>{missionAssignedUserCount} direct user assignments - {missionAssignedGroupCount} group assignments</small>
                  </div>
                  <button className="primary-button" onClick={() => { setEditingMission(null); setMissionFormOpen(true); }}><Plus size={15} /> Add mission</button>
                </div>
                <div className="mission-table">
                  <div className="mission-table-head">
                    <span>Mission</span><span>Assignment</span><span>Rules</span><span>Status</span><span>Actions</span>
                  </div>
                  {missions.map((m) => {
                    const assignedUsers = parseJsonArray(m.assigned_users);
                    const assignedGroups = parseJsonArray(m.assigned_groups);
                    const config = parseJsonObject(m.config);
                    const boundary = boundaries.find((item) => Number(item.id) === Number(m.boundary_id));
                    const assignedUserNames = assignedUsers.map((id) => users.find((account) => Number(account.id) === Number(id))?.name || `User ${id}`);
                    const assignedGroupNames = assignedGroups.map((id) => userGroups.find((group) => Number(group.id) === Number(id))?.name || `Group ${id}`);
                    return (
                      <article key={m.id} className="mission-row">
                        <div className="mission-main">
                          <strong>{m.name}</strong>
                          <small>{m.description || "No description"}</small>
                          <em>{boundary ? `Boundary: ${boundary.name}` : "No boundary attached"}</em>
                        </div>
                        <div className="mission-tags">
                          <span>{assignedUsers.length} users</span>
                          <span>{assignedGroups.length} groups</span>
                          {(assignedUserNames.length || assignedGroupNames.length) ? <small>{[...assignedUserNames, ...assignedGroupNames].slice(0, 4).join(", ")}{assignedUserNames.length + assignedGroupNames.length > 4 ? "..." : ""}</small> : <small>No one assigned</small>}
                        </div>
                        <div className="mission-tags">
                          <span>{config.photoRequired ? "Photo required" : "Photo optional"}</span>
                          <span>{Number(config.minPhotos) || 0} min photos</span>
                          {config.lamppostCapture && <span>Lamppost capture</span>}
                        </div>
                        <div><span className={`status ${m.status === "active" ? "" : "status--occupied"}`}>{m.status}</span></div>
                        <div className="mission-actions">
                          <button onClick={() => { setEditingMission(m); setMissionFormOpen(true); }}>Edit</button>
                          <button className="danger-link" onClick={() => deleteMission(m)}><Trash2 size={13} /> Delete</button>
                        </div>
                      </article>
                    );
                  })}
                  {!missions.length && <div className="empty-state">No missions created yet.<br />Create a mission and assign field users or groups to start collection work.</div>}
                </div>
              </section>

              <section className="field-panel">
                <div className="field-panel-head field-panel-head--table">
                  <div><span className="eyebrow">Field Team &amp; Groups</span><h3>{fieldUsers.length} field users - {userGroups.length} groups</h3><small>Group field users to assign missions faster.</small></div>
                  <button className="text-button" onClick={() => { setEditingGroup(null); setGroupFormOpen(true); }}><Plus size={15} /> New group</button>
                </div>
                <div className="field-list field-list--open">
                  <div className="field-section-label">Groups</div>
                  {userGroups.map((g) => (
                    <article key={g.id} className="field-card field-card--interactive">
                      <div className="field-card-head"><strong>{g.name}</strong><span>{g.members?.length ?? 0} members</span></div>
                      <small>{g.description || "No description"}</small>
                      {g.members?.length > 0 && <div className="field-card-members">{g.members.map((m: any) => <span key={m.id}>{m.name}</span>)}</div>}
                      <div className="field-card-actions">
                        <button onClick={() => { setEditingGroup(g); setGroupFormOpen(true); }}>Manage members</button>
                        {user?.role === "admin" && <button className="danger-link" onClick={() => deleteGroup(g.id)}><Trash2 size={13} /> Delete</button>}
                      </div>
                    </article>
                  ))}
                  {!userGroups.length && <div className="empty-state">No groups yet.</div>}
                  <div className="field-section-label">Field Users</div>
                  {fieldUsers.map((u) => (
                    <article key={u.id} className="field-card field-card--interactive">
                      <div className="field-card-head"><strong>{u.name}</strong><span>{u.role}</span></div>
                      <small>{u.email}</small>
                      {user?.role === "admin" && <button className="danger-link remove-field-user" onClick={() => removeUser(u.id)}><Trash2 size={13} /> Remove field user</button>}
                    </article>
                  ))}
                  {!fieldUsers.length && <div className="empty-state">No field users available.</div>}
                </div>
              </section>

              <section className="field-panel">
                <div className="field-panel-head field-panel-head--table">
                  <div>
                    <span className="eyebrow">Admin Boundaries</span>
                    <h3>{boundaries.length} uploaded</h3>
                    <small>Use boundaries to guide missions by Region, District, Ward, Shehia, Street, Village, or Mtaa.</small>
                  </div>
                  <label className="text-button import-button">
                    <FileUp size={15} /> Upload GeoJSON
                    <input type="file" accept=".geojson,.json" hidden onChange={(event) => event.target.files?.[0] && uploadBoundary(event.target.files[0])} />
                  </label>
                </div>
                <div className="field-list field-list--open">
                  {boundaries.map((b) => (
                    <article key={b.id} className="field-card field-card--interactive">
                      <strong>{b.name}</strong>
                      <small>{b.boundary_type} - Levels: {b.levels?.join(" -> ") || "auto-detected"}</small>
                    </article>
                  ))}
                  {!boundaries.length && <div className="empty-state">No boundaries uploaded yet.<br />Upload a GeoJSON file with administrative attributes.</div>}
                </div>
              </section>
            </section>
          </div>

          {missionFormOpen && (
            <>
              <button className="plan-backdrop" onClick={() => { setMissionFormOpen(false); setEditingMission(null); }} />
              <form className="modal-card asset-form" onSubmit={saveMission}>
                <button type="button" className="close-detail" onClick={() => { setMissionFormOpen(false); setEditingMission(null); }}><X size={17} /></button>
                <span className="eyebrow">{editingMission ? "Edit mission" : "Create mission"}</span>
                <h2>{editingMission ? editingMission.name : "New field mission"}</h2>
                <p className="form-context">Project: {projects.find((project) => project.id === currentProjectId)?.name ?? "Selected project"}</p>
                <div className="mapping-grid">
                  <label><span>Mission name *</span><input name="name" defaultValue={editingMission?.name ?? ""} required /></label>
                  <label><span>Status</span><select name="status" defaultValue={editingMission?.status ?? "active"}><option value="active">Active</option><option value="paused">Paused</option><option value="closed">Closed</option></select></label>
                  <label><span>Description</span><input name="description" defaultValue={editingMission?.description ?? ""} /></label>
                  <fieldset className="member-picker"><legend>Assign individual field users</legend>{users.filter((u) => u.role === "field_user").map((fieldUser) => <label key={fieldUser.id}><input type="checkbox" name="assignedUsers" value={fieldUser.id} defaultChecked={parseJsonArray(editingMission?.assigned_users).map(Number).includes(Number(fieldUser.id))} /><span>{fieldUser.name}<small>{fieldUser.email}</small></span></label>)}</fieldset>
                  <fieldset className="member-picker"><legend>Assign groups</legend>{userGroups.map((group) => <label key={group.id}><input type="checkbox" name="assignedGroups" value={group.id} defaultChecked={parseJsonArray(editingMission?.assigned_groups).map(Number).includes(Number(group.id))} /><span>{group.name}<small>{group.members?.length ?? 0} members</small></span></label>)}</fieldset>
                  <label><span>Boundary</span><select name="boundaryId" defaultValue={editingMission?.boundary_id ?? ""}><option value="">None</option>{boundaries.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
                  <label><span>Required fields</span><input name="requiredFields" defaultValue={(parseJsonObject(editingMission?.config).requiredFields ?? ["district","street"]).join(",")} /></label>
                  <label><span>Min photos</span><input type="number" name="minPhotos" defaultValue={Number(parseJsonObject(editingMission?.config).minPhotos ?? 1)} min={0} /></label>
                  <label className="checkbox-label"><input type="checkbox" name="photoRequired" defaultChecked={editingMission ? Boolean(parseJsonObject(editingMission?.config).photoRequired) : true} /> Photos required</label>
                  <label className="checkbox-label"><input type="checkbox" name="lamppostCapture" defaultChecked={Boolean(parseJsonObject(editingMission?.config).lamppostCapture)} /> Enable lamppost bulk capture</label>
                </div>
                <div className="asset-form-actions">
                  <button type="button" className="text-button" onClick={() => { setMissionFormOpen(false); setEditingMission(null); }}>Cancel</button>
                  <button className="primary-button" type="submit"><Check size={15} /> {editingMission ? "Save mission" : "Create mission"}</button>
                </div>
              </form>
            </>
          )}

          {groupFormOpen && (
            <>
              <button className="plan-backdrop" onClick={() => { setGroupFormOpen(false); setEditingGroup(null); }} />
              <form className="modal-card group-form" onSubmit={saveGroup}>
                <button type="button" className="close-detail" onClick={() => { setGroupFormOpen(false); setEditingGroup(null); }}><X size={17} /></button>
                <span className="eyebrow">Field team</span>
                <h2>{editingGroup ? "Manage group" : "Create field group"}</h2>
                <label><span>Group name *</span><input name="name" defaultValue={editingGroup?.name ?? ""} required /></label>
                <label><span>Description</span><input name="description" defaultValue={editingGroup?.description ?? ""} /></label>
                <fieldset className="member-picker"><legend>Select field users</legend>{users.filter((u) => u.role === "field_user").map((fieldUser) => <label key={fieldUser.id}><input type="checkbox" name="memberIds" value={fieldUser.id} defaultChecked={Boolean(editingGroup?.members?.some((member: any) => member.id === fieldUser.id))} /><span>{fieldUser.name}<small>{fieldUser.email}</small></span></label>)}</fieldset>
                <button className="primary-button" type="submit"><Check size={15} /> {editingGroup ? "Save group members" : "Create group"}</button>
              </form>
            </>
          )}
        </div>
      )}
      {photoViewerOpen && viewingPhoto && (
        <>
          <button className="plan-backdrop" onClick={() => { setPhotoViewerOpen(false); setViewingPhoto(null); }} />
          <div className="photo-viewer">
            <button className="close-detail" onClick={() => { setPhotoViewerOpen(false); setViewingPhoto(null); }}><X size={17} /></button>
            <img src={viewingPhoto} alt="Billboard media preview" />
          </div>
        </>
      )}
      {assignProjectOpen && (
        <>
          <button className="plan-backdrop" onClick={() => setAssignProjectOpen(false)} />
          <form className="modal-card assign-project-card" onSubmit={assignSelectedToProject}>
            <button type="button" className="close-detail" onClick={() => setAssignProjectOpen(false)}><X size={17} /></button>
            <span className="eyebrow">Project assignment</span>
            <h2>Assign {shortlist.length} selected billboard{shortlist.length === 1 ? "" : "s"}</h2>
            <p className="share-mode-copy">
              The billboard records stay in {projects.find((project) => project.id === currentProjectId)?.name ?? "this project"} and will also appear in the target project map, tracker, flighting, and shared views.
            </p>
            <div className="mapping-grid assign-project-grid">
              <label>
                <span>Existing target project</span>
                <select
                  value={assignTargetProjectId}
                  onChange={(event) => {
                    setAssignTargetProjectId(event.target.value);
                    if (event.target.value) setAssignNewProjectName("");
                  }}
                  disabled={assignProjectSaving || Boolean(assignNewProjectName.trim())}
                >
                  <option value="">Select project</option>
                  {projects
                    .filter((project) => project.id !== currentProjectId && project.id !== 0)
                    .map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
              <label>
                <span>Or create new project</span>
                <input
                  value={assignNewProjectName}
                  onChange={(event) => {
                    setAssignNewProjectName(event.target.value);
                    if (event.target.value.trim()) setAssignTargetProjectId("");
                  }}
                  disabled={assignProjectSaving || Boolean(assignTargetProjectId)}
                  placeholder="New project name"
                />
              </label>
            </div>
            <div className="assign-project-summary">
              <strong>{shortlist.length}</strong>
              <span>selected from the current map</span>
            </div>
            <button className="primary-button export-button" type="submit" disabled={assignProjectSaving || !shortlist.length || (!assignTargetProjectId && !assignNewProjectName.trim())}>
              {assignProjectSaving ? "Assigning..." : "Assign billboards"}
            </button>
          </form>
        </>
      )}
      {sharePanelOpen && (
        <>
          <button className="plan-backdrop" onClick={() => setSharePanelOpen(false)} />
          <div className="modal-card share-mode-card">
            <button type="button" className="close-detail" onClick={() => setSharePanelOpen(false)}><X size={17} /></button>
            <span className="eyebrow">Share project map</span>
            <h2>Choose access</h2>
            <p className="share-mode-copy">Select how people with this project link should open the map.</p>
            <div className="share-choice-list">
              <button type="button" className="share-choice-button" onClick={() => copyProjectShare(false)}>
                <strong>Unprotected link</strong>
                <span>Opens the map directly with no login and no secret code.</span>
              </button>
              <button type="button" className="share-choice-button" onClick={() => copyProjectShare(true)}>
                <strong>Protected link</strong>
                <span>Requires the shared secret code before the map opens.</span>
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
