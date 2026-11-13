'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { serveClient: true, pingInterval: 25000, pingTimeout: 20000 });
const PORT = Number(process.env.PORT) || 3000;
const SPAWNS = {
  patient: { x: -72, z: 8, floor: 3 },
  medic: { x: -70, z: 0, floor: 2 },
  orderly: { x: 70, z: 0, floor: 2 },
  director: { x: 70, z: 43, floor: 1 },
};
const INVENTORIES = {
  patient: ['glassShard'], medic: ['smallMedicalKit', 'mediumMedicalKit'],
  orderly: ['riotShield', 'taser', 'stunBaton', 'arrestCuffs'], director: ['stunBaton', 'ignotusShield', 'tablet'],
};
const MAX_HEALTH = { patient: 100, medic: 100, orderly: 115, director: 100 };
const players = new Map();
const updateTimes = new Map();

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders(res) { res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate'); },
}));
app.get('/health', (_req, res) => res.json({ ok: true, players: players.size, version: '2026.11.13-1' }));
app.get('/api/status', (_req, res) => res.json({ online: true, players: players.size, game: 'Asylum Break' }));

let publishTimeout;
function publishSoon() {
  if (publishTimeout) return;
  publishTimeout = setTimeout(() => {
    publishTimeout = null;
    io.emit('playersState', [...players.values()]);
  }, 50);
}
function finiteClamp(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

io.on('connection', socket => {
  socket.emit('serverReady', { ok: true, version: '2026.11.13-1' });

  socket.on('joinGame', (data = {}) => {
    const role = Object.hasOwn(SPAWNS, data.role) ? data.role : 'patient';
    const spawn = SPAWNS[role];
    const name = String(data.name || 'Player').trim().slice(0, 16) || 'Player';
    const player = {
      id: socket.id, name, role,
      x: spawn.x, y: [0, 9, 18, 27][spawn.floor], z: spawn.z, floor: spawn.floor,
      health: MAX_HEALTH[role], inventory: [...INVENTORIES[role]], equippedItem: null,
    };
    players.set(socket.id, player);
    socket.emit('assignedPlayer', player);
    publishSoon();
  });

  socket.on('equipItem', (data = {}) => {
    const player = players.get(socket.id);
    if (!player || typeof data.item !== 'string') return;
    const item = player.inventory.find(value => value.toLowerCase() === data.item.toLowerCase());
    if (!item) return;
    player.equippedItem = item;
    publishSoon();
  });

  socket.on('updatePlayer', (data = {}) => {
    const player = players.get(socket.id);
    if (!player || !data || typeof data !== 'object') return;
    const now = Date.now();
    if (now - (updateTimes.get(socket.id) || 0) < 70) return;
    updateTimes.set(socket.id, now);
    player.x = finiteClamp(data.x, -86, 86, player.x);
    player.z = finiteClamp(data.z, -62, 62, player.z);
    if (Number.isInteger(data.floor)) player.floor = Math.max(0, Math.min(3, data.floor));
    player.y = [0, 9, 18, 27][player.floor];
    publishSoon();
  });

  socket.on('useAbility', (data = {}) => {
    const player = players.get(socket.id);
    if (!player) return;
    socket.emit('abilityFeedback', { ok: true, ability: String(data.ability || '').slice(0, 40), message: `${player.role} ability ready` });
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
    updateTimes.delete(socket.id);
    publishSoon();
  });
});

server.listen(PORT, () => console.log(`Asylum Break server listening on ${PORT}`));
