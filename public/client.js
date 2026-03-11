const socket = io();

// ===== State =====
let myName = '';
let myRoomCode = '';
let isHost = false;
let myTeam = null;
let mySlot = null;
let gameState = null;
let timerState = { remaining: 0, total: 0 };
const TIMER_CIRCUMFERENCE = 2 * Math.PI * 54; // 339.29

// ===== DOM Refs =====
const screens = {
  entry: document.getElementById('screen-entry'),
  host: document.getElementById('screen-host'),
  participant: document.getElementById('screen-participant'),
};

const $ = id => document.getElementById(id);

// Entry
const entryName = $('entry-name');
const entryCode = $('entry-code');
const entryError = $('entry-error');
const btnCreate = $('btn-create');
const btnJoin = $('btn-join');

// Host
const hostRoomCode = $('host-room-code');
const hostNameDisplay = $('host-name-display');
const hostStatusBanner = $('host-status-banner');
const hostBuzzerInfo = $('host-buzzer-info');
const hostBuzzerName = $('host-buzzer-name');
const hostBuzzerTeam = $('host-buzzer-team');
const hostTimer = $('host-timer');
const hostTimerNumber = $('host-timer-number');
const hostTimerFill = $('timer-ring-fill');
const hostTeamA = $('host-team-a');
const hostTeamB = $('host-team-b');
const btnReset = $('btn-reset');
const btnCorrect = $('btn-correct');
const btnWrong = $('btn-wrong');

// Participant - team select
const partRoomCode = $('part-room-code');
const partNameDisplay = $('part-name-display');
const partTeamA = $('part-team-a');
const partTeamB = $('part-team-b');

// Participant - buzzer
const viewTeamSelect = $('view-team-select');
const viewBuzzer = $('view-buzzer');
const buzzRoomCode = $('buzz-room-code');
const buzzPlayerInfo = $('buzz-player-info');
const partStatusBanner = $('part-status-banner');
const partBuzzerInfo = $('part-buzzer-info');
const partBuzzerName = $('part-buzzer-name');
const partBuzzerTeam = $('part-buzzer-team');
const partTimer = $('part-timer');
const partTimerNumber = $('part-timer-number');
const partTimerFill = $('part-timer-ring-fill');
const buzzerBtn = $('buzzer-btn');
const btnChangeSlot = $('btn-change-slot');
const miniTeamA = $('mini-team-a');
const miniTeamB = $('mini-team-b');

// Toast
const toast = $('toast');
let toastTimeout;

// ===== Helpers =====
function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
}

function showToast(msg, duration = 3000) {
  clearTimeout(toastTimeout);
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toastTimeout = setTimeout(() => toast.classList.add('hidden'), duration);
}

function showEntryError(msg) {
  entryError.textContent = msg;
  entryError.classList.remove('hidden');
}

function clearEntryError() {
  entryError.classList.add('hidden');
}

function teamLabel(team) {
  return `Team ${team}`;
}

function setTimerRing(fillEl, remaining, total) {
  if (!total || remaining <= 0) {
    fillEl.style.strokeDashoffset = TIMER_CIRCUMFERENCE;
    return;
  }
  const fraction = remaining / total;
  fillEl.style.strokeDashoffset = TIMER_CIRCUMFERENCE * (1 - fraction);
}

// ===== Render Timer =====
function renderTimer(remaining, total, numberEl, fillEl, containerEl) {
  if (!total || remaining <= 0) {
    containerEl.classList.add('hidden');
    return;
  }
  containerEl.classList.remove('hidden');
  numberEl.textContent = remaining;
  setTimerRing(fillEl, remaining, total);

  // Color based on urgency
  if (total === 10) {
    fillEl.style.stroke = '#3b82f6'; // blue for 10s opponent chance
  } else {
    fillEl.style.stroke = remaining <= 2 ? '#ef4444' : '#f59e0b';
  }
}

// ===== Render Slots =====
function renderHostSlots(teamKey, container) {
  if (!gameState) return;
  const slots = gameState.teams[teamKey];
  container.innerHTML = '';

  const buzzerPlayerId = gameState.currentBuzzer ? gameState.currentBuzzer.playerId : null;

  slots.forEach((slot, i) => {
    const div = document.createElement('div');
    div.className = 'slot' + (slot ? ` occupied team-${teamKey.toLowerCase()}` : '');

    if (slot && slot.playerId === buzzerPlayerId) {
      div.classList.add('buzzed');
    }

    const numSpan = document.createElement('span');
    numSpan.className = 'slot-number';
    numSpan.textContent = i + 1;
    div.appendChild(numSpan);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = slot ? slot.playerName : '—';
    div.appendChild(nameSpan);

    container.appendChild(div);
  });
}

function renderParticipantSlots(teamKey, container, isSelectView) {
  if (!gameState) return;
  const slots = gameState.teams[teamKey];
  container.innerHTML = '';

  const buzzerPlayerId = gameState.currentBuzzer ? gameState.currentBuzzer.playerId : null;

  slots.forEach((slot, i) => {
    const div = document.createElement('div');
    const isMine = slot && slot.playerId === socket.id;
    const isTaken = slot && !isMine;
    const isBuzzed = slot && slot.playerId === buzzerPlayerId;

    div.className = 'slot';
    if (slot) div.classList.add('occupied', `team-${teamKey.toLowerCase()}`);
    if (isMine) div.classList.add('mine');
    if (isBuzzed) div.classList.add('buzzed');

    if (isSelectView) {
      div.classList.add('selectable');
      if (isTaken) div.classList.add('taken');

      if (!isTaken) {
        div.addEventListener('click', () => {
          socket.emit('select_slot', { team: teamKey, slot: i });
        });
      }
    }

    const numSpan = document.createElement('span');
    numSpan.className = 'slot-number';
    numSpan.textContent = i + 1;
    div.appendChild(numSpan);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = slot ? (isMine ? `${slot.playerName} (You)` : slot.playerName) : (isSelectView ? 'Open' : '—');
    div.appendChild(nameSpan);

    container.appendChild(div);
  });
}

function renderMiniSlots(teamKey, container) {
  if (!gameState) return;
  const slots = gameState.teams[teamKey];
  container.innerHTML = '';

  const buzzerPlayerId = gameState.currentBuzzer ? gameState.currentBuzzer.playerId : null;

  slots.forEach((slot, i) => {
    const div = document.createElement('div');
    const isMine = slot && slot.playerId === socket.id;
    const isBuzzed = slot && slot.playerId === buzzerPlayerId;

    div.className = 'mini-slot';
    if (slot) div.classList.add('occupied', `team-${teamKey.toLowerCase()}`);
    if (isMine) div.classList.add('mine');
    if (isBuzzed) div.classList.add('buzzed');

    const numSpan = document.createElement('span');
    numSpan.className = 'slot-number';
    numSpan.textContent = i + 1;
    div.appendChild(numSpan);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = slot ? (isMine ? `${slot.playerName} ✓` : slot.playerName) : '—';
    div.appendChild(nameSpan);

    container.appendChild(div);
  });
}

// ===== Status text =====
const STATUS_MESSAGES = {
  waiting: 'Waiting for Buzz...',
  first_buzz: 'Answering...',
  opponent_chance: 'Opponent Team\'s Chance!',
  opponent_buzz: 'Opponent Answering...',
  open_buzz: 'Open Buzz — Anyone!',
  open_buzz_active: 'Answering...',
};

function getParticipantStatusMsg(state, allowedTeam) {
  if (state === 'opponent_chance') {
    if (myTeam && allowedTeam === myTeam) return `Your Team\'s Chance! Buzz Now!`;
    if (myTeam && allowedTeam !== myTeam) return `Team ${allowedTeam}\'s Chance...`;
    return STATUS_MESSAGES[state];
  }
  return STATUS_MESSAGES[state] || 'Waiting...';
}

// ===== Render Host =====
function renderHost() {
  if (!gameState) return;

  renderHostSlots('A', hostTeamA);
  renderHostSlots('B', hostTeamB);

  const state = gameState.state;
  hostStatusBanner.textContent = STATUS_MESSAGES[state] || state;
  hostStatusBanner.className = `status-banner ${state}`;

  if (gameState.currentBuzzer) {
    hostBuzzerInfo.classList.remove('hidden');
    hostBuzzerName.textContent = gameState.currentBuzzer.playerName;
    hostBuzzerTeam.textContent = teamLabel(gameState.currentBuzzer.team);
    hostBuzzerTeam.style.color = gameState.currentBuzzer.team === 'A' ? 'var(--team-a)' : 'var(--team-b)';
  } else {
    hostBuzzerInfo.classList.add('hidden');
  }

  const hasActiveBuzzer = ['first_buzz', 'opponent_buzz', 'open_buzz_active'].includes(state);
  btnCorrect.disabled = !hasActiveBuzzer;
  btnWrong.disabled = !hasActiveBuzzer && state !== 'opponent_chance';

  renderTimer(timerState.remaining, timerState.total, hostTimerNumber, hostTimerFill, hostTimer);
}

// ===== Render Participant =====
function renderParticipant() {
  if (!gameState) return;

  const state = gameState.state;
  const hasSlot = myTeam !== null;

  // Determine which view to show
  if (hasSlot) {
    viewTeamSelect.classList.add('hidden');
    viewBuzzer.classList.remove('hidden');
  } else {
    viewTeamSelect.classList.remove('hidden');
    viewBuzzer.classList.add('hidden');
  }

  // Team select view
  renderParticipantSlots('A', partTeamA, true);
  renderParticipantSlots('B', partTeamB, true);

  // Buzzer view
  if (hasSlot) {
    buzzPlayerInfo.textContent = `${myName} • Team ${myTeam} • Slot ${mySlot + 1}`;

    // Buzzer button state
    const isBuzzed = gameState.currentBuzzer !== null;
    const myTurn = !isBuzzed && ['waiting', 'open_buzz'].includes(state);
    const opponentTurn = state === 'opponent_chance' && gameState.allowedTeam === myTeam;
    const canBuzz = myTurn || opponentTurn;
    const iBuzzed = isBuzzed && gameState.currentBuzzer.playerId === socket.id;

    buzzerBtn.disabled = !canBuzz && !iBuzzed;
    buzzerBtn.classList.toggle('locked', !canBuzz && !iBuzzed);
    buzzerBtn.classList.toggle('buzzed-me', iBuzzed);

    // Status banner
    partStatusBanner.textContent = getParticipantStatusMsg(state, gameState.allowedTeam);
    partStatusBanner.className = `status-banner ${state}`;

    // If locked for my team during opponent_chance, show locked
    if (state === 'opponent_chance' && gameState.allowedTeam !== myTeam) {
      partStatusBanner.className = 'status-banner locked';
      partStatusBanner.textContent = `Team ${gameState.allowedTeam}'s Chance...`;
    }

    // Buzzer info
    if (gameState.currentBuzzer) {
      partBuzzerInfo.classList.remove('hidden');
      partBuzzerName.textContent = gameState.currentBuzzer.playerName;
      partBuzzerTeam.textContent = teamLabel(gameState.currentBuzzer.team);
      partBuzzerTeam.style.color = gameState.currentBuzzer.team === 'A' ? 'var(--team-a)' : 'var(--team-b)';
    } else {
      partBuzzerInfo.classList.add('hidden');
    }

    renderTimer(timerState.remaining, timerState.total, partTimerNumber, partTimerFill, partTimer);
    renderMiniSlots('A', miniTeamA);
    renderMiniSlots('B', miniTeamB);
  }
}

// ===== Full Render =====
function render() {
  if (isHost) {
    renderHost();
  } else {
    renderParticipant();
  }
}

// ===== Find my slot from gameState =====
function syncMySlot() {
  for (const team of ['A', 'B']) {
    const slots = gameState.teams[team];
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] && slots[i].playerId === socket.id) {
        myTeam = team;
        mySlot = i;
        return;
      }
    }
  }
  myTeam = null;
  mySlot = null;
}

// ===== Socket Events =====
socket.on('room_created', ({ code }) => {
  myRoomCode = code;
  hostRoomCode.textContent = code;
  hostNameDisplay.textContent = myName;
  showScreen('host');
});

socket.on('room_joined', ({ code }) => {
  myRoomCode = code;
  partRoomCode.textContent = code;
  partNameDisplay.textContent = myName;
  buzzRoomCode.textContent = code;
  showScreen('participant');
});

socket.on('game_state', (state) => {
  gameState = state;
  if (!isHost) syncMySlot();
  render();
});

socket.on('timer_update', ({ remaining, total }) => {
  timerState = { remaining, total };
  render();
});

socket.on('error_msg', ({ message }) => {
  if (screens.entry.classList.contains('active')) {
    showEntryError(message);
  } else {
    showToast(message);
  }
});

socket.on('host_disconnected', () => {
  showToast('Host disconnected. Returning to menu.', 4000);
  setTimeout(() => {
    myName = '';
    myRoomCode = '';
    isHost = false;
    myTeam = null;
    mySlot = null;
    gameState = null;
    timerState = { remaining: 0, total: 0 };
    showScreen('entry');
  }, 2500);
});

// ===== Entry Actions =====
btnCreate.addEventListener('click', () => {
  clearEntryError();
  const name = entryName.value.trim();
  if (!name) {
    showEntryError('Please enter your name.');
    return;
  }
  myName = name;
  isHost = true;
  socket.emit('create_room', { name });
});

btnJoin.addEventListener('click', () => {
  clearEntryError();
  const name = entryName.value.trim();
  const code = entryCode.value.trim().toUpperCase();
  if (!name) {
    showEntryError('Please enter your name.');
    return;
  }
  if (!code) {
    showEntryError('Please enter a room code to join.');
    return;
  }
  myName = name;
  isHost = false;
  socket.emit('join_room', { name, code });
});

// Allow Enter key on entry form
[entryName, entryCode].forEach(input => {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnJoin.click();
  });
});

// ===== Host Controls =====
btnReset.addEventListener('click', () => socket.emit('reset_buzzers'));
btnCorrect.addEventListener('click', () => socket.emit('correct_answer'));
btnWrong.addEventListener('click', () => socket.emit('wrong_answer'));

// ===== Buzzer =====
buzzerBtn.addEventListener('click', () => {
  if (buzzerBtn.disabled) return;
  socket.emit('buzz');
});

// Touch events for mobile responsiveness
buzzerBtn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (!buzzerBtn.disabled) socket.emit('buzz');
}, { passive: false });

// ===== Change Slot =====
btnChangeSlot.addEventListener('click', () => {
  socket.emit('leave_slot');
  myTeam = null;
  mySlot = null;
  render();
});

// Force code input to uppercase
entryCode.addEventListener('input', () => {
  entryCode.value = entryCode.value.toUpperCase();
});
