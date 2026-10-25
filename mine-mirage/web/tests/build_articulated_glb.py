"""Repack haul-truck GLB into 8 animated parts with baked vertex color, preserving pivots.
The geometry is unchanged in world coordinates at rest, but moving parts remain separate.
"""
import json, struct, pathlib, numpy as np

base=pathlib.Path(__file__).resolve().parents[1]
src=base/'models/haul-truck.glb'
dst=base/'models/haul-truck-rigged-optimized.glb'
b=src.read_bytes(); assert b[:4]==b'glTF'
js_len, js_type=struct.unpack_from('<II',b,12); assert js_type==0x4e4f534a
j=json.loads(b[20:20+js_len]); pos=20+js_len
bin_len, bin_type=struct.unpack_from('<II',b,pos);assert bin_type==0x004e4942
binary=b[pos+8:pos+8+bin_len]

sizes={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}
types={5126:np.float32,5125:np.uint32,5123:np.uint16,5121:np.uint8}

def accessor(idx):
 a=j['accessors'][idx];v=j['bufferViews'][a['bufferView']]
 dt=np.dtype(types[a['componentType']]).newbyteorder('<')
 count=a['count']; n=sizes[a['type']]
 off=v.get('byteOffset',0)+a.get('byteOffset',0)
 stride=v.get('byteStride',dt.itemsize*n)
 result=np.ndarray((count,n),dtype=dt,buffer=binary,offset=off,strides=(stride,dt.itemsize)).copy()
 return result[:,0] if n==1 else result

def node_matrix(node):
 if 'matrix' in node:return np.array(node['matrix'],dtype=float).reshape((4,4),order='F')
 t=np.eye(4);t[:3,3]=node.get('translation',[0,0,0])
 x,y,z,w=node.get('rotation',[0,0,0,1]); r=np.eye(4)
 r[:3,:3]=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
                    [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
                    [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
 s=np.diag([*node.get('scale',[1,1,1]),1]);return t@r@s

pivot_names={'dump-bed-pivot',*(f'wheel-pivot-{i}' for i in range(1,7))}
pivot_world={'body':np.eye(4)}
for_rec=[]
def walk(idx,parent=np.eye(4),part='body'):
 n=j['nodes'][idx];matrix=parent@node_matrix(n);name=n.get('name','')
 if name in pivot_names:
  part=name;pivot_world[part]=matrix
 if 'mesh' in n:
  for prim in j['meshes'][n['mesh']]['primitives']:
   for_rec.append((part,matrix,prim))
 for child in n.get('children',[]):walk(child,matrix,part)
for root in j['scenes'][j.get('scene',0)]['nodes']:walk(root)

out={p:{'pos':[],'normal':[],'color':[],'indices':[],'count':0} for p in ['body','dump-bed-pivot',*(f'wheel-pivot-{i}' for i in range(1,7))]}
for part,matrix,prim in for_rec:
 if prim.get('mode',4)!=4:continue
 data=out[part]
 local=np.linalg.inv(pivot_world[part])@matrix
 coords=accessor(prim['attributes']['POSITION']).astype(float)
 homo=np.concatenate([coords,np.ones((len(coords),1))],axis=1)
 positions=(homo@local.T)[:,:3].astype(np.float32)
 normals=accessor(prim['attributes']['NORMAL']).astype(float)
 normal_matrix=np.linalg.inv(local[:3,:3]).T
 normals=normals@normal_matrix.T
 normals=(normals/np.maximum(1e-8,np.linalg.norm(normals,axis=1,keepdims=True))).astype(np.float32)
 color=j['materials'][prim.get('material',0)]['pbrMetallicRoughness'].get('baseColorFactor',[0.7,0.7,0.7,1])[:3]
 colors=np.broadcast_to(color,positions.shape).astype(np.float32).copy()
 ind=(accessor(prim['indices']).astype(np.uint32) if 'indices' in prim else np.arange(len(positions),dtype=np.uint32))
 data['pos'].append(positions);data['normal'].append(normals);data['color'].append(colors)
 data['indices'].append(ind+data['count']);data['count']+=len(positions)

blob=bytearray();views=[];acc=[];meshes=[];nodes=[{'name':'Haul truck','children':list(range(1,9))}]
def pack(data,kind):
 ar=np.ascontiguousarray(data)
 pad=(-len(blob))%4;blob.extend(b'\x00'*pad)
 offset=len(blob);blob.extend(ar.tobytes())
 view_id=len(views);views.append({'buffer':0,'byteOffset':offset,'byteLength':ar.nbytes})
 type_name={'pos':'VEC3','normal':'VEC3','color':'VEC3','indices':'SCALAR'}[kind]
 rec={'bufferView':view_id,'componentType':5125 if kind=='indices' else 5126,'count':len(ar),'type':type_name}
 if kind=='pos':
  rec['min']=ar.min(axis=0).tolist();rec['max']=ar.max(axis=0).tolist()
 idx=len(acc);acc.append(rec);return idx

for part,data in out.items():
 if not data['count']:continue
 positions=np.concatenate(data['pos']);normals=np.concatenate(data['normal']);colors=np.concatenate(data['color']);indices=np.concatenate(data['indices'])
 mesh_id=len(meshes)
 meshes.append({'name':part,'primitives':[{'attributes':{'POSITION':pack(positions,'pos'),'NORMAL':pack(normals,'normal'),'COLOR_0':pack(colors,'color')},'indices':pack(indices,'indices'),'material':0,'mode':4}]})
 world=pivot_world[part];name=part
 node={'name':name,'mesh':mesh_id}
 if part!='body':node['matrix']=world.T.flatten().tolist()
 nodes.append(node)
 print(part,'verts',len(positions),'triangles',len(indices)//3)

jout={'asset':{'version':'2.0','generator':'MIRAGE Articulated GLB Optimizer'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':nodes,'meshes':meshes,
      'materials':[{'name':'Baked industrial materials','pbrMetallicRoughness':{'baseColorFactor':[1,1,1,1],'metallicFactor':0.1,'roughnessFactor':0.8}}],
      'accessors':acc,'bufferViews':views,'buffers':[{'byteLength':len(blob)}]}
jsb=json.dumps(jout,separators=(',',':')).encode();jsb+=b' '*((-len(jsb))%4)
blob+=b'\x00'*((-len(blob))%4)
parts=[struct.pack('<II',len(jsb),0x4e4f534a)+jsb,struct.pack('<II',len(blob),0x004e4942)+blob]
size=12+sum(len(p) for p in parts)
dst.write_bytes(struct.pack('<4sII',b'glTF',2,size)+b''.join(parts))
print('wrote',dst, 'bytes',size)
