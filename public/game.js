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
    // Patient wing inspired by the reference images: broad recovery hall, long bed rows, central med desk,
    // visible greenery, and a large open treatment floor with clear coverage and room to move.
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

    for(const z of [-28,28]) for(const x of [-18,-4,10,26,42]){
      box(g,l,x,y+.5,z,7.2,.32,3.2,wood,true);
      box(g,l,x,y+.8,z-1.7,6.4,.18,1,metal,true);
      box(g,l,x,y+.8,z+1.7,6.4,.18,1,metal,true);
    }

    box(g,l,-18,y+1.2,52,12,2.2,5,wood,true);
    box(g,l,-18,y+2.25,52,10,.15,2.7,labTrim,true);
    box(g,l,14,y+1.1,54,9,1.2,3.1,metal,true);
    box(g,l,42,y+1.1,-52,11,1.2,4.8,wood,true);

    for(const [x,z] of [[-68,-8],[-48,22],[42,40],[66,-24],[70,58],[-68,56]]){
      tree(g,l,x,y,z,1.25);
    }

    const patientSign=sign('PATIENT WARD · RECOVERY','#34d399');
    patientSign.position.set(0,y+5.4,-HD+1.2);g.add(patientSign);
    const stationSign=sign('NURSING STATION','#fbbf24');
    stationSign.position.set(-18,y+4.7,52);g.add(stationSign);
    const commonSign=sign('COMMON AREA','#38bdf8');
    commonSign.position.set(0,y+4.7,58);g.add(commonSign);
  }else if(l===2){
    partition(g,l,y,-37,-15,.7,86,12);partition(g,l,y,37,-15,.7,86,12);partition(g,l,y,0,-52,65,.7,10);
    for(const z of [-43,-25,-7,11,29])for(const x of [-70,-58,-46]){box(g,l,x,y+.6,z,5.5,.2,2.4,frame,true);box(g,l,x,y+.82,z,5.0,.24,2.0,mattress,true);box(g,l,x-1.5,y+.96,z,2.1,.12,1.2,blanket,true);}
    for(const z of [-43,-25,-7,11,29])for(const x of [46,58,70]){box(g,l,x,y+.6,z,5.5,.2,2.4,frame,true);box(g,l,x,y+.82,z,5.0,.24,2.0,mattress,true);box(g,l,x-1.5,y+.96,z,2.1,.12,1.2,blanket,true);}
    for(const z of [-48,-18,12,42])for(const x of [-18,-2,14,30]){box(g,l,x,y+.5,z,7,.18,3.2,wood,true);box(g,l,x,y+.78,z,6.2,.18,2.4,blanket,true);}
  }else if(l===1){
    // Laboratory floor inspired by the reference: numerous connected rooms, large glass-fronted stations,
    // and a central corridor with signage for experimental and chemical divisions.
    const labRooms=[
      {x:-68,z:-24,w:22,d:18,name:'LABORATORY'},
      {x:-68,z:24,w:22,d:18,name:'STORAGE'},
      {x:-12,z:-24,w:24,d:18,name:'RESEARCH'},
      {x:-12,z:24,w:24,d:18,name:'TEST BAY'},
      {x:50,z:-24,w:20,d:18,name:'RADIOLOGY'},
      {x:50,z:24,w:20,d:18,name:'CHEMICAL'},
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
      label.position.set(room.x,y+4.7,room.z-8.2);g.add(label);
      const signShelf=sign(room.name,'#38bdf8');
      signShelf.position.set(room.x,y+5.2,room.z+7.8);g.add(signShelf);
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
    labMain.position.set(0,y+5.3,-HD+1.2);g.add(labMain);
    const eastWing=sign('EXPERIMENTAL DIVISION','#a78bfa');
    eastWing.position.set(52,y+5.2,0);g.add(eastWing);
  }else{
    partition(g,l,y,0,-42,90,.7,18);
    box(g,l,0,y+1.1,49,26,2.2,3,wood,true);
    for(const x of [-68,-48,48,68]){box(g,l,x,y+.65,10,8,.3,3,bench,true);box(g,l,x,y+1.45,10,8,1.2,.22,new THREE.MeshStandardMaterial({color:0x7dd3fc,roughness:.62}),true);}
  }
}

function makeFloor(l){const data=floors[l],y=data.y,g=new THREE.Group();groups.set(l,g);colliders.set(l,[]);scene.add(g);box(g,l,0,y,0,W,.65,D,floorMat,false);
  // Ceiling is made around two stairwell openings so the switchback stairs visibly connect story-to-story.
  const top=y+7.05,th=.55;for(const x of [-HW, -86, -70, 70, 86]){} // explicit ceiling tiles around the two apertures
  const rects=[[-90,-86,-66,66],[-70,70,-66,66],[86,90,-66,66],[-86,-70,-66,-13],[-86,-70,13,66],[70,86,-66,-13],[70,86,13,66]];
  for(const [x1,x2,z1,z2]of rects)box(g,l,(x1+x2)/2,top,(z1+z2)/2,x2-x1,th,z2-z1,ceilMat,false,false);
  const h=6.7,cy=y+h/2;box(g,l,0,cy,-HD,W,h,.9,wallMat,true);box(g,l,0,cy,HD,W,h,.9,wallMat,true);box(g,l,-HW,cy,0,.9,h,D,wallMat,true);box(g,l,HW,cy,0,.9,h,D,wallMat,true);
  const trim=new THREE.MeshStandardMaterial({color:data.accent,roughness:.6});box(g,l,0,y+.42,-HD+1,W-2,.22,.14,trim);box(g,l,0,y+.42,HD-1,W-2,.22,.14,trim);box(g,l,-HW+1,y+.42,0,.14,.22,D-2,trim);box(g,l,HW-1,y+.42,0,.14,.22,D-2,trim);
  for(let x=-72;x<=72;x+=24)for(const z of [-48,-16,16,48])box(g,l,x,y+6.72,z,7,.12,1.3,new THREE.MeshStandardMaterial({color:0xfff7dc,emissive:0xffe6a3,emissiveIntensity:.8}),false,false);
  const label=sign(data.name,data.accent);label.position.set(0,y+5.15,-HD+.8);g.add(label);addRoomItems(g,l,y);addStairs(g,l,y,-78);addStairs(g,l,y,78);
}
