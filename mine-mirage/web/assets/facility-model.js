import {G as Group} from './three-vendor.js';

export function fitModularBuilding(scene,model,options){
  // This GLB is a kit display: loose wall samples, props and a 40 x 50 ground
  // sheet surround one complete hangar. Fit the building itself to the site.
  const building=new Group();building.name='industrial-hangar';
  model.updateMatrixWorld(true);
  model.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.name.startsWith('MetalCabin_'))return;
    const part=mesh.clone(false);
    mesh.matrixWorld.decompose(part.position,part.quaternion,part.scale);
    building.add(part);
  });
  // Keep the previous fitting path for other versions of the asset pack.
  return scene.fitModel(building.children.length?building:model,options);
}
