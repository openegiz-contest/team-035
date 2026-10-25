/** Transparent engineering estimates for a fictional 90–105 t haul truck.
 * NOT a manufacturer performance chart, no measured engine output is implied.
 * Coefficients are configuration assumptions and require field calibration.
 * All compared values use the same payload, road and ambient condition.
 */
export const VEHICLE_SPEC = Object.freeze({
  name:'DEMO-100 (Cat 777 reference, not Cat 777 twin)', ratedPowerKw:683, ratedPayloadT:91.7,
  nominalLoadedLPerKm:3.15, nominalEmptyLPerKm:1.85,
  baseAvailability:1, maxSpeedMps:13,
  calibration:'synthetic-not-oem',
});
const clamp=(n,low,high)=>Math.min(high,Math.max(low,Number.isFinite(n)?n:low));
export function performanceEstimate(t,{loaded=true,grade=0,roughness=1,wet=0}={}){
  const c=t.components||{};
  const engine=clamp((c.engine??100)/100,.20,1);
  const transmission=clamp((c.drivetrain??100)/100,.35,1);
  const cooling=clamp((c.cooling??100)/100,.30,1);
  const electrical=clamp((c.electrical??100)/100,.50,1);
  const hydraulics=clamp((c.hydraulics??100)/100,.45,1);
  const tyre=clamp((c.tyres??100)/100,.3,1);
  const suspension=clamp((c.suspension??100)/100,.40,1);
  const brakes=clamp((c.brakes??100)/100,.3,1);
  const temperatureLimit=t.engineTempC>=145?.30:t.engineTempC>=115?.60:1;
  const lubricationLimit=t.oilPressureKpa<100?.25:t.oilPressureKpa<210?.55:1;
  const tyrePressureLimit=t.tyrePressureKpa<470?.60:t.tyrePressureKpa<550?.85:1;
  const brakeTempLimit=t.brakeTempC>310?.20:t.brakeTempC>185?.60:1;
  const powerFactor=clamp(engine*(.88+.12*cooling)*(.96+.04*electrical)*temperatureLimit*lubricationLimit,.10,1);
  const tractionFactor=clamp(transmission*(.93+.07*tyre)*tyrePressureLimit,.18,1);
  const safetyFactor=clamp(Math.min(brakes,brakeTempLimit)*(.88+.12*suspension),.18,1);
  const workFactor=clamp(Math.min(powerFactor,tractionFactor,safetyFactor)*(loaded?(.93+.07*hydraulics):1),.10,1);
  const limited=Boolean(t.failedComponent);
  const speedFactor=limited?0:clamp(Math.sqrt(workFactor),.20,1);
  const loadFraction=loaded?clamp((t.payload??VEHICLE_SPEC.ratedPayloadT)/(t.capacity||VEHICLE_SPEC.ratedPayloadT),0,1.25):0;
  const resistance=1+Math.max(0,roughness-1)*.16+clamp(wet,0,1)*.1+
      (1-tyre)*.25+(1-engine)*.14+(1-cooling)*.07+(1-suspension)*.09+(1-tractionFactor)*.09+
      Math.max(0,grade)*2.2+Math.max(0,loadFraction-1)*.3;
  const standardFuel=(loaded?VEHICLE_SPEC.nominalLoadedLPerKm:VEHICLE_SPEC.nominalEmptyLPerKm);
  const estimatedFuelLPerKm=standardFuel*resistance;
  return {
    ratedPowerKw:VEHICLE_SPEC.ratedPowerKw,
    availablePowerKw:Math.round(VEHICLE_SPEC.ratedPowerKw*powerFactor),
    powerFactor,speedFactor,workFactor,
    productiveCapacityPct:Math.round(workFactor*1000)/10,
    estimatedFuelLPerKm:Math.round(estimatedFuelLPerKm*100)/100,
    fuelFactor:resistance,
    basis:VEHICLE_SPEC.calibration,
  };
}
/** Result describes rated-condition capability, not measured historical tonnage. */
export function compareServicePerformance(before,after){
  const same={loaded:true,grade:0,roughness:1,wet:0};
  const a=performanceEstimate(before,same),b=performanceEstimate(after,same);
  const delta=(x,y)=>Math.round((y-x)*10)/10;
  return {
    before:a,after:b,
    powerKwGain:Math.round(b.availablePowerKw-a.availablePowerKw),
    powerPercentGain: a.availablePowerKw?delta(100,100*b.availablePowerKw/a.availablePowerKw):0,
    capacityPointGain:delta(a.productiveCapacityPct,b.productiveCapacityPct),
    possibleSpeedPercentGain:a.speedFactor?delta(100,100*b.speedFactor/a.speedFactor):0,
    fuelLPerKmSaving:Math.round((a.estimatedFuelLPerKm-b.estimatedFuelLPerKm)*100)/100,
    disclaimer:'Модельный потенциал при одинаковом грузе и дороге, не измеренный прирост т/ч.',
  };
}
