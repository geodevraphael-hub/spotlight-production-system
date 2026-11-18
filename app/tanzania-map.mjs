// A reverse polygon: an opaque Web Mercator world rectangle with Tanzania's
// ADM0 rings cut out. Placing it above every map layer also clips imagery.
const worldRing = [[-85.05112878,-180],[-85.05112878,180],[85.05112878,180],[85.05112878,-180]];
const extent = [[-12.35,29.2],[-0.65,40.85]];
let boundaryRequest;

export function insideTanzaniaBounds(latitude,longitude) {
  return Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) &&
    Number(latitude)>=-12.35 && Number(latitude)<=-0.65 && Number(longitude)>=29.2 && Number(longitude)<=40.85;
}

export async function addTanzaniaMapGuard(L, map, color = '#eef2f0') {
  // Version the URL so a browser's previous force-cached boundary cannot hide
  // the map after the generalized display geometry ships.
  boundaryRequest ||= fetch('/tanzania-boundary.json?v=2',{cache:'force-cache'}).then(response=>{
    if(!response.ok)throw new Error(`Tanzania map boundary unavailable (${response.status})`);
    return response.json();
  }).then(data=>data.rings).catch(error=>{
    // Do not permanently cache a transient network failure; a remount can retry.
    boundaryRequest = undefined;
    throw error;
  });
  const rings=await boundaryRequest;
  const paneName = 'tanzania-mask';
  let pane = map.getPane(paneName);
  if (!pane) pane = map.createPane(paneName);
  pane.style.zIndex = '650';
  const holes = rings.map(ring => ring.map(([lng,lat]) => [lat,lng]));
  const mask = L.polygon([worldRing, ...holes], {
    pane: paneName,
    // A single SVG path handles the reverse polygon reliably; Canvas was
    // failing during initialization on some production browsers with this
    // world-sized outer ring and prevented the basemap from ever appearing.
    renderer: L.svg({ pane: paneName, padding: 0 }),
    stroke: false,
    fill: true,
    fillColor: color,
    fillOpacity: 1,
    fillRule: 'evenodd',
    interactive: false,
    // Let Leaflet simplify sub-pixel bends at the current zoom. The display-only
    // boundary is already generalized; retaining every source vertex is costly.
    smoothFactor: 1,
    noClip: true,
  }).addTo(map);

  const bounds = L.latLngBounds(extent);
  map.setMaxBounds(bounds);
  map.options.maxBoundsViscosity = 1;
  const setCountryMinimumZoom = () => {
    if (!map.getSize().x || !map.getSize().y) return;
    map.setMinZoom(map.getBoundsZoom(bounds, false));
  };
  setCountryMinimumZoom();
  map.on('resize', setCountryMinimumZoom);
  return { mask, bounds, rings, dispose: () => map.off('resize', setCountryMinimumZoom) };
}

export function maskCanvasOutsideTanzania(ctx, map, rings, width, height, color = '#eef2f0') {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [lng,lat] = ring[i];
      const point = map.latLngToContainerPoint([lat,lng]);
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
  }
  ctx.fillStyle = color;
  ctx.fill('evenodd');
  ctx.restore();
}
