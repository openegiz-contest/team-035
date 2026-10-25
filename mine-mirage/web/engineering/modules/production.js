/** Conservative material / copper / water model. All rates are synthetic, in tonnes, m3, seconds. */
import {clamp} from './network.js';
export const PROCESS={hopperCapacity:360,waterPerTonne:.32,recovery:.89,concentrateGrade:.25,makeupRate:.12,recycleRate:1.5,pumpRate:.65};
export const emptyCargo=()=>({mass:0,metal:0,hardness:0});
export function take(cargo,amount){
  const mass=Math.min(Math.max(0,amount),cargo.mass),ratio=cargo.mass>0?mass/cargo.mass:0;
  const part={mass,metal:cargo.metal*ratio,hardness:cargo.hardness*ratio};
  for(const k of ['mass','metal','hardness'])cargo[k]=Math.max(0,cargo[k]-part[k]);
  return part;
}
export function add(target,part){for(const k of ['mass','metal','hardness'])target[k]+=part[k];}
export function initProduction(mine){
  mine.oreBlocks=Object.fromEntries(mine.faceIds.map((id,f)=>[id,Array.from({length:12},(_,i)=>{
    const grade=(f%2?.87:.57)+((i*7+f*3)%9)*.04;
    return {id:`${id}-B${String(i+1).padStart(2,'0')}`,reserve:1250+(i%4)*250,initial:1250+(i%4)*250,grade,hardness:.8+(i%5)*.12,fragmentation:.48};
  })]));
  mine.material={mined:emptyCargo(),external:emptyCargo(),processed:emptyCargo(),concentrate:emptyCargo(),tailings:emptyCargo(),initial:emptyCargo()};
  mine.buffers=Object.fromEntries(mine.crusherIds.map(id=>[id,{mass:mine.hopper[id],metal:mine.hopper[id]*mine.gradeFeed[id]/100,hardness:mine.hopper[id]}]));
  for(const t of mine.trucks){t.cargo={mass:t.payload,metal:t.payload*t.grade/100,hardness:t.payload};add(mine.material.initial,t.cargo);}
  for(const buffer of Object.values(mine.buffers))add(mine.material.initial,buffer);
  mine.water={reservoir:900,sump:160,pond:170,initial:1230,fresh:0,rain:0,evaporated:0,spilled:0,pumped:0,recycled:0,processUsed:0,sprayed:0,flow:0};
  mine.recycling=true;mine.trustAssay=true;mine.targetGrade=.8;
  mine.fuelDepot=15000;mine.fuelAdded=0;mine.fuelInitial=mine.trucks.reduce((a,t)=>a+t.fuelLitres,0)+mine.fuelDepot;
  mine.supplyJobs=[];
}
export function loadOre(mine,t,amount){
  let left=Math.max(0,Math.min(amount,t.capacity-t.payload)),loaded=0;
  for(const b of mine.oreBlocks[t.node]||[]){
    if(left<=1e-9)break;const mass=Math.min(left,b.reserve);if(mass<=0)continue;
    const part={mass,metal:mass*b.grade/100,hardness:mass*b.hardness*(1.35-.5*(b.fragmentation??.48))};b.reserve-=mass;left-=mass;loaded+=mass;
    add(t.cargo,part);add(mine.material.mined,part);
  }
  t.payload=t.cargo.mass;t.expectedPayload=t.payload;t.grade=t.payload>0?t.cargo.metal/t.payload*100:0;
  return loaded;
}
export function waterStep(mine,dt){
  const w=mine.water;const rain=mine.faults.rain?.68*dt:0;w.rain+=rain;w.sump+=rain;
  const fresh=mine.faults.waterShortage?0:Math.min(PROCESS.makeupRate*dt,1100-w.reservoir);w.fresh+=fresh;w.reservoir+=fresh;
  const pump=mine.faults.drainage&&!mine.faults.pumpFault&&!mine.faults.powerFault?Math.min(w.sump,PROCESS.pumpRate*dt,850-w.pond):0;
  w.sump-=pump;w.pond+=pump;w.pumped+=pump;
  const recycled=mine.recycling&&!mine.faults.powerFault?Math.min(w.pond,PROCESS.recycleRate*dt,1100-w.reservoir):0;
  w.pond-=recycled;w.reservoir+=recycled;w.recycled+=recycled;
  const energy=((pump>0?55:0)+(recycled>0?18:0))*dt/3600;mine.energyKwh+=energy;mine.cost+=energy*24;
  if(mine.faults.dustSuppression&&mine.fuelDepot>0&&w.reservoir>.018*dt){const spray=.018*dt;w.reservoir-=spray;w.evaporated+=spray;w.sprayed+=spray;mine.dust=clamp(mine.dust-.024*dt,.04,.98);}
  if(w.sump>650){w.spilled+=w.sump-650;w.sump=650;}
  if(w.pond>850){w.spilled+=w.pond-850;w.pond=850;}
  w.flow=0;
}
export function processOre(mine,dt){
  mine.powerDemand=0;
  for(const id of mine.crusherIds){
    const asset=mine.assets[id],i=mine.crusherIds.indexOf(id),buffer=mine.buffers[id];
    const offline=mine.faults.powerFault||mine.faults.beltFault||(i===0&&mine.faults.crusherFault)||(i===1&&mine.faults.crusherBFault);
    const hardness=buffer.mass>0?buffer.hardness/buffer.mass:1;
    const availableWater=Math.max(0,850-mine.water.pond)/PROCESS.waterPerTonne;
    let rate=asset.rate/Math.max(.7,hardness)*(mine.faults.heat?.9:1);
    const amount=offline?0:Math.min(buffer.mass,rate*dt,mine.water.reservoir/PROCESS.waterPerTonne,availableWater);
    asset.state=offline?'offline':amount>0?'running':buffer.mass<.01?'starved':'water-limited';
    if(amount>0){
      const part=take(buffer,amount);add(mine.material.processed,part);
      const realGrade=part.metal/part.mass*100;
      const reportedGrade=realGrade+(mine.faults.assayFault?.4:0);
      const controlledGrade=mine.trustAssay?realGrade:reportedGrade;
      const recovery=clamp(PROCESS.recovery-Math.abs(controlledGrade-mine.targetGrade)*.09-(hardness-1)*.03,.65,.93);
      const copper=part.metal*recovery,concMass=copper/PROCESS.concentrateGrade;
      add(mine.material.concentrate,{mass:concMass,metal:copper,hardness:0});
      add(mine.material.tailings,{mass:part.mass-concMass,metal:part.metal-copper,hardness:part.hardness});
      mine.processed+=amount;mine.copper+=copper;
      const water=amount*PROCESS.waterPerTonne;mine.water.reservoir-=water;mine.water.pond+=water*.92;mine.water.evaporated+=water*.08;mine.water.processUsed+=water;mine.water.flow+=water/dt;
      const energy=amount*1.15*hardness;mine.energyKwh+=energy;mine.cost+=amount*38+energy*24;mine.powerDemand+=energy/dt*3600;
    }
    mine.hopper[id]=buffer.mass;mine.gradeFeed[id]=buffer.mass>0?buffer.metal/buffer.mass*100:0;
  }
}
export function productionMetrics(mine){
  const p=mine.material,w=mine.water;
  const cargo=mine.trucks.reduce((a,t)=>{add(a,t.cargo);return a;},emptyCargo());
  const buffer=Object.values(mine.buffers).reduce((a,t)=>{add(a,t);return a;},emptyCargo());
  return {
    mined:p.mined.mass,copperTonnes:mine.copper,recoveryPct:p.processed.metal?100*p.concentrate.metal/p.processed.metal:0,
    feedGradePct:p.processed.mass?p.processed.metal/p.processed.mass*100:0,
    reserveTonnes:Object.values(mine.oreBlocks).flat().reduce((a,b)=>a+b.reserve,0),
    massError:p.initial.mass+p.mined.mass+p.external.mass-cargo.mass-buffer.mass-p.concentrate.mass-p.tailings.mass,
    metalError:p.initial.metal+p.mined.metal+p.external.metal-cargo.metal-buffer.metal-p.concentrate.metal-p.tailings.metal,
    waterError:w.initial+w.fresh+w.rain-w.evaporated-w.spilled-w.reservoir-w.sump-w.pond,
    waterReservoir:w.reservoir,waterSump:w.sump,waterPond:w.pond,waterRecycled:w.recycled,
    fuelBalanceError:mine.fuelInitial+mine.fuelAdded-mine.fuelConsumed-mine.fuelDepot-mine.trucks.reduce((a,t)=>a+t.fuelLitres,0),
    unitCost:mine.processed>0?mine.cost/mine.processed:0,availabilityPct:100*mine.trucks.filter(t=>!['stranded','towing','repairing','to_workshop'].includes(t.status)).length/mine.trucks.length,
  };
}
