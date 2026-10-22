"use client";

import { Eye, MapPin, Plus, Trash2, X, ImageOff } from "lucide-react";
import { useState } from "react";

type Costs = { rental: string; printing: string; transport: string; flighting: string };
type Placement = {
  id: number; street: string; district: string; owner: string; vendor?: string;
  width: number; height: number; faces: number; from: string; to: string;
  sourceAttributes?: Record<string, string>;
};
const categories = [
  ["rental", "Space / rental"], ["printing", "Printing"],
  ["transport", "Transport"], ["flighting", "Flighting"],
] as const;

export default function PlanningBillboard({ board, costs, inPlan, type, image, flightStatus, onCost, onToggle, onReview, onClose, onLocate, onPhoto }: {
  board: Placement; costs: Costs; inPlan: boolean; type: string; image: string; flightStatus: string;
  onCost: (category: keyof Costs, value: string) => void;
  onToggle: () => void; onReview: () => void; onClose: () => void; onLocate: () => void; onPhoto: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const entered = categories.filter(([key]) => costs[key].trim() !== "" && Number.isFinite(Number(costs[key])) && Number(costs[key]) >= 0);
  const total = entered.reduce((sum, [key]) => sum + Number(costs[key]), 0);
  return <article className="planning-placement" role="dialog" aria-modal="false" aria-labelledby="planning-placement-title" onKeyDown={event=>{if(event.key==="Escape"){event.stopPropagation();onClose();}}}>
    <header className="planning-placement-head">
      <div><span>Placement for this plan</span><h2 id="planning-placement-title">{board.street}</h2><p>{type} · {board.district}</p></div>
      <button autoFocus className="icon-button" onClick={onClose} aria-label="Close placement"><X size={18} /></button>
    </header>
    <div className="planning-placement-body">
      <section className="planning-placement-context" aria-label="Placement information">
        {image ? <button className="planning-placement-photo" onClick={onPhoto} aria-label={`Preview photo of ${board.street}`}>
          {!imageFailed && <img src={image} alt={board.street} onError={() => setImageFailed(true)} />}
          {imageFailed && <p>Image preview unavailable</p>}
          <span><Eye size={15} /> Open photo</span>
        </button> : <div className="planning-placement-photo planning-placement-photo--empty"><ImageOff size={24} aria-hidden="true" /><p>No placement photo available</p></div>}
        <dl>
          <div><dt>Dimensions</dt><dd>{board.width > 0 && board.height > 0 ? `${board.width} × ${board.height} m` : "Not recorded"}</dd></div>
          <div><dt>Faces</dt><dd>{board.faces || "Not recorded"}</dd></div>
          <div><dt>Vendor</dt><dd>{board.vendor || board.owner || "Not recorded"}</dd></div>
          <div><dt>Flight status</dt><dd>{flightStatus}</dd></div>
          <div><dt>Route</dt><dd>{board.from || "—"} → {board.to || "—"}</dd></div>
        </dl>
        <button className="text-button" onClick={onLocate}><MapPin size={15} /> Locate on map</button>
        {board.sourceAttributes && Object.keys(board.sourceAttributes).length > 0 && <details className="planning-reference">
          <summary>More placement information</summary>
          <dl>{Object.entries(board.sourceAttributes).filter(([, value]) => String(value ?? "").trim()).map(([key, value]) =>
            <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>
        </details>}
      </section>
      <section className="planning-placement-estimate" aria-label="Plan cost estimate">
        <h3>Estimate this placement</h3>
        <p>Prices in TZS, for this plan only.</p>
        <div className="planning-placement-prices">
          {categories.map(([key, label]) => <label key={key}><span>{label}</span>
            <input type="number" min="0" step="0.01" inputMode="decimal" value={costs[key]} placeholder="Not entered"
              aria-label={`${label} estimate for ${board.street}`} onChange={event => onCost(key, event.target.value)} />
          </label>)}
        </div>
        <div className="planning-placement-total"><span>{entered.length === 4 ? "Placement total" : "Partial estimate"}</span><strong>TZS {total.toLocaleString("en-US")}</strong></div>
        <p className="planning-notice">{entered.length}/4 prices entered. Enter 0 only for a cost that does not apply.</p>
        <div className="planning-placement-scope">Adding a placement does not reserve it, change its inventory attributes or update its flight status.</div>
      </section>
    </div>
    <footer className="planning-placement-actions">
      <button className="text-button" onClick={onToggle}>{inPlan ? <Trash2 size={15} /> : <Plus size={15} />}{inPlan ? "Remove from plan" : "Add to selection"}</button>
      <button className="primary-button" onClick={onReview}>{inPlan ? "Review plan" : "Add & review plan"}</button>
    </footer>
  </article>;
}
