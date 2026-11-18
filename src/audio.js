export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineRunning = false;
    this.oscMain = null;
    this.oscSub = null;
    this.engineFilter = null;
    this.engineGain = null;
  }

  unlock() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.engineGain && this.ctx) {
      this.engineGain.gain.setTargetAtTime(muted ? 0 : 0.05, this.ctx.currentTime, 0.05);
    }
  }

  startEngine() {
    this.unlock();
    if (!this.ctx || this.engineRunning) return;

    const now = this.ctx.currentTime;
    this.oscMain = this.ctx.createOscillator();
    this.oscSub = this.ctx.createOscillator();
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineGain = this.ctx.createGain();

    this.oscMain.type = 'sawtooth';
    this.oscMain.frequency.setValueAtTime(65, now);

    this.oscSub.type = 'triangle';
    this.oscSub.frequency.setValueAtTime(130, now);

    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.setValueAtTime(320, now);
    this.engineFilter.Q.setValueAtTime(2.5, now);

    this.engineGain.gain.setValueAtTime(0, now);

    this.oscMain.connect(this.engineFilter);
    this.oscSub.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.ctx.destination);

    this.oscMain.start(now);
    this.oscSub.start(now);
    this.engineRunning = true;
  }

  updateEngine(speedKmh, isThrottling, turboActive) {
    if (!this.ctx || !this.engineRunning || !this.engineGain) return;
    const now = this.ctx.currentTime;

    if (this.muted) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.04);
      return;
    }

    const ratio = Math.max(0, Math.min(1, speedKmh / 240));
    // Simulate subtle sportbike gear shifts by folding pitch across 4 gears
    const gearPos = (ratio * 3.4) % 1;
    const baseFreq = 58 + ratio * 115 + gearPos * 36 + (turboActive ? 42 : 0);

    this.oscMain.frequency.setTargetAtTime(baseFreq, now, 0.06);
    this.oscSub.frequency.setTargetAtTime(baseFreq * 1.98, now, 0.06);
    this.engineFilter.frequency.setTargetAtTime(260 + ratio * 1150 + (turboActive ? 600 : 0), now, 0.06);

    const targetVol = isThrottling || turboActive ? 0.08 + ratio * 0.05 : 0.03 + ratio * 0.02;
    this.engineGain.gain.setTargetAtTime(targetVol, now, 0.08);
  }

  stopEngine() {
    if (!this.engineRunning || !this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      this.engineGain?.gain.setTargetAtTime(0, now, 0.04);
      this.oscMain?.stop(now + 0.08);
      this.oscSub?.stop(now + 0.08);
    } catch {
      // Ignore already stopped oscillators
    }
    this.oscMain = null;
    this.oscSub = null;
    this.engineFilter = null;
    this.engineGain = null;
    this.engineRunning = false;
  }

  playCountdown(isGo) {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = isGo ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(isGo ? 880 : 440, now);
    if (isGo) {
      osc.frequency.exponentialRampToValueAtTime(1175, now + 0.14);
    }

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (isGo ? 0.42 : 0.2));

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + (isGo ? 0.45 : 0.22));
  }

  playCoin() {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const notes = [1046.5, 1318.5];
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const start = now + idx * 0.06;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.16, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(start);
      osc.stop(start + 0.18);
    });
  }

  playTurbo() {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(920, now + 0.35);

    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.42);
  }

  playBump() {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.16);

    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  playSplash() {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.25);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(950, now);
    filter.frequency.exponentialRampToValueAtTime(320, now + 0.24);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    noise.start(now);
  }

  playJump() {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.26);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  playFinish(won) {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const melody = won ? [523.25, 659.25, 783.99, 1046.5] : [440, 523.25, 659.25];
    melody.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const start = now + i * 0.12;
      const dur = i === melody.length - 1 ? 0.48 : 0.18;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.18, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    });
  }
}
