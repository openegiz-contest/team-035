import {initProduction,loadOre,waterStep,processOre,productionMetrics,PROCESS,add,emptyCargo} from './production.js';
import {EXTRA_SCENARIOS,PLAYBOOKS} from './scenarios.js';
import {MODEL,initCondition,advanceCondition,conditionSpeedFactor,maintenancePriority,performServiceStep,chooseServiceParts,COMPONENT_NAMES} from './engineering.js';
import {clamp,validateMap,createNetwork,shortestPath,interpolate} from './network.js';
import {FUEL_BASELINE} from './fuel-calibration.js';
import {createBlastState,completeBlast,loadingFragmentationFactor} from './blast-cycle.js';
import {weatherFactors} from './weather-impact.js';
export const SCENARIOS = [...EXTRA_SCENARIOS,
 ['rain','Ливень','Насыщение уступа + снижение сцепления'],
 ['fog','Туман','Снижение видимости и скорости'],
 ['heat','Жара','Перегрев, пыль и износ шин'],
 ['crusherFault','Отказ дробилки A','Очередь → переназначение потока'],
 ['loaderFault','Отказ северного экскаватора','Простой → южный забой'],
 ['powerFault','Авария энергосети','Остановка переработки и потери'],
 ['roadworks','Ремонт центральной дороги','Алгоритм строит альтернативы'],
 ['gpsFault','GPS-отказ Truck-02','Счисление пути + расширение ошибки'],
 ['weightFault','Ложный датчик веса Truck-01','Сверка с балансом погрузки'],
 ['fuelShortage','Нехватка дизеля','Ограничение работы заправки'],
 ['blast','Буровзрывные работы','Скважины → MWD → подготовка → безопасный цикл → фрагментация'],
 ['drainage','Включить дренаж','Снижение водонасыщения'],
 ['reinforce','Укрепить уступ','Снижение геомеханического риска'],
 ['clear','Расчистить после обвала','Безопасное восстановление'],
 ['repair','Отремонтировать аварии','Восстановить питание и технику'],
 ['ai','Умная диспетчеризация','Выбор маршрутов и очередей'],
 ['dustSuppression','Поливочная машина','Пыль → видимость → скорость → вода и затраты'],
 ['crusherBFault','Отказ дробилки B','Резервная линия перестаёт принимать руду'],
 ['tyreFault','Разрыв шины HT-03','Остановка самосвала → мастерская → очереди'],
 ['microquake','Микросейсмический толчок','Рост трещин → запрет движения по опасному уступу'],
 ['potholes','Разбитая дорога','Удары в подвеску → шины → скорость'],
 ['gradeRoad','Грейдер','Выравнивание повреждённых дорог → затраты'],
 ['lowTyrePressure','Падение давления HT-05','Сопротивление качению → расход и износ'],
 ['brakeFailure','Износ тормозов HT-04','Рост температуры → аварийная остановка'],
 ['coolingLeak','Течь охлаждения HT-06','Перегрев двигателя → ограничение мощности'],
 ['oilLeak','Падение давления масла HT-07','Риск повреждения двигателя'],
 ['hydraulicLeak','Гидравлика HT-08','Ускоренный износ и обслуживание'],
 ['electricalFault','Генератор HT-09','Падение напряжения и работа датчиков'],
 ['overload','Перегруз HT-01','Износ шин/подвески → топливо → риск'],
 ['partsShortage','Нехватка запасных частей','Очередь на ТО и простой'],
 ['predictive','Предиктивное ТО','Автоматически направлять машины на сервис'],
 ['preventive','Назначить плановое ТО','Обслужить наиболее изношенную машину'],
 ['inspection','Диагностика парка','Измеренные моделью параметры и приоритет ремонта'],
 ['nightShift','Ночная смена','Видимость, безопасная скорость и освещение'],
 ['filterClog','Забитый воздушный фильтр HT-10','Пыль → потери мощности → ТО'],
 ['tow','Эвакуатор','Забрать остановленную машину → ремонт'],
];
const kinds = n => n.kind;
const truckLabel = i=>`HT-${String(i+1).padStart(2,'0')}`;
const round=(n,d=1)=>Number(n.toFixed(d));
export class MineOperations {
  constructor(map, seed=35035){
    this.map=validateMap(map);this.net=createNetwork(this.map);this.faceIds=this.map.nodes.filter(n=>n.kind==='face').map(n=>n.id);this.crusherIds=this.map.nodes.filter(n=>n.kind==='crusher').map(n=>n.id);this.initialSeed=seed>>>0;this.seed=this.initialSeed;this.reset();
  }
  random(){this.seed=(Math.imul(1664525,this.seed)+1013904223)>>>0;return this.seed/4294967296;}
  log(message,level='info'){
    this.events.unshift({at:round(this.time),message,level});this.events.length=Math.min(90,this.events.length);
  }
  reset(){
    this.seed=this.initialSeed;this.fuelRates={...FUEL_BASELINE};this.accumulator=0;this.schedule=[];this.playbook=null;this.jobs=[];this.blast={phase:'idle',timer:0,reason:'',completed:0};this.worker=false;this.wind=false;this.spareParts=Object.fromEntries(Object.keys(COMPONENT_NAMES).map(k=>[k,3]));
    this.time=0;this.history=[];this.events=[];this.lastSample=0;this.totalOre=0;this.processed=0;this.copper=0;
    this.fuelConsumed=0;this.co2Kg=0;this.cost=0;this.energyKwh=0;this.lostSeconds=0;
    this.hopper=Object.fromEntries(this.crusherIds.map((id,i)=>[id,i===0?55:35]));this.gradeFeed=Object.fromEntries(this.crusherIds.map((id,i)=>[id,i%2?.79:.68]));
    this.faults={rain:false,fog:false,heat:false,crusherFault:false,crusherBFault:false,loaderFault:false,powerFault:false,roadworks:false,gpsFault:false,weightFault:false,fuelShortage:false,drainage:false,dustSuppression:false,reinforced:false,waterShortage:false,pumpFault:false,beltFault:false,assayFault:false,gpsJump:false,radioFault:false};
    this.ai=true;this.safety=true;this.predictive=true;this.roughRoads=false;this.nightShift=false;this.partsShortage=false;this.preventiveJobs=0;this.maintenanceSpent=0;this.safetyStops=0;this.overspeedEvents=0;this.incidentCounter=0;this.geology={water:.13,cracks:.08,vibration:0,blastPulse:0,fs:1.45,status:'stable',failed:false,exposure:0,age:0};
    this.dust=.15;this.visibility=1;this.roadWet=0;this.powerDemand=0;this.activeShift=1;this.dispatchChanges=0;
    this.assets=Object.fromEntries([...this.faceIds.map((id,i)=>[id,{id:`EX-${String(i+1).padStart(2,'0')}`,health:92,passes:0,busy:null,capacity:Math.min(35,19.5+i*2.5),state:'idle'}]),...this.crusherIds.map((id,i)=>[id,{id:`CR-${String(i+1).padStart(2,'0')}`,health:90,rate:Math.max(.8,2.6-i*.25),busy:null,state:'running'}])]);
    // Physically separate initial parking positions. The old modulo-based
    // start put HT-01 and HT-11 (and others) at exactly the same coordinates.
    const requestedFleet=clamp(this.map.fleetSize||12,5,28);
    const parking=this.map.nodes.filter(n=>['junction','depot','fuel','workshop','weigh','face','crusher'].includes(n.kind));
    const starts=[];
    for(let i=0;i<requestedFleet;i++){
      parking.sort((a,b)=>{
        const score=n=>starts.length ? Math.min(...starts.map(id=>{
          const p=this.net.nodes.get(id);return Math.hypot(n.x-p.x,n.z-p.z);
        }))+(n.kind==='junction'?12:0)-(n.kind==='face'||n.kind==='crusher'?45:0) : (n.kind==='junction'?100:0)-(n.kind==='face'||n.kind==='crusher'?45:0);
        return score(b)-score(a);
      });
      const chosen=parking.shift();
      if(!chosen)break;
      starts.push(chosen.id);
    }
    this.trucks=Array.from({length:requestedFleet},(_,i)=>{
      const north=i%2===0, face=this.faceIds[i%this.faceIds.length], crusher=this.crusherIds[i%this.crusherIds.length];
      const origin=starts[i%starts.length];
      return {id:truckLabel(i),node:origin,edge:null,from:null,to:null,progress:0,reverse:false,target:i%3===0?face:crusher,
        status:i%3===0?'returning':'hauling',face,crusher,payload:i%3===0?0:75+i%3*6,
        capacity:90+(i%4)*5,grade:north?.67:.81, trips:0, fuel:68+(i*7)%31,
        tyre:85+(i*3)%13,health:90-(i%5)*3,speed:0,wheelSpeed:0,
        distance:0,routeCount:0,idleSeconds:0,waitingSeconds:0,queueSeconds:0,
        timer:i*1.7,haulKm:0,road:null,eta:0,warnings:[],
        gps:{ok:true,position:null,estimate:null,edge:null,from:null,to:null,progress:0,uncertainty:0,age:0,plannedTarget:null},
        expectedPayload:i%3===0?0:75+i%3*6,
      };
    });
    this.trucks.forEach((t,i)=>{initCondition(t,i);t.gps.node=t.node;t.gps.estimate=this._position(t);t.gps.position={...t.gps.estimate};t.lastTelemetry=null;t.telemetryAge=0;});
    initProduction(this);this.blast=createBlastState(this);this.initialReserve=Object.values(this.oreBlocks).flat().reduce((a,b)=>a+b.reserve,0);this.trucks.forEach(t=>t.lastTelemetry=this._truckSnapshot(t));
    this.log('MINE//MIRAGE 3.1: единая модель, баланс руды/меди/воды/дизеля, ресурсные ограничения и журнал решений.', 'success');
  }
  blockedEdges(){
    const blocked=new Set();
    // Physical obstruction persists even in the unsafe comparison mode.
    if((this.geology.failed||(this.safety&&this.geology.status==='critical'))&&this.map.hazards?.[0])blocked.add(this.map.hazards[0].edgeId);
    if(this.faults.roadworks)blocked.add(this.map.roadworksEdgeId||(this.net.edges.has('C01')?'C01':this.map.edges[Math.floor(this.map.edges.length/2)].id));
    if(this.water?.sump>540){const flood=this.map.floodEdgeId||this.map.hazards?.[0]?.edgeId;if(flood)blocked.add(flood);}
    if(['countdown','ventilation'].includes(this.blast.phase))for(const e of this.map.edges)if(e.fromNode===this.faceIds[0]||e.toNode===this.faceIds[0])blocked.add(e.id);
    return blocked;
  }
  traffic(){const n=new Map();for(const t of this.trucks)if(t.edge)n.set(t.edge,(n.get(t.edge)||0)+1);return n;}
  path(a,b){return shortestPath(this.net,a,b,{blocked:this.blockedEdges(),traffic:this.ai?this.traffic():new Map(),rain:this.faults.rain,dust:this.dust>.65});}
  _nearest(kind){return this.map.nodes.filter(n=>n.kind===kind);}
  _choose(t, kind){
    const options=this._nearest(kind).filter(n=>!(kind==='face'&&n.id===this.faceIds[0]&&(this.faults.loaderFault||this.blast.phase!=='idle'))).filter(n=>kind!=='face'||this.oreBlocks[n.id].some(b=>b.reserve>1e-8));
    const scored=options.map(n=>{
      const p=this.path(t.node,n.id);if(!p)return {n,score:Infinity};
      const queue=this.trucks.filter(x=>x.target===n.id && x.id!==t.id).length;
      const equipment=n.kind==='crusher'?this.assets[n.id]:this.assets[n.id];
      const faulty=((n.id===this.crusherIds[0]&&this.faults.crusherFault)||(n.id===this.crusherIds[1]&&this.faults.crusherBFault)) ||(n.id===this.faceIds[0]&&this.faults.loaderFault) || (kind==='crusher'&&this.faults.powerFault);
      const penalty=faulty?15000:0;
      const bufferPenalty=kind==='crusher'?Math.max(0,(this.hopper[n.id]||0)-220)*2:0;
      const gradeBonus=kind==='crusher' ? Math.abs((this.gradeFeed[n.id]??.72)-.74)*19:0;
      return {n,score:penalty+bufferPenalty+(p.cost*(this.ai?1:0.55))+(this.ai?queue*17:0)+gradeBonus+ (equipment?.busy?7:0)};
    }).sort((a,b)=>a.score-b.score);
    return scored[0]?.score<Infinity?scored[0].n.id:null;
  }
  _assign(t){
    if(t.payload>1&&(t.failedComponent||t.maintenanceDue)&&!t.failedComponent){t.status='hauling';t.target=this._choose(t,'crusher');return;}
    if(t.fuel<19 && t.status!=='refueling'){t.status='to_fuel';t.target=this._choose(t,'fuel');return;}
    if(t.health<50 ||t.tyre<35 || t.failedComponent || t.serviceReason==='preventive'|| (this.predictive&&t.maintenanceDue)){t.status='to_workshop';t.target=this._choose(t,'workshop');t.serviceReason=t.failedComponent?'failure':'planned';return;}
    if(t.payload>1){t.status='hauling';t.target=this._choose(t,'crusher');t.crusher=t.target;}
    else {t.status='returning';t.target=this._choose(t,'face');t.face=t.target;}
    this.dispatchChanges++;
  }
  dispatch(truckId,target){
    const t=this.trucks.find(t=>t.id===truckId),node=this.net.nodes.get(target);
    if(!t||!node||['stranded','towing','repairing'].includes(t.status))return false;
    if(!['face','crusher','fuel','workshop'].includes(node.kind)||(node.kind==='face'&&t.payload>0)||(node.kind==='crusher'&&t.payload<=0))return false;
    if(!this.path(t.edge?t.to:t.node,target))return false;
    this._releaseAsset(t);t.target=target;t.timer=0;t.serviceReason=node.kind==='workshop'?'preventive':null;
    t.status={face:'returning',crusher:'hauling',fuel:'to_fuel',workshop:'to_workshop'}[node.kind];this.dispatchChanges++;
    this.log(`${t.id}: ручное назначение → ${target}.`);return true;
  }
  action(action){
    if(typeof action!=='string')return false;
    if(action.startsWith('playbook:'))return this.startPlaybook(action.slice(9));
    if(action==='recycling'||action==='trustAssay'){this[action]=!this[action];this.log(`${action}: ${this[action]?'включено':'выключено'}.`);return this[action];}
    if(action==='worker'||action==='wind'){this[action]=!this[action];this.log(`${action==='worker'?'Человек в периметре':'Сильный ветер'}: ${this[action]?'ДА':'НЕТ'}.`,'warning');return this[action];}
    if(action==='cancelBlast'){if(['ventilation','idle'].includes(this.blast.phase))return false;const old=this.blast;this.blast=createBlastState(this);Object.assign(this.blast,{completed:old.completed,fragmentation:old.fragmentation,coarsePct:old.coarsePct,detonatedAt:old.detonatedAt});this.log('Цикл БВР отменён, производственный участок возвращён в исходное состояние.','warning');return true;}
    if(action==='orderParts'||action==='orderFuel'){
      if(this.supplyJobs.some(j=>j.type===action)){this.log('Поставка уже в пути.','warning');return false;}
      this.supplyJobs.push({type:action,remaining:180});this.cost+=action==='orderParts'?18000:24000;this.log('Поставка заказана: прибытие через 180 модельных секунд.');return true;
    }
    if(action==='responsePlan'){
      this.ai=true;this.safety=true;this.predictive=true;this.recycling=true;this.trustAssay=true;this.faults.drainage=true;
      if(Object.entries(this.faults).some(([k,v])=>v&&['powerFault','crusherFault','crusherBFault','pumpFault','beltFault','gpsFault','radioFault','loaderFault'].includes(k))&&!this.jobs.some(j=>j.type==='repair'))this.action('repair');
      if(this.geology.status!=='stable'&&!this.geology.failed&&!this.jobs.some(j=>j.type==='reinforce'))this.action('reinforce');
      if((this.partsShortage||Object.values(this.spareParts).some(v=>v<1))&&!this.supplyJobs.some(j=>j.type==='orderParts'))this.action('orderParts');
      if(this.fuelDepot<2000&&!this.supplyJobs.some(j=>j.type==='orderFuel'))this.action('orderFuel');
      if(this.trucks.some(t=>t.status==='stranded')&&!this.trucks.some(t=>t.status==='towing'))this.action('tow');
      this.log('План восстановления назначен. Учитываются время работ, склад, вода и затраты.','success');return true;
    }
    if(action==='reset'){this.reset();return true;}
    if(action==='tow'){
      const stranded=this.trucks.find(t=>t.status==='stranded');if(!stranded){this.log('Эвакуатор: остановленных машин нет.','info');return false;}
      if(this.trucks.some(t=>t.status==='towing')){this.log('Единственный эвакуатор уже занят.','warning');return false;}
      const at=this._position(stranded),workshop=this._choose(stranded,'workshop');if(!workshop)return false;
      const start=stranded.edge?(stranded.progress<.5?stranded.from:stranded.to):stranded.node;
      const route=this.path(start,workshop);if(!route){this.log('Эвакуатор: нет проходимого пути в мастерскую.','warning');return false;}
      stranded.towPath=[{...at},...route.nodes.map(id=>({...this.net.nodes.get(id)}))];stranded.towLeg=0;stranded.towProgress=0;stranded.towPosition={...at};
      stranded.status='towing';stranded.timer=0;stranded.target=workshop;stranded.serviceReason='recovery';
      this._releaseAsset(stranded);this.log(`${stranded.id}: эвакуатор назначен. Сцепка 45 с, затем движение по дорогам.`, 'warning');return true;
    }
    if(action==='inspection'){
      const sorted=[...this.trucks].sort((a,b)=>maintenancePriority(b)-maintenancePriority(a));const top=sorted.slice(0,3);
      this.log(`Диагностика: ${top.map(t=>`${t.id} ${maintenancePriority(t)} баллов / ${Math.min(...Object.values(t.components)).toFixed(0)}%`).join('; ')}.`, 'info');return true;
    }
    if(action==='preventive'){
      const candidate=[...this.trucks].filter(t=>!['repairing','to_workshop','stranded'].includes(t.status)).sort((a,b)=>maintenancePriority(b)-maintenancePriority(a))[0];
      if(!candidate)return false;
      candidate.maintenanceDue=true;candidate.serviceReason='preventive';this.preventiveJobs++;
      if(!candidate.edge&&candidate.payload<1){this._releaseAsset(candidate);candidate.status='to_workshop';candidate.target=this._choose(candidate,'workshop');}
      this.log(`${candidate.id}: назначено плановое ТО по состоянию агрегатов.`, 'success');return true;
    }
    if(action==='gradeRoad'){
      return this._job('gradeRoad',60,35000,'Грейдер: восстановление дороги');
    }
    if(action==='potholes'){this.roughRoads=!this.roughRoads;this.log(this.roughRoads?'Появились выбоины: износ подвески и шин ускорен.':'Повреждение дороги устранено.', 'warning');return this.roughRoads;}
    if(action==='partsShortage'){this.partsShortage=!this.partsShortage;this.log(this.partsShortage?'Склад: дефицит запчастей, обслуживание машин остановлено.':'Склад: запчасти доступны.','warning');return this.partsShortage;}
    if(action==='nightShift'){this.nightShift=!this.nightShift;this.log(this.nightShift?'Ночь: видимость ограничена, диспетчер снижает скорость.':'Дневная смена: обычная видимость.','info');return this.nightShift;}
    if(action==='predictive'){this.predictive=!this.predictive;this.log(this.predictive?'Автоматическое ТО по диагностике активно.':'Автоматическое ТО отключено: только аварийный сервис.','warning');return this.predictive;}
    const faultVehicle={lowTyrePressure:[4,'tyres'],brakeFailure:[3,'brakes'],coolingLeak:[5,'cooling'],oilLeak:[6,'oil'],hydraulicLeak:[7,'hydraulics'],electricalFault:[8,'electrical'],filterClog:[9,'filter']};
    if(action in faultVehicle){const [index,component]=faultVehicle[action],t=this.trucks[index];if(!t)return false;
      if(!t.faultTags.includes(component))t.faultTags.push(component);
      if(component==='tyres')t.tyrePressureKpa=460;
      if(component==='brakes'){t.components.brakes=Math.min(t.components.brakes,24);t.brakeTempC=190;}
      if(component==='cooling'){t.components.cooling=Math.min(t.components.cooling,49);t.engineTempC=116;}
      if(component==='oil')t.oilPressureKpa=180;
      if(component==='hydraulics')t.components.hydraulics=Math.min(t.components.hydraulics,43);
      if(component==='electrical')t.batteryVoltageV=22;
      this.log(`${t.id}: ${COMPONENT_NAMES[component]||component} — диагностирована неисправность.`, 'danger');return true;
    }
    if(action==='overload'){
      const t=this.trucks[0];const amount=Math.max(0,t.capacity*1.16-t.payload);const part={mass:amount,metal:amount*(t.grade||.7)/100,hardness:amount};add(t.cargo,part);add(this.material.external,part);t.payload=t.cargo.mass;t.expectedPayload=t.payload;
      this.log(`${t.id}: масса ${t.payload.toFixed(1)} т (116% допустимой): автоконтроль назначает ограничение скорости.`, 'warning');return true;
    }
    if(action==='tyreFault'){const t=this.trucks[2];t.components.tyres=Math.min(t.components.tyres,9);t.tyre=Math.min(t.tyre,9);t.health=Math.min(t.health,45);this.log(`${t.id}: повреждена шина — отправить в мастерскую.`, 'danger');return true;}
    if(action==='microquake'){this.geology.blastPulse=clamp(this.geology.blastPulse+.95,0,1);this.geology.cracks=clamp(this.geology.cracks+.18,0,1);this.log('Микросейсмика: уступ деформируется, маршрут может быть закрыт.','danger');return true;}
    if(action==='blast'){
      if(this.geology.failed||this.blast.phase!=='idle'){this.log('Взрыв запрещён: обвал или уже активная подготовка.','danger');return false;}
      const old=this.blast;this.blast=createBlastState(this);Object.assign(this.blast,{completed:old.completed,fragmentation:old.fragmentation,coarsePct:old.coarsePct,cycle:old.cycle+1,detonatedAt:old.detonatedAt});this.blast.phase='drilling';this.log('БВР: началось модельное бурение скважин, записываются синтетические MWD-параметры.','info');return true;
    }
    if(action==='clear'){
      if(this.geology.failed&&!this.faults.rain&&this.faults.drainage&&this.geology.water<.4)return this._job('clear',90,45000,'Расчистка и обследование');
      this.log('Расчистка запрещена: отключить дождь, включить дренаж, вода в уступе <40%.','warning');return false;
    }
    if(action==='reinforce'){
      if(this.geology.failed){this.log('Сначала осушить и расчистить обвал.','warning');return false;}
      return this._job('reinforce',90,60000,'Укрепление уступа');
    }
    if(action==='repair'){
      const keys=['crusherFault','crusherBFault','loaderFault','powerFault','fuelShortage','weightFault','gpsFault','gpsJump','radioFault','pumpFault','beltFault','assayFault'].filter(k=>this.faults[k]);
      if(!keys.length){this.log('Технологических отказов нет. Агрегаты самосвалов обслуживаются в мастерской.');return false;}
      const ok=this._job('repair',90,40000,'Бригада технологического ремонта');if(ok)this.jobs.find(j=>j.type==='repair').targets=keys;return ok;
    }
    if(action==='ai'){this.ai=!this.ai;this.log(this.ai?'Динамическая диспетчеризация включена.':'Диспетчер: фиксированные предпочтения маршрутов.');return this.ai;}
    if(action==='safety'){this.safety=!this.safety;this.log(this.safety?'Автоматические блокировки безопасности включены.':'ВНИМАНИЕ: авто-блокировки отключены для сравнения рисков.','warning');return this.safety;}
    if(!(action in this.faults))return false;
    this.faults[action]=!this.faults[action];
    const names={rain:'Ливень',fog:'Туман',heat:'Жара',crusherFault:'Дробилка A: отказ',crusherBFault:'Дробилка B: отказ',dustSuppression:'Поливочная машина',loaderFault:'Экскаватор EX-01: отказ',powerFault:'Сбой энергоснабжения',roadworks:'Закрыта C01: ремонт',gpsFault:'GPS Truck-02: сигнал потерян',weightFault:'Датчик веса Truck-01: неисправен',fuelShortage:'Заправочный резерв: ограничен',drainage:'Дренажные насосы'};
    this.log(`${names[action]} — ${this.faults[action]?'АКТИВНО':'отключено'}.`,this.faults[action]?'warning':'success');
    return this.faults[action];
  }
  _weather(dt){
    this.roadWet=clamp(this.roadWet+(this.faults.rain?.013:-.005)*dt,0,1);
    const moving=this.trucks.filter(t=>t.speed>1).length;
    this.dust=clamp(this.dust+dt*(.0010*moving+(this.faults.heat?.011:0)-(this.faults.rain?.032:.014)),.04,.98);
    if(this.faults.dustSuppression&&this.water.reservoir>.018*dt){const burn=Math.min(this.fuelDepot,dt*.014);this.fuelDepot-=burn;this.cost+=dt*7.5+burn*MODEL.fuelPriceKztPerL;this.fuelConsumed+=burn;this.co2Kg+=burn*MODEL.dieselKgCo2PerL;}
    this.visibility=clamp(1-(this.faults.fog?.52:0)-this.dust*.3-(this.faults.rain?.20:0)-(this.nightShift?.31:0),.18,1);
  }
  _slope(dt){
    const g=this.geology;
    const nearby=this.trucks.filter(t=>t.edge===this.map.hazards?.[0]?.edgeId).length;
    g.water=clamp(g.water+dt*(this.faults.rain?.012:-.0014)-(this.faults.drainage&&!this.faults.pumpFault&&!this.faults.powerFault?.015*dt:0),.04,1);
    g.cracks=clamp(g.cracks+dt*(Math.max(0,g.water-.52)*.006+g.blastPulse*.0015-(this.faults.reinforced?.0009:0)),.03,1);
    g.vibration=clamp(nearby*.095+g.blastPulse,0,1);g.blastPulse=Math.max(0,g.blastPulse-dt*.065);
    g.fs=round(1.52-.59*g.water-.26*g.cracks-.14*g.vibration+(this.faults.reinforced?.32:0),3);
    const prev=g.status;
    if(g.failed){g.status='collapsed';g.age+=dt;}
    else {
      g.status=g.fs<1.08?'critical':g.fs<1.22?'warning':'stable';
      g.exposure=g.fs<1?g.exposure+dt:Math.max(0,g.exposure-dt);
      if(g.exposure>=5){g.failed=true;g.age=0;g.status='collapsed';this.log('ОБВАЛ: зафиксировано разрушение уступа. Диспетчерия перекрывает RAMP-04!','danger');}
    }
    if(g.status!==prev && !g.failed)this.log(`Геомеханика: ${g.status.toUpperCase()} · FS=${g.fs.toFixed(2)}.`,g.status==='stable'?'success':'warning');
  }
  _position(t){
    if(t.status==='towing'&&t.towPosition)return {...t.towPosition};
    const n=this.net.nodes.get(t.node);return t.edge?interpolate(this.net,t.edge,t.from,t.to,t.progress):{x:n.x,z:n.z,elevation:n.elevation||0};
  }
  _gpsSample(t){
    // Truth is used only to generate a synthetic sensor packet, never to propagate an outage estimate.
    if(this.faults.gpsFault&&t.id==='HT-02')return null;
    const position=this._position(t);if(this.faults.gpsJump&&t.id==='HT-02')position.x+=180;
    return {hdop:this.faults.gpsJump&&t.id==='HT-02'?12:.8,position,node:t.node,edge:t.edge,from:t.from,to:t.to,progress:t.progress};
  }
  _predictGps(t,dt){
    const g=t.gps,radio=this.faults.radioFault&&t.id==='HT-08';
    if(radio){t.telemetryAge+=dt;g.age+=dt;g.uncertainty=Math.min(200,g.uncertainty+dt*1.1);return;}
    t.telemetryAge=0;
    const sample=this._gpsSample(t);
    const residual=sample&&g.estimate?Math.hypot(sample.position.x-g.estimate.x,sample.position.z-g.estimate.z):0;
    // Wide enough for one integration step, but rejects a discontinuous 180 m sample.
    const gate=35+Math.min(35,g.uncertainty*.25);
    if(sample&&sample.hdop<4&&residual<=gate){
      g.ok=true;g.rejected=false;g.node=sample.node;g.position={...sample.position};g.estimate={...sample.position};g.edge=sample.edge;g.from=sample.from;g.to=sample.to;g.progress=sample.progress;g.age=0;g.uncertainty=1.5;g.plannedTarget=t.target;return;
    }
    // Recovery after an extended outage is a deliberate re-acquisition, not a silent teleport.
    // Two consecutive physically consistent fixes are needed if outside the innovation gate.
    if(sample&&sample.hdop<4){
      const previous=g.reacquire;
      if(previous&&Math.hypot(sample.position.x-previous.x,sample.position.z-previous.z)<20){
        g.estimate={...sample.position};g.position={...sample.position};g.node=sample.node;g.edge=sample.edge;g.from=sample.from;g.to=sample.to;g.progress=sample.progress;g.uncertainty=3;g.age=0;g.ok=true;g.reacquire=null;this.log(`${t.id}: положение повторно подтверждено двумя GPS-пакетами.`,'success');return;
      }g.reacquire={...sample.position};
    }
    g.ok=false;g.age+=dt;g.uncertainty=Math.min(200,g.uncertainty+dt*.28+t.wheelSpeed*dt*.02);
    if(sample&&!g.rejected){g.rejected=true;this.log(`${t.id}: GPS-пакет отклонён, невязка ${round(residual)} м. Используем одометр.`,'warning');}
    if(t.target!==g.plannedTarget)g.plannedTarget=t.target;
    let meters=t.wheelSpeed*dt;
    for(let k=0;k<8&&meters>0;k++){
      if(!g.edge){const p=this.path(g.node,g.plannedTarget);if(!p?.edges.length)break;g.edge=p.edges[0];g.from=p.nodes[0];g.to=p.nodes[1];g.progress=0;}
      const e=this.net.edges.get(g.edge);if(!e)break;
      const step=Math.min(meters,(1-g.progress)*e.length);g.progress+=step/e.length;meters-=step;g.estimate=interpolate(this.net,g.edge,g.from,g.to,g.progress);
      if(g.progress>=.999999){g.node=g.to;g.edge=null;g.from=null;g.to=null;g.progress=0;}
    }
  }
  _releaseAsset(t){for(const a of Object.values(this.assets))if(a.busy===t.id){a.busy=null;a.state='idle';}}
  _arrival(t){
    t.speed=0;t.wheelSpeed=0;t.edge=null;t.road=null;
    const kind=this.net.nodes.get(t.node)?.kind;
    if(kind==='face') {t.status='loading';t.timer=0;t.waitingSeconds=0;}
    else if(kind==='crusher'){t.status='dumping';t.timer=0;t.waitingSeconds=0;}
    else if(kind==='fuel'){t.status='refueling';t.timer=0;}
    else if(kind==='workshop'){t.status='repairing';t.timer=0;}
    else this._assign(t);
  }
  _move(t,dt){
    if(!t.target){this._assign(t);return;}
    if(!t.edge && t.node===t.target){this._arrival(t);return;}
    const blocked=this.blockedEdges();
    if(t.edge && blocked.has(t.edge) && this.safety){
      // Turn around slowly on the same geometry, then find a new route from the junction.
      t.reverse=true;
    }
    if(!t.edge){
      const path=this.path(t.node,t.target);
      if(!path){t.status='stranded';t.speed=0;t.idleSeconds+=dt;return;}
      if(!path.edges.length){this._arrival(t);return;}
      const next=path.edges[0],occupied=this.trucks.filter(x=>x.edge===next&&x.id!==t.id&&!(x.status==='towing'&&x.timer>=45));
      const edge=this.net.edges.get(next);
      // A shared centerline is a ONE-LANE road, even when nominal link
      // capacity exceeds 1. Opposing vehicles must not enter simultaneously.
      const opposite=occupied.some(x=>x.from!==path.nodes[0]);
      const entryTail=occupied.some(x=>x.from===path.nodes[0]&&x.progress*edge.length<34);
      if(occupied.length>=edge.capacity||opposite||entryTail){t.speed=0;t.wheelSpeed=0;t.queueSeconds+=dt;return;}
      t.edge=path.edges[0];t.from=path.nodes[0];t.to=path.nodes[1];t.progress=0;t.reverse=false;t.routeCount++;t.road=t.edge;
    }
    const e=this.net.edges.get(t.edge);
    const trafficCount=this.traffic().get(e.id)||0;
    const incline=((this.net.nodes.get(t.to).elevation||0)-(this.net.nodes.get(t.from).elevation||0))/e.length;
    const loading=t.payload>0? .78:1;
    const effects=(1-this.roadWet*.23)*(this.visibility*.67+.33)*(this.faults.heat?.88:1)*(1-Math.max(0,trafficCount-(e.capacity||3))*.09);
    const wearFactor=conditionSpeedFactor(t);
    const faultRestriction=t.diagnostic.some(x=>/ПЕРЕГРЕВ|ТОРМОЗА|МАСЛА|ШИНЫ/.test(x));
    const overload=t.payload>t.capacity*1.1;
    let velocity=clamp(e.speedLimit*loading*effects*wearFactor*(1-Math.max(0,incline)*1.8),0,13);
    if(faultRestriction||overload)velocity=Math.min(velocity,MODEL.speedLimitFault);
    if(t.failedComponent&&this.safety){t.status='stranded';t.speed=0;t.wheelSpeed=0;t.failure=t.failedComponent;this.safetyStops++;this.log(`${t.id}: безопасная остановка — ${COMPONENT_NAMES[t.failedComponent]}.`,'danger');return;}
    if(t.brakeTempC>200&&this.safety){velocity=Math.min(velocity,2.1);}
    if(!this.safety&&(t.brakeTempC>190||overload)){this.overspeedEvents+=dt;}
    if(this.roughRoads&&this.ai)velocity*=.88;
    if(t.reverse)velocity=Math.min(velocity,3.2);
    if(this.safety&&((t.id==='HT-02'&&t.gps.uncertainty>80)||(t.id==='HT-08'&&t.telemetryAge>5))){t.speed=0;t.wheelSpeed=0;t.safetyHold=true;t.queueSeconds+=dt;return;}
    // Physically separated entries and >=24m following distances on a road.
    // Closely crossing DIFFERENT paths cannot be blocked indiscriminately:
    // doing so causes permanent gridlock on these imported mine maps.
    let meters=velocity*dt;
    for(const other of this.trucks){
      if(other.id===t.id||other.edge!==t.edge||(other.status==='towing'&&other.timer>=45))continue;
      if(other.from!==t.from)continue; // opposite entry is prohibited above
      const otherProgress=other.progress;
      const gap=t.reverse?(t.progress-otherProgress)*e.length:(otherProgress-t.progress)*e.length;
      if(gap>=0)meters=Math.min(meters,Math.max(0,gap-26));
    }
    const left=t.reverse?t.progress*e.length:(1-t.progress)*e.length;
    meters=Math.min(meters,left);
    if(meters<.004){meters=0;t.queueSeconds+=dt;}
    t.progress=clamp(t.progress+(t.reverse?-1:1)*meters/e.length,0,1);
    t.speed=meters/dt;t.wheelSpeed=t.speed*(1+.016*Math.sin(this.time*.4+t.id.length*2));
    t.distance+=meters;t.haulKm+=meters/1000;
    // All three counters derive from the SAME fuel volume; no discrepant percentages/litres.
    const rough=(this.roughRoads?1.85:1)*(e.dustFactor||1),fuelBurn=(meters/1000)*(t.payload>0?this.fuelRates.loadedLitresPerKm:this.fuelRates.emptyLitresPerKm)*
      (1+Math.max(0,incline)*3+this.roadWet*.20+(overload?.28:0)+(t.tyrePressureKpa<500?.18:0)+(this.faults.heat?.09:0))*rough;
    const actualBurn=Math.min(t.fuelLitres,fuelBurn);t.fuelLitres-=actualBurn;t.fuel=clamp(100*t.fuelLitres/MODEL.tankLitres,0,100);
    this.fuelConsumed+=actualBurn;this.co2Kg+=actualBurn*MODEL.dieselKgCo2PerL;this.cost+=actualBurn*MODEL.fuelPriceKztPerL;
    if(t.fuel<=1){t.status='stranded';t.speed=0;this.log(`${t.id}: топливо закончилось, нужен эвакуатор.`, 'danger');}
    if((t.reverse&&t.progress<=.00001)||(!t.reverse&&t.progress>=.99999)){
      const arrive=t.reverse?t.from:t.to;t.node=arrive;t.edge=null;t.from=null;t.to=null;t.progress=0;
      if(t.reverse){t.reverse=false;this.log(`${t.id} безопасно развернулся и выбирает обход.`, 'warning');}
      else if(t.node===t.target)this._arrival(t);
    }
  }
  _process(t,dt){
    t.safetyHold=false;
    if(t.status==='stranded'){t.speed=0;t.wheelSpeed=0;t.idleSeconds+=dt;return;}
    if(['hauling','returning','to_fuel','to_workshop'].includes(t.status))return this._move(t,dt);
    t.speed=0;t.wheelSpeed=0;t.idleSeconds+=dt;t.timer+=dt;
    if(t.status==='towing'){
      if(t.timer<45)return;
      t.edge=null;t.from=null;t.to=null;t.road=null;
      const points=t.towPath;let meters=8*dt;
      while(meters>0&&t.towLeg<points.length-1){
        const a=points[t.towLeg],b=points[t.towLeg+1],length=Math.hypot(a.x-b.x,a.z-b.z),left=(1-t.towProgress)*length;
        const travel=Math.min(meters,left);t.towProgress=length?Math.min(1,t.towProgress+travel/length):1;meters-=travel;
        t.towPosition={x:a.x+(b.x-a.x)*t.towProgress,z:a.z+(b.z-a.z)*t.towProgress,elevation:(a.elevation||0)+((b.elevation||0)-(a.elevation||0))*t.towProgress};
        if(t.towProgress>=1){t.towLeg++;t.towProgress=0;}
      }
      if(t.towLeg>=points.length-1){t.status='repairing';t.edge=null;t.from=null;t.to=null;t.progress=0;t.node=t.target;t.timer=0;t.towPosition=null;
        const rescue=Math.min(this.fuelDepot,Math.max(0,45-t.fuelLitres));this.fuelDepot-=rescue;t.fuelLitres+=rescue;t.fuel=100*t.fuelLitres/MODEL.tankLitres;
        t.failure=null;this.cost+=85000;this.maintenanceSpent+=85000;this.log(`${t.id}: доставлен в мастерскую. Эвакуация 85 000 ₸.`,'warning');}
    }else if(t.status==='loading'){
      const asset=this.assets[t.node],evacuating=t.node===this.faceIds[0]&&this.blast.phase!=='idle',fault=t.node===this.faceIds[0]&&this.faults.loaderFault;
      if(evacuating){this._releaseAsset(t);if(t.payload>0){t.status='hauling';t.target=this._choose(t,'crusher');}else {t.target=this._choose(t,'face')||this._choose(t,'depot');t.status='returning';}return;}
      if(fault){t.queueSeconds+=dt;
        if(this.ai && t.timer>=6){const alternate=this._choose(t,'face');if(alternate&&alternate!==t.node){this._releaseAsset(t);t.target=alternate;t.face=alternate;t.status='returning';t.timer=0;this.log(`${t.id}: забой недоступен — отправлен к резервному экскаватору.`, 'warning');}}
        return;}
      if(asset.busy&&asset.busy!==t.id){t.queueSeconds+=dt;return;}
      asset.busy=t.id;asset.state='loading';const block=this.oreBlocks[t.node].find(b=>b.reserve>1e-8);const loaded=loadOre(this,t,asset.capacity/8*dt/(block?.hardness||1)*loadingFragmentationFactor(block) * weatherFactors(this.faults,this.visibility,this.dust,this.nightShift).loading);
      if(t.payload>=t.capacity-.01||!block){
        t.payload=t.cargo.mass;t.expectedPayload=t.payload;t.grade=t.payload?t.cargo.metal/t.payload*100:0;
        asset.passes+=Math.ceil(t.payload/asset.capacity);asset.busy=null;asset.state='idle';
        this.log(`${t.id}: погружено ${t.payload} т · ${asset.id}.`,'success');this._assign(t);
      }
    } else if(t.status==='dumping'){
      const asset=this.assets[t.node],offline=(this.faults.crusherFault&&t.node===this.crusherIds[0])||(this.faults.crusherBFault&&t.node===this.crusherIds[1])||this.faults.powerFault||this.faults.beltFault;
      if(offline){t.queueSeconds+=dt; if(this.ai && t.timer>20&&t.payload>0){
        const other=this._nearest('crusher').find(n=>n.id!==t.node&&!(n.id===this.crusherIds[0]&&this.faults.crusherFault)&&!(n.id===this.crusherIds[1]&&this.faults.crusherBFault)&&!this.faults.powerFault&&!this.faults.beltFault);
        if(other && this.path(t.node,other.id)){this._releaseAsset(t);t.target=other.id;t.crusher=other.id;t.status='hauling';t.timer=0;this.log(`${t.id}: перенаправлен к резервной дробилке.`, 'warning');}
      }return;}
      if(asset.busy&&asset.busy!==t.id){t.queueSeconds+=dt;return;}
      if(this.hopper[t.node]+t.payload>PROCESS.hopperCapacity){t.queueSeconds+=dt;return;}
      if(asset.busy!==t.id){asset.busy=t.id;t.dumpElapsed=0;}asset.state='receiving';t.dumpElapsed+=dt;
      if(t.dumpElapsed>=8){
        const amount=t.payload; const h=this.hopper[t.node], blended=(this.gradeFeed[t.node]*h+t.grade*amount)/(h+amount);
        add(this.buffers[t.node],t.cargo);t.cargo=emptyCargo();this.hopper[t.node]=this.buffers[t.node].mass;this.gradeFeed[t.node]=blended;
        this.totalOre+=amount;t.trips++;t.payload=0;t.expectedPayload=0;asset.busy=null;asset.state='running';t.timer=0;
        this.log(`${t.id}: ${round(amount)} т в ${asset.id}, содержание меди ${round(t.grade,2)}%.`,'success');this._assign(t);
      }
    }else if(t.status==='refueling'){
      if(this.faults.fuelShortage){t.queueSeconds+=dt;return;}
      const occupied=this.trucks.find(x=>x.id!==t.id&&x.status==='refueling'&&x.node===t.node&&x.refuelOwner);if(occupied){t.queueSeconds+=dt;return;}
      t.refuelOwner=true;const supplied=Math.min(this.fuelDepot,MODEL.tankLitres-t.fuelLitres,14.4*dt);this.fuelDepot-=supplied;t.fuelLitres+=supplied;t.fuel=100*t.fuelLitres/MODEL.tankLitres;
      if(supplied===0){t.queueSeconds+=dt;return;}
      if(t.fuel>=96){t.refuelOwner=false;t.timer=0;this._assign(t);this.log(`${t.id} заправлен.`, 'success');}
    }else if(t.status==='repairing'){
      const busy=this.trucks.find(x=>x.id!==t.id&&x.status==='repairing'&&x.node===t.node&&x.serviceParts);if(busy){t.queueSeconds+=dt;return;}
      if(this.partsShortage){t.queueSeconds+=dt;return;}
      if(!t.serviceParts){const needed=chooseServiceParts(t);if(needed.some(k=>this.spareParts[k]<1)){t.queueSeconds+=dt;return;}t.serviceParts=needed;for(const k of needed)this.spareParts[k]--;}
      const res=performServiceStep(t,dt,{spareParts:true});
      this.maintenanceSpent+=res.cost;this.cost+=res.cost;
      if(res.waiting){t.queueSeconds+=dt;}
      if(res.done){t.timer=0;t._reported.clear();this._assign(t);this.log(`${t.id}: ТО выполнено; запчасти ${round(res.partsCost,0)} ₸, простои учтены.`, 'success');}
    }
  }
  _job(type,seconds,cost,label){
    if(this.jobs.some(j=>j.type===type)){this.log('Бригада уже выполняет эту работу.','warning');return false;}
    this.jobs.push({type,remaining:seconds,label});this.cost+=cost;this.log(`${label}: ${seconds} с, ${cost.toLocaleString('ru')} ₸.`);return true;
  }
  _jobs(dt){
    for(const j of this.jobs){
      if(j.type==='clear'&&(this.faults.rain||this.geology.water>=.4)){j.paused=true;continue;}j.paused=false;j.remaining-=dt;
      if(j.remaining>0)continue;
      if(j.type==='gradeRoad')this.roughRoads=false;
      if(j.type==='reinforce'){this.faults.reinforced=true;this.geology.cracks=Math.max(.05,this.geology.cracks-.14);}
      if(j.type==='clear'){this.geology.failed=false;this.geology.exposure=0;this.geology.cracks=.2;this.faults.reinforced=true;}
      if(j.type==='repair')for(const k of j.targets||[])this.faults[k]=false;
      this.log(`${j.label}: завершено.`,'success');
    }this.jobs=this.jobs.filter(j=>j.remaining>0);
    for(const j of this.supplyJobs){j.remaining-=dt;if(j.remaining>0)continue;
      if(j.type==='orderParts'){for(const k of Object.keys(this.spareParts))this.spareParts[k]+=3;this.partsShortage=false;this.cost+=180000;}
      else {this.fuelDepot+=8000;this.fuelAdded+=8000;this.faults.fuelShortage=false;}
      this.log('Поставка прибыла, ресурсы доступны.','success');
    }this.supplyJobs=this.supplyJobs.filter(j=>j.remaining>0);
  }
  _blast(dt){
    const b=this.blast;if(b.phase==='idle')return;
    const center=this.net.nodes.get(this.faceIds[0]);
    // Safety decisions use measured/estimated positions and their uncertainty, not simulation truth.
    const near=this.trucks.filter(t=>{const p=t.gps.estimate;if(!p)return true;return Math.hypot(p.x-center.x,p.z-center.z)-t.gps.uncertainty<145;});
    const reason=this.worker?'Человек в периметре':this.wind?'Сильный ветер':near.length?`Не подтверждён выход: ${near.map(t=>t.id).join(', ')}`:'';
    if(b.phase==='drilling'){
       b.timer+=dt;const count=Math.min(b.holes.length,Math.floor(b.timer/3));
       for(let i=b.drilled;i<count;i++)b.holes[i].status='drilled';b.drilled=count;
       if(count>0)b.hardnessIndex=Math.round(b.holes.slice(0,count).reduce((sum,h)=>sum+h.rockIndex,0)/count);
       if(count===b.holes.length){b.phase='charging';b.timer=0;this.log('MWD: бурение завершено; подготовлен учебный этап контроля готовности.','info');}
     }else if(b.phase==='charging'){
       b.timer+=dt;b.checked=Math.min(b.holes.length,Math.floor(b.timer/1.5));
       for(let i=0;i<b.checked;i++)b.holes[i].status='charged';
       if(b.checked===b.holes.length){b.phase='evacuation';b.timer=0;this.log('Контроль готовности выполнен. Погрузка остановлена; требуется подтвердить безопасный периметр.','warning');}
     }else if(b.phase==='evacuation'){
      for(const t of this.trucks)if(t.target===this.faceIds[0]&&t.status!=='loading'){t.target=t.payload>0?this._choose(t,'crusher'):this._choose(t,'depot');}
      b.reason=reason;if(!reason){b.phase='countdown';b.timer=20;this.log('Периметр подтверждён: отсчёт 20 с.','warning');}
    }else if(b.phase==='countdown'){
      if(reason){b.phase='evacuation';b.reason=reason;this.log('Отсчёт прерван: периметр не подтверждён.','danger');return;}
      b.timer-=dt;if(b.timer<=0){this.geology.blastPulse=Math.min(1,this.geology.blastPulse+.7);this.geology.cracks=clamp(this.geology.cracks+.065,0,1);b.phase='ventilation';b.timer=90;b.completed++;completeBlast(this);this.log(`Учебный взрыв выполнен. Модельная доля мелкой фракции ${Math.round(b.fragmentation*100)}%; проветривание и осмотр: 90 с.`,'warning');}
    }else if(b.phase==='ventilation'){b.timer-=dt;if(b.timer<=0){b.phase='idle';b.reason='';this.log('Взрывной участок осмотрен, погрузка возобновлена.','success');}}
  }
  startPlaybook(id){
    const p=PLAYBOOKS.find(p=>p.id===id);if(!p)return false;
    if(this.schedule.length){this.log('Дождитесь завершения программы событий или сбросьте модель.','warning');return false;}
    this.playbook=id;this.schedule=p.events.map(([after,action])=>({at:this.time+after,action}));this.log(`Сценарная цепочка: ${p.name}.`);return true;
  }
  step(seconds=1){
    if(!Number.isFinite(seconds)||seconds<0||seconds>3600)throw Error('Шаг симуляции: 0–3600 секунд.');
    this.accumulator+=seconds;
    while(this.accumulator>=.5-1e-9){this.accumulator=Math.max(0,this.accumulator-.5);this._tick(.5);}
  }
  _tick(dt){
    this.time+=dt;
    while(this.schedule.length&&this.schedule[0].at<=this.time){const ev=this.schedule.shift();if(ev.action in this.faults){if(!this.faults[ev.action])this.action(ev.action);}else if(ev.action==='potholes'){if(!this.roughRoads)this.action(ev.action);}else if(ev.action==='partsShortage'){if(!this.partsShortage)this.action(ev.action);}else this.action(ev.action);}
    this._jobs(dt);this._weather(dt);waterStep(this,dt);this._slope(dt);this._blast(dt);
    for(const t of this.trucks){
      if(t.status==='stranded'&&t.fuel>1&&!t.failedComponent)this._assign(t);
      const beforeDistance=t.distance;const e=t.edge?this.net.edges.get(t.edge):null;const grade=e?((this.net.nodes.get(t.to)?.elevation||0)-(this.net.nodes.get(t.from)?.elevation||0))/e.length:0;
      this._process(t,dt);
      const running=!['stranded','towing','repairing'].includes(t.status);
      // Idling consumes diesel too. Burn is limited by actual fuel in the tank.
      if(running&&t.distance===beforeDistance){const burn=Math.min(t.fuelLitres,dt/3600*this.fuelRates.idleLitresPerHour);t.fuelLitres-=burn;this.fuelConsumed+=burn;this.co2Kg+=burn*MODEL.dieselKgCo2PerL;this.cost+=burn*MODEL.fuelPriceKztPerL;}
      t.fuel=100*t.fuelLitres/MODEL.tankLitres;
      advanceCondition(t,{dt,meters:t.distance-beforeDistance,grade,roughness:(this.roughRoads?1.85:1)*(e?.dustFactor||1),loaded:t.payload>0,wet:this.roadWet,heat:this.faults.heat,dust:this.dust,idle:t.speed===0,overloaded:t.payload>t.capacity*1.1,braking:grade<-.02,running});
      if(t.failedComponent&&this.safety&&!['stranded','towing','repairing'].includes(t.status)){this._releaseAsset(t);t.status='stranded';t.speed=0;t.wheelSpeed=0;this.safetyStops++;this.log(`${t.id}: защитная остановка — ${COMPONENT_NAMES[t.failedComponent]}.`,'danger');}
      this._predictGps(t,dt);
      for(const msg of t.diagnostic)if(!t._reported.has(msg)){this.log(`${t.id}: ${msg}.`,'warning');t._reported.add(msg);}
      t.warnings=[...(t.status==='stranded'?['ОСТАНОВЛЕН']:[]),...(t.gps.ok?[]:['GPS ESTIMATE']),...(t.telemetryAge>5?['STALE RADIO']:[]),...(t.id==='HT-01'&&this.faults.weightFault&&t.payload>10?['WEIGHT MISMATCH']:[]),...(t.reverse?['ОБЪЕЗД / РАЗВОРОТ']:[]),...(t.fuel<19?['LOW FUEL']:[]),...t.diagnostic.slice(0,3)];
      if(t.telemetryAge===0)t.lastTelemetry=this._truckSnapshot(t);
    }
    processOre(this,dt);
    this.lostSeconds+=this.trucks.filter(t=>['stranded','towing'].includes(t.status)||t.reverse||t.safetyHold).length*dt;
    if(this.time-this.lastSample>=5){this.lastSample=this.time;this.history.push(this.metrics());if(this.history.length>720)this.history.shift();}
    this.activeShift=Math.floor(this.time/28800)+1;
  }
  metrics(){
    const t=this.trucks;
    const moving=t.filter(x=>x.speed>1).length;
    const queue=t.filter(x=>['loading','dumping','refueling','repairing'].includes(x.status)).length;
    const paused=t.filter(x=>x.status==='stranded'||x.status==='towing'||x.reverse||x.safetyHold).length;
    const grade=this.material.processed.mass>0?this.material.processed.metal*100/this.material.processed.mass:0;
    return {...productionMetrics(this),weatherImpact:weatherFactors(this.faults,this.visibility,this.dust,this.nightShift),time:round(this.time),maintenanceCost:round(this.maintenanceSpent),maintenanceDue:t.filter(x=>x.maintenanceDue).length,inWorkshop:t.filter(x=>x.status==='repairing'||x.status==='to_workshop').length,safetyStops:this.safetyStops,overspeedSeconds:round(this.overspeedEvents),avgEngineHealth:round(t.reduce((a,b)=>a+b.components.engine,0)/t.length),avgTyreHealth:round(t.reduce((a,b)=>a+b.components.tyres,0)/t.length),tonnes:round(this.totalOre),processed:round(this.processed),grade:round(grade,3),hopper:round(Object.values(this.hopper).reduce((a,b)=>a+b,0)),moving,queued:queue,paused,energyKwh:round(this.energyKwh),co2Kg:round(this.co2Kg),dieselLitres:round(this.fuelConsumed),cost:round(this.cost),dust:round(this.dust*100),visibility:round(this.visibility*100),fs:this.geology.fs,avgFuel:round(t.reduce((a,b)=>a+b.fuel,0)/t.length),trips:t.reduce((a,b)=>a+b.trips,0),dispatchChanges:this.dispatchChanges,lostSeconds:round(this.lostSeconds),fragmentationFinePct:round(this.blast.fragmentation*100),fragmentationCoarsePct:this.blast.coarsePct,mwdRockIndex:this.blast.hardnessIndex,blastCycles:this.blast.completed};
  }
  advisories(){
    const advice=[],g=this.geology;
    if(g.status==='critical' || g.failed)advice.push({priority:1,title:'Опасный уступ',reason:`FS=${g.fs.toFixed(2)}; закрыто дорог: ${this.blockedEdges().size}`,action:g.failed?(this.faults.rain?'rain':!this.faults.drainage?'drainage':g.water>=.4?'drainage':'clear'):'drainage',note:'Ограничить движение, включить дренаж и проверить устойчивость на месте'});
    const critical=this.trucks.filter(t=>t.failedComponent);
    if(critical.length)advice.push({priority:1,title:'Неисправность техники',reason:`${critical.map(t=>t.id).join(', ')} · критические агрегаты`,action:'tow',note:'Остановка по безопасности, эвакуация и диагностика'});
    const due=this.trucks.filter(t=>t.maintenanceDue);
    if(due.length)advice.push({priority:2,title:'Предиктивное обслуживание',reason:`${due.length} машин требуют ТО`,action:'preventive',note:'Планировать ремонт до аварии; оценить очередь мастерской'});
    if((this.partsShortage||Object.values(this.spareParts).some(n=>n===0))&&due.length)advice.push({priority:1,title:'Снабжение запчастями',reason:'Ремонт задерживается из-за склада',action:'orderParts',note:'Восстановить склад до направления дополнительных машин на ТО'});
    if(this.roughRoads)advice.push({priority:2,title:'Дефекты дорожного покрытия',reason:'Повышен износ шин, подвески и расход дизеля',action:'gradeRoad',note:'Отправить грейдер; сравнить дополнительные расходы с затратами на ремонт'});
    if(this.dust>.65)advice.push({priority:3,title:'Пылевая нагрузка',reason:`Пыль ${(this.dust*100).toFixed(0)}%`,action:'dustSuppression',note:'Полив дорожной сети снижает пыль, требует воды и топлива'});
    if(this.faults.crusherFault || this.faults.crusherBFault)advice.push({priority:2,title:'Переработка ограничена',reason:'Дробильное оборудование частично не работает',action:'repair',note:'Проверить очереди и баланс сырья перед переназначением'});
    if(this.water.reservoir<100)advice.push({priority:1,title:'Дефицит оборотной воды',reason:`В резервуаре ${round(this.water.reservoir)} м³`,action:this.recycling?'repair':'recycling',note:'Восстановить подачу и оборот; переработка ограничивается доступной водой'});
    if(this.water.sump>420)advice.push({priority:1,title:'Подтопление карьера',reason:`Сумп ${round(this.water.sump)} м³; закрытие дороги при 540`,action:this.faults.pumpFault?'repair':'drainage',note:'Проверить насос, дренаж и свободный объём пруда'});
    if(this.fuelDepot<1500)advice.push({priority:2,title:'Дизель заканчивается',reason:`Остаток ${round(this.fuelDepot)} л`,action:'orderFuel',note:'Цистерна прибудет через 180 с'});
    return advice.sort((a,b)=>a.priority-b.priority).slice(0,5);
  }
  _truckSnapshot(t){return {id:t.id,status:t.status,route:t.road,position:this._position(t),telemetryAge:t.telemetryAge,capacity:t.capacity,truePayload:round(t.payload),gpsPosition:t.gps.estimate,uncertainty:round(t.gps.uncertainty),gpsOk:t.gps.ok,speed:round(t.speed*3.6),wheelSpeed:round(t.wheelSpeed*3.6),payload:round(t.id==='HT-01'&&this.faults.weightFault?0:t.payload),expectedPayload:round(t.expectedPayload),fuel:round(t.fuel),tyre:round(t.tyre),health:round(t.health),grade:round(t.grade,2),components:{...t.components},engineHours:round(t.engineHours),engineTempC:round(t.engineTempC),brakeTempC:round(t.brakeTempC),oilPressureKpa:round(t.oilPressureKpa),tyrePressureKpa:round(t.tyrePressureKpa),batteryVoltageV:round(t.batteryVoltageV),maintenanceDue:t.maintenanceDue,serviceCount:t.serviceCount,priority:maintenancePriority(t),diagnostic:[...t.diagnostic],trips:t.trips,target:t.target,queueSeconds:round(t.queueSeconds),warnings:t.warnings,reverse:t.reverse};}
  snapshot(){
    const m=this.metrics();
    const fleet=this.trucks.map(t=>{const reading=t.lastTelemetry||this._truckSnapshot(t);return {...structuredClone(reading),edge:t.edge,from:t.from,to:t.to,progress:t.progress,reverse:t.reverse,telemetryAge:t.telemetryAge,uncertainty:round(t.gps.uncertainty),warnings:t.telemetryAge>0?[...(reading.warnings||[]),'STALE RADIO']:[...t.warnings]};});
    return {version:'3.1',mapId:this.map.id,mapName:this.map.name,time:this.time,metrics:m,flags:{...this.faults,ai:this.ai,safety:this.safety,predictive:this.predictive,potholes:this.roughRoads,nightShift:this.nightShift,partsShortage:this.partsShortage,recycling:this.recycling,trustAssay:this.trustAssay,worker:this.worker,wind:this.wind},geology:{...this.geology},fleet,assets:JSON.parse(JSON.stringify(this.assets)),blocked:[...this.blockedEdges()],traffic:Object.fromEntries(this.traffic()),production:structuredClone(this.material),oreBlocks:structuredClone(this.oreBlocks),water:{...this.water},stock:{parts:{...this.spareParts},fuelLitres:this.fuelDepot},jobs:structuredClone([...this.jobs,...this.supplyJobs]),blast:structuredClone(this.blast),schedule:structuredClone(this.schedule),playbook:this.playbook,history:this.history.slice(-240),events:this.events.slice(0,24),advisories:this.advisories(),lines:{...this.hopper},feedGrade:{...this.gradeFeed},shift:this.activeShift,seed:this.seed};
  }
  clone(){
    const c=new MineOperations(this.map,this.initialSeed);
    for(const key of Object.keys(this))if(!['map','net'].includes(key))c[key]=structuredClone(this[key]);
    return c;
  }
  forecast(seconds=180,change='drainage'){
    const horizon=clamp(Math.floor(seconds),30,600);const base=this.clone(),candidate=this.clone();
    if(change){candidate.action(change);}base.step(horizon);candidate.step(horizon);
    const a=base.metrics(),b=candidate.metrics(),o=this.metrics();
    return {horizon,change,baselineEndTime:base.time,alternativeEndTime:candidate.time,baseline:{tonnes:round(a.tonnes-o.tonnes),processed:round(a.processed-o.processed),co2Kg:round(a.co2Kg-o.co2Kg),maintenanceCost:round(a.maintenanceCost-o.maintenanceCost),cost:round(a.cost-o.cost),lostSeconds:round(a.lostSeconds-o.lostSeconds),copperTonnes:round(a.copperTonnes-o.copperTonnes,3),waterUsed:round(base.water.processUsed-this.water.processUsed),availabilityPct:a.availabilityPct},alternative:{tonnes:round(b.tonnes-o.tonnes),processed:round(b.processed-o.processed),co2Kg:round(b.co2Kg-o.co2Kg),maintenanceCost:round(b.maintenanceCost-o.maintenanceCost),cost:round(b.cost-o.cost),lostSeconds:round(b.lostSeconds-o.lostSeconds),copperTonnes:round(b.copperTonnes-o.copperTonnes,3),waterUsed:round(candidate.water.processUsed-this.water.processUsed),availabilityPct:b.availabilityPct},note:'Контрфактический прогон той же учебной модели; не промышленный прогноз.'};
  }
}
export function buildTwinTelemetry(s){
  const pack=(id,fields)=>({topic:`org.mine.mirage/${id}/things/twin/commands/modify`,path:'/features',value:Object.fromEntries(Object.entries(fields).map(([key,val])=>[key,{properties:{value:val}}]))});
  const m=s.metrics;
  const rows=[['mine-035',{tonnes:m.tonnes,processed:m.processed,co2_kg:m.co2Kg,diesel_l:m.dieselLitres,energy_kwh:m.energyKwh,grade_pct:m.grade,fs:s.geology.fs,dust_pct:m.dust,visibility_pct:m.visibility,moving:m.moving,queued:m.queued,maintenance_due:m.maintenanceDue,maintenance_cost_kzt:m.maintenanceCost,avg_engine_pct:m.avgEngineHealth,avg_tyre_pct:m.avgTyreHealth,cost_kzt:m.cost,road_closed:s.blocked.length,shift:s.shift,mass_error:m.massError,metal_error:m.metalError,water_error:m.waterError,fuel_error:m.fuelBalanceError,copper_t:m.copperTonnes,water_m3:m.waterReservoir,sump_m3:m.waterSump,pond_m3:m.waterPond,unit_cost:m.unitCost,availability:m.availabilityPct}],
    ...s.fleet.map(t=>[t.id.toLowerCase(),{state:t.status,target:t.target,grade_pct:t.grade,telemetry_age:t.telemetryAge||0,payload:t.payload,speed:t.speed,fuel:t.fuel,tyre:t.tyre,engine_temp_c:t.engineTempC,brake_temp_c:t.brakeTempC,oil_pressure_kpa:t.oilPressureKpa,engine_hours:t.engineHours,maintenance_due:t.maintenanceDue?1:0,gps_uncertainty:t.uncertainty,gps_ok:t.gpsOk?1:0,health:t.health,trips:t.trips,position_x:round(t.position.x),position_z:round(t.position.z)}]),
    ...Object.entries(s.assets).map(([id,a])=>[id,{state:a.state,health:a.health,passes:a.passes||0,rate:a.rate||0}]),
    ['slope-07',{state:s.geology.status,water:s.geology.water,cracks:s.geology.cracks,fs:s.geology.fs,collapsed:s.geology.failed?1:0}],
    ['weather-01',{rain:s.flags.rain?1:0,fog:s.flags.fog?1:0,heat:s.flags.heat?1:0,dust:m.dust,visibility:m.visibility}],
  ];return rows.map(([id,f])=>({id:`org.mine.mirage:${id}`,payload:pack(id,f)}));
}
