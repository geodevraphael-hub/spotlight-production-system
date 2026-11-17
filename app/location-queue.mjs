/** Queue changes in the same transaction as inventory writes, including imports and GPS verification. */
export async function setupLocationQueue(db){
 const valid=`json_type(NEW.data,'$.lat') IN ('integer','real') AND json_type(NEW.data,'$.lng') IN ('integer','real') AND abs(json_extract(NEW.data,'$.lat'))<=90 AND abs(json_extract(NEW.data,'$.lng'))<=180`;
 const enqueue=`INSERT INTO location_enrichment_queue(inventory_id,lat,lng,queued_at,next_attempt_at,status,attempts,updated_at)
  VALUES(NEW.id,json_extract(NEW.data,'$.lat'),json_extract(NEW.data,'$.lng'),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),0,'queued',0,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
  ON CONFLICT(inventory_id) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,queued_at=excluded.queued_at,next_attempt_at=0,status='queued',attempts=0,updated_at=excluded.updated_at;`;
 await db.batch([
  db.prepare(`CREATE TABLE IF NOT EXISTS location_enrichment_queue(inventory_id INTEGER PRIMARY KEY,lat REAL NOT NULL,lng REAL NOT NULL,queued_at INTEGER NOT NULL,next_attempt_at INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL DEFAULT 0)`),
  db.prepare('CREATE INDEX IF NOT EXISTS idx_location_queue_due ON location_enrichment_queue(next_attempt_at,status,queued_at)'),
  db.prepare('CREATE INDEX IF NOT EXISTS idx_location_queue_updated ON location_enrichment_queue(updated_at,inventory_id)'),
  db.prepare('CREATE INDEX IF NOT EXISTS idx_location_queue_status ON location_enrichment_queue(status,inventory_id)'),
  db.prepare('CREATE TABLE IF NOT EXISTS location_reverse_cache(lat REAL NOT NULL,lng REAL NOT NULL,data TEXT NOT NULL,fetched_at INTEGER NOT NULL,PRIMARY KEY(lat,lng))'),
  db.prepare(`CREATE TRIGGER IF NOT EXISTS queue_new_location AFTER INSERT ON inventory WHEN ${valid} BEGIN ${enqueue} END`),
  db.prepare(`CREATE TRIGGER IF NOT EXISTS queue_changed_location AFTER UPDATE OF data ON inventory WHEN (json_extract(OLD.data,'$.lat') IS NOT json_extract(NEW.data,'$.lat') OR json_extract(OLD.data,'$.lng') IS NOT json_extract(NEW.data,'$.lng')) AND ${valid} BEGIN ${enqueue} END`),
  db.prepare('CREATE TRIGGER IF NOT EXISTS remove_location_queue AFTER DELETE ON inventory BEGIN DELETE FROM location_enrichment_queue WHERE inventory_id=OLD.id; END'),
  db.prepare(`INSERT OR IGNORE INTO location_enrichment_queue(inventory_id,lat,lng,queued_at,next_attempt_at,status)
   SELECT id,json_extract(data,'$.lat'),json_extract(data,'$.lng'),0,
   CASE WHEN json_extract(data,'$.locationAddress.lat')=json_extract(data,'$.lat') AND json_extract(data,'$.locationAddress.lng')=json_extract(data,'$.lng') THEN COALESCE(json_extract(data,'$.locationAddress.retryAfter'),0) ELSE 0 END,CASE WHEN json_extract(data,'$.locationAddress.lat')=json_extract(data,'$.lat') AND json_extract(data,'$.locationAddress.lng')=json_extract(data,'$.lng') AND json_extract(data,'$.locationAddress.status') IN ('complete','partial') THEN json_extract(data,'$.locationAddress.status') ELSE 'queued' END
   FROM inventory WHERE json_type(data,'$.lat') IN ('integer','real') AND json_type(data,'$.lng') IN ('integer','real') AND abs(json_extract(data,'$.lat'))<=90 AND abs(json_extract(data,'$.lng'))<=180`),
 ]);
}
