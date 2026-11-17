import * as THREE from 'three';
import { makeItemModel, EffectLayer } from './item-visuals.js?v=20261117-6';
import { loadCharacterModels, buildCharacterModel } from './characters.js?v=20261115-2';
import { buildInterior, MAINS_LIGHTING } from './interior.js?v=20261117-1';
import { createWorld } from './world.js?v=20261117-9';

const ITEMS = window.ITEMS || {};
const LAYOUT = window.LAYOUT;

const socket = window.io ? io({ transports: ['websocket', 'polling'] }) : null;
const ROLES = {
  orderly: { name: 'Orderly', color: 0x2878d0, items: ['riotShield', 'taser', 'stunBaton', 'arrestCuffs', 'flashGrenade'], ability: 'Containment', maxHealth: 115 },
  medic: { name: 'Medic', color: 0x35b987, items: ['smallMedicalKit', 'mediumMedicalKit', 'fireExtinguisher', 'mediGun', 'straitjacket'], ability: 'Field treatment', maxHealth: 100 },
  director: { name: 'Facility Director', color: 0x9670d5, items: ['stunBaton', 'shockShield', 'arrestCuffs', 'tablet', 'hostileDetector'], ability: 'Override access', maxHealth: 100 },
  patient: { name: 'Patient', color: 0xc85953, items: ['glassShard', 'shove'], ability: 'Adrenaline', maxHealth: 100 },
};
for (const [role, def] of Object.entries(ROLES)) Object.assign(def, LAYOUT.SPAWNS[role]);
// Floors, staircases and the building itself come from layout.js, which the server shares.
const { FLOOR_Y, FLOOR_NAMES, STAIRS, BOUNDS, WALL_HEIGHT } = LAYOUT;
const GRAVITY = 30;
const JUMP_SPEED = 10.5;
const PLAYER_RADIUS = 0.6;
const CAMERA_PRESETS = LAYOUT.CAMERAS;
// Third person orbits behind the character; first person looks out of its eyes.
const CAMERA = {
  // Pitch is where the player looks: positive is up. Looking up in third person lowers the camera.
  third: { fov: 62, minPitch: -0.95, maxPitch: 0.35, pitch: -0.32, distance: 7.5, minDistance: 2.6, maxDistance: 11 },
  first: { fov: 74, minPitch: -1.35, maxPitch: 1.35, pitch: -0.05 },
};
const storedCameraMode = (() => { try { return localStorage.getItem('asylumCameraMode'); } catch (_) { return null; } })();
const state = {
  role: null, id: null, x: 0, z: 0, floor: 0, yaw: 0, pitch: CAMERA.third.pitch, actor: null, health: 100, maxHealth: 100, items: [], equipped: null, view: null,
  cameraMode: storedCameraMode === 'first' ? 'first' : 'third', zoom: CAMERA.third.distance, cameraDistance: CAMERA.third.distance,
  // Combat status from the server, converted to local performance.now() deadlines.
  stunnedUntil: 0, downUntil: 0, slowedUntil: 0, rootedUntil: 0, ragingUntil: 0, boostedUntil: 0, speed: 1, look: null,
  jammed: false, armor: false, mask: false, carrying: false, carried: false,
  // Height of the steps underfoot, and how far above them a jump has taken you.
  ground: 0, air: 0, vy: 0, jumpQueued: false, sprinting: false, stamina: 100, maxStamina: 100, exhausted: false, sprintingNow: false,
};
const keys = new Set();
const remoteActors = new Map();
const joystick = { active: false, pointer: null, x: 0, y: 0 };
const sessionToken = (() => {
  const create = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    const stored = sessionStorage.getItem('asylumSession') || create();
    sessionStorage.setItem('asylumSession', stored);
    return stored;
  } catch (_) { return create(); }
})();
let lastNetworkUpdate = 0;
let lastCameraPointer = null;
let noticeTimer = 0;
let visibleFloor = -1;
let visibleFloors = new Set();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1016);
scene.fog = new THREE.Fog(0x1a2026, 60, 170);
const camera = new THREE.PerspectiveCamera(CAMERA.third.fov, innerWidth / innerHeight, 0.08, 400);
scene.add(camera); // The first-person view model hangs off the camera.
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
const isTouch = window.matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Indoors: a soft fluorescent wash from above, plus a near-vertical key light that follows the
// player so characters and furniture get crisp contact shadows without the walls striping the floor.
const hemiLight = new THREE.HemisphereLight(0xeef6ff, 0x5b5f5c, 1.75);
const ambientLight = new THREE.AmbientLight(0xdfe8ef, 0.35);
scene.add(hemiLight, ambientLight);
const keyLight = new THREE.DirectionalLight(0xfff4e2, 1.6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.setScalar(isTouch ? 1024 : 2048);
Object.assign(keyLight.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 80 });
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.04;
scene.add(keyLight, keyLight.target);
function moveKeyLight(x, y, z) {
  keyLight.target.position.set(x, y, z);
  keyLight.position.set(x + 7, y + 40, z + 5);
}
moveKeyLight(0, 0, 0);

// One shared unit box and cached materials: every box is just a scaled mesh, so characters that
// leave the game do not leak GPU buffers and the map does not allocate hundreds of geometries.
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const materialCache = new Map();
function standard(color, roughness = 0.8, metalness = 0.03) {
  const key = `${color}|${roughness}|${metalness}`;
  if (!materialCache.has(key)) materialCache.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  return materialCache.get(key);
}
const floors = [];
// Furniture and walls block movement; the boxes come from layout.js.
const colliders = LAYOUT.solids;
function addBox(parent, x, y, z, w, h, d, materialOrColor, options = {}) {
  const material = materialOrColor?.isMaterial ? materialOrColor : standard(materialOrColor, options.roughness, options.metalness);
  const mesh = new THREE.Mesh(UNIT_BOX, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(w, h, d);
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
for (let i = 0; i < FLOOR_Y.length; i++) {
  floors[i] = new THREE.Group(); floors[i].visible = false; scene.add(floors[i]);
}
buildInterior(floors);

// Swap the blocky stand-ins for the real models as soon as each one has loaded.
loadCharacterModels(role => {
  if (state.actor && (state.look || state.role) === role) {
    const old = state.actor;
    state.actor = makeCharacter(role); scene.add(state.actor); scene.remove(old);
    applyActorStatus(state.actor, { equippedItem: state.equipped, stunned: isStunned(), down: isDown() });
  }
  for (const [id, actor] of remoteActors) {
    if (actor.userData.role !== role) continue;
    const next = makeCharacter(role);
    next.position.copy(actor.position);
    next.userData.target = actor.userData.target;
    scene.remove(actor); scene.add(next); remoteActors.set(id, next);
    if (next.userData.target) applyActorStatus(next, next.userData.target);
  }
});
const effects = new EffectLayer({ floors, floorY: FLOOR_Y, actorFor: id => (id === state.id ? state.actor : remoteActors.get(id)) });
// Full white for the first part of the flash, then a slow fade back to normal sight.
function updateBlind(now) {
  const overlay = document.getElementById('flashBlind');
  if (!state.blindUntil || now >= state.blindUntil) {
    if (overlay.style.opacity !== '0') overlay.style.opacity = '0';
    state.blindStrength = 0;
    return;
  }
  const progress = (now - state.blindStart) / (state.blindUntil - state.blindStart);
  const fade = progress < 0.35 ? 1 : 1 - (progress - 0.35) / 0.65;
  overlay.style.opacity = String(state.blindStrength * fade * fade);
}
function flashDamage() {
  const overlay = document.getElementById('damageFlash');
  overlay.classList.remove('visible'); void overlay.offsetWidth; overlay.classList.add('visible');
}

function blocked(x, z, floor) {
  return colliders[floor].some(box => x + PLAYER_RADIUS > box.minX && x - PLAYER_RADIUS < box.maxX && z + PLAYER_RADIUS > box.minZ && z - PLAYER_RADIUS < box.maxZ);
}

// Patients hiding as a box or a shrub. Props still need the arm and hand a character has, so the
// usual animation and held-item code keeps working; both just stay hidden.
const PROPS = {
  box: root => {
    addBox(root, 0, 1.1, 0, 2.2, 2.2, 2.2, 0xb98a55);
    addBox(root, 0, 2.21, 0, 2.22, 0.02, 0.3, 0xd8c08f, { castShadow: false });
    addBox(root, 0.6, 1.4, 1.11, 0.6, 0.4, 0.02, 0x8a6236, { castShadow: false });
  },
  bush: root => {
    addBox(root, 0, 0.5, 0, 1.3, 1, 1.3, 0x9a5b3a);
    addBox(root, 0, 1.7, 0, 2, 1.6, 2, 0x3f8f46);
    addBox(root, 0.3, 2.7, -0.2, 1.3, 0.9, 1.3, 0x4fa357);
    addBox(root, -0.5, 2.3, 0.4, 0.9, 0.8, 0.9, 0x357a3c);
  },
};
function makeProp(kind) {
  const root = new THREE.Group();
  PROPS[kind](root);
  const arm = new THREE.Group(); arm.visible = false; root.add(arm);
  const hand = new THREE.Group(); arm.add(hand);
  Object.assign(root.userData, { arm, hand, height: kind === 'bush' ? 3.2 : 2.2, prop: true });
  return root;
}
function makeCharacter(roleKey) {
  const model = PROPS[roleKey] ? null : buildCharacterModel(roleKey);
  const root = PROPS[roleKey] ? makeProp(roleKey) : model ? model.root : makeBlockCharacter(roleKey);
  if (model) Object.assign(root.userData, model);
  root.userData.role = roleKey;
  root.userData.height ??= 3.2;
  root.rotation.order = 'YXZ'; // Knocked-out characters tip over relative to where they face.
  // Spinning stars over the head while stunned.
  const stars = new THREE.Group(); stars.position.y = root.userData.height + 0.4; stars.visible = false; root.add(stars);
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    addBox(stars, Math.cos(angle) * 0.6, 0, Math.sin(angle) * 0.6, 0.2, 0.2, 0.2, starMaterial, { castShadow: false });
  }
  root.userData.stars = stars;
  return root;
}
// Blocky stand-in, used until the role's 3D model has loaded (or if it fails to load).
function makeBlockCharacter(roleKey) {
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
  // The item arm hangs from a shoulder pivot so it can swing; held items attach to its hand.
  const arm = new THREE.Group(); arm.position.set(0.77, 1.97, 0); root.add(arm);
  addBox(arm, 0, -0.53, 0, 0.37, 1.06, 0.42, uniform);
  const hand = new THREE.Group(); hand.position.set(0, -1.0, 0.12); arm.add(hand);
  root.userData.arm = arm; root.userData.hand = hand;
  addPart(0, 2.62, 0.02, 0.82, 0.82, 0.74, skin);
  addPart(0, 3.07, -0.01, 0.86, 0.22, 0.78, roleKey === 'medic' ? 0x7d463c : 0x1b2532);
  addPart(-0.18, 2.65, 0.4, 0.085, 0.09, 0.045, 0x101820);
  addPart(0.18, 2.65, 0.4, 0.085, 0.09, 0.045, 0x101820);
  addPart(0, 1.68, 0.33, 0.56, 0.14, 0.07, roleKey === 'director' ? 0xf4c45f : 0xdcebf3);
  if (roleKey === 'orderly') {
    addPart(0, 2.65, 0.45, 0.62, 0.14, 0.06, 0x168fd0);
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
    addPart(-0.36, 1.7, 0.31, 0.25, 0.08, 0.05, 0xb96851);
  }
  return root;
}
const starMaterial = new THREE.MeshBasicMaterial({ color: 0xffe066 });
const barBackMaterial = new THREE.MeshBasicMaterial({ color: 0x14202b, transparent: true, opacity: 0.8, depthTest: false });
const barFillMaterial = new THREE.MeshBasicMaterial({ color: 0x5af07f, depthTest: false });
const barLowMaterial = new THREE.MeshBasicMaterial({ color: 0xf06a4f, depthTest: false });
const BAR_PLANE = new THREE.PlaneGeometry(1, 1);
// Floating health bar for other players, only shown once they are hurt.
function healthBar(actor) {
  if (actor.userData.bar) return actor.userData.bar;
  const bar = new THREE.Group(); bar.position.y = actor.userData.height + 0.75; bar.renderOrder = 10;
  const back = new THREE.Mesh(BAR_PLANE, barBackMaterial); back.scale.set(1.7, 0.24, 1); back.renderOrder = 10;
  const fill = new THREE.Mesh(BAR_PLANE, barFillMaterial); fill.position.z = 0.01; fill.renderOrder = 11;
  bar.add(back, fill); bar.userData.fill = fill;
  actor.add(bar); actor.userData.bar = bar;
  return bar;
}
const SHIELD_REACH = 0.8;
function frontMount(actor) {
  if (!actor.userData.front) {
    const front = new THREE.Group();
    front.position.set(0, actor.userData.height * 0.5, SHIELD_REACH);
    actor.add(front); actor.userData.front = front;
  }
  return actor.userData.front;
}
// Shows what a character holds and whether it is stunned, knocked out or hurt.
function applyActorStatus(actor, status) {
  const item = status.equippedItem ?? null;
  if (actor.userData.item !== item) {
    actor.userData.item = item;
    actor.userData.hand.clear();
    actor.userData.front?.clear();
    // Shields are carried squarely in front of the body; everything else sits in the hand.
    if (item && ITEMS[item]?.shield) frontMount(actor).add(makeItemModel(item, ITEMS[item].color));
    else if (item && ITEMS[item]) actor.userData.hand.add(makeItemModel(item, ITEMS[item].color, { held: true }));
  }
  actor.userData.down = Boolean(status.down);
  actor.userData.carried = Boolean(status.carried);
  actor.userData.stars.visible = Boolean(status.stunned) && !status.down;
  actor.userData.raging = Boolean(status.raging);
  if (Number.isFinite(status.health) && Number.isFinite(status.maxHealth) && actor !== state.actor) {
    // A hurt prop would give itself away with a health bar.
    const hurt = status.health < status.maxHealth && !status.down && !actor.userData.prop;
    const bar = healthBar(actor); bar.visible = hurt;
    const ratio = Math.max(0, status.health / status.maxHealth);
    bar.userData.fill.scale.set(1.6 * ratio, 0.16, 1);
    bar.userData.fill.position.x = -0.8 * (1 - ratio);
    bar.userData.fill.material = ratio < 0.35 ? barLowMaterial : barFillMaterial;
  }
}
// Per-frame pose: arm swing, lying down when knocked out, spinning stars, bars facing the camera.
const barQuaternion = new THREE.Quaternion();
function animateActor(actor, dt, baseY) {
  const data = actor.userData;
  // Walk cycle driven by how far the character actually moved, so remote players animate too.
  const moved = data.lastX === undefined ? 0 : Math.hypot(actor.position.x - data.lastX, actor.position.z - data.lastZ);
  data.lastX = actor.position.x; data.lastZ = actor.position.z;
  const speed = dt > 0 ? Math.min(moved / dt, 20) : 0;
  const walking = speed > 0.6 && !data.down && !data.stars.visible;
  data.stride = THREE.MathUtils.lerp(data.stride || 0, walking ? Math.min(1, speed / 9) : 0, 1 - Math.exp(-10 * dt));
  data.phase = ((data.phase || 0) + dt * (4 + speed * 0.55)) % (Math.PI * 2);
  data.time = (data.time || 0) + dt;
  const swingAngle = Math.sin(data.phase) * 0.85 * data.stride;
  const idle = Math.sin(data.time * 1.8) * 0.04 * (1 - data.stride);
  data.swing = Math.max(0, (data.swing || 0) - dt);
  const attack = data.swing > 0 ? -Math.sin((data.swing / 0.3) * Math.PI) * 1.7 : 0;
  // Holding something keeps the item arm raised a little so the item points forward.
  const holding = data.item ? -0.35 : 0;
  data.arm.rotation.x = attack || (holding + swingAngle * (data.item ? 0.4 : 1) + idle);
  // A shield bash shoves the shield forward instead of swinging the arm.
  if (data.front) data.front.position.z = SHIELD_REACH + (data.swing > 0 ? Math.sin((data.swing / 0.3) * Math.PI) * 0.6 : 0);
  if (data.armL) data.armL.rotation.x = -swingAngle - idle;
  if (data.legR) { data.legR.rotation.x = -swingAngle; data.legL.rotation.x = swingAngle; }
  if (data.head) data.head.rotation.y = data.stars.visible ? Math.sin(data.time * 6) * 0.25 : 0;
  // Carried players hang over the carrier's shoulder; berserk players shake with anger.
  actor.rotation.x = data.down ? -Math.PI / 2 : data.carried ? -Math.PI / 2.4 : 0;
  if (data.raging && !data.down) actor.rotation.z = Math.sin(data.time * 40) * 0.03; else actor.rotation.z = 0;
  actor.position.y = baseY + (data.down ? 0.45 : Math.abs(Math.sin(data.phase)) * 0.08 * data.stride);
  if (data.stars.visible) data.stars.rotation.y += dt * 5;
  if (data.bar?.visible) data.bar.quaternion.copy(actor.getWorldQuaternion(barQuaternion).invert().multiply(camera.quaternion));
}

function showNotice(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => toast.classList.remove('visible'), 1900);
}
// The main floor, plus any floor seen through a staircase next to the player.
function showFloor(index, extra = []) {
  const next = new Set([index, ...extra]);
  if (index === visibleFloor && next.size === visibleFloors.size && [...next].every(i => visibleFloors.has(i))) return;
  visibleFloor = index; visibleFloors = next;
  floors.forEach((floor, i) => { floor.visible = next.has(i); });
}
function setFloor(index) {
  state.floor = THREE.MathUtils.clamp(index, 0, FLOOR_Y.length - 1);
  if (!state.view) showFloor(state.floor);
  state.ground = LAYOUT.stairHeight(state.floor, state.x, state.z);
  if (state.actor) state.actor.position.set(state.x, FLOOR_Y[state.floor] + state.ground, state.z);
  document.getElementById('floorLabel').textContent = `FLOOR · ${FLOOR_NAMES[state.floor]}`;
  updateCamera(1);
}
// How far a ray from (px, pz) along (dx, dz) gets before it would come within `margin` of a wall.
function clearDistance(floor, px, pz, dx, dz, max, margin = 0.35) {
  let best = max;
  for (const box of colliders[floor]) {
    if (!box.tall) continue;
    let t0 = 0, t1 = best, hit = true;
    for (const [p, d, min, max] of [[px, dx, box.minX - margin, box.maxX + margin], [pz, dz, box.minZ - margin, box.maxZ + margin]]) {
      if (Math.abs(d) < 1e-6) { if (p < min || p > max) { hit = false; break; } continue; }
      let a = (min - p) / d, b = (max - p) / d;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) { hit = false; break; }
    }
    if (hit) best = Math.max(0, t0);
  }
  return best;
}
// How far the camera can back away and up from the pivot before it meets a ceiling. Over a staircase
// opening the ceiling is the next floor's, so the camera can follow you up the steps.
function ceilingReach(floorY, pivotY, up, across, max) {
  const low = floorY + WALL_HEIGHT - 0.35;
  const openings = FLOOR_Y[state.floor + 1] === undefined ? [] : STAIRS.filter(stair => stair.floor === state.floor).map(LAYOUT.stairBody)
    .filter(box => state.x > box.minX - 12 && state.x < box.maxX + 12 && state.z > box.minZ - 12 && state.z < box.maxZ + 12);
  if (!openings.length) return (low - pivotY) / up;
  const high = FLOOR_Y[state.floor + 1] + WALL_HEIGHT - 0.35;
  const dx = Math.sin(state.yaw) * across, dz = Math.cos(state.yaw) * across;
  for (let d = 0; d <= max; d += 0.2) {
    const x = state.x + dx * d, z = state.z + dz * d;
    const open = openings.some(box => x > box.minX && x < box.maxX && z > box.minZ && z < box.maxZ);
    if (pivotY + up * d > (open ? high : low)) return Math.max(0, d - 0.2);
  }
  return max;
}
const lookTarget = new THREE.Vector3();
function updateCamera(alpha) {
  // Tablet cameras hang under the ceiling in a corner of the room and look across it.
  if (state.view) {
    const view = state.view, y = FLOOR_Y[view.floor];
    camera.position.set(view.x, y + WALL_HEIGHT - 1.1, view.z);
    camera.lookAt(view.tx, y + 1, view.tz);
    return;
  }
  const floorY = FLOOR_Y[state.floor], y = floorY + state.ground + state.air;
  const height = state.actor?.userData.height ?? 3;
  const cos = Math.cos(state.pitch), sin = Math.sin(state.pitch);
  if (state.cameraMode === 'first') {
    const data = state.actor?.userData;
    const bob = data ? Math.sin((data.phase || 0) * 2) * 0.07 * (data.stride || 0) : 0;
    camera.position.set(state.x, y + height * 0.88 + bob, state.z);
    lookTarget.set(state.x - Math.sin(state.yaw) * cos, camera.position.y + sin, state.z - Math.cos(state.yaw) * cos);
    camera.lookAt(lookTarget);
    return;
  }
  // Third person: orbit behind the character, pulled in so walls and the ceiling never get in between.
  const pivotY = y + height * 0.92;
  const elevation = -state.pitch, up = Math.sin(elevation), across = Math.cos(elevation);
  let distance = state.zoom;
  const reach = clearDistance(state.floor, state.x, state.z, Math.sin(state.yaw), Math.cos(state.yaw), distance * across);
  if (across > 0.05) distance = Math.min(distance, reach / across);
  if (up > 0.01) distance = Math.min(distance, ceilingReach(floorY, pivotY, up, across, distance));
  if (up < -0.01) distance = Math.min(distance, (floorY + 0.45 - pivotY) / up);
  distance = Math.max(0.3, distance);
  // Snap in when something blocks the view, ease back out once it is clear.
  state.cameraDistance = distance < state.cameraDistance ? distance : THREE.MathUtils.lerp(state.cameraDistance, distance, alpha);
  const d = state.cameraDistance;
  camera.position.set(state.x + Math.sin(state.yaw) * across * d, pivotY + up * d, state.z + Math.cos(state.yaw) * across * d);
  camera.lookAt(state.x, pivotY, state.z);
}
// First person shows the held item (and a sleeve) in the lower right of the screen.
const viewModel = new THREE.Group();
const VIEW_MODEL_AT = new THREE.Vector3(0.62, -0.62, -1.3);
viewModel.position.copy(VIEW_MODEL_AT);
camera.add(viewModel);
function syncViewModel() {
  viewModel.clear();
  viewModel.userData.item = state.equipped;
  if (!state.role || !state.equipped || !ITEMS[state.equipped]) return;
  if (ITEMS[state.equipped].shield) {
    // Held up in front of you, centred, covering the lower part of the view.
    const model = makeItemModel(state.equipped, ITEMS[state.equipped].color);
    model.rotation.y = Math.PI;
    model.scale.setScalar(0.7);
    model.position.set(-VIEW_MODEL_AT.x, -0.45, -0.25);
    model.traverse(child => { child.castShadow = false; });
    viewModel.add(model);
    return;
  }
  const sleeve = standard(ROLES[state.look || state.role]?.color ?? 0x777777, 0.7);
  const arm = addBox(viewModel, 0.05, -0.16, 0.5, 0.2, 0.2, 0.9, sleeve, { castShadow: false });
  arm.rotation.x = 0.3;
  addBox(viewModel, 0.03, -0.02, 0, 0.17, 0.17, 0.2, standard(0xe9bd9e, 0.9), { castShadow: false });
  {
    const model = makeItemModel(state.equipped, ITEMS[state.equipped].color, { held: true });
    model.rotation.y = Math.PI; // Item models point along +z; the camera looks along -z.
    model.position.set(0.02, 0.08, -0.1);
    model.traverse(child => { child.castShadow = false; });
    viewModel.add(model);
  }
}
function animateViewModel(dt) {
  const data = state.actor?.userData;
  viewModel.visible = state.cameraMode === 'first' && !state.view && viewModel.children.length > 0 && !isDown();
  if (!data || !viewModel.visible) return;
  const swing = data.swing > 0 ? Math.sin((data.swing / 0.3) * Math.PI) : 0;
  const sway = Math.sin(data.phase || 0) * 0.03 * (data.stride || 0);
  viewModel.position.set(VIEW_MODEL_AT.x + sway, VIEW_MODEL_AT.y - Math.abs(sway) * 0.6 - swing * 0.05, VIEW_MODEL_AT.z - swing * 0.3);
  viewModel.rotation.set(-swing * 1.1, swing * 0.35, 0);
}
const canPointerLock = !isTouch && typeof renderer.domElement.requestPointerLock === 'function';
const pointerLocked = () => document.pointerLockElement === renderer.domElement;
function setCameraMode(mode, announce = true) {
  if (mode !== 'first' && mode !== 'third') return;
  const changed = mode !== state.cameraMode;
  state.cameraMode = mode;
  const config = CAMERA[mode];
  if (changed) state.pitch = config.pitch;
  if (mode === 'third') { state.zoom = Math.max(state.zoom, 4); state.cameraDistance = 0.5; }
  camera.fov = config.fov; camera.updateProjectionMatrix();
  if (mode === 'third' && pointerLocked()) document.exitPointerLock();
  document.body.classList.toggle('first-person', mode === 'first');
  const button = document.getElementById('viewButton');
  if (button) button.textContent = mode === 'first' ? '1ST' : '3RD';
  try { localStorage.setItem('asylumCameraMode', mode); } catch (_) {}
  if (changed && announce && state.role) showNotice(mode === 'first' ? `First person${canPointerLock ? ' · click locks the mouse, Esc frees it' : ''}` : 'Third person');
}
function turnCamera(dx, dy) {
  const config = CAMERA[state.cameraMode];
  state.yaw -= dx * 0.006;
  state.pitch = THREE.MathUtils.clamp(state.pitch - dy * 0.004, config.minPitch, config.maxPitch);
}
function setHealth(value, max = state.maxHealth) {
  state.maxHealth = max;
  state.health = THREE.MathUtils.clamp(Number(value) || 0, 0, max);
  document.getElementById('healthText').textContent = `${Math.round(state.health)} / ${max}`;
  document.getElementById('healthFill').style.width = `${(state.health / max) * 100}%`;
}
function sendJoin() {
  if (!socket || !socket.connected || !state.role) return;
  socket.emit('joinGame', { role: state.role, name: document.getElementById('playerName').value.trim() || 'Player', session: sessionToken });
}
function sendPosition() {
  lastNetworkUpdate = performance.now();
  socket?.emit('updatePlayer', { x: state.x, z: state.z, floor: state.floor, yaw: state.yaw, air: state.air, sprint: state.sprintingNow });
}
function setStamina(data) {
  state.stamina = Number(data.value) || 0; state.maxStamina = Number(data.max) || 100;
  const wasExhausted = state.exhausted;
  state.exhausted = Boolean(data.exhausted);
  if (state.exhausted && !wasExhausted) showNotice('Out of breath');
  const fill = document.getElementById('staminaFill');
  fill.style.width = `${(state.stamina / state.maxStamina) * 100}%`;
  fill.classList.toggle('exhausted', state.exhausted);
}
function readableItem(item) {
  return ITEMS[item]?.name ?? item.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
}
function selectItem(item) {
  state.equipped = item;
  document.querySelectorAll('.equipment-slot').forEach(el => el.classList.toggle('selected', el.dataset.item === item));
  document.getElementById('tabletPanel').classList.toggle('hidden', item !== 'tablet');
  if (item !== 'tablet') setView(null);
  else if (pointerLocked()) document.exitPointerLock(); // The camera list needs the mouse.
  if (state.actor) applyActorStatus(state.actor, { equippedItem: item, stunned: isStunned(), down: isDown() });
  if (viewModel.userData.item !== item) syncViewModel();
}
// Slots are { item, uses, cooldown } from the server; plain item names work before it answers.
function renderSlots(slotsData) {
  const items = slotsData.map(slot => (typeof slot === 'string' ? { item: slot, uses: ITEMS[slot]?.uses ?? null, cooldown: 0 } : slot));
  const now = performance.now();
  const signature = items.map(slot => slot.item).join('|');
  const slots = document.getElementById('equipmentSlots');
  if (signature !== state.slotSignature) {
    state.slotSignature = signature;
    slots.replaceChildren();
    items.forEach((slot, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'equipment-slot'; button.dataset.item = slot.item;
      const number = document.createElement('span'); number.className = 'slot-number'; number.textContent = String(index + 1);
      const label = document.createElement('span'); label.className = 'slot-label'; label.textContent = readableItem(slot.item);
      const uses = document.createElement('span'); uses.className = 'slot-uses';
      const cooldown = document.createElement('span'); cooldown.className = 'slot-cooldown';
      button.append(number, label, uses, cooldown);
      button.addEventListener('click', () => equip(slot.item));
      slots.appendChild(button);
    });
  }
  state.items = items.map(slot => ({ ...slot, readyAt: now + (slot.cooldown || 0), total: (ITEMS[slot.item]?.cooldown ?? 0) * 1000 }));
  slots.querySelectorAll('.equipment-slot').forEach((button, index) => {
    const slot = items[index];
    button.querySelector('.slot-uses').textContent = slot?.uses != null ? `×${slot.uses}` : '';
    button.classList.toggle('selected', button.dataset.item === state.equipped);
  });
  if (state.equipped && !items.some(slot => slot.item === state.equipped)) selectItem(null);
}
function equip(item) {
  // Picking the item that is already in hand puts it away again.
  const next = state.equipped === item ? null : item;
  selectItem(next);
  socket?.emit('equipItem', { item: next });
}
function updateSlotCooldowns(now) {
  const buttons = document.querySelectorAll('.equipment-slot');
  state.items.forEach((slot, index) => {
    const bar = buttons[index]?.querySelector('.slot-cooldown'); if (!bar) return;
    const left = slot.readyAt - now;
    bar.style.transform = `scaleX(${left > 0 && slot.total > 0 ? Math.min(1, left / slot.total) : 0})`;
  });
}
const isStunned = () => performance.now() < Math.max(state.stunnedUntil, state.downUntil);
const isDown = () => performance.now() < state.downUntil;
function useItem() {
  if (!state.role || !state.equipped || state.view) return;
  const def = ITEMS[state.equipped];
  if (!def || def.kind === 'tool') return;
  if (isStunned()) { showNotice(isDown() ? 'You are knocked out' : 'You are stunned'); return; }
  const slot = state.items.find(entry => entry.item === state.equipped);
  if (slot && slot.readyAt > performance.now()) return;
  if (!socket?.connected) { showNotice('Items need the server connection'); return; }
  // Swing immediately so melee feels responsive; the server decides what it hit.
  if (def.kind === 'melee' || def.kind === 'push') state.actor.userData.swing = 0.3;
  if (def.electric && state.jammed) { showNotice('Signal jammed · electronics are down here'); return; }
  socket.emit('useItem', { yaw: state.yaw });
}
function applySelfState(data) {
  const now = performance.now();
  if (Number.isFinite(data.health) && Number.isFinite(data.maxHealth)) setHealth(data.health, data.maxHealth);
  if (Array.isArray(data.inventory)) renderSlots(data.inventory.filter(slot => slot && typeof slot.item === 'string'));
  if (data.equippedItem !== undefined && data.equippedItem !== state.equipped) selectItem(data.equippedItem);
  const wasDown = isDown();
  state.stunnedUntil = now + (Number(data.stunned) || 0);
  state.downUntil = now + (Number(data.down) || 0);
  state.slowedUntil = now + (Number(data.slowed) || 0);
  state.rootedUntil = now + (Number(data.rooted) || 0);
  state.ragingUntil = now + (Number(data.raging) || 0);
  state.boostedUntil = now + (Number(data.boosted) || 0);
  state.speed = Number(data.speed) || 1;
  for (const flag of ['armor', 'mask', 'nightVision', 'carrying', 'carried']) state[flag] = Boolean(data[flag]);
  const wasJammed = state.jammed;
  state.jammed = Boolean(data.jammed);
  // Security cameras go dark inside an enemy jammer.
  if (state.jammed && !wasJammed && state.view) { setView(null); showNotice('Signal jammed · cameras offline'); }
  if (!wasDown && isDown()) showNotice('Knocked out · respawning');
  const look = data.look ?? null;
  if (look !== state.look && state.role) {
    state.look = look;
    // Disguised players see themselves in the borrowed uniform, just like everyone else does.
    state.actor?.parent?.remove(state.actor);
    state.actor = makeCharacter(look || state.role); scene.add(state.actor);
    state.actor.userData.item = undefined;
    syncViewModel();
  }
  if (state.actor) applyActorStatus(state.actor, { equippedItem: state.equipped, stunned: isStunned(), down: isDown(), raging: now < state.ragingUntil, carried: state.carried });
  updateStatusEffect();
  world.applySelf(data);
}
function updateStatusEffect() {
  const now = performance.now();
  const element = document.getElementById('statusEffect');
  const seconds = until => `${Math.ceil((until - now) / 1000)}s`;
  const bad = [], good = [];
  if (now < state.downUntil) bad.push(`Knocked out · ${seconds(state.downUntil)}`);
  else if (state.carried) bad.push('Being carried');
  else if (now < state.stunnedUntil) bad.push(`Stunned · ${seconds(state.stunnedUntil)}`);
  if (now < state.rootedUntil) bad.push(`Netted · ${seconds(state.rootedUntil)}`);
  if (now < state.slowedUntil) bad.push('Slowed');
  if (state.jammed) bad.push('Jammed');
  if (now < state.ragingUntil) good.push(`Berserk · ${seconds(state.ragingUntil)}`);
  if (now < state.boostedUntil) good.push('Speed boost');
  if (state.carrying) good.push('Carrying');
  if (state.look === 'box' || state.look === 'bush') good.push('Hidden');
  else if (state.look) good.push('Disguised');
  if (state.armor) good.push('Vest');
  if (state.mask) good.push('Gas mask');
  if (state.nightVision) good.push('Night vision');
  const text = [...bad, ...good].join(' · ');
  if (element.textContent !== text) element.textContent = text;
  element.classList.toggle('visible', Boolean(text));
  element.classList.toggle('bad', bad.length > 0);
}
function setView(preset) {
  state.view = preset;
  document.querySelectorAll('.camera-preset').forEach(el => el.classList.toggle('active', el.dataset.label === preset?.label));
  showFloor(preset ? preset.floor : state.floor);
  updateCamera(1);
}
function renderCameraPresets() {
  const host = document.getElementById('cameraPresets');
  host.replaceChildren();
  for (const preset of [...CAMERA_PRESETS, null]) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'camera-preset';
    button.dataset.label = preset?.label ?? 'live';
    button.textContent = preset?.label ?? 'Live';
    button.addEventListener('click', () => {
      if (preset && state.jammed) { showNotice('Signal jammed · cameras offline'); return; }
      setView(preset);
    });
    host.appendChild(button);
  }
}
renderCameraPresets();

function chooseRole(roleKey) {
  const role = ROLES[roleKey]; if (!role) return;
  state.role = roleKey; state.x = role.x; state.z = role.z;
  Object.assign(state, {
    look: null, stunnedUntil: 0, downUntil: 0, slowedUntil: 0, rootedUntil: 0, ragingUntil: 0, boostedUntil: 0, speed: 1, slotSignature: null, air: 0, vy: 0,
    jammed: false, armor: false, mask: false, carrying: false, carried: false,
  });
  state.actor?.parent?.remove(state.actor);
  state.actor = makeCharacter(roleKey); scene.add(state.actor);
  syncViewModel();
  setView(null);
  setFloor(role.floor);
  document.getElementById('roleLabel').textContent = `ROLE · ${role.name.toUpperCase()}`;
  document.getElementById('statusLabel').textContent = socket?.connected ? 'NETWORK · CONNECTED' : 'LOCAL · CONNECTING';
  document.getElementById('objectiveText').textContent = roleKey === 'patient' ? 'Reach the ground-floor exit and escape.' : 'Secure the facility and restore containment.';
  updateStairHint();
  document.getElementById('joinScreen').classList.add('hidden');
  document.body.classList.add('in-game');
  renderSlots(role.items);
  selectItem(null);
  setHealth(role.maxHealth, role.maxHealth);
  sendJoin();
}
function leaveToJoinScreen(message) {
  state.role = null;
  world.reset();
  state.actor?.parent?.remove(state.actor); state.actor = null;
  selectItem(null);
  document.getElementById('roleLabel').textContent = 'ROLE · NONE';
  document.getElementById('joinMessage').textContent = message;
  document.getElementById('joinScreen').classList.remove('hidden');
  document.body.classList.remove('in-game');
}
document.querySelectorAll('.roleButton').forEach(button => button.addEventListener('click', () => chooseRole(button.dataset.role)));

if (socket) {
  // After a deploy the server comes back as a new build; reload so nobody keeps playing an old client
  // (without the newer HUD, chat or stamina) against the new server.
  let serverBuild = null;
  socket.on('serverReady', data => {
    if (serverBuild && data?.build && data.build !== serverBuild) location.reload();
    serverBuild = data?.build ?? serverBuild;
  });
  socket.on('connect', () => { document.getElementById('statusLabel').textContent = state.role ? 'NETWORK · CONNECTED' : 'NETWORK · READY'; sendJoin(); });
  socket.on('disconnect', () => { document.getElementById('statusLabel').textContent = state.role ? 'LOCAL · RECONNECTING' : 'NETWORK · OFFLINE'; });
  socket.on('connect_error', () => { document.getElementById('statusLabel').textContent = 'LOCAL MODE · NETWORK OFFLINE'; });
  socket.on('assignedPlayer', data => {
    if (!data) return; state.id = data.id;
    if (Number.isFinite(data.x)) state.x = data.x;
    if (Number.isFinite(data.z)) state.z = data.z;
    if (Number.isInteger(data.floor)) setFloor(data.floor);
    applySelfState(data);
    if (data.resumed) showNotice('Reconnected · position restored');
    // The server rolled new staircases since this page loaded; reload to get the same building.
    if (Number.isFinite(data.layoutSeed) && data.layoutSeed !== LAYOUT.SEED) location.reload();
  });
  socket.on('joinRejected', data => leaveToJoinScreen(data?.reason || 'Could not join. Pick another class.'));
  socket.on('positionCorrection', data => {
    if (!data || !Number.isFinite(data.x) || !Number.isFinite(data.z)) return;
    state.x = data.x; state.z = data.z;
    if (Number.isInteger(data.floor) && data.floor !== state.floor) setFloor(data.floor);
  });
  socket.on('playersState', list => {
    if (!Array.isArray(list)) return;
    const present = new Set(list.map(p => p?.id));
    // Geometry and materials are shared, so removing the group is enough to free a character.
    for (const [id, actor] of remoteActors) if (!present.has(id)) { scene.remove(actor); remoteActors.delete(id); }
    for (const person of list) {
      if (!person || person.id === state.id || !Number.isInteger(person.floor)) continue;
      let actor = remoteActors.get(person.id);
      // A disguised patient is drawn in the uniform it stole, so rebuild when the look changes.
      const look = person.look || person.role;
      if (actor && actor.userData.role !== look) { scene.remove(actor); actor = null; }
      if (!actor) {
        actor = makeCharacter(look); remoteActors.set(person.id, actor); scene.add(actor);
        actor.position.set(person.x, (FLOOR_Y[person.floor] || 0) + LAYOUT.stairHeight(person.floor, person.x, person.z), person.z);
      }
      actor.userData.target = person;
      applyActorStatus(actor, person);
    }
  });
  socket.on('selfState', data => { if (data && state.role) applySelfState(data); });
  socket.on('stamina', data => { if (data && state.role) setStamina(data); });
  socket.on('effect', data => {
    if (!data || typeof data.type !== 'string') return;
    effects.handle(data);
    if (data.type === 'hit' && data.floor === state.floor && Math.hypot(data.x - state.x, data.z - state.z) < 0.5) flashDamage();
  });
  socket.on('blinded', data => {
    const duration = Number(data?.duration) * 1000;
    if (!(duration > 0)) return;
    const now = performance.now();
    // A second flash while still blinded extends the effect instead of restarting it dimmer.
    state.blindStart = now;
    state.blindUntil = Math.max(state.blindUntil || 0, now + duration);
    state.blindStrength = Math.min(1, Math.max(Number(data.strength) || 1, state.blindStrength || 0));
  });
  socket.on('abilityFeedback', data => { if (data?.message) showNotice(data.message); });
}

const world = createWorld({ state, socket, LAYOUT, ITEMS, showNotice, floors, scene, makeItemModel, actorFor: id => remoteActors.get(id), lights: [[hemiLight, 1.75], [ambientLight, 0.35], [keyLight, 1.6]], glowing: MAINS_LIGHTING });

// Which rooms on this floor hold the stairs up and the openings down.
function updateStairHint() {
  const role = ROLES[state.role]; if (!role) return;
  const unique = list => [...new Set(list)].join(', ');
  const up = unique(STAIRS.filter(stair => stair.floor === state.floor).map(stair => stair.from));
  const down = unique(STAIRS.filter(stair => stair.floor + 1 === state.floor).map(stair => stair.to));
  document.getElementById('objectiveHint').textContent = [role.ability, up && `Stairs up: ${up}`, down && `Stairs down: ${down}`].filter(Boolean).join(' · ');
}
function jump() {
  if (state.role) state.jumpQueued = true;
}
function setSprint(on) {
  state.sprinting = on;
  sprintButton.classList.toggle('active', on);
}
function useAbility() {
  if (!state.role) return;
  const ability = ROLES[state.role].ability;
  if (socket?.connected) socket.emit('useAbility', { ability }); else showNotice(`${ability} activated`);
}
window.addEventListener('keydown', event => {
  if (event.target.closest?.('input, textarea, select')) return;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;
  if (event.code === 'KeyQ') useAbility();
  if (event.code === 'KeyE') world.interact();
  if (event.code === 'Enter' || event.code === 'KeyT') { event.preventDefault(); world.openChat(); }
  if (event.code === 'Escape') world.closeOverlays();
  if (event.code === 'KeyV' && state.role) setCameraMode(state.cameraMode === 'first' ? 'third' : 'first');
  if (event.code === 'Space') jump();
  if (/^Digit[1-6]$/.test(event.code)) document.querySelectorAll('.equipment-slot')[Number(event.code.at(-1)) - 1]?.click();
}, { passive: false });
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => keys.clear());

renderer.domElement.addEventListener('pointerdown', event => {
  if (event.target.closest?.('button')) return;
  // With the mouse captured in first person, clicking uses the held item.
  if (pointerLocked()) { if (event.button === 0) useItem(); return; }
  // In first person a click also captures the mouse. The click still uses the item, so nothing is lost
  // when the browser refuses the capture (right after Esc, or in embedded browsers); dragging then
  // keeps turning the camera.
  if (canPointerLock && event.pointerType === 'mouse' && state.cameraMode === 'first' && state.role && !state.view) {
    try { renderer.domElement.requestPointerLock()?.catch?.(() => {}); } catch (_) { /* Not allowed here. */ }
  }
  lastCameraPointer = { x: event.clientX, y: event.clientY, id: event.pointerId, moved: 0, mouse: event.pointerType === 'mouse' && event.button === 0 };
  try { renderer.domElement.setPointerCapture?.(event.pointerId); } catch (_) { /* Pointer lock already took the mouse. */ }
});
renderer.domElement.addEventListener('pointermove', event => {
  if (!lastCameraPointer || event.pointerId !== lastCameraPointer.id) return;
  const dx = event.clientX - lastCameraPointer.x, dy = event.clientY - lastCameraPointer.y;
  lastCameraPointer.moved += Math.abs(dx) + Math.abs(dy);
  turnCamera(dx, dy);
  lastCameraPointer.x = event.clientX; lastCameraPointer.y = event.clientY;
});
for (const type of ['pointerup', 'pointercancel']) {
  renderer.domElement.addEventListener(type, event => {
    if (event.pointerId !== lastCameraPointer?.id) return;
    // A mouse click that did not turn the camera uses the held item.
    if (type === 'pointerup' && lastCameraPointer.mouse && lastCameraPointer.moved < 6) useItem();
    lastCameraPointer = null;
  });
}
document.addEventListener('mousemove', event => { if (pointerLocked()) turnCamera(event.movementX * 0.5, event.movementY * 0.5); });
// The wheel zooms the third-person camera; zooming all the way in switches to first person and back.
renderer.domElement.addEventListener('wheel', event => {
  if (!state.role || state.view) return;
  event.preventDefault();
  const { minDistance, maxDistance } = CAMERA.third;
  if (state.cameraMode === 'first') { if (event.deltaY > 0) { setCameraMode('third'); state.zoom = minDistance + 0.6; } return; }
  const next = state.zoom * (1 + THREE.MathUtils.clamp(event.deltaY, -100, 100) * 0.0015);
  if (next < minDistance && event.deltaY < 0) { setCameraMode('first'); return; }
  state.zoom = THREE.MathUtils.clamp(next, minDistance, maxDistance);
}, { passive: false });

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
  // The pad is centred (translate -50%) on the touch point, in coordinates relative to the zone.
  const rect = joystickZone.getBoundingClientRect();
  pad.style.left = `${event.clientX - rect.left}px`; pad.style.top = `${event.clientY - rect.top}px`; pad.classList.add('visible');
  joystickZone.setPointerCapture?.(event.pointerId); moveJoystick(event.clientX, event.clientY);
});
joystickZone.addEventListener('pointermove', event => { if (joystick.active && event.pointerId === joystick.pointer) moveJoystick(event.clientX, event.clientY); });
joystickZone.addEventListener('pointerup', event => { if (event.pointerId === joystick.pointer) resetJoystick(); });
joystickZone.addEventListener('pointercancel', resetJoystick);
const sprintButton = document.getElementById('sprintButton');
// Sprint is a toggle on touch screens, so the other thumb stays free for the camera.
sprintButton.addEventListener('pointerdown', event => { event.preventDefault(); setSprint(!state.sprinting); });
document.getElementById('jumpButton').addEventListener('pointerdown', event => { event.preventDefault(); jump(); });
// Long presses on the controls must not select text or open the callout menu.
document.addEventListener('contextmenu', event => { if (event.target.closest?.('#mobileControls, #hud, canvas')) event.preventDefault(); });
document.addEventListener('selectstart', event => { if (!event.target.closest?.('input, textarea')) event.preventDefault(); });
document.getElementById('abilityButton').addEventListener('click', useAbility);
document.getElementById('viewButton').addEventListener('click', () => setCameraMode(state.cameraMode === 'first' ? 'third' : 'first'));
document.getElementById('chatButton').addEventListener('click', () => world.openChat());
document.getElementById('interactButton').addEventListener('pointerdown', event => { event.preventDefault(); world.interact(); });
document.getElementById('useButton').addEventListener('pointerdown', event => { event.preventDefault(); useItem(); });
document.getElementById('fullscreenButton').addEventListener('click', async () => {
  try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); else await document.exitFullscreen(); } catch (_) { showNotice('Fullscreen is unavailable in this browser'); }
});
if (isTouch) document.body.classList.add('touch-device');

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();
  if (state.role && state.actor) {
    let forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
    let sideways = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
    if (joystick.active) { forward = -joystick.y; sideways = joystick.x; }
    const length = Math.hypot(forward, sideways); if (length > 1) { forward /= length; sideways /= length; }
    // Stunned, netted, carried or knocked-out players cannot move; the server ignores their position updates anyway.
    const held = isStunned() || now < state.rootedUntil || state.carried || world.riding?.seat === 'passenger';
    if (held) { forward = 0; sideways = 0; }
    // Out of breath: walk until stamina has recovered.
    const sprinting = (keys.has('ShiftLeft') || keys.has('ShiftRight') || state.sprinting) && !state.exhausted;
    state.sprintingNow = sprinting && (forward !== 0 || sideways !== 0);
    // The server's multiplier already covers slows, boosts, carrying and hiding in a prop.
    const speed = (sprinting ? 14 : 8) * state.speed;
    // The camera sits behind the player at +(sin yaw, cos yaw), so "forward" points the other way.
    const stepX = (-Math.sin(state.yaw) * forward + Math.cos(state.yaw) * sideways) * speed * dt;
    const stepZ = (-Math.cos(state.yaw) * forward - Math.sin(state.yaw) * sideways) * speed * dt;
    // Each axis moves separately so you slide along walls; staircases can carry you to another floor.
    const tryMove = (x, z) => {
      const step = LAYOUT.stairMove(state.floor, state.x, state.z, x, z);
      if (!step || blocked(x, z, step.floor) || world.doorBlocks(state.x, state.z, x, z, step.floor, PLAYER_RADIUS)) return;
      // Vehicles stay on their floor and off the stairs.
      if (world.riding && (step.floor !== state.floor || step.height > 0)) return;
      state.x = x; state.z = z; state.ground = step.height;
      if (step.floor !== state.floor) { setFloor(step.floor); updateStairHint(); showNotice(`Entered ${FLOOR_NAMES[state.floor]}`); }
    };
    if (stepX) tryMove(THREE.MathUtils.clamp(state.x + stepX, -BOUNDS.x, BOUNDS.x), state.z);
    if (stepZ) tryMove(state.x, THREE.MathUtils.clamp(state.z + stepZ, -BOUNDS.z, BOUNDS.z));
    state.ground = LAYOUT.stairHeight(state.floor, state.x, state.z);
    // Jumping: a simple arc above whatever is underfoot.
    if (state.jumpQueued && state.air === 0 && !held) state.vy = JUMP_SPEED;
    state.jumpQueued = false;
    if (state.air > 0 || state.vy > 0) {
      state.vy -= GRAVITY * dt;
      state.air = Math.max(0, state.air + state.vy * dt);
      if (state.air === 0) state.vy = 0;
    }
    if (!state.view) showFloor(state.floor, LAYOUT.stairNeighbours(state.floor, state.x, state.z));
    state.actor.position.set(state.x, FLOOR_Y[state.floor] + state.ground + state.air, state.z);
    state.actor.rotation.y = state.yaw + Math.PI;
    // Your own body is hidden when the camera is inside (or right behind) your head.
    const insideHead = !state.view && (state.cameraMode === 'first' || state.cameraDistance < 1.3);
    state.actor.visible = visibleFloors.has(state.floor) && !insideHead;
    animateActor(state.actor, dt, FLOOR_Y[state.floor] + state.ground + state.air);
    updateCamera(1 - Math.exp(-7 * dt));
    animateViewModel(dt);
    const focus = state.view || state;
    moveKeyLight(focus.x, FLOOR_Y[focus.floor], focus.z);
    if (socket?.connected && now - lastNetworkUpdate > 100) sendPosition();
    updateSlotCooldowns(now);
    updateStatusEffect();
  }
  world.update(now, dt);
  // Remote players glide towards their last reported position instead of jumping every tick.
  const smoothing = 1 - Math.exp(-12 * dt);
  for (const actor of remoteActors.values()) {
    const target = actor.userData.target; if (!target) continue;
    actor.position.x += (target.x - actor.position.x) * smoothing;
    actor.position.z += (target.z - actor.position.z) * smoothing;
    actor.rotation.y = (Number(target.yaw) || 0) + Math.PI;
    actor.visible = visibleFloors.has(target.floor);
    // Height comes from the steps under the smoothed position, plus the jump the owner reports.
    const lift = LAYOUT.stairHeight(target.floor, actor.position.x, actor.position.z);
    actor.userData.air = THREE.MathUtils.lerp(actor.userData.air || 0, Number(target.air) || 0, smoothing);
    animateActor(actor, dt, (FLOOR_Y[target.floor] || 0) + lift + actor.userData.air);
  }
  effects.update(dt);
  updateBlind(now);
  renderer.render(scene, camera);
}
setFloor(0);
setCameraMode(state.cameraMode, false);
animate();
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(innerWidth, innerHeight);
});
window.addEventListener('load', () => {
  const loading = document.getElementById('loadingScreen');
  document.getElementById('loadingStatus').textContent = 'Facility online';
  window.setTimeout(() => { loading.classList.add('done'); window.setTimeout(() => loading.remove(), 500); }, 450);
});
