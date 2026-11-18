export function inventoryFingerprint(item) {
  return [String(item.street || '').trim().toLowerCase(), Number(item.lat).toFixed(5), Number(item.lng).toFixed(5), item.mediaType || 'lamp-post'].join('|');
}
