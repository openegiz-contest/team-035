import {M as Mesh,B as BufferGeometry,k as Float32BufferAttribute,j as MeshStandardMaterial,V as Vector3,C as Color,l as CanvasTexture,e as DoubleSide,c as IcosahedronGeometry} from './three-vendor.js';
import {decorateLandscape} from './landscape-habitat.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const ease=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
function hash(x,z){const v=Math.sin(x*127.1+z*311.7)*43758.5453;return v-Math.floor(v);}
export function landNoise(x,z){
  const ix=Math.floor(x),iz=Math.floor(z),u=ease(x-ix),v=ease(z-iz);
  return mix(mix(hash(ix,iz),hash(ix+1,iz),u),mix(hash(ix,iz+1),hash(ix+1,iz+1),u),v);
}
function fbm(x,z){return landNoise(x,z)*.55+landNoise(x*2.07+31,z*2.07-17)*.27+landNoise(x*4.13-11,z*4.13+27)*.13+landNoise(x*8.27,z*8.27)*.05;}
let detailTexture;
function rockTexture(){
  if(detailTexture)return detailTexture;
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
  const ctx=canvas.getContext?.('2d');if(!ctx)return null;
  const pixels=ctx.createImageData(512,512);
  for(let z=0;z<512;z++)for(let x=0;x<512;x++){
    const i=(z*512+x)*4,n=fbm(x*.036,z*.036),grain=hash(x,z);
    const stone=landNoise(x*.17,z*.17),crack=Math.pow(Math.abs(landNoise(x*.07,z*.07)-.5)*2,.24);
    pixels.data[i]=clamp((n*.55+stone*.25+grain*.2)*255,0,255);
    pixels.data[i+1]=clamp((.25+n*.48+crack*.2+grain*.07)*255,0,255);
    pixels.data[i+2]=Math.round(grain*255);pixels.data[i+3]=255;
  }
  ctx.putImageData(pixels,0,0);
  detailTexture=new CanvasTexture(canvas);detailTexture.wrapS=detailTexture.wrapT=1000;
  detailTexture.anisotropy=8;detailTexture.needsUpdate=true;
  return detailTexture;
}

// Detail is projected in world space, so cliffs do not stretch their UVs.
export function geologicalMaterial(source,{scan=false,green=false}={}){
  const material=source?source.clone():new MeshStandardMaterial({color:0xffffff,roughness:.98,side:DoubleSide});
  const texture=rockTexture();if(!texture)return material;
  material.roughness=.94;
  material.onBeforeCompile=shader=>{
    shader.uniforms.quarryTexture={value:texture};
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
varying vec3 quarryWorld;
varying vec3 quarryNormal;`);
    shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
quarryWorld=(modelMatrix*vec4(transformed,1.0)).xyz;
quarryNormal=normalize(inverseTransformDirection(transformedNormal,viewMatrix));`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
uniform sampler2D quarryTexture;
varying vec3 quarryWorld;
varying vec3 quarryNormal;
vec3 quarryGrain(vec3 p){
  vec3 w=pow(abs(normalize(quarryNormal)),vec3(4.0));w/=max(dot(w,vec3(1.0)),.001);
  return texture2D(quarryTexture,p.yz).rgb*w.x+texture2D(quarryTexture,p.xz).rgb*w.y+texture2D(quarryTexture,p.xy).rgb*w.z;
}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
vec3 qFine=quarryGrain(quarryWorld*.18);
vec3 qMacro=quarryGrain(quarryWorld*.011);
float qSlope=1.0-abs(normalize(quarryNormal).y);
float qLayer=.5+.5*sin(quarryWorld.y*.62+qMacro.r*7.0+quarryWorld.x*.007);
vec3 qSoil=${green?'vec3(.22,.24,.17)':'vec3(.23,.18,.14)'};
vec3 qRock=${green?'vec3(.36,.37,.33)':'vec3(.34,.27,.205)'};
vec3 qStone=mix(qSoil,qRock,smoothstep(.10,.56,qSlope));
qStone*=.79+qFine.r*.46+qFine.b*.10;
qStone*=.87+qMacro.g*.23;
qStone*=1.0-(.12*qLayer+.07*(1.0-qFine.g))*smoothstep(.20,.60,qSlope);
${scan?'diffuseColor.rgb=mix(diffuseColor.rgb,qStone,.16+.10*qSlope)*(.81+qFine.r*.34+qFine.b*.035);':'diffuseColor.rgb=qStone;'}
`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
float qHeight=quarryGrain(quarryWorld*.18).r*.12;
vec3 qDx=dFdx(-vViewPosition),qDy=dFdy(-vViewPosition);
vec3 qR1=cross(qDy,normal),qR2=cross(normal,qDx);
float qDet=dot(qDx,qR1);
normal=normalize(abs(qDet)*normal-sign(qDet)*(dFdx(qHeight)*qR1+dFdy(qHeight)*qR2));`);
  };
  material.customProgramCacheKey=()=>`quarry-geology-v2-${scan}-${green}`;
  return material;
}

function lowerBound(a,v){let l=0,r=a.length-1;while(l<r){const m=(l+r)>>1;if(a[m]<v)l=m+1;else r=m;}return l;}
function axis(center){
  const a=[];for(let i=-176;i<=176;i++){
    const k=Math.abs(i),far=Math.max(0,k-80);
    a.push(center+Math.sign(i)*(Math.min(k,80)*8+far*8+far*far*.65));
  }return a;
}

export function sampleTerrainField(terrain,bounds){
  const xs=axis((bounds.minx+bounds.maxx)/2),zs=axis((bounds.minz+bounds.maxz)/2),n=xs.length;
  const heights=new Float32Array(n*n);heights.fill(NaN);
  terrain.updateMatrixWorld(true);
  terrain.traverse(o=>{
    const p=o.geometry?.getAttribute('position');if(!p)return;
    const positions=new Float32Array(p.count*3),v=new Vector3();
    for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);positions.set([v.x,v.y,v.z],i*3);}
    const index=o.geometry.index,count=index?index.count:p.count;
    for(let i=0;i<count;i+=3){
      const a=(index?index.getX(i):i)*3,b=(index?index.getX(i+1):i+1)*3,c=(index?index.getX(i+2):i+2)*3;
      const ax=positions[a],az=positions[a+2],bx=positions[b],bz=positions[b+2],cx=positions[c],cz=positions[c+2];
      const den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(den)<1e-7)continue;
      const x0=lowerBound(xs,Math.min(ax,bx,cx)),x1=lowerBound(xs,Math.max(ax,bx,cx));
      const z0=lowerBound(zs,Math.min(az,bz,cz)),z1=lowerBound(zs,Math.max(az,bz,cz));
      for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
        const u=((bz-cz)*(xs[x]-cx)+(cx-bx)*(zs[z]-cz))/den;
        const v=((cz-az)*(xs[x]-cx)+(ax-cx)*(zs[z]-cz))/den,w=1-u-v;
        if(u<-.001||v<-.001||w<-.001)continue;
        const h=u*positions[a+1]+v*positions[b+1]+w*positions[c+1],k=z*n+x;
        if(!Number.isFinite(heights[k])||h>heights[k])heights[k]=h;
      }
    }
  });
  const nearest=new Int32Array(n*n);nearest.fill(-1);const known=[];
  for(let i=0;i<heights.length;i++)if(Number.isFinite(heights[i])){nearest[i]=i;known.push(heights[i]);}
  if(!known.length)return null;
  const distance=(x,z,k)=>Math.hypot(xs[x]-xs[k%n],zs[z]-zs[(k/n)|0]);
  // Propagate nearest scan samples across a regular index grid; comparisons
  // use actual metres, including the progressively coarser distant cells.
  for(let pass=0;pass<4;pass++){
    const reverse=pass%2===1,start=reverse?n-1:0,end=reverse?-1:n,step=reverse?-1:1;
    for(let z=start;z!==end;z+=step)for(let x=start;x!==end;x+=step){
      const k=z*n+x;if(Number.isFinite(heights[k]))continue;
      let best=nearest[k],dist=best<0?Infinity:distance(x,z,best);
      for(const [dx,dz] of [[-step,0],[0,-step],[-step,-step],[step,-step]]){
        const xx=x+dx,zz=z+dz;if(xx<0||xx>=n||zz<0||zz>=n)continue;
        const candidate=nearest[zz*n+xx];if(candidate<0)continue;
        const d=distance(x,z,candidate);if(d<dist){best=candidate;dist=d;}
      }nearest[k]=best;
    }
  }
  known.sort((a,b)=>a-b);const plateau=known[Math.floor(known.length*.76)];
  const surface=new Float32Array(n*n),distances=new Float32Array(n*n);
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){
    const k=z*n+x;if(Number.isFinite(heights[k])){surface[k]=heights[k]-1.2;continue;}
    const near=nearest[k],d=near<0?8000:distance(x,z,near),edge=near<0?plateau:heights[near];distances[k]=d;
    const xx=xs[x],zz=zs[z],broad=fbm(xx*.0012+8,zz*.0012-5),ridges=1-Math.abs(2*fbm(xx*.0036,zz*.0036)-1);
    const drainage=Math.exp(-Math.abs(fbm(xx*.005+41,zz*.005-13)-.48)*36);
    const regional=plateau+12+(broad-.42)*350+ridges*72-drainage*24+(fbm(xx*.019,zz*.019)-.5)*22;
    surface[k]=mix(edge-1.2,regional,ease(d/480));
  }
  const next=new Float32Array(surface);
  for(let pass=0;pass<14;pass++){
    for(let z=1;z<n-1;z++)for(let x=1;x<n-1;x++){
      const k=z*n+x;if(Number.isFinite(heights[k])||distances[k]>850)continue;
      let sum=0,weight=0;
      for(const [dx,dz] of [[-1,0],[1,0],[0,-1],[0,1]]){
        const w=1/Math.pow(Math.hypot(xs[x+dx]-xs[x],zs[z+dz]-zs[z]),2);
        sum+=surface[(z+dz)*n+x+dx]*w;weight+=w;
      }
      next[k]=mix(surface[k],sum/weight,.55);
    }
    surface.set(next);
  }
  return {xs,zs,n,heights,surface,distances,plateau};
}

export function createNaturalLandscape(scene,oldPlane){
  const terrain=scene.terrainGroup.children.find(o=>o!==oldPlane);if(!terrain)return false;
  const bounds=scene.modelBounds(terrain),field=sampleTerrainField(terrain,bounds);if(!field)return false;
  const green=scene.map?.id==='altai',{xs,zs,n,heights,surface}=field,positions=[],indices=[];
  for(let z=0;z<n;z++)for(let x=0;x<n;x++)positions.push(xs[x],surface[z*n+x],zs[z]);
  const nearBoundary=(x,z)=>{
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
      const xx=x+dx,zz=z+dz;if(xx<0||zz<0||xx>=n||zz>=n||!Number.isFinite(heights[zz*n+xx]))return true;
    }return false;
  };
  for(let z=0;z<n-1;z++)for(let x=0;x<n-1;x++){
    const a=z*n+x,b=a+1,c=a+n,d=c+1;
    const edge=nearBoundary(x,z)||nearBoundary(x+1,z+1);
    if(edge||![a,c,b].every(i=>Number.isFinite(heights[i])))indices.push(a,c,b);
    if(edge||![b,c,d].every(i=>Number.isFinite(heights[i])))indices.push(b,c,d);
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const land=new Mesh(geometry,geologicalMaterial(null,{green}));land.name='natural-quarry-surroundings';land.userData.detailGeometry=true;land.userData.detailMaterial=true;scene.terrainGroup.add(land);
  decorateLandscape(scene,terrain,land,field,landNoise);
  terrain.traverse(o=>{if(o.isMesh){o.material=geologicalMaterial(o.material,{scan:true,green});o.userData.detailMaterial=true;}});
  addBoulders(scene,field,green);
  scene.naturalTerrain=field;oldPlane.visible=false;
  scene.scene.background=new Color('#bdd1d8');scene.scene.fog.color.set('#bdd1d8');
  return true;
}

function addBoulders(scene,field,green){
  const {xs,zs,n,surface,distances}=field,source=new IcosahedronGeometry(1,1),p=source.getAttribute('position'),positions=[];
  for(let z=2;z<n-2;z++)for(let x=2;x<n-2;x++){
    const k=z*n+x,d=distances[k];if(d<12||d>2200||hash(x*7,z*11)<.991||landNoise(x*.035,z*.035)<.45)continue;
    const size=1.1+Math.pow(hash(x+83,z-29),2)*8.5,spin=hash(x,z)*Math.PI*2;
    for(let i=0;i<p.count;i++){
      const vx=p.getX(i)*size,vz=p.getZ(i)*size*.8;
      positions.push(xs[x]+vx*Math.cos(spin)-vz*Math.sin(spin),surface[k]+p.getY(i)*size*.58+.15,zs[z]+vx*Math.sin(spin)+vz*Math.cos(spin));
    }
  }
  source.dispose();const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.computeVertexNormals();
  const rocks=new Mesh(geometry,geologicalMaterial(null,{green}));rocks.name='scattered-rock-outcrops';rocks.userData.detailGeometry=true;rocks.userData.detailMaterial=true;scene.terrainGroup.add(rocks);
}
