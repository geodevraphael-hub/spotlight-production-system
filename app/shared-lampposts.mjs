const norm = (value) => String(value ?? '').trim().toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');

export function lamppostRoad(item) {
  if (item?.mediaType !== 'lamp-post') return null;
  const attributes = item.sourceAttributes && typeof item.sourceAttributes === 'object' ? item.sourceAttributes : {};
  const entries = Object.entries(attributes).filter(([key, value]) => /road|street name/i.test(key) && String(value ?? '').trim());
  const explicitRoad = entries.find(([key]) => /road name|street name|^\s*road\s*$/i.test(key) && !/from|to/i.test(key));
  const namedRoad = norm(item.roadName || item.road || explicitRoad?.[1]);
  if (namedRoad) return { key: `road:${namedRoad}`, label: String(item.roadName || item.road || explicitRoad?.[1]).trim() };
  const from = norm(item.from || item.roadFrom);
  const to = norm(item.to || item.roadTo);
  if (from && to) {
    const [first, second] = [from, to].sort();
    return { key: `route:${first}|${second}`, label: `${item.from || item.roadFrom} ↔ ${item.to || item.roadTo}` };
  }
  const routeAttribute = entries.find(([key]) => /road|street/i.test(key));
  if (routeAttribute) return { key: `road:${norm(routeAttribute[1])}`, label: String(routeAttribute[1]).trim() };
  const street = norm(item.street);
  return street ? { key: `location:${street}`, label: `${String(item.street).trim()} · road name inferred from location` } : null;
}

export function groupLamppostsByRoad(items) {
  const groups = new Map();
  for (const item of items || []) {
    const road = lamppostRoad(item);
    if (!road) continue;
    const group = groups.get(road.key) || { key: road.key, label: road.label, boards: [] };
    group.boards.push(item);
    groups.set(road.key, group);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

export function validateSharedLampposts(items) {
  if (!Array.isArray(items) || items.length < 2 || items.length > 200) throw Object.assign(new Error('Select between 2 and 200 lamp posts.'), { status: 400 });
  if (items.some((item) => item?.mediaType !== 'lamp-post')) throw Object.assign(new Error('Only lamp posts can share a road photo.'), { status: 400 });
  const roads = new Set(items.map((item) => lamppostRoad(item)?.key).filter(Boolean));
  if (roads.size !== 1 || items.some((item) => !lamppostRoad(item))) throw Object.assign(new Error('Selected lamp posts must have the same recorded road or location.'), { status: 400 });
  const road = lamppostRoad(items[0]);
  if (!road) throw Object.assign(new Error('Selected lamp posts need a recorded road or location.'), { status: 400 });
  return road;
}
