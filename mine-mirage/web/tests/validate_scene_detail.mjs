import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// The vendor's preload shim needs a document, rendering itself is not used.
globalThis.document={createElement:()=>({relList:{supports:()=>true}})};
globalThis.fetch=async path=>new Response(await fs.readFile(new URL('../'+String(path).replace(/^\.\//,''),import.meta.url)));
const {G:Group,S:Scene,F:Fog,V:Vector3}=await import('../assets/three-vendor.js');
const {MineScene}=await import('../assets/mine-scene.js');
const {loadModel}=await import('../assets/glb-loader.js');
const {MineOperations}=await import('../live/modules/operations.js');
const {trackPoint,bucketPose}=await import('../assets/scene-detail.js');
const saryarka=(await import('../live/maps/saryarka.js')).default;
const altai=(await import('../live/maps/altai.js')).default;
const cache={truck:await loadModel('./models/haul-truck-rigged-optimized.glb'),excavator:await loadModel('./models/excavator.glb')};

for(const map of [saryarka,altai]){
  const ops=new MineOperations(map),scene=Object.create(MineScene.prototype);
  Object.assign(scene,{map,snap:ops.snapshot(),modelCache:cache,trucks:new Map(),assets:new Map(),visualRoads:new Map(),roadSegments:[],facilityRoots:new Map(),visualTime:0});
  scene.scene=new Scene();scene.scene.fog=new Fog(0,1,2);
  for(const key of ['terrainGroup','roadGroup','facilityGroup','machineGroup','fxGroup']){scene[key]=new Group();scene.scene.add(scene[key]);}
  for(const key of ['rainClouds','dust','landslide'])scene[key]={visible:false};
  scene.prepareRoads();scene.createFacilities();scene.buildMachines();scene.update(scene.snap);
  for(const asset of scene.assets.values())if(asset.kind==='excavator'){
    const pivot=asset.pivots['excavator-bucket-pivot'],shell=asset.detail.bucketShell;
    asset.root.updateMatrixWorld(true);
    // Backhoe teeth project behind the stick (toward the machine), not ahead
    // like a front shovel. Check actual transformed geometry, not Euler values.
    const edge=pivot.worldToLocal(shell.getObjectByName('bucket-cutting-edge').getWorldPosition(new Vector3()));
    assert(edge.z<-1.7,'backhoe cutting edge must face toward the machine');
    const contents=pivot.worldToLocal(asset.detail.dirt.getWorldPosition(new Vector3()));
    assert(contents.z<0,'ore stays inside the inward-facing scoop');
    const curl=new Vector3(edge.x,edge.y,edge.z).applyAxisAngle(new Vector3(1,0,0),bucketPose(.29).curl);
    const dig=new Vector3(edge.x,edge.y,edge.z).applyAxisAngle(new Vector3(1,0,0),bucketPose(.16).curl);
    const dump=new Vector3(edge.x,edge.y,edge.z).applyAxisAngle(new Vector3(1,0,0),bucketPose(.78).curl);
    assert(curl.y>dig.y+1,'curl lifts the cutting edge to retain the load');
    assert(dump.y<curl.y-1,'dump lowers the cutting edge to release the load');
  }
  for(const truck of scene.trucks.values()){
    assert.equal(truck.wheels.length,6,'only six top-level wheel pivots animate');
    assert.equal(truck.bed.length,1,'only one top-level bed pivot animates');
  }
  scene.running=true;scene.animationRate=5;
  let moved=false,excavated=false;
  for(let i=0;i<450;i++){
    ops.step(.2);scene.update(ops.snapshot());scene.animateModels(.04);
    moved||=[...scene.trucks.values()].some(t=>t.detail.wheelAngle>.1);
    excavated||=[...scene.assets.values()].some(a=>a.detail?.dirt?.visible);
    scene.scene.updateMatrixWorld(true);
    scene.scene.traverse(o=>assert(o.matrixWorld.elements.every(Number.isFinite),'animation must keep transforms finite'));
  }
  assert(moved,'moving trucks rotate wheels');assert(excavated,'working excavators lift a bucket of ore');
  const snapshot=JSON.stringify(scene.snap);
  scene.running=false;
  const matrices=()=>{scene.scene.updateMatrixWorld(true);const a=[];for(const t of scene.trucks.values())for(const w of t.wheels)a.push(...w.matrixWorld.elements);for(const x of scene.assets.values())if(x.kind==='excavator')x.root.traverse(o=>a.push(...o.matrixWorld.elements));return a;};
  scene.animateModels(.04);const paused=matrices();
  for(let i=0;i<8;i++)scene.animateModels(.04);
  assert.deepEqual(matrices(),paused,'paused simulation freezes wheels, tracks and excavator joints');
  assert.equal(JSON.stringify(scene.snap),snapshot,'animation cannot mutate engine state');
  const nextMap=map===saryarka?altai:saryarka;
  scene.map=nextMap;scene.update(new MineOperations(nextMap).snapshot());
  assert.equal(scene.trucks.size,scene.snap.fleet.length,'map switches render every truck without stale rigs');
  console.log('PASS',map.id,'six-wheel rigs, dig cycle, finite transforms, pause, immutable simulation');
}
const circumference=7.8+Math.PI*2*.64;
assert(Math.hypot(trackPoint(0).z-trackPoint(circumference).z,trackPoint(0).y-trackPoint(circumference).y)<1e-8);
const a=bucketPose(1-1e-6),b=bucketPose(0);
assert(Math.abs(a.swing-b.swing)<1e-6&&Math.abs(a.lift-b.lift)<1e-6&&Math.abs(a.curl-b.curl)<1e-6,'bucket cycle closes without a jump');
console.log('PASS closed track and bucket animation loops');
