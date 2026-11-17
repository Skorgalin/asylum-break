// Facility systems in the browser: interaction prompts, work progress, credits, shops and the
// security doors. game.js owns the scene and the player; this module only adds to them through `ctx`.
import * as THREE from 'three';

const STATION_VERBS = {
  shop: station => `Open ${station.label}`,
  vending: station => `Use ${station.label}`,
  job: station => (station.job === 'laundry' ? 'Do laundry' : 'Paint'),
  breaker: (_station, power) => (power.out ? 'Restore power' : 'Cut the power'),
  exit: () => 'Try the exit',
};

export function createWorld(ctx) {
  const { state, socket, LAYOUT, ITEMS, showNotice, floors, scene, lights, glowing, makeItemModel, actorFor } = ctx;
  const $ = id => document.getElementById(id);
  const prompt = $('interactPrompt'), workBar = $('workBar'), workFill = $('workFill'), workLabel = $('workLabel');
  const shop = $('shopPanel'), shopList = $('shopList');
  let target = null; // what pressing E would use right now
  let work = null; // { label, until, total } in performance.now() time
  let shopStation = null;

  function nearestStation() {
    let best = null, bestDistance = LAYOUT.STATION_RANGE;
    for (const station of LAYOUT.STATIONS) {
      if (station.floor !== state.floor) continue;
      const distance = Math.hypot(station.x - state.x, station.z - state.z);
      if (distance <= bestDistance) { best = station; bestDistance = distance; }
    }
    return best;
  }
  function interact() {
    if (!state.role || state.view) return;
    if (!socket?.connected) { showNotice('Needs the server connection'); return; }
    socket.emit('interact');
  }

  // ---- Shop ------------------------------------------------------------------------------------
  function openShop(data) {
    shopStation = LAYOUT.STATIONS.find(station => station.id === data.station) ?? null;
    if (!shopStation) return;
    if (document.pointerLockElement) document.exitPointerLock();
    $('shopTitle').textContent = data.label;
    $('shopCredits').textContent = `${data.credits} ¢`;
    shopList.replaceChildren();
    if (data.sell > 0) {
      const sell = document.createElement('button');
      sell.type = 'button'; sell.className = 'shop-item sell';
      sell.innerHTML = '<span>Sell contraband</span>';
      const price = document.createElement('b'); price.textContent = `+${data.sell} ¢`; sell.append(price);
      sell.addEventListener('click', () => { socket.emit('sell'); closeShop(); });
      shopList.append(sell);
    }
    for (const entry of data.items) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'shop-item';
      button.disabled = entry.price > data.credits;
      const name = document.createElement('span'); name.textContent = ITEMS[entry.item]?.name ?? entry.item;
      const price = document.createElement('b'); price.textContent = entry.price ? `${entry.price} ¢` : 'Free';
      button.append(name, price);
      button.addEventListener('click', () => socket.emit('buy', { item: entry.item }));
      shopList.append(button);
    }
    shop.classList.remove('hidden');
  }
  function closeShop() {
    shopStation = null;
    shop.classList.add('hidden');
  }
  $('shopClose').addEventListener('click', closeShop);
  socket?.on('shop', data => { if (data && state.role) openShop(data); });

  // ---- Security doors --------------------------------------------------------------------------
  // A sliding panel in each doorway with a lamp above it: green when you may pass, red when not.
  const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x5b6873, roughness: 0.5, metalness: 0.4 });
  const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0xf2d33b, roughness: 0.6 });
  const weldMaterial = new THREE.MeshStandardMaterial({ color: 0xff8a3c, emissive: 0xff5a1f, emissiveIntensity: 0.8 });
  const lampOn = new THREE.MeshBasicMaterial({ color: 0x4fe08a }), lampOff = new THREE.MeshBasicMaterial({ color: 0xf0453a });
  const UNIT = new THREE.BoxGeometry(1, 1, 1);
  const doors = new Map();
  for (const def of LAYOUT.SECURE_DOORS) {
    const y = LAYOUT.FLOOR_Y[def.floor], w = LAYOUT.DOOR_WIDTH, h = LAYOUT.DOOR_HEIGHT;
    const group = new THREE.Group();
    group.position.set(def.x, y, def.z);
    if (!def.alongX) group.rotation.y = Math.PI / 2;
    const panel = new THREE.Group(); group.add(panel);
    const slab = new THREE.Mesh(UNIT, doorMaterial); slab.scale.set(w, h, 0.25); slab.position.y = h / 2; slab.castShadow = true; panel.add(slab);
    const stripe = new THREE.Mesh(UNIT, stripeMaterial); stripe.scale.set(w * 0.92, 0.18, 0.28); stripe.position.y = h * 0.55; panel.add(stripe);
    const weld = new THREE.Mesh(UNIT, weldMaterial); weld.scale.set(0.12, h * 0.9, 0.3); weld.position.set(w / 2 - 0.1, h / 2, 0); weld.visible = false; panel.add(weld);
    const lamp = new THREE.Mesh(UNIT, lampOff); lamp.scale.set(0.5, 0.2, 0.7); lamp.position.y = h + 0.3; group.add(lamp);
    floors[def.floor].add(group);
    doors.set(def.id, { def, panel, weld, lamp, open: false, broken: false, welded: false, lift: 0 });
  }
  const passable = door => door.broken || (state.role && state.role !== 'patient')
    || (!door.welded && state.items.some(slot => slot.item === 'keycard'));
  socket?.on('doors', list => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      const door = doors.get(entry?.id); if (!door) continue;
      Object.assign(door, { open: Boolean(entry.open), broken: Boolean(entry.broken), welded: Boolean(entry.welded) });
      door.weld.visible = door.welded;
    }
  });
  // Shut doors block you like a wall; you can always step out of a doorway you are standing in.
  function doorBlocks(x0, z0, x, z, floor, radius) {
    for (const door of doors.values()) {
      if (door.def.floor !== floor || passable(door)) continue;
      const box = door.def.box;
      const inside = x0 > box.minX - radius && x0 < box.maxX + radius && z0 > box.minZ - radius && z0 < box.maxZ + radius;
      if (!inside && LAYOUT.segmentHitsBox(box, x0, z0, x, z, radius)) return true;
    }
    return false;
  }
  function updateDoors(dt) {
    for (const door of doors.values()) {
      const target = door.broken || door.open ? 1 : 0;
      door.lift += (target - door.lift) * Math.min(1, dt * 8);
      door.panel.position.y = door.lift * LAYOUT.DOOR_HEIGHT * 0.95;
      door.panel.rotation.z = door.broken ? 0.5 : 0; // A broken door hangs crooked in its frame.
      door.lamp.material = passable(door) ? lampOn : lampOff;
    }
  }

  // ---- Vehicles --------------------------------------------------------------------------------
  // Built from boxes like everything else, facing -z (the way characters look at yaw 0).
  const solid = color => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 });
  function part(group, x, y, z, w, h, d, material) {
    const mesh = new THREE.Mesh(UNIT, material); mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.castShadow = true; group.add(mesh);
  }
  const wheel = solid(0x1b1f24), steel = solid(0x9aa4ad);
  const VEHICLE_MODELS = {
    wheelchair: g => {
      const seat = solid(0x2c5a8a);
      part(g, 0, 0.9, 0.1, 1.4, 0.15, 1.3, seat); part(g, 0, 1.6, 0.75, 1.4, 1.3, 0.15, seat);
      for (const x of [-0.8, 0.8]) { part(g, x, 0.7, 0.3, 0.12, 1.4, 1.4, wheel); part(g, x * 0.75, 0.25, -0.6, 0.12, 0.5, 0.5, wheel); }
      for (const x of [-0.6, 0.6]) part(g, x, 2.1, 0.95, 0.1, 0.1, 0.5, steel);
    },
    golfCart: g => {
      const body = solid(0xeef1f3), trim = solid(0x2878d0);
      part(g, 0, 0.75, 0, 2.6, 0.8, 4.6, body); part(g, 0, 1.25, -1.9, 2.4, 0.4, 0.6, trim);
      part(g, 0, 1.4, 0.6, 2.2, 0.5, 1.4, solid(0x2c3540)); part(g, 0, 2, 1.25, 2.2, 0.9, 0.2, solid(0x2c3540));
      for (const [x, z] of [[-1.15, 1.9], [1.15, 1.9], [-1.15, -0.4], [1.15, -0.4]]) part(g, x, 3, z, 0.12, 2.6, 0.12, steel);
      part(g, 0, 4.3, 0.75, 2.6, 0.12, 3.2, body);
      for (const [x, z] of [[-1.3, 1.5], [1.3, 1.5], [-1.3, -1.5], [1.3, -1.5]]) part(g, x, 0.4, z, 0.3, 0.8, 0.8, wheel);
    },
    forklift: g => {
      const body = solid(0xf2b33b);
      part(g, 0, 1, 0.6, 2.2, 1.4, 3, body); part(g, 0, 2, 1.5, 2, 0.6, 1, solid(0x2c3540));
      part(g, 0, 2.5, -1.1, 2, 4.4, 0.2, steel); part(g, -0.55, 0.35, -2.1, 0.25, 0.12, 2, steel); part(g, 0.55, 0.35, -2.1, 0.25, 0.12, 2, steel);
      for (const [x, z] of [[-1.1, 1.5], [1.1, 1.5], [-1.1, -0.5], [1.1, -0.5]]) part(g, x, 0.45, z, 0.3, 0.9, 0.9, wheel);
      part(g, 0, 3.6, 0.6, 2.2, 0.12, 2.4, body);
    },
  };
  const vehicles = new Map();
  for (const spot of LAYOUT.VEHICLES) {
    const group = new THREE.Group();
    VEHICLE_MODELS[spot.type](group);
    group.position.set(spot.x, LAYOUT.FLOOR_Y[spot.floor], spot.z);
    floors[spot.floor].add(group);
    vehicles.set(spot.id, { ...spot, group, target: { x: spot.x, z: spot.z, yaw: 0 }, driver: null, passenger: null });
  }
  socket?.on('vehicles', list => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      const vehicle = vehicles.get(entry?.id); if (!vehicle) continue;
      Object.assign(vehicle.target, { x: entry.x, z: entry.z, yaw: entry.yaw });
      vehicle.driver = entry.driver; vehicle.passenger = entry.passenger;
    }
  });
  let riding = null; // { vehicle, seat } while you sit in or push a vehicle
  function nearestVehicle() {
    let best = null, bestDistance = 3;
    for (const vehicle of vehicles.values()) {
      const distance = Math.hypot(vehicle.group.position.x - state.x, vehicle.group.position.z - state.z);
      if (vehicle.floor === state.floor && distance <= bestDistance) { best = vehicle; bestDistance = distance; }
    }
    return best ? { vehicle: best, distance: bestDistance } : null;
  }
  function updateVehicles(dt) {
    const smoothing = 1 - Math.exp(-12 * dt);
    for (const vehicle of vehicles.values()) {
      const g = vehicle.group;
      // Your own vehicle follows you directly, so driving feels as responsive as walking.
      const mine = riding?.vehicle === vehicle.id && riding.seat === 'driver';
      const to = mine ? { x: state.x, z: state.z, yaw: state.yaw } : vehicle.target;
      g.position.x += (to.x - g.position.x) * (mine ? 1 : smoothing);
      g.position.z += (to.z - g.position.z) * (mine ? 1 : smoothing);
      const turn = Math.atan2(Math.sin(to.yaw - g.rotation.y), Math.cos(to.yaw - g.rotation.y));
      g.rotation.y += turn * (mine ? 1 : smoothing);
    }
  }

  // ---- Drones, turrets and the hostile detector -------------------------------------------------
  const devices = new Map();
  socket?.on('devices', list => {
    if (!Array.isArray(list)) return;
    const present = new Set();
    for (const entry of list) {
      if (!entry || !floors[entry.floor]) continue;
      present.add(entry.id);
      let device = devices.get(entry.id);
      if (!device || device.floor !== entry.floor) {
        if (device) device.group.parent?.remove(device.group);
        const group = new THREE.Group();
        const model = makeItemModel(entry.type); model.scale.setScalar(entry.type === 'therapyTurret' ? 3 : 2.6); group.add(model);
        group.position.set(entry.x, LAYOUT.FLOOR_Y[entry.floor], entry.z);
        floors[entry.floor].add(group);
        device = { group, model, floor: entry.floor, hover: entry.type !== 'therapyTurret', phase: Math.random() * 6 };
        devices.set(entry.id, device);
      }
      device.target = entry;
    }
    for (const [id, device] of devices) if (!present.has(id)) { device.group.parent?.remove(device.group); devices.delete(id); }
  });
  function updateDevices(dt, now) {
    const smoothing = 1 - Math.exp(-10 * dt);
    for (const device of devices.values()) {
      const g = device.group, t = device.target;
      g.position.x += (t.x - g.position.x) * smoothing; g.position.z += (t.z - g.position.z) * smoothing;
      device.model.position.y = device.hover ? 3.2 + Math.sin(now / 300 + device.phase) * 0.2 : 0.4;
      if (device.hover) device.model.rotation.y += dt * 0.8;
    }
  }
  // Revealed enemies get a red marker over their heads that shows through walls.
  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff3b2f, depthTest: false, transparent: true, opacity: 0.9 });
  const MARKER = new THREE.OctahedronGeometry(0.45);
  const markers = new Map(); // player id -> { mesh, until, fallback }
  socket?.on('reveal', data => {
    if (!Array.isArray(data?.targets)) return;
    const until = performance.now() + (Number(data.duration) || 2) * 1000;
    for (const target of data.targets) {
      let marker = markers.get(target.id);
      if (!marker) {
        const mesh = new THREE.Mesh(MARKER, markerMaterial); mesh.renderOrder = 20;
        scene.add(mesh);
        marker = { mesh }; markers.set(target.id, marker);
      }
      Object.assign(marker, { until, fallback: target });
    }
  });
  function updateMarkers(now) {
    for (const [id, marker] of markers) {
      if (now > marker.until) { scene.remove(marker.mesh); markers.delete(id); continue; }
      const actor = actorFor(id);
      const at = actor ? actor.position : { x: marker.fallback.x, y: LAYOUT.FLOOR_Y[marker.fallback.floor], z: marker.fallback.z };
      marker.mesh.position.set(at.x, at.y + 4.4 + Math.sin(now / 200) * 0.15, at.z);
      marker.mesh.rotation.y = now / 400;
    }
  }

  // ---- Blackout --------------------------------------------------------------------------------
  // With the power cut the building goes nearly black; night vision goggles keep it readable.
  let blackoutUntil = 0, nightVision = false, lightLevel = 1;
  const dayBackground = scene.background.clone(), dayFog = scene.fog.color.clone(), dayNear = scene.fog.near, dayFar = scene.fog.far;
  const black = new THREE.Color(0x010203);
  socket?.on('world', data => {
    const wasOut = blackoutUntil > performance.now();
    blackoutUntil = performance.now() + (Number(data?.blackout) || 0);
    const out = blackoutUntil > performance.now();
    if (state.role && out !== wasOut) showNotice(out ? 'Power cut · lights out' : 'Power restored');
  });
  function updateLights(now, dt) {
    const out = now < blackoutUntil;
    const target = !out ? 1 : nightVision ? 0.7 : 0.1;
    lightLevel += (target - lightLevel) * Math.min(1, dt * 3);
    for (const [light, base] of lights) light.intensity = base * lightLevel;
    for (const [material, base] of glowing) material.emissiveIntensity = base * lightLevel;
    const dark = Math.min(1, (1 - lightLevel) * 1.1);
    scene.background.copy(dayBackground).lerp(black, dark);
    scene.fog.color.copy(dayFog).lerp(black, dark);
    // Darkness swallows anything more than a few rooms away (near must stay below far).
    scene.fog.near = dayNear - (dayNear - 6) * dark;
    scene.fog.far = dayFar - (dayFar - 40) * dark;
    document.body.classList.toggle('night-vision', out && nightVision);
  }

  // ---- Chat ------------------------------------------------------------------------------------
  // Enter opens the input, Tab switches between your team (radio for staff) and everyone.
  const chatLog = $('chatLog'), chatForm = $('chatForm'), chatInput = $('chatInput'), chatChannel = $('chatChannel');
  let channel = 'team';
  const channelName = () => (channel === 'all' ? 'All' : state.role === 'patient' ? 'Patients' : 'Radio');
  function openChat() {
    if (!state.role) return;
    if (document.pointerLockElement) document.exitPointerLock();
    chatChannel.textContent = channelName();
    chatForm.classList.add('open');
    chatInput.focus();
  }
  function closeChat() {
    chatInput.value = '';
    chatForm.classList.remove('open');
    chatInput.blur();
  }
  function switchChannel() {
    channel = channel === 'all' ? 'team' : 'all';
    chatChannel.textContent = channelName();
  }
  chatInput.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') closeChat();
    if (event.key === 'Tab') { event.preventDefault(); switchChannel(); }
  });
  // On phones there is no Tab key: tap the channel label instead (without closing the keyboard).
  chatChannel.addEventListener('pointerdown', event => { event.preventDefault(); switchChannel(); chatInput.focus(); });
  chatInput.addEventListener('blur', () => { if (!chatInput.value.trim()) chatForm.classList.remove('open'); });
  chatForm.addEventListener('submit', event => {
    event.preventDefault();
    const text = chatInput.value.trim();
    if (text) socket?.emit('chat', { text, channel });
    closeChat();
  });
  socket?.on('chat', message => {
    if (!message?.text) return;
    const line = document.createElement('div');
    line.className = `chat-line ${message.channel}${message.intercepted ? ' intercepted' : ''}${message.role === 'system' ? ' system' : ''}`;
    const tag = message.intercepted ? 'Intercepted' : message.channel === 'radio' ? 'Radio' : message.channel === 'team' ? 'Patients' : 'All';
    const who = document.createElement('b'); who.textContent = `[${tag}] ${message.from}: `;
    line.append(who, document.createTextNode(message.text));
    chatLog.append(line);
    while (chatLog.children.length > 8) chatLog.firstChild.remove();
    setTimeout(() => line.classList.add('faded'), 12000);
  });

  // ---- Self state ------------------------------------------------------------------------------
  function applySelf(data) {
    if (data.vehicle !== undefined) riding = data.vehicle ? { vehicle: data.vehicle, seat: data.seat } : null;
    if (data.nightVision !== undefined) nightVision = Boolean(data.nightVision);
    if (Number.isFinite(data.credits)) {
      $('walletLabel').textContent = `LV ${data.level} · ${data.credits} ¢`;
      if (shopStation) {
        $('shopCredits').textContent = `${data.credits} ¢`;
        shopList.querySelectorAll('.shop-item:not(.sell)').forEach(button => {
          button.disabled = Number.parseInt(button.querySelector('b').textContent, 10) > data.credits;
        });
      }
    }
    if (data.work !== undefined) {
      const now = performance.now();
      work = data.work ? { label: data.work.label, until: now + data.work.left, total: data.work.total } : null;
    }
  }

  function update(now, dt) {
    updateDoors(dt);
    updateLights(now, dt);
    updateVehicles(dt);
    updateDevices(dt, now);
    updateMarkers(now);
    if (!state.role) { prompt.classList.remove('visible'); return; }
    const station = state.view ? null : nearestStation();
    const near = state.view || riding ? null : nearestVehicle();
    const stationDistance = station ? Math.hypot(station.x - state.x, station.z - state.z) : Infinity;
    const vehicle = near && near.distance < stationDistance ? near.vehicle : null;
    target = vehicle ?? station;
    const type = vehicle && LAYOUT.VEHICLE_TYPES[vehicle.type];
    const vehicleVerb = type && (!vehicle.driver && (type.team === 'all' || (state.role !== 'patient') === (type.team === 'staff')) ? type.verb : 'Ride');
    const text = riding ? 'E · get out' : work ? 'E · stop' : vehicle ? `E · ${vehicleVerb} ${type.name.toLowerCase()}`
      : station ? `E · ${STATION_VERBS[station.type](station, { out: now < blackoutUntil })}` : '';
    if (prompt.textContent !== text) prompt.textContent = text;
    prompt.classList.toggle('visible', Boolean(text));
    document.body.classList.toggle('can-interact', Boolean(text));
    if (work) {
      workBar.classList.add('visible');
      workLabel.textContent = work.label;
      workFill.style.transform = `scaleX(${Math.min(1, 1 - (work.until - now) / work.total)})`;
    } else workBar.classList.remove('visible');
    if (shopStation && (shopStation.floor !== state.floor || Math.hypot(shopStation.x - state.x, shopStation.z - state.z) > LAYOUT.STATION_RANGE + 1.5)) closeShop();
  }

  return {
    interact, applySelf, update, doorBlocks, openChat,
    closeOverlays() { if (!shopStation) return false; closeShop(); return true; },
    get typing() { return document.activeElement === chatInput; },
    reset() { work = null; riding = null; closeShop(); },
    get riding() { return riding; },
    get target() { return target; },
  };
}
