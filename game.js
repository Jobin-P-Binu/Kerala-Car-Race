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
        seed: 123
    },
    musicOn: false
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
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
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

        // Music
        this.musicGain = null;
        this.nextNoteTime = 0;
        this.beatCount = 0;
        this.tempo = 140; // Asphalt style high energy
        this.lookahead = 25.0;
        this.scheduleAheadTime = 0.1;
        this.isPlaying = false;
        this.timerID = null;
    }

    init() {
        if (this.initialized) return;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();

            // Master Compressor to glue sounds together
            this.compressor = this.ctx.createDynamicsCompressor();
            this.compressor.connect(this.ctx.destination);

            this.setupEngine();

            this.musicGain = this.ctx.createGain();
            this.musicGain.gain.value = 0.4;
            this.musicGain.connect(this.compressor);

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

    // --- Procedural Music sequencer ---
    toggleMusic() {
        if (!this.initialized) this.init();
        this.isPlaying = !this.isPlaying;

        if (this.isPlaying) {
            this.nextNoteTime = this.ctx.currentTime;
            this.scheduler();
        } else {
            window.clearTimeout(this.timerID);
        }
    }

    scheduler() {
        while (this.nextNoteTime < this.ctx.currentTime + this.scheduleAheadTime) {
            this.scheduleNote(this.beatCount, this.nextNoteTime);
            this.nextNote();
        }
        this.timerID = window.setTimeout(() => this.scheduler(), this.lookahead);
    }

    nextNote() {
        const secondsPerBeat = 60.0 / this.tempo;
        this.nextNoteTime += 0.25 * secondsPerBeat; // 16th notes
        this.beatCount++;
        if (this.beatCount === 16) this.beatCount = 0;
    }

    scheduleNote(beatNumber, time) {
        // Simple "Trance" Pattern

        // Kick: 4/4 (Beats 0, 4, 8, 12)
        if (beatNumber % 4 === 0) {
            this.playKick(time);
        }

        // Hi-Hat: Off-beats (Beats 2, 6, 10, 14) or every 16th
        if (beatNumber % 2 !== 0) {
            this.playHiHat(time);
        }

        // Bass: Rolling 16ths, excluding Kick downbeats usually, or sidechained
        if (beatNumber % 4 !== 0) {
            this.playBass(time, beatNumber);
        }
    }

    playKick(time) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.5);
        gain.gain.setValueAtTime(1, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.5);

        osc.connect(gain);
        gain.connect(this.musicGain);
        osc.start(time);
        osc.stop(time + 0.5);
    }

    playHiHat(time) {
        // Noise buffer for HiHat
        const bufferSize = this.ctx.sampleRate * 0.1; // 0.1s
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 5000;

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.3, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.05);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.musicGain);
        noise.start(time);
    }

    playBass(time, beat) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        // F - G - G# progression
        let freq = 43.65; // F1
        if (beat > 8) freq = 49.00; // G1

        osc.frequency.setValueAtTime(freq, time);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(400, time);
        filter.frequency.exponentialRampToValueAtTime(100, time + 0.1); // Pluck envelop

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.4, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.musicGain);
        osc.start(time);
        osc.stop(time + 0.2);
    }
}

const audio = new AudioController();
function toggleMusic() {
    audio.toggleMusic();
    state.musicOn = audio.isPlaying;
}
document.addEventListener('click', () => { if (!audio.initialized) audio.init(); }, { once: true });
document.addEventListener('keydown', () => { if (!audio.initialized) audio.init(); }, { once: true });


// ============================================
// WORLD GENERATION (KERALA THEME)
// ============================================
function generateWorld() {
    // 1. Water Bodies (Backwaters)
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

    // 2. Coconut Trees
    for (let i = 0; i < 5000; i++) {
        state.world.trees.push({
            x: Math.random() * CONFIG.WORLD_SIZE - CONFIG.WORLD_SIZE / 2,
            y: Math.random() * CONFIG.WORLD_SIZE - CONFIG.WORLD_SIZE / 2,
            scale: 1 + Math.random() * 0.8,
            angle: Math.random() * Math.PI * 2
        });
    }
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
            // Drifting mechanic: looser turning at high speed
            let turnFactor = CONFIG.TURNING_SPEED * dir;
            if (gas === 0 && Math.abs(this.speed) > 10) turnFactor *= 1.5; // Handbrake turn feel

            this.angle += turn * turnFactor;
        }

        this.speed *= CONFIG.FRICTION;

        if (this.speed > CONFIG.MAX_SPEED) this.speed = CONFIG.MAX_SPEED;
        if (this.speed < -CONFIG.MAX_SPEED / 2) this.speed = -CONFIG.MAX_SPEED / 2;

        this.velX = Math.cos(this.angle) * this.speed;
        this.velY = Math.sin(this.angle) * this.speed;

        this.x += this.velX;
        this.y += this.velY;

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

        // Headlights (Asphalt style glow)
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

    // Auto start music for game feel
    if (!audio.isPlaying) toggleMusic();
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

        // Menu Title Wobble?
        requestAnimationFrame(gameLoop);
        return;
    }

    const player = state.cars[0];

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

    // Draw Water
    state.world.waters.forEach(w => drawWater(ctx, w));

    // Draw Trees (Sorted by Y for depth)
    // Simple sort for now, optimize later if needed
    const visibleTrees = state.world.trees.filter(tree =>
        tree.x > viewL && tree.x < viewR && tree.y > viewT && tree.y < viewB
    );
    visibleTrees.sort((a, b) => a.y - b.y);

    visibleTrees.forEach(tree => {
        drawCoconutTree(ctx, tree.x, tree.y, tree.scale);
    });

    // Draw Player
    player.update();
    player.draw(ctx);

    ctx.restore();

    // HUD Update
    const speedKm = Math.floor(Math.abs(player.speed) * 15);
    document.getElementById('speed').innerText = speedKm;

    requestAnimationFrame(gameLoop);
}

init();
