import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * COMPLETE REBUILD - SweetHome3D JSON Loader
 * Proper import system for college building visualization
 */

// ==================== CONFIGURATION ====================

const CONFIG = {
  unitScale: 0.01, // 1 SH3D unit = 0.01 meters in scene
  playerHeight: 1.65,
  playerRadius: 0.25,
  mouseSensitivity: 0.002,
  moveSpeed: 4.5,
  runMultiplier: 1.6,
  dataDir: "./ALL_FLOORS_JSON",
  defaultFloor: "4thfloor",
};

// ==================== GLOBALS ====================

let scene, camera, renderer, clock, raycaster;
let currentFloor = CONFIG.defaultFloor;
let floorData = new Map(); // floor -> {walls, doors, windows, furniture, rooms, labels, lights}
let sceneGroups = new Map(); // floor -> THREE.Group
let wallSegments = []; // collision segments
let doorObjects = [];
let furnitureColliders = [];
let doorMeshes = new Map(); // door id -> mesh
let active = null;

let player = {
  pos: new THREE.Vector3(0, CONFIG.playerHeight, 0),
  vel: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  enabled: false,
};

let keys = {};

// ==================== CONSTANTS ====================

const MATERIALS = {
  wall: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
  floor: new THREE.MeshStandardMaterial({ color: 0xd1d1d1, roughness: 0.2 }),
  ceiling: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0 }),
  doorWood: new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.7 }),
  doorFrame: new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.8 }),
  glass: new THREE.MeshStandardMaterial({
    color: 0x88ccff,
    transparent: true,
    opacity: 0.4,
    roughness: 0.1,
  }),
  wood: new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.8 }),
  plastic: new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.6 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.3 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x757575, metalness: 0.8 }),
};

// ==================== UTILITY FUNCTIONS ====================

function toNumber(v, fallback = 0) {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

async function loadJSON(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.warn(`[LOADER] Failed to load ${url}: ${res.status}`);
      return [];
    }
    return await res.json();
  } catch (e) {
    console.warn(`[LOADER] Exception loading ${url}:`, e);
    return [];
  }
}

// ==================== GEOMETRY BUILDERS ====================

function createChairGeometry(w, h, d) {
  const geoms = [];
  const seatH = h * 0.4;
  const legT = 0.05;
  
  // Seat
  geoms.push(new THREE.BoxGeometry(w, 0.05, d).translate(0, seatH, 0));
  // Back
  geoms.push(new THREE.BoxGeometry(w, h - seatH, 0.05).translate(0, seatH + (h - seatH) / 2, -d / 2 + 0.025));
  // Legs
  const legGeo = new THREE.BoxGeometry(legT, seatH, legT);
  geoms.push(legGeo.clone().translate(-w / 2 + legT / 2, seatH / 2, -d / 2 + legT / 2));
  geoms.push(legGeo.clone().translate(w / 2 - legT / 2, seatH / 2, -d / 2 + legT / 2));
  geoms.push(legGeo.clone().translate(-w / 2 + legT / 2, seatH / 2, d / 2 - legT / 2));
  geoms.push(legGeo.clone().translate(w / 2 - legT / 2, seatH / 2, d / 2 - legT / 2));
  
  return { geometries: geoms, material: MATERIALS.plastic };
}

function createTableGeometry(w, h, d) {
  const geoms = [];
  const topT = 0.06;
  const legT = 0.06;
  
  // Top
  geoms.push(new THREE.BoxGeometry(w, topT, d).translate(0, h - topT / 2, 0));
  // Legs
  const legGeo = new THREE.BoxGeometry(legT, h - topT, legT);
  geoms.push(legGeo.clone().translate(-w / 2 + legT, (h - topT) / 2, -d / 2 + legT));
  geoms.push(legGeo.clone().translate(w / 2 - legT, (h - topT) / 2, -d / 2 + legT));
  geoms.push(legGeo.clone().translate(-w / 2 + legT, (h - topT) / 2, d / 2 - legT));
  geoms.push(legGeo.clone().translate(w / 2 - legT, (h - topT) / 2, d / 2 - legT));
  
  return { geometries: geoms, material: MATERIALS.wood };
}

function createDeskGeometry(w, h, d) {
  const geoms = [];
  const topT = 0.06;
  const legT = 0.06;
  
  // Top
  geoms.push(new THREE.BoxGeometry(w, topT, d).translate(0, h - topT / 2, 0));
  // Shelf above
  geoms.push(new THREE.BoxGeometry(w * 0.8, h * 0.4, 0.05).translate(0, h + 0.15, 0));
  // Legs
  const legGeo = new THREE.BoxGeometry(legT, h - topT, legT);
  geoms.push(legGeo.clone().translate(-w / 2 + legT, (h - topT) / 2, -d / 2 + legT));
  geoms.push(legGeo.clone().translate(w / 2 - legT, (h - topT) / 2, -d / 2 + legT));
  geoms.push(legGeo.clone().translate(-w / 2 + legT, (h - topT) / 2, d / 2 - legT));
  geoms.push(legGeo.clone().translate(w / 2 - legT, (h - topT) / 2, d / 2 - legT));
  
  return { geometries: geoms, material: MATERIALS.wood };
}

function createMonitorGeometry(w, h, d) {
  const geoms = [];
  // Screen
  geoms.push(new THREE.BoxGeometry(w * 0.8, h * 0.6, 0.08).translate(0, h * 0.7, 0));
  // Stand
  geoms.push(new THREE.BoxGeometry(w * 0.1, h * 0.3, 0.05).translate(0, h * 0.1, 0));
  // Base
  geoms.push(new THREE.BoxGeometry(w * 0.4, 0.05, d * 0.6).translate(0, 0.025, 0));
  return { geometries: geoms, material: MATERIALS.plastic };
}

function createBedGeometry(w, h, d) {
  const geoms = [];
  const frameT = 0.1;
  
  // Base frame
  geoms.push(new THREE.BoxGeometry(w, frameT, d).translate(0, frameT / 2, 0));
  // Headboard
  geoms.push(new THREE.BoxGeometry(w, h * 0.7, frameT).translate(0, h * 0.35, -d / 2 + frameT / 2));
  // Mattress
  geoms.push(new THREE.BoxGeometry(w * 0.9, h * 0.5, d * 0.8).translate(0, frameT + h * 0.25, 0));
  // Legs
  const legT = 0.08;
  const legGeo = new THREE.BoxGeometry(legT, h * 0.8, legT);
  geoms.push(legGeo.clone().translate(-w / 2 + legT, h * 0.4, -d / 2 + legT));
  geoms.push(legGeo.clone().translate(w / 2 - legT, h * 0.4, -d / 2 + legT));
  geoms.push(legGeo.clone().translate(-w / 2 + legT, h * 0.4, d / 2 - legT));
  geoms.push(legGeo.clone().translate(w / 2 - legT, h * 0.4, d / 2 - legT));
  
  return { geometries: geoms, material: MATERIALS.white };
}

function createSofaGeometry(w, h, d) {
  const geoms = [];
  const baseH = h * 0.3;
  
  // Base cushion
  geoms.push(new THREE.BoxGeometry(w, baseH, d).translate(0, baseH / 2, 0));
  // Back
  geoms.push(new THREE.BoxGeometry(w, h - baseH, 0.2).translate(0, (h - baseH) / 2 + baseH, -d / 2 + 0.1));
  // Armrests
  geoms.push(new THREE.BoxGeometry(0.15, h, 0.15).translate(-w / 2 + 0.1, h / 2, d / 2 - 0.1));
  geoms.push(new THREE.BoxGeometry(0.15, h, 0.15).translate(w / 2 - 0.1, h / 2, d / 2 - 0.1));
  
  return { geometries: geoms, material: MATERIALS.plastic };
}

function createCabinetGeometry(w, h, d) {
  const geoms = [];
  // Main body
  geoms.push(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0));
  // Door panels (detail)
  const doorW = w / 2 - 0.05;
  geoms.push(new THREE.BoxGeometry(doorW, h * 0.8, 0.02).translate(-w / 4, h * 0.5, d / 2 + 0.01));
  geoms.push(new THREE.BoxGeometry(doorW, h * 0.8, 0.02).translate(w / 4, h * 0.5, d / 2 + 0.01));
  
  return { geometries: geoms, material: MATERIALS.wood };
}

function createToiletGeometry(w, h, d) {
  const geoms = [];
  // Bowl
  geoms.push(new THREE.BoxGeometry(w * 0.7, h * 0.3, d * 0.7).translate(0, h * 0.25, 0));
  // Tank
  geoms.push(new THREE.BoxGeometry(w * 0.5, h * 0.8, d * 0.3).translate(0, h * 0.7, -d * 0.2));
  return { geometries: geoms, material: MATERIALS.white };
}

function createSinkGeometry(w, h, d) {
  const geoms = [];
  // Basin
  geoms.push(new THREE.BoxGeometry(w, h * 0.3, d).translate(0, h * 0.15, 0));
  // Faucet
  geoms.push(new THREE.CylinderGeometry(0.05, 0.05, h * 0.5).translate(w * 0.35, h * 0.7, 0));
  return { geometries: geoms, material: MATERIALS.white };
}

function createTVGeometry(w, h, d) {
  const geoms = [];
  // Screen
  geoms.push(new THREE.BoxGeometry(w * 0.9, h * 0.8, 0.08).translate(0, h * 0.6, 0));
  // Stand
  geoms.push(new THREE.BoxGeometry(w, 0.15, d * 0.6).translate(0, 0.075, d * 0.2));
  return { geometries: geoms, material: MATERIALS.plastic };
}

function createGenericGeometry(w, h, d) {
  const geoms = [];
  geoms.push(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0));
  return { geometries: geoms, material: MATERIALS.plastic };
}

// ==================== FURNITURE RECOGNITION ====================

function getFurnitureModel(name, w, h, d) {
  const n = (name || "").toLowerCase();
  
  if (n.includes("chair")) return createChairGeometry(w, h, d);
  if (n.includes("table")) return createTableGeometry(w, h, d);
  if (n.includes("desk")) return createDeskGeometry(w, h, d);
  if (n.includes("monitor") || n.includes("computer") || n.includes("pc") || n.includes("laptop")) {
    return createMonitorGeometry(w, h, d);
  }
  if (n.includes("bed")) return createBedGeometry(w, h, d);
  if (n.includes("sofa") || n.includes("couch")) return createSofaGeometry(w, h, d);
  if (n.includes("cabinet") || n.includes("cupboard") || n.includes("wardrobe")) {
    return createCabinetGeometry(w, h, d);
  }
  if (n.includes("toilet")) return createToiletGeometry(w, h, d);
  if (n.includes("sink") || n.includes("basin")) return createSinkGeometry(w, h, d);
  if (n.includes("tv") || n.includes("screen")) return createTVGeometry(w, h, d);
  
  // Fallback - neutral geometry, NOT a box
  const geoms = [];
  if (h > w && h > d) {
    // Tall object - make slim
    geoms.push(new THREE.CylinderGeometry(w / 3, w / 3, h).translate(0, h / 2, 0));
  } else if (w > d && w > h) {
    // Wide object - make flat
    geoms.push(new THREE.BoxGeometry(w, h * 0.3, d).translate(0, h * 0.15, 0));
  } else {
    // Generic - cone
    geoms.push(new THREE.ConeGeometry(w / 2, h, 8).translate(0, h / 2, 0));
  }
  return { geometries: geoms, material: MATERIALS.plastic };
}

// ==================== SCENE BUILDERS ====================

function buildWalls(wallsData, doorsData, windowsData) {
  const wallGeos = [];
  wallSegments = [];
  
  console.log(`[WALLS] Loading ${wallsData.length} walls`);
  
  wallsData.forEach(wall => {
    const x1 = toNumber(wall.xStart);
    const y1 = toNumber(wall.yStart);
    const x2 = toNumber(wall.xEnd);
    const y2 = toNumber(wall.yEnd);
    const thickness = toNumber(wall.thickness, 15) * CONFIG.unitScale;
    const height = toNumber(wall.height, 400) * CONFIG.unitScale;
    
    // Convert coordinates
    const p1 = new THREE.Vector3(x1 * CONFIG.unitScale, 0, y1 * CONFIG.unitScale);
    const p2 = new THREE.Vector3(x2 * CONFIG.unitScale, 0, y2 * CONFIG.unitScale);
    
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const len = Math.hypot(dx, dz);
    
    if (len < 0.01) return;
    
    // Create wall geometry
    const angle = Math.atan2(dz, dx);
    const mid = new THREE.Vector3(
      (p1.x + p2.x) / 2,
      height / 2,
      (p1.z + p2.z) / 2
    );
    
    const wallGeo = new THREE.BoxGeometry(len, height, thickness);
    wallGeo.rotateY(-angle);
    wallGeo.translate(mid.x, mid.y, mid.z);
    wallGeos.push(wallGeo);
    
    // Add collision segment
    wallSegments.push({
      x1: p1.x,
      z1: p1.z,
      x2: p2.x,
      z2: p2.z,
      thickness: thickness / 2,
    });
  });
  
  if (wallGeos.length > 0) {
    const mesh = new THREE.Mesh(mergeGeometries(wallGeos), MATERIALS.wall);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
  return null;
}

function buildDoorsWindows(doorsData, windowsData) {
  const meshes = [];
  doorObjects = [];
  doorMeshes.clear();
  
  console.log(`[DOORS] Loading ${doorsData.length} doors`);
  console.log(`[WINDOWS] Loading ${windowsData.length} windows`);
  
  // Doors
  doorsData.forEach(door => {
    const x = toNumber(door.x) * CONFIG.unitScale;
    const y = toNumber(door.y) * CONFIG.unitScale;
    const w = toNumber(door.width, 90) * CONFIG.unitScale;
    const h = toNumber(door.height, 210) * CONFIG.unitScale;
    const d = toNumber(door.depth, 15) * CONFIG.unitScale;
    const angle = -toNumber(door.angle, 0);
    
    const group = new THREE.Group();
    group.position.set(x, 0, y);
    group.rotation.y = angle;
    
    // Door frame
    const frameT = 0.06;
    const frameGeo = new THREE.BoxGeometry(w, h, d);
    frameGeo.translate(0, h / 2, 0);
    const frame = new THREE.Mesh(frameGeo, MATERIALS.doorFrame);
    frame.castShadow = true;
    group.add(frame);
    
    // Door leaf (rotating)
    const leafGeo = new THREE.BoxGeometry(w - frameT * 2, h - frameT, 0.05);
    leafGeo.translate(0, h / 2, 0);
    const leaf = new THREE.Mesh(leafGeo, MATERIALS.doorWood);
    leaf.castShadow = true;
    
    const pivot = new THREE.Group();
    pivot.add(leaf);
    group.add(pivot);
    
    // Door data
    const doorData = {
      id: door.id,
      group,
      leaf: pivot,
      pos: new THREE.Vector3(x, 0, y),
      width: w,
      angle,
      isOpen: false,
      currentRot: 0,
      targetRot: 0,
    };
    
    doorObjects.push(doorData);
    doorMeshes.set(door.id, group);
    meshes.push(group);
  });
  
  // Windows
  windowsData.forEach(win => {
    const x = toNumber(win.x) * CONFIG.unitScale;
    const y = toNumber(win.y) * CONFIG.unitScale;
    const w = toNumber(win.width, 100) * CONFIG.unitScale;
    const h = toNumber(win.height, 100) * CONFIG.unitScale;
    const el = toNumber(win.elevation, 90) * CONFIG.unitScale;
    
    const glassGeo = new THREE.BoxGeometry(w, h, 0.05);
    glassGeo.translate(x, el + h / 2, y);
    const glass = new THREE.Mesh(glassGeo, MATERIALS.glass);
    glass.receiveShadow = true;
    meshes.push(glass);
  });
  
  return meshes;
}

function buildFurniture(furnitureData) {
  const meshes = [];
  furnitureColliders = [];
  
  console.log(`[FURNITURE] Loading ${furnitureData.length} items`);
  
  furnitureData.forEach(item => {
    const name = item.name || "";
    
    // Skip non-movable large structures
    if (name.toLowerCase().includes("railing") || name.toLowerCase().includes("staircase")) {
      return;
    }
    
    const x = toNumber(item.x) * CONFIG.unitScale;
    const y = toNumber(item.y) * CONFIG.unitScale;
    const w = toNumber(item.width, 50) * CONFIG.unitScale;
    const d = toNumber(item.depth, 50) * CONFIG.unitScale;
    const h = toNumber(item.height, 50) * CONFIG.unitScale;
    const el = toNumber(item.elevation, 0) * CONFIG.unitScale;
    const angle = -toNumber(item.angle, 0);
    
    // Get appropriate geometry
    const model = getFurnitureModel(name, w, h, d);
    
    // Create mesh
    model.geometries.forEach(geo => {
      geo.rotateY(angle);
      geo.translate(x, el, y);
    });
    
    const mesh = new THREE.Mesh(
      mergeGeometries(model.geometries),
      model.material
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    meshes.push(mesh);
    
    // Add collision if substantial size
    if (h > 0.3) {
      furnitureColliders.push({
        x,
        y,
        w,
        d,
        h,
        el,
        name,
      });
    }
  });
  
  return meshes;
}

// ==================== FLOOR LOADING ====================

async function loadFloor(floorName) {
  console.log(`\n[LOAD] Loading floor: ${floorName}`);
  
  const dir = `${CONFIG.dataDir}/${floorName}`;
  
  const [walls, doors, windows, furniture, rooms, labels, lights] = await Promise.all([
    loadJSON(`${dir}/walls.json`),
    loadJSON(`${dir}/doors.json`),
    loadJSON(`${dir}/windows.json`),
    loadJSON(`${dir}/furniture.json`),
    loadJSON(`${dir}/rooms.json`),
    loadJSON(`${dir}/labels.json`),
    loadJSON(`${dir}/lights.json`),
  ]);
  
  floorData.set(floorName, {
    walls,
    doors,
    windows,
    furniture,
    rooms,
    labels,
    lights,
  });
  
  console.log(`[LOAD] ✓ Floor loaded: ${floorName}`);
  return { walls, doors, windows, furniture, rooms, labels, lights };
}

async function showFloor(floorName) {
  console.log(`\n[SHOW] Displaying floor: ${floorName}`);
  
  // Hide all floors
  sceneGroups.forEach((group) => {
    group.visible = false;
  });
  
  // Show new floor
  if (!sceneGroups.has(floorName)) {
    console.log(`[BUILD] Building scene for: ${floorName}`);
    
    // Load if not cached
    if (!floorData.has(floorName)) {
      await loadFloor(floorName);
    }
    
    const data = floorData.get(floorName);
    const floorGroup = new THREE.Group();
    floorGroup.name = floorName;
    
    // Build walls
    const wallMesh = buildWalls(data.walls, data.doors, data.windows);
    if (wallMesh) floorGroup.add(wallMesh);
    
    // Build doors and windows
    const doorWindowMeshes = buildDoorsWindows(data.doors, data.windows);
    doorWindowMeshes.forEach((m) => floorGroup.add(m));
    
    // Build furniture
    const furnMeshes = buildFurniture(data.furniture);
    furnMeshes.forEach((m) => floorGroup.add(m));
    
    sceneGroups.set(floorName, floorGroup);
    scene.add(floorGroup);
  }
  
  const floorGroup = sceneGroups.get(floorName);
  floorGroup.visible = true;
  
  // Teleport player
  player.pos.set(0, CONFIG.playerHeight, 0);
  player.vel.set(0, 0, 0);
  player.yaw = 0;
  player.pitch = 0;
  
  currentFloor = floorName;
  console.log(`[SHOW] ✓ Floor displayed: ${floorName}`);
}

// ==================== COLLISION ====================

function checkCollision(pos, radius) {
  let finalPos = pos.clone();
  
  // Walls
  wallSegments.forEach((seg) => {
    const dx = seg.x2 - seg.x1;
    const dz = seg.z2 - seg.z1;
    const lenSq = dx * dx + dz * dz;
    
    if (lenSq < 0.0001) return;
    
    const t = clamp(
      ((finalPos.x - seg.x1) * dx + (finalPos.z - seg.z1) * dz) / lenSq,
      0,
      1
    );
    
    const closestX = seg.x1 + t * dx;
    const closestZ = seg.z1 + t * dz;
    
    const distX = finalPos.x - closestX;
    const distZ = finalPos.z - closestZ;
    const dist = Math.hypot(distX, distZ);
    
    if (dist < radius + seg.thickness) {
      const pushDist = radius + seg.thickness - dist;
      if (dist > 0.001) {
        finalPos.x += (distX / dist) * pushDist;
        finalPos.z += (distZ / dist) * pushDist;
      } else {
        finalPos.x += pushDist;
      }
    }
  });
  
  // Furniture
  furnitureColliders.forEach((coll) => {
    const closestX = clamp(finalPos.x, coll.x - coll.w / 2, coll.x + coll.w / 2);
    const closestZ = clamp(finalPos.z, coll.y - coll.d / 2, coll.y + coll.d / 2);
    
    const dx = finalPos.x - closestX;
    const dz = finalPos.z - closestZ;
    const dist = Math.hypot(dx, dz);
    
    if (dist < radius) {
      const pushDist = radius - dist;
      if (dist > 0.001) {
        finalPos.x += (dx / dist) * pushDist;
        finalPos.z += (dz / dist) * pushDist;
      } else {
        finalPos.x += pushDist;
      }
    }
  });
  
  // Closed doors
  doorObjects.forEach((door) => {
    if (door.isOpen) return;
    
    const dx = finalPos.x - door.pos.x;
    const dz = finalPos.z - door.pos.y;
    
    const cos = Math.cos(-door.angle);
    const sin = Math.sin(-door.angle);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    
    if (Math.abs(lx) < door.width / 2 && Math.abs(lz) < 0.15) {
      const dist = Math.abs(lz);
      const pushDist = 0.15 - dist;
      finalPos.z += sin * pushDist;
      finalPos.x += cos * pushDist;
    }
  });
  
  return finalPos;
}

// ==================== INPUT & CAMERA ====================

function updatePlayer(dt) {
  if (!player.enabled) return;
  
  // Calculate move direction
  const yawQuat = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    player.yaw
  );
  const pitchQuat = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    player.pitch
  );
  const quat = new THREE.Quaternion().multiplyQuaternions(yawQuat, pitchQuat);
  
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
  fwd.y = 0;
  fwd.normalize();
  
  const rt = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
  rt.y = 0;
  rt.normalize();
  
  const wish = new THREE.Vector3();
  if (keys.KeyW) wish.addScaledVector(fwd, 1);
  if (keys.KeyS) wish.addScaledVector(fwd, -1);
  if (keys.KeyD) wish.addScaledVector(rt, 1);
  if (keys.KeyA) wish.addScaledVector(rt, -1);
  
  if (wish.lengthSq() > 0) wish.normalize();
  
  const speed = CONFIG.moveSpeed * (keys.ShiftLeft ? CONFIG.runMultiplier : 1);
  player.vel.lerp(wish.multiplyScalar(speed), Math.min(dt * 10, 1));
  
  // Move with collision
  const newPos = player.pos.clone().addScaledVector(player.vel, dt);
  player.pos = checkCollision(newPos, CONFIG.playerRadius);
  
  // Update camera
  camera.position.copy(player.pos);
  camera.quaternion.copy(quat);
}

function setupInput() {
  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (e.code === "KeyE") interactDoor();
  });
  
  window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
  });
  
  document.addEventListener("mousemove", (e) => {
    if (!player.enabled) return;
    player.yaw -= e.movementX * CONFIG.mouseSensitivity;
    player.pitch = clamp(
      player.pitch - e.movementY * CONFIG.mouseSensitivity,
      -Math.PI / 2.5,
      Math.PI / 2.5
    );
  });
  
  document.addEventListener("pointerlockchange", () => {
    player.enabled = document.pointerLockElement === renderer.domElement;
    document.getElementById("overlay").style.display = player.enabled ? "none" : "grid";
  });
  
  document.getElementById("startBtn").addEventListener("click", () => {
    renderer.domElement.requestPointerLock();
  });
  
  document.getElementById("floorSelect").addEventListener("change", (e) => {
    showFloor(e.target.value);
  });
}

function interactDoor() {
  raycaster.setFromCamera(new THREE.Vector2(), camera);
  const intersects = raycaster.intersectObjects(
    Array.from(doorMeshes.values()),
    true
  );
  
  if (intersects.length > 0 && intersects[0].distance < 3) {
    let doorGroup = intersects[0].object;
    while (doorGroup && doorGroup.parent && !doorGroup.userData.isDoor) {
      doorGroup = doorGroup.parent;
    }
    
    const door = doorObjects.find(
      (d) => d.group === doorGroup || d.group === intersects[0].object.parent
    );
    
    if (door) {
      door.isOpen = !door.isOpen;
      door.targetRot = door.isOpen ? Math.PI / 1.8 : 0;
      console.log(`[DOOR] ${door.id}: ${door.isOpen ? "OPEN" : "CLOSED"}`);
    }
  }
}

// ==================== ANIMATION LOOP ====================

function animate() {
  requestAnimationFrame(animate);
  
  const dt = Math.min(clock.getDelta(), 0.05);
  
  updatePlayer(dt);
  
  // Animate doors
  doorObjects.forEach((door) => {
    door.currentRot = lerp(door.currentRot, door.targetRot, Math.min(dt * 8, 1));
    door.leaf.rotation.y = door.currentRot;
  });
  
  renderer.render(scene, camera);
}

// ==================== INITIALIZATION ====================

async function init() {
  console.log("[INIT] Starting initialization...");
  
  // Scene setup
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe1e8ed);
  scene.fog = new THREE.FogExp2(0xe1e8ed, 0.012);
  
  // Camera
  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  
  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);
  
  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(40, 60, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -100;
  sun.shadow.camera.right = 100;
  sun.shadow.camera.top = 100;
  sun.shadow.camera.bottom = -100;
  scene.add(sun);
  
  // Base plane
  const floorPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000),
    MATERIALS.floor
  );
  floorPlane.rotation.x = -Math.PI / 2;
  floorPlane.receiveShadow = true;
  scene.add(floorPlane);
  
  const ceilPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000),
    MATERIALS.ceiling
  );
  ceilPlane.rotation.x = Math.PI / 2;
  ceilPlane.position.y = 5;
  scene.add(ceilPlane);
  
  // Input
  raycaster = new THREE.Raycaster();
  clock = new THREE.Clock();
  setupInput();
  
  // Load first floor
  console.log("[INIT] Loading initial floor...");
  await showFloor(CONFIG.defaultFloor);
  
  // Update UI
  document.getElementById("floorSelect").value = CONFIG.defaultFloor;
  document.getElementById("overlaySub").textContent =
    CONFIG.defaultFloor + " • First-person navigation";
  
  // Handle window resize
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  
  console.log("[INIT] ✓ Initialization complete!");
  console.log("[DEBUG] Ready to explore. Click to play!");
  
  animate();
}

init().catch((err) => {
  console.error("[ERROR] Initialization failed:", err);
});
