import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';

const socket = io();
const roleInfo = {
  patient: { color: '#ef4444', ability: 'Glass Shard', inventory: ['glassShard'] },
  medic: { color: '#34d399', ability: 'Medic Heal', inventory: ['smallMedKit', 'mediumMedKit'] },
  orderly: { color: '#fbbf24', ability: 'Arrest Cuffs', inventory: ['riotShield', 'taser', 'stunBaton', 'arrestCuffs'] },
  director: { color: '#a78bfa', ability: 'Director Tablet', inventory: ['tablet', 'stunBaton'] }
};

const roleSpawns = {
  patient: { x: -10, z: -18, floor: 2 },
  medic: { x: 10, z: 12, floor: 1 },
  orderly: { x: -14, z: 12, floor: 1 },
  director: { x: 12, z: -14, floor: 0 }
};

const floorNames = {
  0: 'Ground',
  1: 'U1',
  2: 'U2',
  3: 'U3'
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1020);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 18, 22);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const ambient = new THREE.AmbientLight(0xffffff, 1.2);
scene.add(ambient);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(10, 30, 8);
scene.add(dirLight);

const localPlayer = {
  id: null,
  name: 'Player',
  role: null,
  x: 0,
  y: 0,
  z: 0,
  floor: 0,
  color: '#ffffff',
  inventory: [],
  health: 100,
  stunned: false
};

const remotePlayers = new Map();
const floorData = [
  { level: 0, y: 0, color: 0x7dd3fc },
  { level: 1, y: 8, color: 0x4ade80 },
  { level: 2, y: 16, color: 0xfbbf24 },
  { level: 3, y: 24, color: 0xf87171 }
];

const keys = {};
const doorDefs = [
  { id: 'door1', x: 0, z: 4, floor: 1, locked: true, type: 'keycard' },
  { id: 'door2', x: 6, z: -4, floor: 2, locked: true, type: 'director' },
  { id: 'door3', x: -10, z: 0, floor: 0, locked: false, type: 'normal' },
  { id: 'door4', x: 8, z: 9, floor: 3, locked: true, type: 'keycard' }
];

const stairs = [
  { id: 'stair1', x: -18, z: -4, floor: 3, targetFloor: 2 },
  { id: 'stair2', x: 18, z: -4, floor: 2, targetFloor: 1 },
  { id: 'stair3', x: 18, z: 10, floor: 1, targetFloor: 0 },
  { id: 'stair4', x: -18, z: 4, floor: 0, targetFloor: 1 }
];

const ui = {
  roleLabel: document.getElementById('roleLabel'),
  floorLabel: document.getElementById('floorLabel'),
  statusLabel: document.getElementById('statusLabel'),
  joinScreen: document.getElementById('joinScreen'),
  playerName: document.getElementById('playerName'),
  inventoryList: document.getElementById('inventoryList')
};

function buildFloor(level) {
  const data = floorData.find((floor) => floor.level === level);
  const plane = new THREE.Mesh(
    new THREE.BoxGeometry(46, 0.5, 34),
    new THREE.MeshStandardMaterial({ color: data.color, roughness: 0.7, metalness: 0.1 })
  );
  plane.position.set(0, data.y, 0);
  scene.add(plane);

  const boundary = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(46, 0.5, 34)),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 })
  );
  boundary.position.copy(plane.position);
  scene.add(boundary);
}

function buildWalls() {
  const walls = [
    { x: 0, y: 2, z: -17, w: 42, h: 4, d: 1 },
    { x: 0, y: 2, z: 17, w: 42, h: 4, d: 1 },
    { x: -21, y: 2, z: 0, w: 1, h: 4, d: 32 },
    { x: 21, y: 2, z: 0, w: 1, h: 4, d: 32 },
    { x: 0, y: 2, z: 0, w: 1, h: 4, d: 12 },
    { x: 12, y: 2, z: 0, w: 1, h: 4, d: 12 }
  ];

  walls.forEach((wall) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(wall.w, wall.h, wall.d),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.7, metalness: 0.2 })
    );
    mesh.position.set(wall.x, wall.y, wall.z);
    scene.add(mesh);
  });
}

function buildDoors() {
  doorDefs.forEach((door) => {
    const floorY = floorData[door.floor].y + 2;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 3.6, 0.6),
      new THREE.MeshStandardMaterial({
        color: door.type === 'director' ? '#a78bfa' : door.type === 'keycard' ? '#fbbf24' : '#94a3b8',
        emissive: door.locked ? 0x111111 : 0x0f172a,
        metalness: 0.4,
        roughness: 0.3
      })
    );
    mesh.position.set(door.x, floorY, door.z);
    mesh.userData = { ...door };
    scene.add(mesh);
  });
}

function buildStairs() {
  stairs.forEach((stair) => {
    const y = floorData[stair.floor].y + 1.5;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(3, 1, 3),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, emissive: 0x111827, emissiveIntensity: 0.4 })
    );
    mesh.position.set(stair.x, y, stair.z);
    mesh.userData = { ...stair, type: 'stairs' };
    scene.add(mesh);
  });
}

function buildExit() {
  const exitDoor = new THREE.Mesh(
    new THREE.BoxGeometry(4, 4, 1),
    new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x14532d, emissiveIntensity: 0.4 })
  );
  exitDoor.position.set(0, 2, 16);
  scene.add(exitDoor);
}

function setupWorld() {
  floorData.forEach((floor) => buildFloor(floor.level));
  buildWalls();
  buildDoors();
  buildStairs();
  buildExit();
}

function createPlayerMesh(player) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.75, 0.8, 1.8, 14),
    new THREE.MeshStandardMaterial({ color: player.color || '#ffffff', emissive: 0x111111 })
  );
  body.position.y = 1.1;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 16, 16),
    new THREE.MeshStandardMaterial({ color: '#f8fafc' })
  );
  head.position.y = 2.5;
  group.add(head);

  group.position.set(player.x, floorData[player.floor].y, player.z);
  group.userData.playerId = player.id;
  return group;
}

const worldPlayers = new Map();

function addRemotePlayer(player) {
  if (worldPlayers.has(player.id)) {
    const mesh = worldPlayers.get(player.id);
    mesh.position.set(player.x, floorData[player.floor].y, player.z);
    return mesh;
  }

  const mesh = createPlayerMesh(player);
  worldPlayers.set(player.id, mesh);
  scene.add(mesh);
  return mesh;
}

function removeRemotePlayer(id) {
  if (worldPlayers.has(id)) {
    scene.remove(worldPlayers.get(id));
    worldPlayers.delete(id);
  }
}

function updateInventoryUI() {
  const list = ui.inventoryList;
  list.innerHTML = '';
  if (!localPlayer.inventory.length) {
    list.innerHTML = '<li>Empty</li>';
    return;
  }

  localPlayer.inventory.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  });
}

function updateRoleUI() {
  ui.roleLabel.textContent = `Role: ${localPlayer.role || 'None'}`;
  ui.floorLabel.textContent = `Floor: ${floorNames[localPlayer.floor] || 'U3'}`;
  ui.statusLabel.textContent = localPlayer.stunned ? 'Stunned' : 'Active';
  updateInventoryUI();
}

function setRole(role) {
  if (!roleInfo[role]) return;

  localPlayer.role = role;
  localPlayer.color = roleInfo[role].color;
  localPlayer.inventory = [...roleInfo[role].inventory];

  const spawn = roleSpawns[role];
  localPlayer.x = spawn.x;
  localPlayer.z = spawn.z;
  localPlayer.floor = spawn.floor;

  const name = ui.playerName.value.trim() || 'Player';
  localPlayer.name = name;

  updateRoleUI();
  socket.emit('joinGame', { name, role });
  ui.joinScreen.classList.add('hidden');
}

function handleKeyState() {
  const speed = keys.Shift ? 8 : 5.5;
  const delta = 1 / 60;

  if (!localPlayer.role) return;

  let dx = 0;
  let dz = 0;

  if (keys.KeyW || keys.ArrowUp) dz -= 1;
  if (keys.KeyS || keys.ArrowDown) dz += 1;
  if (keys.KeyA || keys.ArrowLeft) dx -= 1;
  if (keys.KeyD || keys.ArrowRight) dx += 1;

  const length = Math.hypot(dx, dz) || 1;
  dx /= length;
  dz /= length;

  localPlayer.x += dx * speed * delta;
  localPlayer.z += dz * speed * delta;

  localPlayer.x = THREE.MathUtils.clamp(localPlayer.x, -18, 18);
  localPlayer.z = THREE.MathUtils.clamp(localPlayer.z, -15, 15);

  const currentFloorY = floorData[localPlayer.floor].y;
  const bodyHeight = currentFloorY + 1.2;
  localPlayer.y = bodyHeight;

  socket.emit('updatePlayer', {
    x: localPlayer.x,
    y: localPlayer.y,
    z: localPlayer.z,
    floor: localPlayer.floor,
    role: localPlayer.role,
    name: localPlayer.name,
    stunned: localPlayer.stunned,
    health: localPlayer.health
  });
}

function tryUseStairs() {
  const stairTarget = stairs.find((stair) => {
    const dist = Math.hypot(localPlayer.x - stair.x, localPlayer.z - stair.z);
    return dist < 2.8 && localPlayer.floor === stair.floor;
  });

  if (!stairTarget) return;

  localPlayer.floor = stairTarget.targetFloor;
  ui.statusLabel.textContent = `Moving to ${floorNames[localPlayer.floor]}`;
  socket.emit('updatePlayer', {
    x: localPlayer.x,
    y: floorData[localPlayer.floor].y + 1.2,
    z: localPlayer.z,
    floor: localPlayer.floor,
    role: localPlayer.role,
    name: localPlayer.name,
    stunned: localPlayer.stunned,
    health: localPlayer.health
  });
  updateRoleUI();
}

function tryUseAbility() {
  if (!localPlayer.role) return;

  if (localPlayer.role === 'director') {
    ui.statusLabel.textContent = 'Director announcement: door access granted';
  } else if (localPlayer.role === 'medic') {
    localPlayer.health = Math.min(100, localPlayer.health + 20);
    ui.statusLabel.textContent = 'Medic healed and recovered';
  } else if (localPlayer.role === 'orderly') {
    ui.statusLabel.textContent = 'Orderly: stun pulse activated';
  } else {
    ui.statusLabel.textContent = 'Patient: escape path remains hidden';
  }

  socket.emit('useAbility', { ability: roleInfo[localPlayer.role].ability });
}

function setupInput() {
  document.addEventListener('keydown', (event) => {
    keys[event.code] = true;
    if (event.code === 'KeyE') tryUseStairs();
    if (event.code === 'KeyQ') tryUseAbility();
  });

  document.addEventListener('keyup', (event) => {
    keys[event.code] = false;
  });

  document.querySelectorAll('.roleButton').forEach((button) => {
    button.addEventListener('click', () => setRole(button.dataset.role));
  });
}

function setupLocalMarker() {
  const marker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.8, 1.5, 18),
    new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: 0x1e293b })
  );
  marker.position.set(0, 0.6, 0);
  scene.add(marker);
  localPlayer.mesh = marker;
}

function updateCamera() {
  const targetX = localPlayer.x;
  const targetY = floorData[localPlayer.floor].y + 9;
  const targetZ = localPlayer.z + 16;

  camera.position.lerp(new THREE.Vector3(targetX, targetY, targetZ), 0.08);
  camera.lookAt(localPlayer.x, floorData[localPlayer.floor].y + 1.2, localPlayer.z);
}

function tick() {
  handleKeyState();
  updateCamera();

  if (localPlayer.mesh) {
    localPlayer.mesh.position.set(localPlayer.x, floorData[localPlayer.floor].y + 0.7, localPlayer.z);
  }

  worldPlayers.forEach((mesh, id) => {
    if (id === socket.id) return;
    const remote = remotePlayers.get(id);
    if (!remote) return;
    const floorY = floorData[remote.floor]?.y || 0;
    mesh.position.lerp(new THREE.Vector3(remote.x, floorY + 1.2, remote.z), 0.22);
  });

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

socket.on('assignedPlayer', (player) => {
  localPlayer.id = player.id;
  localPlayer.name = player.name;
  localPlayer.role = player.role;
  localPlayer.color = roleInfo[player.role].color;
  localPlayer.inventory = [...roleInfo[player.role].inventory];
  localPlayer.floor = player.floor;
  localPlayer.x = player.x;
  localPlayer.z = player.z;
  updateRoleUI();
});

socket.on('playersState', (players) => {
  const incoming = new Map();

  players.forEach((player) => {
    incoming.set(player.id, player);
    if (player.id !== socket.id) {
      addRemotePlayer(player);
    }
  });

  for (const [id] of worldPlayers) {
    if (!incoming.has(id)) removeRemotePlayer(id);
  }

  remotePlayers.clear();
  players.forEach((player) => {
    if (player.id !== socket.id) remotePlayers.set(player.id, player);
  });

  if (players.length === 1 && localPlayer.role) {
    ui.statusLabel.textContent = 'You are alone in the facility';
  }
});

setupWorld();
setupLocalMarker();
setupInput();
updateRoleUI();
requestAnimationFrame(tick);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
