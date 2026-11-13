import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';

const socket = io();
const touchDevice = matchMedia('(pointer:coarse)').matches || navigator.maxTouchPoints > 0;
if (touchDevice) document.documentElement.classList.add('touch-device');

const roles = {
  patient:{color:'#ef4444',items:['glassShard'],maxHealth:100},
  medic:{color:'#34d399',items:['smallMedicalKit','mediumMedicalKit'],maxHealth:100},
  orderly:{color:'#fbbf24',items:['riotShield','taser','stunBaton','arrestCuffs'],maxHealth:115},
  director:{color:'#a78bfa',items:['stunBaton','ignotusShield','tablet'],maxHealth:100}
};

const itemNames = {
  glassShard:'Glass Shard',
  smallMedicalKit:'Small Med Kit',
  mediumMedicalKit:'Medium Med Kit',
  riotShield:'Riot Shield',
  taser:'Taser',
  stunBaton:'Stun Baton',
  arrestCuffs:'Arrest Cuffs',
  ignotusShield:'Ignotus Shield',
  tablet:'Tablet'
};

const spawns={patient:{x:-72,z:8,floor:3},medic:{x:-70,z:0,floor:2},orderly:{x:70,z:0,floor:2},director:{x:70,z:43,floor:1}};
const floorNames=['Ground','U1','U2','U3'];
const floors=[{y:0,name:'GROUND FLOOR · EXIT',accent:'#38bdf8'},{y:9,name:'U1 · DIRECTOR OFFICE / LABS',accent:'#a78bfa'},{y:18,name:'U2 · MEDICAL BAY / GUARD ZONE',accent:'#34d399'},{y:27,name:'U3 · PATIENT WARD / RECOVERY',accent:'#22c55e'}];
const W=180,D=132,HW=W/2,HD=D/2,R=.52,H=2.8;

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x101827);
scene.fog=new THREE.Fog(0x101827,145,310);

const camera=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,.1,420);
const renderer=new THREE.WebGLRenderer({antialias:!touchDevice,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,touchDevice?1.5:2));
renderer.setSize(innerWidth,innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xe4f0ff,0x45505d,1.55));
const sun=new THREE.DirectionalLight(0xfff1d8,2);
sun.position.set(-45,75,35);
sun.castShadow=true;
sun.shadow.mapSize.set(touchDevice?1024:2048);
scene.add(sun);

const player={
  id:null,
  name:'Player',
  role:null,
  x:0,y:0,z:0,
  floor:0,
  color:'#fff',
  inventory:[],
  equippedItem:null,
  health:100,
  maxHealth:100,
  stunned:false,
  mesh:null
};

const others=new Map();
const meshes=new Map();
const groups=new Map();
const colliders=new Map();
const keys={};
const touch={x:0,z:0,sprint:false};

let lastUpdate=0,lastFrame=performance.now(),yaw=0,pitch=.3,distance=17,dragging=false,lastPointer=null;

const ui={
  role:document.getElementById('roleLabel'),
  floor:document.getElementById('floorLabel'),
  status:document.getElementById('statusLabel'),
  join:document.getElementById('joinScreen'),
  name:document.getElementById('playerName'),
  healthText:document.getElementById('healthText'),
  healthFill:document.getElementById('healthFill'),
  slots:document.getElementById('equipmentSlots'),
  ability:document.getElementById('abilityButton')
};

function tex(draw,rx=1,ry=1){
  const c=document.createElement('canvas');
  c.width=c.height=512;
  const ctx=c.getContext('2d');
  draw(ctx,512);
  const t=new THREE.CanvasTexture(c);
  t.colorSpace=THREE.SRGBColorSpace;
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.repeat.set(rx,ry);
  return t;
}

const floorTex=tex((c,s)=>{
  c.fillStyle='#cbd5df';
  c.fillRect(0,0,s,s);
  for(let y=0;y<s;y+=64)for(let x=0;x<s;x+=64){const n=188+Math.random()*22|0;c.fillStyle=`rgb(${n},${n+3},${n+8})`;c.fillRect(x,y,48,48);}
  c.strokeStyle='rgba(255,255,255,0.08)';c.lineWidth=2;for(let i=0;i<20;i++){const x=Math.random()*s;const y=Math.random()*s;c.beginPath();c.moveTo(x,0);c.lineTo(x,s);c.stroke();}
});
const wallTex=tex((c,s)=>{
  const g=c.createLinearGradient(0,0,s,s);
  g.addColorStop(0,'#e8e5dc');
  g.addColorStop(1,'#b7c1c8');
  c.fillStyle=g;
  c.fillRect(0,0,s,s);
  for(let i=0;i<2600;i++){const x=Math.random()*s,y=Math.random()*s;const side=Math.random()>0.5?1:-1;c.fillStyle=`rgba(${230+Math.random()*20|0},${230+Math.random()*18|0},${220+Math.random()*20|0},${0.2+Math.random()*0.35})`;c.fillRect(x,y,Math.random()*26+8,Math.random()*26+8);}
});
const ceilTex=tex((c,s)=>{
  c.fillStyle='#d7dce0';
  c.fillRect(0,0,s,s);
  for(let y=0;y<s;y+=128)for(let x=0;x<s;x+=128){c.fillStyle='#e8ecef';c.fillRect(x+3,y+3,122,122);c.strokeStyle='#aeb8c2';c.lineWidth=3;c.strokeRect(x+6,y+6,116,116);}
});

const floorMat=new THREE.MeshStandardMaterial({map:floorTex,roughness:.84});
const wallMat=new THREE.MeshStandardMaterial({map:wallTex,roughness:.92});
const ceilMat=new THREE.MeshStandardMaterial({map:ceilTex,roughness:.88});

function addCollider(mesh,l){
  const b=new THREE.Box3().setFromObject(mesh);
  colliders.get(l).push({minX:b.min.x,maxX:b.max.x,minY:b.min.y,maxY:b.max.y,minZ:b.min.z,maxZ:b.max.z});
}

function box(g,l,x,y,z,w,h,d,mat,solid=false,shadow=true){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
  m.position.set(x,y,z);
  m.castShadow=shadow;
  m.receiveShadow=shadow;
  g.add(m);
  if(solid) addCollider(m,l);
  return m;
}

function sign(text,color){
  const c=document.createElement('canvas');
  c.width=768;c.height=160;
  const x=c.getContext('2d');
  x.fillStyle='#111c2c';
  x.fillRect(0,0,768,160);
  x.fillStyle=color;
  x.fillRect(0,0,768,38);
  x.fillStyle='#f8fafc';
  x.font='bold 42px Arial';
  x.textAlign='center';
  x.textBaseline='middle';
  x.fillText(text,384,84);
  const t=new THREE.CanvasTexture(c);
  t.colorSpace=THREE.SRGBColorSpace;
  const mat=new THREE.MeshBasicMaterial({map:t,transparent:true});
  const m=new THREE.Mesh(new THREE.PlaneGeometry(18,3),mat);
  m.renderOrder=10;
  return m;
}

function partition(g,l,y,x,z,w,d,gap=0){
  const h=6.3;
  if(!gap){
    box(g,l,x,y+h/2,z,w,h,d,wallMat,true);
    return;
  }
  if(w>d){
    const q=(w-gap)/2;
    box(g,l,x-gap/2-q/2,y+h/2,z,q,h,d,wallMat,true);
    box(g,l,x+gap/2+q/2,y+h/2,z,q,h,d,wallMat,true);
  }else{
    const q=(d-gap)/2;
    box(g,l,x,y+h/2,z-gap/2-q/2,w,h,q,wallMat,true);
    box(g,l,x,y+h/2,z+gap/2+q/2,w,h,q,wallMat,true);
  }
}

function tree(g,l,x,y,z,s=1){
  const trunk=new THREE.MeshStandardMaterial({color:0x72563b});
  const leaf=new THREE.MeshStandardMaterial({color:0x31794d,roughness:.9});
  box(g,l,x,y+1.6*s,z,.55*s,3.2*s,.55*s,trunk,true);
  box(g,l,x,y+3.5*s,z,2.5*s,2.2*s,2.5*s,leaf,true);
}

function addStairs(g,l,y,x){
  const stairMat=new THREE.MeshStandardMaterial({color:0x64748b,roughness:.72});
  const railMat=new THREE.MeshStandardMaterial({color:0x334155,metalness:.45,roughness:.4});
  const glow=new THREE.MeshStandardMaterial({color:0x22d3ee,emissive:0x0891b2,emissiveIntensity:.45,roughness:.35});
  const count=26;
  for(let i=0;i<count;i++){
    const z=-10+i*.78, sy=y+.35+i*.32;
    box(g,l,x,sy,z,4.2,.26,.88,stairMat,false,true);
  }
  box(g,l,x-2.25,y+4.4,0,.18,8.6,24,railMat,false);
  box(g,l,x+2.25,y+4.4,0,.18,8.6,24,railMat,false);
  const s=sign('STAIRWELL · UP / DOWN','#38bdf8');
  s.scale.set(.55,.55,1);
  s.position.set(x,y+5,-12);
  g.add(s);
  const light=box(g,l,x,y+4.2,-12,.7,1.2,.7,glow,false,false);
  light.material.emissiveIntensity=.8;
}

function addRoomItems(g,l,y){
  const frame=new THREE.MeshStandardMaterial({color:0x596a79,metalness:.2,roughness:.75});
  const mattress=new THREE.MeshStandardMaterial({color:0x9bb7c8,roughness:.93});
  const blanket=new THREE.MeshStandardMaterial({color:0xf1f5f9,roughness:.9});
  const wood=new THREE.MeshStandardMaterial({color:0x6b4f3a,roughness:.8});
  const metal=new THREE.MeshStandardMaterial({color:0x8ea4ba,metalness:.45,roughness:.5});
  const accent=new THREE.MeshStandardMaterial({color:0x38bdf8,emissive:0x0ea5e9,emissiveIntensity:.2,roughness:.58});
  const vinyl=new THREE.MeshStandardMaterial({color:0x9dd9d2,roughness:.82});
  const glass=new THREE.MeshStandardMaterial({color:0xcbd5e1,metalness:.65,roughness:.25,transparent:true,opacity:.88});
  const labPanel=new THREE.MeshStandardMaterial({color:0xe2e8f0,metalness:.15,roughness:.7});
  const labDark=new THREE.MeshStandardMaterial({color:0x475569,metalness:.4,roughness:.55});
  const labTrim=new THREE.MeshStandardMaterial({color:0x93c5fd,emissive:0x38bdf8,emissiveIntensity:.22,roughness:.45});

  if(l===3){
    for(const z of [-54,-42,-30,-18,-6,6,18,30,42,54]){
      for(const x of [-74,-62,-50,-38,-26,-14,-2,10,22,34,46,58,70]){
        box(g,l,x,y+.55,z,5.8,.22,2.7,frame,true);
        box(g,l,x,y+.78,z,5.2,.24,2.45,mattress,true);
        box(g,l,x-1.4,y+.95,z,2.4,.12,1.5,blanket,true);
        box(g,l,x+2.2,y+.9,z,1.1,.16,1.1,accent,true);
        box(g,l,x,y+1.22,z+1.5,5.2,.16,.16,metal,true);
      }
    }

    for(const x of [-62,-30,0,30,62]){
      box(g,l,x,y+.58,0,12,.2,12,vinyl,true);
      box(g,l,x,y+.74,0,9,.2,9,new THREE.MeshStandardMaterial({color:0xf8fafc,roughness:.85}),true);
    }

    for(const z of [-28,28]){
      for(const x of [-18,-4,10,26,42]){
        box(g,l,x,y+.5,z,7.2,.32,3.2,wood,true);
        box(g,l,x,y+.8,z-1.7,6.4,.18,1,metal,true);
        box(g,l,x,y+.8,z+1.7,6.4,.18,1,metal,true);
      }
    }

    box(g,l,-18,y+1.2,52,12,2.2,5,wood,true);
    box(g,l,-18,y+2.25,52,10,.15,2.7,labTrim,true);
    box(g,l,14,y+1.1,54,9,1.2,3.1,metal,true);
    box(g,l,42,y+1.1,-52,11,1.2,4.8,wood,true);

    for(const [x,z] of [[-68,-8],[-48,22],[42,40],[66,-24],[70,58],[-68,56]]){
      tree(g,l,x,y,z,1.25);
    }

    const patientSign=sign('PATIENT WARD · RECOVERY','#34d399');
    patientSign.position.set(0,y+5.4,-HD+1.2);
    g.add(patientSign);

    const stationSign=sign('NURSING STATION','#fbbf24');
    stationSign.position.set(-18,y+4.7,52);
    g.add(stationSign);

    const commonSign=sign('COMMON AREA','#38bdf8');
    commonSign.position.set(0,y+4.7,58);
    g.add(commonSign);

  } else if(l===2){
    partition(g,l,y,-37,-15,.7,86,12);
    partition(g,l,y,37,-15,.7,86,12);
    partition(g,l,y,0,-52,65,.7,10);

    for(const z of [-43,-25,-7,11,29]){
      for(const x of [-70,-58,-46]){
        box(g,l,x,y+.6,z,5.5,.2,2.4,frame,true);
        box(g,l,x,y+.82,z,5.0,.24,2.0,mattress,true);
        box(g,l,x-1.5,y+.96,z,2.1,.12,1.2,blanket,true);
      }
    }

    for(const z of [-43,-25,-7,11,29]){
      for(const x of [46,58,70]){
        box(g,l,x,y+.6,z,5.5,.2,2.4,frame,true);
        box(g,l,x,y+.82,z,5.0,.24,2.0,mattress,true);
        box(g,l,x-1.5,y+.96,z,2.1,.12,1.2,blanket,true);
      }
    }

    for(const z of [-48,-18,12,42]){
      for(const x of [-18,-2,14,30]){
        box(g,l,x,y+.5,z,7,.18,3.2,wood,true);
        box(g,l,x,y+.78,z,6.2,.18,2.4,blanket,true);
      }
    }

  } else if(l===1){
    const labRooms=[
      {x:-68,z:-24,w:22,d:18,name:'LABORATORY'},
      {x:-68,z:24,w:22,d:18,name:'STORAGE'},
      {x:-12,z:-24,w:24,d:18,name:'RESEARCH'},
      {x:-12,z:24,w:24,d:18,name:'TEST BAY'},
      {x:50,z:-24,w:20,d:18,name:'RADIOLOGY'},
      {x:50,z:24,w:20,d:18,name:'CHEMICAL'}
    ];

    for(const room of labRooms){
      box(g,l,room.x,y+1.1,room.z,room.w,1.8,room.d,labPanel,true);
      box(g,l,room.x,y+2.15,room.z,room.w-2,.2,room.d-2,glass,false,false);
      box(g,l,room.x,y+.35,room.z,room.w-1,.15,room.d-1,new THREE.MeshStandardMaterial({color:0xdfe7ef,roughness:.8}),false,false);
      box(g,l,room.x-6.2,y+1.2,room.z-5.2,7,.7,3.2,wood,true);
      box(g,l,room.x+6.2,y+1.2,room.z-5.2,7,.7,3.2,wood,true);
      box(g,l,room.x,y+2.35,room.z+5.2,10,.22,2.5,labTrim,true);
      box(g,l,room.x,y+3.1,room.z-6.8,8,.2,1.2,metal,true);

      const label=sign(room.name,'#a78bfa');
      label.position.set(room.x,y+4.7,room.z-8.2);
      g.add(label);

      const shelf=sign(room.name,'#38bdf8');
      shelf.position.set(room.x,y+5.2,room.z+7.8);
      g.add(shelf);
    }

    box(g,l,0,y+.45,0,38,.18,18,vinyl,false,false);
    box(g,l,-36,y+1.2,0,2.2,2.4,22,labDark,true);
    box(g,l,36,y+1.2,0,2.2,2.4,22,labDark,true);

    for(const x of [-28,0,28]){
      box(g,l,x,y+.9,-8,9,.7,2.6,metal,true);
      box(g,l,x,y+.9,8,9,.7,2.6,metal,true);
      box(g,l,x,y+1.8,-8,8,.18,1.1,accent,true);
      box(g,l,x,y+1.8,8,8,.18,1.1,accent,true);
    }

    const labMain=sign('LABORATORY COMPLEX','#38bdf8');
    labMain.position.set(0,y+5.3,-HD+1.2);
    g.add(labMain);

    const eastWing=sign('EXPERIMENTAL DIVISION','#a78bfa');
    eastWing.position.set(52,y+5.2,0);
    g.add(eastWing);

  } else {
    partition(g,l,y,0,-42,90,.7,18);
    box(g,l,0,y+1.1,49,26,2.2,3,wood,true);
    for(const x of [-68,-48,48,68]){
      box(g,l,x,y+.65,10,8,.3,3,wood,true);
      box(g,l,x,y+1.45,10,8,1.2,.22,new THREE.MeshStandardMaterial({color:0x7dd3fc,roughness:.62}),true);
    }
  }
}

function makeFloor(l){
  const data=floors[l], y=data.y, g=new THREE.Group();
  groups.set(l,g);
  colliders.set(l,[]);
  scene.add(g);

  box(g,l,0,y,0,W,.65,D,floorMat,false);

  const top=y+7.05, th=.55;
  const rects=[[-90,-86,-66,66],[-70,70,-66,66],[86,90,-66,66],[-86,-70,-66,-13],[-86,-70,13,66],[70,86,-66,-13],[70,86,13,66]];
  for(const [x1,x2,z1,z2] of rects){
    box(g,l,(x1+x2)/2,top,(z1+z2)/2,x2-x1,th,z2-z1,ceilMat,false,false);
  }

  const h=6.7, cy=y+h/2;
  box(g,l,0,cy,-HD,W,h,.9,wallMat,true);
  box(g,l,0,cy,HD,W,h,.9,wallMat,true);
  box(g,l,-HW,cy,0,.9,h,D,wallMat,true);
  box(g,l,HW,cy,0,.9,h,D,wallMat,true);

  const trim=new THREE.MeshStandardMaterial({color:data.accent,roughness:.6});
  box(g,l,0,y+.42,-HD+1,W-2,.22,.14,trim);
  box(g,l,0,y+.42,HD-1,W-2,.22,.14,trim);
  box(g,l,-HW+1,y+.42,0,.14,.22,D-2,trim);
  box(g,l,HW-1,y+.42,0,.14,.22,D-2,trim);

  for(let x=-72;x<=72;x+=24){
    for(const z of [-48,-16,16,48]){
      box(g,l,x,y+6.72,z,7,.12,1.3,new THREE.MeshStandardMaterial({color:0xfff7dc,emissive:0xffe6a3,emissiveIntensity:.8}),false,false);
    }
  }

  const label=sign(data.name,data.accent);
  label.position.set(0,y+5.15,-HD+.8);
  g.add(label);

  addRoomItems(g,l,y);
  addStairs(g,l,y,-78);
  addStairs(g,l,y,78);
}

function showFloor(l){
  for(const [i,g] of groups) g.visible = i === l;
  for(const [id,m] of meshes){
    const state = id === player.id ? player : others.get(id);
    if(state) m.visible = state.floor === l;
  }
}

function overlaps(x,z,c,l){
  const y=floors[l].y;
  return x+R>c.minX && x-R<c.maxX && z+R>c.minZ && z-R<c.maxZ && y+H>c.minY && y<c.maxY;
}

function collides(x,z,l){
  return (colliders.get(l)||[]).some(c => overlaps(x,z,c,l));
}

function chooseSafeSpawn(role){
  const wanted=spawns[role], l=wanted.floor;
  if(!collides(wanted.x,wanted.z,l)) return {x:wanted.x,z:wanted.z,floor:l};

  let best=null;
  for(let radius=2; radius<=30 && !best; radius++){
    for(let a=0; a<Math.PI*2; a+=Math.PI/8){
      const nx=THREE.MathUtils.clamp(wanted.x + Math.cos(a)*radius, -HW+2, HW-2);
      const nz=THREE.MathUtils.clamp(wanted.z + Math.sin(a)*radius, -HD+2, HD-2);
      if(!collides(nx,nz,l)){
        best={x:nx,z:nz,floor:l};
        break;
      }
    }
  }
  return best || {x:wanted.x,z:wanted.z,floor:l};
}

function held(item){
  if(!item) return null;

  const root=new THREE.Group();
  const metal=new THREE.MeshStandardMaterial({color:0x475569,metalness:.55,roughness:.35});
  const blue=new THREE.MeshStandardMaterial({color:0x3b82f6,metalness:.15,roughness:.45});
  const red=new THREE.MeshStandardMaterial({color:0xef4444,metalness:.26,roughness:.48});
  const beige=new THREE.MeshStandardMaterial({color:0xe2d4ae,roughness:.84});
  const glassMat=new THREE.MeshStandardMaterial({color:0xcbd5e1,metalness:.6,roughness:.25,transparent:true,opacity:.8});

  switch(item){
    case 'glassShard': {
      const shard=new THREE.Mesh(new THREE.ConeGeometry(.12,.55,4),glassMat);
      shard.rotation.z=Math.PI/2;
      shard.position.set(0,.2,.1);
      root.add(shard);
      break;
    }
    case 'smallMedicalKit':
    case 'mediumMedicalKit': {
      const c=new THREE.Mesh(new THREE.BoxGeometry(.34,.12,.22),blue);
      const cross=new THREE.Mesh(new THREE.BoxGeometry(.1,.34,.08),new THREE.MeshStandardMaterial({color:0xf8fafc}));
      cross.position.set(0,.1,0);
      root.add(c); root.add(cross);
      break;
    }
    case 'riotShield':{
      const s=new THREE.Mesh(new THREE.BoxGeometry(.48,.68,.08),new THREE.MeshStandardMaterial({color:0xfacc15,metalness:.2,roughness:.8}));
      root.add(s);
      break;
    }
    case 'taser':{
      const body=new THREE.Mesh(new THREE.BoxGeometry(.18,.08,.06),metal);
      body.position.set(0,.08,0);
      root.add(body);
      const tip=new THREE.Mesh(new THREE.BoxGeometry(.1,.14,.08),red);
      tip.position.set(.18,0,0);
      root.add(tip);
      break;
    }
    case 'stunBaton':{
      const bat=new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,.7,8),metal);
      bat.rotation.z=Math.PI/2;
      root.add(bat);
      break;
    }
    case 'arrestCuffs':{
      const c1=new THREE.Mesh(new THREE.TorusGeometry(.1,.03,6,12),metal);
      c1.rotation.x=Math.PI/2;
      c1.position.set(0,.1,0);
      root.add(c1);
      break;
    }
    case 'ignotusShield':{
      const s=new THREE.Mesh(new THREE.BoxGeometry(.52,.72,.08),new THREE.MeshStandardMaterial({color:0x8b5cf6,metalness:.3,roughness:.78}));
      root.add(s);
      break;
    }
    case 'tablet':{
      const t=new THREE.Mesh(new THREE.BoxGeometry(.28,.18,.04),new THREE.MeshStandardMaterial({color:0x1f2937,metalness:.3,roughness:.7}));
      root.add(t);
      break;
    }
    default:{
      const d=new THREE.Mesh(new THREE.BoxGeometry(.28,.18,.1),beige);
      root.add(d);
    }
  }

  root.rotation.set(.7,-.4,-.2);
  return root;
}

function equipVisual(m,item){
  const hand = m?.userData.hand;
  if(!hand) return;
  while(hand.children.length) hand.remove(hand.children[0]);
  m.userData.equippedItem = item || null;
  const prop = held(item);
  if(prop) hand.add(prop);
}

function model(p){
  const g=new THREE.Group();
  const shirt=new THREE.MeshStandardMaterial({color:p.color||roles[p.role]?.color||'#fff'});
  const pants=new THREE.MeshStandardMaterial({color:p.role==='patient'?0x3f5d76:p.role==='medic'?0x1f6f65:p.role==='orderly'?0x6b4f3a:0x4338ca,roughness:.8});
  const skin=new THREE.MeshStandardMaterial({color:0xf5d7b5,roughness:.9});
  const hair=new THREE.MeshStandardMaterial({color:0x111827,roughness:.9});
  const outline=new THREE.MeshStandardMaterial({color:0x0f172a,metalness:.2,roughness:.9});

  const torso=new THREE.Mesh(new THREE.BoxGeometry(.7,1.1,.42),shirt);
  torso.position.y=1.3;
  g.add(torso);

  const head=new THREE.Mesh(new THREE.SphereGeometry(.28,18,18),skin);
  head.position.y=2.25;
  g.add(head);

  const hairCap=new THREE.Mesh(new THREE.SphereGeometry(.29,18,18,0,Math.PI*2,0,Math.PI/2),hair);
  hairCap.position.y=2.46;
  g.add(hairCap);

  const leftLeg=new THREE.Mesh(new THREE.BoxGeometry(.22,1.1,.22),pants);
  leftLeg.position.set(-.17,.2,0);
  g.add(leftLeg);

  const rightLeg=new THREE.Mesh(new THREE.BoxGeometry(.22,1.1,.22),pants);
  rightLeg.position.set(.17,.2,0);
  g.add(rightLeg);

  const leftArm=new THREE.Mesh(new THREE.BoxGeometry(.16,.82,.16),shirt);
  leftArm.position.set(-.56,1.3,0);
  g.add(leftArm);

  const rightArm=new THREE.Mesh(new THREE.BoxGeometry(.16,.82,.16),shirt);
  rightArm.position.set(.56,1.3,0);
  g.add(rightArm);

  const hands=new THREE.Group();
  hands.position.set(0,0.88,.18);
  g.add(hands);
  g.userData.hand=hands;

  const glow=new THREE.Mesh(new THREE.TorusGeometry(.32,.03,10,24),outline);
  glow.rotation.x=Math.PI/2;
  glow.position.y=0.18;
  g.add(glow);

  g.position.set(p.x,0,p.z);
  g.userData.role = p.role || 'patient';
  g.userData.health = p.health || 100;

  equipVisual(g, p.equippedItem || p.inventory?.[0]);
  return g;
}

function addPlayer(p,isLocal=false){
  const old=meshes.get(p.id);
  if(old) scene.remove(old);
  const m=model(p);
  m.visible = p.floor === player.floor;
  meshes.set(p.id,m);
  scene.add(m);
  if(isLocal) player.mesh = m;
}

function drawHealth(){
  const max=player.maxHealth||100;
  const current=Math.max(0,Math.min(max,player.health));
  ui.healthText.textContent=`${Math.round(current)} / ${max}%`;
  ui.healthFill.style.width=`${(current/max)*100}%`;
  ui.healthFill.style.background = current > 60
    ? 'linear-gradient(90deg,#22c55e,#86efac)'
    : current > 30
      ? 'linear-gradient(90deg,#f59e0b,#facc15)'
      : 'linear-gradient(90deg,#ef4444,#fca5a5)';
}

function renderSlots(){
  ui.slots.replaceChildren();
  if(!player.inventory.length){
    ui.slots.textContent='No equipment';
    return;
  }

  player.inventory.forEach((item,i)=>{
    const b=document.createElement('button');
    b.type='button';
    b.className=`equipment-slot ${player.equippedItem===item ? 'selected' : ''}`;
    b.innerHTML=`<span class="slot-number">${i+1}</span>${itemNames[item]||item}`;
    b.addEventListener('click',()=>equip(item));
    ui.slots.appendChild(b);
  });
}

function updateHUD(){
  ui.role.textContent=`Role: ${player.role||'None'}`;
  ui.floor.textContent=`Floor: ${floorNames[player.floor]||'Ground'}`;
  ui.status.textContent = player.role ? `Ready: ${player.role}` : 'Waiting';
  renderSlots();
  drawHealth();
  if(ui.ability && player.role){
    ui.ability.textContent = `Ability: ${player.role==='patient'?'Shiv':player.role==='medic'?'Heal':player.role==='orderly'?'Arrest':'Shield'}`;
  }
}

function equip(item){
  if(!player.inventory.includes(item)) return;
  player.equippedItem=item;
  equipVisual(player.mesh,item);
  renderSlots();
  socket.emit('equipItem',{item});
  ui.status.textContent=`Equipped ${itemNames[item]||item}`;
}

function chooseRole(role){
  if(!roles[role]) return;
  player.role=role;
  player.color=roles[role].color;
  player.inventory=[...roles[role].items];
  player.equippedItem=player.inventory[0]||null;
  player.maxHealth=roles[role].maxHealth;
  player.health=player.maxHealth;
  ui.join.classList.add('hidden');
  socket.emit('joinGame',{role,name:player.name,spawn:chooseSafeSpawn(role)});
  updateHUD();
}

function sync(force=false){
  const now=performance.now();
  if(!force && now-lastUpdate<75) return;
  lastUpdate=now;
  socket.emit('updatePlayer',{
    x:player.x,
    y:floors[player.floor].y+1,
    z:player.z,
    floor:player.floor,
    health:Math.max(0,Math.min(player.maxHealth||100,player.health)),
    role:player.role,
    stunned:player.stunned,
    inventory:player.inventory,
    equippedItem:player.equippedItem
  });
}

function move(dt){
  if(!player.role || player.stunned) return;

  let ix=touch.x, fwd=-touch.z;
  if(keys.KeyW||keys.ArrowUp) fwd++;
  if(keys.KeyS||keys.ArrowDown) fwd--;
  if(keys.KeyA||keys.ArrowLeft) ix--;
  if(keys.KeyD||keys.ArrowRight) ix++;

  const speed=(keys.Shift||touch.sprint ? 8 : 5) * dt;
  const ang=yaw;
  const dx=Math.sin(ang)*ix + Math.cos(ang)*fwd;
  const dz=Math.cos(ang)*ix - Math.sin(ang)*fwd;

  const nx=player.x + dx*speed;
  const nz=player.z + dz*speed;
  if(!collides(nx,nz,player.floor)){
    player.x = nx;
    player.z = nz;
  }

  sync();
}

function useStairs(){
  if(!player.role) return;

  const left = Math.hypot(player.x+78,player.z);
  const right = Math.hypot(player.x-78,player.z);
  if(Math.min(left,right) > 8){
    ui.status.textContent='Walk up to either stairwell landing';
    return;
  }

  if(player.floor===0){
    player.floor=1; player.x=78; player.z=0; ui.status.textContent='Moved to U1';
  } else if(player.floor===1 && Math.abs(player.x+78)<8){
    player.floor=2; player.x=-70; player.z=0; ui.status.textContent='Moved to U2';
  } else if(player.floor===1 && Math.abs(player.x-78)<8){
    player.floor=0; player.x=78; player.z=0; ui.status.textContent='Moved to Ground';
  } else if(player.floor===2 && Math.abs(player.x+78)<8){
    player.floor=3; player.x=-72; player.z=8; ui.status.textContent='Moved to U3';
  } else if(player.floor===2 && Math.abs(player.x-78)<8){
    player.floor=1; player.x=70; player.z=0; ui.status.textContent='Moved to U1';
  } else if(player.floor===3 && Math.abs(player.x+78)<8){
    player.floor=2; player.x=-70; player.z=0; ui.status.textContent='Moved to U2';
  } else if(player.floor===3 && Math.abs(player.x-78)<8){
    player.floor=2; player.x=70; player.z=0; ui.status.textContent='Moved to U2';
  }

  showFloor(player.floor);
  sync(true);
}

function chooseSafeSpawnOnFloor(x,z,l){
  if(!collides(x,z,l)) return {x,z};
  for(let r=1; r<24; r+=1){
    for(let a=0; a<Math.PI*2; a+=Math.PI/8){
      const nx=THREE.MathUtils.clamp(x+Math.cos(a)*r,-HW+2,HW-2);
      const nz=THREE.MathUtils.clamp(z+Math.sin(a)*r,-HD+2,HD-2);
      if(!collides(nx,nz,l)) return {x:nx,z:nz};
    }
  }
  return {x,z};
}

function ability(){
  if(!player.role) return;

  if(player.role==='medic'){
    player.health=Math.min(player.maxHealth,player.health+20);
    drawHealth();
    ui.status.textContent='Medic: heal used';
  } else {
    ui.status.textContent=`${player.role} ability ready`;
  }

  socket.emit('useAbility',{ability:player.role});
}

function touchControls(){
  const zone=document.getElementById('joystickZone');
  const pad=document.getElementById('movePad');
  const stick=document.getElementById('moveStick');
  let activeId=null;

  const reset=()=>{
    activeId=null;
    touch.x=0; touch.z=0;
    pad.classList.remove('visible');
    stick.style.transform='translate(-50%, -50%)';
  };

  zone.addEventListener('pointerdown',e=>{
    activeId=e.pointerId;
    pad.classList.add('visible');
    const rect=pad.getBoundingClientRect();
    const cx=rect.left+rect.width/2;
    const cy=rect.top+rect.height/2;
    pad.style.left=`${cx-68}px`;
    pad.style.top=`${cy-68}px`;
  });

  zone.addEventListener('pointermove',e=>{
    if(e.pointerId!==activeId) return;
    const rect=pad.getBoundingClientRect();
    const cx=rect.left+rect.width/2;
    const cy=rect.top+rect.height/2;
    const dx=e.clientX-cx;
    const dy=e.clientY-cy;
    const dist=Math.min(52,Math.hypot(dx,dy));
    const ang=Math.atan2(dy,dx);
    const sx=Math.cos(ang)*dist;
    const sy=Math.sin(ang)*dist;
    stick.style.transform=`translate(${sx}px, ${sy}px)`;
    touch.x = dx / 52;
    touch.z = dy / 52;
  });

  zone.addEventListener('pointerup',reset);
  zone.addEventListener('pointercancel',reset);
  zone.addEventListener('pointerleave',reset);

  const sprintButton=document.getElementById('sprintButton');
  sprintButton.addEventListener('pointerdown',()=>{touch.sprint=true;sprintButton.classList.add('active');});
  sprintButton.addEventListener('pointerup',()=>{touch.sprint=false;sprintButton.classList.remove('active');});
  sprintButton.addEventListener('pointerleave',()=>{touch.sprint=false;sprintButton.classList.remove('active');});

  document.getElementById('interactButton').addEventListener('click',useStairs);
  document.getElementById('abilityButton').addEventListener('click',ability);
}

function cameraInput(){
  const c=renderer.domElement;
  c.addEventListener('pointerdown',e=>{
    if(e.button!==undefined&&e.button!==0) return;
    dragging=true;
    lastPointer={x:e.clientX,y:e.clientY};
  });

  c.addEventListener('pointermove',e=>{
    if(!dragging || !lastPointer) return;
    const dx=e.clientX-lastPointer.x;
    const dy=e.clientY-lastPointer.y;
    lastPointer={x:e.clientX,y:e.clientY};
    yaw -= dx * 0.005;
    pitch = Math.max(-.7, Math.min(1.1, pitch - dy * 0.004));
  });

  c.addEventListener('pointerup',()=>dragging=false);
  c.addEventListener('pointerleave',()=>dragging=false);
}

function updateCamera(){
  const base=floors[player.floor].y;
  const focus=new THREE.Vector3(player.x, base+1.25, player.z);
  const h=Math.cos(pitch)*distance;
  const desired=new THREE.Vector3(
    focus.x + Math.sin(yaw)*h,
    focus.y + Math.sin(pitch)*distance + 1.5,
    focus.z + Math.cos(yaw)*h
  );
  camera.position.lerp(desired, .14);
  camera.lookAt(focus);
}

function inputs(){
  document.addEventListener('keydown',e=>{
    keys[e.code]=true;
    if(e.code==='KeyE') useStairs();
    if(e.code==='KeyQ') ability();
    if(/^Digit[1-9]$/.test(e.code)){
      const n=Number(e.code.slice(5));
      const item=player.inventory[n-1];
      if(item) equip(item);
    }
    if(e.code==='KeyF') document.documentElement.requestFullscreen?.();
    if(e.code==='KeyR') sync(true);
  });

  document.addEventListener('keyup',e=>{ keys[e.code]=false; });

  document.querySelectorAll('.roleButton').forEach(btn => {
    btn.addEventListener('click', () => chooseRole(btn.dataset.role));
  });

  ui.name.addEventListener('input',e=>{ player.name = e.target.value.trim() || 'Player'; });
  document.getElementById('fullscreenButton').addEventListener('click',()=>document.documentElement.requestFullscreen?.());
}

function frame(now){
  const dt=Math.min((now-lastFrame)/1000,.05);
  lastFrame=now;
  move(dt);
  updateCamera();

  for(const [id,m] of meshes){
    const state = id === player.id ? player : others.get(id);
    if(!state) continue;

    const target=new THREE.Vector3(state.x, floors[state.floor].y + 1.4, state.z);
    m.position.lerp(target, .12);
    m.visible = state.floor === player.floor;
    m.rotation.y = Math.atan2(target.x - m.position.x, target.z - m.position.z);
    m.rotation.y += Math.PI;
  }

  requestAnimationFrame(frame);
}

socket.on('assignedPlayer',p=>{
  player.id = p.id;
  player.name = p.name;
  player.role = p.role;
  player.color = roles[p.role]?.color || '#fff';
  player.inventory = [...(p.inventory || roles[p.role]?.items || [])];
  player.equippedItem = p.equippedItem || player.inventory[0] || null;
  player.maxHealth = roles[p.role]?.maxHealth || 100;
  player.health = Math.min(player.maxHealth, p.health || player.maxHealth);
  player.x = p.x || 0;
  player.y = p.y || 0;
  player.z = p.z || 0;
  player.floor = p.floor || 0;
  updateHUD();
  showFloor(player.floor);
});

socket.on('playersState',list=>{
  const live = new Set(list.map(p => p.id));

  for(const [id,m] of meshes){
    if(!live.has(id) && id !== player.id){
      scene.remove(m);
      meshes.delete(id);
    }
  }

  for(const p of list){
    if(p.id === player.id){
      player.x = p.x;
      player.z = p.z;
      player.floor = p.floor;
      player.role = p.role;
      player.health = p.health;
      player.equippedItem = p.equippedItem;
      player.inventory = p.inventory || [];
      if(player.mesh) player.mesh.position.set(player.x, floors[player.floor].y + 1.4, player.z);
      continue;
    }

    others.set(p.id,p);
    const existing = meshes.get(p.id);
    if(!existing || existing.userData.role !== p.role){
      addPlayer(p,false);
    } else {
      existing.position.set(p.x, floors[p.floor].y + 1.4, p.z);
      existing.visible = p.floor === player.floor;
      existing.rotation.y = Math.atan2(p.x - existing.position.x, p.z - existing.position.z);
      existing.rotation.y += Math.PI;
    }
  }

  if(player.mesh) player.mesh.position.set(player.x, floors[player.floor].y + 1.4, player.z);
});

socket.on('abilityFeedback',f=>{
  if(f?.message) ui.status.textContent = f.message;
});

for(let i=0;i<floors.length;i++) makeFloor(i);
showFloor(player.floor);
inputs();
touchControls();
cameraInput();
updateHUD();
requestAnimationFrame(frame);
window.addEventListener('resize',()=>{
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});
