// MINE//MIRAGE 0.2 — карьер, обвал, объезд и оценка позиции без GPS.
// Истинная координата хранится отдельно от телеметрии, доступной оценщику.

import { SlopeModel } from './slope.js';

export const ROAD = [
  [-88, 19], [-62, 9], [-43, -3], [-15, -10], [13, -9], [39, -20], [78, -31],
];
export const DETOUR = [
  [-88, 19], [-62, 9], [-43, -3], [-38, 18], [-10, 29],
  [22, 23], [43, 6], [39, -20], [78, -31],
];
export const ROUTES = { main: ROAD, detour: DETOUR };
export const CONFIG = {
  capacityT: 90,
  loadedSpeed: 5.8,       // игровые метры в секунду
  emptySpeed: 8.3,
  detourSpeedFactor: 0.68,
  loadDuration: 29,
  dumpDuration: 13,
  crusherRateTps: 2.4,
};

const EPS = 1e-8;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
export function roadLength(points = ROAD) {
  return points.slice(1).reduce((sum, p, i) =>
    sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);
}
export const ROUTE_LENGTHS = { main: roadLength(ROAD), detour: roadLength(DETOUR) };
const forkAMain = roadLength(ROAD.slice(0, 3));
const forkBMain = roadLength(ROAD.slice(0, 6));
const forkADetour = roadLength(DETOUR.slice(0, 3));
const forkBDetour = roadLength(DETOUR.slice(0, 8));
export const LANDSLIDE = {
  x: (ROAD[3][0] + ROAD[4][0]) / 2,
  z: (ROAD[3][1] + ROAD[4][1]) / 2,
  start: roadLength(ROAD.slice(0, 4)) + 7,
  end: roadLength(ROAD.slice(0, 4)) + 20,
};

export function positionAt(progress, points = ROAD) {
  const total = roadLength(points);
  let left = clamp(progress, 0, 1) * total;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i];
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (left <= dist || i === points.length - 1) {
      const t = dist > 0 ? left / dist : 0;
      return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t };
    }
    left -= dist;
  }
  return { x: points[0][0], z: points[0][1] };
}

// ОДНА общая дорожная карта для движения и расчёта GPS.
// Важно: оценщик вызывает её со СВОЕЙ предыдущей оценкой, а не с истинной позицией машины.
export function advanceAlongRoute(route, distance, direction, meters, landslideActive) {
  let remaining = Math.max(0, meters);
  let d = clamp(distance, 0, ROUTE_LENGTHS[route]);
  let currentRoute = route;
  let blocked = false;
  let diverted = false;
  let traveled = 0;

  for (let n = 0; n < 5 && remaining > EPS; n += 1) {
    const movingOut = direction > 0;
    const length = ROUTE_LENGTHS[currentRoute];
    const edge = movingOut ? length : 0;
    if (Math.abs(d - edge) < EPS) break;

    // Диспетчеру известно, что трасса закрыта. На развилках он выбирает объезд.
    if (landslideActive && currentRoute === 'main') {
      if (movingOut && d <= forkAMain + EPS) {
        const toFork = Math.max(0, forkAMain - d);
        if (remaining >= toFork - EPS) {
          d = forkADetour;
          currentRoute = 'detour';
          diverted = true;
          traveled += toFork;
          remaining -= toFork;
          continue;
        }
      }
      if (!movingOut && d >= forkBMain - EPS) {
        const toFork = Math.max(0, d - forkBMain);
        if (remaining >= toFork - EPS) {
          d = forkBDetour;
          currentRoute = 'detour';
          diverted = true;
          traveled += toFork;
          remaining -= toFork;
          continue;
        }
      }

      const inside = d >= LANDSLIDE.start - EPS && d <= LANDSLIDE.end + EPS;
      if (inside) { blocked = true; break; }
      const approaching = movingOut
        ? d > forkAMain && d < LANDSLIDE.start
        : d < forkBMain && d > LANDSLIDE.end;
      if (approaching) {
        const boundary = movingOut ? LANDSLIDE.start : LANDSLIDE.end;
        const allowed = Math.abs(boundary - d);
        if (remaining >= allowed - EPS) {
          d = boundary;
          traveled += allowed;
          blocked = true;
          remaining = 0;
          break;
        }
      }
    }
    const step = Math.min(remaining, Math.abs(edge - d));
    d = clamp(d + (movingOut ? step : -step), 0, length);
    traveled += step;
    remaining -= step;
  }
  return { route: currentRoute, distance: d, blocked, diverted, traveled };
}

function createTruck(id, state, progress, payload) {
  const speed = state === 'outbound' ? CONFIG.loadedSpeed
    : state === 'inbound' ? CONFIG.emptySpeed : 0;
  const distance = progress * ROUTE_LENGTHS.main;
  const direction = state === 'inbound' ? -1 : state === 'outbound' ? 1 : 0;
  return {
    id, state, route: 'main', distance, payload,
    speed, wheelSpeed: speed, blocked: false, blockedSeconds: 0, detourSeconds: 0,
    fuel: 94 - id * 9, trips: 0, timer: 0, verifiedPayload: payload,
    gps: {
      ok: true, lastTime: 0, lastRoute: 'main', lastDistance: distance,
      direction, estimateRoute: 'main', estimateDistance: distance,
      age: 0, uncertainty: 0, observedTravel: 0,
    },
  };
}

export class MineSimulator {
  constructor() { this.reset(); }

  reset() {
    this.time = 0;
    this.totalDelivered = 0;
    this.totalProcessed = 0;
    this.hopper = 15;
    this.loader = 'truck-03';
    this.unloader = null;
    this.gpsFault = false;
    this.weightFault = false;
    this.slope = new SlopeModel();
    this.landslideActive = false;
    this.events = [];
    this.trucks = [
      createTruck(1, 'outbound', 0.28, 90),
      createTruck(2, 'inbound', 0.94, 0), // рядом с развилкой — удобно показать объезд
      createTruck(3, 'loading', 0, 0),
      createTruck(4, 'inbound', 0.24, 0),
    ];
    this.trucks[2].timer = 12;
    this._event('Симуляция запущена. 4 самосвала в карьере.', 'success');
  }

  _event(message, level = 'info') {
    this.events.unshift({ time: Math.floor(this.time), message, level });
    this.events.length = Math.min(this.events.length, 12);
  }
  toggleGps() {
    this.gpsFault = !this.gpsFault;
    const gps = this.trucks[1].gps;
    gps.ok = !this.gpsFault;
    if (this.gpsFault) {
      gps.estimateRoute = gps.lastRoute;
      gps.estimateDistance = gps.lastDistance;
      gps.age = 0;
      gps.uncertainty = 2.5;
    }
    this._event(this.gpsFault
      ? 'Truck-02: GPS потерян — прогноз по одометру и доступной карте дорог.'
      : 'Truck-02: GPS восстановлен, координаты будут уточнены.',
    this.gpsFault ? 'danger' : 'success');
    return this.gpsFault;
  }
  toggleWeight() {
    this.weightFault = !this.weightFault;
    this._event(this.weightFault
      ? 'Truck-01: датчик веса сообщает 0 тонн.'
      : 'Truck-01: датчик веса восстановлен.', this.weightFault ? 'danger' : 'success');
    return this.weightFault;
  }
  toggleRain() {
    const enabled = this.slope.toggleRain();
    this._event(enabled ? 'Метеостанция: начался сильный ливень — порода насыщается водой.'
      : 'Метеостанция: осадки прекратились.', enabled ? 'danger' : 'success');
    return enabled;
  }
  toggleDrainage() {
    const enabled = this.slope.toggleDrainage();
    this._event(enabled ? 'Дренажные насосы включены: снижение водонасыщения.'
      : 'Дренажные насосы отключены.', enabled ? 'success' : 'info');
    return enabled;
  }
  blast() {
    if (!this.slope.blast()) {
      this._event('Взрывные работы запрещены после обвала.', 'danger');
      return false;
    }
    this._event('Взрывные работы: вибрация и новые микротрещины склона.', 'danger');
    return true;
  }
  reinforce() {
    const applied = this.slope.reinforce();
    this._event(applied ? 'Склон укреплён: повышен запас устойчивости.'
      : 'После обвала сначала включите дренаж, осушите участок и расчистите его.',
      applied ? 'success' : 'danger');
    return applied;
  }
  clearRoad() {
    const success = this.slope.clear();
    this.landslideActive = this.slope.collapsed;
    this._event(success ? 'Завал расчищен и склон укреплён. Дорога открыта.'
      : 'Расчистка не разрешена: включите дренаж и снизьте насыщение склона ниже 40%.',
      success ? 'success' : 'danger');
    return success;
  }
  _trafficVibration() {
    // Нагрузка от машин в окрестности склона. Только реальная кинематика симулятора.
    let vibration = 0;
    for (const truck of this.trucks) {
      if (truck.state !== 'outbound' && truck.state !== 'inbound') continue;
      const p = positionAt(truck.distance / ROUTE_LENGTHS[truck.route], ROUTES[truck.route]);
      const radius = Math.hypot(p.x - LANDSLIDE.x, p.z - LANDSLIDE.z);
      const proximity = Math.max(0, 1 - radius / 58);
      vibration += proximity * (0.11 + 0.11 * truck.payload / CONFIG.capacityT);
    }
    return Math.min(0.65, vibration);
  }

  _move(t, dt, direction, wasBlocked = false) {
    const baseSpeed = direction > 0 ? CONFIG.loadedSpeed : CONFIG.emptySpeed;
    const factor = t.route === 'detour' ? CONFIG.detourSpeedFactor : 1;
    const plan = advanceAlongRoute(t.route, t.distance, direction,
      baseSpeed * factor * dt, this.slope.roadClosed);
    if (plan.diverted) this._event(`Truck-${String(t.id).padStart(2, '0')}: выбран объезд, скорость снижена.`, 'info');
    if (plan.blocked && !wasBlocked) this._event(`Truck-${String(t.id).padStart(2, '0')}: остановлен у обвала.`, 'danger');
    t.route = plan.route;
    t.distance = plan.distance;
    t.blocked = plan.blocked;
    t.speed = plan.traveled / Math.max(dt, 1e-6);
    // Одометр — отдельная доступная телеметрия; измерение с небольшой систематической погрешностью.
    t.wheelSpeed = t.speed * (1 + 0.035 * Math.sin(this.time * 0.31 + t.id));
    if (t.blocked) t.blockedSeconds += dt;
    if (t.route === 'detour') t.detourSeconds += dt;
    t.fuel = Math.max(0, t.fuel - dt * (direction > 0 ? 0.0038 : 0.003) *
      (t.route === 'detour' ? 1.23 : 1));
  }

  _updateGps(t, dt) {
    const gps = t.gps;
    const direction = t.state === 'inbound' ? -1 : t.state === 'outbound' ? 1 : 0;
    const isDown = this.gpsFault && t.id === 2;
    if (!isDown) {
      // Поступил реальный GPS-отсчёт; разрешаем корректировать оценку.
      gps.ok = true;
      gps.lastTime = this.time;
      gps.lastRoute = t.route;
      gps.lastDistance = t.distance;
      gps.estimateRoute = t.route;
      gps.estimateDistance = t.distance;
      gps.direction = direction;
      gps.age = 0;
      gps.uncertainty = 0;
      gps.observedTravel = 0;
    } else {
      gps.ok = false;
      gps.age += dt;
      // Только ранее наблюдавшееся направление, одометр и публичный статус дороги.
      // ЗАПРЕЩЕНО брать t.distance или t.route здесь: GPS не знает истинную позицию.
      const prediction = advanceAlongRoute(gps.estimateRoute, gps.estimateDistance,
        gps.direction, t.wheelSpeed * dt, this.slope.roadClosed);
      gps.estimateRoute = prediction.route;
      gps.estimateDistance = prediction.distance;
      gps.observedTravel += Math.abs(t.wheelSpeed * dt);
      gps.uncertainty = Math.min(95, 2.5 + gps.observedTravel * 0.075 +
        gps.age * (this.slope.roadClosed ? 0.39 : 0.18));
    }
  }

  step(deltaSec) {
    const dt = clamp(deltaSec, 0, 3);
    this.time += dt;
    const slopeEvent = this.slope.step(dt, this._trafficVibration());
    if (slopeEvent.statusChanged) {
      const texts = {
        stable: 'Геодатчики: состояние склона стабильно, дорога открыта.',
        warning: 'Геодатчики: появились трещины и смещения — повышенный риск!',
        critical: 'КРИТИЧЕСКИЙ РИСК: дорога закрыта превентивно, техника направлена в объезд.',
        collapsed: 'ОБВАЛ: склон потерял устойчивость. На дорогу сошла порода!',
      };
      this._event(texts[slopeEvent.to], slopeEvent.to === 'stable' ? 'success' : 'danger');
    }
    this.landslideActive = this.slope.collapsed;
    const crushed = Math.min(this.hopper, CONFIG.crusherRateTps * dt);
    this.hopper -= crushed;
    this.totalProcessed += crushed;

    for (const t of this.trucks) {
      const wasBlocked = t.blocked;
      t.speed = 0;
      t.wheelSpeed = 0;
      t.blocked = false;
      switch (t.state) {
        case 'waiting_load':
          t.distance = 0;
          if (!this.loader) {
            this.loader = `truck-${String(t.id).padStart(2, '0')}`;
            t.state = 'loading'; t.timer = 0;
          }
          break;
        case 'loading':
          t.timer += dt;
          t.payload = Math.min(CONFIG.capacityT, CONFIG.capacityT * t.timer / CONFIG.loadDuration);
          if (t.timer >= CONFIG.loadDuration) {
            t.state = 'outbound'; t.route = 'main'; t.distance = 0;
            t.payload = CONFIG.capacityT; t.verifiedPayload = CONFIG.capacityT;
            t.timer = 0; this.loader = null;
            this._event(`Truck-${String(t.id).padStart(2, '0')}: погружено 90 т.`);
          }
          break;
        case 'outbound':
          this._move(t, dt, 1, wasBlocked);
          if (t.distance >= ROUTE_LENGTHS[t.route] - EPS) {
            t.distance = ROUTE_LENGTHS[t.route]; t.speed = 0; t.wheelSpeed = 0;
            t.state = 'waiting_dump';
          }
          break;
        case 'waiting_dump':
          if (!this.unloader) {
            this.unloader = t.id;
            t.state = 'dumping'; t.timer = 0;
          }
          break;
        case 'dumping':
          t.timer += dt;
          if (t.timer >= CONFIG.dumpDuration) {
            this.hopper += t.payload; this.totalDelivered += t.payload;
            t.payload = 0; t.verifiedPayload = 0; t.trips += 1;
            t.timer = 0; t.state = 'inbound'; this.unloader = null;
            // Сохраняем выбранную дорогу на обратный путь, если она всё ещё нужна.
            this._event(`Truck-${String(t.id).padStart(2, '0')}: доставка завершена.`, 'success');
          }
          break;
        case 'inbound':
          this._move(t, dt, -1, wasBlocked);
          if (t.distance <= EPS) {
            t.distance = 0; t.speed = 0; t.wheelSpeed = 0;
            t.state = 'waiting_load';
          }
          break;
        default:
          throw new Error(`Unknown truck state: ${t.state}`);
      }
      this._updateGps(t, dt);
    }
  }

  readTruck(t) {
    const gps = t.gps;
    const gpsDown = !gps.ok;
    const reportedPayload = this.weightFault && t.id === 1 ? 0 : t.payload;
    const suspiciousWeight = this.weightFault && t.id === 1 &&
      t.verifiedPayload > 20 && t.state === 'outbound' &&
      Math.abs(reportedPayload - t.verifiedPayload) > 20;
    const warnings = [
      ...(gpsDown ? ['GPS OFFLINE'] : []),
      ...(t.blocked ? ['ROAD BLOCKED'] : []),
      ...(this.slope.status === 'warning' && !t.blocked ? ['SLOPE WATCH'] : []),
      ...(suspiciousWeight ? ['WEIGHT MISMATCH'] : []),
    ];
    return {
      id: `truck-${String(t.id).padStart(2, '0')}`,
      state: t.state, speed: t.speed, wheelSpeed: t.wheelSpeed,
      payload: reportedPayload, fuel: t.fuel, trips: t.trips,
      blocked: t.blocked, blockedSeconds: t.blockedSeconds,
      // GPS-позиция является оценкой, если сигнала нет; маршрут тоже прогнозируемый.
      gpsDown, gpsAge: gps.age, gpsEstimatedRoute: gps.estimateRoute,
      gpsEstimatedProgress: gps.estimateDistance / ROUTE_LENGTHS[gps.estimateRoute],
      uncertaintyMeters: gps.uncertainty,
      // Текущий маршрут известен диспетчеру (но не используется оценщиком GPS).
      routePlan: t.route,
      suspiciousWeight, warnings,
    };
  }
  snapshot() {
    const readings = this.trucks.map(t => this.readTruck(t));
    return {
      time: this.time, totalDelivered: this.totalDelivered,
      totalProcessed: this.totalProcessed, hopper: this.hopper,
      trucks: readings, events: this.events,
      gpsFault: this.gpsFault, weightFault: this.weightFault,
      landslideActive: this.slope.collapsed,
      roadClosed: this.slope.roadClosed,
      slope: this.slope.snapshot(),
      totalBlockedSeconds: this.trucks.reduce((a, t) => a + t.blockedSeconds, 0),
      detourCount: this.trucks.filter(t => t.route === 'detour').length,
      warningsCount: readings.reduce((a, t) => a + t.warnings.length, 0),
    };
  }
}
