/** BUILD 5241: visual depot and weighbridge pad clearances on the GLB surface. */
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
 fuel:await loadModel('./models/fuel-optimized.glb'),
 modular:await loadModel('./models/modular-buildings.glb'),
 warehouse:await loadModel('./models/industrial-warehouse.glb')
},lowPower:true});
scene.scene=new Scene();scene.scene.fog=new Fog(0,1,2);
for(const key of ['terrainGroup','facilityGroup','fxGroup','roadGroup','machineGroup']){scene[key]=new Group();scene.scene.add(scene[key]);}
scene.prepareRoads();scene.createTerrain();
scene.createWorkshopFacility(map.nodes.find(n=>n.kind==='workshop'));
for(const kind of ['fuel','depot','weigh'])scene.createStaticFacility(map.nodes.find(n=>n.kind===kind));
const get=name=>scene.facilityRoots.get(name);
const depot=get('depot'),weigh=get('weigh'),garage=get('workshop'),fuel=get('fuel');
assert.equal(depot.position.x,-40);assert.equal(depot.position.z,330);
assert.equal(weigh.position.x,240);assert.equal(weigh.position.z,390);
const segments=map.edges.flatMap(e=>{const path=e.path||[];return path.slice(1).map((p,i)=>[path[i],p]);});
function roadDist(x,z){return Math.min(...segments.map(([a,b])=>{const dx=b[0]-a[0],dz=b[1]-a[1],den=dx*dx+dz*dz;
 const t=den?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/den)):0;
 return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t);}));}
const placements={depot,weigh,garage,fuel};
const bounds=Object.fromEntries(Object.entries(placements).map(([name,root])=>{root.updateMatrixWorld(true);return [name,scene.modelBounds(root)];}));
function gap(a,b){const x=Math.max(0,b.minx-a.maxx,a.minx-b.maxx),z=Math.max(0,b.minz-a.maxz,a.minz-b.maxz);return Math.hypot(x,z);}
for(const pair of [['depot','weigh'],['depot','garage'],['depot','fuel'],['weigh','garage'],['weigh','fuel']]){
 const d=gap(bounds[pair[0]],bounds[pair[1]]);
 assert(d>20,`${pair.join(' vs ')} AABB footprint clearance should be >20, got ${d.toFixed(1)}`);
}
assert(roadDist(depot.position.x,depot.position.z)>60);
assert(roadDist(weigh.position.x,weigh.position.z)>60);
const depotSite=scene.evaluateFacilitySite({rot:0,lminx:-38,lmaxx:38,lminz:-24,lmaxz:24,miny:0},depot.position.x,depot.position.z);
const weighSite=scene.evaluateFacilitySite({rot:0,lminx:-18,lmaxx:18,lminz:-13,lmaxz:13,miny:0},weigh.position.x,weigh.position.z);
assert(depotSite.range<7 && weighSite.range<4,'footprints should fit gradual terrain');
console.log('PASS relocated depot/weigh',JSON.stringify({
 depot:{position:depot.position.toArray(),roadDistance:roadDist(depot.position.x,depot.position.z).toFixed(1),surfaceRange:depotSite.range.toFixed(2)},
 weigh:{position:weigh.position.toArray(),roadDistance:roadDist(weigh.position.x,weigh.position.z).toFixed(1),surfaceRange:weighSite.range.toFixed(2)},
 aabbGaps:Object.fromEntries([['depot','weigh'],['depot','garage'],['depot','fuel'],['weigh','garage'],['weigh','fuel']].map(([a,b])=>[`${a}-${b}`,gap(bounds[a],bounds[b]).toFixed(1)]))
},null,2));
