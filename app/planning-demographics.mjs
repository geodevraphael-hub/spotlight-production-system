export const DEMOGRAPHIC_LEVELS = [
  ['local','Ward / shehia · census'],['village','Village · estimated'],
  ['council','Council · census'],['district','District · derived census'],['region','Region · census'],
];
const numeric=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
const counts=value=>Object.fromEntries(['population','households','male','female'].map(key=>[key,numeric(value?.[key])]));
const consistent=data=>data.population===null||data.male===null||data.female===null||data.population===data.male+data.female;
/** Source contract: /v1/reverse, /v1/demographics/summary and building-population/summary.
 * Never substitute regional totals for missing villages or treat allocations as enumeration. */
export function demographicAreas(reverse={}) {
  const census=reverse?.census_administration;
  const areas=[];
  for(const level of ['region','district','council','ward','shehia']){
    const area=census?.administration?.[level],data=area?.demographics;
    if(!area)continue;
    const values=counts(data);
    const verified=Boolean(data&&data.year===2022&&!data.name_link_needs_verification&&consistent(values)&&
      !(['ward','shehia'].includes(level)&&census.ambiguous_ward));
    areas.push({level,key:`${level}:${area.boundary_id}`,name:area.name,year:data?.year??null,
      basis:level==='district'?'Derived census grouping':'Published census',verified,
      ...Object.fromEntries(Object.entries(values).map(([k,v])=>[k,verified?v:null])),
      source:'NBS 2022 PHC via Location IQ',note:verified?'Whole administrative area; not a billboard catchment.':'Missing, ambiguous or unverified census link. Excluded from scoring.'});
  }
  const village=reverse?.administration?.village,estimate=reverse?.building_population;
  if(village||estimate){
    const values=counts(estimate?.estimates);
    const components=estimate?.ward_components;
    const verified=Boolean(estimate?.available&&estimate.status==='estimated'&&
      village?.id===estimate.village_id&&!reverse?.coverage?.ambiguous_village&&consistent(values)&&
      Array.isArray(components)&&components.length>0&&components.every(c=>!c.boundary_name_link_needs_verification));
    areas.push({level:'village',key:`village:${village?.id??estimate?.village_id}`,name:village?.name??estimate?.name,
      year:2022,basis:'NBS-anchored village estimate',verified,
      ...Object.fromEntries(Object.entries(values).map(([k,v])=>[k,verified?v:null])),
      source:'Location IQ allocation of NBS 2022 ward/shehia totals using Open Buildings',
      note:estimate?.note||'Village estimate unavailable; no census total is substituted.',
      method:estimate?.method??null,components:components??[]});
  }
  return {version:1,areas,note:'Census reference: 2022. Village figures are modelled allocations, not measured village counts or current population. Repeated boards in one area do not add residents.'};
}
export function demographicArea(evidence,level='local'){
  const areas=evidence?.demographics?.areas??[];
  return areas.find(area=>level==='local'?['ward','shehia'].includes(area.level):area.level===level)??null;
}
export function groupDemographicRows(rows){
  const groups=new Map();
  for(const row of rows){
    const key=row.area?.key??'unavailable';
    if(!groups.has(key))groups.set(key,{key,area:row.area,rows:[]});
    groups.get(key).rows.push(row);
  }
  return [...groups.values()];
}
