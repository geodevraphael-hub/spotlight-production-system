const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function markerSize(item) {
  const w=Number(item.width),h=Number(item.height);
  const ratio=Number.isFinite(w)&&Number.isFinite(h)&&w>0&&h>0?Math.max(.55,Math.min(2.2,w/h)):1;
  const markerWidth=Math.round(27*Math.sqrt(ratio)),markerHeight=Math.round(27/Math.sqrt(ratio));
  return {markerWidth,markerHeight,hitWidth:Math.max(44,markerWidth+12),hitHeight:Math.max(44,markerHeight+16)};
}
export function markerState(item,now=Date.now()) {
  const state=String(item.flightStatus??'').toLowerCase();
  if(state==='flighted'&&Number(item.flightExpiry)>0&&Number(item.flightExpiry)<=now)return 'expired';
  return ['flighted','deflighted','expired'].includes(state)?state:'unflighted';
}
export function markerHtml(item,active,inPlan=false,now=Date.now()) {
  const kind={'large-format':'large','digital-screen':'digital','fabricated-banner':'fabricated','lamp-post':'lamp'}[item.mediaType]??'lamp';
  const {markerWidth,markerHeight}=markerSize(item),state=markerState(item,now);
  return `<span style="width:${markerWidth}px;height:${markerHeight}px" class="asset-marker asset-marker--${kind} asset-marker--${state}${item.positionSource==='estimated-road-stretch'?' asset-marker--estimated':''}${active?' asset-marker--active':''}${inPlan?' asset-marker--in-plan':''}" aria-hidden="true"><i class="asset-marker-post"></i><b>${escape(item.faces)}</b><span class="asset-status-dot"></span>${inPlan?'<em class="planner-marker-check">✓</em>':''}</span>`;
}
