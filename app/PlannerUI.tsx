"use client";

import { BarChart3, Check, Layers3, Plus } from "lucide-react";

export function InventorySummary({ faces, large, digital, banners, lamps }: {
  faces: number; large: number; digital: number; banners: number; lamps: number;
}) {
  return <details className="planner-inventory-summary">
    <summary><BarChart3 size={16} aria-hidden="true" /><span><strong>{faces.toLocaleString()}</strong> faces in these results</span></summary>
    <dl>
      <div><dt>Large format faces</dt><dd>{large.toLocaleString()}</dd></div>
      <div><dt>Digital screen faces</dt><dd>{digital.toLocaleString()}</dd></div>
      <div><dt>Fabricated banner faces</dt><dd>{banners.toLocaleString()}</dd></div>
      <div><dt>Lamp posts</dt><dd>{lamps.toLocaleString()}</dd></div>
    </dl>
  </details>;
}

export function PlanSelectionButton({ name, selected, onClick, disabled = false }: {
  name: string; selected: boolean; onClick: () => void; disabled?: boolean;
}) {
  return <button className="planner-row-select" aria-label={`${selected ? "Remove" : "Add"} ${name} ${selected ? "from" : "to"} plan`}
    aria-pressed={selected} disabled={disabled} onClick={onClick} title={selected ? "Remove from this plan" : "Add to this plan"}>
    {selected ? <Check size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
    <span>{selected ? "In plan" : "Add"}</span>
  </button>;
}

export function PlanningMapLegend({inventory=false,central=false}:{inventory?:boolean;central?:boolean}={}) {
  return <details className="planner-map-legend">
    <summary><Layers3 size={16} aria-hidden="true" /> Map legend</summary>
    <div className="map-symbol-guide">
      <span><i className="guide-large"/>Large format</span><span><i className="guide-digital"/>Digital screen</span>
      <span><i className="guide-fabricated"/>Fabricated banner</span><span><i/>Lamp post</span>
      <span><i className="guide-flighted"/>Flighted · gently pulsing dot</span><span><i className="guide-expired"/>Expired · amber diamond</span>
      <span><i className="guide-unflighted"/>Unflighted</span><span><i className="guide-deflighted"/>Deflighted · hollow dot</span>
    </div>
    <p>Zoom in for format proportions, face counts and status dots. Overview uses compact points. {inventory?"A dark outline marks the focused billboard; a check means selected.":"A dark outline marks the open billboard; a check means in this plan."} Shapes are not to map scale. Reduced-motion settings disable animation.</p>
    {central&&<p>Flight filters match any linked project. With no flight filter, expired takes priority over flighted. Open Details to inspect each project’s status.</p>}
  </details>;
}
