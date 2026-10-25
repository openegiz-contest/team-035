import {M as Mesh,B as BufferGeometry,k as Float32BufferAttribute,j as MeshStandardMaterial,C as Color,c as IcosahedronGeometry} from './three-vendor.js';

// Coordinates are relative to dump-bed-pivot in haul-truck-rigged-optimized.glb.
// The wear plate is at y=.28; the front canopy starts beyond z=3.62.
const FLOOR=.28;
const material=new MeshStandardMaterial({vertexColors:true,roughness:1,flatShading:true});
let geometry;

function makeLoadGeometry(){
  const positions=[],colors=[],grid=[],nx=20,nz=28;
  let seed=5209;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const color=new Color();
  const triangle=(a,b,c,shade=.8+random()*.32)=>{
    color.setHex(0x8d8271).multiplyScalar(shade);
    for(const p of [a,b,c]){positions.push(...p);colors.push(color.r,color.g,color.b);}
  };
  const height=(u,v)=>.55+.36*Math.sin(Math.PI*v)+.75*Math.sin(Math.PI*u)*Math.sin(Math.PI*v);
  for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++){
    const u=x/nx,v=z/nz,edge=x===0||x===nx||z===0||z===nz;
    grid.push([-1.65+3.3*u+(edge?0:(random()-.5)*.11),height(u,v)+(edge?0:(random()-.5)*.13),-.16+3.66*v+(edge?0:(random()-.5)*.08)]);
  }
  for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
    const a=grid[z*(nx+1)+x],b=grid[z*(nx+1)+x+1],c=grid[(z+1)*(nx+1)+x],d=grid[(z+1)*(nx+1)+x+1];
    triangle(a,c,b);triangle(b,c,d);
  }
  // Closed skirt reaches the floor instead of leaving an ellipsoid suspended
  // above it. Its narrower base fits on the actual steel wear plate.
  const rim=[];
  for(let x=0;x<=nx;x++)rim.push(grid[x]);
  for(let z=1;z<=nz;z++)rim.push(grid[z*(nx+1)+nx]);
  for(let x=nx-1;x>=0;x--)rim.push(grid[nz*(nx+1)+x]);
  for(let z=nz-1;z>0;z--)rim.push(grid[z*(nx+1)]);
  for(let i=0;i<rim.length;i++){
    const a=rim[i],b=rim[(i+1)%rim.length],c=[a[0]*.8,0,a[2]],d=[b[0]*.8,0,b[2]];
    triangle(a,b,c);triangle(b,d,c);triangle(c,d,[0,0,1.67]);
  }
  // Embedded fragments break up the surface; all their bottoms overlap the
  // continuous pile, so individual stones cannot hover above the contents.
  const stone=new IcosahedronGeometry(1,0),p=stone.getAttribute('position');
  for(let i=0;i<72;i++){
    const u=.08+random()*.84,v=.07+random()*.86,r=.065+random()*.085;
    const cx=-1.65+3.3*u,cz=-.16+3.66*v,cy=height(u,v)-r*.3;
    const shade=.7+random()*.5;
    for(let j=0;j<p.count;j+=3){
      const points=[];
      for(let k=0;k<3;k++)points.push([cx+p.getX(j+k)*r,cy+p.getY(j+k)*r*.7,cz+p.getZ(j+k)*r]);
      triangle(...points,shade);
    }
  }
  stone.dispose();
  const result=new BufferGeometry();
  result.setAttribute('position',new Float32BufferAttribute(positions,3));
  result.setAttribute('color',new Float32BufferAttribute(colors,3));
  result.computeVertexNormals();result.computeBoundingBox();result.computeBoundingSphere();
  return result;
}

export function createTruckCargo(payload){
  const cargo=new Mesh(geometry||(geometry=makeLoadGeometry()),material);
  cargo.name='truck-ore-load';cargo.position.y=FLOOR;cargo.receiveShadow=true;
  updateTruckCargo(cargo,payload);
  return cargo;
}

export function updateTruckCargo(cargo,payload){
  const fill=Math.max(0,Math.min(1,payload/100));
  cargo.visible=payload>.5;
  // Scale upward from the floor. Narrow shallow loads to stay inside the
  // flared sides of the bed even when almost empty.
  cargo.scale.set(.8+.2*fill,fill,1);
}
