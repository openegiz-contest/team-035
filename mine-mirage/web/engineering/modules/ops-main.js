import {MineOperations} from './operations.js';
import {validateMap} from './network.js';
import {MineWorld} from './world.js';
const $=id=>document.getElementById(id);
const fmt=(v,d=0)=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:d,minimumFractionDigits:d});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusNames={hauling:'К дробилке',returning:'В забой',loading:'Погрузка',dumping:'Разгрузка',refueling:'Заправка',repairing:'Ремонт',to_fuel:'К АЗС',to_workshop:'К ремонту',stranded:'Ожидание помощи'};
const actionFlags=['rain','fog','heat','crusherFault','loaderFault','powerFault','roadworks','gpsFault','weightFault','fuelShortage','drainage'];
const presetFiles={saryarka:'/data/maps/saryarka.json',altai:'/data/maps/altai.json'};
let mapData,engine=null,remote=false,snapshot=null,paused=false,rate=5,lastDraw=0;
const world=new MineWorld($('scene'));
let toastTimer;
function toast(message,error=false){const o=$('toast');o.textContent=message;o.style.background=error?'#44231f':'#1a3b36';o.style.borderColor=error?'#e98576':'#54cba6';o.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>o.classList.remove('show'),4400);}
async function request(url,options={}){const response=await fetch(url,{cache:'no-store',...options});if(!response.ok){const body=await response.text();throw Error(body.slice(0,240)||`HTTP ${response.status}`);}return response.json();}
async function loadPreset(name){const m=await request(presetFiles[name]||presetFiles.saryarka);return validateMap(m);}
async function openMap(m){
 const clean=validateMap(m);
 if(remote){const res=await request('/api/map',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(clean)});mapData=res.map; snapshot=res.state;}
 else{mapData=clean;engine=new MineOperations(mapData);snapshot=engine.snapshot();}
 world.loadMap(mapData);$('mapDescription').textContent=mapData.description||`${mapData.nodes.length} узлов · ${mapData.edges.length} дорог`;
 selectMap(mapData); update(snapshot);toast(`Карта «${mapData.name}» загружена. ${mapData.nodes.length} узлов, ${mapData.edges.length} дорог.`);
}
function paintChart(history){
 const c=$('trend'),ctx=c.getContext('2d');if(!ctx)return;const W=c.width,H=c.height;ctx.clearRect(0,0,W,H);
 const data=history.length?history:[{time:0,tonnes:0,processed:0}];const pad={l:59,r:16,t:14,b:26},w=W-pad.l-pad.r,h=H-pad.t-pad.b;
 const max=Math.max(120,...data.flatMap(x=>[x.tonnes,x.processed]))*1.09;ctx.lineWidth=1;ctx.font='13px Arial';ctx.fillStyle='#7c9da7';ctx.strokeStyle='#28404c';
 for(let k=0;k<=4;k++){const y=pad.t+h*k/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(W-pad.r,y);ctx.stroke();ctx.fillText(fmt(max*(4-k)/4),5,y+4);}
 const draw=(key,color)=>{ctx.strokeStyle=color;ctx.lineWidth=3.4;ctx.lineJoin='round';ctx.beginPath();data.forEach((p,i)=>{const x=pad.l+(data.length===1?0:i/(data.length-1))*w,y=pad.t+h-p[key]/max*h;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();};
 draw('tonnes','#4fdcc0');draw('processed','#f0ab60');
 ctx.fillStyle='#71919e';ctx.fillText(`${fmt(data[0].time)} с`,pad.l,H-5);ctx.fillText(`${fmt(data[data.length-1].time)} с`,W-73,H-5);
}
function update(s){if(!s)return;const m=s.metrics,g=s.geology;
 $('simClock').textContent=new Date(s.time*1000).toISOString().slice(11,19);$('shift').textContent=`СМЕНА ${s.shift}`;
 $('kpiOre').innerHTML=`${fmt(m.tonnes,1)} <i>т</i>`;$('kpiProcessed').innerHTML=`${fmt(m.processed,1)} <i>т</i>`;$('kpiActive').innerHTML=`${m.moving} <i>/ ${s.fleet.length}</i>`;$('kpiQueued').textContent=`${m.queued} у объектов · ${m.paused} ограничено`;$('kpiSafety').innerHTML=`${fmt(g.fs,2)} <i>FS</i>`;$('kpiSafetyInfo').textContent=g.status.toUpperCase();$('kpiCO2').innerHTML=`${fmt(m.co2Kg,1)} <i>кг</i>`;
 $('riskValue').textContent=fmt(g.fs,2);$('riskState').textContent=g.status.toUpperCase();$('riskWater').textContent=`${fmt(g.water*100)}%`;$('riskCracks').textContent=`${fmt(g.cracks*100)}%`;$('riskVibration').textContent=`${fmt(g.vibration*100)}%`;$('riskFill').style.width=`${Math.max(0,Math.min(100,(g.fs-.7)/.85*100))}%`;
 $('riskFlag').textContent=g.status==='stable'?'НОРМА':'ТРЕВОГА';$('riskCard').className=`risk-card ${['critical','collapsed'].includes(g.status)?'risk-critical':g.status==='warning'?'risk-warning':''}`;
 $('riskMeaning').textContent=g.failed?'Обвал: нужна расчистка после осушения.':g.status==='critical'?'Превентивное закрытие уступа: маршруты пересчитаны.':g.status==='warning'?'Рост повреждений: рекомендуется дренаж или укрепление.':'Датчики в пределах учебного безопасного диапазона.';
 $('kpiSafety').style.color=g.fs<1.1?'#ff8c7b':'';
 let flags=0;for(const name of actionFlags){const btn=document.querySelector(`button[data-action="${name}"]`);if(!btn)continue;const active=s.flags[name];btn.classList.toggle('active',active);btn.querySelector('em').textContent=active?'ON':'OFF';if(active)flags++;}
 for(const name of ['ai','safety']){const btn=document.querySelector(`button[data-action="${name}"]`);btn.classList.toggle('active',s.flags[name]);btn.querySelector('em').textContent=s.flags[name]?'ON':'OFF';}
 $('scenarioCount').textContent=`${flags} АКТИВНО`;
 $('roadLabel').textContent=`${mapData?.edges.length||0} ДОРОГ · ${s.blocked.length?`${s.blocked.length} ЗАКРЫТО`: 'МАРШРУТЫ ОТКРЫТЫ'}`;
 $('roadLabel').style.color=s.blocked.length?'#ff9882':'';
 $('cost').textContent=`${fmt(m.cost)} ₸`;$('litres').textContent=`${fmt(m.dieselLitres,1)} л`;$('energy').textContent=`${fmt(m.energyKwh,1)} кВт·ч`;$('downtime').textContent=`${fmt(m.lostSeconds)} с`;$('routes').textContent=m.dispatchChanges;
 $('envDust').textContent=`${fmt(m.dust)}%`;$('envVisibility').textContent=`${fmt(m.visibility)}%`;$('dustFill').style.width=`${m.dust}%`;$('visibilityFill').style.width=`${m.visibility}%`;
 $('assetList').innerHTML=Object.values(s.assets).map(a=>`<div class="asset-row"><span><b>${esc(a.id)}</b><small>${esc(a.state)}</small></span><strong class="${a.state==='offline'?'alert':''}">${a.state==='offline'?'● OFFLINE':a.health+'% HEALTH'}</strong></div>`).join('');
 $('fleetBody').innerHTML=s.fleet.map(t=>`<tr data-id="${esc(t.id)}"><td>${esc(t.id)}</td><td>${esc(statusNames[t.status]||t.status)}</td><td>${esc(t.route||t.target||'нет маршрута')}</td><td>${fmt(t.speed,1)} км/ч</td><td>${fmt(t.payload)} т</td><td><span class="fuel-bar"><i style="width:${t.fuel}%"></i></span>${fmt(t.fuel)}%</td><td>${t.trips}</td><td class="${t.warnings.length?'td-alert':''}">${esc(t.warnings.join(' • ')||'OK')}</td></tr>`).join('');
 $('events').innerHTML=s.events.slice(0,18).map(e=>`<div class="event ${e.level==='danger'?'danger':e.level==='warning'?'warning':''}">${esc(e.message)}<small>${new Date(e.at*1000).toISOString().slice(11,19)} · ${esc(e.level.toUpperCase())}</small></div>`).join('');
 paintChart(s.history);world.update(s);
}
async function doAction(action){try{if(remote){const result=await request('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});snapshot=result.state;}
 else{engine.action(action);snapshot=engine.snapshot();}update(snapshot);}
 catch(e){toast(`Ошибка сценария: ${e.message}`,true);}}
function selectMap(m){const select=$('mapSelect');const custom=select.querySelector('option[data-custom]');if(custom)custom.remove();if(!(m.id in presetFiles)){const o=document.createElement('option');o.value=m.id;o.textContent=`CUSTOM / ${m.name||m.id}`;o.dataset.custom='true';select.add(o);}select.value=m.id;}
async function init(){try{
 const preset=await loadPreset('saryarka');let health=null;
 try{health=await request('/api/health',{signal:AbortSignal.timeout(1000)});}catch{}
 remote=Boolean(health?.service==='mirage-server');
 if(remote){const state=await request('/api/state');const activeMap=await request('/api/map');mapData=validateMap(activeMap);snapshot=state;}
 else{mapData=preset;engine=new MineOperations(mapData);snapshot=engine.snapshot();}
 world.loadMap(mapData);$('mapDescription').textContent=mapData.description||'';selectMap(mapData);
 $('connection').textContent=remote?'NODE ENGINE CONNECTED':'LOCAL SIMULATION';$('backendState').textContent=remote?'Node → MQTT → OpenEgiz (при MQTT_HOST)':'локальный движок · без MQTT';
 update(snapshot);
 if(remote)setInterval(async()=>{try{snapshot=await request('/api/state');if(snapshot.mapId!==mapData.id){mapData=validateMap(await request('/api/map'));world.loadMap(mapData);selectMap(mapData);$('mapDescription').textContent=mapData.description||'';}update(snapshot);$('connection').textContent='NODE ENGINE CONNECTED';}catch{ $('connection').textContent='SERVER DISCONNECTED';}},900);
 }catch(e){toast(`Не удалось запустить симулятор: ${e.message}`,true);console.error(e);}}
$('mapSelect').addEventListener('change',async e=>{try{await openMap(await loadPreset(e.target.value));}catch(err){toast(err.message,true);}});
$('mapUpload').addEventListener('change',async e=>{try{const f=e.target.files?.[0];if(!f)return;if(f.size>1024*1024)throw Error('JSON не должен превышать 1 МБ.');const map=JSON.parse(await f.text());await openMap(map);}catch(err){toast(`Карта отклонена: ${err.message}`,true);}finally{e.target.value='';}});
document.querySelectorAll('button[data-action]').forEach(b=>b.addEventListener('click',()=>doAction(b.dataset.action)));
$('btnTop').addEventListener('click',()=>world.overhead());$('btnDay').addEventListener('click',e=>{e.currentTarget.textContent=world.setNight()?'☼ День':'☾ Ночь';});
$('btnPause').addEventListener('click',async e=>{try{paused=!paused;if(remote){const result=await request('/api/pause',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paused})});paused=result.paused;}e.currentTarget.textContent=paused?'▶ Продолжить':'Ⅱ Пауза';}catch(err){toast(err.message,true);}});
$('rate').addEventListener('input',async e=>{rate=Number(e.target.value);$('rateValue').textContent=`×${rate}`;if(remote){try{await request('/api/rate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rate})});}catch(err){toast(err.message,true);}}});
$('fleetBody').addEventListener('click',e=>{const id=e.target.closest('tr[data-id]')?.dataset.id;if(!id)return;const t=snapshot?.fleet.find(t=>t.id===id);world.focus(t?.position);toast(`Камера следует за ${id}: ${statusNames[t?.status]||t?.status}`);});
$('btnForecast').addEventListener('click',async()=>{const change=$('forecastScenario').value;const btn=$('btnForecast');btn.disabled=true;btn.textContent='Расчёт сценариев…';try{const r=remote?await request('/api/forecast',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({change,horizon:180})}):engine.forecast(180,change);
 const cols=[['Доставка','tonnes','т'],['Переработка','processed','т'],['Дизельный CO₂','co2Kg','кг'],['Простои','lostSeconds','с'],['Затраты','cost','₸']];$('forecastResult').innerHTML=`<div>Горизонт: ${r.horizon} игровых секунд</div><table><thead><tr><th>ПОКАЗАТЕЛЬ</th><th>БАЗА</th><th>СЦЕНАРИЙ</th></tr></thead><tbody>${cols.map(([label,key,unit])=>`<tr><td>${label}</td><td>${fmt(r.baseline[key],1)}</td><td><b>${fmt(r.alternative[key],1)}</b> ${unit}</td></tr>`).join('')}</tbody></table><p>${esc(r.note)}</p>`;
 }catch(e){toast(`Ошибка прогноза: ${e.message}`,true);}finally{btn.disabled=false;btn.textContent='✧ Рассчитать 180 игровых секунд';}});
function downloadFile(name,data,mime){const blob=new Blob([data],{type:mime}),url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
$('btnSnapshot').addEventListener('click',()=>downloadFile('mirage-snapshot.json',JSON.stringify({schemaVersion:1,map:mapData,state:snapshot},null,2),'application/json'));
$('btnExport').addEventListener('click',()=>{if(!snapshot)return;const data=snapshot.history,keys=['time','tonnes','processed','grade','moving','queued','paused','dieselLitres','co2Kg','energyKwh','cost','dust','visibility','fs','trips','lostSeconds'];const lines=[keys.join(';'),...data.map(x=>keys.map(k=>String(x[k]??'').replace('.',',')).join(';'))];downloadFile('mirage-telemetry.csv','\ufeff'+lines.join('\r\n'),'text/csv;charset=utf-8');});
function frame(now){requestAnimationFrame(frame);const dt=Math.min(.1,(now-(frame.prev??now))/1000);frame.prev=now; if(!remote&&engine&&!paused){engine.step(dt*rate);snapshot=engine.snapshot();}
 if(snapshot){world.update(snapshot);if(now-lastDraw>330){update(snapshot);lastDraw=now;}}
 world.render();} requestAnimationFrame(frame);
init();
