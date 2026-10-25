
import assert from 'node:assert/strict';
import {MineOperations} from '../live/modules/operations.js';
import altai from '../live/maps/altai.js';
import saryarka from '../live/maps/saryarka.js';
import {weatherFactors} from '../live/modules/weather-impact.js';
import {weatherFactors as engineeringWeatherFactors} from '../engineering/modules/weather-impact.js';

for(const map of [altai,saryarka]){
  const base=new MineOperations(map,1234);
  const fog=new MineOperations(map,1234);
  const heat=new MineOperations(map,1234);
  fog.action('fog'); heat.action('heat');
  for(const sim of [base,fog,heat])sim.step(3);
  const m0=base.metrics(), mf=fog.metrics(),mh=heat.metrics();
  assert(mf.weatherImpact.visibilityPct<m0.weatherImpact.visibilityPct);
  assert(mf.weatherImpact.loadingPct<m0.weatherImpact.loadingPct);
  assert(mf.weatherImpact.transportPct<m0.weatherImpact.transportPct);
  assert(mh.weatherImpact.loadingPct<m0.weatherImpact.loadingPct);
  assert(mh.weatherImpact.crushingPct<m0.weatherImpact.crushingPct);
  assert(mh.weatherImpact.ambientC>m0.weatherImpact.ambientC);
  for(const sim of [base,fog,heat])sim.step(1800);
  const b=base.metrics(),f=fog.metrics(),h=heat.metrics();
  assert(f.tonnes<=b.tonnes+1e-4,`Fog ${map.id} ${f.tonnes} > ${b.tonnes}`);
  assert(h.tonnes<=b.tonnes+1e-4,`Heat ${map.id} ${h.tonnes} > ${b.tonnes}`);
  assert(h.processed<=b.processed+1e-4,`Heat ${map.id} ${h.processed} > ${b.processed}`);
  assert.deepEqual(weatherFactors({fog:true,heat:true},.48,.10,false),engineeringWeatherFactors({fog:true,heat:true},.48,.10,false));
  console.log(map.id,'1800 sec: normal',b.tonnes,'t mined,',b.processed,'t processed;',
    'fog',f.tonnes,'t mined;', 'heat',h.tonnes,'t mined,',h.processed,'t processed');
}
console.log('PASS weather productivity assumptions, seeded runs and consistent engines');
