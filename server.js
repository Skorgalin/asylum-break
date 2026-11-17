'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const ITEMS = require('./public/items.js');
// Staircases are placed at random from this seed; browsers get the same one from /layout-seed.js.
const STAIR_SEED = Number(process.env.STAIR_SEED) || 1 + Math.floor(Math.random() * 0x7ffffffe);
globalThis.STAIR_SEED = STAIR_SEED;
const LAYOUT = require('./public/layout.js');

const VERSION = '2026.11.17-2';
// Changes on every start (each deploy restarts the server), so open pages can tell they are out of date.
const BUILD = `${VERSION}-${Date.now().toString(36)}`;
const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);
const io = new Server(server, { serveClient: true, pingInterval: 25000, pingTimeout: 20000, maxHttpBufferSize: 1e4 });
const PORT = Number(process.env.PORT) || 3000;
// Floors, spawns, staircases, loot spots and walls live in public/layout.js, shared with the browser.
const { FLOOR_Y, SPAWNS, STAIRS, BOUNDS, STATIONS, STATION_RANGE, VEHICLE_TYPES, SECURE_DOORS, segmentHitsBox, wallBetween, stairBody, stairHeight } = LAYOUT;
// Patients cut the power at the breaker panel; staff switch it back on there, or it comes back by itself.
const BLACKOUT = { duration: 60_000, cut: 5, restore: 3 };
let blackoutUntil = 0;
const DOOR = { hp: 120, brokenFor: 30_000, openRange: 3.2, keycardDrop: 0.35 };
const INVENTORIES = {
  patient: ['glassShard', 'shove'],
  medic: ['smallMedicalKit', 'mediumMedicalKit', 'fireExtinguisher', 'mediGun', 'straitjacket'],
  orderly: ['riotShield', 'taser', 'stunBaton', 'arrestCuffs', 'flashGrenade'],
  director: ['stunBaton', 'shockShield', 'arrestCuffs', 'tablet', 'hostileDetector'],
};
const MAX_HEALTH = { patient: 100, medic: 100, orderly: 115, director: 100 };
const ROLE_LIMITS = { director: 1 };
const MAX_PLAYERS = 40;
const MAX_SLOTS = 6;
const SPRINT_SPEED = 14;
const WALK_SPEED = 8;
// Sprinting drains stamina; once it hits zero you walk until it has recovered to `recover`.
const STAMINA = { max: 100, drain: 18, regen: 12, recover: 30 };
const STAIR_SLACK = 3;
const MAX_JUMP = 4;
const SESSION_TTL_MS = 60_000;
const TICK_MS = 100;
const EVENTS_PER_SECOND = 30;
const RESPAWN_MS = 5000;
const PLAYER_RADIUS = 0.6;
const CARRY_HEIGHT = 2.2;
// Hiding in a prop is slow going.
const LOOK_SPEED = { box: 0.6, bush: 0.35 };
const ZONE_TYPES = new Set(['fire', 'gas', 'healing', 'jam']);

const players = new Map();
const sessions = new Map(); // session token -> { player, expires } for players that dropped connection
const zones = new Map(); // id -> fire, gas, healing and jammer areas
const mines = new Map(); // id -> placed floor mines
const devices = new Map(); // id -> drones and turrets
let devicesDirty = false;
const doors = SECURE_DOORS.map(def => ({ ...def, hp: DOOR.hp, brokenUntil: 0, weldedUntil: 0, open: false }));
let doorsDirty = true;
const VEHICLE = { range: 3, idleReturnMs: 120_000, seatHeight: 0.9 };
const vehicles = LAYOUT.VEHICLES.map(spot => ({ ...spot, def: VEHICLE_TYPES[spot.type], yaw: 0, driver: null, passenger: null, home: { ...spot }, idleSince: Date.now(), rammed: new Map() }));
let vehiclesDirty = true;
let nextEntityId = 1;
let dirty = false;

app.get('/layout-seed.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('application/javascript').send(`window.STAIR_SEED = ${STAIR_SEED};\n`);
});
app.use(express.static(path.join(__dirname, 'public'), {
  // Revalidate everything so deploys show up immediately, but let unchanged files come back as 304.
  setHeaders(res) { res.setHeader('Cache-Control', 'no-cache'); },
}));
app.get('/health', (_req, res) => res.json({ ok: true, players: players.size, version: VERSION }));
app.get('/api/status', (_req, res) => res.json({ online: true, players: players.size, game: 'Asylum Break' }));

function finiteClamp(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}
const isObject = data => data !== null && typeof data === 'object';
// Changing floors needs a staircase between the two floors under (or right next to) the player.
const onStairsBetween = (floorA, floorB, x, z) => STAIRS.some(stair => {
  if (stair.floor !== Math.min(floorA, floorB)) return false;
  const box = stairBody(stair);
  return x > box.minX - STAIR_SLACK && x < box.maxX + STAIR_SLACK && z > box.minZ - STAIR_SLACK && z < box.maxZ + STAIR_SLACK;
});
const teamOf = role => (role === 'patient' ? 'patient' : 'staff');
const canUse = (player, item) => {
  const def = ITEMS[item];
  if (!def || (def.team !== 'all' && def.team !== teamOf(player.role))) return false;
  return !def.roles || def.roles.includes(player.role);
};
// Patients fight staff and can also attack each other; staff never hit staff.
// `a` and `b` may be players or owner snapshots of players, so they are compared by id.
const hostile = (a, b) => a.id !== b.id && (teamOf(a.role) !== teamOf(b.role) || (a.role === 'patient' && b.role === 'patient'));
// Healing, buffs and healing mist go by team, so patients can still team up and patch each other up.
const allied = (a, b) => teamOf(a.role) === teamOf(b.role);
const isDown = (player, now = Date.now()) => player.downUntil > now;
const isStunned = (player, now = Date.now()) => player.stunUntil > now || player.holdUntil > now || isDown(player, now);
// Rooted players (netted) cannot walk, but can still use items.
const isRooted = (player, now = Date.now()) => player.rootUntil > now || Boolean(player.carriedBy) || player.seat === 'passenger';
const isRaging = (player, now = Date.now()) => player.rageUntil > now;
function cleanName(value) {
  return String(value ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'Player';
}
function publicState(player) {
  const { id, name, role, x, z, floor, yaw, health, maxHealth, air } = player;
  const now = Date.now();
  return {
    id, name, role, x, z, floor, yaw, health, maxHealth, air,
    equippedItem: player.equipped?.item ?? null,
    look: player.look, stunned: isStunned(player, now), down: isDown(player, now),
    rooted: player.rootUntil > now, raging: isRaging(player, now), carried: Boolean(player.carriedBy), seat: player.seat,
  };
}
// Everything the owning client needs for its own HUD. Timers go out as remaining milliseconds,
// so the client never has to trust that its clock matches ours.
function selfState(player) {
  const now = Date.now();
  return {
    health: player.health, maxHealth: player.maxHealth,
    inventory: player.inventory.map(slot => ({ item: slot.item, uses: slot.uses, cooldown: Math.max(0, slot.readyAt - now) })),
    equippedItem: player.equipped?.item ?? null,
    stunned: Math.max(0, player.stunUntil - now, player.holdUntil - now),
    down: Math.max(0, player.downUntil - now),
    slowed: Math.max(0, player.slowUntil - now),
    speed: speedMultiplier(player, now),
    look: player.look,
    rooted: Math.max(0, player.rootUntil - now),
    raging: Math.max(0, player.rageUntil - now),
    boosted: Math.max(0, player.boostUntil - now),
    jammed: player.jammed, armor: player.armor < 1, mask: player.mask, nightVision: player.nightVision,
    carrying: Boolean(player.carrying), carried: Boolean(player.carriedBy),
    vehicle: player.vehicle, seat: player.seat,
    credits: player.credits, xp: player.xp, level: levelOf(player.xp),
    work: player.work ? { label: player.work.label, left: Math.max(0, player.work.until - now), total: player.work.total } : null,
  };
}
function sendSelf(player) {
  io.to(player.id).emit('selfState', selfState(player));
  dirty = true;
}
function roleCount(role) {
  let count = 0;
  for (const player of players.values()) if (player.role === role) count++;
  return count;
}
function makeSlot(item) {
  return { item, uses: ITEMS[item].uses ?? null, readyAt: 0 };
}
function freshLoadout(role) {
  return INVENTORIES[role].filter(item => ITEMS[item]).map(makeSlot);
}
function speedMultiplier(player, now = Date.now()) {
  let speed = player.boostUntil > now ? player.boostMultiplier : 1;
  if (player.slowUntil > now) speed *= 0.55;
  if (player.carrying) speed *= 0.8;
  if (player.seat === 'driver') speed *= vehicleOf(player)?.def.speed ?? 1;
  return speed * (LOOK_SPEED[player.look] ?? 1);
}
function notify(player, message) {
  io.to(player.id).emit('abilityFeedback', { ok: true, message });
}
function effect(data) {
  io.emit('effect', data);
}

// ---- Combat ----------------------------------------------------------------------------------

// The character looks along (-sin yaw, -cos yaw): the camera sits behind it at +(sin, cos).
function facing(player) {
  return { x: -Math.sin(player.yaw), z: -Math.cos(player.yaw) };
}
// Whether a player could stand at (x, z): not inside a wall or a piece of furniture.
function spotFree(floor, x, z) {
  if (Math.abs(x) > BOUNDS.x || Math.abs(z) > BOUNDS.z) return false;
  return !LAYOUT.solids[floor].some(box => x + PLAYER_RADIUS > box.minX && x - PLAYER_RADIUS < box.maxX && z + PLAYER_RADIUS > box.minZ && z - PLAYER_RADIUS < box.maxZ);
}
// Moves a player up to `distance` along (dx, dz), stopping in front of the first obstacle. `onStep`
// may return true to stop early. Returns how far the player got.
function slide(player, dx, dz, distance, onStep) {
  const STEP = 0.25;
  let travelled = 0;
  while (travelled + STEP <= distance) {
    const x = player.x + dx * STEP, z = player.z + dz * STEP;
    if (!spotFree(player.floor, x, z) || wallBetween(player.floor, player.x, player.z, x, z) || doorBlocks(player, player.x, player.z, x, z)) break;
    player.x = x; player.z = z; travelled += STEP;
    if (onStep?.()) break;
  }
  player.y = FLOOR_Y[player.floor] + stairHeight(player.floor, player.x, player.z);
  io.to(player.id).emit('positionCorrection', { x: player.x, z: player.z, floor: player.floor });
  dirty = true;
  return travelled;
}
// Players in front of `player` within `range` and within `arc` radians of where it is facing, nearest first.
function targetsInFront(player, range, arc, filter) {
  const dir = facing(player);
  const found = [];
  for (const other of players.values()) {
    if (other === player || other.floor !== player.floor || !filter(other)) continue;
    const dx = other.x - player.x, dz = other.z - player.z, distance = Math.hypot(dx, dz);
    if (distance > range || wallBetween(player.floor, player.x, player.z, other.x, other.z)) continue;
    const angle = distance < 0.01 ? 0 : Math.acos(Math.max(-1, Math.min(1, (dx * dir.x + dz * dir.z) / distance)));
    if (angle <= arc / 2) found.push({ other, distance });
  }
  return found.sort((a, b) => a.distance - b.distance).map(entry => entry.other);
}
// A held shield stops anything that arrives from the front half of the shield bearer.
function blockedByShield(target, fromX, fromZ) {
  const held = target.equipped && ITEMS[target.equipped.item];
  if (!held?.shield || isStunned(target)) return false;
  const dir = facing(target);
  return (fromX - target.x) * dir.x + (fromZ - target.z) * dir.z > 0;
}
// Berserk players hit harder.
const power = (attacker, now = Date.now()) => (attacker && isRaging(attacker, now) ? attacker.rageMultiplier : 1);
function damage(target, amount, attacker) {
  if (isDown(target) || amount <= 0) return;
  target.health = Math.max(0, target.health - amount * (target.armor ?? 1));
  effect({ type: 'hit', x: target.x, z: target.z, floor: target.floor });
  if (target.health === 0) knockDown(target, attacker);
  sendSelf(target);
}
function stun(target, seconds) {
  if (seconds > 0) target.stunUntil = Math.max(target.stunUntil, Date.now() + seconds * 1000);
  sendSelf(target);
}
function slow(target, seconds) {
  if (seconds > 0) target.slowUntil = Math.max(target.slowUntil, Date.now() + seconds * 1000);
  sendSelf(target);
}
function root(target, seconds) {
  if (seconds > 0) target.rootUntil = Math.max(target.rootUntil, Date.now() + seconds * 1000);
  sendSelf(target);
}
function boost(target, multiplier, seconds) {
  target.boostUntil = Date.now() + seconds * 1000; target.boostMultiplier = multiplier;
  sendSelf(target);
}
// Ends a carry from either side: the carried player is put down where the carrier stands.
function releaseCarry(player) {
  const carrier = player.carrying ? player : players.get(player.carriedBy);
  const carried = player.carrying ? players.get(player.carrying) : player;
  if (carrier) { carrier.carrying = null; sendSelf(carrier); }
  if (!carried) return;
  carried.carriedBy = null; carried.air = 0;
  // A short grace period so the carried player does not run off the moment they land.
  carried.holdUntil = Math.max(Date.now() + 500, Math.min(carried.holdUntil, Date.now() + 500));
  if (carrier && spotFree(carrier.floor, carrier.x, carrier.z)) Object.assign(carried, { x: carrier.x, z: carrier.z, floor: carrier.floor });
  io.to(carried.id).emit('positionCorrection', { x: carried.x, z: carried.z, floor: carried.floor });
  sendSelf(carried);
}
function knockDown(target, attacker) {
  target.downUntil = Date.now() + RESPAWN_MS;
  target.look = null;
  if (target.carrying) releaseCarry(target);
  if (target.vehicle) leaveVehicle(target);
  notify(target, attacker ? `Knocked out by ${attacker.name}` : 'Knocked out');
  if (attacker) notify(attacker, `You knocked out ${target.name}`);
  if (attacker && hostile(attacker, target)) reward(attacker, 5, 10);
  // Knocking out staff sometimes leaves their keycard up for grabs.
  if (attacker?.role === 'patient' && teamOf(target.role) === 'staff' && Math.random() < DOOR.keycardDrop
    && !hasItem(attacker, 'keycard') && attacker.inventory.length < MAX_SLOTS) {
    attacker.inventory.push(makeSlot('keycard'));
    notify(attacker, `You lifted ${target.name}'s keycard`);
  }
}
// Status that every fresh (or respawned) player starts with.
const FRESH_STATUS = () => ({
  downUntil: 0, stunUntil: 0, slowUntil: 0, holdUntil: 0, boostUntil: 0, boostMultiplier: 1, rootUntil: 0, rageUntil: 0, rageMultiplier: 1,
  look: null, combo: null, armor: 1, mask: false, nightVision: false, jammed: false, carrying: null, carriedBy: null, air: 0,
  stamina: STAMINA.max, exhausted: false, sprintedAt: 0, work: null, vehicle: null, seat: null,
});
function sendStamina(player) {
  const value = Math.round(player.stamina);
  if (value === player.sentStamina && player.exhausted === player.sentExhausted) return;
  player.sentStamina = value; player.sentExhausted = player.exhausted;
  io.to(player.id).emit('stamina', { value, max: STAMINA.max, exhausted: player.exhausted });
}
function spendStamina(player, amount) {
  player.stamina = Math.max(0, player.stamina - amount);
  if (player.stamina === 0) player.exhausted = true;
  sendStamina(player);
}
function respawn(player) {
  if (player.carrying || player.carriedBy) releaseCarry(player);
  if (player.vehicle) leaveVehicle(player);
  const spawn = SPAWNS[player.role];
  Object.assign(player, FRESH_STATUS(), {
    x: spawn.x, z: spawn.z, floor: spawn.floor, y: FLOOR_Y[spawn.floor],
    health: player.maxHealth, inventory: freshLoadout(player.role), equipped: null,
  });
  io.to(player.id).emit('positionCorrection', { x: player.x, z: player.z, floor: player.floor });
  sendSelf(player);
}
function meleeHit(attacker, target, def) {
  if (blockedByShield(target, attacker.x, attacker.z)) { effect({ type: 'block', x: target.x, z: target.z, floor: target.floor }); return; }
  const now = Date.now();
  if (def.combo) {
    // Count consecutive hits on the same target inside the combo window.
    const combo = attacker.combo?.target === target.id && attacker.combo.until > now ? attacker.combo.count + 1 : 1;
    attacker.combo = { target: target.id, count: combo >= def.combo.stunOn ? 0 : combo, until: now + def.combo.window * 1000 };
    damage(target, def.damage * power(attacker, now), attacker);
    if (combo >= def.combo.stunOn) stun(target, def.combo.stun);
    else if (combo >= def.combo.slowOn) slow(target, def.combo.slow);
    return;
  }
  const wasSlowed = target.slowUntil > now;
  damage(target, def.damage * power(attacker, now), attacker);
  if (def.stunIfSlowed && wasSlowed) stun(target, def.stunIfSlowed);
  else if (def.slow) slow(target, def.slow);
  if (def.stun) stun(target, def.stun);
  if (def.push) pushAway(attacker, target, def.push);
}
function pushAway(from, target, distance) {
  if (target.carriedBy) return;
  const dx = target.x - from.x, dz = target.z - from.z, length = Math.hypot(dx, dz) || 1;
  slide(target, dx / length, dz / length, distance);
}
// Explosions, flashes and fire land at a point on a floor and affect everyone around it.
function detonate(owner, floor, x, z, fx) {
  effect({ type: fx.type, x, z, floor, radius: fx.radius, duration: fx.duration });
  if (ZONE_TYPES.has(fx.type)) {
    const id = nextEntityId++;
    zones.set(id, { id, kind: fx.type, owner: owner.id, ownerSnapshot: owner, ownerTeam: teamOf(owner.role), floor, x, z, radius: fx.radius, dps: fx.dps, hps: fx.hps, until: Date.now() + fx.duration * 1000 });
    effect({ type: 'zone', id, kind: fx.type, x, z, floor, radius: fx.radius, duration: fx.duration });
    return;
  }
  if (fx.maxDamage || fx.type === 'shock') {
    for (const device of devices.values()) {
      if (device.floor === floor && hostile(owner, device.owner) && Math.hypot(device.x - x, device.z - z) <= fx.radius) damageDevice(device, fx.maxDamage || 25);
    }
  }
  if (fx.maxDamage) {
    for (const door of doors) {
      if (door.floor === floor && !isBroken(door) && Math.hypot(door.x - x, door.z - z) <= fx.radius + 1) damageDoor(door, fx.maxDamage, players.get(owner.id) ?? null);
    }
  }
  for (const target of players.values()) {
    if (target.floor !== floor) continue;
    const distance = Math.hypot(target.x - x, target.z - z);
    if (distance > fx.radius || wallBetween(floor, x, z, target.x, target.z)) continue;
    if (blockedByShield(target, x, z)) { effect({ type: 'block', x: target.x, z: target.z, floor }); continue; }
    const closeness = 1 - distance / fx.radius;
    // A flash is bright for everyone standing in it, whichever side threw it; a splat only hits enemies.
    if (fx.blind && (fx.type === 'flash' || hostile(owner, target))) blind(target, fx.blind * (0.4 + closeness * 0.6), 0.75 + closeness * 0.25);
    if (!hostile(owner, target)) continue;
    if (fx.maxDamage) damage(target, Math.round(fx.minDamage + (fx.maxDamage - fx.minDamage) * closeness), owner);
    if (fx.stun) stun(target, fx.stun * (0.5 + closeness * 0.5));
    if (fx.slow) slow(target, fx.slow);
  }
}
function blind(target, seconds, strength = 1) {
  io.to(target.id).emit('blinded', { duration: seconds, strength });
}
// The thrower may disconnect before the fuse runs out; effects still need a team to aim at.
function ownerSnapshot(player) {
  return { id: player.id, role: player.role, name: player.name };
}

const USE_HANDLERS = {
  melee(player, def) {
    effect({ type: 'swing', by: player.id });
    const targets = targetsInFront(player, def.range, def.arc, other => hostile(player, other) && !isDown(other));
    for (const target of targets) meleeHit(player, target, def);
    for (const device of devicesInFront(player, def.range, def.arc)) damageDevice(device, def.damage * power(player));
    // Patients with nobody to hit batter the security door in front of them instead.
    if (!targets.length && teamOf(player.role) === 'patient') {
      const door = doorInFront(player, def.range + 1);
      if (door && !isBroken(door)) damageDoor(door, def.damage * power(player), player);
    }
    return true;
  },
  weld(player, def) {
    const door = doorInFront(player, def.range);
    if (!door) { notify(player, 'No security door in front of you'); return false; }
    effect({ type: 'spray', by: player.id, floor: player.floor, x1: player.x, z1: player.z, x2: door.x, z2: door.z });
    if (isBroken(door)) {
      Object.assign(door, { brokenUntil: 0, hp: DOOR.hp });
      notify(player, `${door.room} door repaired`);
    } else {
      door.weldedUntil = Date.now() + def.seconds * 1000;
      notify(player, `${door.room} door welded shut · keycards won't open it`);
    }
    doorsDirty = true;
    return true;
  },
  ray(player, def) {
    const [target] = targetsInFront(player, def.range, def.arc, other => hostile(player, other) && !isDown(other));
    const dir = facing(player);
    const end = target ? { x: target.x, z: target.z } : { x: player.x + dir.x * def.range, z: player.z + dir.z * def.range };
    effect({ type: 'ray', by: player.id, floor: player.floor, x1: player.x, z1: player.z, x2: end.x, z2: end.z, color: def.color, net: Boolean(def.root) });
    if (!target) return true;
    if (blockedByShield(target, player.x, player.z)) { effect({ type: 'block', x: target.x, z: target.z, floor: target.floor }); return true; }
    if (def.damage) damage(target, def.damage * power(player), player);
    if (def.stun) stun(target, def.stun);
    if (def.slow) slow(target, def.slow);
    if (def.root) root(target, def.root);
    if (def.blind) blind(target, def.blind, 0.6);
    if (def.pull && !target.carriedBy) {
      // Reel the target in until it is right in front of the user.
      const dx = player.x - target.x, dz = player.z - target.z, distance = Math.hypot(dx, dz);
      if (distance > 2) slide(target, dx / distance, dz / distance, distance - 2);
    }
    return true;
  },
  // Hits everyone around the user at once: enemies get the stun or slow, allies the speed boost.
  pulse(player, def) {
    effect({ type: 'pulse', x: player.x, z: player.z, floor: player.floor, radius: def.radius, color: def.color });
    for (const other of players.values()) {
      if (other.floor !== player.floor || isDown(other) || Math.hypot(other.x - player.x, other.z - player.z) > def.radius) continue;
      if (other !== player && wallBetween(player.floor, player.x, player.z, other.x, other.z)) continue;
      if (def.ally && allied(player, other)) {
        boost(other, def.ally.speed, def.ally.duration);
        if (other !== player) notify(other, `${player.name} rallies you`);
      } else if (hostile(player, other)) {
        if (def.stun) stun(other, def.stun);
        if (def.slow) slow(other, def.slow);
      }
    }
    return true;
  },
  push(player, def) {
    const [target] = targetsInFront(player, def.range, def.arc, other => hostile(player, other) && !isDown(other));
    effect({ type: 'swing', by: player.id });
    if (!target) return true;
    if (blockedByShield(target, player.x, player.z)) { effect({ type: 'block', x: target.x, z: target.z, floor: target.floor }); return true; }
    pushAway(player, target, def.push);
    if (def.stun) stun(target, def.stun);
    effect({ type: 'hit', x: target.x, z: target.z, floor: target.floor });
    return true;
  },
  // Charges forward and bowls over the first enemy in the way.
  dash(player, def) {
    if (isRooted(player)) { notify(player, 'You cannot charge while held'); return false; }
    if (def.staminaCost && player.stamina < def.staminaCost) { notify(player, 'Too tired to charge'); return false; }
    if (def.staminaCost) spendStamina(player, def.staminaCost);
    const dir = facing(player);
    const x1 = player.x, z1 = player.z;
    let victim = null;
    slide(player, dir.x, dir.z, def.distance, () => {
      victim = [...players.values()].find(other => other.floor === player.floor && hostile(player, other) && !isDown(other)
        && Math.hypot(other.x - player.x, other.z - player.z) < 1.6) ?? null;
      return Boolean(victim);
    });
    effect({ type: 'dash', by: player.id, floor: player.floor, x1, z1, x2: player.x, z2: player.z });
    if (victim) {
      if (blockedByShield(victim, player.x, player.z)) { effect({ type: 'block', x: victim.x, z: victim.z, floor: victim.floor }); stun(player, 1); }
      else { damage(victim, def.damage * power(player), player); stun(victim, def.stun); }
    }
    return true;
  },
  throw(player, def) {
    const dir = facing(player);
    // Throwables land short of the first wall in their way.
    let range = def.throwRange;
    while (range > 0 && wallBetween(player.floor, player.x, player.z, player.x + dir.x * range, player.z + dir.z * range)) range -= 0.5;
    range = Math.max(0, range - 0.8);
    const to = {
      x: finiteClamp(player.x + dir.x * range, -BOUNDS.x, BOUNDS.x, player.x),
      z: finiteClamp(player.z + dir.z * range, -BOUNDS.z, BOUNDS.z, player.z),
    };
    const floor = player.floor;
    const owner = ownerSnapshot(player);
    effect({ type: 'throw', by: player.id, item: player.equipped.item, floor, x1: player.x, z1: player.z, x2: to.x, z2: to.z, flight: def.flight, fuse: def.fuse ?? 0 });
    if (!def.sticky) {
      setTimeout(() => detonate(owner, floor, to.x, to.z, def.effect), (def.flight + (def.fuse ?? 0)) * 1000);
      return true;
    }
    // Sticky bombs latch on to the nearest enemy where they land and go off wherever that enemy runs.
    setTimeout(() => {
      let victim = null, best = def.sticky;
      for (const other of players.values()) {
        const distance = Math.hypot(other.x - to.x, other.z - to.z);
        if (other.floor === floor && hostile(owner, other) && !isDown(other) && distance < best) { victim = other; best = distance; }
      }
      if (victim) { effect({ type: 'stuck', id: victim.id, fuse: def.fuse ?? 0 }); notify(victim, 'Something is stuck to you!'); }
      setTimeout(() => {
        const at = victim && players.get(victim.id) === victim ? victim : { floor, x: to.x, z: to.z };
        detonate(owner, at.floor, at.x, at.z, def.effect);
      }, (def.fuse ?? 0) * 1000);
    }, def.flight * 1000);
    return true;
  },
  device(player, def) {
    const dir = facing(player), spec = def.device, id = nextEntityId++;
    devices.set(id, {
      id, type: spec.type, spec, owner: ownerSnapshot(player), floor: player.floor, x: player.x + dir.x * 1.5, z: player.z + dir.z * 1.5,
      hp: spec.hp, until: Date.now() + spec.life * 1000, nextAt: Date.now() + 500,
    });
    devicesDirty = true;
    return true;
  },
  // Shows the user's whole team where every enemy is, through walls, for a few seconds.
  reveal(player, def) {
    const targets = [...players.values()].filter(other => hostile(player, other) && !isDown(other));
    revealTo(teamOf(player.role), targets, def.duration);
    notify(player, `${targets.length} hostile${targets.length === 1 ? '' : 's'} located`);
    return true;
  },
  // Sets a zone down right where the user stands.
  deploy(player, def) {
    detonate(ownerSnapshot(player), player.floor, player.x, player.z, def.effect);
    return true;
  },
  place(player, def) {
    const id = nextEntityId++;
    mines.set(id, { id, owner: ownerSnapshot(player), floor: player.floor, x: player.x, z: player.z, armedAt: Date.now() + def.armTime * 1000, def });
    effect({ type: 'mine', id, floor: player.floor, x: player.x, z: player.z });
    return true;
  },
  disguise(player, def) {
    player.look = def.look;
    notify(player, LOOK_SPEED[def.look] ? 'Hidden · move slowly, using an item gives you away' : 'Disguised · attacking blows your cover');
    return true;
  },
  wear(player, def) {
    if (def.armor) player.armor = Math.min(player.armor, def.armor);
    if (def.mask) player.mask = true;
    if (def.nightVision) player.nightVision = true;
    notify(player, `${def.name} on · until you are knocked out`);
    return true;
  },
  restrain(player, def) {
    const [target] = targetsInFront(player, def.range, def.arc, other => hostile(player, other) && isStunned(other) && !isDown(other) && !other.carriedBy);
    if (!target) { notify(player, `${def.name} needs a stunned enemy in front of you`); return false; }
    target.holdUntil = Math.max(target.holdUntil, Date.now() + def.hold * 1000);
    notify(target, `Restrained by ${player.name}`);
    notify(player, `${target.name} is restrained`);
    sendSelf(target);
    return true;
  },
  carry(player, def) {
    if (player.carrying) { releaseCarry(player); return true; }
    const [target] = targetsInFront(player, def.range, def.arc, other => isStunned(other) && !other.carriedBy && !other.carrying);
    if (!target) { notify(player, 'Nobody stunned or knocked out to pick up'); return false; }
    player.carrying = target.id;
    player.carryUntil = Date.now() + def.hold * 1000;
    target.carriedBy = player.id;
    // A knocked-out player is carried until they would have respawned anyway.
    if (!isDown(target)) target.holdUntil = Math.max(target.holdUntil, player.carryUntil);
    notify(target, `${player.name} is carrying you`);
    notify(player, `Carrying ${target.name} · use again to put down`);
    sendSelf(target);
    return true;
  },
  arrest(player, def) {
    const [target] = targetsInFront(player, def.range, def.arc, other => other.role === 'patient' && isStunned(other));
    if (!target) { notify(player, 'Arrest needs a stunned or knocked-out patient in front of you'); return false; }
    if (target.carriedBy) releaseCarry(target);
    // Whatever contraband the patient carried is confiscated, and the arresting officer is paid for it.
    const seized = target.inventory.reduce((sum, slot) => sum + (ITEMS[slot.item].value ?? 0), 0);
    reward(player, 30 + Math.round(seized / 2), 25, seized ? 'Arrest · contraband seized' : 'Arrest');
    const spawn = SPAWNS.patient;
    respawn(target);
    Object.assign(target, { x: spawn.x, z: spawn.z, floor: spawn.floor, holdUntil: Date.now() + def.hold * 1000 });
    io.to(target.id).emit('positionCorrection', { x: target.x, z: target.z, floor: target.floor });
    notify(target, `Arrested by ${player.name} · back to the ward`);
    notify(player, `${target.name} is back in the ward`);
    sendSelf(target);
    return true;
  },
  spray(player, def) {
    const dir = facing(player);
    effect({ type: 'spray', by: player.id, floor: player.floor, x1: player.x, z1: player.z, x2: player.x + dir.x * def.range, z2: player.z + dir.z * def.range });
    for (const zone of zones.values()) {
      if (zone.floor !== player.floor || (zone.kind !== 'fire' && zone.kind !== 'gas')) continue;
      const dx = zone.x - player.x, dz = zone.z - player.z, distance = Math.hypot(dx, dz);
      if (distance - zone.radius > def.range) continue;
      if (distance < zone.radius || (dx * dir.x + dz * dir.z) / distance > Math.cos(def.arc)) endZone(zone);
    }
    return true;
  },
  heal(player, def) {
    const [target] = targetsInFront(player, def.range, def.arc, other => allied(player, other) && !isDown(other) && other.health < other.maxHealth);
    const patient = target || player;
    if (patient.health >= patient.maxHealth) { notify(player, 'Nobody here needs healing'); return false; }
    patient.health = Math.min(patient.maxHealth, patient.health + def.heal);
    if (def.beam && patient !== player) effect({ type: 'ray', by: player.id, floor: player.floor, x1: player.x, z1: player.z, x2: patient.x, z2: patient.z, color: def.color });
    effect({ type: 'heal', x: patient.x, z: patient.z, floor: patient.floor });
    if (patient !== player) notify(patient, `${player.name} patched you up`);
    sendSelf(patient);
    return true;
  },
  consume(player, def) {
    if (def.heal) player.health = Math.min(player.maxHealth, player.health + def.heal);
    if (def.stamina) {
      player.stamina = Math.min(STAMINA.max, player.stamina + def.stamina);
      if (player.stamina >= STAMINA.recover) player.exhausted = false;
      sendStamina(player);
    }
    if (def.speed) boost(player, def.speed.multiplier, def.speed.duration);
    if (def.rage) { player.rageUntil = Date.now() + def.rage.duration * 1000; player.rageMultiplier = def.rage.multiplier; }
    effect({ type: 'heal', x: player.x, z: player.z, floor: player.floor });
    return true;
  },
};
function endZone(zone) {
  zones.delete(zone.id);
  effect({ type: 'zoneEnd', id: zone.id });
}
function useItem(player) {
  const now = Date.now();
  const slot = player.equipped;
  if (!slot || isStunned(player, now) || slot.readyAt > now) return;
  const def = ITEMS[slot.item];
  const handler = USE_HANDLERS[def.kind];
  if (!handler) return;
  if (def.electric && player.jammed) { notify(player, 'Signal jammed · electronics are down here'); return; }
  // Hitting anyone with a weapon blows a disguise; healing, drinking and dressing up do not.
  if (player.look && !['heal', 'consume', 'disguise', 'wear'].includes(def.kind)) player.look = null;
  if (!handler(player, def)) return;
  slot.readyAt = now + (def.cooldown ?? 0.5) * 1000;
  if (slot.uses !== null && --slot.uses <= 0) {
    player.inventory = player.inventory.filter(entry => entry !== slot);
    player.equipped = null;
  }
  sendSelf(player);
}
// ---- Devices -------------------------------------------------------------------------------------

function devicesInFront(player, range, arc) {
  const dir = facing(player);
  return [...devices.values()].filter(device => {
    if (device.floor !== player.floor || !hostile(player, device.owner)) return false;
    const dx = device.x - player.x, dz = device.z - player.z, distance = Math.hypot(dx, dz);
    return distance <= range + 0.5 && (distance < 0.5 || Math.acos(Math.max(-1, Math.min(1, (dx * dir.x + dz * dir.z) / distance))) <= arc / 2);
  });
}
function damageDevice(device, amount) {
  device.hp -= amount;
  effect({ type: 'hit', x: device.x, z: device.z, floor: device.floor });
  if (device.hp <= 0) removeDevice(device, true);
}
function removeDevice(device, destroyed) {
  devices.delete(device.id);
  devicesDirty = true;
  if (destroyed) effect({ type: 'explosion', x: device.x, z: device.z, floor: device.floor, radius: 1.4 });
  const owner = players.get(device.owner.id);
  if (owner) notify(owner, `${ITEMS[device.type].name} ${destroyed ? 'destroyed' : 'powered down'}`);
}
function revealTo(team, targets, seconds) {
  const list = targets.map(({ id, floor, x, z }) => ({ id, floor, x, z }));
  for (const player of players.values()) if (teamOf(player.role) === team) io.to(player.id).emit('reveal', { targets: list, duration: seconds });
}
function updateDevices(now) {
  for (const device of devices.values()) {
    if (now >= device.until) { removeDevice(device, false); continue; }
    const spec = device.spec, owner = players.get(device.owner.id);
    // Combat drones hover off their owner's shoulder.
    if (spec.follow && owner && !isDown(owner, now)) {
      const dir = facing(owner);
      const x = owner.x - dir.z * 1.6, z = owner.z + dir.x * 1.6;
      if (device.floor !== owner.floor || Math.hypot(device.x - x, device.z - z) > 0.05) { Object.assign(device, { floor: owner.floor, x, z }); devicesDirty = true; }
    }
    if (now < device.nextAt) continue;
    device.nextAt = now + spec.every * 1000;
    const near = other => other.floor === device.floor && !isDown(other, now) && !wallBetween(device.floor, device.x, device.z, other.x, other.z);
    if (spec.stun) {
      let target = null, best = spec.range;
      for (const other of players.values()) {
        const distance = Math.hypot(other.x - device.x, other.z - device.z);
        if (hostile(device.owner, other) && near(other) && distance < best) { target = other; best = distance; }
      }
      if (target) {
        effect({ type: 'ray', floor: device.floor, x1: device.x, z1: device.z, x2: target.x, z2: target.z, color: 0xff3b2f });
        if (!jammedAt(device, target)) stun(target, spec.stun);
      }
    }
    if (spec.reveal) {
      const spotted = [...players.values()].filter(other => hostile(device.owner, other) && other.floor === device.floor && !isDown(other, now)
        && Math.hypot(other.x - device.x, other.z - device.z) <= spec.radius);
      if (spotted.length) revealTo(teamOf(device.owner.role), spotted, spec.every + 0.6);
    }
    if (spec.heal) {
      for (const other of players.values()) {
        if (!allied(device.owner, other) || !near(other) || other.health >= other.maxHealth || Math.hypot(other.x - device.x, other.z - device.z) > spec.radius) continue;
        other.health = Math.min(other.maxHealth, other.health + spec.heal);
        effect({ type: 'heal', x: other.x, z: other.z, floor: other.floor });
        sendSelf(other);
      }
    }
  }
  if (devicesDirty) { devicesDirty = false; io.emit('devices', deviceList()); }
}
// A drone flying into an enemy jammer loses its sting.
const jammedAt = (device, _target) => [...zones.values()].some(zone => zone.kind === 'jam' && zone.floor === device.floor
  && zone.ownerTeam !== teamOf(device.owner.role) && Math.hypot(zone.x - device.x, zone.z - device.z) <= zone.radius);
const deviceList = () => [...devices.values()].map(({ id, type, floor, x, z, hp, spec }) => ({ id, type, floor, x, z, health: hp / spec.hp }));

// ---- Chat and radio --------------------------------------------------------------------------------

const CHAT = { length: 120, gapMs: 800 };
// Staff talk over the radio; a patient carrying a stolen radio hears it too. Patients' team chat
// stays among patients, and `all` reaches everyone.
const hearsRadio = player => teamOf(player.role) === 'staff' || hasItem(player, 'stolenRadio');
function chat(player, data) {
  const now = Date.now();
  if (now - (player.lastChat ?? 0) < CHAT.gapMs) return;
  const text = String(data.text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, CHAT.length);
  if (!text) return;
  player.lastChat = now;
  const channel = data.channel === 'all' ? 'all' : teamOf(player.role) === 'staff' ? 'radio' : 'team';
  const message = { from: player.name, role: player.role, channel, text };
  for (const other of players.values()) {
    const hears = channel === 'all' || (channel === 'radio' ? hearsRadio(other) : teamOf(other.role) === 'patient');
    if (hears) io.to(other.id).emit('chat', { ...message, intercepted: channel === 'radio' && teamOf(other.role) !== 'staff' });
  }
}
// Facility alarms go to staff as a toast and over the radio, where radio thieves hear them too.
function alarm(text) {
  for (const other of players.values()) {
    if (teamOf(other.role) === 'staff') notify(other, `Alarm · ${text}`);
    if (hearsRadio(other)) io.to(other.id).emit('chat', { from: 'Control', role: 'system', channel: 'radio', text, intercepted: teamOf(other.role) !== 'staff' });
  }
}

// ---- Security doors --------------------------------------------------------------------------------

const isBroken = (door, now = Date.now()) => door.brokenUntil > now;
const isWelded = (door, now = Date.now()) => door.weldedUntil > now;
// Staff always get through; patients need a keycard (useless on a welded door) or a broken door.
function canPass(player, door, now = Date.now()) {
  if (isBroken(door, now) || teamOf(player.role) === 'staff') return true;
  return hasItem(player, 'keycard') && !isWelded(door, now);
}
// Whether a door that is shut for `player` stands between (x1, z1) and (x2, z2). Someone already
// standing in the doorway may always step out of it.
function doorBlocks(player, x1, z1, x2, z2) {
  for (const door of doors) {
    if (door.floor !== player.floor || canPass(player, door)) continue;
    const box = door.box, m = PLAYER_RADIUS;
    const inside = x1 > box.minX - m && x1 < box.maxX + m && z1 > box.minZ - m && z1 < box.maxZ + m;
    if (!inside && segmentHitsBox(box, x1, z1, x2, z2, m)) return true;
  }
  return false;
}
function doorInFront(player, range) {
  const dir = facing(player);
  let best = null, bestDistance = range;
  for (const door of doors) {
    if (door.floor !== player.floor) continue;
    const dx = door.x - player.x, dz = door.z - player.z, distance = Math.hypot(dx, dz);
    if (distance > bestDistance || (distance > 0.5 && (dx * dir.x + dz * dir.z) / distance < 0.5)) continue;
    best = door; bestDistance = distance;
  }
  return best;
}
function damageDoor(door, amount, attacker) {
  door.hp -= amount;
  effect({ type: 'block', x: door.x, z: door.z, floor: door.floor });
  if (door.hp > 0) return;
  Object.assign(door, { hp: DOOR.hp, brokenUntil: Date.now() + DOOR.brokenFor, weldedUntil: 0 });
  doorsDirty = true;
  effect({ type: 'explosion', x: door.x, z: door.z, floor: door.floor, radius: 1.5 });
  if (attacker) reward(attacker, 10, 15, `Broke the ${door.room} door`);
  alarm(`${door.room} door broken`);
}
function updateDoors(now) {
  for (const door of doors) {
    if (door.brokenUntil && door.brokenUntil <= now) { door.brokenUntil = 0; doorsDirty = true; }
    if (door.weldedUntil && door.weldedUntil <= now) { door.weldedUntil = 0; doorsDirty = true; }
    // Doors slide open for anyone allowed through who walks up to them.
    let open = false;
    for (const player of players.values()) {
      if (player.floor === door.floor && !isDown(player, now) && Math.hypot(player.x - door.x, player.z - door.z) < DOOR.openRange && canPass(player, door, now)) { open = true; break; }
    }
    if (open !== door.open) { door.open = open; doorsDirty = true; }
  }
  if (doorsDirty) { doorsDirty = false; io.emit('doors', doorList(now)); }
}
const doorList = (now = Date.now()) => doors.map(door => ({ id: door.id, open: door.open, broken: isBroken(door, now), welded: isWelded(door, now) }));

// ---- Facility: stations, jobs, credits, shops, escape --------------------------------------------

const levelOf = xp => 1 + Math.floor(Math.sqrt((xp || 0) / 60));
const JOBS = {
  laundry: { label: 'Doing laundry', seconds: 4, credits: 15, xp: 20, consumes: true },
  paint: { label: 'Painting', seconds: 6, credits: 25, xp: 30, consumes: false },
};
const EXIT = { keycard: 4, pry: 12, credits: 200, xp: 150, pryTools: ['crowbar', 'fireAxe', 'rebarHammer'] };
function reward(player, credits, xp, reason) {
  const before = levelOf(player.xp);
  player.credits += credits; player.xp += xp;
  if (reason) notify(player, `+${credits} ¢ · +${xp} XP · ${reason}`);
  if (levelOf(player.xp) > before) notify(player, `Level ${levelOf(player.xp)}!`);
  sendSelf(player);
}
const hasItem = (player, item) => player.inventory.some(slot => slot.item === item);
function takeItem(player, item) {
  const slot = player.inventory.find(entry => entry.item === item);
  if (!slot) return;
  player.inventory = player.inventory.filter(entry => entry !== slot);
  if (player.equipped === slot) player.equipped = null;
}
function nearestStation(player) {
  let best = null, bestDistance = STATION_RANGE;
  for (const station of STATIONS) {
    if (station.floor !== player.floor) continue;
    const distance = Math.hypot(station.x - player.x, station.z - player.z);
    if (distance <= bestDistance) { best = station; bestDistance = distance; }
  }
  return best;
}
// Some stations take a while: stand still until the work is done. Moving or getting hit cancels it.
function startWork(player, station, label, seconds, done) {
  player.work = { station: station.id, label, until: Date.now() + seconds * 1000, total: seconds * 1000, x: player.x, z: player.z, floor: player.floor, done };
  sendSelf(player);
}
function cancelWork(player, message) {
  if (!player.work) return;
  player.work = null;
  if (message) notify(player, message);
  sendSelf(player);
}
// Vending machines hand out anything from their loot pool the player may use. Free for now, so they
// leave out goods that sell for credits (free contraband would be free money).
const VENDING_PRICE = 0;
function shopList(player, station) {
  if (station.type === 'vending') {
    return [...new Set(LAYOUT.LOOT[station.pool])].filter(item => canUse(player, item) && !ITEMS[item].value).map(item => ({ item, price: VENDING_PRICE }));
  }
  return Object.entries(ITEMS)
    .filter(([item, def]) => def.price && (def.team === 'all' || def.team === station.team) && canUse(player, item))
    .map(([item, def]) => ({ item, price: def.price }));
}
function escape(player) {
  reward(player, EXIT.credits, EXIT.xp, 'Escaped!');
  for (const other of players.values()) if (other !== player) notify(other, `${player.name} escaped the facility!`);
  respawn(player);
}
const STATION_HANDLERS = {
  shop(player, station, socket) {
    if (teamOf(player.role) !== station.team) { notify(player, `${station.label} · not for you`); return; }
    const value = player.inventory.reduce((sum, slot) => sum + (ITEMS[slot.item].value ?? 0), 0);
    socket.emit('shop', { station: station.id, label: station.label, credits: player.credits, items: shopList(player, station), sell: value });
  },
  vending(player, station, socket) {
    const items = shopList(player, station);
    if (!items.length) { notify(player, `${station.label} · nothing for you`); return; }
    socket.emit('shop', { station: station.id, label: station.label, credits: player.credits, items, sell: 0 });
  },
  job(player, station) {
    const def = JOBS[station.job];
    const tool = player.inventory.find(slot => ITEMS[slot.item].job === station.job);
    if (!tool) { notify(player, station.job === 'laundry' ? 'Bring some laundry' : 'You need a paintbrush'); return; }
    startWork(player, station, def.label, def.seconds, () => {
      if (def.consumes) takeItem(player, tool.item);
      reward(player, def.credits, def.xp, station.label);
    });
  },
  exit(player, station) {
    if (teamOf(player.role) !== 'patient') { notify(player, 'The exit is locked down'); return; }
    if (hasItem(player, 'keycard')) {
      startWork(player, station, 'Swiping keycard', EXIT.keycard, () => { takeItem(player, 'keycard'); escape(player); });
      return;
    }
    const tool = EXIT.pryTools.find(item => hasItem(player, item));
    if (!tool) { notify(player, 'Exit locked · find a keycard or something to pry it open'); return; }
    startWork(player, station, `Prying with ${ITEMS[tool].name}`, EXIT.pry, () => escape(player));
    alarm('someone is forcing the main exit!');
  },
  breaker(player, station) {
    const out = blackoutUntil > Date.now();
    if (teamOf(player.role) === 'patient') {
      if (out) { notify(player, 'The power is already out'); return; }
      startWork(player, station, 'Cutting the power', BLACKOUT.cut, () => {
        setBlackout(Date.now() + BLACKOUT.duration);
        reward(player, 20, 30, 'Lights out');
        alarm('power cut · breaker panel in Electrical');
      });
      return;
    }
    if (!out) { notify(player, 'The power is on'); return; }
    startWork(player, station, 'Restoring power', BLACKOUT.restore, () => {
      setBlackout(0);
      reward(player, 20, 20, 'Power restored');
    });
  },
};
function setBlackout(until) {
  blackoutUntil = until;
  io.emit('world', worldState());
}
const worldState = () => ({ blackout: Math.max(0, blackoutUntil - Date.now()) });
function interact(player, socket) {
  if (player.vehicle) { leaveVehicle(player); return; }
  if (isStunned(player) || isRooted(player)) return;
  if (player.work) { cancelWork(player, 'Stopped'); return; }
  const station = nearestStation(player), vehicle = nearestVehicle(player);
  const stationDistance = station ? Math.hypot(station.x - player.x, station.z - player.z) : Infinity;
  if (vehicle && Math.hypot(vehicle.x - player.x, vehicle.z - player.z) < stationDistance) { board(player, vehicle); return; }
  if (station) STATION_HANDLERS[station.type]?.(player, station, socket);
}

// ---- Vehicles ------------------------------------------------------------------------------------

const vehicleOf = player => vehicles.find(vehicle => vehicle.id === player.vehicle);
function nearestVehicle(player) {
  let best = null, bestDistance = VEHICLE.range;
  for (const vehicle of vehicles) {
    const distance = Math.hypot(vehicle.x - player.x, vehicle.z - player.z);
    if (vehicle.floor === player.floor && distance <= bestDistance) { best = vehicle; bestDistance = distance; }
  }
  return best;
}
// The driver takes the free driving seat; anyone friendly to the driver may take a free passenger seat.
function board(player, vehicle) {
  const def = vehicle.def;
  const mayDrive = def.team === 'all' || def.team === teamOf(player.role);
  if (!vehicle.driver && mayDrive) {
    vehicle.driver = player.id;
    Object.assign(player, { vehicle: vehicle.id, seat: 'driver', x: vehicle.x, z: vehicle.z });
    notify(player, `${def.verb} the ${def.name.toLowerCase()} · E to get out`);
  } else if (def.seats > 1 && !vehicle.passenger && (!vehicle.driver || allied(player, players.get(vehicle.driver) ?? player))) {
    vehicle.passenger = player.id;
    Object.assign(player, { vehicle: vehicle.id, seat: 'passenger' });
    notify(player, `Riding the ${def.name.toLowerCase()} · E to get out`);
  } else {
    notify(player, mayDrive ? 'No free seat' : `Only staff may drive the ${def.name.toLowerCase()}`);
    return;
  }
  io.to(player.id).emit('positionCorrection', { x: player.x, z: player.z, floor: player.floor });
  vehiclesDirty = true;
  sendSelf(player);
}
function leaveVehicle(player) {
  const vehicle = vehicleOf(player);
  if (vehicle) {
    if (vehicle.driver === player.id) vehicle.driver = null;
    if (vehicle.passenger === player.id) vehicle.passenger = null;
    vehicle.idleSince = Date.now();
    // Step off beside the vehicle rather than standing inside it.
    const side = { x: Math.cos(vehicle.yaw), z: -Math.sin(vehicle.yaw) };
    for (const offset of [1.8, -1.8, 0]) {
      const x = vehicle.x + side.x * offset, z = vehicle.z + side.z * offset;
      if (spotFree(vehicle.floor, x, z) && !wallBetween(vehicle.floor, vehicle.x, vehicle.z, x, z)) { player.x = x; player.z = z; break; }
    }
    io.to(player.id).emit('positionCorrection', { x: player.x, z: player.z, floor: player.floor });
  }
  Object.assign(player, { vehicle: null, seat: null, air: 0 });
  vehiclesDirty = true;
  sendSelf(player);
}
function updateVehicles(now, dt) {
  for (const vehicle of vehicles) {
    const driver = players.get(vehicle.driver), passenger = players.get(vehicle.passenger);
    if (vehicle.driver && (!driver || isStunned(driver, now))) { if (driver) leaveVehicle(driver); else vehicle.driver = null; vehiclesDirty = true; }
    if (vehicle.passenger && !passenger) { vehicle.passenger = null; vehiclesDirty = true; }
    const pilot = players.get(vehicle.driver);
    if (pilot) {
      const moved = Math.hypot(pilot.x - vehicle.x, pilot.z - vehicle.z);
      const speed = moved / dt;
      if (moved > 0.01 || pilot.yaw !== vehicle.yaw) {
        Object.assign(vehicle, { x: pilot.x, z: pilot.z, yaw: pilot.yaw });
        vehiclesDirty = true;
      }
      if (vehicle.def.ram && speed >= vehicle.def.ram.minSpeed) ram(vehicle, pilot, now);
    } else if (!vehicle.passenger && now - vehicle.idleSince > VEHICLE.idleReturnMs && (vehicle.x !== vehicle.home.x || vehicle.z !== vehicle.home.z)) {
      // Abandoned vehicles are towed back to where they belong.
      Object.assign(vehicle, { x: vehicle.home.x, z: vehicle.home.z, yaw: 0 });
      vehiclesDirty = true;
    }
    const rider = players.get(vehicle.passenger);
    if (rider) { Object.assign(rider, { x: vehicle.x, z: vehicle.z, floor: vehicle.floor, yaw: vehicle.yaw, air: VEHICLE.seatHeight }); dirty = true; }
  }
  if (vehiclesDirty) { vehiclesDirty = false; io.emit('vehicles', vehicleList()); }
}
function ram(vehicle, pilot, now) {
  const fx = vehicle.def.ram;
  for (const target of players.values()) {
    if (target.floor !== vehicle.floor || target.vehicle === vehicle.id || !hostile(pilot, target) || isDown(target, now)) continue;
    if (Math.hypot(target.x - vehicle.x, target.z - vehicle.z) > 2.2 || (vehicle.rammed.get(target.id) ?? 0) > now) continue;
    vehicle.rammed.set(target.id, now + 1500);
    damage(target, fx.damage, pilot);
    stun(target, fx.stun);
    pushAway(vehicle, target, fx.push);
    notify(target, `Run over by ${pilot.name}`);
  }
}
const vehicleList = () => vehicles.map(({ id, type, floor, x, z, yaw, driver, passenger }) => ({ id, type, floor, x, z, yaw, driver, passenger }));
function buy(player, item) {
  const station = nearestStation(player);
  const def = ITEMS[item];
  if (!station || isDown(player)) return;
  if (station.type === 'shop' ? teamOf(player.role) !== station.team : station.type !== 'vending') return;
  const entry = shopList(player, station).find(offer => offer.item === item);
  if (!entry) return;
  if (player.credits < entry.price) { notify(player, 'Not enough credits'); return; }
  const owned = player.inventory.find(slot => slot.item === item);
  if (owned && owned.uses === null) { notify(player, 'You already have one'); return; }
  if (!owned && player.inventory.length >= MAX_SLOTS) { notify(player, 'Inventory full'); return; }
  player.credits -= entry.price;
  if (owned) owned.uses += def.uses; else player.inventory.push(makeSlot(item));
  notify(player, entry.price ? `Bought ${def.name}` : `Took ${def.name}`);
  sendSelf(player);
}
function sellContraband(player) {
  const station = nearestStation(player);
  if (!station || station.type !== 'shop' || station.team !== 'patient' || teamOf(player.role) !== 'patient') return;
  const goods = player.inventory.filter(slot => ITEMS[slot.item].value);
  if (!goods.length) return;
  const value = goods.reduce((sum, slot) => sum + ITEMS[slot.item].value, 0);
  player.inventory = player.inventory.filter(slot => !goods.includes(slot));
  if (goods.includes(player.equipped)) player.equipped = null;
  reward(player, value, Math.round(value / 4), 'Sold contraband');
}
function updateWork(player, now) {
  const work = player.work;
  if (!work) return;
  if (isStunned(player, now) || player.floor !== work.floor || Math.hypot(player.x - work.x, player.z - work.z) > 0.8) { cancelWork(player, 'Interrupted'); return; }
  if (now < work.until) return;
  player.work = null;
  work.done();
  sendSelf(player);
}

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) if (session.expires < now) sessions.delete(token);

  for (const zone of zones.values()) if (zone.until <= now) endZone(zone);
  updateDoors(now);
  updateVehicles(now, TICK_MS / 1000);
  updateDevices(now);
  if (blackoutUntil && blackoutUntil <= now) setBlackout(0);
  for (const player of players.values()) {
    if (player.downUntil && player.downUntil <= now) respawn(player);
    updateWork(player, now);
    if (now - player.sprintedAt > 300 && player.stamina < STAMINA.max) {
      player.stamina = Math.min(STAMINA.max, player.stamina + STAMINA.regen * TICK_MS / 1000);
      if (player.exhausted && player.stamina >= STAMINA.recover) player.exhausted = false;
    }
    sendStamina(player);
    player.jammed = false;
    for (const zone of zones.values()) {
      if (player.floor !== zone.floor || Math.hypot(player.x - zone.x, player.z - zone.z) > zone.radius) continue;
      // Fire and gas hurt whoever is hostile to the thrower; healing mist and jammers go by team.
      const enemyZone = hostile(zone.ownerSnapshot, player), enemyTeam = teamOf(player.role) !== zone.ownerTeam;
      if (zone.kind === 'fire' && enemyZone) damage(player, zone.dps * TICK_MS / 1000, players.get(zone.owner));
      else if (zone.kind === 'gas' && enemyZone && !player.mask) {
        damage(player, zone.dps * TICK_MS / 1000, players.get(zone.owner));
        player.slowUntil = Math.max(player.slowUntil, now + 600);
      } else if (zone.kind === 'healing' && !enemyTeam && !isDown(player, now) && player.health < player.maxHealth) {
        player.health = Math.min(player.maxHealth, player.health + zone.hps * TICK_MS / 1000);
        sendSelf(player);
      } else if (zone.kind === 'jam' && enemyTeam) player.jammed = true;
    }
    // Carried players ride on the carrier's shoulders.
    if (player.carrying) {
      const carried = players.get(player.carrying);
      if (!carried || isStunned(player, now) || now > player.carryUntil) releaseCarry(player);
      else {
        Object.assign(carried, { x: player.x, z: player.z, floor: player.floor, y: player.y, yaw: player.yaw, air: CARRY_HEIGHT + player.air });
        dirty = true;
      }
    }
    // Let the HUD know when a stun, slow, boost, net, rage or jammer runs out.
    const flags = `${isStunned(player, now)}|${player.slowUntil > now}|${player.boostUntil > now}|${player.rootUntil > now}|${isRaging(player, now)}|${player.jammed}`;
    if (flags !== player.lastFlags) { player.lastFlags = flags; sendSelf(player); }
  }
  for (const mine of mines.values()) {
    if (mine.armedAt > now) continue;
    for (const target of players.values()) {
      if (target.floor !== mine.floor || !hostile(mine.owner, target) || Math.hypot(target.x - mine.x, target.z - mine.z) > mine.def.trigger) continue;
      mines.delete(mine.id);
      effect({ type: 'mineEnd', id: mine.id });
      detonate(mine.owner, mine.floor, mine.x, mine.z, mine.def.effect);
      break;
    }
  }

  if (!dirty) return;
  dirty = false;
  io.emit('playersState', [...players.values()].map(publicState));
}, TICK_MS);

io.on('connection', socket => {
  socket.emit('serverReady', { ok: true, version: VERSION, build: BUILD });
  socket.emit('doors', doorList());
  socket.emit('world', worldState());
  socket.emit('vehicles', vehicleList());
  socket.emit('devices', deviceList());
  for (const mine of mines.values()) socket.emit('effect', { type: 'mine', id: mine.id, floor: mine.floor, x: mine.x, z: mine.z });
  for (const zone of zones.values()) socket.emit('effect', { type: 'zone', id: zone.id, kind: zone.kind, x: zone.x, z: zone.z, floor: zone.floor, radius: zone.radius, duration: (zone.until - Date.now()) / 1000 });

  // Simple token bucket so a single client cannot flood the server with events.
  let budget = EVENTS_PER_SECOND;
  let lastRefill = Date.now();
  socket.use((_packet, next) => {
    const now = Date.now();
    budget = Math.min(EVENTS_PER_SECOND, budget + ((now - lastRefill) / 1000) * EVENTS_PER_SECOND);
    lastRefill = now;
    if (budget < 1) return;
    budget -= 1;
    next();
  });

  socket.on('joinGame', data => {
    if (!isObject(data) || players.has(socket.id)) return;
    if (players.size >= MAX_PLAYERS) { socket.emit('joinRejected', { reason: 'The facility is full. Try again later.' }); return; }
    const role = Object.hasOwn(SPAWNS, data.role) ? data.role : 'patient';
    const token = typeof data.session === 'string' ? data.session.slice(0, 64) : '';
    const saved = token && sessions.get(token);
    const resumed = saved && saved.player.role === role ? saved.player : null;
    if (!resumed && ROLE_LIMITS[role] && roleCount(role) >= ROLE_LIMITS[role]) {
      socket.emit('joinRejected', { reason: `Only ${ROLE_LIMITS[role]} ${role} allowed at a time.` });
      return;
    }
    if (saved) sessions.delete(token);
    const spawn = SPAWNS[role];
    const player = {
      id: socket.id, name: cleanName(data.name), role,
      x: spawn.x, y: FLOOR_Y[spawn.floor], z: spawn.z, floor: spawn.floor, yaw: 0,
      health: MAX_HEALTH[role], maxHealth: MAX_HEALTH[role], inventory: freshLoadout(role), equipped: null,
      ...FRESH_STATUS(), credits: 0, xp: 0,
      ...(resumed && {
        credits: resumed.credits, xp: resumed.xp,
        x: resumed.x, y: resumed.y, z: resumed.z, floor: resumed.floor, health: resumed.health,
        inventory: resumed.inventory, equipped: resumed.equipped, downUntil: resumed.downUntil, look: resumed.look, stamina: resumed.stamina,
      }),
      session: token, lastMove: Date.now(),
    };
    players.set(socket.id, player);
    socket.emit('assignedPlayer', { id: player.id, name: player.name, role, x: player.x, z: player.z, floor: player.floor, resumed: Boolean(resumed), layoutSeed: STAIR_SEED, ...selfState(player) });
    dirty = true;
  });

  socket.on('equipItem', data => {
    const player = players.get(socket.id);
    if (!player || !isObject(data)) return;
    player.equipped = typeof data.item === 'string' ? player.inventory.find(slot => slot.item === data.item) ?? null : null;
    sendSelf(player);
  });

  socket.on('useItem', data => {
    const player = players.get(socket.id);
    if (!player) return;
    // Aim with the freshest camera direction rather than the last movement update.
    if (isObject(data)) player.yaw = finiteClamp(data.yaw, -1e4, 1e4, player.yaw);
    useItem(player);
  });

  socket.on('updatePlayer', data => {
    const player = players.get(socket.id);
    if (!player || !isObject(data)) return;
    const now = Date.now();
    const elapsed = Math.min((now - player.lastMove) / 1000, 1);
    player.lastMove = now;
    player.yaw = finiteClamp(data.yaw, -1e4, 1e4, player.yaw);
    // Stunned, knocked-out, netted, carried and freshly arrested players stay where they are.
    if (isStunned(player, now) || isRooted(player, now)) {
      if (data.x !== player.x || data.z !== player.z || data.floor !== player.floor) socket.emit('positionCorrection', { x: player.x, z: player.z, floor: player.floor });
      dirty = true;
      return;
    }
    const x = finiteClamp(data.x, -BOUNDS.x, BOUNDS.x, player.x);
    const z = finiteClamp(data.z, -BOUNDS.z, BOUNDS.z, player.z);
    // Allow some slack for network jitter; anything faster than sprinting is a teleport, and
    // nobody walks through walls.
    const allowed = (player.exhausted ? WALK_SPEED : SPRINT_SPEED) * Math.max(1, speedMultiplier(player, now)) * elapsed * 1.5 + 1.5;
    let corrected = false;
    const step = Math.hypot(x - player.x, z - player.z);
    if (step <= allowed && !wallBetween(player.floor, player.x, player.z, x, z) && !doorBlocks(player, player.x, player.z, x, z)) { player.x = x; player.z = z; } else corrected = true;
    if (data.sprint === true && step > 0.05 && !corrected && !player.exhausted) {
      player.sprintedAt = now;
      spendStamina(player, STAMINA.drain * elapsed);
    }
    // Vehicles cannot take the stairs.
    if (player.seat === 'driver' && stairHeight(player.floor, player.x, player.z) > 0) {
      const vehicle = vehicleOf(player);
      Object.assign(player, { x: vehicle.x, z: vehicle.z }); corrected = true;
    }
    if (Number.isInteger(data.floor) && data.floor !== player.floor && player.seat === 'driver') corrected = true;
    else if (Number.isInteger(data.floor) && data.floor !== player.floor) {
      if (Math.abs(data.floor - player.floor) === 1 && data.floor >= 0 && data.floor < FLOOR_Y.length
        && (onStairsBetween(player.floor, data.floor, player.x, player.z) || onStairsBetween(player.floor, data.floor, x, z))) {
        player.floor = data.floor;
      } else corrected = true;
    }
    player.air = finiteClamp(data.air, 0, MAX_JUMP, 0);
    player.y = FLOOR_Y[player.floor] + stairHeight(player.floor, player.x, player.z);
    if (corrected) socket.emit('positionCorrection', { x: player.x, z: player.z, floor: player.floor });
    dirty = true;
  });

  socket.on('chat', data => {
    const player = players.get(socket.id);
    if (player && isObject(data)) chat(player, data);
  });
  socket.on('interact', () => {
    const player = players.get(socket.id);
    if (player) interact(player, socket);
  });
  socket.on('buy', data => {
    const player = players.get(socket.id);
    if (player && isObject(data) && typeof data.item === 'string') buy(player, data.item);
  });
  socket.on('sell', () => {
    const player = players.get(socket.id);
    if (player) sellContraband(player);
  });

  socket.on('useAbility', data => {
    const player = players.get(socket.id);
    if (!player) return;
    const ability = isObject(data) ? String(data.ability ?? '').slice(0, 40) : '';
    socket.emit('abilityFeedback', { ok: true, ability, message: `${ability || player.role} ready` });
  });

  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player && (player.carrying || player.carriedBy)) releaseCarry(player);
    if (player?.vehicle) leaveVehicle(player);
    if (player?.session) sessions.set(player.session, { player, expires: Date.now() + SESSION_TTL_MS });
    players.delete(socket.id);
    dirty = true;
  });
});

// Last line of defence: log unexpected errors instead of taking every player down with the process.
process.on('uncaughtException', error => console.error('Uncaught exception:', error));

server.listen(PORT, () => console.log(`Asylum Break server listening on ${PORT}`));
