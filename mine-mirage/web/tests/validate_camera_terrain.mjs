import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const context={drawImage(){},createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}};
globalThis.document={createElement:()=>({relList:{supports:()=>true},getContext:()=>context})};
globalThis.createImageBitmap=async()=>({width:4096,height:4096,close(){}});
globalThis.fetch=async path=>new Response(await fs.readFile(new URL('../'+String(path).replace(/^\.\//,''),import.meta.url)));
const {G:Group,S:Scene,F:Fog,V:Vector3,P:PerspectiveCamera}=await import('../assets/three-vendor.js');
const {MineScene}=await import('../assets/mine-scene.js');
const {loadModel}=await import('../assets/glb-loader.js');
const {constrainTerrainCamera,terrainCameraHeight}=await import('../assets/camera-terrain.js');

for(const id of ['saryarka','altai']){
  const map=(await import(`../live/maps/${id}.js`)).default,source=JSON.stringify(map);
  const prefab=await loadModel(`./models/${map.sceneDefinition.baseModel}`),scene=Object.create(MineScene.prototype);
  Object.assign(scene,{map,visualRoads:new Map(),modelCache:{[id==='altai'?'terrainAltai':'terrainSaryarka']:prefab},terrainGroup:new Group(),facilityGroup:new Group(),scene:new Scene(),camera:new PerspectiveCamera(42,2.6,.5,18000),controls:{target:new Vector3(),update(){}},running:false});
  scene.scene.fog=new Fog(0,1,2);scene.prepareRoads();scene.createTerrain();
  const collider=scene.cameraTerrain;
  assert(collider.triangles.length>1000,'collision index uses the actual quarry mesh');
  const safe=()=>{
    const p=scene.camera.position;
    assert(Number.isFinite(p.y)&&p.y>=terrainCameraHeight(collider,p.x,p.z)+5.99,'eye remains above terrain');
    for(const [dx,dz] of [[3,0],[-3,0],[0,3],[0,-3]])assert(p.y>=terrainCameraHeight(collider,p.x+dx,p.z+dz)+5.99,'camera footprint cannot intersect a slope');
    assert(p.x>=collider.minX+5&&p.x<=collider.maxX-5&&p.z>=collider.minZ+5&&p.z<=collider.maxZ-5,'panning stays inside the supported landscape');
  };
  // Reproduce an underground eye at triangle centres, including steep benches.
  for(let i=0;i<collider.triangles.length;i+=Math.max(1,Math.floor(collider.triangles.length/160))){
    const t=collider.triangles[i],x=(t[0]+t[3]+t[6])/3,y=(t[1]+t[4]+t[7])/3,z=(t[2]+t[5]+t[8])/3;
    assert(terrainCameraHeight(collider,x,z)>=y-.001,'height query covers the original triangle');
    scene.controls.target.set(x,y-80,z);scene.camera.position.set(x,y-50,z);
    constrainTerrainCamera(scene);safe();
    assert(scene.camera.position.y>=y+5.99,'camera is recovered from below the actual mesh');
  }
  let cases=0;const start=performance.now();
  for(const node of map.nodes)for(const distance of [24,80,350,1500])for(let angle=0;angle<Math.PI*2;angle+=Math.PI/12){
    scene.controls.target.set(node.x,node.elevation+8,node.z);
    scene.camera.position.set(node.x+Math.cos(angle)*distance,node.elevation+distance*.02,node.z+Math.sin(angle)*distance);
    constrainTerrainCamera(scene);safe();cases++;
  }
  const elapsed=performance.now()-start;
  scene.controls.target.set(1e6,-1e6,-1e6);scene.camera.position.copy(scene.controls.target);constrainTerrainCamera(scene);safe();
  scene.fitCamera(true);constrainTerrainCamera(scene);
  const unchanged=scene.camera.position.clone(),target=scene.controls.target.clone();
  assert.equal(constrainTerrainCamera(scene),false,'safe overview does not drift');
  assert(scene.camera.position.equals(unchanged)&&scene.controls.target.equals(target));
  // Exercise the production frame loop while paused, after controls move the eye.
  let frame,rendered=false;globalThis.requestAnimationFrame=callback=>{frame=callback;};
  Object.assign(scene,{lastTime:0,visualTime:0,statsFrames:0,frame:0,animateModels(){},tickParticles(){},renderer:{render(){safe();rendered=true;}}});
  scene.controls.update=()=>{scene.camera.position.y=-1000;};scene.start();frame(1000);
  assert(rendered,'paused frame still applies collision before rendering');
  assert.equal(JSON.stringify(map),source,'camera guard cannot change routes or simulation data');
  console.log('PASS',id,collider.triangles.length,'indexed triangles;',cases,'orbit/zoom/follow poses;',Math.round(elapsed),'ms including assertions; underground recovery, world bounds, pause, no overview drift');
}
