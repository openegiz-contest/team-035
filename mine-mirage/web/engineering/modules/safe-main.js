import * as THREE from 'three';
import { Software3DRenderer } from './software-3d.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MineSimulator, ROAD, DETOUR, ROUTES, LANDSLIDE, positionAt } from './simulator.js';

const mine = new MineSimulator();
const sceneRoot = document.getElementById('scene');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#111d25');
scene.fog = new THREE.Fog('#111d25', 190, 420);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1000);
camera.position.set(12, 143, 170);
// Software 3D intentionally avoids WebGL. The original Three.js world,
// simulation, camera and control handlers remain unchanged.
const renderer = new Software3DRenderer();
sceneRoot.append(renderer.domElement);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 0, -5);
orbit.enableDamping = true;
orbit.maxPolarAngle = Math.PI / 2.18;
orbit.minDistance = 52;
orbit.maxDistance = 320;
orbit.update();

scene.add(new THREE.HemisphereLight(0xc7e5e4, 0x403225, 2.0));
const sun = new THREE.DirectionalLight(0xffdb9f, 3.0);
sun.position.set(-65, 150, 45);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -165;
sun.shadow.camera.right = 165;
sun.shadow.camera.top = 165;
sun.shadow.camera.bottom = -165;
sun.shadow.bias = -0.0005;
scene.add(sun);

const mat = (color, metalness = 0, roughness = 0.85) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness });
const dust = mat('#6a6253');
const ore = mat('#393a35');
const steel = mat('#36434b', 0.65, 0.55);
const yellow = mat('#f4b544', 0.16, 0.58);
const dark = mat('#161d22', 0.16, 0.8);
const green = mat('#36e1af', 0.3, 0.5);

function box(parent, size, pos, material, cast = true) {
  const obj = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  obj.position.set(...pos);
  obj.castShadow = cast;
  obj.receiveShadow = true;
  parent.add(obj);
  return obj;
}

const plain = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), dust);
plain.rotation.x = -Math.PI / 2;
plain.position.y = -5;
plain.receiveShadow = true;
scene.add(plain);

const floor = new THREE.Mesh(new THREE.CircleGeometry(143, 80), mat('#5a594e'));
floor.rotation.x = -Math.PI / 2;
floor.scale.y = 0.64;
floor.position.y = -0.9;
floor.receiveShadow = true;
scene.add(floor);

function createTerrace(rx1, rz1, rx2, rz2, innerHeight, outerHeight, color) {
  const positions = [], indices = [];
  const slices = 96;
  for (let i = 0; i <= slices; i++) {
    const theta = i / slices * Math.PI * 2;
    positions.push(Math.cos(theta) * rx1, innerHeight, Math.sin(theta) * rz1);
    positions.push(Math.cos(theta) * rx2, outerHeight, Math.sin(theta) * rz2);
    if (i < slices) {
      const k = i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const band = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }));
  band.receiveShadow = true;
  scene.add(band);
}
createTerrace(104, 65, 113, 71, 0, 4, '#837764');
createTerrace(113, 71, 126, 79, 4, 4.5, '#a29173');
createTerrace(126, 79, 137, 87, 4.5, 10, '#786d5c');
createTerrace(137, 87, 151, 97, 10, 10.7, '#a19073');
createTerrace(151, 97, 165, 107, 10.7, 18, '#716855');
createTerrace(165, 107, 196, 140, 18, 19, '#a39072');

function roadMesh(points, width, color, height) {
  const vertices = [], idx = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = next[0] - prev[0], dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len * width / 2, nz = dx / len * width / 2;
    vertices.push(points[i][0] + nx, height, points[i][1] + nz);
    vertices.push(points[i][0] - nx, height, points[i][1] - nz);
    if (i < points.length - 1) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(geom, mat(color));
  mesh.receiveShadow = true;
  mesh.material.side = THREE.DoubleSide;
  scene.add(mesh);
  return mesh;
}
roadMesh(ROAD, 16, '#2f3334', 0.11);
roadMesh(ROAD, 0.28, '#9e9a79', 0.16);
// Объезд всегда существует на карте; при обвале подсвечивается.
const detourRoad = roadMesh(DETOUR, 12, '#43534b', 0.19);
const detourLine = roadMesh(DETOUR, 0.28, '#769f84', 0.23);

// Простая геометрия вместо тяжёлой симуляции частиц/физики камней.
const rocks = new THREE.Group();
const rockKinematics = [];
const stoneColors = ['#786f61', '#8e816d', '#5a564e', '#a09278'];
for (let i = 0; i < 17; i += 1) {
  const size = 1.4 + (i * 7 % 9) / 4;
  const geometry = new THREE.DodecahedronGeometry(size, 0);
  const stone = new THREE.Mesh(geometry, mat(stoneColors[i % stoneColors.length]));
  const destX = LANDSLIDE.x + ((i * 13) % 17 - 8);
  const destZ = LANDSLIDE.z + ((i * 11) % 14 - 7);
  rockKinematics.push({ startX: destX - 26 - (i % 4) * 3,
    startY: 19 + (i % 4) * 2, startZ: destZ - 16,
    destX, destZ, size, delay: (i % 6) * 0.38 });
  stone.position.set(destX, -30, destZ);
  stone.rotation.set(i * 0.33, i * 0.7, i * 0.14);
  stone.castShadow = true;
  rocks.add(stone);
}
rocks.visible = false;
scene.add(rocks);
// Первые визуальные признаки: сырая порода, трещины, сигнал опасности.
const slopeMoisture = new THREE.Mesh(new THREE.PlaneGeometry(39, 24),
  new THREE.MeshBasicMaterial({ color: '#287983', transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide }));
slopeMoisture.rotation.x = -Math.PI / 2;
slopeMoisture.position.set(LANDSLIDE.x - 22, 0.35, LANDSLIDE.z - 11);
scene.add(slopeMoisture);
// Осадки — один объект Points вместо сотен отдельных meshes (дёшево для GPU).
const rainCount = 110;
const rainArray = new Float32Array(rainCount * 3);
for (let i = 0; i < rainCount; i += 1) {
  rainArray[i * 3] = LANDSLIDE.x - 46 + ((i * 37) % 91);
  rainArray[i * 3 + 1] = 2 + ((i * 19) % 36);
  rainArray[i * 3 + 2] = LANDSLIDE.z - 38 + ((i * 29) % 76);
}
const rainGeometry = new THREE.BufferGeometry();
rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainArray, 3));
const rainfall = new THREE.Points(rainGeometry,
  new THREE.PointsMaterial({ color: '#93d4f2', size: .9, transparent: true, opacity: .7, sizeAttenuation: true, depthWrite: false }));
rainfall.visible = false;
scene.add(rainfall);
const dustCloud = new THREE.Group();
const dustMat = new THREE.MeshBasicMaterial({ color: '#b9ab91', transparent: true, opacity: .22, depthWrite: false });
for (let i = 0; i < 8; i++) {
  const cl = new THREE.Mesh(new THREE.IcosahedronGeometry(3 + i % 4, 0), dustMat);
  cl.position.set(LANDSLIDE.x + (i % 4) * 5 - 10, 3, LANDSLIDE.z + Math.floor(i / 4) * 7 - 3);
  dustCloud.add(cl);
}
dustCloud.visible = false;
scene.add(dustCloud);
const crackGroup = new THREE.Group();
const crackMaterial = new THREE.LineBasicMaterial({ color: '#ff9972', linewidth: 2 });
for (let i = 0; i < 4; i += 1) {
  const z = LANDSLIDE.z - 20 + i * 7;
  const pts = [
    new THREE.Vector3(LANDSLIDE.x - 37, 1.05, z),
    new THREE.Vector3(LANDSLIDE.x - 30, 1.08, z + 2.5),
    new THREE.Vector3(LANDSLIDE.x - 24, 1.1, z - 1.5),
    new THREE.Vector3(LANDSLIDE.x - 17, 1.1, z + 3.1),
  ];
  crackGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), crackMaterial));
}
crackGroup.visible = false;
scene.add(crackGroup);
const dangerRing = new THREE.Mesh(new THREE.RingGeometry(10, 11, 64),
  new THREE.MeshBasicMaterial({ color: '#ff686b', transparent: true, opacity: .8, side: THREE.DoubleSide }));
dangerRing.rotation.x = -Math.PI / 2;
dangerRing.position.set(LANDSLIDE.x, .24, LANDSLIDE.z);
dangerRing.visible = false;
scene.add(dangerRing);

function label(text, x, z, accent = '#78d9c3') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 100;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(14,27,33,.91)';
  ctx.beginPath();
  ctx.roundRect(3, 4, 500, 90, 16);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillRect(16, 20, 5, 56);
  ctx.font = 'bold 29px Arial';
  ctx.fillStyle = '#ecf6f5';
  ctx.fillText(text, 36, 61);
  const texture = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
  sprite.userData.labelText = text;
  sprite.scale.set(42, 8.2, 1);
  sprite.position.set(x, 24, z);
  scene.add(sprite);
  return sprite;
}

const slideLabel = label('ROAD CLOSED / ОБВАЛ', LANDSLIDE.x, LANDSLIDE.z, '#ff8c8d');
slideLabel.visible = false;
label('DETOUR / ОБЪЕЗД', 2, 36, '#7beac3');

function createExcavator() {
  const g = new THREE.Group();
  g.position.set(-95, 1.15, 19);
  const trackMat = mat('#292e31', .25);
  box(g, [12, 2, 8.5], [0, 1, 0], trackMat);
  box(g, [12, 3, 6], [0, 2, 0], yellow);
  box(g, [5, 6, 5.5], [-2.0, 6, -0.6], yellow);
  box(g, [4.7, 2.2, 5.6], [-1.5, 7.2, -0.65], mat('#1d4a54', .6, .25));
  const boom = new THREE.Group();
  boom.position.set(3.3, 6.2, 0);
  const upper = box(boom, [13, 2.1, 1.8], [6, 4, 0], yellow);
  upper.rotation.z = 0.47;
  const fore = box(boom, [10, 1.4, 1.4], [16.1, 4.2, 0], yellow);
  fore.rotation.z = -0.45;
  const bucket = box(boom, [4.5, 4, 4.5], [21.6, 1.2, 0], mat('#7c7770'));
  bucket.rotation.z = -0.3;
  g.add(boom);
  scene.add(g);
  label('EXCAVATOR-01', -90, 23);
  return { boom };
}
const excavator = createExcavator();

function createCrusher() {
  const g = new THREE.Group();
  g.position.set(90, 0, -30);
  box(g, [23, 3, 23], [0, 1.3, 0], steel);
  box(g, [14, 11, 15], [0, 8, 0], mat('#64727a', .65));
  box(g, [11, 3, 11], [0, 14.5, 0], dark);
  box(g, [7, 2.6, 8], [0, 15.6, 0], ore);
  box(g, [16, 2, 7], [17, 7, -1], mat('#59666b'));
  box(g, [8, 2.5, 8], [-16, 3, 7], mat('#6b695f'));
  scene.add(g);
  label('PRIMARY CRUSHER', 94, -29, '#ffc86d');
}
createCrusher();

function makeTruck(n) {
  const g = new THREE.Group();
  g.name = `truck-${String(n).padStart(2, '0')}`;
  g.userData.truckId = n;
  const base = box(g, [8.5, 2.2, 4.3], [0, 2.4, 0], mat('#222a2c', .3));
  box(g, [2.6, 3.5, 4], [2.9, 4.4, 0], yellow);
  box(g, [0.22, 1.6, 3.5], [4.25, 5.4, 0], mat('#244a55', .5, .3));
  const bed = box(g, [5.7, 2.0, 5], [-1.5, 4.2, 0], mat(n === 2 ? '#ed9f35' : '#dbaa4e'));
  const load = box(g, [4.7, 1.0, 4.1], [-1.5, 5.5, 0], ore);
  const wheelMat = mat('#11191c');
  const geo = new THREE.CylinderGeometry(1.28, 1.28, 0.78, 16);
  for (const x of [-2.7, .2, 3.0]) {
    for (const z of [-2.65, 2.65]) {
      const w = new THREE.Mesh(geo, wheelMat);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 1.35, z);
      w.castShadow = true;
      g.add(w);
    }
  }
  const marker = new THREE.Mesh(new THREE.RingGeometry(6.5, 7.2, 32),
    new THREE.MeshBasicMaterial({ color: '#35e2a8', side: THREE.DoubleSide }));
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.1;
  g.add(marker);
  g.userData = { truckId: n, load, marker, bed, base };
  scene.add(g);
  return g;
}
const trucks = [1, 2, 3, 4].map(makeTruck);

const uncertainty = new THREE.Mesh(
  new THREE.RingGeometry(.95, 1.0, 72),
  new THREE.MeshBasicMaterial({ color: '#ff6e74', transparent: true, opacity: .75, side: THREE.DoubleSide, depthWrite: false })
);
uncertainty.rotation.x = -Math.PI / 2;
uncertainty.position.y = 0.23;
uncertainty.visible = false;
scene.add(uncertainty);

function shownPosition(reading) {
  const along = positionAt(reading.gpsEstimatedProgress, ROUTES[reading.gpsEstimatedRoute]);
  return { x: along.x, z: along.z };
}

function vehicleFacing(progress, inbound, route) {
  const a = positionAt(Math.max(0, progress - .003), ROUTES[route]);
  const b = positionAt(Math.min(1, progress + .003), ROUTES[route]);
  let theta = -Math.atan2(b.z - a.z, b.x - a.x);
  if (inbound) theta += Math.PI;
  return theta;
}

function updateScene(snap) {
  snap.trucks.forEach((reading, i) => {
    const group = trucks[i];
    const { x, z } = shownPosition(reading);
    const inbound = reading.state === 'inbound';
    const shoulder = reading.state === 'waiting_load' || reading.state === 'loading' ? -2.6
      : reading.state === 'waiting_dump' || reading.state === 'dumping' ? 1.0
      : inbound ? -3.2 : 3.2;
    group.position.set(x, 0.9, z + shoulder);
    group.rotation.y = vehicleFacing(reading.gpsEstimatedProgress, inbound, reading.gpsEstimatedRoute);
    group.userData.load.visible = reading.payload > 10 || (reading.suspiciousWeight && mine.trucks[i].verifiedPayload > 10);
    group.userData.marker.material.color.set(reading.blocked ? '#f6b94e' : reading.warnings.length ? '#ff7476' : '#35e2a8');
  });
  const gpsReading = snap.trucks[1];
  uncertainty.visible = gpsReading.gpsDown;
  if (uncertainty.visible) {
    const p = shownPosition(gpsReading);
    uncertainty.position.set(p.x, .22, p.z - 3.2);
    const rad = Math.min(55, Math.max(6, gpsReading.uncertaintyMeters));
    uncertainty.scale.setScalar(rad);
  }
  const slope = snap.slope;
  rocks.visible = slope.collapsed;
  if (slope.collapsed) {
    rocks.children.forEach((stone, i) => {
      const r = rockKinematics[i];
      const u = Math.min(1, Math.max(0, (slope.collapseAge - r.delay) / 2.6));
      const smooth = u * u * (3 - 2 * u);
      stone.position.set(r.startX + (r.destX - r.startX) * smooth,
        r.startY * (1 - smooth) + (0.5 + r.size * 0.55) * smooth + Math.sin(u * Math.PI) * 4,
        r.startZ + (r.destZ - r.startZ) * smooth);
      stone.rotation.x += Math.min(.05, .01 * (1 - u));
    });
  }
  crackGroup.visible = !slope.collapsed && (slope.status !== 'stable' || slope.cracks >= .25);
  crackGroup.scale.z = .65 + slope.cracks;
  slopeMoisture.material.opacity = Math.max(0, Math.min(.55, slope.water * .52));
  rainfall.visible = slope.rain;
  if (rainfall.visible) {
    const pos = rainGeometry.attributes.position;
    for (let i = 0; i < rainCount; i += 1) {
      const y0 = 2 + ((i * 19) % 36);
      pos.setY(i, 2 + ((y0 + 35 - (snap.time * 17 % 36)) % 36));
    }
    pos.needsUpdate = true;
  }
  dustCloud.visible = slope.collapsed && slope.collapseAge < 11;
  if (dustCloud.visible) {
    const phase = slope.collapseAge / 11;
    dustCloud.scale.setScalar(1 + phase * 1.8);
    dustMat.opacity = .22 * (1 - phase);
  }
  dangerRing.visible = slope.roadClosed || slope.status === 'warning';
  dangerRing.material.color.set(slope.collapsed ? '#ff4b58' : slope.status === 'critical' ? '#ff8845' : '#fbc56b');
  slideLabel.visible = slope.collapsed;
  detourRoad.material.color.set(slope.roadClosed ? '#255b50' : '#43534b');
  detourLine.material.color.set(slope.roadClosed ? '#4ce0ad' : '#769f84');
  excavator.boom.rotation.z = Math.sin(snap.time * 0.65) * 0.12;
}

const stateText = {
  waiting_load: 'Ожидание погрузки', loading: 'Погрузка', outbound: 'К дробилке',
  waiting_dump: 'Очередь на разгрузку', dumping: 'Разгрузка', inbound: 'Возвращается',
};
const fmt = v => Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
function renderUI(snap) {
  document.getElementById('delivered').innerHTML = `${fmt(snap.totalDelivered)} <small>т</small>`;
  document.getElementById('processed').innerHTML = `${fmt(snap.totalProcessed)} <small>т</small>`;
  document.getElementById('hopper').innerHTML = `${fmt(snap.hopper)} <small>т</small>`;
  document.getElementById('warnings').textContent = snap.warningsCount;
  document.getElementById('gpsButton').classList.toggle('active', snap.gpsFault);
  document.getElementById('weightButton').classList.toggle('active', snap.weightFault);
  const slope = snap.slope;
  const labels = {
    stable: ['● СКЛОН СТАБИЛЕН', 'Устойчивое состояние. Контролируйте осадки и вибрации.'],
    warning: ['⚠ ПРЕДУПРЕЖДЕНИЕ', 'Появились трещины. Проверьте склон, осушите и остановите взрывы.'],
    critical: ['⛔ КРИТИЧЕСКИЙ РИСК', 'Дорога закрыта заранее. Если индекс упадёт ниже 1.00 на 5 с, произойдёт обвал.'],
    collapsed: ['🔴 ОБВАЛ ПРОИЗОШЁЛ', 'Дорога под завалом. Для расчистки выключите дождь и включите дренаж.'],
  };
  document.getElementById('slopeState').textContent = labels[slope.status][0];
  document.getElementById('slopeExplanation').textContent = labels[slope.status][1];
  document.getElementById('slopePanel').dataset.risk = slope.status;
  document.getElementById('slopeSafety').textContent = `FS ${slope.safetyFactor.toFixed(2)}`;
  document.getElementById('slopeWater').textContent = `${Math.round(slope.water * 100)}%`;
  document.getElementById('slopeCracks').textContent = `${Math.round(slope.cracks * 100)}%`;
  document.getElementById('slopeVibration').textContent = `${Math.round(slope.vibration * 100)}%`;
  const pct = Math.max(0, Math.min(100, (slope.safetyFactor - 0.7) / .85 * 100));
  document.getElementById('slopeBarFill').style.width = `${pct}%`;
  document.getElementById('rainButton').classList.toggle('active', slope.rain);
  document.getElementById('drainButton').classList.toggle('active', slope.drainage);
  document.getElementById('reinforceButton').classList.toggle('active', slope.reinforced);
  document.getElementById('clearRoadButton').classList.toggle('active', slope.collapsed);
  document.getElementById('rainStatus').textContent = slope.rain ? 'ON' : 'OFF';
  document.getElementById('drainStatus').textContent = slope.drainage ? 'ON' : 'OFF';
  document.getElementById('reinforceStatus').textContent = slope.reinforced ? 'DONE' : 'OFF';
  document.getElementById('landslideStatus').textContent = slope.collapsed ? 'READY?' : 'WAIT';
  document.getElementById('roadStatus').textContent = slope.collapsed
    ? '⛔ ОБВАЛ · ДОРОГА ПОД ЗАВАЛОМ'
    : slope.roadClosed ? '⚠ ОПАСНОСТЬ ОБВАЛА · ДОРОГА ЗАКРЫТА ЗАРАНЕЕ'
      : slope.status === 'warning' ? '⚠ ТРЕЩИНЫ · НАБЛЮДЕНИЕ ЗА СКЛОНОМ'
        : '✓ ОСНОВНАЯ ДОРОГА ОТКРЫТА';
  document.getElementById('roadStatus').classList.toggle('hazard', slope.roadClosed || slope.status === 'warning');
  document.getElementById('blockedTime').textContent = `${fmt(snap.totalBlockedSeconds)} с`;
  document.getElementById('detourCount').textContent = snap.detourCount;
  document.getElementById('gpsStatus').textContent = snap.gpsFault ? 'ON' : 'OFF';
  document.getElementById('weightStatus').textContent = snap.weightFault ? 'ON' : 'OFF';
  document.getElementById('clock').textContent = new Date(snap.time * 1000).toISOString().substring(11, 19);
  document.getElementById('fleet').innerHTML = snap.trucks.map(t => `
    <div class="vehicle-card ${t.warnings.length ? 'has-alert' : ''}">
      <div class="vehicle-top"><b>${t.id.toUpperCase()}</b><span class="vehicle-state">${t.warnings.length ? '● WARNING' : '● ONLINE'}</span></div>
      <div class="vehicle-body"><span>🚛</span><div><strong>${t.blocked ? 'Ожидает расчистки' : stateText[t.state]}</strong><small>${t.gpsDown ? `GPS: оценка ±${fmt(t.uncertaintyMeters)} м · ${fmt(t.gpsAge)} с` : `Скорость: ${fmt(t.speed * 3.6)} км/ч`}</small></div></div><div class="route-line">${t.gpsEstimatedRoute === 'detour' ? '↪ ОБЪЕЗД' : '→ ОСНОВНАЯ ДОРОГА'}${t.gpsDown ? ' · ПРОГНОЗ' : ''}</div>
      <div class="vehicle-footer"><span>Груз <b>${fmt(t.payload)} т</b></span><span>Топливо <b>${fmt(t.fuel)}%</b></span></div>
      ${t.warnings.length ? `<div class="alert-label">⚠ ${t.warnings.join(' · ')}</div>` : ''}
    </div>`).join('');
  document.getElementById('events').innerHTML = snap.events.map(e => `
    <div class="event-item"><span class="event-dot ${e.level}"></span><div><span>${e.message}</span><small>${new Date(e.time * 1000).toISOString().substring(11, 19)} · ${e.level.toUpperCase()}</small></div></div>`).join('');
}

document.getElementById('gpsButton').addEventListener('click', () => { mine.toggleGps(); refresh(); });
document.getElementById('weightButton').addEventListener('click', () => { mine.toggleWeight(); refresh(); });
document.getElementById('rainButton').addEventListener('click', () => { mine.toggleRain(); refresh(); });
document.getElementById('blastButton').addEventListener('click', () => { mine.blast(); refresh(); });
document.getElementById('drainButton').addEventListener('click', () => { mine.toggleDrainage(); refresh(); });
document.getElementById('reinforceButton').addEventListener('click', () => { mine.reinforce(); refresh(); });
document.getElementById('clearRoadButton').addEventListener('click', () => { mine.clearRoad(); refresh(); });
let paused = false;
document.getElementById('pauseButton').addEventListener('click', e => {
  paused = !paused;
  e.currentTarget.textContent = paused ? '▶ Продолжить' : 'Ⅱ Пауза';
  document.querySelector('.status-row').classList.toggle('paused', paused);
});
document.getElementById('resetButton').addEventListener('click', () => { mine.reset(); refresh(); });
const speedInput = document.getElementById('speed');
speedInput.addEventListener('input', () => document.getElementById('speedValue').textContent = `×${speedInput.value}`);

function refresh() {
  const snapshot = mine.snapshot();
  updateScene(snapshot);
  renderUI(snapshot);
}

let latestUpdate = 0;
let lastRaster = -Infinity;
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), .12);
  if (!paused) mine.step(dt * Number(speedInput.value));
  orbit.update();
  updateScene(mine.snapshot());
  latestUpdate += dt;
  if (latestUpdate >= .25) {
    renderUI(mine.snapshot());
    latestUpdate = 0;
  }
  // Limit CPU rasterization to roughly 18 FPS; physics still advances each frame.
  if (performance.now() - lastRaster >= 55) {
    renderer.render(scene, camera);
    lastRaster = performance.now();
  }
}

function resize() {
  const width = sceneRoot.clientWidth || 900;
  const height = sceneRoot.clientHeight || 520;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(sceneRoot);
resize();
refresh();
animate();
