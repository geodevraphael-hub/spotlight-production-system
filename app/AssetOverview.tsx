"use client";
import {assetPriority,installationCount,registrationNumber,mediaGroup,PRIORITIES} from './asset-register.mjs';
import {MapPin,Pencil} from 'lucide-react';
export default function AssetOverview({board,type,flight,selection,onEdit}:any){
 const priority=assetPriority(board),installations=installationCount(board);
 return <section className="asset-register-overview attributes">
  <header><h3>Asset register</h3>{onEdit&&<button type="button" onClick={onEdit}><Pencil size={14}/>Edit attributes</button>}</header>
  <h4>Vendor & registration</h4>
  <dl><div><dt>Vendor</dt><dd>{board.vendor||board.owner||'Not recorded'}</dd></div>
   <div><dt>Registration number</dt><dd>{registrationNumber(board)||'Awaiting KM registration'}</dd></div>
   <div><dt>Priority</dt><dd>{PRIORITIES.find(([v]:any)=>v===priority)?.[1]||'Not assigned'}</dd></div></dl>
  <h4>Location</h4>
  {board.positionVerified===true&&board.gpsVerification&&<p>Field GPS verified · accuracy ±{Number(board.gpsVerification.accuracy).toFixed(1)} m · {new Date(board.gpsVerification.verifiedAt).toLocaleString()}</p>}
  {board.positionSource==='estimated-road-stretch'&&<p className="ct-alert">Estimated road-stretch position — not surveyed pole GPS. Confirm the location through field validation before relying on it.</p>}
  <dl><div><dt>Specific location</dt><dd>{board.street}</dd></div><div><dt>District</dt><dd>{board.locationAddress?.lat===Number(board.lat)&&board.locationAddress?.lng===Number(board.lng)?board.locationAddress.district||board.district||'Lookup pending / unavailable':board.district||'Lookup pending'}</dd></div>
   <div><dt>Village</dt><dd>{board.locationAddress?.lat===Number(board.lat)&&board.locationAddress?.lng===Number(board.lng)?board.locationAddress.village||board.village||'Not identified by location service':board.village||'Lookup pending'}</dd></div>
   <div><dt>Road / direction</dt><dd>{board.from||'—'} → {board.to||'—'}</dd></div>
   <div><dt>GPS</dt><dd><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${board.lat},${board.lng}`)}`} target="_blank" rel="noreferrer"><MapPin size={14}/>{Number(board.lat).toFixed(6)}, {Number(board.lng).toFixed(6)}<span className="planner-sr-only"> Open location in Google Maps</span></a></dd></div></dl>
  <h4>Structure & media</h4>
  <dl><div><dt>Media type</dt><dd>{type}</dd></div><div><dt>Media group</dt><dd>{mediaGroup(board)||'Not recorded'}</dd></div>
   <div><dt>Dimension (width × height)</dt><dd>{board.width>0&&board.height>0?`${board.width} × ${board.height} m`:'Not recorded'}</dd></div>
   <div><dt>Faces</dt><dd>{board.faces}</dd></div><div><dt>Installations</dt><dd>{installations??'Not recorded'}</dd></div>
   <div><dt>Arrangement</dt><dd>{board.arrangement||'Not recorded'}</dd></div><div><dt>Brackets</dt><dd>{board.brackets||'Not recorded'}</dd></div></dl>
  <h4>Advertising</h4>
  <dl><div><dt>Booking status</dt><dd>{board.bookingStatus?board.bookingStatus==='booked'?'Booked':'Available':'Not checked'}</dd></div>
   {board.bookingStatus&&<div><dt>Availability check</dt><dd>{board.bookingDate} (EAT){board.bookingActiveFlight?' · Active flight':board.reservedFaces?` · ${board.reservedFaces} face(s) reserved`:''}</dd></div>}
   <div><dt>Flight status</dt><dd>{flight}</dd></div><div><dt>Planning selection</dt><dd>{selection}</dd></div><div><dt>Current advert</dt><dd>{board.advert||'Not recorded'}</dd></div></dl>
 </section>;
}
