/** MINE//MIRAGE concept-inspired 3D geography.
 * No changes to simulation parameters. The terrain is a procedural visual asset
 * made from the SAME JSON roads as the transport/production graph.
 * The detailed picture is only an optional labelled concept reference.
 */
export function installScenicWorld(MineWorld) {
  if (MineWorld.prototype.__scenic035) return;
  MineWorld.prototype.__scenic035 = true;
  const baseLoad = MineWorld.prototype.loadMap;
  const baseUpdate = MineWorld.prototype.update;
  const baseRender = MineWorld.prototype.render;
  const baseAttach = MineWorld.prototype._attachModel;

  const elevations = (map, x, z) => {
    if (!map) return 0;
    const nodes = new Map(map.nodes.map(n => [n.id,n]));
    let nearest = Infinity, y = 0;
    for (const edge of map.edges) {
      const a = nodes.get(edge.fromNode), b = nodes.get(edge.toNode);
      if (!a || !b) continue;
      const dx=b.x-a.x, dz=b.z-a.z;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/Math.max(1,dx*dx+dz*dz)));
      const d=(x-a.x-dx*t)**2+(z-a.z-dz*t)**2;
      if (d<nearest) { nearest=d; y=1.5+.65*((a.elevation||0)+((b.elevation||0)-(a.elevation||0))*t); }
    }
    return y;
  };

  MineWorld.prototype._loadModels=async function(){
    try {
      const response=await fetch('/models/manifest.json');
      if(!response.ok)throw Error(`Assets HTTP ${response.status}`);
      const manifest=await response.json();
      this.modelCatalog=manifest;
      for (const [role,path] of Object.entries(manifest)) {
        if (!path || typeof path!=='string' || !path.startsWith('/models/'))continue;
        this.modelLoader.load(path,(g)=>{
          this.models.set(role,g.scene);
          if (role.startsWith('terrain')) this._attachScenicTerrain();
          else this._applyModels(role);
        },undefined,e=>console.warn('Cannot load',role,e));
      }
    } catch(e) {console.warn('Asset manifest problem; procedural fallback retained',e);}
  };

  MineWorld.prototype._attachScenicTerrain=function(){
    if (this.software || !this.root || !this.map) return;
    const source=this.models.get(this.map.id==='altai'?'terrainAltai':'terrain');
    if (!source || !['saryarka','altai'].includes(this.map.id))return;
    if (this.scenicTerrain) {this.root.remove(this.scenicTerrain);this.scenicTerrain=null;}
    const terrain=source.clone(true);
    terrain.traverse(o=>{o.userData.isExternal=true;if(o.isMesh){o.castShadow=false;o.receiveShadow=true;o.frustumCulled=true;}});
    this.root.add(terrain);this.scenicTerrain=terrain;
    for (const m of this.stockTerrain||[])m.visible=false;
    this._alignScenicRoads();
    const chip=document.querySelector('.scene-chip');
    if(chip)chip.textContent='3D КАРЬЕР · ДОРОГИ ПО JSON · WEBGL';
    const stat=document.querySelector('#graphicsStatus');
    if(stat)stat.textContent='КАРЬЕР 035 · 3D рельеф и дорожный граф совпадают';
  };

  MineWorld.prototype._alignScenicRoads=function(){
    const net=this.net;if(!net)return;
    for(const [id,road] of this.edgeMeshes){
      const e=net.edges.get(id),a=net.nodes.get(e.fromNode),b=net.nodes.get(e.toNode);
      if(!a||!b)continue;
      const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz)||1;
      const px=-dz/len,pz=dx/len;
      const makeRibbon=(width,rise,material)=>{
        const verts=[],idx=[];
        const segments=12;
        for(let i=0;i<=segments;i++) {
          const t=i/segments,x=a.x+dx*t,z=a.z+dz*t,y=1.5+.65*(a.elevation+(b.elevation-a.elevation)*t)+rise;
          verts.push(x+px*width/2,y,z+pz*width/2,x-px*width/2,y,z-pz*width/2);
          if(i<segments){const q=2*i;idx.push(q,q+2,q+1,q+1,q+2,q+3);}
        }
        const geo=road.slab.geometry.clone();
        for (const key of Object.keys(geo.attributes))geo.deleteAttribute(key);
        const BufferAttribute=road.slab.geometry.getAttribute('position').constructor;
        geo.setAttribute('position',new BufferAttribute(new Float32Array(verts),3));
        geo.setIndex(idx);geo.computeVertexNormals();
        const mesh=road.slab.clone(false);mesh.geometry=geo;mesh.material=material;
        mesh.material.side=2; mesh.frustumCulled=true;
        return mesh;
      };
      const surfaceMat=road.slab.material.clone();surfaceMat.color.setHex(0x59544b);
      surfaceMat.roughness=1;surfaceMat.polygonOffset=true;surfaceMat.polygonOffsetFactor=-1;
      const lineMat=road.stripe.material.clone();lineMat.color.setHex(0xc6ac75);
      const shoulders=road.slab.material.clone();shoulders.color.setHex(0xa38b6b);
      const group=road.group;group.clear();group.position.set(0,0,0);group.rotation.set(0,0,0);
      const shoulder=makeRibbon(19,.28,shoulders);
      const slab=makeRibbon(14,.60,surfaceMat);
      const stripe=makeRibbon(.32,.68,lineMat);
      group.add(shoulder,slab,stripe);
      this.edgeMeshes.set(id,{group,slab,stripe});
    }
    for(const marker of this.roadMarkers||[])marker.visible=false;
    for(const [nodeId,asset] of this.assets){const n=net.nodes.get(nodeId);if(n)asset.group.position.y=1.5+.65*(n.elevation||0)+1;}
    if(this.hazardPosition){
      const danger=net.edges.get(this.map.hazards?.[0]?.edgeId);
      if(danger){const a=net.nodes.get(danger.fromNode),b=net.nodes.get(danger.toNode);
        this.hazardPosition.y=1.5+.65*((a.elevation+b.elevation)/2)+5;
        if(this.hazardRing)this.hazardRing.position.y=this.hazardPosition.y;
      }
    }
  };

  MineWorld.prototype.loadMap=function(map){
    this.scenicTerrain=null;this.__smoothing=new Map();
    baseLoad.call(this,map);
    this.stockTerrain=this.root.children.slice(0,1+7+(this.software?46:90));
    this._attachScenicTerrain();
  };

  MineWorld.prototype._attachModel=function(entry,model){
    baseAttach.call(this,entry,model);
    if(entry.external){
      if(entry.role==='truck')entry.external.rotation.y=Math.PI/2;
      entry.external.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=false;}});
    }
  };

  MineWorld.prototype.update=function(snap,...args){
    if(!snap)return;
    const previous=new Map();
    if(!this.software)for(const [id,v] of this.vehicles)previous.set(id,v.group.position.clone());
    baseUpdate.call(this,snap,...args);
    if(!this.software&&this.scenicTerrain){
      for(const t of snap.fleet||[]){
        const v=this.vehicles.get(t.id);if(!v)continue;
        const p=t.gpsPosition||t.position;
        const dest=v.group.position.clone();dest.y=elevations(this.map,p.x,p.z)+1.0;
        this.__smoothing.set(t.id,dest);
        const old=previous.get(t.id);
        if(old&&old.distanceTo(dest)<85)v.group.position.copy(old);
        else v.group.position.copy(dest);
      }
    }
  };

  MineWorld.prototype.render=function(){
    if(this.__smoothing&&!this.software){
      for(const [id,target] of this.__smoothing){const v=this.vehicles.get(id);if(v)v.group.position.lerp(target,.3);}
    }
    baseRender.call(this);
  };
}

export function createScenicWorld(MineWorld,container){
  let world;
  const cpu=new URLSearchParams(location.search).get('graphics')==='cpu';
  try{world=new MineWorld(container,{software:cpu});}
  catch(e){console.warn('WebGL unavailable:',e);container.replaceChildren();world=new MineWorld(container,{software:true});}
  if(!world.software){
    world.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.05));
    world.renderer.shadowMap.enabled=false;
    world.sun.castShadow=false;
    world.sun.intensity=2.5;
  }
  const chip=document.querySelector('.scene-chip');
  if(chip)chip.textContent=world.software?'CANVAS · запасной режим':'3D КАРЬЕР · ЗАГРУЗКА РЕЛЬЕФА';
  const status=document.createElement('span');status.id='graphicsStatus';status.className='mirage-graphics-status';status.textContent=world.software?'CPU · упрощённая сцена':'3D · загружается...';
  const wrap=container.parentElement;wrap.append(status);
  const link=document.createElement('a');link.className='mirage-graphics-switch';link.href=world.software?location.pathname:location.pathname+'?graphics=cpu';link.textContent=world.software?'Включить 3D':'CPU-режим';wrap.append(link);
  if(!world.software){
    world.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();world.__gpuLost=true;status.textContent='⚠ потерян WebGL-контекст';},{passive:false});
    world.renderer.domElement.addEventListener('webglcontextrestored',()=>{world.__gpuLost=false;});
    let last=0,start=0,n=0;
    const loop=t=>{
      if(!document.hidden&&!world.__gpuLost&&world.root&&t-last>=33.2){
        last=t;try{world.render();n++;}catch(e){status.textContent='3D ошибка: '+e.message;console.error(e);world.__gpuLost=true;}
      }
      if(t-start>=1500){if(start&&world.root&&!world.__gpuLost){const fps=Math.round(n*1000/(t-start));const draws=world.renderer.info?.render?.calls;status.textContent=`3D · ${fps} FPS${Number.isFinite(draws)?` · ${draws} вызовов`:''}`;}start=t;n=0;}
      requestAnimationFrame(loop);
    };requestAnimationFrame(loop);
  }
  return world;
}
