import {
  S as Scene, C as Color, F as Fog, P as PerspectiveCamera, at as WebGLRenderer,
  O as OrbitControls, H as HemisphereLight, D as DirectionalLight,
  G as Group, M as Mesh, B as BufferGeometry, k as Float32BufferAttribute,
  j as MeshStandardMaterial, d as MeshBasicMaterial, e as DoubleSide,
  V as Vector3, l as CanvasTexture, q as BoxGeometry, c as IcosahedronGeometry, a as PlaneGeometry,
  g as Points, h as PointsMaterial
} from './three-vendor.js';
import {loadModel} from './glb-loader.js';
import {findPuddleSites,shorelineRadii,stepWaterLevel} from './scenario-water.js';
import {extendLandscape,rigExcavator,rigTruck,animateDetailedMachines,disposeSceneDetails} from './scene-detail.js';
import {prepareTerrainCamera,constrainTerrainCamera,terrainCameraHeight} from './camera-terrain.js';
import {fitModularBuilding} from './facility-model.js';
import {BlastVisual} from './blast-visual.js';

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const mix=(a,b,t)=>a*(1-t)+b*t;
const vec=(x=0,y=0,z=0)=>({x,y,z});
const distance=(a,b)=>Math.hypot((b.x-a.x),(b.y-a.y),(b.z-a.z));
const centerOf=b=>({x:(b.minx+b.maxx)/2,y:(b.miny+b.maxy)/2,z:(b.minz+b.maxz)/2});
const rockMat=new MeshStandardMaterial({color:0xbab3a9,roughness:1,side:DoubleSide});
if(typeof Image!=='undefined'){
  const image=new Image();
  image.onload=()=>{rockMat.map=new CanvasTexture(image);rockMat.needsUpdate=true;};
  image.src='./assets/rock-texture.jpg';
}

export class MineScene {
  constructor(mount,callbacks={}){
    this.mount=mount;this.callbacks=callbacks;
    this.modelCache={};
    this.trucks=new Map();
    this.assets=new Map();
    this.visualRoads=new Map();
    this.roadSegments=[];
    this.facilityRoots=new Map();
    this.running=true;this.lowPower=false;this.topDown=false;this.trackedTruck=null;
    this.fps=0;this.lastTime=0;this.lastStatsTime=0;this.statsFrames=0;this.frame=0;this.visualTime=0;
    this.map=null;this.snap=null;
    this.scenarioState={wetness:0,fog:0,heat:0,slide:0};
    this.scenarioTarget={wetness:0,fog:0,heat:0,slide:0};
    this.serviceUnits={};

    this.scene=new Scene();
    this.scene.background=new Color('#193142');
    this.scene.fog=new Fog('#193142',1200,4200);
    this.camera=new PerspectiveCamera(42,1,2,6000);
    this.camera.position.set(920,1020,1500);
    this.renderer=new WebGLRenderer({antialias:true,powerPreference:'high-performance',alpha:false});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.25));
    this.renderer.outputColorSpace='srgb';
    this.mount.appendChild(this.renderer.domElement);
    this.weatherVeil=document.createElement('div');
    this.weatherVeil.className='mirage-weather-veil';
    this.weatherVeil.setAttribute('aria-hidden','true');
    this.mount.appendChild(this.weatherVeil);
    this.weatherHud=document.createElement('div');
    this.weatherHud.className='mirage-weather-impact';
    this.weatherHud.setAttribute('role','status');
    this.weatherHud.setAttribute('aria-live','off');
    this.mount.appendChild(this.weatherHud);
    this.lastHeatDistort=0;
    // Browser SVG displacement is optional. When disabled or unsupported,
    // warmth/contrast still convey heat without particles.
    const ns='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(ns,'svg');svg.setAttribute('width','0');svg.setAttribute('height','0');
    svg.style.cssText='position:absolute;width:0;height:0;pointer-events:none';
    const defs=document.createElementNS(ns,'defs'),filter=document.createElementNS(ns,'filter');
    filter.setAttribute('id','mine-heat-refraction');filter.setAttribute('x','0');filter.setAttribute('y','0');
    filter.setAttribute('width','100%');filter.setAttribute('height','100%');
    const turbulence=document.createElementNS(ns,'feTurbulence');
    turbulence.setAttribute('type','fractalNoise');turbulence.setAttribute('baseFrequency','0.006 0.015');
    turbulence.setAttribute('numOctaves','1');turbulence.setAttribute('seed','3');turbulence.setAttribute('result','noise');
    const displacement=document.createElementNS(ns,'feDisplacementMap');
    displacement.setAttribute('in','SourceGraphic');displacement.setAttribute('in2','noise');
    displacement.setAttribute('scale','1.6');displacement.setAttribute('xChannelSelector','R');displacement.setAttribute('yChannelSelector','G');
    filter.append(turbulence,displacement);defs.appendChild(filter);svg.appendChild(defs);
    this.mount.appendChild(svg);this.heatTurbulence=turbulence;


    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.controls.enableDamping=true;this.controls.dampingFactor=.08;
    this.controls.minDistance=260;this.controls.maxDistance=4300;
    this.controls.minDistance=24;this.controls.maxDistance=7200;
    this.camera.near=.5;this.camera.far=18000;this.camera.updateProjectionMatrix();
    this.controls.minPolarAngle=.10;this.controls.maxPolarAngle=Math.PI*.485;
    this.controls.target.set(0,0,0);this.controls.update();

    const hemi=new HemisphereLight(0xd4eeff,0x665545,1.3);this.scene.add(hemi);
    const sun=new DirectionalLight(0xffe3ba,1.7);sun.position.set(-900,1200,800);this.scene.add(sun);
    const fill=new DirectionalLight(0x8dbbe6,.35);fill.position.set(600,450,-800);this.scene.add(fill);
    this.weatherSun=sun;this.weatherHemi=hemi;

    this.root=new Group();this.scene.add(this.root);
    this.terrainGroup=new Group();this.root.add(this.terrainGroup);
    this.roadGroup=new Group();this.root.add(this.roadGroup);
    this.facilityGroup=new Group();this.root.add(this.facilityGroup);
    this.machineGroup=new Group();this.root.add(this.machineGroup);
    this.fxGroup=new Group();this.root.add(this.fxGroup);

    this.rainClouds=this.makeRain();
    this.dust=this.makeDust();
    this.landslide=this.makeLandslide();

    this.resizeObserver=new ResizeObserver(()=>this.resize());
    this.resizeObserver.observe(mount);
    this.resize();
    this.start();
  }
  resize(){const w=this.mount.clientWidth||850,h=this.mount.clientHeight||550;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h,false);}
  clearGroup(g){
    while(g.children.length){const child=g.children[0];g.remove(child);
      if(g===this.roadGroup)child.traverse?.(o=>{o.geometry?.dispose?.();});
    }
  } // GLB clones share geometry: do not dispose cached assets on map switch
  clear(){
    this.cameraTerrain=null;this.blastVisual=null;
    disposeSceneDetails(this);
    this.clearGroup(this.terrainGroup);this.clearGroup(this.roadGroup);this.clearGroup(this.facilityGroup);this.clearGroup(this.machineGroup);this.clearGroup(this.fxGroup);
    this.trucks.clear();this.assets.clear();this.visualRoads=new Map();this.roadSegments=[];this.facilityRoots=new Map();this.workshopBay=null;
  }
  async loadModels(){
    const defs={
      quarry:'./models/quarry.glb',
      terrainSaryarka:'./models/open_pit_mine.glb',
      terrainAltai:'./models/mining_quarry.glb',
      truck:'./models/haul-truck-rigged-optimized.glb',
      truckDetail:'./models/haul-truck.glb',
      excavator:'./models/excavator.glb',
      crusher:'./models/mobile-jaw-crusher.glb',
      fuel:'./models/fuel-optimized.glb',
      gasStation:'./models/gas-station.glb',
      garage:'./models/industrial-garage.glb',
      warehouse:'./models/industrial-warehouse.glb',
      substation:'./models/electrical-substation.glb',
      modular:'./models/modular-buildings.glb',
      drill:'./models/mine-mirage-drill-rig.glb?v=5237'
    };
    await Promise.all(Object.entries(defs).map(async([k,url])=>{try{this.modelCache[k]=await loadModel(url);}catch(e){console.warn('GLB load failed',k,e);this.modelCache[k]=null;}}));
    this.assetsLoaded=true; console.info("MINE//MIRAGE BUILD 5235: GLB models loaded, integrated drill rig", Object.keys(this.modelCache).filter(k=>this.modelCache[k]));
    if(this.map){const snap=this.snap;this.buildMap(this.map);if(snap)this.update(snap);}
  }
  buildMap(map){
    this.map=map;this.clear();this.prepareRoads();this.createTerrain(map);this.createRoads(map);this.createFacilities(map);this.createScenarioFx();this.blastVisual=new BlastVisual(this);if(this.snap)this.buildMachines();this.fitCamera(false);
  }
  prepareRoads(){
    if(!this.map)return;
    this.nodes=new Map(this.map.nodes.map(n=>[n.id,n]));
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const n of this.map.nodes){minX=Math.min(minX,n.x);maxX=Math.max(maxX,n.x);minZ=Math.min(minZ,n.z);maxZ=Math.max(maxZ,n.z);minY=Math.min(minY,n.elevation||0);maxY=Math.max(maxY,n.elevation||0);}
    for(const edge of this.map.edges){
      const pts=(edge.path?.length?edge.path:[[this.nodes.get(edge.fromNode).x,this.nodes.get(edge.fromNode).z,this.nodes.get(edge.fromNode).elevation||0],[this.nodes.get(edge.toNode).x,this.nodes.get(edge.toNode).z,this.nodes.get(edge.toNode).elevation||0]])
        .map(([x,z,y])=>[x,y,z]);
      let total=0;const cumulative=[0];
      for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i];total+=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);cumulative.push(total);}
      this.visualRoads.set(edge.id,{id:edge.id,edge,points:pts,cumulative,total:Math.max(total,.001)});
      for(const p of pts){minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minZ=Math.min(minZ,p[2]);maxZ=Math.max(maxZ,p[2]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);}
    }
    this.mapBounds={minX,maxX,minZ,maxZ,minY,maxY,centerX:(minX+maxX)/2,centerZ:(minZ+maxZ)/2};
  }
  createTerrain(){
    const {minX,maxX,minZ,maxZ,minY,centerX,centerZ}=this.mapBounds;
    const setup=this.map?.sceneDefinition?.terrainScale;
    const source=this.map?.sceneDefinition?.baseModel;
    const key=source==='mining_quarry.glb'?'terrainAltai':source==='open_pit_mine.glb'?'terrainSaryarka':'quarry';
    const prefab=this.modelCache[key];
    if(prefab&&setup){
      const terrain=prefab.clone(true);
      const boundsCenter=centerOf(setup);
      terrain.scale.set(setup.scale,setup.scaleY,setup.scale);
      terrain.position.set(-boundsCenter.x*setup.scale,setup.offsetY-setup.miny*setup.scaleY,-boundsCenter.z*setup.scale);
      terrain.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=true;}});
      this.terrainGroup.add(terrain);
    }else this.terrainGroup.add(this.makeFallbackTerrain());
    const plane=new Mesh(new PlaneGeometry(2100,1700),new MeshStandardMaterial({color:0x2e4249,roughness:1,side:DoubleSide}));
    plane.rotation.x=-Math.PI/2;plane.position.set(0,(minY||0)-110,0);this.terrainGroup.add(plane);
    extendLandscape(this,plane);
    prepareTerrainCamera(this);
  }
  makeFallbackTerrain(){
    const {minX,maxX,minZ,maxZ,minY,centerX,centerZ}=this.mapBounds;
    const nx=this.lowPower?96:148,nz=this.lowPower?96:148,w=maxX-minX,h=maxZ-minZ,pts=[],cols=[],ids=[];
    for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){
      const x=minX+w*ix/nx,z=minZ+h*iz/nz;const dx=(x-centerX)/w,dz=(z-centerZ)/h;const ring=Math.hypot(dx*1.2,dz*.95);const y=minY-8+Math.max(0,(ring-.08))*180+Math.sin(x*.02+z*.015)*2.2;
      pts.push(x,y,z);const shade=clamp(.52+ring*.52,0,.9);cols.push(shade*.96,shade*.92,shade*.88);
    }
    for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){const a=z*(nx+1)+x,b=a+1,c=a+nx+1,d=c+1;ids.push(a,c,b,b,c,d);}    
    const geo=new BufferGeometry();geo.setAttribute('position',new Float32BufferAttribute(pts,3));geo.setAttribute('color',new Float32BufferAttribute(cols,3));geo.setIndex(ids);geo.computeVertexNormals();
    return new Mesh(geo,new MeshStandardMaterial({vertexColors:true,roughness:1,side:DoubleSide}));
  }
  ribbon(points,width=.8,up=.2){
    const pos=[],idx=[];const count=points.length/3;
    for(let i=0;i<count;i++){
      const k=Math.max(0,i-1),j=Math.min(count-1,i+1);const dx=points[j*3]-points[k*3],dz=points[j*3+2]-points[k*3+2];const d=Math.hypot(dx,dz)||1;const nx=-dz/d,nz=dx/d;
      pos.push(points[i*3]+nx*width/2,points[i*3+1]+up,points[i*3+2]+nz*width/2);
      pos.push(points[i*3]-nx*width/2,points[i*3+1]+up,points[i*3+2]-nz*width/2);
      if(i<count-1){const a=i*2;idx.push(a,a+1,a+2,a+1,a+3,a+2);}
    }
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();return g;
  }
  sampleRoadRecord(record,t){
    if(!record?.points?.length)return {x:0,y:0,z:0};
    const target=clamp(t,0,1)*record.total;let i=1;while(i<record.cumulative.length-1&&record.cumulative[i]<target)i++;
    const a=record.points[i-1],b=record.points[i],left=record.cumulative[i-1]||0,span=(record.cumulative[i]-left)||1,u=clamp((target-left)/span,0,1);
    return {x:mix(a[0],b[0],u),y:mix(a[1],b[1],u),z:mix(a[2],b[2],u)};
  }
  roadCurve(edgeOrId,t){return this.sampleRoadRecord(this.visualRoads.get(typeof edgeOrId==='string'?edgeOrId:edgeOrId?.id),t);}
  createRoads(){
    // Ordinary mode keeps the photogrammetry unobstructed. Diagnostic mode
    // draws only the ACTUAL routing polylines and warns on excessive slopes.
    this.roadSegments=[];
    if(typeof window==='undefined'||!new URLSearchParams(window.location.search).has('debugRoads'))return;
    for(const record of this.visualRoads.values()){
      if(record.points.length<2)continue;
      const raw=record.points.flat();
      const mesh=new Mesh(this.ribbon(raw,1.2,1.65),new MeshBasicMaterial({color:record.edge.unverifiedSlope?'#ffc15b':'#17edce',transparent:true,opacity:.82,depthWrite:false,side:DoubleSide}));
      mesh.name='route-audit-'+record.id;mesh.renderOrder=13;this.roadGroup.add(mesh);
    }
  }
  nodeDirection(nodeId){
    const connected=this.map.edges.filter(e=>e.fromNode===nodeId||e.toNode===nodeId);
    if(!connected.length)return {dx:0,dz:1,rot:0};
    const edge=connected[0],record=this.visualRoads.get(edge.id);if(!record)return {dx:0,dz:1,rot:0};
    let a,b;
    if(edge.toNode===nodeId){a=record.points[Math.max(0,record.points.length-2)];b=record.points[record.points.length-1];}
    else{a=record.points[0];b=record.points[Math.min(record.points.length-1,1)];}
    const dx=b[0]-a[0],dz=b[2]-a[2],mag=Math.hypot(dx,dz)||1;const ndx=dx/mag,ndz=dz/mag;
    return {dx:ndx,dz:ndz,rot:-Math.atan2(ndz,ndx)};
  }

  groundHeight(x,z){
    return this.cameraTerrain?terrainCameraHeight(this.cameraTerrain,x,z):(this.mapBounds?.minY||0);
  }
  footprintProfile(root){
    const rot=root.rotation.y;root.rotation.y=0;root.updateMatrixWorld(true);
    const l=this.modelBounds(root),px=root.position.x,pz=root.position.z;root.rotation.y=rot;root.updateMatrixWorld(true);
    const b=this.modelBounds(root);
    return {rot,lminx:l.minx-px,lmaxx:l.maxx-px,lminz:l.minz-pz,lmaxz:l.maxz-pz,minx:b.minx-px,maxx:b.maxx-px,minz:b.minz-pz,maxz:b.maxz-pz,miny:b.miny-root.position.y};
  }
  evaluateFacilitySite(profile,x,z){
    // dense sampling of the ORIENTED footprint (corners, edges and interior), not just a 5x5 axis-aligned box
    const r=profile.rot||0,c=Math.cos(r),sn=Math.sin(r);let low=Infinity,high=-Infinity,total=0,count=0;
    const x0=profile.lminx??profile.minx,x1=profile.lmaxx??profile.maxx,z0=profile.lminz??profile.minz,z1=profile.lmaxz??profile.maxz;
    const nx=Math.max(4,Math.min(14,Math.ceil((x1-x0)/8))),nz=Math.max(4,Math.min(14,Math.ceil((z1-z0)/8)));
    for(let ix=0;ix<=nx;ix++)for(let iz=0;iz<=nz;iz++){
      const lx=mix(x0,x1,ix/nx),lz=mix(z0,z1,iz/nz),h=this.groundHeight(x+lx*c+lz*sn,z-lx*sn+lz*c);
      if(h<low)low=h;if(h>high)high=h;total+=h;count++;
    }
    return {low,high,mean:total/count,range:high-low};
  }
  placeFacilityOnTerrain(root,node,{searchRadius=0,clearance=.1,step=8,preferDistance=.06}={}){
    if(!this.cameraTerrain)return;
    const profile=this.footprintProfile(root),baseX=root.position.x,baseZ=root.position.z;let best=null;
    const consider=(x,z)=>{const site=this.evaluateFacilitySite(profile,x,z),dist=Math.hypot(x-baseX,z-baseZ),score=site.range*40+dist*preferDistance;if(!best||score<best.score)best={x,z,score,dist,...site};};
    consider(baseX,baseZ);
    for(let r=step;r<=searchRadius;r+=step)for(let dx=-r;dx<=r;dx+=step)for(let dz=-r;dz<=r;dz+=step){if(Math.abs(dx)!==r&&Math.abs(dz)!==r)continue;consider(baseX+dx,baseZ+dz);}
    if(!best)return;
    root.position.x=best.x;root.position.z=best.z;
    root.position.y=best.low+(best.mean-best.low)*.55-profile.miny+clearance; // sits between lowest and mean: small burial instead of floating
    root.userData.siteRange=best.range;root.userData.siteShift=best.dist;root.updateMatrixWorld(true);
  }
  updateWater(dt){
    const f=this.snap?.flags||{};
    this.waterLevel=stepWaterLevel(this.waterLevel||0,{rain:!!f.rain,drainage:!!f.drainage,pumpFault:!!f.pumpFault,powerFault:!!f.powerFault,sump:this.snap?.water?.sump||0},dt);
    const lv=this.waterLevel;this.puddleGroup.visible=lv>.015;
    if(this.waterShown!==undefined&&Math.abs(lv-this.waterShown)<.01)return;this.waterShown=lv;
    const sm=lv*lv*(3-2*lv);
    for(const mesh of this.puddleMeshes){const site=mesh.userData.site,{yw,radii}=shorelineRadii((x,z)=>this.groundHeight(x,z),site,sm),pos=mesh.geometry.getAttribute('position'),n=radii.length;
      pos.setXYZ(0,site.x,yw+.04,site.z);
      for(let i=0;i<n;i++){const a=i/n*Math.PI*2;pos.setXYZ(1+i,site.x+Math.cos(a)*radii[i],yw+.04,site.z+Math.sin(a)*radii[i]);}
      pos.needsUpdate=true;mesh.material.opacity=.15+.45*sm;}
  }
  createScenarioFx(){
    this.waterLevel=0;this.waterShown=undefined;this.puddleGroup=new Group();this.puddleGroup.visible=false;this.puddleMeshes=[];
    const cand=[];for(const rec of this.visualRoads.values())for(let t=.03;t<1;t+=.04){const q=this.sampleRoadRecord(rec,t);cand.push({x:q.x,z:q.z});}
    const cx=this.mapBounds?.centerX||0,cz=this.mapBounds?.centerZ||0;for(let x=-240;x<=240;x+=16)for(let z=-240;z<=240;z+=16)cand.push({x:cx+x,z:cz+z});
    this.puddleSites=findPuddleSites((x,z)=>this.groundHeight(x,z),cand);
    for(const site of this.puddleSites){
      const g=new BufferGeometry(),n=16;g.setAttribute('position',new Float32BufferAttribute(new Float32Array((n+1)*3),3));
      const idx=[];for(let i=0;i<n;i++)idx.push(0,1+i,1+(i+1)%n);g.setIndex(idx);
      const mesh=new Mesh(g,new MeshBasicMaterial({color:0x6f95ad,transparent:true,opacity:0,side:DoubleSide,depthWrite:false}));
      mesh.frustumCulled=false;mesh.userData={site};this.puddleGroup.add(mesh);this.puddleMeshes.push(mesh);
    }
    this.fxGroup.add(this.puddleGroup);
    // Fog uses Three.js depth fog and atmospheric color grading instead of
    // intersecting, square-edged particle clouds or large ground planes.
    this.mist=new Group();this.fxGroup.add(this.mist);
    // Heat uses a very subtle animated screen-space distortion and a warm
    // atmospheric veil; no billboard dust/heat particles.
    this.heatGroup=new Group();this.fxGroup.add(this.heatGroup);

    this.slideDebrisGroup=new Group();this.slideDebrisGroup.visible=false;
    if(this.visualRoads.has('RAMP-04')){
      const mid=this.sampleRoadRecord(this.visualRoads.get('RAMP-04'),.48);
      for(let i=0;i<12;i++){
        const rock=new Mesh(new IcosahedronGeometry(2.0+(i%4)*.6,0),new MeshStandardMaterial({color:0x887564,roughness:1}));
        const x=mid.x-12+(i%4)*8+Math.sin(i)*2.4,z=mid.z+12+Math.floor(i/4)*6+Math.cos(i*.8)*2.3,y=this.groundHeight(x,z)+.6;
        rock.position.set(x,y,z);rock.scale.setScalar(.05);rock.userData={base:{x,y,z},phase:i*.33};this.slideDebrisGroup.add(rock);
      }
    }
    this.fxGroup.add(this.slideDebrisGroup);
  }
  makeServiceVehicle(kind='water'){
    const root=new Group();
    const cabColor=kind==='water'?0x2d7fbf:0xb6882d, bodyColor=kind==='water'?0x5ca7db:0xd3aa4b;
    const chassis=new Mesh(new BoxGeometry(kind==='water'?11:9,1.2,5),new MeshStandardMaterial({color:0x4c5458,roughness:.95}));chassis.position.y=1.2;root.add(chassis);
    const cab=new Mesh(new BoxGeometry(3.2,2.7,4.4),new MeshStandardMaterial({color:cabColor,roughness:.78,metalness:.12}));cab.position.set(-3.2,2.8,0);root.add(cab);
    const body=new Mesh(new BoxGeometry(kind==='water'?5.8:4.2,3.0,4.4),new MeshStandardMaterial({color:bodyColor,roughness:.72,metalness:.16}));body.position.set(1.8,2.9,0);root.add(body);
    if(kind==='water'){
      const tank=new Mesh(new BoxGeometry(6.4,2.6,4.0),new MeshStandardMaterial({color:0x7fbfe1,roughness:.5,metalness:.22}));tank.position.set(1.7,3.2,0);root.add(tank);
      const hose=new Mesh(new BoxGeometry(1.2,.8,3.8),new MeshStandardMaterial({color:0x29343a,roughness:1}));hose.position.set(4.8,2.8,0);root.add(hose);
    } else {
      const blade=new Mesh(new BoxGeometry(2.6,1.5,6.4),new MeshStandardMaterial({color:0x8b9499,roughness:.7}));blade.position.set(5.0,1.8,0);root.add(blade);
    }
    for(const [x,z] of [[-4.0,-2.4],[-4.0,2.4],[3.4,-2.4],[3.4,2.4]]){const wheel=new Mesh(new BoxGeometry(1.4,1.4,1.2),new MeshStandardMaterial({color:0x252525,roughness:1}));wheel.position.set(x,.7,z);root.add(wheel);}    
    return root;
  }
  createServiceYard(){
    const workshop=this.map?.nodes.find(n=>n.kind==='workshop')||this.map?.nodes.find(n=>n.kind==='depot')||this.map?.nodes.find(n=>n.kind==='fuel');
    if(!workshop)return;
    const prof={rot:0,lminx:-16,lmaxx:16,lminz:-11,lmaxz:11},roadPts=[];
    for(const rec of this.visualRoads.values())for(let t=0;t<=1;t+=.03){const q=this.sampleRoadRecord(rec,t);roadPts.push(q);}
    let site=null;for(let r=0;r<=150;r+=6)for(let dx=-r;dx<=r;dx+=6)for(let dz=-r;dz<=r;dz+=6){if(r&&Math.abs(dx)!==r&&Math.abs(dz)!==r)continue;
      const x=workshop.x-18+dx,z=workshop.z+24+dz,e=this.evaluateFacilitySite(prof,x,z);let rd=Infinity;for(const q of roadPts)rd=Math.min(rd,Math.hypot(q.x-x,q.z-z));
      const sc=e.range*60+Math.abs(rd-24)*.4+r*.05;if(!site||sc<site.sc)site={x,z,sc,...e};}
    const baseX=site.x,baseZ=site.z,baseY=site.high+.04;this.yardRange=site.range;
    const yard=new Group();yard.position.set(baseX,baseY,baseZ);
    const padH=Math.max(.35,this.yardRange+.3),pad=new Mesh(new BoxGeometry(28,padH,18),new MeshStandardMaterial({color:0x76756c,roughness:1}));pad.position.set(0,padH/2-this.yardRange,0);yard.add(pad);
    for(const z of [-4.5,4.5]){const stripe=new Mesh(new BoxGeometry(18,.04,.22),new MeshBasicMaterial({color:0xdacb86,transparent:true,opacity:.8}));stripe.position.set(1,.38,z);yard.add(stripe);}    
    const divider=new Mesh(new BoxGeometry(.22,.04,16),new MeshBasicMaterial({color:0xdacb86,transparent:true,opacity:.75}));divider.position.set(0,.38,0);yard.add(divider);
    const labelWall=new Mesh(new BoxGeometry(9,3.4,.35),new MeshStandardMaterial({color:0x45525a,roughness:.9}));labelWall.position.set(-8.5,1.8,-8.6);yard.add(labelWall);
    this.facilityGroup.add(yard);
    const water=this.makeServiceVehicle('water');water.position.set(-3,0.25,-4.5);yard.add(water);
    const cleanup=this.makeServiceVehicle('cleanup');cleanup.position.set(-3,0.25,4.5);yard.add(cleanup);
    const waterPark=yard.localToWorld(water.position.clone());
    const cleanPark=yard.localToWorld(cleanup.position.clone());
    this.serviceUnits={
      water:{root:water,container:yard,parked:water.position.clone(),worldParked:waterPark,progress:0,targetWorld:null},
      cleanup:{root:cleanup,container:yard,parked:cleanup.position.clone(),worldParked:cleanPark,progress:0,targetWorld:null},
      yard
    };
  }
  updateServiceUnits(dt){
    if(!this.serviceUnits?.yard)return;
    const wet=this.scenarioState?.wetness||0,slide=this.scenarioState?.slide||0;
    const waterActive=!this.scenarioTarget.wetness&&wet>.12&&this.puddleMeshes?.length;
    const cleanupActive=!this.scenarioTarget.slide&&slide>.12&&this.visualRoads.has('RAMP-04');
    const firstPuddle=this.puddleMeshes?.find(m=>m.userData.fill>.28)||this.puddleMeshes?.[0];
    const waterTarget=firstPuddle?new Vector3(firstPuddle.position.x+12,this.groundHeight(firstPuddle.position.x+12,firstPuddle.position.z)+.25,firstPuddle.position.z+6):null;
    const slideMid=this.visualRoads.has('RAMP-04')?this.sampleRoadRecord(this.visualRoads.get('RAMP-04'),.54):null;
    const cleanTarget=slideMid?new Vector3(slideMid.x-14,this.groundHeight(slideMid.x-14,slideMid.z+8)+.25,slideMid.z+8):null;
    const move=(unit,active,target)=>{
      if(!unit)return;
      unit.progress=mix(unit.progress,active?1:0,1-Math.exp(-dt*1.2));
      const tw=(active&&target)?target:unit.worldParked;
      unit.targetWorld=tw;
      const parent=unit.root.parent; if(!parent)return;
      const local=parent.worldToLocal(tw.clone());
      unit.root.position.x=mix(unit.root.position.x,local.x,1-Math.exp(-dt*1.6));
      unit.root.position.y=mix(unit.root.position.y,local.y,1-Math.exp(-dt*1.6));
      unit.root.position.z=mix(unit.root.position.z,local.z,1-Math.exp(-dt*1.6));
      const parkLocal=unit.parked; const dx=local.x-unit.root.position.x,dz=local.z-unit.root.position.z;
      if(Math.hypot(dx,dz)>.5)unit.root.rotation.y=-Math.atan2(dz,dx);
      else if(Math.hypot(unit.root.position.x-parkLocal.x,unit.root.position.z-parkLocal.z)<1.2)unit.root.rotation.y=0;
    };
    move(this.serviceUnits.water,waterActive,waterTarget);
    move(this.serviceUnits.cleanup,cleanupActive,cleanTarget);
  }
  createFacilities(){
    for(const n of this.map.nodes){
      if(n.kind==='face')this.createExcavatorFacility(n);
      else if(n.kind==='crusher')this.createCrusherFacility(n);
      else if(n.kind==='workshop')this.createWorkshopFacility(n);
      else if(['fuel','depot','power','weigh','refuge','workshop'].includes(n.kind))this.createStaticFacility(n);
    }
    this.createServiceYard();
  }
  createExcavatorFacility(n){
    const dir=this.nodeDirection(n.id),perp={x:-dir.dz,z:dir.dx};
    const root=new Group();root.position.set(n.x+perp.x*8,(n.elevation||0)+1.0,n.z+perp.z*8);root.rotation.y=dir.rot+Math.PI/2;
    let visual=this.modelCache.excavator?.clone(true);
    if(visual){visual.scale.setScalar(3.25);visual.position.set(2,0,1);visual.rotation.y=Math.PI;root.add(visual);} else {visual=this.makeFallbackExcavator(root);}
    const pivots={};root.traverse(o=>{if(/excavator-(boom|stick|bucket|turret)-pivot/.test(o.name))pivots[o.name]=o;});
    const baseRotations=Object.fromEntries(Object.entries(pivots).map(([k,o])=>[k,{x:o.rotation.x,y:o.rotation.y}]));
    this.facilityGroup.add(root);this.assets.set(n.id,{kind:'excavator',root,visual,pivots,baseRotations,node:n});this.facilityRoots.set(n.id,root);
    const ore=new Mesh(new IcosahedronGeometry(8,1),new MeshStandardMaterial({color:0x8f6f56,roughness:1}));ore.scale.set(1.7,.55,1.2);ore.position.set(-16,2,-6);root.add(ore);const loadingOre=new Mesh(new IcosahedronGeometry(2.2,0),new MeshStandardMaterial({color:0x99785d,roughness:1}));loadingOre.visible=false;this.fxGroup.add(loadingOre);this.assets.get(n.id).loadingOre=loadingOre;
    rigExcavator(this,this.assets.get(n.id));
  }
  createCrusherFacility(n){
    const dir=this.nodeDirection(n.id);
    const root=new Group();root.position.set(n.x,(n.elevation||0)+1.0,n.z);root.rotation.y=dir.rot;
    // compatibility marker: this.modelCache.crusher?.clone(true) was replaced by a custom grounded crusher assembly.
    const steel=(c=0x5f6d72,r=.82,m=.14)=>new MeshStandardMaterial({color:c,roughness:r,metalness:m});
    const cargoMaterial=new MeshStandardMaterial({color:0x7c6049,roughness:1});

    const receiveDeck=new Mesh(new BoxGeometry(18,.6,12),steel(0x647177,.95,.06));receiveDeck.position.set(-16,6.0,0);root.add(receiveDeck);
    const receiveWallL=new Mesh(new BoxGeometry(18,2.2,.8),steel(0x7d8a90,.86,.12));receiveWallL.position.set(-16,7.0,5.6);root.add(receiveWallL);
    const receiveWallR=receiveWallL.clone();receiveWallR.position.z=-5.6;root.add(receiveWallR);
    const receiveLip=new Mesh(new BoxGeometry(2.2,1.6,12),steel(0xc89b54,.72,.16));receiveLip.position.set(-24,6.9,0);root.add(receiveLip);
    const feedRamp=new Mesh(new BoxGeometry(11,1.2,9),steel(0x3b474d,.9,.08));feedRamp.position.set(-8,4.9,0);feedRamp.rotation.z=-.38;root.add(feedRamp);
    const hopper=new Mesh(new BoxGeometry(8,6.2,9.4),steel(0x49575d,.84,.12));hopper.position.set(-10,3.0,0);root.add(hopper);
    const hopperFill=new Mesh(new IcosahedronGeometry(3.8,1),cargoMaterial);hopperFill.position.set(-11.5,5.0,0);hopperFill.scale.set(1.4,.18,1.1);root.add(hopperFill);

    const crusherBase=new Mesh(new BoxGeometry(12,8,10),steel(0x53636a,.78,.16));crusherBase.position.set(2,4.2,0);root.add(crusherBase);
    const crusherMouth=new Mesh(new BoxGeometry(5.2,4.2,6.2),steel(0x25323a,1,0));crusherMouth.position.set(-1.2,3.6,0);root.add(crusherMouth);
    const jawHousing=new Mesh(new BoxGeometry(6.4,5.2,7.2),steel(0x6c7b81,.8,.18));jawHousing.position.set(3.2,5.8,0);jawHousing.rotation.z=.08;root.add(jawHousing);
    const jaw=new Mesh(new BoxGeometry(4.6,2.8,4.5),steel(0x2b3439,.92,.06));jaw.position.set(1.4,3.3,0);jaw.rotation.z=-.12;root.add(jaw);
    const chute=new Mesh(new BoxGeometry(6,1.2,6),steel(0x405159,.88,.1));chute.position.set(8,2.5,0);chute.rotation.z=-.35;root.add(chute);

    const supportGroup=new Group();root.add(supportGroup);
    const beltTrack=new Group();beltTrack.position.set(23,3.8,0);beltTrack.rotation.z=.30;root.add(beltTrack);
    const belt=new Mesh(new BoxGeometry(38,1.5,7.2),steel(0x263238,1,0));beltTrack.add(belt);
    const stripes=[];for(let i=0;i<12;i++){const m=new Mesh(new BoxGeometry(1.0,.16,6.3),new MeshStandardMaterial({color:0xe3ae59,roughness:.9}));m.position.y=.82;beltTrack.add(m);stripes.push(m);}    
    const rollers=[];for(let i=0;i<6;i++){const m=new Mesh(new BoxGeometry(1.2,1.2,6.8),steel(0x7c8c94,.6,.28));m.position.set(-15+i*6.1,0,0);beltTrack.add(m);rollers.push(m);}    
    const railL=new Mesh(new BoxGeometry(38,1.5,.7),steel(0x5e6f74,.84,.12));railL.position.set(0,.92,3.6);beltTrack.add(railL);
    const railR=railL.clone();railR.position.z=-3.6;beltTrack.add(railR);
    for(let i=0;i<3;i++){
      const tower=new Group();tower.position.set(-10+i*13,-2.0,0);beltTrack.add(tower);
      const leg1=new Mesh(new BoxGeometry(.8,6.6,.8),steel(0x748187,.86,.1));leg1.position.set(-1.7,0,2.1);tower.add(leg1);
      const leg2=leg1.clone();leg2.position.z=-2.1;tower.add(leg2);
      const leg3=leg1.clone();leg3.position.x=1.7;tower.add(leg3);
      const leg4=leg2.clone();leg4.position.x=1.7;tower.add(leg4);
      const topBeam=new Mesh(new BoxGeometry(5.2,.7,5.0),steel(0x748187,.86,.1));topBeam.position.set(0,3.1,0);tower.add(topBeam);
    }
    const dischargeBox=new Mesh(new BoxGeometry(8,4.2,7.6),steel(0x42555d,.84,.12));dischargeBox.position.set(46,1.2,0);root.add(dischargeBox);
    const stockpile=new Mesh(new IcosahedronGeometry(4.4,1),cargoMaterial);stockpile.position.set(50,.6,0);stockpile.scale.set(1.7,.55,1.25);root.add(stockpile);

    const ore=[];
    for(let i=0;i<10;i++){
      const stone=new Mesh(new IcosahedronGeometry(1.0+(i%3)*.2,1),cargoMaterial);
      stone.scale.set(1.45,.62,1.08);stone.visible=false;
      beltTrack.add(stone);ore.push(stone);
    }
    const dumpStream=[];
    for(let i=0;i<10;i++){
      const piece=new Mesh(new IcosahedronGeometry(1.0+(i%3)*.16,0),cargoMaterial);
      piece.visible=false;this.fxGroup.add(piece);dumpStream.push(piece);
    }
    const dustGeo=new BufferGeometry();dustGeo.setAttribute('position',new Float32BufferAttribute(new Float32Array(90*3),3));
    const dust=new Points(dustGeo,new PointsMaterial({color:0xcdb9a2,opacity:.18,transparent:true,size:2.0,depthWrite:false}));dust.visible=false;root.add(dust);
    this.facilityGroup.add(root);
    const asset={kind:'crusher',root,node:n,jaw,jawBaseY:jaw.position.y,jawBaseRot:jaw.rotation.y,stripes,rollers,ore,dumpStream,hopperFill,dust,beltTrack,beltOrigin:{x:23,y:3.8,z:0},supportGroup,conveyorBaseY:3.8,receiveLocal:new Vector3(-16,6.2,0)};
    this.assets.set(n.id,asset);
    this.facilityRoots.set(n.id,root);
    this.placeFacilityOnTerrain(root,n,{searchRadius:6,clearance:.08,step:3,preferDistance:.03});
    this.rebuildCrusherSupports(asset);
  }
  addSupportLeg(root,group,x,z,topY,heightHint=1.0,width=1.0,color=0x6f7678){
    const topWorld=root.localToWorld(new Vector3(x,topY,z));
    const ground=this.groundHeight(topWorld.x,topWorld.z);
    const h=Math.max(0.45,topWorld.y-ground);
    const leg=new Mesh(new BoxGeometry(width,h,width),new MeshStandardMaterial({color,roughness:.9,metalness:.08}));
    const center=root.worldToLocal(new Vector3(topWorld.x,ground+h/2,topWorld.z));
    leg.position.copy(center);group.add(leg);
    const foot=new Mesh(new BoxGeometry(width*1.7,0.22,width*1.7),new MeshStandardMaterial({color:0x807f77,roughness:1}));
    const footCenter=root.worldToLocal(new Vector3(topWorld.x,ground+0.11,topWorld.z));
    foot.position.copy(footCenter);group.add(foot);
  }
  rebuildCrusherSupports(asset){
    if(!asset?.supportGroup)return;
    const g=asset.supportGroup;
    while(g.children.length)g.remove(g.children[0]);
    const baseTop=0.9;
    for(const [x,z] of [[-18,-5],[-18,5],[-9,-5],[-9,5],[-1,-4],[-1,4],[8,-4],[8,4]])this.addSupportLeg(asset.root,g,x,z,baseTop,1.0,1.1);
    for(const x of [18,31,44]){
      this.addSupportLeg(asset.root,g,x,-2,asset.conveyorBaseY||3.8,1.0,0.85,0x717b7f);
      this.addSupportLeg(asset.root,g,x,2,asset.conveyorBaseY||3.8,1.0,0.85,0x717b7f);
    }
  }
  modelBounds(obj){
    obj.updateMatrixWorld(true);
    const min={x:Infinity,y:Infinity,z:Infinity},max={x:-Infinity,y:-Infinity,z:-Infinity};
    obj.traverse(o=>{
      if(!o.geometry)return;
      o.geometry.computeBoundingBox?.();
      const bb=o.geometry.boundingBox;if(!bb)return;
      for(const x of [bb.min.x,bb.max.x])for(const y of [bb.min.y,bb.max.y])for(const z of [bb.min.z,bb.max.z]){
        const v=new Vector3(x,y,z).applyMatrix4(o.matrixWorld);
        if(v.x<min.x)min.x=v.x;if(v.y<min.y)min.y=v.y;if(v.z<min.z)min.z=v.z;
        if(v.x>max.x)max.x=v.x;if(v.y>max.y)max.y=v.y;if(v.z>max.z)max.z=v.z;
      }
    });
    if(!isFinite(min.x))return {minx:0,miny:0,minz:0,maxx:1,maxy:1,maxz:1};
    return {minx:min.x,miny:min.y,minz:min.z,maxx:max.x,maxy:max.y,maxz:max.z};
  }
  fitModel(model,{width=40,depth=30,height=18,offsetX=0,offsetY=0,offsetZ=0,spin=0}={}){
    const inst=model.clone(true);
    inst.rotation.y+=spin;
    let b=this.modelBounds(inst);
    const sx=Math.max(.001,b.maxx-b.minx),sy=Math.max(.001,b.maxy-b.miny),sz=Math.max(.001,b.maxz-b.minz);
    const scale=Math.min(width/sx,depth/sz,height/sy);
    inst.scale.multiplyScalar(scale);
    b=this.modelBounds(inst);
    inst.position.x+=-(b.minx+b.maxx)/2+offsetX;
    inst.position.y+=-b.miny+offsetY;
    inst.position.z+=-(b.minz+b.maxz)/2+offsetZ;
    inst.updateMatrixWorld(true);
    return inst;
  }

  // The old workshop GLB was shifted independently of its simulation node.
  // A small, open-front bay stays near that node and has deterministic parking
  // positions for the active service job and the waiting queue.
  createWorkshopFacility(n){
    const root=new Group();root.name='functional-service-hangar';
    // The bay entrance faces the REAL workshop road node, not an arbitrary first graph edge.
    // Candidates are scored on levelness AND grade of the entrance lane; this keeps
    // trucks out of the steep overhangs shown in the old version.
    const footprint={rot:0,lminx:-23,lmaxx:24,lminz:-14,lmaxz:14,miny:0};
    // On Saryarka the old automatically placed hangar intersected the fuel
    // station and a haul road. The marked clear bench is farther south of the
    // crushers; keep the visual site independent of the logical road node.
    const markedHangar=this.map?.id==='saryarka'?{x:220,z:285}:null;
    let best=null;
    if(markedHangar){
      for(const [ox,oz] of [[0,0],[-5,0],[5,0],[0,-5],[0,5],[-8,-6],[8,6]]){
        const x=markedHangar.x+ox,z=markedHangar.z+oz;
        const rot=Math.atan2(-(z-n.z),x-n.x);
        const site=this.evaluateFacilitySite({...footprint,rot},x,z);
        const targetDistance=Math.hypot(ox,oz);
        const score=site.range*35+targetDistance*.45;
        if(!best||score<best.score)best={x,z,rot,score,maxGrade:0,entranceGap:Math.hypot(n.x-x,n.z-z),...site};
      }
    }
    if(!markedHangar)for(const radius of [30,36,42])for(let angle=0;angle<Math.PI*2;angle+=Math.PI/12){
      const dx=Math.cos(angle)*radius,dz=Math.sin(angle)*radius;
      const x=n.x+dx,z=n.z+dz,rot=Math.atan2(-dz,dx);
      const prof={...footprint,rot};
      const site=this.evaluateFacilitySite(prof,x,z);
      const gateX=x-30*Math.cos(rot),gateZ=z+30*Math.sin(rot);
      const gap=Math.hypot(gateX-n.x,gateZ-n.z);
      let maxGrade=0,last=this.groundHeight(n.x,n.z),prevX=n.x,prevZ=n.z;
      for(let i=1;i<=12;i++){
        const u=i/12,px=mix(n.x,gateX,u),pz=mix(n.z,gateZ,u);
        const y=this.groundHeight(px,pz),dr=Math.hypot(px-prevX,pz-prevZ);
        maxGrade=Math.max(maxGrade,Math.abs(y-last)/Math.max(.2,dr));
        last=y;prevX=px;prevZ=pz;
      }
      const score=site.range*48+maxGrade*450+gap*1.8+radius*.12 + Math.max(0,site.range-8)*150 + Math.max(0,maxGrade-.20)*3000;
      if(!best||score<best.score)best={x,z,rot,score,maxGrade,entranceGap:gap,...site};
    }
    root.rotation.y=best.rot;
    root.position.set(best.x,best.low+(best.mean-best.low)*.55+.08,best.z);
    root.userData.siteRange=best.range;
    root.userData.accessGrade=best.maxGrade;
    root.userData.accessGap=best.entranceGap;
    root.userData.workshopNode=n.id;
    const metal=(color=0x63747d)=>new MeshStandardMaterial({color,roughness:.82,metalness:.12});
    const wall=metal(0x697781),roofMat=metal(0x485a66),frame=metal(0xb49e72);
    const addBox=(w,h,d,x,y,z,mat,parent=root)=>{const m=new Mesh(new BoxGeometry(w,h,d),mat);m.position.set(x,y,z);parent.add(m);return m;};
    // One clear entrance is on local -X. No front wall/door blocks the rig.
    addBox(46,12,1.2,1,6.2,-14,wall);
    addBox(46,12,1.2,1,6.2,14,wall);
    addBox(1.3,12,29,24,6.2,0,wall);
    addBox(49,1.2,30,1,13,0,roofMat);
    for(const z of [-14,14])addBox(1.1,13,1.1,-23,6.5,z,frame);
    addBox(1.1,13,1.1,23,6.5,0,frame);
    addBox(1.0,3,30,-23,13,0,frame);
    addBox(12,.18,.45,-11,.16,-9,new MeshBasicMaterial({color:0xf3c55f}));
    addBox(12,.18,.45,-11,.16,9,new MeshBasicMaterial({color:0xf3c55f}));
    // Narrow earth-coloured apron, not the old floating grey foundation.
    const apron=addBox(24,.18,24,-34,.04,0,metal(0x8a7b65));apron.receiveShadow=true;
    // A diagnostic lamp over the active repair station.
    addBox(7,.55,1.1,3,11,0,new MeshBasicMaterial({color:0x80efb0}));
    // Small isolated workshop tools: leave the truck lane free.
    addBox(7,4,3,12,2,10,metal(0xb68e52));
    addBox(7,4,3,12,2,-10,metal(0x6a858e));
    this.facilityGroup.add(root);
    root.updateMatrixWorld(true);
    // Compacted earth mesh follows the scan outside the bay footprint,
    // closing the under-floor air gap without a large floating concrete cube.
    if(this.cameraTerrain){
      const v=[],idx=[],nx=26,nz=18;
      const toWorld=(x,z)=>root.localToWorld(new Vector3(x,0,z));
      for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){
        const x=-30+ix*58/nx,z=-21+iz*42/nz,q=toWorld(x,z);
        const localGround=this.groundHeight(q.x,q.z)-root.position.y;
        const outside=Math.max(Math.abs(x)-22,Math.abs(z)-13,0);
        const blend=clamp(outside/8,0,1);
        const y=mix(0,localGround-.08,blend*blend*(3-2*blend));
        v.push(x,y,z);
        if(ix<nx&&iz<nz){const a=iz*(nx+1)+ix,b=a+nx+1;idx.push(a,b,a+1,a+1,b,b+1);}
      }
      const geo=new BufferGeometry();geo.setAttribute('position',new Float32BufferAttribute(v,3));geo.setIndex(idx);geo.computeVertexNormals();
      const fill=new Mesh(geo,new MeshStandardMaterial({color:0x8b7968,roughness:1,side:DoubleSide}));fill.name='terrain-graded-workshop-ground';fill.receiveShadow=true;root.add(fill);
    }
    // A short terrain-following access lane joins the road node to the entrance.
    // The garage is rotated toward the node so the lane does not cut across a cliff.
    const entrance=root.localToWorld(new Vector3(-30,0,0));
    // The relocated workshop is well off the haul road: draw only the short
    // local apron, rather than a 100m decorative strip across the active pit.
    const fullDX=entrance.x-n.x,fullDZ=entrance.z-n.z;
    const fullDist=Math.hypot(fullDX,fullDZ)||1;
    const spurLength=markedHangar?Math.min(20,fullDist):fullDist;
    const startX=entrance.x-fullDX/fullDist*spurLength;
    const startZ=entrance.z-fullDZ/fullDist*spurLength;
    const dx=entrance.x-startX,dz=entrance.z-startZ,length=Math.hypot(dx,dz)||1;
    const across={x:-dz/length,z:dx/length};
    const strip=[],faces=[],sections=12;
    for(let i=0;i<=sections;i++){
      const u=i/sections,cx=mix(startX,entrance.x,u),cz=mix(startZ,entrance.z,u);
      for(const side of [-1,1]){
        const x=cx+across.x*side*5,z=cz+across.z*side*5;
        strip.push(x,this.groundHeight(x,z)+.095,z);
      }
      if(i<sections){const a=i*2;faces.push(a,a+2,a+1,a+1,a+2,a+3);}
    }
    const laneGeo=new BufferGeometry();laneGeo.setAttribute('position',new Float32BufferAttribute(strip,3));laneGeo.setIndex(faces);laneGeo.computeVertexNormals();
    const lane=new Mesh(laneGeo,new MeshStandardMaterial({color:0x947f68,roughness:1,side:DoubleSide}));lane.name='workshop-access-lane';lane.receiveShadow=true;this.facilityGroup.add(lane);
    this.facilityRoots.set(n.id,root);
    this.workshopBay={root,node:n,frontX:-23,insideX:0,queueX:-44,siteRange:best.range};
  }
  serviceWorldPosition(localX,localZ){
    if(!this.workshopBay)return null;
    const w=this.workshopBay.root.localToWorld(new Vector3(localX,0,localZ));
    // The bay is graded; exterior staging places use the actual quarry scan.
    w.y=localX>=-23?this.workshopBay.root.position.y+1.35:this.groundHeight(w.x,w.z)+1.35;
    return w;
  }
  serviceTargets(snap){
    if(!this.workshopBay)return new Map();
    const units=snap.fleet.filter(t=>t.status==='repairing'&&t.target===this.workshopBay.node.id);
    const active=units.find(t=>t.serviceActive)||units[0];
    const waiting=units.filter(t=>t!==active).sort((a,b)=>a.id.localeCompare(b.id));
    const out=new Map();
    if(active){
      const phase=clamp((active.serviceElapsedSeconds||0)/10,0,1);
      const x=mix(-28,2,phase*phase*(3-2*phase));
      out.set(active.id,{position:this.serviceWorldPosition(x,0),inside:true});
    }
    waiting.forEach((t,i)=>{
      const q=Math.floor(i/2),lane=i%2===0?-8:8;
      out.set(t.id,{position:this.serviceWorldPosition(-49-q*25,lane),inside:false});
    });
    return out;
  }
  createStaticFacility(n){
    const dir=this.nodeDirection(n.id);
    // Saryarka: keep the visual parking lot and weighbridge on separate open
    // ground south of the crushers, not on a live haul road or under other buildings.
    // Graph nodes deliberately remain unchanged to preserve routing/simulation.
    const relocation=this.map?.id==='saryarka'?{
      fuel:{x:125,z:255},
      depot:{x:-40,z:330},
      weigh:{x:240,z:390}
    }[n.kind]:null;
    const root=new Group();
    root.position.set(relocation?.x??n.x,(n.elevation||0)+1.0,relocation?.z??n.z);
    // Fixed, terrain-checked orientation for the independent service pads;
    // old routing-side rotation is retained for unchanged facilities.
    root.rotation.y=relocation?(n.kind==='fuel'?Math.atan2(n.z-root.position.z,root.position.x-n.x):0):dir.rot;
    const add=(key,opts)=>{if(this.modelCache[key])root.add(key==='modular'?fitModularBuilding(this,this.modelCache[key],opts):this.fitModel(this.modelCache[key],opts));};
    const paint=(c,r=.9,m=.08)=>new MeshStandardMaterial({color:c,roughness:r,metalness:m});
    if(n.kind==='refuge')return; // dead-end shelter removed from the rendered scene
    if(n.kind==='fuel'){
      // BUILD 5242: Sketchfab gas-station.glb includes an entire shop placed
      // thousands of GLB units away from the canopy. Fitting the combined
      // bounds shrank BOTH to a few metres (the white miniature in the UI).
      // Recover its THREE actual textured meshes at their world transforms,
      // then fit the canopy and the shop independently at useful site sizes.
      const prefab=this.modelCache.gasStation;
      const subsection=(startsWith)=>{
        if(!prefab)return null;
        prefab.updateMatrixWorld(true);
        const subset=new Group();
        prefab.traverse(obj=>{
          if(!obj.isMesh||!startsWith.some(prefix=>obj.name.startsWith(prefix)))return;
          const part=obj.clone(false);
          obj.matrixWorld.decompose(part.position,part.quaternion,part.scale);
          part.castShadow=true;part.receiveShadow=true;
          subset.add(part);
        });
        return subset.children.length?subset:null;
      };
      const canopy=subsection(['gas.station.baked.002_','gas.station.cubes.002_']);
      const shop=subsection(['gas.store.baked.002_']);
      if(canopy)root.add(this.fitModel(canopy,{width:62,depth:36,height:18,offsetX:10,offsetY:.65,offsetZ:-12}));
      if(shop){
        // The detached imported shop has an extremely elongated native aspect
        // ratio. Normalize each dimension so it looks like a full-sized mine
        // service building, not a flat miniature beside the canopy.
        const fitted=this.fitModel(shop,{width:22,depth:16,height:10});
        let bounds=this.modelBounds(fitted);
        fitted.scale.set(
          fitted.scale.x*22/Math.max(.001,bounds.maxx-bounds.minx),
          fitted.scale.y*9/Math.max(.001,bounds.maxy-bounds.miny),
          fitted.scale.z*15/Math.max(.001,bounds.maxz-bounds.minz)
        );
        bounds=this.modelBounds(fitted);
        fitted.position.set(-29-(bounds.minx+bounds.maxx)/2,.65-bounds.miny,29-(bounds.minz+bounds.maxz)/2);
        root.add(fitted);
      }
      // A level concrete forecourt makes the expanded buildings legible above
      // the uneven mine terrain, without modifying the routing graph.
      const slab=new Mesh(new BoxGeometry(86,.85,78),paint(0x85827b,1,0));
      slab.position.set(0,.18,2);slab.receiveShadow=true;root.add(slab);
      // Enlarged isolated auxiliary fuel module stays clear of the canopy,
      // and no longer coincides with the separately positioned shop.
      if(this.modelCache.fuel)root.add(this.fitModel(this.modelCache.fuel,{width:20,depth:16,height:12,offsetX:25,offsetY:.65,offsetZ:29}));
      // Offline fallback: always show the enlarged station if the GLB fails.
      if(!canopy){
        const roof=new Mesh(new BoxGeometry(60,1.5,33),paint(0xe7b742,.78,.14));
        roof.position.set(10,11,-12);root.add(roof);
        for(const x of [-14,34])for(const z of [-24,0]){
          const pillar=new Mesh(new BoxGeometry(1.0,10,1.0),paint(0x87949b,.65,.22));
          pillar.position.set(x,5.5,z);root.add(pillar);
        }
        for(const x of [-7,10,27]){
          const pump=new Mesh(new BoxGeometry(2.5,3.5,2.4),paint(0xd7ae48,.8,.15));
          pump.position.set(x,2.2,-12);root.add(pump);
        }
      }
      if(!shop){const cabin=new Mesh(new BoxGeometry(22,10,16),paint(0x7b8587,.83,.12));cabin.position.set(-29,5.5,29);root.add(cabin);}
    } else if(n.kind==='workshop'){
      const pad=new Mesh(new BoxGeometry(62,.8,44),paint(0x8c8b82,1,0));pad.position.set(0,.25,0);pad.receiveShadow=true;root.add(pad);
      const canopy=new Mesh(new BoxGeometry(26,1.1,16),paint(0x6b767d,.82,.16));canopy.position.set(-10,8,0);root.add(canopy);
      for(const x of [-20,0])for(const z of [-5,5]){const leg=new Mesh(new BoxGeometry(.9,7.4,.9),paint(0x6e767a,.86,.12));leg.position.set(x,4.0,z);root.add(leg);}      
      add('modular',{width:22,depth:18,height:11,offsetX:22,offsetZ:-12,spin:Math.PI/2});
      add('warehouse',{width:22,depth:18,height:12,offsetX:18,offsetZ:14,spin:Math.PI/2});
    } else if(n.kind==='depot') {
      const lot=new Mesh(new BoxGeometry(76,.7,48),paint(0x7e7a73,1,0));lot.position.set(0,.2,0);lot.receiveShadow=true;root.add(lot);
      for(let i=0;i<6;i++){const stripe=new Mesh(new BoxGeometry(12,.08,.45),paint(0xd8d8d0,1,0));stripe.position.set(-18+i*7,.55,14);root.add(stripe);const stripe2=stripe.clone();stripe2.position.z=-14;root.add(stripe2);}      
      add('modular',{width:24,depth:18,height:11,offsetX:24,offsetZ:0,spin:Math.PI/2});
      add('warehouse',{width:26,depth:18,height:11,offsetX:-24,offsetZ:0,spin:Math.PI/2});
    } else if(n.kind==='power') {
      add('substation',{width:44,depth:30,height:18,spin:Math.PI/2});
    } else if(n.kind==='weigh') {
      // Thin, drive-through scale along the terminal spur, with an office offset from the lane.
      const bridge=new Mesh(new BoxGeometry(24,.45,9),paint(0x878b89,1,0));bridge.position.set(0,.25,0);bridge.receiveShadow=true;root.add(bridge);
      for(const z of [-4.6,4.6]){
        const rim=new Mesh(new BoxGeometry(23,.5,.45),paint(0xc7b885,1,0));rim.position.set(0,.52,z);root.add(rim);
      }
      const office=new Mesh(new BoxGeometry(7,5.5,6),paint(0x60717b,.83,.12));office.position.set(5,2.8,-9);root.add(office);
      const roof=new Mesh(new BoxGeometry(8,.45,7),paint(0x394b53,.8,.12));roof.position.set(5,5.9,-9);root.add(roof);
    } else {
      const box=new Mesh(new BoxGeometry(24,12,18),new MeshStandardMaterial({color:0x53626d,roughness:.84}));box.position.set(0,6,0);root.add(box);
    }
    this.placeFacilityOnTerrain(root,n,{searchRadius:relocation?0:n.kind==='weigh'?0:12,clearance:n.kind==='fuel'?0.55:0.06,step:6,preferDistance:n.kind==='depot'?0.035:0.05});
    this.facilityGroup.add(root);this.facilityRoots.set(n.id,root);
  }
  buildMachines(){
    this.clearGroup(this.machineGroup);this.trucks.clear();
    if(!this.snap)return;
    for(const truck of this.snap.fleet){
      const root=new Group();root.name=truck.id;
      let visual=this.modelCache.truck?.clone(true);
      if(visual){visual.scale.setScalar(2.70);visual.rotation.y=Math.PI/2;root.add(visual);} else {visual=this.makeFallbackTruck(root);}
      const wheels=[],bed=[];root.traverse(o=>{if(!o.isMesh&&o.parent?.name!==o.name){if(/^wheel-pivot-[1-6]$/.test(o.name))wheels.push(o);if(o.name==='dump-bed-pivot')bed.push(o);}});
      const wheelBases=wheels.map(o=>o.rotation.x),bedBases=bed.map(o=>o.rotation.x);if(wheels.length!==6||bed.length!==1)console.warn(truck.id+': wheel rig incomplete',wheels.length,bed.length);
      const ore=new Group();ore.visible=false;root.add(ore);
      for(let i=0;i<10;i++){const stone=new Mesh(new IcosahedronGeometry(.85,0),new MeshStandardMaterial({color:0x8e7559,roughness:1}));stone.scale.setScalar(.35+(i%5)*.1);stone.position.set(-3+(i%4)*1.5,5.3+Math.floor(i/4)*1.1,-3.8);ore.add(stone);}      
      this.machineGroup.add(root);
      this.trucks.set(truck.id,{root,visual,wheels,bed,wheelBases,bedBases,ore,lastX:truck.position.x,lastZ:truck.position.z,wheelAngle:0,dumpLift:0,actualTravel:0,payload:truck.payload,status:truck.status,speed:truck.speed||0});
      rigTruck(this.trucks.get(truck.id));
    }
  }
  makeFallbackTruck(root){const g=new Group();root.add(g);const a=new Mesh(new BoxGeometry(18,6,10),new MeshStandardMaterial({color:0xc79f52,roughness:.8}));a.position.set(0,6,0);g.add(a);const b=new Mesh(new BoxGeometry(7,6,9),new MeshStandardMaterial({color:0x40535f,roughness:.78}));b.position.set(6,10,0);g.add(b);for(const x of [-6,6])for(const z of [-4.5,4.5]){const w=new Mesh(new BoxGeometry(4,4,2.2),new MeshStandardMaterial({color:0x212629,roughness:.92}));w.position.set(x,2,z);g.add(w);}return g;}
  makeFallbackExcavator(root){const g=new Group();root.add(g);const a=new Mesh(new BoxGeometry(16,6,11),new MeshStandardMaterial({color:0xd4a452,roughness:.75}));a.position.set(0,6,0);g.add(a);const b=new Mesh(new BoxGeometry(20,3,3),new MeshStandardMaterial({color:0xd4a452,roughness:.75}));b.position.set(-12,15,0);b.rotation.z=-.35;g.add(b);return g;}
  makeFallbackCrusher(root){const g=new Group();root.add(g);const a=new Mesh(new BoxGeometry(32,18,18),new MeshStandardMaterial({color:0x50626b,roughness:.82}));a.position.set(28,10,12);g.add(a);return g;}
  update(snap){
    this.snap=snap;
    this.blastVisual?.update(snap);
    if(this.map && (this.trucks.size===0||this.trucks.size!==snap.fleet.length))this.buildMachines();
    const blocked=new Set(snap.blocked||[]);
    for(const seg of this.roadSegments){
      const service=/^(S|E0[789]|E13)/.test(seg.id);
      const hazard=blocked.has(seg.id)||(seg.id==='RAMP-04'&&snap.geology.fs<1.05);
      const slow=!hazard&&(seg.edge.speedLimit<=8||((snap.flags.rain||snap.flags.potholes)&&seg.id.startsWith('RAMP')));
      const col=hazard?'#ff5260':seg.gradeReview?'#edb44d':slow?'#ffbf49':service?'#46c9ff':'#34dda0';
      seg.mat.color.set(col);seg.mat.opacity=hazard?.90:slow?.12:0;
    }
    const servicePositions=this.serviceTargets(snap);
    for(const t of snap.fleet){
      const entity=this.trucks.get(t.id);if(!entity)continue;const p=t.position;
      const service=servicePositions.get(t.id);
      if(entity.previousStatus==='repairing'&&t.status!=='repairing'&&this.workshopBay){
        entity.serviceExit={start:snap.time,from:entity.root.position.clone(),gate:this.serviceWorldPosition(-29,0)};
      }
      entity.previousStatus=t.status;
      const travelPosition={x:p.x,y:this.groundHeight(p.x,p.z)+1.35,z:p.z};
      let stagedPosition=service?{...service.position}:travelPosition;
      if(!service&&entity.serviceExit){
        const age=Math.max(0,snap.time-entity.serviceExit.start);
        const exit=entity.serviceExit;
        if(age<5){
          const half=clamp(age/2.5,0,1),finish=clamp((age-2.5)/2.5,0,1);
          const a=half<1?exit.from.clone().lerp(exit.gate,half):exit.gate.clone().lerp(new Vector3(travelPosition.x,travelPosition.y,travelPosition.z),finish);
          stagedPosition={x:a.x,y:a.y,z:a.z};
        }else entity.serviceExit=null;
      }
      entity.pendingPosition=stagedPosition;
      const dx=p.x-entity.lastX,dz=p.z-entity.lastZ;const travel=Math.hypot(dx,dz);
      if(travel>.005){entity.root.rotation.y=-Math.atan2(dz,dx);entity.wheelAngle+=travel/2.83;}
      if(service&&this.workshopBay){entity.serviceHeading=this.workshopBay.root.rotation.y;entity.serviceMode=true;}else entity.serviceMode=false;
      entity.lastX=p.x;entity.lastZ=p.z;entity.payload=t.payload;entity.status=t.status;entity.speed=t.speed||0;entity.actualTravel=travel;

    }
    this.resolveTruckSpacing();
    if(this.trackedTruck){
      const tracked=this.trucks.get(this.trackedTruck);
      if(tracked){const target=tracked.root.position.clone();target.y+=9;const shift=target.sub(this.controls.target);this.controls.target.add(shift);this.camera.position.add(shift);}
    }
    const raining=!!snap.flags.rain,foggy=!!snap.flags.fog,hot=!!snap.flags.heat,sliding=snap.geology.failed || snap.geology.fs<.9;
    this.scenarioTarget={wetness:raining?1:0,fog:foggy?1:(raining?.45:0),heat:hot?1:0,slide:sliding?1:0};
    this.rainClouds.visible=raining;
    // Smooth transitions are applied in tickParticles instead of snapping colors.
    this.dust.visible=!foggy&&!hot&&(snap.metrics.dust>60||sliding);
    if(this.puddleGroup)this.puddleGroup.visible=true;
    if(this.slideDebrisGroup)this.slideDebrisGroup.visible=true;
    const w=snap.metrics.weatherImpact;
    if(this.weatherHud){
      const active=foggy||hot;
      this.weatherHud.style.display=active?'block':'none';
      if(active&&w){
        const label=foggy&&hot?'ТУМАН + ЖАРА':foggy?'ТУМАН':'ЖАРА';
        this.weatherHud.textContent=`${label} · видимость ${w.visibilityPct}% · транспорт ${w.transportPct}% · погрузка ${w.loadingPct}% · дробление ${w.crushingPct}% · воздух ${w.ambientC}°C`;
      }
    }
  }
  resolveTruckSpacing(){
    // Imported haul roads have several intersecting corridors and service nodes.
    // Resolve proximity of DISPLAY meshes without altering ore/fuel physics,
    // snapping routes or creating permanent simulator deadlocks.
    const rigs=[...this.trucks.entries()].filter(([,v])=>v.pendingPosition);
    const desired=rigs.map(([,v])=>({...v.pendingPosition}));
    const gap=15.4;
    for(let iter=0;iter<12;iter++){
      let adjustments=0;
      for(let i=0;i<desired.length;i++)for(let j=0;j<i;j++){
        const a=desired[i],b=desired[j];
        if(Math.abs(a.y-b.y)>9)continue;
        const dx=a.x-b.x,dz=a.z-b.z,dist=Math.hypot(dx,dz);
        if(dist>=gap)continue;
        const seed=(i+1)*1.71+(j+1)*2.39;
        const ux=dist>.0001?dx/dist:Math.cos(seed),uz=dist>.0001?dz/dist:Math.sin(seed);
        const correction=(gap-dist)*.52;
        // Queuing/loading trucks keep their dedicated bay more closely.
        const fixedI=rigs[i][1].serviceMode||['loading','dumping','repairing','refueling'].includes(rigs[i][1].status);
        const fixedJ=rigs[j][1].serviceMode||['loading','dumping','repairing','refueling'].includes(rigs[j][1].status);
        const ai=fixedI&&!fixedJ?.22:fixedJ&&!fixedI?.78:.5;
        const aj=1-ai;
        a.x+=ux*correction*2*ai;a.z+=uz*correction*2*ai;
        b.x-=ux*correction*2*aj;b.z-=uz*correction*2*aj;
        adjustments++;
      }
      if(!adjustments)break;
    }
    for(let i=0;i<rigs.length;i++){
      const [,rig]=rigs[i],raw=rig.pendingPosition,p=desired[i];
      // Bound the offset to the industrial shoulder, not another distant road.
      const dx=p.x-raw.x,dz=p.z-raw.z,d=Math.hypot(dx,dz);
      const maxOffset=this.visualRoads?.size?4.5:22;
      if(d>maxOffset){p.x=raw.x+dx*maxOffset/d;p.z=raw.z+dz*maxOffset/d;}
      if(rig.serviceMode){p.x=raw.x;p.z=raw.z;p.y=raw.y;}
      else if(typeof this.groundHeight==='function')p.y=this.groundHeight(p.x,p.z)+1.35;
      if(!rig.separationInitialized){rig.root.position.set(p.x,p.y,p.z);rig.separationInitialized=true;}
      else if(rig.detail)rig.detail.targetPosition=new Vector3(p.x,p.y,p.z);
      else rig.root.position.lerp(new Vector3(p.x,p.y,p.z),.63);
    }
  }
  truckPosition(id){return this.trucks.get(id)?.root.position||null;}
  makeRain(){const N=1150,centers=new Float32Array(N*3),verts=new Float32Array(N*18),speed=new Float32Array(N);for(let i=0;i<N;i++){centers[i*3]=(Math.random()-.5)*2300;centers[i*3+1]=50+Math.random()*520;centers[i*3+2]=(Math.random()-.5)*1800;speed[i]=130+Math.random()*180;}const geo=new BufferGeometry();geo.setAttribute('position',new Float32BufferAttribute(verts,3));const rain=new Mesh(geo,new MeshBasicMaterial({color:0xc4e6ff,transparent:true,opacity:.42,side:DoubleSide,depthWrite:false}));rain.visible=false;rain.centers=centers;rain.fallSpeeds=speed;this.scene.add(rain);return rain;}
  softDot(){if(this._dot)return this._dot;const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d'),g=x.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.5,'rgba(255,255,255,.35)');g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(0,0,64,64);return this._dot=new CanvasTexture(c);}
  makeDust(){const N=220,arr=new Float32Array(N*3),geo=new BufferGeometry();geo.setAttribute('position',new Float32BufferAttribute(arr,3));const pts=new Points(geo,new PointsMaterial({map:this.softDot(),alphaTest:.02,color:0xd2b693,transparent:true,opacity:.28,size:7,sizeAttenuation:true,depthWrite:false}));pts.visible=false;this.scene.add(pts);return pts;}
  makeLandslide(){const N=260,arr=new Float32Array(N*3),geo=new BufferGeometry();geo.setAttribute('position',new Float32BufferAttribute(arr,3));const pts=new Points(geo,new PointsMaterial({map:this.softDot(),alphaTest:.02,color:0xa89481,transparent:true,opacity:.72,size:3.2,sizeAttenuation:true,depthWrite:false}));pts.visible=false;this.scene.add(pts);return pts;}
  tickParticles(dt){
    const ease=(a,b,r)=>mix(a,b,1-Math.exp(-r*dt));
    this.scenarioState.wetness=ease(this.scenarioState.wetness,this.scenarioTarget.wetness,0.45);
    this.scenarioState.fog=ease(this.scenarioState.fog,this.scenarioTarget.fog,0.65);
    this.scenarioState.heat=ease(this.scenarioState.heat,this.scenarioTarget.heat,0.55);
    this.scenarioState.slide=ease(this.scenarioState.slide,this.scenarioTarget.slide,0.8);
    if(!this.scenarioTarget.wetness&&this.scenarioState.wetness>.02)this.scenarioState.wetness=Math.max(0,this.scenarioState.wetness-dt*0.035);
    if(!this.scenarioTarget.slide&&this.scenarioState.slide>.02)this.scenarioState.slide=Math.max(0,this.scenarioState.slide-dt*0.03);

    if(this.rainClouds.visible){const att=this.rainClouds.geometry.getAttribute('position'),v=att.array,c=this.rainClouds.centers,spd=this.rainClouds.fallSpeeds;for(let i=0;i<spd.length;i++){const base=3*i,vi=18*i;c[base+1]-=dt*spd[i];c[base]+=dt*18;if(c[base+1]<-180){c[base+1]=460+Math.random()*130;c[base]=(Math.random()-.5)*2300;c[base+2]=(Math.random()-.5)*1800;}const x=c[base],y=c[base+1],z=c[base+2],w=.55,len=8.5;v.set([x-w,y+len,z,x+w,y+len,z,x+4.2+w,y,z,x-w,y+len,z,x+4.2+w,y,z,x+4.2-w,y,z],vi);}att.needsUpdate=true;}

    const drift=(obj,scale,cx,cz)=>{if(!obj.visible)return;const att=obj.geometry.getAttribute('position'),arr=att.array;for(let i=0;i<arr.length;i+=3){const t=i/3+this.visualTime*3.7;arr[i]=cx+Math.sin(t*.69)*scale*.52;arr[i+2]=cz+Math.cos(t*.47)*scale*.52;arr[i+1]=Math.sin(t*.31)*10+Math.abs(Math.sin(t*.19))*38;}att.needsUpdate=true;};
    drift(this.dust,240,this.mapBounds?.centerX||0,this.mapBounds?.centerZ||0);

    const wet=this.scenarioState.wetness,fog=this.scenarioState.fog,heat=this.scenarioState.heat,slide=this.scenarioState.slide;
    this.updateWater(dt);
    // Depth fog hides distant objects continuously with depth, without
    // intersecting triangles or particle squares on the quarry surface.
    if(this.scene.fog){
      const rain=this.scenarioState.wetness;
      const near=1200*(1-fog)+38*fog,far=4200*(1-fog)+385*fog;
      this.scene.fog.near=mix(near,Math.min(near,350),rain*.18);
      this.scene.fog.far=mix(far,Math.min(far,1600),rain*.16);
      const cold=new Color('#193142').lerp(new Color('#9eafb8'),fog*.95);
      const hotTint=new Color('#a89879');
      cold.lerp(hotTint,heat*.25*(1-fog));
      this.scene.fog.color.copy(cold);
      if(this.scene.background?.copy)this.scene.background.copy(cold);
    }
    if(this.weatherSun){this.weatherSun.intensity=1.7-.75*fog+.13*heat;
      this.weatherSun.color.set('#ffe3ba').lerp(new Color('#f2f4f5'),fog*.68);
    }
    if(this.weatherHemi)this.weatherHemi.intensity=1.3-.32*fog+.04*heat;
    if(this.weatherVeil){
      this.weatherVeil.style.opacity=String(Math.min(.19,heat*.13));
      this.weatherVeil.style.display=heat>.03?'block':'none';
    }
    if(this.renderer?.domElement){
      this.renderer.domElement.style.filter=heat>.35&&!this.lowPower?'url(#mine-heat-refraction)':'none';
      if(this.heatTurbulence&&heat>.35&&!this.lowPower&&this.visualTime-this.lastHeatDistort>.16){
        this.heatTurbulence.setAttribute('seed',String(3+Math.floor(this.visualTime*5)%10));
        this.lastHeatDistort=this.visualTime;
      }
    }
    if(this.slideDebrisGroup){this.slideDebrisGroup.visible=slide>.03;for(const rock of this.slideDebrisGroup.children){const b=rock.userData.base,phase=rock.userData.phase||0;rock.position.y=this.groundHeight(b.x,b.z)+.35+slide*.6;const s=.08+slide*(0.95+0.08*Math.sin(this.visualTime*1.5+phase));rock.scale.setScalar(s);}}
    this.landslide.visible=slide>.08;
    if(this.landslide.visible && this.visualRoads.has('RAMP-04')){const mid=this.sampleRoadRecord(this.visualRoads.get('RAMP-04'),.48),att=this.landslide.geometry.getAttribute('position'),arr=att.array;for(let i=0;i<arr.length;i+=3){const n=i/3,u=(this.visualTime*.22+n*.015)%1,lane=(n%14)/13-0.5,spread=((n*17)%9)-4;arr[i]=mid.x+lane*32+Math.sin(n*.7)*1.4;arr[i+2]=mid.z-6-u*(28+slide*18)+spread*.55;arr[i+1]=mid.y+11+slide*8-u*(7+slide*6)+Math.abs(Math.sin(this.visualTime*2.1+n))*.5;}att.needsUpdate=true;}
    this.updateServiceUnits(dt);
  }
  animateModels(dt){
    if(this.running===false)return;
    // Animation is driven by ACTUAL engine states; idle excavators do not shovel the air.
    for(const [id,asset] of this.assets){
      if(asset.kind!=='excavator')continue;
      const live=this.snap?.assets?.[id];
      const truck=this.snap?.fleet?.find(t=>t.status==='loading'&&t.id===live?.busy&&t.target===id);
      const active=!!truck&&!(id==='face-north'&&this.snap?.flags?.loaderFault);
      const p=asset.pivots,b=asset.baseRotations||{};
      const phase=active?((truck.operationTimer||0)%8)/8:0;
      const dig=active?Math.sin(Math.PI*phase*2):0;
      const lift=active?Math.sin(Math.PI*phase):0;
      const turn=active?(phase<.5?phase*2:(1-phase)*2):0;
      if(p['excavator-boom-pivot'])p['excavator-boom-pivot'].rotation.x=(b['excavator-boom-pivot']?.x||0)+lift*.28;
      if(p['excavator-stick-pivot'])p['excavator-stick-pivot'].rotation.x=(b['excavator-stick-pivot']?.x||0)+dig*.31;
      if(p['excavator-bucket-pivot'])p['excavator-bucket-pivot'].rotation.x=(b['excavator-bucket-pivot']?.x||0)+(phase>.55&&phase<.85?-.44:0);
      if(p['excavator-turret-pivot']){
        // Pivot aims at the loading truck only during its loading window.
        let turret=(b['excavator-turret-pivot']?.y||0);
        if(truck){const dx=truck.position.x-asset.root.position.x,dz=truck.position.z-asset.root.position.z;const heading=-Math.atan2(dz,dx)-asset.root.rotation.y;turret+=heading*turn;}
        p['excavator-turret-pivot'].rotation.y=turret;
      }
      if(asset.loadingOre){asset.loadingOre.visible=!!truck&&phase>.52&&phase<.82;
        if(asset.loadingOre.visible&&truck){
          const origin=asset.root.position,delta={x:truck.position.x-origin.x,z:truck.position.z-origin.z};
          const a=Math.max(0,Math.min(1,(phase-.52)/.30));
          asset.loadingOre.position.set(origin.x+delta.x*a,origin.y+12+8*Math.sin(a*Math.PI),origin.z+delta.z*a);
        }
      }
    }
    for(const [id,entity] of this.trucks){
      entity.wheels.forEach((w,i)=>w.rotation.x=(entity.wheelBases[i]||0)+entity.wheelAngle);
      const t=this.snap?.fleet?.find(x=>x.id===id);
      // Dump only while genuinely at the receiving station.
      const target=t?.status==='dumping'&&t?.speed<.2&&t.operationElapsed>=1.5&&t.operationElapsed<=6.0?0.66:0;
      entity.dumpLift=mix(entity.dumpLift,target,Math.min(1,dt*2));
      entity.bed.forEach((b,i)=>b.rotation.x=(entity.bedBases[i]||0)-entity.dumpLift);
      if(entity.ore){entity.ore.visible=false;
        if(entity.ore.visible)entity.ore.children.forEach((stone,i)=>{const f=((t?.operationElapsed||0)*.8+i*.13)%1;stone.position.set(-2.5+(i%4)*1.2,7.5-6.8*f,-4.0-6*f);stone.rotation.x+=dt*(.7+i*.05);});
      }
    }
    for(const [id,asset] of this.assets){
      if(asset.kind!=='crusher')continue;
      const offline=!!this.snap?.flags?.powerFault||!!this.snap?.flags?.beltFault||(id==='crusher-a'&&!!this.snap?.flags?.crusherFault)||(id==='crusher-b'&&!!this.snap?.flags?.crusherBFault);
      const receiving=this.snap?.fleet?.some(t=>t.status==='dumping'&&t.target===id);
      const working=!offline&&((this.snap?.lines?.[id]||0)>0||!!receiving);
      asset.rollers.forEach((r,i)=>{if(working)r.rotation.z+=dt*(2.2+i*.10);});
      if(asset.jaw){
        asset.jaw.position.y=asset.jawBaseY+(working?Math.sin(this.visualTime*7.0)*.045:0);
        asset.jaw.rotation.y=asset.jawBaseRot+(working?Math.sin(this.visualTime*4.5)*.004:0);
        asset.jaw.rotation.z=working?Math.sin(this.visualTime*9.0)*.003:0;
      }
      asset.stripes.forEach((stripe,i)=>{
        const u=working?(this.visualTime*.13+i/asset.stripes.length)%1:i/asset.stripes.length;
        stripe.position.set(-18+u*36,.82,0);
      });
      const hopperTonnes=Math.max(0,Number(this.snap?.lines?.[id]||0));
      const fill=clamp(hopperTonnes/320,0,1);
      asset.hopperFill.scale.y=.16+fill*.5;
      asset.hopperFill.position.y=4.2+fill*1.1;
      // Only a few solid, grouped rocks moving ALONG the belt.
      asset.ore.forEach((stone,i)=>{
        const u=(this.visualTime*.075+i/asset.ore.length)%1;
        stone.position.set(-16+u*32,1.8,((i%3)-1)*1.6);
        stone.rotation.z=0;
        stone.visible=working&&hopperTonnes>5 && i < 7;
      });
      // Material transfer is tied to an actual stationary dumper at this hopper.
      const dumper=this.snap?.fleet?.find(t=>t.node===id&&t.status==='dumping'&&t.speed<.2);
      const rig=dumper&&this.trucks.get(dumper.id);
      const receive=dumper&&rig&&dumper.operationElapsed>=1.8&&dumper.operationElapsed<7;
      asset.root.updateMatrixWorld(true);
      if(rig)rig.root.updateMatrixWorld(true);
      const origin=receive?rig.root.localToWorld(new Vector3(-3.5,9,-1.1)):null;
      const target=asset.root.localToWorld(asset.receiveLocal?asset.receiveLocal.clone():new Vector3(-16,6.2,0));
      asset.dumpStream.forEach((stone,i)=>{
        stone.visible=!!receive;
        if(!receive)return;
        const u=((dumper.operationElapsed-1.8)*.50+i/asset.dumpStream.length)%1;
        stone.position.set(mix(origin.x,target.x,u),mix(origin.y,target.y,u)+3.2*Math.sin(Math.PI*u),mix(origin.z,target.z,u));
        stone.rotation.x+=dt*(.5+i*.04);
      });
      // No permanent arbitrary particle cloud; the solid material is the effect.
      asset.dust.visible=false;
    }
    animateDetailedMachines(this,dt);
    this.blastVisual?.animate(dt,this.visualTime,this.snap);
    for(const truck of this.trucks.values())if(truck.serviceMode&&Number.isFinite(truck.serviceHeading)){
      // The rig faces through the open door along the bay's local X-axis.
      truck.root.rotation.y=truck.serviceHeading;
    }
  }
  start(){const loop=(now)=>{if(this.destroyed)return;requestAnimationFrame(loop);if(now-this.lastTime<(this.lowPower?33:16))return;const dt=Math.min((now-this.lastTime)/1000,.09);this.lastTime=now;this.visualTime+=dt;this.controls.update();this.animateModels(dt);constrainTerrainCamera(this);this.tickParticles(dt);this.renderer.render(this.scene,this.camera);this.frame++;this.statsFrames++;if(!this.lastStatsTime)this.lastStatsTime=now;if(now-this.lastStatsTime>1500){this.fps=Math.round(this.statsFrames*1000/(now-this.lastStatsTime));this.statsFrames=0;this.lastStatsTime=now;}};requestAnimationFrame(loop);}  
  project(x,y,z){const p=new Vector3(x,y,z).project(this.camera),w=this.mount.clientWidth,h=this.mount.clientHeight;return {x:(p.x+1)/2*w,y:(1-p.y)/2*h,visible:p.z<1&&p.z>0&&p.x>-1.2&&p.x<1.2&&p.y>-1.2&&p.y<1.2};}
  fitCamera(top=false){this.trackedTruck=null;this.topDown=top;const {centerX=0,centerZ=0,minY=0,maxX=600,minX=-600,maxZ=400,minZ=-400}=this.mapBounds||{};const span=Math.max(maxX-minX,maxZ-minZ,800);if(top){this.camera.position.set(centerX,minY+span*1.9,centerZ+1);}else{this.camera.position.set(centerX+span*.62,minY+span*.55,centerZ+span*.82);}this.controls.target.set(centerX,minY+10,centerZ);this.controls.update();}
  followTruck(id){const e=this.trucks.get(id);if(!e)return;this.trackedTruck=id;const p=e.root.position;this.controls.target.set(p.x,p.y+8,p.z);this.camera.position.set(p.x+42,p.y+25,p.z+46);this.controls.update();}
  focusBlast(){this.blastVisual?.focus();}
  focusFacility(id){const n=this.map?.nodes.find(n=>n.id===id);const root=this.facilityRoots.get(id);if(!n&&!root)return;this.trackedTruck=null;const p=root?.position||{x:n.x,y:n.elevation||0,z:n.z};this.controls.target.set(p.x,p.y+8,p.z);this.camera.position.set(p.x+55,p.y+36,p.z+63);this.controls.update();}
  setQuality(level){this.lowPower=level==='low';this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,this.lowPower?.72:1.25));this.resize();}
  destroy(){this.destroyed=true;this.resizeObserver.disconnect();this.controls.dispose();this.renderer.dispose();this.weatherHud?.remove();this.weatherVeil?.remove();}
}
