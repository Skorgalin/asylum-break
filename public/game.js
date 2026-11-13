import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';

const socket = io();
const roles = {
  orderly: {
    color: 0x2a5cff,
    accent: '#7dd3fc',
    floor: 2,
    x: 70,
    z: 0,
    items: ['Riot shield', 'Taser', 'Stun baton', 'Arrest cuffs'],
    label: 'Orderly',
    badge: 'ORDERLY',
    palette: ['#3b82f6', '#0f172a', '#dbeafe', '#8ec5ff'],
    summary: 'Security and control specialist.',
  },
  medic: {
    color: 0x34d399,
    accent: '#f9fafb',
    floor: 2,
    x: -70,
    z: 0,
    items: ['Small med kit', 'Medium med kit'],
    label: 'Medic',
    badge: 'MEDIC',
    palette: ['#8b5cf6', '#e0f2fe', '#d1fae5', '#f8fafc'],
    summary: 'Support and healing specialist.',
  },
  director: {
    color: 0xa78bfa,
    accent: '#fbbf24',
    floor: 1,
    x: 70,
    z: 43,
    items: ['Stun baton', 'Ignotus shield', 'Tablet'],
    label: 'Facility Director',
    badge: 'DIRECTOR',
    palette: ['#f59e0b', '#111827', '#f3e8ff', '#ddd6fe'],
    summary: 'Command authority and lockdown control.',
  },
  patient: {
    color: 0xf87171,
    accent: '#fca5a5',
    floor: 3,
    x: -72,
    z: 8,
    items: ['Glass shard'],
    label: 'Patient',
    badge: 'PATIENT',
    palette: ['#fca5a5', '#111827', '#fff7ed', '#fecaca'],
    summary: 'Aggressive escape runner and chaos agent.',
  },
};

const floorY = [0, 9, 18, 27];
const floorNames = ['Ground', 'U1', 'U2', 'U3'];
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1220);
scene.fog = new THREE.Fog(0x0b1220, 90, 260);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xdfefff, 0x1f2937, 1.55));
const keyLight = new THREE.DirectionalLight(0xfff1d0, 2.4);
keyLight.position.set(-34, 62, 22);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -120;
keyLight.shadow.camera.right = 120;
keyLight.shadow.camera.top = 120;
keyLight.shadow.camera.bottom = -120;
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 220;
scene.add(keyLight);

const fillLight = new THREE.PointLight(0x60a5fa, 1.5, 180, 2);
fillLight.position.set(0, 22, 0);
scene.add(fillLight);

const floors = [];
const player = { id: null, role: null, x: 0, z: 0, floor: 0, name: 'Player', mesh: null, velocity: { x: 0, z: 0 } };
const otherPlayers = new Map();
const keys = Object.create(null);
const mobile = {
  active: false,
  dx: 0,
  dy: 0,
  pointerId: null,
  centerX: 0,
  centerY: 0,
};
let yaw = 0;
let pitch = 0.3;
let dragging = false;
let previousPointer = null;

const mat = (color, roughness = 0.8, metalness = 0.08) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const floorMat = mat(0xdfe6ee, 0.82);
const wallMat = mat(0xe5e7eb, 0.7);
const bedMat = mat(0xc7d2d9, 0.75);
const bedFrame = mat(0x53667a, 0.62);
const labMat = mat(0x5c6672, 0.9);
const labGlass = new THREE.MeshStandardMaterial({ color: 0x9ad8ec, roughness: 0.18, metalness: 0.2, transparent: true, opacity: 0.48 });

function addBox(group, x, y, z, w, h, d, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addCylinder(group, x, y, z, radius, height, material) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 18), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addSign(group, text, x, y, z, color = '#60a5fa') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 96);
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 512, 10);
  ctx.fillStyle = 'white';
  ctx.font = 'bold 28px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 52);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.6), new THREE.MeshBasicMaterial({ map: texture }));
  sign.position.set(x, y, z);
  sign.renderOrder = 3;
  group.add(sign);
}

function buildPatientWard(group, y) {
  for (const z of [-48, -32, -16, 16, 32, 48]) {
    for (const x of [-68, -54, -40, 40, 54, 68]) {
      addBox(group, x, y + 0.48, z, 5.8, 0.25, 2.9, bedFrame);
      addBox(group, x, y + 0.72, z, 5.4, 0.25, 2.6, bedMat);
      addBox(group, x - 1.1, y + 0.88, z, 2.4, 0.1, 1.8, mat(0xf1f5f9));
      addBox(group, x + 2.1, y + 0.88, z, 0.8, 0.12, 0.8, mat(0x38bdf8));
    }
  }

  for (const z of [-22, 22]) {
    for (const x of [-18, 0, 18]) {
      addBox(group, x, y + 0.55, z, 9, 0.25, 4, mat(0x7b614b));
      addBox(group, x, y + 0.3, z - 3, 8, 0.6, 0.5, mat(0x64748b));
      addBox(group, x, y + 0.3, z + 3, 8, 0.6, 0.5, mat(0x64748b));
    }
  }

  addBox(group, -18, y + 1.05, 56, 14, 2, 5, mat(0x806342));
  addBox(group, -18, y + 2.12, 56, 12, 0.14, 3.8, mat(0x38bdf8));
  addSign(group, 'PATIENT WARD · RECOVERY', 0, y + 5.6, -64, '#34d399');
  addSign(group, 'NURSING STATION', -18, y + 4.1, 52, '#fbbf24');

  for (const [x, z] of [[-30, 0], [30, 0], [0, 54]]) {
    addBox(group, x, y + 1.5, z, 0.6, 3, 0.6, mat(0x76513a));
    const crown = new THREE.Mesh(new THREE.ConeGeometry(2.5, 5, 7), mat(0x38694c));
    crown.position.set(x, y + 5, z);
    crown.castShadow = true;
    crown.receiveShadow = true;
    group.add(crown);
  }
}

function buildLabs(group, y) {
  addBox(group, 0, y + 0.03, 0, 178, 0.12, 130, mat(0x777a7b));

  for (const side of [-1, 1]) {
    for (const x of [-66, -22, 22, 66]) {
      const z = side * 37;
      addBox(group, x, y + 1.4, z, 34, 2.8, 1, labMat);
      addBox(group, x, y + 3.3, z, 32, 1.2, 0.22, labGlass);
      addBox(group, x, y + 0.7, side * 49, 12, 1.4, 3, mat(0x8b765d));
      addBox(group, x, y + 1.45, side * 49, 10, 0.12, 2.6, mat(0x67c4cf));
      addSign(group, side < 0 ? 'LABORATORY' : 'EXPERIMENTAL DIVISION', x, y + 5.3, side * 34, '#a78bfa');
    }
  }

  for (const x of [-28, 0, 28]) {
    addBox(group, x, y + 0.55, 0, 10, 1.1, 3, mat(0x687482));
    addBox(group, x, y + 1.15, 0, 8, 0.14, 2, mat(0x47aeb7));
  }

  addSign(group, 'RESEARCH LABS · RESTRICTED', 0, y + 5.5, -63, '#38bdf8');
}

function buildFloor(index) {
  const y = floorY[index];
  const group = new THREE.Group();
  floors[index] = group;
  scene.add(group);

  addBox(group, 0, y, 0, 180, 0.6, 132, floorMat);
  addBox(group, 0, y + 3.4, -65.5, 180, 6.8, 1, wallMat);
  addBox(group, 0, y + 3.4, 65.5, 180, 6.8, 1, wallMat);
  addBox(group, -89.5, y + 3.4, 0, 1, 6.8, 132, wallMat);
  addBox(group, 89.5, y + 3.4, 0, 1, 6.8, 132, wallMat);

  if (index === 3) buildPatientWard(group, y);
  else if (index === 1) buildLabs(group, y);
  else {
    for (const z of [-42, -24, -6, 12, 30]) {
      for (const x of [-68, -56, 56, 68]) {
        addBox(group, x, y + 0.5, z, 5.5, 0.25, 2.6, bedFrame);
        addBox(group, x, y + 0.72, z, 5.1, 0.2, 2.3, bedMat);
      }
    }
    addSign(group, index === 2 ? 'MEDICAL BAY · GUARD ZONE' : 'GROUND FLOOR · EXIT', 0, y + 5.5, -63, index === 2 ? '#34d399' : '#38bdf8');
  }

  const stairMat = mat(0x687482, 0.76);
  for (const sx of [-78, 78]) {
    for (let i = 0; i < 10; i++) {
      addBox(group, sx, y + 0.2 + i * 0.38, -7 + i * 1.25, 4, 0.25, 1.2, stairMat);
    }
    addSign(group, 'STAIRS · E', sx, y + 4.8, -15, '#38bdf8');
  }

  group.visible = false;
}

for (let i = 0; i < floorY.length; i++) buildFloor(i);

function makeBodyPart(material, width, height, depth, x, y, z) {
  const part = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  part.position.set(x, y, z);
  part.castShadow = true;
  part.receiveShadow = true;
  return part;
}

function makePlayerCharacter(roleKey, isLocal = false) {
  const group = new THREE.Group();
  const role = roles[roleKey] || roles.patient;
  const bodyColor = new THREE.Color(role.color);
  const bodyMat = mat(bodyColor.getHex(), 0.7);
  const darkMat = mat(0x111827, 0.82);
  const skinMat = mat(0xf5d0b3, 0.9);
  const hairMat = mat(0x1f2937, 0.9);
  const accentMat = mat(new THREE.Color(role.accent).getHex(), 0.72);

  const torso = makeBodyPart(bodyMat, 1.15, 1.65, 0.52, 0, 1.45, 0);
  group.add(torso);

  const waist = makeBodyPart(darkMat, 1.2, 0.52, 0.52, 0, 0.7, 0);
  group.add(waist);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 18), skinMat);
  head.position.y = 2.48;
  head.castShadow = true;
  head.receiveShadow = true;
  group.add(head);

  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.48, 22, 18, 0, Math.PI * 2, 0, Math.PI * 0.85), hairMat);
  hair.position.set(0, 2.9, -0.04);
  hair.scale.set(1.08, 1.15, 1.08);
  hair.castShadow = true;
  group.add(hair);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 0.1), mat(0x1d4ed8, 0.5, 0.25));
  visor.position.set(0, 2.48, 0.38);
  visor.castShadow = true;
  group.add(visor);

  const leftArm = makeBodyPart(bodyMat, 0.38, 1.25, 0.38, -0.82, 1.38, 0);
  const rightArm = makeBodyPart(bodyMat, 0.38, 1.25, 0.38, 0.82, 1.38, 0);
  group.add(leftArm, rightArm);

  const leftLeg = makeBodyPart(darkMat, 0.42, 1.35, 0.42, -0.28, -0.18, 0);
  const rightLeg = makeBodyPart(darkMat, 0.42, 1.35, 0.42, 0.28, -0.18, 0);
  group.add(leftLeg, rightLeg);

  const accent = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.15, 0.12), accentMat);
  accent.position.set(0.12, 1.35, 0.32);
  group.add(accent);

  const shoulderPadLeft = addBox(group, -0.73, 2.1, 0, 0.46, 0.28, 0.64, new THREE.MeshStandardMaterial({ color: 0x101827, roughness: 0.68 }));
  const shoulderPadRight = addBox(group, 0.73, 2.1, 0, 0.46, 0.28, 0.64, new THREE.MeshStandardMaterial({ color: 0x101827, roughness: 0.68 }));
  shoulderPadLeft.castShadow = true;
  shoulderPadRight.castShadow = true;

  if (roleKey === 'medic') {
    const badge = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.05, 12, 20), mat(0x93c5fd, 0.8));
    badge.position.set(-0.1, 2.05, 0.42);
    badge.rotation.x = Math.PI / 4;
    group.add(badge);
  }

  if (roleKey === 'orderly') {
    const visorGlint = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.05), mat(0x93c5fd, 0.4));
    visorGlint.position.set(0, 2.52, 0.44);
    group.add(visorGlint);
    const baton = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.6, 0.16), mat(0x94a3b8, 0.5));
    baton.position.set(1.08, 0.7, 0.3);
    baton.rotation.z = -0.7;
    group.add(baton);
  }

  if (roleKey === 'director') {
    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.13, 0.08), mat(0xfbbf24, 0.6));
    badge.position.set(0.12, 2.12, 0.44);
    group.add(badge);
  }

  if (roleKey === 'patient') {
    const shard = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.7, 4), mat(0xf1f5f9, 0.25));
    shard.position.set(0.8, 1.2, 0.35);
    shard.rotation.z = -1.2;
    group.add(shard);
  }

  group.scale.setScalar(isLocal ? 1.05 : 1.02);
  return group;
}

function generateRolePortraitSvg(roleKey) {
  const role = roles[roleKey] || roles.patient;
  const [a, b, c, d] = role.palette;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 420">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#040c16"/>
          <stop offset="100%" stop-color="${b}"/>
        </linearGradient>
        <linearGradient id="body" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="${a}"/>
          <stop offset="100%" stop-color="${c}"/>
        </linearGradient>
      </defs>
      <rect width="420" height="420" fill="url(#bg)" rx="32"/>
      <circle cx="140" cy="64" r="84" fill="rgba(255,255,255,0.08)"/>
      <rect x="104" y="110" width="210" height="260" rx="26" fill="rgba(15,23,42,0.55)" stroke="rgba(255,255,255,0.15)"/>
      <ellipse cx="208" cy="181" rx="75" ry="77" fill="#f3d2b7"/>
      <path d="M144 178c24-64 109-74 132 0v14c-16 18-42 30-66 30s-47-10-66-30v-14z" fill="${d}"/>
      <path d="M156 176c5-44 31-72 52-72s47 26 52 70" fill="none" stroke="${b}" stroke-width="16" stroke-linecap="round"/>
      <rect x="150" y="198" width="118" height="70" rx="28" fill="url(#body)"/>
      <rect x="165" y="تنا" width="90" height="100" rx="18" fill="none" opacity="0"/>
      <rect x="176" y="215" width="64" height="14" rx="7" fill="${b}"/>
      <circle cx="177" cy="193" r="10" fill="#0f172a"/>
      <circle cx="244" cy="193" r="10" fill="#0f172a"/>
      <circle cx="174" cy="190" r="4" fill="#ffffff"/>
      <circle cx="241" cy="190" r="4" fill="#ffffff"/>
      <path d="M177 230c14 18 34 24 57 0" fill="none" stroke="#0f172a" stroke-width="8" stroke-linecap="round"/>
      <rect x="152" y="265" width="28" height="86" rx="12" fill="${b}"/>
      <rect x="238" y="265" width="28" height="86" rx="12" fill="${b}"/>
      <rect x="178" y="265" width="28" height="86" rx="12" fill="${b}"/>
      <rect x="212" y="265" width="28" height="86" rx="12" fill="${b}"/>
      <path d="M128 290l26 28c6 7 18 5 22-4l9-29-57 5zm263 0l-26 28c-6 7-18 5-22-4l-9-29 57 5z" fill="rgba(255,255,255,0.08)"/>
      <text x="210" y="365" text-anchor="middle" font-size="28" fill="${d}" font-weight="700" letter-spacing="5">${role.badge}</text>
    </svg>
  `)}`;
}

function setupRoleCards() {
  const cardButtons = document.querySelectorAll('.roleButton');
  cardButtons.forEach((button) => {
    const roleKey = button.dataset.role;
    const art = button.querySelector('.role-card-art');
    if (art) {
      art.style.backgroundImage = `url("${generateRolePortraitSvg(roleKey)}")`;
    }
    button.addEventListener('click', () => chooseRole(roleKey));
  });
}

function setFloor(index) {
  player.floor = THREE.MathUtils.clamp(index, 0, 3);
  floors.forEach((floor, i) => {
    floor.visible = i === player.floor;
  });

  const base = floorY[player.floor];
  if (player.mesh) {
    player.mesh.position.set(player.x, base, player.z);
  }

  camera.position.set(player.x + Math.sin(yaw) * 18, base + 13, player.z + Math.cos(yaw) * 18);
  camera.lookAt(player.x, base + 1.4, player.z);

  const floorLabel = document.getElementById('floorLabel');
  if (floorLabel) {
    floorLabel.textContent = `Floor: ${floorNames[player.floor]}`;
  }
}

function updateHealth(health) {
  const healthFill = document.getElementById('healthFill');
  const healthText = document.getElementById('healthText');
  if (healthFill) {
    healthFill.style.width = `${health}%`;
  }
  if (healthText) {
    healthText.textContent = `${Math.round(health)} / 100%`;
  }
}

function populateEquipment(items) {
  const slots = document.getElementById('equipmentSlots');
  if (!slots) return;
  slots.replaceChildren();
  items.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'equipment-slot';
    button.textContent = `${index + 1}. ${item}`;
    button.addEventListener('click', () => {
      document.querySelectorAll('.equipment-slot').forEach((el) => el.classList.remove('selected'));
      button.classList.add('selected');
      socket.emit('equipItem', { item });
    });
    slots.appendChild(button);
  });
}

function chooseRole(role) {
  const selected = roles[role];
  if (!selected) return;

  player.role = role;
  player.name = document.getElementById('playerName')?.value.trim() || 'Player';
  player.x = selected.x;
  player.z = selected.z;

  document.querySelectorAll('.roleButton').forEach((button) => {
    button.classList.toggle('selected', button.dataset.role === role);
  });

  if (player.mesh) scene.remove(player.mesh);
  player.mesh = makePlayerCharacter(role, true);
  scene.add(player.mesh);

  setFloor(selected.floor);

  document.getElementById('roleLabel').textContent = `Role: ${selected.label}`;
  document.getElementById('statusLabel').textContent = `Ready: ${selected.label}`;

  const join = document.getElementById('joinScreen');
  if (join) join.classList.add('hidden');

  populateEquipment(selected.items);
  updateHealth(100);

  socket.emit('joinGame', {
    role,
    name: player.name,
    spawn: { x: player.x, z: player.z, floor: player.floor },
  });
}

const nameInput = document.getElementById('playerName');
if (nameInput) {
  nameInput.addEventListener('input', () => {
    player.name = nameInput.value.trim() || 'Player';
  });
}

socket.on('assignedPlayer', (data) => {
  if (!data) return;
  player.id = data.id;
  if (Number.isFinite(data.x)) player.x = data.x;
  if (Number.isFinite(data.z)) player.z = data.z;
  if (Number.isFinite(data.floor)) setFloor(data.floor);
});

socket.on('playersState', (list) => {
  const live = new Set(list.map((p) => p.id));
  for (const [id, mesh] of otherPlayers) {
    if (!live.has(id)) {
      scene.remove(mesh);
      otherPlayers.delete(id);
    }
  }

  for (const p of list) {
    if (p.id === player.id) continue;
    let mesh = otherPlayers.get(p.id);
    if (!mesh) {
      mesh = makePlayerCharacter(p.role || 'patient', false);
      otherPlayers.set(p.id, mesh);
      scene.add(mesh);
    }
    mesh.position.set(p.x, floorY[p.floor] ?? 0, p.z);
    mesh.visible = p.floor === player.floor;
  }
});

window.addEventListener('keydown', (event) => {
  keys[event.code] = true;

  if (event.code === 'KeyE' && player.role) {
    const nearStairs = Math.min(Math.hypot(player.x - 78, player.z), Math.hypot(player.x + 78, player.z)) < 12;
    if (nearStairs) {
      const nextFloor = player.floor === 3 ? 2 : (player.floor + 1) % 4;
      setFloor(nextFloor);
      socket.emit('updatePlayer', { x: player.x, y: floorY[player.floor], z: player.z, floor: player.floor });
    }
  }

  if (event.code === 'KeyQ' && player.role) {
    socket.emit('useAbility', { ability: 'ability' });
  }
});

window.addEventListener('keyup', (event) => {
  keys[event.code] = false;
});

renderer.domElement.addEventListener('pointerdown', (event) => {
  dragging = true;
  previousPointer = { x: event.clientX, y: event.clientY };
});

window.addEventListener('pointerup', () => {
  dragging = false;
  previousPointer = null;
});

window.addEventListener('pointermove', (event) => {
  if (!dragging || !previousPointer) return;
  yaw -= (event.clientX - previousPointer.x) * 0.005;
  pitch = THREE.MathUtils.clamp(pitch - (event.clientY - previousPointer.y) * 0.004, -0.35, 1.0);
  previousPointer = { x: event.clientX, y: event.clientY };
});

function updateJoystickFromPointer(clientX, clientY) {
  const pad = document.getElementById('movePad');
  const stick = document.getElementById('moveStick');
  if (!pad || !stick) return;

  const rect = pad.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  const radius = rect.width * 0.24;
  const len = Math.hypot(dx, dy);
  const clamped = Math.min(len, radius);
  const angle = Math.atan2(dy, dx);
  const nx = Math.cos(angle) * clamped;
  const ny = Math.sin(angle) * clamped;

  stick.style.transform = `translate(${nx - 22}px, ${ny - 22}px)`;
  mobile.dx = len > 0 ? (nx / radius) : 0;
  mobile.dy = len > 0 ? (ny / radius) : 0;
}

const joystickZone = document.getElementById('joystickZone');
const movePad = document.getElementById('movePad');
const moveStick = document.getElementById('moveStick');

if (joystickZone && movePad && moveStick) {
  joystickZone.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    mobile.active = true;
    mobile.pointerId = event.pointerId;
    const rect = joystickZone.getBoundingClientRect();
    const padX = rect.left + rect.width * 0.36;
    const padY = rect.top + rect.height * 0.64;
    movePad.style.left = `${padX - 68}px`;
    movePad.style.top = `${padY - 68}px`;
    movePad.classList.add('visible');
    updateJoystickFromPointer(event.clientX, event.clientY);
  });

  joystickZone.addEventListener('pointermove', (event) => {
    if (!mobile.active || event.pointerId !== mobile.pointerId) return;
    updateJoystickFromPointer(event.clientX, event.clientY);
  });

  joystickZone.addEventListener('pointerup', (event) => {
    if (event.pointerId !== mobile.pointerId) return;
    mobile.active = false;
    mobile.pointerId = null;
    movePad.classList.remove('visible');
    moveStick.style.transform = 'translate(-50%, -50%)';
    mobile.dx = 0;
    mobile.dy = 0;
  });

  joystickZone.addEventListener('pointerleave', () => {
    mobile.active = false;
    movePad.classList.remove('visible');
    moveStick.style.transform = 'translate(-50%, -50%)';
    mobile.dx = 0;
    mobile.dy = 0;
  });
}

const sprintButton = document.getElementById('sprintButton');
const interactButton = document.getElementById('interactButton');
const abilityButton = document.getElementById('abilityButton');

if (sprintButton) {
  sprintButton.addEventListener('pointerdown', () => {
    sprintButton.classList.add('active');
    keys.ShiftLeft = true;
  });
  sprintButton.addEventListener('pointerup', () => {
    sprintButton.classList.remove('active');
    keys.ShiftLeft = false;
  });
}

if (interactButton) {
  interactButton.addEventListener('pointerdown', () => {
    interactButton.classList.add('active');
    if (player.role) {
      const nearStairs = Math.min(Math.hypot(player.x - 78, player.z), Math.hypot(player.x + 78, player.z)) < 12;
      if (nearStairs) {
        const nextFloor = player.floor === 3 ? 2 : (player.floor + 1) % 4;
        setFloor(nextFloor);
        socket.emit('updatePlayer', { x: player.x, y: floorY[player.floor], z: player.z, floor: player.floor });
      }
    }
  });
  interactButton.addEventListener('pointerup', () => interactButton.classList.remove('active'));
}

if (abilityButton) {
  abilityButton.addEventListener('pointerdown', () => {
    abilityButton.classList.add('active');
    socket.emit('useAbility', { ability: player.role || 'ability' });
  });
  abilityButton.addEventListener('pointerup', () => abilityButton.classList.remove('active'));
}

document.getElementById('fullscreenButton')?.addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    console.warn('Fullscreen not available', error);
  }
});

function animate() {
  requestAnimationFrame(animate);

  const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (isTouch) {
    document.body.classList.add('touch-device');
  }

  const step = keys.ShiftLeft ? 0.42 : 0.22;

  if (player.role) {
    let forward = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    let sideways = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);

    if (mobile.active || Math.abs(mobile.dx) > 0.03 || Math.abs(mobile.dy) > 0.03) {
      forward = -mobile.dy;
      sideways = mobile.dx;
    }

    const length = Math.hypot(forward, sideways) || 1;
    forward /= length;
    sideways /= length;

    player.x += (Math.sin(yaw) * forward + Math.cos(yaw) * sideways) * step;
    player.z += (Math.cos(yaw) * forward - Math.sin(yaw) * sideways) * step;
    player.x = THREE.MathUtils.clamp(player.x, -86, 86);
    player.z = THREE.MathUtils.clamp(player.z, -62, 62);

    if (player.mesh) {
      player.mesh.position.set(player.x, floorY[player.floor], player.z);
      player.mesh.rotation.y = yaw + Math.PI;
    }

    camera.position.lerp(new THREE.Vector3(player.x + Math.sin(yaw) * 18, floorY[player.floor] + 13 + pitch * 4, player.z + Math.cos(yaw) * 18), 0.12);
    camera.lookAt(player.x, floorY[player.floor] + 1.4, player.z);

    socket.emit('updatePlayer', {
      x: player.x,
      y: floorY[player.floor],
      z: player.z,
      floor: player.floor,
    });
  }

  renderer.render(scene, camera);
}

setupRoleCards();
setFloor(0);
updateHealth(100);
animate();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
