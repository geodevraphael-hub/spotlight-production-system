"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Check,
  ChevronDown,
  Layers3,
  LocateFixed,
  MapPin,
  Maximize2,
  PanelLeftClose,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import "leaflet/dist/leaflet.css";

type Billboard = {
  id: number;
  district: string;
  street: string;
  owner: string;
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
};

function textValue(node: Element, field: string) {
  return (
    Array.from(node.querySelectorAll("Data")).find(
      (item) => item.getAttribute("name") === field,
    )?.querySelector("value")?.textContent?.trim() ?? ""
  );
}

function parseBillboards(xmlText: string): Billboard[] {
  const xml = new DOMParser().parseFromString(xmlText, "text/xml");
  return Array.from(xml.querySelectorAll("Placemark")).map((node, index) => ({
    id: Number(textValue(node, "index")) || index + 1,
    district: node.querySelector("name")?.textContent?.trim() || "Unknown",
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
  }));
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

export default function Home() {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<Map<number, LeafletMarker>>(new Map());
  const [billboards, setBillboards] = useState<Billboard[]>([]);
  const [selected, setSelected] = useState<Billboard | null>(null);
  const [query, setQuery] = useState("");
  const [district, setDistrict] = useState("All areas");
  const [availability, setAvailability] = useState("All inventory");
  const [shortlist, setShortlist] = useState<number[]>([]);
  const [showFilters, setShowFilters] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/billboards.kml")
      .then((response) => response.text())
      .then((text) => {
        const parsed = parseBillboards(text);
        setBillboards(parsed);
        setLoading(false);
      });
  }, []);

  const districts = useMemo(
    () => Array.from(new Set(billboards.map((item) => item.district))).sort(),
    [billboards],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return billboards.filter((item) => {
      const matchesSearch =
        !term ||
        [item.district, item.street, item.owner, item.advert]
          .join(" ")
          .toLowerCase()
          .includes(term);
      const matchesDistrict =
        district === "All areas" || item.district === district;
      const matchesAvailability =
        availability === "All inventory" ||
        (availability === "Available" ? !item.occupied : item.occupied);
      return matchesSearch && matchesDistrict && matchesAvailability;
    });
  }, [billboards, query, district, availability]);

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !mapNode.current || mapRef.current) return;
      const map = L.map(mapNode.current, {
        zoomControl: false,
        attributionControl: false,
      }).setView([-6.1455, 39.2269], 14);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      mapRef.current = map;
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !billboards.length) return;
    import("leaflet").then((L) => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current.clear();
      filtered.forEach((item) => {
        const active = selected?.id === item.id;
        const available = !item.occupied;
        const icon = L.divIcon({
          className: "asset-marker-wrap",
          html: `<span class="asset-marker ${available ? "asset-marker--available" : ""} ${active ? "asset-marker--active" : ""}"><span>${item.faces}</span></span>`,
          iconSize: active ? [38, 38] : [30, 30],
          iconAnchor: active ? [19, 19] : [15, 15],
        });
        const marker = L.marker([item.lat, item.lng], { icon })
          .addTo(mapRef.current!)
          .on("click", () => setSelected(item));
        markersRef.current.set(item.id, marker);
      });
    });
  }, [billboards, filtered, selected]);

  useEffect(() => {
    setTimeout(() => mapRef.current?.invalidateSize(), 260);
  }, [sidebarOpen]);

  const availableCount = billboards.filter((item) => !item.occupied).length;
  const totalFaces = billboards.reduce((sum, item) => sum + item.faces, 0);
  const totalLampPosts = billboards.reduce(
    (sum, item) => sum + item.lampPosts,
    0,
  );

  function focusItem(item: Billboard) {
    setSelected(item);
    mapRef.current?.flyTo([item.lat, item.lng], 17, { duration: 0.8 });
  }

  function toggleShortlist(id: number) {
    setShortlist((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  function resetFilters() {
    setQuery("");
    setDistrict("All areas");
    setAvailability("All inventory");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">K</span>
          <span>
            <strong>KMK OOH Planner</strong>
            <small>Dar es Salaam inventory</small>
          </span>
        </div>
        <div className="topbar-actions">
          <button className="text-button">
            <Layers3 size={16} /> Map layers
          </button>
          <button className="primary-button">
            <Sparkles size={16} /> Build a plan
            {shortlist.length > 0 && <span>{shortlist.length}</span>}
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className={sidebarOpen ? "sidebar" : "sidebar sidebar--closed"}>
          <div className="sidebar-inner">
            <section className="sidebar-head">
              <div>
                <span className="eyebrow">Inventory overview</span>
                <h1>Plan with confidence.</h1>
                <p>Explore and compare mapped outdoor media opportunities.</p>
              </div>
              <div className="metrics-grid">
                <Metric value={billboards.length || "—"} label="Mapped assets" />
                <Metric value={availableCount} label="Available" accent />
                <Metric value={totalFaces} label="Total faces" />
                <Metric value={totalLampPosts} label="Lamp posts" />
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
                      <option>All inventory</option>
                      <option>Available</option>
                      <option>Occupied</option>
                    </select>
                  </label>
                </div>
              )}
            </section>

            <div className="result-heading">
              <span>{filtered.length} results</span>
              {(query ||
                district !== "All areas" ||
                availability !== "All inventory") && (
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
                <button
                  key={item.id}
                  className={
                    selected?.id === item.id
                      ? "asset-row asset-row--selected"
                      : "asset-row"
                  }
                  onClick={() => focusItem(item)}
                >
                  <span
                    className={
                      item.occupied ? "row-icon" : "row-icon row-icon--available"
                    }
                  >
                    <MapPin size={16} />
                  </span>
                  <span className="row-copy">
                    <strong>{item.street}</strong>
                    <small>
                      {item.district} · {item.from} → {item.to}
                    </small>
                    <span>
                      {item.width} × {item.height} m · {item.faces} faces
                    </span>
                  </span>
                  <span
                    className={
                      item.occupied ? "status status--occupied" : "status"
                    }
                  >
                    {item.occupied ? "Occupied" : "Available"}
                  </span>
                </button>
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
            <small>Marker number = faces</small>
          </div>
          <button
            className="map-control locate"
            onClick={() => mapRef.current?.flyTo([-6.1455, 39.2269], 14)}
            aria-label="Reset map view"
          >
            <LocateFixed size={18} />
          </button>
          <div className="map-summary">
            <BarChart3 size={16} />
            <span>
              Showing <strong>{filtered.length}</strong> of {billboards.length} assets
            </span>
          </div>

          {selected && (
            <article className="detail-card">
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
                  <span className="eyebrow">{selected.district}</span>
                  <h2>{selected.street}</h2>
                  <p>
                    {selected.from} → {selected.to}
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
                <div>
                  <dt>Current advert</dt>
                  <dd>{selected.advert}</dd>
                </div>
              </dl>
              <div className="detail-actions">
                <button
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
                </button>
                <button
                  className="icon-button"
                  onClick={() =>
                    mapRef.current?.flyTo([selected.lat, selected.lng], 18)
                  }
                  aria-label="Zoom to asset"
                >
                  <Maximize2 size={17} />
                </button>
              </div>
            </article>
          )}
        </section>
      </div>
    </main>
  );
}
