import {G as Group,M as Mesh,B as BufferGeometry,k as Float32BufferAttribute,j as MeshStandardMaterial,q as BoxGeometry,o as CylinderGeometry,e as DoubleSide} from './three-vendor.js';
import {geologicalMaterial,landNoise} from './terrain-natural.js';
import {installGroundedWorksite} from './excavator-ground.js';

const shellMaterial=new MeshStandardMaterial({color:0x695a41,metalness:.55,roughness:.61,side:DoubleSide});
const innerMaterial=new MeshStandardMaterial({color:0x4c4941,metalness:.47,roughness:.72,side:DoubleSide});
const edgeMaterial=new MeshStandardMaterial({color:0x9da19c,metalness:.74,roughness:.38,side:DoubleSide});
const sideMaterial=new MeshStandardMaterial({color:0xb18a36,metalness:.38,roughness:.66,side:DoubleSide});
const box=new BoxGeometry(1,1,1),pin=new CylinderGeometry(.17,.17,1,14);
let shellGeometry,cheekGeometry,toothGeometry;
const meshFromTriangles=positions=>{const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));g.computeVertexNormals();return g;};

function bucketShell(){
  if(shellGeometry)return shellGeometry;
  // Cross section of a deep, curved scoop. The opening is deliberately empty.
  const profile=[[.42,-.40],[-.25,-.52],[-.80,-.30],[-1.08,.13],[-1.06,.66],[-.83,1.22],[-.48,1.80]];
  const positions=[];
  const quad=(a,b,c,d)=>{for(const p of [a,b,c,a,c,d])positions.push(...p);};
  for(let i=0;i<profile.length-1;i++){
    const [y,z]=profile[i],[yy,zz]=profile[i+1];
    quad([-1.06,y,z],[1.06,y,z],[1.06,yy,zz],[-1.06,yy,zz]);
    quad([-.96,y+.10,z+.04],[-.96,yy+.10,zz+.04],[.96,yy+.10,zz+.04],[.96,y+.10,z+.04]);
  }
  shellGeometry=meshFromTriangles(positions);
  shellGeometry.clearGroups();shellGeometry.addGroup(0,positions.length/3,0);
  return shellGeometry;
}
function bucketCheeks(){
  if(cheekGeometry)return cheekGeometry;
  const outline=[[.49,-.39],[-.25,-.57],[-.84,-.34],[-1.16,.12],[-1.13,.72],[-.89,1.29],[-.43,1.84],[.27,1.06]],positions=[];
  for(const side of [-1,1]){
    for(const x of [side*.96,side*1.09])for(let i=0;i<outline.length;i++){
      const a=outline[i],b=outline[(i+1)%outline.length];
      for(const p of [[x,-.32,.52],[x,...a],[x,...b]])positions.push(...p);
    }
    for(let i=0;i<outline.length;i++){
      const [y,z]=outline[i],[yy,zz]=outline[(i+1)%outline.length],a=[side*.96,y,z],b=[side*1.09,y,z],c=[side*1.09,yy,zz],d=[side*.96,yy,zz];
      for(const p of [a,b,c,a,c,d])positions.push(...p);
    }
  }
  cheekGeometry=meshFromTriangles(positions);return cheekGeometry;
}
function bucketTooth(){
  if(toothGeometry)return toothGeometry;
  const points=[[-.14,-.08,0],[.14,-.08,0],[.14,.10,0],[-.14,.10,0],[-.10,-.03,.56],[.10,-.03,.56],[.10,.01,.56],[-.10,.01,.56]];
  const quads=[[0,1,2,3],[0,4,5,1],[3,2,6,7],[0,3,7,4],[1,5,6,2],[4,7,6,5]],positions=[];
  for(const [a,b,c,d] of quads)for(const k of [a,b,c,a,c,d])positions.push(...points[k]);
  toothGeometry=meshFromTriangles(positions);return toothGeometry;
}

export function installDeepBucket(asset){
  const pivot=asset.pivots['excavator-bucket-pivot'];if(!pivot)return;
  for(const child of pivot.children)if(child.name==='curved-bucket'||child.name==='bucket-teeth')child.visible=false;
  // Backhoe opening and teeth face the machine; the shell's authoring axis is +Z.
  const group=new Group();group.name='deep-rock-bucket';group.rotation.y=Math.PI;pivot.add(group);
  const shell=new Mesh(bucketShell(),innerMaterial);group.add(shell);
  group.add(new Mesh(bucketCheeks(),sideMaterial));
  const lip=new Mesh(box,edgeMaterial);lip.name='bucket-cutting-edge';lip.position.set(0,-.45,1.76);lip.scale.set(2.22,.15,.27);lip.rotation.x=-.3;group.add(lip);
  for(let i=0;i<5;i++){
    const tooth=new Mesh(bucketTooth(),edgeMaterial);tooth.position.set(-.85+i*.425,-.47,1.81);tooth.rotation.x=.13;group.add(tooth);
  }
  // Longitudinal wear strips, hinge cheeks and a transverse pivot pin.
  for(const x of [-.67,0,.67]){
    const rib=new Mesh(box,shellMaterial);rib.scale.set(.12,.12,1.20);rib.position.set(x,-1.12,.48);rib.rotation.x=-.03;group.add(rib);
  }
  for(const x of [-.32,.32]){
    const ear=new Mesh(box,sideMaterial);ear.scale.set(.14,.65,.52);ear.position.set(x,.17,-.14);group.add(ear);
  }
  const axle=new Mesh(pin,edgeMaterial);axle.rotation.z=Math.PI/2;axle.position.set(0,.20,-.13);group.add(axle);
  asset.detail.bucketShell=group;
  if(asset.detail.dirt){group.add(asset.detail.dirt);asset.detail.dirt.position.set(0,-.55,.68);asset.detail.dirt.scale.set(1.27,.60,1.22);}
}

export function improveDiggingPad(scene,asset){
  for(const child of asset.root.children){
    const p=child.geometry?.parameters;
    if(p&&(p.width===34||p.width===33||p.radius===8))child.visible=false;
  }
  if(installGroundedWorksite(scene,asset))return;
  const positions=[],indices=[],rings=8,segments=64;
  for(let r=0;r<=rings;r++)for(let i=0;i<=segments;i++){
    const a=i/segments*Math.PI*2,t=r/rings,edge=1+.045*Math.sin(a*7)+.025*Math.cos(a*13);
    const x=Math.cos(a)*23*t*edge,z=Math.sin(a)*19*t*edge;
    const skirt=Math.max(0,(t-.63)/.37),y=-.12-skirt*skirt*3.35+(landNoise(x*.5,z*.5)-.5)*.12;
    positions.push(x,y,z);
    if(r<rings&&i<segments){const k=r*(segments+1)+i;indices.push(k,k+segments+1,k+1,k+1,k+segments+1,k+segments+2);}
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const material=geologicalMaterial(null,{green:scene.map?.id==='altai'}),pad=new Mesh(geometry,material);
  pad.name='compacted-working-ground';pad.userData.detailGeometry=true;pad.userData.detailMaterial=true;asset.root.add(pad);
  const pilePositions=[],pileIndices=[],radial=14,slices=40;
  for(let r=0;r<=radial;r++)for(let i=0;i<=slices;i++){
    const a=i/slices*Math.PI*2,t=r/radial,x=Math.cos(a)*12*t,z=Math.sin(a)*8*t;
    const y=Math.max(0,(1-t*t)*5.4)+(landNoise(x*.45,z*.45)-.5)*1.15*(1-t);
    pilePositions.push(x-16,y-.05,z-6);
    if(r<radial&&i<slices){const k=r*(slices+1)+i;pileIndices.push(k,k+slices+1,k+1,k+1,k+slices+1,k+slices+2);}
  }
  const pileGeo=new BufferGeometry();pileGeo.setAttribute('position',new Float32BufferAttribute(pilePositions,3));pileGeo.setIndex(pileIndices);pileGeo.computeVertexNormals();
  const pileMaterial=geologicalMaterial(null),pile=new Mesh(pileGeo,pileMaterial);pile.name='broken-rock-stockpile';pile.userData.detailGeometry=true;pile.userData.detailMaterial=true;asset.root.add(pile);
}
