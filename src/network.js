import mqtt from 'mqtt';
import { BIKE_COLOR_ORDER } from './bike.js';

const TOPIC = 'jonasrace/v2/room/default';
const BC_CHANNEL = 'jonas-race-room-v2';
const MQTT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];
const MAX_PLAYERS = 6;
const IDLE_SLEEP_MS = 45000;
const PEER_TIMEOUT_MS = 5000;
const RTC_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export class MultiplayerManager {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.localId = `jr_${Math.random().toString(36).slice(2, 9)}`;
    this.joinedAt = Date.now();
    this.localColor = 'red';
    this.lengthId = 'medium';
    this.localState = 'LOBBY';
    this.localReady = false;

    // Map<peerId, PeerInfo>
    this.peers = new Map();
    // Map<peerId, { pc, dc, makingOffer, pendingIce: RTCIceCandidateInit[] }>
    this.rtcPeers = new Map();
    this.seenMsgs = new Map();
    this.msgCounter = 0;

    // Activity & background sleep state (prevents hidden/idle ghost players)
    this.lastActivityAt = Date.now();
    this.isSleeping = typeof document !== 'undefined' ? Boolean(document.hidden) : false;

    // Transport state
    this.bc = null;
    this.ws = null;
    this.wsSupported = false;
    this.mqttClient = null;
    this.mqttConnected = false;
    this.brokerIndex = 0;
    this.mqttFailures = 0;
    this.wsConnected = false;

    this.heartbeatTimer = null;
    this.pruneTimer = null;
    this.fallbackTimer = null;
    this.destroyed = false;
  }

  start() {
    this.initBroadcastChannel();
    this.initLocalWebSocket();
    this.initMqtt(0);

    window.addEventListener('pointerdown', this.markActivity, { passive: true });
    window.addEventListener('pointermove', this.markActivity, { passive: true });
    window.addEventListener('touchstart', this.markActivity, { passive: true });
    window.addEventListener('keydown', this.markActivity);
    window.addEventListener('beforeunload', this.handleUnload);
    window.addEventListener('pagehide', this.handlePageHide);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    if (!this.isSleeping) {
      this.sendHello();
    }

    this.heartbeatTimer = setInterval(() => {
      const hidden = typeof document !== 'undefined' && document.hidden;
      const idleLobby = this.localState === 'LOBBY' && Date.now() - this.lastActivityAt > IDLE_SLEEP_MS;
      if (hidden || idleLobby) {
        this.enterSleep();
        return;
      }
      if (!this.isSleeping) {
        this.sendHello();
        if (this.peers.size > 0) {
          this.sendLatencyPing();
        }
      }
    }, 2000);

    // Prune timed-out peers quickly
    this.pruneTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, peer] of this.peers.entries()) {
        if (now - peer.lastSeen > PEER_TIMEOUT_MS) {
          this.peers.delete(id);
          this.closeRtcPeer(id);
          changed = true;
        }
      }
      if (changed) {
        this.emitRoomUpdate();
      }
    }, 1000);
  }

  markActivity = () => {
    this.lastActivityAt = Date.now();
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (this.isSleeping && !hidden && !this.destroyed) {
      this.wakeUp();
    }
  };

  handleVisibilityChange = () => {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      this.enterSleep();
    } else {
      this.lastActivityAt = Date.now();
      this.wakeUp();
    }
  };

  handlePageHide = () => {
    this.enterSleep();
  };

  handleUnload = () => {
    this.broadcast('bye', {}, { forceShared: true });
  };

  enterSleep() {
    if (this.isSleeping) return;
    this.isSleeping = true;
    this.localReady = false;
    this.broadcast('bye', {}, { forceShared: true });
    if (this.peers.size > 0) {
      this.peers.clear();
      this.emitRoomUpdate();
    }
    this.closeAllRtc();
  }

  wakeUp() {
    if (!this.isSleeping || this.destroyed) return;
    this.isSleeping = false;
    this.joinedAt = Date.now();
    this.sendHello();
    this.emitRoomUpdate();
  }

  initBroadcastChannel() {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      this.bc = new BroadcastChannel(BC_CHANNEL);
      this.bc.onmessage = (ev) => {
        if (ev.data) this.handleIncoming(ev.data, 'bc');
      };
    } catch {
      this.bc = null;
    }
  }

  initLocalWebSocket() {
    if (typeof window === 'undefined' || !window.location.host) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') return;

    const url = `${proto}//${window.location.host}/ws-race`;
    try {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        this.wsConnected = true;
        this.wsSupported = true;
        if (!this.isSleeping) {
          this.sendHello();
        }
        this.emitStatus();
      };
      ws.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data);
          this.handleIncoming(parsed, 'ws');
        } catch {
          // ignore malformed messages
        }
      };
      ws.onclose = () => {
        this.wsConnected = false;
        this.emitStatus();
        if (this.wsSupported && !this.destroyed) {
          setTimeout(() => this.initLocalWebSocket(), 3000);
        }
      };
      ws.onerror = () => {
        this.wsConnected = false;
      };
    } catch {
      this.ws = null;
    }
  }

  initMqtt(brokerIdx) {
    if (this.destroyed) return;
    this.brokerIndex = brokerIdx % MQTT_BROKERS.length;
    const url = MQTT_BROKERS[this.brokerIndex];

    if (this.mqttClient) {
      try {
        this.mqttClient.end(true);
      } catch {
        // ignore
      }
      this.mqttClient = null;
    }

    clearTimeout(this.fallbackTimer);
    this.mqttConnected = false;
    this.emitStatus();

    try {
      const client = mqtt.connect(url, {
        clientId: `jonas_${this.localId}_${Math.floor(Math.random() * 1000)}`,
        clean: true,
        connectTimeout: 5500,
        reconnectPeriod: 4000,
        keepalive: 25,
      });

      this.mqttClient = client;

      // Switch to backup broker if initial connection stalls
      this.fallbackTimer = setTimeout(() => {
        if (!this.mqttConnected && !this.destroyed) {
          this.initMqtt(this.brokerIndex + 1);
        }
      }, 6500);

      client.on('connect', () => {
        clearTimeout(this.fallbackTimer);
        this.mqttConnected = true;
        this.mqttFailures = 0;
        client.subscribe(TOPIC, { qos: 0 }, () => {
          if (!this.isSleeping) {
            this.sendHello();
          }
        });
        this.emitStatus();
      });

      client.on('message', (_topic, payload) => {
        try {
          const parsed = JSON.parse(payload.toString());
          this.handleIncoming(parsed, 'mqtt');
        } catch {
          // ignore invalid JSON
        }
      });

      client.on('close', () => {
        this.mqttConnected = false;
        this.emitStatus();
      });

      client.on('error', () => {
        this.mqttFailures++;
        if (this.mqttFailures >= 2 && !this.mqttConnected) {
          this.mqttFailures = 0;
          this.initMqtt(this.brokerIndex + 1);
        }
      });
    } catch {
      this.mqttConnected = false;
      this.emitStatus();
    }
  }

  // === WEBRTC P2P DATACHANNEL (LOW-LATENCY UNRELIABLE/UNORDERED TRANSPORT) ===
  maybeInitRtc(peerId) {
    if (this.destroyed || this.isSleeping || typeof RTCPeerConnection === 'undefined') return;
    if (this.rtcPeers.has(peerId)) return;
    // Only lexicographically smaller localId initiates offer to prevent glare
    if (this.localId >= peerId) return;

    const entry = this.createRtcEntry(peerId);
    if (!entry) return;

    try {
      const dc = entry.pc.createDataChannel('race', {
        ordered: false,
        maxRetransmits: 0,
      });
      this.attachDataChannel(peerId, entry, dc);

      entry.pc
        .createOffer()
        .then((offer) => entry.pc.setLocalDescription(offer))
        .then(() => {
          if (entry.pc.localDescription) {
            this.broadcast(
              'rtc_offer',
              { to: peerId, sdp: entry.pc.localDescription },
              { forceShared: true },
            );
          }
        })
        .catch(() => {
          this.closeRtcPeer(peerId);
        });
    } catch {
      this.closeRtcPeer(peerId);
    }
  }

  createRtcEntry(peerId) {
    try {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      const entry = { pc, dc: null, pendingIce: [] };
      this.rtcPeers.set(peerId, entry);

      pc.onicecandidate = (ev) => {
        if (ev.candidate && !this.destroyed && !this.isSleeping) {
          this.broadcast(
            'rtc_ice',
            { to: peerId, candidate: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate },
            { forceShared: true },
          );
        }
      };

      pc.ondatachannel = (ev) => {
        this.attachDataChannel(peerId, entry, ev.channel);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          this.closeRtcPeer(peerId);
        }
      };

      return entry;
    } catch {
      return null;
    }
  }

  attachDataChannel(peerId, entry, dc) {
    entry.dc = dc;
    dc.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data);
        this.handleIncoming(parsed, 'rtc');
      } catch {
        // ignore malformed packets
      }
    };
    dc.onclose = () => {
      if (entry.dc === dc) entry.dc = null;
    };
    dc.onerror = () => {
      if (entry.dc === dc) entry.dc = null;
    };
  }

  async handleRtcOffer(from, payload) {
    if (this.isSleeping || typeof RTCPeerConnection === 'undefined') return;
    let entry = this.rtcPeers.get(from);
    if (!entry) {
      entry = this.createRtcEntry(from);
    }
    if (!entry) return;

    try {
      await entry.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      for (const ice of entry.pendingIce) {
        await entry.pc.addIceCandidate(new RTCIceCandidate(ice)).catch(() => {});
      }
      entry.pendingIce = [];
      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      if (entry.pc.localDescription) {
        this.broadcast(
          'rtc_answer',
          { to: from, sdp: entry.pc.localDescription },
          { forceShared: true },
        );
      }
    } catch {
      this.closeRtcPeer(from);
    }
  }

  async handleRtcAnswer(from, payload) {
    const entry = this.rtcPeers.get(from);
    if (!entry) return;
    try {
      await entry.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      for (const ice of entry.pendingIce) {
        await entry.pc.addIceCandidate(new RTCIceCandidate(ice)).catch(() => {});
      }
      entry.pendingIce = [];
    } catch {
      this.closeRtcPeer(from);
    }
  }

  async handleRtcIce(from, payload) {
    if (!payload.candidate) return;
    let entry = this.rtcPeers.get(from);
    if (!entry) {
      entry = this.createRtcEntry(from);
    }
    if (!entry) return;

    if (!entry.pc.remoteDescription) {
      entry.pendingIce.push(payload.candidate);
      return;
    }
    try {
      await entry.pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
    } catch {
      // ignore invalid/stale candidate
    }
  }

  closeRtcPeer(peerId) {
    const entry = this.rtcPeers.get(peerId);
    if (!entry) return;
    try {
      entry.dc?.close();
    } catch {
      // ignore
    }
    try {
      entry.pc?.close();
    } catch {
      // ignore
    }
    this.rtcPeers.delete(peerId);
  }

  closeAllRtc() {
    for (const id of [...this.rtcPeers.keys()]) {
      this.closeRtcPeer(id);
    }
  }

  getConnectionLabel() {
    if (this.mqttConnected) return 'Online (Internet)';
    if (this.wsConnected || this.bc) return 'Lokální síť (Wi-Fi / PC)';
    return 'Připojování...';
  }

  isOnline() {
    return this.mqttConnected || this.wsConnected;
  }

  emitStatus() {
    this.callbacks.onStatusChange?.({
      label: this.getConnectionLabel(),
      online: this.isOnline(),
      mqtt: this.mqttConnected,
      ws: this.wsConnected,
    });
  }

  broadcast(type, payload, options = {}) {
    const envelope = {
      id: `${this.localId}_${++this.msgCounter}`,
      from: this.localId,
      ts: Date.now(),
      type,
      payload,
    };
    const serialized = JSON.stringify(envelope);

    const preferRtcOnly =
      !options.forceShared &&
      (type === 'race_state' || type === 'ping' || type === 'pong');

    let allPeersHaveRtc = this.peers.size > 0;
    if (preferRtcOnly && this.peers.size > 0) {
      for (const peerId of this.peers.keys()) {
        const rtc = this.rtcPeers.get(peerId);
        if (rtc?.dc && rtc.dc.readyState === 'open') {
          try {
            rtc.dc.send(serialized);
          } catch {
            allPeersHaveRtc = false;
          }
        } else {
          allPeersHaveRtc = false;
        }
      }
    } else {
      allPeersHaveRtc = false;
    }

    if (preferRtcOnly && allPeersHaveRtc) {
      return;
    }

    if (this.bc) {
      try {
        this.bc.postMessage(envelope);
      } catch {
        // ignore
      }
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(serialized);
      } catch {
        // ignore
      }
    }

    if (this.mqttClient && this.mqttConnected) {
      try {
        this.mqttClient.publish(TOPIC, serialized, { qos: 0 });
      } catch {
        // ignore
      }
    }
  }

  handleIncoming(msg) {
    if (!msg || !msg.id || !msg.from || msg.from === this.localId) return;
    if (this.isSleeping) return;

    // Deduplicate messages arriving over multiple transports
    if (this.seenMsgs.has(msg.id)) return;
    this.seenMsgs.set(msg.id, Date.now());
    if (this.seenMsgs.size > 400) {
      const oldestKey = this.seenMsgs.keys().next().value;
      this.seenMsgs.delete(oldestKey);
    }

    const now = Date.now();
    const { from, type, payload } = msg;

    if (type === 'bye') {
      const removed = this.peers.delete(from);
      this.closeRtcPeer(from);
      if (removed) {
        this.emitRoomUpdate();
      }
      return;
    }

    // Targeted WebRTC signaling messages
    if (type === 'rtc_offer' || type === 'rtc_answer' || type === 'rtc_ice') {
      if (payload?.to !== this.localId) return;
      if (type === 'rtc_offer') this.handleRtcOffer(from, payload);
      else if (type === 'rtc_answer') this.handleRtcAnswer(from, payload);
      else if (type === 'rtc_ice') this.handleRtcIce(from, payload);
      return;
    }

    let peer = this.peers.get(from);
    let added = false;
    if (!peer && this.peers.size < MAX_PLAYERS - 1) {
      added = true;
      peer = {
        id: from,
        joinedAt: payload?.joinedAt || now,
        color: payload?.color || 'blue',
        state: payload?.state || 'LOBBY',
        ready: Boolean(payload?.ready),
        d: 0,
        lateral: 0,
        speed: 0,
        steer: 0,
        throttling: false,
        lean: 0,
        score: 0,
        coins: 0,
        jumpY: 0,
        turbo: false,
        finished: false,
        finishTime: null,
        rttMs: 70,
        stateReceivedAt: 0,
        lastSeen: now,
      };
      this.peers.set(from, peer);
      this.maybeInitRtc(from);
    }

    if (!peer) return;
    peer.lastSeen = now;

    if (type === 'hello') {
      const prevColor = peer.color;
      const prevState = peer.state;
      const prevReady = peer.ready;
      peer.joinedAt = payload.joinedAt ?? peer.joinedAt;
      peer.color = payload.color ?? peer.color;
      peer.state = payload.state ?? peer.state;
      peer.ready = Boolean(payload.ready);

      if (payload.lengthId && payload.lengthId !== this.lengthId && this.localState === 'LOBBY') {
        if (payload.lengthUpdatedAt && payload.lengthUpdatedAt > (this.lastLengthUpdate || 0)) {
          this.lengthId = payload.lengthId;
          this.lastLengthUpdate = payload.lengthUpdatedAt;
          this.callbacks.onLengthChange?.(this.lengthId);
        }
      }

      this.maybeInitRtc(from);

      if (added) {
        const colorChanged = this.resolveColorConflict();
        if (!colorChanged) {
          this.sendHello();
        }
        this.emitRoomUpdate();
      } else if (
        this.resolveColorConflict() ||
        prevColor !== peer.color ||
        prevState !== peer.state ||
        prevReady !== peer.ready
      ) {
        this.emitRoomUpdate();
      }
    } else if (type === 'ready_change') {
      peer.ready = Boolean(payload.ready);
      if (payload.state) {
        peer.state = payload.state;
      }
      this.emitRoomUpdate();
    } else if (type === 'ping') {
      this.broadcast('pong', { to: from, pingTs: payload.pingTs });
    } else if (type === 'pong') {
      if (payload?.to === this.localId && typeof payload.pingTs === 'number') {
        const sampleRtt = Math.max(2, Math.min(800, performance.now() - payload.pingTs));
        peer.rttMs = peer.rttMs ? peer.rttMs * 0.65 + sampleRtt * 0.35 : sampleRtt;
      }
    } else if (type === 'length_change') {
      if (payload.lengthId && payload.lengthId !== this.lengthId) {
        this.lengthId = payload.lengthId;
        this.lastLengthUpdate = msg.ts;
        this.callbacks.onLengthChange?.(this.lengthId);
      }
    } else if (type === 'race_start') {
      const hidden = typeof document !== 'undefined' && document.hidden;
      if (this.isSleeping || hidden) return;
      this.localReady = false;
      for (const p of this.peers.values()) {
        p.ready = false;
        p.finished = false;
        p.finishTime = null;
        p.coins = 0;
        p.jumpY = 0;
        p.state = 'COUNTDOWN';
      }
      if (payload.lengthId) {
        this.lengthId = payload.lengthId;
        this.callbacks.onLengthChange?.(this.lengthId);
      }
      this.callbacks.onRaceStart?.(payload);
    } else if (type === 'race_state') {
      peer.d = payload.d;
      peer.lateral = payload.lateral;
      peer.speed = payload.speed;
      peer.steer = payload.steer ?? 0;
      peer.throttling = Boolean(payload.throttling);
      peer.lean = payload.lean;
      peer.score = payload.score;
      peer.coins = payload.coins ?? 0;
      peer.jumpY = payload.jumpY ?? 0;
      peer.turbo = Boolean(payload.turbo);
      peer.finished = Boolean(payload.finished);
      peer.finishTime = payload.finishTime ?? peer.finishTime;
      peer.stateReceivedAt = performance.now();
      peer.state = peer.finished ? 'FINISHED' : 'RACING';
    } else if (type === 'race_finish') {
      peer.finished = true;
      peer.finishTime = payload.finishTime;
      peer.score = payload.score;
      peer.state = 'FINISHED';
      peer.ready = false;
      this.callbacks.onPeerFinish?.(peer);
      this.emitRoomUpdate();
    }
  }

  resolveColorConflict() {
    // Earlier joinedAt (or lexicographically smaller ID) wins tie-break
    const takenByOlder = new Set();
    for (const peer of this.peers.values()) {
      const peerHasPriority =
        peer.joinedAt < this.joinedAt ||
        (peer.joinedAt === this.joinedAt && peer.id < this.localId);
      if (peerHasPriority) {
        takenByOlder.add(peer.color);
      }
    }

    if (takenByOlder.has(this.localColor)) {
      const takenAll = new Set([...this.peers.values()].map((p) => p.color));
      const free = BIKE_COLOR_ORDER.find((c) => !takenAll.has(c));
      if (free && free !== this.localColor) {
        this.localColor = free;
        this.sendHello();
        return true;
      }
    }
    return false;
  }

  isColorTaken(colorId) {
    for (const peer of this.peers.values()) {
      if (peer.color === colorId) return true;
    }
    return false;
  }

  selectColor(colorId) {
    this.markActivity();
    if (this.isColorTaken(colorId)) return false;
    this.localColor = colorId;
    this.sendHello();
    this.emitRoomUpdate();
    return true;
  }

  setTrackLength(lengthId) {
    this.markActivity();
    this.lengthId = lengthId;
    this.lastLengthUpdate = Date.now();
    this.broadcast('length_change', { lengthId });
  }

  setLocalState(state) {
    this.markActivity();
    this.localState = state;
    if (state === 'LOBBY') {
      this.localReady = false;
    }
    if (!this.isSleeping) {
      this.sendHello();
    }
  }

  setReady(ready) {
    this.markActivity();
    this.localReady = Boolean(ready);
    this.broadcast('ready_change', {
      ready: this.localReady,
      state: this.localState,
    });
    this.sendHello();
    this.emitRoomUpdate();
  }

  sendHello() {
    if (this.isSleeping) return;
    this.broadcast('hello', {
      joinedAt: this.joinedAt,
      color: this.localColor,
      state: this.localState,
      ready: this.localReady,
      lengthId: this.lengthId,
      lengthUpdatedAt: this.lastLengthUpdate || 0,
    });
  }

  sendLatencyPing() {
    if (this.isSleeping) return;
    this.broadcast('ping', { pingTs: performance.now() });
  }

  startRace(seed, lengthId) {
    this.markActivity();
    this.localReady = false;
    this.localState = 'COUNTDOWN';
    this.lengthId = lengthId;
    for (const p of this.peers.values()) {
      p.ready = false;
      p.finished = false;
      p.finishTime = null;
      p.coins = 0;
      p.jumpY = 0;
      p.state = 'COUNTDOWN';
    }
    this.broadcast('race_start', {
      seed,
      lengthId,
      starterId: this.localId,
      startAt: Date.now(),
    });
  }

  sendRaceState(state) {
    if (this.isSleeping) return;
    this.broadcast('race_state', state);
  }

  sendFinish(finishTime, score) {
    this.localState = 'FINISHED';
    this.localReady = false;
    this.broadcast('race_finish', { finishTime, score });
  }

  getPlayersSnapshot() {
    const list = [
      {
        id: this.localId,
        isLocal: true,
        color: this.localColor,
        state: this.localState,
        ready: this.localReady,
        finished: this.localState === 'FINISHED',
        joinedAt: this.joinedAt,
      },
    ];
    for (const peer of this.peers.values()) {
      list.push({
        id: peer.id,
        isLocal: false,
        color: peer.color,
        state: peer.state,
        ready: Boolean(peer.ready),
        finished: Boolean(peer.finished),
        joinedAt: peer.joinedAt,
      });
    }
    list.sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
    return list;
  }

  emitRoomUpdate() {
    this.callbacks.onRoomUpdate?.(this.getPlayersSnapshot());
  }

  destroy() {
    this.destroyed = true;
    this.handleUnload();
    clearInterval(this.heartbeatTimer);
    clearInterval(this.pruneTimer);
    clearTimeout(this.fallbackTimer);
    window.removeEventListener('pointerdown', this.markActivity);
    window.removeEventListener('pointermove', this.markActivity);
    window.removeEventListener('touchstart', this.markActivity);
    window.removeEventListener('keydown', this.markActivity);
    window.removeEventListener('beforeunload', this.handleUnload);
    window.removeEventListener('pagehide', this.handlePageHide);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.closeAllRtc();
    try {
      this.bc?.close();
    } catch {
      // ignore
    }
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    try {
      this.mqttClient?.end(true);
    } catch {
      // ignore
    }
  }
}
