export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const straight = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function validateMap(raw) {
  if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw Error('Ожидается карта schemaVersion=1 с nodes[] и edges[].');
  if (raw.nodes.length < 8 || raw.nodes.length > 300 || raw.edges.length > 800) throw Error('Размер карты: 8–300 узлов и не более 800 дорог.');
  const ids = new Set(), nodes = new Map();
  for (const n of raw.nodes) {
    if (typeof n.id !== 'string' || !/^[\w-]{1,50}$/.test(n.id) || ids.has(n.id) || !Number.isFinite(n.x) || !Number.isFinite(n.z) || !Number.isFinite(n.elevation ?? 0) || Math.abs(n.elevation??0)>3000 || (n.name!==undefined&&(typeof n.name!=='string'||n.name.length>140)) || Math.abs(n.x) > 20000 || Math.abs(n.z) > 20000) throw Error(`Некорректный/дублирующийся узел: ${n.id}`);
    if(['mine-035','weather-01','slope-07','water-01','workshop-01','blast-01'].includes(n.id)||/^ht-\d\d$/.test(n.id)||n.id.startsWith('road-'))throw Error(`Зарезервированный id узла: ${n.id}`);
    if(typeof n.kind!=='string'||!['face','crusher','fuel','workshop','depot','junction','power','refuge','weigh','stock','water'].includes(n.kind))throw Error(`Неизвестный тип узла ${n.id}`);
    ids.add(n.id);nodes.set(n.id,n);
  }
  if(typeof raw.id!=='string'||!/^[-a-zA-Z0-9_]{1,60}$/.test(raw.id)||typeof raw.name!=='string'||raw.name.length>140)throw Error('У карты нужны id (1–60 букв/цифр) и name (до 140 символов).');
  if(raw.fleetSize!==undefined&&(!Number.isInteger(raw.fleetSize)||raw.fleetSize<5||raw.fleetSize>28))throw Error('fleetSize: целое число 5–28.');
  if(raw.heightScale!==undefined&&(!Number.isFinite(raw.heightScale)||raw.heightScale<=0||raw.heightScale>3))throw Error('heightScale: число от 0 до 3 (не включая 0).');
  const edgeIds=new Set();
  for (const e of raw.edges) {
    if (typeof e.id!=='string'||!/^[-a-zA-Z0-9_]{1,50}$/.test(e.id) || edgeIds.has(e.id) || !nodes.has(e.fromNode) || !nodes.has(e.toNode) || e.fromNode === e.toNode) throw Error(`Ошибка дороги ${e.id}`);
    if (!Number.isFinite(e.speedLimit) || e.speedLimit < 1 || e.speedLimit > 30) throw Error(`Ошибка ограничения скорости ${e.id}`);
    if (straight(nodes.get(e.fromNode),nodes.get(e.toNode)) < 3) throw Error(`Слишком короткая дорога ${e.id}`);
    if(e.capacity!==undefined&&(!Number.isInteger(e.capacity)||e.capacity<1||e.capacity>16))throw Error(`Вместимость дороги ${e.id}: 1–16 машин.`);
    if(e.dustFactor!==undefined&&(!Number.isFinite(e.dustFactor)||e.dustFactor<.1||e.dustFactor>5))throw Error(`Пылевой коэффициент дороги ${e.id}: 0.1–5.`);
    if(e.width!==undefined&&(!Number.isFinite(e.width)||e.width<5||e.width>60))throw Error(`Ширина дороги ${e.id}: 5–60 м.`);
    if(e.path!==undefined){
      if(!Array.isArray(e.path)||e.path.length<2||e.path.length>500||e.path.some(p=>!Array.isArray(p)||p.length!==3||p.some(v=>!Number.isFinite(v))))throw Error(`Неверный профиль трассы ${e.id}`);
      const start=e.path[0],end=e.path[e.path.length-1];
      const a=nodes.get(e.fromNode),b=nodes.get(e.toNode);
      if(Math.hypot(start[0]-a.x,start[1]-a.z,start[2]-(a.elevation||0))>.1||Math.hypot(end[0]-b.x,end[1]-b.z,end[2]-(b.elevation||0))>.1)throw Error(`Трасса ${e.id} не соединена с узлами`);
    }
    edgeIds.add(e.id);
  }
  for (const kind of ['face','crusher','fuel','workshop','depot']) if (![...nodes.values()].some(n=>n.kind===kind)) throw Error(`На карте нет объекта типа ${kind}.`);
  if(raw.floodEdgeId&&!edgeIds.has(raw.floodEdgeId))throw Error('floodEdgeId отсутствует среди дорог.');
  if (raw.roadworksEdgeId && !edgeIds.has(raw.roadworksEdgeId)) throw Error('roadworksEdgeId отсутствует среди дорог.');
  if(raw.hazards!==undefined&&(!Array.isArray(raw.hazards)||raw.hazards.length>50))throw Error('hazards должен быть массивом до 50 зон.');
  for (const h of raw.hazards || []) if (!edgeIds.has(h.edgeId)) throw Error(`Угроза ${h.id} ссылается на несуществующую дорогу.`);
  const topology = createNetwork(raw);
  const seed=raw.nodes[0].id; const visited=new Set([seed]), q=[seed];
  while(q.length){const n=q.shift();for(const e of topology.adj.get(n)){if(!visited.has(e.to)){visited.add(e.to);q.push(e.to);}}}
  if(visited.size !== raw.nodes.length) throw Error(`Карта разорвана: доступно ${visited.size} из ${raw.nodes.length} узлов.`);
  // validate only the fields actually read; deep-copy to isolate from external mutations
  const normalized=JSON.parse(JSON.stringify(raw));
  normalized.nodes.forEach(n=>{n.elevation??=0;n.name??=n.id;});
  normalized.edges.forEach(e=>{e.capacity??=3;e.dustFactor??=1;});
  return normalized;
}
function edgeLength(edge,nodes){
  if(Array.isArray(edge.path)&&edge.path.length>=2){let d=0;for(let i=1;i<edge.path.length;i++){
    const a=edge.path[i-1],b=edge.path[i];d+=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
  }return d;}
  return straight(nodes.get(edge.fromNode),nodes.get(edge.toNode));
}
export function createNetwork(map) {
  const nodes=new Map(map.nodes.map(n=>[n.id,n]));
  const edges=new Map(map.edges.map(e=>{const length=edgeLength(e,nodes);return [e.id,{...e,length,grade:Math.abs((nodes.get(e.toNode).elevation||0)-(nodes.get(e.fromNode).elevation||0))/length}];}));
  const adj=new Map(map.nodes.map(n=>[n.id,[]]));
  for(const e of edges.values()){
    adj.get(e.fromNode).push({to:e.toNode,id:e.id});
    adj.get(e.toNode).push({to:e.fromNode,id:e.id});
  }
  return {nodes,edges,adj};
}
export function shortestPath(net, start, end, options={}) {
  if(!net.nodes.has(start)||!net.nodes.has(end))return null;
  if(start === end)return {nodes:[start],edges:[],cost:0,distance:0};
  if(!net.nodes.has(start)||!net.nodes.has(end))return null;
  const blocked=options.blocked || new Set(); const traffic=options.traffic || new Map();
  const dist=new Map([[start,0]]), prev=new Map(), visited=new Set();
  while(true){
    let u=null,best=Infinity;
    for(const [id,d] of dist)if(!visited.has(id) && d<best){best=d;u=id;}
    if(u===null||u===end)break;
    visited.add(u);
    for(const a of net.adj.get(u)){
      if(blocked.has(a.id))continue;
      const e=net.edges.get(a.id);
      const saturation=(traffic.get(e.id)||0)/(e.capacity||3);
      const friction=1+Math.max(0,saturation-.55)*2 + (options.rain? .20:0) +(options.dust? .16*(e.dustFactor||1):0) + e.grade*2.5;
      const cost=e.length/e.speedLimit*friction;
      if(best+cost<(dist.get(a.to)??Infinity)){dist.set(a.to,best+cost);prev.set(a.to,{node:u,edge:e.id});}
    }
  }
  if(!prev.has(end))return null;
  const nodes=[end],edges=[];let at=end;
  while(at!==start){const p=prev.get(at);if(!p)return null;edges.unshift(p.edge);nodes.unshift(p.node);at=p.node;}
  return {nodes,edges,cost:dist.get(end),distance:edges.reduce((s,id)=>s+net.edges.get(id).length,0)};
}
export function interpolate(net,edgeId,from,to,progress){
  const e=net.edges.get(edgeId),a=net.nodes.get(from),b=net.nodes.get(to),t=clamp(progress,0,1);
  if(Array.isArray(e?.path)&&e.path.length>1){
    const points=e.fromNode===from?e.path:e.path.slice().reverse(),target=t*e.length;
    let used=0;
    for(let i=1;i<points.length;i++){
      const p=points[i-1],q=points[i],length=Math.hypot(q[0]-p[0],q[1]-p[1],q[2]-p[2]);
      if(used+length>=target||i===points.length-1){const u=clamp((target-used)/(length||1),0,1);
        return {x:p[0]+(q[0]-p[0])*u,z:p[1]+(q[1]-p[1])*u,elevation:p[2]+(q[2]-p[2])*u};
      }used+=length;
    }
  }
  return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,elevation:(a.elevation||0)+((b.elevation||0)-(a.elevation||0))*t};
}
