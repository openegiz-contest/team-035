/** The model/view adapter. It never changes MineOperations or production data. */
export function installGraphicsUpgrade(MineWorld){
  if(MineWorld.prototype.__mirageOptimized) return;
  MineWorld.prototype.__mirageOptimized=true;
  const oldLoadMap=MineWorld.prototype.loadMap;
  const oldAttach=MineWorld.prototype._attachModel;
  const oldUpdate=MineWorld.prototype.update;
  const oldRender=MineWorld.prototype.render;

  MineWorld.prototype._loadModels=async function(){
    try{
      const response=await fetch('/models/manifest.json',{cache:'force-cache'});
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      this.modelCatalog=await response.json();
      const pathCache=new Map();
      for(const [role,path] of Object.entries(this.modelCatalog)){
        if(typeof path!=='string'||!path.startsWith('/models/'))continue;
        let loaded=pathCache.get(path);
        if(!loaded){
          loaded=new Promise((resolve,reject)=>this.modelLoader.load(path,g=>resolve(g.scene),undefined,reject));
          pathCache.set(path,loaded);
        }
        loaded.then(model=>{
          this.models.set(role,model);
          if(role==='terrain')this._attachTerrain();
          else this._applyModels(role);
          if(role==='truck'||role==='excavator'||role==='crusher'||role==='fuel'){
            const n=document.querySelector('#graphicsStatus');
            if(n)n.textContent=`GLB: ${this.models.size}/6 моделей`;
          }
        }).catch(error=>console.warn('MINE//MIRAGE asset failed; original proxy remains:',role,error));
      }
    }catch(error){console.warn('GLB manifest unavailable; using original scene:',error);}
  };
  MineWorld.prototype._loadRoadFit=async function(){
    if(this.software||!this.map||!['saryarka','altai'].includes(this.map.id))return;
    const mapId=this.map.id;
    if(this.__fitInFlight===mapId)return;
    this.__fitInFlight=mapId;
    try{
      const response=await fetch(`/models/road-fit-${mapId}.json`,{cache:'force-cache'});
      if(!response.ok)throw Error(`Road fitting HTTP ${response.status}`);
      const fit=await response.json();
      if(this.map?.id!==mapId||fit.mapId!==mapId)return;
      this.roadFit=fit;this._attachTerrain();
    }catch(error){console.warn('Terrain path fitting unavailable; default JSON roads kept:',error);}
    finally{if(this.__fitInFlight===mapId)this.__fitInFlight=null;}
  };
  const visualHeight=function(fit,edgeId,x,z,net){
    if(!fit)return null;
    const samples=fit.edgeHeight[edgeId],edge=net.edges.get(edgeId);
    if(!samples||!edge)return null;
    const from=net.nodes.get(edge.fromNode),to=net.nodes.get(edge.toNode);
    const dx=to.x-from.x,dz=to.z-from.z;
    const p=Math.max(0,Math.min(1,((x-from.x)*dx+(z-from.z)*dz)/Math.max(1,dx*dx+dz*dz)));
    const index=p*(samples.length-1),lo=Math.floor(index),hi=Math.min(samples.length-1,lo+1);
    return samples[lo]+(samples[hi]-samples[lo])*(index-lo);
  };
  MineWorld.prototype._terrainY=function(x,z,edgeId){
    if(!this.roadFit)return null;
    if(edgeId&&this.roadFit.edgeHeight[edgeId])return visualHeight(this.roadFit,edgeId,x,z,this.net);
    let best=Infinity,value=null;
    for(const edge of this.net.edges.values()){
      const a=this.net.nodes.get(edge.fromNode),b=this.net.nodes.get(edge.toNode),dx=b.x-a.x,dz=b.z-a.z;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/Math.max(1,dx*dx+dz*dz)));
      const dist=Math.hypot(x-a.x-dx*t,z-a.z-dz*t);
      if(dist<best){best=dist;value=visualHeight(this.roadFit,edge.id,x,z,this.net);}
    }
    return value;
  };
  MineWorld.prototype._attachTerrain=function(){
    if(this.software||!this.root||!this.map||!['saryarka','altai'].includes(this.map.id))return;
    const source=this.models.get('terrain');if(!source)return;
    if(!this.roadFit||this.roadFit.mapId!==this.map.id){if(!this.__fetchingFit){this.__fetchingFit=true;this._loadRoadFit().finally(()=>{this.__fetchingFit=false;});}return;}
    if(this.terrainModel){this.root.remove(this.terrainModel);this.terrainModel=null;}
    const fit=this.roadFit,terrain=source.clone(true);
    terrain.scale.set(fit.scaleXY,fit.scaleY,fit.scaleXY);
    terrain.position.set(fit.cx,fit.offsetY,fit.cz);
    terrain.traverse(mesh=>{mesh.userData.isExternal=true;if(mesh.isMesh){mesh.castShadow=false;mesh.receiveShadow=false;mesh.frustumCulled=true;}});
    this.root.add(terrain);this.terrainModel=terrain;
    if(!this.__removedStockTerrain){
      for(const part of this.root.children.slice(0,1+7+90)){
        this.root.remove(part);
        part.traverse(o=>{o.geometry?.dispose?.();if(o.material){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose?.());}});
      }
      this.__removedStockTerrain=true;
    }
    // The legacy compiled world creates a group and two poles for each edge.
    // Capture poles by order before replacing road groups, avoiding stale markers.
    if(!this.roadMarkers&&!this.__legacyMarkers){
      const all=this.root.children;
      const offset=0; // stock meshes have already been removed
      this.__legacyMarkers=all.slice(offset,offset+this.net.edges.size*3)
        .filter((_,i)=>i%3!==0);
    }
    // One terrain-following road layer, not floating slabs on top of baked terrain.
    // The centerlines remain tied to the actual JSON routing graph and GPS.
    for(const [id,road] of this.edgeMeshes){
      this.root.remove(road.group);
      const edge=this.net.edges.get(id),a=this.net.nodes.get(edge.fromNode),b=this.net.nodes.get(edge.toNode);
      const ys=fit.edgeHeight[id];if(!ys)continue;
      const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz)||1;
      const perpX=-dz/len,perpZ=dx/len,halfWidth=Math.max(3.6,Math.min(6,edge.width*.43));
      const vertices=[],indices=[],marking=[],marks=[];
      for(let i=0;i<ys.length;i++){
        const t=i/(ys.length-1),x=a.x+dx*t,z=a.z+dz*t,y=ys[i]+.23;
        vertices.push(x+perpX*halfWidth,y,z+perpZ*halfWidth,x-perpX*halfWidth,y,z-perpZ*halfWidth);
        marking.push(x+perpX*.17,y+.08,z+perpZ*.17,x-perpX*.17,y+.08,z-perpZ*.17);
        if(i<ys.length-1){const k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);marks.push(k,k+2,k+1,k+1,k+2,k+3);}
      }
      const make=(v,idx)=>{
        const g=road.slab.geometry.clone();
        // Replace the BoxGeometry's original vertex buffers with a terrain ribbon.
        for(const key of Object.keys(g.attributes))g.deleteAttribute(key);
        const Attribute=road.slab.geometry.getAttribute('position').constructor;
        g.setAttribute('position',new Attribute(new Float32Array(v),3));g.setIndex(idx);g.computeVertexNormals();return g;
      };
      const slab=road.slab.clone(false);slab.geometry=make(vertices,indices);slab.material=road.slab.material.clone();
      slab.material.color.setHex(0x796e59);slab.material.side=2;slab.material.polygonOffset=true;slab.material.polygonOffsetFactor=-1;
      const stripe=road.stripe.clone(false);stripe.geometry=make(marking,marks);stripe.material=road.stripe.material.clone();
      stripe.material.color.setHex(0xa4b1a0);stripe.material.side=2;
      const group=road.group;group.clear();group.position.set(0,0,0);group.rotation.set(0,0,0);group.add(slab,stripe);this.root.add(group);
      this.edgeMeshes.set(id,{group,slab,stripe});
    }
    // Old pole markers from procedural straight roads would otherwise hang in air.
    const oldMarkers=this.roadMarkers?.length?this.roadMarkers:this.__legacyMarkers||[];
    for(const marker of oldMarkers)this.root.remove(marker);
    for(const [nodeId,asset] of this.assets){
      const n=this.net.nodes.get(nodeId);if(n){const y=this._terrainY(n.x,n.z);if(y!==null)asset.group.position.y=y+.6;}
    }
    const status=document.querySelector('#graphicsStatus');if(status)status.textContent='GLB · дороги совмещены с рельефом';
  };
  MineWorld.prototype.loadMap=function(map){
    this.terrainModel=null;this.__removedStockTerrain=false;this.__legacyMarkers=null;
    this.__smoothTargets=new Map();this.roadFit=null;this.__fetchingFit=false;this.__fitInFlight=null;
    oldLoadMap.call(this,map);
    if(this.models.has('terrain'))this._loadRoadFit();
  };
  MineWorld.prototype._attachModel=function(entry,model){
    oldAttach.call(this,entry,model);
    if(!entry.external)return;
    if(entry.role==='truck'){entry.external.rotation.y=Math.PI/2;}
    // Keep the small status beacon from the original model visible.
    if(entry.group.userData.led)entry.group.userData.led.visible=true;
    entry.external.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=false;o.frustumCulled=true;}});
  };
  MineWorld.prototype.update=function(snapshot,...args){
    if(!snapshot)return;
    const previous=new Map();
    if(!this.software){for(const [id,v] of this.vehicles)previous.set(id,v.group.position.clone());}
    oldUpdate.call(this,snapshot,...args);
    if(!this.software){
      if(this.roadFit){for(const t of snapshot.fleet||[]){const v=this.vehicles.get(t.id);if(!v)continue;const p=t.gpsPosition||t.position;const y=this._terrainY(p.x,p.z,t.route);if(y!==null)v.group.position.y=y+.9;}}
      if(!this.__smoothTargets)this.__smoothTargets=new Map();
      for(const [id,v] of this.vehicles){
        const target=v.group.position.clone();
        this.__smoothTargets.set(id,target);
        const before=previous.get(id);
        if(before && before.distanceTo(target)<80)v.group.position.copy(before);
      }
    }
  };
  MineWorld.prototype.render=function(){
    if(!this.software&&this.__smoothTargets){
      for(const [id,target] of this.__smoothTargets){const vehicle=this.vehicles.get(id);if(vehicle)vehicle.group.position.lerp(target,0.24);}
    }
    oldRender.call(this);
  };
}

export function createOptimizedWorld(MineWorld,container){
  let world;
  const cpu=new URLSearchParams(location.search).get('graphics')==='cpu';
  try{world=new MineWorld(container,{software:cpu});}
  catch(error){
    console.warn('WebGL unavailable, falling back to CPU:',error);
    container.replaceChildren();world=new MineWorld(container,{software:true});
  }
  const chip=document.querySelector('.scene-chip');
  if(world.software){
    if(chip)chip.textContent='CANVAS · совместимый режим · без GLB';
  }else{
    world.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.15));
    world.renderer.shadowMap.enabled=false;
    world.sun.castShadow=false;
    if(chip)chip.textContent='MINE 3D · оптимизированные GLB · WebGL';
  }
  const status=document.createElement('span');status.id='graphicsStatus';status.className='mirage-graphics-status';status.textContent=world.software?'Canvas · старые модели':'Загрузка GLB…';
  const wrap=container.parentElement;wrap.append(status);
  const link=document.createElement('a');link.className='mirage-graphics-switch';
  link.textContent=world.software?'Включить 3D GLB ↗':'Совместимый режим ↗';
  link.href=world.software?location.pathname:location.pathname+'?graphics=cpu';
  wrap.append(link);
  // The production simulation stays on its existing 125 ms clock.
  // The GPU only interpolates visual positions at a capped 30 FPS.
  if(!world.software){
    world.renderer.domElement.addEventListener('webglcontextlost', event=>{event.preventDefault();world.__gpuLost=true;status.textContent='⚠ GPU-контекст потерян · включи совместимый режим';},{passive:false});
    world.renderer.domElement.addEventListener('webglcontextrestored',()=>{world.__gpuLost=false;status.textContent='GLB · GPU восстановлен';});
    let last=0,fpsStart=0,painted=0;
    const frame=(now)=>{
      if(!document.hidden && !world.__gpuLost && world.root && now-last>=33.2){
        last=now;
        try{world.render();painted++;}catch(err){console.error('GLB view error:',err);}
      }
      if(now-fpsStart>=1200){
        if(fpsStart&&world.root&&!world.__gpuLost){
          const fps=Math.round(painted*1000/(now-fpsStart));
          const calls=world.renderer.info?.render?.calls;
          status.textContent=`GLB · ${fps} FPS${Number.isFinite(calls)?` · ${calls} draw calls`:''}`;
        }
        fpsStart=now;painted=0;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  return world;
}
