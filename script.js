import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * COLLEGE LAB SIMULATION PRO - ARCHITECTURAL ENGINE
 * Fixed: Modern Glass Doors, Clean Walls, Reordered Labs, Facilities, and Removed Stairs.
 */

// --- 1. GLOBAL STATE & CONFIG ---
const SETTINGS = { 
  unitScale: 0.01,
  playerHeight: 1.70, 
  playerRadius: 0.35, 
  mouseSensitivity: 0.002, 
  baseSpeed: 4.5, 
  runMultiplier: 2.0,
  floorHeight: 3.8,
  jsonDir: './ALL_FLOORS_JSON',
  performanceMode: true
};

const UI = {
  overlay: document.getElementById('overlay'),
  startBtn: document.getElementById('startBtn'),
  zoneName: document.getElementById('zoneName'),
  floorSelect: document.getElementById('floorSelect'),
  floorSelectOverlay: document.getElementById('floorSelectOverlay'),
  qualitySelect: document.getElementById('qualitySelect'),
  minimapCanvas: document.getElementById('minimap-canvas'),
  mobileControls: document.getElementById('mobileControls'),
  movePad: document.getElementById('movePad'),
  lookPad: document.getElementById('lookPad'),
  mobileInteract: document.getElementById('mobileInteract')
};

const IS_TOUCH_DEVICE = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

const ALL_FLOORS = ['groundgloor', '1stfloor', '2ndfloor', '3rdfloor', '4thfloor', '5thfloor'];
const FLOOR_LABELS = ['Ground Floor', '1st Floor', '2nd Floor', '3rd Floor', '4th Floor', '5th Floor'];
const ENABLE_LIFT = false;
const SMART_BOARD_PLACEMENTS = {
  groundgloor: {
    'CLASSROOM G001': { x: 43.33, z: 6.48, yaw: 0 },
    'CLASSROOM G002': { x: 43.33, z: 5.96, yaw: 0 },
    'CLASSROOM G003': { x: 43.33, z: -15.56, yaw: 0 },
    'CLASSROOM G004': { x: 53.18, z: 6.26, yaw: 0 },
    'CLASSROOM G005': { x: 53.18, z: -3.14, yaw: 0 }
  },
  '3rdfloor': {
    'CLASSROOM 301': { x: 43.33, z: 15.56, yaw: 0 },
    'CLASSROOM 302': { x: 43.33, z: 15.56, yaw: Math.PI },
    'CLASSROOM 303': { x: 43.33, z: 6.26, yaw: Math.PI },
    'CLASSROOM 304': { x: 43.33, z: -6.14, yaw: Math.PI },
    'CLASSROOM 305': { x: 53.18, z: 15.56, yaw: Math.PI },
    'CLASSROOM 306': { x: 53.18, z: 6.26, yaw: Math.PI }
  },
  '5thfloor': {
    'CLASSROOM 506': { x: 44.20, z: -6.29, yaw: Math.PI },
    'CLASSROOM 507': { x: 53.73, z: -9.04, yaw: Math.PI }
  }
};

let scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); 
scene.fog = new THREE.FogExp2(0x87CEEB, 0.015);

let raycaster = new THREE.Raycaster();
let clock = new THREE.Clock();
let camera, renderer, ctrl = null;
const TEXTURE_CACHE = {};
const INSTANCED_MESHES = {};
let ROOM_LABELS = {};
let minimapWorld = null;
let flashlight = null;
let stormSystem = null;
let stormActive = false;
let emergencyLockdown = false;

// --- 2. PHYSICS & COLLISION ---
function CollisionSystem() {
  this.walls = [];
  this.ramps = [];
  this.clearances = [];
  this.addWall = function(x1, z1, x2, z2, t, yMin, yMax) { 
    this.walls.push({ x1, z1, x2, z2, half: t/2, yMin, yMax, active: true }); 
  };
  this.addClearance = function(x, z, r, yMin, yMax) {
    this.clearances.push({ x, z, r, yMin, yMax });
  };
  this.addRamp = function(cx, cz, y0, y1, angle, width, run, landing = 1.3) {
    this.ramps.push({ cx, cz, y0, y1, angle, width, run, landing });
  };
  this.move = function(pos, step, rad) {
    let n = pos.clone().add(step);
    for(const w of this.walls) {
      if(!w.active) continue;
      if(w.yMin !== undefined && (pos.y < w.yMin || pos.y - SETTINGS.playerHeight > w.yMax)) continue;
      let inDoorClearance = false;
      for (const c of this.clearances) {
        if (c.yMin !== undefined && (pos.y < c.yMin || pos.y - SETTINGS.playerHeight > c.yMax)) continue;
        if (Math.hypot(n.x - c.x, n.z - c.z) < c.r) { inDoorClearance = true; break; }
      }
      if (inDoorClearance && !w.isDoor) continue;
      const vx=w.x2-w.x1, vz=w.z2-w.z1;
      const l2=Math.max(1e-6, vx*vx+vz*vz);
      const t=Math.max(0, Math.min(1, ((n.x-w.x1)*vx+(n.z-w.z1)*vz)/l2));
      const px=w.x1+vx*t, pz=w.z1+vz*t;
      const dx=n.x-px, dz=n.z-pz;
      const dist=Math.hypot(dx, dz);
      if(dist < rad + w.half) { 
        const f = (rad+w.half-dist)/(dist||1e-4); 
        n.x+=dx*f; n.z+=dz*f; 
      }
    }
    return n;
  };
  this.getHeight = function(pos) {
    const feetY = pos.y - SETTINGS.playerHeight;
    let best = Math.max(0, Math.round(feetY / SETTINGS.floorHeight) * SETTINGS.floorHeight);
    for (const r of this.ramps) {
      // Only consider ramps close to current elevation to prevent jumping to distant floors.
      if (feetY < r.y0 - 0.6 || feetY > r.y1 + 1.0) continue;
      const dx = pos.x - r.cx;
      const dz = pos.z - r.cz;
      const ca = Math.cos(r.angle);
      const sa = Math.sin(r.angle);
      const lx = ca * dx + sa * dz;
      const lz = -sa * dx + ca * dz;
      if (Math.abs(lx) > r.width / 2 + SETTINGS.playerRadius) continue;
      if (lz < -r.run / 2 || lz > r.run / 2 + r.landing) continue;
      if (lz <= r.run / 2) {
        const t = THREE.MathUtils.clamp((lz + r.run / 2) / r.run, 0, 1);
        best = Math.max(best, THREE.MathUtils.lerp(r.y0, r.y1, t));
      } else {
        best = Math.max(best, r.y1);
      }
    }
    return best;
  };
}
const GLOBAL_COLLISION = new CollisionSystem();

// --- 3. UTILS & TEXTURES ---
async function loadJson(url) { try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.json() : []; } catch(e) { return []; } }
const toWorld = (v) => parseFloat(v) * SETTINGS.unitScale || 0;

function resizeMinimapCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, dpr };
}

function drawSimulationMinimap() {
  if (!UI.minimapCanvas || !minimapWorld || !ctrl) return;
  const ctx = UI.minimapCanvas.getContext('2d');
  const { width, height, dpr } = resizeMinimapCanvas(UI.minimapCanvas);
  const floorIdx = Math.max(0, Math.min(ALL_FLOORS.length - 1, Math.round((ctrl.pos.y - SETTINGS.playerHeight) / SETTINGS.floorHeight)));
  const floorKey = ALL_FLOORS[floorIdx];
  const floor = minimapWorld.floorDataMap.get(floorKey);
  if (!floor) return;

  const pad = 16 * dpr;
  const mapW = Math.max(1, floor.bounds.maxX - floor.bounds.minX);
  const mapH = Math.max(1, floor.bounds.maxZ - floor.bounds.minZ);
  const scale = Math.min((width - pad * 2) / mapW, (height - pad * 2) / mapH);
  const mapPixelW = mapW * scale;
  const mapPixelH = mapH * scale;
  const offsetX = (width - mapPixelW) / 2;
  const offsetY = (height - mapPixelH) / 2;
  const toCanvasX = (x) => offsetX + (x - floor.bounds.minX) * scale;
  const toCanvasY = (z) => offsetY + (z - floor.bounds.minZ) * scale;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.2 * dpr;
  ctx.strokeRect(offsetX, offsetY, mapPixelW, mapPixelH);

  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 2.2 * dpr;
  floor.walls.forEach((wall) => {
    ctx.beginPath();
    ctx.moveTo(toCanvasX(wall.x1), toCanvasY(wall.z1));
    ctx.lineTo(toCanvasX(wall.x2), toCanvasY(wall.z2));
    ctx.stroke();
  });

  ctx.strokeStyle = '#0ea5e9';
  ctx.lineWidth = 3 * dpr;
  floor.doors.forEach((door) => {
    ctx.beginPath();
    ctx.moveTo(toCanvasX(door.x1), toCanvasY(door.z1));
    ctx.lineTo(toCanvasX(door.x2), toCanvasY(door.z2));
    ctx.stroke();
  });

  const px = toCanvasX(ctrl.pos.x);
  const py = toCanvasY(ctrl.pos.z);
  const heading = -ctrl.yaw - Math.PI / 2;
  ctx.translate(px, py);
  ctx.rotate(heading);
  ctx.fillStyle = '#14b8a6';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  ctx.moveTo(9 * dpr, 0);
  ctx.lineTo(-7 * dpr, -6 * dpr);
  ctx.lineTo(-4 * dpr, 0);
  ctx.lineTo(-7 * dpr, 6 * dpr);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#0f172a';
  ctx.font = `${11 * dpr}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(FLOOR_LABELS[floorIdx], 10 * dpr, 17 * dpr);
}

function setupFlashlight() {
  flashlight = new THREE.SpotLight(0xffffff, 0, 18, Math.PI / 7, 0.45, 1.25);
  flashlight.position.set(0, -0.08, 0.12);
  flashlight.target.position.set(0, -0.12, -1);
  camera.add(flashlight);
  camera.add(flashlight.target);
}

function toggleFlashlight() {
  if (!flashlight) return;
  flashlight.intensity = flashlight.intensity > 0 ? 0 : 3.2;
}

function setupStormSystem() {
  const count = 900;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 42;
    positions[i * 3 + 1] = Math.random() * 18;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 42;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0x7dd3fc,
    size: 0.045,
    transparent: true,
    opacity: 0.68,
    depthWrite: false
  });
  const rain = new THREE.Points(geometry, material);
  rain.visible = false;
  rain.frustumCulled = false;
  scene.add(rain);

  const lightning = new THREE.DirectionalLight(0xbfdcff, 0);
  lightning.position.set(-30, 70, 20);
  scene.add(lightning);

  stormSystem = { rain, lightning, defaultFogDensity: scene.fog.density, defaultBackground: scene.background.clone() };
}

function toggleStorm() {
  if (!stormSystem) return;
  stormActive = !stormActive;
  stormSystem.rain.visible = stormActive;
  scene.fog.density = stormActive ? 0.026 : stormSystem.defaultFogDensity;
  scene.background = stormActive ? new THREE.Color(0x8fa7bd) : stormSystem.defaultBackground.clone();
}

function updateStorm(dt, t) {
  if (!stormSystem) return;
  stormSystem.lightning.intensity = Math.max(0, stormSystem.lightning.intensity - dt * 7);
  if (!stormActive || !ctrl) return;

  stormSystem.rain.position.set(ctrl.pos.x, ctrl.pos.y + 4, ctrl.pos.z);
  const attr = stormSystem.rain.geometry.attributes.position;
  for (let i = 0; i < attr.count; i++) {
    let y = attr.getY(i) - dt * 16;
    if (y < -1) y = 18;
    attr.setY(i, y);
  }
  attr.needsUpdate = true;

  if (Math.sin(t * 2.7) > 0.992) stormSystem.lightning.intensity = 1.7;
}

function activateEmergencyLockdown(world) {
  emergencyLockdown = !emergencyLockdown;

  if (emergencyLockdown) {
    (world.doorList || []).forEach((door) => {
      door.isOpen = false;
      door.targetRot = 0;
      if (door.colW) door.colW.active = true;
      (door.sideBlockers || []).forEach((b) => { b.active = true; });
    });
    (world.autoDoors || []).forEach((door) => { door.openUntil = 0; });
    (world.lifts || []).forEach((lift) => { lift.openUntil = 0; });
    UI.zoneName.innerText = 'Emergency lockdown active';
    return;
  }

  UI.zoneName.innerText = 'Emergency lockdown cleared';
}
const toNum = (v, def = 0) => { const n = parseFloat(v); return isNaN(n) ? def : n; };

function getTexture(name, type='solid', color1='#fff', color2='#eee') {
  if (TEXTURE_CACHE[name]) return TEXTURE_CACHE[name];
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const ctx = c.getContext('2d'); 
  if (type === 'tile') {
    ctx.fillStyle = color1; ctx.fillRect(0,0,512,512); ctx.strokeStyle = color2; ctx.lineWidth = 4;
    for(let i=0; i<=8; i++) { ctx.beginPath(); ctx.moveTo(i*64, 0); ctx.lineTo(i*64, 512); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i*64); ctx.lineTo(512, i*64); ctx.stroke(); }
  } else if (type === 'wood') {
    ctx.fillStyle = color1; ctx.fillRect(0,0,512,512); ctx.fillStyle = color2; 
    for(let i=0; i<60; i++) ctx.fillRect(0, Math.random()*512, 512, Math.random()*10);
  } else if (type === 'screen') {
    const isSmartBoard = name === 'smartBoardUI';
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, isSmartBoard ? '#f7fbff' : '#001a33');
    grad.addColorStop(1, isSmartBoard ? '#dce8f4' : '#00050a');
    ctx.fillStyle = grad; ctx.fillRect(0,0,512,512);
    if (isSmartBoard) {
      ctx.fillStyle = '#17212c'; ctx.fillRect(0, 0, 512, 44);
      ctx.fillStyle = '#f8fafc'; ctx.font = 'bold 22px Arial'; ctx.fillText('Smart Classroom', 24, 29);
      ctx.font = '18px Arial'; ctx.fillText('10:24 AM', 405, 29);
      ctx.fillStyle = '#1f4f7a'; ctx.font = 'bold 42px Arial'; ctx.fillText('Lecture Slide', 42, 115);
      ctx.fillStyle = '#2b3a4a'; ctx.font = '24px Arial'; ctx.fillText('Topic overview and key points', 42, 160);
      ctx.fillStyle = '#8bb8df'; ctx.fillRect(42, 205, 190, 18);
      ctx.fillStyle = '#b7cfe4'; ctx.fillRect(42, 245, 330, 14);
      ctx.fillRect(42, 280, 285, 14);
      ctx.fillRect(42, 315, 365, 14);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 18;
      ctx.beginPath(); ctx.moveTo(32, 470); ctx.lineTo(470, 36); ctx.stroke();
      ctx.strokeStyle = '#c8d8e6'; ctx.lineWidth = 4; ctx.strokeRect(18, 18, 476, 476);
    } else {
      ctx.strokeStyle = '#00ffcc'; ctx.lineWidth = 2;
      ctx.strokeRect(20, 20, 472, 472);
      ctx.fillStyle = 'rgba(0, 255, 204, 0.1)'; ctx.fillRect(40, 40, 200, 150);
      ctx.fillRect(270, 60, 200, 300);
      ctx.fillStyle = '#00ffcc'; ctx.font = 'bold 30px Arial'; ctx.fillText('SYSTEM READY', 60, 80);
      ctx.fillRect(20, 460, 472, 32); // Taskbar
    }
  } else { ctx.fillStyle = color1; ctx.fillRect(0,0,512,512); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  TEXTURE_CACHE[name] = t; return t;
}

const MATS = {
  corridor: new THREE.MeshStandardMaterial({ map: getTexture('corr', 'tile', '#e8ecef', '#ccc'), roughness: 0.1, metalness: 0.1 }),
  labFloor: new THREE.MeshStandardMaterial({ map: getTexture('labFloor', 'tile', '#d4d4d4', '#999'), roughness: 0.4 }),
  toiletFloor: new THREE.MeshStandardMaterial({ map: getTexture('toiletFloor', 'tile', '#8899a6', '#666'), roughness: 0.8 }),
  stairStone: new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.55, metalness: 0.05 }),
  railSteel: new THREE.MeshStandardMaterial({ color: 0xbfc6cc, roughness: 0.25, metalness: 0.88 }),
  wallPaint: new THREE.MeshStandardMaterial({ color: 0xf5f5dc, roughness: 0.9 }), 
  skirting: new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.7 }),
  wood: new THREE.MeshStandardMaterial({ map: getTexture('wood', 'wood', '#6b4226', '#4a2b16'), roughness: 0.7 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.8, roughness: 0.3 }),
  glass: new THREE.MeshStandardMaterial({ color: 0xadd8e6, transparent: true, opacity: 0.4, roughness: 0.1 }),
  corridorGlass: new THREE.MeshStandardMaterial({
    color: 0xd9f3ff,
    transparent: true,
    opacity: 0.38,
    roughness: 0.05,
    metalness: 0.12,
    envMapIntensity: 1.1,
    side: THREE.DoubleSide,
    depthWrite: false
  }),
  corridorFrame: new THREE.MeshStandardMaterial({ color: 0x1f252b, metalness: 0.78, roughness: 0.26 }),
  corridorBasePanel: new THREE.MeshStandardMaterial({ map: getTexture('corridorBasePanel', 'wood', '#8a603e', '#5f3d25'), roughness: 0.62 }),
  windowFrame: new THREE.MeshStandardMaterial({ color: 0x20262d, metalness: 0.65, roughness: 0.32 }),
  windowGlass: new THREE.MeshStandardMaterial({ color: 0x9fc7df, transparent: true, opacity: 0.46, roughness: 0.08, metalness: 0.18 }),
  white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }),
  ceiling: new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 1.0 }),
  plastic: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 }),
  pcScreen: new THREE.MeshStandardMaterial({ 
    map: getTexture('pcDisp', 'screen'), 
    emissive: 0x00ffcc, emissiveIntensity: 1.2, 
    emissiveMap: getTexture('pcDisp', 'screen'),
    roughness: 0.1, metalness: 0.5 
  })
};

// --- 4. ZONING & LABELS ---
const DEFAULT_ROOM_LABELS = {
  'groundgloor': {
     left: [
        "NCC ROOM",
        "GYMKHANA",
        "GYMKHANA",
        "NSS ROOM",
        "NSS ROOM",
        "CLASSROOM G001",
        "CLASSROOM G002",
        "CLASSROOM G003"
     ],
     right: [
        "CLASSROOM G004",
        "CLASSROOM G005",
        "LADIES TOILET",
        "CLASSROOM G003",
        "GENTS WASHROOM"
     ]
  }
};

function getRoomLabels(floorKey) {
  return ROOM_LABELS[floorKey] || DEFAULT_ROOM_LABELS[floorKey] || { left: [], right: [] };
}

function getZone(pos, elev) {
  const fIdx = Math.round(elev / SETTINGS.floorHeight);
  const floorKey = ALL_FLOORS[fIdx];
  const x = pos.x, z = pos.z;
  
  if (floorKey === 'groundgloor') {
     const isLeft = x < 45;
     const intervals = isLeft ? GROUND_FLOOR_ZONE_MODEL.left : GROUND_FLOOR_ZONE_MODEL.right;
     for (const it of intervals) {
       if (z <= it.zMax && z > it.zMin) return { name: it.label };
     }
     return { name: "Main Corridor" };
  }
  
  if (x > 50 && z < -8) return { name: "Restrooms" };
  if (x > 42 && x < 55 && z > -5 && z < 20) return { name: "Central Lobby" };
  
  // Refined Lab areas for upper floors (based on building footprint)
  if (z < -6) return { name: "Department Labs" };
  if (x < 42 && z > 20) return { name: "Department Labs" };
  
  return { name: "Main Corridor" };
}

function createTextTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;

  const ctx = canvas.getContext('2d');
  const label = String(text || '').trim().toUpperCase();

  ctx.fillStyle = '#071428';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;

  let fontSize = 92;
  ctx.font = `800 ${fontSize}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
  while (fontSize > 40 && ctx.measureText(label).width > canvas.width - 120) {
    fontSize -= 4;
    ctx.font = `800 ${fontSize}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
  }
  ctx.fillText(label, canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

function createNoticeTexture(title, notices) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 640;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#8a5a2b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#9f6b36';
  for (let i = 0; i < 120; i++) {
    ctx.globalAlpha = 0.08;
    ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, Math.random() * 90 + 20, 2);
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#18222f';
  ctx.fillRect(26, 22, 972, 82);
  ctx.fillStyle = '#f8fafc';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 44px Arial, sans-serif';
  ctx.fillText(String(title || 'NOTICE BOARD').toUpperCase(), canvas.width / 2, 64);

  const paperSpecs = [
    { x: 62, y: 142, w: 400, h: 178, color: '#fff8dc' },
    { x: 560, y: 136, w: 372, h: 164, color: '#edf6ff' },
    { x: 72, y: 372, w: 360, h: 150, color: '#f7f1ff' },
    { x: 536, y: 356, w: 406, h: 182, color: '#f0fff4' }
  ];

  paperSpecs.forEach((paper, idx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(paper.x + 8, paper.y + 10, paper.w, paper.h);
    ctx.fillStyle = paper.color;
    ctx.fillRect(paper.x, paper.y, paper.w, paper.h);
    ctx.fillStyle = '#cc2b2b';
    ctx.beginPath();
    ctx.arc(paper.x + paper.w / 2, paper.y + 16, 8, 0, Math.PI * 2);
    ctx.fill();

    const text = notices[idx] || '';
    const lines = String(text).split('\n');
    ctx.fillStyle = '#17212c';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '700 27px Arial, sans-serif';
    lines.forEach((line, lineIdx) => {
      ctx.fillText(line, paper.x + 28, paper.y + 42 + lineIdx * 38);
    });
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

function addSignBoard(text, position, yaw, width = 1.25, height = 0.28, bgColor = 0x1f2933) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = yaw;

  const board = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, 0.035),
    new THREE.MeshStandardMaterial({ color: bgColor, roughness: 0.42, metalness: 0.18 })
  );
  group.add(board);

  const textPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.08, height - 0.06),
    new THREE.MeshBasicMaterial({ map: createTextTexture(text), transparent: true })
  );
  textPlane.position.z = 0.02;
  group.add(textPlane);

  scene.add(group);
  return group;
}

function addNoticeBoard(title, notices, position, yaw) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = yaw;

  const width = 2.35;
  const height = 1.25;
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, 0.055),
    new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 0.58, metalness: 0.08 })
  );
  group.add(board);

  const cork = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.16, height - 0.14),
    new THREE.MeshStandardMaterial({
      map: createNoticeTexture(title, notices),
      roughness: 0.72,
      metalness: 0.02
    })
  );
  cork.position.z = 0.031;
  group.add(cork);

  scene.add(group);
  return group;
}

function addFloorNoticeBoards(floorIndex, floorKey, elev, walls) {
  if (floorKey === '2ndfloor') return;
  const floorLabel = FLOOR_LABELS[floorIndex] || 'Floor';
  const commonNotices = [
    'MID SEM NOTICE\nCheck timetable\non department portal',
    'ATTENDANCE\nMinimum 75 percent\nattendance required',
    'PLACEMENT CELL\nResume verification\nFriday 3:00 PM',
    'LIBRARY REMINDER\nReturn issued books\nbefore month end'
  ];
  const boardY = elev + 1.75;
  const entranceWall = snapSmartBoardToWall(new THREE.Vector3(49.43, boardY, 12.2), -Math.PI / 2, walls, 2.5);
  addNoticeBoard(`${floorLabel} Notices`, commonNotices, entranceWall.position, entranceWall.yaw);
}

function applyQualityProfile(mode) {
  if (!renderer) return;
  const quality = mode || 'performance';
  const ratio = quality === 'quality' ? 1.35 : quality === 'balanced' ? 1.0 : 0.75;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratio));
  renderer.shadowMap.enabled = quality === 'quality';
  SETTINGS.performanceMode = quality !== 'quality';
  scene.fog.density = quality === 'performance' ? 0.012 : 0.015;
}

// Nameplates/boards removed per request.

function buildGroundFloorDoorLabelMap(doorsData) {
  const labelByIndex = new Map();

  const labels = getRoomLabels('groundgloor');
  const leftLabels = (labels.left || []).slice();
  const rightLabels = (labels.right || []).slice();

  const doorPoints = doorsData
    .map((d, index) => {
      const x = toWorld(d.x);
      const z = toWorld(d.y);
      const w = toWorld(d.width || 100);
      return { index, x, z, w };
    })
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z) && p.w > 0.8);

  const left = doorPoints.filter((p) => p.x < 48).sort((a, b) => b.z - a.z);
  const right = doorPoints.filter((p) => p.x >= 48).sort((a, b) => b.z - a.z);

  for (let i = 0; i < left.length && i < leftLabels.length; i++) labelByIndex.set(left[i].index, leftLabels[i]);
  // Right side: target corridor-facing classroom/toilet doors (avoid lobby/front and deep internal doors).
  const rightCorridor = right
    .filter((p) => p.z <= 10.0 && p.z >= -10.5 && p.x <= 51.0 && p.w >= 1.0)
    .sort((a, b) => b.z - a.z);
  for (let i = 0; i < rightLabels.length && i < rightCorridor.length; i++) {
    labelByIndex.set(rightCorridor[i].index, rightLabels[i]);
  }

  return labelByIndex;
}

const GROUND_FLOOR_ZONE_MODEL = { left: [], right: [] };

function computeGroundFloorZoneModel(doorsData) {
  const labelMap = buildGroundFloorDoorLabelMap(doorsData);
  const points = doorsData
    .map((d, index) => ({ index, x: toWorld(d.x), z: toWorld(d.y), w: toWorld(d.width || 100) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z) && p.w > 0.8);

  const sideFromX = (x) => (x < 48 ? 'left' : 'right');
  const grouped = { left: [], right: [] };

  for (const p of points) {
    const label = labelMap.get(p.index);
    if (!label) continue;
    grouped[sideFromX(p.x)].push({ z: p.z, label });
  }

  const makeIntervals = (arr) => {
    const sorted = arr.slice().sort((a, b) => b.z - a.z);
    if (sorted.length === 0) return [];
    const mids = [];
    for (let i = 0; i < sorted.length - 1; i++) mids.push((sorted[i].z + sorted[i + 1].z) / 2);
    return sorted.map((item, idx) => {
      const zMax = idx === 0 ? Infinity : mids[idx - 1];
      const zMin = idx === sorted.length - 1 ? -Infinity : mids[idx];
      return { zMin, zMax, label: item.label };
    });
  };

  GROUND_FLOOR_ZONE_MODEL.left = makeIntervals(grouped.left);
  GROUND_FLOOR_ZONE_MODEL.right = makeIntervals(grouped.right);
}

function buildUpperFloorCorridorDoorLabelMap(floorKey, doorsData) {
  const floorNoMap = { '1stfloor': 1, '2ndfloor': 2, '3rdfloor': 3, '4thfloor': 4, '5thfloor': 5 };
  const floorNo = floorNoMap[floorKey];
  const labelByIndex = new Map();
  if (!floorNo) return labelByIndex;

  const allDoorPoints = doorsData
    .map((d, index) => ({ index, x: toWorld(d.x), z: toWorld(d.y), w: toWorld(d.width || 100) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z) && p.w > 0.8);

  const points = allDoorPoints
    // Keep only major corridor-facing room entries; skip narrow subroom doors.
    .filter((p) => p.w >= 1.2)
    .filter((p) => p.x >= 46.0 && p.x <= 50.6 && p.z >= (floorKey === '3rdfloor' ? -7.0 : -4.5) && p.z <= 22.0);

  const left = points.filter((p) => p.x < 48.2).sort((a, b) => b.z - a.z);
  const right = points.filter((p) => p.x >= 48.2).sort((a, b) => b.z - a.z);

  // Upper-floor washrooms: keep fixed, consistent labels at shared toilet-side doors.
  // These doors are near x≈50.55 with z around -4 and -10 on all copied floors.
  const wcCandidates = allDoorPoints
    .filter((p) => p.x >= 50.2 && p.x <= 50.9 && p.z <= -3.0 && p.z >= -11.2)
    .sort((a, b) => b.z - a.z);
  if (wcCandidates.length >= 1) labelByIndex.set(wcCandidates[0].index, 'LADIES WASHROOM');
  if (wcCandidates.length >= 2) labelByIndex.set(wcCandidates[1].index, 'GENTS WASHROOM');

  // Explicit 1st-floor room naming (corridor-facing labs only).
  if (floorKey === '1stfloor') {
    const floorLabels = getRoomLabels(floorKey);
    const leftNames = floorLabels.left || [];
    const rightNames = floorLabels.right || [];

    for (let i = 0; i < leftNames.length && i < left.length; i++) {
      labelByIndex.set(left[i].index, leftNames[i]);
    }

    const rightLabDoors = right
      .filter((p) => p.x < 50.2 && p.z <= 10.0 && p.z >= -4.5)
      .sort((a, b) => b.z - a.z);
    for (let i = 0; i < rightNames.length && i < rightLabDoors.length; i++) {
      labelByIndex.set(rightLabDoors[i].index, rightNames[i]);
    }

    return labelByIndex;
  }

  // Explicit 2nd-floor room naming (corridor-facing rooms only).
  if (floorKey === '2ndfloor') {
    const floorLabels = getRoomLabels(floorKey);
    const leftNames = floorLabels.left || [];
    const rightNames = floorLabels.right || [];

    const leftUnique = [];
    for (const p of left) {
      const dup = leftUnique.some((u) => Math.abs(u.x - p.x) < 0.12 && Math.abs(u.z - p.z) < 0.12);
      if (!dup) leftUnique.push(p);
    }

    for (let i = 0; i < leftNames.length && i < leftUnique.length; i++) {
      labelByIndex.set(leftUnique[i].index, leftNames[i]);
    }

    // Explicit right-side mapping for 2nd floor:
    // top right door -> LAB 206, lower right door -> LAB 207
    labelByIndex.set(3, rightNames[0] || 'LAB 206');
    labelByIndex.set(1, rightNames[1] || 'LAB 207');

    return labelByIndex;
  }

  // Explicit 4th-floor room naming (corridor-facing rooms only).
  if (floorKey === '4thfloor') {
    const floorLabels = getRoomLabels(floorKey);
    const leftNames = floorLabels.left || [];
    const rightNames = floorLabels.right || [];

    const leftUnique = [];
    for (const p of left) {
      const dup = leftUnique.some((u) => Math.abs(u.x - p.x) < 0.12 && Math.abs(u.z - p.z) < 0.12);
      if (!dup) leftUnique.push(p);
    }
    for (let i = 0; i < leftNames.length && i < leftUnique.length; i++) {
      labelByIndex.set(leftUnique[i].index, leftNames[i]);
    }
    labelByIndex.set(5, 'MEETING ROOM');

    const rightLabDoors = right
      .filter((p) => p.x < 50.2 && p.z <= 10.0 && p.z >= -4.5)
      .sort((a, b) => b.z - a.z);
    for (let i = 0; i < rightNames.length && i < rightLabDoors.length; i++) {
      labelByIndex.set(rightLabDoors[i].index, rightNames[i]);
    }

    return labelByIndex;
  }

  // Explicit 5th-floor classroom naming.
  if (floorKey === '5thfloor') {
    const floorLabels = getRoomLabels(floorKey);
    const leftNames = floorLabels.left || [];
    const rightNames = floorLabels.right || [];

    const leftDoors = allDoorPoints
      .filter((p) => p.x < 48.2 && p.w >= 1.2 && p.z <= 22.0 && p.z >= -7.0)
      .sort((a, b) => b.z - a.z);
    for (let i = 0; i < leftNames.length && i < leftDoors.length; i++) {
      labelByIndex.set(leftDoors[i].index, leftNames[i]);
    }

    const rightDoors = allDoorPoints
      .filter((p) => p.x >= 48.2 && p.x <= 51.0 && p.w > 0.8 && p.z <= 10.0 && p.z >= -7.0)
      .sort((a, b) => b.z - a.z);
    for (let i = 0; i < rightNames.length && i < rightDoors.length; i++) {
      labelByIndex.set(rightDoors[i].index, rightNames[i]);
    }

    return labelByIndex;
  }

  let seq = 1;
  const autoPrefix = floorKey === '3rdfloor' ? 'CLASSROOM' : 'ROOM';
  for (const p of left) {
    if (!labelByIndex.has(p.index)) labelByIndex.set(p.index, `${autoPrefix} ${floorNo}${String(seq++).padStart(2, '0')}`);
  }
  for (const p of right) {
    if (!labelByIndex.has(p.index)) labelByIndex.set(p.index, `${autoPrefix} ${floorNo}${String(seq++).padStart(2, '0')}`);
  }

  return labelByIndex;
}

// --- 5. INSTANCED MESH MANAGERS ---
function createInstanced(name, geometry, material, count) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Instanced shadowing is expensive at this scene scale.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData = { index: 0 };
  INSTANCED_MESHES[name] = mesh;
  scene.add(mesh);
  return mesh;
}

function addInstance(name, position, rotation, scale = new THREE.Vector3(1,1,1)) {
  const mesh = INSTANCED_MESHES[name];
  if (!mesh || mesh.userData.index >= mesh.count) return;
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), rotation);
  matrix.compose(position, q, scale);
  mesh.setMatrixAt(mesh.userData.index++, matrix);
}

function snapSmartBoardToWall(boardPos, yaw, walls, maxDistance = 4.0) {
  let best = null;
  for (const w of walls || []) {
    if (!w.p1 || !w.p2) continue;
    const vx = w.p2.x - w.p1.x;
    const vz = w.p2.z - w.p1.z;
    const l2 = vx * vx + vz * vz;
    if (l2 < 1e-6) continue;
    const tProj = Math.max(0, Math.min(1, ((boardPos.x - w.p1.x) * vx + (boardPos.z - w.p1.z) * vz) / l2));
    const px = w.p1.x + tProj * vx;
    const pz = w.p1.z + tProj * vz;
    const dx = boardPos.x - px;
    const dz = boardPos.z - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 > maxDistance * maxDistance) continue;
    if (!best || d2 < best.d2) best = { w, px, pz, d2 };
  }
  if (!best) return { position: boardPos, yaw };

  const wx = best.w.p2.x - best.w.p1.x;
  const wz = best.w.p2.z - best.w.p1.z;
  const wallLen = Math.hypot(wx, wz) || 1.0;
  const tx = wx / wallLen;
  const tz = wz / wallLen;
  let nx = -tz;
  let nz = tx;

  const desiredX = Math.sin(yaw);
  const desiredZ = Math.cos(yaw);
  if (nx * desiredX + nz * desiredZ < 0) {
    nx *= -1;
    nz *= -1;
  }

  const wallHalfThickness = 0.125;
  const boardBackDepth = 0.045;
  const mountOffset = wallHalfThickness + boardBackDepth;
  return {
    position: new THREE.Vector3(best.px + nx * mountOffset, boardPos.y, best.pz + nz * mountOffset),
    yaw: Math.atan2(nx, nz)
  };
}

function placeSmartBoardSetup(boardPos, yaw, elev) {
  addInstance('smartBoardFrame', boardPos, yaw);
  addInstance('smartBoardScreen', boardPos, yaw);
  addInstance('boardLightFixture', boardPos, yaw);

  const frontX = Math.sin(yaw);
  const frontZ = Math.cos(yaw);
  const deskPos = new THREE.Vector3(boardPos.x + frontX * 1.35, elev, boardPos.z + frontZ * 1.35);
  addInstance('table', deskPos, yaw, new THREE.Vector3(1.45, 1, 0.55));

  if (!SETTINGS.performanceMode) {
    const light = new THREE.PointLight(0xfff0cc, 0.45, 3.4, 1.8);
    light.position.set(boardPos.x + frontX * 0.35, elev + 2.20, boardPos.z + frontZ * 0.35);
    scene.add(light);
  }
}

function placeFixedClassroomSmartBoard(floorKey, roomName, elev, placedSet, walls) {
  if (placedSet.has(roomName)) return false;
  const board = SMART_BOARD_PLACEMENTS[floorKey]?.[roomName];
  if (!board) return false;

  const boardPos = new THREE.Vector3(board.x, elev, board.z);
  if (floorKey === 'groundgloor' && /^CLASSROOM G00[1-5]$/.test(roomName)) {
    placeSmartBoardSetup(boardPos, board.yaw, elev);
    placedSet.add(roomName);
    return true;
  }
  const snapped = snapSmartBoardToWall(boardPos, board.yaw, walls);
  placeSmartBoardSetup(snapped.position, snapped.yaw, elev);
  placedSet.add(roomName);
  return true;
}

function placeWindow(position, yaw, scale = new THREE.Vector3(1, 1, 1)) {
  addInstance('windowFrame', position, yaw, scale);
  addInstance('windowGlass', position, yaw, scale);
}

function placeWindowRun(x1, z1, x2, z2, elev, count, options = {}) {
  const y = elev + (options.y ?? 1.50);
  const scale = options.scale || new THREE.Vector3(1, 1, 1);
  const wallYaw = -Math.atan2(z2 - z1, x2 - x1);
  const frontYaw = options.yaw ?? wallYaw;
  for (let n = 0; n < count; n++) {
    const t = count === 1 ? 0.5 : (n + 1) / (count + 1);
    const x = THREE.MathUtils.lerp(x1, x2, t);
    const z = THREE.MathUtils.lerp(z1, z2, t);
    placeWindow(new THREE.Vector3(x, y, z), frontYaw, scale);
  }
}

function addExteriorWindowsForFloor(floorKey, elev) {
  const classroomScale = new THREE.Vector3(1.05, 1.0, 1.0);
  const corridorScale = new THREE.Vector3(1.35, 0.85, 1.0);
  const stairScale = new THREE.Vector3(0.95, 1.35, 1.0);
  const toiletScale = new THREE.Vector3(0.72, 0.45, 1.0);

  // West external classroom wall: repeated side windows, clear of smart-board walls.
  placeWindowRun(39.83, -14.6, 39.83, -7.2, elev, 3, { yaw: Math.PI / 2, scale: classroomScale });
  placeWindowRun(39.83, -1.4, 39.83, 4.8, elev, 3, { yaw: Math.PI / 2, scale: classroomScale });
  placeWindowRun(39.83, 7.2, 39.83, 14.2, elev, 3, { yaw: Math.PI / 2, scale: classroomScale });
  placeWindowRun(39.83, 16.8, 39.83, 23.0, elev, 2, { yaw: Math.PI / 2, scale: classroomScale });

  // East external classroom/corridor wall.
  placeWindowRun(56.93, -15.0, 56.93, -10.0, elev, 2, { yaw: -Math.PI / 2, scale: classroomScale });
  placeWindowRun(56.93, -1.6, 56.93, 4.8, elev, 3, { yaw: -Math.PI / 2, scale: classroomScale });
  placeWindowRun(56.93, 7.4, 56.93, 17.8, elev, 4, { yaw: -Math.PI / 2, scale: classroomScale });
  placeWindowRun(56.93, 19.8, 56.93, 23.2, elev, 1, { yaw: -Math.PI / 2, scale: corridorScale });

  // Main entrance and rear external corridors: aligned horizontal strip windows.
  placeWindowRun(40.9, 24.66, 46.0, 24.66, elev, 2, { yaw: Math.PI, scale: corridorScale });
  placeWindowRun(47.8, 24.66, 53.5, 24.66, elev, 2, { yaw: Math.PI, scale: corridorScale });
  placeWindowRun(41.4, -16.24, 47.6, -16.24, elev, 2, { yaw: 0, scale: corridorScale });

  // Lift/stair lobby gets taller vertical daylight windows.
  placeWindowRun(54.13, 20.1, 54.13, 23.4, elev, 1, { yaw: -Math.PI / 2, y: 1.65, scale: stairScale });

  // Toilet/privacy windows: small high-level openings.
  placeWindowRun(51.4, -16.24, 55.6, -16.24, elev, 3, { yaw: 0, y: 2.02, scale: toiletScale });
  placeWindowRun(56.93, -8.4, 56.93, -4.1, elev, 2, { yaw: -Math.PI / 2, y: 2.02, scale: toiletScale });
}

function addOutdoorEnvironment() {
  const trees = [
    [35.5, -13.5], [35.2, -4.0], [35.4, 8.5], [35.6, 20.5],
    [60.8, -12.0], [60.5, -1.5], [60.7, 10.5], [60.3, 22.0],
    [42.0, 29.0], [50.0, 29.4], [55.8, 28.8], [42.0, -20.6], [49.5, -21.2]
  ];
  trees.forEach(([x, z], idx) => {
    const scale = new THREE.Vector3(0.85 + (idx % 3) * 0.12, 1.0, 0.85 + (idx % 2) * 0.10);
    addInstance('treeTrunk', new THREE.Vector3(x, 0, z), 0, scale);
    addInstance('treeCanopy', new THREE.Vector3(x, 0, z), 0, scale);
  });
}

function pointInRotatedRect(px, pz, cx, cz, w, d, ang) {
  const dx = px - cx;
  const dz = pz - cz;
  const ca = Math.cos(-ang);
  const sa = Math.sin(-ang);
  const lx = ca * dx - sa * dz;
  const lz = sa * dx + ca * dz;
  return Math.abs(lx) <= w / 2 && Math.abs(lz) <= d / 2;
}

const GROUND_CLASSROOM_BENCH_LAYOUTS = [
  { name: 'G001', xMin: 39.95, xMax: 46.65, zMin: 6.45, zMax: 15.25, benchXs: [41.15, 43.32, 45.49], rowZs: [8.70, 10.00, 11.30, 12.60, 13.90], teacherChair: { x: 43.95, z: 6.95, yaw: Math.PI }, board: { x: 43.33, z: 6.48, yaw: 0 } },
  { name: 'G002', xMin: 39.95, xMax: 46.65, zMin: -3.00, zMax: 6.05, benchXs: [41.15, 43.32, 45.49], rowZs: [-0.95, 0.35, 1.65, 2.95, 4.25], teacherChair: { x: 43.95, z: -2.45, yaw: Math.PI }, board: { x: 43.33, z: -3.00, yaw: 0 } },
  { name: 'G003', xMin: 39.95, xMax: 48.45, zMin: -15.95, zMax: -3.35, benchXs: [41.15, 43.32, 45.49, 47.30], rowZs: [-14.55, -13.25, -11.95, -10.65, -9.35, -8.05], benchYaw: Math.PI, board: { x: 44.20, z: -6.29, yaw: Math.PI } },
  { name: 'G004', xMin: 49.65, xMax: 56.65, zMin: 6.45, zMax: 15.25, benchXs: [50.85, 53.05, 55.25], rowZs: [8.70, 10.00, 11.30, 12.60, 13.90], teacherChair: { x: 53.70, z: 6.95, yaw: Math.PI } },
  { name: 'G005', xMin: 49.65, xMax: 56.65, zMin: -3.00, zMax: 6.05, benchXs: [50.85, 53.05, 55.25], rowZs: [-0.95, 0.35, 1.65, 2.95, 4.25], teacherChair: { x: 53.70, z: -2.45, yaw: Math.PI } }
];

const THIRD_FLOOR_CLASSROOM_BENCH_LAYOUTS = [
  { name: '301', xMin: 39.80, xMax: 46.85, zMin: 15.55, zMax: 24.65, benchXs: [41.15, 43.32, 45.49], rowZs: [18.70, 20.00, 21.30, 22.60, 23.90], benchYaw: 0, benchYOffset: 0.28 },
  { name: '302', xMin: 39.80, xMax: 46.85, zMin: 6.25, zMax: 15.55, benchXs: [41.15, 43.32, 45.49], rowZs: [7.20, 8.50, 9.80, 11.10, 12.40], benchYaw: Math.PI, benchYOffset: 0.28 },
  { name: '303', xMin: 39.80, xMax: 46.85, zMin: -3.15, zMax: 6.25, benchXs: [41.15, 43.32, 45.49], rowZs: [-2.40, -1.10, 0.20, 1.50, 2.80], benchYaw: Math.PI, benchYOffset: 0.28 },
  { name: '304', xMin: 39.80, xMax: 48.85, zMin: -16.25, zMax: -6.15, benchXs: [41.15, 43.32, 45.49, 47.30], rowZs: [-14.55, -13.25, -11.95, -10.65, -9.35], benchYaw: Math.PI, benchYOffset: 0.28 },
  { name: '305', xMin: 49.40, xMax: 56.95, zMin: 6.25, zMax: 15.55, benchXs: [50.85, 53.05, 55.25], rowZs: [7.20, 8.50, 9.80, 11.10, 12.40], benchYaw: Math.PI, benchYOffset: 0.28 },
  { name: '306', xMin: 49.40, xMax: 56.95, zMin: -3.15, zMax: 6.25, benchXs: [50.85, 53.05, 55.25], rowZs: [-2.40, -1.10, 0.20, 1.50, 2.80], benchYaw: Math.PI, benchYOffset: 0.28 }
];

function getGroundClassroomBenchLayoutAt(x, z) {
  return GROUND_CLASSROOM_BENCH_LAYOUTS.find((room) =>
    x >= room.xMin && x <= room.xMax && z >= room.zMin && z <= room.zMax
  );
}

function getThirdFloorClassroomBenchLayoutAt(x, z) {
  return THIRD_FLOOR_CLASSROOM_BENCH_LAYOUTS.find((room) =>
    x >= room.xMin && x <= room.xMax && z >= room.zMin && z <= room.zMax
  );
}

function addCollisionBox(cx, cz, w, d, yaw, yMin, yMax) {
  const ca = Math.cos(yaw);
  const sa = Math.sin(yaw);
  const corners = [
    { x: -w / 2, z: -d / 2 },
    { x: w / 2, z: -d / 2 },
    { x: w / 2, z: d / 2 },
    { x: -w / 2, z: d / 2 }
  ].map((p) => ({
    x: cx + ca * p.x + sa * p.z,
    z: cz - sa * p.x + ca * p.z
  }));

  for (let k = 0; k < 4; k++) {
    const a = corners[k];
    const b = corners[(k + 1) % 4];
    GLOBAL_COLLISION.addWall(a.x, a.z, b.x, b.z, 0.12, yMin, yMax);
  }
}

function shouldSuppressGroundClassroomFurniture(floorKey, name, x, z) {
  const isGroundClassroom = floorKey === 'groundgloor' && getGroundClassroomBenchLayoutAt(x, z);
  const isThirdFloorClassroomSeat =
    floorKey === '3rdfloor' &&
    getThirdFloorClassroomBenchLayoutAt(x, z) &&
    (name.includes('chair') || name.includes('seat') || name.includes('bench'));
  if (!isGroundClassroom && !isThirdFloorClassroomSeat) return false;
  return (
    name.includes('chair') ||
    name.includes('seat') ||
    name.includes('bench') ||
    name.includes('table') ||
    name.includes('desk') ||
    name.includes('rack') ||
    name.includes('laptop') ||
    name.includes('pc') ||
    name.includes('monitor')
  );
}

function addGroundClassroomBenchDeskLayout(room, elev) {
  const yaw = room.benchYaw ?? 0;
  const benchElev = elev + (room.benchYOffset ?? 0);

  room.rowZs.forEach((z, rowIdx) => {
    room.benchXs.forEach((x, colIdx) => {
      const tone = 0.96 + ((rowIdx + colIdx) % 3) * 0.015;
      const scale = new THREE.Vector3(tone, 1, 1);
      const pos = new THREE.Vector3(x, benchElev, z);
      addInstance('benchDeskBlue', pos, yaw, scale);
      addInstance('benchDeskFrame', pos, yaw, scale);
      addCollisionBox(x, z, 1.34, 0.88, yaw, benchElev - 0.05, benchElev + 0.95);
    });
  });

  if (room.teacherChair) {
    const teacherChairPos = new THREE.Vector3(room.teacherChair.x, elev, room.teacherChair.z);
    addInstance('chair', teacherChairPos, room.teacherChair.yaw);
    addCollisionBox(teacherChairPos.x, teacherChairPos.z, 0.50, 0.52, Math.PI, elev - 0.05, elev + 0.85);
  }

  if (room.board) {
    if (room.name === 'G003') {
      const boardPos = new THREE.Vector3(room.board.x, elev, room.board.z);
      if (!room.hideBoard) {
        addInstance('smartBoardFrame', boardPos, room.board.yaw);
        addInstance('smartBoardScreen', boardPos, room.board.yaw);
        addInstance('boardLightFixture', boardPos, room.board.yaw);
      }
      if (room.teacherTable) {
        addInstance('table', new THREE.Vector3(room.teacherTable.x, elev, room.teacherTable.z), room.teacherTable.yaw, new THREE.Vector3(1.45, 1, 0.55));
        addCollisionBox(room.teacherTable.x, room.teacherTable.z, 1.45, 0.55, room.teacherTable.yaw, elev - 0.05, elev + 0.85);
      }
      return;
    } else {
      placeSmartBoardSetup(new THREE.Vector3(room.board.x, elev, room.board.z), room.board.yaw, elev);
    }
  }
}

const DEPARTMENT_LIBRARY_ROOM = {
  floorKey: '2ndfloor',
  xMin: 39.83,
  xMax: 46.83,
  zMin: 15.56,
  zMax: 19.66
};

const FOURTH_FLOOR_DEPARTMENT_LIBRARY_ROOM = {
  floorKey: '4thfloor',
  xMin: 39.83,
  xMax: 46.83,
  zMin: 10.66,
  zMax: 15.56
};

const SERVER_ROOM_AREAS = [
  { floorKey: '2ndfloor', xMin: 39.83, xMax: 46.83, zMin: 10.66, zMax: 15.56 }
];

function isDepartmentLibraryArea(floorKey, x, z) {
  const r = DEPARTMENT_LIBRARY_ROOM;
  return floorKey === r.floorKey && x >= r.xMin && x <= r.xMax && z >= r.zMin && z <= r.zMax;
}

function isFourthFloorDepartmentLibraryArea(floorKey, x, z) {
  const r = FOURTH_FLOOR_DEPARTMENT_LIBRARY_ROOM;
  return floorKey === r.floorKey && x >= r.xMin && x <= r.xMax && z >= r.zMin && z <= r.zMax;
}

function isServerRoomArea(floorKey, x, z) {
  return SERVER_ROOM_AREAS.some((r) =>
    floorKey === r.floorKey && x >= r.xMin && x <= r.xMax && z >= r.zMin && z <= r.zMax
  );
}

function localToWorld2D(cx, cz, yaw, lx, lz) {
  const ca = Math.cos(yaw);
  const sa = Math.sin(yaw);
  return {
    x: cx + ca * lx + sa * lz,
    z: cz - sa * lx + ca * lz
  };
}

function addLibraryBookshelf(cx, cz, yaw, elev, width, depth, options = {}) {
  const shelfMat = new THREE.MeshStandardMaterial({ color: options.wallMounted ? 0xc9ad7f : 0xb88b55, roughness: 0.74, metalness: 0.03 });
  const bookColors = [0x24476f, 0x7e2f2f, 0x1f2933, 0xf0ece2, 0x6b7280, 0x3b5f4a, 0x8a5a2b, 0x2f3e63];
  const group = new THREE.Group();
  group.position.set(cx, elev + (options.wallMounted ? 0.42 : 0), cz);
  group.rotation.y = yaw;

  const h = options.height ?? 2.05;
  const t = 0.065;
  const shelfLevels = options.levels ?? 5;
  const sideH = h;
  const backDepth = options.wallMounted ? 0.035 : 0.055;

  const parts = [
    new THREE.BoxGeometry(width, t, depth).translate(0, t / 2, 0),
    new THREE.BoxGeometry(width, t, depth).translate(0, h, 0),
    new THREE.BoxGeometry(t, sideH, depth).translate(-width / 2 + t / 2, sideH / 2, 0),
    new THREE.BoxGeometry(t, sideH, depth).translate(width / 2 - t / 2, sideH / 2, 0),
    new THREE.BoxGeometry(width, sideH, backDepth).translate(0, sideH / 2, -depth / 2 + backDepth / 2)
  ];

  for (let i = 1; i < shelfLevels; i++) {
    const y = (h / shelfLevels) * i;
    parts.push(new THREE.BoxGeometry(width - t * 1.4, t, depth).translate(0, y, 0));
  }

  const shelf = new THREE.Mesh(mergeGeometries(parts), shelfMat);
  shelf.castShadow = true;
  shelf.receiveShadow = true;
  group.add(shelf);

  const usableW = width - t * 2.5;
  for (let level = 0; level < shelfLevels; level++) {
    const baseY = t + level * (h / shelfLevels);
    let cursor = -usableW / 2 + 0.05;
    let bookIdx = 0;
    while (cursor < usableW / 2 - 0.12) {
      const makeStack = (level + bookIdx) % 9 === 0 && cursor < usableW / 2 - 0.45;
      if (makeStack) {
        const stackW = 0.34;
        const stackCount = 2 + ((level + bookIdx) % 3);
        for (let s = 0; s < stackCount; s++) {
          const book = new THREE.Mesh(
            new THREE.BoxGeometry(stackW, 0.035, 0.20 + ((s + level) % 2) * 0.04),
            new THREE.MeshStandardMaterial({ color: bookColors[(level * 3 + bookIdx + s) % bookColors.length], roughness: 0.68 })
          );
          book.position.set(cursor + stackW / 2, baseY + 0.035 + s * 0.04, 0.02 + ((s % 2) * 0.035));
          group.add(book);
        }
        cursor += stackW + 0.055;
      } else {
        const bw = 0.055 + ((level + bookIdx) % 4) * 0.014;
        const bh = 0.22 + ((level * 2 + bookIdx) % 5) * 0.035;
        const bd = 0.19 + ((level + bookIdx) % 3) * 0.035;
        const book = new THREE.Mesh(
          new THREE.BoxGeometry(bw, bh, bd),
          new THREE.MeshStandardMaterial({ color: bookColors[(level * 7 + bookIdx) % bookColors.length], roughness: 0.62 })
        );
        book.position.set(cursor + bw / 2, baseY + t / 2 + bh / 2, 0.03 + ((bookIdx % 3) - 1) * 0.025);
        book.rotation.z = ((bookIdx % 7) - 3) * 0.018;
        group.add(book);
        cursor += bw + 0.018 + ((bookIdx + level) % 3) * 0.01;
      }
      bookIdx++;
    }
  }

  scene.add(group);

  if (!options.wallMounted) {
    addCollisionBox(cx, cz, width, depth, yaw, elev - 0.05, elev + h + 0.05);
  }
}

function addDepartmentLibraryInterior(elev) {
  const shelves = [
    { x: 39.98, z: 16.60, yaw: Math.PI / 2, w: 1.65, d: 0.30, wallMounted: true },
    { x: 39.98, z: 18.35, yaw: Math.PI / 2, w: 1.80, d: 0.30, wallMounted: true },
    { x: 41.35, z: 19.51, yaw: 0, w: 2.10, d: 0.30, wallMounted: true },
    { x: 43.60, z: 19.51, yaw: 0, w: 2.10, d: 0.30, wallMounted: true },
    { x: 45.65, z: 19.51, yaw: 0, w: 1.55, d: 0.30, wallMounted: true },
    { x: 41.65, z: 15.71, yaw: 0, w: 2.45, d: 0.30, wallMounted: true },
    { x: 44.35, z: 15.71, yaw: 0, w: 2.15, d: 0.30, wallMounted: true },
    { x: 46.68, z: 18.15, yaw: Math.PI / 2, w: 1.85, d: 0.30, wallMounted: true }
  ];
  shelves.forEach((s) => addLibraryBookshelf(s.x, s.z, s.yaw, elev, s.w, s.d, { wallMounted: true, levels: 4 }));

  if (!SETTINGS.performanceMode) {
    [
      [41.15, 18.75], [43.05, 18.75], [44.95, 18.75], [42.45, 16.45], [45.15, 16.85]
    ].forEach(([x, z]) => {
      const light = new THREE.PointLight(0xffe4ba, 0.42, 3.2, 1.6);
      light.position.set(x, elev + 2.55, z);
      scene.add(light);
    });
  }
}

function addFourthFloorDepartmentLibraryInterior(elev) {
  const shelves = [
    // Wall-touching book shelves.
    { x: 40.02, z: 12.10, yaw: Math.PI / 2, w: 2.15, d: 0.30, wallMounted: true },
    { x: 40.02, z: 11.15, yaw: Math.PI / 2, w: 1.85, d: 0.30, wallMounted: true },
    { x: 40.02, z: 14.30, yaw: Math.PI / 2, w: 2.05, d: 0.30, wallMounted: true },
    { x: 41.70, z: 10.82, yaw: 0, w: 2.65, d: 0.30, wallMounted: true },
    { x: 44.55, z: 10.82, yaw: 0, w: 2.55, d: 0.30, wallMounted: true },
    { x: 41.95, z: 15.40, yaw: 0, w: 2.55, d: 0.30, wallMounted: true },
    { x: 44.70, z: 15.40, yaw: 0, w: 2.15, d: 0.30, wallMounted: true },
    { x: 46.68, z: 11.10, yaw: Math.PI / 2, w: 1.75, d: 0.30, wallMounted: true },
    // Parallel freestanding rows. Center gaps are > 1m after shelf depth.
    { x: 41.05, z: 13.05, yaw: Math.PI / 2, w: 3.05, d: 0.42 },
    { x: 42.55, z: 13.05, yaw: Math.PI / 2, w: 3.05, d: 0.42 },
    { x: 44.05, z: 13.05, yaw: Math.PI / 2, w: 3.05, d: 0.42 },
    { x: 45.55, z: 13.00, yaw: Math.PI / 2, w: 2.70, d: 0.42 }
  ];

  shelves.forEach((s) => addLibraryBookshelf(
    s.x,
    s.z,
    s.yaw,
    elev,
    s.w,
    s.d,
    { wallMounted: !!s.wallMounted, levels: s.wallMounted ? 4 : 5, height: s.wallMounted ? 1.75 : 2.05 }
  ));

  if (!SETTINGS.performanceMode) {
    [
      [41.25, 14.75], [42.75, 14.75], [44.25, 14.75], [45.75, 14.65],
      [41.85, 11.30], [44.50, 11.30]
    ].forEach(([x, z]) => {
      const light = new THREE.PointLight(0xffe1b8, 0.36, 3.1, 1.55);
      light.position.set(x, elev + 2.55, z);
      scene.add(light);
    });
  }
}

function addServerRack(cx, cz, yaw, elev, options = {}) {
  const group = new THREE.Group();
  group.position.set(cx, elev, cz);
  group.rotation.y = yaw;

  const cabinetMat = new THREE.MeshStandardMaterial({ color: 0x171b20, roughness: 0.46, metalness: 0.55 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2c333b, roughness: 0.38, metalness: 0.72 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0d1822, transparent: true, opacity: 0.36, roughness: 0.12, metalness: 0.18 });
  const w = options.width ?? 0.78;
  const d = options.depth ?? 0.72;
  const h = options.height ?? 2.05;

  const frame = mergeGeometries([
    new THREE.BoxGeometry(w, h, 0.055).translate(0, h / 2, -d / 2 + 0.027),
    new THREE.BoxGeometry(w, 0.07, d).translate(0, h - 0.035, 0),
    new THREE.BoxGeometry(w, 0.07, d).translate(0, 0.035, 0),
    new THREE.BoxGeometry(0.07, h, d).translate(-w / 2 + 0.035, h / 2, 0),
    new THREE.BoxGeometry(0.07, h, d).translate(w / 2 - 0.035, h / 2, 0)
  ]);
  const rack = new THREE.Mesh(frame, cabinetMat);
  rack.castShadow = true;
  rack.receiveShadow = true;
  group.add(rack);

  const door = new THREE.Mesh(new THREE.BoxGeometry(w - 0.13, h - 0.18, 0.035), glassMat);
  door.position.set(0, h / 2, d / 2 + 0.012);
  group.add(door);

  const serverColors = [0x242b33, 0x303944, 0x11161c, 0x38414b];
  for (let i = 0; i < 10; i++) {
    const unitH = 0.105 + (i % 3) * 0.018;
    const y = 0.23 + i * 0.165;
    const unit = new THREE.Mesh(
      new THREE.BoxGeometry(w - 0.20, unitH, 0.08),
      new THREE.MeshStandardMaterial({ color: serverColors[i % serverColors.length], roughness: 0.42, metalness: 0.42 })
    );
    unit.position.set(0, y, d / 2 + 0.038);
    group.add(unit);

    const ledColor = i % 4 === 0 ? 0xffb84a : i % 3 === 0 ? 0x4aa3ff : 0x51d66b;
    const led = new THREE.Mesh(
      new THREE.BoxGeometry(0.032, 0.018, 0.012),
      new THREE.MeshBasicMaterial({ color: ledColor })
    );
    led.position.set(-w / 2 + 0.16 + (i % 2) * 0.055, y + unitH * 0.12, d / 2 + 0.088);
    group.add(led);
  }

  const ventMat = new THREE.MeshStandardMaterial({ color: 0x0b0e12, roughness: 0.7, metalness: 0.35 });
  for (let i = 0; i < 5; i++) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(w - 0.24, 0.018, 0.012), ventMat);
    vent.position.set(0, h - 0.38 - i * 0.07, d / 2 + 0.09);
    group.add(vent);
  }

  scene.add(group);
  addCollisionBox(cx, cz, w, d, yaw, elev - 0.05, elev + h + 0.05);
}

function addStorageCupboard(cx, cz, yaw, elev, width = 0.9) {
  const group = new THREE.Group();
  group.position.set(cx, elev, cz);
  group.rotation.y = yaw;
  const h = 1.85;
  const d = 0.42;
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xb9aa8e, roughness: 0.66, metalness: 0.05 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x6f6252, roughness: 0.58, metalness: 0.12 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, h, d), bodyMat);
  body.position.y = h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  [-0.25, 0.25].forEach((side) => {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.018, h - 0.18, 0.018), trimMat);
    seam.position.set(side * width, h / 2, d / 2 + 0.014);
    group.add(seam);
  });
  [0.58, 1.15].forEach((y) => {
    const shelfLine = new THREE.Mesh(new THREE.BoxGeometry(width - 0.08, 0.018, 0.02), trimMat);
    shelfLine.position.set(0, y, d / 2 + 0.016);
    group.add(shelfLine);
  });
  const handleMat = new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.35, metalness: 0.7 });
  [-0.09, 0.09].forEach((x) => {
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.28, 0.035), handleMat);
    handle.position.set(x, 0.98, d / 2 + 0.04);
    group.add(handle);
  });

  scene.add(group);
  addCollisionBox(cx, cz, width, d, yaw, elev - 0.05, elev + h + 0.05);
}

function addServerRoomInterior(elev) {
  [
    [40.55, 14.95, 0], [41.55, 14.95, 0], [42.55, 14.95, 0],
    [40.55, 11.15, Math.PI], [41.55, 11.15, Math.PI], [42.55, 11.15, Math.PI],
    [45.92, 12.25, -Math.PI / 2], [45.92, 13.25, -Math.PI / 2]
  ].forEach(([x, z, yaw]) => addServerRack(x, z, yaw, elev));

  addStorageCupboard(44.15, 14.96, 0, elev, 1.05);
  addStorageCupboard(45.20, 14.96, 0, elev, 1.05);
  addStorageCupboard(39.98, 12.25, Math.PI / 2, elev, 0.85);

  addInstance('table', new THREE.Vector3(44.45, elev, 11.35), Math.PI, new THREE.Vector3(1.15, 1, 0.65));
  addCollisionBox(44.45, 11.35, 1.15, 0.65, Math.PI, elev - 0.05, elev + 0.85);
  addInstance('pcBody', new THREE.Vector3(44.45, elev, 11.35), Math.PI);
  addInstance('pcScreen', new THREE.Vector3(44.45, elev, 11.35), Math.PI);
  addInstance('chair', new THREE.Vector3(44.45, elev, 10.82), 0);

  if (!SETTINGS.performanceMode) {
    [
      [40.75, 13.2], [42.65, 13.2], [44.65, 13.3]
    ].forEach(([x, z]) => {
      const light = new THREE.PointLight(0xddeeff, 0.36, 3.4, 1.6);
      light.position.set(x, elev + 2.45, z);
      scene.add(light);
    });
  }
}

function initInstancedMeshes(totalFloors) {
  const chairGeo = mergeGeometries([
    new THREE.BoxGeometry(0.44, 0.035, 0.42).translate(0, 0.45, 0),
    new THREE.BoxGeometry(0.40, 0.40, 0.035).translate(0, 0.68, -0.18),
    new THREE.CylinderGeometry(0.018, 0.018, 0.45, 10).translate(-0.19, 0.225, -0.16),
    new THREE.CylinderGeometry(0.018, 0.018, 0.45, 10).translate(0.19, 0.225, -0.16),
    new THREE.CylinderGeometry(0.018, 0.018, 0.45, 10).translate(-0.19, 0.225, 0.16),
    new THREE.CylinderGeometry(0.018, 0.018, 0.45, 10).translate(0.19, 0.225, 0.16),
    new THREE.CylinderGeometry(0.012, 0.012, 0.42, 8).rotateZ(Math.PI / 2).translate(0, 0.26, -0.16),
    new THREE.CylinderGeometry(0.012, 0.012, 0.42, 8).rotateZ(Math.PI / 2).translate(0, 0.26, 0.16)
  ]);
  createInstanced('chair', chairGeo, new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.55, metalness: 0.15 }), 1200 * totalFloors); 

  // Realistic Lab/Office Table: Slim top, Metal frame, Modesty panel
  const tableGeo = mergeGeometries([
    new THREE.BoxGeometry(1.0, 0.03, 1.0).translate(0, 0.74, 0), // Top (1m x 1m base for scaling)
    new THREE.BoxGeometry(0.94, 0.04, 0.04).translate(0, 0.70, 0.45), // Frame Front
    new THREE.BoxGeometry(0.94, 0.04, 0.04).translate(0, 0.70, -0.45), // Frame Back
    new THREE.BoxGeometry(0.04, 0.04, 0.86).translate(0.45, 0.70, 0), // Frame Left
    new THREE.BoxGeometry(0.04, 0.04, 0.86).translate(-0.45, 0.70, 0), // Frame Right
    new THREE.CylinderGeometry(0.025, 0.025, 0.72, 12).translate(-0.46, 0.36, -0.46), // Leg
    new THREE.CylinderGeometry(0.025, 0.025, 0.72, 12).translate(0.46, 0.36, -0.46), // Leg
    new THREE.CylinderGeometry(0.025, 0.025, 0.72, 12).translate(-0.46, 0.36, 0.46), // Leg
    new THREE.CylinderGeometry(0.025, 0.025, 0.72, 12).translate(0.46, 0.36, 0.46), // Leg
    new THREE.BoxGeometry(0.9, 0.4, 0.015).translate(0, 0.52, -0.45) // Modesty Panel
  ]);
  createInstanced('table', tableGeo, new THREE.MeshStandardMaterial({ color: 0xdcdcdc, roughness: 0.2, metalness: 0.2 }), 1000 * totalFloors);

  const bigTableGeo = mergeGeometries([
    new THREE.BoxGeometry(3.0, 0.06, 1.5).translate(0, 0.75, 0),
    new THREE.BoxGeometry(0.1, 0.75, 0.1).translate(-1.4, 0.375, -0.65),
    new THREE.BoxGeometry(0.1, 0.75, 0.1).translate(1.4, 0.375, -0.65),
    new THREE.BoxGeometry(0.1, 0.75, 0.1).translate(-1.4, 0.375, 0.65),
    new THREE.BoxGeometry(0.1, 0.75, 0.1).translate(1.4, 0.375, 0.65)
  ]);
  createInstanced('bigTable', bigTableGeo, MATS.wood, 100 * totalFloors);

  const pcBodyGeo = mergeGeometries([
    new THREE.BoxGeometry(0.50, 0.32, 0.04).translate(0, 0.98, -0.065), // Monitor Frame
    new THREE.CylinderGeometry(0.015, 0.015, 0.18, 12).translate(0, 0.84, -0.06), // Stand
    new THREE.BoxGeometry(0.22, 0.02, 0.16).translate(0, 0.755, -0.03), // Base (on table)
    new THREE.BoxGeometry(0.44, 0.02, 0.16).translate(0, 0.76, 0.22), // Keyboard
    new THREE.BoxGeometry(0.06, 0.015, 0.11).translate(0.28, 0.76, 0.22), // Mouse
    new THREE.BoxGeometry(0.18, 0.48, 0.45).translate(0.55, 0.24, -0.05) // Tower (on floor)
  ]);
  createInstanced('pcBody', pcBodyGeo, MATS.plastic, 1000 * totalFloors);

  const pcScreenGeo = new THREE.BoxGeometry(0.46, 0.28, 0.01).translate(0, 0.98, -0.046);
  createInstanced('pcScreen', pcScreenGeo, MATS.pcScreen, 1000 * totalFloors);

  const laptopGeo = mergeGeometries([
    new THREE.BoxGeometry(0.32, 0.025, 0.24).translate(0, 0.77, 0.02), // Base
    new THREE.BoxGeometry(0.32, 0.20, 0.02).rotateX(-0.35).translate(0, 0.88, -0.09) // Screen
  ]);
  createInstanced('laptop', laptopGeo, new THREE.MeshStandardMaterial({ color: 0x1d242d, roughness: 0.4, metalness: 0.3 }), 1200 * totalFloors);

  const benchDeskBlueGeo = mergeGeometries([
    new THREE.BoxGeometry(1.32, 0.055, 0.46).translate(0, 0.76, -0.24),
    new THREE.BoxGeometry(1.22, 0.07, 0.34).translate(0, 0.46, 0.28),
    new THREE.BoxGeometry(1.22, 0.08, 0.12).rotateX(-0.18).translate(0, 0.74, 0.43)
  ]);
  createInstanced('benchDeskBlue', benchDeskBlueGeo, new THREE.MeshStandardMaterial({ color: 0x2d78bd, roughness: 0.42, metalness: 0.08 }), 160 * totalFloors);

  const benchDeskFrameGeo = mergeGeometries([
    new THREE.BoxGeometry(1.16, 0.34, 0.025).translate(0, 0.55, -0.43),
    new THREE.CylinderGeometry(0.022, 0.022, 0.72, 10).translate(-0.58, 0.36, -0.43),
    new THREE.CylinderGeometry(0.022, 0.022, 0.72, 10).translate(0.58, 0.36, -0.43),
    new THREE.CylinderGeometry(0.022, 0.022, 0.46, 10).translate(-0.52, 0.23, 0.16),
    new THREE.CylinderGeometry(0.022, 0.022, 0.46, 10).translate(0.52, 0.23, 0.16),
    new THREE.CylinderGeometry(0.018, 0.018, 1.16, 10).rotateZ(Math.PI / 2).translate(0, 0.72, -0.43),
    new THREE.CylinderGeometry(0.018, 0.018, 1.16, 10).rotateZ(Math.PI / 2).translate(0, 0.43, 0.16),
    new THREE.CylinderGeometry(0.016, 0.016, 0.72, 10).rotateX(Math.PI / 2).translate(-0.58, 0.56, -0.08),
    new THREE.CylinderGeometry(0.016, 0.016, 0.72, 10).rotateX(Math.PI / 2).translate(0.58, 0.56, -0.08)
  ]);
  createInstanced('benchDeskFrame', benchDeskFrameGeo, new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.34, metalness: 0.55 }), 160 * totalFloors);

  const boardCenterY = 1.50;
  const boardOuterW = 2.05;
  const boardOuterH = 1.00;
  const boardScreenW = 1.88;
  const boardScreenH = 0.84;
  const smartBoardFrameGeo = mergeGeometries([
    new THREE.BoxGeometry(boardOuterW, boardOuterH, 0.05).translate(0, boardCenterY, -0.015), // 205cm x 100cm classroom board
    new THREE.BoxGeometry(boardOuterW + 0.05, 0.045, 0.07).translate(0, 1.00, 0.01),  // Bottom rail
    new THREE.BoxGeometry(0.045, boardOuterH, 0.065).translate(boardOuterW / 2 - 0.035, boardCenterY, 0.0), // Side trim
    new THREE.BoxGeometry(0.045, boardOuterH, 0.065).translate(-boardOuterW / 2 + 0.035, boardCenterY, 0.0)
  ]);
  createInstanced('smartBoardFrame', smartBoardFrameGeo, new THREE.MeshStandardMaterial({ color: 0x171b21, roughness: 0.42, metalness: 0.25 }), 160 * totalFloors);

  const smartBoardScreenGeo = new THREE.BoxGeometry(boardScreenW, boardScreenH, 0.018).translate(0, boardCenterY, 0.03);
  createInstanced('smartBoardScreen', smartBoardScreenGeo, new THREE.MeshStandardMaterial({
    map: getTexture('smartBoardUI', 'screen'),
    emissive: 0x8ab9ff,
    emissiveIntensity: 0.16,
    roughness: 0.18,
    metalness: 0.22
  }), 160 * totalFloors);

  const boardLightFixtureGeo = mergeGeometries([
    new THREE.BoxGeometry(1.55, 0.045, 0.06).translate(0, 2.08, 0.13),
    new THREE.BoxGeometry(1.35, 0.018, 0.035).translate(0, 2.045, 0.16)
  ]);
  createInstanced('boardLightFixture', boardLightFixtureGeo, new THREE.MeshStandardMaterial({
    color: 0xe8e2d6,
    emissive: 0xffe6aa,
    emissiveIntensity: 0.22,
    roughness: 0.35,
    metalness: 0.2
  }), 160 * totalFloors);

  const toiletGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.2, 0.15, 0.45, 16).translate(0, 0.225, 0.1),
    new THREE.BoxGeometry(0.4, 0.4, 0.2).translate(0, 0.4, -0.15)
  ]);
  createInstanced('toilet', toiletGeo, MATS.white, 200 * totalFloors);

  const basinGeo = mergeGeometries([
    new THREE.BoxGeometry(0.6, 0.15, 0.45).translate(0, 0.85, 0),
    new THREE.CylinderGeometry(0.2, 0.2, 0.1, 16).translate(0, 0.9, 0),
    new THREE.BoxGeometry(0.1, 0.85, 0.1).translate(0, 0.425, 0)
  ]);
  createInstanced('basin', basinGeo, MATS.white, 100 * totalFloors);

  const windowFrameGeo = mergeGeometries([
    new THREE.BoxGeometry(1.65, 0.07, 0.10).translate(0, 0.62, 0),
    new THREE.BoxGeometry(1.65, 0.07, 0.10).translate(0, -0.62, 0),
    new THREE.BoxGeometry(0.07, 1.24, 0.10).translate(0.79, 0, 0),
    new THREE.BoxGeometry(0.07, 1.24, 0.10).translate(-0.79, 0, 0),
    new THREE.BoxGeometry(0.045, 1.14, 0.08).translate(0, 0, 0.01),
    new THREE.BoxGeometry(1.50, 0.035, 0.08).translate(0, 0, 0.012)
  ]);
  createInstanced('windowFrame', windowFrameGeo, MATS.windowFrame, 360 * totalFloors);

  const windowGlassGeo = new THREE.BoxGeometry(1.48, 1.08, 0.035).translate(0, 0, 0.015);
  createInstanced('windowGlass', windowGlassGeo, MATS.windowGlass, 360 * totalFloors);

  const treeTrunkGeo = new THREE.CylinderGeometry(0.08, 0.11, 1.0, 8).translate(0, 0.5, 0);
  createInstanced('treeTrunk', treeTrunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a3822, roughness: 0.8 }), 80);
  const treeCanopyGeo = new THREE.SphereGeometry(0.55, 12, 8).translate(0, 1.35, 0);
  createInstanced('treeCanopy', treeCanopyGeo, new THREE.MeshStandardMaterial({ color: 0x2f7a3f, roughness: 0.9 }), 80);
}

// Smart screens removed per request.

function stitchWallGaps(wallsWithPoints, maxGap = 0.35) {
  const degree = new Map();
  for (const w of wallsWithPoints) {
    if (!w.p1 || !w.p2) continue;
    degree.set(w.p1, (degree.get(w.p1) || 0) + 1);
    degree.set(w.p2, (degree.get(w.p2) || 0) + 1);
  }

  const singles = [];
  for (const [pt, deg] of degree.entries()) if (deg === 1) singles.push(pt);

  const used = new Set();
  const added = [];

  for (let i = 0; i < singles.length; i++) {
    const a = singles[i];
    if (used.has(a)) continue;
    let best = null;
    let bestD = Infinity;
    for (let j = i + 1; j < singles.length; j++) {
      const b = singles[j];
      if (used.has(b)) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best && bestD <= maxGap) {
      used.add(a);
      used.add(best);
      added.push({ p1: a, p2: best, _synthetic: true });
    }
  }

  wallsWithPoints.push(...added);
  return added.length;
}

// Main entrance is represented by an actual door in `doors.json` (front facade opening),
// not by stitching arbitrary wall endpoint gaps.

function isUpperFloorCorridorGlassWall(floorKey, s) {
  const glassFloors = new Set(['1stfloor', '2ndfloor', '4thfloor', '5thfloor']);
  if (!glassFloors.has(floorKey)) return false;
  const midX = (s.x1 + s.x2) * 0.5;
  const midZ = (s.z1 + s.z2) * 0.5;
  const verticalRun = Math.abs(s.x2 - s.x1) < 0.18;
  const insideMainCorridorLength = midZ > -3.45 && midZ < 24.8;
  const leftRoomFront = Math.abs(midX - 46.83) < 0.32;
  const rightRoomFront = Math.abs(midX - 49.43) < 0.38;
  return verticalRun && insideMainCorridorLength && (leftRoomFront || rightRoomFront);
}

function isTopStripCorridorGlassWall(floorKey, s) {
  const topStripFloors = new Set(['groundgloor', '3rdfloor']);
  if (!topStripFloors.has(floorKey)) return false;
  const midX = (s.x1 + s.x2) * 0.5;
  const midZ = (s.z1 + s.z2) * 0.5;
  const verticalRun = Math.abs(s.x2 - s.x1) < 0.18;
  const insideMainCorridorLength = midZ > -3.45 && midZ < 24.8;
  const leftRoomFront = Math.abs(midX - 46.83) < 0.32;
  const rightRoomFront = Math.abs(midX - 49.43) < 0.38;
  const groundGymkhanaFront = floorKey === 'groundgloor' && leftRoomFront && midZ > 8.0 && midZ < 18.9;
  if (groundGymkhanaFront) return false;
  const classroom301Front = floorKey === '3rdfloor' && leftRoomFront && midZ > 15.6 && midZ < 24.8;
  if (classroom301Front) return false;
  return verticalRun && insideMainCorridorLength && (leftRoomFront || rightRoomFront);
}

function shouldOmitSecondFloorCorridorGlassPanel(s, panelMidZ) {
  const midX = (s.x1 + s.x2) * 0.5;
  const leftRoomFront = Math.abs(midX - 46.83) < 0.32;
  if (!leftRoomFront) return false;

  // HOD cabin correction: install half-height/run glass on the actual HOD
  // cabin wall only. The lower door-adjacent mistaken bay stays solid.
  const mistakenDoorAdjacentBay = panelMidZ > 16.85 && panelMidZ < 19.66;
  const solidHalfOfHodCabinWall = panelMidZ > 22.15 && panelMidZ < 24.75;
  return mistakenDoorAdjacentBay || solidHalfOfHodCabinWall;
}

function isSecondFloorDuplicateLibraryDoor(floorKey, dIndex, d) {
  if (floorKey !== '2ndfloor') return false;
  const x = toWorld(d.x);
  const z = toWorld(d.y);
  // The 2nd-floor source has a duplicate door at the Department Library entry.
  // Index 17 is the labeled/functional door; index 5 is the duplicate visual.
  return dIndex === 5 && Math.abs(x - 46.78) < 0.08 && Math.abs(z - 16.22) < 0.08;
}

function isFourthFloorDuplicateMeetingRoomDoor(floorKey, dIndex, d) {
  if (floorKey !== '4thfloor') return false;
  const x = toWorld(d.x);
  const z = toWorld(d.y);
  // The former 4th-floor Server Room, now Meeting Room, has two overlapping entries.
  // Keep index 5 for the label and interaction; suppress index 17 as the extra door.
  return dIndex === 17 && Math.abs(x - 46.78) < 0.08 && Math.abs(z - 16.22) < 0.08;
}

function addSecondFloorHodDoorGapPatches(elev, thick, h, wallGeos, skirtGeos) {
  const x = 46.8285;
  const yaw = Math.PI / 2;
  const patches = [
    { z: 21.235, len: 0.20 },
    { z: 19.700, len: 0.22 }
  ];

  patches.forEach((p) => {
    const wall = new THREE.BoxGeometry(p.len, h, thick + 0.008)
      .rotateY(yaw)
      .translate(x, elev + h / 2, p.z);
    wallGeos.push(wall);

    const skirt = new THREE.BoxGeometry(p.len, 0.15, thick + 0.075)
      .rotateY(yaw)
      .translate(x, elev + 0.075, p.z);
    skirtGeos.push(skirt);
  });
}

function addUpperFloorCorridorGlassWallSegment(floorKey, s, elev, thick, baseGeos, glassGeos, frameGeos, skirtGeos, wallGeos) {
  const slen = Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
  if (slen < 0.18) return;

  const yaw = -Math.atan2(s.z2 - s.z1, s.x2 - s.x1);
  const cx = (s.x1 + s.x2) * 0.5;
  const cz = (s.z1 + s.z2) * 0.5;
  const baseH = 1.15;
  const glassH = SETTINGS.floorHeight - baseH;
  const glassBottom = elev + baseH;
  const glassTop = glassBottom + glassH;
  const frameD = 0.04;
  const frameT = 0.03;
  const railH = 0.035;

  const base = new THREE.BoxGeometry(slen, baseH, thick + 0.018)
    .rotateY(yaw)
    .translate(cx, elev + baseH * 0.5, cz);
  baseGeos.push(base);

  const panelWidth = 1.75;
  const separatorCount = Math.max(1, Math.ceil(slen / panelWidth));
  const tx = (s.x2 - s.x1) / slen;
  const tz = (s.z2 - s.z1) / slen;
  const panelCount = separatorCount;
  const omittedPanels = [];

  for (let j = 0; j < panelCount; j++) {
    const t0 = j / panelCount;
    const t1 = (j + 1) / panelCount;
    const p0x = s.x1 + tx * slen * t0;
    const p0z = s.z1 + tz * slen * t0;
    const p1x = s.x1 + tx * slen * t1;
    const p1z = s.z1 + tz * slen * t1;
    const panelLen = Math.hypot(p1x - p0x, p1z - p0z);
    const panelCx = (p0x + p1x) * 0.5;
    const panelCz = (p0z + p1z) * 0.5;
    const panelMidZ = panelCz;
    const omitted = (floorKey === '2ndfloor' || floorKey === '4thfloor') && shouldOmitSecondFloorCorridorGlassPanel(s, panelMidZ);
    omittedPanels[j] = omitted;

    if (omitted) {
      const infill = new THREE.BoxGeometry(panelLen + 0.035, glassH, thick + 0.002)
        .rotateY(yaw)
        .translate(panelCx, glassBottom + glassH * 0.5, panelCz);
      wallGeos.push(infill);
    } else {
      const baseCap = new THREE.BoxGeometry(Math.max(0.04, panelLen - 0.02), 0.035, 0.05)
        .rotateY(yaw)
        .translate(panelCx, glassBottom - 0.018, panelCz);
      const bottomRail = new THREE.BoxGeometry(Math.max(0.04, panelLen - 0.02), railH, frameD)
        .rotateY(yaw)
        .translate(panelCx, glassBottom + railH * 0.5, panelCz);
      const topRail = new THREE.BoxGeometry(Math.max(0.04, panelLen - 0.02), railH, frameD)
        .rotateY(yaw)
        .translate(panelCx, glassTop - railH * 0.5, panelCz);
      const glass = new THREE.BoxGeometry(Math.max(0.04, panelLen - 0.06), glassH - 0.07, 0.028)
        .rotateY(yaw)
        .translate(panelCx, glassBottom + glassH * 0.5, panelCz);
      frameGeos.push(baseCap, bottomRail, topRail);
      glassGeos.push(glass);
    }
  }

  for (let j = 0; j <= separatorCount; j++) {
    const leftVisible = j > 0 && !omittedPanels[j - 1];
    const rightVisible = j < panelCount && !omittedPanels[j];
    if (!leftVisible && !rightVisible) continue;
    const t = j / separatorCount;
    const px = s.x1 + tx * slen * t;
    const pz = s.z1 + tz * slen * t;
    const separator = new THREE.BoxGeometry(frameT, glassH, frameD)
      .rotateY(yaw)
      .translate(px, glassBottom + glassH * 0.5, pz);
    frameGeos.push(separator);
  }

  const skirt = new THREE.BoxGeometry(slen, 0.15, thick + 0.07)
    .rotateY(yaw)
    .translate(cx, elev + 0.075, cz);
  skirtGeos.push(skirt);
}

function addTopStripCorridorGlassWallSegment(s, elev, thick, h, wallGeos, glassGeos, frameGeos, skirtGeos) {
  const slen = Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
  if (slen < 0.18) return;

  const yaw = -Math.atan2(s.z2 - s.z1, s.x2 - s.x1);
  const cx = (s.x1 + s.x2) * 0.5;
  const cz = (s.z1 + s.z2) * 0.5;
  const glassH = h * 0.25;
  const wallH = h - glassH;
  const glassBottom = elev + wallH;
  const frameD = 0.04;
  const frameT = 0.03;

  const wall = new THREE.BoxGeometry(slen + 0.02, wallH + 0.01, thick + 0.002)
    .rotateY(yaw)
    .translate(cx, elev + wallH * 0.5, cz);
  wallGeos.push(wall);

  const glass = new THREE.BoxGeometry(Math.max(0.04, slen - 0.04), glassH - 0.05, 0.028)
    .rotateY(yaw)
    .translate(cx, glassBottom + glassH * 0.5, cz);
  glassGeos.push(glass);

  const bottomRail = new THREE.BoxGeometry(slen, frameT, frameD)
    .rotateY(yaw)
    .translate(cx, glassBottom + frameT * 0.5, cz);
  const topRail = new THREE.BoxGeometry(slen, frameT, frameD)
    .rotateY(yaw)
    .translate(cx, elev + h - frameT * 0.5, cz);
  frameGeos.push(bottomRail, topRail);

  const separatorCount = Math.max(1, Math.ceil(slen / 1.75));
  const tx = (s.x2 - s.x1) / slen;
  const tz = (s.z2 - s.z1) / slen;
  for (let j = 0; j <= separatorCount; j++) {
    const t = j / separatorCount;
    const px = s.x1 + tx * slen * t;
    const pz = s.z1 + tz * slen * t;
    const separator = new THREE.BoxGeometry(frameT, glassH, frameD)
      .rotateY(yaw)
      .translate(px, glassBottom + glassH * 0.5, pz);
    frameGeos.push(separator);
  }

  const skirt = new THREE.BoxGeometry(slen, 0.15, thick + 0.04)
    .rotateY(yaw)
    .translate(cx, elev + 0.075, cz);
  skirtGeos.push(skirt);
}

// --- 6. WORLD BUILDER ---
// Stairs removed: building uses lift-only vertical movement.

async function loadWorld() {
  initInstancedMeshes(ALL_FLOORS.length);
  const wallGeos = []; const skirtGeos = []; const corridorBaseGeos = []; const corridorGlassGeos = []; const corridorFrameGeos = [];
  const doorList = []; const interactables = []; const autoDoors = []; const lifts = [];
  const floorDataMap = new Map();
  let spawnPoint = new THREE.Vector3(50.0, SETTINGS.playerHeight, 0.0);
  let secondFloorSpawn = null;
  const floorSafeSpawns = [];
  let sharedLiftAnchor = null;
  let topElev = 0;
  
  for(let i=0; i<ALL_FLOORS.length; i++) {
    let currentDir = SETTINGS.jsonDir + '/' + ALL_FLOORS[i];
    
    // Override 2nd floor with 4th floor data
    if (ALL_FLOORS[i] === '2ndfloor') {
      currentDir = SETTINGS.jsonDir + '/4thfloor';
    }

    const [wD, dD, fD] = await Promise.all([
      loadJson(currentDir + '/walls.json'),
      loadJson(currentDir + '/doors.json'),
      loadJson(currentDir + '/furniture.json')
    ]);
    const floorNameplates = ALL_FLOORS[i] === 'groundgloor'
      ? buildGroundFloorDoorLabelMap(dD)
      : buildUpperFloorCorridorDoorLabelMap(ALL_FLOORS[i], dD);

    const elev = i * SETTINGS.floorHeight;
    topElev = Math.max(topElev, elev);
    if (ALL_FLOORS[i] === 'groundgloor') computeGroundFloorZoneModel(dD);

    const points = [];
    const getPt = (x, z) => {
      let p = points.find(pt => Math.hypot(pt.x - x, pt.z - z) < 0.2); 
      if (!p) { p = {x, z}; points.push(p); }
      return p;
    };
    wD.forEach(w => { w.p1 = getPt(toWorld(w.xStart), toWorld(w.yStart)); w.p2 = getPt(toWorld(w.xEnd), toWorld(w.yEnd)); });
    stitchWallGaps(wD, 0.35);

    let minX=Infinity, maxX=-Infinity, minZ=Infinity, maxZ=-Infinity;
    wD.forEach(w => { minX=Math.min(minX, w.p1.x, w.p2.x); maxX=Math.max(maxX, w.p1.x, w.p2.x); minZ=Math.min(minZ, w.p1.z, w.p2.z); maxZ=Math.max(maxZ, w.p1.z, w.p2.z); });
    if (Number.isFinite(minX) && Number.isFinite(maxX) && Number.isFinite(minZ) && Number.isFinite(maxZ)) {
      const safeX = THREE.MathUtils.clamp(48.0, minX + 2.0, maxX - 2.0);
      const safeZ = THREE.MathUtils.clamp(6.0, minZ + 2.0, maxZ - 2.0);
      floorSafeSpawns[i] = new THREE.Vector3(safeX, elev + SETTINGS.playerHeight, safeZ);
    }
    floorDataMap.set(ALL_FLOORS[i], {
      bounds: {
        minX: minX - 1.2,
        maxX: maxX + 1.2,
        minZ: minZ - 1.2,
        maxZ: maxZ + 1.2
      },
      walls: wD.map((w) => ({ x1: w.p1.x, z1: w.p1.z, x2: w.p2.x, z2: w.p2.z })),
      doors: dD.map((d) => {
        const x = toWorld(d.x);
        const z = toWorld(d.y);
        const w = toWorld(d.width || 0.8);
        const angle = -parseFloat(d.angle || 0);
        const dx = Math.cos(angle) * w * 0.5;
        const dz = Math.sin(angle) * w * 0.5;
        return { x1: x - dx, z1: z - dz, x2: x + dx, z2: z + dz };
      })
    });

    const groundMainEntranceDoorIndex = ALL_FLOORS[i] === 'groundgloor'
      ? (() => {
          const boundaryTol = 0.25;
          let bestIdx = -1;
          let bestScore = -Infinity;
          for (let di = 0; di < dD.length; di++) {
            const dx = toWorld(dD[di].x);
            const dz = toWorld(dD[di].y);
            const dw = toWorld(dD[di].width || 0);
            if (!Number.isFinite(dx) || !Number.isFinite(dz) || !Number.isFinite(dw)) continue;

            const onBoundary =
              Math.abs(dz - maxZ) < boundaryTol ||
              Math.abs(dz - minZ) < boundaryTol ||
              Math.abs(dx - maxX) < boundaryTol ||
              Math.abs(dx - minX) < boundaryTol;

            if (!onBoundary) continue;

            // Prefer widest facade door (front entrance).
            const score = dw;
            if (score > bestScore) { bestScore = score; bestIdx = di; }
          }
          return bestIdx;
        })()
      : -1;

    if (ALL_FLOORS[i] === 'groundgloor' && groundMainEntranceDoorIndex >= 0 && dD[groundMainEntranceDoorIndex]) {
      const mainDoor = dD[groundMainEntranceDoorIndex];
      const dx = toWorld(mainDoor.x);
      const dz = toWorld(mainDoor.y);
      const ang = -toNum(mainDoor.angle, 0);
      // Spawn slightly inside corridor from the main gate.
      spawnPoint = new THREE.Vector3(
        dx - Math.sin(ang) * 2.0,
        SETTINGS.playerHeight,
        dz - Math.cos(ang) * 2.0
      );
    }
    
    if(wD.length > 0) {
      const shape = new THREE.Shape(); 
      shape.moveTo(minX-5, minZ-5); shape.lineTo(maxX+5, minZ-5); shape.lineTo(maxX+5, maxZ+5); shape.lineTo(minX-5, maxZ+5); shape.lineTo(minX-5, minZ-5);
      const slabGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false }); slabGeo.rotateX(Math.PI/2);
      const floorMesh = new THREE.Mesh(slabGeo, MATS.corridor); floorMesh.position.y = elev; floorMesh.receiveShadow = true; scene.add(floorMesh);
      const ceilMesh = new THREE.Mesh(slabGeo, MATS.ceiling); ceilMesh.position.y = elev + SETTINGS.floorHeight + 0.35; scene.add(ceilMesh);
      
      const zones = [
        { x: (minX+42)/2, z: (minZ+maxZ)/2, w: 42-minX, d: maxZ-minZ, mat: MATS.labFloor },
        { x: (50+maxX)/2, z: (minZ-8)/2, w: maxX-50, d: -8-minZ, mat: MATS.toiletFloor },
        { x: (42+55)/2, z: (-5+20)/2, w: 55-42, d: 25, mat: MATS.corridor }
      ];
      zones.forEach(z => {
        if(z.w > 0 && z.d > 0) {
          const carpet = new THREE.Mesh(new THREE.BoxGeometry(z.w, 0.02, z.d), z.mat);
          carpet.position.set(z.x, elev + 0.01, z.z); carpet.receiveShadow = true; scene.add(carpet);
        }
      });

      const isGround = ALL_FLOORS[i] === 'groundgloor';

      if (ENABLE_LIFT) {
        // Single shared lift shaft anchor for all floors (near staircase / central lobby).
        const stairRef = (fD || []).find((it) => ((it.name || '').toLowerCase().includes('stair')));
        if (!sharedLiftAnchor && stairRef) {
          sharedLiftAnchor = { x: toWorld(stairRef.x) - 0.2, z: toWorld(stairRef.y) + 1.0 };
        }
        if (!sharedLiftAnchor && ALL_FLOORS[i] === 'groundgloor') {
          sharedLiftAnchor = { x: maxX - 3.0, z: (minZ + maxZ) / 2 };
        }
        const liftX = sharedLiftAnchor ? sharedLiftAnchor.x : (maxX - 3.0);
        const liftZ = sharedLiftAnchor ? sharedLiftAnchor.z : ((minZ + maxZ) / 2);
        const rot180 = (px, pz) => ({ x: 2 * liftX - px, z: 2 * liftZ - pz });
        let liftBackCenterX = liftX;

      const lobbyFloor = new THREE.Mesh(
        new THREE.BoxGeometry(3.4, 0.03, 3.0),
        new THREE.MeshStandardMaterial({ color: 0xbec4c9, roughness: 0.25, metalness: 0.15 })
      );
      {
        const p = rot180(liftX - 1.2, liftZ);
        lobbyFloor.position.set(p.x, elev + 0.02, p.z);
      }
      lobbyFloor.receiveShadow = true;
      scene.add(lobbyFloor);

      const recessBack = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 2.9, 2.4),
        new THREE.MeshStandardMaterial({ color: 0xf1f1ef, roughness: 0.85 })
      );
      {
        const p = rot180(liftX - 0.75, liftZ);
        recessBack.position.set(p.x, elev + 1.45, p.z);
        liftBackCenterX = p.x;
      }
      recessBack.castShadow = true;
      recessBack.receiveShadow = true;
      scene.add(recessBack);

      const liftFrame = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 2.4, 1.62),
        new THREE.MeshStandardMaterial({ color: 0x8a939b, roughness: 0.28, metalness: 0.82 })
      );
      {
        const p = rot180(liftX + 0.66, liftZ);
        liftFrame.position.set(p.x, elev + 1.2, p.z);
      }
      liftFrame.castShadow = true;
      scene.add(liftFrame);

      const doorMat = new THREE.MeshStandardMaterial({ color: 0xaeb6bd, roughness: 0.18, metalness: 0.92, envMapIntensity: 1.0 });
      const doorLeft = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.2, 0.74), doorMat);
      const doorRight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.2, 0.74), doorMat);
      {
        const pL = rot180(liftX + 0.71, liftZ - 0.37);
        const pR = rot180(liftX + 0.71, liftZ + 0.37);
        doorLeft.position.set(pL.x, elev + 1.1, pL.z);
        doorRight.position.set(pR.x, elev + 1.1, pR.z);
      }
      doorLeft.castShadow = true;
      doorRight.castShadow = true;
      scene.add(doorLeft, doorRight);

      const hideSecondFloorWallArtifacts = ALL_FLOORS[i] === '2ndfloor';
      if (!hideSecondFloorWallArtifacts) {
        const floorDisplay = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.22, 0.7),
          new THREE.MeshStandardMaterial({ color: 0x17212c, emissive: 0x2e7fff, emissiveIntensity: 0.7 })
        );
        {
          const p = rot180(liftX + 0.6, liftZ);
          floorDisplay.position.set(p.x, elev + 2.48, p.z);
        }
        scene.add(floorDisplay);

        const callPanel = new THREE.Mesh(
          new THREE.BoxGeometry(0.03, 0.42, 0.16),
          new THREE.MeshStandardMaterial({ color: 0x6f7780, roughness: 0.22, metalness: 0.85 })
        );
        {
          const p = rot180(liftX + 0.63, liftZ + 1.0);
          callPanel.position.set(p.x, elev + 1.22, p.z);
        }
        scene.add(callPanel);
        const callLight = new THREE.PointLight(0x6eb7ff, 0.6, 4.0);
        {
          const p = rot180(liftX + 0.55, liftZ + 1.0);
          callLight.position.set(p.x, elev + 1.25, p.z);
        }
        scene.add(callLight);

        {
          const p = rot180(liftX + 0.92, liftZ);
          addSignBoard(FLOOR_LABELS[i].toUpperCase(), new THREE.Vector3(p.x, elev + 2.75, p.z), -Math.PI / 2, 1.25, 0.24, 0x17212c);
        }
        {
          const p = rot180(liftX + 0.95, liftZ + 1.12);
          addSignBoard('LIFT: G 1 2 3 4 5', new THREE.Vector3(p.x, elev + 1.7, p.z), -Math.PI / 2, 1.25, 0.22, 0x26313d);
        }
        {
          const p = rot180(liftX + 1.05, liftZ - 1.25);
          addSignBoard('LABS / CLASSROOMS', new THREE.Vector3(p.x, elev + 2.25, p.z), -Math.PI / 2, 1.45, 0.24, 0x203024);
        }
        {
          const p = rot180(liftX + 1.05, liftZ + 1.45);
          addSignBoard('WASHROOMS', new THREE.Vector3(p.x, elev + 2.25, p.z), -Math.PI / 2, 1.1, 0x2c2b23);
        }
      }

        addFloorNoticeBoards(i, ALL_FLOORS[i], elev, wD);

        if (isGround) {
        const lobbyLightA = new THREE.PointLight(0xfff3dc, 0.55, 7.5);
        {
          const p = rot180(liftX - 1.2, liftZ - 0.8);
          lobbyLightA.position.set(p.x, elev + SETTINGS.floorHeight - 0.4, p.z);
        }
        scene.add(lobbyLightA);
        const lobbyLightB = new THREE.PointLight(0xfff3dc, 0.55, 7.5);
        {
          const p = rot180(liftX - 1.2, liftZ + 0.8);
          lobbyLightB.position.set(p.x, elev + SETTINGS.floorHeight - 0.4, p.z);
        }
        scene.add(lobbyLightB);
        }

      const liftCall = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.4, 1.9), new THREE.MeshBasicMaterial({ visible: false }));
      {
        const p = rot180(liftX + 1.35, liftZ);
        liftCall.position.set(p.x, elev + 1.3, p.z);
      }
      liftCall.userData = { type: 'lift' };
      interactables.push(liftCall);
      scene.add(liftCall);
      if (ALL_FLOORS[i] === '2ndfloor') {
        secondFloorSpawn = floorSafeSpawns[i] ? floorSafeSpawns[i].clone() : new THREE.Vector3(liftCall.position.x, elev + SETTINGS.playerHeight, liftCall.position.z);
      }
      lifts.push({
        left: doorLeft,
        right: doorRight,
        baseLeftZ: doorLeft.position.z,
        baseRightZ: doorRight.position.z,
        maxSlide: 0.24,
        openUntil: 0,
        openAmount: 0,
        call: liftCall,
        center: new THREE.Vector3((doorLeft.position.x + doorRight.position.x) * 0.5, elev + 1.1, (doorLeft.position.z + doorRight.position.z) * 0.5)
      });

        // Align shaft to lift back panel so there is no visible duct/lift gap.
        if (sharedLiftAnchor) {
          // Back panel thickness = 0.14, shaft width = 1.95
          // Place shaft so its near face touches panel far face exactly.
          sharedLiftAnchor.shaftX = liftBackCenterX + (0.14 / 2) + (1.95 / 2);
          sharedLiftAnchor.shaftZ = liftZ;
        }
      }
    }

    const wallOpenings = dD.map((d) => ({
      x: toWorld(d.x),
      z: toWorld(d.y),
      w: Math.max(0.9, toWorld(d.width || 100))
    }));
    if (sharedLiftAnchor) {
      wallOpenings.push({
        x: sharedLiftAnchor.x,
        z: sharedLiftAnchor.z,
        w: 1.6
      });
    }
    if (ALL_FLOORS[i] === 'groundgloor' && groundMainEntranceDoorIndex >= 0 && dD[groundMainEntranceDoorIndex]) {
      const mainDoor = dD[groundMainEntranceDoorIndex];
      wallOpenings.push({
        x: toWorld(mainDoor.x),
        z: toWorld(mainDoor.y),
        w: 1.5
      });
    }
    wallOpenings.forEach((op) => {
      GLOBAL_COLLISION.addClearance(op.x, op.z, Math.max(0.75, op.w / 2 + 0.45), elev - 0.1, elev + 2.25);
    });

    wD.forEach(w => {
      const thick = 0.25, h = SETTINGS.floorHeight; const len = Math.hypot(w.p2.x-w.p1.x, w.p2.z-w.p1.z); if(len < 0.01) return;
      let segments = [{x1: w.p1.x, z1: w.p1.z, x2: w.p2.x, z2: w.p2.z}];
      const isSecondFloorHodDoorWall =
        ALL_FLOORS[i] === '2ndfloor' &&
        Math.abs(w.p1.x - 46.83) < 0.16 &&
        Math.abs(w.p2.x - 46.83) < 0.16 &&
        Math.max(w.p1.z, w.p2.z) > 24.4 &&
        Math.min(w.p1.z, w.p2.z) < 19.8;
      
      wallOpenings.forEach(op => {
        const dx = op.x, dz = op.z;
        const dw = op.w; 

        let cutAny = false;
        const nextSegments = [];
        const near = Math.max(0.55, dw / 2 + 0.18);

        for (const s of segments) {
          const svx = s.x2 - s.x1;
          const svz = s.z2 - s.z1;
          const l = Math.hypot(svx, svz);
          if (l < 1e-6) continue;

          const dot = ((dx - s.x1) * svx + (dz - s.z1) * svz) / (l * l);
          const px = s.x1 + dot * svx;
          const pz = s.z1 + dot * svz;
          const dist = Math.hypot(dx - px, dz - pz);

          if (dist < near && dot > 0.05 && dot < 0.95) {
            cutAny = true;
            const cut = (dw / 2 + 0.02) / l;
            if (dot - cut > 0) nextSegments.push({ x1: s.x1, z1: s.z1, x2: s.x1 + (dot - cut) * svx, z2: s.z1 + (dot - cut) * svz });
            if (dot + cut < 1) nextSegments.push({ x1: s.x1 + (dot + cut) * svx, z1: s.z1 + (dot + cut) * svz, x2: s.x2, z2: s.z2 });
          } else {
            nextSegments.push(s);
          }
        }

        if (cutAny) {
          const headerBottom = 2.1;
          const headerH = Math.max(0.05, h - headerBottom);
          const isSecondFloorHodDoorHeader =
            ALL_FLOORS[i] === '2ndfloor' &&
            Math.abs(dx - 46.78) < 0.10 &&
            Math.abs(dz - 20.48) < 0.10;
          const headerW = isSecondFloorHodDoorHeader ? dw + 0.16 : dw + 0.08;
          const headerDepth = isSecondFloorHodDoorHeader ? thick + 0.006 : thick + 0.002;
          const lBox = new THREE.BoxGeometry(headerW, headerH + 0.01, headerDepth);
          lBox.rotateY(-Math.atan2(w.p2.z - w.p1.z, w.p2.x - w.p1.x));
          lBox.translate(dx, elev + headerBottom + headerH / 2 - 0.005, dz);
          wallGeos.push(lBox);
        }

        segments = nextSegments;
      });

      if (isSecondFloorHodDoorWall) {
        addSecondFloorHodDoorGapPatches(elev, thick, h, wallGeos, skirtGeos);
      }

      segments.forEach(s => {
        const slen = Math.hypot(s.x2-s.x1, s.z2-s.z1); if(slen < 0.001) return;
        const a = -Math.atan2(s.z2-s.z1, s.x2-s.x1);
        if (isUpperFloorCorridorGlassWall(ALL_FLOORS[i], s)) {
          addUpperFloorCorridorGlassWallSegment(ALL_FLOORS[i], s, elev, thick, corridorBaseGeos, corridorGlassGeos, corridorFrameGeos, skirtGeos, wallGeos);
        } else if (isTopStripCorridorGlassWall(ALL_FLOORS[i], s)) {
          addTopStripCorridorGlassWallSegment(s, elev, thick, h, wallGeos, corridorGlassGeos, corridorFrameGeos, skirtGeos);
        } else {
          const box = new THREE.BoxGeometry(slen, h, thick).rotateY(a).translate((s.x1+s.x2)/2, elev + h/2, (s.z1+s.z2)/2); 
          wallGeos.push(box);
          const skirt = new THREE.BoxGeometry(slen, 0.15, thick + 0.04).rotateY(a).translate((s.x1+s.x2)/2, elev + 0.075, (s.z1+s.z2)/2);
          skirtGeos.push(skirt);
        }
        GLOBAL_COLLISION.addWall(s.x1, s.z1, s.x2, s.z2, thick, elev-0.1, elev+h+0.1);
      });
      const cyl = new THREE.CylinderGeometry(thick/1.9, thick/1.9, h, 8).translate(w.p1.x, elev+h/2, w.p1.z); wallGeos.push(cyl);
    });

    const placedChairs = [];
    const chairPoints = fD
      .filter((it) => {
        const n = (it.name || '').toLowerCase();
        return n.includes('chair') || n.includes('seat') || n.includes('bench');
      })
      .map((it) => ({ x: toWorld(it.x), z: toWorld(it.y) }));
    const tableSurfaces = fD
      .filter((it) => {
        const n = (it.name || '').toLowerCase();
        return n.includes('table') || n.includes('desk') || n.includes('rack');
      })
      .map((it) => ({
        x: toWorld(it.x),
        z: toWorld(it.y),
        w: toWorld(it.width || 120),
        d: toWorld(it.depth || 70),
        ang: -toNum(it.angle, 0)
      }));

    fD.forEach(f => {
      const n = (f.name||'').toLowerCase(); const x=toWorld(f.x), z=toWorld(f.y);
      let ang=-toNum(f.angle,0); const pos = new THREE.Vector3(x, elev, z);
      if (isFourthFloorDepartmentLibraryArea(ALL_FLOORS[i], x, z)) return;
      if (isServerRoomArea(ALL_FLOORS[i], x, z)) return;
      if (shouldSuppressGroundClassroomFurniture(ALL_FLOORS[i], n, x, z)) return;
      if (n.includes('stair') || n.includes('staircase')) {
        // Stairs disabled: lift-only vertical navigation.
        return;
      }
      if (toWorld(f.elevation || 0) < -0.5) return; 
      if(n.includes('table') || n.includes('desk') || n.includes('rack')) {
         // Scale based on JSON: base geometry is 1.0m x 1.0m
         const w = toWorld(f.width || 120);
         const d = toWorld(f.depth || 70);
         const scale = new THREE.Vector3(w, 1, d);
         // Use raw angle from JSON (with sign fix) - hardcoded +PI/2 often broke manual placements
         addInstance('table', pos, ang, scale);
      }
      else if(n.includes('laptop')) {
        const support = tableSurfaces.find((t) => pointInRotatedRect(x, z, t.x, t.z, t.w + 0.08, t.d + 0.08, t.ang));
        let pcYaw = (support ? support.ang : ang) + Math.PI / 2;
        let nearestChair = null;
        let bestDist = 1e9;
        for (const c of chairPoints) {
          const dx = c.x - x;
          const dz = c.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestDist) { bestDist = d2; nearestChair = c; }
        }
        // Face the nearest front chair when a plausible chair is nearby.
        if (nearestChair && bestDist < (2.2 * 2.2)) {
          pcYaw = Math.atan2(nearestChair.x - x, nearestChair.z - z);
        }
        addInstance('pcBody', new THREE.Vector3(x, elev, z), pcYaw);
        addInstance('pcScreen', new THREE.Vector3(x, elev, z), pcYaw);
      }
      else if(n.includes('pc') || n.includes('monitor')) {
        addInstance('pcBody', pos, ang);
        addInstance('pcScreen', pos, ang);
      }
      else if(n.includes('toilet') || n.includes('wc')) {
         addInstance('toilet', pos, ang);
      }
      else if(n.includes('chair') || n.includes('seat') || n.includes('bench')) {
         if (!placedChairs.some(p => Math.hypot(p.x - x, p.z - z) < 0.5)) {
            addInstance('chair', new THREE.Vector3(pos.x, elev, pos.z), ang); placedChairs.push({x, z});
          }
      }
      else if(n.includes('washbasin')) addInstance('basin', pos, ang);
      else if(n.includes('flat tv') || n.includes('tv')) {
        // Exported flat TVs are not classroom smart boards and often float off-wall.
        // The real teaching boards are placed by the wall-snapped classroom setup below.
        return;
      }
    });

    if (ALL_FLOORS[i] === DEPARTMENT_LIBRARY_ROOM.floorKey) {
      addDepartmentLibraryInterior(elev);
    }
    if (ALL_FLOORS[i] === FOURTH_FLOOR_DEPARTMENT_LIBRARY_ROOM.floorKey) {
      addFourthFloorDepartmentLibraryInterior(elev);
    }
    if (SERVER_ROOM_AREAS.some((r) => r.floorKey === ALL_FLOORS[i])) {
      addServerRoomInterior(elev);
    }

    if (ALL_FLOORS[i] === 'groundgloor') {
      GROUND_CLASSROOM_BENCH_LAYOUTS.forEach((room) => addGroundClassroomBenchDeskLayout(room, elev));
    } else if (ALL_FLOORS[i] === '3rdfloor') {
      THIRD_FLOOR_CLASSROOM_BENCH_LAYOUTS.forEach((room) => addGroundClassroomBenchDeskLayout(room, elev));
    }

    const classroomSmartBoardsPlaced = new Set();
    dD.forEach((d, dIndex) => {
      if (isSecondFloorDuplicateLibraryDoor(ALL_FLOORS[i], dIndex, d)) return;
      if (isFourthFloorDuplicateMeetingRoomDoor(ALL_FLOORS[i], dIndex, d)) return;
      const x=toWorld(d.x), z=toWorld(d.y), w=toWorld(d.width || 100), h=2.1, ang=-toNum(d.angle,0); 
      const dObj = new THREE.Group(); dObj.position.set(x, elev, z); dObj.rotation.y = ang;
      const leafGroup = new THREE.Group();
      const doorThickness = 0.05;
      const isMainEntrance = ALL_FLOORS[i] === 'groundgloor' && dIndex === groundMainEntranceDoorIndex;
      const leafW = isMainEntrance ? Math.max(1.8, w) : Math.max(0.9, Math.min(1.35, w));

      if (isMainEntrance) {
        // Premium automatic bi-parting sliding glass entry (facade only):
        // [Fixed] [Slide] [Slide] [Fixed]
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.55, metalness: 0.65 });
        const glassMat = new THREE.MeshStandardMaterial({ color: 0xbcdcff, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.05 });

        const totalW = leafW;
        const fixedW = totalW * 0.15;
        const slideW = totalW * 0.35;
        const frameT = 0.045;
        const frameD = 0.09;
        const doorH = Math.min(2.9, SETTINGS.floorHeight - 0.45);

        const frame = new THREE.Group();
        const sideL = new THREE.Mesh(new THREE.BoxGeometry(frameT, doorH, frameD), frameMat);
        sideL.position.set(-totalW/2 + frameT/2, doorH/2, 0);
        const sideR = sideL.clone(); sideR.position.x = totalW/2 - frameT/2;
        const top = new THREE.Mesh(new THREE.BoxGeometry(totalW, frameT, frameD), frameMat);
        top.position.set(0, doorH - frameT/2, 0);
        const bottom = new THREE.Mesh(new THREE.BoxGeometry(totalW, frameT, frameD), frameMat);
        bottom.position.set(0, frameT/2, 0);
        frame.add(sideL, sideR, top, bottom);

        const rail = new THREE.Mesh(new THREE.BoxGeometry(totalW, 0.02, 0.05), frameMat);
        rail.position.set(0, doorH + 0.04, 0.0);
        frame.add(rail);

        const fixedGlassGeo = new THREE.PlaneGeometry(fixedW - frameT, doorH - frameT * 2);
        const fixedL = new THREE.Mesh(fixedGlassGeo, glassMat);
        fixedL.position.set(-totalW/2 + fixedW/2, doorH/2, frameD/2 - 0.005);
        const fixedR = fixedL.clone(); fixedR.position.x = totalW/2 - fixedW/2;
        frame.add(fixedL, fixedR);

        const makeShutter = () => {
          const g = new THREE.Group();
          const border = new THREE.Mesh(new THREE.BoxGeometry(slideW, doorH, 0.035), frameMat);
          border.position.set(0, doorH/2, 0);
          const glass = new THREE.Mesh(new THREE.PlaneGeometry(slideW - 0.06, doorH - 0.08), glassMat);
          glass.position.set(0, doorH/2, 0.02);
          g.add(border, glass);
          return g;
        };
        const leftShutter = makeShutter();
        const rightShutter = makeShutter();
        const leftBaseX = (-totalW/2 + fixedW) + slideW/2;
        const rightBaseX = (totalW/2 - fixedW) - slideW/2;
        leftShutter.position.x = leftBaseX;
        rightShutter.position.x = rightBaseX;
        frame.add(leftShutter, rightShutter);

        const sensor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.06), frameMat);
        sensor.position.set(0, doorH + 0.02, frameD/2);
        frame.add(sensor);
        const accessLight = new THREE.PointLight(0x44ff88, 0.35, 3.5);
        accessLight.position.set(0.25, doorH + 0.03, 0.25);
        frame.add(accessLight);

        dObj.add(frame);

        const colW = { x1: x - Math.cos(ang)*w/2, z1: z + Math.sin(ang)*w/2, x2: x + Math.cos(ang)*w/2, z2: z - Math.sin(ang)*w/2, half: 0.12, yMin: elev, yMax: elev+doorH, active: true, isDoor: true };
        GLOBAL_COLLISION.walls.push(colW);
        const sideBlockerLen = 0.36;
        const sideBlockerInset = 0.03;
        const sideBlockers = [-1, 1].map((side) => {
          const sx = x + Math.cos(ang) * side * (w / 2 - sideBlockerInset);
          const sz = z - Math.sin(ang) * side * (w / 2 - sideBlockerInset);
          const blocker = {
            x1: sx - Math.sin(ang) * sideBlockerLen / 2,
            z1: sz - Math.cos(ang) * sideBlockerLen / 2,
            x2: sx + Math.sin(ang) * sideBlockerLen / 2,
            z2: sz + Math.cos(ang) * sideBlockerLen / 2,
            half: 0.1,
            yMin: elev - 0.05,
            yMax: elev + doorH + 0.05,
            active: true,
            isDoor: true
          };
          GLOBAL_COLLISION.walls.push(blocker);
          return blocker;
        });
        autoDoors.push({
          kind: 'slidingEntrance',
          pos: new THREE.Vector3(x, elev, z),
          leftShutter,
          rightShutter,
          leftBaseX,
          rightBaseX,
          maxSlide: slideW * 0.92,
          openUntil: 0,
          openAmount: 0,
          targetOpen: 0,
          colW,
          sideBlockers
        });

        scene.add(dObj);
        return;
      }

      // Other doors: wooden frame + vertical glass + handle
      {
        const stileW = 0.30;
        const woodGeo = mergeGeometries([
          new THREE.BoxGeometry(stileW, h, doorThickness).translate(-0.35, h/2, 0),
          new THREE.BoxGeometry(stileW, h, doorThickness).translate(0.35, h/2, 0),
          new THREE.BoxGeometry(0.4, 0.2, doorThickness).translate(0, 0.1, 0),
          new THREE.BoxGeometry(0.4, 0.2, doorThickness).translate(0, h - 0.1, 0)
        ]);
        const frame = new THREE.Mesh(woodGeo, MATS.wood);
        const glass = new THREE.Mesh(new THREE.BoxGeometry(0.4, h - 0.4, 0.02), MATS.glass);
        glass.position.set(0, h/2, 0);

        leafGroup.add(frame, glass);
        // Push door leaf slightly toward corridor to avoid z-fighting / being hidden inside wall thickness.
        leafGroup.position.set(leafW/2, 0, 0.11);

      const hnd = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.2), MATS.metal);
      hnd.position.set(leafW - 0.1, 1.0, doorThickness/2 + 0.01);
      hnd.rotation.x = Math.PI/2;
      leafGroup.add(hnd);
      }

      // Architectural casing to close wall/door-frame side gaps without changing door size.
      // Dimensions are in meters (0.07m = 7cm), matching real trim proportions.
      const wallThickness = 0.25;
      const frameBand = 0.07;
      const frameDepth = wallThickness + 0.04;
      const frameMat = MATS.wood;
      const casing = new THREE.Group();

      const jamb = new THREE.Mesh(new THREE.BoxGeometry(frameBand, h + frameBand, frameDepth), frameMat);
      const jambOffsetX = w / 2 + frameBand / 2;
      jamb.position.set(-jambOffsetX, (h + frameBand) / 2, 0);
      casing.add(jamb);
      const jambR = jamb.clone();
      jambR.position.x = jambOffsetX;
      casing.add(jambR);

      const header = new THREE.Mesh(new THREE.BoxGeometry(w + frameBand * 2, frameBand, frameDepth), frameMat);
      header.position.set(0, h + frameBand / 2, 0);
      casing.add(header);

      const stopBand = 0.075;
      const stopDepth = frameDepth + 0.055;
      const leafClearanceW = Math.max(0.9, Math.min(1.35, w));
      const stopOffsetX = leafClearanceW / 2 + stopBand / 2;
      const stopL = new THREE.Mesh(new THREE.BoxGeometry(stopBand, h, stopDepth), frameMat);
      stopL.position.set(-stopOffsetX, h / 2, 0.025);
      casing.add(stopL);
      const stopR = stopL.clone();
      stopR.position.x = stopOffsetX;
      casing.add(stopR);
      const stopTop = new THREE.Mesh(new THREE.BoxGeometry(leafClearanceW + stopBand * 2, stopBand, stopDepth), frameMat);
      stopTop.position.set(0, h - stopBand / 2, 0.025);
      casing.add(stopTop);

      dObj.add(casing);

      const piv = new THREE.Group(); piv.position.set(-w/2, 0, 0); piv.add(leafGroup); dObj.add(piv);
      
      // Nameplates/boards removed per request.
      
      const hit = new THREE.Mesh(new THREE.BoxGeometry(w+0.2, h, 0.4), new THREE.MeshBasicMaterial({visible:false})); hit.position.y = h/2;
      const colW = { x1: x - Math.cos(ang)*w/2, z1: z + Math.sin(ang)*w/2, x2: x + Math.cos(ang)*w/2, z2: z - Math.sin(ang)*w/2, half: 0.1, yMin: elev, yMax: elev+h, active: true, isDoor: true };
      GLOBAL_COLLISION.walls.push(colW);
      const sideBlockerLen = 0.34;
      const sideBlockerInset = 0.03;
      const sideBlockers = [-1, 1].map((side) => {
        const sx = x + Math.cos(ang) * side * (w / 2 - sideBlockerInset);
        const sz = z - Math.sin(ang) * side * (w / 2 - sideBlockerInset);
        const blocker = {
          x1: sx - Math.sin(ang) * sideBlockerLen / 2,
          z1: sz - Math.cos(ang) * sideBlockerLen / 2,
          x2: sx + Math.sin(ang) * sideBlockerLen / 2,
          z2: sz + Math.cos(ang) * sideBlockerLen / 2,
          half: 0.09,
          yMin: elev - 0.05,
          yMax: elev + h + 0.05,
          active: true,
          isDoor: true
        };
        GLOBAL_COLLISION.walls.push(blocker);
        return blocker;
      });
      hit.userData = {
        type:'door',
        isOpen:false,
        targetRot:0,
        colW,
        sideBlockers,
        toggle(){
          this.isOpen=!this.isOpen;
          this.targetRot=this.isOpen?Math.PI*0.6:0;
          this.colW.active=!this.isOpen;
          this.sideBlockers.forEach((b) => { b.active = !this.isOpen; });
        },
        pivot: piv
      };

      const plateText = floorNameplates.get(dIndex);
      if (plateText) {
        const plateW = plateText === 'MEETING ROOM' ? 1.25 : 0.90;
        const plateH = 0.22;
        const plateD = 0.025;
        const plateBottomY = 2.15; // 215 cm from floor (standard corridor signage)
        const corridorCenter = new THREE.Vector2(48.5, 7.5);
        const dx = corridorCenter.x - x;
        const dz = corridorCenter.y - z;
        // Convert corridor direction to door-local space to decide corridor-side wall face.
        const localCorridorZ = Math.sin(ang) * dx + Math.cos(ang) * dz;
        const sideSign = localCorridorZ >= 0 ? 1 : -1;

        const plate = new THREE.Mesh(
          new THREE.BoxGeometry(plateW, plateH, plateD),
          new THREE.MeshStandardMaterial({ color: 0x1f2933, roughness: 0.45, metalness: 0.2 })
        );
        // Mount flush above door center, slightly protruding from corridor-side wall face.
        const wallHalf = 0.25 / 2;
        const casingExtra = 0.04 / 2;
        const mountOffset = wallHalf + casingExtra + plateD / 2 + 0.005;
        plate.position.set(0, plateBottomY + plateH / 2, sideSign * mountOffset);
        // Keep board parallel to wall and face corridor side.
        plate.rotation.y = sideSign > 0 ? 0 : Math.PI;

        const tex = createTextTexture(plateText);
        const textMatFront = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
        const textPlaneFront = new THREE.Mesh(new THREE.PlaneGeometry(plateW - 0.06, plateH - 0.05), textMatFront);
        textPlaneFront.position.set(0, 0, plateD / 2 + 0.002);
        plate.add(textPlaneFront);

        dObj.add(plate);

        // Smart boards for selected classrooms only.
        const needsClassroomSmartBoard =
          (ALL_FLOORS[i] === 'groundgloor' && /^CLASSROOM G00[4-5]$/.test(plateText)) ||
          (ALL_FLOORS[i] === '3rdfloor' && /^CLASSROOM 30[1-6]$/.test(plateText)) ||
          (ALL_FLOORS[i] === '5thfloor' && (plateText === 'CLASSROOM 506' || plateText === 'CLASSROOM 507'));
        if (needsClassroomSmartBoard && !classroomSmartBoardsPlaced.has(plateText)) {
          if (placeFixedClassroomSmartBoard(ALL_FLOORS[i], plateText, elev, classroomSmartBoardsPlaced, wD)) {
            dObj.add(hit); doorList.push(hit.userData); interactables.push(hit); scene.add(dObj);
            return;
          }

          const isFifthFloorClassroom = ALL_FLOORS[i] === '5thfloor';
          const nearbyTables = (fD || [])
            .filter((it) => {
              const n = (it.name || '').toLowerCase();
              if (!(n.includes('table') || n.includes('desk'))) return false;
              const tx = toWorld(it.x), tz = toWorld(it.y);
              return Math.hypot(tx - x, tz - z) < 9.0;
            })
            .map((it) => ({
              x: toWorld(it.x),
              z: toWorld(it.y),
              ang: -toNum(it.angle, 0),
              area: Math.max(0.01, toWorld(it.width || 100) * toWorld(it.depth || 70))
            }))
            .sort((a, b) => b.area - a.area);

          const nearbyChairs = (fD || [])
            .filter((it) => {
              const n = (it.name || '').toLowerCase();
              if (!(n.includes('chair') || n.includes('seat') || n.includes('bench'))) return false;
              const cx = toWorld(it.x), cz = toWorld(it.y);
              return Math.hypot(cx - x, cz - z) < 7.5;
            })
            .map((it) => ({ x: toWorld(it.x), z: toWorld(it.y), yaw: -toNum(it.angle, 0) }));

          let boardPos;
          let boardYaw;
          let roomRefX = x;
          let roomRefZ = z;
          if (isFifthFloorClassroom) {
            // 5th floor classroom data is sparse; pin boards inside the room from the door side.
            const corridorCenter2 = new THREE.Vector2(48.5, 7.5);
            const toCorridor2 = new THREE.Vector2(corridorCenter2.x - x, corridorCenter2.y - z).normalize();
            const n2 = new THREE.Vector2(Math.sin(ang), Math.cos(ang));
            if (n2.dot(toCorridor2) < 0) n2.multiplyScalar(-1);
            const roomDir = new THREE.Vector2(-n2.x, -n2.y);
            boardPos = new THREE.Vector3(x + roomDir.x * 2.6, elev, z + roomDir.y * 2.6);
            boardYaw = Math.atan2(roomDir.x, roomDir.y);
            roomRefX = x + roomDir.x;
            roomRefZ = z + roomDir.y;
          } else if (nearbyTables.length > 0) {
            // Prefer wall behind the main teacher table.
            const tMain = nearbyTables[0];
            const fx = Math.sin(tMain.ang);
            const fz = Math.cos(tMain.ang);
            boardPos = new THREE.Vector3(tMain.x + fx * 3.0, elev, tMain.z + fz * 3.0);
            boardYaw = Math.atan2(-fx, -fz);
            roomRefX = tMain.x;
            roomRefZ = tMain.z;
          } else if (nearbyChairs.length >= 4) {
            let cx = 0, cz = 0, fx = 0, fz = 0;
            nearbyChairs.forEach((c) => {
              cx += c.x; cz += c.z;
              fx += Math.sin(c.yaw); fz += Math.cos(c.yaw);
            });
            cx /= nearbyChairs.length; cz /= nearbyChairs.length;
            const fl = Math.hypot(fx, fz) || 1.0;
            fx /= fl; fz /= fl;
            // Put board in front of chair-facing direction, then face chairs.
            boardPos = new THREE.Vector3(cx + fx * 2.8, elev, cz + fz * 2.8);
            boardYaw = Math.atan2(-fx, -fz);
            roomRefX = cx;
            roomRefZ = cz;
          } else {
            const corridorCenter2 = new THREE.Vector2(48.5, 7.5);
            const toCorridor2 = new THREE.Vector2(corridorCenter2.x - x, corridorCenter2.y - z).normalize();
            const n2 = new THREE.Vector2(Math.sin(ang), Math.cos(ang));
            if (n2.dot(toCorridor2) < 0) n2.multiplyScalar(-1);
            const roomDir = new THREE.Vector2(-n2.x, -n2.y);
            boardPos = new THREE.Vector3(x + roomDir.x * 2.2, elev, z + roomDir.y * 2.2);
            boardYaw = Math.atan2(roomDir.x, roomDir.y);
          }

          const snapped = snapSmartBoardToWall(boardPos, boardYaw, wD, 6.0);
          placeSmartBoardSetup(snapped.position, snapped.yaw, elev);
          classroomSmartBoardsPlaced.add(plateText);
        }

      }

      dObj.add(hit); doorList.push(hit.userData); interactables.push(hit); scene.add(dObj);
    });

    // Do not auto-place windows on copied wall segments. Real openings are driven
    // by doors.json, including the main facade sliding entrance.
    addExteriorWindowsForFloor(ALL_FLOORS[i], elev);

    if (!SETTINGS.performanceMode) {
      const l1 = new THREE.PointLight(0xffeedd, 0.8, 15); l1.position.set(40, elev + 3.0, 5); scene.add(l1);
      const l2 = new THREE.PointLight(0xffeedd, 0.8, 15); l2.position.set(48, elev + 3.0, 5); scene.add(l2);
    }
  }
  if(wallGeos.length > 0) {
    const wm = new THREE.Mesh(mergeGeometries(wallGeos), MATS.wallPaint);
    wm.castShadow = !SETTINGS.performanceMode;
    wm.receiveShadow = !SETTINGS.performanceMode;
    scene.add(wm);
  }
  if(corridorBaseGeos.length > 0) {
    const baseMesh = new THREE.Mesh(mergeGeometries(corridorBaseGeos), MATS.corridorBasePanel);
    baseMesh.castShadow = !SETTINGS.performanceMode;
    baseMesh.receiveShadow = true;
    scene.add(baseMesh);
  }
  if(corridorGlassGeos.length > 0) {
    const glassMesh = new THREE.Mesh(mergeGeometries(corridorGlassGeos), MATS.corridorGlass);
    glassMesh.renderOrder = 3;
    glassMesh.castShadow = false;
    glassMesh.receiveShadow = false;
    scene.add(glassMesh);
  }
  if(corridorFrameGeos.length > 0) {
    const frameMesh = new THREE.Mesh(mergeGeometries(corridorFrameGeos), MATS.corridorFrame);
    frameMesh.castShadow = !SETTINGS.performanceMode;
    frameMesh.receiveShadow = true;
    scene.add(frameMesh);
  }
  if(skirtGeos.length > 0) scene.add(new THREE.Mesh(mergeGeometries(skirtGeos), MATS.skirting));
  if (sharedLiftAnchor) {
    const shaftH = topElev + SETTINGS.floorHeight + 0.2;
    const shaft = new THREE.Mesh(
      new THREE.BoxGeometry(1.95, shaftH, 1.95),
      new THREE.MeshStandardMaterial({ color: 0xd5d7da, roughness: 0.78, metalness: 0.04 })
    );
    // Keep duct (shaft) merged with the same 180-degree rotated lift layout.
    shaft.position.set(
      sharedLiftAnchor.shaftX !== undefined ? sharedLiftAnchor.shaftX : (sharedLiftAnchor.x + 0.75),
      shaftH / 2,
      sharedLiftAnchor.shaftZ !== undefined ? sharedLiftAnchor.shaftZ : sharedLiftAnchor.z
    );
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    scene.add(shaft);
  }
  Object.values(INSTANCED_MESHES).forEach(m => { m.count = m.userData.index; m.instanceMatrix.needsUpdate = true; });
  return { doorList, interactables, autoDoors, lifts, spawnPoint, secondFloorSpawn, floorSafeSpawns, floorDataMap };
}

// --- 7. PLAYER SYSTEM ---
class FPSController {
  constructor(cam) {
    this.camera = cam;
    this.yaw = 0;
    this.pitch = 0;
    this.enabled = false;
    this.mobileActive = false;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.keys = {};
    this.touchMove = { x: 0, y: 0 };
  }
  resetInput() {
    this.keys = {};
    this.vel.set(0, 0, 0);
    this.touchMove.x = 0;
    this.touchMove.y = 0;
  }
  attach() { 
    document.addEventListener('mousemove', e => { if(this.enabled){ this.yaw -= e.movementX * SETTINGS.mouseSensitivity; this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - e.movementY * SETTINGS.mouseSensitivity)); } }); 
    window.addEventListener('keydown', e => { this.keys[e.code] = true; if(e.code === 'Escape') document.exitPointerLock(); }); 
    window.addEventListener('keyup', e => this.keys[e.code] = false); 
    window.addEventListener('blur', () => this.resetInput());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.resetInput(); });
  }
  update(dt, col) {
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ')); if(!this.enabled){ this.resetInput(); this.camera.position.copy(this.pos); return; }
    const f=new THREE.Vector3(0,0,-1).applyQuaternion(this.camera.quaternion); f.y=0; f.normalize(); const r=new THREE.Vector3(1,0,0).applyQuaternion(this.camera.quaternion); r.y=0; r.normalize();
    const forwardInput = (this.keys.KeyW?1:0)-(this.keys.KeyS?1:0) + this.touchMove.y;
    const sideInput = (this.keys.KeyD?1:0)-(this.keys.KeyA?1:0) + this.touchMove.x;
    const w=new THREE.Vector3().addScaledVector(f, forwardInput).addScaledVector(r, sideInput); if(w.lengthSq()>0) w.normalize();
    this.vel.lerp(w.multiplyScalar(SETTINGS.baseSpeed*(this.keys.ShiftLeft?SETTINGS.runMultiplier:1)), Math.min(dt*15,1));
    this.pos.copy(col.move(this.pos, this.vel.clone().multiplyScalar(dt), SETTINGS.playerRadius));
    const floorY = col.getHeight(this.pos);
    this.pos.y = THREE.MathUtils.lerp(this.pos.y, floorY + SETTINGS.playerHeight, 0.22);
    this.camera.position.copy(this.pos);
    const zInfo = getZone(this.pos.x, this.pos.z);
    const floorIdx = Math.round((this.pos.y - SETTINGS.playerHeight) / SETTINGS.floorHeight);
    const clampedFloorIdx = Math.max(0, Math.min(FLOOR_LABELS.length - 1, floorIdx));
    UI.zoneName.innerText = `${FLOOR_LABELS[clampedFloorIdx]} - ${zInfo.name}`;
    const desiredIndex = ALL_FLOORS.length - 1 - clampedFloorIdx;
    if (UI.floorSelect.selectedIndex !== desiredIndex) { UI.floorSelect.selectedIndex = desiredIndex; }
  }
}

function setupMobileControls(ctrl) {
  if (!IS_TOUCH_DEVICE || !UI.mobileControls || !UI.movePad || !UI.lookPad) return;

  const bindStick = (pad, onMove, onEnd) => {
    const stick = pad.querySelector('.touch-stick');
    let activeId = null;
    const radius = 52;

    const update = (clientX, clientY) => {
      const rect = pad.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = Math.max(-radius, Math.min(radius, clientX - cx));
      const dy = Math.max(-radius, Math.min(radius, clientY - cy));
      if (stick) stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      onMove(dx / radius, dy / radius);
    };

    pad.addEventListener('pointerdown', (e) => {
      activeId = e.pointerId;
      pad.setPointerCapture(activeId);
      update(e.clientX, e.clientY);
      e.preventDefault();
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activeId) return;
      update(e.clientX, e.clientY);
      e.preventDefault();
    });
    const end = (e) => {
      if (e.pointerId !== activeId) return;
      activeId = null;
      if (stick) stick.style.transform = 'translate(-50%, -50%)';
      onEnd();
      e.preventDefault();
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
  };

  bindStick(
    UI.movePad,
    (x, y) => {
      ctrl.touchMove.x = x;
      ctrl.touchMove.y = -y;
    },
    () => {
      ctrl.touchMove.x = 0;
      ctrl.touchMove.y = 0;
    }
  );

  bindStick(
    UI.lookPad,
    (x, y) => {
      ctrl.yaw -= x * SETTINGS.mouseSensitivity * 9;
      ctrl.pitch = Math.max(-1.5, Math.min(1.5, ctrl.pitch - y * SETTINGS.mouseSensitivity * 9));
    },
    () => {}
  );

  if (UI.mobileInteract) {
    UI.mobileInteract.addEventListener('click', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true }));
    });
  }
}

async function init() {
  renderer = new THREE.WebGLRenderer({ antialias: !SETTINGS.performanceMode, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, SETTINGS.performanceMode ? 0.75 : 1.35));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = !SETTINGS.performanceMode;
  if (!SETTINGS.performanceMode) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 500);
  scene.add(camera);
  setupFlashlight();
  scene.add(new THREE.AmbientLight(0xffffff, SETTINGS.performanceMode ? 0.8 : 0.6));
  const sun = new THREE.DirectionalLight(0xfff5e6, SETTINGS.performanceMode ? 1.0 : 1.2);
  sun.position.set(100, 200, 50);
  sun.castShadow = !SETTINGS.performanceMode;
  if (!SETTINGS.performanceMode) {
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
  }
  scene.add(sun);
  ctrl = new FPSController(camera); ctrl.attach(); 
  setupMobileControls(ctrl);
  ROOM_LABELS = await loadJson('./room-labels.json');
  const world = await loadWorld();
  minimapWorld = world;
  addOutdoorEnvironment();
  setupStormSystem();
  if (UI.qualitySelect) {
    applyQualityProfile(UI.qualitySelect.value);
    UI.qualitySelect.addEventListener('change', (e) => applyQualityProfile(e.target.value));
  }
  ctrl.pos.copy(world.floorSafeSpawns[4] || world.spawnPoint || new THREE.Vector3(50.0, SETTINGS.playerHeight, 0.0));
  ctrl.pos.y = 4 * SETTINGS.floorHeight + SETTINGS.playerHeight;
  if (UI.floorSelectOverlay) UI.floorSelectOverlay.selectedIndex = UI.floorSelect.selectedIndex;
  const startExperience = () => {
    if (UI.floorSelectOverlay && UI.floorSelectOverlay.selectedIndex !== UI.floorSelect.selectedIndex) {
      UI.floorSelect.selectedIndex = UI.floorSelectOverlay.selectedIndex;
      UI.floorSelect.dispatchEvent(new Event('change'));
    }
    if (IS_TOUCH_DEVICE || !document.body.requestPointerLock) {
      ctrl.enabled = true;
      ctrl.mobileActive = true;
      UI.overlay.style.display = 'none';
      if (UI.mobileControls) UI.mobileControls.classList.add('active');
      return;
    }
    document.body.requestPointerLock();
  };
  UI.startBtn.addEventListener('click', startExperience);
  document.addEventListener('pointerlockchange', ()=>{
    if (ctrl.mobileActive) return;
    ctrl.enabled = !!document.pointerLockElement;
    if (!ctrl.enabled) ctrl.resetInput();
    UI.overlay.style.display = ctrl.enabled ? 'none' : 'flex';
  });
  UI.floorSelect.addEventListener('change', (e) => {
    if (UI.floorSelectOverlay && UI.floorSelectOverlay.selectedIndex !== e.target.selectedIndex) {
      UI.floorSelectOverlay.selectedIndex = e.target.selectedIndex;
    }
    const fIdx = ALL_FLOORS.length - 1 - e.target.selectedIndex;
    const safe = world.floorSafeSpawns[fIdx];
    if (safe) ctrl.pos.copy(safe);
    ctrl.pos.y = Math.max(0, fIdx) * SETTINGS.floorHeight + SETTINGS.playerHeight;
    ctrl.resetInput();
  });
  if (UI.floorSelectOverlay) {
    UI.floorSelectOverlay.addEventListener('change', (e) => {
      if (UI.floorSelect.selectedIndex !== e.target.selectedIndex) {
        UI.floorSelect.selectedIndex = e.target.selectedIndex;
        UI.floorSelect.dispatchEvent(new Event('change'));
      }
    });
  }
  window.addEventListener('keydown', e=>{
    if (e.repeat) return;
    if(e.code === 'KeyE') {
      const nearestLift = emergencyLockdown ? null : (world.lifts || [])
        .map((l) => {
          const dCall = ctrl ? ctrl.pos.distanceTo(l.call.position) : 999;
          const dDoor = (ctrl && l.center) ? ctrl.pos.distanceTo(l.center) : 999;
          return { l, d: Math.min(dCall, dDoor) };
        })
        .sort((a, b) => a.d - b.d)[0];
      if (nearestLift && nearestLift.d < 3.5) {
        nearestLift.l.openUntil = clock.elapsedTime + 3.0;
        const fIdx = ALL_FLOORS.length - 1 - UI.floorSelect.selectedIndex;
        const targetY = Math.max(0, fIdx) * SETTINGS.floorHeight + 1.3;
        const targetLift = (world.lifts || [])
          .map((l) => ({ l, dy: Math.abs(l.call.position.y - targetY) }))
          .sort((a, b) => a.dy - b.dy)[0];
        if (targetLift) {
          ctrl.pos.x = targetLift.l.call.position.x;
          ctrl.pos.z = targetLift.l.call.position.z;
          targetLift.l.openUntil = clock.elapsedTime + 3.0;
        }
        ctrl.pos.y = Math.max(0, fIdx) * SETTINGS.floorHeight + SETTINGS.playerHeight;
        return;
      }
      raycaster.setFromCamera(new THREE.Vector2(), camera);
      const hits = raycaster.intersectObjects(world.interactables);
      if(hits.length > 0 && hits[0].distance < 3) {
        const ud = hits[0].object.userData || {};
        if (emergencyLockdown && ud.type === 'door') {
          UI.zoneName.innerText = 'Door locked by emergency lockdown';
          return;
        }
        if (ud.type === 'lift') {
          const liftRef = (world.lifts || []).find((l) => l.call === hits[0].object);
          if (liftRef) liftRef.openUntil = clock.elapsedTime + 3.0;
          const fIdx = ALL_FLOORS.length - 1 - UI.floorSelect.selectedIndex;
          const targetY = Math.max(0, fIdx) * SETTINGS.floorHeight + 1.3;
          const targetLift = (world.lifts || [])
            .map((l) => ({ l, dy: Math.abs(l.call.position.y - targetY) }))
            .sort((a, b) => a.dy - b.dy)[0];
          if (targetLift) {
            ctrl.pos.x = targetLift.l.call.position.x;
            ctrl.pos.z = targetLift.l.call.position.z;
            targetLift.l.openUntil = clock.elapsedTime + 3.0;
          }
          ctrl.pos.y = Math.max(0, fIdx) * SETTINGS.floorHeight + SETTINGS.playerHeight;
          return;
        }
        if (ud.toggle) ud.toggle();
      }
    }
  });
  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    if (e.code === 'KeyF') {
      toggleFlashlight();
    }
    if (e.code === 'KeyR') {
      toggleStorm();
    }
    if (e.code === 'KeyU') {
      const floorFromY = Math.round((ctrl.pos.y - SETTINGS.playerHeight) / SETTINGS.floorHeight);
      const targetY = floorFromY * SETTINGS.floorHeight + SETTINGS.playerHeight;
      const sameFloorLifts = (world.lifts || []).filter((l) => Math.abs(l.call.position.y - (floorFromY * SETTINGS.floorHeight + 1.3)) < 0.8);
      const nearest = sameFloorLifts.length > 0
        ? sameFloorLifts.sort((a, b) => ctrl.pos.distanceTo(a.call.position) - ctrl.pos.distanceTo(b.call.position))[0]
        : (world.lifts || [])[0];
      if (nearest) {
        ctrl.pos.set(nearest.call.position.x, targetY, nearest.call.position.z);
        nearest.openUntil = clock.elapsedTime + 3.0;
        console.log('Emergency unstick: moved to lift lobby');
      }
    }
    if (e.code === 'KeyM') {
      activateEmergencyLockdown(world);
    }
  });
  window.addEventListener('resize', () => drawSimulationMinimap());
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;

    if(ctrl.enabled) ctrl.update(dt, GLOBAL_COLLISION);

    world.doorList.forEach(d => { d.pivot.rotation.y += (d.targetRot - d.pivot.rotation.y) * dt * 8; });

    (world.autoDoors || []).forEach(ad => {
      if (ad.kind !== 'slidingEntrance') return;
      const dist = ctrl ? ctrl.pos.distanceTo(ad.pos) : 999;
      if (!emergencyLockdown && dist < 2.6) ad.openUntil = t + 3.0;
      ad.targetOpen = t < ad.openUntil ? 1 : 0;
      ad.openAmount += (ad.targetOpen - ad.openAmount) * Math.min(1, dt * 6.5);

      const slide = ad.maxSlide * ad.openAmount;
      ad.leftShutter.position.x = ad.leftBaseX - slide;
      ad.rightShutter.position.x = ad.rightBaseX + slide;

      // Collision: block when closed, open when sufficiently open
      ad.colW.active = ad.openAmount < 0.25;
      (ad.sideBlockers || []).forEach((b) => { b.active = ad.openAmount < 0.25; });
    });

    (world.lifts || []).forEach((lf) => {
      const nearCall = ctrl ? ctrl.pos.distanceTo(lf.call.position) < 2.4 : false;
      const nearDoor = (ctrl && lf.center) ? ctrl.pos.distanceTo(lf.center) < 2.4 : false;
      const near = nearCall || nearDoor;
      if (!emergencyLockdown && near) lf.openUntil = Math.max(lf.openUntil, t + 0.6);
      const targetOpen = t < lf.openUntil ? 1 : 0;
      lf.openAmount += (targetOpen - lf.openAmount) * Math.min(1, dt * 5.0);
      const slide = lf.maxSlide * lf.openAmount;
      lf.left.position.z = lf.baseLeftZ - slide;
      lf.right.position.z = lf.baseRightZ + slide;
    });

    updateStorm(dt, t);
    drawSimulationMinimap();
    renderer.render(scene, camera);
  }
  animate();
}
init().catch(err=>console.error("Engine Error:", err));
