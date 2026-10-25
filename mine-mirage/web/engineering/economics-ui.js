import {evaluateEconomicPolicy} from './modules/economic-policy.js';
import {calibrateFuel,applyFuelCalibration} from './modules/fuel-calibration.js';
import {exportRun} from './modules/evidence.js';
const $=id=>document.getElementById(id);
const fmt=(x,dec=2)=>Number(x).toLocaleString('ru-RU',{maximumFractionDigits:dec});
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let fuelResult=null,report=null,carriedMine=null;
function bind(){
 const e=$('economic-run');if(!e)return;
 e.onclick=()=>{
  if(!globalThis.__mirageEngineeringMine){$('economic-output').textContent='Сначала создайте или загрузите состояние карьера.';return;}
  e.disabled=true;$('economic-output').textContent='Расчёт альтернатив...';
  setTimeout(()=>{try{
   carriedMine=globalThis.__mirageEngineeringMine();
   report=evaluateEconomicPolicy(carriedMine,{
    horizon:Number($('economic-horizon').value),
    assumptions:{copperValueKztPerTonne:Number($('copper-price').value),maximumExtraSpendKzt:Number($('decision-budget').value)}
   });
   $('economic-output').textContent=report.recommendation==='continue'? 'Продолжать работу: подходящего положительного решения не найдено.' :
    'Рекомендуемое действие: '+report.options.find(o=>o.action===report.recommendation)?.label+' · '+(report.reason==='safety_priority'?'приоритет безопасности':'модельная дополнительная выгода '+fmt(report.expectedNetBenefitKzt)+' ₸');
   $('economic-options').innerHTML=report.options.length?report.options.map(o=>`<tr><td>${esc(o.label)}</td><td>${fmt(o.delta.copperTonnes,4)}</td><td>${fmt(o.extraCostKzt)}</td><td><b>${fmt(o.netBenefitKzt)}</b></td><td>${esc(o.safetyGate)}</td></tr>`).join(''):'<tr><td colspan="5">Сейчас нет допустимых действий.</td></tr>';
   $('economic-note').textContent='Условная стоимость меди: '+fmt(report.assumptions.copperValueKztPerTonne)+' ₸/т. Результат зависит от принятой цены и демонстрационных коэффициентов.';
  }catch(err){$('economic-output').textContent='Ошибка: '+err.message;}finally{e.disabled=false;}},20);
 };
 $('fuel-input').onchange=async ev=>{
  try{
   const file=ev.target.files?.[0];if(!file)return;
   if(file.size>2e6)throw Error('Не более 2 МБ.');
   const doc=JSON.parse(await file.text());fuelResult=calibrateFuel(doc);
   $('fuel-report').textContent=`Источник (не проверен программой): ${fuelResult.source}; период: ${fuelResult.period}. Статус: ${fuelResult.status}. Принято групп: ${fuelResult.acceptedGroups}/3.`;
   $('fuel-rows').innerHTML=Object.entries(fuelResult.groups).map(([mode,r])=>`<tr><td>${esc(mode)}</td><td>${esc(r.status)}</td><td>${r.samples??r.train+' / '+r.holdout}</td><td>${r.validation?fmt(r.validation.maeLitres,3):'—'}</td><td>${r.improvementPct===undefined?'—':fmt(r.improvementPct)+'%'}</td></tr>`).join('');
   $('fuel-warnings').textContent=fuelResult.warnings.join(' ')||'Все кандидаты прошли проверку на отложенных измерениях. Источник измерений ещё требует инженерной проверки.';
  }catch(err){fuelResult=null;$('fuel-report').textContent='Ошибка данных: '+err.message;}
  finally{ev.target.value='';}
 };
 $('apply-fuel').onclick=()=>{
  try{
   const approved=$('engineer-approval').checked;
   if(!fuelResult)throw Error('Нет результатов загрузки.');
   const mine=globalThis.__mirageEngineeringMine?.();if(!mine)throw Error('Сначала создайте карьер.');
   const rates=applyFuelCalibration(mine,fuelResult,{approved});
   $('fuel-report').textContent='Коэффициенты применены ТОЛЬКО к текущей копии в инженерной лаборатории: '+JSON.stringify(rates)+'. Основная 3D-страница не изменена.';
  }catch(err){$('fuel-report').textContent='Применение отклонено: '+err.message;}
 };
 $('fuel-save-run').onclick=()=>{
  try{
    const mine=globalThis.__mirageEngineeringMine?.();if(!mine)throw Error('Нет состояния карьера.');
    const blob=new Blob([JSON.stringify(exportRun(mine),null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='mirage-calibrated-run.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),500);
    $('fuel-report').textContent='Текущее состояние лаборатории сохранено. Файл совместим с импортом записи в инженерную лабораторию.';
  }catch(err){$('fuel-report').textContent='Не удалось сохранить: '+err.message;}
 };
 $('economic-export').onclick=()=>{
  if(!report)return;
  const blob=new Blob([JSON.stringify({report,calibration:fuelResult,disclaimer:'Simulation, not field-proven'},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='mirage-economic-check.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),500);
 };
}
bind();
