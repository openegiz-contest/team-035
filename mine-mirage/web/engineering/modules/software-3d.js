import * as THREE from 'three';

/**
 * Low-GPU 3D projection of real Three.js meshes onto Canvas 2D.
 * This deliberately NEVER allocates a WebGL context. It exists for computers
 * whose Chromium render process crashes during WebGL initialization.
 * Geometry, camera rotation, vehicles and hazards are still 3D; materials are
 * flat shaded and textures/shadows are intentionally simplified.
 */
export class Software3DRenderer {
  constructor() {
    this.domElement = document.createElement('canvas');
    this.domElement.setAttribute('aria-label', 'Трёхмерная модель карьера без WebGL');
    this.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
    this.ctx = this.domElement.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('Canvas 2D is unavailable');
    this.width = 900;
    this.height = 520;
    this.pixelRatio = 1;
  }

  setSize(width, height) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    // Keep enough detail for vehicle visibility, with a hard CPU cost ceiling.
    const k = Math.min(1, 1240 / w, 780 / h);
    this.width = Math.max(1, Math.floor(w * k));
    this.height = Math.max(1, Math.floor(h * k));
    this.domElement.width = this.width;
    this.domElement.height = this.height;
  }

  render(scene, camera) {
    const ctx = this.ctx;
    const W = this.width;
    const H = this.height;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    ctx.fillStyle = '#111d25';
    ctx.fillRect(0, 0, W, H);
    const polygons = [];
    const overlays = [];
    const tmp = new THREE.Vector3();
    const near = camera.near;
    const far = camera.far;
    const project = (x, y, z, m) => {
      tmp.set(x, y, z).applyMatrix4(m).applyMatrix4(camera.matrixWorldInverse);
      const depth = -tmp.z;
      if (!Number.isFinite(depth) || depth < near || depth > far) return null;
      tmp.applyMatrix4(camera.projectionMatrix);
      return { x: (tmp.x + 1) * W / 2, y: (1 - tmp.y) * H / 2, depth };
    };
    scene.traverseVisible(obj => {
      if (obj.isMesh) {
        const positions = obj.geometry?.getAttribute('position');
        if (!positions) return;
        const material = Array.isArray(obj.material) ? obj.material[0] : obj.material;
        if (!material || material.visible === false || (material.transparent && material.opacity <= .01)) return;
        const baseColor = material.color ? `#${material.color.getHexString()}` : '#94a0a1';
        const opacity = material.transparent ? (material.opacity ?? 1) : 1;
        const pts = new Array(positions.count);
        for (let i = 0; i < positions.count; i++) {
          pts[i] = project(positions.getX(i), positions.getY(i), positions.getZ(i), obj.matrixWorld);
        }
        const index = obj.geometry.getIndex();
        const count = index ? index.count : positions.count;
        // Discard triangles that are behind the camera or wholly outside the viewport.
        for (let i = 0; i + 2 < count; i += 3) {
          const a = pts[index ? index.getX(i) : i];
          const b = pts[index ? index.getX(i + 1) : i + 1];
          const c = pts[index ? index.getX(i + 2) : i + 2];
          if (!a || !b || !c) continue;
          const minX = Math.min(a.x, b.x, c.x), maxX = Math.max(a.x, b.x, c.x);
          const minY = Math.min(a.y, b.y, c.y), maxY = Math.max(a.y, b.y, c.y);
          if (maxX < 0 || maxY < 0 || minX > W || minY > H) continue;
          const area = (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
          if (Math.abs(area) < .12) continue;
          // Lightweight distance shading emphasizes terraces and dump truck facets.
          const brightness = area > 0 ? .88 : 1.08;
          polygons.push({a,b,c,depth:(a.depth+b.depth+c.depth)/3,baseColor,opacity,brightness});
        }
      } else if (obj.isLine) {
        const positions = obj.geometry?.getAttribute('position');
        if (!positions) return;
        const coords=[];
        for (let i=0;i<positions.count;i++) coords.push(project(positions.getX(i),positions.getY(i),positions.getZ(i),obj.matrixWorld));
        overlays.push({kind:'line',coords,color:obj.material?.color?.getStyle()||'#ffae78'});
      } else if (obj.isPoints) {
        const positions=obj.geometry?.getAttribute('position');
        if(!positions)return;
        const coords=[];
        for(let i=0;i<positions.count;i++)coords.push(project(positions.getX(i),positions.getY(i),positions.getZ(i),obj.matrixWorld));
        overlays.push({kind:'points',coords,color:obj.material?.color?.getStyle()||'#8ad0ee'});
      } else if (obj.isSprite && obj.userData?.labelText) {
        const p=project(0,0,0,obj.matrixWorld);
        if(p)overlays.push({kind:'label',p,text:obj.userData.labelText});
      }
    });
    polygons.sort((a,b)=>b.depth-a.depth);
    const tinted = new Map();
    for (const f of polygons) {
      const key=f.baseColor+'|'+f.brightness;
      let fill=tinted.get(key);
      if(!fill){const color=new THREE.Color(f.baseColor);color.multiplyScalar(f.brightness);fill=`#${color.getHexString()}`;tinted.set(key,fill);}
      ctx.globalAlpha=f.opacity;
      ctx.fillStyle=fill;
      ctx.beginPath(); ctx.moveTo(f.a.x,f.a.y);ctx.lineTo(f.b.x,f.b.y);ctx.lineTo(f.c.x,f.c.y);ctx.closePath();ctx.fill();
    }
    ctx.globalAlpha=1;
    for(const e of overlays){
      if(e.kind==='label'){
        if(e.p.x<-120||e.p.x>W+120||e.p.y<0||e.p.y>H)continue;
        ctx.font='bold 10px system-ui,Arial'; const width=ctx.measureText(e.text).width+18;
        ctx.fillStyle='rgba(12,28,35,.92)';ctx.fillRect(e.p.x-width/2,e.p.y-14,width,22);
        ctx.fillStyle='#95f1db';ctx.textAlign='center';ctx.fillText(e.text,e.p.x,e.p.y+1);
      } else if(e.kind==='points'){
        ctx.fillStyle=e.color;for(const v of e.coords){if(!v)continue;ctx.fillRect(v.x,v.y,1.6,6);}
      } else if(e.kind==='line'){
        ctx.strokeStyle=e.color;ctx.lineWidth=2;ctx.beginPath();let start=true;
        for(const v of e.coords){if(!v){start=true;continue;}if(start){ctx.moveTo(v.x,v.y);start=false;}else ctx.lineTo(v.x,v.y);}ctx.stroke();
      }
    }
    ctx.textAlign='left';
  }
}
