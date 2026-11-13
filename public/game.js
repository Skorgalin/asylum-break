import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';

// Keep the client bootstrap deliberately small and defensive: the render call must
// run every frame, otherwise the browser shows a black canvas.
const socket = io();
const roles = {
  patient: { color: 0xef4444, floor: 3, x: -72, z: 8, items: ['Glass shard'] },
  medic: { color: 0x34d399, floor: 2, x: -70, z: 0, items: ['Small med kit', 'Medium med kit'] },
  orderly: { color: 0xfbbf24, floor: 2, x: 70, z: 0, items: ['Riot shield', 'Taser', 'Stun baton', 'Arrest cuffs'] },
  director: { color: 0xa78bfa, floor: 1, x: 70, z: 43, items: ['Stun baton', 'Ignotus shield', 'Tablet'] }
};
const floorY = [0, 9, 18, 27];
const floorNames = ['Ground', 'U1', 'U2', 'U3'];
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x18212b);
scene.fog = new THREE.Fog(0x18212b, 120, 280);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, .1, 400);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xeaf3ff, 0x52606b, 2));
const keyLight = new THREE.DirectionalLight(0xfff0d4, 2.2);
keyLight.position.set(-35, 65, 30);
scene.add(keyLight);

const floors = [];
const player = { id: null, role: null, x: 0, z: 0, floor: 0, name: 'Player', mesh: null };
const otherPlayers = new Map();
const keys = Object.create(null);
let yaw = 0, pitch = .32, dragging = false, previousPointer = null;

const mat = (color, roughness = .82) => new THREE.MeshStandardMaterial({ color, roughness });
const floorMat = mat(0xd7dce0);
const wallMat = mat(0xe5e4de);
const bedMat = mat(0xc5d5df);
const bedFrame = mat(0x536575, .6);
const labMat = mat(0x5b626c, .9);
const labGlass = new THREE.MeshStandardMaterial({ color: 0xa9d4db, roughness: .25, metalness: .15, transparent: true, opacity: .48 });

function addBox(group, x, y, z, w, h, d, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
function addSign(group, text, x, y, z, color = '#38bdf8') {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#18212b'; ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = color; ctx.fillRect(0, 0, 512, 10);
  ctx.fillStyle = 'white'; ctx.font = 'bold 30px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 54);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.6), new THREE.MeshBasicMaterial({ map: texture }));
  sign.position.set(x, y, z); group.add(sign);
}
function buildPatientWard(group, y) {
  // Open ward with bed rows, central walkway, nurse desk, and lounge tables.
  for (const z of [-48, -32, -16, 16, 32, 48]) for (const x of [-68, -54, -40, 40, 54, 68]) {
    addBox(group, x, y + .48, z, 5.8, .25, 2.9, bedFrame);
    addBox(group, x, y + .72, z, 5.4, .25, 2.6, bedMat);
    addBox(group, x - 1.1, y + .88, z, 2.4, .1, 1.8, mat(0xf1f5f9));
    addBox(group, x + 2.1, y + .88, z, .8, .12, .8, mat(0x38bdf8));
  }
  for (const z of [-22, 22]) for (const x of [-18, 0, 18]) {
    addBox(group, x, y + .55, z, 9, .25, 4, mat(0x7b614b));
    addBox(group, x, y + .3, z - 3, 8, .6, .5, mat(0x64748b));
    addBox(group, x, y + .3, z + 3, 8, .6, .5, mat(0x64748b));
  }
  addBox(group, -18, y + 1.05, 56, 14, 2, 5, mat(0x806342));
  addBox(group, -18, y + 2.12, 56, 12, .14, 3.8, mat(0x38bdf8));
  addSign(group, 'PATIENT WARD · RECOVERY', 0, y + 5.6, -64, '#34d399');
  addSign(group, 'NURSING STATION', -18, y + 4.1, 52, '#fbbf24');
  // Decorative trees as simple, low-cost geometry.
  for (const [x, z] of [[-30, 0], [30, 0], [0, 54]]) {
    addBox(group, x, y + 1.5, z, .6, 3, .6, mat(0x76513a));
    const crown = new THREE.Mesh(new THREE.ConeGeometry(2.5, 5, 7), mat(0x38694c));
    crown.position.set(x, y + 5, z); group.add(crown);
  }
}
function buildLabs(group, y) {
  // Long, darker corridor with named rooms, glass observation fronts, and lab benches.
  addBox(group, 0, y + .03, 0, 178, .12, 130, mat(0x777a7b));
  for (const side of [-1, 1]) for (const x of [-66, -22, 22, 66]) {
    const z = side * 37;
    addBox(group, x, y + 1.4, z, 34, 2.8, 1, labMat);
    addBox(group, x, y + 3.3, z, 32, 1.2, .22, labGlass);
    addBox(group, x, y + .7, side * 49, 12, 1.4, 3, mat(0x8b765d));
    addBox(group, x, y + 1.45, side * 49, 10, .12, 2.6, mat(0x67c4cf));
    addSign(group, side < 0 ? 'LABORATORY' : 'EXPERIMENTAL DIVISION', x, y + 5.3, side * 34, '#a78bfa');
  }
  for (const x of [-28, 0, 28]) {
    addBox(group, x, y + .55, 0, 10, 1.1, 3, mat(0x687482));
    addBox(group, x, y + 1.15, 0, 8, .14, 2, mat(0x47aeb7));
  }
  addSign(group, 'RESEARCH LABS · RESTRICTED', 0, y + 5.5, -63, '#38bdf8');
}
function buildFloor(index) {
  const y = floorY[index], group = new THREE.Group(); floors[index] = group; scene.add(group);
  addBox(group, 0, y, 0, 180, .6, 132, floorMat);
  // Perimeter walls, kept below the ceiling so the space stays visible.
  addBox(group, 0, y + 3.4, -65.5, 180, 6.8, 1, wallMat);
  addBox(group, 0, y + 3.4, 65.5, 180, 6.8, 1, wallMat);
  addBox(group, -89.5, y + 3.4, 0, 1, 6.8, 132, wallMat);
  addBox(group, 89.5, y + 3.4, 0, 1, 6.8, 132, wallMat);
  if (index === 3) buildPatientWard(group, y);
  else if (index === 1) buildLabs(group, y);
  else {
    for (const z of [-42, -24, -6, 12, 30]) for (const x of [-68, -56, 56, 68]) {
      addBox(group, x, y + .5, z, 5.5, .25, 2.6, bedFrame);
      addBox(group, x, y + .72, z, 5.1, .2, 2.3, bedMat);
    }
    addSign(group, index === 2 ? 'MEDICAL BAY · GUARD ZONE' : 'GROUND FLOOR · EXIT', 0, y + 5.5, -63, index === 2 ? '#34d399' : '#38bdf8');
  }
  const stairMat = mat(0x687482);
  for (const sx of [-78, 78]) {
    for (let i = 0; i < 10; i++) addBox(group, sx, y + .2 + i * .38, -7 + i * 1.25, 4, .25, 1.2, stairMat);
    addSign(group, 'STAIRS · E', sx, y + 4.8, -15, '#38bdf8');
  }
  group.visible = false;
}
for (let i = 0; i < floorY.length; i++) buildFloor(i);

function makePlayer(color) {
  const group = new THREE.Group();
  addBox(group, 0, 1.25, 0, .8, 1.3, .48, new THREE.MeshStandardMaterial({ color }));
  const head = new THREE.Mesh(new THREE.SphereGeometry(.34, 16, 12), mat(0xf2d1b3)); head.position.y = 2.2; group.add(head);
  return group;
}
function setFloor(index) {
  player.floor = THREE.MathUtils.clamp(index, 0, 3);
  floors.forEach((f, i) => { f.visible = i === player.floor; });
  const base = floorY[player.floor];
  if (player.mesh) player.mesh.position.set(player.x, base, player.z);
  camera.position.set(player.x + Math.sin(yaw) * 18, base + 13, player.z + Math.cos(yaw) * 18);
  camera.lookAt(player.x, base + 1.4, player.z);
  const floorLabel = document.getElementById('floorLabel');
  if (floorLabel) floorLabel.textContent = `Floor: ${floorNames[player.floor]}`;
}
function chooseRole(role) {
  const selected = roles[role]; if (!selected) return;
  player.role = role; player.name = document.getElementById('playerName')?.value.trim() || 'Player';
  player.x = selected.x; player.z = selected.z;
  if (player.mesh) scene.remove(player.mesh);
  player.mesh = makePlayer(selected.color); scene.add(player.mesh);
  setFloor(selected.floor);
  document.getElementById('roleLabel').textContent = `Role: ${role}`;
  document.getElementById('statusLabel').textContent = `Ready: ${role}`;
  const join = document.getElementById('joinScreen'); if (join) join.classList.add('hidden');
  const slots = document.getElementById('equipmentSlots');
  if (slots) { slots.replaceChildren(); selected.items.forEach((item, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'equipment-slot'; b.textContent = `${i + 1} ${item}`; slots.appendChild(b); }); }
  socket.emit('joinGame', { role, name: player.name, spawn: { x: player.x, z: player.z, floor: player.floor } });
}
document.querySelectorAll('.roleButton').forEach(button => button.addEventListener('click', () => chooseRole(button.dataset.role)));
const nameInput = document.getElementById('playerName');
if (nameInput) nameInput.addEventListener('input', () => { player.name = nameInput.value.trim() || 'Player'; });

socket.on('assignedPlayer', data => {
  if (!data) return;
  player.id = data.id;
  if (Number.isFinite(data.x)) player.x = data.x;
  if (Number.isFinite(data.z)) player.z = data.z;
  if (Number.isFinite(data.floor)) setFloor(data.floor);
});
socket.on('playersState', list => {
  const live = new Set(list.map(p => p.id));
  for (const [id, mesh] of otherPlayers) if (!live.has(id)) { scene.remove(mesh); otherPlayers.delete(id); }
  for (const p of list) {
    if (p.id === player.id) continue;
    let mesh = otherPlayers.get(p.id);
    if (!mesh) { mesh = makePlayer(roles[p.role]?.color ?? 0xffffff); otherPlayers.set(p.id, mesh); scene.add(mesh); }
    mesh.position.set(p.x, floorY[p.floor] ?? 0, p.z); mesh.visible = p.floor === player.floor;
  }
});

document.addEventListener('keydown', event => {
  keys[event.code] = true;
  if (event.code === 'KeyE' && player.role) {
    const nearStairs = Math.min(Math.hypot(player.x - 78, player.z), Math.hypot(player.x + 78, player.z)) < 12;
    if (nearStairs) { setFloor(player.floor === 3 ? 2 : (player.floor + 1) % 4); socket.emit('updatePlayer', { x: player.x, y: floorY[player.floor], z: player.z, floor: player.floor }); }
  }
});
document.addEventListener('keyup', event => { keys[event.code] = false; });
renderer.domElement.addEventListener('pointerdown', event => { dragging = true; previousPointer = { x: event.clientX, y: event.clientY }; });
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointermove', event => {
  if (!dragging || !previousPointer) return;
  yaw -= (event.clientX - previousPointer.x) * .005;
  pitch = THREE.MathUtils.clamp(pitch - (event.clientY - previousPointer.y) * .004, -.35, 1.0);
  previousPointer = { x: event.clientX, y: event.clientY };
});

function animate() {
  requestAnimationFrame(animate);
  const step = .22;
  if (player.role) {
    let forward = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    let sideways = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    const length = Math.hypot(forward, sideways) || 1;
    forward /= length; sideways /= length;
    player.x += (Math.sin(yaw) * forward + Math.cos(yaw) * sideways) * step;
    player.z += (Math.cos(yaw) * forward - Math.sin(yaw) * sideways) * step;
    player.x = THREE.MathUtils.clamp(player.x, -86, 86); player.z = THREE.MathUtils.clamp(player.z, -62, 62);
    if (player.mesh) player.mesh.position.set(player.x, floorY[player.floor], player.z);
    camera.position.lerp(new THREE.Vector3(player.x + Math.sin(yaw) * 18, floorY[player.floor] + 13 + pitch * 4, player.z + Math.cos(yaw) * 18), .12);
    camera.lookAt(player.x, floorY[player.floor] + 1.4, player.z);
  }
  renderer.render(scene, camera);
}
setFloor(0);
animate();
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
