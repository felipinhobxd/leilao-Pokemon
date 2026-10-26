import http from 'node:http';
import fs from 'node:fs';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)).replaceAll('\\','/').replace(/\/$/,'');
const mock=String.raw`export function createPublicSupabaseClient(){const channel={on(){return this},subscribe(cb){cb('SUBSCRIBED');return this}};return {auth:{async getSession(){return {data:{session:{access_token:'local-test-only',user:{id:'local-test-only'}}}}},onAuthStateChange(cb){queueMicrotask(()=>cb('INITIAL_SESSION',{access_token:'local-test-only',user:{id:'local-test-only'}}));return {data:{subscription:{unsubscribe(){}}}}},async signOut(){}},storage:{from(){return {async uploadToSignedUrl(){return {error:null}}}}},channel(){return channel},async removeChannel(){}}}`;
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Dashboard from '${root}/app/dashboard.tsx';import {NavigationGuardProvider} from '${root}/app/navigation-guard.tsx';import Bulk from '${root}/app/auctions/new/bulk-wizard.tsx';import Navigation from '${root}/app/site-navigation.tsx';import Single from '${root}/app/auctions/new/wizard.tsx';import WhatsApp from '${root}/app/whatsapp/page.tsx';import Brinde from '${root}/app/auctions/brinde/page.tsx';import axe from '${root}/node_modules/axe-core/axe.js';const Page=location.pathname.includes('/single')?Single:location.pathname.includes('/auctions/new')?Bulk:location.pathname==='/whatsapp'?WhatsApp:location.pathname.includes('/brinde')?Brinde:Dashboard;createRoot(document.getElementById('root')).render(<NavigationGuardProvider><Navigation/><Page/><button style={{margin:20}} onClick={async()=>{const result=await axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}});document.getElementById("audit-result").textContent=JSON.stringify(result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({html:n.html,summary:n.failureSummary}))})),null,2)}}>Auditar acessibilidade local</button><pre id="audit-result"/></NavigationGuardProvider>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',tsconfig:root+'/tsconfig.json',nodePaths:[root+'/node_modules'],plugins:[{name:'local-fixtures',setup(b){b.onResolve({filter:/supabase$/},()=>({path:'supabase',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:mock,loader:'js'}));b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'link-fixture'}));b.onLoad({filter:/.*/,namespace:'link-fixture'},()=>({contents:`import React from 'react';export default function Link(props){return <a {...props}/>}`,loader:'jsx',resolveDir:root}));b.onResolve({filter:/^next\/navigation$/},()=>({path:'nav',namespace:'nav-fixture'}));b.onLoad({filter:/.*/,namespace:'nav-fixture'},()=>({contents:'export function usePathname(){return location.pathname} export function useRouter(){return {push(url){location.href=url},replace(url){location.replace(url)}}}',loader:'js'}));}}]});

const id='00000000-0000-0000-0000-000000000092';
const empty=()=>Object.fromEntries(['cards','participants','auctions','bids','auction_events','purchases','payments','deliveries','warnings','value_change_log','participant_warnings','admin_notifications','payment_reminders'].map(x=>[x,[]]));
let calls=[],drafts=new Map(),creations=new Map(),config={batchFailures:0,commitOnFailure:false,workerStatus:'connected',draftFailures:0};
const groups=[{id,name:'Grupo de demonstração',is_default:true}];
const queue={queue:{id,status:'running',starts_at:new Date().toISOString(),interval_seconds:30,total_items:1,ends_at:null},group:groups[0],items:[],summary:{total:1,published:0,pending:1,failed:0,nextScheduledAt:null}};
const json=(res,value,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 const url=new URL(req.url,'http://127.0.0.1'),path=url.pathname;
 const readBody=async()=>{let body='';for await(const chunk of req)body+=chunk;return body?JSON.parse(body):{};};
 if(path==='/__fixture/reset'){calls=[];drafts=new Map();creations=new Map();config={batchFailures:0,commitOnFailure:false,workerStatus:'connected',draftFailures:0};return json(res,{ok:true});}
 if(path==='/__fixture/config'){Object.assign(config,await readBody());return json(res,config);}
 if(path==='/__fixture/calls')return json(res,calls);
 if(path==='/bundle.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles[0].text);}
 if(path==='/style.css'){res.setHeader('Content-Type','text/css');return res.end(['app/globals.css','app/auctions/new/wizard.css','app/auctions/new/batch-wizard.css'].map(p=>fs.readFileSync(root+'/'+p,'utf8')).join(String.fromCharCode(10)));}
 if(path.startsWith('/api/')){
  const body=req.method==='POST'?await readBody():null;calls.push({url:req.url,method:req.method,body});
  if(path==='/api/auctions/batch'){
   const result={queue:{id}};
   if(config.batchFailures-->0){if(config.commitOnFailure)creations.set(body.eventId,result);return json(res,{error:'Falha simulada ao confirmar publicação'},503);}
   creations.set(body.eventId,result);return json(res,{data:result},201);
  }
  if(path==='/api/auctions/recover')return json(res,{data:creations.get(url.searchParams.get('eventId'))??null});
  if(path==='/api/auctions/queue')return json(res,url.searchParams.has('latest')?{queue:null}:queue);
  if(path==='/api/auctions/drafts'){
   if(req.method==='POST'){if(config.draftFailures-->0)return json(res,{error:'Falha simulada ao salvar'},503);drafts.set(body.draftId,{id:body.draftId,title:body.title,payload:body.state,updated_at:new Date().toISOString()});return json(res,{draft:{id:body.draftId}});}
   if(url.searchParams.has('draftId'))return json(res,{draft:drafts.get(url.searchParams.get('draftId'))});
   return json(res,{drafts:[...drafts.values()].map(({payload,...draft})=>draft)});
  }
  if(path==='/api/cards/image/authorize')return json(res,{images:body.images.map(image=>({...image,path:image.sha256+'.png',url:'https://fixtures.invalid/'+image.sha256+'.png',exists:false,token:'local-fixture'}))});
  if(path==='/api/auctions/new')return json(res,{groups,defaultGroupId:id,suggestedLotNumber:1});
  if(path==='/api/whatsapp/groups')return json(res,{groups,defaultGroupId:id});
  const botStatus={worker:{workerId:'demo',status:config.workerStatus,heartbeatAt:new Date().toISOString(),version:'0.2.10',sessionActive:true},online:true,canControl:true};
  if(path==='/api/whatsapp/bootstrap')return json(res,{botStatus,groups,dispatches:[]});
  if(path==='/api/whatsapp/bot')return json(res,req.method==='POST'?{ok:true}:botStatus);
  if(path==='/api/dashboard'){
   if(config.dashboardFailures>0){config.dashboardFailures--;return json(res,{error:'Falha de leitura simulada'},503);}
   const data=empty();const person={id,display_name:'Maria de exemplo',phone_e164:'Contato de demonstração',status:'active'};const card={id,name:'Pikachu ex',starting_price:5,status:'in_auction'};const auction={id,card_id:id,status:'open',starting_price:5,scheduled_end_at:new Date(Date.now()+3600000).toISOString(),created_at:new Date().toISOString(),lot_number:1};
   const bid={id,auction_id:id,participant_id:id,amount:100,status:'active',participant:person};
   data.cards=[card];data.auctions=[auction];data.participants=[person];
   data.purchases=[{id,card_id:id,auction_id:id,participant_id:id,card_name:card.name,person_name:person.display_name,amount:50,status:'confirmed',paid:false}];
   const operations={bot:{online:true,connected:true,version:'0.2.10'},group:groups[0],dispatches:{sent:1,failed:0,pending:0,successRate:1}};
   return json(res,url.searchParams.get('scope')==='operations'?{role:'admin',operations}:{data,role:'admin',liveAuction:{auction,card,winner:null,bids:[bid],participantCount:1,purchases:data.purchases},operations});
  }
  if(path==='/api/operations'){
   const now=new Date().toISOString();
   return json(res,{checkedAt:now,worker:{online:true,status:'connected',heartbeat:now,version:'0.2.10',protectionVersion:1,issue:'',database:{},backup:{},cleanup:{status:'blocked',at:now,reason:'backup_coverage_incomplete',deleted:0}},backupProtection:{state:'confirmed',latestSnapshotAt:now,latestConfirmedAt:now,validSnapshotAt:now,validConfirmedAt:now,validUntil:new Date(Date.now()+48*3600000).toISOString()},backupReadFailed:false,notices:[],failures:[],sectionsUnavailable:[],...(config.operationResponse??{})});
  }
  if(path==='/api/quick-polls')return json(res,{data:[]});
  return json(res,{});
 }
 res.setHeader('Content-Type','text/html; charset=utf-8');
 if(path==='/mobile')return res.end('<body style="margin:0;background:#ddd"><iframe title="Painel em celular de 390 pixels" src="/" style="width:390px;height:1000px;border:0"></iframe></body>');
 res.end('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Validação local — Leilão Pokémon</title><link rel="stylesheet" href="/style.css"></head><body><div style="padding:6px;text-align:center;background:#fff3cd;color:#332701;font:12px system-ui">PRÉVIA LOCAL · DADOS FICTÍCIOS · SEM ENVIO AO WHATSAPP</div><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');
}).listen(Number(process.env.UI_TEST_PORT??3214),'127.0.0.1',()=>console.log('Local UI fixtures ready — no Supabase, no WhatsApp'));
