import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';

const socket = io();
const isTouchDevice = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
if (isTouchDevice) document.documentElement.classList.add('touch-device');

const roleInfo = {
  patient: { color: '#ef4444', ability: 'Glass Shard', inventory: ['glassShard'] },
  medic: { color: '#34d399', ability: 'Medic Heal', inventory: ['smallMedKit', 'mediumMedKit'] },
  orderly: { color: '#fbbf24', ability: 'Arrest Cuffs', inventory: ['riotShield', 'taser', 'stunBaton', 'arrestCuffs'] },
  director: { color: '#a78bfa', ability: 'Director Tablet', inventory: ['tablet', 'stunBaton'] }
};
const roleSpawns = {
  patient: { x: -10, z: -12, floor: 3 },
  medic: { x: 10, z: 12, floor: 2 },
  orderly: { x: -14, z: 12, floor: 2 },
  director: { x: 12, z: -14, floor: 1 }
};
const floorNames = { 0: 'Ground', 1: 'U1', 2: 'U2', 3: 'U3' };
const floorData = [
  { level: 0, y: 0, color: 0x7dd3fc },
  { level: 1, y: 8, color: 0x4ade80 },
  { level: 2, y: 16, color: 0xfbbf24 },
  { level: 3, y: 24, color: 0xf87171 }
];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1020);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
const renderer = new THREE.WebGLRenderer({ antialias: !isTouchDevice, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouchDevice ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(10, 30, 8);
scene.add(dirLight);

const localPlayer = { id: null, name: 'Player', role: null, x: 0, y: 0, z: 0, floor: 0, color: '#ffffff', inventory: [], health: 100, stunned: false };
const remotePlayers = new Map();
const worldPlayers = new Map();
const keys = {};
const touchInput = { x: 0, z: 0, sprint: false };
let lastNetworkUpdate = 0;
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
  roleLabel: document.getElementById('roleLabel'), floorLabel: document.getElementById('floorLabel'),
  statusLabel: document.getElementById('statusLabel'), joinScreen: document.getElementById('joinScreen'),
  playerName: document.getElementById('playerName'), inventoryList: document.getElementById('inventoryList'),
  abilityButton: document.getElementById('abilityButton'), sprintButton: document.getElementById('sprintButton'),
  fullscreenButton: document.getElementById('fullscreenButton')
};

function buildFloor(level) {
  const data = floorData.find((floor) => floor.level === level);
  const plane = new THREE.Mesh(new THREE.BoxGeometry(46, 0.5, 34), new THREE.MeshStandardMaterial({ color: data.color, roughness: 0.7, metalness: 0.1 }));
  plane.position.set(0, data.y, 0);
  scene.add(plane);
  const boundary = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(46, 0.5, 34)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 }));
  boundary.position.copy(plane.position);
  scene.add(boundary);
}
function buildWalls() {
  const walls = [
    { x: 0, y: 2, z: -17, w: 42, h: 4, d: 1 }, { x: 0, y: 2, z: 17, w: 42, h: 4, d: 1 },
    { x: -21, y: 2, z: 0, w: 1, h: 4, d: 32 }, { x: 21, y: 2, z: 0, w: 1, h: 4, d: 32 },
    { x: 0, y: 2, z: 0, w: 1, h: 4, d: 12 }, { x: 12, y: 2, z: 0, w: 1, h: 4, d: 12 }
  ];
  walls.forEach((wall) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(wall.w, wall.h, wall.d), new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.7, metalness: 0.2 }));
    mesh.position.set(wall.x, wall.y, wall.z);
    scene.add(mesh);
  });
}
function buildDoors() {
  doorDefs.forEach((door) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.6, 0.6), new THREE.MeshStandardMaterial({ color: door.type === 'director' ? '#a78bfa' : door.type === 'keycard' ? '#fbbf24' : '#94a3b8', emissive: 0x111111, metalness: 0.4, roughness: 0.3 }));
    mesh.position.set(door.x, floorData[door.floor].y + 2, door.z);
    mesh.userData = { ...door };
    scene.add(mesh);
  });
}
function buildStairs() {
  stairs.forEach((stair) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 3), new THREE.MeshStandardMaterial({ color: 0x1e293b, emissive: 0x111827, emissiveIntensity: 0.4 }));
    mesh.position.set(stair.x, floorData[stair.floor].y + 1.5, stair.z);
    mesh.userData = { ...stair, type: 'stairs' };
    scene.add(mesh);
  });
}
function buildExit() {
  const exitDoor = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 1), new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x14532d, emissiveIntensity: 0.4 }));
  exitDoor.position.set(0, 2, 16);
  scene.add(exitDoor);
}
function setupWorld() { floorData.forEach((floor) => buildFloor(floor.level)); buildWalls(); buildDoors(); buildStairs(); buildExit(); }

function createPlayerMesh(player) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 1.8, 14), new THREE.MeshStandardMaterial({ color: player.color || '#ffffff', emissive: 0x111111 }));
  body.position.y = 1.1;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), new THREE.MeshStandardMaterial({ color: '#f8fafc' }));
  head.position.y = 2.5;
  group.add(head);
  group.position.set(player.x, floorData[player.floor]?.y || 0, player.z);
  group.userData.playerId = player.id;
  return group;
}
function addRemotePlayer(player) {
  if (worldPlayers.has(player.id)) return worldPlayers.get(player.id);
  const mesh = createPlayerMesh(player);
  worldPlayers.set(player.id, mesh);
  scene.add(mesh);
  return mesh;
}
function removeRemotePlayer(id) {
  const mesh = worldPlayers.get(id);
  if (!mesh) return;
  scene.remove(mesh);
  worldPlayers.delete(id);
}
function updateInventoryUI() {
  ui.inventoryList.replaceChildren();
  (localPlayer.inventory.length ? localPlayer.inventory : ['Empty']).forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    ui.inventoryList.appendChild(li);
  });
}
function updateRoleUI() {
  ui.roleLabel.textContent = `Role: ${localPlayer.role || 'None'}`;
  ui.floorLabel.textContent = `Floor: ${floorNames[localPlayer.floor] || 'U3'}`;
  updateInventoryUI();
  if (ui.abilityButton && localPlayer.role) ui.abilityButton.textContent = localPlayer.role === 'medic' ? 'Heal' : localPlayer.role === 'orderly' ? 'Stun' : localPlayer.role === 'director' ? 'Tablet' : 'Use item';
}
function setRole(role) {
  if (!roleInfo[role]) return;
  localPlayer.role = role;
  localPlayer.color = roleInfo[role].color;
  localPlayer.inventory = [...roleInfo[role].inventory];
  const spawn = roleSpawns[role];
  localPlayer.x = spawn.x; localPlayer.z = spawn.z; localPlayer.floor = spawn.floor;
  localPlayer.name = ui.playerName.value.trim() || 'Player';
  updateRoleUI();
  socket.emit('joinGame', { name: localPlayer.name, role });
  ui.joinScreen.classList.add('hidden');
}
function publishPlayer(force = false) {
  const now = performance.now();
  if (!force && now - lastNetworkUpdate < 80) return;
  lastNetworkUpdate = now;
  socket.emit('updatePlayer', { x: localPlayer.x, y: floorData[localPlayer.floor].y + 1.2, z: localPlayer.z, floor: localPlayer.floor, role: localPlayer.role, name: localPlayer.name, stunned: localPlayer.stunned, health: localPlayer.health });
}
function handleMovement(delta) {
  if (!localPlayer.role || localPlayer.stunned) return;
  let dx = touchInput.x;
  let dz = touchInput.z;
  if (keys.KeyW || keys.ArrowUp) dz -= 1;
  if (keys.KeyS || keys.ArrowDown) dz += 1;
  if (keys.KeyA || keys.ArrowLeft) dx -= 1;
  if (keys.KeyD || keys.ArrowRight) dx += 1;
  const length = Math.hypot(dx, dz);
  if (!length) return;
  dx /= Math.max(1, length); dz /= Math.max(1, length);
  const sprinting = keys.ShiftLeft || keys.ShiftRight || touchInput.sprint;
  const speed = sprinting ? 8 : 5.5;
  localPlayer.x = THREE.MathUtils.clamp(localPlayer.x + dx * speed * delta, -18, 18);
  localPlayer.z = THREE.MathUtils.clamp(localPlayer.z + dz * speed * delta, -15, 15);
  publishPlayer();
}
function tryUseStairs() {
  if (!localPlayer.role) return;
  const stair = stairs.find((item) => Math.hypot(localPlayer.x - item.x, localPlayer.z - item.z) < 3 && localPlayer.floor === item.floor);
  if (!stair) { ui.statusLabel.textContent = 'Move closer to the stairs'; return; }
  localPlayer.floor = stair.targetFloor;
  ui.statusLabel.textContent = `Moving to ${floorNames[localPlayer.floor]}`;
  updateRoleUI();
  publishPlayer(true);
}
function tryUseAbility() {
  if (!localPlayer.role) return;
  if (localPlayer.role === 'director') ui.statusLabel.textContent = 'Director tablet ability';
  else if (localPlayer.role === 'medic') { localPlayer.health = Math.min(100, localPlayer.health + 20); ui.statusLabel.textContent = 'Medic ability used'; }
  else if (localPlayer.role === 'orderly') ui.statusLabel.textContent = 'Orderly ability used';
  else ui.statusLabel.textContent = 'Patient item used';
  socket.emit('useAbility', { ability: roleInfo[localPlayer.role].ability });
  publishPlayer(true);
}

function setupTouchControls() {
  const pad = document.getElementById('movePad');
  const stick = document.getElementById('moveStick');
  if (!pad || !stick) return;
  let pointerId = null;
  const reset = () => { pointerId = null; touchInput.x = 0; touchInput.z = 0; stick.style.transform = 'translate(-50%, -50%)'; };
  pad.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    pointerId = event.pointerId;
    pad.setPointerCapture(pointerId);
    updateStick(event);
  });
  const updateStick = (event) => {
    if (pointerId !== event.pointerId) return;
    const rect = pad.getBoundingClientRect();
    const radius = rect.width * 0.32;
    const rawX = event.clientX - (rect.left + rect.width / 2);
    const rawY = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(rawX, rawY) || 1;
    const scale = Math.min(1, radius / distance);
    const x = rawX * scale; const y = rawY * scale;
    touchInput.x = x / radius;
    touchInput.z = y / radius;
    stick.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  };
  pad.addEventListener('pointermove', updateStick);
  pad.addEventListener('pointerup', (event) => { if (pointerId === event.pointerId) reset(); });
  pad.addEventListener('pointercancel', reset);
  const sprintButton = ui.sprintButton;
  sprintButton.addEventListener('pointerdown', (event) => { event.preventDefault(); touchInput.sprint = !touchInput.sprint; sprintButton.classList.toggle('active', touchInput.sprint); });
  document.getElementById('interactButton').addEventListener('click', tryUseStairs);
  ui.abilityButton.addEventListener('click', tryUseAbility);
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      return;
    }
    const root = document.documentElement;
    if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
    else {
      ui.statusLabel.textContent = 'iPhone Safari: Teilen → Zum Home-Bildschirm';
    }
  } catch (_error) {
    ui.statusLabel.textContent = 'Vollbild nicht verfügbar – Safari: Teilen → Zum Home-Bildschirm';
  }
}
function setupInput() {
  document.addEventListener('keydown', (event) => {
    keys[event.code] = true;
    if (event.code === 'KeyE') tryUseStairs();
    if (event.code === 'KeyQ') tryUseAbility();
  });
  document.addEventListener('keyup', (event) => { keys[event.code] = false; });
  document.querySelectorAll('.roleButton').forEach((button) => button.addEventListener('click', () => setRole(button.dataset.role)));
  if (isTouchDevice) {
    ui.fullscreenButton.hidden = false;
    ui.fullscreenButton.addEventListener('click', toggleFullscreen);
  }
}
function setupLocalMarker() {
  const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 1.5, 18), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: 0x1e293b }));
  marker.position.set(0, 0.6, 0);
  scene.add(marker);
  localPlayer.mesh = marker;
}
function updateCamera() {
  const targetY = floorData[localPlayer.floor].y + 9;
  camera.position.lerp(new THREE.Vector3(localPlayer.x, targetY, localPlayer.z + 16), 0.08);
  camera.lookAt(localPlayer.x, floorData[localPlayer.floor].y + 1.2, localPlayer.z);
}
let previousFrame = performance.now();
function tick(now) {
  const delta = Math.min((now - previousFrame) / 1000, 0.05);
  previousFrame = now;
  handleMovement(delta);
  updateCamera();
  if (localPlayer.mesh) localPlayer.mesh.position.set(localPlayer.x, floorData[localPlayer.floor].y + 0.7, localPlayer.z);
  worldPlayers.forEach((mesh, id) => {
    if (id === socket.id) return;
    const remote = remotePlayers.get(id);
    if (!remote) return;
    const floorY = floorData[remote.floor]?.y || 0;
    mesh.position.lerp(new THREE.Vector3(remote.x, floorY, remote.z), 0.22);
  });
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

socket.on('assignedPlayer', (player) => {
  localPlayer.id = player.id; localPlayer.name = player.name; localPlayer.role = player.role;
  localPlayer.color = roleInfo[player.role].color; localPlayer.inventory = [...roleInfo[player.role].inventory];
  localPlayer.floor = player.floor; localPlayer.x = player.x; localPlayer.z = player.z;
  updateRoleUI();
});
socket.on('playersState', (players) => {
  const incoming = new Set(players.map((player) => player.id));
  players.forEach((player) => {
    if (player.id !== socket.id) {
      const mesh = addRemotePlayer(player);
      mesh.userData.color = player.color;
      remotePlayers.set(player.id, player);
    }
  });
  for (const id of worldPlayers.keys()) if (!incoming.has(id)) removeRemotePlayer(id);
  if (players.length === 1 && localPlayer.role) ui.statusLabel.textContent = 'You are alone in the facility';
});
socket.on('abilityFeedback', (feedback) => { if (feedback?.message) ui.statusLabel.textContent = feedback.message; });

setupWorld();
setupLocalMarker();
setupInput();
setupTouchControls();
updateRoleUI();
requestAnimationFrame(tick);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
document.addEventListener('fullscreenchange', () => { ui.fullscreenButton.textContent = document.fullscreenElement ? '⛶ Exit fullscreen' : '⛶ Fullscreen'; });
