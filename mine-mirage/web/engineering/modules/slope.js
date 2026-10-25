// Учебная причинная модель устойчивости склона.
// Показатель FS — условный индекс безопасности, НЕ инженерный расчёт геомеханики.
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

export class SlopeModel {
  constructor() { this.reset(); }

  reset() {
    this.rain = false;
    this.drainage = false;
    this.reinforced = false;
    this.water = 0.14;           // относительное насыщение грунта 0..1
    this.cracks = 0.10;          // относительная повреждённость 0..1
    this.blastPulse = 0;         // кратковременная вибрация после взрыва
    this.trafficVibration = 0;
    this.safetyFactor = 1.0;
    this.failureExposure = 0;
    this.collapsed = false;
    this.collapseAge = 0;
    this.status = 'stable';
    this.roadClosureLatched = false;
    this._recalculate();
  }

  _recalculate() {
    const vibration = clamp(this.trafficVibration + this.blastPulse, 0, 1);
    // Чем больше вода, трещины и вибрация, тем ниже запас устойчивости.
    this.safetyFactor = clamp(
      1.52 - 0.59 * this.water - 0.26 * this.cracks - 0.14 * vibration +
      (this.reinforced ? 0.38 : 0), 0.25, 2.1
    );
    this.vibration = vibration;
    this.status = this.collapsed ? 'collapsed'
      : this.safetyFactor < 1.08 ? 'critical'
      : this.safetyFactor < 1.22 ? 'warning' : 'stable';
    // При критическом риске участок закрывается ПРЕВЕНТИВНО.
    // Гистерезис: не открывать/закрывать трассу каждую секунду из-за колебания вибрации.
    if (this.safetyFactor < 1.08) this.roadClosureLatched = true;
    if (!this.collapsed && this.safetyFactor >= 1.18) this.roadClosureLatched = false;
    this.roadClosed = this.collapsed || this.roadClosureLatched;
  }

  toggleRain() { this.rain = !this.rain; return this.rain; }
  toggleDrainage() { this.drainage = !this.drainage; return this.drainage; }
  blast() {
    if (this.collapsed) return false;
    this.blastPulse = clamp(this.blastPulse + 0.75, 0, 1);
    this.cracks = clamp(this.cracks + 0.115 * (0.5 + this.water), 0, 1);
    this._recalculate();
    return true;
  }
  reinforce() {
    if (this.collapsed) return false;
    this.reinforced = true;
    this.cracks = Math.max(0.025, this.cracks - 0.16);
    this._recalculate();
    return true;
  }
  clear() {
    if (!this.collapsed) return false;
    // Без укрепления и осушения повторно пускать технику опасно.
    if (this.water > 0.40 || !this.drainage) return false;
    this.collapsed = false;
    this.roadClosureLatched = false;
    this.reinforced = true;    // расчистка включает инженерное укрепление
    this.cracks = 0.13;
    this.failureExposure = 0;
    this.collapseAge = 0;
    this.blastPulse = 0;
    this._recalculate();
    return true;
  }
  step(dt, trafficVibration = 0) {
    const before = this.status;
    this.trafficVibration = clamp(trafficVibration, 0, 0.9);
    // Ливень повышает водонасыщение; дренаж ускоряет отвод воды.
    const wetting = this.rain ? 0.012 : 0;
    const runoff = this.drainage ? 0.023 : 0.0015;
    this.water = clamp(this.water + (wetting - runoff) * dt, 0.05, 1);
    this.blastPulse = Math.max(0, this.blastPulse - 0.075 * dt);
    // Долгое переувлажнение и колебания увеличивают повреждённость склона.
    const damageRate = Math.max(0, this.water - 0.38) * (0.003 + 0.002 * this.trafficVibration);
    this.cracks = clamp(this.cracks + damageRate * dt * (this.reinforced ? 0.2 : 1), 0, 1);
    this._recalculate();
    if (!this.collapsed) {
      if (this.safetyFactor < 1.0) this.failureExposure += dt;
      else this.failureExposure = Math.max(0, this.failureExposure - dt * 1.7);
      // Трещины и скопившаяся вода предшествуют обвалу; камни не возникают от кнопки.
      if (this.failureExposure >= 5) {
        this.collapsed = true;
        this.collapseAge = 0;
        this._recalculate();
      }
    } else {
      this.collapseAge += dt;
    }
    return { statusChanged: this.status !== before, from: before, to: this.status,
      newlyCollapsed: before !== 'collapsed' && this.collapsed };
  }
  snapshot() {
    return {
      rain: this.rain, drainage: this.drainage, reinforced: this.reinforced,
      water: this.water, cracks: this.cracks, vibration: this.vibration,
      safetyFactor: this.safetyFactor, failureExposure: this.failureExposure,
      collapsed: this.collapsed, collapseAge: this.collapseAge,
      status: this.status, roadClosed: this.roadClosed,
    };
  }
}
