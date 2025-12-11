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
    cars: [],
    camera: { x: 0, y: 0 },
    world: {
        trees: [],
        waters: [],
        roads: [],
        seed: 123
    },
    musicOn: false,
    cachedTree: null // For performance
};

// Assets
const assets = {
    images: {},
    sources: {
        car_ferrari: 'assets/car_ferrari.png',
        car_lamborghini: 'assets/car_lamborghini.png',
        car_porsche: 'assets/car_porsche.png'
    }
};

// Setup Canvas
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });

// Input Handling
const keys = {
    w: false, a: false, s: false, d: false,
    ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false,
    m: false
};

window.addEventListener('keydown', e => {
    keys[e.key] = true;
    if (e.key === 'm' || e.key === 'M') toggleMusic();
});
window.addEventListener('keyup', e => keys[e.key] = false);
window.addEventListener('resize', resize);

function resize() {
    const dpr = window.devicePixelRatio || 1;
    // Set effective size
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    // Normalize coordinate system
    ctx.scale(dpr, dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
}
resize();

// ============================================
// AUDIO SYSTEM (Engine + Music)
// ============================================
class AudioController {
    constructor() {
        this.ctx = null;
        this.initialized = false;

        // Engine
        this.engineOsc = null;
        this.engineGain = null;
        this.compressor = null;

        // Music
        // Using encodeURICompnent isn't necessary for the Audio constructor if the string is literal, 
        // but spaces in path are fine in JS strings. 
        // Relative path: music/Asphalt 9_ Legends Soundtrack The Score - Legend.mp3
        this.bgMusic = new Audio('music/Asphalt 9_ Legends Soundtrack The Score - Legend.mp3');
        this.bgMusic.loop = true;
        this.bgMusic.volume = 0.5;
    }

    init() {
        if (this.initialized) return;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();

            // Master Compressor to glue sounds together
            this.compressor = this.ctx.createDynamicsCompressor();
            this.compressor.connect(this.ctx.destination);

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

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 400;

        this.engineOsc.connect(filter);
        filter.connect(this.engineGain);
        this.engineGain.connect(this.compressor);

        this.engineOsc.start();
    }

    updateEngine(speed, isTurning) {
        if (!this.initialized) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const absSpeed = Math.abs(speed);
        const freq = 60 + (absSpeed * 15);
        this.engineOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.1);

        const vol = 0.05 + (absSpeed / CONFIG.MAX_SPEED) * 0.1;
        this.engineGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.1);
    }

    toggleMusic() {
        if (!this.initialized) this.init();

        if (this.bgMusic.paused) {
            this.bgMusic.play().catch(e => console.error("Music playback failed", e));
        } else {
            this.bgMusic.pause();
        }
    }

    get isPlaying() {
        return !this.bgMusic.paused;
    }
}

const audio = new AudioController();
function toggleMusic() {
    audio.toggleMusic();
    state.musicOn = audio.isPlaying;
    const statusEl = document.getElementById('music-status');
    if (statusEl) statusEl.innerText = state.musicOn ? 'ON' : 'OFF';
}
document.addEventListener('click', () => { if (!audio.initialized) audio.init(); }, { once: true });
document.addEventListener('keydown', () => { if (!audio.initialized) audio.init(); }, { once: true });


// ============================================
// WORLD GENERATION (KERALA THEME)
// ============================================
function generateWorld() {
    // 0. Cache Tree Sprite
    cacheTreeSprite();

    // 1. Roads (Grid)
    const gridSize = 2000;
    const roadWidth = 200;

    // Horizontal Roads
    for (let y = -CONFIG.WORLD_SIZE / 2; y < CONFIG.WORLD_SIZE / 2; y += gridSize) {
        state.world.roads.push({
            x1: -CONFIG.WORLD_SIZE / 2, y1: y,
            x2: CONFIG.WORLD_SIZE / 2, y2: y,
            width: roadWidth
        });
    }
    // Vertical Roads
    for (let x = -CONFIG.WORLD_SIZE / 2; x < CONFIG.WORLD_SIZE / 2; x += gridSize) {
        state.world.roads.push({
            x1: x, y1: -CONFIG.WORLD_SIZE / 2,
            x2: x, y2: CONFIG.WORLD_SIZE / 2,
            width: roadWidth
        });
    }

    // 2. Water Bodies (Backwaters) - Avoiding Roads loosely
    for (let i = 0; i < 40; i++) {
        let startX = Math.random() * CONFIG.WORLD_SIZE - CONFIG.WORLD_SIZE / 2;
        let startY = Math.random() * CONFIG.WORLD_SIZE - CONFIG.WORLD_SIZE / 2;
        let width = 150 + Math.random() * 300;
        let points = [];
        let len = 50 + Math.random() * 80;
        for (let j = 0; j < len; j++) {
            points.push({
                x: startX + Math.sin(j * 0.1) * 800 + (Math.random() - 0.5) * 300,
                y: startY + j * 300
            });
        }
        state.world.waters.push({ points, width });
    }

    // 3. Coconut Trees
    for (let i = 0; i < 5000; i++) {
        const x = Math.random() * CONFIG.WORLD_SIZE - CONFIG.WORLD_SIZE / 2;
        const y = Math.random() * CONFIG.WORLD_SIZE - CONFIG.WORLD_SIZE / 2;

        // Dont spawn trees on road
        let onRoad = false;
        // Check grid roads (Approx distance check)
        const distToVertRoad = Math.abs(x - Math.round(x / gridSize) * gridSize);
        const distToHorzRoad = Math.abs(y - Math.round(y / gridSize) * gridSize);

        if (distToVertRoad < roadWidth / 2 + 50 || distToHorzRoad < roadWidth / 2 + 50) {
            onRoad = true;
        }

        if (!onRoad) {
            state.world.trees.push({
                x: x,
                y: y,
                scale: 1 + Math.random() * 0.8,
                angle: Math.random() * Math.PI * 2
            });
        }
    }
}

function cacheTreeSprite() {
    const hiddenCanvas = document.createElement('canvas');
    hiddenCanvas.width = 200;
    hiddenCanvas.height = 300;
    const hCtx = hiddenCanvas.getContext('2d');

    // Center it
    hCtx.translate(100, 250); // Anchor at bottom centerish

    // Shadow
    hCtx.fillStyle = 'rgba(0,0,0,0.15)';
    hCtx.beginPath();
    hCtx.ellipse(20, 20, 40, 15, 0, 0, Math.PI * 2);
    hCtx.fill();

    // Trunk (Curved)
    hCtx.strokeStyle = '#4e342e';
    hCtx.lineWidth = 10;
    hCtx.lineCap = 'round';
    hCtx.beginPath();
    hCtx.moveTo(0, 0);
    hCtx.bezierCurveTo(20, -50, -10, -100, 10, -150);
    hCtx.stroke();

    // Leaves (Palm)
    hCtx.translate(10, -150);
    hCtx.strokeStyle = '#2e7d32'; // Kerala Green
    hCtx.lineWidth = 4;

    for (let i = 0; i < 12; i++) {
        hCtx.save();
        hCtx.rotate(i * (Math.PI * 2 / 12));
        hCtx.beginPath();
        hCtx.moveTo(0, 0);
        hCtx.quadraticCurveTo(40 + Math.random() * 10, -20, 80, 40);
        hCtx.stroke();
        hCtx.restore();
    }

    // Coconuts
    hCtx.fillStyle = '#ef6c00';
    hCtx.beginPath();
    hCtx.arc(-8, 5, 5, 0, Math.PI * 2);
    hCtx.arc(8, 5, 6, 0, Math.PI * 2);
    hCtx.arc(0, 12, 5, 0, Math.PI * 2);
    hCtx.fill();

    state.cachedTree = hiddenCanvas;
}

function drawCoconutTree(ctx, x, y, scale) {
    if (!state.cachedTree) return;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.drawImage(state.cachedTree, -100, -250);
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

function drawRoad(ctx, road) {
    // Road Asphalt
    ctx.beginPath();
    ctx.moveTo(road.x1, road.y1);
    ctx.lineTo(road.x2, road.y2);
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = road.width;
    ctx.stroke();

    // Road Markings (Dashed White)
    ctx.beginPath();
    ctx.moveTo(road.x1, road.y1);
    ctx.lineTo(road.x2, road.y2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.setLineDash([30, 30]);
    ctx.stroke();
    ctx.setLineDash([]);
}

// ============================================
// CAR CLASS
// ============================================
class Car {
    constructor(type, x, y) {
        this.type = type;
        this.x = x;
        this.y = y;
        this.angle = 0;
        this.speed = 0;
        this.img = assets.images[`car_${type}`];
        this.width = 70;
        this.height = 120;
        this.velX = 0;
        this.velY = 0;
        this.drift = 0;
    }

    update() {
        if (state.screen !== 'drive') return;

        let gas = 0;
        let turn = 0;

        if (keys.w || keys.ArrowUp) gas = 1;
        if (keys.s || keys.ArrowDown) gas = -1;
        if (keys.a || keys.ArrowLeft) turn = -1;
        if (keys.d || keys.ArrowRight) turn = 1;

        // Physics
        this.speed += gas * CONFIG.ACCELERATION;

        if (Math.abs(this.speed) > 0.5) {
            const dir = this.speed > 0 ? 1 : -1;
            // Drifting mechanic
            let turnFactor = CONFIG.TURNING_SPEED * dir;
            if (gas === 0 && Math.abs(this.speed) > 10) turnFactor *= 1.5;

            this.angle += turn * turnFactor;
        }

        this.speed *= CONFIG.FRICTION;

        if (this.speed > CONFIG.MAX_SPEED) this.speed = CONFIG.MAX_SPEED;
        if (this.speed < -CONFIG.MAX_SPEED / 2) this.speed = -CONFIG.MAX_SPEED / 2;

        this.velX = Math.cos(this.angle) * this.speed;
        this.velY = Math.sin(this.angle) * this.speed;

        this.x += this.velX;
        this.y += this.velY;

        // Road Friction Detection
        const gridSize = 2000;
        const roadWidth = 200;
        let onRoad = false;

        const distX = Math.abs(this.x - Math.round(this.x / gridSize) * gridSize);
        const distY = Math.abs(this.y - Math.round(this.y / gridSize) * gridSize);

        if (distX < roadWidth / 2 || distY < roadWidth / 2) {
            onRoad = true;
        }

        if (!onRoad) {
            this.speed *= CONFIG.OFFROAD_FRICTION;
        }

        audio.updateEngine(this.speed, turn !== 0);
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle + Math.PI / 2);

        // Shadow
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 20;
        ctx.shadowOffsetX = 5;
        ctx.shadowOffsetY = 5;

        // Draw Car
        ctx.drawImage(this.img, -this.width / 2, -this.height / 2, this.width, this.height);

        // Headlights
        if (state.screen === 'drive') {
            ctx.globalCompositeOperation = 'screen';
            ctx.fillStyle = 'rgba(255, 255, 200, 0.6)';
            ctx.beginPath();
            ctx.moveTo(-20, -50);
            ctx.lineTo(-60, -250);
            ctx.lineTo(60, -250);
            ctx.lineTo(20, -50);
            ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
        }

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

    state.cars = [new Car(state.selectedCar, 0, 0)];
    state.screen = 'drive';

    if (!audio.isPlaying) toggleMusic();
}

function gameLoop() {
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Clear & Background
    ctx.fillStyle = '#66bb6a';
    ctx.fillRect(0, 0, width, height);

    if (state.screen === 'menu') {
        ctx.save();
        ctx.translate(width / 2, height / 2);
        drawCoconutTree(ctx, -200, 50, 1.8);
        drawCoconutTree(ctx, 200, 80, 1.4);
        ctx.restore();

        requestAnimationFrame(gameLoop);
        return;
    }

    const player = state.cars[0];

    // Camera follow
    state.camera.x = player.x - width / 2;
    state.camera.y = player.y - height / 2;

    ctx.save();
    ctx.translate(-state.camera.x, -state.camera.y);

    // Cull and Draw World
    const viewL = state.camera.x - 500;
    const viewR = state.camera.x + width + 500;
    const viewT = state.camera.y - 500;
    const viewB = state.camera.y + height + 500;

    state.world.roads.forEach(road => drawRoad(ctx, road));
    state.world.waters.forEach(w => drawWater(ctx, w));

    // Draw Trees
    const visibleTrees = state.world.trees.filter(tree =>
        tree.x > viewL && tree.x < viewR && tree.y > viewT && tree.y < viewB
    );
    visibleTrees.sort((a, b) => a.y - b.y);

    visibleTrees.forEach(tree => {
        drawCoconutTree(ctx, tree.x, tree.y, tree.scale);
    });

    player.update();
    player.draw(ctx);

    ctx.restore();

    // HUD Update
    const speedKm = Math.floor(Math.abs(player.speed) * 15);
    const speedEl = document.getElementById('speed');
    if (speedEl) speedEl.innerText = speedKm;

    requestAnimationFrame(gameLoop);
}

init();
