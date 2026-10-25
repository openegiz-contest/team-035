/** BUILD 5240: grounded relocation of service and fuel facilities, Saryarka. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const context={drawImage(){},createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}};
globalThis.document={createElement:()=>({relList:{supports:()=>true},getContext:()=>context})};
globalThis.createImageBitmap=async()=>({width:2048,height:2048,close(){}});
globalThis.fetch=async p=>new Response(await fs.readFile(new URL('../'+String(p).replace(/^\.\//,''),import.meta.url)));
const {G:Group,S:Scene,F:Fog}=await import('../assets/three-vendor.js');
const {MineScene}=await import('../assets/mine-scene.js');
const {loadModel}=await import('../assets/glb-loader.js');
const map=(await import('../live/maps/saryarka.js')).default;
const scene=Object.create(MineScene.prototype);
Object.assign(scene,{map,visualRoads:new Map(),trucks:new Map(),assets:new Map(),facilityRoots:new Map(),modelCache:{
 terrainSaryarka:await loadModel('./models/open_pit_mine.glb'),
 gasStation:await loadModel('./models/gas-station.glb'),
 fuel:await loadModel('./models/fuel-optimized.glb')
},lowPower:true});
scene.scene=new Scene();scene.scene.fog=new Fog(0,1,2);
for(const key of ['terrainGroup','facilityGroup','fxGroup','roadGroup','machineGroup']){scene[key]=new Group();scene.scene.add(scene[key]);}
scene.prepareRoads();scene.createTerrain();
scene.createWorkshopFacility(map.nodes.find(n=>n.kind==='workshop'));
scene.createStaticFacility(map.nodes.find(n=>n.kind==='fuel'));
const garage=scene.facilityRoots.get('workshop');
const fuel=scene.facilityRoots.get('fuel');
const horizontalDistance=Math.hypot(garage.position.x-fuel.position.x,garage.position.z-fuel.position.z);
assert(horizontalDistance>80,'garage and fuel station clear of each other');
assert(garage.position.z>260 && fuel.position.z>240,'both facilities in marked southern bench');
const gasBuilding=scene.modelBounds(fuel.children[0]);
const fuelModule=scene.modelBounds(fuel.children[1]);
const separation=Math.max(gasBuilding.minz-fuelModule.maxz,fuelModule.minz-gasBuilding.maxz,
 gasBuilding.minx-fuelModule.maxx,fuelModule.minx-gasBuilding.maxx);
assert(separation>5,'fuel building and secondary tank module do not overlap');
const segments=map.edges.flatMap(e=>{const path=e.path||[];return path.slice(1).map((p,i)=>[path[i],p]);});
function distanceToRoad(x,z){return Math.min(...segments.map(([a,b])=>{const dx=b[0]-a[0],dz=b[1]-a[1],den=dx*dx+dz*dz;
 const t=den?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/den)):0;
 return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t);
}));}
const garageRoad=distanceToRoad(garage.position.x,garage.position.z);
const fuelRoad=distanceToRoad(fuel.position.x,fuel.position.z);
assert(garageRoad>40 && fuelRoad>45,'stations clear of mapped haul roads');
console.log('PASS facility relocation', {garage:garage.position.toArray().map(n=>n.toFixed(1)),fuel:fuel.position.toArray().map(n=>n.toFixed(1)),horizontalDistance:horizontalDistance.toFixed(1),garageRoad:garageRoad.toFixed(1),fuelRoad:fuelRoad.toFixed(1),moduleGap:separation.toFixed(1)});
