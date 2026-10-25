import {performanceEstimate,compareServicePerformance} from './performance.js';
/**
 * Demonstration engineering parameters, NOT field-calibrated predictions.
 * Units and provenance are recorded in ENGINEERING_MODEL_RU.md.
 * All functions are deterministic; no concealed randomness in failure decisions.
 */
export const MODEL = Object.freeze({
  version:'3.1-final',
  calibration:'synthetic',
  unitDistance:'m',unitTime:'s',unitFuel:'L',
  tankLitres:1200, dieselKgCo2PerL:2.689, // EPA 10.180 kg/US gallon / 3.785411784 L
  fuelPriceKztPerL:320, labourKztPerHour:16000,
  sparePartsKzt:{engine:110000,brakes:51000,tyres:155000,suspension:67000,cooling:42000,drivetrain:76000,electrical:27000,hydraulics:56000},
  speedLimitFault:4.0, serviceSeconds:55, // accelerated demo clock, not real repair duration
  estimatedServiceHours:{engine:8,drivetrain:6,brakes:3,tyres:1.5,suspension:4,cooling:2,electrical:2,hydraulics:3},
  tyreWearPerKm:.13, // percentage points per kilometre in illustrative model
  engineWearPerHour:.35, brakeWearPerKm:.13,suspensionWearPerKm:.12,
  breakdownThreshold:9, preventiveThreshold:56,
});
export const COMPONENT_KEYS=['engine','drivetrain','brakes','tyres','suspension','cooling','electrical','hydraulics'];
export const COMPONENT_NAMES={engine:'Двигатель',drivetrain:'Трансмиссия',brakes:'Тормоза',tyres:'Шины',suspension:'Подвеска',cooling:'Охлаждение',electrical:'Электрика',hydraulics:'Гидравлика'};
const limit=(n,lo=0,hi=100)=>Math.min(hi,Math.max(lo,n));
export function initCondition(t,index=0){
  const base=()=>({engine:92-index%5*2,drivetrain:94-index%4*2,brakes:95-index%3*2,tyres:t.tyre,suspension:90-index%4*2,cooling:96,electrical:94,hydraulics:95});
  t.components=base();t.engineHours=240+(index*113)%1250;t.engineTempC=82;t.brakeTempC=52;
  t.oilPressureKpa=410;t.tyrePressureKpa=690;t.batteryVoltageV=27.8;t.fuelLitres=MODEL.tankLitres*(t.fuel/100);
  t.serviceCount=0;t.lastServiceHours=t.engineHours;t.serviceReason=null;t.serviceElapsed=0;t.serviceLabourCostKzt=0;t.failure=null;t.failedComponent=null;t.maintenanceDue=false;
  t.faultTags=[];t.diagnostic=[];t._reported=new Set();t._consumedLitres=0;t._serviceCost=0;
  t.serviceHistory=[];t.lastServiceReport=null;t.workMetrics={distanceKm:0,loadedKm:0,emptyKm:0,idleHours:0,operatingHours:0,tonneKm:0,fuelLitres:0,fuelCostKzt:0,maintenanceCostKzt:0,tyreWearPoints:0,engineWearPoints:0};
  return t;
}
/** Advance component temperatures, wear, and engine hours given an actual traveled distance. */
export function advanceCondition(t,{dt,meters=0,grade=0,roughness=1,loaded=false,wet=0,heat=false,dust=0,idle=false,overloaded=false,braking=false,running=true}={}){
  const km=Math.max(0,meters)/1000,hrs=running?Math.max(0,dt)/3600:0;
  const payloadStress=loaded?1.22:1;const gradeStress=1+Math.max(0,grade)*4;
  const rough=Math.max(.8,Math.min(3.5,roughness));
  const stress=payloadStress*gradeStress*rough*(overloaded?1.38:1);
  t.engineHours+=hrs;
  // Exact first-order cooling/heating: results do not depend on UI update frequency.
  const ambient=heat?43:24;
  const engineTarget=running?82+(heat?12:0)+(loaded?6:0)+Math.max(0,grade)*80+(t.faultTags.includes('cooling')?62:0):ambient;
  t.engineTempC=limit(engineTarget+(t.engineTempC-engineTarget)*Math.exp(-dt/70),ambient,155);
  const brakeTarget=braking&&meters>0?110+Math.abs(grade)*900+(loaded?25:0):ambient+20;
  t.brakeTempC=limit(brakeTarget+(t.brakeTempC-brakeTarget)*Math.exp(-dt/(wet?38:55)),ambient,350);
  const c=t.components;const prevTyre=c.tyres,prevEngine=c.engine;
  c.engine=limit(c.engine-hrs*MODEL.engineWearPerHour*(1+dust*1.6+(t.engineTempC>108?3:0)));
  c.drivetrain=limit(c.drivetrain-km*.11*stress);
  c.brakes=limit(c.brakes-km*MODEL.brakeWearPerKm*(1+Math.max(0,-grade)*4)-(t.brakeTempC>180?hrs*3:0));
  c.tyres=limit(c.tyres-km*MODEL.tyreWearPerKm*stress*(1+wet*.2+(heat?.32:0)));
  c.suspension=limit(c.suspension-km*MODEL.suspensionWearPerKm*stress);
  c.cooling=limit(c.cooling-hrs*.24*(heat?2:1));
  c.electrical=limit(c.electrical-hrs*.12*(wet>0.7?1.7:1));
  c.hydraulics=limit(c.hydraulics-hrs*.15*(loaded?1.2:1));
  if(t.faultTags.includes('cooling'))c.cooling=limit(c.cooling-hrs*65);
  if(t.faultTags.includes('oil')){t.oilPressureKpa=Math.max(70,t.oilPressureKpa-7*dt);c.engine=limit(c.engine-hrs*12);}
  if(t.faultTags.includes('brakes'))c.brakes=limit(c.brakes-.13*dt);
  if(t.faultTags.includes('tyres')){c.tyres=limit(c.tyres-.08*dt);t.tyrePressureKpa=Math.max(240,t.tyrePressureKpa-1.3*dt);}
  if(t.faultTags.includes('hydraulics'))c.hydraulics=limit(c.hydraulics-.09*dt);
  if(t.faultTags.includes('filter'))c.engine=limit(c.engine-.017*dt);
  if(t.faultTags.includes('electrical')){t.batteryVoltageV=Math.max(15,t.batteryVoltageV-.06*dt);c.electrical=limit(c.electrical-.025*dt);}
  if(t.faultTags.includes('suspension'))c.suspension=limit(c.suspension-.11*dt);
  const values=Object.values(c);
  t.health=limit(values.reduce((s,v)=>s+v,0)/values.length);
  t.tyre=c.tyres;
  const work=t.workMetrics||(t.workMetrics={distanceKm:0,loadedKm:0,emptyKm:0,idleHours:0,operatingHours:0,tonneKm:0,fuelLitres:0,tyreWearPoints:0,engineWearPoints:0});
  work.distanceKm+=km;work.loadedKm+=loaded?km:0;work.emptyKm+=loaded?0:km;work.tonneKm+=km*Math.max(0,t.payload||0);work.operatingHours+=hrs;work.idleHours+=running&&idle?Math.max(0,dt)/3600:0;work.tyreWearPoints+=Math.max(0,prevTyre-c.tyres);work.engineWearPoints+=Math.max(0,prevEngine-c.engine);
  const critical=COMPONENT_KEYS.filter(k=>c[k]<=MODEL.breakdownThreshold);
  t.failedComponent=critical[0]??null;
  t.maintenanceDue=Object.values(c).some(v=>v<MODEL.preventiveThreshold)||t.engineHours-t.lastServiceHours>=250||t.faultTags.length>0;
  const diag=[];
  if(t.engineTempC>=108)diag.push('ПЕРЕГРЕВ');
  if(t.oilPressureKpa<210)diag.push('ДАВЛЕНИЕ МАСЛА');
  if(t.brakeTempC>175||c.brakes<35)diag.push('ТОРМОЗА');
  if(t.tyrePressureKpa<500||c.tyres<35)diag.push('ШИНЫ');
  if(t.batteryVoltageV<23)diag.push('ГЕНЕРАТОР');
  if(t.oilPressureKpa<100)t.failedComponent='engine';
  if(t.engineTempC>145)t.failedComponent='cooling';
  if(t.brakeTempC>310)t.failedComponent='brakes';
  if(t.batteryVoltageV<18)t.failedComponent='electrical';
  if(t.failedComponent)diag.push(`КРИТИЧ.: ${COMPONENT_NAMES[t.failedComponent]}`);
  if(t.maintenanceDue)diag.push('ТО ТРЕБУЕТСЯ');
  t.diagnostic=diag;
  return diag;
}
export function conditionSpeedFactor(t){return performanceEstimate(t).speedFactor;}
export function maintenancePriority(t){
  const min=Math.min(...Object.values(t.components));return Math.round((100-min)*1.3+((t.engineHours-t.lastServiceHours)/250)*20+t.diagnostic.length*15);
}
// A work order names only the parts being replaced. A routine inspection does not
// magically renew every component of a 100-tonne truck.
export const FAULT_PART={oil:'engine',filter:'engine',tyres:'tyres',brakes:'brakes',cooling:'cooling',hydraulics:'hydraulics',electrical:'electrical',suspension:'suspension'};
export function chooseServiceParts(t){
  const required=new Set(COMPONENT_KEYS.filter(k=>t.components[k]<MODEL.preventiveThreshold));
  for(const tag of t.faultTags||[])if(FAULT_PART[tag])required.add(FAULT_PART[tag]);
  if(t.failedComponent)required.add(t.failedComponent);
  // Planned maintenance: one highest-priority inspection/replacement, not eight new assemblies.
  if(!required.size && t.serviceReason==='preventive'){
    const worst=[...COMPONENT_KEYS].sort((a,b)=>t.components[a]-t.components[b])[0];
    if(t.components[worst]<82)required.add(worst);
  }
  return [...required];
}
export function performServiceStep(t,dt,{spareParts=true,crew=true}={}){
  if(!crew||!spareParts)return {done:false,waiting:true,cost:0};
  t.serviceElapsed+=dt;const stepLabour=dt/3600*MODEL.labourKztPerHour;
  t.serviceLabourCostKzt=(t.serviceLabourCostKzt||0)+stepLabour;
  if(t.serviceElapsed<MODEL.serviceSeconds){t.workMetrics.maintenanceCostKzt=(t.workMetrics.maintenanceCostKzt||0)+stepLabour;return {done:false,waiting:false,cost:stepLabour};}
  const before=structuredClone({components:t.components,engineTempC:t.engineTempC,brakeTempC:t.brakeTempC,oilPressureKpa:t.oilPressureKpa,tyrePressureKpa:t.tyrePressureKpa,batteryVoltageV:t.batteryVoltageV,failedComponent:t.failedComponent,payload:t.payload,capacity:t.capacity});
  const restored=t.serviceParts||chooseServiceParts(t);
  const partsCost=restored.reduce((sum,k)=>sum+(t.components[k]<60?MODEL.sparePartsKzt[k]:Math.round(MODEL.sparePartsKzt[k]*.13)),0);
  // Replace failed parts; routine service is a partial restoration, not a new machine.
  for(const k of restored)t.components[k]=Math.min(100,t.components[k]<60?96:t.components[k]+6);
  const replaced=new Set(restored);
  t.faultTags=(t.faultTags||[]).filter(tag=>!replaced.has(FAULT_PART[tag]||tag));
  t.failedComponent=COMPONENT_KEYS.find(k=>t.components[k]<=MODEL.breakdownThreshold)||null;
  if(replaced.has('engine'))t.oilPressureKpa=410;
  if(replaced.has('tyres'))t.tyrePressureKpa=690;
  if(replaced.has('electrical'))t.batteryVoltageV=27.8;
  if(replaced.has('cooling'))t.engineTempC=82;
  if(replaced.has('brakes'))t.brakeTempC=52;
  t.lastServiceHours=t.engineHours;t.serviceCount++;
  t.serviceElapsed=0;t.serviceReason=null;t.serviceParts=null;
  t.maintenanceDue=!!t.failedComponent || t.faultTags.length>0 || COMPONENT_KEYS.some(k=>t.components[k]<MODEL.preventiveThreshold);
  t.diagnostic=t.maintenanceDue?['ПОВТОРНАЯ ДИАГНОСТИКА']:[];
  t.health=COMPONENT_KEYS.reduce((sum,k)=>sum+t.components[k],0)/COMPONENT_KEYS.length;
  t.tyre=t.components.tyres;
  // Charge the estimated labour of the repair, not 55 seconds of demo clock.
  // All hours are scenario assumptions, replace with workshop records for calibration.
  const estimatedShopHours=restored.length?restored.reduce((sum,k)=>sum+(MODEL.estimatedServiceHours[k]||1),0):.4;
  const estimatedLabourCost=estimatedShopHours*MODEL.labourKztPerHour;
  const accruedBeforeFinal=t.serviceLabourCostKzt-stepLabour;
  const actualCost=partsCost+estimatedLabourCost-accruedBeforeFinal;
  const totalServiceCost=partsCost+estimatedLabourCost;
  t.workMetrics.maintenanceCostKzt=(t.workMetrics.maintenanceCostKzt||0)+actualCost;
  t.serviceLabourCostKzt=0;
  const performance=compareServicePerformance(before,t);
  const report={atHours:t.engineHours,parts:[...replaced],partsCost,cost:totalServiceCost,estimatedShopHours,simulatedServiceSeconds:MODEL.serviceSeconds,performance};
  t.lastServiceReport=report;t.serviceHistory=(t.serviceHistory||[]).concat(report).slice(-15);
  return {done:true,waiting:false,cost:actualCost,partsCost,replaced,performance};
}
export function auditMass({loaded,received,processed,hopperBefore,hopperAfter}){
  // Production balance for a single interval: no invented tonnage or negative stock.
  return Math.abs((hopperBefore+received-processed)-hopperAfter)<.02 && loaded>=0 && processed>=0;
}
