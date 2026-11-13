import mqtt from 'mqtt';
import { BIKE_COLOR_ORDER } from './bike.js';

const TOPIC = 'jonasrace/v1/room/default';
const MQTT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];
const MAX_PLAYERS = 4;

export class MultiplayerManager {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.localId = `jr_${Math.random().toString(36).slice(2, 9)}`;
    this.joinedAt = Date.now();
    this.localColor = 'red';
    this.lengthId = 'medium';
    this.localState = 'LOBBY';

    // Map<peerId, PeerInfo>
    this.peers = new Map();
    this.seenMsgs = new Map();
    this.msgCounter = 0;

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

    // Send hello right away and every 2 seconds
    this.sendHello();
    this.heartbeatTimer = setInterval(() => {
      this.sendHello();
    }, 2000);

    // Prune timed-out peers
    this.pruneTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, peer] of this.peers.entries()) {
        if (now - peer.lastSeen > 8000) {
          this.peers.delete(id);
          changed = true;
        }
      }
      if (changed) {
        this.emitRoomUpdate();
      }
    }, 1500);

    window.addEventListener('beforeunload', this.handleUnload);
  }

  handleUnload = () => {
    this.broadcast('bye', {});
  };

  initBroadcastChannel() {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      this.bc = new BroadcastChannel('jonas-race-room-v1');
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
        this.sendHello();
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
          this.sendHello();
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

  broadcast(type, payload) {
    const envelope = {
      id: `${this.localId}_${++this.msgCounter}`,
      from: this.localId,
      ts: Date.now(),
      type,
      payload,
    };
    const serialized = JSON.stringify(envelope);

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
      if (this.peers.delete(from)) {
        this.emitRoomUpdate();
      }
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
        d: 0,
        lateral: 0,
        speed: 0,
        lean: 0,
        score: 0,
        finished: false,
        finishTime: null,
        lastSeen: now,
      };
      this.peers.set(from, peer);
    }

    if (!peer) return;
    peer.lastSeen = now;

    if (type === 'hello') {
      const prevColor = peer.color;
      const prevState = peer.state;
      peer.joinedAt = payload.joinedAt ?? peer.joinedAt;
      peer.color = payload.color ?? peer.color;
      peer.state = payload.state ?? peer.state;

      if (payload.lengthId && payload.lengthId !== this.lengthId && this.localState === 'LOBBY') {
        // Keep shared length synchronized when joining an active lobby
        if (payload.lengthUpdatedAt && payload.lengthUpdatedAt > (this.lastLengthUpdate || 0)) {
          this.lengthId = payload.lengthId;
          this.lastLengthUpdate = payload.lengthUpdatedAt;
          this.callbacks.onLengthChange?.(this.lengthId);
        }
      }

      if (added || this.resolveColorConflict() || prevColor !== peer.color || prevState !== peer.state) {
        this.emitRoomUpdate();
      }
    } else if (type === 'length_change') {
      if (payload.lengthId && payload.lengthId !== this.lengthId) {
        this.lengthId = payload.lengthId;
        this.lastLengthUpdate = msg.ts;
        this.callbacks.onLengthChange?.(this.lengthId);
      }
    } else if (type === 'race_start') {
      if (payload.lengthId) {
        this.lengthId = payload.lengthId;
        this.callbacks.onLengthChange?.(this.lengthId);
      }
      this.callbacks.onRaceStart?.(payload);
    } else if (type === 'race_state') {
      peer.d = payload.d;
      peer.lateral = payload.lateral;
      peer.speed = payload.speed;
      peer.lean = payload.lean;
      peer.score = payload.score;
      peer.turbo = !!payload.turbo;
      peer.finished = !!payload.finished;
      peer.finishTime = payload.finishTime ?? peer.finishTime;
      if (peer.finished) peer.state = 'FINISHED';
      else peer.state = 'RACING';
    } else if (type === 'race_finish') {
      peer.finished = true;
      peer.finishTime = payload.finishTime;
      peer.score = payload.score;
      peer.state = 'FINISHED';
      this.callbacks.onPeerFinish?.(peer);
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
    if (this.isColorTaken(colorId)) return false;
    this.localColor = colorId;
    this.sendHello();
    this.emitRoomUpdate();
    return true;
  }

  setTrackLength(lengthId) {
    this.lengthId = lengthId;
    this.lastLengthUpdate = Date.now();
    this.broadcast('length_change', { lengthId });
  }

  setLocalState(state) {
    this.localState = state;
    this.sendHello();
  }

  sendHello() {
    this.broadcast('hello', {
      joinedAt: this.joinedAt,
      color: this.localColor,
      state: this.localState,
      lengthId: this.lengthId,
      lengthUpdatedAt: this.lastLengthUpdate || 0,
    });
  }

  startRace(seed, lengthId) {
    this.localState = 'COUNTDOWN';
    this.lengthId = lengthId;
    this.broadcast('race_start', {
      seed,
      lengthId,
      starterId: this.localId,
      startAt: Date.now(),
    });
  }

  sendRaceState(state) {
    this.broadcast('race_state', state);
  }

  sendFinish(finishTime, score) {
    this.localState = 'FINISHED';
    this.broadcast('race_finish', { finishTime, score });
  }

  getPlayersSnapshot() {
    const list = [
      {
        id: this.localId,
        isLocal: true,
        color: this.localColor,
        state: this.localState,
        joinedAt: this.joinedAt,
      },
    ];
    for (const peer of this.peers.values()) {
      list.push({
        id: peer.id,
        isLocal: false,
        color: peer.color,
        state: peer.state,
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
    window.removeEventListener('beforeunload', this.handleUnload);
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
