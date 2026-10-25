/** Portable reproducible experiment files. Restore uses validated state, never arbitrary methods. */
import {MineOperations,SCENARIOS} from './operations.js';
import {COMPONENT_KEYS} from './engineering.js';
import {validateMap} from './network.js';
export function exportRun(mine){
  const state={};for(const [key,value] of Object.entries(mine)){
    if(['net','map'].includes(key))continue;
    state[key]=structuredClone(value);
  }
  state.trucks=state.trucks.map(t=>({...t,_reported:[...t._reported]}));
  return {format:'mirage-run',version:1,modelVersion:'3.1',map:structuredClone(mine.map),state};
}
const finite=(n,a=-1e12,b=1e12)=>typeof n==='number'&&Number.isFinite(n)&&n>=a&&n<=b;
export function importRun(data){
  if(!data||data.format!=='mirage-run'||data.version!==1||data.modelVersion!=='3.1')throw Error('Нужна запись MINE//MIRAGE 3.1.');
  const map=validateMap(data.map),fresh=new MineOperations(map),s=data.state;
  if(!s||!Array.isArray(s.trucks)||s.trucks.length!==fresh.trucks.length||!finite(s.time,0,1e8)||!finite(s.accumulator,0,.5))throw Error('Повреждён заголовок записи.');
  const numericTree=(v,depth=0)=>{if(depth>20)throw Error('Слишком глубокая запись.');if(typeof v==='number'&&!finite(v))throw Error('Запись содержит некорректное число.');if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))throw Error('Недопустимое поле записи.');numericTree(x,depth+1);}};numericTree(s);
  // An exact schema avoids injecting new engine properties. Shape validation follows the reset state.
  function shape(value,template,path){
    if(template===null)return;
    if(Array.isArray(template)){if(!Array.isArray(value)||value.length>5000)throw Error(`Некорректный массив ${path}`);return;}
    if(template instanceof Set)return;
    if(typeof template==='object'){if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`Некорректный объект ${path}`);for(const [key,sub] of Object.entries(template))shape(value[key],sub,`${path}.${key}`);return;}
    if(typeof value!==typeof template)throw Error(`Некорректное поле ${path}`);
  }
  // Backward compatibility: V3.1 and V3.2 records predate explicit fuel rates.
  if(!s.fuelRates)s.fuelRates={...fresh.fuelRates};
  const template=exportRun(fresh).state;
  for(const key of Object.keys(fresh))if(!['net','map'].includes(key)){if(!(key in s))throw Error(`Не хватает поля ${key}`);shape(s[key],template[key],key);}
  const statuses=new Set(['hauling','returning','to_fuel','to_workshop','stranded','loading','dumping','refueling','repairing','towing']);
  for(let i=0;i<s.trucks.length;i++){
    const t=s.trucks[i];shape(t,template.trucks[i],`trucks.${i}`);
    if(t.id!==fresh.trucks[i].id||!statuses.has(t.status)||!fresh.net.nodes.has(t.node)||(t.target!==null&&!fresh.net.nodes.has(t.target))||!finite(t.progress,0,1)||!finite(t.payload,0,500)||!finite(t.fuelLitres,0,1200)||!finite(t.gps.uncertainty,0,200)||!Array.isArray(t._reported)||!Array.isArray(t.faultTags))throw Error(`Повреждено состояние ${t.id}`);
    if(t.edge&&(!fresh.net.edges.has(t.edge)||![t.from,t.to].every(id=>fresh.net.nodes.has(id))))throw Error('Дорога в записи не совпадает с картой.');
    if(Math.abs(t.payload-t.cargo.mass)>1e-6||t.cargo.mass<0||t.cargo.metal<0||t.cargo.metal>t.cargo.mass||Object.values(t.components).some(n=>!finite(n,0,100)))throw Error('Некорректны груз или агрегаты.');
  }
  for(const key of ['totalOre','processed','copper','fuelConsumed','co2Kg','cost','energyKwh','lostSeconds','maintenanceSpent'])if(!finite(s[key],0))throw Error('Отрицательный накопительный показатель.');
  if(!s.events.every(e=>e&&finite(e.at,0,s.time)&&typeof e.message==='string'&&e.message.length<2000&&['info','success','warning','danger'].includes(e.level)))throw Error('Повреждён журнал событий.');
  if(!s.history.every(h=>h&&finite(h.time,0,s.time)&&finite(h.tonnes,0)&&finite(h.processed,0)))throw Error('Повреждена история.');
  if(Object.values(s.water).some(v=>!finite(v,0)))throw Error('Некорректный водный баланс.');
  const actionIds=new Set(SCENARIOS.map(s=>s[0]));
  if(!s.schedule.every(e=>e&&finite(e.at,0,1e8)&&actionIds.has(e.action)))throw Error('Повреждено расписание.');
  if(!s.jobs.every(j=>j&&['repair','gradeRoad','reinforce','clear'].includes(j.type)&&finite(j.remaining,0,300)&&typeof j.label==='string'&&(j.type!=='repair'||Array.isArray(j.targets)&&j.targets.every(k=>k in fresh.faults))))throw Error('Повреждена очередь работ.');
  if(!s.supplyJobs.every(j=>j&&['orderParts','orderFuel'].includes(j.type)&&finite(j.remaining,0,180)))throw Error('Повреждён заказ снабжения.');
  if(!['idle','evacuation','countdown','ventilation'].includes(s.blast.phase)||!finite(s.blast.timer,0,90))throw Error('Повреждён взрывной цикл.');
  if(!finite(s.water.reservoir,0,1100)||!finite(s.water.sump,0,650)||!finite(s.water.pond,0,850)||!finite(s.fuelDepot,0,1e8))throw Error('Неверный запас ресурсов.');
  for(const key of COMPONENT_KEYS)if(!Number.isInteger(s.spareParts[key])||s.spareParts[key]<0||s.spareParts[key]>100000)throw Error('Неверный склад деталей.');
  for(const t of s.trucks){
    const kind=fresh.net.nodes.get(t.node).kind,required={loading:'face',dumping:'crusher',refueling:'fuel',repairing:'workshop'}[t.status];
    if(required&&kind!==required)throw Error('Состояние машины не соответствует объекту.');
    if(t.serviceParts!==undefined&&t.serviceParts!==null&&(!Array.isArray(t.serviceParts)||t.serviceParts.some(k=>!COMPONENT_KEYS.includes(k))))throw Error('Неверные детали ремонтной заявки.');
    if(t._reported.some(v=>typeof v!=='string')||t.faultTags.some(v=>typeof v!=='string'))throw Error('Повреждены диагностические метки.');
    if(t.edge){const e=fresh.net.edges.get(t.edge);if(![e.fromNode,e.toNode].includes(t.from)||![e.fromNode,e.toNode].includes(t.to)||t.from===t.to)throw Error('Положение не соответствует дороге.');}
    if(t.status==='towing'&&(!Array.isArray(t.towPath)||t.towPath.length<1||t.towPath.some(p=>!finite(p.x)||!finite(p.z))))throw Error('Повреждён путь эвакуатора.');
  }
  for(const id of fresh.faceIds){
    if(!Array.isArray(s.oreBlocks[id])||s.oreBlocks[id].length!==12)throw Error('Повреждена блочная модель.');
    for(let i=0;i<12;i++){const b=s.oreBlocks[id][i],original=fresh.oreBlocks[id][i];if(b.id!==original.id||b.initial!==original.initial||b.grade!==original.grade||b.hardness!==original.hardness||!finite(b.reserve,0,b.initial))throw Error('Повреждён геоблок.');}
  }
  const fuelBounds={emptyLitresPerKm:[.2,30],loadedLitresPerKm:[.2,30],idleLitresPerHour:[1,150]};
  for(const [key,[lo,hi]] of Object.entries(fuelBounds))if(!finite(s.fuelRates[key],lo,hi))throw Error('Некорректная топливная калибровка.');
  for(const k of Object.keys(fresh))if(!['map','net'].includes(k))fresh[k]=structuredClone(s[k]);
  fresh.trucks.forEach(t=>t._reported=new Set(t._reported));
  const metrics=fresh.metrics();
  if(['massError','metalError','waterError','fuelBalanceError'].some(k=>!finite(metrics[k],-1e-5,1e-5)))throw Error('Запись нарушает баланс ресурсов.');
  return fresh;
}
export function createReport(mine){
  const s=mine.snapshot();return {format:'mirage-report',version:1,model:'3.1 synthetic',map:mine.map,runTime:s.time,metrics:s.metrics,production:s.production,water:s.water,stock:s.stock,flags:s.flags,blast:s.blast,events:mine.events,history:mine.history,assumptions:'Учебные коэффициенты; полевой калибровки нет. Источники и единицы: ENGINEERING_MODEL_RU.md.'};
}
