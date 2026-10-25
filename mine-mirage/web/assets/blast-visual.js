/** Three.js drill field overlay, grounded on the imported quarry surface.
 * BUILD 5239: Altai drilling pad moved to marked separate bench; GLB animation preserved.
 */
import {G as Group,M as Mesh,q as BoxGeometry,c as IcosahedronGeometry,j as MeshStandardMaterial} from './three-vendor.js';
const mat=(color,metalness=.05)=>new MeshStandardMaterial({color,roughness:.72,metalness});
const C={planned:mat(0x778b9b),drilled:mat(0x23caef),charged:mat(0xf0bd58),fired:mat(0x57d59d)};
const chassis=mat(0xf1b83e),metal=mat(0x6d8c9a,.65),dark=mat(0x283944),glass=mat(0x2b8399,.3);
function cuboid(group,w,h,d,x,y,z,material){const part=new Mesh(new BoxGeometry(w,h,d),material);part.position.set(x,y,z);group.add(part);return part;}
function paintShadows(root){root.traverse?.(o=>{if(o?.isMesh){o.castShadow=true;o.receiveShadow=true;}});return root;}
function rememberBaseTransform(obj){obj.userData.bvrBase={x:obj.position.x,y:obj.position.y,z:obj.position.z,rx:obj.rotation.x,ry:obj.rotation.y,rz:obj.rotation.z,sx:obj.scale.x,sy:obj.scale.y,sz:obj.scale.z};return obj;}
function restoreBaseTransform(obj){const b=obj?.userData?.bvrBase;if(!b)return;obj.position.set(b.x,b.y,b.z);obj.rotation.set(b.rx,b.ry,b.rz);obj.scale.set(b.sx,b.sy,b.sz);}
function makeFallbackRig(){
  const rig=new Group();rig.name='blast-drill-rig-fallback';
  cuboid(rig,9,2.5,7,0,2.3,0,chassis);
  cuboid(rig,3.7,4.5,5.3,-1.7,5.6,0,chassis);
  cuboid(rig,3.5,2.1,3.6,-1.7,7.1,-.2,glass);
  for(const z of [-3.6,3.6]){cuboid(rig,8.8,1.55,1.2,0,1.2,z,dark);for(const x of [-3,0,3])cuboid(rig,1.2,1.1,1.5,x,1.15,z,metal);}  
  cuboid(rig,1.35,15,1.35,3,10.8,0,metal);
  cuboid(rig,.3,12,.3,3.4,11,0,dark);
  cuboid(rig,2.7,.8,2.7,3,18.0,0,chassis);
  cuboid(rig,.7,1.4,.7,0,8.8,0,mat(0xffd06c));
  return paintShadows(rig);
}
export class BlastVisual{
  constructor(world){
    this.world=world;this.root=new Group();this.root.name='blast-visual-learning';this.markers=[];
    this.usingGlb=false;this.baseRigYaw=Math.PI*0.18;
    const face=world.map.nodes.find(n=>n.id==='face-north')||world.map.nodes.find(n=>n.kind==='face');
    if(!face){this.position=null;return;}
    const mapId=world.map?.id||'';
    // User-selected isolated drill pad on the ALTAI map (left of the northern excavator
    // in the overhead view). Coordinates are in the existing quarry world system.
    // This override deliberately bypasses the old flatness-based search, which
    // kept choosing positions beside the loading face.
    const altaiPad=mapId==='altai'?{x:-327,z:-121}:null;
    const preferredOffsets={
      // Move the drill pad away from the excavator/loading face and onto a separate bench.
      saryarka:[[54,-72],[46,-64],[62,-82],[70,-60],[38,-86],[58,-92]],
      altai:[[48,-66],[60,-74],[36,-82],[54,-54],[68,-62],[42,-92]]
    };
    const ring=[[0,0],[14,0],[-14,0],[0,14],[0,-14],[18,18],[-18,-18],[25,0],[40,-40],[52,-56],[64,-72],[48,-84],[72,-48]];
    const candidateOffsets=[...(preferredOffsets[mapId]||[]),...ring];
    let best=null;
    for(const [ox,oz] of candidateOffsets){
      const x=face.x+ox,z=face.z+oz;
      const samples=[[-12,-10],[12,-10],[-12,10],[12,10],[0,0],[0,-14],[0,14],[-16,0],[16,0]].map(([dx,dz])=>world.groundHeight(x+dx,z+dz));
      if(samples.some(y=>!Number.isFinite(y)))continue;
      const range=Math.max(...samples)-Math.min(...samples);
      const dist=Math.hypot(ox,oz);
      // Prefer reasonably flat and clearly separated pads about 40m+ away from the excavator face.
      const separationPenalty=dist<38?(38-dist)*0.5:0;
      const preferredBonus=(preferredOffsets[mapId]||[]).some(([px,pz])=>px===ox&&pz===oz)?-3.5:0;
      const score=range*1.9 + separationPenalty + dist*0.03 + preferredBonus;
      if(!best||score<best.score)best={x,z,y:samples[4],score};
    }
    this.position=altaiPad
      ? {...altaiPad,y:world.groundHeight(altaiPad.x,altaiPad.z)}
      : best||{x:face.x+54,z:face.z-72,y:world.groundHeight(face.x+54,face.z-72)};
    for(let row=0;row<4;row++)for(let col=0;col<5;col++){
      const x=this.position.x+(col-2)*6,z=this.position.z+(row-1.5)*6,y=world.groundHeight(x,z);
      const holder=new Group();holder.position.set(x,y+.4,z);
      const base=cuboid(holder,3.5,.45,3.5,0,0,0,C.planned);
      const signal=cuboid(holder,.65,2,.65,0,1.2,0,C.planned);
      this.root.add(holder);this.markers.push({holder,base,signal});
    }

    this.rig=new Group();this.rig.name='blast-drill-rig';
    const drillPrefab=world.modelCache?.drill;
    if(drillPrefab){
      const model=paintShadows(drillPrefab.clone(true));
      model.name='blast-drill-rig-glb';
      // Make the on-site appearance closer to the rendered preview.
      model.scale.setScalar(1.18);
      model.rotation.y=Math.PI*0.67;
      model.position.set(0,.02,.9);
      this.rigModel=model;
      this.rig.add(model);
      this.usingGlb=true;
      this.collectAnimatedNodes(model);
    }else{
      this.rigModel=makeFallbackRig();
      this.rig.add(this.rigModel);
      this.anim={head:[],drill:[],cylinders:[],lights:[],body:[],tracks:[]};
    }
    rememberBaseTransform(this.rig);
    this.root.add(this.rig);

    this.pile=new Group();this.pile.visible=false;
    for(let i=0;i<16;i++){
      const rock=new Mesh(new IcosahedronGeometry(1.2+(i%4)*.45,0),mat(i%2?0x9f8977:0x736b62));
      rock.position.set((i%5-2)*4,((i*3)%4)*.45,Math.floor(i/5)*4-6);
      rock.scale.set(1.3,(i%3+1)*.5,1);
      this.pile.add(rock);
    }
    this.pile.position.set(this.position.x,this.position.y+.8,this.position.z);
    this.root.add(this.pile);
    world.fxGroup.add(this.root);
  }
  collectAnimatedNodes(model){
    this.anim={head:[],drill:[],cylinders:[],lights:[],body:[],tracks:[]};
    model.traverse(o=>{
      if(!o?.name)return;
      rememberBaseTransform(o);
      const n=o.name;
      if(/^MAST_(rotary_head|rotary_head_dark|rotary_head_drive|chuck)/.test(n))this.anim.head.push(o);
      else if(/^DRILL_/.test(n)||/^MAST_(guide_lower|guide_collar)/.test(n))this.anim.drill.push(o);
      else if(/^SUPPORT_chrome_piston/.test(n))this.anim.cylinders.push(o);
      else if(/^MAST_warning_light/.test(n)||/^CAB_beacon/.test(n))this.anim.lights.push(o);
      else if(/^TRACK_(road_wheel|sprocket)/.test(n))this.anim.tracks.push(o);
      else if(/^(CAB_|BODY_|MAST_)/.test(n))this.anim.body.push(o);
    });
  }
  update(snap){
    if(!this.position||!snap?.blast)return;
    this.lastSnap=snap;
    const b=snap.blast;
    this.markers.forEach((m,i)=>{
      const state=b.holes?.[i]?.status||'planned';
      m.base.material=C[state]||C.planned;m.signal.material=C[state]||C.planned;
      m.signal.scale.y=state==='planned'?.4:state==='fired'?.18:1;
      m.signal.position.y=state==='planned'?.5:state==='fired'?.22:1.2;
    });
    this.rig.visible=['drilling','ready','fired','inspection'].includes(b.phase);
    const active=Math.min(this.markers.length-1,Math.max(0,(b.drilled||1)-1));
    const marker=this.markers[active]||this.markers[0];
    if(marker){
      this.rig.position.copy(marker.holder.position);
      this.rig.position.y+=.08;
      this.rig.position.x-=this.usingGlb?1.2:3;
      this.rig.position.z+=this.usingGlb?.95:0;
      this.rig.rotation.y=this.baseRigYaw;
      this.rig.userData.baseWorld={x:this.rig.position.x,y:this.rig.position.y,z:this.rig.position.z,ry:this.rig.rotation.y};
    }
    this.pile.visible=!!b.completed;
    this.pile.scale.setScalar(.5+(b.fragmentation||.5)*.6);
  }
  animate(dt,time,snap){
    if(!this.rig?.visible)return;
    const b=snap?.blast||this.lastSnap?.blast;if(!b)return;
    const drilling=b.phase==='drilling';
    const armed=b.phase==='ready';
    const post=b.phase==='fired'||b.phase==='inspection';
    const base=this.rig.userData.baseWorld;
    if(base){
      const idleBob=drilling?Math.sin(time*5.1)*.05:Math.sin(time*1.6)*.012;
      this.rig.position.set(base.x,base.y+idleBob,base.z);
      this.rig.rotation.y=base.ry+(drilling?Math.sin(time*.85)*.03:0);
    }
    if(!this.usingGlb)return;
    const feed=drilling?(0.72+Math.sin(time*4.9)*0.88):(armed?0.22:(post?0.1:0));
    const spin=drilling?time*10.5:time*1.3;
    const pulse=drilling?(.97+Math.sin(time*8.6)*.05):(armed?1.02:1);
    this.anim.head.forEach(o=>{restoreBaseTransform(o);o.position.y+=feed;o.position.z+=Math.sin(time*4.9)*.03;});
    this.anim.drill.forEach(o=>{restoreBaseTransform(o);o.position.y+=feed*1.02;o.rotation.y+=spin;o.position.z+=Math.sin(time*4.9)*.02;});
    this.anim.cylinders.forEach((o,i)=>{restoreBaseTransform(o);o.position.y+=feed*(.24+i*.02);});
    this.anim.lights.forEach((o,i)=>{restoreBaseTransform(o);const on=drilling?(Math.floor(time*6+i)%2===0):armed; o.scale.set(o.scale.x*(on?1.08:1),o.scale.y*(on?1.08:1),o.scale.z*(on?1.08:1));});
    this.anim.body.forEach(o=>{restoreBaseTransform(o); if(drilling&&/^CAB_|^BODY_/.test(o.name))o.rotation.z+=Math.sin(time*5.1)*0.002;});
    this.anim.tracks.forEach((o,i)=>{restoreBaseTransform(o); if(armed){o.rotation.x+=Math.sin(time*2.8+i)*.01;}});
    if(this.rigModel){this.rigModel.scale.setScalar(1.18*pulse);this.rigModel.rotation.y=Math.PI*0.67 + (drilling?Math.sin(time*.6)*.018:0);}
  }
  focus(){
    if(!this.position)return;
    const p=this.position;this.world.trackedTruck=null;
    this.world.controls.target.set(p.x,p.y+8,p.z);
    this.world.camera.position.set(p.x+52,p.y+40,p.z+56);
    this.world.controls.update();
  }
}
