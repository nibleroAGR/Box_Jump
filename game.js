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
        return;
    }
    windForce = rollWind(genRng);
    gravityFactor = (allowGravity && level >= 30 && genRng() < 0.3) ? 0.4 : 1.0; // Baja gravedad ocasional en modo Caos
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
        else if (it.k === 'shield' || it.k === 'dj') powerups.push(new PowerUp(cx - 10, y - 10, it.k === 'shield' ? 'shield' : 'doubleJump'));
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

function updateStartScreenUI() {
    const hasCheckpoint = !!(savedGameData && savedGameData.level > 1);
    if (startBtn) {
        startBtn.innerText = hasCheckpoint ? `▶ CONTINUAR (Nivel ${savedGameData.level})` : '▶ CONTINUAR (sin partida guardada)';
        startBtn.disabled = !hasCheckpoint;
    }
    if (newGameBtn) newGameBtn.classList.remove('hidden');
    if (restartBtn) restartBtn.innerText = hasCheckpoint ? `CONTINUAR (Nivel ${savedGameData.level})` : 'REINTENTAR';
    if (gameOverNewBtn) gameOverNewBtn.classList.toggle('hidden', !hasCheckpoint);
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
    platformBright: '#3d5a9d',
    platformVanishing: '#ff00ff',
    platformSpring: '#00ffcc',
    platformOscillating: '#ff00aa',
    platformFlash: '#ffffff',
    platformMini: '#ffcc00',
    platformFragile: '#ffffff',
    platformMoving: '#ffae00',
    ball: '#ff00ea',
    shield: '#00ff64',
    doubleJump: '#ff00ea',
    obstacle: '#ff3300'
};

// MULTIPLIERS & STATE
let combo = 0;
let maxCombo = 0;
let windForce = 0;
let gravityFactor = 1.0;

// Viento (nivel >= 12): dirección aleatoria e intensidad mínima para que siempre se note
function rollWind(R = Math.random) {
    if (level < 12) return 0;
    return (R() < 0.5 ? -1 : 1) * (0.025 + R() * 0.055);
}
let hasShield = false;
let canDoubleJump = false;
let doubleJumpUsed = false;
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
    rubber: { name: 'Goma',     wind: 1,   grav: 1,   desc: 'Rebota al caer y en las paredes. Toca la caja (1 vez por nivel) y bota como un resorte.' },
    sticky: { name: 'Pegajosa', wind: 1,   grav: 1,   desc: 'Se pega a la plataforma donde aterriza, sea cual sea la inercia o el tipo de plataforma.' },
    bomb:   { name: 'Bomba',    wind: 1,   grav: 1,   desc: 'Tienes 20 s por nivel para llegar a la meta. Si la desactivas, sale disparada como un cohete, explota y aparece otra caja.' },
    psychedelic: { name: 'Psicodélica', wind: 1, grav: 1, desc: 'Zona verde al 33 % de la barra, pero la bola desaparece de la mitad de la pantalla hacia abajo. Si aciertas el verde (aunque no la veas) saltas directo a la 3.ª plataforma por encima (sin contar las móviles) o, si no hay tantas, a la del siguiente nivel.' },
    mystery: { name: 'Misteriosa', wind: 1, grav: 1,  desc: 'Se comporta como otra caja al azar... pero no te dice cuál.' },
};
const BOMB_FUSE_SECONDS = 20;
let chosenBox = 'normal';   // la que eliges en el menú: solo vale para los 3 primeros niveles
try { const sb = localStorage.getItem('boxjump_box_type'); if (sb && BOX_TYPES[sb]) chosenBox = sb; } catch (e) { /* no disponible */ }
let boxType = chosenBox;    // la caja activa ahora mismo (cambia sola cada 3 niveles)
let mysteryAs = 'normal';   // comportamiento real de la caja misteriosa
const BOX_SWAP_EVERY = 3;   // niveles que dura cada caja al azar
const PSY_GREEN = 0.33;     // caja psicodélica: la zona verde ocupa el 33 % de la barra de precisión
const PSY_JUMP_PLATFORMS = 3; // caja psicodélica: con el verde salta a la 3.ª plataforma por encima
let runFirstLevel = 1;      // primer nivel de la partida en curso
let rubberBoostUsed = false; // bote de la caja de goma (1 por nivel)
let bombRocket = false;     // la bomba desactivada vuela como un cohete
const boxKind = () => (boxType === 'mystery' ? mysteryAs : boxType); // comportamiento real
let bombFuse = BOMB_FUSE_SECONDS;
let lastUpdateT = performance.now();
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
    if (key === 'mystery') pickMysteryBehavior();
    placeOnPlatform();
}
// Coloca la caja sobre la plataforma en la que está
function placeOnPlatform() {
    const p = player.currentPlatform;
    if (!p || !player.onGround) return;
    player.y = p.y - player.h;
    player.vy = 0;
}

// --- Caja psicodélica: con el verde salta a la 3.ª plataforma por encima (sin contar las móviles) ---
// Si no hay tantas, va a la plataforma del siguiente nivel (la meta).
function psychedelicTarget() {
    const ok = (p) => p.y < player.y && !p.isBroken && p.type !== 'moving' && p.type !== 'oscillating' &&
        !(p.type === 'flash' && !p.isVisible);
    const cands = platforms.filter(ok).sort((a, b) => b.y - a.y); // de la más cercana a la más alta
    if (!cands.length) return null;
    if (cands.length >= PSY_JUMP_PLATFORMS) return cands[PSY_JUMP_PLATFORMS - 1];
    return platforms.find((p) => p.isGoal) || cands[cands.length - 1];
}

// --- Caja bomba: al desactivarla sale disparada como un cohete, explota y aparece otra caja ---
function launchBombRocket() {
    bombRocket = true;
    player.vy = -Math.sqrt(2 * player.gravity * 320);
    player.vx = 0; player.angularVelocity = 0; player.rotation = 0;
    player.straightBounce = true; player.rocket = true; player.onGround = false;
}
function updateBombRocket() {
    if (!bombRocket) return;
    if (player.vy > -1.5 || player.onGround) {
        bombRocket = false; player.rocket = false;
        const cx = player.x + player.w / 2, cy = player.y + player.h / 2;
        createExplosion(cx, cy, 2.5); createExplosion(cx, cy, 1.2);
        if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) { /* sin vibración */ } }
        const next = rollRandomBox(boxType);
        setActiveBox(next);
        showFeedback('💥 ¡LA BOMBA ESTALLA!\n📦 Nueva caja: ' + boxLabel(next));
    }
}

// --- Caja de goma: un toque sobre ella (1 vez por nivel) la hace botar como una plataforma-resorte ---
function rubberBoost() {
    rubberBoostUsed = true;
    player.vy = -Math.sqrt(2 * effGrav() * 220) * 1.4;
    player.vx = 0; player.straightBounce = true; player.rocket = true;
    player.onGround = false; player.angularVelocity = 0; player.squash = 1;
    doubleJumpUsed = false;
    showFeedback('🟣 ¡BOTE!');
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
        case 'psychedelic': { // colores que giran sin parar y una espiral hipnótica
            const hue = (t * 0.12) % 360;
            c.shadowBlur = 16; c.shadowColor = `hsl(${hue},100%,60%)`;
            const g = c.createLinearGradient(x, y, x + w, y + h);
            g.addColorStop(0, `hsl(${hue},100%,58%)`);
            g.addColorStop(0.5, `hsl(${(hue + 120) % 360},100%,58%)`);
            g.addColorStop(1, `hsl(${(hue + 240) % 360},100%,58%)`);
            c.fillStyle = g; c.fillRect(x, y, w, h);
            c.shadowBlur = 0;
            c.save();
            c.beginPath(); c.rect(x + 2, y + 2, w - 4, h - 4); c.clip();
            c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = Math.max(1.5, w * 0.06); c.lineCap = 'round';
            c.beginPath();
            const turns = 3.2 * Math.PI * 2, rot = t * 0.004, maxR = Math.max(w, h) * 0.7;
            for (let a = 0; a <= turns; a += 0.25) {
                const r = (a / turns) * maxR;
                const px = Math.cos(a + rot) * r, py = Math.sin(a + rot) * r;
                if (a === 0) c.moveTo(px, py); else c.lineTo(px, py);
            }
            c.stroke();
            c.restore();
            c.strokeStyle = `hsl(${(hue + 180) % 360},100%,85%)`; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, h - 2);
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
        default: { // clásica
            c.shadowBlur = 15; c.shadowColor = THEME.player; c.fillStyle = THEME.player;
            c.fillRect(x, y, w, h);
            c.shadowBlur = 0;
            c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 1.5; c.strokeRect(x + 2, y + 2, w - 4, h - 4);
        }
    }
    c.restore();
}

// ===================== LAVA ASCENDENTE (cada 10 niveles) =====================
const LAVA_EVERY = 10;      // un nivel de lava cada N niveles
const LAVA_MAX_SKIPS = 3;   // (en desuso) antes: pasadas sin pulsar
const LAVA_RISE_EVERY = 6;  // segundos entre cada subida de la lava
const lava = { active: false, y: 0, targetY: 0, skips: 0, doom: false, armed: false, t: 0, timer: 6 };

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
const RESCUE_TRIGGER = 0.74;       // la caja debe haber caído por debajo de este % de pantalla
const rescue = { active: false, usedThisLevel: false, phase: 'idle', step: 0, elapsed: 0, btn: null, prev: null, target: null, rise: null };
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
            this.vy += effGrav() * gravityFactor;
            this.rotation += this.angularVelocity;
        } else {
            this.vy = 0;
            this.straightBounce = false;
            // Fricción según plataforma
            let friction = 0.85;
            if (this.currentPlatform && this.currentPlatform.type === 'ice') friction = 0.98;
            if (this.currentPlatform && (this.currentPlatform.type === 'sticky' || this.currentPlatform.type === 'mini_sticky')) friction = 0;
            if (boxKind() === 'sticky') friction = 0; // la caja pegajosa se queda clavada donde cae

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

        this.x += this.vx;
        this.y += this.vy;

        if (this.x < 0) { this.x = 0; if (boxKind() === 'rubber' && !this.onGround) this.vx = Math.abs(this.vx) * 0.85; }
        if (this.x + this.w > width) { this.x = width - this.w; if (boxKind() === 'rubber' && !this.onGround) this.vx = -Math.abs(this.vx) * 0.85; }

        if (this.y > height) {
            if (hasShield) {
                useShield();
            } else {
                endGame();
            }
        }
    },

    draw() {
        ctx.save();
        ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
        ctx.rotate(this.rotation);
        if (boxKind() === 'rubber') { // la goma se aplasta al caer y se estira al moverse rápido
            const stretch = this.onGround ? 0 : Math.min(0.25, Math.abs(this.vy) * 0.012);
            const sy = 1 - 0.35 * this.squash + stretch, sx = 1 + 0.3 * this.squash - stretch * 0.6;
            ctx.translate(0, (this.h / 2) * (1 - sy));
            ctx.scale(sx, sy);
        }
        drawBoxShape(ctx, boxType, this.w, this.h, performance.now(), { fuse: bombFuse });
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

    // Tamaño base de la zona verde (la caja psicodélica la fija en el 33 %)
    greenBase() { return boxKind() === 'psychedelic' ? PSY_GREEN : this.targetArea.greenScale; },

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

            let feedback = tier + (tier === "PERFECT" ? ` x${Math.round(subScore * 5)}` : "");
            if (combo > 1) feedback += `\nCOMBO x${combo}!`;
            showFeedback(feedback);

            createExplosion(this.ball.x, this.ball.y, multiplier);
            this.spawnBall();
            return { multiplier, tier, subScore };
        }
        combo = 0; // Fallar tiro reinicia combo
        updateComboDisplay();
        return { multiplier: 0, tier: "MISSED", subScore: 0 };
    },

    draw() {
        ctx.save();
        const tx = this.canal.x, ty = this.canal.y, tw = this.canal.w, th = this.canal.h;

        // Progress bar
        const progressX = this.side === 'left' ? tx - 13 : tx + tw + 10;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(progressX, ty, 3, th);
        const progressFill = Math.min(1, platformsReached / platformsInLevel);
        ctx.fillStyle = '#00f2ff';
        ctx.fillRect(progressX, ty + th * (1 - progressFill), 3, th * progressFill);

        // Canal
        ctx.strokeStyle = 'rgba(0, 242, 255, 0.1)';
        ctx.strokeRect(tx - 2, ty, tw + 4, th);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(tx, ty, tw, th);

        const areaY = this.targetArea.y, areaH = this.targetArea.h, centerY = areaY + areaH / 2;
        const halfArea = areaH / 2;
        // Mismos límites que usa checkHit(): greenLimit / yellowLimit relativos a maxDist (=halfArea)
        const currentGreenScale = greenPowerActive > 0 ? Math.min(1.0, this.greenBase() * 5) : this.greenBase();
        const greenHalf = halfArea * currentGreenScale;
        const yellowHalf = Math.max(greenHalf, halfArea * 0.65);
        const greenH = greenHalf * 2;
        const yellowH = yellowHalf - greenHalf;
        const redH = Math.max(0, halfArea - yellowHalf);

        const drawBand = (y, h, color, glow) => {
            if (glow) { ctx.shadowBlur = 15; ctx.shadowColor = color; }
            const grad = ctx.createLinearGradient(tx, y, tx + tw, y);
            grad.addColorStop(0, color.replace('0.8', '0.4').replace('0.9', '0.4'));
            grad.addColorStop(0.5, color);
            grad.addColorStop(1, color.replace('0.8', '0.4').replace('0.9', '0.4'));
            ctx.fillStyle = grad;
            ctx.fillRect(tx + 2, y, tw - 4, h);
            ctx.shadowBlur = 0;
        };

        drawBand(areaY, redH, 'rgba(255, 50, 50, 0.8)', false);
        drawBand(areaY + areaH - redH, redH, 'rgba(255, 50, 50, 0.8)', false);
        drawBand(areaY + redH, yellowH, 'rgba(255, 230, 0, 0.8)', false);
        drawBand(areaY + areaH - redH - yellowH, yellowH, 'rgba(255, 230, 0, 0.8)', false);

        const gY = centerY - greenH / 2;
        drawBand(gY, greenH, 'rgba(0, 255, 100, 0.9)', true);
        for (let i = 1; i < 5; i++) {
            const lineY = gY + (greenH / 5) * i;
            ctx.beginPath(); ctx.moveTo(tx + 5, lineY); ctx.lineTo(tx + tw - 5, lineY); ctx.stroke();
        }
        ctx.strokeStyle = '#00ff64'; ctx.strokeRect(tx, gY, tw, greenH);

        const hideBall = boxKind() === 'psychedelic' && this.ball.y > height / 2; // psicodélica: la bola desaparece de la mitad de la pantalla hacia abajo
        if (this.ball.active && !hideBall) {
            ctx.shadowBlur = 20; ctx.shadowColor = THEME.ball;
            const ballGrad = ctx.createRadialGradient(this.ball.x, this.ball.y, 0, this.ball.x, this.ball.y, this.ball.radius);
            ballGrad.addColorStop(0, '#fff'); ballGrad.addColorStop(0.3, THEME.ball); ballGrad.addColorStop(1, 'rgba(255, 0, 234, 0)');
            ctx.fillStyle = ballGrad;
            ctx.beginPath(); ctx.arc(this.ball.x, this.ball.y, this.ball.radius * 1.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(this.ball.x - 2, this.ball.y - 2, 2, 0, Math.PI * 2); ctx.fill();
        }
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
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        ctx.fillRect(this.x, this.y, this.w, this.h);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.strokeRect(this.x + 2, this.y + 2, this.w - 4, this.h - 4);
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
        this.vx = (type === 'moving') ? ((dirX === undefined ? Math.random() > 0.5 : dirX) ? 2 : -2) * (1 + level * 0.1) : 0;
        this.vy = (type === 'oscillating') ? ((dirY === undefined ? Math.random() > 0.5 : dirY) ? 1.5 : -1.5) * (1 + level * 0.1) : 0;
        this.isBroken = false;
        this.isPaused = false;
        this.pauseTimer = 0;
        this.oscOffset = 0;
        this.isVisible = true;
        this.idx = -1; // orden dentro del nivel (0 = plataforma de salida); sirve para las lápidas

        if (type === 'mini_sticky') this.w *= 0.6;
    }

    draw() {
        if (this.isBroken) return;
        if (this.type === 'flash' && !this.isVisible) {
            // Dibujar solo borde si está invisible
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.strokeRect(this.x, this.y, this.w, this.h);
            return;
        }
        ctx.save();
        ctx.globalAlpha = this.alpha;

        // Glow effect
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.getColor(true);

        const grad = ctx.createLinearGradient(this.x, this.y, this.x, this.y + this.h);
        const baseCol = this.getColor();
        grad.addColorStop(0, baseCol);
        grad.addColorStop(1, this.type === 'normal' ? THEME.platform : '#000');

        ctx.fillStyle = grad;
        ctx.fillRect(this.x, this.y, (this.type === 'temp_full' ? width : this.w), this.h);

        if (this.isGoal) this.drawFlag();

        // Highlight top
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(this.x, this.y, (this.type === 'temp_full' ? width : this.w), 3);

        // Visual decoration for types
        if (this.type === 'spring') {
            ctx.fillStyle = 'white';
            for (let i = 0; i < 4; i++) ctx.fillRect(this.x + 10 + i * (this.w / 4), this.y + 2, 4, 10);
        }
        if (this.type === 'oscillating') {
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.fillRect(this.x, this.y + this.h / 2 - 1, this.w, 2);
        }
        if (this.isPaused) {
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = "bold 10px Arial";
            ctx.fillText("WAIT", this.x + this.w / 2 - 15, this.y + 15);
        }

        ctx.restore();
    }

    getColor(isGlow = false) {
        if (this.isGoal) return isGlow ? '#ffd700' : '#ffd700';
        switch (this.type) {
            case 'vanishing': return THEME.platformVanishing;
            case 'moving': return THEME.platformMoving;
            case 'spring': return THEME.platformSpring;
            case 'oscillating': return THEME.platformOscillating;
            case 'flash': return THEME.platformFlash;
            case 'mini_sticky': return THEME.platformMini;
            case 'fragile': return THEME.platformFragile;
            default: return THEME.platformBright;
        }
    }

    drawFlag() {
        const fx = this.x + this.w - 15, fy = this.y - 30;
        ctx.fillStyle = '#fff'; ctx.fillRect(fx, fy, 3, 30);
        const wave = Math.sin(Date.now() / 200) * 5;
        ctx.fillStyle = '#ff3300';
        ctx.beginPath(); ctx.moveTo(fx + 3, fy); ctx.lineTo(fx + 20, fy + 7 + wave); ctx.lineTo(fx + 3, fy + 15); ctx.closePath(); ctx.fill();
    }

    update() {
        if (this.isBroken) return false;

        // Movimiento Horizontal (Moving)
        if (this.type === 'moving') {
            if (this.isPaused) {
                if (Date.now() > this.pauseTimer) this.isPaused = false;
            } else {
                this.x += this.vx;
                if (this.x < 0 || this.x + this.w > width) {
                    this.vx *= -1;
                    this.x = this.x < 0 ? 0 : width - this.w;
                    this.isPaused = true;
                    this.pauseTimer = Date.now() + 2000;
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
            if (!this.flashTime) this.flashTime = Date.now();
            if (Date.now() - this.flashTime > 2000) {
                this.isVisible = !this.isVisible;
                this.flashTime = Date.now();
            }
        }

        // Desvanecimiento / Rotura...
        if ((this.type === 'vanishing' || this.type === 'fragile' || this.type === 'temp_full') && this.vanishingStarted) {
            const elapsed = Date.now() - this.startTime;
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

class Obstacle {
    constructor(o) {
        this.w = 40; this.h = 20;
        this.color = THEME.obstacle;
        this.dead = false;
        if (o && o.patrol) { // dron de patrulla (fases del editor): va y viene sin salir nunca
            this.patrol = true; this.x = o.x; this.y = o.y; this.vx = o.dir * (2.2 + level * 0.15);
            return;
        }
        const rSide = (o && o.rSide !== undefined) ? o.rSide : Math.random();
        const rY = (o && o.rY !== undefined) ? o.rY : Math.random();
        this.x = rSide > 0.5 ? -this.w : width;
        this.y = player.y - 300 - rY * 400;
        this.vx = (this.x < 0 ? 1 : -1) * (2 + level * 0.2);
    }
    update() {
        if (this.dead) return false;
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
        ctx.shadowBlur = 15; ctx.shadowColor = this.color;
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.w, this.h);
        // "Ojos" del drone
        ctx.fillStyle = '#fff';
        ctx.fillRect(this.x + 5, this.y + 5, 5, 5);
        ctx.fillRect(this.x + this.w - 10, this.y + 5, 5, 5);
        ctx.restore();
    }
}

class PowerUp {
    constructor(x, y, type) {
        this.x = x; this.y = y; this.type = type; // 'shield', 'doubleJump'
        this.size = 20;
        this.bob = 0;
    }
    update() {
        this.bob = Math.sin(Date.now() / 300) * 5;
        const dx = (this.x + this.size / 2) - (player.x + player.w / 2);
        const dy = (this.y + this.size / 2 + this.bob) - (player.y + player.h / 2);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 30) {
            if (this.type === 'shield') { hasShield = true; showFeedback("¡ESCUDO ACTIVADO!"); }
            if (this.type === 'doubleJump') { canDoubleJump = true; showFeedback("¡SALTO DOBLE DISPONIBLE!"); }
            return false;
        }
        return true;
    }
    draw() {
        ctx.save();
        const col = this.type === 'shield' ? THEME.shield : THEME.doubleJump;
        ctx.shadowBlur = 20; ctx.shadowColor = col;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(this.x + this.size / 2, this.y + this.size / 2 + this.bob, this.size / 2, 0, Math.PI * 2);
        ctx.fill();
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

function useShield() {
    hasShield = false;
    player.vy = -15;
    player.vx = 0;
    player.y = player.currentPlatform ? player.currentPlatform.y - 200 : height / 2;
    player.x = player.currentPlatform ? player.currentPlatform.x + player.currentPlatform.w / 2 : width / 2;
    showFeedback("¡ESCUDO USADO!");
    createExplosion(player.x, player.y, 1.0);
}

function initPlatforms(startLevel = 1) {
    platforms = [];
    props = [];
    obstacles = [];
    powerups = [];
    blackHoles = [];
    particles = [];
    aim.cancel();
    originY = null; player.rocket = false;
    level = Math.max(1, startLevel);
    runFirstLevel = level; rubberBoostUsed = false; bombRocket = false;
    boxType = chosenBox; if (boxType === 'mystery') pickMysteryBehavior(); // la caja elegida vale para los 3 primeros niveles
    cameraScroll = 0;
    platformsInLevel = levelPlatformCount();
    platformsReached = 0; totalPlatformGlobalCount = 0;
    combo = 0; rollEnvironment(false);
    hasShield = false; canDoubleJump = false; doubleJumpUsed = false;
    cancelReels(); inventory = []; chests = []; tombstones = []; usedTombPhrases.clear(); lastPlatIdx = 0; resetRescue(); armBomb(); updateInventoryUI();
    ballSpeedFactor = 1.0; greenPowerActive = 0; platformItemActive = false; bombActive = false;
    if (clockTimeoutId) { clearTimeout(clockTimeoutId); clockTimeoutId = null; }

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
        rPow = R(), rPowType = R(), rBH = R(), rBHx = R(), rBHr = R(), rProp = R(), rPw = R(), rPh = R(), rPx = R(), rHue = R(), rChest = R(), rChestT = R();

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

    const platform = new Platform(nextX, nextY, nextW, 20, forceGoal, type, rDirX > 0.5, rDirY > 0.5);
    platforms.push(platform);
    platform.idx = platforms.length - 1;

    // Cofre (se abre al aterrizar en esta plataforma)
    if (!forceGoal && type !== 'flash' && rChest < CHEST_CHANCE) chests.push(new Chest(platform, 0.12 + rChestT * 0.76));

    // Obstáculos (Nivel 15+)
    if (level >= 15 && rObs < 0.3) obstacles.push(new Obstacle({ rSide: rObsSide, rY: rObsY }));

    // Power-ups (Nivel 18+)
    if (level >= 18 && rPow < 0.15 && !hasShield && !canDoubleJump) {
        powerups.push(new PowerUp(nextX + nextW / 2 - 10, nextY - 50, rPowType > 0.5 ? 'shield' : 'doubleJump'));
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
    setLevelHUD();
    rubberBoostUsed = false;
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
        (wasBombBox && boxType !== 'mystery' ? "\n💣 ¡Bomba desactivada!" : "") + boxMsg);

    // Guardado automático cada 5 niveles (checkpoint) — solo en la partida normal
    if (gameMode === 'normal' && level % 5 === 0 && window.BJFirebase && window.BJFirebase.isSignedIn()) {
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
    width = canvas.width = canvas.offsetWidth;
    height = canvas.height = canvas.offsetHeight;
    precisionSystem.init();
}

function showFeedback(text) {
    let color = "#fff";
    if (text.includes("PERFECT")) color = "#00ff00";
    else if (text.includes("GOOD")) color = "#ffff00";
    else if (text.includes("POOR")) color = "#ff4400";
    else if (text.includes("EXTRA")) color = "#00f2ff";
    msgText.innerText = text;
    msgText.style.color = color;
    msgOverlay.classList.remove('hidden');
    msgText.style.animation = 'none';
    msgText.offsetHeight;
    msgText.style.animation = null;
}

function createExplosion(x, y, multiplier) {
    const amount = 5 + multiplier * 25;
    const color = multiplier > 0.9 ? '#00ff00' : (multiplier > 0.6 ? '#ffff00' : '#ff0000');
    for (let i = 0; i < amount; i++) {
        particles.push({ x, y, vx: (Math.random() - 0.5) * 15, vy: (Math.random() - 0.5) * 15, life: 1.0, color });
    }
}

// Calcula los parámetros del salto (sin ejecutarlo). Se calcula UNA vez para que
// el azar del tier POOR no cambie mientras el jugador apunta.
function computeJump(precision) {
    const { multiplier, tier } = precision;
    if (!player.onGround || multiplier <= 0) return null;
    const candidates = platforms.filter(p => p.y < player.y).sort((a, b) => b.y - a.y);
    if (candidates.length === 0) return null;
    // Psicodélica + zona verde: salta directo a la 3.ª plataforma por encima (o a la meta)
    const target = (boxKind() === 'psychedelic' && tier === "PERFECT") ? (psychedelicTarget() || candidates[0]) : candidates[0];
    const distY = player.y - target.y + player.h;

    const targetMultiplier = (tier === "PERFECT") ? 1.08 : (tier === "GOOD" ? 1.45 : (Math.random() > 0.5 ? 2.0 : 0.4));
    const g = effGrav(); // gravedad propia de la caja (la ligera cae más despacio)
    const vy = -Math.sqrt(2 * g * distY) * targetMultiplier;

    const tRise = Math.abs(vy / g);
    const hMax = (vy * vy) / (2 * g);
    const hFall = hMax - distY;
    const tFall = Math.sqrt(Math.max(0, 2 * hFall / g));
    const totalT = tRise + tFall;

    const dx = (target.x + target.w / 2) - (player.x + player.w / 2);
    return { vy, vxBase: dx / totalT, totalT, target, tier };
}

function launchPlayer(j, vx) {
    player.vy = j.vy;
    player.vx = vx;
    player.onGround = false;
    player.bouncesLeft = 2;
    player.angularVelocity = (j.tier === "PERFECT" ? 0.15 : (j.tier === "GOOD" ? 0.35 : 0.6));
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
                if (x + player.w > p.x && x < p.x + p.w && bottom >= p.y && bottom <= p.y + p.h + 10) {
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
        ctx.font = 'bold 12px Outfit, Inter, sans-serif';
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
    ctx.font = 'bold 10px Outfit, Inter, sans-serif';
    ctx.fillText('VIENTO', cx, y - 12);
    ctx.strokeStyle = '#00f2ff'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowBlur = 10; ctx.shadowColor = '#00f2ff';
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

    // Colisión Jugador con Obstáculos
    let shieldConsumedThisFrame = false;
    obstacles.forEach(obs => {
        if (player.x + player.w > obs.x && player.x < obs.x + obs.w &&
            player.y + player.h > obs.y && player.y < obs.y + obs.h) {
            if (hasShield || shieldConsumedThisFrame) {
                if (hasShield) useShield();
                shieldConsumedThisFrame = true;
                obs.x = -1000; obs.dead = true; // Eliminar obstáculo
            } else {
                endGame();
            }
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
        if (player.vy >= 0 && player.x + player.w > p.x && player.x < p.x + p.w &&
            player.y + player.h >= p.y && player.y + player.h <= p.y + p.h + 10) {

            // Item Bomba se ha movido a triggerAction para elección manual
            const impact = player.vy;
            player.y = p.y - player.h;
            let bounced = false;
            if (boxKind() === 'rubber' && impact > 6 && player.bouncesLeft > 0) { // caja de goma: rebota (cada vez menos)
                bounced = true; player.bouncesLeft--;
                player.vy = -impact * 0.45; player.vx *= 0.25; player.angularVelocity = 0;
                player.squash = 1;
                createExplosion(player.x + player.w / 2, p.y, 0.3);
            } else if (boxKind() === 'rubber') {
                player.bouncesLeft = 2;
                if (impact > 3) player.squash = Math.min(1, impact / 12);
            }
            if (boxKind() === 'heavy' && impact > 8) landingBurst(p, '#9aa7ba', 10); // caja pesada: nube de polvo
            player.onGround = !bounced;
            if (player.currentPlatform !== p) {
                // Al aterrizar en plataforma móvil, anular velocidad lateral (Punto 2)
                if (p.type === 'moving') player.vx = 0;

                player.currentPlatform = p;
                lastPlatIdx = p.idx;
                platformsReached++;
                doubleJumpUsed = false; // Reset salto doble al tocar suelo
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
                    p.startTime = Date.now();
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
                    doubleJumpUsed = false;
                    showFeedback("¡RESORTE! 🚀");
                    createExplosion(p.x + p.w / 2, p.y, 0.8);
                }
                if (p.isGoal) {
                    const wasBomb = boxKind() === 'bomb';
                    nextLevel();
                    if (wasBomb && !runEnded) launchBombRocket(); // bomba desactivada: sale disparada
                }
            }
        }
    });
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
function updateBombBox(dtSec) {
    if (boxKind() !== 'bomb' || runEnded) return;
    bombFuse -= dtSec;
    if (bombFuse > 0) return;
    createExplosion(player.x + player.w / 2, player.y + player.h / 2, 2);
    if (hasShield) {
        useShield(); armBomb(); bombFuse = BOMB_FUSE_SECONDS / 2;
        showFeedback('💥 ¡LA BOMBA ESTALLA!\nEl escudo te salva (10 s más)');
    } else {
        showFeedback('💥 ¡BOOM!');
        endGame();
    }
}
function drawBombRing() {
    if (boxKind() !== 'bomb' || boxType === 'mystery' || runEnded) return;
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
const isLavaLevel = () => (gameMode === 'normal' || gameMode === 'daily') && level % LAVA_EVERY === 0;

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
            useShield();
            lava.timer = LAVA_RISE_EVERY; lava.y = lava.targetY = height + 30;
            showFeedback('🛡️ ¡EL ESCUDO TE SALVA DE LA LAVA!');
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
    ctx.font = 'bold 12px Outfit, Inter, sans-serif';
    if (lava.active) {
        const t = Math.max(0, lava.timer);
        const danger = t < 3;
        const pulse = 0.65 + 0.35 * Math.sin(performance.now() / (danger ? 90 : 220));
        ctx.fillStyle = `rgba(255,${danger ? 70 : 150},40,${pulse})`;
        ctx.fillText('🌋 LA LAVA SUBE EN ' + t.toFixed(1) + ' s', width / 2, y);
        y += 20;
    }
    if (boxKind() === 'bomb' && boxType !== 'mystery' && !runEnded) {
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

// ===================== RESCATE EN EL ÚLTIMO SEGUNDO (QTE) =====================
function resetRescue() {
    rescue.active = false; rescue.usedThisLevel = false; rescue.phase = 'idle';
    rescue.step = 0; rescue.elapsed = 0; rescue.btn = null; rescue.prev = null; rescue.target = null; rescue.rise = null;
}
const rescueRadius = () => RESCUE_START_R * Math.max(0, 1 - rescue.elapsed / RESCUE_TIME);

// Plataforma a la que subirá la caja: la más ALTA de las que se ven en pantalla, sin plataformas con movimiento.
function rescueTarget() {
    const c = platforms.filter((p) => !p.isBroken && p.type !== 'moving' && p.type !== 'oscillating' &&
        p.type !== 'flash' && p.type !== 'temp_full' && p.y >= 0 && p.y < player.y);
    c.sort((a, b) => a.y - b.y); // menor y = más arriba
    return c[0] || null;
}
function platformBelow() {
    const feet = player.y + player.h;
    return platforms.some((p) => !p.isBroken && !(p.type === 'flash' && !p.isVisible) && p.y >= feet - 4 &&
        player.x + player.w + 14 > p.x && player.x - 14 < p.x + (p.type === 'temp_full' ? width : p.w));
}
function maybeStartRescue() {
    if (rescue.active || rescue.usedThisLevel || runEnded || hasShield || bombActive) return false;
    if (player.onGround || player.vy <= 1) return false;                 // solo cayendo
    if (player.y + player.h < height * RESCUE_TRIGGER) return false;     // aún queda mucha caída
    if (platformBelow()) return false;                                   // hay algo que te recoja
    if (!rescueTarget()) return false;                                   // y debe haber plataforma a la que subir
    rescue.active = true; rescue.usedThisLevel = true;
    rescue.phase = 'qte'; rescue.step = 0; rescue.prev = null;
    rescue.target = rescueTarget();
    newRescueButton();
    showFeedback('🆘 ¡RESCATE!\nPulsa cuando el aro encaje');
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
        if (last) rescueSuccess(); else newRescueButton();
    } else {
        rescueFail(rescueRadius() > RESCUE_TARGET_R ? '¡TEMPRANO!' : '¡TARDE!');
    }
}
function rescueFail(msg) {
    rescue.active = false; rescue.phase = 'idle'; rescue.btn = null;
    showFeedback(msg + ' 💀');
    createExplosion(player.x + player.w / 2, player.y + player.h / 2, 0.2);
}
function rescueSuccess() {
    const t = (rescue.target && !rescue.target.isBroken) ? rescue.target : rescueTarget();
    if (!t) { rescueFail('¡SIN PLATAFORMA!'); return; }
    rescue.phase = 'rise'; rescue.btn = null;
    rescue.rise = {
        t: 0, dur: 750, x0: player.x, y0: player.y,
        x1: Math.max(0, Math.min(width - player.w, t.x + t.w / 2 - player.w / 2)), y1: t.y - player.h,
        spin: Math.PI * 2 * (player.x < t.x ? 1 : -1)
    };
    player.vx = 0; player.vy = 0; player.angularVelocity = 0;
    showFeedback('🎆 ¡RESCATE PERFECTO!');
}
function rescueLand() {
    const r = rescue.rise;
    player.x = r.x1; player.y = r.y1; player.vx = 0; player.vy = 0;
    player.rotation = 0; player.angularVelocity = 0; player.onGround = false; player.bouncesLeft = 2;
    rescue.active = false; rescue.phase = 'idle'; rescue.rise = null;
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
        player.x = r.x0 + (r.x1 - r.x0) * e;
        player.y = r.y0 + (r.y1 - r.y0) * e;
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
    if (!rescue.active) return;
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

// --- CÁMARA en saltos muy grandes ---
// La plataforma de la que sale el jugador se mantiene visible abajo del todo
// mientras dure el salto (sin zoom). Se sigue la plataforma aunque desaparezca.
const ORIGIN_BOTTOM_MARGIN = 34;   // hueco mínimo bajo la plataforma de origen
const PLAYER_MIN_Y = 0.12;         // el jugador nunca sube por encima de este % de la pantalla
let originY = null;

function update() {
    const nowT = performance.now();
    const dtMs = Math.min(50, nowT - lastUpdateT); lastUpdateT = nowT; // el tiempo en pausa/apuntando no cuenta
    if (!gameActive) return;
    if (aim.active) { aim.update(); updateParticles(); return; } // mundo congelado mientras se apunta
    if (rescue.active) { updateRescue(dtMs); updateParticles(); return; } // rescate: mundo congelado
    if (maybeStartRescue()) { updateParticles(); return; }
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
    }

    trackHeight();
    updateParticles();
}

function draw() {
    ctx.clearRect(0, 0, width, height);

    // Grid de fondo dinámico
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    const offset = (player.y % 40);
    for (let i = -40; i < height + 40; i += 40) {
        ctx.beginPath(); ctx.moveTo(0, i + offset); ctx.lineTo(width, i + offset); ctx.stroke();
    }

    // Efecto Viento
    if (windForce !== 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        for (let i = 0; i < 10; i++) {
            const spd = 0.3 + Math.abs(windForce) * 8;
            const wx = (((Date.now() * spd * Math.sign(windForce) + i * 100) % width) + width) % width;
            ctx.fillRect(wx, (i * height / 10), 50, 2);
        }
    }

    blackHoles.forEach(bh => bh.draw());
    platforms.forEach(p => p.draw());
    chests.forEach(c => c.draw());
    tombstones.forEach(t => t.draw());
    powerups.forEach(pu => pu.draw());
    props.forEach(pr => pr.draw());
    obstacles.forEach(o => o.draw());
    drawLava();
    player.draw();
    drawBombRing();

    // UI del Escudo / Powerups
    if (hasShield) {
        ctx.strokeStyle = THEME.shield;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(player.x + player.w / 2, player.y + player.h / 2, 35, 0, Math.PI * 2);
        ctx.stroke();
    }
    if (canDoubleJump) {
        ctx.fillStyle = THEME.doubleJump;
        ctx.font = "bold 12px Arial";
        ctx.fillText("2J READY", player.x, player.y - 10);
    }

    particles.forEach(p => {
        const sz = p.size || 4;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        if (p.fire) ctx.globalCompositeOperation = 'lighter';
        ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
        if (p.fire) ctx.globalCompositeOperation = 'source-over';
    });
    ctx.globalAlpha = 1;

    precisionSystem.draw();
    drawWindHUD();
    drawStatusHUD();
    drawRescue();
    aim.draw();
}

function gameLoop() { update(); draw(); requestAnimationFrame(gameLoop); }
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
    initPlatforms(cfg ? cfg.first : (resume ? savedGameData.level : 1));
    setLevelHUD();
    updateHeightDisplay();
    precisionSystem.spawnBall();
}
function endGame() { finishRun(false); }

// Fin de partida (derrota o fase completada). En los modos especiales, el modo decide
// qué se guarda y qué botones aparecen (modeCfg.onEnd).
function finishRun(completed) {
    if (runEnded) return;
    runEnded = true;
    gameActive = false;
    aim.cancel();
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

    goTitle.innerText = info.title || (completed ? '¡FASE COMPLETADA!' : 'FIN DEL JUEGO');
    goNote.innerText = info.note || '';
    goNote.classList.toggle('hidden', !info.note);
    if (modeCfg) {
        restartBtn.innerText = info.retryText || 'REINTENTAR';
        gameOverNewBtn.classList.add('hidden');
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
    if (!runEnded && gameMode === 'normal' && window.BJFirebase) window.BJFirebase.reportRun(level, heightCm());
    runEnded = true; gameActive = false; bombActive = false; bombRocket = false;
    aim.cancel(); cancelReels(); updateInventoryUI();
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
restartBtn.addEventListener('click', () => (modeCfg ? startGame(false, modeCfg) : startGame(true)));
if (goMenuBtn) goMenuBtn.addEventListener('click', goToMenu);
if (gameOverNewBtn) gameOverNewBtn.addEventListener('click', () => askStart(() => startGame(false)));

const triggerAction = (e) => {
    // Si item bomba está activo (especial: el juego está pausado)
    if (bombActive) {
        // Encontrar si se ha clicado una plataforma
        const rect = canvas.getBoundingClientRect();
        const rawX = (e.clientX || (e.touches ? e.touches[0].clientX : 0)) - rect.left;
        const rawY = (e.clientY || (e.touches ? e.touches[0].clientY : 0)) - rect.top;
        const mouseX = rawX, mouseY = rawY;

        const clickedPlatform = platforms.find(p =>
            !p.isGoal && mouseX > p.x && mouseX < p.x + p.w && mouseY > p.y && mouseY < p.y + p.h
        );

        if (clickedPlatform) {
            clickedPlatform.isBroken = true;
            createExplosion(clickedPlatform.x + clickedPlatform.w / 2, clickedPlatform.y, 1.5);
            bombActive = false;
            gameActive = true;
            showFeedback("¡BOMBA EXPLOTADA!");
            return;
        }
    }

    if (!gameActive) return;

    // Rescate en el último segundo: los toques van a los botones, no a la barra de precisión
    if (rescue.active) {
        const rect = canvas.getBoundingClientRect();
        const pt = (e.touches && e.touches.length) ? e.touches[0] : e;
        rescuePress(pt.clientX - rect.left, pt.clientY - rect.top);
        return;
    }

    // Medidor de ángulo activo: este toque fija el ángulo y lanza
    if (aim.active) { aim.lock(); return; }

    // Caja de goma: un toque sobre la propia caja (1 vez por nivel) la hace botar como una plataforma-resorte
    if (boxKind() === 'rubber' && !rubberBoostUsed) {
        const rect = canvas.getBoundingClientRect();
        const pt = (e.touches && e.touches.length) ? e.touches[0] : e;
        const tx = pt.clientX - rect.left, ty = pt.clientY - rect.top, pad = 22;
        if (tx >= player.x - pad && tx <= player.x + player.w + pad && ty >= player.y - pad && ty <= player.y + player.h + pad) {
            rubberBoost();
            return;
        }
    }

    // Si item plataforma está activo (deprecated por la nueva instrucción de ser instantáneo, 
    // pero lo limpio por si acaso quedaba algo)
    if (platformItemActive) { platformItemActive = false; }

    const precision = precisionSystem.checkHit();
    if (precision.multiplier > 0) {
        if (player.onGround) {
            // Con viento: primero se apunta (medidor de ángulo); sin viento, salto directo
            if (!(effWind() !== 0 && aim.start(precision))) handleJump(precision);
        } else if (canDoubleJump && !doubleJumpUsed) {
            handleJump(precision);
            doubleJumpUsed = true;
            canDoubleJump = false; // Se gasta al usarlo
            showFeedback("¡SALTO DOBLE!");
        }
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

// INVENTARIO (los objetos salen de los cofres; usarlos es gratis)
const game = {
    useItem(index) {
        if (!gameActive || runEnded || aim.active || rescue.active || !inventory[index]) return;
        const type = inventory[index];
        inventory.splice(index, 1);
        updateInventoryUI();

        switch (type) {
            case 'clock':
                ballSpeedFactor = 0.5;
                if (clockTimeoutId) clearTimeout(clockTimeoutId);
                clockTimeoutId = setTimeout(() => { ballSpeedFactor = 1.0; clockTimeoutId = null; }, 10000);
                showFeedback("⏱️ TIEMPO RALENTIZADO!");
                break;
            case 'platform': {
                const newP = new Platform(0, player.y + 120, width, 25, false, 'temp_full');
                newP.vanishingStarted = true; newP.startTime = Date.now();
                platforms.push(newP);
                showFeedback("🏗️ PLATAFORMA CREADA!");
                break;
            }
            case 'power':
                greenPowerActive = 5;
                showFeedback("⚡ ZONA VERDE x5!");
                break;
            case 'bomb':
                bombActive = true;
                gameActive = false;
                showFeedback("💣 TOCA UNA PLATAFORMA PARA EXPLOTARLA");
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

if (settingsFab) settingsFab.addEventListener('click', () => {
    setMenuOpen(false);
    settingsWasPlaying = gameActive;
    gameActive = false;
    settingsModal.classList.remove('hidden');
});
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
};

// --- "¿Cómo quieres empezar?": se muestra DESPUÉS de pulsar el modo de juego ---
function askStart(onGo) {
    const scr = document.getElementById('start-choice-screen');
    if (!scr) { onGo(); return; }
    const go = document.getElementById('start-choice-go'), back = document.getElementById('start-choice-back');
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
        const lb = document.createElement('span'); lb.textContent = BOX_TYPES[key].name;
        el.appendChild(cv); el.appendChild(lb);
        el.addEventListener('click', () => selectBox(key));
        wrap.appendChild(el);
        items.push({ key, el, cv });
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
    function selectBox(key) {
        chosenBox = key; boxType = key;
        try { localStorage.setItem('boxjump_box_type', key); } catch (e) { /* no disponible */ }
        items.forEach((i) => i.el.classList.toggle('active', i.key === key));
        if (desc) desc.textContent = BOX_TYPES[key].desc;
        paint();
    }
    selectBox(chosenBox);
    const choiceScreen = document.getElementById('start-choice-screen');
    setInterval(() => { if (choiceScreen && !choiceScreen.classList.contains('hidden')) paint(); }, 90); // alas y mechas animadas
}
initBoxPicker();

gameLoop();
