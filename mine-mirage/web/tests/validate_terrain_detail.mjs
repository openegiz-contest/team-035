import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

const context={drawImage(){},createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}};
globalThis.document={createElement:()=>({relList:{supports:()=>true},getContext:()=>context})};
globalThis.createImageBitmap=async()=>({width:4096,height:4096,close(){}});
globalThis.fetch=async path=>new Response(await fs.readFile(new URL('../'+String(path).replace(/^\.\//,''),import.meta.url)));
const {G:Group,S:Scene,F:Fog}=await import('../assets/three-vendor.js');
const {MineScene}=await import('../assets/mine-scene.js');
const {loadModel}=await import('../assets/glb-loader.js');
const {disposeSceneDetails}=await import('../assets/scene-detail.js');
const {sampleLandscapeSurface}=await import('../assets/landscape-habitat.js');
const geometryHash=root=>{const hash=createHash('sha256');root.traverse(o=>{
  for(const a of Object.values(o.geometry?.attributes||{}))hash.update(new Uint8Array(a.array.buffer));
  if(o.geometry?.index)hash.update(new Uint8Array(o.geometry.index.array.buffer));
});return hash.digest('hex');};

for(const id of ['saryarka','altai']){
  const map=(await import(`../live/maps/${id}.js`)).default;
  const prefab=await loadModel(`./models/${map.sceneDefinition.baseModel}`),before=geometryHash(prefab),sourceMaterials=[];
  prefab.traverse(o=>{if(o.material){sourceMaterials.push(o.material);if(o.material.map)assert.equal(o.material.map.image.width,4096,'terrain retains its 4K texture');}});
  const scene=Object.create(MineScene.prototype);
  Object.assign(scene,{map,visualRoads:new Map(),modelCache:{[id==='altai'?'terrainAltai':'terrainSaryarka']:prefab},terrainGroup:new Group(),facilityGroup:new Group(),scene:new Scene()});
  scene.scene.fog=new Fog(0,1,2);scene.prepareRoads();scene.createTerrain();
  const field=scene.naturalTerrain,land=scene.terrainGroup.getObjectByName('natural-quarry-surroundings');
  assert(field&&land,'both real quarry models receive surrounding terrain');
  assert(field.surface.every(Number.isFinite),'no missing vertices or NaN heights');
  assert(field.xs.at(-1)-field.xs[0]>14000,'landscape extends beyond the quarry');
  assert(field.heights.some(Number.isFinite),'height field samples the original scan');
  for(let i=0;i<field.heights.length;i++)if(Number.isFinite(field.heights[i]))assert(Math.abs(field.surface[i]-(field.heights[i]-1.2))<.001,'underlap stays below the scan');
  assert(land.geometry.index.array.every(i=>i<land.geometry.getAttribute('position').count),'all surface triangles have valid vertices');
  assert(scene.landscapeVegetation.length>100,'surroundings contain vegetation beyond the central scan');
  for(const plant of scene.landscapeVegetation){
    const ground=sampleLandscapeSurface(field,plant.x,plant.z);
    assert(ground&&!ground.onScan&&ground.distance>=12,'vegetation stays off the scanned quarry and its operational routes');
    assert(Math.abs(ground.y-plant.y)<.001,'vegetation roots sit on the landscape surface');
  }
  for(const mesh of scene.terrainGroup.children.filter(o=>o.name.startsWith('landscape-woodland-'))){
    for(const attribute of Object.values(mesh.geometry.attributes))assert(attribute.array.every(Number.isFinite),'vegetation geometry is finite');
    assert(mesh.geometry.boundingSphere.radius>0,'grove batches support frustum culling');
  }
  assert.equal(geometryHash(prefab),before,'source terrain vertices, normals and UVs remain unchanged');
  let disposedSource=false,disposedSurface=false;
  for(const material of sourceMaterials)material.addEventListener('dispose',()=>disposedSource=true);
  land.geometry.addEventListener('dispose',()=>disposedSurface=true);
  disposeSceneDetails(scene);
  assert(disposedSurface&&!disposedSource,'map cleanup releases new geometry and preserves cached source materials');
  console.log('PASS',id,'finite landscape, scan preservation, 4K textures, safe map cleanup;',scene.landscapeVegetation.length,'grounded plants off operational terrain');
}
