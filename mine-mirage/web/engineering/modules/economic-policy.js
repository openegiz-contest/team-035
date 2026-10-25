/** Monetary comparison of actions on equal copies of the same synthetic mine.
 * Copper value is a scenario assumption, never a market quotation.
 * Risk checks are hard constraints, not arbitrary positive score bonuses.
 */
import {eligibleActions} from './decision-lab.js';
export const ECONOMIC_ASSUMPTIONS=Object.freeze({
  copperValueKztPerTonne:3_500_000,  // hypothetical recovered Cu value; user supplies own contract price
  maximumExtraSpendKzt:250_000,
  minimumNetBenefitKzt:1000,
  maximumSafetyStopsIncrease:0,
});
const round=(v,d=2)=>Number(v.toFixed(d));
const finite=(x,min,max,name)=>{if(!Number.isFinite(x)||x<min||x>max)throw Error(`Некорректный ${name}`);return x;};
const difference=(after,before)=>({
  copperTonnes:after.copperTonnes-before.copperTonnes,
  processedTonnes:after.processed-before.processed,
  costKzt:after.cost-before.cost,
  fuelLitres:after.dieselLitres-before.dieselLitres,
  lostSeconds:after.lostSeconds-before.lostSeconds,
  safetyStops:after.safetyStops-before.safetyStops,
});
const outcome=(mine,origin)=>difference(mine.metrics(),origin);
const actionNames={drainage:'Откачать воду',reinforce:'Укрепить уступ',clear:'Расчистить дорогу',repair:'Ремонт оборудования',gradeRoad:'Грейдер',orderParts:'Поставка запчастей',orderFuel:'Поставка дизеля',trustAssay:'Проверить анализ',recycling:'Оборотная вода',dustSuppression:'Полив дорог',tow:'Эвакуация',responsePlan:'План восстановления',preventive:'Плановое ТО'};
export function evaluateEconomicPolicy(mine,{horizon=600,actions=null,maxOptions=10,assumptions={}}={}){
  if(!Number.isInteger(horizon)||horizon<60||horizon>3600)throw Error('Горизонт: 60–3600 игровых секунд.');
  if(!Number.isInteger(maxOptions)||maxOptions<1||maxOptions>20)throw Error('maxOptions: 1–20.');
  const cfg={...ECONOMIC_ASSUMPTIONS,...assumptions};
  finite(cfg.copperValueKztPerTonne,0,1e9,'цена меди');
  finite(cfg.maximumExtraSpendKzt,0,1e9,'бюджет');
  finite(cfg.minimumNetBenefitKzt,0,1e8,'порог выгоды');
  finite(cfg.maximumSafetyStopsIncrease,0,0,'ограничение безопасности');
  const available=eligibleActions(mine),selected=(actions??available).filter(a=>available.includes(a)).slice(0,maxOptions);
  const initial=mine.metrics(),control=mine.clone();control.step(horizon);
  const baseline=outcome(control,initial),rows=[];
  for(const action of selected){
    const test=mine.clone();if(test.action(action)===false)continue;
    test.step(horizon);const candidate=outcome(test,initial);
    const delta=Object.fromEntries(Object.keys(baseline).map(k=>[k,candidate[k]-baseline[k]]));
    const additionalRevenue=delta.copperTonnes*cfg.copperValueKztPerTonne;
    const netBenefit=additionalRevenue-delta.costKzt;
    const isNewCollapse=!control.geology.failed&&test.geology.failed;
    const newFailures=test.trucks.filter(t=>t.failedComponent).length-control.trucks.filter(t=>t.failedComponent).length;
    const worsening=delta.safetyStops>cfg.maximumSafetyStopsIncrease||isNewCollapse||newFailures>0;
    const budgetExceeded=delta.costKzt>cfg.maximumExtraSpendKzt;
    const mitigatesCollapse=control.geology.failed&&!test.geology.failed;
    const eligible=!worsening&&!budgetExceeded;
    rows.push({action,label:actionNames[action]??action,
      delta:Object.fromEntries(Object.entries(delta).map(([k,v])=>[k,round(v,4)])),
      extraRevenueKzt:round(additionalRevenue),extraCostKzt:round(delta.costKzt),
      netBenefitKzt:round(netBenefit),mitigatesCollapse,
      safetyGate:worsening?'rejected':budgetExceeded?'over_budget':'pass',
      profitable:eligible&&netBenefit>=cfg.minimumNetBenefitKzt,
      breakEvenCopperValueKztPerTonne:Math.abs(delta.copperTonnes)>1e-8?round(delta.costKzt/delta.copperTonnes):null,
    });
  }
  rows.sort((a,b)=>{
    const gate=r=>r.safetyGate==='pass'?0:1;
    return gate(a)-gate(b)||b.netBenefitKzt-a.netBenefitKzt||a.action.localeCompare(b.action);
  });
  const safest=rows.filter(r=>r.safetyGate==='pass');
  const financiallyBest=safest.find(r=>r.profitable)||null;
  // An action preventing an actual simulated collapse may be selected even if
  // financially negative. It is clearly designated as safety, not as profit.
  const emergency=safest.filter(r=>r.mitigatesCollapse).sort((a,b)=>b.netBenefitKzt-a.netBenefitKzt)[0];
  const recommendation=emergency?.action??financiallyBest?.action??'continue';
  const selectedRow=rows.find(r=>r.action===recommendation);
  return {version:'3.3',type:'synthetic-economic-counterfactual',horizon,
    assumptions:cfg,baseline,options:rows,recommendation,
    reason:emergency?'safety_priority':financiallyBest?'positive_model_net_value':'no_qualified_economic_improvement',
    expectedNetBenefitKzt:selectedRow?selectedRow.netBenefitKzt:0,
    coverage:{available:available.length,simulated:rows.length},
    limitations:'Расчётная медь × условная цена минус модельные операционные затраты; без капитальных расходов, дисконтирования, вероятностного риска и реального рыночного контракта. Не промышленная оптимизация.'};
}
