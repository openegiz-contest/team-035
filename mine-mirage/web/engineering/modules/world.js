import * as THREE from 'three';
import {Software3DRenderer} from './software-3d.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createNetwork} from './network.js';
const col={rock:0x655e4f,loam:0xa18a69,low:0x202e32,road:0x384a4b,cyan:0x3ddac0,warning:0xf67360,yellow:0xf3b847};
const mat=(c,metalness=.05,roughness=.86)=>new THREE.MeshStandardMaterial({color:c,metalness,roughness});
const geomBox=(g,w,h,d,x,y,z,material)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;g.add(m);return m;};
function glyph(text,color='#9defda',width=280){const canvas=document.createElement('canvas');canvas.width=512;canvas.height=112;const ctx=canvas.getContext('2d');ctx.fillStyle='#0a1b25ed';ctx.beginPath();ctx.roundRect(3,3,506,105,12);ctx.fill();ctx.fillStyle=color;ctx.fillRect(15,17,5,77);ctx.font='bold 29px Arial';ctx.fillStyle='#e1f6f1';ctx.fillText(String(text).slice(0,24),36,69);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;const s=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthWrite:false}));s.scale.set(width/5,width/5*.22,1);s.userData.labelText=String(text).slice(0,24);return s;}
function vehicleModel(){const g=new THREE.Group();const chassis=mat(0xc68b28,.25,.46),bright=mat(0xe6b448,.16,.54),dark=mat(0x172327,.1,.8),glass=mat(0x395c62,.65,.2),ore=mat(0x666258);
 geomBox(g,11,2.2,6,0,2.4,0,chassis);geomBox(g,4,5.1,5.4,3.3,4,0,bright);geomBox(g,3.7,2.4,5.55,4.1,5.2,0,glass);geomBox(g,6.8,2.7,6.1,-2.5,4.2,0,chassis);geomBox(g,6.3,1.2,5.4,-2.5,5.4,0,ore);
 for(const x of [-3.6,1.1,4])for(const z of [-3.5,3.5]){const wheel=new THREE.Mesh(new THREE.CylinderGeometry(1.65,1.65,1.2,12),dark);wheel.rotation.x=Math.PI/2;wheel.position.set(x,1.55,z);wheel.castShadow=true;g.add(wheel);}
 const led=new THREE.Mesh(new THREE.SphereGeometry(.55,8,8),new THREE.MeshBasicMaterial({color:0x50e5b6}));led.position.set(4,7.7,0);g.add(led);g.userData.led=led;return g;
}
function excavatorModel(){const g=new THREE.Group(),steel=mat(0x2d393e),cab=mat(0xebac33,.2,.6),glass=mat(0x35616a,.5,.3);
 geomBox(g,16,2,10,0,2,0,steel);for(const side of [-1,1])geomBox(g,15,3,3,0,1.4,side*4,steel);
 geomBox(g,11,4.3,9,0,5,0,cab);geomBox(g,6,4,8,-2.6,8,0,glass);
 const arm=new THREE.Group();arm.position.set(3.2,8,0);const a=geomBox(arm,17,1.6,2,9,4,0,cab);a.rotation.z=.45;const b=geomBox(arm,12,1.4,1.5,19,5,0,cab);b.rotation.z=-.4;geomBox(arm,5,4,5,24,1,0,steel);g.add(arm);g.userData.arm=arm;return g;
}
function crusherModel(){const g=new THREE.Group(),s=mat(0x4b656a,.63,.45),dark=mat(0x203035);
 geomBox(g,38,4,30,0,4,0,s);for(const x of [-13,13])for(const z of [-10,10])geomBox(g,2,22,2,x,16,z,s);
 geomBox(g,26,15,23,0,16,0,dark);geomBox(g,32,7,18,0,27,0,s);geomBox(g,44,2.5,8,27,10,5,dark);return g;
}
function serviceModel(kind){const g=new THREE.Group(),material=mat(kind==='fuel'?0x209a90:0x586c75,.3,.55);
 geomBox(g,36,8,29,0,5,0,material);geomBox(g,38,2,31,0,11,0,mat(0x9cafa8));
 if(kind==='fuel')for(const x of [-10,0,10])geomBox(g,4,7,4,x,1,-19,mat(0xe7bb51));
 return g;
}
export class MineWorld {
 constructor(container, {software=false}={}){this.software=software;this.container=container;this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x101e27);this.scene.fog=new THREE.FogExp2(0x101e27,.00061);
   this.camera=new THREE.PerspectiveCamera(47,1,1,7000);this.camera.position.set(800,770,870);
   if(software){this.renderer=new Software3DRenderer();this.renderer.setSize(container.clientWidth||1000,container.clientHeight||500);}
   else{this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.6));this.renderer.setSize(container.clientWidth||1000,container.clientHeight||500);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.35;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;}
   container.appendChild(this.renderer.domElement);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.maxPolarAngle=Math.PI*.486;this.controls.minDistance=45;this.controls.maxDistance=2750;this.controls.target.set(0,0,0);
   this.scene.add(new THREE.HemisphereLight(0xbde1ed,0x5c4737,2.2));this.sun=new THREE.DirectionalLight(0xffd6a0,3.15);this.sun.position.set(-700,900,450);this.sun.castShadow=!software;this.sun.shadow.mapSize.set(2048,2048);Object.assign(this.sun.shadow.camera,{left:-1200,right:1200,top:1200,bottom:-1200,near:1,far:4000});this.sun.shadow.bias=-.0003;this.scene.add(this.sun);
   this.night=false;this.root=null;this.vehicles=new Map();this.edgeMeshes=new Map();this.assets=new Map();this.modelCatalog={};this.modelLoader=new GLTFLoader();this.models=new Map();
   this.rainParticles=null;this.dustParticles=null;this.gpsOrb=null;this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);if(!this.software)this._loadModels();
 }
 async _loadModels(){try{const r=await fetch('/models/manifest.json');if(!r.ok)return;this.modelCatalog=await r.json();for(const [role,path] of Object.entries(this.modelCatalog)){if(!path)continue;this.modelLoader.load(path,(g)=>{this.models.set(role,g.scene);this._applyModels(role);},undefined,()=>{});}}catch{} }
 _applyModels(role){const item=this.models.get(role);if(!item)return;const entries=role==='truck'?this.vehicles.values():this.assets.values();for(const entry of entries)if(entry.role===role)this._attachModel(entry,item);}
 _attachModel(entry,model){if(entry.external)return;const group=entry.group;group.children.forEach(c=>c.visible=false);const obj=model.clone(true);obj.traverse(c=>{c.userData.isExternal=true;if(c.isMesh){c.castShadow=true;c.receiveShadow=true;}});
   const b=new THREE.Box3().setFromObject(obj);const dim=new THREE.Vector3();b.getSize(dim);const maxDim=Math.max(dim.x,dim.y,dim.z,1);
   const target=entry.role==='truck'?13:entry.role==='excavator'?42:entry.role==='crusher'?45:31;
   obj.scale.setScalar(target/maxDim);obj.position.y=1;group.add(obj);entry.external=obj;
 }
 _height(node){return 2+(node.elevation||0)*(this.map.heightScale??.08);}
 loadMap(map){
   if(this.root){this.scene.remove(this.root);this.root.traverse(o=>{if(o.geometry && !o.userData.isExternal)o.geometry.dispose();if(o.material&&!o.userData.isExternal){const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>{if(m.map)m.map.dispose();m.dispose();});}});}
   this.map=map;this.net=createNetwork(map);this.hazardRing=null;this.rockfall=null;this.hazardPosition=null;this.root=new THREE.Group();this.scene.add(this.root);this.vehicles.clear();this.assets.clear();this.edgeMeshes.clear();this.gpsOrb=null;
   const xs=map.nodes.map(n=>n.x),zs=map.nodes.map(n=>n.z),cx=(Math.min(...xs)+Math.max(...xs))/2,cz=(Math.min(...zs)+Math.max(...zs))/2;
   const spanX=Math.max(...xs)-Math.min(...xs),spanZ=Math.max(...zs)-Math.min(...zs),radius=Math.max(spanX,spanZ)*.74;
   const plane=new THREE.Mesh(new THREE.PlaneGeometry(radius*4,radius*4),mat(0x554e43));plane.rotation.x=-Math.PI/2;plane.position.set(cx,-26,cz);plane.receiveShadow=true;this.root.add(plane);
   for(let i=0;i<7;i++){
     const a=radius*(.66+i*.095),b=radius*(.75+i*.095),height=-19+i*5.0;
     const positions=[],indices=[];
     const slices=this.software?52:100;for(let j=0;j<=slices;j++){const theta=j/slices*Math.PI*2;
       positions.push(cx+Math.cos(theta)*a,height,cz+Math.sin(theta)*a*.72,cx+Math.cos(theta)*b,height+5,cz+Math.sin(theta)*b*.72);
       if(j<slices){const k=j*2;indices.push(k,k+1,k+2,k+1,k+3,k+2);}}
     const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();const band=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:i%2?0x887963:0x6d6354,side:THREE.DoubleSide,roughness:1}));band.receiveShadow=true;this.root.add(band);
   }
   // Geological benches, not a DEM; paths are generated from node elevation, not hand-coded coordinates.
   const rockMaterial=mat(0x82725e);
   for(let i=0;i<(this.software?46:90);i++){const ang=i*2.399,rad=radius*(.75+(i%14)*.027),x=cx+Math.cos(ang)*rad,z=cz+Math.sin(ang)*rad*.71;
     const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(2.7+(i*3%7),0),rockMaterial);rock.position.set(x,-12+(i%7)*2,z);rock.rotation.y=i*.8;rock.castShadow=i%3===0;this.root.add(rock);
   }
   for(const e of this.net.edges.values()){
     const a=this.net.nodes.get(e.fromNode),b=this.net.nodes.get(e.toNode),from=new THREE.Vector3(a.x,this._height(a),a.z),to=new THREE.Vector3(b.x,this._height(b),b.z),diff=to.clone().sub(from);
     const length=diff.length(),g=new THREE.Group();g.position.copy(from).add(to).multiplyScalar(.5);g.rotation.y=-Math.atan2(diff.z,diff.x);g.rotation.z=Math.atan2(diff.y,Math.hypot(diff.x,diff.z));
     const slab=new THREE.Mesh(new THREE.BoxGeometry(length,1.2,13),mat(0x39494a));slab.receiveShadow=true;g.add(slab);
     const stripe=new THREE.Mesh(new THREE.BoxGeometry(length,1.23,.35),new THREE.MeshBasicMaterial({color:0x7c9992}));stripe.position.y=.02;g.add(stripe);
     if(e.id.includes('BYP')){const verge=new THREE.Mesh(new THREE.BoxGeometry(length,1.22,1.7),new THREE.MeshBasicMaterial({color:0x358b79}));verge.position.z=-6.5;g.add(verge);}
     g.userData.roadLength=length;this.root.add(g);this.edgeMeshes.set(e.id,{group:g,slab,stripe});
     for(const node of [a,b]){const pole=new THREE.Mesh(new THREE.CylinderGeometry(.35,.6,8,6),mat(0x465d62));pole.position.set(node.x,this._height(node)+4,node.z);this.root.add(pole);}
   }
   for(const n of map.nodes){if(!['face','crusher','depot','fuel','workshop','power','refuge','weigh'].includes(n.kind))continue;
     const role=n.kind==='face'?'excavator':n.kind==='crusher'?'crusher':n.kind;
     const group=n.kind==='face'?excavatorModel():n.kind==='crusher'?crusherModel():serviceModel(n.kind);
     group.position.set(n.x,this._height(n),n.z);
     this.root.add(group);const entry={role,group};this.assets.set(n.id,entry);if(this.models.has(role))this._attachModel(entry,this.models.get(role));
     const tag=glyph(n.name.toUpperCase(),n.kind==='crusher'?'#ffc478':n.kind==='face'?'#61f5c5':'#bed4d8');tag.position.set(n.x,this._height(n)+42,n.z);this.root.add(tag);
   }
   for(let i=0;i<clamp(this.map.fleetSize||12,5,28);i++){
     const id=`HT-${String(i+1).padStart(2,'0')}`,group=vehicleModel();group.scale.setScalar(1.12);this.root.add(group);const entry={role:'truck',group};this.vehicles.set(id,entry);
     if(this.models.has('truck'))this._attachModel(entry,this.models.get('truck'));
   }
   const dangerNode=this.net.edges.get(map.hazards?.[0]?.edgeId);if(dangerNode){const a=this.net.nodes.get(dangerNode.fromNode),b=this.net.nodes.get(dangerNode.toNode);this.hazardPosition=new THREE.Vector3((a.x+b.x)/2,Math.max(this._height(a),this._height(b))+5,(a.z+b.z)/2);
     const material=new THREE.MeshBasicMaterial({color:0xf27859,transparent:true,opacity:.5,side:THREE.DoubleSide});this.hazardRing=new THREE.Mesh(new THREE.RingGeometry(22,24,64),material);this.hazardRing.rotation.x=-Math.PI/2;this.hazardRing.position.copy(this.hazardPosition);this.root.add(this.hazardRing);
     const label=glyph('SLOPE-07 · УСТУП','#ff967e',245);label.position.set(this.hazardPosition.x,this.hazardPosition.y+48,this.hazardPosition.z);this.root.add(label);
     this.rockfall=new THREE.Group();this.root.add(this.rockfall);
     const stones=mat(0x968671);
     for(let i=0;i<36;i++){
       const size=2.2+(i*11%8)*.65,stone=new THREE.Mesh(new THREE.DodecahedronGeometry(size,0),stones);
       stone.userData={dropDelay:(i%10)*.26,offsetX:(i*13%53)-26,offsetZ:(i*17%47)-23,size};
       stone.position.set(this.hazardPosition.x+stone.userData.offsetX,this.hazardPosition.y+40,this.hazardPosition.z+stone.userData.offsetZ);
       stone.castShadow=true;this.rockfall.add(stone);
     }
     this.rockfall.visible=false;
   }
   this.rainParticles=this._particles(this.software?100:450,radius,cx,cz,0xa4d8ff,1.2);this.dustParticles=this._particles(this.software?75:310,radius,cx,cz,0xc7ad78,2.2);
   this.gpsOrb=new THREE.Mesh(new THREE.RingGeometry(1,1.08,64),new THREE.MeshBasicMaterial({color:0x83d5ff,transparent:true,opacity:.65,side:THREE.DoubleSide}));this.gpsOrb.rotation.x=-Math.PI/2;this.gpsOrb.visible=false;this.root.add(this.gpsOrb);
   this.controls.maxDistance=radius*4;this.controls.target.set(cx,0,cz);this.camera.position.set(cx+radius*1.2,radius*.91,cz+radius*.94);this.camera.far=Math.max(5000,radius*9);this.camera.updateProjectionMatrix();this.controls.update();
 }
 _particles(count,radius,cx,cz,color,size){const points=new Float32Array(count*3);for(let i=0;i<count;i++){const x=Math.sin(i*13.4)*12345.6,z=Math.sin(i*7.73)*2234;points[i*3]=cx+(x-Math.floor(x)-.5)*radius*2;points[i*3+1]=Math.max(1,((i*17)%110));points[i*3+2]=cz+(z-Math.floor(z)-.5)*radius*2;}
   const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(points,3));const p=new THREE.Points(geo,new THREE.PointsMaterial({color,size,transparent:true,opacity:.56,depthWrite:false}));p.visible=false;this.root.add(p);return p;
 }
 update(snap,elapsed=0){if(!snap||!this.map||snap.mapId!==this.map.id)return;
   const flags=snap.flags;
   for(const [id,road] of this.edgeMeshes){const blocked=snap.blocked.includes(id);const traffic=snap.traffic[id]||0;road.slab.material.color.set(blocked?0x843a36:traffic>3?0x785f44:0x39494a);road.stripe.material.color.set(blocked?0xff7466:traffic>3?0xf4ae58:0x89b0a7);}
   const lights=snap.geology.status;if(this.hazardRing){this.hazardRing.visible=lights!=='stable';this.hazardRing.material.color.set(lights==='collapsed'?0xe84844:lights==='critical'?0xff6b43:0xffbd61);this.hazardRing.scale.setScalar(1+.09*Math.sin(snap.time*3));}
   for(const t of snap.fleet){const model=this.vehicles.get(t.id);if(!model)continue;const p=t.gpsPosition||t.position;model.group.position.set(p.x,2+(p.elevation||0)*(this.map.heightScale??.08),p.z);
     const old=model.lastPosition||p;const dx=p.x-old.x,dz=p.z-old.z;if(Math.hypot(dx,dz)>.03)model.group.rotation.y=-Math.atan2(dz,dx);
     model.lastPosition={...p};const led=model.group.userData.led;if(led)led.material.color.set(t.warnings.length?0xf68761:0x49e1a8);
   }
   const gps=snap.fleet.find(t=>t.id==='HT-02');this.gpsOrb.visible=!!(gps&&!gps.gpsOk&&gps.gpsPosition);if(this.gpsOrb.visible){this.gpsOrb.position.set(gps.gpsPosition.x,2.6+(gps.gpsPosition.elevation||0)*(this.map.heightScale??.08),gps.gpsPosition.z);this.gpsOrb.scale.setScalar(Math.max(5,gps.uncertainty));}
   for(const [id,a] of this.assets){if(a.role==='excavator'&&a.group.userData.arm)a.group.userData.arm.rotation.z=.08*Math.sin(snap.time*.4+(id==='face-north'?0:2));}
   if(this.rockfall){this.rockfall.visible=snap.geology.failed;if(this.rockfall.visible){
     for(const stone of this.rockfall.children){const d=stone.userData,t=Math.max(0,Math.min(1,(snap.geology.age-d.dropDelay)/3.5));
       const smooth=t*t*(3-2*t);
       stone.position.set(this.hazardPosition.x+d.offsetX-25*(1-smooth),this.hazardPosition.y+d.size*.55+38*(1-smooth)+Math.sin(t*Math.PI)*8,this.hazardPosition.z+d.offsetZ-15*(1-smooth));
       stone.rotation.z=t*1.7;
     }
   }}
   this.rainParticles.visible=flags.rain;this.dustParticles.visible=snap.metrics.dust>27|| (snap.geology.failed&&snap.geology.age<12);
   if(this.rainParticles.visible){const pos=this.rainParticles.geometry.attributes.position;for(let i=0;i<pos.count;i++)pos.setY(i,3+((i*17+130-(snap.time*24%125))%125));pos.needsUpdate=true;}
   if(this.dustParticles.visible){this.dustParticles.material.opacity=.12+(snap.metrics.dust/100)*.47+(snap.geology.failed&&snap.geology.age<12?.2:0);const p=this.dustParticles.geometry.attributes.position;for(let i=0;i<p.count;i++)p.setY(i,5+(i*9%25)+Math.sin(snap.time*.2+i)*4);p.needsUpdate=true;}
   const haze=flags.fog?.0019:flags.rain?.0011:.0005;this.scene.fog.density=haze + (snap.metrics.dust/100)*.0003;
 }
 setNight(){this.night=!this.night;this.scene.background.set(this.night?0x06101f:0x101e27);this.sun.intensity=this.night?.35:3.15;return this.night;}
 overhead(){if(!this.map)return;const ns=this.map.nodes;const xs=ns.map(n=>n.x),zs=ns.map(n=>n.z);const cx=(Math.min(...xs)+Math.max(...xs))/2,cz=(Math.min(...zs)+Math.max(...zs))/2;const r=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...zs)-Math.min(...zs));this.camera.position.set(cx+5,r*1.3,cz+1);this.controls.target.set(cx,0,cz);this.controls.update();}
 focus(position){if(!position)return;this.controls.target.set(position.x,1,position.z);this.camera.position.set(position.x+85,120,position.z+105);this.controls.update();}
 resize(){const w=this.container.clientWidth||850,h=this.container.clientHeight||510;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
 render(){this.controls.update();this.renderer.render(this.scene,this.camera);}
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
