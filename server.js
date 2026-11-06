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
    deadline: room.deadline, buzzerAlwaysOpen: room.buzzerAlwaysOpen, winnerId: room.winnerId, buzzes: room.buzzes || [],
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, score: p.score, connected: p.connected, buzzedAt: p.buzzedAt, answerSubmitted: Boolean(p.answerSubmitted), latestAnswer: p.latestAnswer || null })),
    teams: room.teams, answerCount: room.answers.length, independentTimer: { duration: room.independentTimer.duration, running: room.independentTimer.running, deadline: room.independentTimer.deadline, remainingMs: room.independentTimer.running && room.independentTimer.deadline ? Math.max(0, room.independentTimer.deadline - Date.now()) : room.independentTimer.remainingMs, startedAt: room.independentTimer.startedAt }
  };
}
function emitRoom(room) { io.to(room.code).emit('room:update', publicRoom(room)); }
function emitHostAnswers(room) { if (room.hostId) io.to(room.hostId).emit('answers:update', room.answers); }
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
      duration: Math.max(1, Math.min(300, Number(duration) || 5)),
      buzzerAlwaysOpen: false,
      teams: Array.isArray(teams) ? teams.slice(0, 12).map(t => clean(t, 20)).filter(Boolean) : ['Đội 1', 'Đội 2'],
      players: new Map(), answers: [], buzzes: [], roundStartedAt: null, status: 'waiting', deadline: null, timer: null, winnerId: null, independentTimer: { duration: 60, remainingMs: 60000, deadline: null, running: false, startedAt: null, handle: null }
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
    ack({ ok: true, state: publicRoom(room) }); emitHostAnswers(room);
  });

  socket.on('player:join', ({ code: rawCode, name, team } = {}, ack = () => {}) => {
    const room = rooms.get(clean(rawCode, 8).toUpperCase());
    if (!room) return ack({ ok: false, error: 'Mã phòng không hợp lệ.' });
    if (room.deadline && Date.now() < room.deadline) return ack({ ok: false, error: 'Lượt đang diễn ra, Host tạm khóa người chơi mới.' });
    const playerName = clean(name, 24);
    if (!playerName) return ack({ ok: false, error: 'Bạn cần nhập tên.' });
    const chosenTeam = room.teams.includes(team) ? team : room.teams[0];
    const player = { id: socket.id, name: playerName, team: chosenTeam, score: 0, connected: true, buzzedAt: null, answerSubmitted: false, latestAnswer: null };
    room.players.set(socket.id, player); socket.join(room.code);
    socket.data.roomCode = room.code; socket.data.role = 'player';
    ack({ ok: true, playerId: socket.id, state: publicRoom(room) }); emitRoom(room);
  });

  socket.on('player:answer', ({ answer } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'player') return ack({ ok: false, error: 'Không tìm thấy phòng.' });
    const player = room.players.get(socket.id);
    if (!player) return ack({ ok: false, error: 'Không tìm thấy người chơi.' });
    const at = room.independentTimer;
    const canSubmit = Boolean(at && at.running && at.deadline && Date.now() < at.deadline);
    if (!canSubmit) return ack({ ok: false, error: 'Đã hết thời gian nhận câu trả lời.' });
    const text = String(answer || '').trim().slice(0, 500);
    if (!text) return ack({ ok: false, error: 'Bạn chưa nhập câu trả lời.' });
    const elapsedMs = Math.max(0, Date.now() - (at.startedAt || Date.now()));
    const submission = {
      id: crypto.randomUUID(), playerId: player.id, name: player.name, team: player.team,
      answer: text, elapsedMs, submittedAt: Date.now()
    };
    room.answers.push(submission); player.latestAnswer = { answer: text, elapsedMs, submittedAt: submission.submittedAt };
    emitRoom(room);
    emitHostAnswers(room);
    ack({ ok: true, elapsedMs });
  });

  socket.on('player:buzz', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'player') return ack({ ok: false, error: 'Không tìm thấy phòng.' });
    const player = room.players.get(socket.id);
    if (!player || room.status !== 'playing' || (room.deadline && Date.now() >= room.deadline)) return ack({ ok: false, error: 'Chuông hiện không mở.' });
    if (room.buzzerAlwaysOpen) {
      const receivedAt = Date.now();
      player.buzzedAt = receivedAt;
      const buzz = { id: crypto.randomUUID(), playerId: player.id, name: player.name, team: player.team, receivedAt, elapsedMs: Math.max(0, receivedAt - (room.roundStartedAt || receivedAt)) };
      room.buzzes.push(buzz);
      emitRoom(room); ack({ ok: true, alwaysOpen: true, elapsedMs: buzz.elapsedMs }); return;
    }
    if (room.winnerId) return ack({ ok: false, error: 'Đã có người bấm trước.' });
    room.winnerId = player.id; player.buzzedAt = Date.now();
    room.status = 'won'; emitRoom(room); ack({ ok: true });
  });

  socket.on('host:start', ({ duration } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'host' || room.hostId !== socket.id) return ack({ ok: false, error: 'Không có quyền Host.' });
    stopTimer(room); room.duration = Math.max(1, Math.min(300, Number(duration) || room.duration || 5)); room.winnerId = null; room.answers = []; room.buzzes = []; room.roundStartedAt = Date.now();
    for (const p of room.players.values()) { p.buzzedAt = null; p.answerSubmitted = false; p.latestAnswer = null; }
    room.status = 'playing'; room.deadline = Date.now() + room.duration * 1000;
    room.timer = setTimeout(() => {
      if (room.deadline && Date.now() >= room.deadline && ['playing','won'].includes(room.status)) {
        room.status = 'locked'; room.deadline = null; room.timer = null; emitRoom(room);
      }
    }, room.duration * 1000);
    emitRoom(room); emitHostAnswers(room); ack({ ok: true });
  });  socket.on('host:lock', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'host' || room.hostId !== socket.id) return ack({ ok: false, error: 'Không có quyền Host.' });
    // Host locks only the buzzer; answer submissions remain open until the countdown ends.
    if (room.status === 'playing') room.status = 'locked';
    stopTimer(room); room.deadline = null;
    emitRoom(room); ack({ ok: true });
  });
  socket.on('host:reset', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'host' || room.hostId !== socket.id) return ack({ ok: false, error: 'Không có quyền Host.' });
    stopTimer(room); stopIndependentTimer(room, false); room.independentTimer.remainingMs = room.independentTimer.duration * 1000; room.independentTimer.startedAt = null; room.independentTimer.startedAt = null; room.status = 'waiting'; room.deadline = null; room.winnerId = null; room.roundStartedAt = null; room.answers = []; room.buzzes = [];
    for (const p of room.players.values()) { p.buzzedAt = null; p.answerSubmitted = false; p.latestAnswer = null; }
    emitRoom(room); emitHostAnswers(room); ack({ ok: true });
  });
  function isHost(room) { return room && socket.data.role === 'host' && room.hostId === socket.id; }
  function stopIndependentTimer(room, keepRemaining = true) {
    const t = room.independentTimer;
    if (t.handle) clearTimeout(t.handle);
    t.handle = null;
    if (t.running && keepRemaining && t.deadline) t.remainingMs = Math.max(0, t.deadline - Date.now());
    t.running = false; t.deadline = null;
  }
  socket.on('host:buzzer-mode', ({ alwaysOpen } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    room.buzzerAlwaysOpen = Boolean(alwaysOpen);
    emitRoom(room); ack({ ok: true });
  });
  socket.on('host:independent:set', ({ duration } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    const seconds = Math.max(1, Math.min(3600, Number(duration) || 60));
    stopIndependentTimer(room, false);
    room.independentTimer.duration = seconds; room.independentTimer.remainingMs = seconds * 1000; room.independentTimer.startedAt = null;
    emitRoom(room); ack({ ok: true });
  });
  socket.on('host:independent:start', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    const t = room.independentTimer;
    if (!t.running) {
      if (t.remainingMs <= 0) t.remainingMs = t.duration * 1000;
      t.running = true; t.startedAt ||= Date.now(); t.deadline = Date.now() + t.remainingMs;
      t.handle = setTimeout(() => { t.remainingMs = 0; t.running = false; t.deadline = null; t.handle = null; emitRoom(room); }, t.remainingMs);
      emitRoom(room);
    }
    ack({ ok: true });
  });
  socket.on('host:independent:pause', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    stopIndependentTimer(room, true); emitRoom(room); ack({ ok: true });
  });
  socket.on('host:independent:reset', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    stopIndependentTimer(room, false); room.independentTimer.remainingMs = room.independentTimer.duration * 1000; room.independentTimer.startedAt = null;
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
    const p = room.players.get(playerId); if (p) { room.players.delete(playerId); room.answers = room.answers.filter(a => a.playerId !== playerId); const s = io.sockets.sockets.get(playerId); if (s) s.leave(room.code); }
    emitRoom(room); emitHostAnswers(room); ack({ ok: true });
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
