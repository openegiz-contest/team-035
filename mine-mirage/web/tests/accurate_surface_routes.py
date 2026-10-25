"""Generate drivable, surface-projected road centre lines from original GLB triangle upper shell.
Not a reconstruction of road paint/phototextures: route authoring still needs human review.
"""
import json, heapq, math
from pathlib import Path
import numpy as np, trimesh
from scipy.ndimage import distance_transform_edt, gaussian_filter, binary_erosion, binary_closing
from numba import njit
ROOT=Path(__file__).resolve().parents[1]
SIDE=205
@njit(cache=True)
def rasterize(tri,n,minx,minz,dx,dz):
    h=np.full((n,n),-1e6,dtype=np.float64)
    for k in range(len(tri)):
        p=tri[k]
        xmin=min(p[0,0],p[1,0],p[2,0]);xmax=max(p[0,0],p[1,0],p[2,0])
        zmin=min(p[0,2],p[1,2],p[2,2]);zmax=max(p[0,2],p[1,2],p[2,2])
        a=max(0,int(math.floor((xmin-minx)/dx)));b=min(n-1,int(math.ceil((xmax-minx)/dx)))
        c=max(0,int(math.floor((zmin-minz)/dz)));d=min(n-1,int(math.ceil((zmax-minz)/dz)))
        if a>b or c>d:continue
        x0,z0=p[0,0],p[0,2];x1,z1=p[1,0],p[1,2];x2,z2=p[2,0],p[2,2]
        det=(z1-z2)*(x0-x2)+(x2-x1)*(z0-z2)
        if abs(det)<1e-12:continue
        for i in range(a,b+1):
            x=minx+i*dx
            for j in range(c,d+1):
                z=minz+j*dz
                u=((z1-z2)*(x-x2)+(x2-x1)*(z-z2))/det
                v=((z2-z0)*(x-x2)+(x0-x2)*(z-z2))/det
                w=1-u-v
                if u<-.001 or v<-.001 or w<-.001:continue
                y=u*p[0,1]+v*p[1,1]+w*p[2,1]
                if y>h[i,j]:h[i,j]=y
    return h

def get_shell(fn,spec):
    scene=trimesh.load(ROOT/'models'/fn,force='scene')
    world=[]
    for node in scene.graph.nodes_geometry:
        transform,geom=scene.graph.get(node)
        world.append(trimesh.transform_points(scene.geometry[geom].triangles.reshape(-1,3),transform).reshape(-1,3,3))
    triangles=np.concatenate(world).astype('float64')
    # limit mesh extent but give few metres safety at edges
    bounds=np.array([spec['minx'],spec['maxx'],spec['minz'],spec['maxz']])
    hx=(bounds[1]-bounds[0])*.012;hz=(bounds[3]-bounds[2])*.012
    minx=bounds[0]-hx;maxx=bounds[1]+hx;minz=bounds[2]-hz;maxz=bounds[3]+hz
    h=rasterize(triangles,SIDE,minx,minz,(maxx-minx)/(SIDE-1),(maxz-minz)/(SIDE-1))
    exact=h>-1e5
    # avoid extrapolating phantom terrain into missing mesh regions
    valid=binary_closing(exact,iterations=1)
    # avoid needless tiny mesh punctures, but keep holes over 2 grid cells invalid
    ix=distance_transform_edt(~exact,return_indices=True,return_distances=False)
    filled=h[tuple(ix)]
    xs=np.linspace(minx,maxx,SIDE);zs=np.linspace(minz,maxz,SIDE)
    worldx=(xs-(spec['minx']+spec['maxx'])/2)*spec['scale']
    worldz=(zs-(spec['minz']+spec['maxz'])/2)*spec['scale']
    worldh=(filled-spec['miny'])*spec['scaleY']+spec['offsetY']
    return worldh,valid,worldx,worldz

def scalar(arr,i,j):return float(arr[i,j])
def make_new(mapid):
    p=ROOT/'live/maps'/f'{mapid}.js';s=p.read_text();old=json.loads(s.split('export default ',1)[1].strip().rstrip(';'))
    spec=old['sceneDefinition']['terrainScale'];name=old['sceneDefinition']['baseModel']
    H,valid,X,Z=get_shell(name,spec)
    spacing=(X[1]-X[0],Z[1]-Z[0]);dx,dz=spacing
    steep=np.hypot(np.gradient(H,dx,axis=0),np.gradient(H,dz,axis=1));steep=gaussian_filter(steep,0.5)
    # use only valid points at least 1 cell inside the mesh for full-width roads
    road_area=binary_erosion(valid,iterations=1)
    slope_ok=steep<.16
    safe=road_area & slope_ok
    nodes=old['nodes']
    positions={}
    for node in nodes:
        x,z=node['x'],node['z'];i=int(np.argmin(abs(X-x)));j=int(np.argmin(abs(Z-z)))
        candidate=[]
        for a in range(max(3,i-36),min(SIDE-3,i+37)):
            for b in range(max(3,j-36),min(SIDE-3,j+37)):
                if not valid[a,b]:continue
                dist=math.hypot((a-i)*dx,(b-j)*dz)
                sep=sum(max(0,38-math.hypot((a-k)*dx,(b-l)*dz)) for k,l in positions.values())
                cost=dist*.8 + min(4,steep[a,b])*32 + (0 if safe[a,b] else 40) + sep*.7
                candidate.append((cost,a,b))
        if not candidate:
            raise Exception('no valid location for '+node['id'])
        _,a,b=min(candidate)
        positions[node['id']]=(a,b)
        node.update(x=round(float(X[a]),3),z=round(float(Z[b]),3),elevation=round(float(H[a,b]+1.65),3))
    prev_used=np.zeros(H.shape,dtype=np.float32)
    neighbors=[(1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)]
    def pathfind(start,goal):
        pq=[(0,start)];g={start:0};parents={};visited=set()
        while pq:
            _,pnt=heapq.heappop(pq)
            if pnt in visited:continue
            visited.add(pnt)
            if pnt==goal:break
            i,j=pnt
            for di,dj in neighbors:
                ni,nj=i+di,j+dj
                if ni<2 or nj<2 or ni>=SIDE-2 or nj>=SIDE-2 or not road_area[ni,nj]:continue
                # don't clip corners around out-of-mesh gaps
                if di and dj and not(road_area[ni,j] and road_area[i,nj]):continue
                horiz=math.hypot(di*dx,dj*dz)
                grade=abs(H[ni,nj]-H[i,j])/max(1e-6,horiz)
                if grade>.16 and (ni,nj)!=goal:continue
                slope_pen=(grade/.10)**2*.8
                # prefer following the same laid-out haul road, avoid crossing new terrace walls
                cost=horiz*(1+slope_pen + max(0,steep[ni,nj]-.1)*18) / (1+min(1.8,prev_used[ni,nj])*.16)
                nxt=(ni,nj);ng=g[pnt]+cost
                if ng<g.get(nxt,1e40):
                    g[nxt]=ng;parents[nxt]=pnt
                    heuristic=math.hypot((ni-goal[0])*dx,(nj-goal[1])*dz)
                    heapq.heappush(pq,(ng+heuristic,nxt))
        if goal not in parents and goal!=start:
            return None
        cells=[goal]
        while cells[-1]!=start:cells.append(parents[cells[-1]])
        cells.reverse()
        return cells
    def fallback(start,goal):
        # find best grade-respecting route; we do NOT draw straight lines through missing terrain
        return pathfind(start,goal)
    diagnostics=[];road_used=set()
    for edge in old['edges']:
        start=positions[edge['fromNode']];goal=positions[edge['toNode']]
        cells=fallback(start,goal)
        if cells is None:
            # route might be non-drivable on photogrammetry mesh; preserve topology but mark unsupported
            # keep A* over valid mesh with heavy penalty for grades up to 45% and tag unsafe
            pq=[(0,start)];g={start:0};parents={};visited=set()
            while pq:
                _,pnt=heapq.heappop(pq)
                if pnt in visited:continue
                visited.add(pnt)
                if pnt==goal:break
                i,j=pnt
                for di,dj in neighbors:
                    ni,nj=i+di,j+dj
                    if not(1<=ni<SIDE-1 and 1<=nj<SIDE-1 and valid[ni,nj]):continue
                    dist=math.hypot(di*dx,dj*dz)
                    grade=abs(H[ni,nj]-H[i,j])/dist
                    ng=g[pnt]+dist*(1+(max(0,grade-.1)*28)**2)
                    nxt=(ni,nj)
                    if ng<g.get(nxt,1e30):
                        g[nxt]=ng;parents[nxt]=pnt
                        heapq.heappush(pq,(ng+math.hypot((ni-goal[0])*dx,(nj-goal[1])*dz),nxt))
            if goal not in parents:raise Exception(f'no connected mesh path {mapid} {edge["id"]}')
            cells=[goal]
            while cells[-1]!=start:cells.append(parents[cells[-1]])
            cells.reverse();edge['unverifiedSlope']=True
        else:edge.pop('unverifiedSlope',None)
        for cell in cells:prev_used[cell]+=1
        road_used.update(cells)
        # Use raw grid points with compression of collinear directions; don't smooth across cliff edges.
        chunks=[cells[0]]
        for k in range(1,len(cells)-1):
            v=(cells[k][0]-chunks[-1][0],cells[k][1]-chunks[-1][1]);w=(cells[k+1][0]-cells[k][0],cells[k+1][1]-cells[k][1]);
            if w[0]*v[1]!=v[0]*w[1] or (k%5==0): chunks.append(cells[k])
        chunks.append(cells[-1]);path=[]
        for a,b in chunks:
            path.append([round(float(X[a]),3),round(float(Z[b]),3),round(float(H[a,b]+1.65),3)])
        a=next(n for n in nodes if n['id']==edge['fromNode']);b=next(n for n in nodes if n['id']==edge['toNode'])
        path[0]=[a['x'],a['z'],a['elevation']];path[-1]=[b['x'],b['z'],b['elevation']]
        if len(path)>500: path=path[::math.ceil(len(path)/450)]+[path[-1]]
        edge['path']=path;seg=np.diff(np.array(path),axis=0)
        horiz=np.linalg.norm(seg[:,:2],axis=1)
        grades=abs(seg[:,2])/np.maximum(.001,horiz)
        maxgrade=float(max(grades)) if len(grades) else 0
        length=float(np.linalg.norm(seg,axis=1).sum())
        edge['lengthM']=round(length,1);edge['maxGradePct']=round(100*maxgrade,1)
        if maxgrade>.16:edge['unverifiedSlope']=True
        diagnostics.append({'id':edge['id'],'maxGradePct':round(maxgrade*100,1),'lengthM':round(length,1),'manualReview':bool(edge.get('unverifiedSlope'))})
    old['visualRoads']=[{'id':e['id'],'path':e['path']} for e in old['edges']]
    old['description']='Маршруты реконструированы по фактической GLB-геометрии и проверке области поверхности, но не подтверждены геодезией. Подъезды с высоким уклоном — демонстрационные и требуют разметки.'
    old['sceneDefinition']['method']='Triangle-raster upper surface; mesh-valid A*; no paths over empty mesh'
    old['sceneDefinition']['roadsSource']='authored through actual mesh polygons, not texture-traced'
    p.write_text('/* 5204: GLB mesh surface road paths. Unverified slopes are marked in test report. */\nexport default '+json.dumps(old,ensure_ascii=False,separators=(',',':'))+';\n')
    return {'map':mapid,'mesh':name,'validCoveragePct':round(100*np.mean(valid),1),'nodes':len(nodes),'edges':len(old['edges']),'reviewRequired':sum(d['manualReview'] for d in diagnostics),'maxGradePct':max(d['maxGradePct'] for d in diagnostics),'edgesDetail':diagnostics}
if __name__=='__main__':
    reports=[]
    for mapid in ['saryarka','altai']:
        print('building',mapid,flush=True)
        reports.append(make_new(mapid))
    path=ROOT/'tests/route_surface_audit_5204.json';path.write_text(json.dumps(reports,ensure_ascii=False,indent=2))
    for r in reports:print(r['map'],r['validCoveragePct'],r['reviewRequired'],r['maxGradePct'])
