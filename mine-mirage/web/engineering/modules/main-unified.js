/** MINE//MIRAGE 2.0 — ONE operational engine for fleet, roads, weather, incidents and 3D.
 * GPU-free rendering on the working Vite port; never starts the old server or a second simulator.
 * The original four-truck project remains at /classic.html.
 */
import {MineOperations} from './operations.js';
import {createControlCenter} from './control-center.js';
import {validateMap} from './network.js';
import {b as MineWorld} from '/assets/world-DU5ZngHg.js';
const [saryarka,altai]=await Promise.all(['/data/maps/saryarka.json','/data/maps/altai.json'].map(async path=>{const response=await fetch(path);if(!response.ok)throw Error('Карта недоступна: '+path);return response.json();}));

const $ = id => document.getElementById(id);
const fmt = (v,d=1) => Number(v??0).toLocaleString('ru-RU',{maximumFractionDigits:d,minimumFractionDigits:d});
const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const modes = {towing:'Эвакуация',hauling:'К дробилке',returning:'Возвращается в забой',loading:'Погрузка',dumping:'Разгрузка',refueling:'Заправка',repairing:'Технический ремонт',to_fuel:'К АЗС',to_workshop:'В мастерскую',stranded:'Остановлен'};
const presetMaps = {saryarka,altai};
const buttons = {gpsButton:'gpsFault',weightButton:'weightFault',rainButton:'rain',blastButton:'blast',drainButton:'drainage',reinforceButton:'reinforce',clearRoadButton:'clear'};
const toggleActions = ['predictive','potholes','partsShortage','nightShift','rain','fog','heat','dustSuppression','crusherFault','crusherBFault','loaderFault','roadworks','powerFault','fuelShortage','gpsFault','weightFault','drainage','ai','safety'];
let engine, currentMap, paused=false,selectedId=null,drawError=false,platform=false,remoteSnapshot=null,remotePollBusy=false;
const source=document.createElement('span');source.className='platform-source';source.id='sourceStatus';document.querySelector('.top-right').prepend(source);
let lab;
async function post(url,data){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(15000)});const body=await r.json();if(!r.ok)throw Error(body.error||`HTTP ${r.status}`);return body;}

const clockText=seconds=>`${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(Math.floor(seconds)%60).padStart(2,'0')}`;
const clock = {last:performance.now(),lastRender:0,lastUI:0};
// Keep the previously working 3D map, camera and equipment, but build geometry
// from the SAME graph that drives route planning and sensor estimation.
const world = new MineWorld($('scene'),{software:true});

async function setMap(raw){
  if(platform){validateMap(raw);await post('/api/map',raw);source.textContent='Карта принята, ожидаем данные Ditto…';return;}
  const checked = validateMap(raw); // invalid upload leaves existing simulation untouched
  const fresh = new MineOperations(checked);
  world.loadMap(checked);
  engine=fresh;currentMap=checked;paused=false;selectedId=null;drawError=false;
  $('pauseButton').textContent='Ⅱ Пауза';
  $('mapHealth').textContent=`✓ ${checked.nodes.length} узлов · ${checked.edges.length} дорог · ${engine.trucks.length} машин`;
  $('mapHealth').style.color='#65d8b8';
  $('fleetCount').textContent=engine.trucks.length;
  const grades=Array.from(engine.net.edges.values()).filter(e=>e.grade>.10);
  $('roadAudit').textContent=grades.length?`⚠ ${grades.length} участков с уклоном > 10%; максимум ${fmt(Math.max(...grades.map(e=>e.grade))*100)}%. Требуется инженерная проверка.`:'Дорожные уклоны ≤ 10%';
  $('forecastOutput').textContent='Новая карта запущена. Прогноз не влияет на текущий карьер.';
  renderUI(engine.snapshot());renderWorld();
}

function act(action){
  if(!engine)return;
  if(platform){post('/api/action',{action}).then(r=>{if(r.result===false&&!toggleActions.includes(action))$('forecastOutput').textContent='Действие отклонено. Причина — в журнале событий.';}).catch(e=>$('forecastOutput').textContent=e.message);return;}
  const result=engine.action(action);
  renderUI(engine.snapshot());
  renderWorld();
  if(result===false && !toggleActions.includes(action)){
    $('forecastOutput').textContent=engine.events[0]?.message??'Действие отклонено';
  }
}
for(const [id,action] of Object.entries(buttons))$(id).addEventListener('click',()=>act(action));
for(const button of document.querySelectorAll('[data-action]'))button.addEventListener('click',()=>act(button.dataset.action));
$('pauseButton').addEventListener('click',()=>{
  paused=!paused;$('pauseButton').textContent=paused?'▶ Продолжить':'Ⅱ Пауза';
  document.querySelector('.status-row').classList.toggle('paused',paused);
  if(platform)post('/api/pause',{paused}).catch(e=>$('forecastOutput').textContent=e.message);
});
$('resetButton').addEventListener('click',()=>{if(currentMap)setMap(currentMap).catch(showMapError);});
$('speed').addEventListener('input',()=>{$('speedValue').textContent=`×${$('speed').value}`;if(platform)post('/api/rate',{rate:Number($('speed').value)}).catch(e=>$('forecastOutput').textContent=e.message);});
$('topView').addEventListener('click',()=>{world.overhead();renderWorld();});
$('mapSelect').addEventListener('change',async e=>{try{await setMap(presetMaps[e.target.value]);}catch(err){showMapError(err);}});
$('mapFile').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    if(file.size>1_000_000)throw Error('Файл слишком большой: максимум 1 МБ для дорожной схемы.');
    const raw=JSON.parse(await file.text());await setMap(raw);presetMaps.custom=validateMap(raw);
    const select=$('mapSelect');
    let opt=select.querySelector('option[value="custom"]');
    if(!opt){opt=document.createElement('option');opt.value='custom';select.append(opt);}
    opt.textContent=`ЗАГРУЖЕНА · ${(raw.name||file.name).slice(0,35)}`;select.value='custom';
  }catch(err){showMapError(err);}finally{e.target.value='';}
});
function showMapError(error){$('mapHealth').style.color='#ff9b93';$('mapHealth').textContent=`✕ ${error.message}`;}
$('fleet').addEventListener('click',e=>{
  const id=e.target.closest('[data-vehicle]')?.dataset.vehicle;
  if(!id)return;selectedId=id;const truck=engine.snapshot().fleet.find(t=>t.id===id);
  if(truck)world.focus(truck.gpsPosition||truck.position);
  renderUI(engine.snapshot());renderWorld();
});

function download(name,text,mime){const a=document.createElement('a'),blob=new Blob([text],{type:mime}),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
$('csvExport').addEventListener('click',()=>{
  if(!engine)return;const s=engine.snapshot(), keys=['time','tonnes','processed','moving','queued','energyKwh','co2Kg','dieselLitres','cost','dust','visibility','fs','trips','dispatchChanges','lostSeconds','maintenanceCost','maintenanceDue','inWorkshop','avgEngineHealth','avgTyreHealth','safetyStops'];
  const records=[...s.history,s.metrics];
  const body=[keys.join(';'),...records.map(r=>keys.map(k=>String(r[k]??'').replace('.',',')).join(';'))].join('\r\n');
  download('mirage-telemetry.csv','\ufeff'+body,'text/csv;charset=utf-8');
});
$('forecastRun').addEventListener('click',()=>{
  if(!engine)return;const button=$('forecastRun');button.disabled=true;button.textContent='Считаю…';
  // Give the UI one paint frame. Forecast is deterministic and works on clones.
  setTimeout(async()=>{
    try{
      const horizon=Number($('forecastHorizon').value);const r=await engine.forecast(horizon,$('forecastSelect').value);
      const rows=[['Доставка, т','tonnes'],['Переработка, т','processed'],['Простои, с','lostSeconds'],['Стоимость ТО, ₸','maintenanceCost'],['Извлечено Cu, т','copperTonnes'],['Вода в процессе, м³','waterUsed'],['CO₂, кг','co2Kg'],['Затраты, ₸','cost']];
      $('forecastOutput').innerHTML=`<b>${r.horizon} модельных секунд · тот же карьер и будущие события:</b><div class="forecast-cells">`+
        rows.map(([label,key])=>`<div><small>${label}</small><strong>${fmt(r.baseline[key])} → ${fmt(r.alternative[key])}</strong></div>`).join('')+'</div>'+
        `<span>${esc(r.note)}</span>`;
    }catch(e){$('forecastOutput').textContent=`Ошибка прогноза: ${e.message}`;}
    finally{button.disabled=false;button.textContent='✦ Рассчитать варианты';}
  },20);
});

function drawChart(snap){
  const canvas=$('proChart');const rect=canvas.getBoundingClientRect();
  const w=Math.max(300,Math.round(rect.width)),h=125;
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,w,h);
  ctx.strokeStyle='#25404b';ctx.lineWidth=1;
  for(let i=1;i<5;i++){const y=i*h/5;ctx.beginPath();ctx.moveTo(26,y);ctx.lineTo(w-13,y);ctx.stroke();}
  const data=[...snap.history,snap.metrics].filter((x,i,a)=>i===0||x.time!==a[i-1].time);
  const tail=data.slice(-80);if(tail.length<2)return;
  const ceiling=Math.max(10,...tail.map(v=>Math.max(v.tonnes,v.processed)))*1.08;
  for(const [key,color] of [['tonnes','#54d9ad'],['processed','#edb268']]){
    ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=2.5;
    tail.forEach((v,i)=>{const x=29+i/(tail.length-1)*(w-48),y=(h-12)-(v[key]||0)/ceiling*(h-22);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();
  }
  ctx.fillStyle='#b3c6cc';ctx.font='10px monospace';ctx.fillText('т',10,16);ctx.fillText(`Добыча: ${fmt(snap.metrics.tonnes)} т`,w-185,16);
}

function renderUI(snap){
  if(!snap)return;
  const m=snap.metrics,g=snap.geology;
  $('simulationLabel').textContent=paused?'СИМУЛЯЦИЯ НА ПАУЗЕ':'СИМУЛЯЦИЯ АКТИВНА';$('simulationBadge').textContent=paused?'PAUSE':'LIVE';document.querySelector('.status-row').classList.toggle('paused',paused);
  $('delivered').innerHTML=`${fmt(m.tonnes)} <small>т</small>`;
  $('processed').innerHTML=`${fmt(m.processed)} <small>т</small>`;
  $('hopper').innerHTML=`${fmt(m.hopper)} <small>т</small>`;
  $('warnings').textContent=snap.fleet.reduce((n,t)=>n+t.warnings.length,0)+(g.status==='critical'||g.failed?1:0);
  $('costKpi').textContent=`${fmt(m.cost,0)} ₸`; $('co2Kpi').textContent=`${fmt(m.co2Kg)} кг`;
  $('fuelKpi').textContent=`${fmt(m.dieselLitres)} л`; $('energyKpi').textContent=`${fmt(m.energyKwh)} кВт·ч`;
  $('movingKpi').textContent=`${m.moving} / ${m.queued}`;$('dispatchKpi').textContent=m.dispatchChanges;
  $('dueKpi').textContent=m.maintenanceDue;$('shopKpi').textContent=m.inWorkshop;
  $('maintenanceKpi').textContent=`${fmt(m.maintenanceCost,0)} ₸`;
  $('engineHealthKpi').textContent=`${fmt(m.avgEngineHealth)}%`;
  $('safetyKpi').textContent=m.safetyStops;
  const names={stable:'● СКЛОН СТАБИЛЕН',warning:'⚠ ПРЕДУПРЕЖДЕНИЕ',critical:'⛔ КРИТИЧЕСКИЙ РИСК',collapsed:'🔴 ОБВАЛ'};
  $('slopeState').textContent=names[g.status]??g.status;
  $('slopeSafety').textContent=`FS* ${fmt(g.fs,2)}`;
  $('slopeWater').textContent=`${Math.round(g.water*100)}%`;
  $('slopeCracks').textContent=`${Math.round(g.cracks*100)}%`;
  $('slopeVibration').textContent=`${Math.round(g.vibration*100)}%`;
  $('slopePanel').dataset.risk=g.status;
  $('slopeBarFill').style.width=`${Math.max(0,Math.min(100,(g.fs-.7)/.85*100))}%`;
  $('slopeExplanation').textContent=g.failed?'Обвал: после осушения можно расчищать. Движение перенаправлено.':g.status==='critical'?'Риск критический: опасная дорога закрыта автоматически при включённой автоблокировке.':g.status==='warning'?'Мониторинг трещин: включите дренаж и укрепление до опасной фазы.':'Уступ стабилен. Следите за дождём, техногенной вибрацией и нагрузкой от техники.';
  $('roadStatus').textContent=g.failed?'⛔ ОБВАЛ · МАРШРУТ ПЕРЕКРЫТ':g.status==='critical'&&snap.flags.safety?'⛔ ПРЕВЕНТИВНОЕ ЗАКРЫТИЕ ОПАСНОГО УЧАСТКА':snap.blocked.length?`⚠ ЗАКРЫТО ДОРОГ: ${snap.blocked.length}`:'✓ МАРШРУТЫ ПЕРЕСЧИТЫВАЮТСЯ ПО ДОРОЖНОМУ ГРАФУ';
  $('roadStatus').classList.toggle('hazard',snap.blocked.length>0);
  $('blockedTime').textContent=`${fmt(m.lostSeconds)} с`; $('detourCount').textContent=snap.fleet.filter(t=>t.reverse||t.warnings.some(w=>w.includes('ОБЪЕЗД'))).length;
  $('gpsStatus').textContent=snap.flags.gpsFault?'ON':'OFF';$('weightStatus').textContent=snap.flags.weightFault?'ON':'OFF';
  $('rainStatus').textContent=snap.flags.rain?'ON':'OFF';$('drainStatus').textContent=snap.flags.drainage?'ON':'OFF';
  $('reinforceStatus').textContent=snap.flags.reinforced?'DONE':'OFF';
  $('landslideStatus').textContent=g.failed?'READY?':'WAIT';
  for(const [id,action] of Object.entries(buttons))$(id).classList.toggle('active',!!snap.flags[action]||(action==='clear'&&g.failed));
  for(const button of document.querySelectorAll('[data-action]')){
    const action=button.dataset.action,flag=snap.flags[action];
    button.classList.toggle('active',!!flag);
    if(toggleActions.includes(action))button.querySelector('em').textContent=flag?'ON':'OFF';
  }
  $('clock').textContent=clockText(snap.time);
  $('fleet').innerHTML=snap.fleet.map(t=>`<div class="vehicle-card ${t.warnings.length?'has-alert':''} ${t.id===selectedId?'selected':''}" data-vehicle="${esc(t.id)}" tabindex="0" role="button" aria-label="Следить за ${esc(t.id)}"><div class="vehicle-top"><b>${esc(t.id)}</b><span class="vehicle-state">${t.warnings.length?'● WARNING':'● ONLINE'}</span></div><div class="vehicle-body"><span>🚛</span><div><strong>${modes[t.status]??esc(t.status)}</strong><small>${t.gpsOk?`Скорость: ${fmt(t.speed)} км/ч`:`GPS: оценка ±${fmt(t.uncertainty)} м`}</small></div></div><div class="route-line">→ ${esc(t.target||'—')} ${t.route?`· ${esc(t.route)}`:''}</div><div class="vehicle-footer"><span>Груз <b>${fmt(t.payload)} т</b></span><span>Топливо <b>${fmt(t.fuel)}%</b></span></div>${t.warnings.length?`<div class="alert-label">⚠ ${t.warnings.map(esc).join(' · ')}</div>`:''}</div>`).join('');
  const suggestions=snap.advisories||[];
  $('advisories').innerHTML=suggestions.length?suggestions.map(a=>`<div class="advice-item"><div><b>${esc(a.title)}</b><small>${esc(a.reason)}</small><small>${esc(a.note)}</small></div><button type="button" data-recommend="${esc(a.action)}">Действие ↗</button></div>`).join(''):'<small style="color:#9cc3b9">Критических отклонений нет. Мониторинг продолжается; реальные параметры ещё требуют калибровки.</small>';
  const detailed=snap.fleet.find(t=>t.id===selectedId)||snap.fleet[0];
  if(detailed){
    const titles={engine:'Двигатель',drivetrain:'Трансмиссия',brakes:'Тормоза',tyres:'Шины',suspension:'Подвеска',cooling:'Охлаждение',electrical:'Электрика',hydraulics:'Гидравлика'};
    const comps=Object.entries(detailed.components||{}).map(([key,value])=>`<div class="inspection-parameter" data-low="${value<60}" data-danger="${value<30}"><div><span>${titles[key]??esc(key)}</span><b>${fmt(value)}%</b></div><div class="inspection-bar"><span style="width:${Math.max(0,Math.min(100,value))}%"></span></div></div>`).join('');
    $('truckDetails').innerHTML=`<div class="inspection-header"><b>${esc(detailed.id)}</b><span>${esc(modes[detailed.status]||detailed.status)}</span><span>Риск ТО: ${detailed.priority}/150+</span><span>Обслуживаний: ${detailed.serviceCount}</span>${detailed.maintenanceDue?'<span style="color:#f0a177">⚠ Требуется ТО</span>':''}</div><div class="inspection-grid">${comps}</div><div class="inspection-readings"><span>Моточасы ${fmt(detailed.engineHours)} ч</span><span>Двигатель ${fmt(detailed.engineTempC)} °C</span><span>Тормоза ${fmt(detailed.brakeTempC)} °C</span><span>Давление масла ${fmt(detailed.oilPressureKpa)} кПа</span><span>Шины ${fmt(detailed.tyrePressureKpa)} кПа</span><span>Аккумулятор ${fmt(detailed.batteryVoltageV)} В</span></div>${detailed.diagnostic.length?`<div class="alert-label">⚠ ${detailed.diagnostic.map(esc).join(' · ')}</div>`:''}`;
  }
  $('events').innerHTML=snap.events.slice(0,20).map(e=>`<div class="event-item"><span class="event-dot ${e.level==='warning'?'danger':esc(e.level)}"></span><div><span>${esc(e.message)}</span><small>${clockText(e.at)} · ${esc(e.level)}</small></div></div>`).join('');
  drawChart(snap);lab?.render(snap);
  document.querySelector('.breadcrumb').textContent=`ОПЕРАЦИОННЫЙ ЦЕНТР / ${snap.fleet.length} МАШИН / ${Object.keys(snap.oreBlocks||{}).length} ЗАБОЯ / ${Object.keys(snap.lines).length} ДРОБИЛКИ`;
  $('qualityNote').textContent=platform?'Источник отображения: Eclipse Ditto · MQTT → Ditto → UI':'Автономный режим · данные рассчитывает этот браузер';
}
$('advisories').addEventListener('click',e=>{const action=e.target.closest('[data-recommend]')?.dataset.recommend;if(action)act(action);});
$('fleet').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.closest('[data-vehicle]'))e.target.closest('[data-vehicle]').click();});
function renderWorld(){
  if(!engine||drawError||document.hidden)return;
  try{world.update(engine.snapshot());world.render();}catch(e){
    drawError=true;$('roadStatus').textContent=`3D-рендер не загружен: ${e.message}. Симуляция продолжает работать.`;
    console.error('MINE//MIRAGE 3D fallback:',e);
  }
}
// A static :5173 remains autonomous. In platform mode only Ditto supplies rendered data.
lab=createControlCenter({getEngine:()=>engine,act,download,isPlatform:()=>platform,post,restore:async(fresh,data)=>{
 if(platform){await post('/api/run',data);return;}
 world.loadMap(fresh.map);engine=fresh;currentMap=fresh.map;paused=true;selectedId=null;drawError=false;$('pauseButton').textContent='▶ Продолжить';renderUI(engine.snapshot());renderWorld();
}});
async function pollPlatform(){
 if(remotePollBusy)return;remotePollBusy=true;
 try{
  const r=await fetch('/api/state',{signal:AbortSignal.timeout(5000)});const d=await r.json();if(!r.ok)throw Error(d.error||'Платформа недоступна');
  if(!d.snapshot||!d.map)throw Error('Ожидаем первый снимок MQTT → Ditto');
  const sig=JSON.stringify(d.map);
  if(!currentMap||JSON.stringify(currentMap)!==sig){currentMap=validateMap(d.map);world.loadMap(currentMap);drawError=false;$('mapHealth').textContent=`✓ ${currentMap.nodes.length} узлов · ${currentMap.edges.length} дорог · Ditto`;$('fleetCount').textContent=d.snapshot.fleet.length;$('roadAudit').textContent='Геометрия из конфигурации карты';}
  remoteSnapshot=d.snapshot;paused=d.paused;$('pauseButton').textContent=paused?'▶ Продолжить':'Ⅱ Пауза';$('speed').value=d.speed;$('speedValue').textContent='×'+d.speed;
  engine={map:currentMap,snapshot:()=>remoteSnapshot,forecast:(horizon,change)=>post('/api/forecast',{horizon,change}),events:remoteSnapshot.events};
  $('bridgeStatus').textContent=d.stale?'⚠ DITTO: устаревшие данные':'● MQTT → DITTO → UI · LIVE';$('bridgeStatus').style.color=d.stale?'#f0a86a':'#64d5a7';
  source.textContent=d.stale?'⚠ DITTO: данные устарели':`● OPENEGIZ / DITTO · #${d.sequence}`;source.classList.toggle('source-stale',d.stale);renderUI(remoteSnapshot);renderWorld();
 }catch(e){source.textContent='⚠ OPENEGIZ: '+e.message;source.classList.add('source-stale');}finally{remotePollBusy=false;}
}
async function boot(){
 // Static servers return 404 or HTML for this URL. Only an explicit platform config selects it.
 try{const r=await fetch('/api/config',{signal:AbortSignal.timeout(1400)});if(r.ok){const c=await r.json();platform=c.mode==='platform';}}catch{}
 if(platform){source.textContent='OPENEGIZ: ожидание данных…';await pollPlatform();setInterval(pollPlatform,1500);}
 else {source.textContent='● АВТОНОМНЫЙ РЕЖИМ · 3.1';await setMap(saryarka);}
}
boot().catch(e=>{showMapError(e);source.textContent='Ошибка запуска: '+e.message;});
// Updating max four times per second bounds CPU rasterization, even for 14+ vehicles.
const timer=setInterval(()=>{
  const now=performance.now();const dt=Math.min(.4,(now-clock.last)/1000);clock.last=now;
  if(!engine)return;
  if(!platform&&!paused)engine.step(dt*Number($('speed').value));
  if(!document.hidden && now-clock.lastRender>=240){renderWorld();clock.lastRender=now;}
  if(now-clock.lastUI>=470){renderUI(engine.snapshot());clock.lastUI=now;}
},125);
// Optional push only, preserving the autonomous working site on port 5173.
// It does NOT instantiate a second simulation. No bridge means no connectivity, not an error.
const bridgeTimer=setInterval(async()=>{
  if(!engine||platform||document.hidden)return;
  try{
    const response=await fetch('http://127.0.0.1:8788/ingest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(engine.snapshot()),signal:AbortSignal.timeout(1800)});
    $('bridgeStatus').textContent=response.ok?'● TELEMETRY BRIDGE · LIVE':'⚠ МОСТ: ответ '+response.status;
    $('bridgeStatus').style.color=response.ok?'#64d5a7':'#f0a86a';
  }catch{
    $('bridgeStatus').textContent='● ТЕЛЕМЕТРИЯ: автономно / без Docker';
    $('bridgeStatus').style.color='';
  }
},4000);
window.addEventListener('beforeunload',()=>{clearInterval(timer);clearInterval(bridgeTimer);});
