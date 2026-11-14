import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';

const socket = window.io ? io({ transports: ['websocket', 'polling'] }) : null;
const ROLES = {
  orderly: { name: 'Orderly', color: 0x2878d0, floor: 2, x: 70, z: 0, items: ['riotShield', 'taser', 'stunBaton', 'arrestCuffs'], ability: 'Containment' },
  medic: { name: 'Medic', color: 0x35b987, floor: 2, x: -70, z: 0, items: ['smallMedicalKit', 'mediumMedicalKit'], ability: 'Field treatment' },
  director: { name: 'Facility Director', color: 0x9670d5, floor: 1, x: 70, z: 43, items: ['stunBaton', 'ignotusShield', 'tablet'], ability: 'Override access' },
  patient: { name: 'Patient', color: 0xc85953, floor: 3, x: -72, z: 8, items: ['glassShard'], ability: 'Adrenaline' },
};
const FLOOR_Y = [0, 9, 18, 27];
const FLOOR_NAMES = ['GROUND', 'U1', 'U2', 'U3'];
const state = { role: null, id: null, x: 0, z: 0, floor: 0, yaw: 0, pitch: 0.34, actor: null, health: 100 };
const keys = new Set();
const remoteActors = new Map();
const joystick = { active: false, pointer: null, x: 0, y: 0 };
let lastNetworkUpdate = 0;
let lastCameraPointer = null;
let noticeTimer = 0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101923);
scene.fog = new THREE.Fog(0x101923, 90, 245);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xdcecff, 0x35404b, 1.6));
const keyLight = new THREE.DirectionalLight(0xffe6c1, 2.15);
keyLight.position.set(-38, 70, 32);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1536, 1536);
Object.assign(keyLight.shadow.camera, { left: -105, right: 105, top: 105, bottom: -105, near: 0.5, far: 220 });
keyLight.shadow.bias = -0.00015;
scene.add(keyLight);
const blueFill = new THREE.PointLight(0x438de3, 75, 110, 2);
blueFill.position.set(0, 18, 0);
scene.add(blueFill);

const standard = (color, roughness = 0.8, metalness = 0.03) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const floors = [];
function addBox(parent, x, y, z, w, h, d, materialOrColor, options = {}) {
  const material = materialOrColor?.isMaterial ? materialOrColor : standard(materialOrColor, options.roughness, options.metalness);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function addSign(parent, text, x, y, z, tint = '#51d6e8') {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#09131f'; ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = tint; ctx.fillRect(0, 0, 512, 8);
  ctx.fillStyle = '#f2f7fb'; ctx.font = 'bold 27px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 53);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.6), new THREE.MeshBasicMaterial({ map: texture }));
  sign.position.set(x, y, z); parent.add(sign);
}
function addCeilingLights(parent, y) {
  for (const z of [-46, -15, 16, 47]) {
    addBox(parent, 0, y + 6.72, z, 17, 0.12, 1.1, new THREE.MeshStandardMaterial({ color: 0x93d8e2, emissive: 0x1d7b91, emissiveIntensity: 1.2, roughness: 0.35 }));
  }
}
function buildFloor(index) {
  const y = FLOOR_Y[index]; const group = new THREE.Group(); floors[index] = group; scene.add(group);
  const lab = index === 1; const ward = index === 3;
  const groundMaterial = standard(lab ? 0x52606a : ward ? 0xb9c2c2 : 0x929da2, 0.92);
  const wallMaterial = standard(lab ? 0x303b47 : 0xd1d2cc, 0.86);
  addBox(group, 0, y - 0.3, 0, 180, 0.6, 132, groundMaterial);
  addBox(group, 0, y + 3.4, -65.5, 180, 6.8, 1, wallMaterial);
  addBox(group, 0, y + 3.4, 65.5, 180, 6.8, 1, wallMaterial);
  addBox(group, -89.5, y + 3.4, 0, 1, 6.8, 132, wallMaterial);
  addBox(group, 89.5, y + 3.4, 0, 1, 6.8, 132, wallMaterial);
  addCeilingLights(group, y);

  const bedFrame = standard(0x415464, 0.58, 0.22);
  for (const z of [-45, -27, -9, 9, 27, 45]) for (const x of [-68, -54, 54, 68]) {
    addBox(group, x, y + 0.43, z, 5.3, 0.24, 2.5, bedFrame);
    addBox(group, x, y + 0.64, z, 5.0, 0.2, 2.2, lab ? 0x8db6bc : 0xdfe7e7);
    addBox(group, x - 1.4, y + 0.79, z, 2.4, 0.08, 1.6, 0xf1f3eb);
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 10; i++) addBox(group, side * 78, y + 0.16 + i * 0.36, -7 + i * 1.25, 4, 0.22, 1.2, 0x5e6a75);
    addSign(group, 'STAIRS · E', side * 78, y + 4.8, -16, '#6dd9e7');
  }
  if (lab) {
    for (const side of [-1, 1]) for (const x of [-60, -20, 20, 60]) {
      addBox(group, x, y + 1.45, side * 37, 28, 2.9, 0.8, 0x424e5b);
      addBox(group, x, y + 3.35, side * 37, 25, 1.0, 0.16, new THREE.MeshStandardMaterial({ color: 0x80d3df, transparent: true, opacity: 0.38, roughness: 0.2 }));
      addBox(group, x, y + 0.7, side * 49, 11, 1.4, 3, 0x766956);
      addBox(group, x, y + 1.45, side * 49, 9, 0.14, 2.6, 0x4aa8b0);
    }
    addSign(group, 'RESEARCH DIVISION · RESTRICTED', 0, y + 5.5, -63, '#b39aff');
  } else if (ward) {
    addBox(group, -18, y + 1.1, 56, 14, 2.1, 5, 0x765d46);
    addBox(group, -18, y + 2.22, 56, 12, 0.14, 3.8, 0x45b6c5);
    addSign(group, 'PATIENT WARD · RECOVERY', 0, y + 5.5, -63, '#70dbaf');
  } else {
    addSign(group, index === 2 ? 'MEDICAL BAY · SECURITY' : 'GROUND FLOOR · EXIT', 0, y + 5.5, -63, index === 2 ? '#65d9ad' : '#56d5e8');
  }
  group.visible = false;
}
for (let i = 0; i < FLOOR_Y.length; i++) buildFloor(i);

function makeCharacter(roleKey) {
  const role = ROLES[roleKey] || ROLES.patient;
  const root = new THREE.Group();
  const uniform = standard(role.color, 0.58, 0.08);
  const dark = standard(0x17202b, 0.78);
  const skin = standard(0xe9bd9e, 0.9);
  const addPart = (x, y, z, w, h, d, mat) => addBox(root, x, y, z, w, h, d, mat);
  // Deliberately blocky proportions evoke a toy-like, Roblox-inspired avatar.
  addPart(0, 1.48, 0, 1.15, 1.28, 0.62, uniform);
  addPart(0, 0.72, 0, 1.08, 0.34, 0.58, dark);
  addPart(-0.3, 0.16, 0, 0.43, 1.08, 0.46, dark);
  addPart(0.3, 0.16, 0, 0.43, 1.08, 0.46, dark);
  addPart(-0.77, 1.44, 0, 0.37, 1.06, 0.42, uniform);
  addPart(0.77, 1.44, 0, 0.37, 1.06, 0.42, uniform);
  addPart(0, 2.62, 0.02, 0.82, 0.82, 0.74, skin);
  addPart(0, 3.07, -0.01, 0.86, 0.22, 0.78, roleKey === 'medic' ? 0x7d463c : 0x1b2532);
  addPart(-0.18, 2.65, 0.4, 0.085, 0.09, 0.045, 0x101820);
  addPart(0.18, 2.65, 0.4, 0.085, 0.09, 0.045, 0x101820);
  addPart(0, 1.68, 0.33, 0.56, 0.14, 0.07, roleKey === 'director' ? 0xf4c45f : 0xdcebf3);
  if (roleKey === 'orderly') {
    addPart(0, 2.65, 0.45, 0.62, 0.14, 0.06, 0x168fd0);
    addPart(1.0, 0.95, 0.17, 0.13, 1.1, 0x91a7b6);
    addPart(-0.78, 1.94, 0, 0.52, 0.28, 0.68, dark);
    addPart(0.78, 1.94, 0, 0.52, 0.28, 0.68, dark);
  } else if (roleKey === 'medic') {
    addPart(0, 1.68, 0.39, 0.38, 0.38, 0.08, 0xf1f7f3);
    addPart(0, 1.68, 0.44, 0.1, 0.27, 0.04, 0x27a981);
    addPart(0, 1.68, 0.45, 0.27, 0.1, 0.04, 0x27a981);
  } else if (roleKey === 'director') {
    addPart(0, 3.15, 0.02, 0.96, 0.08, 0.85, 0xd5a94d);
    addPart(0.25, 2.03, 0.37, 0.28, 0.13, 0.05, 0xf2c35d);
  } else if (roleKey === 'patient') {
    addPart(0.86, 1.2, 0.16, 0.09, 0.72, 0.12, 0xe9edf0);
    addPart(-0.36, 1.7, 0.31, 0.25, 0.08, 0.05, 0xb96851);
  }
  return root;
}

function showNotice(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => toast.classList.remove('visible'), 1900);
}
function setFloor(index) {
  state.floor = THREE.MathUtils.clamp(index, 0, FLOOR_Y.length - 1);
  floors.forEach((floor, i) => { floor.visible = i === state.floor; });
  if (state.actor) state.actor.position.set(state.x, FLOOR_Y[state.floor], state.z);
  document.getElementById('floorLabel').textContent = `FLOOR · ${FLOOR_NAMES[state.floor]}`;
  updateCamera(1);
}
function updateCamera(alpha) {
  const target = new THREE.Vector3(state.x + Math.sin(state.yaw) * 14, FLOOR_Y[state.floor] + 9.5 + state.pitch * 3, state.z + Math.cos(state.yaw) * 14);
  camera.position.lerp(target, alpha);
  camera.lookAt(state.x, FLOOR_Y[state.floor] + 1.45, state.z);
}
function setHealth(value) {
  state.health = THREE.MathUtils.clamp(Number(value) || 0, 0, 100);
  document.getElementById('healthText').textContent = `${Math.round(state.health)} / 100`;
  document.getElementById('healthFill').style.width = `${state.health}%`;
}
function sendJoin() {
  if (!socket || !socket.connected || !state.role) return;
  socket.emit('joinGame', { role: state.role, name: document.getElementById('playerName').value.trim() || 'Player' });
}
function chooseRole(roleKey) {
  const role = ROLES[roleKey]; if (!role) return;
  state.role = roleKey; state.x = role.x; state.z = role.z;
  state.actor?.parent?.remove(state.actor);
  state.actor = makeCharacter(roleKey); scene.add(state.actor);
  setFloor(role.floor);
  document.getElementById('roleLabel').textContent = `ROLE · ${role.name.toUpperCase()}`;
  document.getElementById('statusLabel').textContent = socket?.connected ? 'NETWORK · CONNECTED' : 'LOCAL · CONNECTING';
  document.getElementById('objectiveText').textContent = roleKey === 'patient' ? 'Reach the ground-floor exit and escape.' : 'Secure the facility and restore containment.';
  document.getElementById('objectiveHint').textContent = `${role.ability} · Find the stairwell to change floors.`;
  document.getElementById('joinScreen').classList.add('hidden');
  const slots = document.getElementById('equipmentSlots'); slots.replaceChildren();
  role.items.forEach((item, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'equipment-slot';
    const readable = item.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
    button.innerHTML = `<span class="slot-number">${index + 1}</span>${readable}`;
    button.addEventListener('click', () => {
      slots.querySelectorAll('.equipment-slot').forEach(el => el.classList.remove('selected'));
      button.classList.add('selected'); socket?.emit('equipItem', { item });
    });
    slots.appendChild(button);
  });
  setHealth(100);
  sendJoin();
}
document.querySelectorAll('.roleButton').forEach(button => button.addEventListener('click', () => chooseRole(button.dataset.role)));

if (socket) {
  socket.on('connect', () => { document.getElementById('statusLabel').textContent = state.role ? 'NETWORK · CONNECTED' : 'NETWORK · READY'; sendJoin(); });
  socket.on('disconnect', () => { document.getElementById('statusLabel').textContent = state.role ? 'LOCAL · RECONNECTING' : 'NETWORK · OFFLINE'; });
  socket.on('connect_error', () => { document.getElementById('statusLabel').textContent = 'LOCAL MODE · NETWORK OFFLINE'; });
  socket.on('assignedPlayer', data => {
    if (!data) return; state.id = data.id;
    if (Number.isFinite(data.x)) state.x = data.x;
    if (Number.isFinite(data.z)) state.z = data.z;
    if (Number.isInteger(data.floor)) setFloor(data.floor);
  });
  socket.on('playersState', list => {
    const present = new Set(list.map(p => p.id));
    for (const [id, actor] of remoteActors) if (!present.has(id)) { scene.remove(actor); remoteActors.delete(id); }
    for (const person of list) {
      if (person.id === state.id) continue;
      let actor = remoteActors.get(person.id);
      if (!actor) { actor = makeCharacter(person.role); remoteActors.set(person.id, actor); scene.add(actor); }
      actor.position.set(person.x, FLOOR_Y[person.floor] || 0, person.z); actor.visible = person.floor === state.floor;
    }
  });
  socket.on('abilityFeedback', data => { if (data?.message) showNotice(data.message); });
}

function changeFloor() {
  if (!state.role) return;
  const distance = Math.min(Math.hypot(state.x - 78, state.z + 10), Math.hypot(state.x + 78, state.z + 10));
  if (distance > 16) { showNotice('Move closer to a stairwell first'); return; }
  if (state.floor >= 3) { showNotice('You are on the top floor'); return; }
  setFloor(state.floor + 1); showNotice(`Entered ${FLOOR_NAMES[state.floor]}`);
}
window.addEventListener('keydown', event => {
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;
  if (event.code === 'KeyE') changeFloor();
  if (event.code === 'KeyQ' && state.role) { socket?.emit('useAbility', { ability: ROLES[state.role].ability }); if (!socket?.connected) showNotice(`${ROLES[state.role].ability} activated`); }
  if (/^Digit[1-4]$/.test(event.code)) document.querySelectorAll('.equipment-slot')[Number(event.code.at(-1)) - 1]?.click();
}, { passive: false });
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => keys.clear());

renderer.domElement.addEventListener('pointerdown', event => {
  if (event.target.closest?.('button')) return;
  lastCameraPointer = { x: event.clientX, y: event.clientY, id: event.pointerId };
  renderer.domElement.setPointerCapture?.(event.pointerId);
});
renderer.domElement.addEventListener('pointermove', event => {
  if (!lastCameraPointer || event.pointerId !== lastCameraPointer.id) return;
  const dx = event.clientX - lastCameraPointer.x, dy = event.clientY - lastCameraPointer.y;
  state.yaw -= dx * 0.006;
  state.pitch = THREE.MathUtils.clamp(state.pitch - dy * 0.004, -0.25, 0.8);
  lastCameraPointer.x = event.clientX; lastCameraPointer.y = event.clientY;
});
renderer.domElement.addEventListener('pointerup', () => { lastCameraPointer = null; });
renderer.domElement.addEventListener('pointercancel', () => { lastCameraPointer = null; });

const joystickZone = document.getElementById('joystickZone');
const pad = document.getElementById('movePad');
const stick = document.getElementById('moveStick');
function resetJoystick() {
  joystick.active = false; joystick.pointer = null; joystick.x = 0; joystick.y = 0;
  pad.classList.remove('visible'); stick.style.transform = 'translate(-50%,-50%)';
}
function moveJoystick(clientX, clientY) {
  const rect = pad.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2, limit = rect.width * 0.3;
  const dx = clientX - cx, dy = clientY - cy, length = Math.hypot(dx, dy), scale = length > limit ? limit / length : 1;
  const x = dx * scale, y = dy * scale;
  joystick.x = x / limit; joystick.y = y / limit;
  stick.style.transform = `translate(calc(-50% + ${x}px),calc(-50% + ${y}px))`;
}
joystickZone.addEventListener('pointerdown', event => {
  event.preventDefault(); joystick.active = true; joystick.pointer = event.pointerId;
  const rect = joystickZone.getBoundingClientRect(); const cx = rect.left + Math.min(rect.width * 0.38, 145); const cy = rect.bottom - Math.min(rect.height * 0.38, 145);
  pad.style.left = `${cx - 68}px`; pad.style.top = `${cy - 68}px`; pad.classList.add('visible');
  joystickZone.setPointerCapture?.(event.pointerId); moveJoystick(event.clientX, event.clientY);
});
joystickZone.addEventListener('pointermove', event => { if (joystick.active && event.pointerId === joystick.pointer) moveJoystick(event.clientX, event.clientY); });
joystickZone.addEventListener('pointerup', event => { if (event.pointerId === joystick.pointer) resetJoystick(); });
joystickZone.addEventListener('pointercancel', resetJoystick);
const sprintButton = document.getElementById('sprintButton');
sprintButton.addEventListener('pointerdown', event => { event.preventDefault(); keys.add('ShiftLeft'); sprintButton.classList.add('active'); });
for (const type of ['pointerup','pointercancel','pointerleave']) sprintButton.addEventListener(type, () => { keys.delete('ShiftLeft'); sprintButton.classList.remove('active'); });
document.getElementById('interactButton').addEventListener('click', changeFloor);
document.getElementById('abilityButton').addEventListener('click', () => {
  if (!state.role) return; socket?.emit('useAbility', { ability: ROLES[state.role].ability }); showNotice(`${ROLES[state.role].ability} ready`);
});
document.getElementById('fullscreenButton').addEventListener('click', async () => {
  try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); else await document.exitFullscreen(); } catch (_) { showNotice('Fullscreen is unavailable in this browser'); }
});
if (window.matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window) document.body.classList.add('touch-device');

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (state.role && state.actor) {
    let forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
    let sideways = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
    if (joystick.active) { forward = -joystick.y; sideways = joystick.x; }
    const length = Math.hypot(forward, sideways); if (length > 1) { forward /= length; sideways /= length; }
    const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 14 : 8;
    state.x = THREE.MathUtils.clamp(state.x + (Math.sin(state.yaw) * forward + Math.cos(state.yaw) * sideways) * speed * dt, -86, 86);
    state.z = THREE.MathUtils.clamp(state.z + (Math.cos(state.yaw) * forward - Math.sin(state.yaw) * sideways) * speed * dt, -62, 62);
    state.actor.position.set(state.x, FLOOR_Y[state.floor], state.z);
    state.actor.rotation.y = state.yaw + Math.PI;
    updateCamera(1 - Math.exp(-7 * dt));
    const now = performance.now();
    if (socket?.connected && now - lastNetworkUpdate > 100) {
      lastNetworkUpdate = now;
      socket.emit('updatePlayer', { x: state.x, z: state.z, floor: state.floor });
    }
  }
  renderer.render(scene, camera);
}
setFloor(0);
animate();
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
window.addEventListener('load', () => {
  const loading = document.getElementById('loadingScreen');
  document.getElementById('loadingStatus').textContent = 'Facility online';
  window.setTimeout(() => { loading.classList.add('done'); window.setTimeout(() => loading.remove(), 500); }, 450);
});
