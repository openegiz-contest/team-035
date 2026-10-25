import {
  G as Group,M as Mesh,B as BufferGeometry,k as Float32BufferAttribute,
  j as MeshStandardMaterial,C as Color,V as Vector3,q as BoxGeometry,
  c as IcosahedronGeometry,o as CylinderGeometry,e as DoubleSide
} from './three-vendor.js';
import {createNaturalLandscape} from './terrain-natural.js';
import {installDeepBucket,improveDiggingPad} from './excavator-detail.js';
import {createTruckCargo,updateTruckCargo} from './truck-cargo.js';

const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=t=>{t=clamp(t,0,1);return t*t*t*(t*(t*6-15)+10);};
const angle=v=>Math.atan2(Math.sin(v),Math.cos(v));
const damp=(a,b,dt,rate=9)=>a+(b-a)*(1-Math.exp(-rate*dt));
const soilMaterial=new MeshStandardMaterial({color:0x977755,roughness:1});
const trackMaterial=new MeshStandardMaterial({color:0x414541,metalness:.28,roughness:.88});
const steelMaterial=new MeshStandardMaterial({color:0xc4d1d4,metalness:.78,roughness:.28});
const barrelMaterial=new MeshStandardMaterial({color:0xd7a340,metalness:.24,roughness:.6});
const unitCylinder=new CylinderGeometry(1,1,1,10);
const unitBox=new BoxGeometry(1,1,1);
const bucketGeometry=new IcosahedronGeometry(.66,1);
const fallingGeometry=new IcosahedronGeometry(.48,0);
const markerGeometry=new BoxGeometry(.035,.14,1.42);
const markerMaterial=new MeshStandardMaterial({color:0xdac397,metalness:.25,roughness:.68});

export function disposeSceneDetails(scene){
  for(const group of [scene.terrainGroup,scene.facilityGroup])group.traverse(o=>{
    if(o.userData.detailGeometry)o.geometry?.dispose();
    if(o.userData.detailMaterial)o.material?.dispose();
  });
}

// Extend the scan outward from its silhouette. The operational terrain and
// all coordinates used by the route engine remain at their original scale.
export function extendLandscape(scene,oldPlane){
  if(createNaturalLandscape(scene,oldPlane))return;
  const terrain=scene.terrainGroup.children.find(o=>o!==oldPlane);
  if(!terrain)return;
  terrain.updateMatrixWorld(true);
  const count=160,edge=new Array(count),center=new Vector3();
  const bounds=scene.modelBounds(terrain);
  center.set((bounds.minx+bounds.maxx)/2,0,(bounds.minz+bounds.maxz)/2);
  terrain.traverse(o=>{
    const p=o.geometry?.getAttribute('position');if(!p)return;
    const v=new Vector3();
    for(let i=0;i<p.count;i++){
      v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);
      const x=v.x-center.x,z=v.z-center.z,r=Math.hypot(x,z);
      const sector=Math.floor(((Math.atan2(z,x)+TAU)%TAU)/TAU*count)%count;
      if(!edge[sector]||r>edge[sector].r)edge[sector]={r,y:v.y};
    }
  });
  const fallback=Math.max(bounds.maxx-bounds.minx,bounds.maxz-bounds.minz)/2;
  for(let i=0;i<count;i++)if(!edge[i]){
    let k=1;while(k<count&&!edge[(i+k)%count])k++;
    edge[i]=edge[(i+k)%count]||{r:fallback,y:bounds.miny};
  }
  const positions=[],colors=[],indices=[],rings=22,ground=bounds.miny-52;
  for(let j=0;j<=rings;j++)for(let i=0;i<=count;i++){
    const k=i%count,a=k/count*TAU,u=j/rings;
    const r=edge[k].r*.995+(6700-edge[k].r)*u;
    const fade=smooth(u*4);
    const hills=(Math.sin(a*5+.5)*Math.cos(a*9)*110+150)*smooth((u-.16)*2);
    const y=ground+hills*fade;
    positions.push(center.x+Math.cos(a)*r,y-1,center.z+Math.sin(a)*r);
    const shade=.34+.035*Math.sin(a*13+r*.008)+.025*Math.cos(r*.017-a*7);
    colors.push(shade,shade*.87,shade*.70);
    if(j<rings&&i<count){const p=j*(count+1)+i;indices.push(p,p+count+1,p+1,p+1,p+count+1,p+count+2);}
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  const land=new Mesh(geometry,new MeshStandardMaterial({vertexColors:true,roughness:1,side:DoubleSide}));
  land.name='open-landscape';land.userData.detailGeometry=true;land.userData.detailMaterial=true;scene.terrainGroup.add(land);oldPlane.visible=false;
  addScanSkirt(scene,terrain,center,ground);
  scene.scene.background=new Color('#a9c6d3');
}

function addScanSkirt(scene,terrain,center,ground){
  const edges=new Map(),v=new Vector3();
  terrain.traverse(o=>{
    const p=o.geometry?.getAttribute('position');if(!p)return;
    const points=[],keys=[];
    for(let i=0;i<p.count;i++){
      v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);
      points.push(v.clone());keys.push([v.x,v.y,v.z].map(n=>Math.round(n*50)).join(','));
    }
    const index=o.geometry.index,n=index?index.count:p.count;
    for(let i=0;i<n;i+=3){
      const triangle=[0,1,2].map(k=>index?index.getX(i+k):i+k);
      for(let k=0;k<3;k++){
        const a=triangle[k],b=triangle[(k+1)%3];if(keys[a]===keys[b])continue;
        const key=keys[a]<keys[b]?keys[a]+'|'+keys[b]:keys[b]+'|'+keys[a];
        const entry=edges.get(key);
        if(entry)entry.count++;else edges.set(key,{count:1,a:points[a],b:points[b]});
      }
    }
  });
  const positions=[];
  for(const {count,a,b} of edges.values())if(count===1){
    const lower=(p,t)=>{
      const dx=p.x-center.x,dz=p.z-center.z,length=Math.hypot(dx,dz)||1;
      return new Vector3(p.x+dx/length*650*t,p.y+(ground-1-p.y)*smooth(t),p.z+dz/length*650*t);
    };
    for(let i=0;i<8;i++){
      const aa=lower(a,i/8),bb=lower(b,i/8),c=lower(a,(i+1)/8),d=lower(b,(i+1)/8);
      for(const p of [aa,c,bb,bb,c,d])positions.push(p.x,p.y-.15,p.z);
    }
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.computeVertexNormals();
  const skirt=new Mesh(geometry,new MeshStandardMaterial({color:0x8b7661,roughness:1,side:DoubleSide}));
  skirt.name='scan-edge-slopes';skirt.userData.detailGeometry=true;skirt.userData.detailMaterial=true;scene.terrainGroup.add(skirt);
}

// A closed capsule: shoes wrap continuously over both sprockets.
export function trackPoint(distance){
  const straight=3.9,r=.64,arc=Math.PI*r,length=straight*2+arc*2;
  let s=((distance%length)+length)%length;
  if(s<straight)return {z:-straight/2+s,y:1.38,tilt:0};
  s-=straight;
  if(s<arc){const a=s/r;return {z:straight/2+r*Math.sin(a),y:.74+r*Math.cos(a),tilt:a};}
  s-=arc;
  if(s<straight)return {z:straight/2-s,y:.10,tilt:Math.PI};
  s-=straight;const a=s/r;
  return {z:-straight/2-r*Math.sin(a),y:.74-r*Math.cos(a),tilt:Math.PI+a};
}
const trackLength=7.8+TAU*.64;

function makeTracks(asset){
  const original=asset.visual.getObjectByName('track-shoes');if(!original)return;
  const group=new Group();group.name='animated-track-shoes';original.parent.add(group);
  // One mesh for both continuous belts, rather than a draw call per shoe.
  const base=unitBox.toNonIndexed(),corners=base.getAttribute('position');
  const count=42,vertices=new Float32Array(count*2*corners.count*3);
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(vertices,3));
  const mesh=new Mesh(geometry,trackMaterial);mesh.userData.detailGeometry=true;mesh.frustumCulled=false;group.add(mesh);
  original.visible=false;
  asset.detail.tracks={geometry,corners,count,phase:0};
  updateTracks(asset,0);
}
function updateTracks(asset,travel){
  const tracks=asset.detail.tracks;if(!tracks)return;
  tracks.phase+=travel/3.25;
  const attr=tracks.geometry.getAttribute('position'),a=attr.array;
  let offset=0;
  for(const side of [-1,1])for(let i=0;i<tracks.count;i++){
    const p=trackPoint(i/tracks.count*trackLength+tracks.phase),c=Math.cos(p.tilt),s=Math.sin(p.tilt);
    for(let k=0;k<tracks.corners.count;k++){
      const x=tracks.corners.getX(k)*.83,y=tracks.corners.getY(k)*.11,z=tracks.corners.getZ(k)*.24;
      a[offset++]=side*2.09+x;a[offset++]=p.y+y*c-z*s;a[offset++]=p.z+y*s+z*c;
    }
  }
  attr.needsUpdate=true;tracks.geometry.computeVertexNormals();
}

function hydraulic(parent,start,end){
  const group=new Group();group.name='articulated-hydraulic';parent.add(group);
  const barrel=new Mesh(unitCylinder,barrelMaterial),rod=new Mesh(unitCylinder,steelMaterial);
  group.add(barrel,rod);
  return {group,barrel,rod,start,end};
}
function updateHydraulic(h){
  h.group.parent.updateWorldMatrix(true,false);
  const a=h.group.parent.worldToLocal(h.start()),b=h.group.parent.worldToLocal(h.end());
  const d=b.clone().sub(a),length=Math.max(.01,d.length()),direction=d.clone().normalize();
  h.group.position.copy(a);h.group.quaternion.setFromUnitVectors(new Vector3(0,1,0),direction);
  const barrel=length*.56,rod=length-barrel;
  h.barrel.scale.set(.14,barrel,.14);h.barrel.position.y=barrel/2;
  h.rod.scale.set(.075,rod+.10,.075);h.rod.position.y=barrel+rod/2-.05;
}
const point=(node,x,y,z)=>()=>node.localToWorld(new Vector3(x,y,z));

export function rigExcavator(scene,asset){
  asset.detail={clock:0,lastTime:scene.snap?.time??0,blend:0,yaw:0,basePosition:asset.visual.position.clone(),lastPosition:asset.visual.position.clone()};
  const p=asset.pivots,boom=p['excavator-boom-pivot'],stick=p['excavator-stick-pivot'],bucket=p['excavator-bucket-pivot'],turret=p['excavator-turret-pivot'];
  if(!boom||!stick||!bucket||!turret)return;
  const forward=new Vector3(0,0,1).applyQuaternion(turret.quaternion);
  asset.detail.restYaw=Math.atan2(forward.x,forward.z);
  asset.detail.yaw=asset.detail.restYaw;
  asset.detail.boomAngle=boom.rotation.x;asset.detail.stickAngle=stick.rotation.x;asset.detail.bucketAngle=bucket.rotation.x;
  asset.detail.hydraulics=[];
  // Preserve the original cylinders in the hierarchy; articulated replacements
  // keep their attachment points connected as the three joints move.
  asset.visual.traverse(o=>{if(o.name==='hydraulic-cylinder')o.visible=false;});
  for(const x of [.04,1.16])asset.detail.hydraulics.push(hydraulic(turret,point(turret,x,.84,.15),point(boom,x-.6,2.5,-.35)));
  asset.detail.hydraulics.push(hydraulic(boom,point(boom,0,1.9,-.65),point(stick,0,-1.7,.44)));
  asset.detail.hydraulics.push(hydraulic(stick,point(stick,0,-.8,.43),point(bucket,0,.35,.35)));
  const dirt=new Mesh(bucketGeometry,soilMaterial);dirt.scale.set(1.15,.36,1.1);dirt.position.set(0,.05,.55);bucket.add(dirt);dirt.visible=false;asset.detail.dirt=dirt;
  installDeepBucket(asset);
  const pieces=[];
  for(let i=0;i<9;i++){
    const piece=new Mesh(fallingGeometry,soilMaterial);piece.scale.setScalar(.8+(i%3)*.2);
    piece.visible=false;scene.fxGroup.add(piece);pieces.push(piece);
  }
  asset.detail.pieces=pieces;makeTracks(asset);
  improveDiggingPad(scene,asset);
}

export function rigTruck(entity){
  entity.detail={lastPosition:null,yaw:0,roll:0,steer:0,wheelAngle:0,travel:0,baseY:entity.visual.position.y};
  if(entity.bed[0]){
    const cargo=createTruckCargo(entity.payload);
    entity.bed[0].add(cargo);entity.detail.cargo=cargo;
  }
  // The asymmetric marks make wheel rotation visible at close range.
  for(const wheel of entity.wheels){
    const marker=new Mesh(markerGeometry,markerMaterial);
    marker.position.set(wheel.position.x<0?-.455:.455,0,0);marker.rotation.x=.35;wheel.add(marker);
  }
}

// A closed dig -> curl -> lift -> swing -> tip -> return cycle.
export function bucketPose(phase){
  const keys=[
    [0,0,3,-.12],[.16,0,.2,-.16],[.29,0,1.5,.58],
    [.43,0,12,.58],[.61,1,12,.58],[.69,1,5,.58],
    [.78,1,5,-.75],[.87,1,12,-.35],[1,0,3,-.12]
  ];
  const t=((phase%1)+1)%1;
  let i=1;while(i<keys.length-1&&keys[i][0]<t)i++;
  const a=keys[i-1],b=keys[i],u=smooth((t-a[0])/(b[0]-a[0]));
  return {swing:a[1]+(b[1]-a[1])*u,lift:a[2]+(b[2]-a[2])*u,curl:a[3]+(b[3]-a[3])*u};
}
function poseExcavator(scene,asset,simDelta,dt){
  const d=asset.detail,p=asset.pivots,boom=p['excavator-boom-pivot'],stick=p['excavator-stick-pivot'],bucket=p['excavator-bucket-pivot'],turret=p['excavator-turret-pivot'];
  if(!boom||!stick||!bucket||!turret)return;
  const live=scene.snap?.assets?.[asset.node.id];
  const truck=scene.snap?.fleet?.find(t=>t.id===live?.busy&&t.status==='loading'&&t.target===asset.node.id);
  const active=!!truck&&!(asset.node.id===scene.map?.nodes.find(n=>n.kind==='face')?.id&&scene.snap?.flags?.loaderFault);
  const running=simDelta>0;
  d.blend=damp(d.blend,active?1:0,running?dt:0,5);
  if(active)d.clock+=simDelta;
  const phase=(d.clock%24)/24,pose=bucketPose(phase),rig=truck&&scene.trucks.get(truck.id);
  // A short crawl on the existing loading pad repositions the machine between
  // trucks; it stops before digging. It never changes the simulation asset node.
  const crawl=active?0:Math.sin((scene.snap?.time||0)*.035)*.42;
  asset.visual.position.z=damp(asset.visual.position.z,d.basePosition.z+crawl,running?dt:0,2);
  const travel=asset.visual.position.z-d.lastPosition.z;
  if(Math.abs(travel)>1e-6)updateTracks(asset,travel*3.25);
  d.lastPosition.copy(asset.visual.position);
  asset.root.updateMatrixWorld(true);
  const dig=asset.root.localToWorld(d.digPoint?.clone()||new Vector3(-16,2,-6));
  const bed=rig?rig.visual.localToWorld(new Vector3(0,3.8,.7)):dig.clone();
  const workTarget=dig.clone().lerp(bed,pose.swing);workTarget.y+=pose.lift;
  const target=dig.clone();target.y+=4.5;target.lerp(workTarget,d.blend);
  const local=asset.visual.worldToLocal(target.clone());
  local.sub(turret.position);
  const desired=Math.atan2(local.x,local.z)-Math.asin(clamp(boom.position.x/(Math.hypot(local.x,local.z)||1),-1,1));
  const rest=d.restYaw;
  const yaw=rest+angle(desired-rest);
  d.yaw+=angle(yaw-d.yaw)*(1-Math.exp(-7*(running?dt:0)));
  turret.rotation.set(0,d.yaw,0);turret.updateWorldMatrix(true,true);
  const v=turret.worldToLocal(target.clone()).sub(boom.position);
  const l1=5.1,l2=4.5,length=Math.hypot(v.y,v.z)||1,r=clamp(length,2.2,9.1);
  const y=v.y*r/length,z=v.z*r/length;
  const a=Math.atan2(z,y)-Math.acos(clamp((l1*l1+r*r-l2*l2)/(2*l1*r),-1,1));
  const b=angle(Math.atan2(-(z-l1*Math.sin(a)),-(y-l1*Math.cos(a)))-a);
  const base=asset.baseRotations;
  d.boomAngle=damp(d.boomAngle,clamp(a,.12,1.62),running?dt:0,8);
  d.stickAngle=damp(d.stickAngle,clamp(b,-2.65,-.15),running?dt:0,8);
  boom.rotation.x=d.boomAngle;stick.rotation.x=d.stickAngle;
  const pitch=-.12+(pose.curl+.12)*d.blend;
  d.bucketAngle=damp(d.bucketAngle,clamp(pitch-d.boomAngle-d.stickAngle,-1.75,1.85),running?dt:0,10);
  bucket.rotation.x=d.bucketAngle;
  d.dirt.visible=active&&phase>.24&&phase<.75;
  asset.loadingOre.visible=false;
  asset.root.updateMatrixWorld(true);
  for(const h of d.hydraulics)updateHydraulic(h);
  const pour=active&&phase>.69&&phase<.79;
  const origin=(d.bucketShell||bucket).localToWorld(new Vector3(0,-.48,1.96));
  for(let i=0;i<d.pieces.length;i++){
    const piece=d.pieces[i];piece.visible=pour;
    if(!pour)continue;
    const u=((phase-.69)*28+i/d.pieces.length)%1;
    piece.position.copy(origin).lerp(bed,u);
    piece.position.y-=Math.sin(Math.PI*u)*1.1;
    piece.position.x+=Math.sin(i*4.1)*.8*u;piece.rotation.x=d.clock+i;
  }
}

export function animateDetailedMachines(scene,dt){
  const time=scene.snap?.time??0;
  const delta=scene.detailTime===undefined?0:Math.max(0,time-scene.detailTime);
  const simDelta=scene.running===true?dt*(scene.animationRate||5):scene.running===false?0:delta;
  scene.detailTime=time;
  scene.scene.fog.near=scene.snap?.flags?.rain?800:2000;
  scene.scene.fog.far=scene.snap?.flags?.rain?3500:6200;
  for(const entity of scene.trucks.values()){
    const d=entity.detail;if(!d)continue;
    if(d.targetPosition&&simDelta>0)entity.root.position.lerp(d.targetPosition,1-Math.exp(-dt*12));
    const pos=entity.root.position;
    if(!d.lastPosition){d.lastPosition=pos.clone();d.yaw=entity.root.rotation.y;}
    const delta=pos.clone().sub(d.lastPosition),travel=Math.hypot(delta.x,delta.z);
    if(travel>.0001&&travel<45&&simDelta>0){
      const heading=-Math.atan2(delta.z,delta.x),change=angle(heading-d.yaw);
      d.yaw+=change*(1-Math.exp(-dt*10));
      d.steer=damp(d.steer,clamp(-change,-.38,.38),dt,8);
      d.wheelAngle+=travel/2.83;d.travel+=travel;
      d.roll=damp(d.roll,clamp(Math.atan2(delta.y,travel),-.24,.24),dt,5);
    }else if(simDelta>0){d.steer=damp(d.steer,0,dt);d.roll=damp(d.roll,0,dt);}
    entity.root.rotation.y=d.yaw;entity.root.rotation.z=d.roll;
    entity.visual.position.y=d.baseY+(simDelta>0&&travel>.01?Math.sin(d.travel*.6)*.045:0);
    if(d.cargo)updateTruckCargo(d.cargo,entity.payload);
    entity.wheels.forEach((wheel,i)=>{
      wheel.rotation.x=(entity.wheelBases[i]||0)+d.wheelAngle;
      if(/wheel-pivot-(3|6)$/.test(wheel.name))wheel.rotation.y=d.steer;
    });
    d.lastPosition.copy(pos);
  }
  for(const asset of scene.assets.values())if(asset.kind==='excavator'&&asset.detail)poseExcavator(scene,asset,simDelta,dt);
}
