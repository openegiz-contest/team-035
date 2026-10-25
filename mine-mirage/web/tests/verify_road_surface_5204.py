"""Assert every physically drawn center-line vertex lies over original GLB terrain polygons."""
import json
from pathlib import Path
import numpy as np
from scipy.ndimage import distance_transform_edt
from accurate_surface_routes import get_shell
ROOT=Path(__file__).resolve().parents[1]
report=[]
for name in ('saryarka','altai'):
 s=(ROOT/'live/maps'/f'{name}.js').read_text();m=json.loads(s.split('export default ',1)[1].strip().rstrip(';'))
 H,valid,X,Z=get_shell(m['sceneDefinition']['baseModel'],m['sceneDefinition']['terrainScale'])
 points=np.array([p for e in m['visualRoads'] for p in e['path']]);
 ii=np.rint((points[:,0]-X[0])/(X[-1]-X[0])*(len(X)-1)).astype(int)
 jj=np.rint((points[:,1]-Z[0])/(Z[-1]-Z[0])*(len(Z)-1)).astype(int)
 within=(ii>=0)&(ii<len(X))&(jj>=0)&(jj<len(Z))
 inside=np.zeros_like(within)
 inside[within]=valid[ii[within],jj[within]]
 bad=int((~inside).sum())
 vertical=np.zeros(len(points))
 vertical[within]=points[within,2]-H[ii[within],jj[within]]
 print(name,'physical point count',len(points),'outside mesh count',bad,'median y offset',round(float(np.median(vertical[within])),2))
 # Original GLB point-to-route discrepancy is not zero everywhere; all vertices should lie on mesh raster cells.
 assert bad==0,f'{name}: {bad} points outside terrain'
 report.append({'map':name,'physicalCorridors':len(m['visualRoads']),'logicalLinks':len(m['edges']),'sampledRoadVertices':int(len(points)),'outsideMeshVertices':bad,'medianVerticalOffsetM':round(float(np.median(vertical[within])),2),'logicalLinksOver12pctGrade':sum(e['maxGradePct']>12 for e in m['edges']), 'physicalCorridorsOver16pctGrade':sum(e['maxGradePct']>16 for e in m['visualRoads'])})
(ROOT/'tests/road_qa_5204.json').write_text(json.dumps(report,indent=2,ensure_ascii=False))
