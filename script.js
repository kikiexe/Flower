import * as THREE from "three";

gsap.registerPlugin(ScrollTrigger);

/* ---------- Setup dasar ---------- */
const canvas = document.getElementById("bg-canvas");
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  60, window.innerWidth / window.innerHeight, 0.1, 500
);
camera.position.set(0, 0, 40);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const ambient = new THREE.AmbientLight(0xffffff, 0.6);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(5, 10, 20);
scene.add(ambient, dirLight);

const clock = new THREE.Clock();

/* ---------- Interaksi Mouse ---------- */
const mouse = new THREE.Vector2(-9999, -9999);
const raycaster = new THREE.Raycaster();
const planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const mouse3D = new THREE.Vector3(-9999, -9999, -9999);
const targetMouse3D = new THREE.Vector3();

window.addEventListener("mousemove", (event) => {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
});

window.addEventListener("mouseleave", () => {
  mouse.set(-9999, -9999);
});

/* ---------- Helper: Tekstur Partikel Bersinar ---------- */
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

/* ---------- Tahap 1: Partikel Hati 3D ---------- */
const HEART_COUNT = 6000;
const HEART_SCALE = 1.0; // Menggunakan skala 1.0 agar hati parametrik pas dengan ukuran layar browser

function heartCurve(t) {
  const x = 16 * Math.pow(Math.sin(t), 3);
  const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
  return { x: x * HEART_SCALE, y: y * HEART_SCALE + 2.5 * HEART_SCALE };
}

// Poligon batas hati resolusi tinggi, dipakai buat isi area lewat scanline.
// (Skala radial titik boundary ke titik pusat (0,0) menumpuk garis terang di
// sumbu tengah, karena ujung atas & bawah hati sama-sama ada di x=0 — jadi
// dihindari, gantinya isi area beneran per potongan horizontal.)
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

// Lebar maksimum dipakai buat rejection sampling di bawah, biar kepadatan
// merata per LUAS (bukan per tinggi) — mencegah numpuk di ujung lancip hati
// yang lebarnya nyaris nol.
let maxWidth = 0;
for (let i = 0; i <= 200; i++) {
  const y = minY + (i / 200) * (maxY - minY);
  maxWidth = Math.max(maxWidth, scanLine(y).totalLen);
}

function randomPointInHeart() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const y = minY + Math.random() * (maxY - minY);
    const { spans, totalLen } = scanLine(y);
    if (totalLen === 0 || Math.random() > totalLen / maxWidth) continue; // tolak: jaga kepadatan per luas

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
// Displacement kursor per-partikel, disimpan & di-lerp tiap frame (bukan
// dihitung ulang dari nol) biar dorongannya punya inersia, nempel & lepas
// pelan-pelan — bukan snap instan pas kursor masuk/keluar jangkauan.
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

  // target dispersi: menjauh dari pusat ke arah acak
  const len = Math.sqrt(x * x + y * y + z * z) || 1;
  const dirX = x / len, dirY = y / len, dirZ = z / len;
  const dist = 35 + Math.random() * 55;

  scatterPositions[ix] = x + dirX * dist + (Math.random() - 0.5) * 20;
  scatterPositions[ix + 1] = y + dirY * dist + (Math.random() - 0.5) * 20;
  scatterPositions[ix + 2] = z + dirZ * dist + (Math.random() - 0.5) * 20;

  // posisi asal masuk acak dari kejauhan luar layar
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

// Jalankan animasi masuk partikel saat halaman dimuat
gsap.to(intro, {
  value: 1,
  duration: 2.5,
  ease: "power2.out"
});

function updateHeartParticles(elapsed) {
  // Optimasi: lewati pembaruan koordinat jika partikel sudah tidak terlihat
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

    // Penyatuan dari posisi acak luar layar (rx, ry, rz) ke posisi hati dasar (bx, by, bz)
    let x = rx + (bx - rx) * introVal;
    let y = ry + (by - ry) * introVal;
    let z = rz + (bz - rz) * introVal;

    // Pemencaran seiring scroll ke target dispersi (sx, sy, sz)
    x = x + (sx - x) * d;
    y = y + (sy - y) * d;
    z = z + (sz - z) * d;

    const phase = phases[i];
    // Gerakan melayang organik yang aktif dan hidup kembali diterapkan
    x += Math.sin(elapsed * 1.5 + phase) * 0.45 + Math.cos(elapsed * 0.6 + phase * 2.0) * 0.25;
    y += Math.cos(elapsed * 1.3 + phase) * 0.45 + Math.sin(elapsed * 0.5 + phase * 2.0) * 0.25;
    z += Math.sin(elapsed * 0.9 + phase * 1.5) * 0.35;

    // Efek tolakan kursor: falloff gaussian (halus, tanpa batas tegas —
    // beda dari cutoff keras sebelumnya yang bikin kelihatan "tembok"
    // lingkaran), dan hasilnya di-lerp ke buffer displacement persisten
    // biar ada inersia (nempel & lepas pelan-pelan, bukan snap instan).
    let targetDispX = 0;
    let targetDispY = 0;
    if (hasMouse && introVal > 0.95 && d < 0.95) {
      const dx = mouse3D.x - x;
      const dy = mouse3D.y - y;
      const distSq = dx * dx + dy * dy;
      const sigma = 2.2; // "radius efektif" gaussian, gak ada batas keras
      const falloff = Math.exp(-distSq / (2 * sigma * sigma));
      targetDispX = -dx * falloff * 1.1;
      targetDispY = -dy * falloff * 1.1;
    }
    cursorDispX[i] += (targetDispX - cursorDispX[i]) * 0.1;
    cursorDispY[i] += (targetDispY - cursorDispY[i]) * 0.1;
    x += cursorDispX[i];
    y += cursorDispY[i];

    arr[ix] = x;
    arr[ix + 1] = y;
    arr[ix + 2] = z;
  }
  posAttr.needsUpdate = true;
}

/* ---------- Tahap 3: Foto Melayang ---------- */
const textureLoader = new THREE.TextureLoader();
textureLoader.crossOrigin = "anonymous";
const photoFiles = ["assets/hot.webp", "assets/hot2.webp", "assets/hot3.webp", "assets/hot4.webp", "assets/hot5.webp"];
const photoTextures = photoFiles.map((path) => {
  const tex = textureLoader.load(path);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
});

const photoZs = [-16, -23, -30, -37, -44];
const photoMeshes = photoZs.map((z, i) => {
  const geo = new THREE.PlaneGeometry(8, 6);
  const mat = new THREE.MeshBasicMaterial({
    map: photoTextures[i],
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 0, z);
  mesh.scale.set(0.01, 0.01, 0.01);
  scene.add(mesh);
  return mesh;
});

/* ---------- Tahap 4: Buket Bunga Mekar Prosedural (banyak bunga) ---------- */
const FLOWER_Z = -95;
const PETAL_COUNT = 8;
const petalGeo = new THREE.PlaneGeometry(3, 6, 1, 4);
petalGeo.translate(0, 3, 0); // pivot di pangkal kelopak
const pistilGeo = new THREE.SphereGeometry(1, 16, 16);
const pistilMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5 });

// Satu bunga = flowerGroup (kepala: putik + kelopak) + stemGroup TERPISAH
// (biar gak ikut hilang pas kepala bunga di-scale 0 nanti). Mulai scale 0
// (baru muncul bareng bunga mekar), soalnya kalau langsung 1 dari awal dia
// kelihatan dari jauh nembus tahap foto (tangkai bentang di sumbu Y, bukan
// Z, jadi TETAP kelihatan dari kamera manapun sepanjang sumbu Z).
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
  stem.position.set(0, -1 - stemLength / 2, 0); // ujung atas nempel pangkal bunga (y=-1)
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
    pivot.rotation.z = angle; // sebar melingkar menghadap kamera (sumbu pandang Z)

    const petalMesh = new THREE.Mesh(petalGeo, petalMat.clone());
    petalMesh.position.set(0, 0.3, 0);
    petalMesh.rotation.x = -1.45; // kuncup: menutup rapat ke sumbu pusat
    pivot.add(petalMesh);

    flowerGroup.add(pivot);
    petalPivots.push(petalMesh);
  }

  return { flowerGroup, stemGroup, petalPivots, targetScale };
}

// Buket: 1 bunga utama di tengah + 4 bunga lebih kecil menyebar di
// sekelilingnya, variasi warna & tinggi tangkai biar keliatan alami.
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

/* ---------- Tahap 5: Amplop & Kertas QR ---------- */
// Render QR code asli (bukan pola acak) pakai qrcodejs (CDN), dari elemen
// tersembunyi lalu diambil canvas-nya jadi tekstur Three.js.
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

// Amplop muncul di titik yang sama dengan bunga (bergantian, bukan sekaligus)
const envelopeGroup = new THREE.Group();
envelopeGroup.position.set(0, 0, FLOWER_Z);
envelopeGroup.scale.set(0, 0, 0);
scene.add(envelopeGroup);

const envelopeBody = new THREE.Mesh(
  new THREE.PlaneGeometry(9, 6),
  new THREE.MeshStandardMaterial({ color: 0xd8c39a, roughness: 0.85, side: THREE.DoubleSide })
);
envelopeGroup.add(envelopeBody);

// Tutup amplop: segitiga menggantung dari tepi atas, pivot di tepi biar bisa dibuka
const flapGeo = new THREE.BufferGeometry();
flapGeo.setAttribute(
  "position",
  new THREE.BufferAttribute(new Float32Array([-4.5, 0, 0, 4.5, 0, 0, 0, -3, 0]), 3)
);
flapGeo.setIndex([0, 1, 2]);
flapGeo.computeVertexNormals();
const flapMat = new THREE.MeshStandardMaterial({ color: 0x9c7a4c, roughness: 0.85, side: THREE.DoubleSide });
const flapPivot = new THREE.Group();
flapPivot.position.set(0, 3, 0.05); // tepi atas amplop (tinggi 6, jadi tepi di y=+3)
const flapMesh = new THREE.Mesh(flapGeo, flapMat);
flapPivot.add(flapMesh);
envelopeGroup.add(flapPivot);

// Kertas berisi QR, ukurannya dibikin lebih kecil dari badan amplop (5x5 vs
// 9x6) & diposisikan di tengah biar bener-bener ketutup rapat, gak nongol
// duluan sebelum dianimasikan keluar. z lebih kecil dari body = ketutup.
const paperMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(5, 5),
  new THREE.MeshBasicMaterial({ map: qrTexture, side: THREE.DoubleSide })
);
paperMesh.position.set(0, 0, -0.1);
paperMesh.scale.set(0.85, 0.85, 0.85);
envelopeGroup.add(paperMesh);

/* ---------- Timeline GSAP terpadu ---------- */
const tl = gsap.timeline({
  scrollTrigger: {
    trigger: ".scroll-container",
    start: "top top",
    end: "bottom bottom",
    scrub: 1.5,
  },
});

// Kamera: 0 -> 0.3 langsung menembus pusat hati (scroll langsung memicu gerak)
tl.to(camera.position, { z: -10, duration: 0.3, ease: "none" }, 0);
// 0.3 -> 0.8 melewati jalur foto secara lambat agar foto dapat dinikmati
tl.to(camera.position, { z: -55, duration: 0.5, ease: "none" }, 0.3);
// 0.8 -> 1.0 mendekati bunga
tl.to(camera.position, { z: -78, duration: 0.2, ease: "none" }, 0.8);

// Titik beku dihitung dari 8x klik panah bawah scrollbar (~40px/klik),
// bukan angka pecahan tetap — soalnya area geser total = 3x tinggi layar
// (container 400vh dikurang 1 viewport), jadi pecahannya beda tiap device.
const SCROLLBAR_ARROW_CLICK_PX = 40;
const FREEZE_CLICKS = 8;
const scrollRange = 3 * window.innerHeight; // 400vh - 100vh viewport = 300vh = 3x innerHeight
const freezeProgress = (FREEZE_CLICKS * SCROLLBAR_ARROW_CLICK_PX) / scrollRange;

// Hati: pecah sebagian dulu (0 -> freezeProgress), lalu BEKU (freezeProgress
// -> ~0.68) selama foto-foto tampil biar jumlah/tampilan sisa partikel sama
// persis di tiap foto, baru diselesaikan (dispersi penuh, opacity 0, tanpa
// sisa partikel) setelah foto terakhir hilang (crossTime foto terakhir ~0.678).
tl.to(dispersion, { value: 0.4, duration: freezeProgress, ease: "none" }, 0);
tl.to(heartMaterial, { opacity: 0.5, duration: freezeProgress, ease: "none" }, 0);
// freezeProgress -> 0.68: beku, tidak ada tween (nilai dipertahankan otomatis)
tl.to(dispersion, { value: 1, duration: 0.08, ease: "none" }, 0.68);
tl.to(heartMaterial, { opacity: 0, duration: 0.08, ease: "none" }, 0.68);

// Foto: window animasi dipusatkan pada saat kamera benar-benar
// melintasi z foto tersebut (bukan slot waktu sembarang), supaya
// scale-up/fade selalu selaras dengan posisi kamera aktual.
// Kamera pada 0.6 -> 0.8 bergerak linear dari z=-10 ke z=-50,
// jadi waktu saat camera.z == photoZ adalah:
//   t = 0.6 - (photoZ + 10) / 200
const HALF_WINDOW = 0.16; // Rentang scroll diperlebar biar membesarnya pelan, gak lompat gede sekali gulir
photoMeshes.forEach((mesh, i) => {
  // Kamera pada 0.3 -> 0.8 bergerak linear dari z=-10 ke z=-55 (selisih -45)
  // kecepatan kamera: -45 per 0.5 unit timeline = -90 unit z per unit timeline
  // Rumus posisi silang waktu: camera.z == mesh.z => mesh.z = -10 - 90 * (t - 0.3)
  // => t = 0.3 - (mesh.z + 10) / 90
  const crossTime = 0.3 - (mesh.position.z + 10) / 90;
  const start = crossTime - HALF_WINDOW;
  const end = crossTime + HALF_WINDOW;
  const span = end - start;

  tl.fromTo(
    mesh.scale,
    { x: 0.01, y: 0.01, z: 0.01 },
    { x: 1.15, y: 1.15, z: 1.15, duration: span, ease: "sine.inOut" },
    start
  );
  tl.fromTo(mesh.material, { opacity: 0 }, { opacity: 1, duration: span * 0.35, ease: "sine.out" }, start);
  tl.to(mesh.material, { opacity: 0, duration: span * 0.35, ease: "sine.in" }, end - span * 0.35);

  // Animasi rotasi 3D (tilt) agar foto melayang lebih dinamis
  tl.fromTo(
    mesh.rotation,
    { y: (i % 2 === 0 ? -0.4 : 0.4), x: -0.2 },
    { y: (i % 2 === 0 ? 0.3 : -0.3), x: 0.2, duration: span, ease: "none" },
    start
  );
});

// Buket bunga: kuncup -> mekar (0.8 -> 1.0) buat SEMUA bunga, tangkai ikut
// muncul bareng. Tiap bunga dikasih stagger start dikit (j*0.015) biar
// mekarnya gak persis bersamaan, keliatan lebih alami/organik.
flowerPlants.forEach(({ flowerGroup, stemGroup, petalPivots, targetScale }, j) => {
  const start = 0.8 + j * 0.015;
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

// Tahap 5 (1.0 -> 1.3): kamera menjauh + turun dikit, nampilin FULL bunga
// yang lagi mekar sekaligus tangkainya utuh dalam satu frame (bukan cuma
// tangkai doang). Ditahan sebentar (1.2->1.3) biar sempat keliatan jelas.
tl.to(camera.position, { y: -6, z: -68, duration: 0.2, ease: "sine.inOut" }, 1.0);

// Tahap 5b (1.3 -> 1.5): bunga (kepala + tangkai) perlahan bergantian jadi
// amplop — crossfade bareng, bukan hilang dulu baru amplop nongol nyusul.
// Kamera bareng-bareng balik ke posisi awal (tengah) buat framing amplop.
// ease "power2.out" (bukan "sine.in") biar bunga ngecil CEPET di awal —
// nyamain ritme sama amplop yang munculnya cepet duluan (back.out), jadi
// gak tumpang tindih lama-lama gede berbarengan.
flowerPlants.forEach(({ flowerGroup, stemGroup }) => {
  tl.to(flowerGroup.scale, { x: 0, y: 0, z: 0, duration: 0.2, ease: "power2.out" }, 1.3);
  tl.to(stemGroup.scale, { x: 0, y: 0, z: 0, duration: 0.2, ease: "power2.out" }, 1.3);
});
tl.to(envelopeGroup.scale, { x: 1, y: 1, z: 1, duration: 0.2, ease: "back.out(1.4)" }, 1.3);
tl.to(camera.position, { y: 0, z: -78, duration: 0.2, ease: "sine.inOut" }, 1.3);

// Tahap 6 (1.5 -> 1.85): tutup amplop kebuka TUNTAS (diputar lebih jauh,
// hampir rata ke belakang badan amplop — sebelumnya cuma nungging separuh),
// baru kertas QR keluar dari dalamnya.
tl.to(flapPivot.rotation, { x: 2.9, duration: 0.15, ease: "sine.inOut" }, 1.5);
tl.to(paperMesh.position, { y: 3.2, z: 0.6, duration: 0.2, ease: "sine.out" }, 1.6);
tl.to(paperMesh.scale, { x: 1.15, y: 1.15, z: 1.15, duration: 0.2, ease: "sine.out" }, 1.6);

/* ---------- Render loop ---------- */
function renderLoop() {
  const elapsed = clock.getElapsedTime();

  // Proyeksikan posisi 2D kursor ke bidang 3D Z = 0 dengan lerp untuk efek inersia halus
  if (mouse.x !== -9999 && camera.position.z > 0) {
    raycaster.setFromCamera(mouse, camera);
    raycaster.ray.intersectPlane(planeZ, targetMouse3D);
    if (mouse3D.x === -9999) {
      mouse3D.copy(targetMouse3D);
    } else {
      mouse3D.lerp(targetMouse3D, 0.08); // Nilai lerp kecil memberikan efek inersia yang sangat luwes
    }
  } else {
    mouse3D.set(-9999, -9999, -9999);
  }

  updateHeartParticles(elapsed);
  renderer.render(scene, camera);
}
gsap.ticker.add(renderLoop);
