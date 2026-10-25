import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const context={drawImage(){},createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}};
globalThis.document={createElement:()=>({relList:{supports:()=>true},getContext:()=>context})};
globalThis.createImageBitmap=async()=>({width:4096,height:4096,close(){}});
globalThis.fetch=async p=>new Response(await fs.readFile(new URL('../'+String(p).replace(/^\.\//,''),import.meta.url)));
const {G:Group,S:Scene,F:Fog,V:Vector3,P:PerspectiveCamera}=await import('../assets/three-vendor.js');
const {MineScene}=await import('../assets/mine-scene.js');
const {MineOperations}=await import('../live/modules/operations.js');
const {loadModel}=await import('../assets/glb-loader.js');
const {terrainCameraHeight,constrainTerrainCamera}=await import('../assets/camera-terrain.js');
const machines={excavator:await loadModel('./models/excavator.glb'),truck:await loadModel('./models/haul-truck-rigged-optimized.glb'),fuel:await loadModel('./models/fuel-optimized.glb'),gasStation:await loadModel('./models/gas-station.glb'),garage:await loadModel('./models/industrial-garage.glb'),warehouse:await loadModel('./models/industrial-warehouse.glb'),substation:await loadModel('./models/electrical-substation.glb'),modular:await loadModel('./models/modular-buildings.glb')};
for(const id of ['saryarka','altai']){
  const map=(await import(`../live/maps/${id}.js`)).default,source=JSON.stringify(map),ops=new MineOperations(map);
  const scene=Object.create(MineScene.prototype);
  scene.roadSegments=[];scene.visualTime=0;
  Object.assign(scene,{map,snap:ops.snapshot(),visualRoads:new Map(),trucks:new Map(),assets:new Map(),facilityRoots:new Map(),modelCache:{...machines,[id==='altai'?'terrainAltai':'terrainSaryarka']:await loadModel(`./models/${map.sceneDefinition.baseModel}`)},scene:new Scene(),camera:new PerspectiveCamera(42,2,.5,18000),controls:{target:new Vector3()}});
  scene.scene.fog=new Fog(0,1,2);
  for(const key of ['terrainGroup','facilityGroup','fxGroup','machineGroup','roadGroup']){scene[key]=new Group();scene.scene.add(scene[key]);}
  for(const key of ['rainClouds','dust','landslide'])scene[key]={visible:false};
  scene.prepareRoads();scene.createTerrain();scene.createFacilities();scene.buildMachines();scene.update(scene.snap);
  const rows=[];
  for(const [id2,root] of scene.facilityRoots){
    const n=map.nodes.find(q=>q.id===id2);if(!n||n.kind==='face')continue;
    const pr=scene.footprintProfile(root),e=scene.evaluateFacilitySite(pr,root.position.x,root.position.z),base=root.position.y+pr.miny,lo=e.low,hi=e.high,b={maxx:pr.lmaxx,minx:pr.lminx,maxz:pr.lmaxz,minz:pr.lminz,miny:base};
    rows.push(`${id} ${n.kind.padEnd(8)} ${id2.padEnd(10)} size ${(b.maxx-b.minx).toFixed(0)}x${(b.maxz-b.minz).toFixed(0)} relief ${(hi-lo).toFixed(1)} m  base-vs-lowest ${(b.miny-lo).toFixed(1)} m  base-vs-highest ${(b.miny-hi).toFixed(1)} m`);
  }
  const y=scene.serviceUnits?.yard;if(y){const p=y.position;let lo=Infinity,hi=-Infinity;for(let ix=-14;ix<=14;ix+=4)for(let iz=-9;iz<=9;iz+=3){const h=scene.groundHeight(p.x+ix,p.z+iz);lo=Math.min(lo,h);hi=Math.max(hi,h);}rows.push(`${id} service-yard relief ${(hi-lo).toFixed(1)} m`);}
  console.log(rows.join('\n'));
}
process.exit(0);
