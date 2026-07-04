import * as THREE from "three";

gsap.registerPlugin(ScrollTrigger);

const canvas = document.getElementById("bg-canvas");
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  60, window.innerWidth / window.innerHeight, 0.1, 500
);
camera.position.set(0, 0, 40);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

function handleResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const aspect = width / height;

  camera.aspect = aspect;

  const aspectBaseline = 1.6;
  if (aspect < aspectBaseline) {
    camera.zoom = Math.max(aspect / aspectBaseline, 0.45);
  } else {
    camera.zoom = 1.0;
  }

  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

window.addEventListener("resize", handleResize);
handleResize();

const ambient = new THREE.AmbientLight(0xffffff, 0.6);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(5, 10, 20);
scene.add(ambient, dirLight);

const clock = new THREE.Clock();

const mouse = new THREE.Vector2(-9999, -9999);
const raycaster = new THREE.Raycaster();
const planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const mouse3D = new THREE.Vector3(-9999, -9999, -9999);
const targetMouse3D = new THREE.Vector3();

function updateMouseCoords(clientX, clientY) {
  mouse.x = (clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(clientY / window.innerHeight) * 2 + 1;
}

window.addEventListener("mousemove", (event) => {
  updateMouseCoords(event.clientX, event.clientY);
});

window.addEventListener("mouseleave", () => {
  mouse.set(-9999, -9999);
});

window.addEventListener("touchstart", (event) => {
  if (event.touches.length > 0) {
    updateMouseCoords(event.touches[0].clientX, event.touches[0].clientY);
  }
}, { passive: true });

window.addEventListener("touchmove", (event) => {
  if (event.touches.length > 0) {
    updateMouseCoords(event.touches[0].clientX, event.touches[0].clientY);
  }
}, { passive: true });

window.addEventListener("touchend", () => {
  mouse.set(-9999, -9999);
});

window.addEventListener("touchcancel", () => {
  mouse.set(-9999, -9999);
});

function createCircleTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  grad.addColorStop(0, "rgba(255, 255, 255, 1)");
  grad.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 16, 16);
  return new THREE.CanvasTexture(canvas);
}

const HEART_COUNT = 6000;
const HEART_SCALE = 1.0;

function heartCurve(t) {
  const x = 16 * Math.pow(Math.sin(t), 3);
  const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
  return { x: x * HEART_SCALE, y: y * HEART_SCALE + 2.5 * HEART_SCALE };
}

const POLY_RES = 720;
const heartPolygon = [];
for (let i = 0; i < POLY_RES; i++) {
  heartPolygon.push(heartCurve((i / POLY_RES) * Math.PI * 2));
}
let minY = Infinity, maxY = -Infinity;
for (const p of heartPolygon) {
  if (p.y < minY) minY = p.y;
  if (p.y > maxY) maxY = p.y;
}

function scanLine(y) {
  const crossings = [];
  for (let i = 0; i < POLY_RES; i++) {
    const a = heartPolygon[i];
    const b = heartPolygon[(i + 1) % POLY_RES];
    if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
      const frac = (y - a.y) / (b.y - a.y);
      crossings.push(a.x + frac * (b.x - a.x));
    }
  }
  crossings.sort((p, q) => p - q);

  const spans = [];
  let totalLen = 0;
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const len = crossings[i + 1] - crossings[i];
    spans.push({ x0: crossings[i], len });
    totalLen += len;
  }
  return { spans, totalLen };
}

let maxWidth = 0;
for (let i = 0; i <= 200; i++) {
  const y = minY + (i / 200) * (maxY - minY);
  maxWidth = Math.max(maxWidth, scanLine(y).totalLen);
}

function randomPointInHeart() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const y = minY + Math.random() * (maxY - minY);
    const { spans, totalLen } = scanLine(y);
    if (totalLen === 0 || Math.random() > totalLen / maxWidth) continue;

    let pick = Math.random() * totalLen;
    for (const span of spans) {
      if (pick <= span.len) return { x: span.x0 + pick, y };
      pick -= span.len;
    }
    const last = spans[spans.length - 1];
    return { x: last.x0 + last.len, y };
  }
  return { x: 0, y: minY };
}

const basePositions = new Float32Array(HEART_COUNT * 3);
const scatterPositions = new Float32Array(HEART_COUNT * 3);
const ingressPositions = new Float32Array(HEART_COUNT * 3);
const phases = new Float32Array(HEART_COUNT);
const cursorDispX = new Float32Array(HEART_COUNT);
const cursorDispY = new Float32Array(HEART_COUNT);

for (let i = 0; i < HEART_COUNT; i++) {
  const p = randomPointInHeart();
  const x = p.x;
  const y = p.y;
  const z = (Math.random() - 0.5) * 10 * HEART_SCALE;

  const ix = i * 3;
  basePositions[ix] = x;
  basePositions[ix + 1] = y;
  basePositions[ix + 2] = z;

  const len = Math.sqrt(x * x + y * y + z * z) || 1;
  const dirX = x / len, dirY = y / len, dirZ = z / len;
  const dist = 35 + Math.random() * 55;

  scatterPositions[ix] = x + dirX * dist + (Math.random() - 0.5) * 20;
  scatterPositions[ix + 1] = y + dirY * dist + (Math.random() - 0.5) * 20;
  scatterPositions[ix + 2] = z + dirZ * dist + (Math.random() - 0.5) * 20;

  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos((Math.random() - 0.5) * 2);
  const radius = 120 + Math.random() * 80;

  ingressPositions[ix] = radius * Math.sin(phi) * Math.cos(theta);
  ingressPositions[ix + 1] = radius * Math.sin(phi) * Math.sin(theta);
  ingressPositions[ix + 2] = radius * (Math.random() - 0.5) * 40;

  phases[i] = Math.random() * Math.PI * 2;
}

const heartGeometry = new THREE.BufferGeometry();
heartGeometry.setAttribute("position", new THREE.BufferAttribute(basePositions.slice(), 3));

const heartMaterial = new THREE.PointsMaterial({
  color: 0xff2d55,
  size: 0.5,
  map: createCircleTexture(),
  transparent: true,
  opacity: 1,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

const heartPoints = new THREE.Points(heartGeometry, heartMaterial);
scene.add(heartPoints);

const dispersion = { value: 0 };
const intro = { value: 0 };

gsap.to(intro, {
  value: 1,
  duration: 2.5,
  ease: "power2.out"
});

function updateHeartParticles(elapsed) {
  if (heartMaterial.opacity <= 0.001) return;

  const posAttr = heartGeometry.attributes.position;
  const arr = posAttr.array;
  const d = dispersion.value;
  const introVal = intro.value;
  const hasMouse = mouse3D.x !== -9999;

  for (let i = 0; i < HEART_COUNT; i++) {
    const ix = i * 3;
    const bx = basePositions[ix], by = basePositions[ix + 1], bz = basePositions[ix + 2];
    const sx = scatterPositions[ix], sy = scatterPositions[ix + 1], sz = scatterPositions[ix + 2];
    const rx = ingressPositions[ix], ry = ingressPositions[ix + 1], rz = ingressPositions[ix + 2];

    let x = rx + (bx - rx) * introVal;
    let y = ry + (by - ry) * introVal;
    let z = rz + (bz - rz) * introVal;

    x = x + (sx - x) * d;
    y = y + (sy - y) * d;
    z = z + (sz - z) * d;

    const phase = phases[i];
    x += Math.sin(elapsed * 1.5 + phase) * 0.45 + Math.cos(elapsed * 0.6 + phase * 2.0) * 0.25;
    y += Math.cos(elapsed * 1.3 + phase) * 0.45 + Math.sin(elapsed * 0.5 + phase * 2.0) * 0.25;
    z += Math.sin(elapsed * 0.9 + phase * 1.5) * 0.35;

    let targetDispX = 0;
    let targetDispY = 0;
    if (hasMouse && introVal > 0.95 && d < 0.95) {
      const dx = mouse3D.x - x;
      const dy = mouse3D.y - y;
      const distSq = dx * dx + dy * dy;
      const sigma = 1.6;
      const falloff = Math.exp(-distSq / (2 * sigma * sigma));
      const len = Math.sqrt(distSq) || 0.0001;
      const dirX = dx / len, dirY = dy / len;
      const pushMag = falloff * 2.0;
      const swirlMag = falloff * 0.7;
      targetDispX = -dirX * pushMag - dirY * swirlMag;
      targetDispY = -dirY * pushMag + dirX * swirlMag;
    }
    const targetMag = Math.hypot(targetDispX, targetDispY);
    const currentMag = Math.hypot(cursorDispX[i], cursorDispY[i]);
    const lerpRate = targetMag > currentMag ? 0.16 : 0.05;
    cursorDispX[i] += (targetDispX - cursorDispX[i]) * lerpRate;
    cursorDispY[i] += (targetDispY - cursorDispY[i]) * lerpRate;
    x += cursorDispX[i];
    y += cursorDispY[i];

    arr[ix] = x;
    arr[ix + 1] = y;
    arr[ix + 2] = z;
  }
  posAttr.needsUpdate = true;
}

const textureLoader = new THREE.TextureLoader();
textureLoader.crossOrigin = "anonymous";
const photoFiles = Array.from({ length: 12 }, (_, i) => `assets/${i + 1}.jpg`);
const PHOTO_MAX_DIM = 8;

const photoZs = Array.from({ length: 12 }, (_, i) => -14 - i * ((51 - 14) / 11));

const photoMeshes = photoZs.map((z, i) => {
  const group = new THREE.Group();
  group.position.set(0, 0, z);
  group.scale.set(0.01, 0.01, 0.01);
  scene.add(group);

  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  group.add(mesh);

  textureLoader.load(photoFiles[i], (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    mat.map = tex;
    mat.needsUpdate = true;
    const w = tex.image.width, h = tex.image.height;
    if (w >= h) mesh.scale.set(PHOTO_MAX_DIM, (PHOTO_MAX_DIM * h) / w, 1);
    else mesh.scale.set((PHOTO_MAX_DIM * w) / h, PHOTO_MAX_DIM, 1);
  });

  return { group, material: mat };
});

const FLOWER_Z = -95;
const PETAL_COUNT = 8;
const petalGeo = new THREE.PlaneGeometry(3, 6, 1, 4);
petalGeo.translate(0, 3, 0);
const pistilGeo = new THREE.SphereGeometry(1, 16, 16);
const pistilMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5 });

function createFlowerPlant(offsetX, offsetZ, targetScale, petalColor, stemLength) {
  const flowerGroup = new THREE.Group();
  flowerGroup.position.set(offsetX, 0, FLOWER_Z + offsetZ);
  flowerGroup.scale.set(0, 0, 0);
  scene.add(flowerGroup);

  const pistil = new THREE.Mesh(pistilGeo, pistilMat);
  flowerGroup.add(pistil);

  const stemGroup = new THREE.Group();
  stemGroup.position.set(offsetX, 0, FLOWER_Z + offsetZ);
  stemGroup.scale.set(0, 0, 0);
  scene.add(stemGroup);
  const stemGeo = new THREE.CylinderGeometry(0.35, 0.45, stemLength, 12);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x3f7d32, roughness: 0.7 });
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.position.set(0, -1 - stemLength / 2, 0);
  stemGroup.add(stem);

  const petalMat = new THREE.MeshStandardMaterial({
    color: petalColor,
    side: THREE.DoubleSide,
    roughness: 0.6,
  });

  const petalPivots = [];
  for (let i = 0; i < PETAL_COUNT; i++) {
    const angle = (i / PETAL_COUNT) * Math.PI * 2;
    const pivot = new THREE.Group();
    pivot.rotation.z = angle;

    const petalMesh = new THREE.Mesh(petalGeo, petalMat.clone());
    petalMesh.position.set(0, 0.3, 0);
    petalMesh.rotation.x = -1.45;
    pivot.add(petalMesh);

    flowerGroup.add(pivot);
    petalPivots.push(petalMesh);
  }

  return { flowerGroup, stemGroup, petalPivots, targetScale };
}

const bouquetConfigs = [
  { x: 0, z: 0, scale: 1.0, color: 0xff6fa5, stemLen: 16 },
  { x: -6, z: 1.5, scale: 0.8, color: 0xff8fc0, stemLen: 12 },
  { x: 6, z: 1.5, scale: 0.8, color: 0xe85f95, stemLen: 12 },
  { x: -3.5, z: -2.5, scale: 0.65, color: 0xffa8d0, stemLen: 9 },
  { x: 3.5, z: -2.5, scale: 0.65, color: 0xd94f85, stemLen: 9 },
];
const flowerPlants = bouquetConfigs.map((c) =>
  createFlowerPlant(c.x, c.z, c.scale, c.color, c.stemLen)
);

const qrHolder = document.createElement("div");
qrHolder.style.position = "absolute";
qrHolder.style.left = "-9999px";
document.body.appendChild(qrHolder);
new QRCode(qrHolder, {
  text: "https://youtu.be/dQw4w9WgXcQ?si=R67_lNCay5BJ-OOF",
  width: 256,
  height: 256,
  colorDark: "#1a1a1a",
  colorLight: "#ffffff",
  correctLevel: QRCode.CorrectLevel.M,
});
const qrTexture = new THREE.CanvasTexture(qrHolder.querySelector("canvas"));
qrTexture.colorSpace = THREE.SRGBColorSpace;

const envelopeGroup = new THREE.Group();
envelopeGroup.position.set(0, 0, FLOWER_Z);
envelopeGroup.scale.set(0, 0, 0);
scene.add(envelopeGroup);

const envelopeBody = new THREE.Mesh(
  new THREE.PlaneGeometry(9, 6),
  new THREE.MeshStandardMaterial({ color: 0xd8c39a, roughness: 0.85, side: THREE.DoubleSide })
);
envelopeGroup.add(envelopeBody);

const flapGeo = new THREE.BufferGeometry();
flapGeo.setAttribute(
  "position",
  new THREE.BufferAttribute(new Float32Array([-4.5, 0, 0, 4.5, 0, 0, 0, -3, 0]), 3)
);
flapGeo.setIndex([0, 1, 2]);
flapGeo.computeVertexNormals();
const flapMat = new THREE.MeshStandardMaterial({ color: 0x9c7a4c, roughness: 0.85, side: THREE.DoubleSide });
const flapPivot = new THREE.Group();
flapPivot.position.set(0, 3, 0.05);
const flapMesh = new THREE.Mesh(flapGeo, flapMat);
flapPivot.add(flapMesh);
envelopeGroup.add(flapPivot);

const paperMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(5, 5),
  new THREE.MeshBasicMaterial({ map: qrTexture, side: THREE.DoubleSide })
);
paperMesh.position.set(0, 0, -0.1);
paperMesh.scale.set(0.85, 0.85, 0.85);
envelopeGroup.add(paperMesh);

const tl = gsap.timeline({
  scrollTrigger: {
    trigger: ".scroll-container",
    start: "top top",
    end: "bottom bottom",
    scrub: 1.5,
  },
});

tl.to(camera.position, { z: -10, duration: 0.3, ease: "none" }, 0);
tl.to(camera.position, { z: -55, duration: 1.0, ease: "none" }, 0.3);
tl.to(camera.position, { z: -78, duration: 0.2, ease: "none" }, 1.3);

const TOTAL_DURATION = 2.3;

const SCROLLBAR_ARROW_CLICK_PX = 40;
const FREEZE_CLICKS = 8;
const scrollRangePx = (4 * TOTAL_DURATION - 1) * window.innerHeight;
const freezeProgress = ((FREEZE_CLICKS * SCROLLBAR_ARROW_CLICK_PX) / scrollRangePx) * TOTAL_DURATION;

tl.to(dispersion, { value: 0.4, duration: freezeProgress, ease: "none" }, 0);
tl.to(heartMaterial, { opacity: 0.5, duration: freezeProgress, ease: "none" }, 0);
tl.to(dispersion, { value: 1, duration: 0.08, ease: "none" }, 1.22);
tl.to(heartMaterial, { opacity: 0, duration: 0.08, ease: "none" }, 1.22);

const HALF_WINDOW = 0.16;
photoMeshes.forEach(({ group, material }, i) => {
  const crossTime = 0.3 - (group.position.z + 10) / 45;
  const start = crossTime - HALF_WINDOW;
  const end = crossTime + HALF_WINDOW;
  const span = end - start;

  tl.fromTo(
    group.scale,
    { x: 0.01, y: 0.01, z: 0.01 },
    { x: 1.15, y: 1.15, z: 1.15, duration: span, ease: "sine.inOut" },
    start
  );
  tl.fromTo(material, { opacity: 0 }, { opacity: 1, duration: span * 0.35, ease: "sine.out" }, start);
  tl.to(material, { opacity: 0, duration: span * 0.35, ease: "sine.in" }, end - span * 0.35);

  tl.fromTo(
    group.rotation,
    { y: (i % 2 === 0 ? -0.4 : 0.4), x: -0.2 },
    { y: (i % 2 === 0 ? 0.3 : -0.3), x: 0.2, duration: span, ease: "none" },
    start
  );
});

flowerPlants.forEach(({ flowerGroup, stemGroup, petalPivots, targetScale }, j) => {
  const start = 1.3 + j * 0.015;
  tl.to(
    flowerGroup.scale,
    { x: targetScale, y: targetScale, z: targetScale, duration: 0.2, ease: "back.out(1.7)" },
    start
  );
  tl.to(flowerGroup.rotation, { z: Math.PI * 0.5, y: 0.3, duration: 0.2, ease: "sine.out" }, start);
  tl.to(
    stemGroup.scale,
    { x: targetScale, y: targetScale, z: targetScale, duration: 0.2, ease: "back.out(1.7)" },
    start
  );
  petalPivots.forEach((petalMesh, i) => {
    tl.to(petalMesh.rotation, { x: 0.25, duration: 0.12, ease: "sine.out" }, start + i * 0.01);
  });
});

tl.to(camera.position, { y: -6, z: -68, duration: 0.2, ease: "sine.inOut" }, 1.5);

flowerPlants.forEach(({ flowerGroup, stemGroup }) => {
  tl.to(flowerGroup.scale, { x: 0, y: 0, z: 0, duration: 0.2, ease: "power2.out" }, 1.8);
  tl.to(stemGroup.scale, { x: 0, y: 0, z: 0, duration: 0.2, ease: "power2.out" }, 1.8);
});
tl.to(envelopeGroup.scale, { x: 1, y: 1, z: 1, duration: 0.2, ease: "back.out(1.4)" }, 1.8);
tl.to(camera.position, { y: 0, z: -78, duration: 0.2, ease: "sine.inOut" }, 1.8);

tl.to(flapPivot.rotation, { x: 2.9, duration: 0.15, ease: "sine.inOut" }, 2.0);
tl.to(paperMesh.position, { y: 3.2, z: 0.6, duration: 0.2, ease: "sine.out" }, 2.1);
tl.to(paperMesh.scale, { x: 1.15, y: 1.15, z: 1.15, duration: 0.2, ease: "sine.out" }, 2.1);

function renderLoop() {
  const elapsed = clock.getElapsedTime();

  if (mouse.x !== -9999 && camera.position.z > 0) {
    raycaster.setFromCamera(mouse, camera);
    raycaster.ray.intersectPlane(planeZ, targetMouse3D);
    if (mouse3D.x === -9999) {
      mouse3D.copy(targetMouse3D);
    } else {
      mouse3D.lerp(targetMouse3D, 0.08);
    }
  } else {
    mouse3D.set(-9999, -9999, -9999);
  }

  updateHeartParticles(elapsed);
  renderer.render(scene, camera);
}
gsap.ticker.add(renderLoop);
