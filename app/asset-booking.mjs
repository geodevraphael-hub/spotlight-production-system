/** Physical availability is shared across projects. Never expose other campaigns' names. */
export async function assetBookings(db,now=Date.now()){
 const day=new Date(now+10800000).toISOString().slice(0,10);
 const rows=await db.prepare(`SELECT i.id,
   (SELECT count(DISTINCT b.face) FROM bookings b WHERE b.inventory_id=i.id AND b.status!='cancelled' AND b.starts_on<=? AND b.ends_on>=?) reserved_faces,
   EXISTS(SELECT 1 FROM flight_schedules f WHERE CAST(json_extract(i.data,'$.id') AS INTEGER)=f.asset_id
    AND (EXISTS(SELECT 1 FROM inventory_projects ip WHERE ip.inventory_id=i.id AND ip.project_id=f.project_id) OR COALESCE(json_extract(i.data,'$.projectId'),1)=f.project_id)
    AND f.flight_status IN ('flighted','expired') AND (f.start_at IS NULL OR f.start_at<=?)) active_flight
   FROM inventory i`).bind(day,day,now).all();
 return new Map(rows.results.map(r=>[Number(r.id),{bookingStatus:r.reserved_faces>0||r.active_flight?'booked':'available',reservedFaces:r.reserved_faces,bookingDate:day,bookingActiveFlight:Boolean(r.active_flight)}]));
}
