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
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function createRoom(hostId, hostName) {
  let code;
  do {
    code = generateRoomCode();
  } while (rooms[code]);

  rooms[code] = {
    code,
    hostId,
    hostName,
    // States: waiting | first_buzz | opponent_chance | opponent_buzz | open_buzz | open_buzz_active
    state: 'waiting',
    teams: {
      A: Array(6).fill(null),
      B: Array(6).fill(null),
    },
    currentBuzzer: null,
    allowedTeam: null,
    intervalTimer: null,
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
  };
}

function clearTimer(room) {
  if (room.intervalTimer) {
    clearInterval(room.intervalTimer);
    room.intervalTimer = null;
  }
}

function startCountdown(room, duration, onEnd) {
  clearTimer(room);
  let remaining = duration;
  io.to(room.code).emit('timer_update', { remaining, total: duration });

  room.intervalTimer = setInterval(() => {
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
  io.to(room.code).emit('game_state', getRoomState(room));
  io.to(room.code).emit('timer_update', { remaining: 0, total: 0 });
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('create_room', ({ name }) => {
    if (!name || !name.trim()) {
      socket.emit('error_msg', { message: 'Name is required.' });
      return;
    }
    const room = createRoom(socket.id, name.trim());
    socket.join(room.code);
    socket.roomCode = room.code;
    socket.isHost = true;
    socket.playerName = name.trim();
    socket.emit('room_created', { code: room.code });
    socket.emit('game_state', getRoomState(room));
  });

  socket.on('join_room', ({ name, code }) => {
    if (!name || !name.trim()) {
      socket.emit('error_msg', { message: 'Name is required.' });
      return;
    }
    const upperCode = (code || '').trim().toUpperCase();
    const room = rooms[upperCode];
    if (!room) {
      socket.emit('error_msg', { message: 'Room not found. Check the code and try again.' });
      return;
    }
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

    // Remove player from any current slot
    for (const t of ['A', 'B']) {
      for (let i = 0; i < 6; i++) {
        if (room.teams[t][i] && room.teams[t][i].playerId === socket.id) {
          room.teams[t][i] = null;
        }
      }
    }

    // Check if slot is taken by someone else
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

    for (const t of ['A', 'B']) {
      for (let i = 0; i < 6; i++) {
        if (room.teams[t][i] && room.teams[t][i].playerId === socket.id) {
          room.teams[t][i] = null;
        }
      }
    }
    socket.team = null;
    socket.slot = null;

    io.to(room.code).emit('game_state', getRoomState(room));
  });

  socket.on('buzz', () => {
    const room = rooms[socket.roomCode];
    if (!room || socket.isHost) return;

    if (!socket.team) {
      socket.emit('error_msg', { message: 'Please select a team slot first.' });
      return;
    }

    // Only valid states for buzzing
    if (!['waiting', 'opponent_chance', 'open_buzz'].includes(room.state)) return;

    // Team restriction check
    if (room.allowedTeam && room.allowedTeam !== socket.team) return;

    const prevState = room.state;
    room.currentBuzzer = {
      playerId: socket.id,
      playerName: socket.playerName,
      team: socket.team,
    };

    if (prevState === 'waiting') {
      room.state = 'first_buzz';
    } else if (prevState === 'opponent_chance') {
      room.state = 'opponent_buzz';
    } else if (prevState === 'open_buzz') {
      room.state = 'open_buzz_active';
    }

    io.to(room.code).emit('game_state', getRoomState(room));

    // 5-second answer timer
    startCountdown(room, 5, () => {
      // Timer expired without host decision
      if (room.state === 'open_buzz_active') {
        resetRoom(room);
      }
      // For first_buzz and opponent_buzz, host should handle — just stop the timer
    });
  });

  socket.on('correct_answer', () => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;
    resetRoom(room);
  });

  socket.on('wrong_answer', () => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;

    clearTimer(room);
    const prevState = room.state;

    if (prevState === 'first_buzz') {
      const oppositeTeam = room.currentBuzzer.team === 'A' ? 'B' : 'A';
      room.state = 'opponent_chance';
      room.allowedTeam = oppositeTeam;
      room.currentBuzzer = null;
      io.to(room.code).emit('game_state', getRoomState(room));

      startCountdown(room, 10, () => {
        // Nobody from opponent team buzzed — open buzz
        room.state = 'open_buzz';
        room.allowedTeam = null;
        io.to(room.code).emit('game_state', getRoomState(room));
        io.to(room.code).emit('timer_update', { remaining: 0, total: 0 });
      });
    } else if (prevState === 'opponent_buzz') {
      room.state = 'open_buzz';
      room.allowedTeam = null;
      room.currentBuzzer = null;
      io.to(room.code).emit('game_state', getRoomState(room));
      io.to(room.code).emit('timer_update', { remaining: 0, total: 0 });
    } else if (prevState === 'open_buzz_active') {
      resetRoom(room);
    }
  });

  socket.on('reset_buzzers', () => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;
    resetRoom(room);
  });

  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    const room = rooms[socket.roomCode];
    if (!room) return;

    if (socket.isHost) {
      clearTimer(room);
      io.to(room.code).emit('host_disconnected');
      delete rooms[socket.roomCode];
    } else {
      for (const t of ['A', 'B']) {
        for (let i = 0; i < 6; i++) {
          if (room.teams[t][i] && room.teams[t][i].playerId === socket.id) {
            room.teams[t][i] = null;
          }
        }
      }
      io.to(room.code).emit('game_state', getRoomState(room));
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Buzzer app running at http://localhost:${PORT}`);
});
