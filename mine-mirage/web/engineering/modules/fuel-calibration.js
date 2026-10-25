/** Transparent fuel calibration from independently recorded trip/idle segments.
 * No synthetic observations are supplied or silently generated.
 * A holdout is formed by sorting each segment class chronologically.
 */
export const FUEL_BASELINE=Object.freeze({emptyLitresPerKm:2.10,loadedLitresPerKm:2.75,idleLitresPerHour:18});
const classes=['empty','loaded','idle'];
const keys={empty:'emptyLitresPerKm',loaded:'loadedLitresPerKm',idle:'idleLitresPerHour'};
const round=(n,d=5)=>Number(n.toFixed(d));
function factor(s){
  const climb=Math.max(0,s.gradePct||0)/100, wet=s.wetFraction||0, rough=s.roughness??1;
  return (1+climb*3+wet*.2+(s.overloaded?.28:0)+(s.lowTyrePressure?.18:0)+(s.heat?.09:0))*rough;
}
function check(s,i){
  const fail=msg=>{throw Error(`Рейс ${i+1}: ${msg}`);};
  if(!s||!classes.includes(s.mode)||typeof s.asset!=='string'||!s.asset.trim()||!Number.isFinite(s.time_s)||s.time_s<0)fail('режим/машина/время');
  if(!Number.isFinite(s.fuel_l)||s.fuel_l<0||s.fuel_l>1500)fail('измеренный дизель');
  if(s.mode==='idle'){
    if(!Number.isFinite(s.duration_s)||s.duration_s<=0||s.duration_s>24*3600)fail('длительность простоя');
    if(s.distance_km!==undefined&&s.distance_km!==0)fail('простой с ненулевым пробегом');
  }else{
    if(!Number.isFinite(s.distance_km)||s.distance_km<=0||s.distance_km>200)fail('пробег');
    if(!Number.isFinite(s.gradePct||0)||Math.abs(s.gradePct||0)>25||!Number.isFinite(s.roughness??1)||(s.roughness??1)<.7||(s.roughness??1)>3.5)fail('уклон/дорога');
    if(!Number.isFinite(s.wetFraction||0)||(s.wetFraction||0)<0||(s.wetFraction||0)>1)fail('влажность');
    for(const k of ['overloaded','lowTyrePressure','heat'])if(s[k]!==undefined&&typeof s[k]!=='boolean')fail(k);
  }
}
function x(s){return s.mode==='idle'?s.duration_s/3600:s.distance_km*factor(s);}
function summary(data,coef){
  const errors=data.map(s=>coef*x(s)-s.fuel_l);
  if(!errors.length)return null;
  const mean=fn=>errors.reduce((n,v)=>n+fn(v),0)/errors.length;
  return {count:errors.length,maeLitres:round(mean(Math.abs)),rmseLitres:round(Math.sqrt(mean(v=>v*v))),biasLitres:round(mean(v=>v))};
}
export function calibrateFuel(doc,{minimumPerGroup=8}={}){
  if(!doc||doc.format!=='mirage-fuel-observations-v1'||!Array.isArray(doc.records)||doc.records.length>50000)throw Error('Нужен документ mirage-fuel-observations-v1 с records[].');
  if(!Number.isInteger(minimumPerGroup)||minimumPerGroup<6||minimumPerGroup>200)throw Error('Размер выборки 6–200.');
  if(typeof doc.source!=='string'||doc.source.trim().length<12||!doc.period||typeof doc.period!=='string')throw Error('Укажите источник измерений и период.');
  const rows=doc.records;
  rows.forEach(check);
  const results={},proposal={...FUEL_BASELINE},warnings=[];let accepted=0;
  for(const mode of classes){
    const subset=rows.filter(r=>r.mode===mode).sort((a,b)=>a.time_s-b.time_s||a.asset.localeCompare(b.asset));
    if(subset.length<minimumPerGroup){warnings.push(`Недостаточно измерений ${mode}: ${subset.length}/${minimumPerGroup}. Коэффициент не меняется.`);results[mode]={status:'insufficient',samples:subset.length};continue;}
    // Reserve the chronologically latest 25% of records as unseen validation.
    const split=Math.floor(subset.length*.75),train=subset.slice(0,split),test=subset.slice(split);
    const nominator=train.reduce((sum,s)=>sum+x(s)*s.fuel_l,0),denominator=train.reduce((sum,s)=>sum+x(s)**2,0);
    const estimate=denominator?nominator/denominator:NaN;
    const range=mode==='idle'?[1,150]:[.2,30];
    const baseline=summary(test,FUEL_BASELINE[keys[mode]]);
    const holdout=Number.isFinite(estimate)?summary(test,estimate):null;
    const improvement=baseline&&holdout?baseline.maeLitres-holdout.maeLitres:0;
    const plausible=Number.isFinite(estimate)&&estimate>=range[0]&&estimate<=range[1];
    // Small gains are not enough evidence for replacing baseline coefficients.
    const pass=plausible&&baseline.maeLitres>0&&improvement>=baseline.maeLitres*.05;
    if(pass){proposal[keys[mode]]=round(estimate,6);accepted++;}
    else warnings.push(`${mode}: ${plausible?'нет улучшения на отложенных наблюдениях':'коэффициент за разумными границами'}; оставлено исходное значение.`);
    results[mode]={status:pass?'candidate':'rejected',train:train.length,holdout:test.length,
      fittedRate:round(Number.isFinite(estimate)?estimate:0),baselineRate:FUEL_BASELINE[keys[mode]],baseline,validation:holdout,
      improvementPct:baseline.maeLitres?round(100*improvement/baseline.maeLitres,2):null};
  }
  return {version:1,status:accepted?'candidate_needs_engineer_approval':'not_calibrated',source:doc.source,period:doc.period,calibrationType:'chronological_holdout',
    proposedRates:proposal,acceptedGroups:accepted,groups:results,warnings,
    warning:'Истинность и независимость наблюдений не подтверждается программой. Калибровка только расхода дизеля в игровой модели, без подтверждения остальных физических процессов.'};
}
export function applyFuelCalibration(mine,result,{approved=false}={}){
  if(!approved)throw Error('Необходимо явное подтверждение инженера.');
  if(!result||result.status!=='candidate_needs_engineer_approval')throw Error('Нет прошедшего проверку предложения.');
  const rates=result.proposedRates;
  for(const [mode,key] of Object.entries(keys)){
    const n=rates[key],range=mode==='idle'?[1,150]:[.2,30];
    if(!Number.isFinite(n)||n<range[0]||n>range[1])throw Error('Некорректный коэффициент.');
  }
  mine.fuelRates={...rates};
  return mine.fuelRates;
}
