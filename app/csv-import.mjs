export function normalizeCsvHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_/-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ');
}

export function parseCsvNumber(value) {
  let text = String(value ?? '').trim().replace(/\s/g, '');
  if (!text) return 0;
  text = text.replace(/[^\d.,+-]/g, '');
  if (text.includes(',') && text.includes('.')) {
    // A comma before a decimal point is a thousands separator (e.g. 1,234.5).
    text = text.replace(/,/g, '');
  } else if (text.includes(',')) {
    const commaDecimal = /^[-+]?\d+,\d{1,2}$/.test(text);
    text = commaDecimal ? text.replace(',', '.') : text.replace(/,/g, '');
  }
  const numeric = Number(text.match(/[-+]?\d+(?:\.\d+)?/)?.[0] ?? '');
  return Number.isFinite(numeric) ? numeric : 0;
}

/** Parse a physical billboard dimension in metres, not a display resolution or year. */
export function parseCsvDimensionMeters(value) {
  const text = String(value ?? '').trim();
  if (!text || /(?:px|pixels?|mm|cm|ft|feet|in|inch|inches)\b/i.test(text)) return 0;
  const match = text.match(/^\s*([+-]?(?:\d[\d.,]*|[.,]\d+))\s*(?:m|met(?:er|re)s?)?\s*$/i);
  if (!match) return 0;
  const numeric = parseCsvNumber(match[1]);
  return numeric > 0 && numeric <= 500 ? numeric : 0;
}

export function parseCsvDimensions(value) {
  const match = String(value ?? '').match(/^\s*([^x×*]+?)\s*(?:x|×|\*)\s*([^x×*]+?)\s*$/i);
  if (!match) return { width: 0, height: 0 };
  const width = parseCsvDimensionMeters(match[1]);
  const height = parseCsvDimensionMeters(match[2]);
  return width > 0 && height > 0 ? { width, height } : { width: 0, height: 0 };
}

const CSV_ALIASES = {
  street: ['street', 'street name', 'road', 'road name', 'route', 'name', 'site', 'billboard', 'billboard name', 'location name', 'jina la eneo', 'mtaa'],
  district: ['area', 'district', 'location', 'region', 'ward'],
  from: ['from', 'road from', 'route from', 'start', 'origin'],
  to: ['to', 'road to', 'route to', 'end', 'destination'],
  latitude: ['latitude', 'lat', 'gps latitude', 'gps lat', 'y', 'y coordinate'],
  longitude: ['longitude', 'lng', 'lon', 'long', 'gps longitude', 'gps long', 'x', 'x coordinate'],
  width: ['width', 'width m', 'w'],
  height: ['height', 'height m', 'h'],
  dimensions: ['dimensions', 'dimension', 'size', 'format', 'format size'],
  faces: ['faces', 'face', 'number of faces'],
  owner: ['owner', 'vendor', 'supplier'],
  priority: ['priority', 'priority level'],
  registrationNumber: ['registration number', 'registration no', 'reg number'],
  installations: ['installation', 'installations', 'number of installations'],
  mediaGroup: ['media group'],
  mediaType: ['type', 'board type', 'billboard type', 'media type', 'format type', 'screen type'],
  status: ['status', 'selection status', 'selected', 'planning status'],
  photoUrl: ['photo url', 'image url', 'photo', 'image', 'photo_url', 'image_url', 'picture url', 'media url'],
  rental: ['rental', 'rental price', 'space price', 'space rental price'],
  printing: ['printing', 'printing price'],
  transport: ['transport', 'transport price'],
  flighting: ['flighting', 'flighting price', 'installation price'],
};

/** Exact headers always win. Fuzzy matching ignores one-character aliases and only maps a field when unambiguous. */
export function mapCsvHeaders(headers) {
  const normalized = headers.map(normalizeCsvHeader);
  const mapping = {};
  const assigned = new Set();
  for (const [field, aliases] of Object.entries(CSV_ALIASES)) {
    const names = aliases.map(normalizeCsvHeader);
    const exact = normalized.findIndex((header) => names.includes(header));
    if (exact >= 0) {
      mapping[field] = headers[exact];
      assigned.add(exact);
    }
  }
  for (const [field, aliases] of Object.entries(CSV_ALIASES)) {
    if (mapping[field]) continue;
    const names = aliases.map(normalizeCsvHeader);
    const candidates = new Set();
    normalized.forEach((header, index) => {
      if (!assigned.has(index) && names.some((name) => name.length >= 3 && header.includes(name))) candidates.add(index);
    });
    if (candidates.size === 1) {
      const index = [...candidates][0];
      mapping[field] = headers[index];
      assigned.add(index);
    }
  }
  return mapping;
}
