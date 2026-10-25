/** Counterfactual decision support, NOT trained AI or an industrial optimizer.
 * Candidates share an identical initial state, RNG and future event schedule.
 * The module never modifies the operating mine. Policy weights are explicit.
 */
export const DECISION_WEIGHTS=Object.freeze({
  copperTonnes:1200, // points per additional tonne of recovered copper (scenario weight)
  processed:0.035,    // points per additional tonne processed
  cost:-0.00013,     // points per extra KZT spent
  lostSeconds:-0.018, // points per accumulated truck-idle second
  dieselLitres:-0.016,
  co2Kg:-0.004,
});
const ACTION_POOL=['drainage','reinforce','clear','repair','gradeRoad','orderParts','orderFuel','trustAssay','recycling','dustSuppression','tow','responsePlan','preventive'];
const labels={drainage:'Откачать воду',reinforce:'Укрепить уступ',clear:'Расчистить дорогу',repair:'Ремонт технологических отказов',gradeRoad:'Отремонтировать дорогу',orderParts:'Заказать запчасти',orderFuel:'Заказать дизель',trustAssay:'Проверить анализатор',recycling:'Подключить оборот воды',dustSuppression:'Полить дороги',tow:'Эвакуировать машину',responsePlan:'Комплексный план',preventive:'Плановое ТО'};
const metricKeys=Object.keys(DECISION_WEIGHTS);
const round=(x,d=3)=>Number(x.toFixed(d));
export function eligibleActions(m){
  const f=m.faults, g=m.geology;
  return ACTION_POOL.filter(a=>{
    switch(a){
      case 'drainage':return !f.drainage&&(f.rain||g.water>.2||m.water.sump>360);
      case 'reinforce':return !f.reinforced&&!g.failed&&g.fs<1.4&&!m.jobs.some(j=>j.type==='reinforce');
      case 'clear':return g.failed&&!f.rain&&f.drainage&&g.water<.4;
      case 'repair':return Object.keys(f).some(k=>f[k]&&['powerFault','crusherFault','crusherBFault','pumpFault','beltFault','gpsFault','radioFault','loaderFault','assayFault','fuelShortage','weightFault'].includes(k))&&!m.jobs.some(j=>j.type==='repair');
      case 'gradeRoad':return m.roughRoads&&!m.jobs.some(j=>j.type==='gradeRoad');
      case 'orderParts':return !m.supplyJobs.some(j=>j.type==='orderParts')&&(m.partsShortage||Object.values(m.spareParts).some(n=>n<1));
      case 'orderFuel':return m.fuelDepot<2200&&!m.supplyJobs.some(j=>j.type==='orderFuel');
      case 'trustAssay':return !m.trustAssay;
      case 'recycling':return !m.recycling;
      case 'dustSuppression':return !f.dustSuppression&&m.dust>.55&&m.water.reservoir>100;
      case 'tow':return m.trucks.some(t=>t.status==='stranded')&&!m.trucks.some(t=>t.status==='towing');
      case 'preventive':return m.trucks.some(t=>t.maintenanceDue)&&m.trucks.some(t=>!['repairing','to_workshop','stranded'].includes(t.status));
      case 'responsePlan':return g.status!=='stable'||Object.values(f).some(Boolean)||m.partsShortage;
    }
    return false;
  });
}
function outcome(m,origin){const x=m.metrics();return Object.fromEntries(metricKeys.map(k=>[k,round(x[k]-origin[k],6)]).concat([
  ['safetyStops',x.safetyStops-origin.safetyStops],
  ['collapse',Boolean(m.geology.failed)],
  ['slopeIndex',round(m.geology.fs,4)],
  ['waterSump',round(m.water.sump,2)],
  ['failedTrucks',m.trucks.filter(t=>t.failedComponent).length]
]));}
function score(baseline,alternative,weights){
  const delta=Object.fromEntries(metricKeys.map(k=>[k,round(alternative[k]-baseline[k],6)]));
  const contributions=Object.fromEntries(metricKeys.map(k=>[k,round(delta[k]*weights[k])]));
  const riskWorsens=(!baseline.collapse&&alternative.collapse) || alternative.failedTrucks>baseline.failedTrucks+1 || alternative.safetyStops>baseline.safetyStops;
  return {delta,contributions,score:round(Object.values(contributions).reduce((a,b)=>a+b,0)),safetyGate:riskWorsens?'rejected':'pass'};
}
export function evaluateDecisions(mine,{horizon=300,actions=null,maxOptions=8,weights=DECISION_WEIGHTS}={}){
  if(!Number.isInteger(horizon)||horizon<30||horizon>600)throw Error('Горизонт анализа: 30–600 игровых секунд.');
  if(!Number.isInteger(maxOptions)||maxOptions<1||maxOptions>20)throw Error('Количество кандидатов: 1–20.');
  const policy={};for(const k of metricKeys){if(!Number.isFinite(weights[k])||Math.abs(weights[k])>1e6)throw Error('Некорректные веса цели.');policy[k]=weights[k];}
  const available=eligibleActions(mine);const candidates=(actions??available).filter(a=>ACTION_POOL.includes(a)&&available.includes(a)).slice(0,maxOptions);
  const origin=mine.metrics(),b=mine.clone();b.step(horizon);const baseline=outcome(b,origin);
  const options=[];
  for(const action of candidates){
    const alt=mine.clone();if(alt.action(action)===false)continue;
    alt.step(horizon);const alternative=outcome(alt,origin),ranking=score(baseline,alternative,policy);
    options.push({action,label:labels[action],baseline,alternative,...ranking});
  }
  options.sort((a,b)=>(a.safetyGate==='rejected'?1:0)-(b.safetyGate==='rejected'?1:0)||b.score-a.score||a.action.localeCompare(b.action));
  const best=options.find(x=>x.safetyGate==='pass'&&x.score>0.001)||null;
  return {model:'MINE//MIRAGE synthetic 3.1-compatible',horizon,weights:policy,baseline,options,recommendation:best?best.action:'continue',recommendationExplanation:best?`Сценарное сравнение: ${best.label}, оценка ${best.score} баллов по указанным весам.`:'Продолжить без нового действия: среди проверенных вариантов нет положительного эффекта по выбранным весам и ограничениям.',disclaimer:'Ранжирование условное, зависит от весов и демонстрационных параметров. Никаких гарантий безопасности или экономического эффекта.'};
}
