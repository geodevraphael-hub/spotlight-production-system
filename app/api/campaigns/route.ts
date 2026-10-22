import {env} from 'cloudflare:workers';
import {currentUser} from '../app/route';
import {auditedDatabase} from '../../activity-audit.mjs';
import {initializeOnce} from '../../initialize-once.mjs';
import {setupCampaignTools,campaignList,saveCampaign,saveRoad} from '../../campaign-store.mjs';
const setup=initializeOnce(()=>setupCampaignTools(env.DB));
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){
 const user=await currentUser(request);if(!user)return reply({error:'Sign in required'},401);
 try{await setup();return reply(await campaignList(env.DB,user,Number(new URL(request.url).searchParams.get('projectId'))));}
 catch(e:any){return reply({error:e.status?e.message:'Campaigns could not be loaded. Please retry.'},e.status||500);}
}
export async function POST(request:Request){
 const user=await currentUser(request);if(!user)return reply({error:'Sign in required'},401);
 // Caddy terminates TLS; the Worker request URL can be the internal HTTP origin.
 // Allow the exact production origin, never arbitrary forwarded-host headers.
 const origin=request.headers.get('origin');
 if(origin&&origin!=='https://spotlight.co.tz'&&origin!==new URL(request.url).origin)return reply({error:'Invalid request origin'},403);
 try{await setup();const body=await request.json() as any,db=auditedDatabase(env.DB,user);
  if(body.action==='save-campaign')return reply(await saveCampaign(db,user,body));
  if(body.action==='save-road')return reply(await saveRoad(db,user,body));
  return reply({error:'Unknown action'},400);
 }catch(e:any){return reply({error:e.message||'Unable to save'},e.status||400);}
}
