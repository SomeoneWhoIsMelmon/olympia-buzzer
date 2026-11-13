const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 11 * 1024 * 1024 });
const PORT = process.env.PORT || 3000;
const rooms = new Map(); // Starter version: in-memory; rooms reset when server restarts.
const introMediaDefaults = ['IntroKD', 'IntroVCNV', 'IntroTT', 'IntroVD', 'Intro'].map(name => {
  const filePath = path.join(__dirname, 'public', 'DoHoa', `${name}.mp4`);
  if (!fs.existsSync(filePath)) return null;
  const data = fs.readFileSync(filePath);
  return { name: `${name}.mp4`, type: 'video/mp4', size: data.length, data };
});

app.use(express.static('public'));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

const code = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const clean = (s, max = 24) => String(s || '').trim().replace(/[<>]/g, '').slice(0, max);
function publicRoom(room) {
  return {
    code: room.code, status: room.status, duration: room.duration, question: room.question || '',
    finishQuestionCount: room.finishQuestionSequence?.length || 0, finishQuestionPointsSequence: (room.finishQuestionSequence || []).map(question => question.points), finishAllowFortyQuestionFour: Boolean(room.finishAllowFortyQuestionFour), finishQuestionIndex: room.finishQuestionIndex,
    finishQuestionPoints: Number.isInteger(room.finishQuestionIndex) ? room.finishQuestionSequence?.[room.finishQuestionIndex]?.points ?? null : null,
    finishPlayerId: room.finishPlayerId || null, finishNshv: Boolean(room.finishNshv), finishStealPending: Boolean(room.finishStealPending),
    projectorVolume: room.projectorVolume,
    deadline: room.deadline, openingDeadline: room.openingDeadline || null, buzzerCountdownDeadline: room.buzzerCountdownDeadline || null, winnerCountdownDeadline: room.winnerCountdownDeadline || null, buzzerAlwaysOpen: room.buzzerAlwaysOpen, winnerId: room.winnerId, buzzes: room.buzzes || [],
    spotlightRound: room.spotlightRound || '', spotlightPlayerId: room.spotlightPlayerId || null,
    openingQuestionRound: room.openingQuestionRound || '', openingQuestionIndex: Number.isInteger(room.openingQuestionIndex) ? room.openingQuestionIndex : null,
    openingQuestionMode: room.openingQuestionMode || '', openingStartArmed: Boolean(room.openingStartArmed), openingEmptyQuestionNumber: Number.isInteger(room.openingEmptyQuestionNumber) ? room.openingEmptyQuestionNumber : null,
    roundMode: room.roundMode || 'opening', obstacleStarted: Boolean(room.obstacleStarted), obstacleSelectedRow: room.obstacleSelectedRow || null, obstacleRowsSelected: [...(room.obstacleRowsSelected || [])], obstaclePictureOpen: Boolean(room.obstaclePictureOpen), obstaclePictureRevealed: [...(room.obstaclePictureRevealed || [])], obstaclePictureEverRevealed: [...(room.obstaclePictureEverRevealed || [])], obstacleBuzzOrder: room.obstacleBuzzOrder || [],
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, score: p.score, connected: p.connected, focused: p.focused !== false, buzzedAt: p.buzzedAt, obstacleBuzzed: Boolean(p.obstacleBuzzed), obstacleBuzzUsed: Boolean(p.obstacleBuzzUsed), obstacleBuzzJudged: Boolean(p.obstacleBuzzJudged), answerSubmitted: Boolean(p.answerSubmitted), latestAnswer: p.latestAnswer || null })),
    teams: room.teams, answerCount: room.answers.length, independentTimer: { duration: room.independentTimer.duration, running: room.independentTimer.running, deadline: room.independentTimer.deadline, remainingMs: room.independentTimer.running && room.independentTimer.deadline ? Math.max(0, room.independentTimer.deadline - Date.now()) : room.independentTimer.remainingMs, startedAt: room.independentTimer.startedAt }
  };
}
function emitRoom(room) { io.to(room.code).emit('room:update', publicRoom(room)); }
function emitHostAnswers(room) { if (room.hostId) io.to(room.hostId).emit('answers:update', room.answers); }
function obstacleBonus(room) { return 70 - 10 * Math.max(room.obstacleRowsSelected?.size || 0, room.obstaclePictureEverRevealed?.size || 0, Object.keys(room.obstacleVerdicts || {}).length); }
function openAllObstacle(room) {
  room.obstaclePictureRevealed = new Set(['1', '2', '3', '4', '5']);
  for (const tileId of room.obstaclePictureRevealed) room.obstaclePictureEverRevealed.add(tileId);
  for (let row = 1; row <= 5; row++) {
    room.obstacleVerdicts[row] = 'Đ';
    io.to(`${room.code}:projector`).emit('projector:obstacle:verdict', { row, verdict: 'Đ' });
  }
}
function obstacleAnswerCells(answer = '') { const cells = Array(15).fill(''); for (const [index, character] of Array.from(String(answer)).entries()) { if (index >= 15) break; cells[index] = character; } return cells; }
function emitProjectorObstacleAnswers(room, target = `${room.code}:projector`) {
  io.to(target).emit('projector:obstacle:answers', { rows: room.obstacleCourse.rows.map(row => Array.isArray(row.answerCells) ? row.answerCells.slice(0, 15) : obstacleAnswerCells(row.answer)), verdicts: room.obstacleVerdicts || {} });
}
function clearRoomAnswers(room) {
  room.answers = [];
  for (const player of room.players.values()) { player.latestAnswer = null; player.answerSubmitted = false; }
  emitRoom(room);
  emitHostAnswers(room);
  io.to(room.code).emit('projector:answer:hide');
}
function emitHostDatabaseQuestions(room) { if (room.hostId) io.to(room.hostId).emit('host:database:questions:update', room.questions); }
function emitHostSpeedQuestions(room) {
  if (!room.hostId) return;
  io.to(room.hostId).emit('host:database:speed-questions:update', room.speedQuestions.map(slot => ({
    prompt: slot.prompt,
    answer: slot.answer,
    media: slot.media ? { name: slot.media.name, type: slot.media.type, size: slot.media.size } : null
  })));
}
function getActiveRoundMedia(room) {
  if (room.roundMode === 'obstacle') return room.obstacleCourse.media || null;
  if (room.roundMode === 'speed' && Number.isInteger(room.activeSpeedQuestionSlot)) {
    return room.speedQuestions[room.activeSpeedQuestionSlot]?.media || null;
  }
  return null;
}
function emitActiveRoundMedia(room, target = room.code) {
  const media = getActiveRoundMedia(room);
  io.to(target).emit('round:media', media ? { name: media.name, type: media.type, data: media.data } : null);
}
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
function resetFinishBuzzer(room) {
  stopTimer(room);
  stopBuzzerCountdown(room);
  stopWinnerCountdown(room);
  room.status = 'locked';
  room.deadline = null;
  room.winnerId = null;
  room.buzzes = [];
  room.roundStartedAt = null;
  for (const player of room.players.values()) player.buzzedAt = null;
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
  socket.on('time:sync', (_payload, ack = () => {}) => {
    ack({ serverTime: Date.now() });
  });
  socket.on('room:peek', ({ code: rawCode } = {}, ack = () => {}) => {
    const room = rooms.get(clean(rawCode, 8).toUpperCase());
    if (!room) return ack({ ok: false, error: 'Không tìm thấy phòng.' });
    ack({ ok: true, teams: room.teams });
  });
  socket.on('projector:join', ({ code: rawCode } = {}, ack = () => {}) => {
    const room = rooms.get(clean(rawCode, 8).toUpperCase());
    if (!room) return ack({ ok: false, error: 'Không tìm thấy phòng.' });
    socket.join(room.code);
    socket.join(`${room.code}:projector`);
    socket.data.roomCode = room.code;
    socket.data.role = 'projector';
    ack({ ok: true, state: publicRoom(room) });
    emitActiveRoundMedia(room, socket.id);
    emitProjectorObstacleAnswers(room, socket.id);
  });
  socket.on('host:create', ({ hostName, duration, teams } = {}, ack = () => {}) => {
    let roomCode; do { roomCode = code(); } while (rooms.has(roomCode));
    const room = {
      code: roomCode, hostId: socket.id, hostName: clean(hostName, 24) || 'Host', question: '', projectorVolume: 1, obstacleVerdicts: {}, obstacleStarted: false, obstacleSelectedRow: null, obstacleRowsSelected: new Set(), obstaclePictureOpen: false, obstaclePictureRevealed: new Set(), obstaclePictureEverRevealed: new Set(), obstacleBuzzOrder: [],
      duration: Math.max(1, Math.min(300, Number(duration) || 5)),
      buzzerAlwaysOpen: true,
      teams: Array.isArray(teams) ? teams.slice(0, 12).map(t => clean(t, 20)).filter(Boolean) : ['Đội 1', 'Đội 2'],
      players: new Map(), answers: [], buzzes: [], questions: [], introMedia: [...introMediaDefaults, null, null, null], speedQuestions: Array.from({ length: 4 }, () => ({ prompt: '', answer: '', media: null })), obstacleCourse: { rows: Array.from({ length: 4 }, () => ({ answer: '', answerCells: Array(15).fill(''), question: '' })), keyword: '', keywordQuestion: '', fullAnswer: '', media: null }, finishRounds: Array.from({ length: 4 }, () => Array.from({ length: 7 }, () => ({ question: '', answer: '' }))), finishQuestionSequence: [], finishQuestionRound: null, finishQuestionIndex: null, finishQuestionPoints: null, finishAllowFortyQuestionFour: false, finishPlayerId: null, finishStealPending: false, finishStealNshv: false, roundMode: 'opening', activeSpeedQuestionSlot: null, databaseAccessToken: null, spotlightRound: '', spotlightPlayerId: null, openingQuestionRound: '', openingQuestionIndex: null, openingQuestionMode: '', openingStartArmed: false, openingEmptyQuestionNumber: null, openingDeadline: null, openingTimer: null, openingTimerKind: null, roundStartedAt: null, status: 'waiting', deadline: null, timer: null, buzzerCountdownDeadline: null, buzzerCountdownTimer: null, winnerCountdownDeadline: null, winnerCountdownTimer: null, winnerId: null, independentTimer: { duration: 60, remainingMs: 60000, deadline: null, startedAt: null, handle: null }
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
  socket.on('host:database:token', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    room.databaseAccessToken ||= crypto.randomBytes(32).toString('hex');
    ack({ ok: true, token: room.databaseAccessToken });
  });
  socket.on('host:database:join', ({ code: rawCode, token } = {}, ack = () => {}) => {
    const room = rooms.get(clean(rawCode, 8).toUpperCase());
    if (!room || typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token) || !room.databaseAccessToken) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
    const supplied = Buffer.from(token, 'hex');
    const expected = Buffer.from(room.databaseAccessToken, 'hex');
    if (!crypto.timingSafeEqual(supplied, expected)) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
    socket.data.roomCode = room.code;
    socket.data.role = 'database';
    socket.data.databaseToken = token;
    ack({ ok: true, code: room.code });
  });

  socket.on('player:join', ({ code: rawCode, name, team } = {}, ack = () => {}) => {
    const room = rooms.get(clean(rawCode, 8).toUpperCase());
    if (!room) return ack({ ok: false, error: 'Mã phòng không hợp lệ.' });
    if (room.deadline && Date.now() < room.deadline) return ack({ ok: false, error: 'Lượt đang diễn ra, Host tạm khóa người chơi mới.' });
    const playerName = clean(name, 24);
    if (!playerName) return ack({ ok: false, error: 'Bạn cần nhập tên.' });
    const chosenTeam = room.teams.includes(team) ? team : room.teams[0];
    const player = { id: socket.id, name: playerName, team: chosenTeam, score: 0, connected: true, focused: true, buzzedAt: null, obstacleBuzzed: false, obstacleBuzzUsed: false, obstacleBuzzJudged: false, answerSubmitted: false, latestAnswer: null };
    room.players.set(socket.id, player); socket.join(room.code);
    socket.data.roomCode = room.code; socket.data.role = 'player';
    ack({ ok: true, playerId: socket.id, state: publicRoom(room) }); emitRoom(room); emitActiveRoundMedia(room, socket.id);
  });

  socket.on('player:answer', ({ answer } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'player') return ack({ ok: false, error: 'Không tìm thấy phòng.' });
    const player = room.players.get(socket.id);
    if (!player) return ack({ ok: false, error: 'Không tìm thấy người chơi.' });
    if (room.roundMode === 'obstacle' && player.obstacleBuzzUsed) return ack({ ok: false, error: 'Bạn đã bấm chuông Vượt chướng ngại vật rồi.' });
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
    room.answers.push(submission); player.latestAnswer = { id: submission.id, answer: text, elapsedMs, submittedAt: submission.submittedAt };
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
    if (!player) return ack({ ok: false, error: 'Không tìm thấy người chơi.' });
    if (room.roundMode === 'obstacle') {
      if (!room.obstacleStarted) return ack({ ok: false, error: 'Chuông Vượt chướng ngại vật chưa mở.' });
      if (player.obstacleBuzzUsed) return ack({ ok: false, error: 'Bạn đã bấm chuông Vượt chướng ngại vật rồi.' });
      const receivedAt = Date.now();
      player.obstacleBuzzed = true;
      player.obstacleBuzzUsed = true;
      player.obstacleBuzzJudged = false;
      player.buzzedAt = receivedAt;
      const buzz = { id: crypto.randomUUID(), playerId: player.id, name: player.name, team: player.team, receivedAt, elapsedMs: Math.max(0, receivedAt - (room.roundStartedAt || receivedAt)) };
      room.buzzes.push(buzz);
      room.obstacleBuzzOrder.push(buzz);
      emitRoom(room);
      ack({ ok: true, alwaysOpen: true, obstacle: true, elapsedMs: buzz.elapsedMs });
      return;
    }
    if (room.status !== 'playing' || !room.deadline || Date.now() >= room.deadline) return ack({ ok: false, error: 'Chuông hiện không mở.' });
    if (room.roundMode === 'finish' && player.id === room.finishPlayerId) return ack({ ok: false, error: 'Thí sinh đang thi Về đích không được bấm chuông.' });
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

  socket.on('host:question', ({ question, resetBuzzer, clearAnswers = false, obstacleRow } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'host' || room.hostId !== socket.id) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (typeof clearAnswers !== 'boolean') return ack({ ok: false, error: 'Trạng thái xóa câu trả lời không hợp lệ.' });
    if (resetBuzzer) stopBuzzerCountdown(room);
    room.question = String(question || '').trim().slice(0, 500);
    room.obstacleSelectedRow = room.roundMode === 'obstacle' && Number.isInteger(obstacleRow) && obstacleRow >= 1 && obstacleRow <= 5 ? obstacleRow : null;
    if (room.roundMode === 'obstacle' && Number.isInteger(obstacleRow) && obstacleRow >= 1 && obstacleRow <= 5) room.obstacleRowsSelected.add(obstacleRow);
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
    if (clearAnswers) {
      room.answers = [];
      for (const player of room.players.values()) { player.latestAnswer = null; player.answerSubmitted = false; }
    }
    emitRoom(room);
    if (clearAnswers) { emitHostAnswers(room); io.to(room.code).emit('projector:answer:hide'); }
    ack({ ok: true });
  });
  socket.on('host:finish:commit', ({ round, playerId, points, allowFortyQuestionFour } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (room.roundMode !== 'finish') return ack({ ok: false, error: 'Hãy chọn vòng thi Về đích trước.' });
    if (allowFortyQuestionFour !== false) return ack({ ok: false, error: 'Chốt hiện chỉ hỗ trợ khi chưa bật tùy chọn câu 40 điểm và câu số 4.' });
    if (!Number.isInteger(round) || round < 0 || round >= room.finishRounds.length) return ack({ ok: false, error: 'Hãy chọn lượt thi Về đích.' });
    if (typeof playerId !== 'string' || !room.players.has(playerId)) return ack({ ok: false, error: 'Hãy chọn thí sinh Về đích.' });
    if (!Array.isArray(points) || points.length !== 3 || points.some(value => value !== 20 && value !== 30)) {
      return ack({ ok: false, error: 'Hãy chọn mức điểm cho đủ ba câu đầu tiên.' });
    }
    const pointOffsets = { 20: 0, 30: 3 };
    const selectedQuestions = points.map((value, questionIndex) =>
      room.finishRounds[round][pointOffsets[value] + questionIndex]
    );
    if (selectedQuestions.some(item => !item?.question?.trim() || !item?.answer?.trim())) {
      return ack({ ok: false, error: 'Câu hỏi hoặc đáp án được chọn chưa có trong Database.' });
    }
    room.finishQuestionSequence = selectedQuestions.map((item, index) => ({ ...item, points: points[index] }));
    room.finishQuestionRound = round;
    room.finishAllowFortyQuestionFour = Boolean(allowFortyQuestionFour);
    room.finishQuestionIndex = null;
    room.finishPlayerId = playerId;
    room.finishStealPending = false;
    room.finishStealNshv = false;
    room.question = '';
    emitRoom(room);
    io.to(room.code).emit('projector:finish:presentation', { action: 'commit' });
    io.to(room.code).emit('projector:audio', { type: 'startTurnVD' });
    ack({ ok: true, count: room.finishQuestionSequence.length });
  });
  socket.on('host:finish:navigate', ({ direction } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (room.roundMode !== 'finish') return ack({ ok: false, error: 'Hãy chọn vòng thi Về đích trước.' });
    if (direction !== 'next' && direction !== 'previous') return ack({ ok: false, error: 'Hướng chuyển câu không hợp lệ.' });
    if (!room.finishQuestionSequence.length) return ack({ ok: false, error: 'Hãy nhấn Chốt trước khi chuyển câu.' });
    const nextIndex = room.finishQuestionIndex === null
      ? (direction === 'next' ? 0 : -1)
      : room.finishQuestionIndex + (direction === 'next' ? 1 : -1);
    if (nextIndex < 0 || nextIndex >= room.finishQuestionSequence.length) {
      return ack({ ok: false, error: direction === 'next' ? 'Đã đến câu cuối của lượt Về đích.' : 'Đây là câu đầu tiên của lượt Về đích.' });
    }
    resetFinishBuzzer(room);
    room.finishStealPending = false;
    room.finishStealNshv = false;
    room.finishQuestionIndex = nextIndex;
    const selected = room.finishQuestionSequence[nextIndex];
    room.question = selected.question;
    io.to(room.hostId).emit('host:finish:answer', { answer: selected.answer });
    emitRoom(room);
    ack({ ok: true, answer: selected.answer, index: nextIndex });
  });
  socket.on('host:finish:end', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    resetFinishBuzzer(room);
    room.finishQuestionSequence = [];
    room.finishQuestionRound = null;
    room.finishQuestionIndex = null;
    room.finishAllowFortyQuestionFour = false;
    room.finishPlayerId = null;
    room.finishNshv = false;
    room.finishStealPending = false;
    room.finishStealNshv = false;
    emitRoom(room);
    io.to(room.code).emit('projector:finish:presentation', { action: 'end' });
    io.to(room.code).emit('projector:audio', { type: 'endTurnVD' });
    ack({ ok: true });
  });
  socket.on('host:finish:nshv', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (room.roundMode !== 'finish' || !room.finishPlayerId) return ack({ ok: false, error: 'Hãy chọn thí sinh và bắt đầu lượt Về đích trước.' });
    room.finishNshv = !room.finishNshv;
    if (room.finishNshv) io.to(room.code).emit('projector:audio', { type: 'nshv' });
    emitRoom(room); ack({ ok: true, finishNshv: room.finishNshv });
  });
  socket.on('host:finish:start', ({ playerId } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (room.roundMode !== 'finish' || typeof playerId !== 'string' || !room.players.has(playerId)) return ack({ ok: false, error: 'Hãy chọn thí sinh Về đích.' });
    room.finishPlayerId = playerId;
    room.finishNshv = false;
    room.finishStealPending = false;
    room.finishStealNshv = false;
    resetFinishBuzzer(room);
    room.question = '';
    emitRoom(room); ack({ ok: true });
    io.to(room.code).emit('projector:audio', { type: 'startVDCombined' });
  });
  socket.on('host:finish:judge', ({ correct } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (room.roundMode !== 'finish' || !room.finishPlayerId || !Number.isInteger(room.finishQuestionIndex)) return ack({ ok: false, error: 'Hãy bắt đầu lượt Về đích và hiển thị câu hỏi trước.' });
    if (typeof correct !== 'boolean') return ack({ ok: false, error: 'Kết quả chấm không hợp lệ.' });
    if (room.finishStealPending) {
      const buzzerWinnerId = room.buzzerAlwaysOpen ? room.buzzes[0]?.playerId : room.winnerId;
      if (!buzzerWinnerId) return ack({ ok: false, error: 'Chưa có thí sinh nào bấm chuông.' });
      const player = room.players.get(buzzerWinnerId);
      const primary = room.players.get(room.finishPlayerId);
      const question = room.finishQuestionSequence[room.finishQuestionIndex];
      if (!player || !primary || !question || !Number.isInteger(question.points)) return ack({ ok: false, error: 'Không tìm thấy thí sinh hoặc điểm câu hỏi.' });
      const delta = correct ? question.points : -Math.floor(question.points / 2);
      player.score = Math.max(-9999, Math.min(9999, player.score + delta));
      if (correct && !room.finishStealNshv) primary.score = Math.max(-9999, Math.min(9999, primary.score - question.points));
      room.finishStealPending = false;
      room.finishStealNshv = false;
      room.finishNshv = false;
      room.status = 'locked';
      room.deadline = null;
      emitRoom(room);
      io.to(room.code).emit('projector:audio', { type: correct ? 'finishCorrect' : 'finishStealWrong' });
      return ack({ ok: true, delta });
    }
    const player = room.players.get(room.finishPlayerId);
    const question = room.finishQuestionSequence[room.finishQuestionIndex];
    if (!player || !question || !Number.isInteger(question.points)) return ack({ ok: false, error: 'Không tìm thấy thí sinh hoặc điểm câu hỏi.' });
    let delta = 0;
    if (correct) delta = question.points * (room.finishNshv ? 2 : 1);
    else if (room.finishNshv) delta = -question.points;
    room.finishStealNshv = Boolean(room.finishNshv);
    room.finishNshv = false;
    player.score = Math.max(-9999, Math.min(9999, player.score + delta));
    if (!correct) {
      room.finishStealPending = true;
      startBuzzerRound(room, 5);
    }
    else emitRoom(room);
    io.to(room.code).emit('projector:audio', { type: correct ? 'finishCorrect' : 'finishWrong' });
    ack({ ok: true, delta, finishNshv: Boolean(room.finishNshv) });
  });
  socket.on('host:round-mode', ({ round, speedSlot, openMedia = false } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    const allowedRounds = ['intro', 'opening', 'obstacle', 'speed', 'finish', 'bonus'];
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (!allowedRounds.includes(round)) return ack({ ok: false, error: 'Vòng thi không hợp lệ.' });
    if (typeof openMedia !== 'boolean') return ack({ ok: false, error: 'Trạng thái media không hợp lệ.' });
    if (openMedia && round !== 'speed') return ack({ ok: false, error: 'Chỉ có thể mở media cho câu Tăng tốc.' });
    if (round === 'speed' && speedSlot !== undefined && speedSlot !== null && (!Number.isInteger(speedSlot) || speedSlot < 0 || speedSlot >= room.speedQuestions.length)) return ack({ ok: false, error: 'Câu Tăng tốc không hợp lệ.' });
    if (openMedia && !Number.isInteger(speedSlot)) return ack({ ok: false, error: 'Hãy chọn câu Tăng tốc trước khi mở media.' });
    room.roundMode = round;
    if (round !== 'intro') io.to(`${room.code}:projector`).emit('projector:intro:hide');
    if (round === 'obstacle') { room.obstacleVerdicts = {}; room.obstacleStarted = false; room.obstacleSelectedRow = null; room.obstacleRowsSelected.clear(); room.obstaclePictureOpen = false; room.obstaclePictureRevealed.clear(); room.obstaclePictureEverRevealed.clear(); room.obstacleBuzzOrder = []; room.buzzes = []; for (const player of room.players.values()) { player.buzzedAt = null; player.obstacleBuzzed = false; player.obstacleBuzzUsed = false; player.obstacleBuzzJudged = false; } }
    room.activeSpeedQuestionSlot = round === 'speed' && openMedia && Number.isInteger(speedSlot) ? speedSlot : null;
    emitRoom(room);
    emitActiveRoundMedia(room);
    if (round === 'obstacle') emitProjectorObstacleAnswers(room);
    ack({ ok: true });
  });
  socket.on('host:intro:play', ({ slot } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (room.roundMode !== 'intro') return ack({ ok: false, error: 'Hãy chọn phần thi Intro trước.' });
    if (!Number.isInteger(slot) || slot < 0 || slot >= room.introMedia.length) return ack({ ok: false, error: 'Ô Intro không hợp lệ.' });
    const media = room.introMedia[slot];
    if (!media) return ack({ ok: false, error: 'Chưa có media cho Intro này trong MEDIADATABASE.' });
    io.to(`${room.code}:projector`).emit('projector:intro:media', { name: media.name, type: media.type, data: media.data });
    ack({ ok: true });
  });
  socket.on('host:obstacle:verdict', ({ row, verdict } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (room.roundMode !== 'obstacle' || !Number.isInteger(row) || row < 1 || row > 5 || !['Đ', 'S'].includes(verdict)) return ack({ ok: false, error: 'Kết quả hàng ngang không hợp lệ.' });
    room.obstacleVerdicts[row] = verdict;
    io.to(`${room.code}:projector`).emit('projector:obstacle:verdict', { row, verdict });
    ack({ ok: true });
  });
  socket.on('host:obstacle:row-selected', ({ row } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (room.roundMode !== 'obstacle' || !Number.isInteger(row) || row < 1 || row > 5) return ack({ ok: false, error: 'Hàng ngang không hợp lệ.' });
    room.obstacleRowsSelected.add(row);
    io.to(`${room.code}:projector`).emit('projector:obstacle:question-presentation', { action: 'show' });
    ack({ ok: true });
  });
  socket.on('host:obstacle:picture-open', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (room.roundMode !== 'obstacle') return ack({ ok: false, error: 'Hãy chọn phần thi Vượt chướng ngại vật trước.' });
    room.obstaclePictureOpen = !room.obstaclePictureOpen;
    emitRoom(room);
    ack({ ok: true });
  });
  socket.on('host:obstacle:start', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (room.roundMode !== 'obstacle') return ack({ ok: false, error: 'Hãy chọn phần thi Vượt chướng ngại vật trước.' });
    room.obstacleStarted = true;
    room.obstaclePictureOpen = false;
    emitRoom(room);
    ack({ ok: true });
  });
  socket.on('host:obstacle:reveal', ({ tile, open, all } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (room.roundMode !== 'obstacle') return ack({ ok: false, error: 'Hãy chọn phần thi Vượt chướng ngại vật trước.' });
    if (all === true) {
      openAllObstacle(room);
    } else {
      const tileId = String(tile);
      if (!['1', '2', '3', '4', '5'].includes(tileId) || typeof open !== 'boolean') return ack({ ok: false, error: 'Mảnh ảnh không hợp lệ.' });
      if (open) room.obstaclePictureRevealed.add(tileId);
      else room.obstaclePictureRevealed.delete(tileId);
      if (open) room.obstaclePictureEverRevealed.add(tileId);
    }
    emitRoom(room);
    ack({ ok: true, obstaclePictureRevealed: [...room.obstaclePictureRevealed] });
  });
  socket.on('host:obstacle:bonus', ({ playerId } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    const player = room.players.get(playerId);
    if (room.roundMode !== 'obstacle' || !player?.obstacleBuzzed || player.obstacleBuzzJudged) return ack({ ok: false, error: 'Không tìm thấy lượt chuông Vượt chướng ngại vật cần chấm.' });
    ack({ ok: true, points: obstacleBonus(room) });
  });
  socket.on('host:obstacle:judge', ({ playerId, correct, expectedPoints } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    const player = room.players.get(playerId);
    if (room.roundMode !== 'obstacle' || typeof correct !== 'boolean' || !player?.obstacleBuzzed || player.obstacleBuzzJudged) return ack({ ok: false, error: 'Không tìm thấy lượt chuông Vượt chướng ngại vật cần chấm.' });
    const points = correct ? obstacleBonus(room) : 0;
    if (correct && expectedPoints !== points) return ack({ ok: false, error: 'Điểm thưởng đã thay đổi. Hãy xác nhận lại số điểm.' });
    player.obstacleBuzzJudged = true;
    if (correct) {
      player.score = Math.max(-9999, Math.min(9999, player.score + points));
      openAllObstacle(room);
      room.obstacleBuzzOrder = [];
    } else {
      player.obstacleBuzzed = false;
      player.buzzedAt = null;
      room.buzzes = room.buzzes.filter(buzz => buzz.playerId !== player.id);
      room.obstacleBuzzOrder = room.obstacleBuzzOrder.filter(buzz => buzz.playerId !== player.id);
    }
    emitRoom(room);
    io.to(room.code).emit('projector:audio', { type: correct ? 'correctCNV' : 'wrongHN' });
    ack({ ok: true, points });
  });
  socket.on('host:speed-video:play', ({ seconds } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (![20, 30, 40].includes(seconds)) return ack({ ok: false, error: 'Thời lượng video Tăng tốc không hợp lệ.' });
    if (!room.independentTimer.running || room.independentTimer.duration !== seconds) return ack({ ok: false, error: 'Hãy bắt đầu đồng hồ bằng nút thời lượng tương ứng trước.' });
    const media = room.roundMode === 'speed' && Number.isInteger(room.activeSpeedQuestionSlot)
      ? room.speedQuestions[room.activeSpeedQuestionSlot]?.media
      : null;
    if (!media || !media.type.startsWith('video/')) return ack({ ok: false, error: 'Không có video Tăng tốc đang mở.' });
    io.to(room.code).emit('round:video:play', { seconds });
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
    if (!['start', 'end', 'opening', 'blank', 'vcnv15', 'tt20', 'tt30', 'tt40', 'speedQuestionOpen', 'showAnswerVCNV', 'showAnswerTT', 'correctHN', 'wrongHN', 'pickHNCombined', 'openHN', 'openAll', 'openPiece', 'roundStartKD', 'roundStartVCNV', 'roundStartTT', 'roundStartVD', 'win', 'cang1', 'cang2', 'cang3', 'correctDP', 'wrongDP', 'stopAllSFX'].includes(type)) return ack({ ok: false, error: 'Lệnh âm thanh không hợp lệ.' });
    if (type === 'start') {
      room.openingStartArmed = room.spotlightRound === 'Lượt chung';
      room.question = '';
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
      emitRoom(room);
    }
    io.to(room.code).emit('projector:audio', { type });
    ack({ ok: true });
  });
  socket.on('host:projector:volume', ({ volume } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 1) return ack({ ok: false, error: 'Mức âm lượng không hợp lệ.' });
    room.projectorVolume = volume;
    io.to(room.code).emit('projector:volume', { volume });
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
  function isDatabaseHost(room) {
    if (isHost(room)) return true;
    if (!room || socket.data.role !== 'database' || socket.data.roomCode !== room.code || typeof socket.data.databaseToken !== 'string' || !room.databaseAccessToken) return false;
    const token = socket.data.databaseToken;
    return /^[a-f0-9]{64}$/i.test(token) && crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(room.databaseAccessToken, 'hex'));
  }
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
      if (room.roundMode === 'obstacle' && t.duration === 15) clearRoomAnswers(room);
      else emitRoom(room);
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
    clearRoomAnswers(room); ack({ ok: true });
  });
  socket.on('host:finish:timer', ({ seconds } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (room.roundMode !== 'finish' || ![15, 20, 30].includes(seconds)) return ack({ ok: false, error: 'Thời lượng đồng hồ Về đích không hợp lệ.' });
    stopOpeningTimer(room);
    const deadline = Date.now() + seconds * 1000;
    room.openingDeadline = deadline;
    room.openingTimerKind = 'finish';
    room.openingTimer = setTimeout(() => {
      if (room.openingDeadline !== deadline || room.openingTimerKind !== 'finish') return;
      room.openingDeadline = null;
      room.openingTimer = null;
      room.openingTimerKind = null;
      emitRoom(room);
    }, seconds * 1000);
    emitRoom(room);
    io.to(room.code).emit('projector:audio', { type: `vd${seconds}` });
    ack({ ok: true });
  });
  socket.on('host:answer:reveal', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    const answers = [...room.players.values()]
      .filter(player => player.latestAnswer)
      .map(player => ({
        id: player.latestAnswer.id,
        name: player.name,
        team: player.team,
        answer: player.latestAnswer.answer,
        elapsedMs: player.latestAnswer.elapsedMs,
        submittedAt: player.latestAnswer.submittedAt,
        gradedCorrect: typeof player.latestAnswer.gradedCorrect === 'boolean' ? player.latestAnswer.gradedCorrect : null
      }))
      .sort((a, b) => a.elapsedMs - b.elapsedMs || a.submittedAt - b.submittedAt);
    io.to(room.code).emit('player:answer:reveal', { answers });
    ack({ ok: true, count: answers.length });
  });
  socket.on('host:answers:grade', ({ correctAnswerIds } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    if (!['obstacle', 'speed'].includes(room.roundMode)) return ack({ ok: false, error: 'Chấm đáp án hiện chỉ hỗ trợ Vượt chướng ngại vật và Tăng tốc.' });
    if (!Array.isArray(correctAnswerIds) || correctAnswerIds.length > room.players.size || correctAnswerIds.some(id => typeof id !== 'string')) return ack({ ok: false, error: 'Danh sách đáp án được chọn không hợp lệ.' });
    const correctIds = new Set(correctAnswerIds);
    const latestByPlayer = new Map();
    for (const submission of room.answers) {
      const old = latestByPlayer.get(submission.playerId);
      if (!old || submission.submittedAt >= old.submittedAt) latestByPlayer.set(submission.playerId, submission);
    }
    const latestIds = new Set([...latestByPlayer.values()].map(answer => answer.id));
    if ([...correctIds].some(id => !latestIds.has(id))) return ack({ ok: false, error: 'Một số đáp án đã thay đổi. Hãy chọn lại đáp án mới nhất.' });
    const ungradedCorrect = [...latestByPlayer.values()]
      .filter(answer => typeof answer.gradedCorrect !== 'boolean' && correctIds.has(answer.id))
      .sort((a, b) => a.elapsedMs - b.elapsedMs || a.submittedAt - b.submittedAt);
    const speedPoints = [40, 30, 20];
    const grades = [];
    for (const answer of latestByPlayer.values()) {
      if (typeof answer.gradedCorrect === 'boolean') continue;
      const correct = correctIds.has(answer.id);
      const rank = ungradedCorrect.findIndex(item => item.id === answer.id);
      const pointsAwarded = correct ? (room.roundMode === 'obstacle' ? 10 : speedPoints[rank] || 10) : 0;
      answer.gradedCorrect = correct;
      answer.pointsAwarded = pointsAwarded;
      const player = room.players.get(answer.playerId);
      if (player) {
        player.latestAnswer = { ...player.latestAnswer, gradedCorrect: correct, pointsAwarded };
        player.score = Math.max(-9999, Math.min(9999, player.score + pointsAwarded));
      }
      grades.push({ answerId: answer.id, correct, pointsAwarded });
    }
    emitRoom(room);
    emitHostAnswers(room);
    io.to(room.code).emit('answers:graded', { grades });
    let obstacleVerdict = null;
    const obstacleRow = room.obstacleSelectedRow;
    if (room.roundMode === 'obstacle' && Number.isInteger(obstacleRow) && obstacleRow >= 1 && obstacleRow <= 4) {
      obstacleVerdict = correctIds.size > 0 ? 'Đ' : 'S';
      room.obstacleVerdicts[obstacleRow] = obstacleVerdict;
      io.to(`${room.code}:projector`).emit('projector:obstacle:verdict', { row: obstacleRow, verdict: obstacleVerdict });
    }
    ack({ ok: true, grades, correctCount: grades.filter(grade => grade.correct).length, obstacleRow: obstacleVerdict ? obstacleRow : null, obstacleVerdict });
  });
  socket.on('host:answer:hide', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isHost(room)) return ack({ ok: false, error: 'Không có quyền Host.' });
    io.to(room.code).emit('projector:answer:hide');
    ack({ ok: true });
  });
  socket.on('host:database:get', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isDatabaseHost(room)) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
    const obstacleCourse = { ...room.obstacleCourse, media: room.obstacleCourse.media ? { name: room.obstacleCourse.media.name, type: room.obstacleCourse.media.type, size: room.obstacleCourse.media.size } : null };
    ack({ ok: true, questions: room.questions, introMedia: room.introMedia.map(media => media ? { name: media.name, type: media.type, size: media.size } : null), speedQuestions: room.speedQuestions.map(slot => ({ prompt: slot.prompt, answer: slot.answer, media: slot.media ? { name: slot.media.name, type: slot.media.type, size: slot.media.size } : null })), obstacleCourse, finishRounds: room.finishRounds });
  });
  socket.on('host:database:intro-media:set', ({ slot, name, type, data } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isDatabaseHost(room)) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
    if (!Number.isInteger(slot) || slot < 0 || slot >= room.introMedia.length) return ack({ ok: false, error: 'Ô Intro không hợp lệ.' });
    if (!Buffer.isBuffer(data) || data.length === 0 || data.length > 10 * 1024 * 1024) return ack({ ok: false, error: 'File media phải có dung lượng tối đa 10 MB.' });
    if (typeof type !== 'string' || !/^(image|video)\/[a-z0-9.+-]+$/i.test(type)) return ack({ ok: false, error: 'Chỉ hỗ trợ file ảnh hoặc video.' });
    if (typeof name !== 'string' || !name.trim() || name.length > 255) return ack({ ok: false, error: 'Tên file media không hợp lệ.' });
    const safeName = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 255);
    room.introMedia[slot] = { name: safeName, type, size: data.length, data };
    ack({ ok: true, media: { name: safeName, type, size: data.length } });
  });
  socket.on('host:database:intro-media:get', ({ slot } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isDatabaseHost(room)) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
    if (!Number.isInteger(slot) || slot < 0 || slot >= room.introMedia.length) return ack({ ok: false, error: 'Ô Intro không hợp lệ.' });
    const media = room.introMedia[slot];
    if (!media) return ack({ ok: false, error: 'Ô Intro chưa có media.' });
    ack({ ok: true, media: { name: media.name, type: media.type, size: media.size, data: media.data } });
  });
  socket.on('host:database:intro-media:delete', ({ slot } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isDatabaseHost(room)) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
    if (!Number.isInteger(slot) || slot < 0 || slot >= room.introMedia.length) return ack({ ok: false, error: 'Ô Intro không hợp lệ.' });
    room.introMedia[slot] = null;
    ack({ ok: true });
  });
  socket.on('host:database:obstacle-media:set', ({ name, type, data } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isDatabaseHost(room)) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
    if (!Buffer.isBuffer(data) || data.length === 0 || data.length > 10 * 1024 * 1024) return ack({ ok: false, error: 'File media phải có dung lượng tối đa 10 MB.' });
    if (typeof type !== 'string' || !/^(image|video)\/[a-z0-9.+-]+$/i.test(type)) return ack({ ok: false, error: 'Chỉ hỗ trợ file ảnh hoặc video.' });
    if (typeof name !== 'string' || !name.trim() || name.length > 255) return ack({ ok: false, error: 'Tên file media không hợp lệ.' });
    const safeName = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 255);
    room.obstacleCourse.media = { name: safeName, type, size: data.length, data };
    if (room.roundMode === 'obstacle') emitActiveRoundMedia(room);
    ack({ ok: true, media: { name: safeName, type, size: data.length } });
  });
  socket.on('host:database:obstacle-media:get', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isDatabaseHost(room)) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
    const media = room.obstacleCourse.media;
    if (!media) return ack({ ok: false, error: 'VCNV chưa có media.' });
    ack({ ok: true, media: { name: media.name, type: media.type, size: media.size, data: media.data } });
  });
  socket.on('host:database:obstacle-media:delete', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isDatabaseHost(room)) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
    room.obstacleCourse.media = null;
    if (room.roundMode === 'obstacle') emitActiveRoundMedia(room);
    ack({ ok: true });
  });
  socket.on('host:database:finish-round:update', ({ round, index, question, answer } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isDatabaseHost(room)) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
    if (!Number.isInteger(round) || round < 0 || round >= 4 || !Number.isInteger(index) || index < 0 || index >= 7 ||
      typeof question !== 'string' || question.length > 5000 || typeof answer !== 'string' || answer.length > 5000) return ack({ ok: false, error: 'Dữ liệu câu hỏi Về đích không hợp lệ.' });
    room.finishRounds[round][index] = { question, answer };
    ack({ ok: true, finishRounds: room.finishRounds });
  });
  socket.on('host:database:obstacle-course:update', ({ row, answer, answerCells, question, keyword, keywordQuestion, fullAnswer } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isDatabaseHost(room)) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
    if (row !== undefined) {
      if (!Number.isInteger(row) || row < 0 || row >= room.obstacleCourse.rows.length || (answer === undefined && answerCells === undefined && question === undefined) || (answer !== undefined && (typeof answer !== 'string' || answer.length > 64)) || (question !== undefined && (typeof question !== 'string' || question.length > 5000))) return ack({ ok: false, error: 'Dữ liệu hàng ngang không hợp lệ.' });
      if (answerCells !== undefined) {
        if (!Array.isArray(answerCells) || answerCells.length !== 15 || answerCells.some(cell => typeof cell !== 'string' || cell.length > 8)) return ack({ ok: false, error: 'Dữ liệu hàng ngang không hợp lệ.' });
        room.obstacleCourse.rows[row].answerCells = answerCells;
        room.obstacleCourse.rows[row].answer = answerCells.join('');
      } else if (answer !== undefined) {
        room.obstacleCourse.rows[row].answer = answer;
        room.obstacleCourse.rows[row].answerCells = obstacleAnswerCells(answer);
      }
      if (question !== undefined) room.obstacleCourse.rows[row].question = question;
    } else {
      if ((keyword === undefined && keywordQuestion === undefined && fullAnswer === undefined) || (keyword !== undefined && (typeof keyword !== 'string' || keyword.length > 5000)) || (keywordQuestion !== undefined && (typeof keywordQuestion !== 'string' || keywordQuestion.length > 5000)) || (fullAnswer !== undefined && (typeof fullAnswer !== 'string' || fullAnswer.length > 5000))) return ack({ ok: false, error: 'Đáp án chướng ngại vật không hợp lệ.' });
      if (keyword !== undefined) room.obstacleCourse.keyword = keyword;
      if (keywordQuestion !== undefined) room.obstacleCourse.keywordQuestion = keywordQuestion;
      if (fullAnswer !== undefined) room.obstacleCourse.fullAnswer = fullAnswer;
    }
    const obstacleCourse = {
      ...room.obstacleCourse,
      media: room.obstacleCourse.media ? { name: room.obstacleCourse.media.name, type: room.obstacleCourse.media.type, size: room.obstacleCourse.media.size } : null
    };
    if (room.roundMode === 'obstacle') emitProjectorObstacleAnswers(room);
    ack({ ok: true, obstacleCourse });
  });
  socket.on('host:database:speed-question:update', ({ slot, prompt, answer } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isDatabaseHost(room)) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
    if (!Number.isInteger(slot) || slot < 0 || slot >= room.speedQuestions.length || (prompt === undefined && answer === undefined) || (prompt !== undefined && (typeof prompt !== 'string' || prompt.length > 5000)) || (answer !== undefined && (typeof answer !== 'string' || answer.length > 5000))) return ack({ ok: false, error: 'Câu hỏi hoặc đáp án Tăng tốc không hợp lệ.' });
    if (prompt !== undefined) room.speedQuestions[slot].prompt = prompt;
    if (answer !== undefined) room.speedQuestions[slot].answer = answer;
    emitHostSpeedQuestions(room);
    if (room.roundMode === 'speed' && room.activeSpeedQuestionSlot === slot) emitActiveRoundMedia(room);
    ack({ ok: true });
  });
  socket.on('host:database:speed-media:set', ({ slot, name, type, data } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isDatabaseHost(room)) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
    if (!Number.isInteger(slot) || slot < 0 || slot >= room.speedQuestions.length) return ack({ ok: false, error: 'Ô Tăng tốc không hợp lệ.' });
    if (!Buffer.isBuffer(data) || data.length === 0 || data.length > 10 * 1024 * 1024) return ack({ ok: false, error: 'File media phải có dung lượng tối đa 10 MB.' });
    if (typeof type !== 'string' || !/^(image|video)\/[a-z0-9.+-]+$/i.test(type)) return ack({ ok: false, error: 'Chỉ hỗ trợ file ảnh hoặc video.' });
    if (typeof name !== 'string' || !name.trim() || name.length > 255) return ack({ ok: false, error: 'Tên file media không hợp lệ.' });
    const safeName = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 255);
    room.speedQuestions[slot].media = { name: safeName, type, size: data.length, data };
    emitHostSpeedQuestions(room);
    if (room.roundMode === 'speed' && room.activeSpeedQuestionSlot === slot) emitActiveRoundMedia(room);
    ack({ ok: true, media: { name: safeName, type, size: data.length } });
  });
  socket.on('host:database:speed-media:get', ({ slot } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isDatabaseHost(room)) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
    if (!Number.isInteger(slot) || slot < 0 || slot >= room.speedQuestions.length) return ack({ ok: false, error: 'Ô Tăng tốc không hợp lệ.' });
    const media = room.speedQuestions[slot].media;
    if (!media) return ack({ ok: false, error: 'Ô này chưa có media.' });
    ack({ ok: true, media: { name: media.name, type: media.type, size: media.size, data: media.data } });
  });
  socket.on('host:database:speed-media:delete', ({ slot } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isDatabaseHost(room)) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
    if (!Number.isInteger(slot) || slot < 0 || slot >= room.speedQuestions.length) return ack({ ok: false, error: 'Ô Tăng tốc không hợp lệ.' });
    room.speedQuestions[slot].media = null;
    emitHostSpeedQuestions(room);
    if (room.roundMode === 'speed' && room.activeSpeedQuestionSlot === slot) emitActiveRoundMedia(room);
    ack({ ok: true });
  });
  socket.on('host:database:clear', (_payload, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isDatabaseHost(room)) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
    const deleted = room.questions.length;
    room.questions = [];
    emitHostDatabaseQuestions(room);
    ack({ ok: true, questions: room.questions, deleted });
  });
  socket.on('host:database:import', ({ questions } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isDatabaseHost(room)) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
    if (!Array.isArray(questions) || !questions.length || questions.length > 2000) return ack({ ok: false, error: 'File phải có từ 1 đến 2000 câu hỏi.' });
    const imported = questions.map(question => normalizeQuestion(question)).filter(Boolean);
    if (imported.length !== questions.length) return ack({ ok: false, error: 'Dữ liệu nhập có câu hỏi không hợp lệ.' });
    room.questions.push(...imported);
    emitHostDatabaseQuestions(room);
    ack({ ok: true, questions: room.questions, imported: imported.length });
  });
  socket.on('host:database:import-document', ({ questions, openingSheetIncluded = false, speedQuestions, obstacleCourse, finishSheetIncluded = false, finishRounds } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isDatabaseHost(room)) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
    if (!Array.isArray(questions) || questions.length > 2000 || typeof openingSheetIncluded !== 'boolean' || typeof finishSheetIncluded !== 'boolean' || (speedQuestions !== null && (!Array.isArray(speedQuestions) || speedQuestions.length !== 4)) || (obstacleCourse !== null && obstacleCourse !== undefined && (!obstacleCourse || !Array.isArray(obstacleCourse.rows) || obstacleCourse.rows.length !== 4)) || (finishSheetIncluded && (!Array.isArray(finishRounds) || finishRounds.length !== 4 || finishRounds.some(round => !Array.isArray(round) || round.length !== 7))) || (finishRounds !== null && finishRounds !== undefined && (!Array.isArray(finishRounds) || finishRounds.length !== 4 || finishRounds.some(round => !Array.isArray(round) || round.length !== 7)))) return ack({ ok: false, error: 'Dữ liệu workbook không hợp lệ.' });
    const imported = questions.map(question => normalizeQuestion(question)).filter(Boolean);
    if (imported.length !== questions.length) return ack({ ok: false, error: 'Dữ liệu câu hỏi Khởi Động không hợp lệ.' });
    const normalizedSpeedQuestions = speedQuestions?.map(question => {
      if (!question || typeof question.prompt !== 'string' || question.prompt.length > 5000 || typeof question.answer !== 'string' || question.answer.length > 5000) return null;
      return { prompt: question.prompt, answer: question.answer };
    });
    const normalizedObstacleCourse = obstacleCourse ? {
      rows: obstacleCourse.rows.map(row => {
        if (!row || typeof row.answer !== 'string' || row.answer.length > 64 || typeof row.question !== 'string' || row.question.length > 5000) return null;
        const answerCells = Array.isArray(row.answerCells) && row.answerCells.length === 15 && row.answerCells.every(cell => typeof cell === 'string') ? row.answerCells : obstacleAnswerCells(row.answer);
        return { answer: answerCells.join(''), answerCells, question: row.question };
      }),
      keyword: obstacleCourse.keyword,
      keywordQuestion: obstacleCourse.keywordQuestion,
      fullAnswer: obstacleCourse.fullAnswer
    } : null;
    const normalizedFinishRounds = finishRounds?.map(round => round.map(item => {
      if (!item || typeof item.question !== 'string' || item.question.length > 5000 || typeof item.answer !== 'string' || item.answer.length > 5000) return null;
      return { question: item.question, answer: item.answer };
    }));
    if (normalizedSpeedQuestions?.some(question => !question) || normalizedObstacleCourse?.rows.some(row => !row) ||
      normalizedFinishRounds?.some(round => round.some(item => !item)) ||
      (normalizedObstacleCourse && [normalizedObstacleCourse.keyword, normalizedObstacleCourse.keywordQuestion, normalizedObstacleCourse.fullAnswer].some(value => typeof value !== 'string' || value.length > 5000)) ||
      (!imported.length && !normalizedSpeedQuestions?.some(question => question.prompt || question.answer) && !normalizedObstacleCourse?.rows.some(row => row.answer || row.question) && ![normalizedObstacleCourse?.keyword, normalizedObstacleCourse?.keywordQuestion, normalizedObstacleCourse?.fullAnswer].some(Boolean) && !normalizedFinishRounds?.some(round => round.some(item => item.question || item.answer)))) return ack({ ok: false, error: 'Dữ liệu câu hỏi trong workbook không hợp lệ hoặc workbook không có nội dung.' });
    if (openingSheetIncluded) room.questions = imported;
    else room.questions.push(...imported);
    normalizedSpeedQuestions?.forEach((question, index) => {
      room.speedQuestions[index].prompt = question.prompt;
      room.speedQuestions[index].answer = question.answer;
    });
    if (normalizedSpeedQuestions) emitHostSpeedQuestions(room);
    if (normalizedObstacleCourse) room.obstacleCourse = { ...normalizedObstacleCourse, media: room.obstacleCourse.media || null };
    if (normalizedObstacleCourse && room.roundMode === 'obstacle') { emitActiveRoundMedia(room); emitProjectorObstacleAnswers(room); }
    if (finishSheetIncluded) room.finishRounds = normalizedFinishRounds;
    emitHostDatabaseQuestions(room);
    ack({
      ok: true,
      questions: room.questions,
      imported: imported.length,
      speedQuestions: room.speedQuestions.map(slot => ({ prompt: slot.prompt, answer: slot.answer, media: slot.media ? { name: slot.media.name, type: slot.media.type, size: slot.media.size } : null })),
      obstacleCourse: normalizedObstacleCourse ? room.obstacleCourse : null,
      finishRounds: finishSheetIncluded ? room.finishRounds : null
    });
  });
  socket.on('host:database:add', ({ question } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isDatabaseHost(room)) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
    const normalized = normalizeQuestion(question);
    if (!normalized) return ack({ ok: false, error: 'Nội dung câu hỏi không hợp lệ.' });
    room.questions.push(normalized);
    emitHostDatabaseQuestions(room);
    ack({ ok: true, questions: room.questions });
  });
  socket.on('host:database:update', ({ id, question } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isDatabaseHost(room)) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
    const index = room.questions.findIndex(item => item.id === id);
    if (index < 0) return ack({ ok: false, error: 'Không tìm thấy câu hỏi.' });
    const normalized = normalizeQuestion(question, id);
    if (!normalized) return ack({ ok: false, error: 'Dữ liệu câu hỏi không hợp lệ.' });
    room.questions[index] = normalized;
    emitHostDatabaseQuestions(room);
    ack({ ok: true, questions: room.questions });
  });
  socket.on('host:database:updateGroup', ({ questions } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isDatabaseHost(room)) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
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
    emitHostDatabaseQuestions(room);
    ack({ ok: true, questions: room.questions });
  });
  socket.on('host:database:delete', ({ id } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!isDatabaseHost(room)) return ack({ ok: false, error: 'Không có quyền truy cập Database.' });
    const originalLength = room.questions.length;
    room.questions = room.questions.filter(item => item.id !== id);
    if (room.questions.length === originalLength) return ack({ ok: false, error: 'Không tìm thấy câu hỏi.' });
    emitHostDatabaseQuestions(room);
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
    const p = room.players.get(playerId); if (p) { const s = io.sockets.sockets.get(playerId); if (s) { s.emit('player:kicked'); s.leave(room.code); s.data.roomCode = null; s.data.role = null; } room.players.delete(playerId); room.answers = room.answers.filter(a => a.playerId !== playerId); if (room.spotlightPlayerId === playerId) room.spotlightPlayerId = null; }
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
