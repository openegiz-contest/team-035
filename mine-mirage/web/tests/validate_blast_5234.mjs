import assert from 'node:assert/strict';
import {MineOperations} from '../live/modules/operations.js';
import {BLAST_PHASES} from '../live/modules/blast-cycle.js';
import saryarka from '../live/maps/saryarka.js';
import altai from '../live/maps/altai.js';
import {loadOre,processOre} from '../live/modules/production.js';

for(const map of [saryarka,altai]){
  const ops=new MineOperations(map);let s=ops.snapshot();
  assert.equal(s.blast.holes.length,20);
  assert.equal(s.blast.hardnessIndex,null,'MWD is not published before drilling');
  assert(s.blast.holes.every(h=>h.status==='planned'));
  assert(ops.action('blast'));
  ops.step(33);s=ops.snapshot();
  assert.equal(s.blast.phase,'drilling');
  assert.equal(s.blast.drilled,11);
  assert.equal(s.blast.holes[11].status,'planned');
  assert(s.blast.hardnessIndex>0);
  const cancelled=ops.action('cancelBlast');assert(cancelled);assert.equal(ops.blast.phase,'idle');
  assert.equal(ops.blast.drilled,0);
  assert(ops.action('blast'));
  let enteredCharging=false,enteredEvacuation=false,enteredVentilation=false,blockedDuringCountdown=false;
  for(let i=0;i<2400;i++){
    ops.step(1);const b=ops.blast;
    if(b.phase==='charging')enteredCharging=true;
    if(b.phase==='evacuation')enteredEvacuation=true;
    if(b.phase==='countdown')blockedDuringCountdown ||= [...ops.blockedEdges()].length>0;
    if(b.phase==='ventilation')enteredVentilation=true;
    if(b.phase==='idle'&&b.completed>=1)break;
  }
  s=ops.snapshot();
  assert(enteredCharging&&enteredEvacuation&&enteredVentilation&&blockedDuringCountdown);
  assert.equal(s.blast.completed,1);
  assert(s.blast.fragmentation>0&&s.blast.fragmentation<1);
  assert(s.blast.holes.every(h=>h.status==='fired'));
  assert(s.oreBlocks[ops.faceIds[0]].every(b=>Math.abs(b.fragmentation-s.blast.fragmentation)<.001));
  assert(Number.isFinite(s.metrics.fragmentationFinePct));
  assert(ops.action('blast'),'repeat cycle allowed');
  assert.equal(ops.blast.drilled,0,'drilling status resets on repeat cycle');
  console.log('BVR OK:',map.id, 'fragmentation',s.blast.fragmentation, 'cycles',s.blast.completed);
}
// Show the fragmentation effect in isolation, without interfering with mass/copper accounting.
const coarse=new MineOperations(saryarka),fine=new MineOperations(saryarka);
for(const sim of [coarse,fine]){
  const face=sim.faceIds[0];
  sim.oreBlocks[face].forEach(b=>b.fragmentation=sim===coarse?.28:.86);
  const truck=sim.trucks[0];truck.node=face;truck.cargo={mass:0,metal:0,hardness:0};truck.payload=0;
  loadOre(sim,truck,65);
  const crusher=sim.crusherIds[0];
  sim.buffers[crusher]={...truck.cargo};
  sim.hopper[crusher]=truck.cargo.mass;
}
assert(coarse.trucks[0].cargo.hardness>fine.trucks[0].cargo.hardness);
const crId=coarse.crusherIds[0];
const beforeC=coarse.metrics().processed,beforeF=fine.metrics().processed;
processOre(coarse,10);processOre(fine,10);
assert(fine.metrics().processed-beforeF>coarse.metrics().processed-beforeC,'finer material improves throughput');
console.log('PASS: BVR cycles, MWD gating, production coupling on both maps.');
