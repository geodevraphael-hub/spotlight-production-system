const clean = value => String(value ?? '').trim();
const normalize = value => clean(value).toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
const fieldKey = value => normalize(value).replace(/[^a-z0-9]/g, '');

function attributeValue(attributes, predicate) {
  const match = Object.entries(attributes && typeof attributes === 'object' ? attributes : {})
    .find(([key, value]) => predicate(fieldKey(key)) && clean(value));
  return clean(match?.[1]);
}

/** Return a real road/route label, or an explicit unassigned-route label. */
export function lamppostRoute(item) {
  if (item?.mediaType !== 'lamp-post' && item?.type !== 'Lampposts') return null;
  const attributes = item.sourceAttributes || {};
  const sharedLabel = clean(item.photoSharedRoad);
  if (sharedLabel) return { key: `shared:${normalize(sharedLabel)}`, label: sharedLabel, recorded: true };

  const roadName = clean(item.roadStretch?.name || item.roadName || item.road) || attributeValue(attributes, key =>
    /^(?:roadstretch|roadname|streetname|road)$/.test(key));
  if (roadName) return { key: `road:${normalize(roadName)}`, label: roadName, recorded: true };

  const from = clean(item.from || item.roadFrom) || attributeValue(attributes, key => key === 'from' || key === 'roadfrom');
  const to = clean(item.to || item.roadTo) || attributeValue(attributes, key => key === 'to' || key === 'roadto');
  if (from && to) {
    const [first, second] = [normalize(from), normalize(to)].sort();
    return { key: `route:${first}|${second}`, label: `${from} ↔ ${to}`, recorded: true };
  }

  const routeText = attributeValue(attributes, key => /^(?:roadfromto|roadroute|streetroute)$/.test(key));
  if (routeText) return { key: `route:${normalize(routeText)}`, label: routeText, recorded: true };

  const area = clean(item.district || item.area || item.region) || 'Area not recorded';
  return { key: `unassigned:${normalize(area)}`, label: `Road not recorded · ${area}`, recorded: false };
}

export function groupLamppostRoutes(items) {
  const groups = new Map();
  for (const item of items || []) {
    const route = lamppostRoute(item);
    if (!route) continue;
    const group = groups.get(route.key) || { ...route, boards: [] };
    group.boards.push(item);
    groups.set(route.key, group);
  }
  return [...groups.values()]
    .map(group => ({ ...group, boards: group.boards.sort((a, b) => String(a.street || a.name || '').localeCompare(String(b.street || b.name || ''), undefined, { numeric: true })) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/** Collapse per-pole URLs that reference the same shared route photo. */
export function imageReferenceKey(item) {
  const raw = clean(item?.image || item?.photoUrl || item?.photoOriginalUrl);
  if (!raw) return '';
  try {
    const url = new URL(raw, 'https://spotlight.co.tz');
    if (url.searchParams.get('action') === 'shared-lamppost-photo') {
      return `shared-photo:${url.searchParams.get('id') || url.pathname}`;
    }
    return url.href;
  } catch {
    return raw;
  }
}

export function uniqueImageReferences(items) {
  const unique = new Map();
  for (const item of items || []) {
    const key = imageReferenceKey(item);
    if (!key) continue;
    const current = unique.get(key);
    if (!current || Number(item.photoSharedAt || 0) > Number(current.photoSharedAt || 0)) unique.set(key, item);
  }
  return [...unique.values()];
}
