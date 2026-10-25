"""Generate a physically planned mine: a predesigned spiral haul road and spurs.
The graph retains original entity IDs, scenarios and connectivity, while its
nodes and edge polylines are rebuilt from the quarry master plan.
"""
import json, math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PARAM = {
    'saryarka': dict(cx=-40, cz=0, inner=95, outer=630, stretch=.79,
                     turns=1.52, initial=-2.70, bottom=-118, top=36,
                     fleetSize=12, radiusX=940, radiusZ=790),
    'altai': dict(cx=-40, cz=0, inner=108, outer=770, stretch=.78,
                 turns=1.68, initial=-2.85, bottom=-152, top=55,
                 fleetSize=14, radiusX=1115, radiusZ=950),
}
S = {'face-north':.055, 'west-n':.12, 'face-south':.215, 'west-s':.27,
     'ramp-n':.335, 'ramp-s':.405, 'depot':.465, 'central':.505,
     'refuge':.555, 'north-cross':.625, 'south-cross':.69, 'east-low':.74,
     'fuel':.782, 'east-mid':.805, 'substation':.846, 'east-high':.866,
     'weigh':.89, 'crusher-a':.94, 'workshop':.965, 'crusher-b':.995}
SPUR = {'face':-31,'crusher':83,'workshop':78,'depot':55,'fuel':72,'refuge':52,
        'power':75,'weigh':55,'junction':0}

def spiral(s,p):
    angle = p['initial']+math.tau*p['turns']*s
    radius = p['inner']+(p['outer']-p['inner'])*s
    x = p['cx']+radius*math.cos(angle)
    z = p['cz']+radius*math.sin(angle)*p['stretch']
    elev = p['bottom']+(p['top']-p['bottom'])*s
    return x,z,elev

def position(s, kind, p):
    x,z,y=spiral(s,p)
    dx=x-p['cx']; dz=(z-p['cz'])/(p['stretch']**2)
    l=math.hypot(dx,dz) or 1
    spur=SPUR[kind]
    return (x+dx/l*spur,z+dz/l*spur,y + (1.1 if kind in ['workshop','crusher','fuel'] else 0))

def distance3(a,b):
    return math.sqrt(sum((u-v)**2 for u,v in zip(a,b)))

def edge_path(a,b,sa,sb,p):
    rev = sb<sa
    lo,hi=(sb,sa) if rev else (sa,sb)
    samples = max(5,int((hi-lo)*180))
    route=[spiral(lo,p)]
    route += [spiral(lo+(hi-lo)*k/samples,p) for k in range(1,samples)]
    route.append(spiral(hi,p))
    if rev:route.reverse()
    path=[a]+route+[b]
    out=[]
    for x,z,y in path:
        pt=[round(x,3),round(z,3),round(y,3)]
        if not out or distance3(pt,out[-1])>.01:out.append(pt)
    return out

for mapid,p in PARAM.items():
    source=json.loads((ROOT/'tests'/f'source_{mapid}.json').read_text())
    byid={}
    for node in source['nodes']:
        s=S[node['id']]
        x,z,y=position(s,node['kind'],p)
        node.update(x=round(x,3),z=round(z,3),elevation=round(y,3))
        node['masterplanT']=s
        byid[node['id']]=node
    for e in source['edges']:
        a=byid[e['fromNode']];b=byid[e['toNode']]
        path=edge_path((a['x'],a['z'],a['elevation']), (b['x'],b['z'],b['elevation']),
                       a['masterplanT'],b['masterplanT'],p)
        e['path']=path
        e['lengthM']=round(sum(distance3((c[0],c[1],c[2]),(d[0],d[1],d[2])) for c,d in zip(path,path[1:])),2)
    source['sceneDefinition']=dict(p, profile='masterplan-v1', mainRoadSteps=220)
    source['fleetSize']=p['fleetSize']
    for section in ('live','engineering'):
        dest=ROOT/section/'maps'/f'{mapid}.js'
        if not dest.parent.is_dir():continue
        dest.write_text('/* Masterplan-generated quarry road network. */\nexport default '+json.dumps(source,ensure_ascii=False,separators=(',',':'))+';\n')
    print(mapid,'nodes',len(source['nodes']),'edges',len(source['edges']),'ranges',min(e['lengthM'] for e in source['edges']), max(e['lengthM'] for e in source['edges']))
