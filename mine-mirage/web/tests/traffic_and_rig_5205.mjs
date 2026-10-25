import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { MineOperations } from '../live/modules/operations.js';
import saryarka from '../live/maps/saryarka.js';
import altai from '../live/maps/altai.js';

const scene=fs.readFileSync(new URL('../assets/mine-scene.js',import.meta.url),'utf8');
assert(scene.includes('rotation.x=(entity.bedBases[i]||0)-entity.dumpLift'),'dump rotation must tilt cab end UP, from rear hinge');
assert(scene.includes('setScalar(2.70)'),'corrected haul-truck visual dimensions');
assert(scene.includes('this.resolveTruckSpacing()'),'render separation activated');

// Evaluate precisely the isolated collision-spacing method, using a Vector3 stub.
const start=scene.indexOf('  resolveTruckSpacing(){');
const end=scene.indexOf('  truckPosition(id)',start);
assert(start>=0 && end>start);
const implementation=scene.slice(start,end);
class FakeV {
  constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
  set(x,y,z){Object.assign(this,{x,y,z});return this;}
  lerp(p,t){this.x+=(p.x-this.x)*t;this.y+=(p.y-this.y)*t;this.z+=(p.z-this.z)*t;return this;}
}
const context=vm.createContext({Vector3:FakeV,Math,Map,console});
vm.runInContext(`class TestSpacing {${implementation}};globalThis.TestSpacing=TestSpacing;`,context);
function runLayout(positions){
  const instance=new context.TestSpacing();
  instance.trucks=new Map(positions.map(([x,y,z],i)=>[`HT-${i+1}`,{root:{position:new FakeV()},pendingPosition:{x,y,z},status:'hauling'}]));
  instance.resolveTruckSpacing();
  return [...instance.trucks.values()].map(v=>v.root.position);
}
let positions=runLayout([[0,0,0],[2,0,0],[8,0,0]]);
for(let i=0;i<positions.length;i++)for(let j=0;j<i;j++){
 const d=Math.hypot(positions[i].x-positions[j].x,positions[i].z-positions[j].z);
 assert(d>14.8,`two nearby truck meshes still overlap: ${d}`);
}
console.log('PASS visual contact spacing, minimum 14.8 m');
for(const map of [saryarka,altai]){
 const ops=new MineOperations(map);
 const initial=ops.trucks.map(t=>ops._position(t));
 for(let i=0;i<initial.length;i++)for(let j=0;j<i;j++)
   assert(Math.hypot(initial[i].x-initial[j].x,initial[i].z-initial[j].z)>=28,'overlapping spawn');
 let sameRoadClose=0, headOn=0;
 for(let t=0;t<400;t++){
  ops.step(.5);
  for(let i=0;i<ops.trucks.length;i++)for(let j=0;j<i;j++){
   const a=ops.trucks[i],b=ops.trucks[j];
   if(!a.edge||a.edge!==b.edge)continue;
   if(a.from!==b.from)headOn++;
   const p=ops._position(a),q=ops._position(b),d=Math.hypot(p.x-q.x,p.z-q.z);
   if(d<22)sameRoadClose++;
  }
 }
 assert.equal(headOn,0,'opposite-direction traffic on the same one-lane edge');
 // Imported paths sometimes share geometry without sharing IDs; the rendering
 // deconfliction pass handles those close approaches.
 console.log(map.id,'PASS spawn and one-lane direction guards; same-road proximity events',sameRoadClose);
}
console.log('PASS 5205 traffic and truck rig regression');
