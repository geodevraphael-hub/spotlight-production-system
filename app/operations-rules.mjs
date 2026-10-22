export function validCoordinates(latitude, longitude) {
  return latitude !== '' && longitude !== '' && latitude != null && longitude != null && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) && Math.abs(Number(latitude)) <= 90 && Math.abs(Number(longitude)) <= 180;
}

export function dayKey(value = Date.now()) {
  return new Date(value + 3 * 3600000).toISOString().slice(0, 10);
}

export function bookingOverlap(start, end, otherStart, otherEnd) {
  return start <= otherEnd && end >= otherStart;
}

export function money(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1e12) throw new Error('Enter a valid non-negative amount');
  return Math.round(parsed * 100);
}

export function nextDeliveryStatus(current, incoming) {
  if (current === 'read' || (current === 'delivered' && incoming !== 'read')) return current;
  return incoming;
}

export function inventoryFingerprint(item) {
  return [String(item.street || '').trim().toLowerCase(), Number(item.lat).toFixed(5), Number(item.lng).toFixed(5), item.mediaType || 'lamp-post'].join('|');
}
