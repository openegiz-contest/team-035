// Minimal offline glTF 2.0 / GLB loader for uncompressed geometry used in this project.
// Keeps scene hierarchy (including excavator's movable pivots), without any CDN requests.
import {G as Group,M as Mesh,B as BufferGeometry,k as Float32BufferAttribute,j as MeshStandardMaterial,e as DoubleSide,l as CanvasTexture} from './three-vendor.js';
const NUM_COMPONENTS={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
const CTORS={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array};
const SIZE={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
function readAccessor(json,binary,index){
  const a=json.accessors[index], view=json.bufferViews[a.bufferView];
  if(!a||!view)throw Error('GLB accessor missing '+index);
  const size=NUM_COMPONENTS[a.type],Ctor=CTORS[a.componentType];
  const offset=(view.byteOffset||0)+(a.byteOffset||0);
  const count=a.count*size;
  const byteStride=view.byteStride||size*SIZE[a.componentType];
  if(!Ctor)throw Error('GLB component type unsupported: '+a.componentType);
  const out=new Ctor(count),buf=new DataView(binary,offset);
  if(byteStride===size*SIZE[a.componentType] && offset%SIZE[a.componentType]===0){out.set(new Ctor(binary,offset,count));}
  else {
    const getters={5120:'getInt8',5121:'getUint8',5122:'getInt16',5123:'getUint16',5125:'getUint32',5126:'getFloat32'};
    for(let i=0;i<a.count;i++)for(let k=0;k<size;k++)out[i*size+k]=buf[getters[a.componentType]](i*byteStride+k*SIZE[a.componentType],true);
  }
  return {array:out,items:size,normalized:!!a.normalized};
}
export async function loadModel(url){
  const response=await fetch(url);
  if(!response.ok)throw Error('GLB download failed: '+response.status+' '+url);
  const buffer=await response.arrayBuffer(),dv=new DataView(buffer);
  if(dv.getUint32(0,true)!==0x46546c67)throw Error('Not a GLB model: '+url);
  let pos=12,json=null,binary=null;
  while(pos<buffer.byteLength){
    const len=dv.getUint32(pos,true),type=dv.getUint32(pos+4,true);
    if(type===0x4e4f534a)json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,pos+8,len)));
    if(type===0x004e4942)binary=buffer.slice(pos+8,pos+8+len);
    pos+=len+8;
  }
  if(!json||!binary)throw Error('GLB missing JSON or geometry');
  const materials=(json.materials||[]).map(m=>{
    const p=m.pbrMetallicRoughness||{},rgba=p.baseColorFactor||[.8,.8,.8,1];
    return new MeshStandardMaterial({color:0xffffff,roughness:p.roughnessFactor??.83,metalness:p.metallicFactor??.05,transparent:rgba[3]<.999,opacity:rgba[3],side:m.doubleSided?DoubleSide:0,
    emissive: m.emissiveFactor?0x101515:0x000000});
  });
  materials.forEach((material,i)=>{
    const c=json.materials[i].pbrMetallicRoughness?.baseColorFactor||[.8,.8,.8];
    material.color.setRGB(c[0],c[1],c[2]);
  });

  // glTF images are embedded in this GLB; older loader omitted them completely.
  // Decoding material.baseColorTexture restores the original quarry's photo texture.
  const imageTextures=await Promise.all((json.images||[]).map(async img=>{
    if(img.bufferView===undefined)return null;
    const view=json.bufferViews[img.bufferView];
    const blob=new Blob([binary.slice(view.byteOffset||0,(view.byteOffset||0)+view.byteLength)],{type:img.mimeType||'image/png'});
    let source;
    try{
      if(typeof createImageBitmap==='function')source=await createImageBitmap(blob);
      else source=await new Promise((resolve,reject)=>{const url=URL.createObjectURL(blob);const im=new Image();im.onload=()=>{URL.revokeObjectURL(url);resolve(im)};im.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Image decode failed'))};im.src=url;});
      const canvas=document.createElement('canvas');
      const terrainTexture=/(?:open_pit_mine|mining_quarry)\.glb(?:$|[?#])/.test(url);
      const max=terrainTexture?4096:2048,ratio=Math.min(1,max/Math.max(source.width,source.height));
      canvas.width=Math.max(1,Math.round(source.width*ratio));canvas.height=Math.max(1,Math.round(source.height*ratio));
      canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);
      if(typeof source.close==='function')source.close();
      const texture=new CanvasTexture(canvas);texture.flipY=false;texture.colorSpace='srgb';texture.needsUpdate=true;
      if(terrainTexture)texture.anisotropy=8;
      return texture;
    }catch(error){console.warn('GLB texture decode failure',error);return null;}
  }));
  materials.forEach((material,i)=>{
    const pbr=json.materials[i].pbrMetallicRoughness||{};
    if(pbr.baseColorTexture){const tex=json.textures?.[pbr.baseColorTexture.index];if(tex && imageTextures[tex.source])material.map=imageTextures[tex.source];}
    material.needsUpdate=true;
  });

  const meshes=(json.meshes||[]).map(mesh=>{
    const root=new Group();root.name=mesh.name||'mesh';
    (mesh.primitives||[]).forEach((p,i)=>{
      if(p.mode&&p.mode!==4)return;
      const geometry=new BufferGeometry();
      for(const [attr,slot] of Object.entries(p.attributes)){
        if(!['POSITION','NORMAL','TEXCOORD_0','COLOR_0'].includes(attr))continue;
        const a=readAccessor(json,binary,slot);
        const name={POSITION:'position',NORMAL:'normal',TEXCOORD_0:'uv',COLOR_0:'color'}[attr];
        // A glTF normalized UBYTE color of [231,184,62] means RGB in [0,1],
        // not the literal float [231,184,62]. Float32BufferAttribute does NOT
        // normalize values on its own, even with normalized=true.
        // This bug previously overexposed the entire drill rig to white.
        const factors={5120:127,5121:255,5122:32767,5123:65535,5125:4294967295};
        const type=json.accessors[slot].componentType;
        const denom=a.normalized?factors[type]:null;
        const values=denom?Float32Array.from(a.array,v=>Math.max(type===5120||type===5122?-1:0,v/denom)):a.array;
        geometry.setAttribute(name,new Float32BufferAttribute(values,a.items,false));
      }
      if(p.indices!==undefined)geometry.setIndex(Array.from(readAccessor(json,binary,p.indices).array));
      if(!geometry.getAttribute('normal'))geometry.computeVertexNormals();
      const baseMaterial=materials[p.material]||new MeshStandardMaterial({color:'#b8b4a9'});
      const material=geometry.getAttribute('color') ? baseMaterial.clone() : baseMaterial;
      if(geometry.getAttribute('color')){material.vertexColors=true;material.needsUpdate=true;}
      const mesh3d=new Mesh(geometry,material);
      mesh3d.castShadow=false;mesh3d.receiveShadow=true;mesh3d.name=(mesh.name||'part')+'_'+i;
      root.add(mesh3d);
    });
    return root;
  });
  const objects=(json.nodes||[]).map((n,i)=>{
    const o=new Group();o.name=n.name||`node-${i}`;
    if(n.matrix){o.matrix.fromArray(n.matrix);o.matrix.decompose(o.position,o.quaternion,o.scale);}
    if(n.translation)o.position.set(...n.translation);
    if(n.rotation)o.quaternion.set(...n.rotation);
    if(n.scale)o.scale.set(...n.scale);
    if(n.mesh!==undefined)o.add(meshes[n.mesh]);
    return o;
  });
  (json.nodes||[]).forEach((n,i)=>(n.children||[]).forEach(child=>objects[i].add(objects[child])));
  const scene=new Group();scene.name='GLB:'+url;
  const roots=json.scenes?.[json.scene||0]?.nodes||[0];roots.forEach(id=>scene.add(objects[id]));
  return scene;
}
