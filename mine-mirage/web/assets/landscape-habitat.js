import {M as Mesh,B as BufferGeometry,k as Float32BufferAttribute,j as MeshStandardMaterial,c as IcosahedronGeometry,o as CylinderGeometry,C as Color} from './three-vendor.js';

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
const hash=(x,z)=>{const n=Math.sin(x*127.1+z*311.7)*43758.5453;return n-Math.floor(n);};
const patchCache=new WeakMap();

// Find safe squares inside the photogrammetry atlas, avoiding its black UV gaps.
// Only UV rectangles are retained: the original photographs are reused directly.
function atlasPatches(texture){
  if(patchCache.has(texture))return patchCache.get(texture);
  const fallback={forest:[.687,.255,.035,.025],earth:[.446,.345,.025,.025],rock:[.45,.35,.025,.025]};
  const canvas=document.createElement('canvas');canvas.width=canvas.height=384;
  const ctx=canvas.getContext?.('2d');if(!ctx?.getImageData)return fallback;
  ctx.drawImage(texture.image,0,0,384,384);
  const pixels=ctx.getImageData(0,0,384,384).data,result={};
  for(const kind of ['forest','earth','rock']){
    const sizes=new Uint16Array(384*384);let best=0,bx=0,by=0;
    for(let y=1;y<383;y++)for(let x=1;x<383;x++){
      const k=y*384+x,i=k*4,r=pixels[i]/255,g=pixels[i+1]/255,b=pixels[i+2]/255,l=(r+g+b)/3;
      const valid=kind==='forest'?g>r*1.02&&g>b*1.12&&l>.09&&l<.36:
        kind==='earth'?r>g*.98&&g>b*1.04&&l>.28&&l<.78:
        Math.max(r,g,b)-Math.min(r,g,b)<.17&&l>.35&&l<.82;
      if(!valid)continue;
      const size=1+Math.min(sizes[k-1],sizes[k-384],sizes[k-385]);sizes[k]=size;
      if(size>best){best=size;bx=x;by=y;}
    }
    const inset=Math.min(1,best*.15);
    result[kind]=best>=4?[(bx-best+1+inset)/384,(by-best+1+inset)/384,(best-inset*2)/384,(best-inset*2)/384]:fallback[kind];
  }
  patchCache.set(texture,result);return result;
}

function coverAt(x,z,noise){
  return noise(x*.0037+19,z*.0037-7)*.58+noise(x*.013-8,z*.013+5)*.29+noise(x*.041,z*.041)*.13;
}

function shadeLandscape(terrain,land,green){
  let texture;terrain.traverse(o=>{if(!texture&&o.material?.map)texture=o.material.map;});
  const patches=texture?atlasPatches(texture):null,material=land.material,baseCompile=material.onBeforeCompile;
  material.onBeforeCompile=shader=>{
    baseCompile(shader);
    if(texture){
      shader.uniforms.habitatAtlas={value:texture};
      for(const kind of ['forest','earth','rock'])shader.uniforms[`${kind}Patch`]={value:patches[kind]};
    }
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
attribute float habitatCover;
varying float habitatDensity;`);
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
habitatDensity=habitatCover;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
varying float habitatDensity;
${texture?`uniform sampler2D habitatAtlas;
uniform vec4 forestPatch;
uniform vec4 earthPatch;
uniform vec4 rockPatch;
vec2 habitatHash(vec2 p){return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);}
vec3 habitatTile(vec4 rect,vec2 p,vec2 cell){
  vec2 r=habitatHash(cell),a=abs(fract(mat2(cos(r.x*6.28),-sin(r.x*6.28),sin(r.x*6.28),cos(r.x*6.28))*p*.5+r)*2.0-1.0);
  return texture2D(habitatAtlas,rect.xy+a*rect.zw).rgb;
}
vec3 habitatPhoto(vec4 rect,vec2 p){
  vec2 cell=floor(p*.38),f=smoothstep(0.0,1.0,fract(p*.38));
  return mix(mix(habitatTile(rect,p,cell),habitatTile(rect,p,cell+vec2(1,0)),f.x),mix(habitatTile(rect,p,cell+vec2(0,1)),habitatTile(rect,p,cell+vec2(1,1)),f.x),f.y);
}`:''}`);
    shader.fragmentShader=shader.fragmentShader.replace('diffuseColor.rgb=qStone;',`
float hCover=smoothstep(.30,.60,habitatDensity+qFine.g*.10-.05);
float hStone=smoothstep(.15,.52,qSlope);
vec3 hEarth=${texture?'habitatPhoto(earthPatch,quarryWorld.xz*.055)':'qSoil'};
vec3 hRock=${texture?'habitatPhoto(rockPatch,(quarryWorld.xz+quarryWorld.y*.7)*.043)':'qRock'};
vec3 hWood=${texture&&green?'habitatPhoto(forestPatch,quarryWorld.xz*.060)':'vec3(.13,.135,.065)'};
${green?'hWood*=.54+.22*qFine.r;':'hWood=mix(hEarth,vec3(.12,.10,.048),.43);hCover*=.46;'}
vec3 hGround=mix(mix(hEarth,hRock,.24)*(.65+qFine.r*.32),hWood,hCover);
hGround=mix(hGround,hRock*(.65+.30*qFine.g),hStone);
hGround*=.83+qMacro.r*.30;
diffuseColor.rgb=hGround;`);
  };
  material.customProgramCacheKey=()=>`quarry-habitat-v1-${green}-${!!texture}`;
  material.needsUpdate=true;
  material.userData.atlasPatches=patches;
  material.userData.habitatAtlas=texture;
}

function locate(axis,value){
  let a=0,b=axis.length-1;while(a<b){const m=(a+b)>>1;if(axis[m]<value)a=m+1;else b=m;}return Math.max(0,a-1);
}
export function sampleLandscapeSurface(field,x,z){
  const {xs,zs,n,surface,heights,distances}=field;
  if(x<xs[0]||x>=xs[n-1]||z<zs[0]||z>=zs[n-1])return null;
  const ix=locate(xs,x),iz=locate(zs,z),k=iz*n+ix;
  const u=(x-xs[ix])/(xs[ix+1]-xs[ix]),v=(z-zs[iz])/(zs[iz+1]-zs[iz]);
  const blend=a=>a[k]*(1-u)*(1-v)+a[k+1]*u*(1-v)+a[k+n]*(1-u)*v+a[k+n+1]*u*v;
  const slope=Math.hypot((surface[k+1]-surface[k])/(xs[ix+1]-xs[ix]),(surface[k+n]-surface[k])/(zs[iz+1]-zs[iz]));
  return {y:blend(surface),distance:blend(distances),slope,onScan:[k,k+1,k+n,k+n+1].some(i=>Number.isFinite(heights[i]))};
}

function addWoodland(scene,field,noise,green,groundMaterial){
  const leafSource=new IcosahedronGeometry(1,0),nearLeafSource=new IcosahedronGeometry(1,1),trunkSource=new CylinderGeometry(.13,.23,1,5,1),trunkGeometry=trunkSource.toNonIndexed();
  const leaves=leafSource.getAttribute('position'),nearLeaves=nearLeafSource.getAttribute('position'),trunk=trunkGeometry.getAttribute('position');
  const batches=new Map(),samples=[],cx=(field.xs[0]+field.xs.at(-1))/2,cz=(field.zs[0]+field.zs.at(-1))/2;
  const foliage=new MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0});
  if(green&&groundMaterial.userData.habitatAtlas){
    foliage.onBeforeCompile=shader=>{
      shader.uniforms.groveAtlas={value:groundMaterial.userData.habitatAtlas};
      shader.uniforms.grovePatch={value:groundMaterial.userData.atlasPatches.forest};
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
varying vec3 groveWorld;`).replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
groveWorld=(modelMatrix*vec4(transformed,1.0)).xyz;`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
varying vec3 groveWorld;
uniform sampler2D groveAtlas;
uniform vec4 grovePatch;`).replace('#include <color_fragment>',`#include <color_fragment>
vec2 groveUV=abs(fract(groveWorld.xz*.12+groveWorld.y*.07)*2.0-1.0);
vec3 grovePhoto=texture2D(groveAtlas,grovePatch.xy+groveUV*grovePatch.zw).rgb;
diffuseColor.rgb*=clamp(.40+dot(grovePhoto,vec3(.22,.70,.08))*7.0,.45,1.45);`);
    };
    foliage.customProgramCacheKey=()=> 'quarry-photo-foliage-v1';
  }
  const stemColor=new Color('#534b36'),baseColor=new Color();
  const append=(batch,p,x,y,z,sx,sy,sz,color,spin,seed)=>{
    const c=Math.cos(spin),s=Math.sin(spin);
    for(let i=0;i<p.count;i++){
      const jitter=.88+hash(i%13+seed,seed)*.23,vx=p.getX(i)*sx*jitter,vz=p.getZ(i)*sz*jitter;
      batch.positions.push(x+vx*c-vz*s,y+p.getY(i)*sy*jitter,z+vx*s+vz*c);
      const shade=.64+.36*clamp((p.getY(i)+1)*.5);
      batch.colors.push(color.r*shade,color.g*shade,color.b*shade);
      const nx=p.getX(i)/sx,ny=p.getY(i)/sy,nz=p.getZ(i)/sz,length=Math.hypot(nx,ny,nz)||1;
      batch.normals.push((nx*c-nz*s)/length,ny/length,(nx*s+nz*c)/length);
    }
  };
  // Jittered clusters, with clearings; never place new vegetation on the scan
  // or on operational roads. Farther hills are carried by the same photo material.
  for(let z=cz-2450;z<cz+2450;z+=17)for(let x=cx-2450;x<cx+2450;x+=17){
    const xx=x+(hash(x,z)-.5)*15,zz=z+(hash(z,x)-.5)*15,p=sampleLandscapeSurface(field,xx,zz);
    if(!p||p.onScan||p.distance<12||p.distance>2200||p.slope>.75)continue;
    const cover=coverAt(xx,zz,noise),prob=green?smooth(.38,.62,cover)*.85:smooth(.46,.73,cover)*.14;
    if(hash(x+211,z-719)>prob)continue;
    const key=`${Math.floor(xx/320)},${Math.floor(zz/320)}`;
    if(!batches.has(key))batches.set(key,{positions:[],colors:[],normals:[]});
    const batch=batches.get(key),seed=hash(x-7,z+41),tree=green&&seed>.25;
    const height=tree?5.8+seed*7.2:1.0+seed*2.3,radius=tree?4.3+seed*3.2:2.2+seed*2.5;
    baseColor.setHSL(green?.235+seed*.04:.18,.22+seed*.15,green?.045+seed*.055:.13+seed*.06);
    if(tree)append(batch,trunk,xx,p.y+height*.38,zz,1,height*.76,1,stemColor,0,3);
    const lobes=tree?3:2;
    for(let l=0;l<lobes;l++){
      const a=l/lobes*Math.PI*2+seed*9,r=l?radius*.46:0;
      append(batch,p.distance<500?nearLeaves:leaves,xx+Math.cos(a)*r,p.y+height*(l?.59:.73),zz+Math.sin(a)*r,radius*(l?.75:1),height*(l?.32:.40),radius*(l?.80:1),baseColor,a,seed*83+l);
    }
    samples.push({x:xx,y:p.y,z:zz,height});
  }
  leafSource.dispose();nearLeafSource.dispose();trunkSource.dispose();trunkGeometry.dispose();
  for(const [key,batch] of batches){
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(batch.positions,3));geometry.setAttribute('color',new Float32BufferAttribute(batch.colors,3));geometry.setAttribute('normal',new Float32BufferAttribute(batch.normals,3));geometry.computeBoundingSphere();
    const plants=new Mesh(geometry,foliage);plants.name=`landscape-woodland-${key}`;plants.userData.detailGeometry=true;plants.userData.detailMaterial=true;scene.terrainGroup.add(plants);
  }
  if(!batches.size)foliage.dispose();
  scene.landscapeVegetation=samples;
}

export function decorateLandscape(scene,terrain,land,field,noise){
  const green=scene.map?.id==='altai',cover=new Float32Array(field.n*field.n);
  for(let z=0;z<field.n;z++)for(let x=0;x<field.n;x++)cover[z*field.n+x]=coverAt(field.xs[x],field.zs[z],noise);
  land.geometry.setAttribute('habitatCover',new Float32BufferAttribute(cover,1));
  shadeLandscape(terrain,land,green);
  addWoodland(scene,field,noise,green,land.material);
}
