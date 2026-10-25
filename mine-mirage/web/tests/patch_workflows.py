from pathlib import Path
R=Path(__file__).resolve().parent.parent
p=R/'assets/mine-scene.js'
s=p.read_text()
# Use exact model mapping in map.json instead of accidental reversal/hardcoded overrides.
start=s.index('const TERRAIN_SPECS=')
end=s.index('const rockMat=',start)
s=s[:start]+'''const centerOf=b=>({x:(b.minx+b.maxx)/2,y:(b.miny+b.maxy)/2,z:(b.minz+b.maxz)/2});
'''+s[end:]
s=s.replace("terrainSaryarka:'./models/mining_quarry.glb',\n      terrainAltai:'./models/open_pit_mine.glb',",
            "terrainSaryarka:'./models/open_pit_mine.glb',\n      terrainAltai:'./models/mining_quarry.glb',\n      conveyor:'./models/conveyor-kit.glb',")
start=s.index('  createTerrain(){')
end=s.index('  makeFallbackTerrain(){',start)
s=s[:start]+'''  createTerrain(){
    const {minX,maxX,minZ,maxZ,minY,centerX,centerZ}=this.mapBounds;
    const setup=this.map?.sceneDefinition?.terrainScale;
    const source=this.map?.sceneDefinition?.baseModel;
    const key=source==='mining_quarry.glb'?'terrainAltai':source==='open_pit_mine.glb'?'terrainSaryarka':'quarry';
    const prefab=this.modelCache[key];
    if(prefab&&setup){
      const terrain=prefab.clone(true);
      const boundsCenter=centerOf(setup);
      terrain.scale.set(setup.scale,setup.scaleY,setup.scale);
      terrain.position.set(-boundsCenter.x*setup.scale,setup.offsetY-setup.miny*setup.scaleY,-boundsCenter.z*setup.scale);
      terrain.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=true;}});
      this.terrainGroup.add(terrain);
    }else this.terrainGroup.add(this.makeFallbackTerrain());
    const plane=new Mesh(new PlaneGeometry(2100,1700),new MeshStandardMaterial({color:0x2e4249,roughness:1,side:DoubleSide}));
    plane.rotation.x=-Math.PI/2;plane.position.set(0,(minY||0)-110,0);this.terrainGroup.add(plane);
  }
'''+s[end:]
# rig work data
s=s.replace('this.snap=snap;\n    if(this.map', 'this.snap=snap;\n    if(this.map')
# truck/model node validation in same code
s=s.replace('const wheelBases=wheels.map(o=>o.rotation.x),bedBases=bed.map(o=>o.rotation.x);',
            "const wheelBases=wheels.map(o=>o.rotation.x),bedBases=bed.map(o=>o.rotation.x);if(wheels.length!==6||bed.length!==1)console.warn(truck.id+': wheel rig incomplete',wheels.length,bed.length);")
# replace crusher factory in code with GLB kit integrated + animated belt elements
start=s.index('  createCrusherFacility(n){')
end=s.index('  createStaticFacility(n){',start)
new='''  createCrusherFacility(n){
    const dir=this.nodeDirection(n.id);
    const root=new Group();root.position.set(n.x,n.elevation||0,n.z);root.rotation.y=dir.rot;
    const slab=new Mesh(new BoxGeometry(127,1.5,68),new MeshStandardMaterial({color:0x737777,roughness:1}));slab.position.set(35,-.75,12);root.add(slab);
    const approach=new Mesh(new BoxGeometry(42,1.0,19),new MeshStandardMaterial({color:0x585b5b,roughness:.95}));approach.position.set(-22,.15,0);root.add(approach);
    // Dump pocket is OFFSET from the physical driveway: truck stays on road.
    const hopper=new Mesh(new BoxGeometry(22,7,17),new MeshStandardMaterial({color:0x384c55,metalness:.18,roughness:.82}));hopper.position.set(-1,2.4,13);root.add(hopper);
    const rim=new Mesh(new BoxGeometry(24,1.5,19),new MeshStandardMaterial({color:0xc7954a,metalness:.18,roughness:.72}));rim.position.set(-1,7.7,13);root.add(rim);
    const screening=new Mesh(new BoxGeometry(10,8,10),new MeshStandardMaterial({color:0x5c6b72,metalness:.15,roughness:.82}));screening.position.set(17,7,13);root.add(screening);
    let kit=this.modelCache.conveyor?.clone(true);
    if(kit){
      // Kit bounds: x[-16,2074], y[-134,359], z[-534,146]. 5.5% = 115m complex.
      kit.scale.setScalar(.047);
      kit.position.set(9+.782,6.5+6.3,19+9.15);
      kit.rotation.y=0;
      root.add(kit);
    }
    // Keep jaw crusher at a realistic scale as a component, not the whole plant.
    let jaw=this.modelCache.crusher?.clone(true);
    if(jaw){jaw.scale.setScalar(3.0);jaw.position.set(28,.6,-7);jaw.rotation.y=.15;root.add(jaw);}
    const beltTrack=new Group();beltTrack.position.set(43,14,9);beltTrack.rotation.z=.21;root.add(beltTrack);
    const belt=new Mesh(new BoxGeometry(66,1.8,9),new MeshStandardMaterial({color:0x263238,roughness:1}));beltTrack.add(belt);
    const stripes=[];for(let i=0;i<12;i++){const m=new Mesh(new BoxGeometry(1.2,.17,8.2),new MeshStandardMaterial({color:0xe3ae59,roughness:.9}));m.position.y=1;beltTrack.add(m);stripes.push(m);}
    const rollers=[];for(let i=0;i<7;i++){const m=new Mesh(new IcosahedronGeometry(1.6,1),new MeshStandardMaterial({color:0x7c8c94,metalness:.3,roughness:.6}));m.position.set(-29+i*9,0,0);beltTrack.add(m);rollers.push(m);}
    const ore=[];for(let i=0;i<20;i++){const m=new Mesh(new IcosahedronGeometry(1.15,0),new MeshStandardMaterial({color:0x967959,roughness:1}));m.visible=false;root.add(m);ore.push(m);}
    const dustGeo=new BufferGeometry();dustGeo.setAttribute('position',new Float32BufferAttribute(new Float32Array(90*3),3));
    const dust=new Points(dustGeo,new PointsMaterial({color:0xcdb9a2,opacity:.25,transparent:true,size:2.5,depthWrite:false}));dust.visible=false;root.add(dust);
    this.facilityGroup.add(root);
    this.assets.set(n.id,{kind:'crusher',root,node:n,kit,jaw,stripes,rollers,ore,dust,beltOrigin:{x:43,y:14,z:9}});
    this.facilityRoots.set(n.id,root);
  }
'''
s=s[:start]+new+s[end:]
# pivot animations replace from animateModels
start=s.index('  animateModels(dt){')
end=s.index('  start(){',start)
new='''  animateModels(dt){
    // Animation is driven by ACTUAL engine states; idle excavators do not shovel the air.
    for(const [id,asset] of this.assets){
      if(asset.kind!=='excavator')continue;
      const live=this.snap?.assets?.[id];
      const truck=this.snap?.fleet?.find(t=>t.status==='loading'&&t.id===live?.busy&&t.target===id);
      const active=!!truck&&!this.snap?.flags?.loaderFault;
      const p=asset.pivots,b=asset.baseRotations||{};
      const phase=active?((truck.operationTimer||0)%8)/8:0;
      const dig=active?Math.sin(Math.PI*phase*2):0;
      const lift=active?Math.sin(Math.PI*phase):0;
      const turn=active?(phase<.5?phase*2:(1-phase)*2):0;
      if(p['excavator-boom-pivot'])p['excavator-boom-pivot'].rotation.x=(b['excavator-boom-pivot']?.x||0)+lift*.28;
      if(p['excavator-stick-pivot'])p['excavator-stick-pivot'].rotation.x=(b['excavator-stick-pivot']?.x||0)+dig*.31;
      if(p['excavator-bucket-pivot'])p['excavator-bucket-pivot'].rotation.x=(b['excavator-bucket-pivot']?.x||0)+(phase>.55&&phase<.85?-.44:0);
      if(p['excavator-turret-pivot']){
        // Pivot aims at the loading truck only during its loading window.
        let turret=(b['excavator-turret-pivot']?.y||0);
        if(truck){const dx=truck.position.x-asset.root.position.x,dz=truck.position.z-asset.root.position.z;const heading=-Math.atan2(dz,dx)-asset.root.rotation.y;turret+=heading*turn;}
        p['excavator-turret-pivot'].rotation.y=turret;
      }
      if(asset.loadingOre){asset.loadingOre.visible=!!truck&&phase>.52&&phase<.82;
        if(asset.loadingOre.visible&&truck){
          const origin=asset.root.position,delta={x:truck.position.x-origin.x,z:truck.position.z-origin.z};
          const a=Math.max(0,Math.min(1,(phase-.52)/.30));
          asset.loadingOre.position.set(delta.x*a,12+8*Math.sin(a*Math.PI),delta.z*a);
        }
      }
    }
    for(const [id,entity] of this.trucks){
      entity.wheels.forEach((w,i)=>w.rotation.x=(entity.wheelBases[i]||0)+entity.wheelAngle);
      const t=this.snap?.fleet?.find(x=>x.id===id);
      // Dump only while genuinely at the receiving station.
      const target=t?.status==='dumping'&&t?.speed<.2?0.83:0;
      entity.dumpLift=mix(entity.dumpLift,target,Math.min(1,dt*2));
      entity.bed.forEach((b,i)=>b.rotation.x=(entity.bedBases[i]||0)+entity.dumpLift);
      if(entity.ore){entity.ore.visible=target>0&&entity.dumpLift>.20;
        if(entity.ore.visible)entity.ore.children.forEach((stone,i)=>{const f=((t?.operationElapsed||0)*.8+i*.13)%1;stone.position.set(-2.5+(i%4)*1.2,7.5-6.8*f,-4.0-6*f);stone.rotation.x+=dt*(.7+i*.05);});
      }
    }
    for(const [id,asset] of this.assets){
      if(asset.kind!=='crusher')continue;
      const offline=!!this.snap?.flags?.powerFault||!!this.snap?.flags?.beltFault||(id==='crusher-a'&&!!this.snap?.flags?.crusherFault)||(id==='crusher-b'&&!!this.snap?.flags?.crusherBFault);
      const receiving=this.snap?.fleet?.some(t=>t.status==='dumping'&&t.target===id);
      const working=!offline&&((this.snap?.lines?.[id]||0)>0||!!receiving);
      asset.rollers.forEach((r,i)=>{if(working)r.rotation.z+=dt*(3+i*.12);});
      asset.stripes.forEach((stripe,i)=>{const u=working?(this.visualTime*.25+i/asset.stripes.length)%1:i/asset.stripes.length;stripe.position.set(-30+u*60,1,0);});
      asset.ore.forEach((stone,i)=>{
        const u=working?(this.visualTime*.23+i/asset.ore.length)%1:i/asset.ore.length;
        stone.position.set(13+u*65,10+u*10,9+Math.sin(i*2)*2.5);
        stone.visible=working;stone.rotation.x+=working?dt*.7:0;
      });
      asset.dust.visible=working;
      if(working){const att=asset.dust.geometry.getAttribute('position'),arr=att.array;
        for(let i=0;i<arr.length;i+=3){const u=i/3+this.visualTime;arr[i]=22+Math.sin(u)*7;arr[i+1]=11+Math.abs(Math.sin(u*1.1))*8;arr[i+2]=9+Math.cos(u*.7)*5;}att.needsUpdate=true;
      }
    }
  }
'''
s=s[:start]+new+s[end:]
# Add ore to excavator as distinct visual cue triggered by loading
s=s.replace("const ore=new Mesh(new IcosahedronGeometry(8,1),new MeshStandardMaterial({color:0x8f6f56,roughness:1}));ore.scale.set(1.7,.55,1.2);ore.position.set(-16,2,-6);root.add(ore);",
    "const ore=new Mesh(new IcosahedronGeometry(8,1),new MeshStandardMaterial({color:0x8f6f56,roughness:1}));ore.scale.set(1.7,.55,1.2);ore.position.set(-16,2,-6);root.add(ore);const loadingOre=new Mesh(new IcosahedronGeometry(2.2,0),new MeshStandardMaterial({color:0x99785d,roughness:1}));loadingOre.visible=false;this.fxGroup.add(loadingOre);this.assets.get(n.id).loadingOre=loadingOre;")
# Clear effects on map changes (otherwise stay leftover).
s=s.replace('this.clearGroup(this.terrainGroup);this.clearGroup(this.roadGroup);this.clearGroup(this.facilityGroup);this.clearGroup(this.machineGroup);',
            'this.clearGroup(this.terrainGroup);this.clearGroup(this.roadGroup);this.clearGroup(this.facilityGroup);this.clearGroup(this.machineGroup);this.clearGroup(this.fxGroup);')
# Fix map pin project placement untouched. update wheel angle in real units + clamp drift.
s=s.replace('entity.root.rotation.y=-Math.atan2(dz,dx);entity.wheelAngle+=travel/1.85;',
            'entity.root.rotation.y=-Math.atan2(dz,dx);entity.wheelAngle+=travel/1.85;')
# Frame cap normal 60-ish rather than 32
s=s.replace('if(now-this.lastTime<(this.lowPower?52:31))return;','if(now-this.lastTime<(this.lowPower?33:15))return;')
p.write_text(s)
# Make physical operation phases accessible. Preserve calculations unchanged.
ops=R/'live/modules/operations.js';o=ops.read_text()
needle='const fleet=this.trucks.map(t=>{const reading=t.lastTelemetry||this._truckSnapshot(t);return {...structuredClone(reading),edge:t.edge,from:t.from,to:t.to,progress:t.progress,reverse:t.reverse,'
replacement='const fleet=this.trucks.map(t=>{const reading=t.lastTelemetry||this._truckSnapshot(t);return {...structuredClone(reading),operationTimer:t.timer,operationElapsed:t.dumpElapsed||0,node:t.node,edge:t.edge,from:t.from,to:t.to,progress:t.progress,reverse:t.reverse,'
assert needle in o
ops.write_text(o.replace(needle,replacement))
# Note model name in UI and asset references
app=R/'assets/app.js';a=app.read_text()
a=a.replace('GLB-КАРЬЕР 5201 · реальные уступы и новые коридоры','5203 · два реальных GLB-карьера и поверхностные маршруты')
a=a.replace('Загружены два разных карьера (Сарыарка/Алтай), дробилка и анимированные машины','GLB: Сарыарка / Алтай · дорожная модель · конвейерный комплекс')
app.write_text(a)
