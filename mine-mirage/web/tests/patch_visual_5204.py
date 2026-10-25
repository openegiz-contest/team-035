from pathlib import Path
p=Path(__file__).resolve().parents[1]/'assets/mine-scene.js'
s=p.read_text()
start=s.index('  createRoads(){');end=s.index('  nodeDirection(nodeId){',start)
new='''  createRoads(){
    // Each road comes from the 3D mesh-derived route. No extra roads drawn from
    // the old coordinate graph and no interpolation across unsupported terrain.
    const shoulderMat=new MeshStandardMaterial({color:0x716a60,roughness:1,side:DoubleSide});
    const compactedMat=new MeshStandardMaterial({color:0x8c8172,roughness:1,side:DoubleSide});
    const centerMat=new MeshStandardMaterial({color:0xc3b399,roughness:1,side:DoubleSide});
    const laneStripeMat=new MeshBasicMaterial({color:0xe8d7b4,transparent:true,opacity:.72,side:DoubleSide,depthWrite:false});
    for(const edge of this.map.edges){
      const path=edge.path;
      if(!path || path.length<2)continue;
      const highSlope=(edge.maxGradePct||0)>16;
      // The road is narrower than old 21 m floating strips, laid just above
      // the GLB vertex-exact upper shell projected by the route builder.
      const width=edge.id.startsWith('S')?10.5:12.5;
      const pavement=[],dashes=[];
      let advance=0;
      for(let i=0;i<path.length-1;i++){
        const [x,z,y]=path[i],[xx,zz,yy]=path[i+1];
        const len=Math.hypot(xx-x,zz-z,yy-y);
        const count=Math.max(1,Math.ceil(len/5));
        for(let j=0;j<count;j++){
          const t=j/count;
          pavement.push(x+(xx-x)*t,y+(yy-y)*t+.45,z+(zz-z)*t);
        }
      }
      const last=path[path.length-1];pavement.push(last[0],last[2]+.45,last[1]);
      const shoulder=new Mesh(this.ribbon(pavement,width+3,.18),shoulderMat);
      const road=new Mesh(this.ribbon(pavement,width,.33),compactedMat);
      road.receiveShadow=shoulder.receiveShadow=true;
      this.roadGroup.add(shoulder,road);
      // Small spaced guidance dashes: easier to read than neon continuous strips.
      let run=0;
      for(let i=1;i<pavement.length/3;i++){
        const ax=pavement[(i-1)*3],ay=pavement[(i-1)*3+1],az=pavement[(i-1)*3+2];
        const bx=pavement[i*3],by=pavement[i*3+1],bz=pavement[i*3+2];
        const dist=Math.hypot(bx-ax,bz-az),steps=Math.max(1,Math.ceil(dist/2.5));
        for(let j=1;j<=steps;j++){
          run+=dist/steps;
          if((run%28)<8){const u=j/steps;dashes.push(ax+(bx-ax)*u,ay+(by-ay)*u+.7,az+(bz-az)*u);}
        }
      }
      // Keep road geometry continuous, but use a very subtle centre guidance.
      if(!highSlope && pavement.length>=6){
        const mid=new Mesh(this.ribbon(pavement,0.35,.76),centerMat);
        mid.material.transparent=true;mid.material.opacity=.30;mid.material.depthWrite=false;
        this.roadGroup.add(mid);
      }
      const overlay=new MeshBasicMaterial({color:highSlope?0xe2a94c:0xff5962,transparent:true,opacity:highSlope?.42:0,side:DoubleSide,depthWrite:false});
      const warning=new Mesh(this.ribbon(pavement,highSlope?1.3:2.0,.92),overlay);
      this.roadGroup.add(warning);
      this.roadSegments.push({id:edge.id,edge,mat:overlay,gradeReview:highSlope});
    }
  }
'''
s=s[:start]+new+s[end:]
# tidy unverified road logic
s=s.replace("seg.mat.opacity=hazard?.85:slow?.18:0;","seg.mat.opacity=hazard?.90:seg.gradeReview?.42:slow?.10:0;")
s=s.replace("const col=hazard?'#ff5260':slow?'#ffbf49':service?'#46c9ff':'#34dda0';","const col=hazard?'#ff5260':seg.gradeReview?'#edb44d':slow?'#ffbf49':service?'#46c9ff':'#34dda0';")
# crusher: control ore from hopper state instead of indiscriminate debris
old="""    const ore=[];for(let i=0;i<20;i++){const m=new Mesh(new IcosahedronGeometry(1.15,0),new MeshStandardMaterial({color:0x967959,roughness:1}));m.visible=false;root.add(m);ore.push(m);} 
"""
# no exact whitespace easier substr
begin=s.index('    const ore=[];for(let i=0;i<20;i++)',s.index('  createCrusherFacility(n){'))
end=s.index('    const dustGeo=',begin)
replacement='''    // Ore is rendered as tangible rock cargo on the actual conveyor, not floating dust.
    const cargoMaterial=new MeshStandardMaterial({color:0x7c6049,roughness:1});
    const ore=[];
    for(let i=0;i<12;i++){
      const stone=new Mesh(new IcosahedronGeometry(1.1+(i%3)*.23,1),cargoMaterial);
      stone.scale.set(1.5,.65,1.15);stone.visible=false;
      beltTrack.add(stone);ore.push(stone);
    }
    const hopperFill=new Mesh(new IcosahedronGeometry(5.7,1),cargoMaterial);
    hopperFill.position.set(-1,3.5,13);
    hopperFill.scale.set(1.55,.18,1.05);
    root.add(hopperFill);
    // A continuous physical ore bed inside the receiving pocket is visible
    // even when conveyor transport is stopped.
    const dumpStream=[];
    for(let i=0;i<10;i++){
      const piece=new Mesh(new IcosahedronGeometry(1.15+(i%3)*.18,0),cargoMaterial);
      piece.visible=false;this.fxGroup.add(piece);dumpStream.push(piece);
    }
'''
s=s[:begin]+replacement+s[end:]
# replace asset set to include the new objects, belt reference
s=s.replace('node:n,kit,jaw,stripes,rollers,ore,dust,beltOrigin:{x:43,y:14,z:9}', 'node:n,kit,jaw,stripes,rollers,ore,dumpStream,hopperFill,dust,beltTrack,beltOrigin:{x:43,y:14,z:9}')
# clear fx group must not leak? clear() does clear fxGroup but assets free; yes.
# remove entity.ore flying rubble; restrict to none to avoid duplicate visual (we now use dump stream via asset)
s=s.replace("if(entity.ore){entity.ore.visible=target>0&&entity.dumpLift>.20;", "if(entity.ore){entity.ore.visible=false;")
# choose animateModels crusher portion replace loop body from asset.rollers to end of asset.dust block
start=s.index('      asset.rollers.forEach',s.index('  animateModels(dt){'))
end=s.index('\n    }\n  }\n  start(){', start)
new='''      asset.rollers.forEach((r,i)=>{if(working)r.rotation.z+=dt*(2.2+i*.10);});
      asset.stripes.forEach((stripe,i)=>{
        const u=working?(this.visualTime*.13+i/asset.stripes.length)%1:i/asset.stripes.length;
        stripe.position.set(-30+u*60,1,0);
      });
      const hopperTonnes=Math.max(0,Number(this.snap?.lines?.[id]||0));
      const fill=clamp(hopperTonnes/320,0,1);
      asset.hopperFill.scale.y=.16+fill*.5;
      asset.hopperFill.position.y=3.0+fill*1.2;
      // Only a few solid, grouped rocks moving ALONG the belt.
      asset.ore.forEach((stone,i)=>{
        const u=(this.visualTime*.075+i/asset.ore.length)%1;
        stone.position.set(-29+u*59,2.05,((i%3)-1)*1.8);
        stone.rotation.z=0;
        stone.visible=working&&hopperTonnes>5 && i < 7;
      });
      // Material transfer is tied to an actual stationary dumper at this hopper.
      const dumper=this.snap?.fleet?.find(t=>t.node===id&&t.status==='dumping'&&t.speed<.2);
      const rig=dumper&&this.trucks.get(dumper.id);
      const receive=dumper&&rig&&dumper.operationElapsed>=1.8&&dumper.operationElapsed<7;
      asset.root.updateMatrixWorld(true);
      if(rig)rig.root.updateMatrixWorld(true);
      const origin=receive?rig.root.localToWorld(new Vector3(-3.5,9,-1.1)):null;
      const target=asset.root.localToWorld(new Vector3(-1,7.8,13));
      asset.dumpStream.forEach((stone,i)=>{
        stone.visible=!!receive;
        if(!receive)return;
        const u=((dumper.operationElapsed-1.8)*.50+i/asset.dumpStream.length)%1;
        stone.position.set(mix(origin.x,target.x,u),mix(origin.y,target.y,u)+3.2*Math.sin(Math.PI*u),mix(origin.z,target.z,u));
        stone.rotation.x+=dt*(.5+i*.04);
      });
      // No permanent arbitrary particle cloud; the solid material is the effect.
      asset.dust.visible=false;'''
s=s[:start]+new+s[end:]
# dumping lift timing only when actual
s=s.replace("const target=t?.status==='dumping'&&t?.speed<.2?0.83:0;", "const target=t?.status==='dumping'&&t?.speed<.2&&t.operationElapsed>=.8&&t.operationElapsed<=6.8?0.83:0;")
# revise terrain visible error warnings in UI later
p.write_text(s)
print('patched visual')
