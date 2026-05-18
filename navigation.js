import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';

/**
 * CAMPUS AR NAVIGATION SYSTEM
 * Optimized A* pathfinding, 2D mini-map, and WebXR AR integration.
 */

const SETTINGS = {
  unitScale: 0.01,
  jsonDir: './ALL_FLOORS_JSON',
  gridSize: 0.4, 
  floorHeight: 3.8
};

const UI = {
  floorSelect: document.getElementById('floorSelect'),
  startSelect: document.getElementById('startSelect'),
  destSelect: document.getElementById('destSelect'),
  goBtn: document.getElementById('go-btn'),
  statusMsg: document.getElementById('status-msg'),
  minimapCanvas: document.getElementById('minimap-canvas'),
  arBtn: document.getElementById('ar-btn'),
  pickStartBtn: document.getElementById('pick-start-btn'),
  pickDestBtn: document.getElementById('pick-dest-btn'),
  nudgeForward: document.getElementById('nudge-forward'),
  nudgeBack: document.getElementById('nudge-back'),
  nudgeLeft: document.getElementById('nudge-left'),
  nudgeRight: document.getElementById('nudge-right'),
  snapCorridorBtn: document.getElementById('snap-corridor-btn'),
  routeDistance: document.getElementById('route-distance'),
  routeEta: document.getElementById('route-eta'),
  routeTurns: document.getElementById('route-turns')
};

let currentFloor = '4thfloor';
let floorData = { walls: [], doors: [] };
let roomLabels = {};
let navLocations = [];
let startPos = null;
let destPos = null;
let path = [];
let occupancyGrid = null;
let gridBounds = { minX: 0, minZ: 0, maxX: 0, maxZ: 0, width: 0, height: 0 };
let pickMode = 'start';

// --- 1. UTILS ---
async function loadJson(url) { try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.json() : []; } catch(e) { return []; } }
const toWorld = (v) => parseFloat(v) * SETTINGS.unitScale || 0;

// --- 2. DATA LOADING ---
async function loadFloorData(floor) {
  currentFloor = floor;
  const dir = `${SETTINGS.jsonDir}/${floor}`;
  const [walls, doors] = await Promise.all([
    loadJson(`${dir}/walls.json`),
    loadJson(`${dir}/doors.json`)
  ]);
  floorData = { walls, doors };
  startPos = null;
  destPos = null;
  path = [];
  
  calculateGridBounds();
  generateOccupancyGrid();
  updateLocationDropdowns();
  update3DScene();
  setPickMode('start');
  renderMinimap();
  UI.statusMsg.innerText = 'Choose your current location and destination.';
}

function calculateGridBounds() {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  floorData.walls.forEach(w => {
    const x1 = toWorld(w.xStart), z1 = toWorld(w.yStart);
    const x2 = toWorld(w.xEnd), z2 = toWorld(w.yEnd);
    minX = Math.min(minX, x1, x2);
    maxX = Math.max(maxX, x1, x2);
    minZ = Math.min(minZ, z1, z2);
    maxZ = Math.max(maxZ, z1, z2);
  });
  
  const margin = 5;
  gridBounds = {
    minX: minX - margin,
    maxX: maxX + margin,
    minZ: minZ - margin,
    maxZ: maxZ + margin,
    width: maxX - minX + 2 * margin,
    height: maxZ - minZ + 2 * margin
  };
}

function generateOccupancyGrid() {
  const cols = Math.ceil(gridBounds.width / SETTINGS.gridSize);
  const rows = Math.ceil(gridBounds.height / SETTINGS.gridSize);
  occupancyGrid = new Uint8Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = gridBounds.minX + c * SETTINGS.gridSize;
      const z = gridBounds.minZ + r * SETTINGS.gridSize;
      
      let blocked = false;
      for (const w of floorData.walls) {
        const x1 = toWorld(w.xStart), z1 = toWorld(w.yStart);
        const x2 = toWorld(w.xEnd), z2 = toWorld(w.yEnd);
        
        const l2 = (x1-x2)**2 + (z1-z2)**2;
        if (l2 === 0) continue;
        let t = ((x-x1)*(x2-x1) + (z-z1)*(z2-z1)) / l2;
        t = Math.max(0, Math.min(1, t));
        const dist = Math.sqrt((x - (x1 + t*(x2-x1)))**2 + (z - (z1 + t*(z2-z1)))**2);
        
        if (dist < 0.35) {
          let inDoor = false;
          for (const d of floorData.doors) {
            const dx = toWorld(d.x), dz = toWorld(d.y), dw = toWorld(d.width);
            if (Math.hypot(x - dx, z - dz) < dw / 2 + 0.1) { inDoor = true; break; }
          }
          if (!inDoor) { blocked = true; break; }
        }
      }
      if (blocked) occupancyGrid[r * cols + c] = 1;
    }
  }
}

function isWalkableGrid(gx, gz) {
  const cols = Math.ceil(gridBounds.width / SETTINGS.gridSize);
  const rows = Math.ceil(gridBounds.height / SETTINGS.gridSize);
  return gx >= 0 && gx < cols && gz >= 0 && gz < rows && occupancyGrid[gz * cols + gx] !== 1;
}

function worldToGrid(pos) {
  return {
    x: Math.floor((pos.x - gridBounds.minX) / SETTINGS.gridSize),
    z: Math.floor((pos.z - gridBounds.minZ) / SETTINGS.gridSize)
  };
}

function gridToWorld(gx, gz) {
  return {
    x: gridBounds.minX + gx * SETTINGS.gridSize + SETTINGS.gridSize / 2,
    z: gridBounds.minZ + gz * SETTINGS.gridSize + SETTINGS.gridSize / 2
  };
}

function snapToWalkable(pos) {
  const start = worldToGrid(pos);
  if (isWalkableGrid(start.x, start.z)) return gridToWorld(start.x, start.z);

  const maxRadius = 18;
  let best = null;
  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
        const gx = start.x + dx;
        const gz = start.z + dz;
        if (!isWalkableGrid(gx, gz)) continue;
        const candidate = gridToWorld(gx, gz);
        const dist = Math.hypot(candidate.x - pos.x, candidate.z - pos.z);
        if (!best || dist < best.dist) best = { ...candidate, dist };
      }
    }
    if (best) return { x: best.x, z: best.z };
  }
  return pos;
}

function closestPointOnSegment(pos, a, b) {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const l2 = vx * vx + vz * vz;
  if (l2 < 1e-6) return { x: a.x, z: a.z, dist: Math.hypot(pos.x - a.x, pos.z - a.z) };
  const t = Math.max(0, Math.min(1, ((pos.x - a.x) * vx + (pos.z - a.z) * vz) / l2));
  const x = a.x + vx * t;
  const z = a.z + vz * t;
  return { x, z, dist: Math.hypot(pos.x - x, pos.z - z) };
}

function getCorridorCenterlines() {
  const minZ = gridBounds.minZ + 1.4;
  const maxZ = gridBounds.maxZ - 1.4;
  const minX = gridBounds.minX + 1.4;
  const maxX = gridBounds.maxX - 1.4;
  return [
    { a: { x: 48.45, z: minZ }, b: { x: 48.45, z: maxZ } },
    { a: { x: minX, z: 24.2 }, b: { x: maxX, z: 24.2 } },
    { a: { x: minX, z: -16.0 }, b: { x: maxX, z: -16.0 } },
    { a: { x: 48.45, z: 6.2 }, b: { x: 56.5, z: 6.2 } },
    { a: { x: 48.45, z: -3.2 }, b: { x: 56.5, z: -3.2 } }
  ];
}

function snapToCorridor(pos) {
  const walkable = snapToWalkable(pos);
  let best = null;
  for (const segment of getCorridorCenterlines()) {
    const projected = closestPointOnSegment(walkable, segment.a, segment.b);
    const snapped = snapToWalkable(projected);
    const dist = Math.hypot(walkable.x - snapped.x, walkable.z - snapped.z);
    if (!best || dist < best.dist) best = { ...snapped, dist };
  }
  return best ? { x: best.x, z: best.z } : walkable;
}

function setCurrentPosition(pos, message = 'Current position adjusted.', options = {}) {
  startPos = options.corridorSnap === false ? snapToWalkable(pos) : snapToCorridor(pos);
  UI.startSelect.value = '';
  if (destPos) {
    path = getPath(startPos, snapToWalkable(destPos));
    updateRouteSummary(path);
    visualizePath3D();
    if (!path.length) resetRouteSummary();
  } else {
    path = [];
    resetRouteSummary();
  }
  renderMinimap();
  if (isARSessionActive) anchorRouteForAR();
  UI.statusMsg.innerText = message;
}

function nudgeCurrentPosition(dx, dz) {
  if (!startPos) {
    UI.statusMsg.innerText = 'Set your current position before using nudge controls.';
    return;
  }
  setCurrentPosition(
    { x: startPos.x + dx, z: startPos.z + dz },
    'Current position nudged. Use Snap to Corridor if AR alignment drifts.',
    { corridorSnap: false }
  );
}

// --- 3. MINIMAP RENDERING ---
function renderMinimap() {
  const ctx = UI.minimapCanvas.getContext('2d');
  const canvas = UI.minimapCanvas;
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (floorData.walls.length === 0) return;
  
  const scale = Math.min(canvas.width / gridBounds.width, canvas.height / gridBounds.height);
  const offsetX = (canvas.width - gridBounds.width * scale) / 2;
  const offsetY = (canvas.height - gridBounds.height * scale) / 2;
  const toCanvasX = (x) => offsetX + (x - gridBounds.minX) * scale;
  const toCanvasY = (z) => offsetY + (z - gridBounds.minZ) * scale;
  
  canvas.userData = { scale, offsetX, offsetY };

  // Draw Grid (optional, for debug)
  /*
  const cols = Math.ceil(gridBounds.width / SETTINGS.gridSize);
  const rows = Math.ceil(gridBounds.height / SETTINGS.gridSize);
  for(let r=0; r<rows; r++) {
    for(let c=0; c<cols; c++) {
      if(occupancyGrid[r*cols + c] === 1) {
        ctx.fillStyle = 'rgba(255,0,0,0.1)';
        ctx.fillRect(toCanvasX(gridBounds.minX + c*SETTINGS.gridSize), toCanvasY(gridBounds.minZ + r*SETTINGS.gridSize), SETTINGS.gridSize*scale, SETTINGS.gridSize*scale);
      }
    }
  }
  */

  // Draw Walls
  ctx.strokeStyle = '#666'; ctx.lineWidth = 1.5;
  floorData.walls.forEach(w => {
    ctx.beginPath();
    ctx.moveTo(toCanvasX(toWorld(w.xStart)), toCanvasY(toWorld(w.yStart)));
    ctx.lineTo(toCanvasX(toWorld(w.xEnd)), toCanvasY(toWorld(w.yEnd)));
    ctx.stroke();
  });
  
  // Draw Doors
  ctx.strokeStyle = '#00ffcc'; ctx.lineWidth = 2.5;
  floorData.doors.forEach(d => {
    const x = toWorld(d.x), z = toWorld(d.y), w = toWorld(d.width), a = -parseFloat(d.angle || 0);
    const x1 = x - Math.cos(a) * w/2, z1 = z - Math.sin(a) * w/2;
    const x2 = x + Math.cos(a) * w/2, z2 = z + Math.sin(a) * w/2;
    ctx.beginPath(); ctx.moveTo(toCanvasX(x1), toCanvasY(z1)); ctx.lineTo(toCanvasX(x2), toCanvasY(z2)); ctx.stroke();
  });

  // Draw named destinations
  ctx.font = '10px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  navLocations.forEach((loc) => {
    const x = toCanvasX(loc.x);
    const y = toCanvasY(loc.z);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    if (scale > 4.5) {
      ctx.fillStyle = 'rgba(255,255,255,0.78)';
      ctx.fillText(loc.name, x + 5, y);
    }
  });

  // Draw Path
  if (path.length > 1) {
    ctx.strokeStyle = '#00ffcc'; ctx.lineWidth = 3; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(toCanvasX(path[0].x), toCanvasY(path[0].z));
    path.forEach(p => ctx.lineTo(toCanvasX(p.x), toCanvasY(p.z)));
    ctx.stroke(); ctx.setLineDash([]);
  }

  // Markers
  if (startPos) {
    ctx.fillStyle = '#20e06b'; ctx.beginPath(); ctx.arc(toCanvasX(startPos.x), toCanvasY(startPos.z), 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#07120c'; ctx.lineWidth = 2; ctx.stroke();
  }
  if (destPos) {
    ctx.fillStyle = '#ff3b5f'; ctx.beginPath(); ctx.arc(toCanvasX(destPos.x), toCanvasY(destPos.z), 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#18070c'; ctx.lineWidth = 2; ctx.stroke();
  }
}

// --- 4. CLICK HANDLING ---
UI.minimapCanvas.addEventListener('click', (e) => {
  if (!UI.minimapCanvas.userData) return;
  const rect = UI.minimapCanvas.getBoundingClientRect();
  const { scale, offsetX = 0, offsetY = 0 } = UI.minimapCanvas.userData;
  const x = (e.clientX - rect.left - offsetX) / scale + gridBounds.minX;
  const z = (e.clientY - rect.top - offsetY) / scale + gridBounds.minZ;
  const point = snapToWalkable({ x, z });
  
  if (pickMode === 'start') {
    setCurrentPosition(point, 'Current location set and snapped to corridor. Pick your destination.');
    setPickMode('dest');
  } else {
    destPos = point;
    path = [];
    resetRouteSummary();
    UI.destSelect.value = '';
    UI.statusMsg.innerText = "Destination set. Click 'Start Navigation'.";
  }
  renderMinimap();
});

// --- 5. PATHFINDING (A*) ---
function getPath(start, end) {
  const cols = Math.ceil(gridBounds.width / SETTINGS.gridSize);
  const toGridX = (v) => Math.floor((v - gridBounds.minX) / SETTINGS.gridSize);
  const toGridZ = (v) => Math.floor((v - gridBounds.minZ) / SETTINGS.gridSize);
  
  const startG = { x: toGridX(start.x), z: toGridZ(start.z) };
  const endG = { x: toGridX(end.x), z: toGridZ(end.z) };
  
  const openSet = [{ ...startG, g: 0, f: Math.hypot(startG.x - endG.x, startG.z - endG.z), p: null }];
  const closedSet = new Set();
  
  let iter = 0;
  while (openSet.length > 0 && iter < 30000) {
    iter++;
    openSet.sort((a, b) => a.f - b.f);
    const curr = openSet.shift();
    if (curr.x === endG.x && curr.z === endG.z) {
      const p = []; let t = curr;
      while (t) { p.push({ x: gridBounds.minX + t.x * SETTINGS.gridSize, z: gridBounds.minZ + t.z * SETTINGS.gridSize }); t = t.p; }
      return p.reverse();
    }
    closedSet.add(`${curr.x},${curr.z}`);
    
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const nx = curr.x + dx, nz = curr.z + dz;
        if (nx < 0 || nx >= cols || nz < 0 || nz >= occupancyGrid.length/cols) continue;
        if (closedSet.has(`${nx},${nz}`) || occupancyGrid[nz * cols + nx] === 1) continue;
        
        const g = curr.g + Math.hypot(dx, dz);
        const f = g + Math.hypot(nx - endG.x, nz - endG.z);
        const ex = openSet.find(o => o.x === nx && o.z === nz);
        if (ex) { if (g < ex.g) { ex.g = g; ex.f = f; ex.p = curr; } }
        else openSet.push({ x: nx, z: nz, g, f, p: curr });
      }
    }
  }
  return [];
}

// --- 6. NAVIGATION UI ---
function getRoomLabels(floorKey) {
  return roomLabels[floorKey] || { left: [], right: [] };
}

function doorPoints(doorsData) {
  return doorsData
    .map((d, index) => ({ index, x: toWorld(d.x), z: toWorld(d.y), w: toWorld(d.width || 100) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z) && p.w > 0.8);
}

function buildUpperFloorCorridorDoorLabelMap(floorKey, doorsData) {
  const floorNoMap = { '1stfloor': 1, '2ndfloor': 2, '3rdfloor': 3, '4thfloor': 4, '5thfloor': 5 };
  const floorNo = floorNoMap[floorKey];
  const labelByIndex = new Map();
  if (!floorNo) return labelByIndex;

  const allDoorPoints = doorPoints(doorsData);
  const points = allDoorPoints
    .filter((p) => p.w >= 1.2)
    .filter((p) => p.x >= 46.0 && p.x <= 50.6 && p.z >= (floorKey === '3rdfloor' ? -7.0 : -4.5) && p.z <= 22.0);

  const left = points.filter((p) => p.x < 48.2).sort((a, b) => b.z - a.z);
  const right = points.filter((p) => p.x >= 48.2).sort((a, b) => b.z - a.z);
  const labels = getRoomLabels(floorKey);
  const leftNames = labels.left || [];
  const rightNames = labels.right || [];

  const wcCandidates = allDoorPoints
    .filter((p) => p.x >= 50.2 && p.x <= 50.9 && p.z <= -3.0 && p.z >= -11.2)
    .sort((a, b) => b.z - a.z);
  if (wcCandidates.length >= 1) labelByIndex.set(wcCandidates[0].index, 'LADIES WASHROOM');
  if (wcCandidates.length >= 2) labelByIndex.set(wcCandidates[1].index, 'GENTS WASHROOM');

  const uniqueLeft = [];
  for (const p of left) {
    if (!uniqueLeft.some((u) => Math.abs(u.x - p.x) < 0.12 && Math.abs(u.z - p.z) < 0.12)) uniqueLeft.push(p);
  }
  for (let i = 0; i < leftNames.length && i < uniqueLeft.length; i++) labelByIndex.set(uniqueLeft[i].index, leftNames[i]);

  if (floorKey === '2ndfloor') {
    labelByIndex.set(3, rightNames[0] || 'LAB 206');
    labelByIndex.set(1, rightNames[1] || 'LAB 207');
    return labelByIndex;
  }

  if (floorKey === '4thfloor') labelByIndex.set(5, 'MEETING ROOM');

  const rightDoors = right
    .filter((p) => p.x < 50.2 && p.z <= 10.0 && p.z >= -7.0)
    .sort((a, b) => b.z - a.z);
  for (let i = 0; i < rightNames.length && i < rightDoors.length; i++) labelByIndex.set(rightDoors[i].index, rightNames[i]);

  if (labelByIndex.size === 0 && floorKey === '3rdfloor') {
    let seq = 1;
    for (const p of left) labelByIndex.set(p.index, `CLASSROOM ${floorNo}${String(seq++).padStart(2, '0')}`);
    for (const p of right) labelByIndex.set(p.index, `CLASSROOM ${floorNo}${String(seq++).padStart(2, '0')}`);
  }

  return labelByIndex;
}

function buildGroundFloorDoorLabelMap(doorsData) {
  const labelByIndex = new Map();
  const labels = getRoomLabels('groundgloor');
  const points = doorPoints(doorsData);
  const left = points.filter((p) => p.x < 48).sort((a, b) => b.z - a.z);
  const rightCorridor = points
    .filter((p) => p.x >= 48 && p.z <= 10.0 && p.z >= -10.5 && p.x <= 51.0 && p.w >= 1.0)
    .sort((a, b) => b.z - a.z);

  (labels.left || []).forEach((name, i) => { if (left[i]) labelByIndex.set(left[i].index, name); });
  (labels.right || []).forEach((name, i) => { if (rightCorridor[i]) labelByIndex.set(rightCorridor[i].index, name); });
  return labelByIndex;
}

function buildNavLocations() {
  const labelMap = currentFloor === 'groundgloor'
    ? buildGroundFloorDoorLabelMap(floorData.doors)
    : buildUpperFloorCorridorDoorLabelMap(currentFloor, floorData.doors);

  const seen = new Set();
  const locations = [];
  for (const point of doorPoints(floorData.doors)) {
    const name = labelMap.get(point.index);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    locations.push({ id: `door-${point.index}`, name, ...snapToWalkable({ x: point.x, z: point.z }) });
  }

  locations.push(
    { id: 'corridor-main', name: 'MAIN CORRIDOR', ...snapToWalkable({ x: 48.4, z: 5.0 }) },
    { id: 'lift-lobby', name: 'LIFT / STAIR LOBBY', ...snapToWalkable({ x: 49.4, z: 12.2 }) }
  );

  return locations.sort((a, b) => a.name.localeCompare(b.name));
}

function fillLocationSelect(select, placeholder) {
  select.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.innerText = placeholder;
  select.appendChild(empty);

  for (const loc of navLocations) {
    const opt = document.createElement('option');
    opt.value = loc.id;
    opt.innerText = loc.name;
    select.appendChild(opt);
  }
}

function findLocation(id) {
  return navLocations.find((loc) => loc.id === id);
}

function setPickMode(mode) {
  pickMode = mode;
  UI.pickStartBtn.classList.toggle('active', mode === 'start');
  UI.pickDestBtn.classList.toggle('active', mode === 'dest');
}

function resetRouteSummary() {
  if (UI.routeDistance) UI.routeDistance.innerText = '--';
  if (UI.routeEta) UI.routeEta.innerText = '--';
  if (UI.routeTurns) UI.routeTurns.innerText = '--';
}

function routeDistanceMeters(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }
  return total;
}

function routeTurnCount(points) {
  let turns = 0;
  for (let i = 2; i < points.length; i++) {
    const ax = points[i - 1].x - points[i - 2].x;
    const az = points[i - 1].z - points[i - 2].z;
    const bx = points[i].x - points[i - 1].x;
    const bz = points[i].z - points[i - 1].z;
    const al = Math.hypot(ax, az) || 1;
    const bl = Math.hypot(bx, bz) || 1;
    const dot = (ax * bx + az * bz) / (al * bl);
    if (dot < 0.72) turns++;
  }
  return turns;
}

function updateRouteSummary(points) {
  if (!points || points.length < 2) {
    resetRouteSummary();
    return;
  }
  const meters = routeDistanceMeters(points);
  const etaMinutes = Math.max(1, Math.round(meters / 70));
  if (UI.routeDistance) UI.routeDistance.innerText = `${meters.toFixed(0)} m`;
  if (UI.routeEta) UI.routeEta.innerText = `${etaMinutes} min`;
  if (UI.routeTurns) UI.routeTurns.innerText = String(routeTurnCount(points));
}

UI.goBtn.addEventListener('click', () => {
  if (!startPos || !destPos) {
    UI.statusMsg.innerText = 'Select both current location and destination first.';
    return;
  }
  path = getPath(snapToWalkable(startPos), snapToWalkable(destPos));
  if (path.length > 0) {
    renderMinimap();
    visualizePath3D();
    updateRouteSummary(path);
    UI.statusMsg.innerText = `Route ready: ${path.length} waypoints. Follow the cyan line.`;
  }
  else {
    resetRouteSummary();
    UI.statusMsg.innerText = 'No path found. Pick a nearby corridor point and try again.';
  }
});

UI.destSelect.addEventListener('change', (e) => {
  const loc = findLocation(e.target.value);
  if (!loc) return;
  destPos = { x: loc.x, z: loc.z };
  path = [];
  resetRouteSummary();
  renderMinimap();
  UI.statusMsg.innerText = `Destination set: ${loc.name}.`;
});

UI.startSelect.addEventListener('change', (e) => {
  const loc = findLocation(e.target.value);
  if (!loc) return;
  setCurrentPosition({ x: loc.x, z: loc.z }, `Current location set: ${loc.name}.`);
  setPickMode('dest');
});

UI.pickStartBtn.addEventListener('click', () => {
  setPickMode('start');
  UI.statusMsg.innerText = 'Click the minimap to set your current location.';
});

UI.pickDestBtn.addEventListener('click', () => {
  setPickMode('dest');
  UI.statusMsg.innerText = 'Click the minimap to set where you want to go.';
});

if (UI.nudgeForward) UI.nudgeForward.addEventListener('click', () => nudgeCurrentPosition(0, -0.4));
if (UI.nudgeBack) UI.nudgeBack.addEventListener('click', () => nudgeCurrentPosition(0, 0.4));
if (UI.nudgeLeft) UI.nudgeLeft.addEventListener('click', () => nudgeCurrentPosition(-0.4, 0));
if (UI.nudgeRight) UI.nudgeRight.addEventListener('click', () => nudgeCurrentPosition(0.4, 0));
if (UI.snapCorridorBtn) {
  UI.snapCorridorBtn.addEventListener('click', () => {
    if (!startPos) {
      UI.statusMsg.innerText = 'Set your current position before snapping.';
      return;
    }
    setCurrentPosition(startPos, 'Current position snapped to nearest corridor.');
  });
}

UI.floorSelect.addEventListener('change', (e) => loadFloorData(e.target.value));

function updateLocationDropdowns() {
  navLocations = buildNavLocations();
  fillLocationSelect(UI.startSelect, 'Select Current Location');
  fillLocationSelect(UI.destSelect, 'Select Destination');
  resetRouteSummary();
}

// --- 7. 3D VISUALIZATION ---
let scene, camera, renderer, pathGroup, floorGroup;
let isARSessionActive = false;

function resetFloorGroupTransform() {
  if (!floorGroup) return;
  floorGroup.position.set(0, 0, 0);
  floorGroup.scale.setScalar(1);
}

function setBuildingModelVisible(visible) {
  if (!floorGroup) return;
  floorGroup.children.forEach((child) => {
    if (child !== pathGroup) child.visible = visible;
  });
}

function anchorRouteForAR() {
  if (!floorGroup || !startPos) return;

  floorGroup.scale.setScalar(1);
  floorGroup.position.set(-startPos.x, -0.45, -startPos.z - 1.5);
  setBuildingModelVisible(false);
}

function init3D() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e14);
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(50, 40, 30);
  
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);
  
  const arButton = ARButton.createButton(renderer, { requiredFeatures: ['hit-test'] });
  document.body.appendChild(arButton);

  renderer.xr.addEventListener('sessionstart', () => {
    isARSessionActive = true;
    anchorRouteForAR();
    UI.statusMsg.innerText = path.length > 1
      ? 'AR route anchored. Follow the bright arrows in front of you.'
      : 'Select a route before using AR navigation.';
  });

  renderer.xr.addEventListener('sessionend', () => {
    isARSessionActive = false;
    resetFloorGroupTransform();
    setBuildingModelVisible(true);
  });

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 0.5); sun.position.set(5, 10, 5); scene.add(sun);
  
  floorGroup = new THREE.Group(); scene.add(floorGroup);
  
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  
  renderer.setAnimationLoop(() => renderer.render(scene, camera));
}

function update3DScene() {
  resetFloorGroupTransform();
  while(floorGroup.children.length > 0) floorGroup.remove(floorGroup.children[0]);
  pathGroup = null;
  
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x334455 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x112233 });
  
  // Floor slab
  const floorGeo = new THREE.PlaneGeometry(gridBounds.width, gridBounds.height);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI/2;
  floor.position.set((gridBounds.minX + gridBounds.maxX)/2, 0, (gridBounds.minZ + gridBounds.maxZ)/2);
  floorGroup.add(floor);
  
  // Walls
  floorData.walls.forEach(w => {
    const x1 = toWorld(w.xStart), z1 = toWorld(w.yStart);
    const x2 = toWorld(w.xEnd), z2 = toWorld(w.yEnd);
    const len = Math.hypot(x2-x1, z2-z1);
    const ang = -Math.atan2(z2-z1, x2-x1);
    const box = new THREE.Mesh(new THREE.BoxGeometry(len, 2.5, 0.2), wallMat);
    box.position.set((x1+x2)/2, 1.25, (z1+z2)/2); box.rotation.y = ang;
    floorGroup.add(box);
  });
  
  if (startPos && !isARSessionActive) {
    camera.position.set(startPos.x, 30, startPos.z + 20);
    camera.lookAt(startPos.x, 0, startPos.z);
  }

  if (isARSessionActive) anchorRouteForAR();
}

function visualizePath3D() {
  if (pathGroup) floorGroup.remove(pathGroup);
  if (path.length < 2) return;
  pathGroup = new THREE.Group();
  
  const points = path.map(p => new THREE.Vector3(p.x, 0.22, p.z));
  const curve = new THREE.CatmullRomCurve3(points);
  const tubeGeo = new THREE.TubeGeometry(curve, path.length * 2, 0.13, 10, false);
  const tubeMat = new THREE.MeshBasicMaterial({
    color: 0x00ffcc,
    transparent: true,
    opacity: 0.95,
    depthTest: false
  });
  pathGroup.add(new THREE.Mesh(tubeGeo, tubeMat));
  
  const arrowGeo = new THREE.ConeGeometry(0.35, 0.85, 3);
  const arrowMat = new THREE.MeshBasicMaterial({
    color: 0xfff04a,
    depthTest: false
  });
  const baseDirection = new THREE.Vector3(0, 1, 0);
  for(let i=1; i<path.length; i+=5) {
    const next = path[Math.min(i+1, path.length-1)];
    const direction = new THREE.Vector3(next.x - path[i].x, 0, next.z - path[i].z);
    if (direction.lengthSq() === 0) continue;
    direction.normalize();

    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.position.set(path[i].x, 0.38, path[i].z);
    arrow.quaternion.setFromUnitVectors(baseDirection, direction);
    arrow.renderOrder = 10;
    pathGroup.add(arrow);
  }
  floorGroup.add(pathGroup);

  if (isARSessionActive) anchorRouteForAR();
}

async function initNavigation() {
  roomLabels = await loadJson('./room-labels.json');
  init3D();
  await loadFloorData('4thfloor');
}

initNavigation();
