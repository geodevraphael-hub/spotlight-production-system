/** Additive indexes only: no rebuilds or rewrites of active business records. */
export async function installPerformanceIndexes(db){
 await db.batch([
  db.prepare('CREATE INDEX IF NOT EXISTS idx_inventory_source_id ON inventory(source_id)'),
  db.prepare("CREATE INDEX IF NOT EXISTS idx_inventory_original_id ON inventory(CAST(json_extract(data,'$.id') AS INTEGER))"),
  db.prepare("CREATE INDEX IF NOT EXISTS idx_inventory_source_project ON inventory(COALESCE(json_extract(data,'$.projectId'),1))"),
  db.prepare('CREATE INDEX IF NOT EXISTS idx_project_users_user_project ON project_users(user_id,project_id)'),
  db.prepare('CREATE INDEX IF NOT EXISTS idx_inventory_projects_scope ON inventory_projects(project_id,inventory_id)'),
  db.prepare('CREATE INDEX IF NOT EXISTS idx_flight_asset_state ON flight_schedules(asset_id,flight_status,start_at,project_id)'),
  db.prepare("CREATE INDEX IF NOT EXISTS idx_bookings_current_asset ON bookings(inventory_id,starts_on,ends_on,face) WHERE status!='cancelled'"),
  db.prepare('CREATE INDEX IF NOT EXISTS idx_field_collections_project_created ON field_collections(project_id,created_at DESC)'),
  db.prepare('CREATE INDEX IF NOT EXISTS idx_field_photos_collection ON field_photos(collection_id)'),
  db.prepare('CREATE INDEX IF NOT EXISTS idx_campaign_plans_project_updated ON campaign_plans(project_id,updated_at DESC)'),
 ]);
}
