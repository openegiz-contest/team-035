import {MineOperations} from './modules/operations.js';
import {importRun} from './modules/evidence.js';
import {evaluateDecisions} from './modules/decision-lab.js';
import {auditEngineering} from './modules/data-quality.js';
const $=id=>document.getElementById(id);const fmt=n=>Number(n||0).toLocaleString('ru-RU',{maximumFractionDigits:3});
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let mine,decision,audit;
globalThis.__mirageEngineeringMine=()=>mine;
async function reset(){const map=await(await fetch('/data/maps/saryarka.json')).json();mine=new MineOperations(map);runAudit();$('status').textContent='Чистый синтетический карьер · расчётная модель 3.1, инженерные проверки 3.2';}
function runAudit(){audit=auditEngineering(mine);$('quality').innerHTML=`<p><span class="flag ${audit.status==='fail'?'fail':audit.status==='review'?'warning':''}">${escape(audit.status)}</span> Проверок: ${audit.checks.length}. Предупреждений: ${audit.counts.warning}, ошибок: ${audit.counts.critical}</p>`+audit.checks.map(x=>`<p class="muted"><span class="flag ${x.severity==='critical'?'fail':x.severity==='warning'?'warning':''}">${escape(x.severity)}</span> ${escape(x.detail)}</p>`).join('');}
$('start').onclick=()=>reset().catch(error=>$('status').textContent=error.message);
$('storm').onclick=async()=>{await reset();mine.action('rain');mine.action('pumpFault');mine.step(45);runAudit();$('status').textContent='Сценарий: дождь, отказ насоса, последствия через 45 с.';};
$('roads').onclick=async()=>{await reset();mine.action('potholes');mine.action('lowTyrePressure');mine.step(90);runAudit();$('status').textContent='Сценарий: разбитая дорога + давление шин, последствия через 90 с.';};
$('file').onchange=async e=>{try{const f=e.target.files?.[0];if(!f)return;if(f.size>3e6)throw Error('Максимум 3 МБ');mine=importRun(JSON.parse(await f.text()));runAudit();$('status').textContent='Загружена запись: '+mine.map.name+' · время '+fmt(mine.time)+' с';}catch(err){$('status').textContent='Ошибка записи: '+err.message;}finally{e.target.value='';}};
$('calculate').onclick=()=>{const b=$('calculate');b.disabled=true;$('status').textContent='Сравниваем альтернативы...';setTimeout(()=>{try{decision=evaluateDecisions(mine,{horizon:Number($('horizon').value),maxOptions:8});$('recommendation').textContent=decision.recommendation==='continue'?'Результат: продолжать без вмешательства':'Рекомендация: '+decision.options.find(o=>o.action===decision.recommendation)?.label;
 $('options').innerHTML=decision.options.length?decision.options.map(o=>`<tr><td>${escape(o.label)}</td><td>${fmt(o.score)}</td><td>${fmt(o.delta.processed)}</td><td>${fmt(o.delta.copperTonnes)}</td><td>${fmt(o.delta.cost)}</td><td>${fmt(o.delta.lostSeconds)}</td><td><span class="flag ${o.safetyGate==='rejected'?'fail':''}">${escape(o.safetyGate)}</span></td></tr>`).join(''):'<tr><td colspan="7" class="empty">Нет подходящих действий в текущем состоянии.</td></tr>';
 $('status').textContent='Расчёт завершён; рабочее состояние не изменилось.';}catch(err){$('status').textContent='Ошибка: '+err.message;}finally{b.disabled=false;}},25);};
$('export').onclick=()=>{const report={audit,decision,provenance:'Synthetic model only, no field validation'};const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='mirage-engineering-audit.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),500);};
reset().catch(error=>$('status').textContent=error.message);
