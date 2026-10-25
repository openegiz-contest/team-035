// Transparent scenario assumptions, not calibrated field measurements.
// These factors also drive the weather indicator shown over the quarry.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function weatherFactors(flags={},visibility=1,dust=0,nightShift=false){
  const reference=clamp(1-dust*.30-(nightShift?.31:0),.18,1);
  const transport=clamp((visibility*.67+.33)/(reference*.67+.33)*(flags.heat?.88:1),.30,1);
  return {
    transport,loading:(flags.fog?.90:1)*(flags.heat?.88:1),
    crushing:flags.heat?.90:1,
    ambientC:flags.heat?43:24,
    visibilityPct:Math.round(clamp(visibility,0,1)*100),
    transportPct:Math.round(transport*100),
    loadingPct:Math.round((flags.fog?.90:1)*(flags.heat?.88:1)*100),
    crushingPct:flags.heat?90:100
  };
}
