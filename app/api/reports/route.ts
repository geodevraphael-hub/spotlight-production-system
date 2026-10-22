import {env} from 'cloudflare:workers';
import {currentUser} from '../app/route';
import {initializeOnce} from '../../initialize-once.mjs';
import {setupReports,reportWorkspace,saveReport,reportLink} from '../../report-store.mjs';
const setup=initializeOnce(()=>setupReports(env.DB));
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){const user=await currentUser(request);if(!user)return reply({error:'Sign in required'},401);try{await setup();const q=new URL(request.url).searchParams;return reply(await reportWorkspace(env.DB,user,Number(q.get('projectId')),q.get('scope')||''));}catch(e:any){return reply({error:e.status?e.message:'Report could not be loaded. Please retry.'},e.status||500);}}
export async function POST(request:Request){const user=await currentUser(request);if(!user)return reply({error:'Sign in required'},401);const origin=request.headers.get('origin');if(origin&&origin!=='https://spotlight.co.tz'&&origin!==new URL(request.url).origin)return reply({error:'Invalid request origin'},403);
 try{await setup();if(Number(request.headers.get('content-length'))>2500000)return reply({error:'Cover file too large'},413);const body=await request.json() as any;
 if(body.action==='save')return reply(await saveReport(env.DB,user,body));if(body.action==='link')return reply(await reportLink(env.DB,user,body));return reply({error:'Unknown report action'},400);
 }catch(e:any){return reply({error:e.status?e.message:'Unable to save the report. Check your inputs and reload if it changed elsewhere.'},e.status||400);}}
