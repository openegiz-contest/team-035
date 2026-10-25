import {findPuddleSites,shorelineRadii,stepWaterLevel,pumpTruckShouldWork} from '../assets/scenario-water.js';
import assert from 'node:assert/strict';
// synthetic terrain: gentle slope, a bowl at (100,100) and a cliff wall at x>200
const h=(x,z)=>(x>200?30:0)+(x>195&&x<=200?(x-195)*6:0)-6*Math.exp(-((x-100)**2+(z-100)**2)/300)+x*.002;
const cand=[];for(let x=0;x<=260;x+=10)for(let z=0;z<=200;z+=10)cand.push({x,z});
const sites=findPuddleSites(h,cand);
assert(sites.length>=1,'no depression found');
assert(sites.every(s=>Math.hypot(s.x-100,s.z-100)<25),'puddle outside the bowl');
assert(sites.every(s=>s.x<190),'puddle placed on/near cliff');
assert(findPuddleSites((x,z)=>x*.5,cand).length===0,'steep plane must not hold water');
const s=sites[0];
for(const lv of [.1,.5,1]){const {yw,radii}=shorelineRadii(h,s,lv);
  assert(radii.some(r=>r>0));
  radii.forEach((r,i)=>{const a=i/radii.length*Math.PI*2;if(r>0)assert(h(s.x+Math.cos(a)*r*.99,s.z+Math.sin(a)*r*.99)<=yw+1e-6,'water crosses terrain');});}
assert(shorelineRadii(h,s,1).radii.reduce((a,b)=>a+b)>shorelineRadii(h,s,.2).radii.reduce((a,b)=>a+b),'area must grow with level');
// level model
let L=0,prev=0;for(let t=0;t<60;t++){L=stepWaterLevel(L,{rain:true},1);assert(L>=prev);prev=L;}
assert(L>.4&&L<.9,'60 s of rain should be partial: '+L);
const wet=L;
let a=wet,b=wet;for(let t=0;t<30;t++){a=stepWaterLevel(a,{drainage:true},1);b=stepWaterLevel(b,{drainage:true,pumpFault:true},1);}
assert(a<wet-.2,'drainage must lower water');assert(b>wet-.05,'pumpFault must keep water');
assert(stepWaterLevel(0,{},10)===0,'dry stays dry');
assert(pumpTruckShouldWork({drainage:true})&&!pumpTruckShouldWork({drainage:true,pumpFault:true})&&!pumpTruckShouldWork({drainage:true,rain:true})&&!pumpTruckShouldWork({}));
console.log('validate_scenario_water OK');
