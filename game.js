/**
 * BOX JUMP PRECISION - v4 Final
 * Juego de habilidad por niveles, precisión y desafíos temporales.
 */

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreValue = document.getElementById('score-value');
const levelValue = document.getElementById('level-value');
const finalScore = document.getElementById('final-score');
const finalLevel = document.getElementById('final-level');
const startBtn = document.getElementById('start-btn');
const newGameBtn = document.getElementById('new-game-btn');
const restartBtn = document.getElementById('restart-btn');
const gameOverNewBtn = document.getElementById('game-over-new-btn');
const rankingFab = document.getElementById('ranking-fab');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const msgOverlay = document.getElementById('msg-overlay');
const msgText = document.getElementById('msg-text');
const comboContainer = document.getElementById('combo-container');
const comboValueEl = document.getElementById('combo-value');
const bestValueEl = document.getElementById('best-value');

// CONFIGURACIÓN GLOBAL
let width, height;
let gameActive = false;
let level = 1;
let platformsInLevel = 5;
let platformsReached = 0;
let totalPlatformGlobalCount = 0;
let platforms = [];
let props = [];
let particles = [];

// ALTURA: se mide en centímetros (1 px = 1 cm; la caja mide 30 cm).
// cameraScroll acumula lo que baja el mundo al subir la cámara, así la altura es "de mundo".
let cameraScroll = 0;
let levelBaseH = 0;   // altura (mundo) de la plataforma desde la que empieza el nivel
let levelMaxH = 0;    // máxima altura alcanzada en el nivel actual (px = cm)
const heightCm = () => Math.max(0, Math.round(levelMaxH));
function resetLevelHeight() {
    levelBaseH = cameraScroll - platforms[0].y;
    levelMaxH = 0;
    updateHeightDisplay();
}
function trackHeight() {
    const h = cameraScroll - (player.y + player.h) - levelBaseH;
    if (h > levelMaxH) { levelMaxH = h; updateHeightDisplay(); }
}

// Mejor marca histórica en este navegador: nivel y, a igualdad, altura
let bestRun = { level: 1, height: 0 };
try {
    const br = JSON.parse(localStorage.getItem('boxjump_best_run') || 'null');
    if (br && br.level >= 1) bestRun = { level: br.level | 0, height: br.height | 0 };
} catch (e) { /* almacenamiento no disponible */ }
const betterRun = (l, h, b) => l > b.level || (l === b.level && h > b.height);
const bestRunText = () => `Nv ${bestRun.level} · ${bestRun.height} cm`;
if (bestValueEl) bestValueEl.innerText = bestRunText();

// Partida guardada (checkpoint cada 5 niveles), recibida al iniciar sesión
let savedGameData = null;

// ===================== MODOS DE JUEGO =====================
// 'normal' (infinito) | 'daily' (fase diaria, semilla fija) | 'custom' (fase creada en el editor)
let gameMode = 'normal';
let modeCfg = null;      // { type, first, last, total, seed?, levels?, onEnd?, onExit? }
let runEnded = true;
let genRng = Math.random; // generador de azar de la generación de niveles

const goTitle = document.getElementById('go-title');
const goNote = document.getElementById('go-note');
const goPrimaryBtn = document.getElementById('go-primary-btn');
const goMenuBtn = document.getElementById('go-menu-btn');

function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return function () { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
}
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
// Cada nivel de la fase diaria tiene su propia semilla: mismo nivel = mismas plataformas para todos
function seedLevelRng() {
    genRng = (modeCfg && modeCfg.seed) ? mulberry32(xmur3(modeCfg.seed + ':' + level)()) : Math.random;
}
function hudLevel() {
    if (modeCfg && modeCfg.total > 1) return (level - modeCfg.first + 1) + '/' + modeCfg.total;
    return String(level);
}
function setLevelHUD() { levelValue.innerText = hudLevel(); }

// Posición X de una plataforma/objeto a partir de una fracción 0..1 (misma fórmula que la generación aleatoria)
function mapX(fx, w, W, side) {
    const base = side === 'left' ? 50 : 30;
    return base + Math.max(0, Math.min(1, fx)) * (W - w - 80);
}
function customLevelData() {
    return (modeCfg && modeCfg.levels && modeCfg.levels[level - 1]) || { items: [], wind: 0, lowG: false };
}
function levelPlatformCount() {
    if (gameMode === 'custom') return Math.max(1, customLevelData().items.filter(i => i.k === 'plat').length);
    return 5 + Math.floor(level / 2);
}
function rollEnvironment(allowGravity) {
    seedLevelRng();
    if (gameMode === 'custom') {
        const d = customLevelData();
        windForce = (d.wind || 0) * 0.028;
        gravityFactor = d.lowG ? 0.4 : 1.0;
        darkLevel = false;
        return;
    }
    windForce = rollWind(genRng);
    gravityFactor = (allowGravity && level >= 30 && genRng() < 0.3) ? 0.4 : 1.0; // Baja gravedad ocasional en modo Caos
    darkLevel = level >= 2 && genRng() < DARK_CHANCE; // niebla: 10 % de probabilidad por nivel
}
function buildCustomLevel() {
    const d = customLevelData();
    const base = platforms[0], baseY = base.y;
    const plats = d.items.filter(i => i.k === 'plat').sort((a, b) => a.y - b.y);
    plats.forEach((it, i) => {
        const goal = i === plats.length - 1, w = it.w || 90;
        platforms.push(new Platform(mapX(it.fx, w, width, precisionSystem.side), baseY - it.y, w, 20, goal, goal ? 'normal' : (it.t || 'normal')));
        platforms[platforms.length - 1].idx = platforms.length - 1;
        totalPlatformGlobalCount++;
    });
    d.items.forEach(it => {
        const cx = mapX(it.fx, 0, width, precisionSystem.side), y = baseY - it.y;
        if (it.k === 'drone') obstacles.push(new Obstacle({ patrol: true, x: cx - 20, y: y - 10, dir: it.fx < 0.5 ? 1 : -1 }));
        else if (it.k === 'shield' || it.k === 'dj') powerups.push(new PowerUp(cx - 14, y - 14, it.k === 'shield' ? 'shield' : 'rocket')); // 'dj' antiguo = cohete
        else if (it.k === 'hole') blackHoles.push(new BlackHole(cx, y, it.w || 35));
        else if (it.k === 'box') { const sz = it.w || 24; props.push(new Prop(cx - sz / 2, y - sz / 2, sz, sz, 'hsl(215, 80%, 60%)')); }
        else if (it.k === 'chest') { // se pega a la plataforma más cercana en altura
            const target = platforms.slice(1).reduce((b, q) => (!b || Math.abs(q.y - y) < Math.abs(b.y - y) ? q : b), null);
            if (target) {
                const cw = 26, t = target.w > cw ? Math.max(0, Math.min(1, (cx - cw / 2 - target.x) / (target.w - cw))) : 0;
                chests.push(new Chest(target, t));
            }
        }
    });
}
function populateLevel() {
    if (gameMode === 'custom') buildCustomLevel();
    else for (let i = 1; i < platformsInLevel; i++) spawnNextPlatform(i === platformsInLevel - 1);
    placeTombstone();
}

// Menú de inicio: por defecto "Nueva partida". Si ya hay un checkpoint (nivel 5, 10, 15...) se muestra
// "Continuar" y desaparece "Nueva partida" (solo se puede empezar de cero desde Configuración, con confirmación).
function updateStartScreenUI() {
    const hasCheckpoint = !!(savedGameData && savedGameData.level > 1);
    if (startBtn) {
        startBtn.innerText = hasCheckpoint ? `▶ CONTINUAR (Nivel ${savedGameData.level})` : '▶ CONTINUAR';
        startBtn.classList.toggle('hidden', !hasCheckpoint);
        startBtn.disabled = !hasCheckpoint;
    }
    if (newGameBtn) newGameBtn.classList.toggle('hidden', hasCheckpoint);
    if (restartBtn) restartBtn.innerText = hasCheckpoint ? `CONTINUAR (Nivel ${savedGameData.level})` : 'REINTENTAR';
    if (gameOverNewBtn) gameOverNewBtn.classList.add('hidden'); // empezar de cero solo desde Configuración
    const ngs = document.getElementById('settings-newgame-section');
    if (ngs && !hasCheckpoint) ngs.classList.add('hidden');
}

function updateHeightDisplay() {
    const h = heightCm();
    scoreValue.innerText = h + ' cm';
    if (gameMode === 'normal' && !runEnded && betterRun(level, h, bestRun)) {
        bestRun = { level, height: h };
        try { localStorage.setItem('boxjump_best_run', JSON.stringify(bestRun)); } catch (e) { /* no disponible */ }
    }
    bestValueEl.innerText = bestRunText();
}

function updateComboDisplay() {
    if (combo > 1) {
        comboContainer.classList.remove('hidden');
        comboValueEl.innerText = `COMBO x${combo}`;
        const scale = Math.min(1.8, 1 + combo * 0.06);
        comboContainer.style.transform = `translateX(-50%) scale(${scale})`;
        comboContainer.classList.toggle('combo-hot', combo >= 5 && combo < 10);
        comboContainer.classList.toggle('combo-fire', combo >= 10);
    } else {
        comboContainer.classList.add('hidden');
        comboContainer.classList.remove('combo-hot', 'combo-fire');
    }
}

const THEME = {
    player: '#00f2ff',
    platform: '#1e2d4d',
    platformBright: '#5470d6',
    platformVanishing: '#c45cff',
    platformSpring: '#2ef2c4',
    platformOscillating: '#ff5c9d',
    platformFlash: '#e8eeff',
    platformMini: '#ffc94a',
    platformFragile: '#cfd6e6',
    platformMoving: '#ffb547',
    platformIce: '#8fe3ff',
    platformSticky: '#5fbf6a',
    platformGoal: '#ffcf4a',
    ball: '#ff4fd8',
    shield: '#00ff64',
    shieldPlat: '#00c853',
    rocket: '#2f8bff',
    obstacle: '#ff3300'
};

// MULTIPLIERS & STATE
// Sonido (audio.js): nunca debe romper el juego si no está disponible
const sfx = (n, o) => { try { if (window.SFX) window.SFX.play(n, o); } catch (e) { /* sin audio */ } };
let combo = 0;
let maxCombo = 0;
let windForce = 0;
let gravityFactor = 1.0;
const DARK_CHANCE = 0.10;   // probabilidad de que el siguiente nivel sea de niebla
const DARK_RADIUS = 105;    // radio (px) que se ilumina alrededor de la caja
let darkLevel = false;      // nivel oscuro: solo se ve un radio reducido alrededor de la caja

// Viento (nivel >= 12): en cada nivel hay un 20 % de probabilidad de que sople.
// Dirección aleatoria e intensidad mínima para que siempre se note
const WIND_CHANCE = 0.2;
function rollWind(R = Math.random) {
    if (level < 12) return 0;
    if (R() >= WIND_CHANCE) return 0;
    return (R() < 0.5 ? -1 : 1) * (0.025 + R() * 0.055);
}
let hasShield = false;
const ROCKET_JUMPS = 3;     // saltos cohete que da el power-up
let rocketJumps = 0;        // saltos cohete que quedan (cada uno se salta una plataforma)
let obstacles = [];
let powerups = [];
let blackHoles = [];
let inventory = [];
let ballSpeedFactor = 1.0;
let clockTimeoutId = null;
let greenPowerActive = 0;
let platformItemActive = false;
let bombActive = false;
// ===================== CAJAS CON PERSONALIDAD =====================
// La caja del jugador se elige en el menú principal (se guarda en este navegador).
const BOX_TYPES = {
    normal: { name: 'Clásica',  wind: 1,   grav: 1,   desc: 'Equilibrada y sin trucos.' },
    heavy:  { name: 'Pesada',   wind: 0,   grav: 1,   desc: 'Ignora el viento por completo.' },
    light:  { name: 'Ligera',   wind: 1.3, grav: 0.6, desc: 'Planea: cae muy despacio, pero el viento la empuja más.' },
    rubber: { name: 'Goma',     wind: 1,   grav: 1,   desc: 'Se aplasta al caer y rebota en las paredes. Toca la caja (1 vez por nivel) y bota como un resorte.' },
    sticky: { name: 'Pegajosa', wind: 1,   grav: 1,   desc: 'Se pega a la plataforma donde aterriza, sea cual sea la inercia o el tipo de plataforma.' },
    bomb:   { name: 'Bomba',    wind: 1,   grav: 1,   desc: 'Tienes 20 s por nivel para llegar a la meta o explota. Si llegas, sale disparada como un cohete, estalla en fuegos artificiales y aparece otra caja.' },
    gravity: { name: 'Gravitatoria', wind: 1, grav: 1, desc: 'Toca la caja (1 vez por nivel) y la gravedad del nivel se invierte durante 3 s: la caja flota hacia arriba.' },
    mystery: { name: 'Misteriosa', wind: 1, grav: 1,  desc: 'Se comporta como otra caja al azar... pero no te dice cuál.' },
};
const BOMB_FUSE_SECONDS = 20;
// Desbloqueo: se empieza solo con la clásica; las demás se desbloquean al aparecer en una partida
let unlockedBoxes = ['normal'];
try {
    const u = JSON.parse(localStorage.getItem('boxjump_unlocked_boxes') || 'null');
    if (Array.isArray(u)) unlockedBoxes = Array.from(new Set(['normal', ...u.filter((k) => BOX_TYPES[k])]));
} catch (e) { /* no disponible */ }
const isUnlocked = (k) => unlockedBoxes.includes(k);
function unlockBox(k) { // devuelve true si era nueva
    if (isUnlocked(k)) return false;
    unlockedBoxes.push(k);
    try { localStorage.setItem('boxjump_unlocked_boxes', JSON.stringify(unlockedBoxes)); } catch (e) { /* no disponible */ }
    return true;
}
let chosenBox = 'normal';   // la que eliges en el menú: solo vale para los 3 primeros niveles
try { const sb = localStorage.getItem('boxjump_box_type'); if (sb && BOX_TYPES[sb] && isUnlocked(sb)) chosenBox = sb; } catch (e) { /* no disponible */ }
let boxType = chosenBox;    // la caja activa ahora mismo (cambia sola cada 3 niveles)
let mysteryAs = 'normal';   // comportamiento real de la caja misteriosa
const BOX_SWAP_EVERY = 3;   // niveles que dura cada caja al azar
// Caja gravitatoria: al tocarla invierte la gravedad del nivel durante 3 s (1 vez por nivel)
const GRAV_FLIP_MS = 3000;
const GRAV_FLIP_MAX_VY = 5;  // velocidad máxima de ascenso mientras dura la inversión (px/frame)
let gravFlipT = 0;           // ms que le quedan a la inversión
let gravBoostUsed = false;   // ya usada en este nivel
let frameDtMs = 16;          // duración del último fotograma (la usan los drones)
let runFirstLevel = 1;      // primer nivel de la partida en curso
let rubberBoostUsed = false; // bote de la caja de goma (1 por nivel)
let bombRocket = false;     // la bomba desactivada vuela como un cohete
const boxKind = () => (boxType === 'mystery' ? mysteryAs : boxType); // comportamiento real
let bombFuse = BOMB_FUSE_SECONDS;
let lastUpdateT = performance.now();
// Simulación a paso fijo: la física avanza 60 pasos por segundo sea cual sea la tasa de refresco
// de la pantalla (60, 90, 120, 144 Hz...). Así todo va a la misma velocidad en cualquier móvil.
const STEP_MS = 1000 / 60;
let stepAcc = 0, lastFrameT = performance.now();
// Reloj del juego (ms): solo avanza mientras el mundo se mueve. Lo usan las plataformas que se
// desvanecen, las frágiles, las intermitentes, la del objeto y la pausa de las móviles, para que
// NO sigan corriendo con el juego en pausa, apuntando, en el tirachinas, en el rescate, etc.
let gameTime = 0;
let clockUntil = 0;          // objeto reloj: la bola va lenta hasta este instante (reloj del juego)
const boxCfg = () => BOX_TYPES[boxKind()];
const effWind = () => windForce * boxCfg().wind;          // viento que de verdad afecta a esta caja
const effGrav = () => player.gravity * boxCfg().grav;     // gravedad propia de esta caja
const armBomb = () => { bombFuse = BOMB_FUSE_SECONDS; };

// ===================== CAMBIO DE CAJA, COHETE-BOMBA, BOTE DE GOMA =====================
const BOX_KEYS = Object.keys(BOX_TYPES);
const boxLabel = (k) => (k === 'mystery' ? '❓ Misteriosa' : BOX_TYPES[k].name);
function rollRandomBox(exclude) {
    const pool = BOX_KEYS.filter((k) => k !== exclude);
    return pool[Math.floor(Math.random() * pool.length)];
}
function pickMysteryBehavior() {
    const pool = BOX_KEYS.filter((k) => k !== 'mystery');
    mysteryAs = pool[Math.floor(Math.random() * pool.length)];
}
function setActiveBox(key) {
    boxType = key;
    gravFlipT = 0;
    if (key === 'mystery') pickMysteryBehavior();
    placeOnPlatform();
    if (unlockBox(key) && gameMode !== 'race') showBoxIntro(key); // primera vez que aparece: cuadro informativo (en carrera no se pausa)
}
// Coloca la caja sobre la plataforma en la que está
function placeOnPlatform() {
    const p = player.currentPlatform;
    if (!p || !player.onGround) return;
    player.y = p.y - player.h;
    player.vy = 0;
}

// Plataforma "segura": no se mueve, no está a punto de romperse ni la está destruyendo un dron
const UNSAFE_TYPES = ['moving', 'oscillating', 'flash', 'temp_full', 'vanishing', 'fragile'];
function isSafePlatform(p) {
    return !!p && !p.isBroken && !p.vanishingStarted && !(p.rayT > 0) && !UNSAFE_TYPES.includes(p.type) &&
        !obstacles.some((o) => o.target === p);
}
// Posición X que tendrá una plataforma móvil dentro de T pasos (al llegar al borde se para 2 s)
function predictPlatX(p, T) {
    if (p.type !== 'moving' || p.isPaused) return p.x;
    return Math.max(0, Math.min(width - p.w, p.x + p.vx * T));
}

// --- Vuelo guiado de la caja hasta una plataforma (rescate, escudo y bomba) ---
// El mundo se congela, la caja vuela hasta la plataforma (que se sigue aunque la cámara se mueva)
// y al final la física normal la posa encima (cuenta como aterrizaje).
function flyTo(t, dur, kind, onLand) {
    rescue.active = true; rescue.kind = kind; rescue.phase = 'rise'; rescue.btn = null; rescue.target = t;
    rescue.rise = { t: 0, dur, x0: player.x, y0: player.y, target: t, spin: Math.PI * 2 * (player.x < t.x ? 1 : -1), onLand: onLand || null };
    player.vx = 0; player.vy = 0; player.angularVelocity = 0; player.onGround = false;
}

// --- Escudo: al caer, se convierte en una plataforma en el centro de la pantalla y la caja vuela hasta ella ---
const SHIELD_PLAT_W = 120;
function shieldSave(msg) {
    sfx('shield');
    hasShield = false;
    const y = Math.round(height * 0.5);
    const sp = new Platform(width / 2 - SHIELD_PLAT_W / 2, y, SHIELD_PLAT_W, 20, false, 'shield');
    platforms.push(sp);
    createExplosion(width / 2, y, 1.0);
    addFlash(0.3, '0,255,120');
    showFeedback(msg || '🛡️ ¡EL ESCUDO TE SALVA!');
    flyTo(sp, 650, 'shield');
}

// --- Caja gravitatoria: un toque sobre ella (1 vez por nivel) invierte la gravedad durante 3 s ---
function gravityFlip() {
    gravBoostUsed = true; gravFlipT = GRAV_FLIP_MS;
    if (player.onGround) { player.onGround = false; player.vy = -3; } // se despega de la plataforma
    player.straightBounce = false;
    showFeedback('🌀 ¡GRAVEDAD INVERTIDA! 3 s');
    sfx('gravity_on');
    createExplosion(player.x + player.w / 2, player.y + player.h / 2, 0.8);
}

// --- Caja bomba: al desactivarla sale disparada como un cohete, explota y aparece otra caja ---
const BOMB_TARGET_N = 5; // la bomba desactivada vuela hasta la 5.ª plataforma por encima
function bombTargetPlatform() {
    const feet = player.y + player.h;
    const above = platforms.filter((p) => p !== player.currentPlatform && !p.isBroken && p.y < feet - 10)
        .sort((a, b) => b.y - a.y); // la más cercana primero
    const ok = (p) => isSafePlatform(p) && !p.isGoal;
    // la 5.ª o, si no es segura, la primera segura a partir de ella; si no hay, la más alta segura por debajo
    for (let i = BOMB_TARGET_N - 1; i < above.length; i++) if (ok(above[i])) return above[i];
    for (let i = Math.min(BOMB_TARGET_N - 2, above.length - 1); i >= 0; i--) if (ok(above[i])) return above[i];
    return above.find(isSafePlatform) || null;
}
function bombExplode() {
    bombRocket = false; player.rocket = false;
    // fuegos artificiales al llegar
    const cx = player.x + player.w / 2, cy = player.y + player.h / 2;
    spawnFirework(cx, cy, true);
    setTimeout(() => { spawnFirework(cx - 70, cy - 60, false); sfx('explosion'); }, 180);
    setTimeout(() => { spawnFirework(cx + 70, cy - 90, false); sfx('rescue_win'); }, 360);
    sfx('explosion');
    if (navigator.vibrate) { try { navigator.vibrate(40); } catch (e) { /* sin vibración */ } }
    const next = rollRandomBox(boxType);
    setActiveBox(next);
    showFeedback('🎆 ¡LA BOMBA ESTALLA!\n📦 Nueva caja: ' + boxLabel(next));
}
function launchBombRocket() {
    sfx('rocket');
    createExplosion(player.x + player.w / 2, player.y + player.h, 0.8); // impulso del despegue
    const t = bombTargetPlatform();
    if (!t) { bombExplode(); return; }
    bombRocket = true; player.rocket = true;
    showFeedback('💣🚀 ¡BOMBA DESACTIVADA!\nSales disparado');
    flyTo(t, 1100, 'bomb', bombExplode);
}
function updateBombRocket() { /* el vuelo lo gestiona flyTo / updateRescue */ }

// --- Caja de goma: un toque sobre ella (1 vez por nivel) la hace botar como una plataforma-resorte ---
function rubberBoost() {
    rubberBoostUsed = true;
    player.vy = -Math.sqrt(2 * effGrav() * 220) * 1.4;
    player.vx = 0; player.straightBounce = true; player.rocket = true;
    player.onGround = false; player.angularVelocity = 0; player.squash = 1;
    showFeedback('🟣 ¡BOTE!');
    sfx('spring');
    createExplosion(player.x + player.w / 2, player.y + player.h, 0.8);
}

function roundRectPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
// Dibuja una caja centrada en (0,0). Cada tipo tiene su propio aspecto.
function drawBoxShape(c, type, w, h, t, o = {}) {
    const x = -w / 2, y = -h / 2;
    c.save();
    switch (type) {
        case 'heavy': { // acero remachado con placa "KG"
            c.shadowBlur = 14; c.shadowColor = '#9fb4d0';
            const g = c.createLinearGradient(0, y, 0, y + h);
            g.addColorStop(0, '#9aabc2'); g.addColorStop(1, '#3d4a5c');
            c.fillStyle = g; c.fillRect(x, y, w, h);
            c.shadowBlur = 0;
            c.strokeStyle = '#1b2430'; c.lineWidth = 4; c.strokeRect(x + 2, y + 2, w - 4, h - 4);
            c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1; c.strokeRect(x + 5.5, y + 5.5, w - 11, h - 11);
            c.fillStyle = '#e1e8f2';
            [[x + 3, y + 3], [x + w - 7, y + 3], [x + 3, y + h - 7], [x + w - 7, y + h - 7]].forEach(([rx, ry]) => c.fillRect(rx, ry, 4, 4));
            c.fillStyle = '#10161f'; c.font = `bold ${Math.max(7, Math.round(h * 0.3))}px Arial`;
            c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('KG', 0, 1);
            break;
        }
        case 'light': { // translúcida, con alitas que aletean
            const flap = Math.sin(t * 0.014) * 0.45;
            c.shadowBlur = 12; c.shadowColor = '#bfe9ff';
            c.fillStyle = 'rgba(255,255,255,0.8)';
            [-1, 1].forEach((s) => {
                c.save(); c.translate(s * w / 2, -h * 0.12); c.rotate(s * (-0.55 + flap));
                c.beginPath(); c.ellipse(s * 9, 0, 11, 4.5, 0, 0, Math.PI * 2); c.fill(); c.restore();
            });
            c.fillStyle = 'rgba(214,240,255,0.88)'; c.fillRect(x, y, w, h);
            c.shadowBlur = 0;
            c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 1.5; c.strokeRect(x + 2, y + 2, w - 4, h - 4);
            c.fillStyle = 'rgba(120,190,230,0.55)';
            c.fillRect(x + w * 0.22, y + h * 0.32, w * 0.56, 2); c.fillRect(x + w * 0.3, y + h * 0.5, w * 0.4, 2); c.fillRect(x + w * 0.38, y + h * 0.68, w * 0.24, 2);
            break;
        }
        case 'rubber': { // goma rosa con brillo
            c.shadowBlur = 14; c.shadowColor = '#ff4f9a';
            c.fillStyle = '#ff4f9a'; roundRectPath(c, x, y, w, h, Math.min(11, w * 0.36)); c.fill();
            c.shadowBlur = 0;
            c.strokeStyle = 'rgba(130,0,70,0.55)'; c.lineWidth = 2; roundRectPath(c, x + 1, y + 1, w - 2, h - 2, Math.min(10, w * 0.34)); c.stroke();
            c.fillStyle = 'rgba(255,255,255,0.5)'; roundRectPath(c, x + 4, y + 4, w * 0.46, h * 0.2, 4); c.fill();
            break;
        }
        case 'sticky': { // verde con goterones que cuelgan
            c.shadowBlur = 12; c.shadowColor = '#00ff64';
            c.fillStyle = '#2ecf6a'; c.fillRect(x, y, w, h);
            c.shadowBlur = 0;
            c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 1.5; c.strokeRect(x + 2, y + 2, w - 4, h - 4);
            c.fillStyle = '#00ff64'; c.fillRect(x, y + h - 6, w, 6);
            const d = (Math.sin(t * 0.004) + 1) / 2;
            [[-w / 4, 3 + d * 3], [w / 5, 2.5 + (1 - d) * 3], [w * 0.38, 2 + d * 2]].forEach(([dx, len]) => {
                c.fillRect(dx - 1.2, y + h - 1, 2.4, len); c.beginPath(); c.arc(dx, y + h + len - 1, 2.6, 0, Math.PI * 2); c.fill();
            });
            break;
        }
        case 'bomb': { // negra con franja roja, mecha encendida
            c.shadowBlur = 10; c.shadowColor = '#ff3b2f';
            c.fillStyle = '#1a1a22'; c.fillRect(x, y, w, h);
            c.shadowBlur = 0;
            c.strokeStyle = '#ff3b2f'; c.lineWidth = 2; c.strokeRect(x + 2, y + 2, w - 4, h - 4);
            c.fillStyle = '#ff3b2f'; c.fillRect(x, y + h * 0.42, w, h * 0.16);
            c.strokeStyle = '#caa46a'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, y); c.quadraticCurveTo(5, y - 6, 2, y - 10); c.stroke();
            const urgent = o.fuse !== undefined && o.fuse < 5;
            if (!urgent || Math.floor(t / 110) % 2 === 0) {
                c.fillStyle = Math.floor(t / 90) % 2 ? '#ffe08a' : '#ff9a1f';
                c.shadowBlur = 14; c.shadowColor = '#ff9a1f';
                c.beginPath(); c.arc(2, y - 10, 3.2 + Math.sin(t * 0.03), 0, Math.PI * 2); c.fill();
            }
            break;
        }
        case 'gravity': { // violeta con flechas arriba/abajo; brilla en cian mientras la gravedad está invertida
            const on = !!o.flip;
            c.shadowBlur = on ? 22 : 12; c.shadowColor = on ? '#7df9ff' : '#8a5bff';
            const gr = c.createLinearGradient(0, y, 0, y + h);
            gr.addColorStop(0, '#5b3df5'); gr.addColorStop(1, '#1b1450');
            c.fillStyle = gr; c.fillRect(x, y, w, h);
            c.shadowBlur = 0;
            c.strokeStyle = on ? '#7df9ff' : '#b79cff'; c.lineWidth = 2; c.strokeRect(x + 2, y + 2, w - 4, h - 4);
            const s = Math.max(3, w * 0.14), ay = h * 0.22;
            c.fillStyle = on ? '#7df9ff' : '#e6dcff';
            // flecha hacia arriba (izquierda)
            c.beginPath(); c.moveTo(-w * 0.2, y + ay); c.lineTo(-w * 0.2 - s, y + ay + s * 1.6); c.lineTo(-w * 0.2 + s, y + ay + s * 1.6); c.closePath(); c.fill();
            c.fillRect(-w * 0.2 - 1, y + ay + s * 1.6, 2, h * 0.3);
            // flecha hacia abajo (derecha)
            c.fillStyle = on ? 'rgba(125,249,255,0.35)' : '#e6dcff';
            c.beginPath(); c.moveTo(w * 0.2, y + h - ay); c.lineTo(w * 0.2 - s, y + h - ay - s * 1.6); c.lineTo(w * 0.2 + s, y + h - ay - s * 1.6); c.closePath(); c.fill();
            c.fillRect(w * 0.2 - 1, y + h - ay - s * 1.6 - h * 0.3, 2, h * 0.3);
            break;
        }
        case 'mystery': { // oscura con borde arcoíris y un "?"
            const hue = (t * 0.05) % 360;
            c.shadowBlur = 12; c.shadowColor = `hsl(${hue},90%,60%)`;
            c.fillStyle = '#2b2140'; c.fillRect(x, y, w, h);
            c.shadowBlur = 0;
            c.strokeStyle = `hsl(${hue},90%,65%)`; c.lineWidth = 2; c.strokeRect(x + 2, y + 2, w - 4, h - 4);
            c.fillStyle = '#fff'; c.font = `bold ${Math.max(10, Math.round(h * 0.62))}px Arial`;
            c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', 0, 1);
            break;
        }
        default: { // clásica: cubo de neón con bisel y núcleo
            c.shadowBlur = 18; c.shadowColor = 'rgba(62,240,255,0.75)';
            const g = c.createLinearGradient(0, y, 0, y + h);
            g.addColorStop(0, '#9ffbff'); g.addColorStop(0.45, '#3ef0ff'); g.addColorStop(1, '#0fa3c4');
            c.fillStyle = g; roundRectPath(c, x, y, w, h, 5); c.fill();
            c.shadowBlur = 0;
            c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 1.2; roundRectPath(c, x + 2.5, y + 2.5, w - 5, h - 5, 3.5); c.stroke();
            c.fillStyle = 'rgba(255,255,255,0.45)'; roundRectPath(c, x + 4, y + 3.5, w - 8, h * 0.18, 2); c.fill();
            c.fillStyle = 'rgba(6,40,60,0.55)'; roundRectPath(c, -w * 0.17, -h * 0.1, w * 0.34, h * 0.34, 3); c.fill();
            c.fillStyle = 'rgba(255,255,255,0.9)'; roundRectPath(c, -w * 0.09, -h * 0.02, w * 0.18, h * 0.18, 2); c.fill();
        }
    }
    c.restore();
}

// ===================== LAVA ASCENDENTE (cada 10 niveles) =====================
const LAVA_EVERY = 10;      // un nivel de lava cada N niveles
const LAVA_MAX_SKIPS = 3;   // (en desuso) antes: pasadas sin pulsar
const LAVA_RISE_EVERY = 5;  // segundos entre cada subida de la lava
const lava = { active: false, y: 0, targetY: 0, skips: 0, doom: false, armed: false, t: 0, timer: 5 };

// ===================== LÁPIDAS (muertes de otros jugadores) =====================
let tombstones = [];
let lastPlatIdx = 0;                 // índice (dentro del nivel) de la última plataforma pisada
const usedTombPhrases = new Set();
const TOMB_PHRASES = [
    'Dijo «ya lo tengo» justo antes de saltar.',
    'Pulsó un pelín tarde. Un pelín.',
    'La gravedad siempre gana.',
    'Descansa en piezas.',
    'Era el salto fácil, decían.',
    'Aquí perdió la fe en la zona verde.',
    'Murió como vivió: apuntando mal.',
    'Se oyó un «¡ay!» larguísimo.',
    'Eligió la plataforma equivocada.',
    'Nunca más confiará en el viento.',
    'F por los que cayeron aquí.',
    'Vio la plataforma. La plataforma no lo vio a él.',
    'Aquí yace un combo de x9.',
    'Casi. Casi casi.',
    'Su último pensamiento: «¿y si pulso ya?»',
];

// ===================== RESCATE EN EL ÚLTIMO SEGUNDO =====================
const RESCUE_STEPS = 3;            // botones seguidos
const RESCUE_TIME = 1500;          // ms que tarda el aro en cerrarse en cada botón (el doble de rápido)
const RESCUE_TARGET_R = 30;        // radio del círculo fijo
const RESCUE_START_R = 112;        // radio inicial del aro que se achica
const RESCUE_TOL = [12, 10, 8];    // margen de acierto (px) en cada botón: cada vez más exigente
const RESCUE_CHANCE = 1 / 3;       // probabilidad de que te ofrezcan el rescate al caer (1 de cada 3)
const RESCUE_TRIGGER = 0.74;       // la caja debe haber caído por debajo de este % de pantalla
const rescue = { active: false, usedThisLevel: false, rolled: false, phase: 'idle', step: 0, elapsed: 0, btn: null, prev: null, target: null, rise: null };
let chests = [];          // cofres sobre plataformas
let reels = [];           // rodillos de la tragaperras pendientes de parar
let reelTimer = null;

// Cofres y objetos
const ITEM_POOL = ['clock', 'platform', 'power', 'bomb'];
const ITEM_ICONS = { clock: '⏱️', platform: '🏗️', power: '⚡', bomb: '💣' };
const MAX_INV = 3;
const CHEST_CHANCE = 0.12; // probabilidad de cofre por plataforma

// --- PLAYER ---
const player = {
    x: 0,
    y: 0,
    w: 30,
    h: 30,
    vx: 0,
    vy: 0,
    rotation: 0,
    angularVelocity: 0,
    gravity: 0.6,
    onGround: false,
    color: THEME.player,
    currentPlatform: null,
    bouncesLeft: 2,   // rebotes que le quedan a la caja de goma
    squash: 0,        // aplastamiento visual (goma)

    update() {
        if (this.squash > 0) this.squash = Math.max(0, this.squash - 0.07);
        // Viento si no está en el suelo (la caja pesada lo ignora, la ligera lo nota más)
        if (!this.onGround) {
            if (!this.straightBounce) this.vx += effWind();
            if (gravFlipT > 0) this.vy = Math.max(-GRAV_FLIP_MAX_VY, this.vy - effGrav() * gravityFactor); // gravedad invertida: flota hacia arriba
            else this.vy += effGrav() * gravityFactor;
            this.rotation += this.angularVelocity;
        } else {
            this.vy = 0;
            this.straightBounce = false;
            // Fricción según plataforma
            let friction = 0.85;
            if (this.currentPlatform && this.currentPlatform.type === 'ice') friction = 0.98;
            if (this.currentPlatform && (this.currentPlatform.type === 'sticky' || this.currentPlatform.type === 'mini_sticky')) friction = 0;
            if (boxKind() === 'sticky') friction = 0; // la caja pegajosa se queda clavada donde cae
            if (this.currentPlatform && this.currentPlatform.type === 'shield') friction = 0; // el escudo la sujeta

            this.vx *= friction;
            this.rotation = 0;
            this.angularVelocity = 0;

            // Sincronización con plataformas móviles/oscilantes
            if (this.currentPlatform) {
                if (this.currentPlatform.type === 'moving' && !this.currentPlatform.isPaused) {
                    this.x += this.currentPlatform.vx;
                }
                if (this.currentPlatform.type === 'oscillating') {
                    this.y += this.currentPlatform.vy;
                }
            }
        }

        // Atracción Agujeros Negros
        blackHoles.forEach(bh => {
            const dx = bh.x - (this.x + this.w / 2);
            const dy = bh.y - (this.y + this.h / 2);
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 0 && dist < bh.radius * 3) {
                const force = (1 - dist / (bh.radius * 3)) * 0.5;
                this.vx += (dx / dist) * force;
                this.vy += (dy / dist) * force;
            }
        });

        this.prevY = this.y;
        this.x += this.vx;
        this.y += this.vy;

        if (this.x < 0) { this.x = 0; if (boxKind() === 'rubber' && !this.onGround) this.vx = Math.abs(this.vx) * 0.85; }
        if (this.x + this.w > width) { this.x = width - this.w; if (boxKind() === 'rubber' && !this.onGround) this.vx = -Math.abs(this.vx) * 0.85; }

        if (this.y > height) {
            if (hasShield) shieldSave();
            else endGame();
        }
    },

    draw() {
        ctx.save();
        ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
        ctx.rotate(this.rotation);
        { // aplastamiento al caer y estiramiento al volar (la goma, el doble)
            const k = boxKind() === 'rubber' ? 1 : 0.55;
            const stretch = this.onGround ? 0 : Math.min(0.25, Math.abs(this.vy) * 0.012) * k;
            const sy = 1 - 0.35 * this.squash * k + stretch, sx = 1 + 0.3 * this.squash * k - stretch * 0.6;
            ctx.translate(0, (this.h / 2) * (1 - sy));
            ctx.scale(sx, sy);
        }
        drawBoxShape(ctx, boxType, this.w, this.h, performance.now(), { fuse: bombFuse, flip: gravFlipT > 0 });
        ctx.restore();
    }
};

// --- PRECISION SYSTEM ---
const precisionSystem = {
    ball: { x: 0, y: 0, radius: 10, active: false, speed: 4 },
    side: 'right', // 'left' | 'right' (configurable)
    canal: { x: 0, y: 0, w: 40, h: 0, rightPadding: 25, leftPadding: 25 },
    targetArea: { y: 0, h: 200, greenScale: 0.2 },

    init() {
        this.canal.w = 40;
        this.canal.x = this.side === 'left'
            ? this.canal.leftPadding
            : width - this.canal.w - this.canal.rightPadding;
        this.canal.y = 40;
        this.canal.h = height - 80;
        this.targetArea.y = height - this.targetArea.h - 120;
    },

    // Tamaño base de la zona verde
    greenBase() { return this.targetArea.greenScale; },

    spawnBall() {
        this.ball.x = this.canal.x + this.canal.w / 2;
        this.ball.y = -50;
        this.ball.active = true;
        if (lava.active) lava.armed = true; // en el nivel de lava, a partir de esta bola cuentan las pasadas

        const candidates = platforms.filter(p => p.y < player.y).sort((a, b) => b.y - a.y);
        let difficultyFactor = 1;
        if (candidates.length > 0) {
            const distY = player.y - candidates[0].y;
            difficultyFactor = Math.max(1, distY / 150);
        }

        // Zona verde dinámica (con margen extra en los primeros niveles para una curva de entrada más suave)
        const levelEase = Math.max(0, (10 - level) * 0.035);
        this.targetArea.greenScale = Math.min(0.9, Math.max(0.05, 0.45 - (difficultyFactor * 0.3) + levelEase));

        const randomVariance = (Math.random() - 0.5) * 1.5;
        this.ball.speed = (5 + (Math.min(level - 1, 20) * 0.8) + (difficultyFactor * 2.5)) + randomVariance;
        if (this.ball.speed < 4) this.ball.speed = 4;
        if (this.ball.speed > 16) this.ball.speed = 16;
    },

    update() {
        if (!this.ball.active) return;
        this.ball.y += this.ball.speed * ballSpeedFactor;
        if (this.ball.y > height + this.ball.radius) {
            this.ball.active = false;
            lavaSkip(); // la bola ha pasado sin que pulsaras
            this.spawnBall();
        }
    },

    checkHit() {
        if (!this.ball.active) return { multiplier: 0, tier: "MISSED", subScore: 0 };
        const ballY = this.ball.y;
        const targetCenterY = this.targetArea.y + this.targetArea.h / 2;
        const dist = Math.abs(ballY - targetCenterY);
        const maxDist = this.targetArea.h / 2;

        if (dist < maxDist) {
            this.ball.active = false;
            let tier = "MISSED", multiplier = 0, subScore = 0;

            // Item Power: Zona verde x5
            const currentGreenScale = greenPowerActive > 0 ? Math.min(1.0, this.greenBase() * 5) : this.greenBase();
            if (greenPowerActive > 0) greenPowerActive--;

            const greenLimit = maxDist * currentGreenScale;
            const yellowLimit = maxDist * 0.65;

            if (dist < greenLimit) {
                tier = "PERFECT"; multiplier = 1.0;
                subScore = Math.ceil((1 - (dist / greenLimit)) * 5) / 5;
                if (subScore < 0.2) subScore = 0.2;
                combo++;
                if (combo > maxCombo) maxCombo = combo;
            } else if (dist < yellowLimit) {
                tier = "GOOD"; multiplier = 0.7; subScore = 0.5;
                combo = 0;
            } else {
                tier = "POOR"; multiplier = 0.4; subScore = 0.2;
                combo = 0;
            }

            updateComboDisplay();
            sfx('hit', { tier });
            if (tier === 'PERFECT') addFlash(0.1, '93,255,201');

            let feedback = tier + (tier === "PERFECT" ? ` x${Math.round(subScore * 5)}` : "");
            if (combo > 1) feedback += `\nCOMBO x${combo}!`;
            showFeedback(feedback);

            createExplosion(this.ball.x, this.ball.y, multiplier);
            this.spawnBall();
            return { multiplier, tier, subScore };
        }
        combo = 0; // Fallar tiro reinicia combo
        updateComboDisplay();
        sfx('miss');
        return { multiplier: 0, tier: "MISSED", subScore: 0 };
    },

    draw() {
        ctx.save();
        const tx = this.canal.x, ty = this.canal.y, tw = this.canal.w, th = this.canal.h;

        // Progreso del nivel: carril fino con banderín
        const progressX = this.side === 'left' ? tx - 12 : tx + tw + 8;
        const progressFill = Math.min(1, platformsReached / platformsInLevel);
        ctx.fillStyle = 'rgba(201,211,255,0.12)'; roundRectPath(ctx, progressX, ty, 4, th, 2); ctx.fill();
        if (progressFill > 0) {
            const pg = ctx.createLinearGradient(0, ty + th, 0, ty);
            pg.addColorStop(0, '#3ef0ff'); pg.addColorStop(1, '#ffcf4a');
            ctx.fillStyle = pg; roundRectPath(ctx, progressX, ty + th * (1 - progressFill), 4, th * progressFill, 2); ctx.fill();
        }
        ctx.fillStyle = '#ff5c8a'; ctx.beginPath(); ctx.moveTo(progressX + 2, ty - 10); ctx.lineTo(progressX + 11 * (this.side === 'left' ? -1 : 1), ty - 6); ctx.lineTo(progressX + 2, ty - 2); ctx.closePath(); ctx.fill();

        // Canal en forma de cápsula
        ctx.fillStyle = 'rgba(8,10,30,0.72)';
        roundRectPath(ctx, tx, ty, tw, th, tw / 2); ctx.fill();
        ctx.strokeStyle = 'rgba(201,211,255,0.14)'; ctx.lineWidth = 1;
        roundRectPath(ctx, tx + 0.5, ty + 0.5, tw - 1, th - 1, tw / 2); ctx.stroke();

        const areaY = this.targetArea.y, areaH = this.targetArea.h, centerY = areaY + areaH / 2;
        const halfArea = areaH / 2;
        // Mismos límites que usa checkHit(): greenLimit / yellowLimit relativos a maxDist (=halfArea)
        const currentGreenScale = greenPowerActive > 0 ? Math.min(1.0, this.greenBase() * 5) : this.greenBase();
        const greenHalf = halfArea * currentGreenScale;
        const yellowHalf = Math.max(greenHalf, halfArea * 0.65);
        const greenH = greenHalf * 2;
        const yellowH = yellowHalf - greenHalf;
        const redH = Math.max(0, halfArea - yellowHalf);
        const ix = tx + 5, iw = tw - 10;
        const band = (yy, hh, c1, c2) => {
            if (hh <= 0.5) return;
            const g = ctx.createLinearGradient(ix, 0, ix + iw, 0);
            g.addColorStop(0, c2); g.addColorStop(0.5, c1); g.addColorStop(1, c2);
            ctx.fillStyle = g; roundRectPath(ctx, ix, yy, iw, hh, Math.min(4, hh / 2)); ctx.fill();
        };
        band(areaY, redH, 'rgba(255,92,138,0.7)', 'rgba(255,92,138,0.35)');
        band(areaY + areaH - redH, redH, 'rgba(255,92,138,0.7)', 'rgba(255,92,138,0.35)');
        band(areaY + redH + 1, yellowH - 2, 'rgba(255,181,71,0.85)', 'rgba(255,181,71,0.4)');
        band(areaY + areaH - redH - yellowH + 1, yellowH - 2, 'rgba(255,181,71,0.85)', 'rgba(255,181,71,0.4)');
        const gY = centerY - greenH / 2, pulse = 0.75 + 0.25 * Math.sin(performance.now() / 260);
        // halo de la zona verde (sin shadowBlur: es mucho más barato)
        ctx.fillStyle = `rgba(93,255,201,${0.1 + 0.1 * pulse})`; roundRectPath(ctx, ix - 7, gY - 6, iw + 14, greenH + 12, 9); ctx.fill();
        ctx.fillStyle = `rgba(93,255,201,${0.12 + 0.12 * pulse})`; roundRectPath(ctx, ix - 4, gY - 3, iw + 8, greenH + 6, 7); ctx.fill();
        band(gY, greenH, 'rgba(93,255,201,0.95)', 'rgba(93,255,201,0.55)');
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.2;
        roundRectPath(ctx, ix - 2, gY - 1, iw + 4, greenH + 2, 5); ctx.stroke();
        ctx.strokeStyle = 'rgba(6,40,40,0.35)'; ctx.lineWidth = 1;
        for (let i = 1; i < 5; i++) { const lineY = gY + (greenH / 5) * i; ctx.beginPath(); ctx.moveTo(ix + 4, lineY); ctx.lineTo(ix + iw - 4, lineY); ctx.stroke(); }

        // Bola con estela de cometa
        if (!this.trail) this.trail = [];
        if (this.ball.active) {
            this.trail.push(this.ball.y); if (this.trail.length > 6) this.trail.shift();
            const bx = this.ball.x, by = this.ball.y, r = this.ball.radius;
            ctx.globalCompositeOperation = 'lighter';
            if (this.trail.length > 1) { // cola de cometa continua
                const tg = ctx.createLinearGradient(0, this.trail[0], 0, by);
                tg.addColorStop(0, 'rgba(255,79,216,0)'); tg.addColorStop(1, 'rgba(255,79,216,0.55)');
                ctx.strokeStyle = tg; ctx.lineWidth = r * 1.3; ctx.lineCap = 'round';
                ctx.beginPath(); ctx.moveTo(bx, this.trail[0]); ctx.lineTo(bx, by); ctx.stroke();
            }
            const halo = ctx.createRadialGradient(bx, by, 0, bx, by, r * 2.2);
            halo.addColorStop(0, 'rgba(255,255,255,0.95)'); halo.addColorStop(0.35, 'rgba(255,79,216,0.8)'); halo.addColorStop(1, 'rgba(255,79,216,0)');
            ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(bx, by, r * 2.2, 0, Math.PI * 2); ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(bx, by, r * 0.55, 0, Math.PI * 2); ctx.fill();
        } else this.trail.length = 0;
        ctx.restore();
    }
};

// --- PROPS (MODIFICADOS) ---
class Prop {
    constructor(x, y, w, h, color) {
        this.x = x; this.y = y; this.w = w; this.h = h;
        this.vx = 0; this.vy = 0;
        this.gravity = 0.5;
        this.onGround = false;
        this.color = color;
        this.weight = w * h / 400; // El peso depende del tamaño
        this.isOffScreen = false;
    }

    update() {
        if (!this.onGround) {
            this.vy += this.gravity;
        } else {
            this.vy = 0;
            this.vx *= 0.95; // Fricción
        }
        this.x += this.vx;
        this.y += this.vy;

        // Limites horizontales
        if (this.x < 0) { this.x = 0; this.vx *= -0.5; }
        if (this.x + this.w > width) { this.x = width - this.w; this.vx *= -0.5; }

        if (this.y > height && !this.isOffScreen) {
            this.isOffScreen = true;
            return false;
        }
        return true;
    }

    draw() {
        ctx.save();
        const g = ctx.createLinearGradient(0, this.y, 0, this.y + this.h);
        g.addColorStop(0, '#9fb2ff'); g.addColorStop(1, '#3d4fae');
        ctx.shadowBlur = 10; ctx.shadowColor = 'rgba(120,140,255,0.45)';
        ctx.fillStyle = g; roundRectPath(ctx, this.x, this.y, this.w, this.h, 4); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
        roundRectPath(ctx, this.x + 2.5, this.y + 2.5, this.w - 5, this.h - 5, 2.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(this.x + 3, this.y + 3); ctx.lineTo(this.x + this.w - 3, this.y + this.h - 3); ctx.stroke(); // cruz de caja de madera
        ctx.restore();
    }
}

// --- PLATFORMS ---
class Platform {
    constructor(x, y, w, h, isGoal = false, type = 'normal', dirX, dirY) {
        this.x = x; this.y = y; this.w = w; this.h = h;
        this.isGoal = isGoal;
        this.type = type; // 'normal', 'vanishing', 'moving', 'ice', 'sticky', 'fragile'
        this.alpha = 1.0;
        this.vanishingStarted = false;
        this.startTime = 0;
        this.vx = (type === 'moving') ? ((dirX === undefined ? Math.random() > 0.5 : dirX) ? 2 : -2) * Math.min(3, 1 + level * 0.1) : 0; // tope: x3
        this.vy = (type === 'oscillating') ? ((dirY === undefined ? Math.random() > 0.5 : dirY) ? 1.5 : -1.5) * Math.min(3, 1 + level * 0.1) : 0;
        this.isBroken = false;
        this.isPaused = false;
        this.pauseTimer = 0;
        this.oscOffset = 0;
        this.isVisible = true;
        this.rayT = 0; // 0..1: progreso del rayo de un dron sobre esta plataforma
        this.idx = -1; // orden dentro del nivel (0 = plataforma de salida); sirve para las lápidas

        if (type === 'mini_sticky') this.w *= 0.6;
    }

    draw() {
        if (this.isBroken) return;
        const x = this.x, y = this.y, h = this.h, pw = this.type === 'temp_full' ? width : this.w;
        const col = this.getColor(), t = performance.now();
        if (this.type === 'flash' && !this.isVisible) { // apagada: solo el contorno punteado
            ctx.save();
            ctx.setLineDash([4, 5]); ctx.strokeStyle = 'rgba(232,238,255,0.22)'; ctx.lineWidth = 1.5;
            roundRectPath(ctx, x + 0.5, y + 0.5, pw - 1, h - 1, 6); ctx.stroke();
            ctx.restore();
            return;
        }
        ctx.save();
        ctx.globalAlpha = this.alpha;

        // haz de luz de la meta
        if (this.isGoal) {
            const pulse = 0.55 + 0.25 * Math.sin(t / 380);
            const beam = ctx.createLinearGradient(0, y - 170, 0, y);
            beam.addColorStop(0, 'rgba(255,207,74,0)'); beam.addColorStop(1, `rgba(255,207,74,${0.22 * pulse})`);
            ctx.fillStyle = beam;
            ctx.beginPath(); ctx.moveTo(x + pw * 0.15, y); ctx.lineTo(x + pw * 0.85, y); ctx.lineTo(x + pw, y - 170); ctx.lineTo(x, y - 170); ctx.closePath(); ctx.fill();
        }
        // sombra suave bajo la plataforma
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        roundRectPath(ctx, x + 4, y + h - 1, pw - 8, 9, 5); ctx.fill();
        // cuerpo con degradado y halo del color de la plataforma
        const body = ctx.createLinearGradient(0, y, 0, y + h);
        body.addColorStop(0, shade(col, 0.25)); body.addColorStop(0.4, col); body.addColorStop(1, shade(col, -0.55));
        // halo de color (dos capas translúcidas: mucho más barato que shadowBlur)
        ctx.fillStyle = rgba(col, 0.09); roundRectPath(ctx, x - 6, y - 5, pw + 12, h + 10, 11); ctx.fill();
        ctx.fillStyle = rgba(col, 0.14); roundRectPath(ctx, x - 3, y - 2.5, pw + 6, h + 5, 8.5); ctx.fill();
        ctx.fillStyle = body; roundRectPath(ctx, x, y, pw, h, 6); ctx.fill();
        // canto superior luminoso y bisel inferior
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; roundRectPath(ctx, x + 4, y + 1.5, pw - 8, 2.4, 1.2); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x + 5, y + h - 4, pw - 10, 2);

        // detalles por tipo
        ctx.save();
        roundRectPath(ctx, x, y, pw, h, 6); ctx.clip();
        if (this.type === 'ice') { // brillo helado en diagonal
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            for (let i = -1; i < pw / 16; i++) { ctx.beginPath(); ctx.moveTo(x + i * 16, y + h); ctx.lineTo(x + i * 16 + 6, y + h); ctx.lineTo(x + i * 16 + 14, y); ctx.lineTo(x + i * 16 + 8, y); ctx.closePath(); ctx.fill(); }
        }
        if (this.type === 'fragile') { // grietas
            ctx.strokeStyle = 'rgba(40,46,60,0.6)'; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + pw * 0.3, y); ctx.lineTo(x + pw * 0.36, y + h * 0.5); ctx.lineTo(x + pw * 0.31, y + h);
            ctx.moveTo(x + pw * 0.7, y); ctx.lineTo(x + pw * 0.64, y + h * 0.6); ctx.lineTo(x + pw * 0.72, y + h);
            ctx.stroke();
        }
        if (this.type === 'vanishing') { // destellos que se apagan
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            for (let i = 0; i < 4; i++) { const k = (t / 600 + i * 0.25) % 1; ctx.globalAlpha = this.alpha * (1 - k); ctx.fillRect(x + (i + 0.5) * pw / 4 - 1.5, y + h * 0.35, 3, 3); }
            ctx.globalAlpha = this.alpha;
        }
        if (this.type === 'moving' || this.type === 'oscillating') { // flechas de dirección
            ctx.fillStyle = 'rgba(30,20,0,0.45)';
            const cx = x + pw / 2, cy = y + h / 2 + 1;
            if (this.isPaused) { ctx.fillRect(cx - 5, cy - 4, 3, 8); ctx.fillRect(cx + 2, cy - 4, 3, 8); }
            else if (this.type === 'moving') {
                const d = Math.sign(this.vx) || 1;
                [-9, 0, 9].forEach((o) => { ctx.beginPath(); ctx.moveTo(cx + o - 3 * d, cy - 4); ctx.lineTo(cx + o + 3 * d, cy); ctx.lineTo(cx + o - 3 * d, cy + 4); ctx.closePath(); ctx.fill(); });
            } else {
                ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx + 4, cy - 1); ctx.lineTo(cx - 4, cy - 1); ctx.closePath(); ctx.fill();
                ctx.beginPath(); ctx.moveTo(cx, cy + 6); ctx.lineTo(cx + 4, cy + 1); ctx.lineTo(cx - 4, cy + 1); ctx.closePath(); ctx.fill();
            }
        }
        if (this.isGoal) { // franja a cuadros de meta
            const sq = 5;
            for (let i = 0; i * sq < pw; i++) {
                ctx.fillStyle = i % 2 ? 'rgba(40,24,0,0.55)' : 'rgba(255,255,255,0.75)';
                ctx.fillRect(x + i * sq, y + h - 8, sq, 3.5);
                ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.75)' : 'rgba(40,24,0,0.55)';
                ctx.fillRect(x + i * sq, y + h - 4.5, sq, 3.5);
            }
        }
        ctx.restore();

        if (this.type === 'sticky' || this.type === 'mini_sticky') { // goterones
            ctx.fillStyle = shade(col, -0.1);
            const d = (Math.sin(t / 420 + x) + 1) / 2;
            [[0.22, 3 + d * 4], [0.58, 2 + (1 - d) * 4], [0.84, 2 + d * 3]].forEach(([fx, len]) => {
                const dx = x + pw * fx;
                ctx.fillRect(dx - 1.5, y + h - 2, 3, len); ctx.beginPath(); ctx.arc(dx, y + h + len - 1, 2.6, 0, Math.PI * 2); ctx.fill();
            });
        }
        if (this.type === 'spring') { // muelle
            const cx = x + pw / 2;
            ctx.strokeStyle = '#eafffb'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
            ctx.shadowBlur = 8; ctx.shadowColor = col;
            ctx.beginPath(); ctx.moveTo(cx - 9, y);
            for (let i = 1; i <= 5; i++) ctx.lineTo(cx + (i % 2 ? 9 : -9), y - i * 2.6);
            ctx.stroke();
            ctx.fillStyle = '#eafffb'; roundRectPath(ctx, cx - 12, y - 16, 24, 3.5, 1.5); ctx.fill();
            ctx.shadowBlur = 0;
        }
        if (this.type === 'sling') { // horquilla de tirachinas con su goma
            ctx.strokeStyle = '#ffd08a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x + 6, y); ctx.lineTo(x + 6, y - 16);
            ctx.moveTo(x + pw - 6, y); ctx.lineTo(x + pw - 6, y - 16);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(255,159,28,0.85)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(x + 6, y - 16); ctx.quadraticCurveTo(x + pw / 2, y - 10, x + pw - 6, y - 16); ctx.stroke();
        }
        if (this.rayT > 0) { // el rayo de un dron la está destruyendo
            ctx.fillStyle = 'rgba(255,60,80,' + (0.2 + 0.55 * this.rayT) + ')';
            roundRectPath(ctx, x, y, pw, h, 6); ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,' + (0.3 + 0.5 * this.rayT) + ')'; ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x + pw * 0.3, y); ctx.lineTo(x + pw * 0.38, y + h * 0.6); ctx.lineTo(x + pw * 0.3, y + h);
            if (this.rayT > 0.5) { ctx.moveTo(x + pw * 0.7, y); ctx.lineTo(x + pw * 0.62, y + h * 0.5); ctx.lineTo(x + pw * 0.7, y + h); }
            ctx.stroke();
        }
        if (this.type === 'shield') { // escudo convertido en plataforma
            ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
            ctx.fillText('🛡️', x + pw / 2, y + 15);
        }
        if (this.isGoal) this.drawFlag();
        ctx.restore();
    }

    getColor() {
        if (this.isGoal) return THEME.platformGoal;
        switch (this.type) {
            case 'vanishing': return THEME.platformVanishing;
            case 'moving': return THEME.platformMoving;
            case 'spring': return THEME.platformSpring;
            case 'oscillating': return THEME.platformOscillating;
            case 'flash': return THEME.platformFlash;
            case 'mini_sticky': return THEME.platformMini;
            case 'fragile': return THEME.platformFragile;
            case 'ice': return THEME.platformIce;
            case 'sticky': return THEME.platformSticky;
            case 'sling': return '#ff9f1c';
            case 'shield': return THEME.shieldPlat;
            default: return THEME.platformBright;
        }
    }

    drawFlag() {
        const fx = this.x + this.w - 15, fy = this.y - 32;
        ctx.fillStyle = '#f4f6ff'; ctx.fillRect(fx, fy, 2.5, 32);
        ctx.beginPath(); ctx.arc(fx + 1.25, fy, 2.6, 0, Math.PI * 2); ctx.fill();
        const tt = performance.now() / 200;
        ctx.save();
        ctx.shadowBlur = 10; ctx.shadowColor = 'rgba(255,92,138,0.8)';
        ctx.fillStyle = '#ff5c8a';
        ctx.beginPath(); ctx.moveTo(fx + 2.5, fy + 1);
        ctx.quadraticCurveTo(fx + 11, fy + 1 + Math.sin(tt) * 3, fx + 21, fy + 6 + Math.sin(tt + 1) * 3);
        ctx.quadraticCurveTo(fx + 11, fy + 11 + Math.sin(tt + 0.5) * 3, fx + 2.5, fy + 15);
        ctx.closePath(); ctx.fill();
        ctx.restore();
    }

    update() {
        if (this.isBroken) return false;

        // Movimiento Horizontal (Moving)
        if (this.type === 'moving') {
            if (this.isPaused) {
                if (gameTime > this.pauseTimer) this.isPaused = false;
            } else {
                this.x += this.vx;
                if (this.x < 0 || this.x + this.w > width) {
                    this.vx *= -1;
                    this.x = this.x < 0 ? 0 : width - this.w;
                    this.isPaused = true;
                    this.pauseTimer = gameTime + 2000;
                }
            }
        }

        // Movimiento Vertical (Oscillating)
        if (this.type === 'oscillating') {
            this.y += this.vy;
            this.oscOffset += this.vy;
            if (Math.abs(this.oscOffset) > 50) {
                this.vy *= -1;
            }
        }

        // Visibilidad (Flash)
        if (this.type === 'flash') {
            if (this.flashTime === undefined) this.flashTime = gameTime;
            if (gameTime - this.flashTime > 2000) {
                this.isVisible = !this.isVisible;
                this.flashTime = gameTime;
            }
        }

        // Desvanecimiento / Rotura...
        if ((this.type === 'vanishing' || this.type === 'fragile' || this.type === 'temp_full') && this.vanishingStarted) {
            const elapsed = gameTime - this.startTime;
            const duration = this.type === 'vanishing' ? 5000 : (this.type === 'temp_full' ? 8000 : 1500);
            this.alpha = Math.max(0, 1 - (elapsed / duration));
            if (elapsed >= duration) {
                this.isBroken = true;
                if (this.type === 'fragile') createExplosion(this.x + this.w / 2, this.y, 0.5);
                return false;
            }
        }
        return true;
    }
}

// Drones: como las plataformas móviles, patrullan en horizontal o en vertical. A veces disparan un
// rayo a la plataforma que tienen debajo y la destruyen en 5 s. NO matan: ni al tocarlos ni con el rayo
// (el rayo solo elimina plataformas). Si la caja cae sobre el dron lo destruye y rebota hacia arriba,
// hacia la siguiente plataforma.
const DRONE_RAY_SECONDS = 5;   // tiempo que tarda el rayo en destruir la plataforma
const DRONE_VERT_RANGE = 45;   // recorrido (± px) de un dron vertical
const DRONE_SHOOT_CHANCE = 0.5; // probabilidad de disparar cada vez que se "carga"

class Obstacle {
    constructor(o) {
        this.w = 40; this.h = 20;
        this.color = THEME.obstacle;
        this.dead = false;
        if (o && o.hover) { // dron "plataforma": horizontal o vertical, puede disparar rayo
            this.hover = true; this.axis = o.axis; this.x = o.x; this.y = o.y; this.off = 0;
            const spd = Math.min(3.5, 1.5 + level * 0.05);
            this.vx = o.axis === 'h' ? o.dir * spd : 0;
            this.vy = o.axis === 'v' ? o.dir * spd * 0.7 : 0;
            this.rnd = mulberry32(o.seed >>> 0);          // decisiones deterministas (misma fase diaria para todos)
            this.state = 'patrol'; this.cool = 1.5 + this.rnd() * 2.5; this.fireT = 0; this.target = null;
            return;
        }
        if (o && o.patrol) { // dron de patrulla (fases del editor): va y viene sin salir nunca
            this.patrol = true; this.x = o.x; this.y = o.y; this.vx = o.dir * Math.min(5, 2.2 + level * 0.15);
            return;
        }
        const rSide = (o && o.rSide !== undefined) ? o.rSide : Math.random();
        const rY = (o && o.rY !== undefined) ? o.rY : Math.random();
        this.x = rSide > 0.5 ? -this.w : width;
        this.y = player.y - 300 - rY * 400;
        this.vx = (this.x < 0 ? 1 : -1) * Math.min(6, 2 + level * 0.2);
    }
    // Plataforma que tiene justo debajo (la más cercana), sin contar la meta
    platformBelow() {
        const cx = this.x + this.w / 2;
        let best = null;
        platforms.forEach((p) => {
            if (p.isBroken || p.isGoal || p.type === 'temp_full' || p.type === 'shield' || (p.type === 'flash' && !p.isVisible)) return;
            if (p === player.currentPlatform && player.onGround) return; // nunca la plataforma donde está la caja
            if (p.y > this.y + this.h && cx >= p.x && cx <= p.x + p.w && (!best || p.y < best.y)) best = p;
        });
        return best;
    }
    endFire() {
        if (this.target) this.target.rayT = 0;
        this.state = 'patrol'; this.target = null; this.fireT = 0;
    }
    kill() { // destruido por la caja: el rayo se corta y la plataforma se salva
        if (this.target) this.target.rayT = 0;
        this.target = null; this.dead = true;
    }
    update() {
        if (this.dead) return false;
        if (this.hover) {
            const dt = frameDtMs / 1000;
            if (this.state === 'fire') {
                const t = this.target, cx = this.x + this.w / 2;
                if (!t || t.isBroken || cx < t.x || cx > t.x + t.w || (t === player.currentPlatform && player.onGround)) this.endFire(); // objetivo perdido o la caja está encima
                else {
                    this.fireT += dt;
                    t.rayT = Math.min(1, this.fireT / DRONE_RAY_SECONDS);
                    if (this.fireT >= DRONE_RAY_SECONDS) {
                        t.isBroken = true; t.rayT = 0;
                        createExplosion(t.x + t.w / 2, t.y, 1.4);
                        sfx('ray_break');
                        this.endFire();
                    }
                }
            } else {
                if (this.axis === 'h') {
                    this.x += this.vx;
                    if (this.x < 0) { this.x = 0; this.vx = Math.abs(this.vx); }
                    else if (this.x + this.w > width) { this.x = width - this.w; this.vx = -Math.abs(this.vx); }
                } else {
                    this.y += this.vy; this.off += this.vy;
                    if (Math.abs(this.off) > DRONE_VERT_RANGE) this.vy *= -1;
                }
                this.cool -= dt;
                if (this.cool <= 0) {
                    this.cool = 2 + this.rnd() * 3;
                    if (this.rnd() < DRONE_SHOOT_CHANCE) {
                        const t = this.platformBelow();
                        if (t) { this.state = 'fire'; this.target = t; this.fireT = 0; if (this.y > -20 && this.y < height) sfx('ray'); }
                    }
                }
            }
            return this.y < height + 250;
        }
        this.x += this.vx;
        if (this.patrol) {
            if (this.x < 0) { this.x = 0; this.vx = Math.abs(this.vx); }
            else if (this.x + this.w > width) { this.x = width - this.w; this.vx = -Math.abs(this.vx); }
            return true;
        }
        return (this.x > -100 && this.x < width + 100);
    }
    draw() {
        ctx.save();
        if (this.hover && this.state === 'fire' && this.target) { // rayo hacia la plataforma
            const bx = this.x + this.w / 2, by = this.y + this.h, prog = this.fireT / DRONE_RAY_SECONDS;
            ctx.globalAlpha = 0.55 + 0.35 * Math.sin(performance.now() / 60);
            ctx.strokeStyle = '#ff3b2f'; ctx.lineWidth = 2 + prog * 5;
            ctx.shadowBlur = 16; ctx.shadowColor = '#ff3b2f';
            ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, this.target.y); ctx.stroke();
            ctx.globalAlpha = 1;
        }
        const dg = ctx.createLinearGradient(0, this.y, 0, this.y + this.h);
        dg.addColorStop(0, '#5a5f86'); dg.addColorStop(1, '#22243f');
        ctx.shadowBlur = 14; ctx.shadowColor = 'rgba(255,92,138,0.55)';
        ctx.fillStyle = dg; roundRectPath(ctx, this.x, this.y, this.w, this.h, 7); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.18)'; roundRectPath(ctx, this.x + 4, this.y + 2, this.w - 8, 3, 1.5); ctx.fill();
        // visor con ojos rojos
        ctx.fillStyle = '#0b0a1c'; roundRectPath(ctx, this.x + 4, this.y + 5, this.w - 8, 8, 4); ctx.fill();
        ctx.fillStyle = '#ff5c8a'; ctx.shadowBlur = 8; ctx.shadowColor = '#ff5c8a';
        ctx.beginPath(); ctx.arc(this.x + 11, this.y + 9, 2.4, 0, Math.PI * 2); ctx.arc(this.x + this.w - 11, this.y + 9, 2.4, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        if (this.hover) { // hélices y luz: roja parpadeante mientras dispara
            ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
            const sp = Math.sin(performance.now() / 40) * 6;
            ctx.beginPath();
            ctx.moveTo(this.x + 4 - sp, this.y - 3); ctx.lineTo(this.x + 4 + sp, this.y - 3);
            ctx.moveTo(this.x + this.w - 4 - sp, this.y - 3); ctx.lineTo(this.x + this.w - 4 + sp, this.y - 3);
            ctx.stroke();
            ctx.fillStyle = this.state === 'fire' && Math.floor(performance.now() / 100) % 2 ? '#fff' : '#ffd23f';
            ctx.fillRect(this.x + this.w / 2 - 2, this.y + this.h - 4, 4, 4);
        }
        ctx.restore();
    }
}

class PowerUp {
    constructor(x, y, type) {
        this.x = x; this.y = y; this.type = type; // 'shield' | 'rocket'
        this.size = 28;
        this.bob = 0;
    }
    update() {
        this.bob = Math.sin(performance.now() / 300) * 5;
        const dx = (this.x + this.size / 2) - (player.x + player.w / 2);
        const dy = (this.y + this.size / 2 + this.bob) - (player.y + player.h / 2);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 32) {
            sfx('item');
            if (this.type === 'shield') { hasShield = true; showFeedback('🛡️ ¡ESCUDO ACTIVADO!'); }
            if (this.type === 'rocket') { rocketJumps = ROCKET_JUMPS; showFeedback('🚀 ¡COHETE! Tus próximos ' + ROCKET_JUMPS + ' saltos se saltan una plataforma'); }
            return false;
        }
        return true;
    }
    draw() {
        const cx = this.x + this.size / 2, cy = this.y + this.size / 2 + this.bob, r = this.size / 2;
        const col = this.type === 'shield' ? THEME.shield : THEME.rocket;
        ctx.save();
        ctx.shadowBlur = 18; ctx.shadowColor = col;
        ctx.fillStyle = this.type === 'shield' ? 'rgba(0,255,100,0.18)' : 'rgba(47,139,255,0.2)';
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = col; ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
        ctx.fillText(this.type === 'shield' ? '🛡️' : '🚀', cx, cy + 1);
        ctx.restore();
    }
}

class BlackHole {
    constructor(x, y, radius) {
        this.x = x; this.y = y; this.radius = radius || (30 + Math.random() * 20);
    }
    draw() {
        ctx.save();
        const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius);
        grad.addColorStop(0, '#000');
        grad.addColorStop(0.7, '#6600ff');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();

        // Espiral
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 20; i++) {
            const r = (i / 20) * this.radius;
            const a = (Date.now() / 500) + (i / 2);
            ctx.lineTo(this.x + Math.cos(a) * r, this.y + Math.sin(a) * r);
        }
        ctx.stroke();
        ctx.restore();
    }
}

class Chest {
    constructor(platform, t) {
        this.p = platform; this.t = t; // t: posición relativa sobre la plataforma (0..1)
        this.w = 26; this.h = 20;
        this.opened = false; this.age = 0;
    }
    get x() { return this.p.x + this.t * Math.max(0, this.p.w - this.w); }
    get y() { return this.p.y - this.h; }
    update() {
        if (this.p.isBroken) return false;
        if (this.opened && ++this.age > 50) return false;
        return true;
    }
    draw() {
        const x = this.x, y = this.y, w = this.w, h = this.h;
        ctx.save();
        ctx.globalAlpha = (this.p.alpha === undefined ? 1 : this.p.alpha) * (this.opened ? Math.max(0, 1 - this.age / 50) : 1);
        ctx.shadowBlur = 12; ctx.shadowColor = '#ffd700';
        if (this.opened) { // destello dorado saliendo del cofre
            ctx.fillStyle = 'rgba(255, 215, 0, 0.35)';
            ctx.fillRect(x + 4, y - 22, w - 8, 26);
        }
        ctx.fillStyle = '#8a5a2b'; ctx.fillRect(x, y + 8, w, h - 8);               // cuerpo
        const lift = this.opened ? Math.min(10, this.age) : 0;
        ctx.fillStyle = '#b07a3a'; ctx.fillRect(x - 1, y - lift, w + 2, 9);          // tapa
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(x + w / 2 - 3, y + 5 - (this.opened ? 0 : 0), 6, 7);            // cerradura
        ctx.fillRect(x, y + 8, w, 2);                                                // banda dorada
        ctx.restore();
    }
}

// Tragaperras: los huecos libres del inventario giran y se van parando uno a uno
function openChest(c) {
    const free = MAX_INV - inventory.length - reels.length;
    if (free <= 0) { showFeedback("¡INVENTARIO LLENO!"); return; }
    c.opened = true; c.age = 0;
    createExplosion(c.x + c.w / 2, c.y, 1.0);
    showFeedback("🎁 ¡COFRE ABIERTO!");
    sfx('chest');
    const now = performance.now();
    const base = reels.length ? reels[reels.length - 1].stopAt : now + 500;
    for (let i = 0; i < free; i++) {
        reels.push({ final: ITEM_POOL[Math.floor(Math.random() * ITEM_POOL.length)], stopAt: base + (i + 1) * 450 });
    }
    if (!reelTimer) reelTimer = setInterval(tickReels, 70);
    updateInventoryUI();
}
function tickReels() {
    const now = performance.now();
    while (reels.length && now >= reels[0].stopAt) {
        inventory.push(reels.shift().final);
        sfx('reel');
        const el = document.getElementById(`slot-${inventory.length - 1}`);
        if (el) { el.classList.remove('landed'); void el.offsetWidth; el.classList.add('landed'); }
    }
    if (!reels.length) { clearInterval(reelTimer); reelTimer = null; }
    updateInventoryUI();
}
function cancelReels() {
    if (reelTimer) clearInterval(reelTimer);
    reelTimer = null; reels = [];
}

function initPlatforms(startLevel = 1) {
    platforms = [];
    props = [];
    obstacles = [];
    powerups = [];
    blackHoles = [];
    particles = [];
    aim.cancel(); cancelSling();
    originY = null; player.rocket = false;
    level = Math.max(1, startLevel);
    runFirstLevel = level; rubberBoostUsed = false; gravBoostUsed = false; gravFlipT = 0; bombRocket = false;
    boxType = (modeCfg && modeCfg.box) || chosenBox; if (boxType === 'mystery') pickMysteryBehavior(); // la caja elegida vale para los 3 primeros niveles
    cameraScroll = 0;
    platformsInLevel = levelPlatformCount();
    platformsReached = 0; totalPlatformGlobalCount = 0;
    combo = 0; rollEnvironment(false);
    hasShield = false; rocketJumps = 0; bombDying = 0;
    cancelReels(); inventory = []; chests = []; tombstones = []; usedTombPhrases.clear(); lastPlatIdx = 0; resetRescue(); armBomb(); updateInventoryUI();
    ballSpeedFactor = 1.0; greenPowerActive = 0; platformItemActive = false; bombActive = false;
    if (clockTimeoutId) { clearTimeout(clockTimeoutId); clockTimeoutId = null; }
    clockUntil = 0;

    setLevelHUD();
    updateHeightDisplay();
    updateComboDisplay();

    const startCx = width / 2 + (precisionSystem.side === 'left' ? 30 : 0);
    platforms.push(new Platform(startCx - 50, height - 150, 100, 20));
    platforms[0].idx = 0;
    resetLevelHeight();
    player.x = startCx - player.w / 2;
    player.y = height - 150 - player.h;
    player.vx = 0;
    player.vy = 0;
    player.rotation = 0;
    player.angularVelocity = 0;
    player.onGround = true;
    player.currentPlatform = platforms[0];
    player.bouncesLeft = 2; player.squash = 0;
    placeOnPlatform();
    setupLava(false);
    populateLevel();
}

function spawnNextPlatform(forceGoal = false) {
    const R = genRng;
    const last = platforms[platforms.length - 1];
    const marginY = 110 + R() * 90;
    const nextY = last.y - marginY;
    const nextW = Math.max(50, 80 + R() * 40 - (level * 0.5));
    // Deja libre el lado donde está la barra de precisión
    const nextX = (precisionSystem.side === 'left' ? 50 : 30) + R() * (width - nextW - 80);
    // Tiradas siempre en el mismo orden (se usen o no): con la misma semilla el nivel sale idéntico
    const rType = R(), rIce = R(), rDirX = R(), rDirY = R(), rObs = R(), rObsSide = R(), rObsY = R(),
        rPow = R(), rPowType = R(), rBH = R(), rBHx = R(), rBHr = R(), rProp = R(), rPw = R(), rPh = R(), rPx = R(), rHue = R(), rChest = R(), rChestT = R(), rSling = R();

    totalPlatformGlobalCount++;

    // DETERMINAR TIPO DE PLATAFORMA
    let type = 'normal';
    if (!forceGoal) {
        if (level >= 6 && totalPlatformGlobalCount % 10 === 0) type = 'vanishing';
        else if (level >= 27 && rType < 0.06) type = 'flash';
        else if (level >= 22 && rType < 0.14) type = 'fragile';
        else if (level >= 16 && rType < 0.22) type = 'mini_sticky';
        else if (level >= 12 && rType < 0.32) type = (rIce > 0.5 ? 'ice' : 'sticky');
        else if (level >= 6 && rType < 0.40) type = 'spring';
        else if (level >= 8 && rType < 0.55) type = 'moving';
    }

    // Plataforma tirachinas (nivel 10+): solo sustituye a una plataforma normal
    if (!forceGoal && type === 'normal' && level >= 10 && rSling < 0.1) type = 'sling';

    const platform = new Platform(nextX, nextY, nextW, 20, forceGoal, type, rDirX > 0.5, rDirY > 0.5);
    platforms.push(platform);
    platform.idx = platforms.length - 1;

    // Cofre (se abre al aterrizar en esta plataforma)
    if (!forceGoal && type !== 'flash' && rChest < CHEST_CHANCE) chests.push(new Chest(platform, 0.12 + rChestT * 0.76));

    // Obstáculos (Nivel 15+)
    if (level >= 15 && rObs < 0.3) {
        const axis = rObsSide > 0.5 ? 'h' : 'v', dir = rObsY > 0.5 ? 1 : -1;
        const seed = Math.floor((rObsY * 0.5 + rObsSide * 0.37 + rObs) * 4294967296) >>> 0;
        if (axis === 'h') { // patrulla todo el ancho, sobrevolando la nueva plataforma
            obstacles.push(new Obstacle({ hover: true, axis, dir, seed, x: Math.max(0, Math.min(width - 40, nextX + nextW / 2 - 20)), y: nextY - 105 - ((rObsSide * 10) % 1) * 45 }));
        } else {            // sube y baja sobre un punto de la plataforma
            const dx = nextX + nextW * (0.2 + 0.6 * ((rObsY * 10) % 1)) - 20;
            obstacles.push(new Obstacle({ hover: true, axis, dir, seed, x: Math.max(0, Math.min(width - 40, dx)), y: nextY - 135 }));
        }
    }

    // Power-ups (Nivel 18+)
    if (level >= 18 && rPow < 0.15 && !hasShield && rocketJumps === 0) {
        powerups.push(new PowerUp(nextX + nextW / 2 - 14, nextY - 56, rPowType > 0.5 ? 'shield' : 'rocket'));
    }

    // Agujeros Negros (Nivel 25+)
    if (level >= 25 && rBH < 0.1) blackHoles.push(new BlackHole(rBHx * width, nextY - 100, 30 + rBHr * 20));

    // Props (Cajas)
    if (!forceGoal && rProp < 0.3) {
        const propW = 15 + rPw * 20;
        const propH = 15 + rPh * 20;
        const propX = nextX + rPx * (nextW - propW);
        props.push(new Prop(propX, nextY - propH, propW, propH, `hsl(${200 + rHue * 30}, 80%, 60%)`));
    }
}

function nextLevel() {
    // Fin de la fase (diaria / creada): último nivel superado
    if (modeCfg && level >= modeCfg.last) { finishRun(true); return; }

    level++;
    sfx('level_up');
    addFlash(0.16, '255,207,74');
    setLevelHUD();
    rubberBoostUsed = false; gravBoostUsed = false; gravFlipT = 0;
    // Cada 3 niveles la caja cambia al azar (la bomba lo hace al explotar)
    const wasBombBox = boxKind() === 'bomb';
    const played = level - runFirstLevel;
    let boxMsg = '';
    if (!wasBombBox && played >= BOX_SWAP_EVERY && played % BOX_SWAP_EVERY === 0) {
        setActiveBox(rollRandomBox(boxType));
        boxMsg = '\n📦 Nueva caja: ' + boxLabel(boxType);
    }

    // Configuración ambiental según nivel (viento / gravedad; en fases creadas viene del editor)
    rollEnvironment(true);

    platformsInLevel = levelPlatformCount();
    platformsReached = 0;
    const lavaNext = isLavaLevel();
    showFeedback("¡NIVEL " + hudLevel() + "!" + (windForce !== 0 ? "\n¡CUIDADO CON EL VIENTO!" : "") + (gravityFactor < 1 ? "\n¡GRAVEDAD BAJA!" : "") +
        (lavaNext ? "\n🌋 ¡LAVA! Sube cada " + LAVA_RISE_EVERY + " s: no te quedes quieto" : "") +
        (darkLevel ? "\n🌫️ ¡NIEBLA! Solo ves a tu alrededor" : "") +
        (wasBombBox && boxType !== 'mystery' ? "\n💣 ¡Bomba desactivada!" : "") + boxMsg);

    // Guardado automático cada 5 niveles (checkpoint) — solo en la partida normal
    if (gameMode === 'normal' && level % 5 === 0 && window.BJFirebase && window.BJFirebase.isSignedIn() &&
        !(savedGameData && savedGameData.level >= level)) { // nunca se pisa un progreso más avanzado
        window.BJFirebase.saveProgress(level);
        savedGameData = { level };
        updateStartScreenUI();
    }

    const current = player.currentPlatform;
    platforms = [current];
    current.idx = 0; lastPlatIdx = 0; tombstones = [];
    rescue.usedThisLevel = false; armBomb(); setupLava(true);
    resetLevelHeight();
    props = [];
    obstacles = [];
    powerups = [];
    chests = [];
    // Mantener agujeros negros si están cerca (en fases creadas cada nivel trae los suyos)
    blackHoles = gameMode === 'custom' ? [] : blackHoles.filter(bh => Math.abs(bh.y - player.y) < height);

    populateLevel();
}

// --- UTILS ---
function resize() {
    const oldW = width, oldH = height;
    width = canvas.width = canvas.offsetWidth;
    height = canvas.height = canvas.offsetHeight;
    precisionSystem.init();
    if (oldW && oldH && platforms.length && (oldW !== width || oldH !== height)) rescaleWorld(width / oldW, height - oldH);
}
// Girar el móvil / cambiar la ventana: escala en horizontal y mantiene todo pegado a la parte de abajo
function rescaleWorld(kx, dy) {
    const fit = (o, w) => { o.x = Math.max(0, Math.min(width - (w || 0), o.x * kx)); o.y += dy; };
    platforms.forEach((p) => fit(p, p.type === 'temp_full' ? 0 : p.w));
    props.forEach((o) => fit(o, o.w));
    obstacles.forEach((o) => fit(o, o.w));
    powerups.forEach((o) => fit(o, o.size));
    blackHoles.forEach((o) => { o.x *= kx; o.y += dy; });
    particles.forEach((o) => { o.x *= kx; o.y += dy; });
    fit(player, player.w);
    if (player.prevY !== undefined) player.prevY += dy;
    lava.y += dy; lava.targetY += dy;
    if (originY !== null) originY += dy;
    if (rescue.rise) { rescue.rise.x0 *= kx; rescue.rise.y0 += dy; }
    if (rescue.btn) { rescue.btn.x *= kx; rescue.btn.y += dy; }
}

function showFeedback(text) {
    let color = "#ffffff";
    if (text.includes("PERFECT")) color = "#5dffc9";
    else if (text.includes("GOOD")) color = "#ffc35c";
    else if (text.includes("POOR") || text.includes("💀") || text.includes("BOOM")) color = "#ff6b8f";
    else if (text.includes("EXTRA")) color = "#3ef0ff";
    else if (text.includes("NIVEL")) color = "#ffcf4a";
    const lines = String(text).split('\n').map((l) => l.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])));
    msgText.innerHTML = '<span class="msg-main">' + lines[0] + '</span>' + lines.slice(1).map((l) => '<span class="msg-sub">' + l + '</span>').join('');
    msgText.style.color = color;
    msgOverlay.classList.remove('hidden');
    msgText.style.animation = 'none';
    msgText.offsetHeight;
    msgText.style.animation = null;
}

function createExplosion(x, y, multiplier) {
    const amount = 5 + multiplier * 25;
    const pal = multiplier > 0.9 ? ['#5dffc9', '#3ef0ff', '#ffffff'] : (multiplier > 0.6 ? ['#ffc35c', '#ffe08a', '#ffffff'] : ['#ff6b8f', '#ff9a6b']);
    for (let i = 0; i < amount; i++) {
        const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 7.5;
        particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1.0, decay: 0.018 + Math.random() * 0.014,
            size: 2.5 + Math.random() * 3.5, color: pal[(Math.random() * pal.length) | 0], drag: 0.95 });
    }
    if (multiplier >= 1.2) addShake(multiplier * 3.2);
}

// Calcula los parámetros del salto (sin ejecutarlo). Se calcula UNA vez para que
// el azar del tier POOR no cambie mientras el jugador apunta.
function computeJump(precision) {
    const { multiplier, tier } = precision;
    if (!player.onGround || multiplier <= 0) return null;
    const candidates = platforms.filter(p => p.y < player.y && !p.isBroken && !(p.type === 'flash' && !p.isVisible))
        .sort((a, b) => b.y - a.y);
    if (candidates.length === 0) return null;
    let target = candidates[0], rocket = false;
    // Cohete: se salta la plataforma más cercana y va a la siguiente que sea segura
    if (rocketJumps > 0) {
        const far = candidates.slice(1).find(isSafePlatform);
        if (far) { target = far; rocket = true; }
    }
    const distY = player.y - target.y + player.h;

    const targetMultiplier = rocket ? 1.08 : ((tier === "PERFECT") ? 1.08 : (tier === "GOOD" ? 1.45 : (Math.random() > 0.5 ? 2.0 : 0.4)));
    const g = effGrav(); // gravedad propia de la caja (la ligera cae más despacio)
    const vy = -Math.sqrt(2 * g * distY) * targetMultiplier;

    const tRise = Math.abs(vy / g);
    const hMax = (vy * vy) / (2 * g);
    const hFall = hMax - distY;
    const tFall = Math.sqrt(Math.max(0, 2 * hFall / g));
    const totalT = tRise + tFall;

    // Si es móvil, se apunta a donde estará al llegar
    const dx = (predictPlatX(target, totalT) + target.w / 2) - (player.x + player.w / 2);
    return { vy, vxBase: dx / totalT, totalT, target, tier, rocket };
}

function launchPlayer(j, vx) {
    sfx('jump', { tier: j.tier });
    if (j.rocket) {
        rocketJumps = Math.max(0, rocketJumps - 1);
        sfx('rocket');
        showFeedback('🚀 ¡SALTO COHETE!' + (rocketJumps ? ' (quedan ' + rocketJumps + ')' : ''));
    }
    player.vy = j.vy;
    player.vx = vx;
    player.onGround = false;
    player.bouncesLeft = 2;
    player.angularVelocity = (j.tier === "PERFECT" ? 0.15 : (j.tier === "GOOD" ? 0.35 : 0.6));
    if (j.rocket) { player.rocket = true; player.straightBounce = true; player.angularVelocity = 0.1; } // sin viento, con estela
}

function handleJump(precision) {
    const j = computeJump(precision);
    if (!j) return;
    launchPlayer(j, j.vxBase);
}

// Simula el salto con la MISMA física del juego (gravedad + viento + paredes + plataformas)
function simulateJump(j, vx0) {
    let x = player.x, y = player.y, vx = vx0, vy = j.vy;
    const pts = [];
    let tTarget = null, landing = null;
    for (let step = 1; step <= 500; step++) {
        const prevBottom = y + player.h, prevTop = y;
        vx += effWind();
        vy += effGrav() * gravityFactor;
        x += vx; y += vy;
        if (x < 0) { x = 0; if (boxKind() === 'rubber') vx = Math.abs(vx) * 0.85; }
        if (x + player.w > width) { x = width - player.w; if (boxKind() === 'rubber') vx = -Math.abs(vx) * 0.85; }
        const bottom = y + player.h;

        if (vy >= 0 && tTarget === null && prevBottom < j.target.y && bottom >= j.target.y) tTarget = step;
        if (step % 2 === 0) pts.push({ x: x + player.w / 2, y: y + player.h / 2 });

        if (vy >= 0) {
            for (const p of platforms) {
                if (p.type === 'flash' && !p.isVisible) continue;
                const px = predictPlatX(p, step), pw = p.type === 'temp_full' ? width : p.w;
                if (x + player.w > px && x < px + pw && bottom >= p.y && (bottom <= p.y + p.h + 10 || prevBottom <= p.y + 10)) {
                    landing = { x: x + player.w / 2, y: p.y, onTarget: p === j.target };
                    pts.push({ x: landing.x, y: p.y - player.h / 2 });
                    break;
                }
            }
            if (landing) break;
        }
        if (y > height + 60) break;
    }
    return { pts, landing, tTarget };
}

// --- MEDIDOR DE ÁNGULO (fases de viento) ---
// Tras acertar la precisión, el mundo se congela y una aguja barre un arco alrededor
// del cubo. Una línea punteada muestra dónde caería el salto (viento incluido).
// Segundo toque = fijar el ángulo y saltar.
const AIM_ARC = 55 * Math.PI / 180; // media apertura visual del arco
const aim = {
    active: false, s: 0, phase: 0, dir: 1, last: 0, startedAt: 0,
    jump: null, range: 1, sim: null, period: 1.8,

    start(precision) {
        const j = computeJump(precision);
        if (!j || !(j.totalT > 0)) return false;
        const base = simulateJump(j, j.vxBase);
        const T = base.tTarget || j.totalT;
        // Rango lateral: cubre con margen (x1.6) lo necesario para anular el viento máximo
        // y como mínimo ~2.2x la semi-ventana de acierto, para que el ajuste exija precisión
        const hitHalfVx = ((j.target.w + player.w) / 2) / T;
        this.range = Math.max(0.8, 0.5 * Math.abs(effWind()) * T * 1.6, hitHalfVx * 2.2);
        this.jump = j;
        this.period = Math.max(1.2, 2.0 - (level - 12) * 0.03); // más rápido al subir de nivel
        this.dir = Math.random() < 0.5 ? -1 : 1;
        this.phase = 0; this.s = 0;
        this.last = this.startedAt = performance.now();
        this.sim = base;
        this.active = true;
        return true;
    },

    cancel() { this.active = false; this.jump = null; this.sim = null; },

    vx() { return this.jump.vxBase + this.s * this.range; },

    update() {
        const now = performance.now();
        const dt = Math.min(50, now - this.last) / 1000;
        this.last = now;
        this.phase += dt * Math.PI * 2 / this.period;
        this.s = this.dir * Math.sin(this.phase);
        this.sim = simulateJump(this.jump, this.vx());
    },

    lock() {
        if (!this.active || performance.now() - this.startedAt < 180) return; // evita doble toque accidental
        launchPlayer(this.jump, this.vx());
        createExplosion(player.x + player.w / 2, player.y + player.h, 0.6);
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) { } }
        this.cancel();
    },

    // Corrección respecto a apuntar directo a la plataforma, en grados reales
    deltaDeg() {
        const vyAbs = Math.abs(this.jump.vy) || 1;
        return (Math.atan(this.vx() / vyAbs) - Math.atan(this.jump.vxBase / vyAbs)) * 180 / Math.PI;
    },

    draw() {
        if (!this.active || !this.sim) return;
        const cx = player.x + player.w / 2, cy = player.y + player.h / 2;
        const R = 66;
        const land = this.sim.landing;
        const col = land ? (land.onTarget ? '#00ff64' : '#ffae00') : '#ff3300';
        const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 120);

        ctx.save();

        // Trayectoria punteada (se desvanece con la distancia)
        const pts = this.sim.pts;
        for (let i = 0; i < pts.length; i++) {
            ctx.globalAlpha = Math.max(0.15, 0.9 - (i / pts.length) * 0.7);
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, 2.2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;

        // Marcador de aterrizaje
        if (land) {
            ctx.strokeStyle = col; ctx.lineWidth = 2;
            ctx.shadowBlur = 12; ctx.shadowColor = col;
            const ly = land.y - player.h;
            ctx.strokeRect(land.x - player.w / 2, ly, player.w, player.h);
            ctx.globalAlpha = 0.15 * pulse + 0.1; ctx.fillStyle = col;
            ctx.fillRect(land.x - player.w / 2, ly, player.w, player.h);
            ctx.globalAlpha = 1; ctx.shadowBlur = 0;
        } else if (pts.length) {
            const e = pts[pts.length - 1];
            ctx.strokeStyle = col; ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(e.x - 8, e.y - 8); ctx.lineTo(e.x + 8, e.y + 8);
            ctx.moveTo(e.x + 8, e.y - 8); ctx.lineTo(e.x - 8, e.y + 8);
            ctx.stroke();
        }

        // Arco del medidor
        const a0 = -Math.PI / 2 - AIM_ARC, a1 = -Math.PI / 2 + AIM_ARC;
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(0, 242, 255, 0.18)'; ctx.lineWidth = 8;
        ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
        ctx.strokeStyle = 'rgba(0, 242, 255, 0.55)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, R + 5, a0, a1); ctx.stroke();

        // Marcas: centro (apuntar directo) y cada 1/4 del recorrido
        for (let k = -4; k <= 4; k++) {
            const a = -Math.PI / 2 + (k / 4) * AIM_ARC;
            const inner = R - (k === 0 ? 10 : 5), outer = R + (k === 0 ? 12 : 8);
            ctx.strokeStyle = k === 0 ? '#ffffff' : 'rgba(255,255,255,0.45)';
            ctx.lineWidth = k === 0 ? 2.5 : 1.5;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
            ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
            ctx.stroke();
        }

        // Aguja
        const na = -Math.PI / 2 + this.s * AIM_ARC;
        const nx = cx + Math.cos(na) * (R + 4), ny = cy + Math.sin(na) * (R + 4);
        ctx.shadowBlur = 16; ctx.shadowColor = col;
        ctx.strokeStyle = col; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(na) * 22, cy + Math.sin(na) * 22);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(nx, ny, 5, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        // Textos de ayuda (HUD superior, bajo el viento)
        ctx.textAlign = 'center';
        ctx.fillStyle = `rgba(255,255,255,${0.55 + 0.4 * pulse})`;
        ctx.font = '600 12px "Chakra Petch", Outfit, sans-serif';
        ctx.fillText('TOCA PARA LANZAR', width / 2, 176);
        const d = this.deltaDeg();
        ctx.fillStyle = col;
        ctx.font = 'bold 14px Outfit, Inter, sans-serif';
        const txt = Math.abs(d) < 0.3 ? '0.0°' : (d < 0 ? `◄ ${Math.abs(d).toFixed(1)}°` : `${d.toFixed(1)}° ►`);
        ctx.fillText(txt, width / 2, 196);
        ctx.restore();
    }
};

// Indicador de viento (dirección + intensidad) en el HUD del canvas
function drawWindHUD() {
    if (windForce === 0) return;
    const dir = Math.sign(windForce);
    const n = 1 + Math.min(3, Math.floor(Math.abs(windForce) / 0.022)); // 1..4 chevrons
    const cx = width / 2, y = 146;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '600 10px "Chakra Petch", Outfit, sans-serif';
    ctx.fillText('VIENTO', cx, y - 12);
    ctx.strokeStyle = '#3ef0ff'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowBlur = 10; ctx.shadowColor = '#3ef0ff';
    const t = (Date.now() / 250) % 1;
    for (let i = 0; i < n; i++) {
        const px = cx + dir * (i - (n - 1) / 2) * 14;
        ctx.globalAlpha = 0.35 + 0.65 * (((i / n) + t) % 1);
        ctx.beginPath();
        ctx.moveTo(px - dir * 5, y - 7); ctx.lineTo(px + dir * 5, y); ctx.lineTo(px - dir * 5, y + 7);
        ctx.stroke();
    }
    if (boxCfg().wind === 0 && boxType !== 'mystery') { // caja pesada
        ctx.shadowBlur = 0; ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = 'bold 9px Outfit, Inter, sans-serif';
        ctx.fillText('🔩 IGNORADO', cx, y + 24);
    }
    ctx.restore();
}

function checkCollisions() {
    player.onGround = false;

    // Drones: no matan al tocarlos. Actúan como plataformas: si la caja cae encima, el dron se destruye y la
    // caja rebota hacia la siguiente plataforma; por los lados o por debajo se pueden atravesar sin daño.
    obstacles.forEach(obs => {
        if (obs.dead) return;
        if (player.x + player.w > obs.x && player.x < obs.x + obs.w &&
            player.y + player.h > obs.y && player.y < obs.y + obs.h &&
            player.vy > 0 && (player.y + player.h - player.vy) <= obs.y + 8) {
            stompDrone(obs);
        }
    });

    // Colisiones Props con Plataformas
    props.forEach(prop => {
        prop.onGround = false;
        platforms.forEach(p => {
            if (prop.vy >= 0 && prop.x + prop.w > p.x && prop.x < p.x + p.w &&
                prop.y + prop.h >= p.y && prop.y + prop.h <= p.y + p.h + 10) {
                prop.y = p.y - prop.h;
                prop.onGround = true;
            }
        });
    });

    // Colisión Jugador con Props
    props.forEach(prop => {
        if (player.x + player.w > prop.x && player.x < prop.x + prop.w &&
            player.y + player.h > prop.y && player.y < prop.y + prop.h) {
            const now = Date.now();
            if (!prop.lastHitTime || now - prop.lastHitTime > 300) {
                prop.lastHitTime = now;
                const playerCenterX = player.x + player.w / 2;
                const propCenterX = prop.x + prop.w / 2;
                const force = (player.vx || (propCenterX > playerCenterX ? 2 : -2));
                prop.vx += force * 0.5;
                prop.vy -= 2;
                // Límite de velocidad para que no salgan disparadas sin control
                prop.vx = Math.max(-12, Math.min(12, prop.vx));
                prop.vy = Math.max(-12, Math.min(12, prop.vy));
            }
        }
    });

    // Colisión Jugador con Plataformas
    platforms.forEach(p => {
        if (p.type === 'flash' && !p.isVisible) return; // "apagada": el jugador la atraviesa
        const bottom = player.y + player.h;
        const prevBottom = (player.prevY === undefined ? player.y : player.prevY) + player.h;
        const pw = p.type === 'temp_full' ? width : p.w;
        // Colisión continua: también cuenta si en este paso ha cruzado la parte de arriba de la plataforma
        if (player.vy >= 0 && player.x + player.w > p.x && player.x < p.x + pw &&
            bottom >= p.y && (bottom <= p.y + p.h + 10 || prevBottom <= p.y + 10)) {

            // Item Bomba se ha movido a triggerAction para elección manual
            const impact = player.vy;
            player.y = p.y - player.h;
            let bounced = false;
            if (boxKind() === 'rubber' && impact > 2) { // caja de goma: no rebota (se caería de las móviles), solo se aplasta un poco
                player.squash = Math.min(0.8, impact / 12);
            }
            if (boxKind() === 'heavy' && impact > 8) landingBurst(p, '#9aa7ba', 10); // caja pesada: nube de polvo
            player.onGround = !bounced;
            if (player.currentPlatform !== p) {
                // Al aterrizar en plataforma móvil, anular velocidad lateral (Punto 2)
                if (p.type === 'moving' || p.type === 'shield') player.vx = 0;

                player.currentPlatform = p;
                sfx('land', { impact });
                player.squash = Math.max(player.squash, Math.min(0.7, impact / 14)); // aplastamiento al caer (todas las cajas)
                if (impact > 4) landingBurst(p, rgba(shade(p.getColor(), 0.3), 0.9), Math.min(10, Math.round(impact)));
                if (impact > 11) addShake((impact - 11) * 0.7);
                lastPlatIdx = p.idx;
                platformsReached++;
                chests.forEach(c => { if (c.p === p && !c.opened) openChest(c); });
                // Caja pegajosa: se queda clavada pase lo que pase (inercia, fuerza de salto, tipo de plataforma)
                let stuck = false;
                if (boxKind() === 'sticky') {
                    stuck = true;
                    player.vx = 0; player.angularVelocity = 0;
                    landingBurst(p, '#00ff64', 8);
                }
                if ((p.type === 'vanishing' || p.type === 'fragile') && !p.vanishingStarted) {
                    p.vanishingStarted = true;
                    p.startTime = gameTime;
                }
                if (p.type === 'spring' && !stuck) {
                    // Resorte: rebote automático hacia arriba, no requiere precisión del jugador
                    const distY = 220;
                    player.vy = -Math.sqrt(2 * player.gravity * distY) * 1.4;
                    player.vx = 0;            // rebote vertical, sin ángulo
                    player.straightBounce = true; // sin viento hasta volver a tocar suelo
                    player.rocket = true;         // estela de fuego mientras sube
                    player.onGround = false;
                    player.angularVelocity = 0;   // sube recto, como un cohete
                                    showFeedback("¡RESORTE! 🚀");
                    sfx('spring');
                    createExplosion(p.x + p.w / 2, p.y, 0.8);
                }
                if (p.type === 'sling' && !p.isGoal) startSling(p); // plataforma tirachinas
                if (p.isGoal) {
                    const wasBomb = boxKind() === 'bomb';
                    nextLevel();
                    if (wasBomb && !runEnded) launchBombRocket(); // bomba desactivada: sale disparada
                }
            }
        }
    });
}

// Pisotón sobre un dron: se destruye y la caja bota hacia arriba, como en una plataforma de botes,
// pero con la fuerza justa para llegar a la siguiente plataforma por encima.
function stompDrone(obs) {
    obs.kill();
    createExplosion(obs.x + obs.w / 2, obs.y + obs.h / 2, 1.3);
    const feet = player.y + player.h;
    const cands = platforms.filter((p) => !p.isBroken && p.y < feet - 20 && p.type !== 'temp_full' && !(p.type === 'flash' && !p.isVisible))
        .sort((a, b) => b.y - a.y); // la más cercana por encima
    const target = cands[0], g = effGrav();
    if (target) {
        const distY = feet - target.y;
        const vy = -Math.sqrt(2 * g * distY) * 1.12;
        const tRise = Math.abs(vy / g), hFall = (vy * vy) / (2 * g) - distY;
        const totalT = tRise + Math.sqrt(Math.max(0, 2 * hFall / g));
        player.vy = vy;
        player.vx = totalT > 0 ? ((target.x + target.w / 2) - (player.x + player.w / 2)) / totalT : 0;
    } else {
        player.vy = -Math.sqrt(2 * g * 220) * 1.4; player.vx = 0;
    }
    player.y = obs.y - player.h;
    player.straightBounce = true; player.rocket = true; player.onGround = false;
    player.angularVelocity = 0.1;
    if (navigator.vibrate) { try { navigator.vibrate(25); } catch (e) { } }
    showFeedback('💥 ¡DRON DESTRUIDO!');
    sfx('drone_destroy');
}

// Estela de fuego y humo que sale de la base de la caja tras un autosalto
function emitRocketFlame() {
    const cx = player.x + player.w / 2, by = player.y + player.h;
    const flame = ['#fff6b0', '#ffd23f', '#ff9a1f', '#ff5a14', '#ff2a00'];
    for (let i = 0; i < 4; i++) {
        particles.push({
            x: cx + (Math.random() - 0.5) * 12, y: by + Math.random() * 4,
            vx: (Math.random() - 0.5) * 1.6, vy: 2 + Math.random() * 3.5,
            life: 1, decay: 0.045 + Math.random() * 0.035,
            size: 4 + Math.random() * 6, grow: -0.12,
            color: flame[Math.floor(Math.random() * flame.length)], fire: true
        });
    }
    if (Math.random() < 0.6) {
        const g = 120 + Math.floor(Math.random() * 60);
        particles.push({
            x: cx + (Math.random() - 0.5) * 10, y: by + 6,
            vx: (Math.random() - 0.5) * 1.2, vy: 1 + Math.random() * 1.5,
            life: 0.7, decay: 0.02 + Math.random() * 0.015,
            size: 5 + Math.random() * 4, grow: 0.25,
            color: `rgb(${g},${g},${g})`
        });
    }
}

function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (p.drag) { p.vx *= p.drag; p.vy *= p.drag; }
        p.x += p.vx; p.y += p.vy; p.life -= (p.decay || 0.02);
        if (p.grow) p.size = (p.size || 4) + p.grow;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

// ===================== EFECTOS DE ATERRIZAJE =====================
function landingBurst(p, color, n) {
    const cx = player.x + player.w / 2;
    for (let i = 0; i < n; i++) {
        particles.push({
            x: cx + (Math.random() - 0.5) * player.w, y: p.y,
            vx: (Math.random() - 0.5) * 5, vy: -Math.random() * 2.6,
            life: 0.9, decay: 0.035 + Math.random() * 0.02, size: 3 + Math.random() * 3, color
        });
    }
}

// ===================== BOMBA: 20 s POR NIVEL =====================
const BOMB_DEATH_WAIT_MS = 3000; // tras explotar se esperan 3 s antes de terminar
let bombDying = 0;             // ms que quedan de la explosión final (la caja ya no está)
const MYSTERY_BOMB_WARN = 5; // la misteriosa-bomba se descubre en los últimos 5 s
function updateBombBox(dtSec) {
    if (boxKind() !== 'bomb' || runEnded) return;
    const prevFuse = bombFuse;
    bombFuse -= dtSec;
    if (boxType === 'mystery' && prevFuse >= MYSTERY_BOMB_WARN && bombFuse < MYSTERY_BOMB_WARN) {
        showFeedback('❓💣 ¡LA CAJA MISTERIOSA ERA UNA BOMBA!\nLlega a la meta');
        sfx('rescue_alert');
    }
    if (bombFuse > 0) return;
    createExplosion(player.x + player.w / 2, player.y + player.h / 2, 2);
    if (hasShield) {
        sfx('shield'); hasShield = false; armBomb(); bombFuse = BOMB_FUSE_SECONDS / 2;
        showFeedback('💥 ¡LA BOMBA ESTALLA!\nEl escudo te salva (' + Math.round(BOMB_FUSE_SECONDS / 2) + ' s más)');
    } else { // la bomba revienta: la caja desaparece y se esperan 3 s
        const cx = player.x + player.w / 2, cy = player.y + player.h / 2;
        createExplosion(cx, cy, 2.5); createExplosion(cx, cy, 1.5);
        sfx('explosion');
        if (navigator.vibrate) { try { navigator.vibrate([80, 40, 120]); } catch (e) { /* sin vibración */ } }
        showFeedback('💥 ¡BOOM! La bomba ha explotado');
        bombDying = BOMB_DEATH_WAIT_MS;
        addShake(16); addFlash(0.45, '255,190,120');
        aim.cancel(); cancelSling();
    }
}
function drawBombRing() {
    if (boxKind() !== 'bomb' || runEnded) return;
    if (boxType === 'mystery' && bombFuse >= MYSTERY_BOMB_WARN) return; // secreta hasta el final
    const cx = player.x + player.w / 2, cy = player.y + player.h / 2;
    const k = Math.max(0, bombFuse / BOMB_FUSE_SECONDS);
    ctx.save();
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.strokeStyle = bombFuse < 5 ? '#ff3b2f' : '#ffae00';
    ctx.shadowBlur = 10; ctx.shadowColor = ctx.strokeStyle;
    ctx.beginPath(); ctx.arc(cx, cy, 28, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.stroke();
    ctx.restore();
}

// ===================== LAVA ASCENDENTE =====================
const isLavaLevel = () => (gameMode === 'normal' || gameMode === 'daily' || gameMode === 'race') && level % LAVA_EVERY === 0;

function setupLava(silent) {
    lava.active = isLavaLevel();
    lava.skips = 0; lava.doom = false; lava.armed = false;
    lava.timer = LAVA_RISE_EVERY;
    lava.y = lava.targetY = height + 30; // justo bajo la pantalla
    if (lava.active && !silent) showFeedback('🌋 ¡NIVEL DE LAVA!\nCada ' + LAVA_RISE_EVERY + ' s sube un poco por encima de la siguiente plataforma');
}

// Ya no depende de la barra: la lava sube sola por tiempo (ver lavaRise).
function lavaSkip() { /* sin efecto */ }

// Cada LAVA_RISE_EVERY s la lava sube hasta un poco por encima de la plataforma más baja que aún queda libre.
function lavaRise() {
    const base = lava.targetY;
    const next = platforms
        .filter((p) => !p.isBroken && p.y < base - 2)
        .sort((a, b) => b.y - a.y)[0];
    lava.targetY = next ? next.y - 16 : base - 80;
    showFeedback('🌋 ¡LA LAVA SUBE!');
    sfx('lava');
    addShake(5);
}

function updateLava(dtSec = 0) {
    if (!lava.active || runEnded) return;
    lava.t += 0.05;
    if (lava.armed) {
        lava.timer -= dtSec;
        if (lava.timer <= 0) { lava.timer += LAVA_RISE_EVERY; lavaRise(); }
    }
    lava.y += (lava.targetY - lava.y) * 0.06;             // sube suave hacia su nuevo nivel
    if (player.y + player.h > lava.y + 6) {
        createExplosion(player.x + player.w / 2, player.y + player.h, 1.5);
        if (hasShield) {
            lava.timer = LAVA_RISE_EVERY; lava.y = lava.targetY = height + 30;
            shieldSave('🛡️ ¡EL ESCUDO TE SALVA DE LA LAVA!');
        } else {
            showFeedback('🌋 ¡LA LAVA TE HA PILLADO!');
            endGame();
        }
    }
}

function drawLava() {
    if (!lava.active) return;
    const top = lava.y;
    ctx.save();
    // resplandor en el borde inferior: más intenso cuantos más fallos
    const heat = 0.16 + 0.4 * (1 - Math.max(0, lava.timer) / LAVA_RISE_EVERY);
    const glow = ctx.createLinearGradient(0, height - 140, 0, height);
    glow.addColorStop(0, 'rgba(255,90,20,0)'); glow.addColorStop(1, `rgba(255,90,20,${heat})`);
    ctx.fillStyle = glow; ctx.fillRect(0, height - 140, width, 140);
    if (top < height + 14) {
        const grad = ctx.createLinearGradient(0, top, 0, height);
        grad.addColorStop(0, '#ffd23f'); grad.addColorStop(0.07, '#ff7a1a'); grad.addColorStop(0.5, '#e8310a'); grad.addColorStop(1, '#7a0d00');
        ctx.fillStyle = grad; ctx.shadowBlur = 26; ctx.shadowColor = '#ff5a14';
        ctx.beginPath(); ctx.moveTo(0, height + 4);
        for (let x = 0; x <= width + 12; x += 12) {
            ctx.lineTo(x, top + Math.sin(x * 0.045 + lava.t * 2) * 5 + Math.sin(x * 0.11 - lava.t * 3) * 3);
        }
        ctx.lineTo(width, height + 4); ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;
        // burbujas
        ctx.fillStyle = 'rgba(255,230,120,0.75)';
        for (let i = 0; i < 8; i++) {
            const bx = (i * 137 + lava.t * 18 * (1 + (i % 3))) % width;
            const by = top + 12 + ((lava.t * 26 + i * 53) % 70);
            if (by < height) { ctx.beginPath(); ctx.arc(bx, by, 2 + (i % 3), 0, Math.PI * 2); ctx.fill(); }
        }
    }
    ctx.restore();
}

// HUD de estado: lava (fallos que quedan) y cuenta atrás de la bomba
function drawStatusHUD() {
    if (runEnded && !gameActive && !lava.active) return;
    let y = 214;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '600 12px "Chakra Petch", Outfit, sans-serif';
    if (lava.active) {
        const t = Math.max(0, lava.timer);
        const danger = t < 3;
        const pulse = 0.65 + 0.35 * Math.sin(performance.now() / (danger ? 90 : 220));
        ctx.fillStyle = `rgba(255,${danger ? 70 : 150},40,${pulse})`;
        ctx.fillText('🌋 LA LAVA SUBE EN ' + t.toFixed(1) + ' s', width / 2, y);
        y += 20;
    }
    if (ghost && gameMode === 'race' && modeCfg) {
        const mine = level - modeCfg.first + 1, his = Math.max(1, Math.min(modeCfg.total, (ghost.level || modeCfg.first) - modeCfg.first + 1));
        ctx.fillStyle = his > mine ? '#ff8a8a' : (his < mine ? '#7dff6b' : '#cfd8ee');
        ctx.fillText('⚔️ ' + (ghost.name || 'Rival') + ': nivel ' + his + '/' + modeCfg.total, width / 2, y);
        y += 20;
    }
    if (gravFlipT > 0) {
        ctx.fillStyle = 'rgba(125,249,255,' + (0.7 + 0.3 * Math.sin(performance.now() / 120)) + ')';
        ctx.fillText('🌀 GRAVEDAD INVERTIDA ' + (gravFlipT / 1000).toFixed(1) + ' s', width / 2, y);
        y += 20;
    }
    if (boxKind() === 'bomb' && !runEnded && (boxType !== 'mystery' || bombFuse < MYSTERY_BOMB_WARN)) {
        const urgent = bombFuse < 5;
        const pulse = urgent ? 0.6 + 0.4 * Math.sin(performance.now() / 80) : 1;
        ctx.fillStyle = urgent ? `rgba(255,59,47,${pulse})` : 'rgba(255,174,0,0.95)';
        ctx.fillText('💣 ' + Math.max(0, bombFuse).toFixed(1) + ' s', width / 2, y);
    }
    ctx.restore();
}

// ===================== LÁPIDAS =====================
function wrapText(c, text, maxW) {
    const words = text.split(' '), lines = [];
    let line = '';
    words.forEach((w) => {
        const test = line ? line + ' ' + w : w;
        if (c.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    });
    if (line) lines.push(line);
    return lines;
}

class Tombstone {
    constructor(platform, count, phrase, t) {
        this.p = platform; this.count = count; this.phrase = phrase; this.t = t;
        this.w = 22; this.h = 28;
    }
    get x() { return this.p.x + this.t * Math.max(0, this.p.w - this.w); }
    get y() { return this.p.y - this.h; }
    update() { return !this.p.isBroken; }
    draw() {
        const x = this.x, y = this.y, w = this.w, h = this.h;
        ctx.save();
        ctx.globalAlpha = (this.p.alpha === undefined ? 1 : this.p.alpha) * 0.95;
        // piedra
        ctx.shadowBlur = 8; ctx.shadowColor = 'rgba(180,200,255,0.55)';
        ctx.fillStyle = '#8a93a8';
        ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y + w / 2); ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); ctx.lineTo(x + w, y + h); ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#4c566c'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#3b4357'; ctx.font = 'bold 8px Arial'; ctx.textAlign = 'center';
        ctx.fillText('RIP', x + w / 2, y + 13);
        ctx.fillRect(x + w / 2 - 1, y + 16, 2, 9); ctx.fillRect(x + w / 2 - 4, y + 18, 8, 2);
        ctx.fillStyle = '#4f8a4f'; ctx.fillRect(x - 3, y + h - 3, w + 6, 3); // hierba
        // bocadillo con la frase (solo si la caja anda cerca y la lápida se ve entera)
        if (y > 70 && Math.abs(player.y - y) < 280) {
            ctx.font = '10px Outfit, Inter, sans-serif';
            const head = '💀 ' + this.count + (this.count === 1 ? ' jugador cayó aquí' : ' jugadores cayeron aquí');
            const lines = [head, ...wrapText(ctx, this.phrase, 140)];
            const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14, bh = lines.length * 13 + 8;
            const bx = Math.max(6, Math.min(width - bw - 6, x + w / 2 - bw / 2)), by = y - bh - 9;
            ctx.fillStyle = 'rgba(10,16,36,0.88)'; roundRectPath(ctx, bx, by, bw, bh, 7); ctx.fill();
            ctx.strokeStyle = 'rgba(180,200,255,0.4)'; ctx.lineWidth = 1; ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x + w / 2 - 4, by + bh); ctx.lineTo(x + w / 2 + 4, by + bh); ctx.lineTo(x + w / 2, by + bh + 5); ctx.closePath();
            ctx.fillStyle = 'rgba(10,16,36,0.88)'; ctx.fill();
            ctx.textAlign = 'center';
            lines.forEach((l, i) => {
                ctx.fillStyle = i === 0 ? '#ff8a8a' : '#cfd8ee';
                ctx.font = (i === 0 ? 'bold ' : '') + '10px Outfit, Inter, sans-serif';
                ctx.fillText(l, bx + bw / 2, by + 15 + i * 13);
            });
        }
        ctx.restore();
    }
}

function pickTombPhrase() {
    let pool = TOMB_PHRASES.filter((p) => !usedTombPhrases.has(p));
    if (!pool.length) { usedTombPhrases.clear(); pool = TOMB_PHRASES; }
    const ph = pool[Math.floor(Math.random() * pool.length)];
    usedTombPhrases.add(ph);
    return ph;
}

// Una sola lápida por nivel: en la plataforma desde la que más gente ha muerto.
function placeTombstone() {
    tombstones = [];
    const dm = modeCfg && modeCfg.deaths && modeCfg.deaths[level];
    if (!dm) return;
    let bestIdx = -1, bestN = 0;
    Object.keys(dm).forEach((k) => {
        const n = dm[k] | 0, i = +k;
        if (n > bestN) { bestN = n; bestIdx = i; }
    });
    if (bestIdx < 0 || bestN < 1) return;
    const p = platforms.find((q) => q.idx === bestIdx);
    if (!p || p.w < 40) return;
    tombstones.push(new Tombstone(p, bestN, pickTombPhrase(), 0.12 + Math.random() * 0.3));
}

// ===================== PLATAFORMA TIRACHINAS =====================
// Al aterrizar en ella el mundo se congela: arrastra el dedo hacia abajo (como en Angry Birds,
// pero hacia arriba) y suelta. La caja sale lanzada con fuerza en sentido contrario al arrastre.
// La línea punteada muestra la trayectoria; hay que apuntar a la siguiente plataforma.
const SLING_MAX_PULL = 90;   // px de estirado máximo
const SLING_MIN_PULL = 22;   // estirado mínimo para poder soltar
const SLING_MAX_SPEED = 24;  // velocidad de salida con el estirado máximo
const sling = { active: false, dragging: false, ax: 0, ay: 0, px: 0, py: 0, platform: null, target: null, sim: null };

function cancelSling() { sling.active = false; sling.dragging = false; sling.platform = null; sling.target = null; sling.sim = null; }

function startSling(p) {
    const cands = platforms.filter((q) => !q.isBroken && q.y < player.y - 10 && !(q.type === 'flash' && !q.isVisible) && q.type !== 'temp_full')
        .sort((a, b) => b.y - a.y); // la más cercana por encima = la siguiente plataforma
    sling.active = true; sling.dragging = false; sling.platform = p; sling.target = cands[0] || null; sling.sim = null;
    player.vx = 0; player.angularVelocity = 0;
    showFeedback('🎯 ¡TIRACHINAS!\nArrastra hacia abajo y suelta');
    sfx('sling_ready');
}
function slingPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const pt = (e.touches && e.touches.length) ? e.touches[0] : ((e.changedTouches && e.changedTouches.length) ? e.changedTouches[0] : e);
    return { x: pt.clientX - rect.left, y: pt.clientY - rect.top };
}
function slingPull() {
    let dx = sling.ax - sling.px, dy = sling.ay - sling.py; // sentido de lanzamiento = contrario al arrastre
    let len = Math.hypot(dx, dy);
    if (len > SLING_MAX_PULL) { dx *= SLING_MAX_PULL / len; dy *= SLING_MAX_PULL / len; len = SLING_MAX_PULL; }
    const k = SLING_MAX_SPEED / SLING_MAX_PULL;
    return { dx, dy, len, vx: dx * k, vy: dy * k, cx: player.x + player.w / 2, cy: player.y + player.h / 2 };
}
function slingUpdateSim() {
    const v = slingPull();
    sling.sim = (sling.dragging && v.len >= SLING_MIN_PULL && v.vy < -2)
        ? simulateJump({ vy: v.vy, target: sling.target || { y: -1e9 } }, v.vx) : null;
}
function slingPress(e) {
    if (!sling.active) return;
    const pt = slingPoint(e);
    sling.dragging = true; sling.ax = sling.px = pt.x; sling.ay = sling.py = pt.y;
    sfx('sling_pull');
    slingUpdateSim();
}
function slingMove(e) {
    if (!sling.active || !sling.dragging) return;
    const pt = slingPoint(e);
    sling.px = pt.x; sling.py = pt.y;
    slingUpdateSim();
}
function slingRelease() {
    if (!sling.active || !sling.dragging) return;
    sling.dragging = false;
    const v = slingPull();
    if (v.len < SLING_MIN_PULL || v.vy > -2) { sling.sim = null; showFeedback('⬇️ Arrastra hacia abajo y suelta'); return; }
    player.vx = v.vx; player.vy = v.vy;
    player.onGround = false; player.currentPlatform = null;
    player.straightBounce = false; player.bouncesLeft = 2; player.angularVelocity = 0.12; player.rocket = true;
    createExplosion(player.x + player.w / 2, player.y + player.h, 0.9);
    sfx('sling_launch');
    if (navigator.vibrate) { try { navigator.vibrate(20); } catch (e) { } }
    cancelSling();
}
function drawSling() {
    if (!sling.active || !sling.platform) return;
    const p = sling.platform, v = slingPull();
    const pouch = sling.dragging ? { x: v.cx - v.dx, y: v.cy - v.dy } : { x: v.cx, y: v.cy };
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ffd08a'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(p.x + 6, p.y - 16); ctx.lineTo(pouch.x, pouch.y); ctx.lineTo(p.x + p.w - 6, p.y - 16); ctx.stroke();
    if (sling.sim) { // trayectoria punteada y marca de aterrizaje
        const land = sling.sim.landing, col = land ? (land.onTarget ? '#00ff64' : '#ffae00') : '#ff3300';
        sling.sim.pts.forEach((q, i, arr) => {
            ctx.globalAlpha = Math.max(0.15, 0.9 - (i / arr.length) * 0.7);
            ctx.fillStyle = col; ctx.beginPath(); ctx.arc(q.x, q.y, 2.4, 0, Math.PI * 2); ctx.fill();
        });
        ctx.globalAlpha = 1;
        if (land) {
            ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.shadowBlur = 12; ctx.shadowColor = col;
            ctx.strokeRect(land.x - player.w / 2, land.y - player.h, player.w, player.h);
        }
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1; ctx.textAlign = 'center';
    ctx.font = '600 12px "Chakra Petch", Outfit, sans-serif'; ctx.fillStyle = '#ffd08a';
    if (sling.dragging) ctx.fillText('FUERZA ' + Math.round(v.len / SLING_MAX_PULL * 100) + ' %', pouch.x, pouch.y + 24);
    else {
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(performance.now() / 180);
        ctx.fillText('⬇ ARRASTRA HACIA ABAJO Y SUELTA', width / 2, Math.min(height - 40, v.cy + 80));
    }
    ctx.restore();
}

// ===================== RESCATE EN EL ÚLTIMO SEGUNDO (QTE) =====================
function resetRescue() {
    rescue.active = false; rescue.usedThisLevel = false; rescue.rolled = false; rescue.phase = 'idle';
    rescue.step = 0; rescue.elapsed = 0; rescue.btn = null; rescue.prev = null; rescue.target = null; rescue.rise = null; rescue.kind = null;
}
const rescueRadius = () => RESCUE_START_R * Math.max(0, 1 - rescue.elapsed / RESCUE_TIME);

// Plataforma a la que subirá la caja: la más ALTA de las que se ven en pantalla, sin plataformas con movimiento.
function rescueTarget() {
    const c = platforms.filter((p) => isSafePlatform(p) && p.y >= 0 && p.y < player.y);
    c.sort((a, b) => a.y - b.y); // menor y = más arriba
    return c[0] || null;
}
function platformBelow() {
    const feet = player.y + player.h;
    return platforms.some((p) => !p.isBroken && !(p.type === 'flash' && !p.isVisible) && p.y >= feet - 4 &&
        player.x + player.w + 14 > p.x && player.x - 14 < p.x + (p.type === 'temp_full' ? width : p.w));
}
function maybeStartRescue() {
    if (player.onGround) rescue.rolled = false;                          // nueva caída = nueva tirada
    if (rescue.active || rescue.usedThisLevel || runEnded || hasShield || bombActive) return false;
    if (player.onGround || player.vy <= 1) return false;                 // solo cayendo
    if (player.y + player.h < height * RESCUE_TRIGGER) return false;     // aún queda mucha caída
    if (platformBelow()) return false;                                   // hay algo que te recoja
    if (!rescueTarget()) return false;                                   // y debe haber plataforma a la que subir
    // Una sola tirada por caída: 1 posibilidad entre 3 de que aparezca el tap
    if (!rescue.rolled) { rescue.rolled = true; if (Math.random() >= RESCUE_CHANCE) return false; }
    else return false;                                                   // ya se tiró en esta caída y no salió
    rescue.active = true; rescue.usedThisLevel = true; rescue.kind = 'rescue';
    rescue.phase = 'qte'; rescue.step = 0; rescue.prev = null;
    rescue.target = rescueTarget();
    newRescueButton();
    showFeedback('🆘 ¡RESCATE!\nPulsa cuando el aro encaje');
    sfx('rescue_alert');
    return true;
}
function newRescueButton() {
    const bar = precisionSystem.canal, pad = RESCUE_TARGET_R + 30;
    const minX = (precisionSystem.side === 'left' ? bar.x + bar.w + 10 : 0) + pad;
    const maxX = Math.max(minX + 1, (precisionSystem.side === 'right' ? bar.x - 10 : width) - pad);
    const minY = Math.min(260, height * 0.3), maxY = Math.max(minY + 1, height * 0.78 - 20);
    let x, y, tries = 0;
    do {
        x = minX + Math.random() * (maxX - minX); y = minY + Math.random() * (maxY - minY); tries++;
    } while (tries < 25 && rescue.prev && Math.hypot(x - rescue.prev.x, y - rescue.prev.y) < 150);
    rescue.btn = { x, y }; rescue.prev = { x, y }; rescue.elapsed = 0;
}
function rescuePress(px, py) {
    if (rescue.phase !== 'qte' || !rescue.btn) return;
    if (Math.hypot(px - rescue.btn.x, py - rescue.btn.y) > RESCUE_TARGET_R + 24) return; // fuera del botón: se ignora
    const tol = RESCUE_TOL[rescue.step];
    if (Math.abs(rescueRadius() - RESCUE_TARGET_R) <= tol) {
        const last = rescue.step === RESCUE_STEPS - 1;
        spawnFirework(rescue.btn.x, rescue.btn.y, last);
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { } }
        rescue.step++;
        sfx(last ? 'rescue_win' : 'rescue_ok');
        if (last) rescueSuccess(); else newRescueButton();
    } else {
        rescueFail(rescueRadius() > RESCUE_TARGET_R ? '¡TEMPRANO!' : '¡TARDE!');
    }
}
function rescueFail(msg) {
    rescue.active = false; rescue.phase = 'idle'; rescue.btn = null;
    sfx('rescue_fail');
    showFeedback(msg + ' 💀');
    createExplosion(player.x + player.w / 2, player.y + player.h / 2, 0.2);
}
function rescueSuccess() {
    const t = (rescue.target && isSafePlatform(rescue.target)) ? rescue.target : rescueTarget();
    if (!t) { rescueFail('¡SIN PLATAFORMA!'); return; }
    flyTo(t, 750, 'rescue');
    showFeedback('🎆 ¡RESCATE PERFECTO!');
}
const flyX1 = (r) => Math.max(0, Math.min(width - player.w, r.target.x + r.target.w / 2 - player.w / 2));
const flyY1 = (r) => r.target.y - player.h;
function rescueLand() {
    const r = rescue.rise;
    player.x = flyX1(r); player.y = flyY1(r); player.prevY = player.y; player.vx = 0; player.vy = 0;
    player.rotation = 0; player.angularVelocity = 0; player.onGround = false; player.bouncesLeft = 2;
    rescue.active = false; rescue.phase = 'idle'; rescue.rise = null; rescue.kind = null;
    if (r.onLand) { try { r.onLand(); } catch (e) { console.error(e); } }
    // la física normal la posa en la plataforma (cuenta como aterrizaje: cofres, meta, etc.)
}
function updateRescue(dtMs) {
    if (rescue.phase === 'qte') {
        rescue.elapsed += dtMs;
        // cámara lentísima: la caja sigue cayendo apenas un poco
        player.y = Math.min(height * 0.9 - player.h, player.y + Math.max(0, player.vy) * 0.03);
        player.rotation += 0.002;
        const tol = RESCUE_TOL[rescue.step];
        if (rescueRadius() < RESCUE_TARGET_R - tol - 2 || rescue.elapsed >= RESCUE_TIME) rescueFail('¡TARDE!');
    } else if (rescue.phase === 'rise' && rescue.rise) {
        const r = rescue.rise;
        r.t += dtMs / r.dur;
        const k = Math.min(1, r.t), e = 1 - Math.pow(1 - k, 3);
        player.x = r.x0 + (flyX1(r) - r.x0) * e; // destino vivo: sigue a la plataforma aunque la cámara se mueva
        player.y = r.y0 + (flyY1(r) - r.y0) * e;
        player.rotation = (1 - e) * r.spin;
        emitRocketFlame();
        if (k >= 1) rescueLand();
    } else {
        rescue.active = false;
    }
}
function spawnFirework(x, y, big) {
    const cols = ['#ff4d6d', '#ffd23f', '#00f2ff', '#7dff6b', '#ff00ea', '#ffffff'];
    const n = big ? 80 : 40;
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = (big ? 2 : 1.4) + Math.random() * (big ? 6.5 : 4.2);
        particles.push({
            x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, decay: 0.014 + Math.random() * 0.012,
            size: 3 + Math.random() * 3, color: cols[(Math.random() * cols.length) | 0], fire: true
        });
    }
}
function drawRescue() {
    if (!rescue.active || rescue.kind !== 'rescue') return;
    ctx.save();
    // viñeta azulada: sensación de cámara lenta
    const vg = ctx.createRadialGradient(width / 2, height / 2, height * 0.2, width / 2, height / 2, height * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,12,50,0.6)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, width, height);
    ctx.textAlign = 'center';
    if (rescue.phase === 'qte' && rescue.btn) {
        const { x, y } = rescue.btn, r = rescueRadius(), tol = RESCUE_TOL[rescue.step];
        const inWin = Math.abs(r - RESCUE_TARGET_R) <= tol;
        const TAU = Math.PI * 2;
        // zona de acierto (anillo verde tenue)
        ctx.lineWidth = tol * 2; ctx.strokeStyle = 'rgba(0,255,100,0.16)';
        ctx.beginPath(); ctx.arc(x, y, RESCUE_TARGET_R, 0, TAU); ctx.stroke();
        // círculo fijo
        ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.shadowBlur = 12; ctx.shadowColor = '#fff';
        ctx.beginPath(); ctx.arc(x, y, RESCUE_TARGET_R, 0, TAU); ctx.stroke();
        // botón
        ctx.shadowBlur = 18; ctx.shadowColor = inWin ? '#00ff64' : '#00f2ff';
        ctx.fillStyle = inWin ? 'rgba(0,255,100,0.55)' : 'rgba(0,242,255,0.28)';
        ctx.beginPath(); ctx.arc(x, y, RESCUE_TARGET_R - 7, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Outfit, Inter, sans-serif';
        ctx.fillText('TAP', x, y + 4);
        // aro grande que se va achicando
        if (r > 1) {
            ctx.lineWidth = 5; ctx.strokeStyle = inWin ? '#00ff64' : '#00f2ff';
            ctx.shadowBlur = 14; ctx.shadowColor = ctx.strokeStyle;
            ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
        }
        // progreso: 3 puntos
        ctx.shadowBlur = 0;
        for (let i = 0; i < RESCUE_STEPS; i++) {
            ctx.fillStyle = i < rescue.step ? '#00ff64' : 'rgba(255,255,255,0.3)';
            ctx.beginPath(); ctx.arc(width / 2 + (i - 1) * 22, 222, 6, 0, TAU); ctx.fill();
        }
    }
    ctx.restore();
}

// ===================== FANTASMA DEL RIVAL (multijugador) =====================
// El rival se ve en modo sombra. Su posición llega como (nivel, altura sobre la salida del nivel, x relativa).
let ghost = null; // { name, level, hgt, xf, rot, box, dx, dy } (dx/dy: posición suavizada en pantalla)
function setGhost(st) {
    if (!st) { ghost = null; return; }
    if (!ghost) ghost = {};
    Object.assign(ghost, st);
}
function raceSnapshot() {
    return {
        level, hgt: Math.round(cameraScroll - (player.y + player.h) - levelBaseH),
        xf: +(player.x / Math.max(1, width - player.w)).toFixed(4), rot: +player.rotation.toFixed(2),
        box: boxType, alive: !runEnded && !bombDying,
    };
}
function drawGhost() {
    if (!ghost || gameMode !== 'race') return;
    if (ghost.level !== level || ghost.alive === false) { delete ghost.dx; return; }
    const tx = ghost.xf * (width - player.w);
    const ty = cameraScroll - levelBaseH - ghost.hgt - player.h;
    if (ghost.dx === undefined || Math.abs(ty - ghost.dy) > height) { ghost.dx = tx; ghost.dy = ty; }
    ghost.dx += (tx - ghost.dx) * 0.25; ghost.dy += (ty - ghost.dy) * 0.25; // movimiento suave entre mensajes
    if (ghost.dy < -60 || ghost.dy > height + 60) return;
    ctx.save();
    ctx.globalAlpha = 0.38;
    ctx.translate(ghost.dx + player.w / 2, ghost.dy + player.h / 2);
    ctx.rotate(ghost.rot || 0);
    ctx.filter = 'grayscale(1)';
    drawBoxShape(ctx, BOX_TYPES[ghost.box] ? ghost.box : 'normal', player.w, player.h, performance.now(), {});
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.75; ctx.fillStyle = '#cfd8ee'; ctx.textAlign = 'center';
    ctx.font = 'bold 11px Outfit, Inter, sans-serif';
    ctx.fillText('👻 ' + (ghost.name || 'Rival'), ghost.dx + player.w / 2, ghost.dy - 8);
    ctx.restore();
}

// ===================== EFECTOS DE PANTALLA =====================
const REDUCED_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const screenFx = { shake: 0, flash: 0, flashRgb: '255,255,255', last: performance.now() };
function addShake(m) { if (!REDUCED_MOTION) screenFx.shake = Math.min(18, Math.max(screenFx.shake, m)); }
function addFlash(a, rgb) { screenFx.flash = Math.max(screenFx.flash, a); screenFx.flashRgb = rgb || '255,255,255'; }

// Utilidades de color (#rrggbb)
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function shade(h, k) { // k > 0 aclara, k < 0 oscurece
    const c = hexRgb(h).map((v) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k)));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
const rgba = (h, a) => { const c = hexRgb(h); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
function lerpHex(a, b, t) {
    const x = hexRgb(a), y = hexRgb(b);
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// ===================== ESCENARIO: CIELO CON PARALLAX =====================
// Se empieza al atardecer sobre la ciudad; al subir de nivel el cielo pasa a noche, aurora y espacio.
const SKY_BANDS = [ // [nivel, cielo arriba, cielo abajo, brillo del horizonte, cantidad de estrellas]
    [1, '#1b1446', '#4a2363', '#ff7a7a', 0.35],
    [10, '#0b1137', '#1f1a55', '#7c5cff', 0.7],
    [25, '#05152b', '#0b2c44', '#2ef2c4', 0.85],
    [40, '#020309', '#0c0a26', '#5b6cff', 1],
];
const BOX_TRAIL_COLORS = { normal: '#3ef0ff', heavy: '#9aabc2', light: '#d6f0ff', rubber: '#ff4f9a', sticky: '#2ecf6a', bomb: '#ff5b4f', gravity: '#a46bff', mystery: '#e8eeff' };
const bg = { stars: [], motes: [], city: null, cityH: 0, w: 0, h: 0 };
function skyColors() {
    let i = 0;
    while (i < SKY_BANDS.length - 1 && level >= SKY_BANDS[i + 1][0]) i++;
    const a = SKY_BANDS[i], b = SKY_BANDS[Math.min(SKY_BANDS.length - 1, i + 1)];
    const t = a === b ? 0 : Math.max(0, Math.min(1, (level - a[0]) / (b[0] - a[0])));
    return { top: lerpHex(a[1], b[1], t), bot: lerpHex(a[2], b[2], t), hor: lerpHex(a[3], b[3], t), stars: a[4] + (b[4] - a[4]) * t };
}
function buildBackground() {
    if (!width || !height) return;
    bg.w = width; bg.h = height;
    const R = mulberry32(1234);
    bg.stars = Array.from({ length: 150 }, () => ({ x: R(), y: R(), r: 0.4 + R() * 1.3, tw: R() * 6.28, sp: 0.6 + R() * 1.8 }));
    bg.motes = Array.from({ length: 22 }, () => ({ x: R(), y: R(), r: 0.8 + R() * 1.8, sp: 0.4 + R() }));
    // ciudad en dos capas (silueta lejana + edificios con ventanas encendidas)
    bg.cityH = Math.round(Math.min(300, height * 0.36));
    const c = document.createElement('canvas'); c.width = width; c.height = bg.cityH;
    const g = c.getContext('2d');
    const layer = (col, minH, maxH, wMin, wMax, windows) => {
        let x = -10;
        while (x < width + 10) {
            const w = wMin + R() * (wMax - wMin), h = minH + R() * (maxH - minH), y = bg.cityH - h;
            g.fillStyle = col; g.fillRect(x, y, w, h);
            if (R() < 0.3) g.fillRect(x + w * 0.4, y - 10 - R() * 14, 2, 14 + R() * 10); // antena
            if (windows) {
                for (let wy = y + 8; wy < bg.cityH - 6; wy += 9) for (let wx = x + 4; wx < x + w - 5; wx += 7) {
                    if (R() < 0.28) { g.fillStyle = R() < 0.8 ? 'rgba(255,200,120,0.55)' : 'rgba(120,220,255,0.55)'; g.fillRect(wx, wy, 3, 4); }
                }
            }
            x += w + R() * 6;
        }
    };
    layer('rgba(40,22,80,0.85)', bg.cityH * 0.35, bg.cityH * 0.8, 26, 60, false);
    layer('#120c2e', bg.cityH * 0.2, bg.cityH * 0.62, 22, 48, true);
    bg.city = c;
}
function drawBackground() {
    if (bg.w !== width || bg.h !== height) { buildBackground(); bg.skyKey = null; }
    const sky = skyColors(), now = performance.now() / 1000;
    // cielo + brillo del horizonte: se pintan en un lienzo aparte y solo se rehacen si cambian
    const horA = Math.max(0, 0.55 - cameraScroll / 2600);
    // auroras (a partir del nivel 18, sobre todo hacia el 30): se repintan 5 veces por segundo
    const aur = level < 18 ? 0 : Math.max(0, 1 - Math.abs(level - 30) / 14) * 0.5;
    const key = level + ':' + Math.round(horA * 40) + (aur > 0.02 ? ':' + Math.floor(now * 5) : '');
    if (bg.skyKey !== key || !bg.sky) {
        bg.skyKey = key;
        if (!bg.sky) bg.sky = document.createElement('canvas');
        bg.sky.width = width; bg.sky.height = height;
        const g = bg.sky.getContext('2d');
        const grd = g.createLinearGradient(0, 0, 0, height);
        grd.addColorStop(0, sky.top); grd.addColorStop(1, sky.bot);
        g.fillStyle = grd; g.fillRect(0, 0, width, height);
        if (horA > 0.01) { // brillo del horizonte (se aleja al subir)
            const hg = g.createRadialGradient(width / 2, height + 40, 10, width / 2, height + 40, height * 0.75);
            hg.addColorStop(0, rgba(sky.hor, horA)); hg.addColorStop(1, rgba(sky.hor, 0));
            g.fillStyle = hg; g.fillRect(0, 0, width, height);
        }
        if (aur > 0.02) {
            g.globalCompositeOperation = 'lighter';
            [['#2ef2c4', 0.22, 0], ['#7c5cff', 0.34, 2.1]].forEach(([c, yk, ph]) => {
                const yy = height * yk + Math.sin(now * 0.2 + ph) * 18;
                const ag = g.createLinearGradient(0, yy - 60, 0, yy + 60);
                ag.addColorStop(0, rgba(c, 0)); ag.addColorStop(0.5, rgba(c, aur * 0.35)); ag.addColorStop(1, rgba(c, 0));
                g.fillStyle = ag; g.beginPath(); g.moveTo(0, yy - 60);
                for (let x = 0; x <= width; x += 20) g.lineTo(x, yy - 60 + Math.sin(x * 0.012 + now * 0.35 + ph) * 26);
                for (let x = width; x >= 0; x -= 20) g.lineTo(x, yy + 60 + Math.sin(x * 0.012 + now * 0.35 + ph + 0.8) * 26);
                g.closePath(); g.fill();
            });
            g.globalCompositeOperation = 'source-over';
        }
    }
    ctx.drawImage(bg.sky, 0, 0);
    // estrellas (parallax muy lento) con parpadeo
    const span = height * 1.3;
    ctx.fillStyle = '#fff';
    bg.stars.forEach((st) => {
        const y = ((st.y * span + cameraScroll * 0.05 * st.r) % span) - height * 0.15;
        const a = sky.stars * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now * st.sp + st.tw)));
        ctx.globalAlpha = a * 0.85;
        ctx.fillRect(st.x * width, y, st.r, st.r);
    });
    ctx.globalAlpha = 1;
    // ciudad: se hunde al subir
    const cityY = height - bg.cityH + cameraScroll * 0.22;
    if (bg.city && cityY < height) ctx.drawImage(bg.city, 0, cityY);
    // motas de luz cercanas (parallax rápido)
    bg.motes.forEach((m) => {
        const y = ((m.y * (height + 40) + cameraScroll * 0.45 + now * 8 * m.sp) % (height + 40)) - 20;
        const x = m.x * width + Math.sin(now * 0.6 + m.y * 9) * 10;
        ctx.globalAlpha = 0.18; ctx.fillStyle = '#c9d3ff';
        ctx.beginPath(); ctx.arc(x, y, m.r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
    // viento: rachas finas
    if (windForce !== 0) {
        ctx.strokeStyle = 'rgba(201,211,255,0.16)'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
        for (let i = 0; i < 12; i++) {
            const spd = 0.3 + Math.abs(windForce) * 8;
            const wx = (((performance.now() * spd * Math.sign(windForce) + i * 97) % (width + 120)) + width + 120) % (width + 120) - 60;
            const wy = (i * height / 12) + Math.sin(i * 3.1) * 20;
            ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx + 46 * Math.sign(windForce), wy + 1.5); ctx.stroke();
        }
    }
}

// Estela de la caja en el aire (en coordenadas del mundo para que no salte con la cámara)
const trail = [];
function updateTrail() {
    if (!player.onGround && gameActive && !bombDying && !runEnded) {
        trail.push({ x: player.x, y: player.y - cameraScroll, r: player.rotation });
        if (trail.length > 7) trail.shift();
    } else if (trail.length) trail.shift();
}
function drawTrail() {
    if (!trail.length) return;
    const col = BOX_TRAIL_COLORS[boxType] || '#3ef0ff';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    trail.forEach((p, i) => {
        const k = (i + 1) / trail.length;
        ctx.globalAlpha = 0.16 * k;
        ctx.save();
        ctx.translate(p.x + player.w / 2, p.y + cameraScroll + player.h / 2); ctx.rotate(p.r);
        const sz = player.w * (0.65 + 0.35 * k);
        ctx.fillStyle = col; roundRectPath(ctx, -sz / 2, -sz / 2, sz, sz, 5); ctx.fill();
        ctx.restore();
    });
    ctx.restore();
}

// --- CÁMARA en saltos muy grandes ---
// La plataforma de la que sale el jugador se mantiene visible abajo del todo
// mientras dure el salto (sin zoom). Se sigue la plataforma aunque desaparezca.
const ORIGIN_BOTTOM_MARGIN = 34;   // hueco mínimo bajo la plataforma de origen
const PLAYER_MIN_Y = 0.12;         // el jugador nunca sube por encima de este % de la pantalla
let originY = null;

function update(dtMs = STEP_MS) {
    frameDtMs = dtMs;
    if (!gameActive) return;
    if (bombDying > 0) { // la caja ha explotado: solo se ven las partículas durante 3 s
        bombDying -= dtMs; updateParticles();
        if (bombDying <= 0) { bombDying = 0; endGame(); }
        return;
    }
    if (window.SFX) window.SFX.mood(lava.active ? 'lava' : (darkLevel ? 'dark' : 'normal'));
    if (aim.active) { aim.update(); updateParticles(); return; } // mundo congelado mientras se apunta
    if (sling.active) { updateParticles(); return; }               // tirachinas: mundo congelado
    if (rescue.active) { // rescate / vuelo del escudo / vuelo de la bomba: mundo congelado
        updateRescue(dtMs);
        if (rescue.phase === 'rise') updateCamera(); // la cámara acompaña a la caja en el vuelo
        updateParticles(); return;
    }
    if (maybeStartRescue()) { updateParticles(); return; }
    gameTime += dtMs; // el reloj del juego solo corre con el mundo en marcha
    if (clockUntil && gameTime >= clockUntil) { ballSpeedFactor = 1.0; clockUntil = 0; }
    if (gravFlipT > 0) { // gravedad invertida: cuenta atrás
        gravFlipT -= dtMs;
        if (gravFlipT <= 0) { gravFlipT = 0; showFeedback('⬇️ Gravedad normal'); sfx('gravity_off'); }
    }
    player.update();
    updateBombRocket();
    // Cohete: mientras sube tras un autosalto
    if (player.rocket) {
        if (player.onGround || player.vy > -1) player.rocket = false;
        else emitRocketFlame();
    }
    precisionSystem.update();
    updateBombBox(dtMs / 1000);
    updateLava(dtMs / 1000);

    // Actualizar entidades
    obstacles = obstacles.filter(obs => obs.update());
    chests = chests.filter(c => c.update());
    tombstones = tombstones.filter(t => t.update());
    powerups = powerups.filter(pu => pu.update());
    for (let i = props.length - 1; i >= 0; i--) {
        if (!props[i].update()) props.splice(i, 1);
    }

    checkCollisions();

    for (let i = platforms.length - 1; i >= 0; i--) {
        if (!platforms[i].update()) {
            if (player.currentPlatform === platforms[i]) {
                player.onGround = false;
                player.currentPlatform = null;
            }
            platforms.splice(i, 1);
        }
    }

    updateCamera();
    trackHeight();
    updateParticles();
}

function updateCamera() {
    // Plataforma de origen del salto (se mantiene aunque desaparezca)
    if (player.currentPlatform) originY = player.currentPlatform.y;

    const cameraThreshold = height * 0.4;
    if (player.y < cameraThreshold) {
        let diff = cameraThreshold - player.y;
        // Salto muy grande: no bajar el mundo más de lo que deje la plataforma de
        // origen visible abajo, salvo que el jugador se fuera a salir por arriba.
        if (!player.onGround && originY !== null) {
            const allowed = Math.max(0, (height - ORIGIN_BOTTOM_MARGIN) - originY);
            const needForPlayer = Math.max(0, height * PLAYER_MIN_Y - player.y);
            diff = Math.max(Math.min(diff, allowed), needForPlayer);
        }
        // Al aterrizar tras un salto enorme, la cámara se recoloca con suavidad (sin salto brusco)
        if (player.onGround && diff > 8) diff = Math.max(8, diff * 0.2);
        if (originY !== null && !player.currentPlatform) originY += diff;
        particles.forEach(pt => pt.y += diff);
        cameraScroll += diff;
        player.y += diff;
        platforms.forEach(p => p.y += diff);
        props.forEach(pr => pr.y += diff);
        obstacles.forEach(o => o.y += diff);
        powerups.forEach(pu => pu.y += diff);
        blackHoles.forEach(bh => bh.y += diff);
        lava.y += diff; lava.targetY += diff;
        if (rescue.rise) rescue.rise.y0 += diff; // vuelo en curso: el punto de partida baja con el mundo
    }

}

function draw() {
    const nowFx = performance.now(), dtFx = Math.min(0.1, (nowFx - screenFx.last) / 1000);
    screenFx.last = nowFx;
    screenFx.shake *= Math.exp(-dtFx * 10); if (screenFx.shake < 0.2) screenFx.shake = 0;
    screenFx.flash = Math.max(0, screenFx.flash - dtFx * 1.8);

    drawBackground();

    // mundo (tiembla con las explosiones)
    ctx.save();
    if (screenFx.shake) ctx.translate((Math.random() - 0.5) * 2 * screenFx.shake, (Math.random() - 0.5) * 2 * screenFx.shake);

    blackHoles.forEach(bh => bh.draw());
    platforms.forEach(p => p.draw());
    chests.forEach(c => c.draw());
    tombstones.forEach(t => t.draw());
    powerups.forEach(pu => pu.draw());
    props.forEach(pr => pr.draw());
    obstacles.forEach(o => o.draw());
    drawLava();
    updateTrail(); drawTrail();
    if (!bombDying) player.draw(); // tras explotar la bomba la caja ya no está
    drawGhost();
    drawBombRing();
    drawSling();

    // UI del Escudo / Powerups
    if (hasShield) {
        ctx.strokeStyle = THEME.shield;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(player.x + player.w / 2, player.y + player.h / 2, 35, 0, Math.PI * 2);
        ctx.stroke();
    }
    if (rocketJumps > 0) {
        ctx.save();
        ctx.fillStyle = THEME.rocket; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center';
        ctx.fillText('🚀 x' + rocketJumps, player.x + player.w / 2, player.y - 12);
        ctx.restore();
    }

    // partículas brillantes (suma de luz)
    ctx.globalCompositeOperation = 'lighter';
    particles.forEach(p => {
        const sz = (p.size || 4) * (0.5 + 0.5 * Math.max(0, p.life));
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, sz / 2 + 0.5, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.restore(); // fin del temblor

    drawDarkness();
    if (screenFx.flash > 0) { ctx.fillStyle = `rgba(${screenFx.flashRgb},${screenFx.flash})`; ctx.fillRect(0, 0, width, height); }
    precisionSystem.draw();
    drawWindHUD();
    drawStatusHUD();
    drawRescue();
    aim.draw();
}

// Nivel de niebla / modo oscuro: solo se ilumina un radio reducido alrededor de la caja
function drawDarkness() {
    if (!darkLevel) return;
    const cx = player.x + player.w / 2, cy = player.y + player.h / 2;
    const r = DARK_RADIUS * (1 + 0.03 * Math.sin(performance.now() / 400));
    const grd = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.3);
    grd.addColorStop(0, 'rgba(2,4,12,0)');
    grd.addColorStop(0.55, 'rgba(2,4,12,0.8)');
    grd.addColorStop(1, 'rgba(2,4,12,0.985)');
    ctx.save();
    ctx.fillStyle = grd; ctx.fillRect(0, 0, width, height);
    ctx.restore();
}

function gameLoop() {
    const now = performance.now();
    stepAcc += Math.min(100, now - lastFrameT); // tras una pausa larga no se intenta "recuperar" el tiempo
    lastFrameT = now;
    let n = 0;
    while (stepAcc >= STEP_MS && n < 6) { update(STEP_MS); stepAcc -= STEP_MS; n++; }
    draw();
    requestAnimationFrame(gameLoop);
}
function startGame(continueGame = false, cfg = null) {
    // Hay que iniciar sesión con Google antes de poder jugar
    if (window.BJFirebase && !window.BJFirebase.isSignedIn()) {
        window.BJFirebase.promptSignIn();
        return;
    }
    modeCfg = cfg || null;
    gameMode = cfg ? cfg.type : 'normal';
    runEnded = false;
    gameActive = true;
    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    if (rankingFab) rankingFab.classList.remove('hidden');

    const resume = !cfg && continueGame && savedGameData && savedGameData.level > 1;
    initPlatforms(cfg ? (cfg.startAt || cfg.first) : (resume ? savedGameData.level : 1));
    setLevelHUD();
    updateHeightDisplay();
    precisionSystem.spawnBall();
    if (window.SFX) window.SFX.musicStart();
}
function endGame() { finishRun(false); }

// Fin de partida (derrota o fase completada). En los modos especiales, el modo decide
// qué se guarda y qué botones aparecen (modeCfg.onEnd).
let respawnTimer = null;
function finishRun(completed) {
    if (runEnded) return;
    // Carrera multijugador: al caer se reaparece en el mismo nivel a los 3 s
    if (!completed && modeCfg && modeCfg.respawn) {
        runEnded = true; gameActive = false;
        aim.cancel(); cancelSling(); gravFlipT = 0; resetRescue();
        showFeedback('💀 ¡HAS CAÍDO!\nReapareces en 3 s');
        sfx('miss');
        const cfg = modeCfg, lv = level;
        clearTimeout(respawnTimer);
        respawnTimer = setTimeout(() => { respawnTimer = null; if (modeCfg === cfg) startGame(false, Object.assign({}, cfg, { startAt: lv })); }, 3000);
        return;
    }
    runEnded = true;
    gameActive = false;
    sfx(completed ? 'win' : 'game_over');
    if (window.SFX) window.SFX.musicStop();
    aim.cancel(); cancelSling(); gravFlipT = 0;
    resetRescue();
    // Muerte registrada para las lápidas de los demás (solo fase diaria y fases de la comunidad)
    if (!completed && modeCfg && modeCfg.onDeath && lastPlatIdx >= 0) {
        try { modeCfg.onDeath({ level, platIdx: lastPlatIdx }); } catch (e) { console.error(e); }
    }
    const cleared = modeCfg ? (completed ? modeCfg.last - modeCfg.first + 1 : level - modeCfg.first) : level - 1;
    const finalHeight = heightCm();
    finalScore.innerText = finalHeight;
    finalLevel.innerText = hudLevel();
    if (rankingFab) rankingFab.classList.add('hidden');
    updateStartScreenUI();

    let info = {};
    if (modeCfg && modeCfg.onEnd) {
        try { info = modeCfg.onEnd({ completed, level, height: finalHeight, cleared }) || {}; } catch (e) { console.error(e); }
    } else if (gameMode === 'normal' && window.BJFirebase) {
        window.BJFirebase.reportRun(level, finalHeight);
    }

    if (info.silent) return; // el modo muestra su propia pantalla (carrera)
    goTitle.innerText = info.title || (completed ? '¡FASE COMPLETADA!' : 'FIN DEL JUEGO');
    goNote.innerText = info.note || '';
    goNote.classList.toggle('hidden', !info.note);
    if (modeCfg) {
        restartBtn.innerText = info.retryText || 'REINTENTAR';
    }
    goPrimaryBtn.classList.toggle('hidden', !info.primary);
    if (info.primary) {
        goPrimaryBtn.innerText = info.primary.text;
        goPrimaryBtn.onclick = () => { gameOverScreen.classList.add('hidden'); info.primary.onClick(); };
    }
    gameOverScreen.classList.remove('hidden');
}

// Vuelve al menú principal (abandona la partida en curso)
function goToMenu() {
    clearTimeout(respawnTimer); respawnTimer = null; ghost = null; bombDying = 0;
    if (!runEnded && gameMode === 'normal' && window.BJFirebase) window.BJFirebase.reportRun(level, heightCm());
    runEnded = true; gameActive = false; bombActive = false; bombRocket = false;
    if (window.SFX) window.SFX.musicStop();
    aim.cancel(); cancelSling(); cancelReels(); updateInventoryUI(); gravFlipT = 0;
    resetRescue(); tombstones = []; lava.active = false;
    modeCfg = null; gameMode = 'normal';
    [gameOverScreen, document.getElementById('items-modal'), document.getElementById('settings-modal'), document.getElementById('ranking-modal')]
        .forEach(el => el && el.classList.add('hidden'));
    if (rankingFab) rankingFab.classList.add('hidden');
    startScreen.classList.remove('hidden');
    updateStartScreenUI();
}
// Salir de una partida: cada modo puede indicar a dónde volver (onExit)
function exitRun() {
    const cb = modeCfg && modeCfg.onExit;
    goToMenu();
    if (cb) cb();
}

// Puente con el módulo de Firebase (index.html) para pausar el juego
// mientras el jugador mira la clasificación, sin reanudarlo si no estaba jugando.
window.__bjOpenRanking = () => {
    window.__bjWasPlaying = gameActive;
    gameActive = false;
};
window.__bjCloseRanking = () => {
    if (window.__bjWasPlaying) gameActive = true;
    window.__bjWasPlaying = false;
};

// Si la mejor marca remota (Firebase: nivel y altura) es mayor que la local, la adoptamos.
// También recibimos aquí la partida guardada (checkpoint) para ofrecer "Continuar".
window.addEventListener('bj-auth-changed', (e) => {
    if (e.detail && e.detail.signedIn) {
        const remote = { level: e.detail.bestLevel || 1, height: e.detail.bestHeight || 0 };
        if (betterRun(remote.level, remote.height, bestRun)) {
            bestRun = remote;
            try { localStorage.setItem('boxjump_best_run', JSON.stringify(bestRun)); } catch (err) { /* no disponible */ }
        }
        if (bestValueEl) bestValueEl.innerText = bestRunText();
        savedGameData = e.detail.savedGame || null;
    } else {
        savedGameData = null;
    }
    updateStartScreenUI();
});

window.addEventListener('resize', resize);
resize();
startBtn.addEventListener('click', () => askStart(() => startGame(true)));
if (newGameBtn) newGameBtn.addEventListener('click', () => askStart(() => startGame(false)));
restartBtn.addEventListener('click', () => (modeCfg ? (modeCfg.respawn ? null : startGame(false, modeCfg)) : startGame(true)));
if (goMenuBtn) goMenuBtn.addEventListener('click', goToMenu);

// Punto tocado en coordenadas del canvas (ratón o dedo); clientX = 0 también es válido
function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const pt = (e.touches && e.touches.length) ? e.touches[0] : e;
    return { x: (pt.clientX || 0) - rect.left, y: (pt.clientY || 0) - rect.top };
}
const BOMB_TAP_PAD = 26; // margen táctil alrededor de la plataforma (solo mide 20 px de alto)
// Plataformas que el objeto bomba puede romper: ni la meta, ni la tuya, ni el escudo, y visibles
const bombablePlatform = (p) => !p.isBroken && !p.isGoal && p !== player.currentPlatform && p.type !== 'shield' &&
    p.type !== 'temp_full' && p.y > -10 && p.y < height;

const triggerAction = (e) => {
    // Si item bomba está activo (especial: el juego está pausado)
    if (bombActive) {
        const pt = canvasPoint(e);
        const clickedPlatform = platforms.find(p => bombablePlatform(p) &&
            pt.x > p.x - 8 && pt.x < p.x + p.w + 8 && pt.y > p.y - BOMB_TAP_PAD && pt.y < p.y + p.h + BOMB_TAP_PAD);
        bombActive = false;
        gameActive = true;
        if (clickedPlatform) {
            clickedPlatform.isBroken = true;
            createExplosion(clickedPlatform.x + clickedPlatform.w / 2, clickedPlatform.y, 1.5);
            sfx('explosion');
            showFeedback("¡BOMBA EXPLOTADA!");
        } else { // toque fuera de una plataforma: se cancela y la bomba vuelve al inventario
            if (inventory.length < MAX_INV) inventory.push('bomb');
            updateInventoryUI();
            showFeedback("💣 Bomba cancelada");
        }
        return;
    }

    if (!gameActive) return;

    // Rescate en el último segundo: los toques van a los botones, no a la barra de precisión
    if (rescue.active) {
        const cp = canvasPoint(e);
        rescuePress(cp.x, cp.y);
        return;
    }

    // Tirachinas: el toque empieza el arrastre
    if (sling.active) { slingPress(e); return; }

    // Medidor de ángulo activo: este toque fija el ángulo y lanza
    if (aim.active) { aim.lock(); return; }

    // Caja de goma: un toque sobre la propia caja (1 vez por nivel) la hace botar como una plataforma-resorte
    if (boxKind() === 'rubber' && !rubberBoostUsed) {
        const cp = canvasPoint(e), tx = cp.x, ty = cp.y, pad = 22;
        if (tx >= player.x - pad && tx <= player.x + player.w + pad && ty >= player.y - pad && ty <= player.y + player.h + pad) {
            rubberBoost();
            return;
        }
    }

    // Caja gravitatoria: un toque sobre la propia caja (1 vez por nivel) invierte la gravedad 3 s
    if (boxKind() === 'gravity' && !gravBoostUsed && gravFlipT <= 0) {
        const cp = canvasPoint(e), tx = cp.x, ty = cp.y, pad = 22;
        if (tx >= player.x - pad && tx <= player.x + player.w + pad && ty >= player.y - pad && ty <= player.y + player.h + pad) {
            gravityFlip();
            return;
        }
    }

    // Si item plataforma está activo (deprecated por la nueva instrucción de ser instantáneo, 
    // pero lo limpio por si acaso quedaba algo)
    if (platformItemActive) { platformItemActive = false; }

    // En el aire el toque no hace nada: así no se gasta la bola ni se pierde el combo
    if (!player.onGround) return;

    const precision = precisionSystem.checkHit();
    if (precision.multiplier > 0) {
        // Con viento: primero se apunta (medidor de ángulo); sin viento o con cohete, salto directo
        if (!(effWind() !== 0 && rocketJumps === 0 && aim.start(precision))) handleJump(precision);
    }
};
// Los toques sobre botones, campos de texto, modales y pantallas de UI no deben
// disparar el salto (y sobre todo no se les debe hacer preventDefault, o no
// funcionan ni los clics ni el teclado en móvil).
const isUiTarget = (e) => !!(e.target && e.target.closest &&
    e.target.closest('button, input, textarea, a, .screen, #hud-menu, #ranking-fab, #settings-fab, #home-fab, #info-fab, #items-modal, #ranking-modal, .inv-slot'));
window.addEventListener('mousedown', (e) => {
    if (isUiTarget(e)) return;
    triggerAction(e);
});
window.addEventListener('touchstart', (e) => {
    if (isUiTarget(e)) return;
    e.preventDefault();
    triggerAction(e);
}, { passive: false });

// Arrastre de la tirachinas
window.addEventListener('mousemove', (e) => { if (sling.active) slingMove(e); });
window.addEventListener('touchmove', (e) => { if (sling.active && sling.dragging) { e.preventDefault(); slingMove(e); } }, { passive: false });
window.addEventListener('mouseup', () => { if (sling.active) slingRelease(); });
window.addEventListener('touchend', () => { if (sling.active) slingRelease(); });
window.addEventListener('touchcancel', () => { if (sling.active) { sling.dragging = false; sling.sim = null; } });

// INVENTARIO (los objetos salen de los cofres; usarlos es gratis)
const game = {
    useItem(index) {
        if (!gameActive || runEnded || aim.active || sling.active || rescue.active || !inventory[index]) return;
        const type = inventory[index];
        inventory.splice(index, 1);
        sfx('item');
        updateInventoryUI();

        switch (type) {
            case 'clock':
                ballSpeedFactor = 0.5;
                clockUntil = gameTime + 10000; // 10 s de juego (no cuenta el tiempo en pausa)
                showFeedback("⏱️ TIEMPO RALENTIZADO!");
                break;
            case 'platform': {
                const newP = new Platform(0, player.y + 120, width, 25, false, 'temp_full');
                newP.vanishingStarted = true; newP.startTime = gameTime;
                platforms.push(newP);
                showFeedback("🏗️ PLATAFORMA CREADA!");
                break;
            }
            case 'power':
                greenPowerActive = 5;
                showFeedback("⚡ ZONA VERDE x5!");
                break;
            case 'bomb':
                if (!platforms.some(bombablePlatform)) { // nada que explotar: se devuelve
                    inventory.splice(index, 0, 'bomb'); updateInventoryUI();
                    showFeedback("💣 No hay plataformas que explotar");
                    break;
                }
                bombActive = true;
                gameActive = false;
                showFeedback("💣 TOCA UNA PLATAFORMA PARA EXPLOTARLA\n(toca fuera para cancelar)");
                break;
        }
    }
};

function updateInventoryUI() {
    for (let i = 0; i < MAX_INV; i++) {
        const slot = document.getElementById(`slot-${i}`);
        const spinning = !inventory[i] && i >= inventory.length && (i - inventory.length) < reels.length;
        slot.classList.toggle('spinning', spinning);
        if (inventory[i]) {
            slot.innerText = ITEM_ICONS[inventory[i]];
            slot.onclick = () => game.useItem(i);
        } else if (spinning) { // efecto tragaperras: símbolos al azar hasta que el rodillo para
            slot.innerText = ITEM_ICONS[ITEM_POOL[Math.floor(Math.random() * ITEM_POOL.length)]];
            slot.onclick = null;
        } else {
            slot.innerText = '';
            slot.onclick = null;
        }
    }
}

// Menú de tres líneas: despliega el carrito (tienda) y los trofeos (clasificación)
const menuToggle = document.getElementById('menu-toggle');
const menuPanel = document.getElementById('menu-panel');
function setMenuOpen(open) {
    if (!menuToggle || !menuPanel) return;
    menuPanel.classList.toggle('hidden', !open);
    menuToggle.classList.toggle('open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
}
if (menuToggle) menuToggle.addEventListener('click', () => setMenuOpen(menuPanel.classList.contains('hidden')));
const homeFab = document.getElementById('home-fab');
const infoFab = document.getElementById('info-fab');
[rankingFab, homeFab, infoFab].forEach((el) => { if (el) el.addEventListener('click', () => setMenuOpen(false)); });
if (homeFab) homeFab.addEventListener('click', () => {
    if (runEnded || confirm('¿Salir de la partida? Se perderá el progreso de esta carrera (excepto el último punto de control).')) exitRun();
});

// --- Configuración (código de amigo + lado de la barra de precisión) ---
const settingsFab = document.getElementById('settings-fab');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings-btn');
// Interruptores de sonido (se guardan en el navegador)
(function () {
    const mBtn = document.getElementById('snd-music'), fBtn = document.getElementById('snd-sfx');
    if (!mBtn || !fBtn || !window.SFX) return;
    const paintSnd = () => {
        mBtn.textContent = '🎵 MÚSICA: ' + (window.SFX.musicEnabled() ? 'SÍ' : 'NO');
        fBtn.textContent = '🔊 EFECTOS: ' + (window.SFX.sfxEnabled() ? 'SÍ' : 'NO');
        mBtn.classList.toggle('active', window.SFX.musicEnabled());
        fBtn.classList.toggle('active', window.SFX.sfxEnabled());
    };
    mBtn.addEventListener('click', () => { window.SFX.setMusic(!window.SFX.musicEnabled()); paintSnd(); });
    fBtn.addEventListener('click', () => { window.SFX.setSfx(!window.SFX.sfxEnabled()); paintSnd(); });
    paintSnd();
})();
const sideLeftBtn = document.getElementById('side-left');
const sideRightBtn = document.getElementById('side-right');
let settingsWasPlaying = false;

function setBarSide(side, persist = true) {
    precisionSystem.side = side === 'left' ? 'left' : 'right';
    if (persist) {
        try { localStorage.setItem('boxjump_bar_side', precisionSystem.side); } catch (e) { /* no disponible */ }
    }
    if (width) {
        precisionSystem.init();
        if (precisionSystem.ball.active) {
            precisionSystem.ball.x = precisionSystem.canal.x + precisionSystem.canal.w / 2;
        }
    }
    if (sideLeftBtn) sideLeftBtn.classList.toggle('active', precisionSystem.side === 'left');
    if (sideRightBtn) sideRightBtn.classList.toggle('active', precisionSystem.side === 'right');
}
let savedSide = 'right';
try { savedSide = localStorage.getItem('boxjump_bar_side') || 'right'; } catch (e) { /* por defecto */ }
setBarSide(savedSide, false);
if (sideLeftBtn) sideLeftBtn.addEventListener('click', () => setBarSide('left'));
if (sideRightBtn) sideRightBtn.addEventListener('click', () => setBarSide('right'));

// "Nueva partida" solo aparece en Configuración abierta desde el inicio y si hay una partida guardada
function setNewGameSection(show) {
    const s = document.getElementById('settings-newgame-section');
    if (s) s.classList.toggle('hidden', !(show && savedGameData && savedGameData.level > 1));
}
if (settingsFab) settingsFab.addEventListener('click', () => {
    setMenuOpen(false);
    settingsWasPlaying = gameActive;
    gameActive = false;
    setNewGameSection(false);
    settingsModal.classList.remove('hidden');
});
const menuSettingsBtn = document.getElementById('menu-settings-btn');
if (menuSettingsBtn) menuSettingsBtn.addEventListener('click', () => {
    settingsWasPlaying = false;
    setNewGameSection(true);
    settingsModal.classList.remove('hidden');
});
(function () { // confirmación antes de borrar el progreso
    const modal = document.getElementById('confirm-new-modal');
    const openBtn = document.getElementById('settings-newgame-btn');
    const yes = document.getElementById('confirm-new-yes'), no = document.getElementById('confirm-new-no');
    if (!modal || !openBtn || !yes || !no) return;
    openBtn.addEventListener('click', () => {
        document.getElementById('confirm-new-level').textContent = 'nivel ' + ((savedGameData && savedGameData.level) || 1);
        modal.classList.remove('hidden');
    });
    no.addEventListener('click', () => modal.classList.add('hidden'));
    yes.addEventListener('click', () => {
        modal.classList.add('hidden');
        settingsModal.classList.add('hidden');
        // Se elige la caja y, solo al pulsar EMPEZAR, se borra la partida guardada y se arranca de cero
        askStart(() => {
            savedGameData = null;
            if (window.BJFirebase && window.BJFirebase.resetProgress) window.BJFirebase.resetProgress();
            updateStartScreenUI();
            startGame(false);
        });
    });
})();
const cupGeneralBtn = document.getElementById('cup-general-btn'), cupDailyBtn = document.getElementById('cup-daily-btn');
if (cupGeneralBtn) cupGeneralBtn.addEventListener('click', () => window.BJFirebase && window.BJFirebase.openRanking('general'));
if (cupDailyBtn) cupDailyBtn.addEventListener('click', () => window.BJFirebase && window.BJFirebase.openRanking('daily'));
if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
    if (settingsWasPlaying) gameActive = true;
    settingsWasPlaying = false;
});

// --- Información de objetos (sustituye a la antigua tienda) ---
const itemsModal = document.getElementById('items-modal');
const closeItemsBtn = document.getElementById('close-items-btn');
let itemsWasPlaying = false;
if (infoFab) infoFab.addEventListener('click', () => {
    itemsWasPlaying = gameActive;
    gameActive = false;
    itemsModal.classList.remove('hidden');
});
if (closeItemsBtn) closeItemsBtn.addEventListener('click', () => {
    itemsModal.classList.add('hidden');
    if (itemsWasPlaying) gameActive = true;
    itemsWasPlaying = false;
});

window.addEventListener('keydown', (e) => {
    if (e.key === '1') game.useItem(0);
    if (e.key === '2') game.useItem(1);
    if (e.key === '3') game.useItem(2);
});

// API pública para modes.js (fase diaria y creador)
window.BJGame = {
    start: (cfg) => startGame(false, cfg),
    askStart: (cb) => askStart(cb),
    exit: exitRun,
    toMenu: goToMenu,
    mapX,
    getSide: () => precisionSystem.side,
    setGhost, raceSnapshot,
    isPlaying: () => gameActive && !runEnded,
    mode: () => gameMode,
};

// --- Cuadro "NUEVA CAJA": primera vez que aparece una caja (pausa la partida mientras se lee) ---
let boxIntroQueue = [], boxIntroOpen = false, boxIntroWasActive = false, boxIntroTimer = null;
let boxPickerRefresh = null;
function openBoxIntro(key) {
    const m = document.getElementById('box-intro-modal');
    const cv = document.getElementById('box-intro-canvas');
    document.getElementById('box-intro-name').textContent = BOX_TYPES[key].name;
    document.getElementById('box-intro-desc').textContent = BOX_TYPES[key].desc;
    const c = cv.getContext('2d');
    const paint = () => {
        c.clearRect(0, 0, cv.width, cv.height);
        c.save(); c.translate(cv.width / 2, cv.height / 2);
        drawBoxShape(c, key, 44, 44, performance.now(), { fuse: 99 });
        c.restore();
    };
    clearInterval(boxIntroTimer); paint(); boxIntroTimer = setInterval(paint, 60);
    m.classList.remove('hidden');
}
function showBoxIntro(key) {
    const m = document.getElementById('box-intro-modal');
    if (!m) return;
    if (boxIntroOpen) { boxIntroQueue.push(key); return; }
    boxIntroOpen = true; boxIntroWasActive = gameActive; gameActive = false;
    sfx('unlock');
    aim.cancel(); cancelSling();
    openBoxIntro(key);
}
function closeBoxIntro() {
    if (boxIntroQueue.length) { openBoxIntro(boxIntroQueue.shift()); return; }
    clearInterval(boxIntroTimer); boxIntroTimer = null;
    document.getElementById('box-intro-modal').classList.add('hidden');
    boxIntroOpen = false;
    if (boxIntroWasActive && !runEnded) gameActive = true;
    lastFrameT = performance.now(); stepAcc = 0;
}
(function () {
    const ok = document.getElementById('box-intro-ok');
    if (ok) ok.addEventListener('click', closeBoxIntro);
})();

// --- "¿Cómo quieres empezar?": se muestra DESPUÉS de pulsar el modo de juego ---
function askStart(onGo) {
    const scr = document.getElementById('start-choice-screen');
    if (!scr) { onGo(); return; }
    const go = document.getElementById('start-choice-go'), back = document.getElementById('start-choice-back');
    if (boxPickerRefresh) boxPickerRefresh(); // las cajas desbloqueadas desde la última vez
    scr.classList.remove('hidden');
    go.onclick = () => { scr.classList.add('hidden'); onGo(); };
    back.onclick = () => scr.classList.add('hidden');
}

// --- Selector de caja (pantalla "¿Cómo quieres empezar?") ---
function initBoxPicker() {
    const wrap = document.getElementById('box-options'), desc = document.getElementById('box-desc');
    if (!wrap) return;
    const items = [];
    Object.keys(BOX_TYPES).forEach((key) => {
        const el = document.createElement('div');
        el.className = 'box-opt'; el.setAttribute('role', 'button'); el.title = BOX_TYPES[key].name;
        const cv = document.createElement('canvas'); cv.width = 40; cv.height = 40;
        const lb = document.createElement('span');
        el.appendChild(cv); el.appendChild(lb);
        el.addEventListener('click', () => selectBox(key));
        wrap.appendChild(el);
        items.push({ key, el, cv, lb });
    });
    function paint() {
        items.forEach(({ key, cv }) => {
            const c = cv.getContext('2d');
            c.clearRect(0, 0, 40, 40);
            c.save(); c.translate(20, 20);
            drawBoxShape(c, key, 24, 24, performance.now(), { fuse: 99 });
            c.restore();
        });
    }
    function refresh() {
        items.forEach(({ key, el, lb }) => {
            const open = isUnlocked(key);
            el.classList.toggle('locked', !open);
            el.classList.toggle('active', open && key === chosenBox);
            lb.textContent = open ? BOX_TYPES[key].name : '🔒';
            el.title = open ? BOX_TYPES[key].name : 'Bloqueada';
        });
        if (desc) desc.textContent = BOX_TYPES[chosenBox].desc;
        paint();
    }
    function selectBox(key) {
        if (!isUnlocked(key)) { // bloqueada: se desbloquea cuando aparezca en una partida
            if (desc) desc.textContent = '🔒 Caja bloqueada: se desbloquea cuando te aparezca al azar durante una partida.';
            return;
        }
        chosenBox = key; boxType = key;
        try { localStorage.setItem('boxjump_box_type', key); } catch (e) { /* no disponible */ }
        refresh();
    }
    boxPickerRefresh = refresh;
    refresh();
    const choiceScreen = document.getElementById('start-choice-screen');
    setInterval(() => { if (choiceScreen && !choiceScreen.classList.contains('hidden')) paint(); }, 90); // alas y mechas animadas
}
initBoxPicker();

gameLoop();
