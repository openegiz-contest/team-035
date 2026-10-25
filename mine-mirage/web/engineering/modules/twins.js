import {buildTwinTelemetry} from './operations.js';
export const NS='org.mine.mirage';
export const twinId=slug=>`${NS}:${slug}`;
export function definitions(map){
 const root=twinId('mine-035');
 const defs=[['mine-035','Карьер и диспетчерская','mine',null],['weather-01','Метеостанция','weather',root],['slope-07','Уступ и геориск','slope',root],['water-01','Водооборот','water',root],['workshop-01','Ремонт и снабжение','maintenance',root],['blast-01','Взрывной периметр','blast',root]];
 for(let i=0;i<(map.fleetSize||12);i++)defs.push([`ht-${String(i+1).padStart(2,'0')}`,`Самосвал HT-${String(i+1).padStart(2,'0')}`,'truck',root]);
 for(const n of map.nodes)defs.push([n.id,n.name||n.id,n.kind,root]);
 for(const e of map.edges)defs.push([`road-${e.id}`,e.id,'road',root]);
 return defs.map(([slug,name,kind,parent])=>({thingId:twinId(slug),policyId:'default:basic_policy',attributes:{name,kind,_isType:false,...(parent?{_parents:parent}:{}),mapId:map.id,synthetic:true,modelVersion:'3.1',...(kind==='road'?{connects:map.edges.filter(e=>'road-'+e.id===slug).flatMap(e=>[twinId(e.fromNode),twinId(e.toNode)])}:{}),...(map.nodes.find(n=>n.id===slug)?{coordinates:map.nodes.filter(n=>n.id===slug).map(n=>({x:n.x,z:n.z,elevation:n.elevation}))}:{}),...(kind==='mine'?{process:'face -> truck -> crusher -> concentrate / tailings',waterLoop:'reservoir -> process -> pond -> reservoir'}:{})},features:{status:{properties:{value:'initializing'}}}}));
}
const fields=obj=>Object.fromEntries(Object.entries(obj).map(([key,value])=>[key,{properties:{value}}]));
export function features(snapshot,map){
 const result=Object.fromEntries(buildTwinTelemetry(snapshot).map(t=>[t.id,t.payload.value]));
 result[twinId('water-01')]=fields({reservoir:snapshot.water.reservoir,sump:snapshot.water.sump,pond:snapshot.water.pond,recycled:snapshot.water.recycled,balance:snapshot.metrics.waterError});
 result[twinId('workshop-01')]=fields({due:snapshot.metrics.maintenanceDue,jobs:snapshot.jobs.length,fuel_stock:snapshot.stock.fuelLitres,cost:snapshot.metrics.maintenanceCost});
 result[twinId('blast-01')]=fields({phase:snapshot.blast.phase,remaining:snapshot.blast.timer,completed:snapshot.blast.completed});
 for(const n of map.nodes)if(!result[twinId(n.id)])result[twinId(n.id)]=fields({state:n.kind==='power'&&snapshot.flags.powerFault?'offline':'available'});
 for(const e of map.edges)result[twinId(`road-${e.id}`)]=fields({closed:snapshot.blocked.includes(e.id)?1:0,traffic:snapshot.traffic[e.id]||0,capacity:e.capacity,from:e.fromNode,to:e.toNode});
 return result;
}
