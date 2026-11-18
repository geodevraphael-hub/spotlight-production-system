export const SUMMARY_FILTERS=[['boardType','Board type','type','typeLabel'],['vendor','Vendor','vendor','vendor'],['region','Region','region','regionLabel'],['district','District','districtKey','district'],['local','Ward / shehia','localKey','localLabel'],['village','Village','villageKey','villageLabel']];
export const emptySummaryFilters=()=>Object.fromEntries(SUMMARY_FILTERS.map(([key])=>[key,'']));
export function matchesSummaryFilters(asset,filters){return SUMMARY_FILTERS.every(([key,,field])=>!filters[key]||asset[field]===filters[key]);}
export function summaryFilterOptions(assets,filters){
 return Object.fromEntries(SUMMARY_FILTERS.map(([key,,field,label],index)=>{
  const parents=Object.fromEntries(SUMMARY_FILTERS.slice(0,index).map(([parent])=>[parent,filters[parent]]));
  const options=new Map();for(const asset of assets)if(matchesSummaryFilters(asset,parents))options.set(asset[field],{label:asset[label],context:key==='district'?asset.regionLabel:key==='local'?`${asset.district}, ${asset.regionLabel}`:key==='village'?`${asset.localLabel}, ${asset.district}, ${asset.regionLabel}`:''});
  const labelCounts=new Map();for(const row of options.values())labelCounts.set(row.label,(labelCounts.get(row.label)||0)+1);
  return [key,[...options].map(([value,row])=>({value,label:labelCounts.get(row.label)>1&&row.context?`${row.label} (${row.context})`:row.label})).sort((a,b)=>a.label.localeCompare(b.label)||a.value.localeCompare(b.value))];
 }));
}
export function changeSummaryFilter(filters,key,value){
 const next={...filters,[key]:value},index=SUMMARY_FILTERS.findIndex(([field])=>field===key);
 // Keep selections valid as the upstream scope changes.
 for(const [field] of SUMMARY_FILTERS.slice(index+1))next[field]='';
 return next;
}
export function selectedSummaryFilters(filters,options){return SUMMARY_FILTERS.filter(([key])=>filters[key]).map(([key,label])=>({key,label,value:options[key]?.find(option=>option.value===filters[key])?.label||filters[key]}));}
