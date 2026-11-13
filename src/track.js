import * as THREE from 'three';

export const TRACK_LENGTHS = {
  short: { id: 'short', label: 'Krátká', approx: '~45 s', meters: 1800 },
  medium: { id: 'medium', label: 'Střední', approx: '~75 s', meters: 3000 },
  long: { id: 'long', label: 'Dlouhá', approx: '~110 s', meters: 4500 },
};

export const ROAD_HALF_WIDTH = 7.5;
export const RIDE_HALF_LIMIT = 6.55;
const STEP_METERS = 12;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createAsphaltTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Base asphalt
  ctx.fillStyle = '#333844';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle asphalt grain
  for (let i = 0; i < 6500; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = 38 + Math.floor(Math.random() * 34);
    ctx.fillStyle = `rgb(${v},${v + 2},${v + 7})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Yellow shoulder lines near edges
  ctx.fillStyle = '#f5c518';
  ctx.fillRect(16, 0, 10, 512);
  ctx.fillRect(486, 0, 10, 512);

  // Outer crisp white edge stripes
  ctx.fillStyle = '#eef2fa';
  ctx.fillRect(30, 0, 6, 512);
  ctx.fillRect(476, 0, 6, 512);

  // Two white dashed lane dividers (3-lane coastal highway)
  ctx.fillStyle = '#f4f7ff';
  const laneX1 = Math.round(512 * 0.345);
  const laneX2 = Math.round(512 * 0.655);
  for (let y = 16; y < 512; y += 128) {
    ctx.fillRect(laneX1 - 5, y, 10, 74);
    ctx.fillRect(laneX2 - 5, y, 10, 74);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createBarrierTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Red and white alternating barrier blocks along V (length of road)
  ctx.fillStyle = '#f5f7fb';
  ctx.fillRect(0, 0, 128, 256);
  ctx.fillStyle = '#e52525';
  ctx.fillRect(0, 0, 128, 128);

  // Subtle vertical shading across U (height of barrier)
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, 0, 24, 256);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(102, 0, 26, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createWaterTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, '#20b6e8');
  grad.addColorStop(0.25, '#0b86d6');
  grad.addColorStop(1, '#0758b0');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  for (let i = 0; i < 42; i++) {
    const x = Math.random() * 230;
    const y = Math.random() * 250;
    ctx.fillRect(x, y, 18 + Math.random() * 24, 3);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createCliffTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, '#3ca338');
  grad.addColorStop(0.28, '#4c9e38');
  grad.addColorStop(0.65, '#8c765a');
  grad.addColorStop(1, '#588c3b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.09)';
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 8 + Math.random() * 14, 6);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createTurboTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#07224d';
  ctx.fillRect(0, 0, 256, 256);

  // Glowing cyan/yellow triple chevrons pointing forward (-Z => top of texture)
  const colors = ['#00f0ff', '#ffd426', '#00f0ff'];
  for (let i = 0; i < 3; i++) {
    const y = 55 + i * 74;
    ctx.beginPath();
    ctx.moveTo(32, y + 48);
    ctx.lineTo(128, y - 24);
    ctx.lineTo(224, y + 48);
    ctx.lineTo(224, y + 74);
    ctx.lineTo(128, y + 4);
    ctx.lineTo(32, y + 74);
    ctx.closePath();
    ctx.fillStyle = colors[i];
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createCheckerTexture(cols = 12, rows = 2) {
  const canvas = document.createElement('canvas');
  canvas.width = cols * 32;
  canvas.height = rows * 32;
  const ctx = canvas.getContext('2d');

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#ffffff' : '#111520';
      ctx.fillRect(c * 32, r * 32, 32, 32);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createGateBannerTexture(text, bgHex) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 512, 128);

  // Checker edge stripes
  for (let c = 0; c < 16; c++) {
    ctx.fillStyle = c % 2 === 0 ? '#ffffff' : '#111111';
    ctx.fillRect(c * 32, 0, 32, 18);
    ctx.fillRect(c * 32, 110, 32, 18);
  }

  ctx.font = '900 58px Arial Black, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffd426';
  ctx.strokeStyle = '#07142e';
  ctx.lineWidth = 8;
  ctx.strokeText(text, 256, 66);
  ctx.fillText(text, 256, 66);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildRibbonGeometry(samples, getSpan, uvScaleV) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const span = getSpan(s, i);
    positions.push(
      span.left.x, span.left.y, span.left.z,
      span.right.x, span.right.y, span.right.z,
    );
    const nx = span.normal ? span.normal.x : 0;
    const ny = span.normal ? span.normal.y : 1;
    const nz = span.normal ? span.normal.z : 0;
    normals.push(nx, ny, nz, nx, ny, nz);

    const v = (s.dist / STEP_METERS) * uvScaleV;
    uvs.push(0, v, 1, v);

    if (i < samples.length - 1) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function createTrack(scene, seed, lengthId = 'medium') {
  const lengthSpec = TRACK_LENGTHS[lengthId] || TRACK_LENGTHS.medium;
  const totalMeters = lengthSpec.meters;
  const segCount = Math.floor(totalMeters / STEP_METERS);
  const rand = mulberry32(seed);

  // Random harmonic waves for distinct scenic coastal curves each race
  const freq1 = 0.0022 + rand() * 0.0014;
  const freq2 = 0.0052 + rand() * 0.0025;
  const freq3 = 0.0095 + rand() * 0.004;
  const ph1 = rand() * Math.PI * 2;
  const ph2 = rand() * Math.PI * 2;
  const ph3 = rand() * Math.PI * 2;
  const amp1 = (0.011 + rand() * 0.006) * (rand() > 0.5 ? 1 : -1);
  const amp2 = (0.007 + rand() * 0.005) * (rand() > 0.5 ? 1 : -1);
  const amp3 = (0.004 + rand() * 0.004) * (rand() > 0.5 ? 1 : -1);

  const hillFreq = 0.003 + rand() * 0.002;
  const hillPh = rand() * Math.PI * 2;

  const samples = [];
  let x = 0;
  let y = 0;
  let z = 0;
  let heading = 0;

  for (let i = 0; i <= segCount; i++) {
    const dist = i * STEP_METERS;
    // Keep start & finish straight for ~60m so starting grid & finish arch look sharp
    const edgeFade = Math.min(1, dist / 72, Math.max(0, (totalMeters - dist) / 72));

    let curvature = 0;
    if (i > 0) {
      const rawCurv =
        amp1 * Math.sin(dist * freq1 + ph1) +
        amp2 * Math.sin(dist * freq2 + ph2) +
        amp3 * Math.cos(dist * freq3 + ph3);
      curvature = rawCurv * edgeFade;
      // Gentle restoring spring keeps track flowing forward without self-intersection
      heading += curvature * STEP_METERS - heading * 0.045;
      heading = Math.max(-1.12, Math.min(1.12, heading));

      x += Math.sin(heading) * STEP_METERS;
      z -= Math.cos(heading) * STEP_METERS;
      const nextY = (Math.sin(dist * hillFreq + hillPh) + 1) * 3.8 * edgeFade;
      y = nextY;
    }

    samples.push({
      dist,
      pos: new THREE.Vector3(x, y, z),
      heading,
      curvature,
      tangent: new THREE.Vector3(),
      right: new THREE.Vector3(),
      hillFactor: 0.5 + 0.5 * Math.sin(dist * 0.015 + ph1),
    });
  }

  // Compute consistent tangent & right vectors
  const worldUp = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < samples.length; i++) {
    const prev = samples[Math.max(0, i - 1)].pos;
    const next = samples[Math.min(samples.length - 1, i + 1)].pos;
    samples[i].tangent.subVectors(next, prev).normalize();
    samples[i].right.crossVectors(samples[i].tangent, worldUp).normalize();
  }

  const group = new THREE.Group();
  const disposables = [];
  const register = (obj) => {
    disposables.push(obj);
    return obj;
  };

  // 1. Road mesh
  const asphaltTex = register(createAsphaltTexture());
  const roadGeo = register(buildRibbonGeometry(
    samples,
    (s) => ({
      left: s.pos.clone().addScaledVector(s.right, -ROAD_HALF_WIDTH),
      right: s.pos.clone().addScaledVector(s.right, ROAD_HALF_WIDTH),
    }),
    0.55,
  ));
  const roadMat = register(new THREE.MeshStandardMaterial({
    map: asphaltTex,
    roughness: 0.78,
    metalness: 0.05,
    side: THREE.DoubleSide,
  }));
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  group.add(roadMesh);

  // 2. Red-and-white guardrails on left and right
  const barrierTex = register(createBarrierTexture());
  const barrierMat = register(new THREE.MeshStandardMaterial({
    map: barrierTex,
    roughness: 0.45,
    metalness: 0.1,
    side: THREE.DoubleSide,
  }));

  [-1, 1].forEach((side) => {
    const offset = side * (ROAD_HALF_WIDTH + 0.35);
    const barrierGeo = register(buildRibbonGeometry(
      samples,
      (s) => {
        const base = s.pos.clone().addScaledVector(s.right, offset);
        const top = base.clone().add(new THREE.Vector3(0, 0.92, 0));
        return side < 0 ? { left: top, right: base } : { left: base, right: top };
      },
      1.8,
    ));
    group.add(new THREE.Mesh(barrierGeo, barrierMat));

    // Top cap of barrier
    const capGeo = register(buildRibbonGeometry(
      samples,
      (s) => {
        const inner = s.pos.clone().addScaledVector(s.right, offset).add(new THREE.Vector3(0, 0.92, 0));
        const outer = inner.clone().addScaledVector(s.right, side * 0.45);
        return side < 0 ? { left: outer, right: inner } : { left: inner, right: outer };
      },
      1.8,
    ));
    group.add(new THREE.Mesh(capGeo, barrierMat));
  });

  // 3. Left coastal rocky hills & green shoulder
  const cliffTex = register(createCliffTexture());
  const cliffMat = register(new THREE.MeshStandardMaterial({
    map: cliffTex,
    roughness: 0.92,
    side: THREE.DoubleSide,
  }));
  const cliffGeo = register(buildRibbonGeometry(
    samples,
    (s) => {
      const inner = s.pos.clone().addScaledVector(s.right, -(ROAD_HALF_WIDTH + 0.6));
      const outer = s.pos
        .clone()
        .addScaledVector(s.right, -58)
        .add(new THREE.Vector3(0, 18 + s.hillFactor * 22, 0));
      return { left: outer, right: inner };
    },
    0.25,
  ));
  group.add(new THREE.Mesh(cliffGeo, cliffMat));

  // Sandy coastal slope on the right dipping cleanly below sea level
  const shoulderGeo = register(buildRibbonGeometry(
    samples,
    (s) => {
      const inner = s.pos.clone().addScaledVector(s.right, ROAD_HALF_WIDTH + 0.6);
      const outer = s.pos.clone().addScaledVector(s.right, ROAD_HALF_WIDTH + 9.5);
      outer.y = -2.6;
      return { left: inner, right: outer };
    },
    0.35,
  ));
  const shoulderMat = register(new THREE.MeshStandardMaterial({
    color: 0xd8c37c,
    roughness: 0.95,
    side: THREE.DoubleSide,
  }));
  group.add(new THREE.Mesh(shoulderGeo, shoulderMat));

  // 4. Sparkling Blue Ocean on the right + wide ocean horizon base
  const waterTex = register(createWaterTexture());
  waterTex.repeat.set(3, 1);
  const seaGeo = register(buildRibbonGeometry(
    samples,
    (s) => {
      const inner = new THREE.Vector3(
        s.pos.x + s.right.x * (ROAD_HALF_WIDTH + 4),
        -1.5,
        s.pos.z + s.right.z * (ROAD_HALF_WIDTH + 4),
      );
      const outer = new THREE.Vector3(
        s.pos.x + s.right.x * 360,
        -1.5,
        s.pos.z + s.right.z * 360,
      );
      return { left: inner, right: outer };
    },
    0.28,
  ));
  const seaMat = register(new THREE.MeshStandardMaterial({
    map: waterTex,
    roughness: 0.25,
    metalness: 0.25,
    side: THREE.DoubleSide,
  }));
  group.add(new THREE.Mesh(seaGeo, seaMat));

  const oceanBaseGeo = register(new THREE.PlaneGeometry(8000, 12000));
  oceanBaseGeo.rotateX(-Math.PI / 2);
  const oceanBaseMat = register(new THREE.MeshBasicMaterial({ color: 0x0758b0 }));
  const oceanBase = new THREE.Mesh(oceanBaseGeo, oceanBaseMat);
  oceanBase.position.set(0, -1.65, -totalMeters * 0.5);
  group.add(oceanBase);

  // 5. Instanced Palm Trees on left & right coasts
  const palmPlacements = [];
  for (let i = 2; i < samples.length - 3; i += 2) {
    const s = samples[i];
    // Left palm
    if (rand() > 0.22) {
      const lat = -(ROAD_HALF_WIDTH + 2.5 + rand() * 7.5);
      const pos = s.pos.clone().addScaledVector(s.right, lat);
      pos.y += Math.max(0, (-lat - ROAD_HALF_WIDTH - 1.5) * 0.28);
      palmPlacements.push({ pos, scale: 0.85 + rand() * 0.5, rot: rand() * Math.PI * 2 });
    }
    // Right palm near beach
    if (rand() > 0.58) {
      const lat = ROAD_HALF_WIDTH + 2.4 + rand() * 2.2;
      const pos = s.pos.clone().addScaledVector(s.right, lat);
      pos.y -= 0.4;
      palmPlacements.push({ pos, scale: 0.8 + rand() * 0.42, rot: rand() * Math.PI * 2 });
    }
  }

  if (palmPlacements.length > 0) {
    const trunkGeo = register(new THREE.CylinderGeometry(0.18, 0.34, 6.2, 7));
    trunkGeo.translate(0, 3.1, 0);
    const trunkMat = register(new THREE.MeshStandardMaterial({ color: 0x7c5338, roughness: 0.9 }));
    const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, palmPlacements.length);

    const crownGeo = register(new THREE.ConeGeometry(2.6, 1.8, 7));
    crownGeo.translate(0, 6.1, 0);
    const crownMat = register(new THREE.MeshStandardMaterial({ color: 0x26a637, roughness: 0.7 }));
    const crownInst = new THREE.InstancedMesh(crownGeo, crownMat, palmPlacements.length);

    const dummy = new THREE.Object3D();
    palmPlacements.forEach((p, idx) => {
      dummy.position.copy(p.pos);
      dummy.rotation.set(0, p.rot, (rand() - 0.5) * 0.14);
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(idx, dummy.matrix);
      crownInst.setMatrixAt(idx, dummy.matrix);
    });
    trunkInst.instanceMatrix.needsUpdate = true;
    crownInst.instanceMatrix.needsUpdate = true;
    group.add(trunkInst, crownInst);
  }

  // Helper to sample track frame at arbitrary distance
  function sampleAt(distance) {
    const clamped = Math.max(0, Math.min(totalMeters, distance));
    const idxFloat = clamped / STEP_METERS;
    const i0 = Math.min(samples.length - 1, Math.floor(idxFloat));
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const t = idxFloat - i0;

    const s0 = samples[i0];
    const s1 = samples[i1];

    const pos = new THREE.Vector3().lerpVectors(s0.pos, s1.pos, t);
    const tangent = new THREE.Vector3().lerpVectors(s0.tangent, s1.tangent, t).normalize();
    const right = new THREE.Vector3().lerpVectors(s0.right, s1.right, t).normalize();
    const curvature = s0.curvature + (s1.curvature - s0.curvature) * t;
    const yaw = Math.atan2(-tangent.x, -tangent.z);

    return { pos, tangent, right, curvature, yaw };
  }

  // 6. Start & Finish gates + checkered lines
  const checkerTex = register(createCheckerTexture(14, 2));
  const checkerMat = register(new THREE.MeshBasicMaterial({ map: checkerTex, side: THREE.DoubleSide }));
  const pillarMat = register(new THREE.MeshStandardMaterial({ color: 0xe6eaf4, roughness: 0.35 }));

  const addGate = (dist, label, bgHex) => {
    const frame = sampleAt(dist);
    const gate = new THREE.Group();
    gate.position.copy(frame.pos);
    gate.rotation.y = frame.yaw;

    // Road checkered strip
    const stripGeo = register(new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 2, 2.2));
    stripGeo.rotateX(-Math.PI / 2);
    const strip = new THREE.Mesh(stripGeo, checkerMat);
    strip.position.y = 0.04;
    gate.add(strip);

    // Side pillars
    [-ROAD_HALF_WIDTH - 0.5, ROAD_HALF_WIDTH + 0.5].forEach((px) => {
      const pillarGeo = register(new THREE.CylinderGeometry(0.28, 0.32, 6.0, 10));
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(px, 3.0, 0);
      gate.add(pillar);
    });

    // Overhead banner
    const bannerTex = register(createGateBannerTexture(label, bgHex));
    const bannerMat = register(new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide }));
    const bannerGeo = register(new THREE.BoxGeometry(ROAD_HALF_WIDTH * 2 + 1.4, 1.85, 0.45));
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    banner.position.set(0, 5.4, 0);
    gate.add(banner);

    group.add(gate);
  };

  addGate(12, 'START', '#0e368c');
  addGate(totalMeters, 'CÍL', '#0b6b2b');

  // 7. Track Gameplay Items (turbo pads, coins, cones, puddles)
  const items = [];
  const itemRand = mulberry32((seed ^ 0x9e3779b9) >>> 0);

  const turboTex = register(createTurboTexture());
  const turboGeo = register(new THREE.PlaneGeometry(2.7, 7.2));
  turboGeo.rotateX(-Math.PI / 2);
  const turboMat = register(new THREE.MeshBasicMaterial({
    map: turboTex,
    transparent: true,
    opacity: 0.96,
    side: THREE.DoubleSide,
  }));

  const coinGeo = register(new THREE.CylinderGeometry(0.65, 0.65, 0.16, 16));
  coinGeo.rotateX(Math.PI / 2);
  const coinMat = register(new THREE.MeshStandardMaterial({
    color: 0xffd426,
    emissive: 0xaa6c00,
    emissiveIntensity: 0.45,
    metalness: 0.75,
    roughness: 0.2,
  }));

  const coneGeo = register(new THREE.ConeGeometry(0.45, 1.0, 12));
  const coneMat = register(new THREE.MeshStandardMaterial({
    color: 0xff6200,
    roughness: 0.45,
  }));
  const coneStripeGeo = register(new THREE.CylinderGeometry(0.23, 0.31, 0.24, 12));
  const coneStripeMat = register(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));

  const puddleGeo = register(new THREE.CircleGeometry(1.45, 18));
  puddleGeo.rotateX(-Math.PI / 2);
  puddleGeo.scale(1.0, 1.0, 1.65);
  const puddleMat = register(new THREE.MeshStandardMaterial({
    color: 0x0c66c2,
    emissive: 0x06244f,
    roughness: 0.08,
    metalness: 0.85,
    transparent: true,
    opacity: 0.85,
  }));

  const lanes = [-4.2, 0, 4.2];
  let d = 95;
  while (d < totalMeters - 110) {
    const roll = itemRand();
    const lane = lanes[Math.floor(itemRand() * lanes.length)] + (itemRand() - 0.5) * 1.1;

    if (roll < 0.22) {
      // Turbo pad
      const frame = sampleAt(d);
      const mesh = new THREE.Mesh(turboGeo, turboMat);
      mesh.position.copy(frame.pos).addScaledVector(frame.right, lane);
      mesh.position.y += 0.05;
      mesh.rotation.y = frame.yaw;
      group.add(mesh);
      items.push({ type: 'turbo', dist: d, lateral: lane, radiusLat: 1.7, radiusDist: 4.0, mesh, cooldown: 0 });
      d += 65 + itemRand() * 35;
    } else if (roll < 0.68) {
      // Line of 3 golden coins
      const coinLineLane = lane;
      for (let k = 0; k < 3; k++) {
        const cd = d + k * 11;
        if (cd >= totalMeters - 90) break;
        const frame = sampleAt(cd);
        const mesh = new THREE.Mesh(coinGeo, coinMat);
        mesh.position.copy(frame.pos).addScaledVector(frame.right, coinLineLane);
        mesh.position.y += 0.95;
        mesh.rotation.y = frame.yaw;
        group.add(mesh);
        items.push({ type: 'coin', dist: cd, lateral: coinLineLane, radiusLat: 1.55, radiusDist: 2.5, mesh, collected: false });
      }
      d += 55 + itemRand() * 30;
    } else if (roll < 0.86) {
      // Traffic cone obstacle (leaves 2 other lanes completely free)
      const frame = sampleAt(d);
      const coneGroup = new THREE.Group();
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.y = 0.5;
      const stripe = new THREE.Mesh(coneStripeGeo, coneStripeMat);
      stripe.position.y = 0.48;
      coneGroup.add(cone, stripe);
      coneGroup.position.copy(frame.pos).addScaledVector(frame.right, lane);
      coneGroup.rotation.y = frame.yaw;
      group.add(coneGroup);
      items.push({ type: 'cone', dist: d, lateral: lane, radiusLat: 1.1, radiusDist: 1.8, mesh: coneGroup, hit: false });
      d += 52 + itemRand() * 32;
    } else {
      // Water puddle obstacle
      const frame = sampleAt(d);
      const mesh = new THREE.Mesh(puddleGeo, puddleMat);
      mesh.position.copy(frame.pos).addScaledVector(frame.right, lane);
      mesh.position.y += 0.04;
      mesh.rotation.y = frame.yaw;
      group.add(mesh);
      items.push({ type: 'puddle', dist: d, lateral: lane, radiusLat: 1.75, radiusDist: 2.6, mesh, cooldown: 0 });
      d += 56 + itemRand() * 34;
    }
  }

  scene.add(group);

  // Minimap 2D path (downsampled cleanly)
  const minimapPoints = [];
  const stepMap = Math.max(1, Math.floor(samples.length / 80));
  for (let i = 0; i < samples.length; i += stepMap) {
    minimapPoints.push({ x: samples[i].pos.x, z: samples[i].pos.z });
  }
  const lastSample = samples[samples.length - 1];
  minimapPoints.push({ x: lastSample.pos.x, z: lastSample.pos.z });

  return {
    totalMeters,
    lengthId,
    minimapPoints,
    items,
    sampleAt,
    update(dt, timeSec) {
      // Subtle animated ocean waves & spinning coins
      waterTex.offset.y -= dt * 0.14;
      waterTex.offset.x += dt * 0.04;
      for (const item of items) {
        if (item.type === 'coin' && !item.collected) {
          item.mesh.rotation.y = timeSec * 3.0 + item.dist * 0.1;
          item.mesh.position.y = sampleAt(item.dist).pos.y + 0.95 + Math.sin(timeSec * 4 + item.dist) * 0.12;
        }
        if (item.cooldown > 0) {
          item.cooldown = Math.max(0, item.cooldown - dt);
        }
      }
    },
    resetItems() {
      for (const item of items) {
        item.collected = false;
        item.hit = false;
        item.cooldown = 0;
        item.mesh.visible = true;
      }
    },
    dispose() {
      scene.remove(group);
      for (const dItem of disposables) {
        if (typeof dItem.dispose === 'function') {
          dItem.dispose();
        }
      }
    },
  };
}
