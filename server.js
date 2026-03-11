const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createRoom(hostId, hostName) {
  let code;
  do { code = generateRoomCode(); } while (rooms[code]);

  rooms[code] = {
    code, hostId, hostName,
    // States: waiting | first_buzz | opponent_chance | opponent_buzz | open_buzz | open_buzz_active | correct_reveal
    state: 'waiting',
    teams: { A: Array(6).fill(null), B: Array(6).fill(null) },
    currentBuzzer: null,
    allowedTeam: null,
    wrongPlayers: [],    // [{ playerId, playerName, team }] — persists until round reset
    correctPlayer: null, // { playerId, playerName, team }
    settings: {
      answerTime: 5,       // seconds for the answer timer
      opponentTime: 10,    // seconds for opponent-chance timer
      lockWrongPlayers: true,
    },
    _timer: null,
    _revealTimer: null,
  };
  return rooms[code];
}

function getRoomState(room) {
  return {
    code: room.code,
    state: room.state,
    teams: room.teams,
    currentBuzzer: room.currentBuzzer,
    allowedTeam: room.allowedTeam,
    wrongPlayers: room.wrongPlayers,
    correctPlayer: room.correctPlayer,
    settings: room.settings,
  };
}

function clearTimer(room) {
  if (room._timer)       { clearInterval(room._timer);  room._timer = null; }
  if (room._revealTimer) { clearTimeout(room._revealTimer); room._revealTimer = null; }
}

function startCountdown(room, duration, onEnd) {
  clearTimer(room);
  let remaining = duration;
  io.to(room.code).emit('timer_update', { remaining, total: duration });

  room._timer = setInterval(() => {
    remaining--;
    io.to(room.code).emit('timer_update', { remaining, total: duration });
    if (remaining <= 0) {
      clearTimer(room);
      onEnd();
    }
  }, 1000);
}

function resetRoom(room) {
  clearTimer(room);
  room.state = 'waiting';
  room.currentBuzzer = null;
  room.allowedTeam = null;
  room.wrongPlayers = [];
  room.correctPlayer = null;
  io.to(room.code).emit('game_state', getRoomState(room));
  io.to(room.code).emit('timer_update', { remaining: 0, total: 0 });
}

function markWrong(room) {
  if (!room.currentBuzzer) return;
  const already = room.wrongPlayers.some(p => p.playerId === room.currentBuzzer.playerId);
  if (!already) room.wrongPlayers.push({ ...room.currentBuzzer });
}

// Returns how many players can still buzz (eligible = not in wrongPlayers when lockWrongPlayers is on)
function eligibleCount(room) {
  const allIds = [];
  for (const t of ['A', 'B'])
    for (const slot of room.teams[t])
      if (slot) allIds.push(slot.playerId);

  if (!room.settings.lockWrongPlayers) return allIds.length;
  return allIds.filter(id => !room.wrongPlayers.some(p => p.playerId === id)).length;
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('create_room', ({ name }) => {
    if (!name?.trim()) { socket.emit('error_msg', { message: 'Name is required.' }); return; }
    const room = createRoom(socket.id, name.trim());
    socket.join(room.code);
    socket.roomCode = room.code;
    socket.isHost = true;
    socket.playerName = name.trim();
    socket.emit('room_created', { code: room.code });
    socket.emit('game_state', getRoomState(room));
  });

  socket.on('join_room', ({ name, code }) => {
    if (!name?.trim()) { socket.emit('error_msg', { message: 'Name is required.' }); return; }
    const upperCode = (code || '').trim().toUpperCase();
    const room = rooms[upperCode];
    if (!room) { socket.emit('error_msg', { message: 'Room not found. Check the code and try again.' }); return; }
    socket.join(upperCode);
    socket.roomCode = upperCode;
    socket.isHost = false;
    socket.playerName = name.trim();
    socket.team = null;
    socket.slot = null;
    socket.emit('room_joined', { code: upperCode });
    socket.emit('game_state', getRoomState(room));
  });

  socket.on('select_slot', ({ team, slot }) => {
    const room = rooms[socket.roomCode];
    if (!room || socket.isHost) return;

    for (const t of ['A', 'B'])
      for (let i = 0; i < 6; i++)
        if (room.teams[t][i]?.playerId === socket.id) room.teams[t][i] = null;

    if (room.teams[team][slot] && room.teams[team][slot].playerId !== socket.id) {
      socket.emit('error_msg', { message: 'That slot is already taken.' });
      socket.emit('game_state', getRoomState(room));
      return;
    }

    room.teams[team][slot] = { playerId: socket.id, playerName: socket.playerName };
    socket.team = team;
    socket.slot = slot;
    io.to(room.code).emit('game_state', getRoomState(room));
  });

  socket.on('leave_slot', () => {
    const room = rooms[socket.roomCode];
    if (!room || socket.isHost) return;
    for (const t of ['A', 'B'])
      for (let i = 0; i < 6; i++)
        if (room.teams[t][i]?.playerId === socket.id) room.teams[t][i] = null;
    socket.team = null;
    socket.slot = null;
    io.to(room.code).emit('game_state', getRoomState(room));
  });

  socket.on('buzz', () => {
    const room = rooms[socket.roomCode];
    if (!room || socket.isHost) return;
    if (!socket.team) { socket.emit('error_msg', { message: 'Please select a team slot first.' }); return; }
    if (!['waiting', 'opponent_chance', 'open_buzz'].includes(room.state)) return;
    if (room.allowedTeam && room.allowedTeam !== socket.team) return;

    // Lock check
    if (room.settings.lockWrongPlayers && room.wrongPlayers.some(p => p.playerId === socket.id)) return;

    const prevState = room.state;
    room.currentBuzzer = { playerId: socket.id, playerName: socket.playerName, team: socket.team };

    if      (prevState === 'waiting')          room.state = 'first_buzz';
    else if (prevState === 'opponent_chance')  room.state = 'opponent_buzz';
    else if (prevState === 'open_buzz')        room.state = 'open_buzz_active';

    io.to(room.code).emit('game_state', getRoomState(room));

    // Answer timer
    startCountdown(room, room.settings.answerTime, () => {
      // Timer ran out during open_buzz_active — auto wrong
      if (room.state === 'open_buzz_active') {
        markWrong(room);
        room.currentBuzzer = null;
        if (eligibleCount(room) > 0) {
          room.state = 'open_buzz';
          io.to(room.code).emit('game_state', getRoomState(room));
          io.to(room.code).emit('timer_update', { remaining: 0, total: 0 });
        } else {
          resetRoom(room);
        }
      }
    });
  });

  socket.on('correct_answer', () => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;

    clearTimer(room);
    if (room.currentBuzzer) room.correctPlayer = { ...room.currentBuzzer };
    room.state = 'correct_reveal';
    room.currentBuzzer = null;
    io.to(room.code).emit('game_state', getRoomState(room));
    io.to(room.code).emit('timer_update', { remaining: 0, total: 0 });

    // Show correct reveal for 2 seconds then auto-reset
    room._revealTimer = setTimeout(() => {
      room._revealTimer = null;
      resetRoom(room);
    }, 2000);
  });

  socket.on('wrong_answer', () => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;

    clearTimer(room);
    const prevState = room.state;

    if (prevState === 'first_buzz') {
      markWrong(room);
      const oppTeam = room.currentBuzzer?.team === 'A' ? 'B' : 'A';
      room.state = 'opponent_chance';
      room.allowedTeam = oppTeam;
      room.currentBuzzer = null;
      io.to(room.code).emit('game_state', getRoomState(room));

      startCountdown(room, room.settings.opponentTime, () => {
        room.state = 'open_buzz';
        room.allowedTeam = null;
        io.to(room.code).emit('game_state', getRoomState(room));
        io.to(room.code).emit('timer_update', { remaining: 0, total: 0 });
      });

    } else if (prevState === 'opponent_buzz') {
      markWrong(room);
      room.state = 'open_buzz';
      room.allowedTeam = null;
      room.currentBuzzer = null;
      io.to(room.code).emit('game_state', getRoomState(room));
      io.to(room.code).emit('timer_update', { remaining: 0, total: 0 });

    } else if (prevState === 'open_buzz_active') {
      // Mark wrong and KEEP open buzz — never auto-reset here
      markWrong(room);
      room.currentBuzzer = null;

      if (room.settings.lockWrongPlayers && eligibleCount(room) === 0) {
        // Everyone has been locked out — end the round
        resetRoom(room);
      } else {
        room.state = 'open_buzz';
        io.to(room.code).emit('game_state', getRoomState(room));
        io.to(room.code).emit('timer_update', { remaining: 0, total: 0 });
      }
    }
  });

  socket.on('reset_buzzers', () => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;
    resetRoom(room);
  });

  socket.on('update_settings', (newSettings) => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;

    const { answerTime, opponentTime, lockWrongPlayers } = newSettings;
    if (typeof answerTime === 'number' && answerTime >= 3 && answerTime <= 60)
      room.settings.answerTime = answerTime;
    if (typeof opponentTime === 'number' && opponentTime >= 5 && opponentTime <= 120)
      room.settings.opponentTime = opponentTime;
    if (typeof lockWrongPlayers === 'boolean')
      room.settings.lockWrongPlayers = lockWrongPlayers;

    // Broadcast updated settings to all clients in the room
    io.to(room.code).emit('settings_updated', room.settings);
    socket.emit('error_msg', { message: `Settings saved!` }); // toast feedback
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;

    if (socket.isHost) {
      clearTimer(room);
      io.to(room.code).emit('host_disconnected');
      delete rooms[socket.roomCode];
    } else {
      for (const t of ['A', 'B'])
        for (let i = 0; i < 6; i++)
          if (room.teams[t][i]?.playerId === socket.id) room.teams[t][i] = null;

      room.wrongPlayers = room.wrongPlayers.filter(p => p.playerId !== socket.id);
      io.to(room.code).emit('game_state', getRoomState(room));
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Buzzer app running at http://localhost:${PORT}`));
