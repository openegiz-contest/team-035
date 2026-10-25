import json,math,heapq,os,random
from pathlib import Path
import numpy as np,trimesh
from scipy.stats import binned_statistic_2d
from scipy.ndimage import distance_transform_edt, gaussian_filter, sobel
ROOT=Path(__file__).resolve().parent.parent
SIM_ROAD_SPAN=1050
GRID=135
ASSIGNMENTS={'saryarka':('open_pit_mine.glb',.62),'altai':('mining_quarry.glb',.68)}

def world_sample(name,yfactor):
    sc=trimesh.load(ROOT/'models'/name,force='scene')
    arr=[]
    for n in sc.graph.nodes_geometry:
        tf,geom=sc.graph.get(n)
        arr.append(trimesh.transform_points(sc.geometry[geom].vertices,tf))
    p=np.concatenate(arr)
    xmin,ymin,zmin=p.min(axis=0);xmax,ymax,zmax=p.max(axis=0)
    xs=SIM_ROAD_SPAN/(xmax-xmin);ys=xs*yfactor
    # Rasterised upper shell: verts and triangle centroids help protect holes.
    h,xe,ze,_=binned_statistic_2d(p[:,0],p[:,2],p[:,1],statistic='max',bins=[GRID,GRID],range=[[xmin,xmax],[zmin,zmax]])
    miss=~np.isfinite(h)
    near=distance_transform_edt(miss,return_distances=False,return_indices=True)
    h=h[tuple(near)]
    h=gaussian_filter(h,1)
    wx=np.linspace(-SIM_ROAD_SPAN/2,SIM_ROAD_SPAN/2,GRID)
    wz=np.linspace(-(zmax-zmin)*xs/2,(zmax-zmin)*xs/2,GRID)
    heights=(h-ymin)*ys-72
    def to_world(ix,iz):return float(wx[ix]),float(wz[iz]),float(heights[ix,iz])
    return heights,wx,wz,to_world,dict(minx=float(xmin),maxx=float(xmax),miny=float(ymin),maxy=float(ymax),minz=float(zmin),maxz=float(zmax),scale=float(xs),scaleY=float(ys),offsetY=-72.,grid=GRID)

# Semantic sites in projected quarry footprint (not reused tracks from old map).
SITE={
'face-north':(.27,.31),'face-south':(.36,.67),'west-n':(.20,.30),'west-s':(.27,.61),
'ramp-n':(.22,.43),'ramp-s':(.35,.42),'central':(.50,.50),'north-cross':(.54,.24),
'south-cross':(.48,.77),'east-low':(.60,.64),'east-mid':(.72,.46),'east-high':(.77,.31),
'crusher-a':(.82,.25),'crusher-b':(.83,.76),'fuel':(.81,.52),'workshop':(.90,.60),
'depot':(.91,.70),'refuge':(.16,.77),'weigh':(.75,.42),'substation':(.91,.37)
}

# Routing over original GLB surface, with slope, turn and congestion penalties.
def calculate(mapid,mesh,yfactor):
    H,wx,wz,world,transform=world_sample(mesh,yfactor)
    oldjs=(ROOT/'live/maps'/f'{mapid}.js').read_text()
    old=json.loads(oldjs[oldjs.index('export default')+len('export default'):].strip().rstrip(';'))
    dx=wx[1]-wx[0];dz=wz[1]-wz[0]
    steep=np.hypot(np.gradient(H,dx,axis=0),np.gradient(H,dz,axis=1))
    def closest_site(u,v,constrain=True):
        i=int(np.clip(round((GRID-1)*u),3,GRID-4));j=int(np.clip(round((GRID-1)*v),3,GRID-4))
        if not constrain:return i,j
        loc=min(((int(a),int(b)) for a in range(max(3,i-7),min(GRID-3,i+8)) for b in range(max(3,j-7),min(GRID-3,j+8))),key=lambda q:math.hypot(q[0]-i,q[1]-j)*.29+min(steep[q[0],q[1]],2.5)*18)
        return loc
    occupied={}
    for n in old['nodes']:
        (u,v)=SITE[n['id']]
        occupied[n['id']]=closest_site(u,v)
        x,z,y=world(*occupied[n['id']]);n.update(x=round(x,3),z=round(z,3),elevation=round(y+1.5,3))
    path_usage=np.zeros_like(H)
    neighbors=[(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]
    def route(start,stop):
        if start==stop:return [start,stop]
        q=[(0.,start)];g={start:0.};prev={};visited=set();slope_cap=.42
        while q:
            _,here=heapq.heappop(q)
            if here in visited:continue
            visited.add(here)
            if here==stop:break
            i,j=here
            for di,dj in neighbors:
                ni,nj=i+di,j+dj
                if ni<2 or nj<2 or ni>GRID-3 or nj>GRID-3:continue
                dist=math.hypot(di*dx,dj*dz);grad=abs(float(H[ni,nj]-H[i,j]))/dist
                penalty=(max(0,grad-.08)*14)**2+max(0,grad-.25)**2*1200
                penalty+=max(0,steep[ni,nj]-.35)*8
                penreuse=1/(1+.5*path_usage[ni,nj])
                cost=dist*(1+penalty)*(.72+.28*penreuse)
                nxt=(ni,nj);new=g[here]+cost
                if new<g.get(nxt,1e30):
                    g[nxt]=new;prev[nxt]=here
                    heur=math.hypot((ni-stop[0])*dx,(nj-stop[1])*dz)
                    heapq.heappush(q,(new+heur,nxt))
        if stop not in prev:return [start,stop]
        rev=[stop]
        while rev[-1]!=start:rev.append(prev[rev[-1]])
        rev.reverse()
        for point in rev:path_usage[point]+=1
        # Turn long pixel staircase into manageable segments while preserving 2m deviations.
        chunks=[rev[0]]
        for k in range(3,len(rev),3):chunks.append(rev[k])
        if chunks[-1]!=rev[-1]:chunks.append(rev[-1])
        return chunks
    paths={}
    for edge in old['edges']:
        start=occupied[edge['fromNode']];stop=occupied[edge['toNode']]
        cells=route(start,stop)
        path=[]
        for ix,iz in cells:
            x,z,y=world(ix,iz);path.append([round(x,3),round(z,3),round(y+1.5,3)])
        a=next(n for n in old['nodes'] if n['id']==edge['fromNode']);b=next(n for n in old['nodes'] if n['id']==edge['toNode'])
        path[0]=[a['x'],a['z'],a['elevation']];path[-1]=[b['x'],b['z'],b['elevation']]
        edge['path']=path
        seg=np.diff(np.array(path),axis=0)
        length=float(np.linalg.norm(seg,axis=1).sum())
        grade=float(np.max(abs(seg[:,2])/np.maximum(.1,np.linalg.norm(seg[:,:2],axis=1)))) if len(seg) else 0
        edge['lengthM']=round(length,2);edge['maxGradePct']=round(grade*100,1)
        paths[edge['id']]=path
    old['visualRoads']=[dict(id=e['id'],path=e['path']) for e in old['edges']]
    old['sceneDefinition']={'baseModel':mesh,'terrainScale':transform,'roadsSource':'surface-routed, not traced photo texture','method':'GLB heightmap grid A*; visual validation required'}
    old['description']='Дороги рассчитаны по поверхности отдельной GLB-модели с минимизацией уклонов. Учебная модель: не реальные геодезические трассы.'
    new=(ROOT/'live/maps'/f'{mapid}.js')
    new.write_text('/* 5203 road plan fitted to own GLB surface. Phototexture lanes are not automatically recognized. */\nexport default '+json.dumps(old,ensure_ascii=False,separators=(',',':'))+';\n')
    report={'map':mapid,'mesh':mesh,'nodes':len(old['nodes']),'edges':len(old['edges']),'max_grade_pct':max(e['maxGradePct'] for e in old['edges']),'lengths_m':[e['lengthM'] for e in old['edges']], 'terrain_scale':transform}
    return report

if __name__=='__main__':
    rep=[calculate(m,*ASSIGNMENTS[m]) for m in ['saryarka','altai']]
    (ROOT/'tests/terrain_route_report.json').write_text(json.dumps(rep,indent=2,ensure_ascii=False))
    print(json.dumps(rep,ensure_ascii=False,indent=2)[:3000])
