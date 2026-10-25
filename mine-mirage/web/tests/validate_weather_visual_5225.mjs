import assert from 'node:assert/strict';
const context={drawImage(){},createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}};
globalThis.document={createElement:()=>({relList:{supports:()=>true},getContext:()=>context})};
const {S:Scene,F:Fog,C:Color}=await import('../assets/three-vendor.js');
const {MineScene}=await import('../assets/mine-scene.js');
const world=Object.create(MineScene.prototype);
world.scene=new Scene();world.scene.background=new Color('#193142');world.scene.fog=new Fog('#193142',1200,4200);
world.scenarioState={wetness:0,fog:0,heat:0,slide:0};
world.scenarioTarget={wetness:0,fog:1,heat:0,slide:0};
world.visualTime=0;world.lowPower=false;world.lastHeatDistort=0;
world.rainClouds={visible:false};world.dust={visible:false};world.landslide={visible:false};
world.mapBounds={centerX:0,centerZ:0};world.visualRoads=new Map();
world.updateWater=()=>{};world.updateServiceUnits=()=>{};
world.weatherVeil={style:{}};world.renderer={domElement:{style:{}}};
world.heatTurbulence={setAttribute(){}};
for(let i=0;i<120;i++){world.visualTime+=.1;world.tickParticles(.1);}
assert(world.scenarioState.fog>.95);
assert(world.scene.fog.far<700);
assert(world.scene.fog.near<250);
world.scenarioTarget={wetness:0,fog:0,heat:1,slide:0};
for(let i=0;i<120;i++){world.visualTime+=.1;world.tickParticles(.1);}
assert(world.scenarioState.heat>.95);
assert(world.scenarioState.fog<.01);
assert(world.weatherVeil.style.display==='block');
assert(world.renderer.domElement.style.filter.includes('mine-heat-refraction'));
world.lowPower=true;world.tickParticles(.1);
assert.equal(world.renderer.domElement.style.filter,'none');
console.log('PASS 5225: fog smooth depth, warm heat, low-power fallback, no particle layers');
