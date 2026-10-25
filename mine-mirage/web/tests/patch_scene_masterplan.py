from pathlib import Path
p=Path(__file__).resolve().parents[1]/'assets/mine-scene.js'
s=p.read_text()
s=s.replace("this.roadSegments=[];this.roadCache=[];this.visualRoads=new Map();", "this.roadSegments=[];this.roadCache=[];this.visualRoads=new Map();this.mainRampSamples=[];")
s=s.replace("this.roadSegments=[];this.roadCache=[];this.visualRoads=new Map();this.trackedTruck=null;", "this.roadSegments=[];this.roadCache=[];this.visualRoads=new Map();this.mainRampSamples=[];this.trackedTruck=null;")
a=s.index('  terrainBase(x,z){'); b=s.index('  edgeLength(e){',a)
s=s[:a]+'''  spiral(t){
    const d=this.map?.sceneDefinition;
    if(!d)return {x:0,y:0,z:0};
    const s=clamp(t,0,1),ang=d.initial+Math.PI*2*d.turns*s,r=d.inner+(d.outer-d.inner)*s;
    return {x:d.cx+Math.cos(ang)*r,y:d.bottom+(d.top-d.bottom)*s,z:d.cz+Math.sin(ang)*r*d.stretch};
  }
  terrainBase(x,z){
    const d=this.map?.sceneDefinition;
    if(!d)return 0;
    const radial=Math.hypot(x-d.cx,(z-d.cz)/d.stretch);
    const t=clamp((radial-d.inner)/(d.outer-d.inner),0,1);
    // True separate working terraces; road ramp is cut between benches.
    const bands=d.profile==='masterplan-v1'?9:7;
    const scaled=t*bands;
    const bench=Math.min(bands,Math.floor(scaled+.000001));
    const lip=scaled-Math.floor(scaled);
    const gentle=clamp((lip-.80)/.20,0,1);
    const height=d.bottom+(d.top-d.bottom)*(bench+gentle*.92)/bands;
    const localRock=(Math.sin(x*.045+z*.018)*Math.cos(z*.036-x*.012))*1.45+Math.sin(x*.009-z*.017)*1.2;
    return height+localRock*(radial>d.inner?1:.2);
  }
  roadCurve(edge,t){
    return this.sampleRoadRecord(this.visualRoads.get(edge.id),t);
  }
  sampleRoadRecord(record,t){
    if(!record?.points?.length)return {x:0,y:0,z:0};
    const target=clamp(t,0,1)*record.total;
    let i=1;while(i<record.cumulative.length-1&&record.cumulative[i]<target)i++;
    const left=record.cumulative[i-1]||0;
    const span=(record.cumulative[i]-left)||1;
    const u=clamp((target-left)/span,0,1);
    const a=record.points[i-1],b=record.points[i];
    return {x:mix(a[0],b[0],u),z:mix(a[1],b[1],u),y:mix(a[2],b[2],u)};
  }
  sampleRoadById(id,t){return this.sampleRoadRecord(this.visualRoads.get(id),t);}
  prepareRoads(){
    this.nodes=new Map(this.map.nodes.map(n=>[n.id,n]));
    this.roadCache=[];this.visualRoads=new Map();
    this.mainRampSamples=[];
    for(let i=0;i<=220;i++)this.mainRampSamples.push(this.spiral(i/220));
    for(const edge of this.map.edges){
      const a=this.nodes.get(edge.fromNode),b=this.nodes.get(edge.toNode);
      const pts=edge.path?.length>1?edge.path:[[a.x,a.z,a.elevation||0],[b.x,b.z,b.elevation||0]];
      let total=0;const cum=[0];for(let i=1;i<pts.length;i++){
        const p=pts[i-1],q=pts[i];total+=Math.hypot(q[0]-p[0],q[1]-p[1],q[2]-p[2]);cum.push(total);
      }
      const record={id:edge.id,edge,points:pts,cumulative:cum,total:Math.max(total,.0001)};
      this.visualRoads.set(edge.id,record);
    }
    // Master ramp and service spurs are generated from the quarry layout,
    // not from the old web of graph chords.
    this.roadCache.push(...this.mainRampSamples);
    for(const node of this.map.nodes){
      const base=this.spiral(node.masterplanT||0);
      for(let i=0;i<=8;i++){const t=i/8;this.roadCache.push({x:mix(node.x,base.x,t),z:mix(node.z,base.z,t),y:mix(node.elevation||0,base.y,t)});}
    }
  }
  terrainHeight(x,z){
    let h=this.terrainBase(x,z),min=Infinity,roadY=0;
    const check=(p,q)=>{
      const dx=q.x-p.x,dz=q.z-p.z;
      const t=clamp(((x-p.x)*dx+(z-p.z)*dz)/(dx*dx+dz*dz||1),0,1);
      const px=mix(p.x,q.x,t),pz=mix(p.z,q.z,t),dist2=(x-px)**2+(z-pz)**2;
      if(dist2<min){min=dist2;roadY=mix(p.y,q.y,t);}
    };
    const pts=this.mainRampSamples;
    for(let i=1;i<pts.length;i++)check(pts[i-1],pts[i]);
    for(const node of this.map.nodes){
      const base=this.spiral(node.masterplanT||0);
      check({x:base.x,z:base.z,y:base.y},{x:node.x,z:node.z,y:node.elevation||0});
    }
    // Ramp is engineered into the wall as a 24 m horizontal bench with
    // gradual shoulders; the remainder of the quarry retains fixed geology.
    const d=Math.sqrt(min);
    if(d<50){const weight=Math.pow(clamp((50-d)/34,0,1),1.4);h=mix(h,roadY-.85,weight);}
    return h;
  }
''' + s[b:]
# replace other height geometry color carefully
s=s.replace("const isAltai=map.id==='altai';const rx=isAltai?1010:865,rz=isAltai?760:645;", "const isAltai=map.id==='altai';const d=map.sceneDefinition;const rx=d?.radiusX||(isAltai?1010:865),rz=d?.radiusZ||(isAltai?760:645);")
# profile spec strata should map to actual quarry
s=s.replace("const rings=this.lowPower?6:8,cx=isAltai?-260:-275,cz=isAltai?-10:0;\n    for(let ring=1;ring<=rings;ring++){\n      const r=ring/(rings+1),y=-109+r*145;\n      const edge=this.makeStrataCurve(cx,cz,(isAltai?650:560)*r,(isAltai?465:390)*r,y);",
"const rings=this.lowPower?6:8,cx=d?.cx||-275,cz=d?.cz||0;\n    for(let ring=1;ring<=rings;ring++){\n      const r=ring/(rings+1),y=this.terrainBase(cx+(d?.outer||560)*r,cz);\n      const edge=this.makeStrataCurve(cx,cz,(d?.outer||560)*r,(d?.outer||560)*(d?.stretch||.8)*r,y);")
# replace createRoads entire function
start=s.index('  createRoads(map){');end=s.index('  createFacilities(map){',start)
s=s[:start]+'''  createRoads(map){
    // The physical master ramp is authored FIRST. The traffic graph's edge
    // paths follow it instead of covering the mine with radial straight lines.
    const asphalt=new MeshStandardMaterial({color:0x555556,roughness:.98,side:DoubleSide});
    const shoulders=new MeshStandardMaterial({color:0xa39b8d,roughness:1,side:DoubleSide});
    const routeLine=new MeshBasicMaterial({color:0x39d4ac,transparent:true,opacity:.66,side:DoubleSide,depthWrite:false});
    const pts=this.mainRampSamples.flatMap(p=>[p.x,p.y+.35,p.z]);
    this.root.add(new Mesh(this.ribbon(pts,31),shoulders));
    this.root.add(new Mesh(this.ribbon(pts,25,.37),asphalt));
    this.root.add(new Mesh(this.ribbon(pts,1.45,.87),routeLine));
    // Industrial pads and individual spurs belong to each machine zone.
    for(const node of map.nodes){
      const base=this.spiral(node.masterplanT||0);
      if(Math.hypot(node.x-base.x,node.z-base.z)<8)continue;
      const spur=[base.x,base.y+.35,base.z,node.x,node.elevation+.35,node.z];
      this.root.add(new Mesh(this.ribbon(spur,20),asphalt));
      this.root.add(new Mesh(this.ribbon(spur,1.5,.95),routeLine));
    }
    // Scenarios color only their affected graph routes. Ordinary roads
    // are never drawn 34 times on top of each other.
    for(const edge of map.edges){
      const record=this.visualRoads.get(edge.id);
      const n=Math.max(8,Math.ceil(record.total/18)),route=[];
      for(let k=0;k<=n;k++){const p=this.sampleRoadRecord(record,k/n);route.push(p.x,p.y+.93,p.z);}
      const mat=new MeshBasicMaterial({color:0xffb84a,opacity:0,transparent:true,side:DoubleSide,depthWrite:false});
      const strip=new Mesh(this.ribbon(route,3.4),mat);this.root.add(strip);
      this.roadSegments.push({id:edge.id,edge,mat,strip,under:null});
    }
  }
''' +s[end:]
# remove flat boxes for crushers: replace facilities definition/add supplemental box
s=s.replace("const pads=['crusher-a','crusher-b','fuel','workshop','depot','substation','weigh'];", "const pads=['fuel','workshop','depot','substation','weigh'];")
start=s.index('    // Plant conveyor / crusher facility structures.');end=s.index('  createRockFields(map){',start)
s=s[:start]+'''    // Crusher buildings come from articulated machinery, not giant cubes.
  }
''' +s[end:]
# update road colored hazards only
s=s.replace("seg.mat.color.set(col);seg.mat.opacity=hazard?.91:.70;", "seg.mat.color.set(col);seg.mat.opacity=hazard?.95:slow?.32:0;")
# update trucks proper from/orient use true t.position; override inconsistent visual edge sampling
start=s.index('    for(const t of snap.fleet){const entity=this.trucks.get(t.id);if(!entity)continue;')
end=s.index('    this.rainClouds.visible=',start)
s=s[:start]+'''    for(const t of snap.fleet){const entity=this.trucks.get(t.id);if(!entity)continue;
      const pos=t.position;
      // Same polyline interpolation as MineOperations.network.interpolate.
      // In particular a reverse-oriented edge is not flipped a second time.
      entity.root.position.set(pos.x,pos.elevation+.35,pos.z);
      const dx=pos.x-entity.lastX,dz=pos.z-entity.lastZ;
      const travel=Math.hypot(dx,dz);
      if(travel>.005){entity.root.rotation.y=-Math.atan2(dz,dx);entity.wheelAngle+=travel/3.68;}
      entity.lastX=pos.x;entity.lastZ=pos.z;entity.payload=t.payload;entity.status=t.status;
      entity.speed=t.speed;entity.actualTravel=travel;
      if(this.trackedTruck===t.id){
        const target=entity.root.position.clone();target.y+=8;
        const cameraShift=target.sub(this.controls.target);
        this.controls.target.add(cameraShift);this.camera.position.add(cameraShift);
      }
    }
''' +s[end:]
# avoid shared GLB link issue / keep
p.write_text(s)
print('mine scene new chars',len(s))
