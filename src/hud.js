import { BIKE_COLORS } from './bike.js';

export class RaceHUD {
  constructor() {
    this.scoreEl = document.getElementById('hud-score');
    this.coinsEl = document.getElementById('hud-coins');
    this.speedEl = document.getElementById('hud-speed');
    this.placeEl = document.getElementById('hud-place');
    this.minimapCanvas = document.getElementById('minimap');
    this.minimapCtx = this.minimapCanvas.getContext('2d');
    this.tachoCanvas = document.getElementById('tachometer');
    this.tachoCtx = this.tachoCanvas.getContext('2d');

    this.lastScoreText = '';
    this.lastCoinsText = '';
    this.lastSpeedText = '';
    this.lastPlaceText = '';
    this.normalizedPath = [];
    this.needleRatio = 0;
  }

  setTrackPath(points2D) {
    if (!points2D || points2D.length < 2) {
      this.normalizedPath = [];
      return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const pt of points2D) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.z < minZ) minZ = pt.z;
      if (pt.z > maxZ) maxZ = pt.z;
    }

    const spanX = Math.max(10, maxX - minX);
    const spanZ = Math.max(10, maxZ - minZ);
    const maxSpan = Math.max(spanX, spanZ);
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;

    // Normalize into [-1, 1] keeping aspect ratio, with start near bottom and finish near top
    this.normalizedPath = points2D.map((pt) => ({
      x: (pt.x - cx) / (maxSpan * 0.5),
      y: (pt.z - cz) / (maxSpan * 0.5),
    }));
  }

  update({ raceTime = 0, coins = 0, speedKmh, place, totalPlayers, progressPct, riders, dt }) {
    const timeStr = `${raceTime.toFixed(1)}s`;
    if (timeStr !== this.lastScoreText) {
      this.scoreEl.textContent = timeStr;
      this.lastScoreText = timeStr;
    }

    if (this.coinsEl) {
      const coinsStr = `Mince: ${coins} (+${coins} km/h)`;
      if (coinsStr !== this.lastCoinsText) {
        this.coinsEl.textContent = coinsStr;
        this.lastCoinsText = coinsStr;
      }
    }

    const speedStr = String(Math.round(speedKmh));
    if (speedStr !== this.lastSpeedText) {
      this.speedEl.textContent = speedStr;
      this.lastSpeedText = speedStr;
    }

    const pct = Math.max(0, Math.min(100, Math.round(progressPct)));
    const placeStr = totalPlayers > 1
      ? `${place}. / ${totalPlayers} • ${pct} %`
      : `Trénink • ${pct} %`;
    if (placeStr !== this.lastPlaceText) {
      this.placeEl.textContent = placeStr;
      this.lastPlaceText = placeStr;
    }

    this.drawMinimap(riders);
    this.drawTachometer(speedKmh, dt);
  }

  drawMinimap(riders) {
    const canvas = this.minimapCanvas;
    const ctx = this.minimapCtx;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const radius = Math.min(w, h) * 0.5 - 5;

    ctx.clearRect(0, 0, w, h);

    // Circular translucent navy backdrop
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 22, 52, 0.78)';
    ctx.fill();
    ctx.clip();

    const path = this.normalizedPath;
    if (path.length >= 2) {
      const drawRadius = radius * 0.72;
      const toScreen = (p) => ({
        x: cx + p.x * drawRadius,
        y: cy + p.y * drawRadius,
      });

      // Outer dark track outline
      ctx.beginPath();
      path.forEach((pt, idx) => {
        const s = toScreen(pt);
        if (idx === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.lineWidth = 8.5;
      ctx.stroke();

      // White track centerline
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 5;
      ctx.stroke();

      // Checkered finish marker at end of path
      const endPt = toScreen(path[path.length - 1]);
      ctx.save();
      ctx.translate(endPt.x, endPt.y);
      const cell = 3.5;
      for (let r = -1; r <= 1; r++) {
        for (let c = -1; c <= 1; c++) {
          ctx.fillStyle = (r + c) % 2 === 0 ? '#ffffff' : '#111111';
          ctx.fillRect(c * cell - cell * 0.5, r * cell - cell * 0.5, cell, cell);
        }
      }
      ctx.restore();

      // Draw riders sorted so local player is rendered on top
      const sorted = [...riders].sort((a, b) => (a.isLocal ? 1 : 0) - (b.isLocal ? 1 : 0));
      for (const r of sorted) {
        const normT = Math.max(0, Math.min(1, r.progress));
        const idxFloat = normT * (path.length - 1);
        const i0 = Math.floor(idxFloat);
        const i1 = Math.min(path.length - 1, i0 + 1);
        const f = idxFloat - i0;
        const p0 = toScreen(path[i0]);
        const p1 = toScreen(path[i1]);
        const rx = p0.x + (p1.x - p0.x) * f;
        const ry = p0.y + (p1.y - p0.y) * f;

        const colorHex = (BIKE_COLORS[r.color] || BIKE_COLORS.red).hex;
        ctx.beginPath();
        ctx.arc(rx, ry, r.isLocal ? 6.8 : 5.2, 0, Math.PI * 2);
        ctx.fillStyle = colorHex;
        ctx.fill();
        ctx.lineWidth = r.isLocal ? 2.4 : 1.6;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
    }

    ctx.restore();

    // Metallic bezel ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#e2e9f7';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, radius - 2.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  drawTachometer(speedKmh, dt) {
    const canvas = this.tachoCanvas;
    const ctx = this.tachoCtx;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const radius = Math.min(w, h) * 0.5 - 5;

    const targetRatio = Math.max(0, Math.min(1, speedKmh / 260));
    const smooth = Math.min(1, (dt || 0.016) * 10);
    this.needleRatio += (targetRatio - this.needleRatio) * smooth;

    ctx.clearRect(0, 0, w, h);

    // Dial background
    const grad = ctx.createRadialGradient(cx, cy, 8, cx, cy, radius);
    grad.addColorStop(0, '#1e2f59');
    grad.addColorStop(0.72, '#0c1630');
    grad.addColorStop(1, '#050a18');

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Outer chrome/gold rim
    ctx.strokeStyle = '#d5dfef';
    ctx.lineWidth = 4;
    ctx.stroke();

    const startAngle = Math.PI * 0.75;
    const endAngle = Math.PI * 2.25;
    const totalArc = endAngle - startAngle;

    // Colored gauge zones matching reference image
    const zones = [
      { from: 0.0, to: 0.22, color: '#2499ff' },
      { from: 0.22, to: 0.58, color: '#39d353' },
      { from: 0.58, to: 0.80, color: '#ffd426' },
      { from: 0.80, to: 1.0, color: '#ff332b' },
    ];

    const arcRadius = radius - 12;
    for (const z of zones) {
      ctx.beginPath();
      ctx.arc(
        cx,
        cy,
        arcRadius,
        startAngle + z.from * totalArc,
        startAngle + z.to * totalArc,
      );
      ctx.strokeStyle = z.color;
      ctx.lineWidth = 11;
      ctx.lineCap = 'butt';
      ctx.stroke();
    }

    // Tick marks around dial
    const majorTicks = 6;
    for (let i = 0; i <= majorTicks * 2; i++) {
      const t = i / (majorTicks * 2);
      const a = startAngle + t * totalArc;
      const isMajor = i % 2 === 0;
      const rIn = radius - (isMajor ? 22 : 17);
      const rOut = radius - 7;

      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn);
      ctx.lineTo(cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = isMajor ? 2.2 : 1.1;
      ctx.stroke();
    }

    // Needle
    const needleAngle = startAngle + this.needleRatio * totalArc;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(needleAngle);

    ctx.shadowColor = 'rgba(255, 45, 32, 0.85)';
    ctx.shadowBlur = 8;

    ctx.beginPath();
    ctx.moveTo(-10, -4);
    ctx.lineTo(radius - 13, 0);
    ctx.lineTo(-10, 4);
    ctx.closePath();
    ctx.fillStyle = '#ff2a22';
    ctx.fill();
    ctx.restore();

    // Center hub cap
    ctx.beginPath();
    ctx.arc(cx, cy, 9.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ff382b';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#d7e0f2';
    ctx.stroke();
  }
}
