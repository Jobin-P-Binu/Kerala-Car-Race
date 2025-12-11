// Game Configuration
const CONFIG = {
    MAX_SPEED: 40, // Increased for 3D sensation
    ACCELERATION: 0.6,
    TURNING_SPEED: 0.04,
    FRICTION: 0.96,
    OFFROAD_FRICTION: 0.9,
    CAMERA_HEIGHT: 150,
    CAMERA_DIST: 400, // Distance behind car
    FOV: 600, // Perspective scale
    ROAD_WIDTH: 400
};

// Game State
const state = {
    screen: 'loading',
    selectedCar: 'ferrari',
    difficulty: 'medium',
    cars: [],
    camera: { x: 0, y: 0, z: 0, angle: 0 },
    particles: [],
    // World now just a list of objects for the highway
    world: {
        backgroundObjects: [], // Scenery
        roadSegments: []
    },
    totalDistance: 0
};

// Assets
const assets = {
    images: {},
    sources: {
        car_ferrari: 'assets/car_ferrari.png',
        car_lamborghini: 'assets/car_lamborghini.png',
        car_porsche: 'assets/car_porsche.png',
        bg_music: 'music/bgm.mp3' // Placeholder key, logic handled via HTML tag
    }
};

// Setup Canvas
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false }); // No alpha for background perf

// Input
const keys = {
    w: false, a: false, s: false, d: false,
    ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false,
    Shift: false
};

window.addEventListener('keydown', e => {
    keys[e.key] = true;
    if (e.key === 'h' || e.key === 'H') audio.playHorn();
});
window.addEventListener('keyup', e => keys[e.key] = false);
window.addEventListener('resize', resize);

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
resize();

// ============================================
// AUDIO SYSTEM
// ============================================
const audioTag = document.getElementById('bg-music');
audioTag.volume = 0.5;

window.toggleMute = function () {
    audioTag.muted = !audioTag.muted;
    const btn = document.getElementById('mute-btn');
    btn.innerHTML = audioTag.muted ? '🔇' : '🔊';
}

class AudioController {
    constructor() {
        this.ctx = null;
        this.initialized = false;
        this.engineOsc = null;
        this.engineGain = null;
    }

    init() {
        if (this.initialized) return;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.setupEngine();
            this.initialized = true;
        } catch (e) { console.warn('Audio init failed', e); }
    }

    setupEngine() {
        this.engineOsc = this.ctx.createOscillator();
        this.engineOsc.type = 'sawtooth';
        this.engineOsc.frequency.value = 60;
        this.engineGain = this.ctx.createGain();
        this.engineGain.gain.value = 0;
        this.engineOsc.connect(this.engineGain);
        this.engineGain.connect(this.ctx.destination);
        this.engineOsc.start();
    }

    playHorn() {
        if (!this.initialized) return;
        const osc = this.ctx.createOscillator();
        osc.frequency.value = 400;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.5);
    }

    updateEngine(speed) {
        if (!this.initialized) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const absSpeed = Math.abs(speed);
        // Pitch rises with speed
        this.engineOsc.frequency.setTargetAtTime(60 + absSpeed * 10, this.ctx.currentTime, 0.1);
        // Volume rises with speed
        this.engineGain.gain.setTargetAtTime(0.05 + (absSpeed / CONFIG.MAX_SPEED) * 0.1, this.ctx.currentTime, 0.1);
    }
}
const audio = new AudioController();

document.addEventListener('click', () => { if (!audio.initialized) audio.init(); }, { once: true });

// ============================================
// 3D PROJECTION MATH
// ============================================
// Project world X,Y,Z to Screen X,Y,Scale
function project(p, camera) {
    // 1. Translate relative to camera
    // We assume Camera is at (camX, camY, camZ) looking North (-Y)
    // Actually, let's keep it simple: Camera looks "Forward" based on its angle.
    // For this game, "Forward" is generally -Y in world space, but let's support rotation.

    let relX = p.x - camera.x;
    let relY = p.y - camera.y;
    let relZ = p.z - camera.z; // World Z is typically 0 for ground objects

    // 2. Rotate around Camera (Yaw)
    // If angle is 0, we look -Y? Let's say Angle 0 is facing North (-Y)
    // Standard rotation formula:
    // x' = x cos - y sin
    // y' = x sin + y cos
    // Our "Forward" is -Y.
    // Let's rotate so that "Forward" becomes +Z in camera space (depth).
    // This is getting complex for a simple racer.
    // Simpler Approch:
    // Camera is strictly behind car. Camera Rotation matches Car Rotation.
    // We rotate the world around the camera so the camera always points "Up" (screen -Y).

    // Rotation Angle: -camera.angle - Math.PI/2 (to align North to Up)
    const theta = -camera.angle - Math.PI / 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);

    const rx = relX * cos - relY * sin;
    const ry = relX * sin + relY * cos; // ry is now "depth" (negative if in front? wait)

    // If facing North (Angle -PI/2):
    // theta = -(-PI/2) - PI/2 = 0.
    // rx = x, ry = y.
    // If y is negative (North), ry is negative.
    // We want +Depth to be Forward. So Let's invert Y.
    const depth = -ry;

    if (depth <= 10) return null; // Behind camera or too close

    // 3. Perspective Projection
    const scale = CONFIG.FOV / depth;
    const sx = rx * scale + canvas.width / 2; // X is lateral
    const sy = (relZ - CONFIG.CAMERA_HEIGHT) * scale + canvas.height / 2; // Z is Up/Down

    return { x: sx, y: sy, scale: scale, depth: depth };
}

// ============================================
// WORLD GENERATION (HIGHWAY & SCENERY)
// ============================================
function generateWorld() {
    // Generate a long highway
    // We'll generate "Waypoints" or objects.
    // For a smoother road, strict segments would be better, but "Objects on Side" works for free-roam feel.
    // Road Segments: Just logical definitions for drawing the "Grey Strip"

    let y = 0;
    const length = 50000; // 50km

    // Add trees on sides
    for (let i = 0; i < 400; i++) {
        // Left Side
        state.world.backgroundObjects.push({
            type: 'tree',
            x: -CONFIG.ROAD_WIDTH / 2 - 200 - Math.random() * 300,
            y: -i * 150 + (Math.random() * 50),
            z: 0 // Ground
        });

        // Right Side
        state.world.backgroundObjects.push({
            type: 'tree',
            x: CONFIG.ROAD_WIDTH / 2 + 200 + Math.random() * 300,
            y: -i * 150 + (Math.random() * 50),
            z: 0
        });

        // Occasional Building
        if (i % 20 === 0) {
            const side = Math.random() > 0.5 ? 1 : -1;
            state.world.backgroundObjects.push({
                type: 'building',
                x: side * (CONFIG.ROAD_WIDTH / 2 + 600),
                y: -i * 150,
                z: 0
            });
        }
    }
}

// ============================================
// CAR & ENTITIES
// ============================================
class Car {
    constructor(type, x, y, isAI = false) {
        this.type = type;
        this.x = x;
        this.y = y;
        this.z = 0; // Altitude
        this.isAI = isAI;
        this.angle = -Math.PI / 2; // Facing North
        this.speed = 0;
        this.img = assets.images[`car_${type}`] || assets.images['car_ferrari'];
        // Physical dimensions
        this.width = 80;
        this.length = 160;

        this.nitro = 100;
        this.velX = 0;
        this.velY = 0;
    }

    update() {
        if (state.screen !== 'drive') return;

        let gas = 0;
        let turn = 0;

        if (!this.isAI) {
            if (keys.w || keys.ArrowUp) gas = 1;
            if (keys.s || keys.ArrowDown) gas = -1;
            if (keys.a || keys.ArrowLeft) turn = -1;
            if (keys.d || keys.ArrowRight) turn = 1;

            // Nitro
            if (keys.Shift && this.nitro > 0 && gas > 0) {
                gas *= 2.0;
                this.nitro -= 0.5;
            } else if (this.nitro < 100) this.nitro += 0.2;
        } else {
            // Simple AI: Drive forward, stay in lane
            gas = 0.8;
            // Lane Assist
            if (this.x > 200) turn = -0.5;
            if (this.x < -200) turn = 0.5;
        }

        // Physics
        this.speed += gas * CONFIG.ACCELERATION;
        this.speed *= CONFIG.FRICTION;

        // Turning (Drift feel)
        if (Math.abs(this.speed) > 1) {
            this.angle += turn * CONFIG.TURNING_SPEED * (this.speed > 0 ? 1 : -1);
        }

        this.velX = Math.cos(this.angle) * this.speed;
        this.velY = Math.sin(this.angle) * this.speed;

        this.x += this.velX;
        this.y += this.velY;

        // Road Boundaries (Soft Wall)
        if (Math.abs(this.x) > CONFIG.ROAD_WIDTH / 2 + 200) {
            this.speed *= 0.9; // Slow down off-road
        }

        if (!this.isAI) {
            audio.updateEngine(this.speed);
        }
    }

    draw(ctx, camera) {
        const p = project(this, camera);
        if (!p) return;

        ctx.save();
        ctx.translate(p.x, p.y);
        // Rotation: Car Angle relative to Camera Angle
        // Visual Rotation = CarAngle - CameraAngle - PI/2
        // If CarAngle == CameraAngle (driving straight), Visual Rotation = -PI/2 (Up)
        // Wait, Canvas rotation 0 is Right. -PI/2 is Up.
        const relAngle = this.angle - camera.angle - Math.PI / 2;

        // However, we are drawing a top-down sprite in 3D?
        // Ideally we need 'Rear View' sprites.
        // Since we only have top-down sprites, we cheat:
        // We scale Y less than X to make it look flat ?
        // Or just rotate it. 
        // Let's rotate it to face Up (-PI/2) plus relative turn.

        // Actually, pseudo-3D usually uses sprites that are pre-rendered at angles.
        // We only have top-down. 
        // "Mode 7" style: The sprite lies flat on the ground.
        // To simulate this with `drawImage`, we can skew/scale.
        // Simple: Just draw it standard for now, user asked for "convert to 3d real world" 
        // using existing assets which are top down. 
        // Best approach for top-down assets in 3D:
        // Draw them facing 'Up' on screen, maybe squish height to look like they are on road.

        ctx.rotate(relAngle);
        ctx.scale(p.scale, p.scale * 0.6); // Squish Y for perspective

        // Car Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(-this.width / 2 + 5, -this.length / 2 + 5, this.width, this.length);

        ctx.drawImage(this.img, -this.width / 2, -this.length / 2, this.width, this.length);
        ctx.restore();
    }
}

// ============================================
// CORE SYSTEM
// ============================================

function init() {
    loadAssets().then(() => {
        document.getElementById('loading').classList.add('hidden');
        showMenu();
        generateWorld();
    });
}

function loadAssets() {
    let promises = [];
    for (let key in assets.sources) {
        if (key === 'bg_music') continue;
        let p = new Promise((resolve) => {
            const img = new Image();
            img.src = assets.sources[key];
            img.onload = () => { assets.images[key] = img; resolve(); };
            img.onerror = resolve;
        });
        promises.push(p);
    }
    return Promise.all(promises);
}

function showMenu() {
    state.screen = 'menu';
    document.getElementById('main-menu').classList.remove('hidden');
    document.getElementById('hud').classList.remove('visible');

    // Play Menu Music
    audioTag.currentTime = 0;
    audioTag.play().catch(e => console.warn(e));
}

window.selectCar = function (type, el) {
    state.selectedCar = type;
    document.querySelectorAll('.car-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
}

window.startGame = function () {
    // STOP Menu Music
    audioTag.pause();

    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('hud').classList.add('visible');

    // Init Player
    state.cars = [new Car(state.selectedCar, 50, 0)];

    // Init AI
    state.cars.push(new Car('lamborghini', -100, -300, true));
    state.cars.push(new Car('porsche', 100, -600, true));

    state.screen = 'drive';
    audio.init(); // Engine sound start
    requestAnimationFrame(gameLoop);
}

function drawCoconutTree(ctx, obj, camera) {
    const p = project(obj, camera);
    if (!p) return;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(p.scale, p.scale);

    // Simple Procedural Palm Tree (Upright billboard style)
    // Since it's standing up, we draw it from bottom center up.

    // Trunk
    ctx.fillStyle = '#4e342e';
    ctx.beginPath();
    ctx.moveTo(-5, 0); // Base
    ctx.lineTo(5, 0);
    ctx.lineTo(0, -150); // Top
    ctx.fill();

    // Leaves
    ctx.strokeStyle = '#2e7d32';
    ctx.lineWidth = 4;
    ctx.translate(0, -150);
    for (let i = 0; i < 8; i++) {
        ctx.save();
        ctx.rotate(i * (Math.PI / 4));
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(30, -20, 60, 20);
        ctx.stroke();
        ctx.restore();
    }

    // Coconuts
    ctx.fillStyle = 'orange';
    ctx.beginPath(); ctx.arc(-5, 5, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(5, 5, 5, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
}

function drawBuilding(ctx, obj, camera) {
    const p = project(obj, camera);
    if (!p) return;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(p.scale, p.scale);

    // Simple Shop
    ctx.fillStyle = '#fdd835';
    ctx.fillRect(-60, -80, 120, 80); // Up from ground
    ctx.fillStyle = '#ef5350'; // Roof
    ctx.beginPath();
    ctx.moveTo(-70, -80);
    ctx.lineTo(0, -130);
    ctx.lineTo(70, -80);
    ctx.fill();

    ctx.restore();
}

function drawRoad(ctx, camera) {
    // Draw infinite road strip
    // We draw segments from Z-Far to Z-Near
    // Optimally: Just draw a big polygon for the road extending to horizon

    // 1. Horizon Line
    // 2. Road Polygons (Center Strip)

    // Draw Road from player position to arbitrary distance forward
    // Segmented approach for curvature would be best, but for straight infinite road:
    // Just draw two lines converging to vanishing point?
    // Let's draw discrete segments to allow for future curvature support

    const segmentLength = 200;
    const drawDist = 30; // 30 segments * 200 = 6000 units
    const playerY = state.cars[0].y;

    // Calculate start segment index
    const startIdx = Math.floor(-playerY / segmentLength);

    for (let i = drawDist; i >= 0; i--) { // Draw back to front
        const z1 = (startIdx + i) * segmentLength;
        const z2 = (startIdx + i + 1) * segmentLength;
        const y1 = -z1; // World Y is negative forward
        const y2 = -z2;

        const p1 = project({ x: -CONFIG.ROAD_WIDTH / 2, y: y1, z: 0 }, camera);
        const p2 = project({ x: CONFIG.ROAD_WIDTH / 2, y: y1, z: 0 }, camera);
        const p3 = project({ x: CONFIG.ROAD_WIDTH / 2, y: y2, z: 0 }, camera);
        const p4 = project({ x: -CONFIG.ROAD_WIDTH / 2, y: y2, z: 0 }, camera);

        if (!p1 || !p3) continue; // Clipped

        // Grass/Ground
        // (Optional: Draw distinct grass color per segment for speed illusion)

        // Road
        ctx.fillStyle = (startIdx + i) % 2 === 0 ? '#37474f' : '#3e5059'; // Alternating asphalt
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.fill();

        // Side Lines
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 4 * p1.scale;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.stroke();

        // Center Line
        if ((startIdx + i) % 2 === 0) {
            const pm1 = project({ x: 0, y: y1, z: 0 }, camera);
            const pm2 = project({ x: 0, y: y2, z: 0 }, camera);
            if (pm1 && pm2) {
                ctx.strokeStyle = '#ffeb3b';
                ctx.lineWidth = 4 * pm1.scale;
                ctx.beginPath();
                ctx.moveTo(pm1.x, pm1.y);
                ctx.lineTo(pm2.x, pm2.y);
                ctx.stroke();
            }
        }
    }
}

function gameLoop() {
    // 1. Update State
    const player = state.cars[0];

    state.cars.forEach(c => c.update());

    // Update Camera (Chase Cam)
    // Target: Behind car, up. 
    // Lerp for smoothness
    const targetX = player.x - Math.sin(player.angle) * -CONFIG.CAMERA_DIST; // Actually player.x is position. 
    // Camera X should follow Player X but smooth.
    state.camera.x += (player.x - state.camera.x) * 0.1;

    // Camera Y: Player is moving -Y. Camera should be at PlayerY + Dist
    const targetY = player.y - Math.sin(player.angle) * -CONFIG.CAMERA_DIST;
    // Just simple trailing for now:
    state.camera.y = player.y + 400; // Fixed distance behind for straight road test
    state.camera.z = CONFIG.CAMERA_HEIGHT;
    state.camera.angle = -Math.PI / 2; // Fixed Looking North

    // 2. Draw
    // Sky
    var grd = ctx.createLinearGradient(0, 0, 0, canvas.height / 2);
    grd.addColorStop(0, "#2196f3");
    grd.addColorStop(1, "#b3e5fc");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Ground (horizon down)
    ctx.fillStyle = '#2e7d32'; // Kerala Green
    ctx.fillRect(0, canvas.height / 2, canvas.width, canvas.height / 2);

    // Road
    drawRoad(ctx, state.camera);

    // Objects (Trees, Buildings, Cars)
    // We need to sort ALL objects by Z (distance from camera).
    // In our -Y forward system, smaller Y is further away.
    // So sort descending Y? No.
    // Objects with Y < CameraY are in front.
    // The further (smaller) Y, the further away.
    // Painters algo: Draw furthest first (Smallest Y first).

    let renderList = [];

    state.world.backgroundObjects.forEach(obj => renderList.push({ type: 'scenery', ref: obj, y: obj.y }));
    state.cars.forEach(car => renderList.push({ type: 'car', ref: car, y: car.y }));

    // Filter visible (simple)
    renderList = renderList.filter(item => item.y < state.camera.y + 200 && item.y > state.camera.y - 6000);

    // Sort: Smallest Y (Furthest) -> Largest Y (Closest)
    renderList.sort((a, b) => a.y - b.y);

    renderList.forEach(item => {
        if (item.type === 'scenery') {
            if (item.ref.type === 'tree') drawCoconutTree(ctx, item.ref, state.camera);
            else drawBuilding(ctx, item.ref, state.camera);
        } else {
            item.ref.draw(ctx, state.camera);
        }
    });

    // Speedometer
    const speedKm = Math.floor(Math.abs(player.speed) * 3); // Scale for display
    document.getElementById('speed').innerText = speedKm;

    requestAnimationFrame(gameLoop);
}

init();
