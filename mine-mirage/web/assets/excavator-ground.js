import {V as Vector3,M as Mesh,B as BufferGeometry,k as Float32BufferAttribute} from './three-vendor.js';
import {prepareTerrainCamera,terrainCameraHeight} from './camera-terrain.js';
import {geologicalMaterial,landNoise} from './terrain-natural.js';

const clamp=t=>Math.max(0,Math.min(1,t));
const smooth=t=>{t=clamp(t);return t*t*(3-2*t);};

function roadClearance(scene,x,z){
  let distance=Infinity;
  for(const road of scene.visualRoads.values())for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[2]-a[2];
    const t=clamp(((x-a[0])*dx+(z-a[2])*dz)/(dx*dx+dz*dz||1));
    distance=Math.min(distance,Math.hypot(x-a[0]-t*dx,z-a[2]-t*dz));
  }
  return distance;
}

function selectWorksite(scene,asset){
  const node=asset.node,old=asset.root.position,candidates=[];
  const height=(x,z)=>terrainCameraHeight(scene.cameraTerrain,x,z);
  const assess=(site,step)=>{
    const c=Math.cos(site.yaw),s=Math.sin(site.yaw),heights=[];
    for(let x=-7;x<=11.01;x+=step)for(let z=-9;z<=11.01;z+=step){
      heights.push(height(site.x+c*x+s*z,site.z-s*x+c*z));
    }
    site.high=Math.max(...heights);site.low=Math.min(...heights);
    site.score=(site.high-site.low)*4+Math.abs(site.high-node.elevation)*.8+
      Math.hypot(site.x-old.x,site.z-old.z)*.025+(site.radius-20)*.12;
    return site;
  };
  // Stay within the boom's loading reach and leave the existing haul routes
  // clear. Only the rendered facility moves; simulation nodes stay untouched.
  for(const radius of [20,22,24,26,28])for(let i=0;i<72;i++){
    const a=i*Math.PI/36,x=node.x+Math.cos(a)*radius,z=node.z+Math.sin(a)*radius;
    if(roadClearance(scene,x,z)<17)continue;
    candidates.push(assess({x,z,radius,yaw:Math.atan2(z-node.z,node.x-x)},5));
  }
  if(!candidates.length)return null;
  const finalists=candidates.sort((a,b)=>a.score-b.score).slice(0,12).map(site=>assess(site,1));
  return finalists.sort((a,b)=>a.score-b.score)[0];
}

function surfaceMesh(positions,indices,name,material){
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
  const mesh=new Mesh(geometry,material);mesh.name=name;mesh.receiveShadow=true;
  mesh.userData.detailGeometry=true;mesh.userData.detailMaterial=true;
  return mesh;
}

function includeGroundInCamera(scene,mesh){
  const temporary={terrainGroup:{children:[mesh],getObjectByName:()=>null}};
  prepareTerrainCamera(temporary);
  const addition=temporary.cameraTerrain,target=scene.cameraTerrain;if(!addition)return;
  const offset=target.triangles.length;
  for(const triangle of addition.triangles)target.triangles.push(triangle);
  for(const [key,ids] of addition.cells)target.cells.set(key,(target.cells.get(key)||[]).concat(ids.map(id=>id+offset)));
}

export function installGroundedWorksite(scene,asset){
  if(!scene.cameraTerrain)return false;
  const site=selectWorksite(scene,asset);if(!site)return false;
  const root=asset.root;
  root.position.set(site.x,site.high+.12,site.z);root.rotation.y=site.yaw;root.updateMatrixWorld(true);
  const c=Math.cos(site.yaw),s=Math.sin(site.yaw);
  // Keep the scan sampler separate from the new working ground collision mesh.
  const scan={...scene.cameraTerrain,cells:new Map(scene.cameraTerrain.cells)};
  const ground=(x,z)=>terrainCameraHeight(scan,site.x+c*x+s*z,site.z-s*x+c*z)-root.position.y;
  const skirt=Math.max(5,Math.min(24,(site.high-site.low)/.7+4));
  const pileSites=[];
  for(let i=0;i<=18;i++){
    const a=Math.PI/2+i*Math.PI/18,x=Math.cos(a)*18,z=Math.sin(a)*18,heights=[];
    if(roadClearance(scene,site.x+c*x+s*z,site.z-s*x+c*z)<10)continue;
    for(const dx of [-5,0,5])for(const dz of [-5,0,5])heights.push(ground(x+dx,z+dz));
    const high=Math.max(...heights),low=Math.min(...heights);
    pileSites.push({x,z,score:(high-low)*2+Math.abs(high)+Math.max(0,high)*4});
  }
  const pileSite=pileSites.sort((a,b)=>a.score-b.score)[0]||{x:-18,z:0};
  const surface=(x,z)=>{
    const trackDistance=Math.hypot(Math.max(0,Math.abs(x-2)-9.3),Math.max(0,Math.abs(z-1)-10));
    const distance=Math.min(trackDistance,Math.max(0,Math.hypot(x-pileSite.x,z-pileSite.z)-8));
    const blend=smooth(distance/skirt),earth=ground(x,z);
    return earth*blend-.18*Math.pow(blend,12);
  };
  // A level working bench under the full track footprint. The transition and
  // closed underside are sampled from the real scan, never a fixed-depth disk.
  const positions=[],indices=[],nx=64,nz=64;
  const minX=Math.min(2-9.3,pileSite.x-8)-skirt,maxX=Math.max(2+9.3,pileSite.x+8)+skirt;
  const minZ=Math.min(1-10,pileSite.z-8)-skirt,maxZ=Math.max(1+10,pileSite.z+8)+skirt;
  for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){
    const x=minX+(maxX-minX)*ix/nx,z=minZ+(maxZ-minZ)*iz/nz;
    positions.push(x,surface(x,z),z);
  }
  const count=positions.length/3;
  for(let i=0;i<count;i++)positions.push(positions[i*3],ground(positions[i*3],positions[i*3+2])-1,positions[i*3+2]);
  for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
    const a=z*(nx+1)+x,b=a+1,d=a+nx+1,e=d+1;
    indices.push(a,d,b,b,d,e,a+count,b+count,d+count,b+count,e+count,d+count);
  }
  const rim=[];
  for(let x=0;x<=nx;x++)rim.push(x);
  for(let z=1;z<=nz;z++)rim.push(z*(nx+1)+nx);
  for(let x=nx-1;x>=0;x--)rim.push(nz*(nx+1)+x);
  for(let z=nz-1;z>0;z--)rim.push(z*(nx+1));
  for(let i=0;i<rim.length;i++){const a=rim[i],b=rim[(i+1)%rim.length];indices.push(a,b,a+count,b,b+count,a+count);}
  const pad=surfaceMesh(positions,indices,'compacted-working-ground',geologicalMaterial(null,{green:scene.map?.id==='altai'}));
  root.add(pad);

  const pilePositions=[],pileIndices=[],rings=18,segments=64;
  for(let r=0;r<=rings;r++)for(let i=0;i<=segments;i++){
    const a=i/segments*Math.PI*2,t=r/rings,x=pileSite.x+Math.cos(a)*8*t,z=pileSite.z+Math.sin(a)*7*t;
    const base=Math.max(ground(x,z),surface(x,z));
    const heap=(1-t*t)*5.4+(landNoise(x*.45,z*.45)-.5)*.8*(1-t);
    pilePositions.push(x,base+heap-.08,z);
    if(r<rings&&i<segments){const k=r*(segments+1)+i;pileIndices.push(k,k+segments+1,k+1,k+1,k+segments+1,k+segments+2);}
  }
  const pile=surfaceMesh(pilePositions,pileIndices,'broken-rock-stockpile',geologicalMaterial(null));root.add(pile);

  // Seat the actual animated belt geometry, not the model's origin, on the pad.
  const tracks=asset.visual.getObjectByName('animated-track-shoes');
  if(tracks){
    root.updateMatrixWorld(true);let bottom=Infinity;const point=new Vector3();
    tracks.traverse(mesh=>{const p=mesh.geometry?.getAttribute('position');if(!p)return;
      for(let i=0;i<p.count;i++){point.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);root.worldToLocal(point);bottom=Math.min(bottom,point.y);}
    });
    if(Number.isFinite(bottom))asset.visual.position.y-=bottom;
  }
  asset.detail.basePosition.copy(asset.visual.position);asset.detail.lastPosition.copy(asset.visual.position);
  asset.detail.digPoint=new Vector3(pileSite.x,Math.max(ground(pileSite.x,pileSite.z),surface(pileSite.x,pileSite.z))+2,pileSite.z);
  asset.detail.worksite={surface,ground,skirt,pad,site};
  root.updateMatrixWorld(true);
  includeGroundInCamera(scene,pad);includeGroundInCamera(scene,pile);
  return true;
}
