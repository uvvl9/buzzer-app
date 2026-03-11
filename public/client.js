const socket = io();

// ===== State =====
let myName = '';
let myRoomCode = '';
let isHost = false;
let myTeam = null;
let mySlot = null;
let gameState = null;
let timerState = { remaining: 0, total: 0 };
const TIMER_CIRCUMFERENCE = 2 * Math.PI * 54;

// ===== DOM Refs =====
const screens = {
  entry: document.getElementById('screen-entry'),
  host: document.getElementById('screen-host'),
  participant: document.getElementById('screen-participant'),
};
const $ = id => document.getElementById(id);

// Entry
const entryName        = $('entry-name');
const entryCode        = $('entry-code');
const entryError       = $('entry-error');
const btnCreate        = $('btn-create');
const btnJoin          = $('btn-join');

// Host
const hostRoomCode     = $('host-room-code');
const hostNameDisplay  = $('host-name-display');
const hostStatusBanner = $('host-status-banner');
const hostBuzzerInfo   = $('host-buzzer-info');
const hostBuzzerName   = $('host-buzzer-name');
const hostBuzzerTeam   = $('host-buzzer-team');
const hostTimer        = $('host-timer');
const hostTimerNumber  = $('host-timer-number');
const hostTimerFill    = $('timer-ring-fill');
const hostTeamA        = $('host-team-a');
const hostTeamB        = $('host-team-b');
const hostTeamACount   = $('host-team-a-count');
const hostTeamBCount   = $('host-team-b-count');
const btnReset         = $('btn-reset');
const btnCorrect       = $('btn-correct');
const btnWrong         = $('btn-wrong');
const btnCopyCode      = $('btn-copy-code');
const btnSettingsOpen  = $('btn-settings');

// Participant - team select
const partRoomCode     = $('part-room-code');
const partNameDisplay  = $('part-name-display');
const partTeamA        = $('part-team-a');
const partTeamB        = $('part-team-b');

// Participant - buzzer
const viewTeamSelect   = $('view-team-select');
const viewBuzzer       = $('view-buzzer');
const buzzRoomCode     = $('buzz-room-code');
const buzzPlayerInfo   = $('buzz-player-info');
const partStatusBanner = $('part-status-banner');
const partBuzzerInfo   = $('part-buzzer-info');
const partBuzzerName   = $('part-buzzer-name');
const partBuzzerTeam   = $('part-buzzer-team');
const partTimer        = $('part-timer');
const partTimerNumber  = $('part-timer-number');
const partTimerFill    = $('part-timer-ring-fill');
const buzzerBtn        = $('buzzer-btn');
const btnChangeSlot    = $('btn-change-slot');
const miniTeamA        = $('mini-team-a');
const miniTeamB        = $('mini-team-b');
const buzzerScreenBg   = $('buzzer-screen-bg');

// Settings modal
const settingsModal      = $('settings-modal');
const modalBackdrop      = $('modal-backdrop');
const btnCloseSettings   = $('btn-close-settings');
const btnSaveSettings    = $('btn-save-settings');
const settingAnswerTime  = $('setting-answer-time');
const settingAnswerVal   = $('setting-answer-time-val');
const settingOppTime     = $('setting-opponent-time');
const settingOppVal      = $('setting-opponent-time-val');
const settingLockWrong   = $('setting-lock-wrong');

const toast = $('toast');
let toastTimeout;

// ===== Helpers =====
function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => el.classList.toggle('active', k === name));
}
function showToast(msg, duration = 3000) {
  clearTimeout(toastTimeout);
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toastTimeout = setTimeout(() => toast.classList.add('hidden'), duration);
}
function showEntryError(msg) { entryError.textContent = msg; entryError.classList.remove('hidden'); }
function clearEntryError()   { entryError.classList.add('hidden'); }
function teamLabel(t) { return `Team ${t}`; }

function setTimerRing(fillEl, remaining, total) {
  fillEl.style.strokeDashoffset = (!total || remaining <= 0)
    ? TIMER_CIRCUMFERENCE
    : TIMER_CIRCUMFERENCE * (1 - remaining / total);
}
function renderTimer(remaining, total, numEl, fillEl, containerEl) {
  if (!total || remaining <= 0) { containerEl.classList.add('hidden'); return; }
  containerEl.classList.remove('hidden');
  numEl.textContent = remaining;
  setTimerRing(fillEl, remaining, total);
  fillEl.style.stroke = (total === 10)
    ? (remaining <= 3 ? '#ff3d3d' : '#00b4ff')
    : (remaining <= 2 ? '#ff3d3d' : '#ffd740');
}

// ===== Buzzer ripple =====
function spawnRipple() {
  const r = document.createElement('div');
  r.className = 'buzzer-ripple';
  buzzerBtn.appendChild(r);
  r.addEventListener('animationend', () => r.remove());
}

// ===== Dynamic buzzer background =====
function updateBuzzerBg(state, buzzer, allowedTeam) {
  if (!buzzerScreenBg) return;
  let bg;
  if (buzzer) {
    bg = buzzer.team === 'A'
      ? 'radial-gradient(ellipse at center, rgba(0,80,200,0.38) 0%, transparent 70%)'
      : 'radial-gradient(ellipse at center, rgba(200,0,0,0.38) 0%, transparent 70%)';
  } else if (state === 'correct_reveal') {
    bg = 'radial-gradient(ellipse at center, rgba(0,180,80,0.38) 0%, transparent 70%)';
  } else if (state === 'open_buzz' || state === 'open_buzz_active') {
    bg = 'radial-gradient(ellipse at center, rgba(0,130,60,0.32) 0%, transparent 70%)';
  } else if (state === 'opponent_chance') {
    const c = allowedTeam === 'A' ? '0,80,200' : '200,0,0';
    bg = `radial-gradient(ellipse at center, rgba(${c},0.28) 0%, transparent 70%)`;
  } else {
    bg = 'radial-gradient(ellipse at center, rgba(60,0,0,0.4) 0%, transparent 70%)';
  }
  buzzerScreenBg.style.background = bg;
}

// ===== Settings Modal =====
function openSettings() {
  const s = gameState?.settings ?? { answerTime: 5, opponentTime: 10, lockWrongPlayers: true };
  settingAnswerTime.value = s.answerTime;
  settingAnswerVal.textContent = `${s.answerTime}s`;
  settingOppTime.value = s.opponentTime;
  settingOppVal.textContent = `${s.opponentTime}s`;
  settingLockWrong.checked = s.lockWrongPlayers;
  settingsModal.classList.remove('hidden');
}
function closeSettings() { settingsModal.classList.add('hidden'); }

settingAnswerTime?.addEventListener('input', () => {
  settingAnswerVal.textContent = `${settingAnswerTime.value}s`;
});
settingOppTime?.addEventListener('input', () => {
  settingOppVal.textContent = `${settingOppTime.value}s`;
});
btnSettingsOpen?.addEventListener('click', openSettings);
btnCloseSettings?.addEventListener('click', closeSettings);
modalBackdrop?.addEventListener('click', closeSettings);
btnSaveSettings?.addEventListener('click', () => {
  socket.emit('update_settings', {
    answerTime: parseInt(settingAnswerTime.value),
    opponentTime: parseInt(settingOppTime.value),
    lockWrongPlayers: settingLockWrong.checked,
  });
  closeSettings();
});

// ===== Slot Building =====
function makeSlot(slot, index, team, options = {}) {
  const { selectable = false, showOpen = false, buzzerPlayerId = null,
          wrongPlayers = [], correctPlayer = null } = options;

  const isMine    = slot?.playerId === socket.id;
  const isTaken   = slot && !isMine;
  const isBuzzed  = slot?.playerId === buzzerPlayerId;
  const isWrong   = slot && wrongPlayers.some(p => p.playerId === slot.playerId);
  const isCorrect = slot && correctPlayer?.playerId === slot.playerId;

  const div = document.createElement('div');
  div.className = 'slot';
  if (slot)      div.classList.add('occupied', `team-${team.toLowerCase()}`);
  if (isMine)    div.classList.add('mine');
  if (isBuzzed)  div.classList.add('buzzed');
  if (isWrong)   div.classList.add('wrong-player');
  if (isCorrect) div.classList.add('correct-player');

  if (selectable) {
    div.classList.add('selectable');
    if (isTaken) div.classList.add('taken');
    else div.addEventListener('click', () => socket.emit('select_slot', { team, slot: index }));
  }

  const num = document.createElement('span');
  num.className = 'slot-number';
  num.textContent = index + 1;
  div.appendChild(num);

  const name = document.createElement('span');
  name.className = 'slot-name';
  name.textContent = slot
    ? (isMine ? `${slot.playerName} (You)` : slot.playerName)
    : (selectable && showOpen ? 'Open' : '—');
  div.appendChild(name);

  if (isWrong || isCorrect) {
    const marker = document.createElement('span');
    marker.className = `slot-marker ${isWrong ? 'wrong' : 'correct'}`;
    marker.textContent = isWrong ? '✗' : '✓';
    div.appendChild(marker);
  }
  return div;
}

function makeMiniSlot(slot, index, team, buzzerPlayerId, wrongPlayers, correctPlayer) {
  const isMine    = slot?.playerId === socket.id;
  const isBuzzed  = slot?.playerId === buzzerPlayerId;
  const isWrong   = slot && wrongPlayers?.some(p => p.playerId === slot.playerId);
  const isCorrect = slot && correctPlayer?.playerId === slot.playerId;

  const div = document.createElement('div');
  div.className = 'mini-slot';
  if (slot)      div.classList.add('occupied', `team-${team.toLowerCase()}`);
  if (isMine)    div.classList.add('mine');
  if (isBuzzed)  div.classList.add('buzzed');
  if (isWrong)   div.classList.add('wrong-player');
  if (isCorrect) div.classList.add('correct-player');

  const num = document.createElement('span');
  num.className = 'slot-number';
  num.textContent = index + 1;
  div.appendChild(num);

  const name = document.createElement('span');
  const suffix = isWrong ? ' ✗' : isCorrect ? ' ✓' : isMine ? ' ✓' : '';
  name.textContent = slot ? `${slot.playerName}${suffix}` : '—';
  div.appendChild(name);
  return div;
}

function renderSlots(teamKey, container, options = {}) {
  if (!gameState) return;
  const buzzerPlayerId = gameState.currentBuzzer?.playerId ?? null;
  container.innerHTML = '';
  gameState.teams[teamKey].forEach((slot, i) =>
    container.appendChild(makeSlot(slot, i, teamKey, {
      ...options,
      buzzerPlayerId,
      wrongPlayers: gameState.wrongPlayers ?? [],
      correctPlayer: gameState.correctPlayer ?? null,
    }))
  );
}

function renderMiniSlots(teamKey, container) {
  if (!gameState) return;
  const buzzerPlayerId = gameState.currentBuzzer?.playerId ?? null;
  container.innerHTML = '';
  gameState.teams[teamKey].forEach((slot, i) =>
    container.appendChild(makeMiniSlot(
      slot, i, teamKey, buzzerPlayerId,
      gameState.wrongPlayers ?? [],
      gameState.correctPlayer ?? null,
    ))
  );
}

function countOccupied(team) {
  return gameState?.teams[team].filter(Boolean).length ?? 0;
}

function amILockedOut() {
  if (!gameState) return false;
  if (!gameState.settings?.lockWrongPlayers) return false;
  return (gameState.wrongPlayers ?? []).some(p => p.playerId === socket.id);
}

// ===== Status messages =====
const STATUS = {
  waiting:         'Waiting for buzz...',
  first_buzz:      'Answering...',
  opponent_chance: "Opponent's Chance!",
  opponent_buzz:   'Opponent Answering...',
  open_buzz:       'Open Buzz — Anyone!',
  open_buzz_active:'Answering...',
  correct_reveal:  'Correct!',
};

function getParticipantStatus(state, allowedTeam) {
  if (state === 'correct_reveal') return '🎉 Correct!';
  if (state === 'opponent_chance') {
    if (myTeam && allowedTeam === myTeam) return "⚡ Your Team's Chance!";
    if (myTeam && allowedTeam !== myTeam) return `⏳ Team ${allowedTeam}'s Chance...`;
  }
  if (state === 'open_buzz' && amILockedOut()) return '🔒 You have been locked out';
  return STATUS[state] ?? 'Waiting...';
}

// ===== Render Host =====
function renderHost() {
  if (!gameState) return;
  const { state, currentBuzzer, correctPlayer } = gameState;

  renderSlots('A', hostTeamA);
  renderSlots('B', hostTeamB);
  hostTeamACount.textContent = `${countOccupied('A')} / 6`;
  hostTeamBCount.textContent = `${countOccupied('B')} / 6`;

  // Status banner
  let statusText = STATUS[state] ?? state;
  if (state === 'correct_reveal' && correctPlayer) statusText = `✓ ${correctPlayer.playerName} is Correct!`;
  hostStatusBanner.textContent = statusText;
  hostStatusBanner.className = `status-banner ${state}`;

  // Buzzer info
  const showBuzzer = currentBuzzer !== null;
  const showCorrect = state === 'correct_reveal' && correctPlayer !== null;
  if (showBuzzer || showCorrect) {
    const info = showBuzzer ? currentBuzzer : correctPlayer;
    hostBuzzerInfo.classList.remove('hidden');
    hostBuzzerName.textContent = info.playerName;
    hostBuzzerTeam.textContent = teamLabel(info.team);
    hostBuzzerTeam.style.color = info.team === 'A' ? 'var(--team-a)' : 'var(--team-b)';
  } else {
    hostBuzzerInfo.classList.add('hidden');
  }

  // Control buttons
  const hasActiveBuzzer = ['first_buzz', 'opponent_buzz', 'open_buzz_active'].includes(state);
  btnCorrect.disabled = !hasActiveBuzzer;
  btnWrong.disabled   = !hasActiveBuzzer;
  btnReset.disabled   = state === 'correct_reveal';

  renderTimer(timerState.remaining, timerState.total, hostTimerNumber, hostTimerFill, hostTimer);
}

// ===== Render Participant =====
function renderParticipant() {
  if (!gameState) return;
  const { state, currentBuzzer, allowedTeam, correctPlayer } = gameState;

  // Which view to show
  const hasSlot = myTeam !== null;
  viewTeamSelect.classList.toggle('hidden', hasSlot);
  viewBuzzer.classList.toggle('hidden', !hasSlot);

  // Always render team select slots (for switching)
  renderSlots('A', partTeamA, { selectable: true, showOpen: true });
  renderSlots('B', partTeamB, { selectable: true, showOpen: true });

  if (!hasSlot) return;

  // Buzzer view
  buzzPlayerInfo.textContent = `${myName}  •  Team ${myTeam}  •  Slot ${(mySlot ?? 0) + 1}`;

  const iBuzzed  = currentBuzzer?.playerId === socket.id;
  const isBuzzed = currentBuzzer !== null;
  const lockedOut = amILockedOut();
  const myTurn = !isBuzzed && ['waiting', 'open_buzz'].includes(state) && !lockedOut;
  const oppTurn = state === 'opponent_chance' && allowedTeam === myTeam && !lockedOut;
  const canBuzz = myTurn || oppTurn;

  buzzerBtn.disabled = !canBuzz && !iBuzzed;
  buzzerBtn.classList.toggle('locked', !canBuzz && !iBuzzed);
  buzzerBtn.classList.toggle('buzzed-me', iBuzzed);

  // Change buzzer label when locked out
  const labelEl = buzzerBtn.querySelector('.buzzer-label');
  if (labelEl) {
    if (lockedOut && state !== 'correct_reveal') labelEl.textContent = 'LOCKED';
    else if (iBuzzed) labelEl.textContent = 'BUZZED!';
    else labelEl.textContent = 'BUZZ!';
  }

  // Status banner
  let statusClass = state;
  let statusText  = getParticipantStatus(state, allowedTeam);
  if (state === 'opponent_chance' && allowedTeam !== myTeam) statusClass = 'locked';
  if (lockedOut && ['waiting','open_buzz'].includes(state)) statusClass = 'locked';
  partStatusBanner.textContent = statusText;
  partStatusBanner.className = `status-banner ${statusClass}`;

  // Buzzer info (who buzzed / who was correct)
  const showReveal = state === 'correct_reveal' && correctPlayer;
  const infoTarget = showReveal ? correctPlayer : currentBuzzer;
  if (infoTarget) {
    partBuzzerInfo.classList.remove('hidden');
    partBuzzerName.textContent = infoTarget.playerName;
    partBuzzerTeam.textContent = teamLabel(infoTarget.team);
    partBuzzerTeam.style.color = infoTarget.team === 'A' ? 'var(--team-a)' : 'var(--team-b)';
  } else {
    partBuzzerInfo.classList.add('hidden');
  }

  renderTimer(timerState.remaining, timerState.total, partTimerNumber, partTimerFill, partTimer);
  renderMiniSlots('A', miniTeamA);
  renderMiniSlots('B', miniTeamB);
  updateBuzzerBg(state, currentBuzzer, allowedTeam);
}

function render() {
  if (isHost) renderHost();
  else renderParticipant();
}

// ===== Sync my slot from state =====
function syncMySlot() {
  for (const team of ['A', 'B']) {
    for (let i = 0; i < gameState.teams[team].length; i++) {
      if (gameState.teams[team][i]?.playerId === socket.id) {
        myTeam = team; mySlot = i; return;
      }
    }
  }
  myTeam = null; mySlot = null;
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

socket.on('settings_updated', (settings) => {
  if (gameState) gameState.settings = settings;
  showToast('Settings updated!');
});

socket.on('error_msg', ({ message }) => {
  if (screens.entry.classList.contains('active')) showEntryError(message);
  else showToast(message);
});

socket.on('host_disconnected', () => {
  showToast('Host disconnected. Returning to menu.', 4000);
  setTimeout(() => {
    myName = ''; myRoomCode = ''; isHost = false;
    myTeam = null; mySlot = null;
    gameState = null; timerState = { remaining: 0, total: 0 };
    showScreen('entry');
  }, 2500);
});

// ===== Entry =====
btnCreate.addEventListener('click', () => {
  clearEntryError();
  const name = entryName.value.trim();
  if (!name) { showEntryError('Please enter your name.'); return; }
  myName = name; isHost = true;
  socket.emit('create_room', { name });
});

btnJoin.addEventListener('click', () => {
  clearEntryError();
  const name = entryName.value.trim();
  const code = entryCode.value.trim().toUpperCase();
  if (!name) { showEntryError('Please enter your name.'); return; }
  if (!code) { showEntryError('Please enter a room code to join.'); return; }
  myName = name; isHost = false;
  socket.emit('join_room', { name, code });
});

[entryName, entryCode].forEach(input =>
  input.addEventListener('keydown', e => { if (e.key === 'Enter') btnJoin.click(); })
);
entryCode.addEventListener('input', () => { entryCode.value = entryCode.value.toUpperCase(); });

// ===== Host Controls =====
btnReset.addEventListener('click', () => socket.emit('reset_buzzers'));
btnCorrect.addEventListener('click', () => socket.emit('correct_answer'));
btnWrong.addEventListener('click', () => socket.emit('wrong_answer'));

btnCopyCode?.addEventListener('click', () => {
  const code = hostRoomCode.textContent;
  if (!code || code === '-----') return;
  navigator.clipboard.writeText(code).then(() => showToast(`Room code ${code} copied!`));
});

// ===== Buzzer =====
function triggerBuzz() {
  if (buzzerBtn.disabled) return;
  spawnRipple();
  socket.emit('buzz');
}
buzzerBtn.addEventListener('click', triggerBuzz);
buzzerBtn.addEventListener('touchstart', e => { e.preventDefault(); triggerBuzz(); }, { passive: false });

// ===== Change Slot =====
btnChangeSlot.addEventListener('click', () => {
  socket.emit('leave_slot');
  myTeam = null; mySlot = null;
  render();
});
