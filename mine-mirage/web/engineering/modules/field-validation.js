/** This module can measure the disagreement with field measurements.
 * It does NOT fit any parameters or manufacture real-world observations. */
const allowed=new Set(['speed_kmh','diesel_l','engine_temp_c','brake_temp_c','processed_t','copper_t']);
export function compareMeasurements(records){
 if(!Array.isArray(records)||records.length>100000)throw Error('records: массив до 100000 измерений.');
 const series=new Map();
 for(const [index,r] of records.entries()){
  if(!r||!allowed.has(r.metric)||typeof r.asset!=='string'||!r.asset.trim()||!Number.isFinite(r.time_s)||r.time_s<0||!Number.isFinite(r.observed)||!Number.isFinite(r.predicted))throw Error(`Некорректное измерение №${index+1}.`);
  if(Math.abs(r.observed)>1e8||Math.abs(r.predicted)>1e8)throw Error('Измерение вне диапазона.');
  const key=`${r.metric}|${r.asset}`,a=series.get(key)||[];a.push(r);series.set(key,a);
 }
 const output=[];
 for(const [key,arr] of series){
  const errors=arr.map(r=>r.predicted-r.observed);const [metric,asset]=key.split('|');
  const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
  const nonzero=arr.filter(r=>Math.abs(r.observed)>1e-6);
  output.push({metric,asset,n:arr.length,mae:mean(errors.map(Math.abs)),rmse:Math.sqrt(mean(errors.map(x=>x*x))),bias:mean(errors),mapePct:nonzero.length?mean(nonzero.map(r=>Math.abs((r.predicted-r.observed)/r.observed)))*100:null});
 }
 return {modelValidation:'UNVALIDATED unless real recorded measurements were provided',count:records.length,groups:output,warning:'Validation metrics quantify error for these samples only. Synthetic example data must not be labelled as field measurements.'};
}
