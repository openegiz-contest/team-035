import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

globalThis.document={createElement:()=>({relList:{supports:()=>true}})};
globalThis.fetch=async path=>new Response(await fs.readFile(new URL('../'+String(path).replace(/^\.\//,''),import.meta.url)));
const {G:Group}=await import('../assets/three-vendor.js');
const {MineScene}=await import('../assets/mine-scene.js');
const {loadModel}=await import('../assets/glb-loader.js');
const saryarka=(await import('../live/maps/saryarka.js')).default;
const altai=(await import('../live/maps/altai.js')).default;
const oldWarn=console.warn;console.warn=(...args)=>{if(!String(args[0]).includes('GLB texture decode failure'))oldWarn(...args);};
const modelCache={gasStation:await loadModel('./models/gas-station.glb'),fuel:await loadModel('./models/fuel-optimized.glb')};
console.warn=oldWarn;
const asSize=b=>[+(b.maxx-b.minx).toFixed(2),+(b.maxy-b.miny).toFixed(2),+(b.maxz-b.minz).toFixed(2)];
for(const map of [saryarka,altai]){
  const scene=Object.create(MineScene.prototype);
  Object.assign(scene,{map,modelCache,facilityGroup:new Group(),facilityRoots:new Map(),cameraTerrain:null,visualRoads:new Map(),roadSegments:[],groundHeight:()=>map.id==='saryarka'?-55:-30});
  scene.prepareRoads();
  const fuel=map.nodes.find(n=>n.kind==='fuel');
  scene.createStaticFacility(fuel);
  const root=scene.facilityRoots.get(fuel.id);
  assert(root,'fuel station should exist');
  const station=root.children.find(c=>c.isGroup && c.children.length===2); // fitted canopy
  assert(station,'gas-station facade and canopy should be fitted together');
  const dims=asSize(scene.modelBounds(station));
  assert(Math.max(dims[0],dims[2])>50 && Math.max(dims[0],dims[2])<75,`canopy should be enlarged to ~62m width, got ${dims}`);
  assert(Math.min(dims[0],dims[2])>25 && Math.min(dims[0],dims[2])<50,`canopy should be enlarged to ~30m depth, got ${dims}`);
  const shop=root.children.find(c=>c.isGroup && c.children.length===1 && c!==station && c.children[0].name.startsWith('gas.store'));
  assert(shop,'separate store should be visible');
  const b1=scene.modelBounds(station),b2=scene.modelBounds(shop);
  assert(b1.maxz < b2.minz-2, 'store and canopy should not overlap');
  const aux=root.children.find(c=>c.isGroup && c!==station && c!==shop);
  assert(aux,'auxiliary fuel prefab should be kept');
  const b3=scene.modelBounds(aux);
  assert(b1.maxz < b3.minz-2, 'fuel auxiliary and canopy should not overlap');
  assert(b2.maxx < b3.minx-2, 'store and auxiliary fuel units should not overlap');
  if(map.id==='saryarka'){
    scene.createWorkshopFacility(map.nodes.find(n=>n.kind==='workshop'));
    const workshop=scene.facilityRoots.get('workshop');
    const a=scene.modelBounds(root),w=scene.modelBounds(workshop);
    const gapX=Math.max(0,w.minx-a.maxx,a.minx-w.maxx),gapZ=Math.max(0,w.minz-a.maxz,a.minz-w.maxz);
    console.log('fuel bounds',a,'workshop bounds',w,'AABB separation',Math.hypot(gapX,gapZ));
    assert(gapX>5||gapZ>5,'enlarged station must remain clear of workshop');
  }
  console.log('PASS',map.id,'canopy',dims,'shop',asSize(b2),'aux',asSize(b3),'root',asSize(scene.modelBounds(root)));
}
