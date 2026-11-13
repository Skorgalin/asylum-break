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
  { level: 0, y: 0, color: 0x7dd3fc, name: 'GROUND FLOOR' },
  { level: 1, y: 8, color: 0x4ade80, name: 'U1 · DIRECTOR / LABS' },
  { level: 2, y: 16, color: 0xfbbf24, name: 'U2 · MEDICAL / GUARD' },
  { level: 3, y: 24, color: 0xf87171, name: 'U3 · PATIENT AREA' }
];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1020);
scene.fog = new THREE.Fog(0x0b1020, 60, 115);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
const renderer = new THREE.WebGLRenderer({ antialias: !isTouchDevice, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouchDevice ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xdbeafe, 0x293449, 2.0));
const dirLight = new THREE.DirectionalLight(0xfff1d6, 2.2);
dirLight.position.set(-12, 45, 18);
scene.add(dirLight);

const localPlayer = { id: null, name: 'Player', role: null, x: 0, y: 0, z: 0, floor: 0, color: '#ffffff', inventory: [], health: 100, stunned: false, mesh: null };
const remotePlayers = new Map();
const worldPlayers = new Map();
const keys = {};
const touchInput = { x: 0, z: 0, sprint: false };
let lastNetworkUpdate = 0;
let previousFrame = performance.now();
let cameraYaw = 0;
let cameraPitch = 0.28;
let cameraDistance = 13;
let draggingCamera = false;
let previousPointer = null;
const wallMeshes = [];
const wallRaycaster = new THREE.Raycaster();
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

function makeCanvasTexture(draw, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  draw(context, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
  return texture;
}
const floorTexture = makeCanvasTexture((ctx, w, h) => {
  ctx.fillStyle = '#cbd5e1'; ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 32) {
    for (let x = 0; x < w; x += 32) {
      ctx.fillStyle = ((x / 32 + y / 32) % 2) ? '#b7c3d0' : '#d7dee7';
      ctx.fillRect(x + 1, y + 1, 30, 30);
      ctx.strokeStyle = 'rgba(51,65,85,.18)'; ctx.strokeRect(x + 1, y + 1, 30, 30);
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(0, 0, w, 5);
}, 10, 8);
const wallTexture = makeCanvasTexture((ctx, w, h) => {
  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, '#e2e8f0'); gradient.addColorStop(1, '#aebdca');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 64) {
    ctx.fillStyle = 'rgba(71,85,105,.12)'; ctx.fillRect(0, y, w, 3);
    for (let x = 12; x < w; x += 64) {
      ctx.fillStyle = 'rgba(255,255,255,.17)'; ctx.fillRect(x, y + 8, 3, 42);
    }
  }
}, 3, 1);
const floorMaterial = new THREE.MeshStandardMaterial({ map: floorTexture, color: 0xffffff, roughness: 0.86 });
const wallMaterial = new THREE.MeshStandardMaterial({ map: wallTexture, color: 0xffffff, roughness: 0.92 });

function addWall(x, y, z, width, height, depth, material = wallMaterial) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  wallMeshes.push(mesh);
  return mesh;
}
function buildFloor(level) {
  const data = floorData.find((floor) => floor.level === level);
  const plane = new THREE.Mesh(new THREE.BoxGeometry(46, 0.5, 34), floorMaterial);
  plane.position.set(0, data.y, 0);
  plane.receiveShadow = true;
  scene.add(plane);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(46.4, 0.35, 34.4), new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.8 }));
  edge.position.set(0, data.y - 0.38, 0);
  scene.add(edge);
  // Each floor has its own perimeter walls. Camera collision uses these walls too.
  const wallY = data.y + 2.25;
  addWall(0, wallY, -17, 42, 4.5, 0.8);
  addWall(0, wallY, 17, 42, 4.5, 0.8);
  addWall(-21, wallY, 0, 0.8, 4.5, 32.8);
  addWall(21, wallY, 0, 0.8, 4.5, 32.8);
  // Interior partitions add visible room structure without closing the central corridors.
  addWall(-5, wallY, -7, 0.45, 4.5, 8.5);
  addWall(8, wallY, 6, 0.45, 4.5, 9);
  addWall(0, wallY, -3, 10, 4.5, 0.45);
  // A floor stripe gives each level a distinct visual identity.
  const accent = new THREE.Mesh(new THREE.BoxGeometry(40, 0.035, 0.18), new THREE.MeshStandardMaterial({ color: data.color, emissive: data.color, emissiveIntensity: 0.12, roughness: 0.55 }));
  accent.position.set(0, data.y + 0.28, 12.5);
  scene.add(accent);
  const sign = makeFloorSign(data.name, data.color);
  sign.position.set(-15, data.y + 3.4, -15.8);
  scene.add(sign);
}
function makeFloorSign(text, color) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`; ctx.fillRect(0, 0, 14, 128);
  ctx.font = 'bold 30px Arial'; ctx.fillStyle = '#f8fafc'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 266, 66);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
  return sign;
}
function buildDoors() {
  doorDefs.forEach((door) => {
    const color = door.type === 'director' ? '#a78bfa' : door.type === 'keycard' ? '#fbbf24' : '#94a3b8';
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.45 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.6, 0.6), material);
    mesh.position.set(door.x, floorData[door.floor].y + 2, door.z);
    mesh.userData = { ...door };
    mesh.castShadow = true;
    scene.add(mesh);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.55, 0.12), new THREE.MeshStandardMaterial({ color: door.type === 'director' ? 0x8b5cf6 : 0x38bdf8, emissive: door.type === 'director' ? 0x4c1d95 : 0x075985, emissiveIntensity: 0.6 }));
    panel.position.set(door.x + 1.3, floorData[door.floor].y + 2.3, door.z);
    scene.add(panel);
  });
}
function buildStairs() {
  stairs.forEach((stair) => {
    const y = floorData[stair.floor].y + 0.8;
    for (let step = 0; step < 5; step++) {
      const tread = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.22, 0.58), new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.72 }));
      tread.position.set(stair.x, y + step * 0.28, stair.z + (step - 2) * 0.52);
      tread.castShadow = true; scene.add(tread);
    }
    const marker = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.08, 3.5), new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0369a1, emissiveIntensity: 0.35, transparent: true, opacity: 0.75 }));
    marker.position.set(stair.x, floorData[stair.floor].y + 0.38, stair.z);
    marker.userData = { ...stair, type: 'stairs' };
    scene.add(marker);
  });
}
function buildExit() {
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.55, roughness: 0.38 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(5, 4.5, 0.8), frameMaterial);
  frame.position.set(0, 2.25, 16.5); frame.castShadow = true; scene.add(frame);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.4, 0.25), new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x14532d, emissiveIntensity: 0.5, metalness: 0.3 }));
  panel.position.set(0, 2, 16); scene.add(panel);
  const label = makeFloorSign('EXIT', 0x22c55e);
  label.scale.set(0.45, 0.45, 1); label.position.set(0, 4.8, 15.9); scene.add(label);
}
function setupWorld() {
  floorData.forEach((floor) => buildFloor(floor.level));
  buildDoors(); buildStairs(); buildExit();
}

// A simple blocky, toy-like avatar inspired by classic Roblox proportions.
function createPlayerMesh(player, isLocal = false) {
  const group = new THREE.Group();
  const roleColor = new THREE.Color(player.color || roleInfo[player.role]?.color || '#ffffff');
  const shirtMat = new THREE.MeshStandardMaterial({ color: roleColor, roughness: 0.72 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: player.role === 'patient' ? 0x334155 : 0x1e293b, roughness: 0.82 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xf1c7a5, roughness: 0.88 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 });
  const part = (w, h, d, material, x, y, z, parent = group) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  // Feet/legs, torso, arms, square head, and tiny eyes make a recognizable humanoid silhouette.
  part(0.48, 0.9, 0.5, pantsMat, -0.27, 0.48, 0);
  part(0.48, 0.9, 0.5, pantsMat, 0.27, 0.48, 0);
  part(0.5, 0.16, 0.58, shoeMat, -0.27, 0.08, -0.04);
  part(0.5, 0.16, 0.58, shoeMat, 0.27, 0.08, -0.04);
  part(1.05, 0.95, 0.58, shirtMat, 0, 1.45, 0);
  part(0.32, 0.9, 0.38, shirtMat, -0.73, 1.48, 0);
  part(0.32, 0.9, 0.38, shirtMat, 0.73, 1.48, 0);
  part(0.62, 0.62, 0.62, skinMat, 0, 2.3, 0);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111827 });
  part(0.075, 0.09, 0.025, eyeMat, -0.14, 2.34, -0.32);
  part(0.075, 0.09, 0.025, eyeMat, 0.14, 2.34, -0.32);
  const mouth = part(0.14, 0.035, 0.025, eyeMat, 0, 2.15, -0.325);
  // Small shoulder badge makes team colors readable from a distance.
  part(0.22, 0.22, 0.08, new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 }), -0.3, 1.72, -0.34);
  group.position.set(player.x, floorData[player.floor]?.y || 0, player.z);
  group.userData.playerId = player.id;
  group.userData.isLocal = isLocal;
  group.userData.roleColor = roleColor;
  return group;
}
function addRemotePlayer(player) {
  let mesh = worldPlayers.get(player.id);
  if (mesh && mesh.userData.role !== player.role) {
    scene.remove(mesh); worldPlayers.delete(player.id); mesh = null;
  }
  if (!mesh) {
    mesh = createPlayerMesh(player);
    mesh.userData.role = player.role;
    worldPlayers.set(player.id, mesh); scene.add(mesh);
  }
  return mesh;
}
function removeRemotePlayer(id) {
  const mesh = worldPlayers.get(id);
  if (!mesh) return;
  scene.remove(mesh); worldPlayers.delete(id); remotePlayers.delete(id);
}
function updateInventoryUI() {
  ui.inventoryList.replaceChildren();
  (localPlayer.inventory.length ? localPlayer.inventory : ['Empty']).forEach((item) => {
    const li = document.createElement('li'); li.textContent = item; ui.inventoryList.appendChild(li);
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
  localPlayer.role = role; localPlayer.color = roleInfo[role].color; localPlayer.inventory = [...roleInfo[role].inventory];
  const spawn = roleSpawns[role]; localPlayer.x = spawn.x; localPlayer.z = spawn.z; localPlayer.floor = spawn.floor;
  localPlayer.name = ui.playerName.value.trim() || 'Player';
  if (localPlayer.mesh) scene.remove(localPlayer.mesh);
  localPlayer.mesh = createPlayerMesh({ ...localPlayer, id: socket.id }, true); scene.add(localPlayer.mesh);
  updateRoleUI(); socket.emit('joinGame', { name: localPlayer.name, role });
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
  let dx = touchInput.x; let dz = touchInput.z;
  if (keys.KeyW || keys.ArrowUp) dz -= 1;
  if (keys.KeyS || keys.ArrowDown) dz += 1;
  if (keys.KeyA || keys.ArrowLeft) dx -= 1;
  if (keys.KeyD || keys.ArrowRight) dx += 1;
  const length = Math.hypot(dx, dz);
  if (!length) return;
  dx /= Math.max(1, length); dz /= Math.max(1, length);
  const sprinting = keys.ShiftLeft || keys.ShiftRight || touchInput.sprint;
  const speed = sprinting ? 8 : 5.5;
  localPlayer.x = THREE.MathUtils.clamp(localPlayer.x + dx * speed * delta, -18.8, 18.8);
  localPlayer.z = THREE.MathUtils.clamp(localPlayer.z + dz * speed * delta, -14.8, 14.8);
  if (localPlayer.mesh) localPlayer.mesh.rotation.y = Math.atan2(dx, dz) + Math.PI;
  publishPlayer();
}
function tryUseStairs() {
  if (!localPlayer.role) return;
  const stair = stairs.find((item) => Math.hypot(localPlayer.x - item.x, localPlayer.z - item.z) < 3 && localPlayer.floor === item.floor);
  if (!stair) { ui.statusLabel.textContent = 'Move closer to the stairs'; return; }
  localPlayer.floor = stair.targetFloor; ui.statusLabel.textContent = `Moving to ${floorNames[localPlayer.floor]}`;
  updateRoleUI(); publishPlayer(true);
}
function tryUseAbility() {
  if (!localPlayer.role) return;
  if (localPlayer.role === 'director') ui.statusLabel.textContent = 'Director tablet ability';
  else if (localPlayer.role === 'medic') { localPlayer.health = Math.min(100, localPlayer.health + 20); ui.statusLabel.textContent = 'Medic ability used'; }
  else if (localPlayer.role === 'orderly') ui.statusLabel.textContent = 'Orderly ability used';
  else ui.statusLabel.textContent = 'Patient item used';
  socket.emit('useAbility', { ability: roleInfo[localPlayer.role].ability }); publishPlayer(true);
}
function setupTouchControls() {
  const pad = document.getElementById('movePad'); const stick = document.getElementById('moveStick');
  if (!pad || !stick) return;
  let pointerId = null;
  const reset = () => { pointerId = null; touchInput.x = 0; touchInput.z = 0; stick.style.transform = 'translate(-50%, -50%)'; };
  const updateStick = (event) => {
    if (pointerId !== event.pointerId) return;
    const rect = pad.getBoundingClientRect(); const radius = rect.width * 0.32;
    const rawX = event.clientX - (rect.left + rect.width / 2); const rawY = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(rawX, rawY) || 1; const scale = Math.min(1, radius / distance);
    const x = rawX * scale; const y = rawY * scale;
    touchInput.x = x / radius; touchInput.z = y / radius;
    stick.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  };
  pad.addEventListener('pointerdown', (event) => { event.preventDefault(); pointerId = event.pointerId; pad.setPointerCapture(pointerId); updateStick(event); });
  pad.addEventListener('pointermove', updateStick);
  pad.addEventListener('pointerup', (event) => { if (pointerId === event.pointerId) reset(); });
  pad.addEventListener('pointercancel', reset);
  ui.sprintButton.addEventListener('pointerdown', (event) => { event.preventDefault(); touchInput.sprint = !touchInput.sprint; ui.sprintButton.classList.toggle('active', touchInput.sprint); });
  document.getElementById('interactButton').addEventListener('click', tryUseStairs);
  ui.abilityButton.addEventListener('click', tryUseAbility);
}
function setupCameraControls() {
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    draggingCamera = true; previousPointer = { x: event.clientX, y: event.clientY, id: event.pointerId };
    try { canvas.setPointerCapture(event.pointerId); } catch (_error) { /* Safari may not capture every pointer */ }
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!draggingCamera || !previousPointer || previousPointer.id !== event.pointerId) return;
    const dx = event.clientX - previousPointer.x; const dy = event.clientY - previousPointer.y;
    previousPointer = { x: event.clientX, y: event.clientY, id: event.pointerId };
    cameraYaw -= dx * 0.006;
    cameraPitch = THREE.MathUtils.clamp(cameraPitch + dy * 0.004, -0.08, 0.9);
  });
  const stop = () => { draggingCamera = false; previousPointer = null; };
  canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointercancel', stop); canvas.addEventListener('lostpointercapture', stop);
  canvas.addEventListener('wheel', (event) => { cameraDistance = THREE.MathUtils.clamp(cameraDistance + event.deltaY * 0.01, 7, 20); }, { passive: true });
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) await document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      return;
    }
    const root = document.documentElement;
    if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
    else ui.statusLabel.textContent = 'iPhone Safari: Share → Add to Home Screen';
  } catch (_error) { ui.statusLabel.textContent = 'Fullscreen unavailable in this browser'; }
}
function setupInput() {
  document.addEventListener('keydown', (event) => { keys[event.code] = true; if (event.code === 'KeyE') tryUseStairs(); if (event.code === 'KeyQ') tryUseAbility(); });
  document.addEventListener('keyup', (event) => { keys[event.code] = false; });
  document.querySelectorAll('.roleButton').forEach((button) => button.addEventListener('click', () => setRole(button.dataset.role)));
  if (isTouchDevice) { ui.fullscreenButton.hidden = false; ui.fullscreenButton.addEventListener('click', toggleFullscreen); }
}
function updateCamera() {
  const focus = new THREE.Vector3(localPlayer.x, floorData[localPlayer.floor].y + 1.35, localPlayer.z);
  const horizontal = Math.cos(cameraPitch) * cameraDistance;
  const desired = new THREE.Vector3(
    focus.x + Math.sin(cameraYaw) * horizontal,
    focus.y + Math.sin(cameraPitch) * cameraDistance,
    focus.z + Math.cos(cameraYaw) * horizontal
  );
  const rayDirection = desired.clone().sub(focus).normalize();
  wallRaycaster.set(focus, rayDirection);
  wallRaycaster.far = cameraDistance;
  const hits = wallRaycaster.intersectObjects(wallMeshes, false);
  if (hits.length) desired.copy(hits[0].point).addScaledVector(rayDirection, -0.45);
  // Keep the camera inside the building footprint and above the current floor.
  desired.x = THREE.MathUtils.clamp(desired.x, -20.2, 20.2);
  desired.z = THREE.MathUtils.clamp(desired.z, -16.2, 16.2);
  desired.y = Math.max(floorData[localPlayer.floor].y + 0.75, desired.y);
  camera.position.lerp(desired, 0.2);
  camera.lookAt(focus);
}
function tick(now) {
  const delta = Math.min((now - previousFrame) / 1000, 0.05); previousFrame = now;
  handleMovement(delta); updateCamera();
  if (localPlayer.mesh) localPlayer.mesh.position.set(localPlayer.x, floorData[localPlayer.floor].y, localPlayer.z);
  worldPlayers.forEach((mesh, id) => {
    const remote = remotePlayers.get(id); if (!remote) return;
    const floorY = floorData[remote.floor]?.y || 0;
    mesh.position.lerp(new THREE.Vector3(remote.x, floorY, remote.z), 0.22);
  });
  renderer.render(scene, camera); requestAnimationFrame(tick);
}

socket.on('assignedPlayer', (player) => {
  localPlayer.id = player.id; localPlayer.name = player.name; localPlayer.role = player.role;
  localPlayer.color = roleInfo[player.role].color; localPlayer.inventory = [...roleInfo[player.role].inventory];
  localPlayer.floor = player.floor; localPlayer.x = player.x; localPlayer.z = player.z;
  if (localPlayer.mesh) scene.remove(localPlayer.mesh);
  localPlayer.mesh = createPlayerMesh({ ...localPlayer, id: player.id }, true); scene.add(localPlayer.mesh);
  updateRoleUI();
});
socket.on('playersState', (players) => {
  const incoming = new Set(players.map((player) => player.id));
  players.forEach((player) => {
    if (player.id !== socket.id) { addRemotePlayer(player); remotePlayers.set(player.id, player); }
  });
  for (const id of worldPlayers.keys()) if (!incoming.has(id)) removeRemotePlayer(id);
  if (players.length === 1 && localPlayer.role) ui.statusLabel.textContent = 'You are alone in the facility';
});
socket.on('abilityFeedback', (feedback) => { if (feedback?.message) ui.statusLabel.textContent = feedback.message; });

setupWorld(); setupInput(); setupTouchControls(); setupCameraControls(); updateRoleUI(); requestAnimationFrame(tick);
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });
document.addEventListener('fullscreenchange', () => { ui.fullscreenButton.textContent = document.fullscreenElement ? '⛶ Exit fullscreen' : '⛶ Fullscreen'; });
