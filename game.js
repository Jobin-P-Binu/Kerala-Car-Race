// Game Configuration
const CONFIG = {
    MAX_SPEED: 25, // Faster for "Asphalt" feel
    ACCELERATION: 0.4,
    TURNING_SPEED: 0.05,
    FRICTION: 0.96,
    OFFROAD_FRICTION: 0.9,
    WORLD_SIZE: 20000,
    CHUNK_SIZE: 1000
};

// Game State
const state = {
    screen: 'loading',
    selectedCar: 'ferrari',
    difficulty: 'medium', // easy, medium, hard
    cars: [],
    camera: { x: 0, y: 0 },
    particles: [], // For drift smoke
    leaderboard: [],
    world: {
        trees: [],
        waters: [],
        seed: 123
    },
    dayTime: 0, // 0 to 24 hours
    sunIntensity: 1
};

// Assets
const assets = {
    images: {},
    sources: {
        car_ferrari: 'assets/car_ferrari.png',
        car_lamborghini: 'assets/car_lamborghini.png',
        car_porsche: 'assets/car_porsche.png',
        bg_music: 'background.mp3'
    }
};

// Setup Canvas
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });

// Input Handling
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
// ============================================
// AUDIO SYSTEM (Engine + Music)
// Old bgMusic removed in favor of HTML5 <audio> tag
const audioTag = document.getElementById('bg-music');
audioTag.volume = 0.5; // Default 50%

window.toggleMute = function () {
    audioTag.muted = !audioTag.muted;
    const btn = document.getElementById('mute-btn');
    btn.innerHTML = audioTag.muted ? '🔇' : '🔊';
}

function initAudio() {
    // Attempt to unlock audio on first interaction
    if (audioTag.paused) {
        audioTag.play().catch(e => console.log("Audio waiting for interaction"));
    }
    if (!audio.initialized) audio.init();
}

// ============================================
class AudioController {
    constructor() {
        this.ctx = null;
        this.initialized = false;

        // Engine
        this.engineOsc = null;
        this.engineGain = null;

        // Ambience
        this.windGain = null;
    }

    init() {
        if (this.initialized) return;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();

            // Master Compressor to glue sounds together
            this.compressor = this.ctx.createDynamicsCompressor();
            this.compressor.connect(this.ctx.destination);

            this.setupEngine();
            this.setupAmbience();

            this.initialized = true;
        } catch (e) { console.warn('Audio init failed', e); }
    }

    setupEngine() {
        this.engineOsc = this.ctx.createOscillator();
        this.engineOsc.type = 'sawtooth';
        this.engineOsc.frequency.value = 60;

        this.engineGain = this.ctx.createGain();
        this.engineGain.gain.value = 0;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 400;

        this.engineOsc.connect(filter);
        filter.connect(this.engineGain);
        this.engineGain.connect(this.compressor);

        this.engineOsc.start();
    }

    setupAmbience() {
        const bufferSize = this.ctx.sampleRate * 2; // 2 sec noise
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        noise.loop = true;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 400;

        this.windGain = this.ctx.createGain();
        this.windGain.gain.value = 0;

        noise.connect(filter);
        filter.connect(this.windGain);
        this.windGain.connect(this.ctx.destination);
        noise.start();
    }

    playHorn() {
        if (!this.initialized) return;
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 400;

        const osc2 = this.ctx.createOscillator();
        osc2.type = 'sawtooth';
        osc2.frequency.value = 500;

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);

        osc.connect(gain);
        osc2.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc2.start();
        osc.stop(this.ctx.currentTime + 0.5);
        osc2.stop(this.ctx.currentTime + 0.5);
    }

    updateEngine(speed, isTurning) {
        if (!this.initialized) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const absSpeed = Math.abs(speed);
        const freq = 60 + (absSpeed * 15);
        this.engineOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.1);

        const vol = 0.05 + (absSpeed / CONFIG.MAX_SPEED) * 0.1;
        this.engineGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.1);

        // Update Wind
        if (this.windGain) {
            const windVol = (absSpeed / CONFIG.MAX_SPEED) * 0.3;
            this.windGain.gain.setTargetAtTime(windVol, this.ctx.currentTime, 0.5);
        }
    }
}

const audio = new AudioController();

document.addEventListener('click', () => { if (!audio.initialized) audio.init(); }, { once: true });
document.addEventListener('keydown', () => { if (!audio.initialized) audio.init(); }, { once: true });


// ============================================
// WORLD GENERATION (KERALA THEME)
// ============================================
const ROADS = [];
const BUILDINGS = [];

function generateWorld() {
    // 0. Road Network (Grid for now)
    // Vertical Main Road
    ROADS.push({ x: 0, y: -CONFIG.WORLD_SIZE / 2, w: 200, h: CONFIG.WORLD_SIZE });

    // Horizontal Connectors
    for (let i = 0; i < 10; i++) {
        let y = (Math.random() - 0.5) * CONFIG.WORLD_SIZE * 0.8;
        ROADS.push({ x: -CONFIG.WORLD_SIZE / 2, y: y, w: CONFIG.WORLD_SIZE, h: 180 });
    }

    // 1. Water Bodies (Backwaters)
    for (let i = 0; i < 40; i++) {
        let startX = Math.random() * CONFIG.WORLD_SIZE - CONFIG.WORLD_SIZE / 2;
        let startY = Math.random() * CONFIG.WORLD_SIZE - CONFIG.WORLD_SIZE / 2;

        // Strict overlap check with ALL roads
        let overlap = false;
        const padding = 200; // Safe distance
        for (let r of ROADS) {
            if (startX > r.x - padding && startX < r.x + r.w + padding &&
                startY > r.y - padding && startY < r.y + r.h + padding) {
                overlap = true;
                break;
            }
        }
        if (overlap) continue;

        let width = 150 + Math.random() * 300;
        let points = [];
        let len = 50 + Math.random() * 80;

        // Generate points and check them too (simple verify)
        let valid = true;
        for (let j = 0; j < len; j++) {
            let px = startX + Math.sin(j * 0.1) * 800 + (Math.random() - 0.5) * 300;
            let py = startY + j * 300;

            // Re-check point against roads
            for (let r of ROADS) {
                if (px > r.x - padding && px < r.x + r.w + padding &&
                    py > r.y - padding && py < r.y + r.h + padding) {
                    valid = false;
                    break;
                }
            }
            if (!valid) break;

            points.push({ x: px, y: py });
        }

        if (valid) {
            state.world.waters.push({ points, width });
        }
    }

    // 2. Coconut Trees & Buildings
    for (let i = 0; i < 5000; i++) {
        let x = Math.random() * CONFIG.WORLD_SIZE - CONFIG.WORLD_SIZE / 2;
        let y = Math.random() * CONFIG.WORLD_SIZE - CONFIG.WORLD_SIZE / 2;

        // Simple overlap check with roads
        let onRoad = ROADS.some(r =>
            x > r.x - r.w / 2 && x < r.x + r.w / 2 + r.w && // Box approx
            y > r.y && y < r.y + r.h
        ); // Very rough, refining later

        if (!onRoad) {
            state.world.trees.push({
                x: x,
                y: y,
                scale: 1 + Math.random() * 0.8,
                angle: Math.random() * Math.PI * 2
            });
        }
    }

    // Add Special Buildings - REMOVED as per request
    // Tea shops and Bus stops removed.
}

function drawCoconutTree(ctx, x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(20, 20, 40, 15, 0, 0, Math.PI * 2);
    ctx.fill();

    // Trunk (Curved)
    ctx.strokeStyle = '#4e342e';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(20, -50, -10, -100, 10, -150);
    ctx.stroke();

    ctx.restore(); // Fix context leak
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    // Leaves (Palm)
    ctx.translate(10, -150);
    ctx.strokeStyle = '#2e7d32'; // Kerala Green
    ctx.lineWidth = 4;

    for (let i = 0; i < 12; i++) {
        ctx.save();
        ctx.rotate(i * (Math.PI * 2 / 12));
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(40 + Math.random() * 10, -20, 80, 40);
        ctx.stroke();
        ctx.restore();
    }

    // Coconuts
    ctx.fillStyle = '#ef6c00';
    ctx.beginPath();
    ctx.arc(-8, 5, 5, 0, Math.PI * 2);
    ctx.arc(8, 5, 6, 0, Math.PI * 2);
    ctx.arc(0, 12, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function drawWater(ctx, water) {
    ctx.lineWidth = water.width;
    ctx.strokeStyle = '#0277bd'; // Deep Backwater Blue
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    if (water.points.length > 0) {
        ctx.moveTo(water.points[0].x, water.points[0].y);
        for (let i = 1; i < water.points.length; i++) {
            ctx.lineTo(water.points[i].x, water.points[i].y);
        }
    }
    ctx.stroke();

    // Banks (Mud/Sand)
    ctx.globalCompositeOperation = 'destination-over';
    ctx.lineWidth = water.width + 60;
    ctx.strokeStyle = '#cddc39'; // Lime/Mud mix
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
}

function drawBuilding(ctx, b) {
    ctx.save();
    ctx.translate(b.x, b.y);
    if (b.type === 'tea_shop') {
        // Simple Huts
        ctx.fillStyle = '#795548';
        ctx.fillRect(-40, -40, 80, 80);
        ctx.fillStyle = '#ff5722'; // Tile roof
        ctx.beginPath();
        ctx.moveTo(-50, -40);
        ctx.lineTo(0, -90);
        ctx.lineTo(50, -40);
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.font = '12px Arial';
        ctx.fillText("TEA", -10, 0);
    } else {
        // KSRTC Bus Stop
        ctx.fillStyle = '#FFF176'; // Light Yellow
        ctx.fillRect(-60, -40, 120, 80);
        ctx.fillStyle = '#4CAF50'; // Green stripe
        ctx.fillRect(-60, 0, 120, 20);
        ctx.fillStyle = 'black';
        ctx.font = 'bold 14px Arial';
        ctx.fillText("KSRTC", -20, 15);
    }
    ctx.restore();
}

function drawRoads(ctx, viewL, viewR, viewT, viewB) {
    ctx.fillStyle = '#37474f'; // Asphalt Gray
    ROADS.forEach(r => {
        // Simple culling
        if (r.x + r.w > viewL && r.x < viewR && r.y + r.h > viewT && r.y < viewB) {
            ctx.fillRect(r.x, r.y, r.w, r.h);
            // White lines
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.setLineDash([40, 40]);
            ctx.lineWidth = 4;
            ctx.beginPath();
            if (r.w < r.h) { // Vertical
                ctx.moveTo(r.x + r.w / 2, r.y);
                ctx.lineTo(r.x + r.w / 2, r.y + r.h);
            } else { // Horizontal
                ctx.moveTo(r.x, r.y + r.h / 2);
                ctx.lineTo(r.x + r.w, r.y + r.h / 2);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }
    });
}

// ============================================
// CAR CLASS
// ============================================
class Car {
    constructor(type, x, y, isAI = false) {
        this.type = type;
        this.x = x;
        this.y = y;
        this.isAI = isAI;
        this.angle = 0;
        this.speed = 0;
        this.img = assets.images[`car_${type}`] || assets.images['car_ferrari']; // Fallback
        this.width = 70;
        this.height = 120;
        this.velX = 0;
        this.velY = 0;
        this.drift = 0;
        this.nitro = 100;
        this.plate = this.generatePlate();
        this.name = isAI ? this.getRandomName() : "YOU";

        // AI State
        this.targetNode = null;
        this.aiOffset = 0; // Fixed alignment
    }

    update() {
        if (state.screen !== 'drive') return;

        let gas = 0;
        let turn = 0;

        if (!this.isAI) {
            // Player Inputs
            if (keys.w || keys.ArrowUp) gas = 1;
            if (keys.s || keys.ArrowDown) gas = -1;
            if (keys.a || keys.ArrowLeft) turn = -1;
            if (keys.d || keys.ArrowRight) turn = 1;

            // Nitro Input
            if (keys.Shift && this.nitro > 0 && gas > 0) {
                gas *= 2.0; // Boost acceleration
                this.nitro -= 0.5;
            } else if (this.nitro < 100) {
                this.nitro += 0.1; // Regen
            }
        } else {
            // AI Inputs
            const result = this.aiControl();
            gas = result.gas;
            turn = result.turn;
        }

        // Physics
        this.speed += gas * CONFIG.ACCELERATION;

        if (Math.abs(this.speed) > 0.5) {
            const dir = this.speed > 0 ? 1 : -1;
            // Drifting mechanic: looser turning at high speed
            let turnFactor = CONFIG.TURNING_SPEED * dir;
            if (gas === 0 && Math.abs(this.speed) > 10) turnFactor *= 1.5; // Handbrake turn feel

            this.angle += turn * turnFactor;

            // Drift Smoke
            if (Math.abs(turn) > 0.8 && Math.abs(this.speed) > 15) {
                state.particles.push({
                    x: this.x - Math.cos(this.angle) * 40 + (Math.random() - 0.5) * 10,
                    y: this.y - Math.sin(this.angle) * 40 + (Math.random() - 0.5) * 10,
                    life: 1,
                    size: 5 + Math.random() * 5
                });
            }
        }

        // AI Logic
        if (this.type !== state.selectedCar && this.y === this.y) { // Check if AI (simple check: if not player index 0, but here type check is weak. Better: pass isAI flag)
            // ... handled in constructor/update
        }

        this.speed *= CONFIG.FRICTION;

        if (this.speed > CONFIG.MAX_SPEED) this.speed = CONFIG.MAX_SPEED;
        if (this.speed < -CONFIG.MAX_SPEED / 2) this.speed = -CONFIG.MAX_SPEED / 2;

        this.velX = Math.cos(this.angle) * this.speed;
        this.velY = Math.sin(this.angle) * this.speed;

        this.x += this.velX;
        this.y += this.velY;

        // Collision Check
        this.checkCollisions();

        audio.updateEngine(this.speed, turn !== 0);
    }

    checkCollisions() {
        // 1. World Boundaries
        if (this.x < -CONFIG.WORLD_SIZE / 2 || this.x > CONFIG.WORLD_SIZE / 2 ||
            this.y < -CONFIG.WORLD_SIZE / 2 || this.y > CONFIG.WORLD_SIZE / 2) {
            this.speed *= -0.5; // Bounce back
            this.x -= this.velX * 2;
            this.y -= this.velY * 2;
        }

        // 2. Buildings
        for (let b of BUILDINGS) {
            const dx = this.x - b.x;
            const dy = this.y - b.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 80) { // Simple radius collision
                this.speed *= -0.3;
                this.x -= this.velX * 1.5;
                this.y -= this.velY * 1.5;
            }
        }
    }

    aiControl() {
        // 1. Find Road
        let targetAngle = -Math.PI / 2; // Default Up/North

        // Find nearest road
        let nearestRoad = null;
        let minDist = Infinity;

        for (let r of ROADS) {
            let cx = r.x + r.w / 2;
            let cy = r.y + r.h / 2;
            let d = Math.abs(this.x - cx) + Math.abs(this.y - cy);
            if (d < minDist) {
                minDist = d;
                nearestRoad = r;
            }
        }

        if (nearestRoad) {
            let speedLimit = CONFIG.MAX_SPEED;
            if (state.difficulty === 'easy') speedLimit *= 0.6;
            if (state.difficulty === 'medium') speedLimit *= 0.8;

            // Target Speed Control
            let targetGas = 0.8;
            if (Math.abs(this.speed) > speedLimit) targetGas = 0;

            // Determine direction: Vertical or Horizontal
            if (nearestRoad.w < nearestRoad.h) {
                // Vertical Road
                let tx = nearestRoad.x + nearestRoad.w / 2 + this.aiOffset;
                let dx = tx - this.x;
                let angleToTarget = -Math.PI / 2 + (dx * 0.005);
                targetAngle = angleToTarget;
            } else {
                // Horizontal Road (Not dominant yet)
            }

            let diff = targetAngle - this.angle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;

            let turn = 0;
            if (diff > 0.05) turn = 1;
            if (diff < -0.05) turn = -1;

            // Avoidance
            for (let other of state.cars) {
                if (other === this) continue;
                let dx = other.x - this.x;
                let dy = other.y - this.y;
                let dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 200) {
                    let angleToOther = Math.atan2(dy, dx);
                    let angleDiff = angleToOther - this.angle;
                    if (Math.abs(angleDiff) < 0.5) return { gas: -0.5, turn: turn * -1 };
                }
            }

            return { gas: targetGas, turn: turn };
        }

        return { gas: 0.8, turn: 0 };
    }

    generatePlate() {
        const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const l1 = letters[Math.floor(Math.random() * letters.length)];
        const l2 = letters[Math.floor(Math.random() * letters.length)];
        const n1 = Math.floor(Math.random() * 100);
        const n2 = Math.floor(Math.random() * 10000);
        return `KL-${n1}-${l1}${l2}-${n2}`;
    }

    getRandomName() {
        const names = ["Raju", "Biju", "Shibu", "Jose", "Unni", "Kuttan", "Appu"];
        return names[Math.floor(Math.random() * names.length)];
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);

        // Fix: Rotate Ferrari and Lamborghini 180 degrees
        let drawAngle = this.angle + Math.PI / 2;
        if (this.type === 'ferrari' || this.type === 'lamborghini') {
            drawAngle += Math.PI;
        }
        ctx.rotate(drawAngle);

        // Shadow
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 20;
        ctx.shadowOffsetX = 5;
        ctx.shadowOffsetY = 5;

        // Draw Car
        ctx.drawImage(this.img, -this.width / 2, -this.height / 2, this.width, this.height);

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

        const startMusic = () => {
            initAudio(); // Unlock audio
            document.removeEventListener('click', startMusic);
            document.removeEventListener('keydown', startMusic);
        };
        document.addEventListener('click', startMusic);
        document.addEventListener('keydown', startMusic);
    });
}

function loadAssets() {
    let promises = [];
    for (let key in assets.sources) {
        // Fix: Skip non-image assets to prevent loading hang
        if (key === 'bg_music') continue;

        let p = new Promise((resolve) => {
            const img = new Image();
            img.src = assets.sources[key];
            img.onload = () => {
                assets.images[key] = img;
                resolve();
            };
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

    if (audioTag.paused && audioTag.currentTime > 0) {
        audioTag.play().catch(e => console.log("Resume failed:", e));
    }

    requestAnimationFrame(gameLoop);
}

window.selectCar = function (type, el) {
    state.selectedCar = type;
    document.querySelectorAll('.car-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
}

window.startGame = function () {
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('hud').classList.add('visible');

    // Add AI Bots with strict lane alignment
    // Road w: 200. Lanes at 50 (Left) and 150 (Right). Road starts at x=0.
    // Wait, generated road is: x: 0, w: 200. Center x=100.
    // Lanes: center left = 50, center right = 150.

    // Player spawn (Left Lane)
    state.cars = [new Car(state.selectedCar, 50, 0)];

    const aiConfigs = [
        { type: 'ferrari', x: 150, y: 300 }, // Right lane, behind/ahead
        { type: 'lamborghini', x: 50, y: -400 }, // Left lane, ahead
        { type: 'porsche', x: 150, y: -800 } // Right lane, ahead
    ];

    for (let i = 0; i < 3; i++) {
        let conf = aiConfigs[i];
        state.cars.push(new Car(conf.type, conf.x, conf.y, true));
    }
    state.screen = 'drive';

    // music is continuous, restart on new game if needed
    audioTag.currentTime = 0;
    audioTag.play().catch(e => console.warn("Music play blocked", e));
}

function gameLoop() {
    // Clear & Background (Kerala Green)
    ctx.fillStyle = '#66bb6a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (state.screen === 'menu') {
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        // Menu visualizer
        drawCoconutTree(ctx, -200, 50, 1.8);
        drawCoconutTree(ctx, 200, 80, 1.4);
        ctx.restore();
        requestAnimationFrame(gameLoop);
        return;
    }

    // Logic Hazard Fix: Do not sort state.cars in place!
    const player = state.cars.find(c => !c.isAI) || state.cars[0];

    // Camera follow
    state.camera.x = player.x - canvas.width / 2;
    state.camera.y = player.y - canvas.height / 2;

    ctx.save();
    ctx.translate(-state.camera.x, -state.camera.y);

    // Cull and Draw World
    const viewL = state.camera.x - 500;
    const viewR = state.camera.x + canvas.width + 500;
    const viewT = state.camera.y - 500;
    const viewB = state.camera.y + canvas.height + 500;

    // Draw Roads (Bottom Layer)
    drawRoads(ctx, viewL, viewR, viewT, viewB);

    // Draw Water
    state.world.waters.forEach(w => drawWater(ctx, w));

    // Draw Trees
    const visibleTrees = state.world.trees.filter(tree =>
        tree.x > viewL && tree.x < viewR && tree.y > viewT && tree.y < viewB
    );
    visibleTrees.sort((a, b) => a.y - b.y);

    visibleTrees.forEach(tree => {
        drawCoconutTree(ctx, tree.x, tree.y, tree.scale);
    });

    // Draw Buildings
    BUILDINGS.forEach(b => drawBuilding(ctx, b));

    // Draw Cars (Sort copy by Y for depth)
    const renderList = [...state.cars].sort((a, b) => a.y - b.y);
    renderList.forEach(car => {
        car.update();
        car.draw(ctx);
    });

    // Night Overlay REMOVED
    // Time UI REMOVED

    // HUD Update
    const speedKm = Math.floor(Math.abs(player.speed) * 15);
    document.getElementById('speed').innerText = speedKm;

    requestAnimationFrame(gameLoop);
}

init();
