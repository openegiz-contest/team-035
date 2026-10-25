import {V as Vector3} from './three-vendor.js';

const CELL=24,CLEARANCE=6,TARGET_CLEARANCE=3;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const footprint=[[0,0],[1,0],[-1,0],[0,1],[0,-1],[.707,.707],[-.707,.707],[.707,-.707],[-.707,-.707]];

// Index only the immutable quarry surface. Trees and moving machines are not
// terrain; their geometry must not move the camera or change this height index.
export function prepareTerrainCamera(scene){
  const terrain=scene.terrainGroup.children[0];
  if(!terrain){scene.cameraTerrain=null;return;}
  const cells=new Map(),triangles=[],point=new Vector3();
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,minY=Infinity;
  terrain.updateWorldMatrix(true,true);
  terrain.traverse(mesh=>{
    const attr=mesh.geometry?.getAttribute('position');if(!attr)return;
    const vertices=new Float64Array(attr.count*3);
    for(let i=0;i<attr.count;i++){
      point.fromBufferAttribute(attr,i).applyMatrix4(mesh.matrixWorld);vertices.set([point.x,point.y,point.z],i*3);
      minX=Math.min(minX,point.x);maxX=Math.max(maxX,point.x);minZ=Math.min(minZ,point.z);maxZ=Math.max(maxZ,point.z);minY=Math.min(minY,point.y);
    }
    const index=mesh.geometry.index,count=index?index.count:attr.count;
    for(let i=0;i<count;i+=3){
      const a=(index?index.getX(i):i)*3,b=(index?index.getX(i+1):i+1)*3,c=(index?index.getX(i+2):i+2)*3;
      const ax=vertices[a],az=vertices[a+2],bx=vertices[b],bz=vertices[b+2],cx=vertices[c],cz=vertices[c+2];
      const den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(den)<1e-10)continue;
      const id=triangles.length;
      triangles.push([ax,vertices[a+1],az,bx,vertices[b+1],bz,cx,vertices[c+1],cz,1/den]);
      for(let z=Math.floor(Math.min(az,bz,cz)/CELL);z<=Math.floor(Math.max(az,bz,cz)/CELL);z++){
        for(let x=Math.floor(Math.min(ax,bx,cx)/CELL);x<=Math.floor(Math.max(ax,bx,cx)/CELL);x++){
          const key=`${x},${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(id);
        }
      }
    }
  });
  if(!triangles.length){scene.cameraTerrain=null;return;}
  const field=scene.terrainGroup.getObjectByName('natural-quarry-surroundings')?scene.naturalTerrain:null;
  if(field){minX=field.xs[0];maxX=field.xs.at(-1);minZ=field.zs[0];maxZ=field.zs.at(-1);}
  scene.cameraTerrain={cells,triangles,field,minX,maxX,minZ,maxZ,minY};
}

function lowerCell(axis,v){
  let a=0,b=axis.length-1;while(a<b){const m=(a+b)>>1;if(axis[m]<v)a=m+1;else b=m;}return clamp(a-1,0,axis.length-2);
}

export function terrainCameraHeight(collider,x,z){
  let height=-Infinity;
  const field=collider.field;
  if(field&&x>=field.xs[0]&&x<=field.xs.at(-1)&&z>=field.zs[0]&&z<=field.zs.at(-1)){
    const ix=lowerCell(field.xs,x),iz=lowerCell(field.zs,z),k=iz*field.n+ix;
    const u=(x-field.xs[ix])/(field.xs[ix+1]-field.xs[ix]),v=(z-field.zs[iz])/(field.zs[iz+1]-field.zs[iz]),h=field.surface;
    // Same diagonal and barycentric interpolation as the rendered ground mesh.
    height=u+v<=1?h[k]*(1-u-v)+h[k+1]*u+h[k+field.n]*v:
      h[k+1]*(1-v)+h[k+field.n]*(1-u)+h[k+field.n+1]*(u+v-1);
  }
  for(const id of collider.cells.get(`${Math.floor(x/CELL)},${Math.floor(z/CELL)}`)||[]){
    const t=collider.triangles[id];
    const u=((t[5]-t[8])*(x-t[6])+(t[6]-t[3])*(z-t[8]))*t[9];
    const v=((t[8]-t[2])*(x-t[6])+(t[0]-t[6])*(z-t[8]))*t[9],w=1-u-v;
    if(u>=-1e-6&&v>=-1e-6&&w>=-1e-6)height=Math.max(height,u*t[1]+v*t[4]+w*t[7]);
  }
  return Number.isFinite(height)?height:collider.minY;
}

export function constrainTerrainCamera(scene){
  const collider=scene.cameraTerrain,camera=scene.camera,target=scene.controls?.target;
  if(!collider||!camera||!target)return false;
  // Cover the near plane as well as the eye, including wide expanded viewports.
  const nearRadius=(camera.near||.5)*Math.tan((camera.fov||42)*Math.PI/360)*Math.hypot(1,camera.aspect||1);
  const radius=Math.max(3,nearRadius+1),margin=radius+2,p=camera.position;
  let changed=false;
  const contain=point=>{
    const x=clamp(point.x,collider.minX+margin,collider.maxX-margin),z=clamp(point.z,collider.minZ+margin,collider.maxZ-margin);
    if(x!==point.x||z!==point.z){point.x=x;point.z=z;changed=true;}
  };
  contain(target);contain(p);
  const focusFloor=terrainCameraHeight(collider,target.x,target.z)+TARGET_CLEARANCE;
  if(target.y<focusFloor){target.y=focusFloor;changed=true;}
  let floor=-Infinity;
  for(const [dx,dz] of footprint)floor=Math.max(floor,terrainCameraHeight(collider,p.x+dx*radius,p.z+dz*radius));
  const safeY=Math.max(floor+Math.max(CLEARANCE,nearRadius+2),target.y+.5);
  if(p.y<safeY){p.y=safeY;changed=true;}
  if(changed){
    // Do not call OrbitControls.update a second time: that would apply its
    // damping again and could reintroduce penetration before this frame renders.
    camera.lookAt(target);camera.updateMatrixWorld(true);
  }
  return changed;
}
