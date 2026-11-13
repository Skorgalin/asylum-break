const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

const roleSpawns = {
  patient: { x: -10, y: 0, z: -18, floor: 2 },
  medic: { x: 10, y: 0, z: 12, floor: 1 },
  orderly: { x: -14, y: 0, z: 12, floor: 1 },
  director: { x: 12, y: 0, z: -14, floor: 0 }
};

const roleColors = {
  patient: '#ef4444',
  medic: '#34d399',
  orderly: '#fbbf24',
  director: '#a78bfa'
};

const players = new Map();

app.use(express.static(publicDir));

app.get('/health', (_req, res) => {
  res.json({ ok: true, players: players.size });
});

io.on('connection', (socket) => {
  socket.on('joinGame', ({ name, role }) => {
    const safeName = String(name || 'Player').slice(0, 20);
    const safeRole = role && roleSpawns[role] ? role : 'patient';
    const spawn = roleSpawns[safeRole];

    const player = {
      id: socket.id,
      name: safeName,
      role: safeRole,
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      floor: spawn.floor,
      color: roleColors[safeRole],
      inventory: safeRole === 'patient' ? ['glassShard'] : safeRole === 'director' ? ['tablet'] : [],
      stunned: false,
      health: 100
    };

    players.set(socket.id, player);
    socket.emit('assignedPlayer', player);
    io.emit('playersState', Array.from(players.values()));
  });

  socket.on('updatePlayer', (payload) => {
    const player = players.get(socket.id);
    if (!player) return;

    const x = Number(payload.x);
    const y = Number(payload.y);
    const z = Number(payload.z);
    const floor = Number(payload.floor);

    if (!Number.isNaN(x) && !Number.isNaN(y) && !Number.isNaN(z)) {
      player.x = x;
      player.y = y;
      player.z = z;
    }

    if (!Number.isNaN(floor)) {
      player.floor = floor;
    }

    if (payload.role) player.role = payload.role;
    if (payload.name) player.name = String(payload.name).slice(0, 20);
    if (payload.stunned !== undefined) player.stunned = Boolean(payload.stunned);
    if (payload.health !== undefined) player.health = Number(payload.health) || 0;

    io.emit('playersState', Array.from(players.values()));
  });

  socket.on('useAbility', ({ ability }) => {
    const player = players.get(socket.id);
    if (!player) return;

    socket.emit('abilityFeedback', {
      ok: true,
      ability,
      role: player.role,
      message: `${player.role} used ${ability}.`
    });
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
    io.emit('playersState', Array.from(players.values()));
  });
});

server.listen(PORT, () => {
  console.log(`Asylum server running on http://localhost:${PORT}`);
});
