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
    code: room.code, status: room.status, duration: room.duration, question: room.question || '',
    deadline: room.deadline, openingDeadline: room.openingDeadline || null, buzzerCountdownDeadline: room.buzzerCountdownDeadline || null, winnerCountdownDeadline: room.winnerCountdownDeadline || null, buzzerAlwaysOpen: room.buzzerAlwaysOpen, winnerId: room.winnerId, buzzes: room.buzzes || [],
    spotlightRound: room.spotlightRound || '', spotlightPlayerId: room.spotlightPlayerId || null,
    openingQuestionRound: room.openingQuestionRound || '', openingQuestionIndex: Number.isInteger(room.openingQuestionIndex) ? room.openingQuestionIndex : null,
    openingQuestionMode: room.openingQuestionMode || '', openingStartArmed: Boolean(room.openingStartArmed), openingEmptyQuestionNumber: Number.isInteger(room.openingEmptyQuestionNumber) ? room.openingEmptyQuestionNumber : null,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, score: p.score, connected: p.connected, focused: p.focused !== false, buzzedAt: p.buzzedAt, answerSubmitted: Boolean(p.answerSubmitted), latestAnswer: p.latestAnswer || null })),
    teams: room.teams, answerCount: room.answers.length, independentTimer: { duration: room.independentTimer.duration, running: room.independentTimer.running, deadline: room.independentTimer.deadline, remainingMs: room.independentTimer.running && room.independentTimer.deadline ? Math.max(0, room.independentTimer.deadline - Date.now()) : room.independentTimer.remainingMs, startedAt: room.independentTimer.startedAt }
  };
}
function emitRoom(room) { io.to(room.code).emit('room:update', publicRoom(room)); }
function emitHostAnswers(room) { if (room.hostId) io.to(room.hostId).emit('answers:update', room.answers); }
function stopTimer(room) { if (room.timer) clearTimeout(room.timer); room.timer = null; }
function stopOpeningTimer(room) {
  if (room.openingTimer) clearTimeout(room.openingTimer);
  room.openingTimer = null;
  room.openingDeadline = null;
  room.openingTimerKind = null;
}
function stopBuzzerCountdown(room) {
  if (room.buzzerCountdownTimer) clearTimeout(room.buzzerCountdownTimer);
  room.buzzerCountdownTimer = null;
  room.buzzerCountdownDeadline = null;
}
function stopWinnerCountdown(room) {
  if (room.winnerCountdownTimer) clearTimeout(room.winnerCountdownTimer);
  room.winnerCountdownTimer = null;
  room.winnerCountdownDeadline = null;
}
function startWinnerCountdown(room) {
  stopWinnerCountdown(room);
  const deadline = Date.now() + 5000;
  room.winnerCountdownDeadline = deadline;
  room.winnerCountdownTimer = setTimeout(() => {
    if (room.winnerCountdownDeadline !== deadline) return;
    room.winnerCountdownTimer = null;
    room.winnerCountdownDeadline = null;
    emitRoom(room);
  }, 6000);
}
function startBuzzerRound(room, duration, preserveOpening = false) {
  stopBuzzerCountdown(room);
  stopWinnerCountdown(room);
  stopTimer(room);
  if (!preserveOpening) {
    stopOpeningTimer(room);
    room.openingQuestionRound = ''; room.openingQuestionIndex = null; room.openingQuestionMode = ''; room.openingEmptyQuestionNumber = null;
    room.openingStartArmed = false;
  }
  room.duration = Math.max(1, Math.min(300, Number(duration) || room.duration || 5));
  room.winnerId = null; room.answers = []; room.buzzes = []; room.roundStartedAt = Date.now();
  for (const player of room.players.values()) { player.buzzedAt = null; player.answerSubmitted = false; player.latestAnswer = null; }
  room.status = 'playing'; room.deadline = Date.now() + room.duration * 1000;
  room.timer = setTimeout(() => {
    if (room.deadline && Date.now() >= room.deadline && ['playing', 'won'].includes(room.status)) {
      room.status = 'locked'; room.deadline = null; room.timer = null; emitRoom(room);
    }
  }, room.duration * 1000);
  emitRoom(room);
  emitHostAnswers(room);
}
function startDelayedBuzzer(room, duration, preserveOpening = false) {
  stopTimer(room);
  stopBuzzerCountdown(room);
  stopWinnerCountdown(room);
  if (!preserveOpening) {
    stopOpeningTimer(room);
    room.openingQuestionRound = ''; room.openingQuestionIndex = null; room.openingQuestionMode = ''; room.openingEmptyQuestionNumber = null;
    room.openingStartArmed = false;
  }
  room.status = 'locked';
  room.deadline = null;
  room.winnerId = null;
  room.buzzes = [];
  if (preserveOpening) room.spotlightPlayerId = null;
  for (const player of room.players.values()) player.buzzedAt = null;
  room.duration = Math.max(1, Math.min(300, Number(duration) || room.duration || 5));
  const countdownDeadline = Date.now() + 5000;
  room.buzzerCountdownDeadline = countdownDeadline;
  room.buzzerCountdownTimer = setTimeout(() => {
    if (room.buzzerCountdownDeadline !== countdownDeadline) return;
    room.buzzerCountdownTimer = null;
    startBuzzerRound(room, room.duration, preserveOpening);
  }, 5000);
  emitRoom(room);
}
function lockRoom(room, status = 'locked') { stopTimer(room); room.status = status; room.deadline = null; }
function finishRound(room, status) { lockRoom(room, status); emitRoom(room); }

io.on('connection', socket => {
  socket.on('room:peek', ({ code: rawCode } = {}, ack = () => {}) => {
    const room = rooms.get(clean(rawCode, 8).toUpperCase());
    if (!room) return ack({ ok: false, error: 'Không tìm thấy phòng.' });
    ack({ ok: true, teams: room.teams });
  });
  socket.on('projector:join', ({ code: rawCode } = {}, ack = () => {}) => {
    const room = rooms.get(clean(rawCode, 8).toUpperCase());
    if (!room) return ack({ ok: false, error: 'Không tìm thấy phòng.' });
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.role = 'projector';
    ack({ ok: true, state: publicRoom(room) });
  });
  socket.on('host:create', ({ hostName, duration, teams } = {}, ack = () => {}) => {
    let roomCode; do { roomCode = code(); } while (rooms.has(roomCode));
    const room = {
      code: roomCode, hostId: socket.id, hostName: clean(hostName, 24) || 'Host', question: '',
      duration: Math.max(1, Math.min(300, Number(duration) || 5)),
      buzzerAlwaysOpen: false,
      teams: Array.isArray(teams) ? teams.slice(0, 12).map(t => clean(t, 20)).filter(Boolean) : ['Đội 1', 'Đội 2'],
      players: new Map(), answers: [], buzzes: [], questions: [], spotlightRound: '', spotlightPlayerId: null, openingQuestionRound: '', openingQuestionIndex: null, openingQuestionMode: '', openingStartArmed: false, openingEmptyQuestionNumber: null, openingDeadline: null, openingTimer: null, openingTimerKind: null, roundStartedAt: null, status: 'waiting', deadline: null, timer: null, buzzerCountdownDeadline: null, buzzerCountdownTimer: null, winnerCountdownDeadline: null, winnerCountdownTimer: null, winnerId: null, independentTimer: { duration: 60, remainingMs: 60000, deadline: null, running: false, startedAt: null, handle: null }
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
    const player = { id: socket.id, name: playerName, team: chosenTeam, score: 0, connected: true, focused: true, buzzedAt: null, answerSubmitted: false, latestAnswer: null };
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
    const elapsedMs = Math.max(0, at.duration * 1000 - Math.max(0, at.deadline - Date.now()));
    const submission = {
      id: crypto.randomUUID(), playerId: player.id, name: player.name, team: player.team,
      answer: text, elapsedMs, submittedAt: Date.now()
    };
    room.answers.push(submission); player.latestAnswer = { answer: text, elapsedMs, submittedAt: submission.submittedAt };
    emitRoom(room);
    emitHostAnswers(room);
    ack({ ok: true, elapsedMs });
  });

  socket.on('player:focus', ({ focused } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'player' || typeof focused !== 'boolean') return;
    const player = room.players.get(socket.id);
    if (!player || player.focused === focused) return;
    player.focused = focused;
    emitRoom(room);
  });

  socket.on('player:buzz', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'player') return ack({ ok: false, error: 'Không tìm thấy phòng.' });
    const player = room.players.get(socket.id);
    if (!player || room.status !== 'playing' || !room.deadline || Date.now() >= room.deadline) return ack({ ok: false, error: 'Chuông hiện không mở.' });
    if (room.buzzerAlwaysOpen) {
      // In always-open mode, each player may buzz only once per round.
      if (player.buzzedAt) return ack({ ok: false, error: 'Bạn đã bấm chuông rồi.' });
      const receivedAt = Date.now();
      player.buzzedAt = receivedAt;
      const buzz = { id: crypto.randomUUID(), playerId: player.id, name: player.name, team: player.team, receivedAt, elapsedMs: Math.max(0, receivedAt - (room.roundStartedAt || receivedAt)) };
      const isFirstBuzz = room.buzzes.length === 0;
      room.buzzes.push(buzz);
      if (isFirstBuzz) startWinnerCountdown(room);
      if (isFirstBuzz && room.openingStartArmed && room.openingQuestionRound === 'Lượt chung') room.spotlightPlayerId = player.id;
      emitRoom(room); ack({ ok: true, alwaysOpen: true, elapsedMs: buzz.elapsedMs }); return;
    }
    if (room.winnerId) return ack({ ok: false, error: 'Đã có người bấm trước.' });
    room.winnerId = player.id; player.buzzedAt = Date.now();
    startWinnerCountdown(room);
    if (room.openingStartArmed && room.openingQuestionRound === 'Lượt chung') room.spotlightPlayerId = player.id;
    room.status = 'won'; emitRoom(room); ack({ ok: true });
  });

  socket.on('host:start', ({ duration } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'host' || room.hostId !== socket.id) return ack({ ok: false, error: 'Không có quyền Host.' });
    startBuzzerRound(room, duration);
    ack({ ok: true });
  });
  socket.on('host:start:delayed', ({ duration } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'host' || room.hostId !== socket.id) return ack({ ok: false, error: 'Không có quyền Host.' });
    const preserveOpening = room.openingStartArmed && room.openingQuestionRound === 'Lượt chung';
    startDelayedBuzzer(room, duration, preserveOpening);
    const countdownDeadline = room.buzzerCountdownDeadline;
    ack({ ok: true, buzzerCountdownDeadline: countdownDeadline });
  });
  socket.on('host:lock', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'host' || room.hostId !== socket.id) return ack({ ok: false, error: 'Không có quyền Host.' });
    // Host locks only the buzzer; answer submissions remain open until the countdown ends.
    stopBuzzerCountdown(room);
    if (!(room.openingStartArmed && room.openingQuestionRound === 'Lượt chung') && room.openingTimer) {
      clearTimeout(room.openingTimer);
      room.openingTimer = null;
    }
    if (room.status === 'playing') room.status = 'locked';
    stopTimer(room); room.deadline = null;
    emitRoom(room); ack({ ok: true });
  });

  socket.on('host:question', ({ question, resetBuzzer } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'host' || room.hostId !== socket.id) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (resetBuzzer) stopBuzzerCountdown(room);
    room.question = String(question || '').trim().slice(0, 500);
    room.openingQuestionRound = ''; room.openingQuestionIndex = null; room.openingQuestionMode = ''; room.openingEmptyQuestionNumber = null;
    if (resetBuzzer) {
      room.winnerId = null;
      room.buzzes = [];
      for (const player of room.players.values()) player.buzzedAt = null;
      if (room.status === 'won') {
        if (room.deadline && Date.now() < room.deadline) room.status = 'playing';
        else lockRoom(room);
      }
    }
    emitRoom(room);
    ack({ ok: true });
  });
  socket.on('host:opening:start', ({ round, mode, duration } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    const selectedRound = String(round || '').trim();
    const questions = room.questions.filter(question => question.round === selectedRound).sort((a, b) => (a.sourceRow || 0) - (b.sourceRow || 0));
    if (!questions.length) return ack({ ok: false, error: 'Lượt thi chưa có câu hỏi trong Database.' });
    if (mode !== 'standard' && mode !== 'o27') return ack({ ok: false, error: 'Chế độ Khởi động không hợp lệ.' });
    const roundStartRows = { 'Thí sinh 1': 4, 'Thí sinh 2': 26, 'Thí sinh 3': 48, 'Thí sinh 4': 70, 'Lượt chung': 92 };
    const startRow = roundStartRows[selectedRound];
    if (!startRow) return ack({ ok: false, error: 'Lượt thi không hợp lệ.' });
    const questionBySourceRow = new Map(questions.filter(question => Number.isInteger(question.sourceRow)).map(question => [question.sourceRow, question]));
    const firstMissing = Array.from({ length: 20 }, (_, index) => index + 1).find(number => {
      const question = questionBySourceRow.get(startRow + number - 1);
      return !question || !String(question.prompt || '').trim();
    });
    const emptyQuestionNumber = firstMissing || 21;
    stopBuzzerCountdown(room);
    stopTimer(room);
    stopWinnerCountdown(room);
    stopOpeningTimer(room);
    room.roundStartedAt = Date.now();
    room.winnerId = null;
    room.buzzes = [];
    if (room.openingStartArmed && selectedRound === 'Lượt chung') room.spotlightPlayerId = null;
    for (const player of room.players.values()) player.buzzedAt = null;
    room.openingQuestionRound = selectedRound;
    room.openingQuestionIndex = 0;
    room.openingQuestionMode = mode;
    room.openingEmptyQuestionNumber = emptyQuestionNumber;
    room.openingStartArmed = room.openingStartArmed && selectedRound === 'Lượt chung';
    room.question = questions[0].prompt;
    room.status = 'locked';
    room.deadline = null;
    if (mode === 'standard') {
      const deadline = Date.now() + 60000;
      room.openingDeadline = deadline;
      room.openingTimerKind = 'round';
      room.openingTimer = setTimeout(() => {
        if (room.openingDeadline === deadline && room.openingQuestionRound === selectedRound) {
          room.openingDeadline = null;
          room.openingTimer = null;
          room.openingTimerKind = null;
          if (room.status === 'playing' || room.status === 'won') {
            stopTimer(room);
            room.status = 'locked';
            room.deadline = null;
          }
          stopBuzzerCountdown(room);
          emitRoom(room);
        }
      }, 60000);
    } else {
      room.openingDeadline = null;
      room.openingTimer = null;
      room.openingTimerKind = null;
    }
    if (room.openingStartArmed && selectedRound === 'Lượt chung') startDelayedBuzzer(room, duration, true);
    else emitRoom(room);
    ack({ ok: true, answer: questions[0].answer, emptyQuestionNumber });
  });
  socket.on('host:opening:timer', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    stopOpeningTimer(room);
    const deadline = Date.now() + 5000;
    room.openingDeadline = deadline;
    room.openingTimerKind = 'standalone';
    room.openingTimer = setTimeout(() => {
      if (room.openingDeadline !== deadline || room.openingTimerKind !== 'standalone') return;
      room.openingDeadline = null;
      room.openingTimer = null;
      room.openingTimerKind = null;
      emitRoom(room);
    }, 6000);
    emitRoom(room);
    ack({ ok: true, openingDeadline: deadline });
  });
  socket.on('host:opening:navigate', ({ round, direction, duration } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (direction !== 'next' && direction !== 'previous') return ack({ ok: false, error: 'Hướng chuyển câu không hợp lệ.' });
    const selectedRound = String(round || '').trim();
    if (!selectedRound || selectedRound !== room.openingQuestionRound || !Number.isInteger(room.openingQuestionIndex)) {
      return ack({ ok: false, error: 'Hãy bắt đầu lượt thi bằng nút 60s KĐ trước.' });
    }
    const questions = room.questions.filter(question => question.round === selectedRound).sort((a, b) => (a.sourceRow || 0) - (b.sourceRow || 0));
    const nextIndex = room.openingQuestionIndex + (direction === 'next' ? 1 : -1);
    if (nextIndex < 0 || nextIndex >= questions.length) return ack({ ok: false, error: direction === 'next' ? 'Đã đến câu cuối của lượt thi.' : 'Đây là câu đầu tiên của lượt thi.' });
    room.openingQuestionIndex = nextIndex;
    room.question = questions[nextIndex].prompt;
    if (room.openingStartArmed && selectedRound === 'Lượt chung') startDelayedBuzzer(room, duration, true);
    else emitRoom(room);
    ack({ ok: true, answer: questions[nextIndex].answer });
  });
  socket.on('host:opening:judge', ({ playerId, result, points } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (result !== 'correct' && result !== 'wrong') return ack({ ok: false, error: 'Kết quả chấm không hợp lệ.' });
    const player = typeof playerId === 'string' ? room.players.get(playerId) : null;
    if (!player) return ack({ ok: false, error: 'Không tìm thấy thí sinh được chọn.' });
    const commonRound = room.openingStartArmed && room.openingQuestionRound === 'Lượt chung';
    if (result === 'correct') {
      if (commonRound && points !== 10) return ack({ ok: false, error: 'Lượt chung chỉ cộng 10 điểm khi trả lời đúng.' });
      if (points !== 10 && points !== 30) return ack({ ok: false, error: 'Số điểm cộng không hợp lệ.' });
      player.score = Math.max(-9999, Math.min(9999, player.score + points));
      emitRoom(room);
    } else if (commonRound) {
      if (points !== undefined) return ack({ ok: false, error: 'Điểm trừ cho câu trả lời sai không hợp lệ.' });
      player.score = Math.max(-9999, player.score - 5);
      emitRoom(room);
    } else if (points !== undefined) {
      return ack({ ok: false, error: 'Câu trả lời sai không thay đổi điểm.' });
    }
    io.to(room.code).emit('projector:audio', { type: result });
    ack({ ok: true });
  });
  socket.on('host:opening:audio', ({ type } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (!['start', 'end', 'opening', 'blank'].includes(type)) return ack({ ok: false, error: 'Lệnh âm thanh không hợp lệ.' });
    if (type === 'start') {
      room.openingStartArmed = room.spotlightRound === 'Lượt chung';
      emitRoom(room);
    }
    if (type === 'end') {
      stopBuzzerCountdown(room);
      stopWinnerCountdown(room);
      stopTimer(room);
      stopOpeningTimer(room);
      room.status = 'locked';
      room.deadline = null;
      room.winnerId = null;
      room.buzzes = [];
      room.roundStartedAt = null;
      room.spotlightPlayerId = null;
      for (const player of room.players.values()) player.buzzedAt = null;
      room.openingStartArmed = false;
      room.openingQuestionRound = '';
      room.openingQuestionIndex = null;
      room.openingQuestionMode = '';
      room.openingEmptyQuestionNumber = null;
      room.question = '';
      emitRoom(room);
    }
    io.to(room.code).emit('projector:audio', { type });
    ack({ ok: true });
  });
  socket.on('host:spotlight', ({ round, playerId } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    const selectedRound = String(round || '').trim();
    const allowedRounds = ['Thí sinh 1', 'Thí sinh 2', 'Thí sinh 3', 'Thí sinh 4', 'Lượt chung'];
    if (selectedRound && (!allowedRounds.includes(selectedRound) || !room.questions.some(question => question.round === selectedRound))) {
      return ack({ ok: false, error: 'Lượt thi không có trong Database Khởi động của phòng.' });
    }
    const selectedPlayerId = playerId ? String(playerId) : '';
    if (selectedPlayerId && !room.players.has(selectedPlayerId)) return ack({ ok: false, error: 'Không tìm thấy thí sinh được chọn.' });
    room.spotlightRound = selectedRound;
    room.spotlightPlayerId = selectedPlayerId || null;
    if (selectedRound !== 'Lượt chung') room.openingStartArmed = false;
    emitRoom(room);
    ack({ ok: true });
  });
  socket.on('host:reset', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'host' || room.hostId !== socket.id) return ack({ ok: false, error: 'Không có quyền Host.' });
    stopBuzzerCountdown(room); stopWinnerCountdown(room); stopTimer(room); stopOpeningTimer(room); stopIndependentTimer(room, false); room.independentTimer.remainingMs = room.independentTimer.duration * 1000; room.independentTimer.startedAt = null; room.independentTimer.startedAt = null; room.status = 'waiting'; room.deadline = null; room.openingQuestionRound = ''; room.openingQuestionIndex = null; room.openingQuestionMode = ''; room.openingStartArmed = false; room.openingEmptyQuestionNumber = null; room.winnerId = null; room.roundStartedAt = null; room.answers = []; room.buzzes = [];
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
    const enabled = Boolean(alwaysOpen);
    if (room.buzzerAlwaysOpen !== enabled) {
      stopWinnerCountdown(room);
      room.buzzes = [];
      for (const player of room.players.values()) player.buzzedAt = null;
    }
    room.buzzerAlwaysOpen = enabled;
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
  socket.on('host:answer:reveal', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    const answers = [...room.players.values()]
      .filter(player => player.latestAnswer)
      .map(player => ({
        name: player.name,
        team: player.team,
        answer: player.latestAnswer.answer,
        elapsedMs: player.latestAnswer.elapsedMs,
        submittedAt: player.latestAnswer.submittedAt
      }))
      .sort((a, b) => a.elapsedMs - b.elapsedMs || a.submittedAt - b.submittedAt);
    io.to(room.code).emit('player:answer:reveal', { answers });
    ack({ ok: true, count: answers.length });
  });
  socket.on('host:database:get', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    ack({ ok: true, questions: room.questions });
  });
  socket.on('host:database:clear', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    const deleted = room.questions.length;
    room.questions = [];
    ack({ ok: true, questions: room.questions, deleted });
  });
  socket.on('host:database:import', ({ questions } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (!Array.isArray(questions) || !questions.length || questions.length > 2000) return ack({ ok: false, error: 'File phải có từ 1 đến 2000 câu hỏi.' });
    const imported = questions.map(question => normalizeQuestion(question)).filter(Boolean);
    if (imported.length !== questions.length) return ack({ ok: false, error: 'Dữ liệu nhập có câu hỏi không hợp lệ.' });
    room.questions.push(...imported);
    ack({ ok: true, questions: room.questions, imported: imported.length });
  });
  socket.on('host:database:add', ({ question } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    const normalized = normalizeQuestion(question);
    if (!normalized) return ack({ ok: false, error: 'Nội dung câu hỏi không hợp lệ.' });
    room.questions.push(normalized);
    ack({ ok: true, questions: room.questions });
  });
  socket.on('host:database:update', ({ id, question } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    const index = room.questions.findIndex(item => item.id === id);
    if (index < 0) return ack({ ok: false, error: 'Không tìm thấy câu hỏi.' });
    const normalized = normalizeQuestion(question, id);
    if (!normalized) return ack({ ok: false, error: 'Dữ liệu câu hỏi không hợp lệ.' });
    room.questions[index] = normalized;
    ack({ ok: true, questions: room.questions });
  });
  socket.on('host:database:updateGroup', ({ questions } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (!Array.isArray(questions) || !questions.length || questions.length > 2000) return ack({ ok: false, error: 'Danh sách câu hỏi cần lưu không hợp lệ.' });
    const updates = [];
    const seenIds = new Set();
    for (const update of questions) {
      if (!update || typeof update.id !== 'string' || seenIds.has(update.id)) return ack({ ok: false, error: 'Danh sách câu hỏi cần lưu không hợp lệ.' });
      seenIds.add(update.id);
      const index = room.questions.findIndex(item => item.id === update.id);
      if (index < 0) return ack({ ok: false, error: 'Không tìm thấy câu hỏi cần lưu.' });
      const current = room.questions[index];
      const normalized = normalizeQuestion({ ...current, round: update.round, prompt: update.prompt, answer: update.answer }, update.id);
      if (!normalized) return ack({ ok: false, error: 'Kiểm tra nội dung câu hỏi và điểm số trước khi lưu.' });
      updates.push({ index, question: normalized });
    }
    for (const update of updates) room.questions[update.index] = update.question;
    ack({ ok: true, questions: room.questions });
  });
  socket.on('host:database:delete', ({ id } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    const originalLength = room.questions.length;
    room.questions = room.questions.filter(item => item.id !== id);
    if (room.questions.length === originalLength) return ack({ ok: false, error: 'Không tìm thấy câu hỏi.' });
    ack({ ok: true, questions: room.questions });
  });
  socket.on('host:score', ({ playerId, delta } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'host' || room.hostId !== socket.id) return ack({ ok: false, error: 'Không có quyền Host.' });
    const p = room.players.get(playerId);
    if (!p) return ack({ ok: false, error: 'Không tìm thấy người chơi.' });
    p.score = Math.max(-9999, Math.min(9999, p.score + Math.max(-100, Math.min(1000, Number(delta) || 0))));
    emitRoom(room); ack({ ok: true });
  });
  socket.on('host:remove', ({ playerId } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'host' || room.hostId !== socket.id) return ack({ ok: false, error: 'Không có quyền Host.' });
    const p = room.players.get(playerId); if (p) { room.players.delete(playerId); room.answers = room.answers.filter(a => a.playerId !== playerId); if (room.spotlightPlayerId === playerId) room.spotlightPlayerId = null; const s = io.sockets.sockets.get(playerId); if (s) s.leave(room.code); }
    emitRoom(room); emitHostAnswers(room); ack({ ok: true });
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    if (socket.data.role === 'player') {
      const p = room.players.get(socket.id); if (p) { p.connected = false; p.focused = false; }
      emitRoom(room);
    }
    // Host room remains available for host rejoin while the process is alive.
  });
});

function normalizeQuestion(question, id = crypto.randomUUID()) {
  if (!question || typeof question !== 'object' || Array.isArray(question)) return null;
  const prompt = String(question.prompt || '').trim().slice(0, 5000);
  const points = Number(question.points);
  if (!prompt || !Number.isInteger(points) || points < -10000 || points > 10000) return null;
  const rawData = question.rawData && typeof question.rawData === 'object' && !Array.isArray(question.rawData) ? question.rawData : {};
  return {
    id,
    round: String(question.round || '').trim().slice(0, 120),
    prompt,
    answer: String(question.answer || '').trim().slice(0, 5000),
    notes: String(question.notes || '').trim().slice(0, 5000),
    points,
    sourceSheet: String(question.sourceSheet || '').trim().slice(0, 120),
    sourceRow: Number.isInteger(Number(question.sourceRow)) ? Number(question.sourceRow) : null,
    rawData: Object.fromEntries(Object.entries(rawData).slice(0, 40).map(([key, value]) => [String(key).slice(0, 100), String(value).slice(0, 1000)]))
  };
}

server.listen(PORT, () => console.log(`Olympia Buzzer running on port ${PORT}`));
