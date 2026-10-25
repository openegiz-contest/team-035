/** Educational drill-and-blast cycle. Synthetic MWD indices; NOT blast-design data. */
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
export const BLAST_PHASES={idle:'Участок доступен',drilling:'Бурение скважин',charging:'Контроль готовности',evacuation:'Эвакуация и контроль периметра',countdown:'Защитный отсчёт',ventilation:'Проветривание и осмотр'};

export function createBlastState(mine){
  const blocks=mine.oreBlocks[mine.faceIds[0]]||[];
  const mean=blocks.reduce((s,b)=>s+b.hardness,0)/Math.max(1,blocks.length);
  const holes=Array.from({length:20},(_,i)=>{
    const row=Math.floor(i/5),col=i%5;
    const variance=(((i*17+row*3+col*5)%13)-6)*.024;
    const rockIndex=clamp(Math.round(100*(.47+(mean-1)*.52+variance)),14,91);
    return {id:`MWD-${String(i+1).padStart(2,'0')}`,row,col,status:'planned',rockIndex,
      penetrationIndex:clamp(100-rockIndex+12,8,100),torqueIndex:clamp(rockIndex+7,0,100)};
  });
  return {phase:'idle',timer:0,reason:'',completed:0,holes,drilled:0,checked:0,
    hardnessIndex:null,fragmentation:0.48,coarsePct:52,cycle:0,detonatedAt:null,
    note:'Все MWD-параметры и показатели фрагментации синтетические; проектирования взрывов нет.'};
}

export function completeBlast(mine){
  const b=mine.blast;
  // Abstract fragmentation index; hardness produces coarser fragments.
  const fragment=clamp(.94-b.hardnessIndex*.0048,.43,.87);
  b.fragmentation=Number(fragment.toFixed(3));b.coarsePct=Math.round((1-fragment)*100);
  b.holes.forEach(h=>h.status='fired');b.detonatedAt=mine.time;
  // Effect is applied to remaining material of the actual northern working face.
  for(const block of mine.oreBlocks[mine.faceIds[0]]||[])block.fragmentation=fragment;
  return b;
}

export function loadingFragmentationFactor(block){
  return clamp(.67+.67*(block?.fragmentation??.48),.67,1.30);
}
