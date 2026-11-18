"use client";
import {useEffect, useMemo, useRef, useState} from 'react';
import {Camera, Check, ImagePlus, X} from 'lucide-react';
import {groupLamppostsByRoad} from './shared-lampposts.mjs';

function readCompressedImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('Choose a valid image file.'));
      image.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) return reject(new Error('Image processing is unavailable on this device.'));
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', .78));
      };
      image.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export default function SharedLamppostPhoto({boards, projectId, onClose, onSaved}: any) {
  const groups = useMemo(() => groupLamppostsByRoad(boards), [boards]);
  const [roadKey, setRoadKey] = useState(groups[0]?.key || '');
  const group = groups.find((item: any) => item.key === roadKey) || groups[0];
  const [selectedIds, setSelectedIds] = useState<number[]>(() => (group?.boards || []).map((item: any) => item.inventoryDbId).filter(Number.isSafeInteger));
  const [photo, setPhoto] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const requestId = useRef<string | null>(null);
  useEffect(() => { root.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, []);
  useEffect(() => {
    if (!group) return;
    setSelectedIds(group.boards.map((item: any) => item.inventoryDbId).filter(Number.isSafeInteger));
    setConfirm(false);
  }, [roadKey]);

  async function chooseFile(file?: File) {
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/')) return setError('Choose an image file.');
    if (file.size > 20 * 1024 * 1024) return setError('Choose an image up to 20 MB.');
    try {
      const compressed = await readCompressedImage(file);
      if (compressed.length > 4_000_000) throw new Error('Image is still too large after compression. Choose a smaller image.');
      setPhoto(compressed);
      setFileName(file.name);
      setConfirm(false);
      requestId.current = null;
    } catch (reason: any) { setError(reason.message || 'Could not prepare image.'); }
  }

  async function save() {
    if (!group || selectedIds.length < 2 || !photo || !confirm || busy) return;
    setBusy(true); setError('');
    requestId.current ||= crypto.randomUUID();
    try {
      const response = await fetch('/api/app?action=shared-lamppost-photo', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({projectId, assetIds: selectedIds, photo, requestId: requestId.current}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save the shared photo.');
      onSaved(result);
    } catch (reason: any) { setError(reason.message || 'Could not save the shared photo. Retry when connected.'); }
    finally { setBusy(false); }
  }

  return <div className="inventory-bulk-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="central-assignment shared-lamppost-photo" ref={root} role="dialog" aria-modal="true" aria-labelledby="shared-lamppost-title" aria-busy={busy} onKeyDown={event => { if (event.key === 'Escape' && !busy) onClose(); }}>
      <header><div><h2 id="shared-lamppost-title">Use one photo for lamp posts</h2><p>Select a single road group, choose its poles, then upload one shared photo.</p></div><button aria-label="Close shared photo" disabled={busy} onClick={onClose}><X size={20}/></button></header>
      <div className="shared-lamppost-body">
        <section className="shared-lamppost-controls">
          <label>Road / stretch<select value={group?.key || ''} onChange={event => setRoadKey(event.target.value)} disabled={busy || groups.length < 2}><option value="">{groups.length ? 'Choose a road group' : 'No shared road group found'}</option>{groups.map((item: any) => <option key={item.key} value={item.key}>{item.label} · {item.boards.length} pole{item.boards.length === 1 ? '' : 's'}</option>)}</select></label>
          {!groups.length&&<p className="shared-photo-error" role="status">Add matching Road From / Road To, Road Name or Street values to at least two selected lamp posts before sharing a photo.</p>}
          {!!groups.length&&groups.every((item: any)=>item.boards.length<2)&&<p className="shared-photo-error" role="status">These selected poles do not yet form a shared-road group. Select at least two poles with matching road details.</p>}
          <div className="shared-lamppost-pole-heading"><div><strong>{group?.boards.length || 0} poles in this road group</strong><small>Only poles with matching road details are grouped together.</small></div><button type="button" disabled={busy||!group} onClick={() => setSelectedIds((group?.boards||[]).map((item: any) => item.inventoryDbId).filter(Number.isSafeInteger))}>Select all</button></div>
          <div className="shared-lamppost-list" aria-label="Lamp posts to receive this photo">{(group?.boards || []).map((item: any) => <label key={item.inventoryDbId}><input type="checkbox" checked={selectedIds.includes(item.inventoryDbId)} disabled={busy} onChange={event => setSelectedIds(current => event.target.checked ? [...new Set([...current, item.inventoryDbId])] : current.filter(id => id !== item.inventoryDbId))}/><span><strong>{item.street || `Lamp post ${item.inventoryDbId}`}</strong><small>{item.district || 'Location not recorded'} · {Number(item.lat).toFixed(5)}, {Number(item.lng).toFixed(5)}</small></span></label>)}</div>
        </section>
        <section className="shared-lamppost-photo-pane">
          <h3>Shared road photo</h3><p>One optimized image is stored once and securely linked to each selected pole.</p>
          <label className="shared-photo-upload"><ImagePlus size={18}/><span>{photo ? 'Replace photo' : 'Choose photo'}<small>{fileName || 'JPG, PNG or WebP · max 20 MB'}</small></span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = ''; }}/></label>
          {photo && <img className="shared-photo-preview" src={photo} alt="Preview of photo to attach to selected lamp posts"/>}
          <p className="shared-photo-note"><Camera size={15}/> This same road-level photo will appear on each selected lamp-post record. You can still replace an individual pole photo later.</p>
        </section>
      </div>
      {error && <p className="assignment-error shared-photo-error" role="alert">{error}</p>}
      <footer><label><input type="checkbox" checked={confirm} disabled={busy || !group || !photo || selectedIds.length < 2} onChange={event => setConfirm(event.target.checked)}/><span>Attach this photo to {selectedIds.length} selected lamp posts in “{group?.label || 'the selected road'}”.</span></label><div><button disabled={busy} onClick={onClose}>Cancel</button><button className="assignment-save" disabled={busy || !group || !photo || !confirm || selectedIds.length < 2} onClick={() => void save()}><Check size={16}/>{busy ? 'Saving photo…' : 'Save shared photo'}</button></div></footer>
    </div>
  </div>;
}
