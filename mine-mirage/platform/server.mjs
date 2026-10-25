/**
 * MINE//MIRAGE OpenEgiz bridge. One authoritative operations engine lives here.
 * Simulated telemetry -> MQTT Ditto protocol -> Eclipse Ditto.
 * Browser reads Ditto REST only via GET /api/twin; control requests never return
 * computed state and become visible only after Ditto accepts MQTT updates.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import mqtt from 'mqtt';
import {MineOperations,SCENARIOS} from '../web/live/modules/operations.js';
import {PLAYBOOKS} from '../web/live/modules/scenarios.js';
import saryarka from '../web/live/maps/saryarka.js';
import altai from '../web/live/maps/altai.js';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const WEB=path.resolve(HERE,'../web');
const MAPS={saryarka,altai};
const NS='org.mine.mirage';
const PORT=Number(process.env.PORT||5233);
const DITTO=(process.env.DITTO_URL||'http://ditto-nginx:80').replace(/\/$/,'');
const AUTH='Basic '+Buffer.from(`${process.env.DITTO_USER||'ditto'}:${process.env.DITTO_PASSWORD||''}`).toString('base64');
const MQTT_HOST=process.env.MQTT_HOST||'mosquitto';
const MQTT_PORT=Number(process.env.MQTT_PORT||1883);
const ACTIONS=new Set([...SCENARIOS.map(s=>s[0]),...PLAYBOOKS.map(x=>'playbook:'+x.id),'cancelBlast','safety']);
let currentMap='saryarka',ops=new MineOperations(MAPS[currentMap]),running=true,rate=1,connected=false;
let lastPublish=0,lastError='';
const broker=mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`,{clientId:'mine-mirage-authority',reconnectPeriod:1500,connectTimeout:8000});
broker.on('connect',()=>{connected=true;console.log('MQTT connected',MQTT_HOST);publish();});
broker.on('reconnect',()=>{connected=false;});
broker.on('offline',()=>{connected=false;});
broker.on('error',e=>{lastError=String(e.message);console.error('MQTT',e.message);});
function feature(value,unit){return {properties:unit?{value,unit}:{value}};}
function publishTwin(id,features){
  if(!connected)return;
  const body={topic:`${NS}/${id}/things/twin/commands/modify`,path:'/features',value:features};
  broker.publish(`telemetry/${id}`,JSON.stringify(body),{qos:1});
}
function publish(){
  if(!connected)return;
  const snap=ops.snapshot();
  publishTwin('mine-01',{
    state:feature(snap),
    map:feature(snap.mapId),
    simulation_time:feature(Math.round(snap.time*10)/10,'s'),
    mined_tonnes:feature(snap.metrics.tonnes,'t'),
    processed_tonnes:feature(snap.metrics.processed,'t'),
    moving_trucks:feature(snap.metrics.moving),
    energy:feature(snap.metrics.energyKwh??0,'kWh'),
    running:feature(running),
    speedup:feature(rate),
    updated_at:feature(new Date().toISOString())
  });
  for(const t of snap.fleet){
    publishTwin(t.id.toLowerCase(),{
      state:feature(t.status),speed:feature(t.speed,'km/h'),
      payload:feature(t.payload,'t'),fuel:feature(t.fuel,'%'),
      health:feature(t.health,'%'),target:feature(t.target||''),
      position:feature({x:t.position?.x||0,y:t.position?.y||0,z:t.position?.z||0})
    });
  }
  for(const [id,a] of Object.entries(snap.assets)){
    const key=a.id?.toLowerCase()||id;
    publishTwin(key,{
      state:feature(a.state||'idle'),
      health:feature(a.health||0,'%'),
      handled_tonnes:feature(a.handledTonnes||0,'t'),
      operating_hours:feature(a.operatingHours||0,'h')
    });
  }
  publishTwin('drill-01',{
    phase:feature(snap.blast.phase),
    drilled:feature(snap.blast.drilled||0),
    holes:feature(snap.blast.holes||[]),
    mwd_hardness:feature(snap.blast.hardnessIndex??0,'index'),
    fragmentation:feature(snap.blast.fragmentation??0,'fraction'),
    completed:feature(snap.blast.completed||0)
  });
  lastPublish=Date.now();
}
// Engine updates are SERVER ONLY. Clients never execute MineOperations.step.
setInterval(()=>{
  if(running)ops.step(1.5*rate);
  publish();
},1500).unref?.();

const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.glb':'model/gltf-binary','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'};
function json(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj));}
function parseBody(req){return new Promise((resolve,reject)=>{const chunks=[];let size=0;req.on('data',buf=>{size+=buf.length;if(size>16384){reject(Error('payload too large'));req.destroy();return;}chunks.push(buf);});req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'));}catch(e){reject(e)}});req.on('error',reject);});}
async function getTwin(){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),5500);
  try{
    const url=`${DITTO}/api/2/things/${encodeURIComponent(NS+':mine-01')}`;
    const result=await fetch(url,{headers:{Authorization:AUTH,Accept:'application/json'},signal:controller.signal});
    if(!result.ok)throw Error(`Ditto HTTP ${result.status}`);
    const twin=await result.json();
    const value=twin.features?.state?.properties?.value;
    if(!value?.fleet||!value?.metrics)throw Error('Ditto twin not yet initialized by MQTT');
    return {snapshot:value,dittoThingId:twin.thingId,revision:twin._revision||0,updatedAt:twin.features?.updated_at?.properties?.value||null};
  }finally{clearTimeout(timer);}
}
async function serveFile(req,res,pathname){
  let decoded;
  try{decoded=decodeURIComponent(pathname);}catch{return json(res,400,{error:'bad path'});}
  const rel=decoded==='/'?'index.html':decoded.slice(1);
  const dest=path.resolve(WEB,rel);
  if(!(dest===WEB||dest.startsWith(WEB+path.sep)))return json(res,403,{error:'forbidden'});
  try{
    const stat=await fs.promises.stat(dest);
    if(!stat.isFile())return json(res,404,{error:'not a file'});
    res.writeHead(200,{'Content-Type':TYPES[path.extname(dest).toLowerCase()]||'application/octet-stream','Cache-Control':/\.(?:html|js|css)$/.test(dest)?'no-cache':'public, max-age=3600','X-Content-Type-Options':'nosniff'});
    fs.createReadStream(dest).pipe(res);
  }catch{return json(res,404,{error:'not found'});}
}
const server=http.createServer(async(req,res)=>{
  try{
    const uri=new URL(req.url||'/',`http://localhost:${PORT}`);
    if(req.method==='GET'&&uri.pathname==='/api/health'){
      return json(res,200,{service:'mine-mirage',mqttConnected:connected,map:currentMap,running,rate,lastPublish,platform:DITTO,lastError});
    }
    if(req.method==='GET'&&uri.pathname==='/api/twin'){
      try{return json(res,200,await getTwin());}
      catch(e){return json(res,503,{error:'Ditto data unavailable',detail:e.message});}
    }
    if(req.method==='POST'&&uri.pathname==='/api/command'){
      const {action}=await parseBody(req);
      if(typeof action!=='string'||!ACTIONS.has(action))return json(res,400,{error:'unknown action'});
      if(!connected)return json(res,503,{error:'MQTT not connected'});
      const applied=ops.action(action);publish();return json(res,202,{accepted:true,applied:Boolean(applied),source:'command queued to Ditto via MQTT'});
    }
    if(req.method==='POST'&&uri.pathname==='/api/control'){
      const body=await parseBody(req);
      if(body.operation==='toggle'){running=!running;}
      else if(body.operation==='reset'){ops=new MineOperations(MAPS[currentMap]);running=true;}
      else if(body.operation==='speed'&&[0.5,1,3,5].includes(body.rate)){rate=body.rate;}
      else if(body.operation==='map'&&MAPS[body.map]){currentMap=body.map;ops=new MineOperations(MAPS[currentMap]);running=true;}
      else return json(res,400,{error:'invalid control'});
      publish();return json(res,202,{accepted:true});
    }
    if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'method not allowed'});
    return serveFile(req,res,uri.pathname);
  }catch(e){console.error(e);return json(res,500,{error:String(e.message)});}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`MINE//MIRAGE platform UI listening on ${PORT}`));
