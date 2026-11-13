import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';

const socket = io();
const isTouchDevice = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
if (isTouchDevice) document.documentElement.classList.add('touch-device');

const roleInfo = {
  patient: { color: '#ef4444', inventory: ['glassShard'] },
  medic: { color: '#34d399', inventory: ['smallMedKit', 'mediumMedKit'] },
  orderly: { color: '#fbbf24', inventory: ['riotShield', 'taser', 'stunBaton', 'arrestCuffs'] },
  director: { color: '#a78bfa', inventory: ['tablet', 'stunBaton'] }
};
// Floor indexes: Ground=0, U1=1, U2=2, U3=3.
const roleSpawns = {
  patient: { x: -18, z: 7, floor: 3 },
  medic: { x: -25, z: -5, floor: 2 },
  orderly: { x: 25, z: -5, floor: 2 },
  director: { x: 23, z: 8, floor: 1 }
};
const floorNames = { 0: 'Ground', 1: 'U1', 2: 'U2', 3: 'U3' };
const floors = [
  { level: 0, y: 0, name: 'GROUND FLOOR · EXIT', accent: '#38bdf8' },
  { level: 1, y: 8, name: 'U1 · DIRECTOR OFFICE / LABS', accent: '#a78bfa' },
  { level: 2, y: 16, name: 'U2 · MEDICAL BAY / GUARD ZONE', accent: '#34d399' },
  { level: 3, y: 24, name: 'U3 · PATIENT AREA / CAFETERIA', accent: '#fb7185' }
];
const FLOOR_W = 88;
const FLOOR_D = 60;
const HALF_W = FLOOR_W / 2;
const HALF_D = FLOOR_D / 2;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101827);
scene.fog = new THREE.Fog(0x101827, 85, 180);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 250);
const renderer = new THREE.WebGLRenderer({ antialias: !isTouchDevice, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isTouchDevice ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xe4f0ff, 0x45505d, 1.75));
const sun = new THREE.DirectionalLight(0xfff1d8, 2.3);
sun.position.set(-25, 55, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouchDevice ? 1024 : 2048, isTouchDevice ? 1024 : 2048);
sun.shadow.camera.left = -65; sun.shadow.camera.right = 65;
sun.shadow.camera.top = 65; sun.shadow.camera.bottom = -65;
sun.shadow.bias = -0.00025;
scene.add(sun);

const localPlayer = { id: null, name: 'Player', role: null, x: 0, y: 0, z: 0, floor: 0, color: '#fff', inventory: [], health: 100, stunned: false, mesh: null };
const remotePlayers = new Map();
const playerMeshes = new Map();
const floorGroups = new Map();
const floorWalls = new Map();
const keys = {};
const touchInput = { x: 0, z: 0, sprint: false };
let lastNetworkUpdate = 0;
let lastFrame = performance.now();
let cameraYaw = 0;
let cameraPitch = 0.38;
let cameraDistance = 13;
let draggingCamera = false;
let previousPointer = null;
const raycaster = new THREE.Raycaster();

const ui = {
  roleLabel: document.getElementById('roleLabel'), floorLabel: document.getElementById('floorLabel'),
  statusLabel: document.getElementById('statusLabel'), joinScreen: document.getElementById('joinScreen'),
  playerName: document.getElementById('playerName'), inventoryList: document.getElementById('inventoryList'),
  abilityButton: document.getElementById('abilityButton'), sprintButton: document.getElementById('sprintButton'),
  fullscreenButton: document.getElementById('fullscreenButton')
};

function canvasTexture(draw, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d'); draw(ctx, 512, 512);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  return texture;
}
const tileTexture = canvasTexture((ctx, size) => {
  ctx.fillStyle = '#cbd5df'; ctx.fillRect(0, 0, size, size);
  const tile = 64;
  for (let y = 0; y < size; y += tile) for (let x = 0; x < size; x += tile) {
    const shade = 187 + Math.floor(Math.random() * 20);
    ctx.fillStyle = `rgb(${shade},${shade + 5},${shade + 9})`;
    ctx.fillRect(x + 2, y + 2, tile - 4, tile - 4);
    ctx.strokeStyle = 'rgba(55,65,81,.25)'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, tile - 2, tile - 2);
    ctx.fillStyle = 'rgba(255,255,255,.17)'; ctx.fillRect(x + 4, y + 4, tile - 8, 3);
  }
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = `rgba(51,65,85,${Math.random() * 0.08})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
}, 9, 7);
const plasterTexture = canvasTexture((ctx, size) => {
  const g = ctx.createLinearGradient(0, 0, size, size); g.addColorStop(0, '#e8e5dc'); g.addColorStop(1, '#b7c1c8');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 3200; i++) {
    const a = Math.random() * 0.09; ctx.fillStyle = `rgba(51,65,85,${a})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2 + Math.random() * 8, 1 + Math.random() * 3);
  }
  for (let y = 0; y < size; y += 128) { ctx.fillStyle = 'rgba(71,85,105,.18)'; ctx.fillRect(0, y, size, 3); }
}, 2, 1);
const ceilingTexture = canvasTexture((ctx, size) => {
  ctx.fillStyle = '#d7dce0'; ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 128) for (let x = 0; x < size; x += 128) {
    ctx.fillStyle = '#e8ecef'; ctx.fillRect(x + 3, y + 3, 122, 122);
    ctx.strokeStyle = '#aeb8c2'; ctx.lineWidth = 3; ctx.strokeRect(x + 1, y + 1, 126, 126);
  }
}, 6, 4);
const tileMat = new THREE.MeshStandardMaterial({ map: tileTexture, roughness: 0.82 });
const wallMat = new THREE.MeshStandardMaterial({ map: plasterTexture, roughness: 0.9 });
const ceilingMat = new THREE.MeshStandardMaterial({ map: ceilingTexture, roughness: 0.9, side: THREE.DoubleSide });

function addMesh(group, mesh, shadows = true) {
  if (shadows) { mesh.castShadow = true; mesh.receiveShadow = true; }
  group.add(mesh); return mesh;
}
function box(group, x, y, z, w, h, d, material, shadows = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z); return addMesh(group, mesh, shadows);
}
function makeSign(text, accent) {
  const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111c2c'; ctx.fillRect(0, 0, 768, 160);
  ctx.fillStyle = accent; ctx.fillRect(0, 0, 18, 160);
  ctx.font = 'bold 36px Arial'; ctx.fillStyle = '#f8fafc'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 400, 82);
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(12, 2.5), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
}
function createFloor(level) {
  const data = floors[level];
  const group = new THREE.Group(); group.name = `floor-${level}`; floorGroups.set(level, group); scene.add(group);
  floorWalls.set(level, []);
  const baseY = data.y;
  const floor = new THREE.Mesh(new THREE.BoxGeometry(FLOOR_W, 0.6, FLOOR_D), tileMat);
  floor.position.set(0, baseY, 0); addMesh(group, floor);
  // Opaque ceiling slab hides the level above; only the active story is rendered to prevent looking through floors.
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(FLOOR_W, 0.45, FLOOR_D), ceilingMat);
  ceiling.position.set(0, baseY + 6.4, 0); addMesh(group, ceiling, false);
  const wallY = baseY + 3.05;
  const wall = (x, z, w, d, h = 6.1) => {
    const mesh = box(group, x, baseY + h / 2, z, w, h, d, wallMat);
    floorWalls.get(level).push(mesh);
    return mesh;
  };
  // Perimeter walls are deliberately solid and tall enough to keep the camera inside.
  wall(0, -HALF_D, FLOOR_W, 0.75); wall(0, HALF_D, FLOOR_W, 0.75);
  wall(-HALF_W, 0, 0.75, FLOOR_D); wall(HALF_W, 0, 0.75, FLOOR_D);
  const accent = new THREE.MeshStandardMaterial({ color: data.accent, roughness: 0.55, metalness: 0.12 });
  // Colored lower wall trims and ceiling lights improve readability across floors.
  for (const z of [-HALF_D + 1, HALF_D - 1]) box(group, 0, baseY + 0.38, z, FLOOR_W - 2, 0.22, 0.12, accent, false);
  for (const x of [-HALF_W + 1, HALF_W - 1]) box(group, x, baseY + 0.38, 0, 0.12, 0.22, FLOOR_D - 2, accent, false);
  for (const [lx, lz] of [[-25,-18],[-5,-18],[15,-18],[33,-18],[-25,12],[-5,12],[15,12],[33,12]]) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.12, 1.1), new THREE.MeshStandardMaterial({ color: 0xfff7da, emissive: 0xffe6a3, emissiveIntensity: 1.1 }));
    light.position.set(lx, baseY + 6.05, lz); addMesh(group, light, false);
  }
  const sign = makeSign(data.name, data.accent); sign.position.set(0, baseY + 4.9, -HALF_D + 0.55); group.add(sign);

  // Two stairwells at the ends of the building connect every adjacent story.
  addStairwell(group, level, -36, 0, data.y);
  addStairwell(group, level, 36, 0, data.y);
  addRoomFurniture(group, level, data.y);
}
function addStairwell(group, level, x, z, y) {
  const platformMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.75 });
  const markerMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x075985, emissiveIntensity: 0.55, transparent: true, opacity: 0.82 });
  // A prominent landing marks the matching stairwell on every story; E changes to the adjacent floor.
  box(group, x, y + 0.38, z, 7.2, 0.12, 7.2, markerMat, false);
  for (let i = 0; i < 7; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.28, 0.72), platformMat);
    step.position.set(x, y + 0.62 + i * 0.23, z - 2.2 + i * 0.6); addMesh(group, step);
  }
  const label = makeSign(level < 3 ? `STAIRS UP · ${floorNames[level + 1]}` : 'STAIRS DOWN · U2', '#38bdf8');
  label.scale.set(0.42, 0.42, 1); label.position.set(x, y + 3.3, z - 3.3); group.add(label);
}
function addPartition(group, y, x, z, width, depth, gap = 0) {
  const h = 5.3;
  if (!gap) { box(group, x, y + h / 2, z, width, h, depth, wallMat); return; }
  // Leave a walk-through opening while keeping a short wall segment on both sides.
  if (width > depth) {
    const segment = (width - gap) / 2;
    box(group, x - gap / 2 - segment / 2, y + h / 2, z, segment, h, depth, wallMat);
    box(group, x + gap / 2 + segment / 2, y + h / 2, z, segment, h, depth, wallMat);
  } else {
    const segment = (depth - gap) / 2;
    box(group, x, y + h / 2, z - gap / 2 - segment / 2, width, h, segment, wallMat);
    box(group, x, y + h / 2, z + gap / 2 + segment / 2, width, h, segment, wallMat);
  }
}
function addRoomFurniture(group, level, y) {
  const accent = floors[level].accent;
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.7 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x806248, roughness: 0.8 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.56, metalness: 0.35 });
  const mattress = new THREE.MeshStandardMaterial({ color: level === 3 ? 0x8da1b3 : 0x94a3b8, roughness: 0.92 });
  if (level === 3) {
    // One large, connected patient common area and cafeteria, with sleeping rooms grouped along the north side.
    addPartition(group, y, 0, -19, 51, 0.55, 5);
    for (const x of [-34, -22, -10, 2, 14]) {
      box(group, x, y + 1.05, -25, 5.8, 0.35, 2.6, wood);
      box(group, x, y + 0.78, -25, 5.3, 0.3, 2.2, mattress);
      box(group, x, y + 1.6, -26.6, 5.8, 1.2, 0.25, accentMat);
    }
    // Dining hall: long shared tables and benches; it remains open to the patient lounge.
    for (const x of [-22, -8, 6, 20]) {
      box(group, x, y + 1.05, 2, 8.5, 0.28, 2.8, wood);
      box(group, x, y + 0.62, 2, 8.9, 0.22, 0.65, metal);
      box(group, x, y + 0.62, 4.1, 8.9, 0.22, 0.65, metal);
      for (const dx of [-3.6, 3.6]) box(group, x + dx, y + 0.62, -0.3, 0.26, 0.9, 0.26, metal);
    }
    // Serving counter and kitchen pass-through at the east end.
    box(group, 34, y + 1.1, 4, 1.4, 1.8, 15, metal);
    box(group, 33.15, y + 2.05, 4, 0.16, 0.12, 13, accentMat, false);
    for (const x of [-32, -20, -8, 4]) box(group, x, y + 0.55, 12, 6, 0.18, 1, accentMat, false);
    const sign = makeSign('CAFETERIA · PATIENT COMMON AREA', '#fb7185'); sign.scale.set(0.6, 0.6, 1); sign.position.set(23, y + 3.6, 15); group.add(sign);
  } else if (level === 2) {
    // Medical bay to the west; orderly/guard zone to the east; central corridor connects them.
    addPartition(group, y, -20, -3, 0.55, 34, 5);
    addPartition(group, y, 20, -3, 0.55, 34, 5);
    addPartition(group, y, -8, -20, 23, 0.55, 4);
    addPartition(group, y, 8, -20, 23, 0.55, 4);
    for (const x of [-31, -21, -11]) {
      box(group, x, y + 0.58, -7, 5.4, 0.18, 2.2, metal);
      box(group, x, y + 0.9, -7, 4.6, 0.38, 1.7, mattress);
      box(group, x, y + 1.5, -8.7, 4.8, 1.2, 0.18, accentMat);
    }
    for (const x of [25, 34]) {
      box(group, x, y + 1.1, -6, 4.5, 2.1, 3.2, metal);
      box(group, x, y + 2.2, -6, 4.8, 0.18, 3.5, accentMat, false);
    }
    const sign = makeSign('MEDICAL BAY  ←     →  ORDERLY / GUARD ZONE', '#34d399'); sign.scale.set(0.58,0.58,1); sign.position.set(0, y + 3.7, -13); group.add(sign);
  } else if (level === 1) {
    addPartition(group, y, 0, -10, 0.55, 35, 5);
    addPartition(group, y, -23, -10, 0.55, 35, 4);
    addPartition(group, y, 23, -10, 0.55, 35, 4);
    for (const x of [-34, -27, -19]) {
      box(group, x, y + 1.1, -19, 4.2, 2.1, 2.6, metal);
      box(group, x, y + 2.2, -19, 4.4, 0.18, 2.8, accentMat, false);
      box(group, x, y + 0.55, -12, 2.4, 0.18, 1.4, wood);
    }
    box(group, 32, y + 0.7, -17, 8, 1.2, 2.4, wood);
    box(group, 32, y + 1.35, -17, 8.3, 0.14, 2.6, accentMat, false);
    for (const z of [-4, 4, 12]) box(group, 31, y + 0.85, z, 5, 1.7, 3.2, metal);
    const sign = makeSign('FACILITY DIRECTOR · LABORATORIES', '#a78bfa'); sign.scale.set(0.58,0.58,1); sign.position.set(0, y + 3.7, -2); group.add(sign);
  } else {
    // Large reception / waiting area with a clear route to the main exit.
    addPartition(group, y, 0, -18, 48, 0.55, 8);
    box(group, 0, y + 1.1, 22, 18, 2.1, 2.5, wood);
    box(group, 0, y + 2.2, 22, 18.2, 0.18, 2.7, accentMat, false);
    for (const x of [-31, -21, 21, 31]) {
      box(group, x, y + 0.7, 4, 5.5, 0.25, 2, metal);
      box(group, x, y + 1.5, 4, 5.5, 1.2, 0.18, accentMat);
    }
    const sign = makeSign('MAIN EXIT · RECEPTION', '#38bdf8'); sign.scale.set(0.55,0.55,1); sign.position.set(0, y + 3.8, 27); group.add(sign);
  }
}
function buildWorld() {
  floors.forEach((f) => createFloor(f.level));
  setActiveFloor(localPlayer.floor);
}
function setActiveFloor(level) {
  for (const [floor, group] of floorGroups) group.visible = floor === level;
  for (const [id, mesh] of playerMeshes) {
    const state = id === socket.id ? localPlayer : remotePlayers.get(id);
    if (state) mesh.visible = state.floor === level;
  }
}

function createPlayerMesh(player) {
  const group = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: player.color || roleInfo[player.role]?.color || '#ffffff', roughness: 0.76 });
  const pants = new THREE.MeshStandardMaterial({ color: player.role === 'patient' ? 0x3f5065 : 0x202c3c, roughness: 0.86 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe9bd9a, roughness: 0.9 });
  const shoes = new THREE.MeshStandardMaterial({ color: 0x17202b, roughness: 0.9 });
  const addPart = (w,h,d,x,y,z,mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat); m.position.set(x,y,z); m.castShadow = true; m.receiveShadow = true; group.add(m); return m; };
  addPart(0.47, 0.82, 0.48, -0.25, 0.49, 0, pants);
  addPart(0.47, 0.82, 0.48, 0.25, 0.49, 0, pants);
  addPart(0.5, 0.16, 0.58, -0.25, 0.08, -0.04, shoes);
  addPart(0.5, 0.16, 0.58, 0.25, 0.08, -0.04, shoes);
  addPart(0.98, 0.88, 0.55, 0, 1.38, 0, shirt);
  addPart(0.3, 0.84, 0.35, -0.66, 1.4, 0, shirt);
  addPart(0.3, 0.84, 0.35, 0.66, 1.4, 0, shirt);
  addPart(0.62, 0.62, 0.62, 0, 2.18, 0, skin);
  const face = new THREE.MeshBasicMaterial({ color: 0x17202b });
  addPart(0.07, 0.09, 0.03, -0.14, 2.22, -0.32, face);
  addPart(0.07, 0.09, 0.03, 0.14, 2.22, -0.32, face);
  addPart(0.14, 0.035, 0.03, 0, 2.04, -0.32, face);
  addPart(0.2, 0.2, 0.08, -0.27, 1.62, -0.31, new THREE.MeshStandardMaterial({ color: 0xf8fafc }));
  group.position.set(player.x, floors[player.floor]?.y || 0, player.z);
  group.userData.playerId = player.id;
  group.userData.role = player.role;
  return group;
}
function addPlayer(player, local = false) {
  const old = playerMeshes.get(player.id);
  if (old) { scene.remove(old); playerMeshes.delete(player.id); }
  const mesh = createPlayerMesh(player); mesh.visible = player.floor === localPlayer.floor;
  playerMeshes.set(player.id, mesh); scene.add(mesh);
  if (local) localPlayer.mesh = mesh;
}
function updateInventory() {
  ui.inventoryList.replaceChildren();
  (localPlayer.inventory.length ? localPlayer.inventory : ['Empty']).forEach((item) => { const li = document.createElement('li'); li.textContent = item; ui.inventoryList.appendChild(li); });
}
function updateHUD() {
  ui.roleLabel.textContent = `Role: ${localPlayer.role || 'None'}`;
  ui.floorLabel.textContent = `Floor: ${floorNames[localPlayer.floor] || 'Ground'}`;
  updateInventory();
  if (ui.abilityButton && localPlayer.role) ui.abilityButton.textContent = ({ medic: 'Heal', orderly: 'Stun', director: 'Tablet', patient: 'Use item' })[localPlayer.role];
}
function setRole(role) {
  if (!roleInfo[role]) return;
  localPlayer.role = role; localPlayer.color = roleInfo[role].color; localPlayer.inventory = [...roleInfo[role].inventory];
  Object.assign(localPlayer, roleSpawns[role]);
  localPlayer.name = ui.playerName.value.trim() || 'Player';
  updateHUD(); addPlayer({ ...localPlayer, id: socket.id }, true); setActiveFloor(localPlayer.floor);
  socket.emit('joinGame', { name: localPlayer.name, role });
  ui.joinScreen.classList.add('hidden');
}
function publishPlayer(force = false) {
  const now = performance.now();
  if (!force && now - lastNetworkUpdate < 75) return;
  lastNetworkUpdate = now;
  socket.emit('updatePlayer', { x: localPlayer.x, y: floors[localPlayer.floor].y + 1, z: localPlayer.z, floor: localPlayer.floor, role: localPlayer.role, name: localPlayer.name, stunned: localPlayer.stunned, health: localPlayer.health });
}
function movePlayer(delta) {
  if (!localPlayer.role || localPlayer.stunned) return;
  let inputX = touchInput.x; let inputForward = -touchInput.z;
  if (keys.KeyW || keys.ArrowUp) inputForward += 1;
  if (keys.KeyS || keys.ArrowDown) inputForward -= 1;
  if (keys.KeyA || keys.ArrowLeft) inputX -= 1;
  if (keys.KeyD || keys.ArrowRight) inputX += 1;
  const magnitude = Math.hypot(inputX, inputForward);
  if (magnitude < 0.05) return;
  inputX /= Math.max(1, magnitude); inputForward /= Math.max(1, magnitude);
  // Movement axes follow the current camera yaw rather than fixed world compass directions.
  const rightX = Math.cos(cameraYaw); const rightZ = -Math.sin(cameraYaw);
  const forwardX = -Math.sin(cameraYaw); const forwardZ = -Math.cos(cameraYaw);
  const dx = rightX * inputX + forwardX * inputForward;
  const dz = rightZ * inputX + forwardZ * inputForward;
  const speed = keys.ShiftLeft || keys.ShiftRight || touchInput.sprint ? 8.5 : 5.6;
  const oldX = localPlayer.x; const oldZ = localPlayer.z;
  localPlayer.x = THREE.MathUtils.clamp(localPlayer.x + dx * speed * delta, -HALF_W + 1.3, HALF_W - 1.3);
  localPlayer.z = THREE.MathUtils.clamp(localPlayer.z + dz * speed * delta, -HALF_D + 1.3, HALF_D - 1.3);
  // Stop the avatar at solid walls while still allowing movement through the deliberate room openings.
  const playerBox = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(localPlayer.x, floors[localPlayer.floor].y + 1, localPlayer.z), new THREE.Vector3(0.9, 1.9, 0.9));
  const blocked = floorWalls.get(localPlayer.floor).some((wall) => playerBox.intersectsBox(new THREE.Box3().setFromObject(wall)));
  if (blocked) { localPlayer.x = oldX; localPlayer.z = oldZ; }
  if (localPlayer.mesh) localPlayer.mesh.rotation.y = Math.atan2(dx, dz) + Math.PI;
  publishPlayer();
}
const stairPoints = [{ x: -36, z: 0 }, { x: 36, z: 0 }];
function useStairs() {
  if (!localPlayer.role) return;
  const near = stairPoints.some((p) => Math.hypot(localPlayer.x - p.x, localPlayer.z - p.z) < 5);
  if (!near) { ui.statusLabel.textContent = 'Gehe zu einem der Treppenhäuser'; return; }
  // E uses the connected stairwell: ascend from U3, descend elsewhere; U1 can go either way.
  if (localPlayer.floor === 3) localPlayer.floor = 2;
  else if (localPlayer.floor === 0) localPlayer.floor = 1;
  else localPlayer.floor += keys.AltLeft || keys.AltRight ? 1 : -1;
  localPlayer.floor = THREE.MathUtils.clamp(localPlayer.floor, 0, 3);
  ui.statusLabel.textContent = `Etage: ${floorNames[localPlayer.floor]}`;
  setActiveFloor(localPlayer.floor); updateHUD(); publishPlayer(true);
}
function useAbility() {
  if (!localPlayer.role) return;
  if (localPlayer.role === 'medic') { localPlayer.health = Math.min(100, localPlayer.health + 20); ui.statusLabel.textContent = 'Medic: Heilung benutzt'; }
  else if (localPlayer.role === 'director') ui.statusLabel.textContent = 'Director: Tablet benutzt';
  else if (localPlayer.role === 'orderly') ui.statusLabel.textContent = 'Orderly: Ausrüstung benutzt';
  else ui.statusLabel.textContent = 'Patient: Glass Shard benutzt';
  socket.emit('useAbility', { ability: localPlayer.role }); publishPlayer(true);
}
function setupTouch() {
  const pad = document.getElementById('movePad'); const stick = document.getElementById('moveStick');
  let pointerId = null;
  const reset = () => { pointerId = null; touchInput.x = touchInput.z = 0; stick.style.transform = 'translate(-50%, -50%)'; };
  const update = (event) => {
    if (pointerId !== event.pointerId) return;
    const r = pad.getBoundingClientRect(); const radius = r.width * 0.32;
    const rawX = event.clientX - r.left - r.width / 2; const rawY = event.clientY - r.top - r.height / 2;
    const length = Math.hypot(rawX, rawY) || 1; const k = Math.min(1, radius / length);
    const x = rawX * k; const y = rawY * k; touchInput.x = x / radius; touchInput.z = y / radius;
    stick.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  };
  pad.addEventListener('pointerdown', (e) => { e.preventDefault(); pointerId = e.pointerId; pad.setPointerCapture(pointerId); update(e); });
  pad.addEventListener('pointermove', update); pad.addEventListener('pointerup', (e) => { if (pointerId === e.pointerId) reset(); }); pad.addEventListener('pointercancel', reset);
  ui.sprintButton.addEventListener('pointerdown', (e) => { e.preventDefault(); touchInput.sprint = !touchInput.sprint; ui.sprintButton.classList.toggle('active', touchInput.sprint); });
  document.getElementById('interactButton').addEventListener('click', useStairs); ui.abilityButton.addEventListener('click', useAbility);
}
function setupCameraInput() {
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', (e) => { if (e.button !== undefined && e.button !== 0) return; draggingCamera = true; previousPointer = { x: e.clientX, y: e.clientY, id: e.pointerId }; try { canvas.setPointerCapture(e.pointerId); } catch (_) {} });
  canvas.addEventListener('pointermove', (e) => {
    if (!draggingCamera || !previousPointer || previousPointer.id !== e.pointerId) return;
    cameraYaw -= (e.clientX - previousPointer.x) * 0.006;
    cameraPitch = THREE.MathUtils.clamp(cameraPitch + (e.clientY - previousPointer.y) * 0.004, 0.12, 0.86);
    previousPointer = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  const end = () => { draggingCamera = false; previousPointer = null; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end); canvas.addEventListener('lostpointercapture', end);
  canvas.addEventListener('wheel', (e) => { cameraDistance = THREE.MathUtils.clamp(cameraDistance + e.deltaY * 0.01, 7, 20); }, { passive: true });
}
function updateCamera() {
  const focus = new THREE.Vector3(localPlayer.x, floors[localPlayer.floor].y + 1.25, localPlayer.z);
  const horiz = Math.cos(cameraPitch) * cameraDistance;
  const desired = new THREE.Vector3(focus.x + Math.sin(cameraYaw) * horiz, focus.y + Math.sin(cameraPitch) * cameraDistance, focus.z + Math.cos(cameraYaw) * horiz);
  const walls = floorWalls.get(localPlayer.floor) || [];
  raycaster.set(focus, desired.clone().sub(focus).normalize()); raycaster.far = cameraDistance;
  const hit = raycaster.intersectObjects(walls, false)[0];
  if (hit) desired.copy(hit.point).addScaledVector(raycaster.ray.direction, -0.65);
  desired.x = THREE.MathUtils.clamp(desired.x, -HALF_W + 1, HALF_W - 1);
  desired.z = THREE.MathUtils.clamp(desired.z, -HALF_D + 1, HALF_D - 1);
  desired.y = Math.max(floors[localPlayer.floor].y + 2.4, desired.y);
  camera.position.lerp(desired, 0.22); camera.lookAt(focus);
}
function setupInput() {
  document.addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'KeyE') useStairs(); if (e.code === 'KeyQ') useAbility(); });
  document.addEventListener('keyup', (e) => { keys[e.code] = false; });
  document.querySelectorAll('.roleButton').forEach((b) => b.addEventListener('click', () => setRole(b.dataset.role)));
  if (isTouchDevice) { ui.fullscreenButton.hidden = false; ui.fullscreenButton.addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); else ui.statusLabel.textContent = 'Safari: Teilen → Zum Home-Bildschirm'; } catch (_) { ui.statusLabel.textContent = 'Vollbild ist in diesem Browser nicht verfügbar'; } }); }
}
function frame(now) {
  const delta = Math.min((now - lastFrame) / 1000, 0.05); lastFrame = now;
  movePlayer(delta); updateCamera();
  if (localPlayer.mesh) { localPlayer.mesh.position.set(localPlayer.x, floors[localPlayer.floor].y, localPlayer.z); localPlayer.mesh.visible = true; }
  for (const [id, mesh] of playerMeshes) {
    if (id === socket.id) continue;
    const state = remotePlayers.get(id); if (!state) continue;
    mesh.visible = state.floor === localPlayer.floor;
    if (mesh.visible) { const floorY = floors[state.floor].y; mesh.position.lerp(new THREE.Vector3(state.x, floorY, state.z), 0.25); mesh.rotation.y = state.rotation || mesh.rotation.y; }
  }
  renderer.render(scene, camera); requestAnimationFrame(frame);
}

socket.on('assignedPlayer', (p) => {
  localPlayer.id = p.id; localPlayer.name = p.name; localPlayer.role = p.role;
  localPlayer.color = roleInfo[p.role]?.color || '#fff'; localPlayer.inventory = [...(roleInfo[p.role]?.inventory || [])];
  localPlayer.floor = THREE.MathUtils.clamp(Number(p.floor) || 0, 0, 3); localPlayer.x = Number(p.x) || 0; localPlayer.z = Number(p.z) || 0;
  addPlayer({ ...localPlayer, id: p.id }, true); setActiveFloor(localPlayer.floor); updateHUD();
});
socket.on('playersState', (list) => {
  const live = new Set(list.map((p) => p.id));
  for (const p of list) if (p.id !== socket.id) {
    remotePlayers.set(p.id, p);
    const existing = playerMeshes.get(p.id);
    if (!existing || existing.userData.role !== p.role) addPlayer(p);
  }
  for (const id of playerMeshes.keys()) if (id !== socket.id && !live.has(id)) { scene.remove(playerMeshes.get(id)); playerMeshes.delete(id); remotePlayers.delete(id); }
  if (list.length === 1 && localPlayer.role) ui.statusLabel.textContent = 'Du bist allein im Gebäude';
});
socket.on('abilityFeedback', (feedback) => { if (feedback?.message) ui.statusLabel.textContent = feedback.message; });

buildWorld(); setupInput(); setupTouch(); setupCameraInput(); updateHUD(); requestAnimationFrame(frame);
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
document.addEventListener('fullscreenchange', () => { ui.fullscreenButton.textContent = document.fullscreenElement ? '⛶ Vollbild verlassen' : '⛶ Vollbild'; });
