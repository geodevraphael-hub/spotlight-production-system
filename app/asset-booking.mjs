/** Physical availability is shared across projects. Never expose other campaigns' names. */
/** @param {number|null} [projectId] */
export async function assetBookings(db,now=Date.now(),projectId=null){
 const day=new Date(now+10800000).toISOString().slice(0,10);
 const rows=await db.prepare(`SELECT i.id,
   (SELECT count(DISTINCT b.face) FROM bookings b WHERE b.inventory_id=i.id AND b.status!='cancelled' AND b.starts_on<=? AND b.ends_on>=?) reserved_faces,
   EXISTS(SELECT 1 FROM flight_schedules f WHERE CAST(json_extract(i.data,'$.id') AS INTEGER)=f.asset_id
    AND (EXISTS(SELECT 1 FROM inventory_projects ip WHERE ip.inventory_id=i.id AND ip.project_id=f.project_id) OR COALESCE(json_extract(i.data,'$.projectId'),1)=f.project_id)
    AND f.flight_status IN ('flighted','expired') AND (f.start_at IS NULL OR f.start_at<=?)) active_flight
   FROM inventory i ${projectId===null?'':`WHERE i.id IN (SELECT inventory_id FROM inventory_projects WHERE project_id=?) OR COALESCE(json_extract(i.data,'$.projectId'),1)=?`}`).bind(day,day,now,...(projectId===null?[]:[projectId,projectId])).all();
 return new Map(rows.results.map(r=>[Number(r.id),{bookingStatus:r.reserved_faces>0||r.active_flight?'booked':'available',reservedFaces:r.reserved_faces,bookingDate:day,bookingActiveFlight:Boolean(r.active_flight)}]));
}
