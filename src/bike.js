import * as THREE from 'three';

export const BIKE_COLORS = {
  red: {
    id: 'red',
    label: 'Červená',
    riderLabel: 'Červený jezdec',
    hex: '#e62b2b',
    num: 0xe62b2b,
    dark: 0x7c1010,
  },
  blue: {
    id: 'blue',
    label: 'Modrá',
    riderLabel: 'Modrý jezdec',
    hex: '#1e78ff',
    num: 0x1e78ff,
    dark: 0x0b3982,
  },
  green: {
    id: 'green',
    label: 'Zelená',
    riderLabel: 'Zelený jezdec',
    hex: '#24c445',
    num: 0x24c445,
    dark: 0x0d5e1e,
  },
  yellow: {
    id: 'yellow',
    label: 'Žlutá',
    riderLabel: 'Žlutý jezdec',
    hex: '#ffbe0b',
    num: 0xffbe0b,
    dark: 0x996b00,
  },
};

export const BIKE_COLOR_ORDER = ['red', 'blue', 'green', 'yellow'];

export function createBikeMesh(colorId, isLocalPlayer = false) {
  const palette = BIKE_COLORS[colorId] || BIKE_COLORS.red;

  const group = new THREE.Group();
  const leanGroup = new THREE.Group();
  group.add(leanGroup);

  // Materials
  const paintMat = new THREE.MeshStandardMaterial({
    color: palette.num,
    roughness: 0.25,
    metalness: 0.35,
  });
  const whiteMat = new THREE.MeshStandardMaterial({
    color: 0xf4f6fa,
    roughness: 0.4,
    metalness: 0.1,
  });
  const darkSuitMat = new THREE.MeshStandardMaterial({
    color: 0x1b202b,
    roughness: 0.65,
    metalness: 0.1,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x161920,
    roughness: 0.85,
    metalness: 0.05,
  });
  const metalMat = new THREE.MeshStandardMaterial({
    color: 0xb8c2d1,
    roughness: 0.3,
    metalness: 0.85,
  });
  const darkMetalMat = new THREE.MeshStandardMaterial({
    color: 0x2d3340,
    roughness: 0.45,
    metalness: 0.7,
  });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x0d1522,
    roughness: 0.1,
    metalness: 0.9,
  });
  const tailLightMat = new THREE.MeshStandardMaterial({
    color: 0xff2222,
    emissive: 0xff1111,
    emissiveIntensity: 1.4,
    roughness: 0.2,
  });

  // Soft contact shadow on road
  const shadowGeo = new THREE.CircleGeometry(0.95, 20);
  shadowGeo.rotateX(-Math.PI / 2);
  shadowGeo.scale(0.8, 1, 1.85);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x050812,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.position.set(0, 0.025, 0);
  group.add(shadow);

  // Rear wheel (wide racing slick like in the reference image)
  const rearWheel = new THREE.Group();
  rearWheel.position.set(0, 0.36, 0.78);
  const rearTireGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.34, 24);
  rearTireGeo.rotateZ(Math.PI / 2);
  const rearTire = new THREE.Mesh(rearTireGeo, tireMat);
  rearWheel.add(rearTire);
  const rearRimGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.35, 16);
  rearRimGeo.rotateZ(Math.PI / 2);
  const rearRim = new THREE.Mesh(rearRimGeo, darkMetalMat);
  rearWheel.add(rearRim);
  leanGroup.add(rearWheel);

  // Front wheel
  const frontWheel = new THREE.Group();
  frontWheel.position.set(0, 0.34, -0.82);
  const frontTireGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.2, 24);
  frontTireGeo.rotateZ(Math.PI / 2);
  const frontTire = new THREE.Mesh(frontTireGeo, tireMat);
  frontWheel.add(frontTire);
  const frontRimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.21, 16);
  frontRimGeo.rotateZ(Math.PI / 2);
  const frontRim = new THREE.Mesh(frontRimGeo, darkMetalMat);
  frontWheel.add(frontRim);
  leanGroup.add(frontWheel);

  // Chassis & Engine core
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 1.15), darkMetalMat);
  chassis.position.set(0, 0.56, 0.05);
  leanGroup.add(chassis);

  // Swingarm
  const swingarm = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.11, 0.65), metalMat);
  swingarm.position.set(0, 0.39, 0.55);
  leanGroup.add(swingarm);

  // Front forks
  [-0.14, 0.14].forEach((xOff) => {
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.034, 0.78, 10), metalMat);
    fork.position.set(xOff, 0.64, -0.66);
    fork.rotation.x = 0.35;
    leanGroup.add(fork);
  });

  // Exhaust pipe (right side) + Turbo flame cone
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.052, 0.7, 12), metalMat);
  exhaust.rotation.x = Math.PI / 2 - 0.15;
  exhaust.position.set(0.26, 0.46, 0.68);
  leanGroup.add(exhaust);

  const exhaustTip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 12), darkMetalMat);
  exhaustTip.rotation.x = Math.PI / 2 - 0.15;
  exhaustTip.position.set(0.26, 0.51, 1.03);
  leanGroup.add(exhaustTip);

  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x38d9ff,
    transparent: true,
    opacity: 0.9,
  });
  const turboFlame = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.72, 12), flameMat);
  turboFlame.rotation.x = Math.PI / 2 - 0.15;
  turboFlame.position.set(0.26, 0.55, 1.4);
  turboFlame.visible = false;
  leanGroup.add(turboFlame);

  // Sculpted front nose fairing
  const frontFairing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.44, 0.72), paintMat);
  frontFairing.position.set(0, 0.82, -0.56);
  frontFairing.rotation.x = 0.25;
  leanGroup.add(frontFairing);

  // Windscreen
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.28, 0.3), visorMat);
  screen.position.set(0, 1.06, -0.64);
  screen.rotation.x = 0.55;
  leanGroup.add(screen);

  // Fuel tank
  const tank = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.56), paintMat);
  tank.position.set(0, 0.84, -0.1);
  leanGroup.add(tank);

  // Tail cowl (angled up behind seat, prominent from player camera)
  const tailCowl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.68), paintMat);
  tailCowl.position.set(0, 0.85, 0.58);
  tailCowl.rotation.x = -0.22;
  leanGroup.add(tailCowl);

  const tailWhiteStripe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.23, 0.55), whiteMat);
  tailWhiteStripe.position.set(0, 0.86, 0.58);
  tailWhiteStripe.rotation.x = -0.22;
  leanGroup.add(tailWhiteStripe);

  // Glowing tail light
  const tailLight = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.08), tailLightMat);
  tailLight.position.set(0, 0.9, 0.91);
  leanGroup.add(tailLight);

  // Handlebars
  const handlebar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.68, 8), darkMetalMat);
  handlebar.rotation.z = Math.PI / 2;
  handlebar.position.set(0, 0.99, -0.44);
  leanGroup.add(handlebar);

  // === RIDER (tucked forward in racing suit) ===
  const riderGroup = new THREE.Group();
  leanGroup.add(riderGroup);

  // Pelvis / seat area
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.34), paintMat);
  pelvis.position.set(0, 0.94, 0.25);
  riderGroup.add(pelvis);

  // Torso leaning forward
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.54, 0.32), paintMat);
  torso.position.set(0, 1.18, 0.04);
  torso.rotation.x = 0.72;
  riderGroup.add(torso);

  // White/dark racing back protector & racing stripe
  const backStripe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.52, 0.34), whiteMat);
  backStripe.position.set(0, 1.19, 0.05);
  backStripe.rotation.x = 0.72;
  riderGroup.add(backStripe);

  const shoulderPad = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.16, 0.26), darkSuitMat);
  shoulderPad.position.set(0, 1.32, -0.1);
  shoulderPad.rotation.x = 0.72;
  riderGroup.add(shoulderPad);

  // Legs (left and right knees tucked in, white racing boots)
  [-0.24, 0.24].forEach((sideX) => {
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.17, 0.44), darkSuitMat);
    thigh.position.set(sideX, 0.88, 0.12);
    thigh.rotation.x = -0.35;
    riderGroup.add(thigh);

    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.15), paintMat);
    shin.position.set(sideX * 0.96, 0.66, 0.24);
    shin.rotation.x = 0.25;
    riderGroup.add(shin);

    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.26), whiteMat);
    boot.position.set(sideX * 0.95, 0.5, 0.29);
    riderGroup.add(boot);
  });

  // Arms reaching forward to handlebars
  [-0.28, 0.28].forEach((sideX) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.44), darkSuitMat);
    arm.position.set(sideX, 1.13, -0.26);
    arm.rotation.x = -0.45;
    arm.rotation.y = sideX > 0 ? 0.16 : -0.16;
    riderGroup.add(arm);
  });

  // Helmet
  const helmetGroup = new THREE.Group();
  helmetGroup.position.set(0, 1.48, -0.19);

  const helmetShell = new THREE.Mesh(new THREE.SphereGeometry(0.19, 18, 16), whiteMat);
  helmetShell.scale.set(0.95, 1.0, 1.15);
  helmetGroup.add(helmetShell);

  const helmetStripe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.36, 0.42), paintMat);
  helmetStripe.position.set(0, 0.03, 0);
  helmetGroup.add(helmetStripe);

  const helmetVisor = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.18), visorMat);
  helmetVisor.position.set(0, -0.02, -0.14);
  helmetGroup.add(helmetVisor);

  riderGroup.add(helmetGroup);

  // Floating indicator diamond for remote friends
  let indicator = null;
  if (!isLocalPlayer) {
    const indGeo = new THREE.OctahedronGeometry(0.24, 0);
    const indMat = new THREE.MeshBasicMaterial({ color: palette.num });
    indicator = new THREE.Mesh(indGeo, indMat);
    indicator.position.set(0, 2.05, 0);
    group.add(indicator);
  }

  let wheelSpin = 0;

  return {
    group,
    leanGroup,
    frontWheel,
    rearWheel,
    turboFlame,
    indicator,
    updateVisual(dt, speedMs, leanAngle, turboActive, bumpTimer, timeSec) {
      // Spin wheels forward
      wheelSpin -= (speedMs / 0.35) * dt;
      frontWheel.rotation.x = wheelSpin;
      rearWheel.rotation.x = wheelSpin;

      // Lean whole bike smoothly + slight bump wobble
      const wobble = bumpTimer > 0 ? Math.sin(timeSec * 45) * 0.14 * bumpTimer : 0;
      leanGroup.rotation.z = leanAngle + wobble;

      // Wheelie pitch during turbo boost
      const targetPitch = turboActive ? 0.11 : 0;
      leanGroup.rotation.x += (targetPitch - leanGroup.rotation.x) * Math.min(1, dt * 8);

      // Turbo exhaust flame
      turboFlame.visible = turboActive;
      if (turboActive) {
        const flicker = 0.85 + Math.sin(timeSec * 55) * 0.25;
        turboFlame.scale.set(flicker, 0.9 + Math.random() * 0.4, flicker);
      }

      // Bob remote indicator gently
      if (indicator) {
        indicator.rotation.y = timeSec * 2.4;
        indicator.position.y = 2.08 + Math.sin(timeSec * 4) * 0.08;
      }
    },
  };
}
