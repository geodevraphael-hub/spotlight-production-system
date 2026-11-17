export const DICTIONARY_TABS=[['mediaType','Board types'],['priority','Priorities'],['status','Inventory statuses']];
export const DEFAULT_DICTIONARIES={
 mediaType:[['lamp-post','Lamp post'],['large-format','Large format'],['digital-screen','Digital screen'],['fabricated-banner','Fabricated banner']],
 priority:[['A','Priority A — Highest visibility'],['B','Priority B'],['C','Priority C']],
 status:[['selected','Selected'],['not-selected','Not selected']],
};
export function dictionaryLabel(dictionaries,kind,value){return dictionaries[kind]?.find(([code])=>code===value)?.[1]??String(value??'');}
export function validateDictionaryEntry(body){
 if(!DICTIONARY_TABS.some(([key])=>key===body.kind))throw new Error('Choose a valid dictionary.');
 const value=String(body.value??'').trim(),label=String(body.label??'').trim();
 if(!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,59}$/.test(value)||['__missing__','All status','All types'].includes(value))throw new Error('Code must contain 1–60 letters, numbers or hyphens.');
 if(body.kind==='priority'&&value!==value.toUpperCase())throw new Error('Priority codes must be uppercase.');
 if(!label||label.length>100)throw new Error('Label must contain 1–100 characters.');
 return {kind:body.kind,value,label};
}
