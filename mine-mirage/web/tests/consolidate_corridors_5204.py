"""Lay a shared, connected haul-road masterplan rather than 34 independent crisscross ribbons.
Logical dispatch edges are remapped onto the canonical physical centerlines.
"""
import json,math,heapq
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
for name in ['saryarka','altai']:
 p=ROOT/'live/maps'/f'{name}.js'
 txt=p.read_text();m=json.loads(txt.split('export default ',1)[1].strip().rstrip(';'))
 edges=m['edges'];nodes=m['nodes']
 parent={n['id']:n['id'] for n in nodes}
 def find(x):
  while parent[x]!=x:
   parent[x]=parent[parent[x]];x=parent[x]
  return x
 def union(a,b):
  a=find(a);b=find(b)
  if a==b:return False
  parent[b]=a;return True
 selected=set()
 # prefer good gentle roads that avoid long detours, then minimally bridge otherwise
 for e in sorted(edges,key=lambda e:e['lengthM']*(1+min(1.2,(e['maxGradePct']/40))*.23)):
  if union(e['fromNode'],e['toNode']):selected.add(e['id'])
 # Add a few extra bypass corridors, not the old all-to-all spiderweb.
 for e in sorted(edges,key=lambda e:(e['maxGradePct']>16,e['lengthM'])):
  if len(selected)>=23:break
  if e['id'] not in selected:selected.add(e['id'])
 physical=[e for e in edges if e['id'] in selected]
 if len(physical)<len(nodes)-1:raise RuntimeError('Disconnected physical network')
 g={n['id']:[] for n in nodes}
 for e in physical:
  g[e['fromNode']].append((e['toNode'],e));g[e['toNode']].append((e['fromNode'],e))
 def physical_route(a,b):
  pq=[(0,a)];dist={a:0};prev={};seen=set()
  while pq:
   _,node=heapq.heappop(pq)
   if node in seen:continue
   seen.add(node)
   if node==b:break
   for to,e in g[node]:
    cost=e['lengthM']*(1+max(0,e['maxGradePct']-12)/55)
    dd=dist[node]+cost
    if dd<dist.get(to,1e30):dist[to]=dd;prev[to]=(node,e);heapq.heappush(pq,(dd,to))
  if b not in prev and a!=b:raise RuntimeError((name,a,b))
  legs=[];cur=b
  while cur!=a:
   before,e=prev[cur];legs.append((before,cur,e));cur=before
  legs.reverse();out=[]
  for u,v,e in legs:
   segment=e['path'] if u==e['fromNode'] else e['path'][::-1]
   out.extend(segment if not out else segment[1:])
  return out,legs
 for e in edges:
  if e['id'] in selected:continue
  new,legs=physical_route(e['fromNode'],e['toNode'])
  if len(new)>470:
   # Preserve exact starts and ends; reduce sample density only where network API requires it.
   stride=math.ceil((len(new)-1)/455)
   new=new[::stride]+([new[-1]] if new[::stride][-1]!=new[-1] else [])
  e['path']=new
  seg=[(new[i],new[i+1]) for i in range(len(new)-1)]
  e['lengthM']=round(sum(math.dist(a,b) for a,b in seg),1)
  e['maxGradePct']=round(max((abs(b[2]-a[2])/max(1,math.hypot(b[0]-a[0],b[1]-a[1]))*100 for a,b in seg),default=0),1)
  e['viaCorridors']=[z['id'] for u,v,z in legs]
  if e['maxGradePct']>16:e['unverifiedSlope']=True
  else:e.pop('unverifiedSlope',None)
 # physical roads only, while routing engine uses ALL logical edges mapped onto shared centerlines
 m['visualRoads']=[{'id':e['id'],'path':e['path'],'maxGradePct':e['maxGradePct']} for e in physical]
 m['sceneDefinition']['roadNetwork']='23 shared physical roads; 34 dispatch links snap to these corridors'
 m['description']='Единая сеть реальных поверхностных коридоров; логические маршруты используют общую дорожную геометрию. Небезопасные уклоны требуют проверки.'
 p.write_text('/* 5204: shared mesh-fitted road network. */\nexport default '+json.dumps(m,ensure_ascii=False,separators=(',',':'))+';\n')
 print(name,'physical',len(physical),'logical',len(edges),'longest',max(len(e['path']) for e in edges))
