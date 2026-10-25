import assert from 'node:assert/strict';
import fs from 'node:fs';
import map from '../live/maps/altai.js';
const land=JSON.parse(fs.readFileSync(new URL('../QUALITY_CHECK/altai_landcover_grid.json',import.meta.url),'utf8'));
const bits=Buffer.from(land.bits,'base64');
function forest(x,z){
 const i=Math.round((x-land.xmin)/land.step),j=Math.round((z-land.zmin)/land.step);
 if(i<0||j<0||i>=land.width||j>=land.height)return true;
 const n=j*land.width+i;return !!(bits[n>>3]&(1<<(7-(n&7))));
}
let forestMeters=0,routeMeters=0;
for(const edge of map.edges){
 let off=0,length=0;
 for(let k=1;k<edge.path.length;k++){
  const a=edge.path[k-1],b=edge.path[k];const d=Math.hypot(a[0]-b[0],a[1]-b[1]);
  const steps=Math.max(1,Math.ceil(d/3));
  for(let i=0;i<steps;i++){
   const t=(i+.5)/steps,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
   length+=d/steps;if(forest(x,z))off+=d/steps;
  }
 }
 forestMeters+=off;routeMeters+=length;
 assert(off<1,`${edge.id} runs over mapped vegetation: ${off.toFixed(1)}m`);
}
console.log('PASS altai land-cover audit:',map.edges.length,'routes;',routeMeters.toFixed(0),'m total;',forestMeters.toFixed(2),'m of classified vegetation');
