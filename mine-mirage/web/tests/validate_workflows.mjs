import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {MineOperations,SCENARIOS} from '../live/modules/operations.js';
import {interpolate,validateMap,createNetwork} from '../live/modules/network.js';
import saryarka from '../live/maps/saryarka.js';
import altai from '../live/maps/altai.js';

function glbInfo(bytes){
  assert.equal(bytes.toString('ascii',0,4),'glTF');
  const length=bytes.readUInt32LE(12);
  return JSON.parse(bytes.toString('utf8',20,20+length));
}
for(const [name,expected] of [['saryarka','open_pit_mine.glb'],['altai','mining_quarry.glb']]){
  const map=name==='saryarka'?saryarka:altai;
  validateMap(map);
  assert.equal(map.sceneDefinition.baseModel,expected);
  assert(map.nodes.length>=18,'core facilities remain');assert(map.edges.length>=24,'working topology remains connected');
  const net=createNetwork(map);
  let maxRevDiff=0;let unsafeCount=0;let longest=0;
  for(const edge of map.edges){
    assert(edge.path.length>=2);
    assert(edge.maxGradePct>=0);
    if(edge.maxGradePct>12)unsafeCount++;
    longest=Math.max(longest,edge.lengthM);
    for(const t of [.01,.2,.5,.8,.99]){
      const x=interpolate(net,edge.id,edge.fromNode,edge.toNode,t);
      const y=interpolate(net,edge.id,edge.toNode,edge.fromNode,1-t);
      maxRevDiff=Math.max(maxRevDiff,Math.hypot(x.x-y.x,x.z-y.z,x.elevation-y.elevation));
    }
  }
  assert(maxRevDiff<0.0001,`bidirectional continuity ${maxRevDiff}`);
  const op=new MineOperations(map);let s=op.snapshot();const seen=new Set();let maxJump=0;
  for(let i=0;i<2500;i++){
    op.step(1);const next=op.snapshot();
    for(let k=0;k<next.fleet.length;k++){
      const a=s.fleet[k],b=next.fleet[k];
      seen.add(b.status);
      maxJump=Math.max(maxJump,Math.hypot(a.position.x-b.position.x,a.position.z-b.position.z,a.position.elevation-b.position.elevation));
      assert('operationTimer' in b);assert('operationElapsed' in b);
    }
    s=next;
  }
  assert(s.metrics.tonnes>0&&s.metrics.trips>0);
  assert(seen.has('loading')&&seen.has('dumping')&&seen.has('returning')&&seen.has('hauling'));
  assert(maxJump<25);
  console.log(name, {mapModel:expected,unsafeSlopeEdges:unsafeCount,longestRoadM:longest, tonnes:s.metrics.tonnes,trips:s.metrics.trips,maxJump:+maxJump.toFixed(2)});
  for(const [id] of SCENARIOS){
    const test=new MineOperations(map);
    try{test.action(id);test.step(5);test.snapshot();}catch(e){throw new Error(`${name}: scenario ${id} failed: ${e.stack}`);}
  }
}
for(const fn of ['open_pit_mine.glb','mining_quarry.glb','conveyor-kit.glb','haul-truck-rigged-optimized.glb','excavator.glb']){
  const d=await fs.readFile(new URL('../models/'+fn,import.meta.url));
  const glb=glbInfo(d);
  assert(glb.meshes?.length>0);
  const names=(glb.nodes||[]).map(n=>n.name||'');
  if(fn.includes('haul-truck-rigged')){assert.equal(names.filter(n=>/^wheel-pivot-[1-6]$/.test(n)).length,6);assert(names.includes('dump-bed-pivot'));}
  if(fn==='excavator.glb')for(const name of ['excavator-boom-pivot','excavator-stick-pivot','excavator-bucket-pivot','excavator-turret-pivot'])assert(names.includes(name));
  console.log('GLB valid',fn,Math.round(d.length/1024)+' KiB');
}
const scene=await fs.readFile(new URL('../assets/mine-scene.js',import.meta.url),'utf8');
assert(scene.includes('const live=this.snap?.assets?.[id]'));
assert(scene.includes('createRoads(){'));
assert(scene.includes('this.roadSegments=[];'));
assert(!scene.includes('this.modelCache.conveyor?.clone(true)'));
assert(scene.includes('this.modelCache.crusher?.clone(true)'));
assert(scene.includes('this.snap?.lines?.[id]'));
console.log('PASS: scenario checks',SCENARIOS.length,'on two maps; all rig files verified.');
