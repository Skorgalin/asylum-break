import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';

const socket = io();
const touchDevice = matchMedia('(pointer:coarse)').matches || navigator.maxTouchPoints > 0;
if (touchDevice) document.documentElement.classList.add('touch-device');
const roles = {
  patient: { color:'#ef4444', items:['glassShard'] },
  medic: { color:'#34d399', items:['smallMedicalKit','mediumMedicalKit'] },
  orderly: { color:'#fbbf24', items:['riotShield','taser','stunBaton','arrestCuffs'] },
  director: { color:'#a78bfa', items:['stunBaton','ignotusShield','tablet'] }
};
const itemNames = { glassShard:'Glass Shard', smallMedicalKit:'Small Med Kit', mediumMedicalKit:'Medium Med Kit', riotShield:'Riot Shield', taser:'Taser', stunBaton:'Stun Baton', arrestCuffs:'Arrest Cuffs', ignotusShield:'Ignotus Shield', tablet:'Tablet' };
const spawns = { patient:{x:-18,z:7,floor:3}, medic:{x:-25,z:-5,floor:2}, orderly:{x:25,z:-5,floor:2}, director:{x:23,z:8,floor:1} };
const floorNames = ['Ground','U1','U2','U3'];
const floors = [
  {y:0,name:'GROUND FLOOR · EXIT',accent:'#38bdf8'},
  {y:8,name:'U1 · DIRECTOR OFFICE / LABS',accent:'#a78bfa'},
  {y:16,name:'U2 · MEDICAL BAY / GUARD ZONE',accent:'#34d399'},
  {y:24,name:'U3 · PATIENT AREA / CAFETERIA',accent:'#fb7185'}
];
const W=88,D=60,HW=W/2,HD=D/2, PLAYER_RADIUS=.52, PLAYER_HEIGHT=2.8;
const scene=new THREE.Scene(); scene.background=new THREE.Color(0x101827); scene.fog=new THREE.Fog(0x101827,85,180);
const camera=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,.1,250);
const renderer=new THREE.WebGLRenderer({antialias:!touchDevice,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,touchDevice?1.5:2)); renderer.setSize(innerWidth,innerHeight); renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap; document.body.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xe4f0ff,0x45505d,1.65));
const sun=new THREE.DirectionalLight(0xfff1d8,2.1); sun.position.set(-25,55,20); sun.castShadow=true; sun.shadow.mapSize.set(touchDevice?1024:2048,touchDevice?1024:2048); sun.shadow.camera.left=-60; sun.shadow.camera.right=60; sun.shadow.camera.top=60; sun.shadow.camera.bottom=-60; sun.shadow.bias=-.0003; scene.add(sun);
const player={id:null,name:'Player',role:null,x:0,y:0,z:0,floor:0,color:'#fff',inventory:[],equippedItem:null,health:100,stunned:false,mesh:null};
const otherPlayers=new Map(), meshes=new Map(), floorGroups=new Map(), colliders=new Map(), keys={}, touch={x:0,z:0,sprint:false};
let lastUpdate=0,lastFrame=performance.now(),yaw=0,pitch=.3,distance=13,dragging=false,lastPointer=null;
const ui={role:document.getElementById('roleLabel'),floor:document.getElementById('floorLabel'),status:document.getElementById('statusLabel'),join:document.getElementById('joinScreen'),name:document.getElementById('playerName'),slots:document.getElementById('equipmentSlots'),ability:document.getElementById('abilityButton'),sprint:document.getElementById('sprintButton'),fullscreen:document.getElementById('fullscreenButton')};
const raycaster=new THREE.Raycaster();

function texture(draw,rx=1,ry=1){const c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d');draw(ctx,512);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(rx,ry);t.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8);return t;}
const floorTex=texture((c,s)=>{c.fillStyle='#cbd5df';c.fillRect(0,0,s,s);for(let y=0;y<s;y+=64)for(let x=0;x<s;x+=64){const n=190+Math.random()*18|0;c.fillStyle=`rgb(${n},${n+3},${n+8})`;c.fillRect(x+2,y+2,60,60);c.strokeStyle='#64748b55';c.strokeRect(x+1,y+1,62,62);c.fillStyle='#ffffff33';c.fillRect(x+5,y+5,52,3);}for(let i=0;i<2000;i++){c.fillStyle=`rgba(51,65,85,${Math.random()*.06})`;c.fillRect(Math.random()*s,Math.random()*s,2,2);}},9,7);
const wallTex=texture((c,s)=>{const g=c.createLinearGradient(0,0,s,s);g.addColorStop(0,'#e8e5dc');g.addColorStop(1,'#b7c1c8');c.fillStyle=g;c.fillRect(0,0,s,s);for(let i=0;i<2400;i++){c.fillStyle=`rgba(51,65,85,${Math.random()*.06})`;c.fillRect(Math.random()*s,Math.random()*s,5,2);}for(let y=0;y<s;y+=128){c.fillStyle='#47556922';c.fillRect(0,y,s,3);}},2,1);
const ceilingTex=texture((c,s)=>{c.fillStyle='#d7dce0';c.fillRect(0,0,s,s);for(let y=0;y<s;y+=128)for(let x=0;x<s;x+=128){c.fillStyle='#e8ecef';c.fillRect(x+3,y+3,122,122);c.strokeStyle='#aeb8c2';c.lineWidth=3;c.strokeRect(x+1,y+1,126,126);}},6,4);
const floorMat=new THREE.MeshStandardMaterial({map:floorTex,roughness:.85}),wallMat=new THREE.MeshStandardMaterial({map:wallTex,roughness:.92}),ceilingMat=new THREE.MeshStandardMaterial({map:ceilingTex,roughness:.92,side:THREE.DoubleSide});
function rememberCollider(mesh,level){const b=new THREE.Box3().setFromObject(mesh);colliders.get(level).push({minX:b.min.x,maxX:b.max.x,minY:b.min.y,maxY:b.max.y,minZ:b.min.z,maxZ:b.max.z});}
function box(group,level,x,y,z,w,h,d,mat,solid=false,shadows=true){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=shadows;m.receiveShadow=shadows;group.add(m);if(solid)rememberCollider(m,level);return m;}
function sign(text,color){const c=document.createElement('canvas');c.width=768;c.height=160;const x=c.getContext('2d');x.fillStyle='#111c2c';x.fillRect(0,0,768,160);x.fillStyle=color;x.fillRect(0,0,18,160);x.font='bold 34px Arial';x.fillStyle='white';x.textAlign='center';x.textBaseline='middle';x.fillText(text,400,82);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return new THREE.Mesh(new THREE.PlaneGeometry(12,2.5),new THREE.MeshBasicMaterial({map:t,side:THREE.DoubleSide}));}
function addPartition(g,l,y,x,z,w,d,gap=0){const h=5.3;if(!gap){box(g,l,x,y+h/2,z,w,h,d,wallMat,true);return;}if(w>d){const part=(w-gap)/2;box(g,l,x-gap/2-part/2,y+h/2,z,part,h,d,wallMat,true);box(g,l,x+gap/2+part/2,y+h/2,z,part,h,d,wallMat,true);}else{const part=(d-gap)/2;box(g,l,x,y+h/2,z-gap/2-part/2,w,h,part,wallMat,true);box(g,l,x,y+h/2,z+gap/2+part/2,w,h,part,wallMat,true);}}
function makeFloor(l){const data=floors[l],y=data.y,g=new THREE.Group();g.name=`floor-${l}`;floorGroups.set(l,g);colliders.set(l,[]);scene.add(g);
  box(g,l,0,y,0,W,.6,D,floorMat,false);
  // Render only the current level. Its opaque ceiling stays visible above the camera and prevents seeing through the next floor.
  const ceil=box(g,l,0,y+6.45,0,W,.5,D,ceilingMat,false,false);ceil.material.side=THREE.DoubleSide;
  const wh=6.1,cy=y+wh/2;
  box(g,l,0,cy,-HD,W,wh,.8,wallMat,true);box(g,l,0,cy,HD,W,wh,.8,wallMat,true);box(g,l,-HW,cy,0,.8,wh,D,wallMat,true);box(g,l,HW,cy,0,.8,wh,D,wallMat,true);
  const accent=new THREE.MeshStandardMaterial({color:data.accent,roughness:.6});
  box(g,l,0,y+.42,-HD+1,W-2,.22,.14,accent);box(g,l,0,y+.42,HD-1,W-2,.22,.14,accent);box(g,l,-HW+1,y+.42,0,.14,.22,D-2,accent);box(g,l,HW-1,y+.42,0,.14,.22,D-2,accent);
  for(const [lx,lz] of [[-25,-18],[-5,-18],[15,-18],[33,-18],[-25,12],[-5,12],[15,12],[33,12]]){const lm=new THREE.MeshStandardMaterial({color:0xfff7da,emissive:0xffe6a3,emissiveIntensity:1});box(g,l,lx,y+6.12,lz,5.2,.12,1.1,lm,false,false);}
  const s=sign(data.name,data.accent);s.position.set(0,y+4.9,-HD+.6);g.add(s);
  // Room partitions are collision solids, not just decoration.
  if(l===3){
    addPartition(g,l,y,0,-19,70,.7,7);
    // Bed bays on the north side
    const mattress=new THREE.MeshStandardMaterial({color:0x91a9bd,roughness:.95}),frame=new THREE.MeshStandardMaterial({color:0x465465,metalness:.25,roughness:.75}),wood=new THREE.MeshStandardMaterial({color:0x806248,roughness:.8});
    for(const x of [-34,-22,-10,2,14,26]){box(g,l,x,y+1.05,-25,5.8,.35,2.6,frame,true);box(g,l,x,y+1.28,-25,5.3,.22,2.2,mattress,true);box(g,l,x,y+1.75,-26.4,5.8,1.05,.25,accent,true);}
    // Joined canteen and patient common room: long tables, benches, serving counter, and lounge seating.
    const table=new THREE.MeshStandardMaterial({color:0x8b684b,roughness:.82});
    for(const x of [-25,-10,5,20]){box(g,l,x,y+1.05,1,9,.25,2.8,table,true);box(g,l,x,y+.62,-.9,9,.22,.65,frame,true);box(g,l,x,y+.62,2.9,9,.22,.65,frame,true);for(const dx of [-3.6,3.6])box(g,l,x+dx,y+.58,1,.24,.9,.24,frame,true);}
    // Lounge sofas and low tables
    for(const x of [-31,-18,28]){box(g,l,x,y+.6,12,7,.55,2.3,new THREE.MeshStandardMaterial({color:0x648b91}),true);box(g,l,x,y+1.3,11.1,7,.95,.45,new THREE.MeshStandardMaterial({color:0x77a4a8}),true);}
    box(g,l,34,y+1.1,4,1.4,1.8,15,frame,true);box(g,l,33.15,y+2.05,4,.16,.12,13,accent,false,false);
    const cs=sign('CAFETERIA · PATIENT COMMON AREA','#fb7185');cs.scale.set(.6,.6,1);cs.position.set(22,y+3.8,15);g.add(cs);
  } else if(l===2){
    addPartition(g,l,y,-20,-3,.65,36,6);addPartition(g,l,y,20,-3,.65,36,6);addPartition(g,l,y,-8,-20,25,.65,5);addPartition(g,l,y,8,-20,25,.65,5);
    const bed=new THREE.MeshStandardMaterial({color:0x9caebd});for(const x of [-31,-21,-11]){box(g,l,x,y+.7,-7,5.4,.2,2.2,accent,true);box(g,l,x,y+1,-7,4.6,.38,1.7,bed,true);}
    const s=sign('MEDICAL BAY  ←     →  ORDERLY / GUARD ZONE','#34d399');s.scale.set(.6,.6,1);s.position.set(0,y+3.8,-13);g.add(s);
  }else if(l===1){
    addPartition(g,l,y,0,-10,.65,37,6);addPartition(g,l,y,-23,-10,.65,37,5);addPartition(g,l,y,23,-10,.65,37,5);
    const metal=new THREE.MeshStandardMaterial({color:0x64748b,metalness:.3,roughness:.6}),wood=new THREE.MeshStandardMaterial({color:0x806248});for(const x of [-34,-27,-19]){box(g,l,x,y+1.1,-19,4.2,2.1,2.6,metal,true);box(g,l,x,y+.55,-12,2.4,.18,1.4,wood,true);}const s=sign('FACILITY DIRECTOR · LABORATORIES','#a78bfa');s.scale.set(.6,.6,1);s.position.set(0,y+3.8,-2);g.add(s);
  }else{
    addPartition(g,l,y,0,-18,55,.65,9);const wood=new THREE.MeshStandardMaterial({color:0x806248});box(g,l,0,y+1.1,22,18,2.1,2.5,wood,true);const s=sign('MAIN EXIT · RECEPTION','#38bdf8');s.scale.set(.55,.55,1);s.position.set(0,y+3.8,27);g.add(s);
  }
  // Two stair landings per floor. Their approach is kept clear for movement.
  for(const x of [-36,36]){const marker=new THREE.MeshStandardMaterial({color:0x38bdf8,emissive:0x075985,emissiveIntensity:.35,transparent:true,opacity:.75});box(g,l,x,y+.38,0,6.5,.1,6.5,marker,false,false);for(let i=0;i<6;i++)box(g,l,x,y+.6+i*.2,-2+i*.65,2.8,.22,.55,new THREE.MeshStandardMaterial({color:0x64748b}),true);}
}
function buildWorld(){floors.forEach((_,i)=>makeFloor(i));showFloor(player.floor);}
function showFloor(l){for(const [i,g] of floorGroups)g.visible=i===l;for(const [id,m]of meshes){const state=id===socket.id?player:otherPlayers.get(id);if(state)m.visible=state.floor===l;}}

function heldModel(item){if(!item)return null;const root=new THREE.Group();const mats={metal:new THREE.MeshStandardMaterial({color:0x475569,metalness:.55,roughness:.35}),blue:new THREE.MeshStandardMaterial({color:0x38bdf8,metalness:.25,roughness:.35}),red:new THREE.MeshStandardMaterial({color:0xef4444}),white:new THREE.MeshStandardMaterial({color:0xe2e8f0}),glass:new THREE.MeshStandardMaterial({color:0xbff5ff,transparent:true,opacity:.78,metalness:.1,roughness:.1})};
  const add=(w,h,d,x,y,z,mat)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;root.add(m);};
  if(item==='riotShield'||item==='ignotusShield'){add(.13,1.25,.78,0,0,0,mats[item==='ignotusShield'?'blue':'metal']);if(item==='ignotusShield')add(.15,.08,.82,0,.25,0,mats.blue);}
  else if(item==='tablet'){add(.62,.85,.1,0,0,0,mats.metal);add(.52,.68,.025,0,.03,-.065,mats.blue);}
  else if(item==='glassShard'){const m=new THREE.Mesh(new THREE.ConeGeometry(.16,.78,3),mats.glass);m.rotation.z=-Math.PI/2;m.position.set(0,.1,0);root.add(m);}
  else if(item.toLowerCase().includes('medical')){add(.5,.4,.32,0,0,0,mats.white);add(.52,.08,.34,0,.05,-.02,mats.red);}
  else if(item==='arrestCuffs'){const m=new THREE.Mesh(new THREE.TorusGeometry(.23,.055,8,18),mats.metal);m.position.y=.1;root.add(m);}
  else{add(.2,.72,.2,0,0,0,item==='taser'?mats.blue:mats.metal);add(.27,.2,.24,0,-.2,0,mats.metal);}
  root.position.set(.66,1.25,-.28);root.rotation.set(.1,.1,-.15);return root;
}
function playerModel(p){const g=new THREE.Group();const shirt=new THREE.MeshStandardMaterial({color:p.color||roles[p.role]?.color||'#fff',roughness:.76}),pants=new THREE.MeshStandardMaterial({color:p.role==='patient'?0x3f5065:0x202c3c,roughness:.86}),skin=new THREE.MeshStandardMaterial({color:0xe9bd9a,roughness:.9}),shoe=new THREE.MeshStandardMaterial({color:0x17202b});const part=(w,h,d,x,y,z,mat)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;g.add(m);};
  part(.47,.82,.48,-.25,.49,0,pants);part(.47,.82,.48,.25,.49,0,pants);part(.5,.16,.58,-.25,.08,-.04,shoe);part(.5,.16,.58,.25,.08,-.04,shoe);part(.98,.88,.55,0,1.38,0,shirt);part(.3,.84,.35,-.66,1.4,0,shirt);part(.3,.84,.35,.66,1.4,0,shirt);part(.62,.62,.62,0,2.18,0,skin);const face=new THREE.MeshBasicMaterial({color:0x17202b});part(.07,.09,.03,-.14,2.22,-.32,face);part(.07,.09,.03,.14,2.22,-.32,face);part(.14,.035,.03,0,2.04,-.32,face);const hand=new THREE.Group();g.add(hand);g.userData.hand=hand;g.userData.role=p.role;g.userData.equippedItem=null;g.position.set(p.x,floors[p.floor]?.y||0,p.z);equipVisual(g,p.equippedItem);return g;}
function equipVisual(mesh,item){const hand=mesh.userData.hand;if(!hand)return;while(hand.children.length){const child=hand.children.pop();child.traverse?.(o=>{if(o.geometry)o.geometry.dispose();});}mesh.userData.equippedItem=item||null;const prop=heldModel(item);if(prop)hand.add(prop);}
function addPlayer(p,isLocal=false){const old=meshes.get(p.id);if(old)scene.remove(old);const m=playerModel(p);m.visible=p.floor===player.floor;meshes.set(p.id,m);scene.add(m);if(isLocal)player.mesh=m;}
function equip(item){if(!player.inventory.includes(item))return;player.equippedItem=item;equipVisual(player.mesh,item);renderSlots();socket.emit('equipItem',{item});ui.status.textContent=`Ausgerüstet: ${itemNames[item]||item}`;}
function renderSlots(){ui.slots.replaceChildren();if(!player.inventory.length){ui.slots.textContent='Wähle zuerst eine Rolle.';return;}player.inventory.forEach((item,index)=>{const b=document.createElement('button');b.type='button';b.className=`equipment-slot${player.equippedItem===item?' selected':''}`;b.innerHTML=`<span class="slot-number">${index+1}</span>${itemNames[item]||item}`;b.addEventListener('click',()=>equip(item));ui.slots.appendChild(b);});}
function updateHUD(){ui.role.textContent=`Role: ${player.role||'None'}`;ui.floor.textContent=`Floor: ${floorNames[player.floor]||'Ground'}`;renderSlots();if(ui.ability&&player.role)ui.ability.textContent=({medic:'Heal',orderly:'Use item',director:'Tablet',patient:'Use item'})[player.role];}
function chooseRole(role){if(!roles[role])return;player.role=role;player.color=roles[role].color;player.inventory=[...roles[role].items];player.equippedItem=player.inventory[0]||null;Object.assign(player,spawns[role]);player.name=ui.name.value.trim()||'Player';updateHUD();addPlayer({...player,id:socket.id},true);showFloor(player.floor);socket.emit('joinGame',{name:player.name,role});ui.join.classList.add('hidden');}
function sync(force=false){const now=performance.now();if(!force&&now-lastUpdate<75)return;lastUpdate=now;socket.emit('updatePlayer',{x:player.x,y:floors[player.floor].y+1,z:player.z,floor:player.floor,stunned:player.stunned,health:player.health});}
function overlaps(x,z,collider){return x+PLAYER_RADIUS>collider.minX&&x-PLAYER_RADIUS<collider.maxX&&z+PLAYER_RADIUS>collider.minZ&&z-PLAYER_RADIUS<collider.maxZ&&floors[player.floor].y+PLAYER_HEIGHT>collider.minY&&floors[player.floor].y<collider.maxY;}
function collides(x,z){return (colliders.get(player.floor)||[]).some(c=>overlaps(x,z,c));}
function movement(dt){if(!player.role||player.stunned)return;let ix=touch.x,forward=-touch.z;if(keys.KeyW||keys.ArrowUp)forward++;if(keys.KeyS||keys.ArrowDown)forward--;if(keys.KeyA||keys.ArrowLeft)ix--;if(keys.KeyD||keys.ArrowRight)ix++;const len=Math.hypot(ix,forward);if(len<.05)return;ix/=Math.max(1,len);forward/=Math.max(1,len);const rightX=Math.cos(yaw),rightZ=-Math.sin(yaw),forwardX=-Math.sin(yaw),forwardZ=-Math.cos(yaw);const dx=rightX*ix+forwardX*forward,dz=rightZ*ix+forwardZ*forward,speed=keys.ShiftLeft||keys.ShiftRight||touch.sprint?8.5:5.6;const nx=THREE.MathUtils.clamp(player.x+dx*speed*dt,-HW+PLAYER_RADIUS,HW-PLAYER_RADIUS),nz=THREE.MathUtils.clamp(player.z+dz*speed*dt,-HD+PLAYER_RADIUS,HD-PLAYER_RADIUS);
  // Axis-separated AABB collision prevents tunnelling and lets the player slide along walls.
  if(!collides(nx,player.z))player.x=nx;if(!collides(player.x,nz))player.z=nz;if(player.mesh)player.mesh.rotation.y=Math.atan2(dx,dz)+Math.PI;sync();}
function useStairs(){if(!player.role)return;const close=Math.min(Math.hypot(player.x+36,player.z),Math.hypot(player.x-36,player.z))<5;if(!close){ui.status.textContent='Gehe zu einem der Treppenhäuser';return;}if(player.floor===3)player.floor=2;else if(player.floor===0)player.floor=1;else player.floor+=keys.AltLeft||keys.AltRight?1:-1;player.floor=THREE.MathUtils.clamp(player.floor,0,3);showFloor(player.floor);updateHUD();sync(true);}
function useAbility(){if(!player.role)return;if(player.role==='medic'){player.health=Math.min(100,player.health+20);ui.status.textContent='Medic: Heilung benutzt';}else ui.status.textContent=`${player.role}: ${itemNames[player.equippedItem]||'Fähigkeit'} benutzt`;socket.emit('useAbility',{ability:player.equippedItem||player.role});sync(true);}
function setupTouch(){const pad=document.getElementById('movePad'),stick=document.getElementById('moveStick');let id=null;const reset=()=>{id=null;touch.x=touch.z=0;stick.style.transform='translate(-50%,-50%)';};const update=e=>{if(id!==e.pointerId)return;const r=pad.getBoundingClientRect(),radius=r.width*.32,rx=e.clientX-r.left-r.width/2,ry=e.clientY-r.top-r.height/2,len=Math.hypot(rx,ry)||1,k=Math.min(1,radius/len),x=rx*k,y=ry*k;touch.x=x/radius;touch.z=y/radius;stick.style.transform=`translate(calc(-50% + ${x}px),calc(-50% + ${y}px))`;};pad.addEventListener('pointerdown',e=>{e.preventDefault();id=e.pointerId;pad.setPointerCapture(id);update(e);});pad.addEventListener('pointermove',update);pad.addEventListener('pointerup',e=>{if(id===e.pointerId)reset();});pad.addEventListener('pointercancel',reset);ui.sprint.addEventListener('pointerdown',e=>{e.preventDefault();touch.sprint=!touch.sprint;ui.sprint.classList.toggle('active',touch.sprint);});document.getElementById('interactButton').addEventListener('click',useStairs);ui.ability.addEventListener('click',useAbility);}
function setupCamera(){const c=renderer.domElement;c.addEventListener('pointerdown',e=>{if(e.button!==undefined&&e.button!==0)return;dragging=true;lastPointer={x:e.clientX,y:e.clientY,id:e.pointerId};try{c.setPointerCapture(e.pointerId);}catch{}});c.addEventListener('pointermove',e=>{if(!dragging||!lastPointer||lastPointer.id!==e.pointerId)return;yaw-=(e.clientX-lastPointer.x)*.006;pitch=THREE.MathUtils.clamp(pitch+(e.clientY-lastPointer.y)*.004,.08,.34);lastPointer={x:e.clientX,y:e.clientY,id:e.pointerId};});const stop=()=>{dragging=false;lastPointer=null;};c.addEventListener('pointerup',stop);c.addEventListener('pointercancel',stop);c.addEventListener('lostpointercapture',stop);c.addEventListener('wheel',e=>distance=THREE.MathUtils.clamp(distance+e.deltaY*.01,7,18),{passive:true});}
function updateCamera(){const base=floors[player.floor].y,focus=new THREE.Vector3(player.x,base+1.25,player.z),h=Math.cos(pitch)*distance;const desired=new THREE.Vector3(focus.x+Math.sin(yaw)*h,focus.y+Math.sin(pitch)*distance,focus.z+Math.cos(yaw)*h);const group=floorGroups.get(player.floor);raycaster.set(focus,desired.clone().sub(focus).normalize());raycaster.far=distance;const hits=raycaster.intersectObject(group,true).filter(hit=>hit.object.material!==undefined&&hit.object.position.y>base+5.9);if(hits.length)desired.copy(hits[0].point).addScaledVector(raycaster.ray.direction,-.45);desired.x=THREE.MathUtils.clamp(desired.x,-HW+1,HW-1);desired.z=THREE.MathUtils.clamp(desired.z,-HD+1,HD-1);desired.y=THREE.MathUtils.clamp(desired.y,base+2.5,base+5.65);camera.position.lerp(desired,.22);camera.lookAt(focus);}
function setupInput(){document.addEventListener('keydown',e=>{keys[e.code]=true;if(e.code==='KeyE')useStairs();if(e.code==='KeyQ')useAbility();if(/^Digit[1-9]$/.test(e.code)){const item=player.inventory[Number(e.code.slice(-1))-1];if(item)equip(item);}});document.addEventListener('keyup',e=>keys[e.code]=false);document.querySelectorAll('.roleButton').forEach(b=>b.addEventListener('click',()=>chooseRole(b.dataset.role)));if(touchDevice){ui.fullscreen.hidden=false;ui.fullscreen.addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen({navigationUI:'hide'});else ui.status.textContent='Safari: Teilen → Zum Home-Bildschirm';}catch{ui.status.textContent='Vollbild nicht verfügbar';}});}}
function frame(now){const dt=Math.min((now-lastFrame)/1000,.05);lastFrame=now;movement(dt);updateCamera();for(const[id,m]of meshes){const state=id===socket.id?player:otherPlayers.get(id);if(!state)continue;m.visible=state.floor===player.floor;if(id===socket.id){m.position.set(player.x,floors[player.floor].y,player.z);}else if(m.visible)m.position.lerp(new THREE.Vector3(state.x,floors[state.floor].y,state.z),.24);}renderer.render(scene,camera);requestAnimationFrame(frame);}
socket.on('assignedPlayer',p=>{player.id=p.id;player.name=p.name;player.role=p.role;player.color=roles[p.role]?.color||'#fff';player.inventory=[...(p.inventory||roles[p.role]?.items||[])];player.equippedItem=p.equippedItem||player.inventory[0]||null;player.floor=THREE.MathUtils.clamp(Number(p.floor)||0,0,3);player.x=Number(p.x)||0;player.z=Number(p.z)||0;addPlayer({...player,id:p.id},true);showFloor(player.floor);updateHUD();});
socket.on('playersState',list=>{const live=new Set(list.map(p=>p.id));for(const p of list){if(p.id===socket.id)continue;otherPlayers.set(p.id,p);const m=meshes.get(p.id);if(!m||m.userData.role!==p.role)addPlayer(p);else if(m.userData.equippedItem!==p.equippedItem)equipVisual(m,p.equippedItem);}for(const id of meshes.keys())if(id!==socket.id&&!live.has(id)){scene.remove(meshes.get(id));meshes.delete(id);otherPlayers.delete(id);}if(list.length===1&&player.role)ui.status.textContent='Du bist allein im Gebäude';});
socket.on('abilityFeedback',f=>{if(f?.message)ui.status.textContent=f.message;});
buildWorld();setupInput();setupTouch();setupCamera();updateHUD();requestAnimationFrame(frame);window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});document.addEventListener('fullscreenchange',()=>ui.fullscreen.textContent=document.fullscreenElement?'⛶ Vollbild verlassen':'⛶ Fullscreen');
