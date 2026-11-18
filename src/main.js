import * as THREE from 'three';
import './style.css';
import { BIKE_COLORS, createBikeMesh } from './bike.js';
import { createTrack, RIDE_HALF_LIMIT, TRACK_LENGTHS } from './track.js';
import { MultiplayerManager } from './network.js';
import { SoundEngine } from './audio.js';
import { RaceHUD } from './hud.js';

// === DOM REFERENCES ===
const canvas = document.getElementById('game-canvas');
const appEl = document.getElementById('app');

const lobbyScreen = document.getElementById('lobby-screen');
const netStatusEl = document.getElementById('net-status');
const netTextEl = netStatusEl.querySelector('.net-text');
const colorCards = Array.from(document.querySelectorAll('.color-card'));
const lengthBtns = Array.from(document.querySelectorAll('.length-btn'));
const playersListEl = document.getElementById('players-list');
const playerCountEl = document.getElementById('player-count');
const startBtn = document.getElementById('start-btn');

const raceHudEl = document.getElementById('race-hud');
const countdownEl = document.getElementById('countdown-overlay');
const turboBannerEl = document.getElementById('turbo-banner');
const controlHintEl = document.getElementById('control-hint');
const soundBtn = document.getElementById('sound-btn');
const pauseBtn = document.getElementById('pause-btn');

const pauseOverlay = document.getElementById('pause-overlay');
const resumeBtn = document.getElementById('resume-btn');
const quitBtn = document.getElementById('quit-btn');

const finishOverlay = document.getElementById('finish-overlay');
const finishTitleEl = document.getElementById('finish-title');
const finishSubtitleEl = document.getElementById('finish-subtitle');
const podiumListEl = document.getElementById('podium-list');
const playAgainBtn = document.getElementById('play-again-btn');
const backLobbyBtn = document.getElementById('back-lobby-btn');

// === THREE.JS RENDERER & SCENE ===
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x55b8ff);
scene.fog = new THREE.Fog(0x88d4ff, 110, 420);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.2, 550);

// Sunny coastal lighting
const hemiLight = new THREE.HemisphereLight(0xbbe9ff, 0x3b5c2b, 1.15);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff8e6, 1.55);
sunLight.position.set(80, 120, -40);
scene.add(sunLight);

// Distant glowing sun disc in sky
const sunDisc = new THREE.Mesh(
  new THREE.CircleGeometry(22, 24),
  new THREE.MeshBasicMaterial({ color: 0xfff5b8, fog: false }),
);
sunDisc.position.set(170, 145, -360);
scene.add(sunDisc);

function handleResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', handleResize);

// === CORE SYSTEMS ===
const sound = new SoundEngine();
const hud = new RaceHUD();

let gameState = 'LOBBY'; // 'LOBBY' | 'COUNTDOWN' | 'RACING' | 'PAUSED' | 'FINISHED'
let currentTrack = null;
let currentSeed = 12345;
let selectedLength = 'medium';
let countdownTimer = 0;
let countdownStep = 4;
let raceElapsed = 0;
let hintTimer = 0;
let turboBannerTimer = 0;
let lastNetSend = 0;
let lastPodiumRefresh = 0;
let bikeBumpCooldown = 0;
let muted = false;
let prevPeerCount = 0;
let readyAutoStartTimer = null;

const localRider = {
  d: 8,
  lateral: 0,
  speed: 0,
  steer: 0,
  lean: 0,
  score: 0,
  scoreAccum: 0,
  coins: 0,
  jumpY: 0,
  jumpVelY: 0,
  turboTimer: 0,
  slowTimer: 0,
  bumpTimer: 0,
  finished: false,
  finishTime: null,
  visual: null,
};

// Map<peerId, RemoteRiderEntry>
const remoteRiders = new Map();

// === ONE-FINGER TOUCH / POINTER + KEYBOARD INPUT ===
let pointerActive = false;
let activePointerId = null;
let dragAnchorX = 0;
let dragCurrentX = 0;
const keys = { up: false, left: false, right: false };

function getMaxDragPx() {
  return Math.min(105, Math.max(62, window.innerWidth * 0.23));
}

appEl.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button') || e.target.closest('.lobby-card') || e.target.closest('.modal-card')) {
    return;
  }
  if (gameState !== 'RACING' && gameState !== 'COUNTDOWN') return;
  sound.unlock();
  const wasActive = pointerActive;
  pointerActive = true;
  activePointerId = e.pointerId;
  dragAnchorX = e.clientX;
  dragCurrentX = e.clientX;
  if (gameState === 'RACING' && !wasActive) {
    sendLocalRaceStateNow();
  }
});

window.addEventListener('pointermove', (e) => {
  if (!pointerActive || e.pointerId !== activePointerId) return;
  dragCurrentX = e.clientX;
  const maxDrag = getMaxDragPx();
  const delta = dragCurrentX - dragAnchorX;
  if (Math.abs(delta) > maxDrag * 1.25) {
    dragAnchorX = dragCurrentX - Math.sign(delta) * maxDrag * 1.25;
  }
});

function releasePointer(e) {
  if (pointerActive && e.pointerId === activePointerId) {
    pointerActive = false;
    activePointerId = null;
    if (gameState === 'RACING') {
      sendLocalRaceStateNow();
    }
  }
}
window.addEventListener('pointerup', releasePointer);
window.addEventListener('pointercancel', releasePointer);

window.addEventListener('keydown', (e) => {
  const wasUp = keys.up;
  if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') keys.up = true;
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = true;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = true;
  if (gameState === 'RACING' && !wasUp && keys.up) {
    sendLocalRaceStateNow();
  }
});

window.addEventListener('keyup', (e) => {
  const wasUp = keys.up;
  if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') keys.up = false;
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
  if (gameState === 'RACING' && wasUp && !keys.up) {
    sendLocalRaceStateNow();
  }
});

function getSteerInput() {
  let steer = 0;
  if (pointerActive) {
    const maxDrag = getMaxDragPx();
    steer = Math.max(-1, Math.min(1, (dragCurrentX - dragAnchorX) / maxDrag));
  }
  if (keys.left) steer -= 1;
  if (keys.right) steer += 1;
  return Math.max(-1, Math.min(1, steer));
}

function isThrottlingInput() {
  return pointerActive || keys.up;
}

// === MULTIPLAYER MANAGER ===
const network = new MultiplayerManager({
  onStatusChange(status) {
    netTextEl.textContent = status.label;
    netStatusEl.classList.toggle('online', status.online);
  },
  onRoomUpdate(players) {
    if (prevPeerCount > 1 && players.length === 1 && network.localReady && gameState === 'LOBBY') {
      network.setReady(false);
      prevPeerCount = players.length;
      return;
    }
    prevPeerCount = players.length;
    renderLobbyUI(players);
    if (gameState === 'FINISHED') {
      renderPodium();
    }
    checkAndTriggerStartIfAllReady();
  },
  onLengthChange(lengthId) {
    selectedLength = lengthId;
    updateLengthButtons();
  },
  onRaceStart(payload) {
    clearTimeout(readyAutoStartTimer);
    if (gameState === 'COUNTDOWN' || gameState === 'RACING') return;
    beginCountdown(payload.seed, payload.lengthId || selectedLength);
  },
  onPeerFinish() {
    if (gameState === 'FINISHED') {
      renderPodium();
    }
    if (gameState === 'LOBBY') {
      renderLobbyUI();
    }
    checkAndTriggerStartIfAllReady();
  },
});

network.start();

// === LOBBY & READY FLOW ===
function isAnyPeerStillRacing() {
  for (const peer of network.peers.values()) {
    if (peer.state === 'RACING' || peer.state === 'COUNTDOWN') {
      return true;
    }
  }
  return false;
}

function checkAndTriggerStartIfAllReady() {
  if (gameState !== 'LOBBY' && gameState !== 'FINISHED') return;
  if (isAnyPeerStillRacing()) return;

  const players = network.getPlayersSnapshot();
  if (players.length === 0) return;

  const allReady = players.every((p) => p.ready);
  if (!allReady) {
    clearTimeout(readyAutoStartTimer);
    return;
  }

  if (players[0].isLocal) {
    clearTimeout(readyAutoStartTimer);
    const seed = Math.floor(Math.random() * 1_000_000_000) + 1;
    network.startRace(seed, selectedLength);
    beginCountdown(seed, selectedLength);
  } else {
    clearTimeout(readyAutoStartTimer);
    readyAutoStartTimer = setTimeout(() => {
      if ((gameState === 'LOBBY' || gameState === 'FINISHED') && !isAnyPeerStillRacing()) {
        const latest = network.getPlayersSnapshot();
        if (latest.length > 0 && latest.every((p) => p.ready)) {
          const seed = Math.floor(Math.random() * 1_000_000_000) + 1;
          network.startRace(seed, selectedLength);
          beginCountdown(seed, selectedLength);
        }
      }
    }, 550);
  }
}

function updateLengthButtons() {
  for (const btn of lengthBtns) {
    btn.classList.toggle('selected', btn.dataset.length === selectedLength);
  }
}

function renderLobbyUI(players = network.getPlayersSnapshot()) {
  const takenMap = new Map();
  for (const p of players) {
    takenMap.set(p.color, p);
  }

  for (const card of colorCards) {
    const cId = card.dataset.color;
    const owner = takenMap.get(cId);
    const badge = card.querySelector('.color-badge');
    const isMine = cId === network.localColor;
    const isTakenByOther = Boolean(owner && !owner.isLocal);

    card.classList.toggle('selected', isMine);
    card.classList.toggle('taken', isTakenByOther);
    if (isMine) {
      badge.textContent = 'TVOJE';
    } else if (isTakenByOther) {
      badge.textContent = 'Obsazeno';
    } else {
      badge.textContent = 'Volná';
    }
  }

  playerCountEl.textContent = String(players.length);
  playersListEl.innerHTML = '';

  for (let i = 0; i < 6; i++) {
    const p = players[i];
    const row = document.createElement('div');
    if (p) {
      const palette = BIKE_COLORS[p.color] || BIKE_COLORS.red;
      let statusTag = 'Nepřipraven';
      if (p.state === 'RACING' || p.state === 'COUNTDOWN') {
        statusTag = 'Závodí';
      } else if (p.ready) {
        statusTag = 'Připraven ✓';
      }
      row.className = 'player-row';
      row.innerHTML = `
        <span class="player-dot" style="background:${palette.hex}"></span>
        <span>${p.isLocal ? 'Ty' : `Kamarád ${i + 1}`} (${palette.riderLabel})</span>
        <span class="player-tag">${statusTag}</span>
      `;
    } else {
      row.className = 'player-row empty';
      row.innerHTML = `
        <span class="player-dot" style="background:rgba(255,255,255,0.2)"></span>
        <span>Čeká se na dalšího hráče...</span>
      `;
    }
    playersListEl.appendChild(row);
  }

  // Start / Ready button state
  if (isAnyPeerStillRacing()) {
    startBtn.disabled = true;
    startBtn.classList.remove('ready-waiting');
    startBtn.textContent = 'PROBÍHÁ ZÁVOD (Čeká se na dojetí...)';
  } else {
    startBtn.disabled = false;
    const total = players.length;
    const readyCount = players.filter((p) => p.ready).length;
    if (total <= 1) {
      startBtn.classList.remove('ready-waiting');
      startBtn.textContent = 'START ZÁVODU!';
    } else if (network.localReady) {
      startBtn.classList.add('ready-waiting');
      startBtn.textContent = `ČEKÁ SE NA OSTATNÍ... (${readyCount}/${total})`;
    } else {
      startBtn.classList.remove('ready-waiting');
      startBtn.textContent = `JSEM PŘIPRAVEN! (${readyCount}/${total})`;
    }
  }

  if (gameState === 'LOBBY') {
    rebuildLocalBikeMesh(network.localColor);
  }
}

colorCards.forEach((card) => {
  card.addEventListener('click', () => {
    sound.unlock();
    const colorId = card.dataset.color;
    if (network.selectColor(colorId)) {
      rebuildLocalBikeMesh(colorId);
      renderLobbyUI();
    }
  });
});

lengthBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    sound.unlock();
    selectedLength = btn.dataset.length;
    updateLengthButtons();
    network.setTrackLength(selectedLength);
  });
});

startBtn.addEventListener('click', () => {
  sound.unlock();
  if (isAnyPeerStillRacing()) return;
  network.setReady(!network.localReady);
  renderLobbyUI();
  checkAndTriggerStartIfAllReady();
});

playAgainBtn.addEventListener('click', () => {
  sound.unlock();
  if (isAnyPeerStillRacing()) return;
  network.setReady(!network.localReady);
  renderPodium();
  checkAndTriggerStartIfAllReady();
});

backLobbyBtn.addEventListener('click', () => {
  returnToLobby();
});

soundBtn.addEventListener('click', () => {
  muted = !muted;
  sound.setMuted(muted);
  soundBtn.classList.toggle('muted', muted);
});

pauseBtn.addEventListener('click', () => {
  if (gameState !== 'RACING') return;
  gameState = 'PAUSED';
  pointerActive = false;
  pauseOverlay.classList.remove('hidden');
  sound.updateEngine(0, false, false);
});

resumeBtn.addEventListener('click', () => {
  if (gameState !== 'PAUSED') return;
  pauseOverlay.classList.add('hidden');
  gameState = 'RACING';
});

quitBtn.addEventListener('click', () => {
  pauseOverlay.classList.add('hidden');
  returnToLobby();
});

// === SCENE / TRACK MANAGEMENT ===
function clearRemoteBikes() {
  for (const entry of remoteRiders.values()) {
    scene.remove(entry.visual.group);
  }
  remoteRiders.clear();
}

function rebuildLocalBikeMesh(colorId) {
  if (localRider.visual) {
    scene.remove(localRider.visual.group);
  }
  localRider.visual = createBikeMesh(colorId, true);
  scene.add(localRider.visual.group);
}

function loadSceneTrack(seed, lengthId) {
  if (currentTrack) {
    currentTrack.dispose();
  }
  currentSeed = seed;
  currentTrack = createTrack(scene, seed, lengthId);
  hud.setTrackPath(currentTrack.minimapPoints);
}

function sendLocalRaceStateNow(now = performance.now()) {
  lastNetSend = now;
  network.sendRaceState({
    d: localRider.d,
    lateral: localRider.lateral,
    speed: localRider.speed,
    steer: Number(localRider.steer.toFixed(3)),
    throttling: isThrottlingInput(),
    lean: localRider.lean,
    score: Math.floor(localRider.score),
    coins: localRider.coins,
    jumpY: Number(localRider.jumpY.toFixed(2)),
    turbo: localRider.turboTimer > 0,
    finished: localRider.finished,
    finishTime: localRider.finishTime,
  });
}

function ensureRemoteRiderVisual(peer) {
  let entry = remoteRiders.get(peer.id);
  if (!entry) {
    entry = {
      id: peer.id,
      color: peer.color,
      d: peer.d || 8,
      lateral: peer.lateral || 0,
      netTargetD: peer.d || 8,
      netTargetLat: peer.lateral || 0,
      speed: peer.speed || 0,
      steer: peer.steer || 0,
      throttling: Boolean(peer.throttling),
      lean: peer.lean || 0,
      score: peer.score || 0,
      coins: peer.coins || 0,
      jumpY: peer.jumpY || 0,
      netTargetJumpY: peer.jumpY || 0,
      turbo: false,
      finished: false,
      finishTime: null,
      lastPacketAt: 0,
      visual: createBikeMesh(peer.color, false),
    };
    scene.add(entry.visual.group);
    remoteRiders.set(peer.id, entry);
  } else if (entry.color !== peer.color) {
    scene.remove(entry.visual.group);
    entry.color = peer.color;
    entry.visual = createBikeMesh(peer.color, false);
    scene.add(entry.visual.group);
  }
  return entry;
}

function getStartingLateral(index, total) {
  if (total <= 1) return 0;
  if (total === 2) return index === 0 ? -2.2 : 2.2;
  if (total === 3) return [-3.6, 0, 3.6][index] ?? 0;
  if (total === 4) return [-4.5, -1.5, 1.5, 4.5][index] ?? 0;
  if (total === 5) return [-5.2, -2.6, 0, 2.6, 5.2][index] ?? 0;
  return [-5.5, -3.3, -1.1, 1.1, 3.3, 5.5][index] ?? 0;
}

function beginCountdown(seed, lengthId) {
  clearTimeout(readyAutoStartTimer);
  selectedLength = lengthId;
  updateLengthButtons();
  loadSceneTrack(seed, lengthId);
  clearRemoteBikes();
  rebuildLocalBikeMesh(network.localColor);

  const snapshot = network.getPlayersSnapshot();
  const total = snapshot.length;

  snapshot.forEach((p, idx) => {
    const startLat = getStartingLateral(idx, total);
    if (p.isLocal) {
      localRider.d = 8;
      localRider.lateral = startLat;
      localRider.speed = 0;
      localRider.steer = 0;
      localRider.lean = 0;
      localRider.score = 0;
      localRider.scoreAccum = 0;
      localRider.coins = 0;
      localRider.jumpY = 0;
      localRider.jumpVelY = 0;
      localRider.turboTimer = 0;
      localRider.slowTimer = 0;
      localRider.bumpTimer = 0;
      localRider.finished = false;
      localRider.finishTime = null;
    } else {
      const remote = ensureRemoteRiderVisual(p);
      remote.d = 8;
      remote.lateral = startLat;
      remote.netTargetD = 8;
      remote.netTargetLat = startLat;
      remote.speed = 0;
      remote.steer = 0;
      remote.throttling = false;
      remote.lean = 0;
      remote.coins = 0;
      remote.jumpY = 0;
      remote.netTargetJumpY = 0;
      remote.lastPacketAt = 0;
    }
  });

  lobbyScreen.classList.add('hidden');
  pauseOverlay.classList.add('hidden');
  finishOverlay.classList.add('hidden');
  raceHudEl.classList.remove('hidden');
  turboBannerEl.classList.add('hidden');
  controlHintEl.classList.remove('hidden');

  countdownTimer = 3.2;
  countdownStep = 4;
  raceElapsed = 0;
  hintTimer = 5.5;
  turboBannerTimer = 0;
  pointerActive = false;
  gameState = 'COUNTDOWN';
  network.setLocalState('COUNTDOWN');

  // Position camera immediately at starting grid
  positionBikeAndCamera(0.016, 0, true);
}

function returnToLobby() {
  gameState = 'LOBBY';
  pointerActive = false;
  sound.stopEngine();
  clearRemoteBikes();
  network.setLocalState('LOBBY');

  raceHudEl.classList.add('hidden');
  pauseOverlay.classList.add('hidden');
  finishOverlay.classList.add('hidden');
  countdownEl.classList.add('hidden');
  lobbyScreen.classList.remove('hidden');

  if (!currentTrack) {
    loadSceneTrack(12345, 'short');
  } else {
    currentTrack.resetItems();
  }
  localRider.d = 12;
  localRider.lateral = 0;
  localRider.speed = 0;
  localRider.lean = 0;
  localRider.coins = 0;
  localRider.jumpY = 0;
  localRider.jumpVelY = 0;
  rebuildLocalBikeMesh(network.localColor);
  renderLobbyUI();
}

function showBanner(text) {
  turboBannerEl.textContent = text;
  turboBannerTimer = 1.3;
  turboBannerEl.classList.remove('hidden');
}

function buildRaceStandings() {
  const entries = [
    {
      id: network.localId,
      isLocal: true,
      color: network.localColor,
      d: localRider.d,
      score: Math.floor(localRider.score),
      finished: localRider.finished,
      finishTime: localRider.finishTime,
      ready: network.localReady,
    },
  ];

  for (const peer of network.peers.values()) {
    if (peer.state === 'RACING' || peer.state === 'FINISHED' || peer.state === 'COUNTDOWN') {
      entries.push({
        id: peer.id,
        isLocal: false,
        color: peer.color,
        d: peer.d || 0,
        score: Math.floor(peer.score || 0),
        finished: Boolean(peer.finished),
        finishTime: peer.finishTime,
        ready: Boolean(peer.ready),
      });
    }
  }

  entries.sort((a, b) => {
    if (a.finished && b.finished) {
      return (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity);
    }
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.d - a.d;
  });

  return entries;
}

function renderPodium() {
  const standings = buildRaceStandings();
  const localRank = standings.findIndex((e) => e.isLocal) + 1;
  const bestTime =
    standings.find((e) => e.finished && e.finishTime != null)?.finishTime ?? null;

  finishTitleEl.textContent = 'CÍL ZÁVODU!';
  finishSubtitleEl.textContent =
    standings.length > 1
      ? `${localRank}. MÍSTO (${localRider.finishTime.toFixed(2)} s)`
      : `Čas v cíli: ${localRider.finishTime.toFixed(2)} s`;

  podiumListEl.innerHTML = '';
  standings.forEach((entry, idx) => {
    const palette = BIKE_COLORS[entry.color] || BIKE_COLORS.red;
    const row = document.createElement('div');
    row.className = `podium-row${entry.isLocal ? ' local' : ''}`;
    let metaText;
    if (entry.finished && entry.finishTime != null) {
      if (idx === 0 || bestTime == null) {
        metaText = `${entry.finishTime.toFixed(2)} s`;
      } else {
        const diff = Math.max(0, entry.finishTime - bestTime);
        metaText = `${entry.finishTime.toFixed(2)} s (+${diff.toFixed(2)} s)`;
      }
    } else {
      metaText = `Na trati (${Math.round((entry.d / currentTrack.totalMeters) * 100)} %)`;
    }
    const readySuffix = entry.ready ? ' • ✓ Připraven' : '';
    row.innerHTML = `
      <span class="podium-rank">${idx + 1}.</span>
      <span class="player-dot" style="background:${palette.hex}"></span>
      <span>${entry.isLocal ? 'Ty' : 'Kamarád'} (${palette.label})</span>
      <span class="podium-meta">${metaText}${readySuffix}</span>
    `;
    podiumListEl.appendChild(row);
  });

  const stillRacing = isAnyPeerStillRacing();
  const finishedCount = standings.filter((e) => e.finished).length;

  if (stillRacing) {
    playAgainBtn.disabled = true;
    playAgainBtn.classList.remove('ready-waiting');
    playAgainBtn.textContent = `Čeká se na dojetí ostatních... (${finishedCount}/${standings.length} v cíli)`;
  } else {
    playAgainBtn.disabled = false;
    const players = network.getPlayersSnapshot();
    const total = players.length;
    const readyCount = players.filter((p) => p.ready).length;
    if (total <= 1) {
      playAgainBtn.classList.remove('ready-waiting');
      playAgainBtn.textContent = 'DALŠÍ ZÁVOD (Nová trať)';
    } else if (network.localReady) {
      playAgainBtn.classList.add('ready-waiting');
      playAgainBtn.textContent = `ČEKÁ SE NA OSTATNÍ... (${readyCount}/${total})`;
    } else {
      playAgainBtn.classList.remove('ready-waiting');
      playAgainBtn.textContent = `PŘIPRAVEN NA DALŠÍ ZÁVOD (${readyCount}/${total})`;
    }
  }
}

function finishLocalRace() {
  localRider.finished = true;
  localRider.finishTime = raceElapsed;
  localRider.jumpY = 0;
  localRider.jumpVelY = 0;
  gameState = 'FINISHED';
  pointerActive = false;

  network.sendRaceState({
    d: currentTrack.totalMeters,
    lateral: localRider.lateral,
    speed: localRider.speed,
    steer: 0,
    throttling: false,
    lean: 0,
    score: Math.floor(localRider.score),
    coins: localRider.coins,
    jumpY: 0,
    turbo: false,
    finished: true,
    finishTime: localRider.finishTime,
  });
  network.sendFinish(localRider.finishTime, Math.floor(localRider.score));

  sound.stopEngine();
  const standings = buildRaceStandings();
  const won = standings[0]?.isLocal;
  sound.playFinish(won);

  renderPodium();
  finishOverlay.classList.remove('hidden');
}

// === PHYSICS & RENDER LOOP ===
const _camPosTarget = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _smoothedLook = new THREE.Vector3();

function positionBikeAndCamera(dt, timeSec, snapImmediate = false) {
  if (!currentTrack || !localRider.visual) return;

  const frame = currentTrack.sampleAt(localRider.d);
  localRider.visual.group.position.copy(frame.pos).addScaledVector(frame.right, localRider.lateral);
  localRider.visual.group.rotation.y = frame.yaw;

  localRider.visual.updateVisual(
    dt,
    localRider.speed,
    localRider.lean,
    localRider.turboTimer > 0,
    localRider.bumpTimer,
    timeSec,
    localRider.jumpY,
  );

  const aheadFrame = currentTrack.sampleAt(Math.min(currentTrack.totalMeters, localRider.d + 16));
  _camPosTarget
    .copy(frame.pos)
    .addScaledVector(frame.tangent, -4.8)
    .addScaledVector(frame.right, localRider.lateral * 0.72);
  _camPosTarget.y += 2.45 + localRider.jumpY * 0.65;

  _lookTarget
    .copy(aheadFrame.pos)
    .addScaledVector(aheadFrame.right, localRider.lateral * 0.42);
  _lookTarget.y += 1.05 + localRider.jumpY * 0.4;

  if (snapImmediate) {
    camera.position.copy(_camPosTarget);
    _smoothedLook.copy(_lookTarget);
  } else {
    const camBlend = 1 - Math.exp(-12 * dt);
    camera.position.lerp(_camPosTarget, camBlend);
    _smoothedLook.lerp(_lookTarget, camBlend);
  }
  camera.lookAt(_smoothedLook);

  // Subtle dynamic FOV boost when fast / turbo
  const targetFov = localRider.turboTimer > 0 ? 73 : 61 + (localRider.speed / 65) * 6;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 6);
    camera.updateProjectionMatrix();
  }
}

function updateRemoteBikes(dt, timeSec) {
  if (!currentTrack) return;

  const activePeerIds = new Set();

  // Sync peers active in this race with 60 FPS dead-reckoning
  for (const peer of network.peers.values()) {
    if (peer.state !== 'RACING' && peer.state !== 'COUNTDOWN' && peer.state !== 'FINISHED') {
      continue;
    }
    activePeerIds.add(peer.id);
    const entry = ensureRemoteRiderVisual(peer);

    if (peer.stateReceivedAt && peer.stateReceivedAt !== entry.lastPacketAt) {
      entry.lastPacketAt = peer.stateReceivedAt;
      const oneWaySec = Math.min(0.15, ((peer.rttMs || 60) * 0.5) / 1000);
      entry.netTargetD = (peer.d ?? entry.d) + (peer.speed ?? 0) * oneWaySec;
      entry.netTargetLat = peer.lateral ?? entry.lateral;
      entry.speed = peer.speed ?? entry.speed;
      entry.steer = peer.steer ?? 0;
      entry.throttling = Boolean(peer.throttling);
      entry.coins = peer.coins ?? entry.coins ?? 0;
      entry.netTargetJumpY = peer.jumpY ?? 0;
      entry.turbo = Boolean(peer.turbo);
      entry.finished = Boolean(peer.finished);
    }

    if (!entry.finished && peer.state === 'RACING') {
      const topSpeed = ((entry.turbo ? 230 : 180) + (entry.coins || 0)) / 3.6;
      if (entry.throttling || entry.turbo) {
        const accel = entry.turbo ? 38 : 22;
        if (entry.speed < topSpeed) {
          entry.speed = Math.min(topSpeed, entry.speed + accel * dt);
        } else {
          entry.speed = Math.max(topSpeed, entry.speed - 18 * dt);
        }
      } else {
        entry.speed = Math.max(0, entry.speed - 28 * dt);
      }

      entry.netTargetD += entry.speed * dt;
      entry.d += entry.speed * dt;
      const dErr = entry.netTargetD - entry.d;
      if (Math.abs(dErr) > 18) {
        entry.d = entry.netTargetD;
      } else {
        entry.d += dErr * Math.min(1, dt * 14);
      }

      const frameNow = currentTrack.sampleAt(entry.d);
      const speedSteerFactor = 0.28 + 0.72 * Math.min(1, entry.speed / 24);
      const latVel =
        entry.steer * 11.8 * speedSteerFactor -
        frameNow.curvature * entry.speed * entry.speed * 0.14;
      entry.netTargetLat = Math.max(
        -RIDE_HALF_LIMIT,
        Math.min(RIDE_HALF_LIMIT, entry.netTargetLat + latVel * dt),
      );
      entry.lateral += latVel * dt + (entry.netTargetLat - entry.lateral) * Math.min(1, dt * 16);
      entry.lateral = Math.max(-RIDE_HALF_LIMIT, Math.min(RIDE_HALF_LIMIT, entry.lateral));

      const targetLean = -entry.steer * 0.44 * Math.min(1, entry.speed / 15 + 0.2);
      entry.lean += (targetLean - entry.lean) * Math.min(1, dt * 10);
      entry.jumpY += ((entry.netTargetJumpY || 0) - (entry.jumpY || 0)) * Math.min(1, dt * 16);
    } else if (entry.finished) {
      entry.speed = Math.max(0, entry.speed - 24 * dt);
      entry.d = Math.min(currentTrack.totalMeters + 25, entry.d + entry.speed * dt);
      entry.lean += (0 - entry.lean) * Math.min(1, dt * 8);
      entry.jumpY = Math.max(0, (entry.jumpY || 0) - 12 * dt);
    }

    const frame = currentTrack.sampleAt(entry.d);
    entry.visual.group.position.copy(frame.pos).addScaledVector(frame.right, entry.lateral);
    entry.visual.group.rotation.y = frame.yaw;
    entry.visual.updateVisual(dt, entry.speed, entry.lean, entry.turbo, 0, timeSec, entry.jumpY || 0);
  }

  // Clean up disconnected or lobby-returned peers
  for (const [id, entry] of remoteRiders.entries()) {
    if (!activePeerIds.has(id)) {
      scene.remove(entry.visual.group);
      remoteRiders.delete(id);
    }
  }
}

function updateLocalPhysics(dt) {
  const throttling = isThrottlingInput();
  const targetSteer = getSteerInput();
  localRider.steer += (targetSteer - localRider.steer) * Math.min(1, dt * 11);

  if (localRider.turboTimer > 0) localRider.turboTimer = Math.max(0, localRider.turboTimer - dt);
  if (localRider.slowTimer > 0) localRider.slowTimer = Math.max(0, localRider.slowTimer - dt);
  if (localRider.bumpTimer > 0) localRider.bumpTimer = Math.max(0, localRider.bumpTimer - dt);
  if (bikeBumpCooldown > 0) bikeBumpCooldown = Math.max(0, bikeBumpCooldown - dt);

  const bonusKmh = localRider.coins;
  const topSpeed =
    localRider.turboTimer > 0
      ? (230 + bonusKmh) / 3.6
      : localRider.slowTimer > 0
        ? 28
        : (180 + bonusKmh) / 3.6;

  if (throttling || localRider.turboTimer > 0) {
    const accel = localRider.turboTimer > 0 ? 38 : 22;
    if (localRider.speed < topSpeed) {
      localRider.speed = Math.min(topSpeed, localRider.speed + accel * dt);
    } else {
      localRider.speed = Math.max(topSpeed, localRider.speed - 18 * dt);
    }
  } else {
    // Finger lifted: smooth braking/slowdown
    localRider.speed = Math.max(0, localRider.speed - 28 * dt);
  }

  // Jump vertical flight physics
  if (localRider.jumpY > 0 || localRider.jumpVelY > 0) {
    localRider.jumpY += localRider.jumpVelY * dt;
    localRider.jumpVelY -= 25 * dt;
    if (localRider.jumpY <= 0) {
      localRider.jumpY = 0;
      localRider.jumpVelY = 0;
    }
  }

  // Forward travel
  localRider.d += localRider.speed * dt;

  // Steering + gentle centrifugal curve push
  const frame = currentTrack.sampleAt(localRider.d);
  const speedSteerFactor = 0.28 + 0.72 * Math.min(1, localRider.speed / 24);
  const lateralSteerVel = localRider.steer * 11.8 * speedSteerFactor;
  const centrifugal = -frame.curvature * localRider.speed * localRider.speed * 0.14;
  localRider.lateral += (lateralSteerVel + centrifugal) * dt;

  // Lean angle (positive rotation.z leans LEFT, negative leans RIGHT)
  const targetLean = -localRider.steer * 0.44 * Math.min(1, localRider.speed / 15 + 0.2);
  localRider.lean += (targetLean - localRider.lean) * Math.min(1, dt * 10);

  // Guardrail bounce (always keeps kids safely on the road)
  if (localRider.lateral < -RIDE_HALF_LIMIT || localRider.lateral > RIDE_HALF_LIMIT) {
    const sign = Math.sign(localRider.lateral);
    localRider.lateral = sign * (RIDE_HALF_LIMIT - 0.18);
    if (localRider.speed > 14) {
      localRider.speed = Math.max(14, localRider.speed * 0.85);
      localRider.bumpTimer = 0.25;
      sound.playBump();
    }
  }

  // Gentle bike-to-bike bumping
  for (const remote of remoteRiders.values()) {
    if (remote.finished) continue;
    if (Math.abs(remote.d - localRider.d) < 2.1 && Math.abs(remote.lateral - localRider.lateral) < 1.05) {
      const pushDir = localRider.lateral >= remote.lateral ? 1 : -1;
      localRider.lateral = Math.max(
        -RIDE_HALF_LIMIT + 0.2,
        Math.min(RIDE_HALF_LIMIT - 0.2, localRider.lateral + pushDir * 0.45),
      );
      localRider.speed = Math.max(12, localRider.speed * 0.94);
      localRider.bumpTimer = 0.22;
      if (bikeBumpCooldown <= 0) {
        bikeBumpCooldown = 0.45;
        sound.playBump();
      }
    }
  }

  // Track items: ramps, coins, turbo pads, cones, puddles
  for (const item of currentTrack.items) {
    if (Math.abs(item.dist - localRider.d) > item.radiusDist) continue;
    if (Math.abs(item.lateral - localRider.lateral) > item.radiusLat) continue;

    if (item.type === 'ramp' && item.cooldown <= 0 && localRider.jumpY <= 0.12) {
      item.cooldown = 1.2;
      localRider.jumpVelY = Math.max(8.5, Math.min(13.5, localRider.speed * 0.24));
      sound.playJump();
      showBanner('SKOK!');
    } else if (item.type === 'coin' && !item.collected) {
      const canCollect = item.airCoin ? localRider.jumpY > 0.45 : localRider.jumpY < 1.55;
      if (canCollect) {
        item.collected = true;
        item.mesh.visible = false;
        localRider.coins += 1;
        sound.playCoin();
      }
    } else if (item.type === 'turbo' && item.cooldown <= 0 && localRider.jumpY < 0.7) {
      item.cooldown = 1.6;
      localRider.turboTimer = 2.2;
      localRider.speed = Math.max(localRider.speed, (220 + localRider.coins) / 3.6);
      sound.playTurbo();
      showBanner('TURBO!');
    } else if (item.type === 'cone' && !item.hit && localRider.jumpY <= 0.35) {
      item.hit = true;
      item.mesh.visible = false;
      localRider.slowTimer = 0.9;
      localRider.speed = Math.min(localRider.speed, 24);
      localRider.bumpTimer = 0.3;
      sound.playBump();
    } else if (item.type === 'puddle' && item.cooldown <= 0 && localRider.jumpY <= 0.35) {
      item.cooldown = 1.5;
      localRider.slowTimer = 1.1;
      localRider.speed = Math.min(localRider.speed, 26);
      sound.playSplash();
    }
  }

  sound.updateEngine(localRider.speed * 3.6, throttling, localRider.turboTimer > 0);

  if (localRider.d >= currentTrack.totalMeters) {
    finishLocalRace();
  }
}

function updateHudDisplay(dt) {
  const standings = buildRaceStandings();
  const place = standings.findIndex((s) => s.isLocal) + 1;
  const totalMeters = currentTrack ? currentTrack.totalMeters : 1;

  const mapRiders = [
    {
      isLocal: true,
      color: network.localColor,
      progress: localRider.d / totalMeters,
    },
  ];
  for (const r of remoteRiders.values()) {
    mapRiders.push({
      isLocal: false,
      color: r.color,
      progress: r.d / totalMeters,
    });
  }

  hud.update({
    raceTime: localRider.finished && localRider.finishTime != null ? localRider.finishTime : raceElapsed,
    coins: localRider.coins,
    speedKmh: localRider.speed * 3.6,
    place,
    totalPlayers: standings.length,
    progressPct: (localRider.d / totalMeters) * 100,
    riders: mapRiders,
    dt,
  });
}

// === BOOTSTRAP PREVIEW SCENE & ANIMATION LOOP ===
loadSceneTrack(12345, 'short');
rebuildLocalBikeMesh(network.localColor);
renderLobbyUI();

let prevTime = performance.now();

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, Math.max(0.001, (now - prevTime) / 1000));
  prevTime = now;
  const timeSec = now / 1000;

  if (currentTrack) {
    currentTrack.update(dt, timeSec);
  }

  if (gameState === 'LOBBY') {
    // Gently showcase the selected bike on the coastal highway behind the lobby
    const frame = currentTrack.sampleAt(14);
    localRider.visual.group.position.copy(frame.pos);
    localRider.visual.group.rotation.y = frame.yaw + Math.sin(timeSec * 0.45) * 0.3;
    localRider.visual.updateVisual(dt, 0, 0, false, 0, timeSec);

    camera.position.set(
      frame.pos.x + Math.sin(timeSec * 0.25) * 1.4,
      frame.pos.y + 2.4,
      frame.pos.z + 4.4,
    );
    camera.lookAt(frame.pos.x, frame.pos.y + 1.1, frame.pos.z - 6);
  } else if (gameState === 'COUNTDOWN') {
    countdownTimer -= dt;
    const step = Math.ceil(countdownTimer);
    if (step !== countdownStep && step >= 1 && step <= 3) {
      countdownStep = step;
      countdownEl.textContent = String(step);
      countdownEl.classList.remove('hidden');
      sound.playCountdown(false);
    }

    if (countdownTimer <= 0) {
      countdownEl.textContent = 'START!';
      sound.playCountdown(true);
      sound.startEngine();
      gameState = 'RACING';
      network.setLocalState('RACING');
      setTimeout(() => {
        countdownEl.classList.add('hidden');
      }, 750);
    }

    updateRemoteBikes(dt, timeSec);
    positionBikeAndCamera(dt, timeSec);
    updateHudDisplay(dt);
  } else if (gameState === 'RACING') {
    raceElapsed += dt;

    if (hintTimer > 0) {
      hintTimer -= dt;
      if (hintTimer <= 0) {
        controlHintEl.classList.add('hidden');
      }
    }

    if (turboBannerTimer > 0) {
      turboBannerTimer -= dt;
      if (turboBannerTimer <= 0) {
        turboBannerEl.classList.add('hidden');
      }
    }

    updateLocalPhysics(dt);
    updateRemoteBikes(dt, timeSec);
    positionBikeAndCamera(dt, timeSec);
    updateHudDisplay(dt);

    if (now - lastNetSend >= 30) {
      sendLocalRaceStateNow(now);
    }
  } else if (gameState === 'PAUSED') {
    // Keep remote riders updating smoothly when paused in multiplayer
    updateRemoteBikes(dt, timeSec);
    positionBikeAndCamera(dt, timeSec);
  } else if (gameState === 'FINISHED') {
    // Coast smoothly past the finish line while watching friends finish
    localRider.speed = Math.max(0, localRider.speed - 24 * dt);
    updateRemoteBikes(dt, timeSec);
    positionBikeAndCamera(dt, timeSec);
    updateHudDisplay(dt);
    if (now - lastPodiumRefresh >= 220) {
      lastPodiumRefresh = now;
      renderPodium();
    }
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(animate);
