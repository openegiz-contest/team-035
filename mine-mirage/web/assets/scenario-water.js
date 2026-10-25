// BUILD 5224: terrain-driven puddles and a deterministic water-level model.
// Pure functions (no Three.js) so they can be tested in Node.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const RING=Array.from({length:12},(_,i)=>[Math.cos(i/12*Math.PI*2),Math.sin(i/12*Math.PI*2)]);

// Natural depressions: centre lower than the mean of a surrounding ring, ring relief is small
// (so steep benches/cliffs are rejected), centre is the lowest point of the ring.
export function findPuddleSites(height,candidates,{ringR=7,minDepth=.12,maxRelief=3.2,minSpacing=28,max=10}={}){
  const found=[];
  for(const c of candidates){
    const y=height(c.x,c.z);if(!Number.isFinite(y))continue;
    let sum=0,hi=-Infinity,lo=Infinity,ok=true;
    for(const [dx,dz] of RING){const h=height(c.x+dx*ringR,c.z+dz*ringR);if(!Number.isFinite(h)){ok=false;break;}sum+=h;hi=Math.max(hi,h);lo=Math.min(lo,h);}
    if(!ok)continue;
    const depth=sum/RING.length-y;
    if(depth>=minDepth&&hi-lo<=maxRelief&&lo>=y-.05)found.push({x:c.x,z:c.z,y,depth,maxLevel:Math.min(depth*1.2,1.4),maxR:ringR*1.6});
  }
  found.sort((a,b)=>b.depth-a.depth);
  const out=[];for(const s of found){if(out.every(o=>Math.hypot(o.x-s.x,o.z-s.z)>=minSpacing))out.push(s);if(out.length>=max)break;}
  return out;
}

// Flat water surface at yw: the shoreline in each direction stops where terrain rises above yw.
export function shorelineRadii(height,site,level,n=16){
  const yw=site.y+site.maxLevel*level,radii=[];
  for(let i=0;i<n;i++){const a=i/n*Math.PI*2,dx=Math.cos(a),dz=Math.sin(a);let r=0;
    while(r<site.maxR&&height(site.x+dx*(r+.5),site.z+dz*(r+.5))<=yw)r+=.5;radii.push(r);}
  return {yw,radii};
}

// level 0..1. Rain fills (~85 s to full), evaporation is slow, working pump drains (~90 s),
// pumpFault removes the pump term so standing water stays. dt in real seconds.
export function stepWaterLevel(level,{rain=false,drainage=false,pumpFault=false,powerFault=false,sump=0},dt){
  const inflow=rain?.012:0,flood=sump>420?.002:0,evap=.0008;
  const pump=drainage&&!pumpFault&&!powerFault?.010:0;
  return clamp(level+(inflow+flood-evap-pump)*dt,0,1);
}
// Pump truck may only work when the engine really drains.
export const pumpTruckShouldWork=f=>!!(f.drainage&&!f.pumpFault&&!f.powerFault&&!f.rain);
