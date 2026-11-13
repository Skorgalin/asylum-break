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
  patient: { x: -18, y: 25, z: 7, floor: 3 },
  medic: { x: -25, y: 17, z: -5, floor: 2 },
  orderly: { x: 25, y: 17, z: -5, floor: 2 },
  director: { x: 23, y: 9, z: 8, floor: 1 }
};
const roleColors = { patient: '#ef4444', medic: '#34d399', orderly: '#fbbf24', director: '#a78bfa' };
const players = new Map();
app.use(express.static(publicDir));
app.get('/health', (_req, res) => res.json({ ok: true, players: players.size }));

io.on('connection', (socket) => {
  socket.on('joinGame', (payload = {}) => {
    const name = String(payload.name || 'Player').slice(0, 20);
    const role = Object.hasOwn(roleSpawns, payload.role) ? payload.role : 'patient';
    const spawn = roleSpawns[role];
    const player = { id: socket.id, name, role, ...spawn, color: roleColors[role], inventory: role === 'patient' ? ['glassShard'] : role === 'director' ? ['tablet', 'stunBaton'] : role === 'orderly' ? ['riotShield', 'taser', 'stunBaton', 'arrestCuffs'] : ['smallMedKit', 'mediumMedKit'], stunned: false, health: 100 };
    players.set(socket.id, player);
    socket.emit('assignedPlayer', player);
    io.emit('playersState', [...players.values()]);
  });
  socket.on('updatePlayer', (payload = {}) => {
    const player = players.get(socket.id);
    if (!player) return;
    for (const field of ['x', 'y', 'z']) {
      const value = Number(payload[field]);
      if (Number.isFinite(value)) player[field] = Math.max(-100, Math.min(100, value));
    }
    const floor = Number(payload.floor);
    if (Number.isInteger(floor) && floor >= 0 && floor <= 3) player.floor = floor;
    if (payload.stunned !== undefined) player.stunned = Boolean(payload.stunned);
    if (payload.health !== undefined && Number.isFinite(Number(payload.health))) player.health = Math.max(0, Math.min(100, Number(payload.health)));
    io.emit('playersState', [...players.values()]);
  });
  socket.on('useAbility', ({ ability } = {}) => {
    const player = players.get(socket.id);
    if (player) socket.emit('abilityFeedback', { ok: true, ability: String(ability || '').slice(0, 40), message: `${player.role} used ${String(ability || 'ability').slice(0, 40)}.` });
  });
  socket.on('disconnect', () => { players.delete(socket.id); io.emit('playersState', [...players.values()]); });
});
server.listen(PORT, () => console.log(`Asylum server running on port ${PORT}`));
