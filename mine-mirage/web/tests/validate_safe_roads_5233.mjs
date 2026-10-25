import assert from 'node:assert/strict';
import fs from 'node:fs';
import altai from '../live/maps/altai.js';
import saryarka from '../live/maps/saryarka.js';
import {MineOperations} from '../live/modules/operations.js';
import {validateMap,createNetwork,shortestPath} from '../live/modules/network.js';
const qa=JSON.parse(fs.readFileSync(new URL('../QUALITY_CHECK/SAFE_ROAD_AUDIT_5233.json',import.meta.url),'utf8'));
for(const map of [altai,saryarka]) {
 const audit=qa.find(x=>x.map===map.id);assert(audit);
 validateMap(map);assert.equal(map.edges.length,24);
 const net=createNetwork(map);
 const facilityIds=map.nodes.filter(n=>['face','crusher','fuel','depot','workshop','weigh'].includes(n.kind)).map(n=>n.id);
 for(const a of facilityIds)for(const b of facilityIds){assert(shortestPath(net,a,b),`${map.id}: ${a} cannot reach ${b}`);}
 for(const edge of map.edges){
  assert(edge.path.length>=2 && edge.path.length<=500,edge.id);
  assert(edge.maxGradePct<=12.05,`${map.id} ${edge.id}: grade ${edge.maxGradePct}`);
  for(let k=1;k<edge.path.length;k++){
   const p=edge.path[k-1],q=edge.path[k],run=Math.hypot(q[0]-p[0],q[1]-p[1]);
   assert(run>0,`${edge.id}: zero-length segment`);
   assert(Math.abs(q[2]-p[2])/run<=.121,`${edge.id}: exceeds slope`);
  }
 }
 const sim=new MineOperations(map,4105);
 sim.step(220);
 const moving=sim.snapshot().fleet.filter(t=>['hauling','returning','loading','dumping','to_fuel','refueling'].includes(t.status));
 assert(moving.length>=3,`${map.id}: production has stopped`);
 sim.action('nightShift');sim.step(100);
 const night=sim.snapshot();
 assert(night.flags.nightShift);
 assert(night.fleet.some(t=>t.status==='to_depot'||t.status==='parked'),'night dispatch did not run');
 sim.action('nightShift');sim.step(100);
 assert(!sim.snapshot().flags.nightShift);
 console.log(`PASS ${map.id}: ${map.edges.length} valid roads, max grade ${audit.maxGradePct}%, ${facilityIds.length} facility nodes mutually accessible, day/night simulation`);
}
