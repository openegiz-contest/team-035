"""Idempotent, automatic creation of MINE//MIRAGE twins inside Eclipse Ditto."""
import base64
import json
import os
import time
import urllib.request
import urllib.error

URL=os.environ.get('DITTO_URL','http://ditto-nginx:80').rstrip('/')
USER=os.environ.get('DITTO_USER','ditto')
PASSWORD=os.environ['DITTO_PASSWORD']
NS='org.mine.mirage'
AUTH='Basic '+base64.b64encode(f'{USER}:{PASSWORD}'.encode()).decode()

def make(name,kind,features,extra=None,parent=True):
    attrs={'name':name,'kind':kind,'_isType':False}
    if parent: attrs['_parents']=f'{NS}:mine-01'
    if extra: attrs.update(extra)
    return {'policyId':'default:basic_policy','attributes':attrs,'features':{
        k:{'properties':{'value':v}} for k,v in features.items()
    }}

def twins():
    t={'mine-01':make('MINE//MIRAGE · цифровой карьер','mine',{'state':{},'map':'saryarka','running':True},parent=False)}
    for i in range(1,15):
        t[f'ht-{i:02d}']=make(f'Haul truck HT-{i:02d}','haul-truck',{'state':'parked','speed':0,'payload':0,'fuel':100})
    for i in range(1,3):
        t[f'ex-{i:02d}']=make(f'Excavator EX-{i:02d}','excavator',{'state':'idle','handled_tonnes':0})
        t[f'cr-{i:02d}']=make(f'Crusher CR-{i:02d}','crusher',{'state':'idle','handled_tonnes':0})
    t['drill-01']=make('MWD drill rig · BVR','drill',{'phase':'idle','drilled':0,'holes':[],'fragmentation':0})
    return {f'{NS}:{key}':val for key,val in t.items()}

def main():
    data=twins()
    for tid,body in data.items():
        req=urllib.request.Request(f'{URL}/api/2/things/{tid}',method='PUT',data=json.dumps(body).encode(),headers={'Authorization':AUTH,'Content-Type':'application/json'})
        for attempt in range(60):
            try:
                with urllib.request.urlopen(req,timeout=25) as res:
                    print(f'Created twin {tid}: HTTP {res.status}',flush=True)
                    break
            except (urllib.error.URLError,TimeoutError) as e:
                if attempt==59:raise RuntimeError(f'Cannot create {tid}: {e}') from e
                time.sleep(3)
    print(f'{len(data)} MINE//MIRAGE twins ready in Eclipse Ditto',flush=True)

if __name__=='__main__':main()
