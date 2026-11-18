export { inventoryFingerprint } from './inventory-fingerprint.mjs';

export function validCoordinates(latitude, longitude) {
  if(latitude===''||longitude===''||latitude==null||longitude==null)return false;
  const lat=Number(latitude),lng=Number(longitude);
  return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180;
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
