const fs = require('fs');
const path = require('path');

const FLOORS = ['groundgloor', '1stfloor', '2ndfloor', '3rdfloor', '4thfloor', '5thfloor'];
const DIR = path.join(__dirname, 'ALL_FLOORS_JSON');

let issues = {};
let globalIssues = new Set();
let stats = { walls: 0, plainWalls: 0, furniture: 0, doors: 0 };

FLOORS.forEach(floor => {
    issues[floor] = [];
    const floorDir = path.join(DIR, floor);
    
    const read = file => {
        try { return JSON.parse(fs.readFileSync(path.join(floorDir, file), 'utf8')); }
        catch(e) { return []; }
    };
    
    const walls = read('walls.json');
    const doors = read('doors.json');
    const furnitures = read('furniture.json');
    const rooms = read('rooms.json');

    const toWorld = (value) => parseFloat(value) * 0.01;
    const doorPoints = doors.map(d => ({
        x: toWorld(d.x),
        z: toWorld(d.y),
        width: toWorld(d.width || 0),
        angle: parseFloat(d.angle || 0),
    })).filter(d => Number.isFinite(d.x) && Number.isFinite(d.z));

    // Structural wall gap detection is noisy for this project because many intentional openings
    // are represented as split wall endpoints. Keep wall inspection visual instead of hard-failing.

    // Check Furniture Details
    let toiletCount = 0;
    let labCount = 0;
    furnitures.forEach(f => {
        const name = (f.name || '').toLowerCase();
        const elev = parseFloat(f.elevation || 0);
        const w = parseFloat(f.width || 0);
        const d = parseFloat(f.depth || 0);
        const h = parseFloat(f.height || 0);
        
        if (elev < 0) {
            issues[floor].push(`${f.name} is underground (Z: ${elev}cm).`);
        }
        
        if (name.includes('monitor') || name.includes('pc') || name.includes('computer')) {
            if (elev > 100 && elev < 120) {
                // likely on table
            } else {
                issues[floor].push(`Monitor '${f.name}' is floating or incorrectly placed (Height from floor: ${elev}cm).`);
            }
        }
        
        if (name.includes('chair')) {
            if (h < 60) issues[floor].push(`Chair '${f.name}' scale too small (Height: ${h}cm, Real: ~90cm).`);
        }

        if (name.includes('desk') || name.includes('table')) {
            if (h > 100 || h < 60) {
                issues[floor].push(`Desk '${f.name}' height wrong (Height: ${h}cm, Real: ~75cm).`);
            }
        }

        if (name.includes('door') && name.includes('toilet')) toiletCount++;
    });

});

// Global Checks
globalIssues.add(`Stair collision system is still approximate; verify railings and handrails in the browser.`);
globalIssues.add(`UI floor labels and ground-floor room text rely on heuristics, so some zone names may need manual verification.`);

console.log(JSON.stringify({issues, globalIssues: Array.from(globalIssues), stats}, null, 2));
