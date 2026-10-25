import {SCENARIOS} from '../live/modules/operations.js';
import {PLAYBOOKS} from '../live/modules/scenarios.js';
import saryarka from '../live/maps/saryarka.js';
import altai from '../live/maps/altai.js';
import {MineScene} from './mine-scene.js';
import {BLAST_PHASES} from '../live/modules/blast-cycle.js';
import {installSceneView} from './scene-view.js';
const BUILD_ID='OPENEGIZ-2026-platform-backed';
console.info('MINE//MIRAGE BUILD',BUILD_ID);
const $=id=>document.getElementById(id);
const MAPS={saryarka,altai};
let currentMap='saryarka',snapshot=null,lastPlatformPoll=0,pollBusy=false,platformError='';
let scene=null,sceneLoaded=false,simulationRunning=true,simRate=1,lastReal=performance.now(),uiTime=0,chartTime=0,activeTruck='HT-01',activeTab='diagnostic',eventFilter='all',quality='normal',navPage='overview';
let compactLabels=true;
let chartHistory=[{t:0,mined:0,processed:0}],recsDone=new Set(),modalOpen=false,pinsTime=0,lastFPS=0,draws=0,frameProbe=performance.now(),displayCameraPin=true;
const COMPONENTS=[['engine','Двигатель'],['drivetrain','Трансмиссия'],['brakes','Тормоза'],['tyres','Шины'],['suspension','Подвеска'],['cooling','Система охлаждения'],['electrical','Электрика'],['hydraulics','Гидравлика']];
const STATUSES={loading:'На погрузке',hauling:'К дробилке',returning:'Возврат в забой',dumping:'Разгрузка',to_fuel:'К заправке',refueling:'Заправляется',to_workshop:'В сервис',repairing:'Обслуживание',to_depot:'К ночной стоянке',parked:'Стоянка · техника выключена',stranded:'Остановлен',towing:'Эвакуация',idle:'Ожидание'};
const format=(v,d=0)=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:d});
const money=v=>`${format(v)} ₸`;
const safe=x=>String(x??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const rateBtns=[...document.querySelectorAll('[data-rate]')];
const modal=$('modalBackdrop'),modalBody=$('modalBody');
// Authoritative snapshots are read from Eclipse Ditto through the same-origin proxy.
// No local MineOperations engine runs in the browser.
async function pullFromDitto(){
  if(pollBusy)return false;
  pollBusy=true;
  try{
    const response=await fetch('/api/twin',{cache:'no-store'});
    if(!response.ok)throw Error(`Ditto not ready (${response.status})`);
    const data=await response.json();
    if(!data.snapshot?.fleet||!data.snapshot?.metrics)throw Error('Invalid Ditto snapshot');
    snapshot=data.snapshot;platformError='';
    if(snapshot.mapId&&currentMap!==snapshot.mapId){
      currentMap=snapshot.mapId;
      const select=$('mapSelect');if(select)select.value=currentMap;
      scene?.buildMap(MAPS[currentMap]);
    }
    scene?.update(snapshot);
    return true;
  }catch(error){platformError=error.message;console.warn('Ditto snapshot:',error.message);return false;}
  finally{pollBusy=false;}
}
async function awaitDitto(){
  for(let attempt=0;attempt<120;attempt++){
    if(await pullFromDitto())return;
    $('mapSceneStatus').textContent=`ECLIPSE DITTO: ожидание телеметрии (${attempt+1})`;
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  throw Error('Нет данных цифровых двойников Eclipse Ditto: '+platformError);
}
async function platformCommand(action){
  const r=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});
  const data=await r.json();if(!r.ok)throw Error(data.error||'Command failed');return data.applied;
}
async function platformControl(operation,extra={}){
  const r=await fetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,...extra})});
  const data=await r.json();if(!r.ok)throw Error(data.error||'Control failed');return data;
}

const allActions=new Map(SCENARIOS.map(([id,name,desc])=>[id,{name,desc}]));
function notify(str){const d=document.createElement('div');d.className='toast';d.textContent=str;$('toasts').append(d);setTimeout(()=>d.remove(),3500);}
async function init(){
  try {
    await awaitDitto();
    scene=new MineScene($('sceneMount'));
    installSceneView(scene);
    scene.buildMap(MAPS[currentMap]);scene.update(snapshot);
    scene.loadModels().then(()=>{sceneLoaded=true;notify('GLB: буровой станок обновлён и анимирован в 3D-сцене');}).catch(err=>console.warn(err));
    $('mapSceneStatus').textContent='OPENEGIZ · ДАННЫЕ ИЗ ECLIPSE DITTO';
    if(new URLSearchParams(window.location.search).has('debugRoads'))$('mapModeInfo').textContent='Аудит: бирюзовый = путь, жёлтый = уклон требует проверки';
  } catch(e){console.error(e);$('mapSceneStatus').textContent='Ошибка запуска OpenEgiz/WebGL: '+e.message;notify('Ошибка подключения к Eclipse Ditto: '+e.message);return;}
  attachUI();renderUI();requestAnimationFrame(frame);
}
function attachUI(){
  $('mapSelect').onchange=e=>changeMap(e.target.value);
  $('openScenariosTop').onclick=()=>showScenarios();
  $('weatherBtn').onclick=()=>runAction('rain');
  $('playBtn').onclick=async()=>{try{await platformControl('toggle');simulationRunning=!simulationRunning;refreshPlayButton();notify(simulationRunning?'Симуляция продолжена':'Симуляция поставлена на паузу');}catch(e){notify(e.message);}};
  $('resetBtn').onclick=async()=>{try{await platformControl('reset');await pullFromDitto();renderUI();notify('Команда сброса отправлена в OpenEgiz');}catch(e){notify(e.message);}};
  rateBtns.forEach(btn=>btn.onclick=async()=>{try{simRate=Number(btn.dataset.rate);await platformControl('speed',{rate:simRate});rateBtns.forEach(x=>x.classList.toggle('on',x===btn));notify(`Ускорение серверной симуляции: ×${simRate}`);}catch(e){notify(e.message);}});
  $('topViewBtn').onclick=()=>{scene?.fitCamera(true);$('topViewBtn').classList.add('current');$('isoViewBtn').classList.remove('current');$('mapModeInfo').textContent='Вид сверху · нажатие и масштаб';};
  $('isoViewBtn').onclick=()=>{scene?.fitCamera(false);$('isoViewBtn').classList.add('current');$('topViewBtn').classList.remove('current');$('mapModeInfo').textContent='Объёмный карьер · 3D';};
  $('cameraResetBtn').onclick=()=>{scene?.fitCamera(false);notify('Камера возвращена к общему плану');};
  $('mapQualityBtn').onclick=()=>{quality=quality==='normal'?'low':'normal';scene?.setQuality(quality);notify(`Графика: ${quality==='low'?'экономный режим':'стандартное качество'}`);};
  $('toggleLabelsBtn').onclick=()=>{compactLabels=!compactLabels;$('toggleLabelsBtn').classList.toggle('current',!compactLabels);updateMapPins();notify(compactLabels?'Метки: только важные':'Метки: все объекты');};
  $('focusTruckBtn').onclick=()=>{scene?.followTruck(activeTruck);notify(`${activeTruck}: камера следует за машиной. Видны колёса и кузов.`);};
  $('focusExcavatorBtn').onclick=()=>{scene?.focusFacility('face-north');notify('Показана механика стрелы, рукояти и ковша экскаватора.');};
  $('focusCrusherBtn').onclick=()=>{scene?.focusFacility('crusher-a');notify('Показана работа дробилки и конвейерной зоны.');};
  $('focusBlastBtn').onclick=()=>{scene?.focusBlast();notify('Буровой участок: 3D-модель бурового станка и учебная сетка скважин.');};
  $('openBlastMap').onclick=showBlast;
  $('vehiclePrevBtn').onclick=()=>cycleTruck(-1);$('vehicleNextBtn').onclick=()=>cycleTruck(1);
  [...document.querySelectorAll('.seg-tabs [data-tab]')].forEach(b=>b.onclick=()=>{activeTab=b.dataset.tab;renderVehicle();});
  $('eventFilters').onclick=e=>{const b=e.target.closest('[data-filter]');if(!b)return;eventFilter=b.dataset.filter;renderEvents();};
  $('showJournalBtn').onclick=()=>openModal('Журнал событий',renderJournalModal());
  $('settingsBtn').onclick=()=>showSettings();
  document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('[data-nav]').forEach(x=>x.classList.toggle('active',x===b));
    navPage=b.dataset.nav;
    const handler={overview:()=>{closeModal();scene?.fitCamera(false);},dispatch:showDispatch,fleet:showFleet,scenarios:showScenarios,blast:showBlast,analytics:showAnalytics,maintenance:showMaintenance,journal:()=>openModal('Журнал событий',renderJournalModal()),settings:showSettings}[navPage];handler?.();
  });
  $('modalClose').onclick=closeModal;
  modal.onclick=e=>{if(e.target===modal)closeModal();};
  window.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();if(e.code==='Space'&&!modalOpen&&e.target.tagName!=='BUTTON'){e.preventDefault();$('playBtn').click();}});
}
function refreshPlayButton(){$('playBtn').textContent=simulationRunning?'❚❚':'▶';$('simState').textContent=simulationRunning?'активно':'пауза';}
function frame(t){
  const elapsed=Math.max(0,Math.min(.12,(t-lastReal)/1000));lastReal=t;
  if(scene){scene.running=simulationRunning;scene.animationRate=5*simRate;}
  if(t-lastPlatformPoll>1400){lastPlatformPoll=t;pullFromDitto().then(ok=>{if(ok)renderUI();});}
  uiTime+=elapsed;chartTime+=elapsed;
  if(chartTime>.95){const last=chartHistory.at(-1);if(snapshot.time-last.t>6){chartHistory.push({t:snapshot.time,mined:snapshot.metrics.tonnes,processed:snapshot.metrics.processed});if(chartHistory.length>85)chartHistory.shift();}chartTime=0;}
  if(uiTime>.45){renderUI();uiTime=0;}
  if(t-frameProbe>1400){lastFPS=Math.round(draws*1000/(t-frameProbe));draws=0;frameProbe=t;}
  draws++;
  if(t-pinsTime>115){updateMapPins();pinsTime=t;}
  requestAnimationFrame(frame);
}
async function changeMap(id){
  if(!MAPS[id])return;
  try{
    await platformControl('map',{map:id});
    chartHistory=[{t:0,mined:0,processed:0}];recsDone.clear();activeTruck='HT-01';
    simulationRunning=true;refreshPlayButton();
    await pullFromDitto();renderUI();
    notify('Карта переключена на сервере; состояние обновляется из Ditto.');
  }catch(e){notify(e.message);console.error(e);}
}
async function runAction(id){
  try{
    const applied=await platformCommand(id);
    const name=allActions.get(id)?.name||PLAYBOOKS.find(x=>'playbook:'+x.id===id)?.name||id;
    $('scenarioTitle').textContent=name;
    notify(applied?`Отправлено в OpenEgiz: ${name}`:`Действие не применено: ${name}`);
    closeModal();
    await pullFromDitto();renderUI();
  }catch(e){console.error(e);notify('Не удалось отправить в OpenEgiz: '+e.message);}
}
function hms(sec){sec=Math.floor(sec);const hours=String(Math.floor(sec/3600)).padStart(2,'0'),mins=String(Math.floor(sec%3600/60)).padStart(2,'0'),s=String(sec%60).padStart(2,'0');return `${hours}:${mins}:${s}`;}
function renderUI(){
  const m=snapshot.metrics;
  $('simClock').textContent=hms(snapshot.time);$('simState').textContent=simulationRunning?'активно':'пауза';
  $('kpiMined').innerHTML=`${format(m.tonnes)} <em>т</em>`;
  $('kpiProcessed').innerHTML=`${format(m.processed)} <em>т</em>`;
  $('kpiGrade').innerHTML=`${format(m.grade,2)} <em>%</em>`;
  $('kpiFuel').innerHTML=`${format(m.dieselLitres,1)} <em>л</em>`;
  $('kpiAvail').innerHTML=`${format(m.availabilityPct,1)} <em>%</em>`;
  $('kpiMove').textContent=`В движении: ${m.moving}`;
  $('kpiTrips').textContent=format(m.trips);
  $('kpiDispatch').textContent=`Переназначений: ${m.dispatchChanges}`;
  $('kpiQueue').textContent=format(m.queued);
  $('kpiCost').textContent=`Расходы: ${money(m.cost)}`;
  const weather=snapshot.flags.rain?'Ливень':snapshot.flags.fog?'Туман':snapshot.flags.heat?'Жара':'Ясно';
  $('weatherText').textContent=weather;$('weatherIcon').textContent=snapshot.flags.rain?'☂':snapshot.flags.fog?'≋':snapshot.flags.heat?'☀':'☀';
  $('perfStatus').textContent=scene?.fps?`${scene.fps} FPS · ${scene.lowPower?'ECO':'WEBGL'}${scene.lowPower?'':' · цель 60'}`:'WEBGL';
  const chosen=snapshot.fleet.find(t=>t.id===activeTruck);$('animState').textContent=chosen?`${activeTruck}: ${chosen.status==='dumping'?'разгрузка и подъём кузова':chosen.speed>0.5?'колёса вращаются по пробегу':'колёса стоят'} · ${format(chosen.speed,1)} км/ч`:'Рейсовая анимация техники';
  renderVehicle();renderEvents();renderAdvice();renderChart();renderBlastLive();
}
function cycleTruck(delta){const fleet=snapshot.fleet,i=fleet.findIndex(t=>t.id===activeTruck);activeTruck=fleet[(i+delta+fleet.length)%fleet.length].id;renderVehicle();updateMapPins();}
function selectTruck(id,follow=false){activeTruck=id;renderVehicle();updateMapPins();if(follow)scene?.followTruck(id);}
function renderVehicle(){
  const t=snapshot.fleet.find(t=>t.id===activeTruck)||snapshot.fleet[0];if(!t)return;activeTruck=t.id;
  $('vehicleId').textContent=t.id;$('vehicleState').textContent=STATUSES[t.status]||t.status;
  $('vehicleState').classList.toggle('off',['stranded','towing'].includes(t.status));
  $('vehicleCapacity').textContent=`${format(t.capacity)} т`;
  $('vehiclePayload').textContent=`${format(t.payload,1)} т`;
  $('vehicleTarget').textContent=t.target||'Нет назначения';
  $('vehicleWork').textContent=`${format(t.workMetrics.distanceKm,1)} км`;
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===activeTab));
  const diag=COMPONENTS.map(([k,name])=>{const v=t.components[k]||0;return `<div class="diag-row"><label title="${name}">${name}</label><div class="meter"><i class="${v<45?'bad':v<78?'mid':''}" style="width:${v}%"></i></div><strong>${format(v,1)}%</strong></div>`;}).join('');
  const note=`<div class="diagnostics-bottom"><span>Мощность: <b>${format(t.performance.availablePowerKw)} кВт</b></span><span>Дизель: <b>${format(t.fuel,1)}%</b></span><span>Темп. двигателя: <b>${format(t.engineTempC)} °C</b></span><span>Транспортная работа: <b>${format(t.workMetrics.tonneKm,1)} т·км</b></span></div>`;
  if(activeTab==='diagnostic')$('vehicleTabContent').innerHTML=diag+note;
  if(activeTab==='route')$('vehicleTabContent').innerHTML=`<div class="vehicle-route"><h3>Назначение: ${safe(t.target||'Ожидание')}</h3><p>Текущая операция: ${safe(STATUSES[t.status]||t.status)}</p><p>Скорость: <strong>${format(t.speed,1)} км/ч</strong></p><p>Гружёный пробег: ${format(t.workMetrics.loadedKm,1)} км</p><p>Порожний пробег: ${format(t.workMetrics.emptyKm,1)} км</p><p>GPS: ${t.gpsOk?'сигнал исправен':'сигнал потерян; оценка положения'}</p><button class="icon-btn" id="focusSelected" style="width:100%;font-size:12px">Найти на карте</button></div>`;
  if(activeTab==='route')$('focusSelected').onclick=()=>scene?.followTruck(t.id);
  if(activeTab==='jobs')$('vehicleTabContent').innerHTML=`<h3>Рабочее задание</h3><p>Перевезено: ${format(t.workMetrics.tonneKm)} т·км</p><p>Моточасы: ${format(t.engineHours,1)} ч</p><p>Остаток топлива: ${format(t.fuel,1)}%</p><p>Заменённых узлов: ${format(t.serviceCount)}</p><button id="runPreventive" class="icon-btn" style="font-size:11px;width:100%">Назначить плановое ТО</button>`;
  if(activeTab==='jobs')$('runPreventive').onclick=()=>runAction('preventive');
  const rep=t.lastServiceReport;
  if(rep){const p=rep.performance;$('repairContent').innerHTML=`<div class="repair-pair"><div><small>До обслуживания</small><strong>${format(p.before.availablePowerKw)} кВт</strong><small>Потенциал ${format(p.before.productiveCapacityPct,1)}%</small></div><div><small>После обслуживания</small><strong>${format(p.after.availablePowerKw)} кВт</strong><small>Прирост +${format(p.powerKwGain)} кВт</small></div></div><div class="repair-note">Заменено: ${safe(rep.parts.map(x=>COMPONENTS.find(i=>i[0]===x)?.[1]||x).join(', ')||'осмотр')}. Стоимость: ${money(rep.cost)}. Потенциал скорости +${format(p.possibleSpeedPercentGain,1)}%. ${safe(p.disclaimer||'')}</div>`;}
  else $('repairContent').innerHTML='<p>Ещё не было завершённого обслуживания. Запусти неисправность и назначь ТО — здесь появятся реальные расчёты «до/после».</p>';
}
function eventSeverity(e){return e.level==='danger'?'critical':e.level==='warning'?'warn':'';}
function filteredEvents(){return (snapshot.events||[]).filter(e=>eventFilter==='all'||(eventFilter==='warning'?['warning','danger'].includes(e.level):e.level===eventFilter)).slice(0,24);}
function renderEvents(){const events=filteredEvents().slice(0,6);$('eventsList').innerHTML=events.map(e=>{
  const time=hms(e.at);const parts=e.message.match(/(HT-\d+|CR-\d+|EX-\d+|Дробилка \w|АЗС)/);
  const id=parts?.[0]||'MIRAGE';return `<div class="event-row"><i class="${eventSeverity(e)}"></i><time>${time.slice(3)}</time><b>${safe(id)}</b><span>${safe(e.message).slice(0,130)}</span></div>`;
}).join('')||'<p class="repair-note" style="padding:12px">Нет событий этой категории</p>';
  document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===eventFilter));}
function renderAdvice(){const list=snapshot.advisories||[];
  const defaults=[{priority:2,title:'Контроль состояния транспорта',note:'Следите за доступной мощностью и износом машин',action:'inspection',reason:'Рекомендуется диагностика парка'}];
  $('adviceList').innerHTML=(list.length?list:defaults).slice(0,4).map((a,i)=>{
    const done=recsDone.has(a.title),critical=a.priority===1;
    return `<div class="advice-item"><i class="${critical?'danger':''}">${critical?'!':'i'}</i><div><b>${safe(a.title)}</b><small>${safe(a.reason||a.note)}. ${safe(a.note||'')}</small></div><button data-advice="${i}" ${done?'disabled':''}>${done?'Учтено':'Принять'}</button></div>`;
  }).join('');
  $('adviceList').querySelectorAll('[data-advice]').forEach(b=>b.onclick=()=>{
    const a=(list.length?list:defaults)[Number(b.dataset.advice)];
    if(!a)return;
    if(allActions.has(a.action)){recsDone.add(a.title);runAction(a.action);}
    else{notify('Рекомендация принята к сведению; автоматическое действие не предусмотрено');recsDone.add(a.title);renderAdvice();}
  });
}
function renderChart(){
  const samples=chartHistory.slice(-25);const w=390,h=151,top=12,bottom=26,left=37;const max=Math.max(100,...samples.map(s=>Math.max(s.mined,s.processed)))*1.10;
  const cell=(w-left-8)/Math.max(1,samples.length),bar=cell*.28;
  const y=v=>h-bottom-(v/max)*(h-bottom-top);
  let svg=`<svg viewBox="0 0 ${w} ${h}" aria-label="График добычи и переработки">`;
  for(let k=0;k<4;k++){const value=max*k/3,yp=y(value);svg+=`<line x1="${left}" y1="${yp}" x2="${w}" y2="${yp}" stroke="#23516b" stroke-dasharray="4 4"/><text x="3" y="${yp+4}" fill="#8ebbd4" font-size="10">${format(value)}</text>`;}
  samples.forEach((s,i)=>{const x=left+i*cell;svg+=`<rect x="${x}" y="${y(s.mined)}" width="${bar}" height="${h-bottom-y(s.mined)}" fill="#23aaf4"/><rect x="${x+bar+1}" y="${y(s.processed)}" width="${bar}" height="${h-bottom-y(s.processed)}" fill="#28df9d"/>`;});
  svg+=`<text x="${left}" y="${h-3}" fill="#8ebbd4" font-size="10">0</text><text x="${w-45}" y="${h-3}" fill="#8ebbd4" font-size="10">T+${format(snapshot.time/60)} мин</text></svg>`;
  $('productionChart').innerHTML=svg;
}
function updateMapPins(){if(!scene||!snapshot)return;
  const pins=[];
  for(const [idx,t] of snapshot.fleet.entries()){
    const critical=t.status==='stranded'||t.health<40;
    if(compactLabels && t.id!==activeTruck && !critical && idx%3!==0)continue;
    const visual=scene.truckPosition(t.id);
    const p=visual||{x:t.position.x,y:(t.position.elevation??0)+1.35,z:t.position.z};
    const screen=scene.project(p.x,p.y+25,p.z);
    if(!screen.visible)continue;
    const warning=t.health<68;
    pins.push({id:t.id,x:screen.x,y:screen.y,cls:critical?'critical':warning?'warn':'',html:`<b>${t.id}</b><small>${format(t.speed,1)} км/ч · ${safe(STATUSES[t.status]||t.status)}</small>`,entity:t.id});
  }
  for(const n of scene.map?.nodes||[]){if(!['face','crusher','fuel','workshop','depot','power','weigh'].includes(n.kind))continue;
    if(compactLabels && !['face','crusher','workshop','fuel','depot','power','weigh'].includes(n.kind))continue;
    const facilityRoot=scene.facilityRoots?.get?.(n.id);
    const fx=facilityRoot?.position?.x ?? n.x, fy=(facilityRoot?.position?.y ?? (n.elevation||0))+44, fz=facilityRoot?.position?.z ?? n.z;
    const screen=scene.project(fx,fy,fz);if(!screen.visible)continue;
    pins.push({id:n.id,x:screen.x,y:screen.y,cls:'facility',html:`<b>${safe(n.name)}</b>`,entity:n.id});
  }
  if(snapshot.geology.fs<1.0){const e=scene.map?.edges.find(e=>e.id==='RAMP-04');if(e){const p=scene.roadCurve(e,.48),screen=scene.project(p.x,p.y+42,p.z);if(screen.visible)pins.push({id:'hazard',x:screen.x,y:screen.y,cls:'hazard',html:'⚠ Опасный уступ',entity:'hazard'});}}
  // Fewer but readable map pins: selected truck first; avoid overlapping labels.
  pins.sort((a,b)=>Number(b.id===activeTruck)-Number(a.id===activeTruck)||Number(b.cls==='facility')-Number(a.cls==='facility'));
  const placed=[];
  const visiblePins=[];
  for(const pin of pins){
    const near=placed.some(p=>Math.abs(p.x-pin.x)<110&&Math.abs(p.y-pin.y)<35);
    if(near && pin.id!==activeTruck)continue;
    placed.push(pin);visiblePins.push(pin);
  }
  const parent=$('mapPins');const existing=new Map([...parent.children].map(e=>[e.dataset.pin,e]));
  const ids=new Set();
  for(const pin of visiblePins){ids.add(pin.id);let node=existing.get(pin.id);
    if(!node){node=document.createElement('button');node.dataset.pin=pin.id;node.onclick=()=>{if(pin.entity.startsWith('HT'))selectTruck(pin.entity,true);else if(pin.entity==='hazard')runAction('drainage');else notify('Объект: '+pin.id);};parent.appendChild(node);}
    node.className='map-pin '+pin.cls+(pin.id===activeTruck?' active':'');node.innerHTML=pin.html;
    node.style.left=`${Math.round(pin.x)}px`;node.style.top=`${Math.round(pin.y)}px`;
  }
  for(const [id,node] of existing)if(!ids.has(id))node.remove();
}
function openModal(title,body){$('modalTitle').textContent=title;modalBody.innerHTML=body;modal.classList.remove('hidden');modalOpen=true;}
function closeModal(){modal.classList.add('hidden');modalOpen=false;}
function showScenarios(){const groups=[
  ['Погода и геология',['rain','fog','heat','blast','drainage','reinforce','clear','roadworks','potholes','nightShift','microquake']],
  ['Оборудование и производство',['crusherFault','crusherBFault','loaderFault','powerFault','pumpFault','beltFault','fuelShortage','waterShortage','partsShortage','repair']],
  ['Износ, ТО и машины',['lowTyrePressure','coolingLeak','brakeFailure','tyreFault','oilPressure','hydraulicFault','alternatorFault','airFilter','overload','preventive','predictive','inspection','tow','gradeRoad']],
  ['Телеметрия и безопасность',['gpsFault','gpsJump','radioFault','weightFault','worker','wind','safety','ai']],
  ['Прочие сценарии',SCENARIOS.map(s=>s[0]).filter(id=>!['rain','fog','heat','blast','drainage','reinforce','clear','roadworks','potholes','nightShift','microquake','crusherFault','crusherBFault','loaderFault','powerFault','pumpFault','beltFault','fuelShortage','waterShortage','partsShortage','repair','lowTyrePressure','coolingLeak','brakeFailure','tyreFault','oilPressure','hydraulicFault','alternatorFault','airFilter','overload','preventive','predictive','inspection','tow','gradeRoad','gpsFault','gpsJump','radioFault','weightFault','worker','wind','safety','ai'].includes(id))]
];
  let html=`<div style="color:#90b6c9;margin-bottom:10px">Действия меняют тот же расчётный карьер, который показан в 3D. Физические и экономические последствия рассчитываются движком.</div>`;
  html+=`<h4 class="modal-group-title">Составные аварийные цепочки</h4><div class="modal-grid">${PLAYBOOKS.map(p=>`<button class="action-tile" data-action="playbook:${safe(p.id)}"><strong>⚑ ${safe(p.name)}</strong><small>${safe(p.description||'Последовательный сценарий аварий')}</small></button>`).join('')}</div>`;
  for(const [title,ids] of groups){const known=ids.filter(id=>allActions.has(id));if(!known.length)continue;
    html+=`<h4 class="modal-group-title">${title}</h4><div class="modal-grid">${known.map(id=>{const a=allActions.get(id);return `<button class="action-tile" data-action="${id}"><strong>${safe(a.name)}</strong><small>${safe(a.desc||'')}</small></button>`;}).join('')}</div>`;
  }
  openModal('Планы и аварийные сценарии',html);
  modalBody.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>runAction(b.dataset.action));
}

function showBlast(){
  const b=snapshot.blast;
  openModal('Буровзрывные работы · MWD и фрагментация',`
    <div class="blast-headline"><div><small>СЕВЕРНЫЙ ЗАБОЙ · УЧЕБНАЯ 3D-МОДЕЛЬ</small><h3 id="bvrPhase">—</h3><p id="bvrReason">—</p></div><div class="blast-phase-ring" id="bvrProgress">0 / 20</div></div>
    <div class="blast-cards"><div><small>MWD: индекс крепости</small><strong id="bvrHardness">—</strong><span>Модельный показатель, 0–100</span></div><div><small>Мелкая фракция</small><strong id="bvrFine">—</strong><span>Индекс фрагментации</span></div><div><small>Крупная фракция</small><strong id="bvrCoarse">—</strong><span>Выше → труднее дробить</span></div><div><small>Завершено циклов</small><strong id="bvrCycles">—</strong><span>Смена / выбранная карта</span></div></div>
    <div class="blast-action-row"><button id="bvrStart" class="bvr-primary">▶ Запустить учебный цикл</button><button id="bvrCancel">Отменить подготовку</button><button id="bvrFocus">◎ Участок в 3D</button></div>
    <p class="blast-steps">Бурение и MWD <b>→</b> контроль готовности <b>→</b> эвакуация и блокировка <b>→</b> учебный взрыв <b>→</b> осмотр <b>→</b> изменение фрагментации.</p>
    <div class="blast-cols"><section><h4>Сетка скважин · 4 × 5</h4><div class="blast-hole-grid" id="bvrGrid"></div><div class="blast-key"><span>● Запланирована</span><span>● Пробурена</span><span>● Готова</span><span>● Взорвана</span></div><p>Сетка схематическая. Геометрия, реальные расстояния, глубины, заряды и задержки не задаются.</p></section>
    <section><h4>MWD · параметры бурения</h4><div class="blast-mwd-table"><table class="data-table"><thead><tr><th>Скважина</th><th>Крепость</th><th>Проходка</th><th>Момент</th></tr></thead><tbody id="bvrMWD"></tbody></table></div></section></div>
    <div class="blast-effects"><h4>Связь с производством</h4><p>После цикла фрагментация оставшейся породы северного забоя влияет на темп погрузки и удельную нагрузку дробилки. Показатели рассчитываются движком симуляции, а не подставляются в интерфейсе.</p><div id="bvrImpact"></div></div>
    <p class="blast-caution">Все значения MWD, доли фракций и эффекты на производительность — синтетические демонстрационные данные. Не использовать для планирования реальных буровзрывных работ.</p>`);
  $('bvrStart').onclick=async()=>{try{const result=await platformCommand('blast');await pullFromDitto();renderBlastLive();notify(result?'БВР: команда отправлена в OpenEgiz.':'БВР: запуск отклонён движком.');}catch(e){notify(e.message);}};
  $('bvrCancel').onclick=async()=>{try{const result=await platformCommand('cancelBlast');await pullFromDitto();renderBlastLive();notify(result?'БВР: отмена отправлена в OpenEgiz.':'БВР: отмена недоступна.');}catch(e){notify(e.message);}};
  $('bvrFocus').onclick=()=>{closeModal();scene?.focusBlast();};
  renderBlastLive();
}
function renderBlastLive(){
  const b=snapshot?.blast;if(!b)return;
  $('blastMapStatus').textContent=BLAST_PHASES[b.phase]||b.phase;
  if(!modalOpen||!$('bvrPhase'))return;
  $('bvrPhase').textContent=BLAST_PHASES[b.phase]||b.phase;
  $('bvrReason').textContent=b.reason||((b.phase==='idle'&&b.completed)?'Предыдущий цикл завершён; доступен повторный опыт.':
    b.phase==='drilling'?'Буровой станок регистрирует параметры породы.':
    b.phase==='charging'?'Условная готовность скважин без параметров взрывчатых веществ.':
    b.phase==='countdown'?'Техника и персонал должны находиться вне контролируемой зоны.':
    b.phase==='ventilation'?'Идёт проверка и временное ограничение погрузки.': 'Доступен запуск демонстрационного процесса.');
  $('bvrProgress').textContent=`${b.drilled} / ${b.holes.length}`;
  $('bvrHardness').textContent=b.hardnessIndex==null?'Нет MWD':`${b.hardnessIndex} / 100`;
  $('bvrFine').textContent=`${format(b.fragmentation*100,1)} %`;
  $('bvrCoarse').textContent=`${b.coarsePct} %`;
  $('bvrCycles').textContent=String(b.completed);
  $('bvrStart').disabled=b.phase!=='idle'||snapshot.geology.failed;
  $('bvrCancel').disabled=['idle','ventilation'].includes(b.phase);
  $('bvrGrid').innerHTML=b.holes.map(h=>`<div class="blast-hole ${safe(h.status)}" title="${safe(h.id)} · индекс крепости ${h.rockIndex}"><b>●</b><small>${safe(h.id.replace('MWD-',''))}</small></div>`).join('');
  $('bvrMWD').innerHTML=b.holes.map(h=>`<tr><td>${safe(h.id)}</td><td>${h.status==='planned'?'—':h.rockIndex}</td><td>${h.status==='planned'?'—':h.penetrationIndex}</td><td>${h.status==='planned'?'—':h.torqueIndex}</td></tr>`).join('');
  const loading=Math.round((.67+.67*b.fragmentation)*100);
  const crusher=Math.round(100/(1.35-.5*b.fragmentation));
  $('bvrImpact').innerHTML=`<div class="blast-effect-line"><span>Коэффициент погрузки фрагментированной породы</span><strong>×${format(loading/100,2)}</strong></div><div class="blast-effect-line"><span>Индекс дробления (без учёта крепости)</span><strong>${crusher} / 100</strong></div><p>Реальная пропускная способность также зависит от содержания руды, исходной крепости, очередей и состояния оборудования.</p>`;
}
function renderJournalModal(){return `<table class="data-table"><thead><tr><th>Время</th><th>Уровень</th><th>Событие</th></tr></thead><tbody>${snapshot.events.map(e=>`<tr><td>${hms(e.at)}</td><td>${safe(e.level)}</td><td>${safe(e.message)}</td></tr>`).join('')}</tbody></table>`;}
function showFleet(){openModal('Парк техники',`<table class="data-table"><thead><tr><th>Машина</th><th>Операция</th><th>Скорость</th><th>Ресурс</th><th>Дизель</th><th></th></tr></thead><tbody>${snapshot.fleet.map(t=>`<tr><td>${t.id}</td><td>${safe(STATUSES[t.status]||t.status)}</td><td>${format(t.speed,1)} км/ч</td><td>${format(t.health,1)}%</td><td>${format(t.fuel,1)}%</td><td><button data-fleet="${t.id}">Показать</button></td></tr>`).join('')}</tbody></table>`);
  modalBody.querySelectorAll('[data-fleet]').forEach(b=>b.onclick=()=>{selectTruck(b.dataset.fleet,true);closeModal();});}
function showDispatch(){const m=snapshot.metrics;openModal('Оперативная диспетчеризация',`<p>Логистика связывает 20 узлов, 34 участка и ${snapshot.fleet.length} машин. Машины переназначаются по ограничениям дорожного графа.</p><table class="data-table"><tbody><tr><td>Машин в движении</td><td>${m.moving}</td></tr><tr><td>В очереди</td><td>${m.queued}</td></tr><tr><td>Переназначений</td><td>${m.dispatchChanges}</td></tr><tr><td>Перевезено</td><td>${format(m.tonnes)} т</td></tr><tr><td>Расчётный простой</td><td>${format(m.lostSeconds)} с</td></tr><tr><td>Закрытые дороги</td><td>${snapshot.blocked.length}</td></tr></tbody></table><div style="margin-top:16px;display:flex;gap:12px"><button data-dispatch="ai" class="action-tile">Алгоритмический диспетчер</button><button data-dispatch="safety" class="action-tile">Автоблокировка опасных дорог</button></div>`);modalBody.querySelectorAll('[data-dispatch]').forEach(b=>b.onclick=()=>runAction(b.dataset.dispatch));}
function showAnalytics(){const m=snapshot.metrics;openModal('Инженерная аналитика',`<p>Все значения — модельные показатели симуляции, а не показатели реального предприятия.</p><table class="data-table"><tbody>${[['Добыто руды',format(m.tonnes)+' т'],['Переработано',format(m.processed)+' т'],['Содержание меди',format(m.grade,2)+' %'],['Получено Cu',format(m.copperTonnes,2)+' т'],['Дизель',format(m.dieselLitres)+' л'],['Себестоимость',money(m.unitCost)],['Ремонтные расходы',money(m.maintenanceCost)],['Баланс массы',format(m.massError,3)+' т'],['Баланс воды',format(m.waterError,3)],['Баланс дизеля',format(m.fuelBalanceError,3)]].map(([a,b])=>`<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody></table><p>Подробный анализ: <a href="./engineering.html" target="_blank" style="color:#42cafa">Инженерная лаборатория ↗</a></p>`);}
function showMaintenance(){openModal('ТО и ремонты',`<p>Износ восьми агрегатов рассчитывается по фактической модельной работе машины: пробег, груз, моточасы, температура и качество дорог.</p><table class="data-table"><thead><tr><th>Самосвал</th><th>Состояние</th><th>Пробег</th><th>Техобслуживание</th><th>Отчёт</th></tr></thead><tbody>${snapshot.fleet.map(t=>`<tr><td>${t.id}</td><td>${format(t.health,1)}%</td><td>${format(t.workMetrics.distanceKm,1)} км</td><td>${t.serviceCount}</td><td>${t.lastServiceReport?'Есть':'Нет'}</td></tr>`).join('')}</tbody></table><button class="action-tile" data-action="preventive" style="margin-top:16px">Назначить приоритетное ТО</button>`);modalBody.querySelector('[data-action]').onclick=()=>runAction('preventive');}
function showSettings(){openModal('Настройки и режимы',`<div class="settings-row"><label>Качество 3D</label><select id="qualitySelect"><option value="normal">Стандартное (30 FPS)</option><option value="low">Низкое (экономный режим)</option></select></div><div class="settings-row"><label>Карьер</label><select id="modalMapSelect"><option value="saryarka">Сарыарка</option><option value="altai">Алтай</option></select></div><p>Используются локальные GLB-модели. Расчётный движок работает на сервере OpenEgiz, телеметрия поступает через MQTT в Eclipse Ditto.</p><p>В этом конкурсном режиме данные интерфейса поступают из Eclipse Ditto через OpenEgiz. Без платформы симулятор не стартует.</p>`);
  $('qualitySelect').value=quality;$('qualitySelect').onchange=e=>{quality=e.target.value;scene?.setQuality(quality);notify('Режим графики сохранён для текущей сессии');};
  $('modalMapSelect').value=currentMap;$('modalMapSelect').onchange=e=>{changeMap(e.target.value);$('mapSelect').value=e.target.value;closeModal();};
}
init();
