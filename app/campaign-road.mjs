const DAY=86400000;
export function calendarDate(value){
 const text=String(value??'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||!Number.isFinite(Date.parse(text))||new Date(text).toISOString().slice(0,10)!==text)throw new Error('Choose a valid start and end date.');
 return text;
}
export function campaignClock(start,end,now=Date.now()){
 const a=Date.parse(calendarDate(start))/DAY,b=Date.parse(calendarDate(end))/DAY;
 if(b<a)throw new Error('End date cannot be before start date.');
 const today=Math.floor((now+10800000)/DAY),remaining=b-today,duration=b-a+1;
 return {duration,remaining,startsIn:a-today,progress:Math.max(0,Math.min(100,(today-a)/duration*100)),
  label:today<a?`Starts in ${a-today} day${a-today===1?'':'s'}`:remaining<0?`Ended ${-remaining} day${remaining===-1?'':'s'} ago`:remaining===0?'Ends today':`${remaining} day${remaining===1?'':'s'} remaining`,
  state:today<a?'scheduled':remaining<0?'ended':'active'};
}
const rad=d=>d*Math.PI/180,deg=r=>r*180/Math.PI;
export function distance(a,b){const x=rad(b.lat-a.lat),y=rad(b.lng-a.lng);return 6371008.8*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(x/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(y/2)**2)));}
function interpolate(a,b,f){
 const angle=distance(a,b)/6371008.8,s=Math.sin(angle),u=Math.sin((1-f)*angle)/s,v=Math.sin(f*angle)/s;
 const x=u*Math.cos(rad(a.lat))*Math.cos(rad(a.lng))+v*Math.cos(rad(b.lat))*Math.cos(rad(b.lng));
 const y=u*Math.cos(rad(a.lat))*Math.sin(rad(a.lng))+v*Math.cos(rad(b.lat))*Math.sin(rad(b.lng));
 const z=u*Math.sin(rad(a.lat))+v*Math.sin(rad(b.lat));
 return {lat:Number(deg(Math.atan2(z,Math.hypot(x,y))).toFixed(7)),lng:Number(deg(Math.atan2(y,x)).toFixed(7))};
}
/** Equal chainage along a surveyed/marked polyline, never road snapping or verified pole GPS. */
export function roadPreview(anchors,count){
 if(!Array.isArray(anchors)||anchors.length<2||anchors.length>50||anchors.some(p=>!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>85||Math.abs(p.lng)>180))throw new Error('Mark 2–50 valid road coordinates (latitude −85 to 85, longitude −180 to 180).');
 if(!Number.isInteger(count)||count<2||count>200)throw new Error('Enter a known pole count between 2 and 200, including the first and last poles.');
 const segments=anchors.slice(1).map((p,i)=>distance(anchors[i],p));
 const length=segments.reduce((a,b)=>a+b,0);
 if(segments.some(n=>n<1)||length<2||length>100000)throw new Error('Road points must be at least 1 m apart; the stretch must be under 100 km.');
 if(length/(count-1)<1)throw new Error('Pole spacing must be at least 1 m. Check the count or road points.');
 let segment=0,start=0;
 const points=Array.from({length:count},(_,i)=>{const chainage=length*i/(count-1);while(segment<segments.length-1&&chainage>start+segments[segment])start+=segments[segment++];return {...interpolate(anchors[segment],anchors[segment+1],Math.max(0,Math.min(1,(chainage-start)/segments[segment]))),chainage:Number(chainage.toFixed(1))};});
 return {points,length,spacing:length/(count-1)};
}
