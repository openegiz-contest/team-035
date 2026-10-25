/** Explicit separation of internal consistency from real-world validation. */
import {createNetwork} from './network.js';
export function auditEngineering(mine){
 const result={version:'1',calibration:'synthetic — no field validation',time:mine.time,mapId:mine.map.id,checks:[],statistics:{}};
 const add=(id,severity,detail)=>result.checks.push({id,severity,detail});
 const m=mine.metrics(),net=createNetwork(mine.map);let high=0,maxGrade=0;
 for(const edge of net.edges.values()){maxGrade=Math.max(maxGrade,edge.grade);if(edge.grade>.10){high++;add(`ROAD_${edge.id}`,edge.grade>.15?'critical':'warning',`Уклон ${(edge.grade*100).toFixed(2)}%. Нужна проверка паспорта дороги и параметров машины.`);}}
 result.statistics.maxGradePct=Number((maxGrade*100).toFixed(2));result.statistics.steepSegments=high;
 for(const [k,unit] of [['massError','т'],['metalError','т Cu'],['waterError','м³'],['fuelBalanceError','л']]){
  const value=m[k];add(`BALANCE_${k}`,!Number.isFinite(value)||Math.abs(value)>1e-5?'critical':'pass',`${k}: ${value} ${unit}; внутренний баланс, не полевое измерение`);
 }
 for(const t of mine.trucks){
  if(t.payload>t.capacity*1.01)add(`OVERLOAD_${t.id}`,'warning',`Загрузка ${(100*t.payload/t.capacity).toFixed(1)}% паспортной вместимости в модели.`);
  if(t.telemetryAge>15)add(`TELEMETRY_${t.id}`,'warning',`Последняя телеметрия ${t.telemetryAge.toFixed(0)} с назад; не использовать как live.`);
  if(!Number.isFinite(t.fuelLitres)||t.fuelLitres<0||t.fuelLitres>1200.01)add(`FUEL_${t.id}`,'critical',`Топливо за пределами бака: ${t.fuelLitres}`);
  if(Object.values(t.components).some(v=>!Number.isFinite(v)||v<0||v>100))add(`COMPONENT_${t.id}`,'critical','Ресурс агрегатов должен оставаться в 0–100%.');
 }
 if(!mine.map.source)add('MAP_PROVENANCE','warning','Геометрия синтетическая. Геодезия/GNSS/ЦМР и реальные паспорта дорог не приложены.');
 add('COEFFICIENTS','warning','Износ, цены и надёжность не откалиброваны по журналам ТО, расходу и телеметрии предприятия.');
 const counts={pass:0,warning:0,critical:0};for(const c of result.checks)counts[c.severity]++;
 result.counts=counts;result.status=counts.critical?'fail':counts.warning?'review':'pass';
 result.meaning='PASS означает внутреннюю согласованность указанных проверок, НЕ промышленную валидацию.';
 return result;
}
