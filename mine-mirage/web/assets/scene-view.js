export function installSceneView(scene){
  const viewport=document.querySelector('.viewport');
  const controls=document.querySelector('.animation-camera-controls');
  if(!viewport||!controls||document.getElementById('expandSceneBtn'))return;
  const button=document.createElement('button');
  button.id='expandSceneBtn';button.type='button';
  const refresh=()=>{
    const open=viewport.classList.contains('scene-expanded');
    button.textContent=open?'↙ Свернуть':'⛶ Развернуть карьер';
    button.setAttribute('aria-pressed',String(open));
    button.title=open?'Вернуть панель управления · Esc':'Развернуть 3D-карьер на всё окно';
    scene?.resize();
  };
  button.onclick=()=>{viewport.classList.toggle('scene-expanded');refresh();};
  window.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&viewport.classList.contains('scene-expanded')){
      viewport.classList.remove('scene-expanded');refresh();
    }
  });
  controls.prepend(button);refresh();
}
