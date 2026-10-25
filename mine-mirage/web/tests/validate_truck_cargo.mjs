import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
globalThis.document={createElement:()=>({relList:{supports:()=>true}})};
globalThis.fetch=async path=>new Response(await fs.readFile(new URL('../'+String(path).replace(/^\.\//,''),import.meta.url)));
const {V:Vector3,G:Group,S:Scene,F:Fog}=await import('../assets/three-vendor.js');
const {loadModel}=await import('../assets/glb-loader.js');
const {rigTruck,animateDetailedMachines}=await import('../assets/scene-detail.js');
const visual=await loadModel('./models/haul-truck-rigged-optimized.glb');
const bed=visual.getObjectByName('dump-bed-pivot');
const plate=bed.getObjectByName('dump-bed-pivot_0').geometry;
const positions=plate.getAttribute('position'),indices=plate.index;
// Find the actual upward-facing steel floor, not a duplicated cargo constant.
function floorAt(x,z){
  let floor=-Infinity;
  for(let i=0;i<indices.count;i+=3){
    const a=new Vector3().fromBufferAttribute(positions,indices.getX(i));
    const b=new Vector3().fromBufferAttribute(positions,indices.getX(i+1));
    const c=new Vector3().fromBufferAttribute(positions,indices.getX(i+2));
    const normal=b.clone().sub(a).cross(c.clone().sub(a));
    if(normal.y<=0||Math.abs(a.y-b.y)>.0001||Math.abs(a.y-c.y)>.0001||a.y>.5)continue;
    const det=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
    const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/det;
    const v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/det;
    if(u>=-1e-6&&v>=-1e-6&&u+v<=1.000001)floor=Math.max(floor,a.y);
  }
  return floor;
}
const root=new Group();root.add(visual);visual.scale.setScalar(2.7);
const truck={root,visual,bed:[bed],wheels:[],payload:0};rigTruck(truck);
const scene={scene:new Scene(),trucks:new Map([['HT-01',truck]]),assets:new Map(),running:true,snap:{time:0}};
scene.scene.fog=new Fog(0,1,2);scene.scene.add(root);
const cargo=truck.detail.cargo,p=cargo.geometry.getAttribute('position');
assert.equal(cargo.parent,bed,'cargo must inherit the tipping bed pivot');
let lastHeight=0;
for(const payload of [0,.6,5,25,50,90,100,116]){
  truck.payload=payload;animateDetailedMachines(scene,.04);
  assert.equal(cargo.visible,payload>.5,'empty trucks have no visible ore');
  let maxHeight=0,contacts=0;
  for(const tilt of [0,-.33,-.66]){
    bed.rotation.x=tilt;root.rotation.y=1.2;root.position.set(140,23,-72);root.updateMatrixWorld(true);
    for(let i=0;i<p.count;i++){
      const local=new Vector3().fromBufferAttribute(p,i);
      const inBed=bed.worldToLocal(cargo.localToWorld(local.clone()));
      assert(inBed.toArray().every(Number.isFinite));
      assert(inBed.z>=-.161&&inBed.z<=3.501,'ore stays inside the bed, behind the cab canopy');
      assert(inBed.y>=floorAt(0,inBed.z)-1e-6,'load cannot sink below the steel floor');
      if(local.y===0){
        assert(Math.abs(inBed.y-floorAt(inBed.x,inBed.z))<1e-6,'pile remains in contact with the actual floor at every fill and tilt');
        contacts++;
      }
      maxHeight=Math.max(maxHeight,inBed.y);
    }
  }
  assert(contacts>100,'contact extends across the load, not a single hanging point');
  assert(maxHeight>=lastHeight-1e-6,'loading grows upward from the floor');lastHeight=maxHeight;
}
assert(lastHeight<2.1,'full load remains a low heap between the side walls');
const colors=cargo.geometry.getAttribute('color');
assert(new Set(Array.from(colors.array).map(v=>v.toFixed(3))).size>30,'ore has irregular fragments and mineral color variation');
console.log('PASS empty/partial/full/overloaded truck, actual GLB floor contact, three dump angles, containment and finite transforms');
