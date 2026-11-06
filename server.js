const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const rooms = new Map(); // Starter version: in-memory; rooms reset when server restarts.

app.use(express.static('public'));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

const code = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const clean = (s, max = 24) => String(s || '').trim().replace(/[<>]/g, '').slice(0, max);
function publicRoom(room) {
  return {
    code: room.code, status: room.status, duration: room.duration,
    deadline: room.deadline, winnerId: room.winnerId,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, score: p.score, connected: p.connected, buzzedAt: p.buzzedAt })),
    teams: room.teams
  };
}
function emitRoom(room) { io.to(room.code).emit('room:update', publicRoom(room)); }
function stopTimer(room) { if (room.timer) clearTimeout(room.timer); room.timer = null; }
function lockRoom(room, status = 'locked') { stopTimer(room); room.status = status; room.deadline = null; }
function finishRound(room, status) { lockRoom(room, status); emitRoom(room); }

io.on('connection', socket => {
  socket.on('room:peek', ({ code: rawCode } = {}, ack = () => {}) => {
    const room = rooms.get(clean(rawCode, 8).toUpperCase());
    if (!room) return ack({ ok: false, error: 'Không tìm thấy phòng.' });
    ack({ ok: true, teams: room.teams });
  });
  socket.on('host:create', ({ hostName, duration, teams } = {}, ack = () => {}) => {
    let roomCode; do { roomCode = code(); } while (rooms.has(roomCode));
    const room = {
      code: roomCode, hostId: socket.id, hostName: clean(hostName, 24) || 'Host',
      duration: Math.max(5, Math.min(300, Number(duration) || 20)),
      teams: Array.isArray(teams) ? teams.slice(0, 12).map(t => clean(t, 20)).filter(Boolean) : ['Đội 1', 'Đội 2'],
      players: new Map(), status: 'waiting', deadline: null, timer: null, winnerId: null
    };
    if (!room.teams.length) room.teams = ['Đội 1', 'Đội 2'];
    rooms.set(roomCode, room); socket.join(roomCode);
    socket.data.roomCode = roomCode; socket.data.role = 'host';
    ack({ ok: true, code: roomCode, state: publicRoom(room) });
  });

  socket.on('host:rejoin', ({ code: rawCode } = {}, ack = () => {}) => {
    const room = rooms.get(clean(rawCode, 8).toUpperCase());
    if (!room) return ack({ ok: false, error: 'Không tìm thấy phòng.' });
    // A room host can reclaim control only when the previous host disconnected.
    if (room.hostId && room.hostId !== socket.id && io.sockets.sockets.has(room.hostId)) return ack({ ok: false, error: 'Phòng đang có Host điều khiển.' });
    room.hostId = socket.id; socket.join(room.code); socket.data.roomCode = room.code; socket.data.role = 'host';
    ack({ ok: true, state: publicRoom(room) });
  });

  socket.on('player:join', ({ code: rawCode, name, team } = {}, ack = () => {}) => {
    const room = rooms.get(clean(rawCode, 8).toUpperCase());
    if (!room) return ack({ ok: false, error: 'Mã phòng không hợp lệ.' });
    if (room.status === 'playing') return ack({ ok: false, error: 'Ván đang diễn ra, Host tạm khóa người chơi mới.' });
    const playerName = clean(name, 24);
    if (!playerName) return ack({ ok: false, error: 'Bạn cần nhập tên.' });
    const chosenTeam = room.teams.includes(team) ? team : room.teams[0];
    const player = { id: socket.id, name: playerName, team: chosenTeam, score: 0, connected: true, buzzedAt: null };
    room.players.set(socket.id, player); socket.join(room.code);
    socket.data.roomCode = room.code; socket.data.role = 'player';
    ack({ ok: true, playerId: socket.id, state: publicRoom(room) }); emitRoom(room);
  });

  socket.on('player:buzz', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'player') return ack({ ok: false, error: 'Không tìm thấy phòng.' });
    const player = room.players.get(socket.id);
    if (!player || room.status !== 'playing') return ack({ ok: false, error: 'Chuông hiện không mở.' });
    if (room.winnerId) return ack({ ok: false, error: 'Đã có người bấm trước.' });
    room.winnerId = player.id; player.buzzedAt = Date.now();
    finishRound(room, 'won'); ack({ ok: true });
  });

  socket.on('host:start', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'host' || room.hostId !== socket.id) return ack({ ok: false, error: 'Không có quyền Host.' });
    stopTimer(room); room.winnerId = null;
    for (const p of room.players.values()) p.buzzedAt = null;
    room.status = 'playing'; room.deadline = Date.now() + room.duration * 1000;
    room.timer = setTimeout(() => { if (room.status === 'playing') finishRound(room, 'timeout'); }, room.duration * 1000);
    emitRoom(room); ack({ ok: true });
  });
  socket.on('host:lock', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'host' || room.hostId !== socket.id) return ack({ ok: false, error: 'Không có quyền Host.' });
    finishRound(room, 'locked'); ack({ ok: true });
  });
  socket.on('host:reset', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'host' || room.hostId !== socket.id) return ack({ ok: false, error: 'Không có quyền Host.' });
    stopTimer(room); room.status = 'waiting'; room.deadline = null; room.winnerId = null;
    for (const p of room.players.values()) p.buzzedAt = null;
    emitRoom(room); ack({ ok: true });
  });
  socket.on('host:score', ({ playerId, delta } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'host' || room.hostId !== socket.id) return ack({ ok: false, error: 'Không có quyền Host.' });
    const p = room.players.get(playerId);
    if (!p) return ack({ ok: false, error: 'Không tìm thấy người chơi.' });
    p.score = Math.max(0, Math.min(9999, p.score + Math.max(-100, Math.min(100, Number(delta) || 0))));
    emitRoom(room); ack({ ok: true });
  });
  socket.on('host:remove', ({ playerId } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'host' || room.hostId !== socket.id) return ack({ ok: false, error: 'Không có quyền Host.' });
    const p = room.players.get(playerId); if (p) { room.players.delete(playerId); const s = io.sockets.sockets.get(playerId); if (s) s.leave(room.code); }
    emitRoom(room); ack({ ok: true });
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    if (socket.data.role === 'player') {
      const p = room.players.get(socket.id); if (p) p.connected = false;
      emitRoom(room);
    }
    // Host room remains available for host rejoin while the process is alive.
  });
});

server.listen(PORT, () => console.log(`Olympia Buzzer running on port ${PORT}`));
