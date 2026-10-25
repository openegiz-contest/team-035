"""Regression test for corrected Saryarka weigh/Crusher A branch vs original GLB upper surface."""
from pathlib import Path
import sys,json,math
import numpy as np
sys.path.insert(0,str(Path(__file__).parent))
from accurate_surface_routes import get_shell
ROOT=Path(__file__).resolve().parents[1]
m=json.loads((ROOT/'live/maps/saryarka.js').read_text().split('export default ',1)[1].strip().rstrip(';'))
H,V,X,Z=get_shell(m['sceneDefinition']['baseModel'],m['sceneDefinition']['terrainScale'])
nd={n['id']:n for n in m['nodes']};es={e['id']:e for e in m['edges']}
assert 'E01' not in es,'impossible cliff shortcut E01 must be removed'
assert es['E03']['fromNode']==es['E05']['fromNode']=='east-low'
assert es['E03']['toNode']=='weigh' and es['E05']['toNode']=='crusher-a'
for id in ['E03','E05']:
 e=es[id]; p=e['path'];max_grade=0.;max_error=0.
 for a,b in zip(p,p[1:]):
  max_grade=max(max_grade,abs(b[2]-a[2])/max(.001,math.hypot(b[0]-a[0],b[1]-a[1])))
 for x,z,y in p:
  i=int(np.argmin(abs(X-x)));j=int(np.argmin(abs(Z-z)))
  assert V[i,j],f'{id}: point off actual mesh'
  max_error=max(max_error,abs(y-H[i,j]))
 assert max_grade<=.08+1e-3,f'{id}: slope {max_grade*100:.1f}%'
 assert max_error<=1.7,f'{id}: off-mesh height {max_error:.2f} m'
 print(f'{id}: {len(p)} points, max grade {100*max_grade:.2f}%, max mesh height error {max_error:.2f} m')
for id in ('weigh','crusher-a'):
 n=nd[id];i=int(np.argmin(abs(X-n['x'])));j=int(np.argmin(abs(Z-n['z'])))
 assert V[i,j] and abs(n['elevation']-H[i,j])<1.7
 ii,jj=((3,2) if id=='weigh' else (6,4))
 patch=H[i-ii:i+ii+1,j-jj:j+jj+1]
 assert patch.size>0 and np.isfinite(patch).all()
 spread=float(patch.max()-patch.min())
 assert spread<2.6,f'{id}: unsafe foundation spread {spread:.2f}'
 print(f'{id}: footprint range {spread:.2f} m, node y error {n["elevation"]-H[i,j]:.2f} m')
print('PASS: Saryarka new access to weigh + Crusher A follows terrain; no cliff shortcut')
