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
const machines={excavator:await loadModel('./models/excavator.glb'),truck:await loadModel('./models/haul-truck-rigged-optimized.glb')};
for(const id of ['saryarka','altai']){
  const map=(await import(`../live/maps/${id}.js`)).default,source=JSON.stringify(map),ops=new MineOperations(map);
  const scene=Object.create(MineScene.prototype);
  scene.roadSegments=[];scene.visualTime=0;
  Object.assign(scene,{map,snap:ops.snapshot(),visualRoads:new Map(),trucks:new Map(),assets:new Map(),facilityRoots:new Map(),modelCache:{...machines,[id==='altai'?'terrainAltai':'terrainSaryarka']:await loadModel(`./models/${map.sceneDefinition.baseModel}`)},scene:new Scene(),camera:new PerspectiveCamera(42,2,.5,18000),controls:{target:new Vector3()}});
  scene.scene.fog=new Fog(0,1,2);
  for(const key of ['terrainGroup','facilityGroup','fxGroup','machineGroup','roadGroup']){scene[key]=new Group();scene.scene.add(scene[key]);}
  for(const key of ['rainClouds','dust','landslide'])scene[key]={visible:false};
  scene.prepareRoads();scene.createTerrain();scene.createFacilities();scene.buildMachines();scene.update(scene.snap);
  const excavators=[...scene.assets.values()].filter(a=>a.kind==='excavator');
  for(const asset of excavators){
    const w=asset.detail.worksite;assert(w,'every excavator uses a terrain-aware site');
    assert(Math.hypot(asset.root.position.x-asset.node.x,asset.root.position.z-asset.node.z)<=28.01,'loading point stays within boom reach');
    const geometry=w.pad.geometry,p=geometry.getAttribute('position'),count=p.count/2,index=geometry.index;
    assert(p.array.every(Number.isFinite),'working ground geometry remains finite');
    for(let i=0;i<count;i++)assert(p.getY(i+count)<=w.ground(p.getX(i),p.getZ(i))-.99,'foundation underside is buried in the actual terrain');
    const edges=new Map();
    for(let i=0;i<index.count;i+=3)for(let j=0;j<3;j++){
      const a=index.getX(i+j),b=index.getX(i+(j+1)%3),key=a<b?`${a},${b}`:`${b},${a}`;
      edges.set(key,(edges.get(key)||0)+1);
    }
    assert([...edges.values()].every(n=>n===2),'pad is a closed solid, without open sides or bottom');
    const target=asset.detail.digPoint;
    assert(Math.abs(target.y-w.surface(target.x,target.z)-2)<.25,'digging target sits on the prepared bench');
    // Camera protection must include the new raised working surface as well.
    const center=asset.root.localToWorld(new Vector3(2,0,1));
    scene.camera.position.copy(center).add(new Vector3(0,-20,0));scene.controls.target.copy(center);
    constrainTerrainCamera(scene);
    assert(scene.camera.position.y>=center.y+5.99,'camera cannot enter the working bench from below');
    console.log(id,asset.node.id,'site',asset.root.position.toArray().map(n=>n.toFixed(2)).join(', '));
  }
  scene.running=true;scene.animationRate=5;
  for(let frame=0;frame<240;frame++){
    ops.step(.2);scene.update(ops.snapshot());scene.animateModels(.04);
    if(frame%20!==0)continue;
    for(const asset of excavators){
      asset.root.updateMatrixWorld(true);
      const mesh=asset.visual.getObjectByName('animated-track-shoes').children[0],p=mesh.geometry.getAttribute('position');
      const contacts=[0,0];
      for(let i=0;i<p.count;i++)if(p.getY(i)<.055){
        const world=new Vector3().fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld),surface=terrainCameraHeight(scene.cameraTerrain,world.x,world.z);
        assert(world.y>=surface-.08&&world.y<=surface+.09,'both crawler belts stay on the rendered ground throughout the dig/crawl cycle');
        contacts[p.getX(i)<0?0:1]++;
      }
      assert(contacts.every(n=>n>20),'both full tracks have ground support');
      assert(asset.root.matrixWorld.elements.every(Number.isFinite));
    }
  }
  assert.equal(JSON.stringify(map),source,'facility placement does not modify routes, elevations or simulation nodes');
  console.log('PASS',id,'grounded tracks through animation, closed foundations, reachable stockpile, camera collision and unchanged routes');
}
