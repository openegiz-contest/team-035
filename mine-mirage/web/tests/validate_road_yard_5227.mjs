import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const context={drawImage(){},createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}};
globalThis.document={createElement:()=>({relList:{supports:()=>true},getContext:()=>context})};
globalThis.createImageBitmap=async()=>({width:4096,height:4096,close(){}});
globalThis.fetch=async p=>new Response(await fs.readFile(new URL('../'+String(p).replace(/^\.\//,''),import.meta.url)));
const {G:Group,S:Scene,F:Fog}=await import('../assets/three-vendor.js');
const {MineScene}=await import('../assets/mine-scene.js');
const {loadModel}=await import('../assets/glb-loader.js');
const {MineOperations}=await import('../live/modules/operations.js');
for(const id of ['altai','saryarka']){
 const map=(await import(`../live/maps/${id}.js`)).default;
 const s=Object.create(MineScene.prototype);
 Object.assign(s,{map,snap:new MineOperations(map).snapshot(),visualRoads:new Map(),trucks:new Map(),assets:new Map(),facilityRoots:new Map(),modelCache:{[id==='altai'?'terrainAltai':'terrainSaryarka']:await loadModel(`./models/${map.sceneDefinition.baseModel}`)},lowPower:true});
 s.scene=new Scene();s.scene.fog=new Fog(0,1,2);
 for(const key of ['terrainGroup','facilityGroup','fxGroup','roadGroup','machineGroup']){s[key]=new Group();s.scene.add(s[key]);}
 s.prepareRoads();s.createTerrain();s.createWorkshopFacility(map.nodes.find(n=>n.kind==='workshop'));
 const w=s.workshopBay,root=w.root;
 assert(Number.isFinite(root.position.x)&&Number.isFinite(root.position.y));
 const node=map.nodes.find(n=>n.kind==='workshop'),gate=s.serviceWorldPosition(-30,0);
 if(id==='saryarka'){
  // BUILD 5240: hangar moved to the marked clear bench away from the haul road.
  assert(root.position.z>265,'hangar on the marked southern bench');
  assert(root.userData.accessGap>50,'relocated hangar far from haul road node');
  assert(Math.hypot(node.x-gate.x,node.z-gate.z)>50,'garage off active haul route');
 }else{
  assert(root.userData.accessGap<=19,'entrance aligned with service road node');
  assert(Math.hypot(node.x-gate.x,node.z-gate.z)<19);
 }
 assert(root.userData.siteRange<28,'garage not standing over a deep drop');
 console.log(id,'garage site',root.position.toArray().map(n=>n.toFixed(2)),
 'siteRange',root.userData.siteRange.toFixed(2),'approach max grade',root.userData.accessGrade.toFixed(2),
 'road-gap',root.userData.accessGap.toFixed(1));
}
