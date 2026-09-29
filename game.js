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
const shopFab = document.getElementById('shop-fab');
const shopModal = document.getElementById('shop-modal');
const closeShopBtn = document.getElementById('close-shop-btn');
const comboContainer = document.getElementById('combo-container');
const comboValueEl = document.getElementById('combo-value');
const bestValueEl = document.getElementById('best-value');

// CONFIGURACIÓN GLOBAL
let width, height;
let gameActive = false;
let score = 0;
let level = 1;
let platformsInLevel = 5;
let platformsReached = 0;
let totalPlatformGlobalCount = 0;
let platforms = [];
let props = [];
let particles = [];

// Mejor puntuación histórica (persistida en este navegador)
let bestScore = 0;
try {
    bestScore = parseInt(localStorage.getItem('boxjump_best_score'), 10) || 0;
} catch (e) { bestScore = 0; }
if (bestValueEl) bestValueEl.innerText = bestScore;

// Partida guardada (checkpoint cada 5 niveles), recibida al iniciar sesión
let savedGameData = null;

function updateStartScreenUI() {
    const hasCheckpoint = !!(savedGameData && savedGameData.level > 1);
    if (startBtn) {
        startBtn.innerText = hasCheckpoint ? `CONTINUAR (Nivel ${savedGameData.level})` : 'EMPEZAR';
    }
    if (newGameBtn) {
        newGameBtn.classList.toggle('hidden', !hasCheckpoint);
    }
    if (restartBtn) {
        restartBtn.innerText = hasCheckpoint ? `CONTINUAR (Nivel ${savedGameData.level})` : 'REINTENTAR';
    }
    if (gameOverNewBtn) {
        gameOverNewBtn.classList.toggle('hidden', !hasCheckpoint);
    }
}

function updateScoreDisplay() {
    scoreValue.innerText = score;
    if (score > bestScore) {
        bestScore = score;
        try { localStorage.setItem('boxjump_best_score', String(bestScore)); } catch (e) { /* almacenamiento no disponible */ }
    }
    bestValueEl.innerText = bestScore;
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
function rollWind() {
    if (level < 12) return 0;
    return (Math.random() < 0.5 ? -1 : 1) * (0.025 + Math.random() * 0.055);
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

    update() {
        // Viento si no está en el suelo
        if (!this.onGround) {
            if (!this.straightBounce) this.vx += windForce;
            this.vy += this.gravity * gravityFactor;
            this.rotation += this.angularVelocity;
        } else {
            this.vy = 0;
            this.straightBounce = false;
            // Fricción según plataforma
            let friction = 0.85;
            if (this.currentPlatform && this.currentPlatform.type === 'ice') friction = 0.98;
            if (this.currentPlatform && (this.currentPlatform.type === 'sticky' || this.currentPlatform.type === 'mini_sticky')) friction = 0;

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

        if (this.x < 0) this.x = 0;
        if (this.x + this.w > width) this.x = width - this.w;

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
        ctx.shadowBlur = 15;
        ctx.shadowColor = this.color;
        ctx.fillStyle = this.color;
        ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.strokeRect(-this.w / 2 + 2, -this.h / 2 + 2, this.w - 4, this.h - 4);
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

    spawnBall() {
        this.ball.x = this.canal.x + this.canal.w / 2;
        this.ball.y = -50;
        this.ball.active = true;

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
        this.ball.speed = (5 + (Math.min(score, 6000) * 0.004) + (difficultyFactor * 2.5)) + randomVariance;
        if (this.ball.speed < 4) this.ball.speed = 4;
        if (this.ball.speed > 16) this.ball.speed = 16;
    },

    update() {
        if (!this.ball.active) return;
        this.ball.y += this.ball.speed * ballSpeedFactor;
        if (this.ball.y > height + this.ball.radius) {
            this.ball.active = false;
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
            const currentGreenScale = greenPowerActive > 0 ? Math.min(1.0, this.targetArea.greenScale * 5) : this.targetArea.greenScale;
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

            // Bono por combo
            const comboBonus = 1 + (combo > 1 ? combo * 0.1 : 0);
            const points = Math.round(subScore * 100 * comboBonus);
            score += points;
            updateScoreDisplay();
            updateComboDisplay();

            let feedback = tier + (tier === "PERFECT" ? ` x${Math.round(subScore * 5)}` : "") + " +" + points;
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
        const currentGreenScale = greenPowerActive > 0 ? Math.min(1.0, this.targetArea.greenScale * 5) : this.targetArea.greenScale;
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

        if (this.ball.active) {
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
            const extraPoints = Math.round(50 * this.weight);
            score += extraPoints;
            updateScoreDisplay();
            showFeedback("+PUNTOS EXTRA! +" + extraPoints);
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
    constructor(x, y, w, h, isGoal = false, type = 'normal') {
        this.x = x; this.y = y; this.w = w; this.h = h;
        this.isGoal = isGoal;
        this.type = type; // 'normal', 'vanishing', 'moving', 'ice', 'sticky', 'fragile'
        this.alpha = 1.0;
        this.vanishingStarted = false;
        this.startTime = 0;
        this.vx = (type === 'moving') ? (Math.random() > 0.5 ? 2 : -2) * (1 + level * 0.1) : 0;
        this.vy = (type === 'oscillating') ? (Math.random() > 0.5 ? 1.5 : -1.5) * (1 + level * 0.1) : 0;
        this.isBroken = false;
        this.isPaused = false;
        this.pauseTimer = 0;
        this.oscOffset = 0;
        this.isVisible = true;

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
    constructor() {
        this.w = 40; this.h = 20;
        this.x = Math.random() > 0.5 ? -this.w : width;
        this.y = player.y - 300 - Math.random() * 400;
        this.vx = (this.x < 0 ? 1 : -1) * (2 + level * 0.2);
        this.color = THEME.obstacle;
    }
    update() {
        this.x += this.vx;
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
    constructor(x, y) {
        this.x = x; this.y = y; this.radius = 30 + Math.random() * 20;
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

function useShield() {
    hasShield = false;
    player.vy = -15;
    player.vx = 0;
    player.y = player.currentPlatform ? player.currentPlatform.y - 200 : height / 2;
    player.x = player.currentPlatform ? player.currentPlatform.x + player.currentPlatform.w / 2 : width / 2;
    showFeedback("¡ESCUDO USADO!");
    createExplosion(player.x, player.y, 1.0);
}

function initPlatforms(startLevel = 1, startScore = 0) {
    platforms = [];
    props = [];
    obstacles = [];
    powerups = [];
    blackHoles = [];
    particles = [];
    aim.cancel();
    level = Math.max(1, startLevel);
    score = Math.max(0, startScore);
    platformsInLevel = 5 + Math.floor(level / 2);
    platformsReached = 0; totalPlatformGlobalCount = 0;
    combo = 0; windForce = rollWind(); gravityFactor = 1.0;
    hasShield = false; canDoubleJump = false; doubleJumpUsed = false;
    inventory = []; updateInventoryUI();
    ballSpeedFactor = 1.0; greenPowerActive = 0; platformItemActive = false; bombActive = false;
    if (clockTimeoutId) { clearTimeout(clockTimeoutId); clockTimeoutId = null; }

    levelValue.innerText = level;
    updateScoreDisplay();
    updateComboDisplay();

    const startCx = width / 2 + (precisionSystem.side === 'left' ? 30 : 0);
    platforms.push(new Platform(startCx - 50, height - 150, 100, 20));
    player.x = startCx - player.w / 2;
    player.y = height - 150 - player.h;
    player.vx = 0;
    player.vy = 0;
    player.rotation = 0;
    player.angularVelocity = 0;
    player.onGround = true;
    player.currentPlatform = platforms[0];
    for (let i = 1; i < platformsInLevel; i++) {
        spawnNextPlatform(i === platformsInLevel - 1);
    }
}

function spawnNextPlatform(forceGoal = false) {
    const last = platforms[platforms.length - 1];
    const marginY = 110 + Math.random() * 90;
    const nextY = last.y - marginY;
    const nextW = Math.max(50, 80 + Math.random() * 40 - (level * 0.5));
    // Deja libre el lado donde está la barra de precisión
    const nextX = (precisionSystem.side === 'left' ? 50 : 30) + Math.random() * (width - nextW - 80);

    totalPlatformGlobalCount++;

    // DETERMINAR TIPO DE PLATAFORMA
    let type = 'normal';
    if (!forceGoal) {
        const rand = Math.random();
        if (level >= 6 && totalPlatformGlobalCount % 10 === 0) type = 'vanishing';
        else if (level >= 27 && rand < 0.06) type = 'flash';
        else if (level >= 22 && rand < 0.14) type = 'fragile';
        else if (level >= 16 && rand < 0.22) type = 'mini_sticky';
        else if (level >= 12 && rand < 0.32) type = (Math.random() > 0.5 ? 'ice' : 'sticky');
        else if (level >= 6 && rand < 0.40) type = 'spring';
        else if (level >= 8 && rand < 0.55) type = 'moving';
    }

    const platform = new Platform(nextX, nextY, nextW, 20, forceGoal, type);
    platforms.push(platform);

    // Obstáculos (Nivel 15+)
    if (level >= 15 && Math.random() < 0.3) {
        obstacles.push(new Obstacle());
    }

    // Power-ups (Nivel 18+)
    if (level >= 18 && Math.random() < 0.15 && !hasShield && !canDoubleJump) {
        powerups.push(new PowerUp(nextX + nextW / 2 - 10, nextY - 50, Math.random() > 0.5 ? 'shield' : 'doubleJump'));
    }

    // Agujeros Negros (Nivel 25+)
    if (level >= 25 && Math.random() < 0.1) {
        blackHoles.push(new BlackHole(Math.random() * width, nextY - 100));
    }

    // Props (Cajas)
    if (!forceGoal && Math.random() < 0.3) {
        const propW = 15 + Math.random() * 20;
        const propH = 15 + Math.random() * 20;
        const propX = nextX + Math.random() * (nextW - propW);
        const propCol = `hsl(${200 + Math.random() * 30}, 80%, 60%)`;
        props.push(new Prop(propX, nextY - propH, propW, propH, propCol));
    }
}

function nextLevel() {
    level++;
    levelValue.innerText = level;

    // Configuración ambiental según nivel
    windForce = rollWind();
    gravityFactor = (level >= 30 && Math.random() < 0.3) ? 0.4 : 1.0; // Baja gravedad ocasional en modo Caos

    platformsInLevel = 5 + Math.floor(level / 2);
    platformsReached = 0;
    showFeedback("¡NIVEL " + level + "!" + (windForce !== 0 ? "\n¡CUIDADO CON EL VIENTO!" : "") + (gravityFactor < 1 ? "\n¡GRAVEDAD BAJA!" : ""));

    // Guardado automático cada 5 niveles (checkpoint)
    if (level % 5 === 0 && window.BJFirebase && window.BJFirebase.isSignedIn()) {
        window.BJFirebase.saveProgress(score, level);
        // Actualizamos el estado local al instante: no hace falta esperar a
        // un nuevo evento de login para poder "continuar" desde aquí.
        savedGameData = { score, level };
        updateStartScreenUI();
    }

    const current = player.currentPlatform;
    platforms = [current];
    props = [];
    obstacles = [];
    powerups = [];
    // Mantener agujeros negros si están cerca
    blackHoles = blackHoles.filter(bh => Math.abs(bh.y - player.y) < height);

    for (let i = 1; i < platformsInLevel; i++) {
        spawnNextPlatform(i === platformsInLevel - 1);
    }
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
    const target = candidates[0];
    const distY = player.y - target.y + player.h;

    const targetMultiplier = (tier === "PERFECT") ? 1.08 : (tier === "GOOD" ? 1.45 : (Math.random() > 0.5 ? 2.0 : 0.4));
    const vy = -Math.sqrt(2 * player.gravity * distY) * targetMultiplier;

    const tRise = Math.abs(vy / player.gravity);
    const hMax = (vy * vy) / (2 * player.gravity);
    const hFall = hMax - distY;
    const tFall = Math.sqrt(Math.max(0, 2 * hFall / player.gravity));
    const totalT = tRise + tFall;

    const dx = (target.x + target.w / 2) - (player.x + player.w / 2);
    return { vy, vxBase: dx / totalT, totalT, target, tier };
}

function launchPlayer(j, vx) {
    player.vy = j.vy;
    player.vx = vx;
    player.onGround = false;
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
        const prevBottom = y + player.h;
        vx += windForce;
        vy += player.gravity * gravityFactor;
        x += vx; y += vy;
        if (x < 0) x = 0;
        if (x + player.w > width) x = width - player.w;
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
        this.range = Math.max(0.8, 0.5 * Math.abs(windForce) * T * 1.6, hitHalfVx * 2.2);
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
            ctx.strokeRect(land.x - player.w / 2, land.y - player.h, player.w, player.h);
            ctx.globalAlpha = 0.15 * pulse + 0.1; ctx.fillStyle = col;
            ctx.fillRect(land.x - player.w / 2, land.y - player.h, player.w, player.h);
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
                obs.x = -1000; // Eliminar obstáculo
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
            player.y = p.y - player.h;
            player.onGround = true;
            if (player.currentPlatform !== p) {
                // Al aterrizar en plataforma móvil, anular velocidad lateral (Punto 2)
                if (p.type === 'moving') player.vx = 0;

                player.currentPlatform = p;
                platformsReached++;
                doubleJumpUsed = false; // Reset salto doble al tocar suelo
                if ((p.type === 'vanishing' || p.type === 'fragile') && !p.vanishingStarted) {
                    p.vanishingStarted = true;
                    p.startTime = Date.now();
                }
                if (p.type === 'spring') {
                    // Resorte: rebote automático hacia arriba, no requiere precisión del jugador
                    const distY = 220;
                    player.vy = -Math.sqrt(2 * player.gravity * distY) * 1.4;
                    player.vx = 0;            // rebote vertical, sin ángulo
                    player.straightBounce = true; // sin viento hasta volver a tocar suelo
                    player.onGround = false;
                    player.angularVelocity = 0.25;
                    doubleJumpUsed = false;
                    showFeedback("¡RESORTE! 🚀");
                    createExplosion(p.x + p.w / 2, p.y, 0.8);
                }
                if (p.isGoal) nextLevel();
            }
        }
    });
}

function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy; p.life -= 0.02;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

function update() {
    if (!gameActive) return;
    if (aim.active) { aim.update(); updateParticles(); return; } // mundo congelado mientras se apunta
    player.update();
    precisionSystem.update();

    // Actualizar entidades
    obstacles = obstacles.filter(obs => obs.update());
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

    const cameraThreshold = height * 0.4;
    if (player.y < cameraThreshold) {
        const diff = cameraThreshold - player.y;
        player.y += diff;
        platforms.forEach(p => p.y += diff);
        props.forEach(pr => pr.y += diff);
        obstacles.forEach(o => o.y += diff);
        powerups.forEach(pu => pu.y += diff);
        blackHoles.forEach(bh => bh.y += diff);
    }

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
    powerups.forEach(pu => pu.draw());
    props.forEach(pr => pr.draw());
    obstacles.forEach(o => o.draw());
    player.draw();
    precisionSystem.draw();
    drawWindHUD();
    aim.draw();

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
        ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 4, 4);
    });
    ctx.globalAlpha = 1;
}

function gameLoop() { update(); draw(); requestAnimationFrame(gameLoop); }
function startGame(continueGame = false) {
    // Hay que iniciar sesión con Google antes de poder jugar
    if (window.BJFirebase && !window.BJFirebase.isSignedIn()) {
        window.BJFirebase.promptSignIn();
        return;
    }
    gameActive = true;
    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    if (rankingFab) rankingFab.classList.remove('hidden');

    const resume = continueGame && savedGameData && savedGameData.level > 1;
    initPlatforms(resume ? savedGameData.level : 1, resume ? (savedGameData.score || 0) : 0);
    levelValue.innerText = level;
    updateScoreDisplay();
    precisionSystem.spawnBall();
}
function endGame() {
    gameActive = false;
    finalScore.innerText = score;
    finalLevel.innerText = level;
    gameOverScreen.classList.remove('hidden');
    if (rankingFab) rankingFab.classList.add('hidden');
    updateStartScreenUI();
    if (window.BJFirebase) window.BJFirebase.reportScore(score, level);
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

// Si el mejor puntaje remoto (Firebase) es mayor que el local, lo adoptamos.
// También recibimos aquí la partida guardada (checkpoint) para ofrecer "Continuar".
window.addEventListener('bj-auth-changed', (e) => {
    if (e.detail && e.detail.signedIn) {
        if (typeof e.detail.bestScore === 'number' && e.detail.bestScore > bestScore) {
            bestScore = e.detail.bestScore;
            try { localStorage.setItem('boxjump_best_score', String(bestScore)); } catch (err) { /* no disponible */ }
        }
        if (bestValueEl) bestValueEl.innerText = bestScore;
        savedGameData = e.detail.savedGame || null;
    } else {
        savedGameData = null;
    }
    updateStartScreenUI();
});

window.addEventListener('resize', resize);
resize();
startBtn.addEventListener('click', () => startGame(true));
if (newGameBtn) newGameBtn.addEventListener('click', () => startGame(false));
restartBtn.addEventListener('click', () => startGame(true));
if (gameOverNewBtn) gameOverNewBtn.addEventListener('click', () => startGame(false));

const triggerAction = (e) => {
    // Si item bomba está activo (especial: el juego está pausado)
    if (bombActive) {
        // Encontrar si se ha clicado una plataforma
        const rect = canvas.getBoundingClientRect();
        const mouseX = (e.clientX || (e.touches ? e.touches[0].clientX : 0)) - rect.left;
        const mouseY = (e.clientY || (e.touches ? e.touches[0].clientY : 0)) - rect.top;

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

    // Medidor de ángulo activo: este toque fija el ángulo y lanza
    if (aim.active) { aim.lock(); return; }

    // Si item plataforma está activo (deprecated por la nueva instrucción de ser instantáneo, 
    // pero lo limpio por si acaso quedaba algo)
    if (platformItemActive) { platformItemActive = false; }

    const precision = precisionSystem.checkHit();
    if (precision.multiplier > 0) {
        if (player.onGround) {
            // Con viento: primero se apunta (medidor de ángulo); sin viento, salto directo
            if (!(windForce !== 0 && aim.start(precision))) handleJump(precision);
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
    e.target.closest('button, input, textarea, a, .screen, #hud-menu, #shop-fab, #ranking-fab, #settings-fab, #shop-modal, #ranking-modal, .inv-slot'));
window.addEventListener('mousedown', (e) => {
    if (isUiTarget(e)) return;
    triggerAction(e);
});
window.addEventListener('touchstart', (e) => {
    if (isUiTarget(e)) return;
    e.preventDefault();
    triggerAction(e);
}, { passive: false });

// SHOP & INVENTORY LOGIC
const game = {
    buyItem(type) {
        if (score < 1000) { showFeedback("¡PUNTOS INSUFICIENTES!"); return; }
        if (inventory.length >= 3) { showFeedback("¡INVENTARIO LLENO!"); return; }

        score -= 1000;
        updateScoreDisplay();
        inventory.push(type);
        updateInventoryUI();
        showFeedback("¡COMPRADO: " + type.toUpperCase() + "!");
    },
    useItem(index) {
        if (aim.active || !inventory[index]) return;
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
            case 'platform':
                const newP = new Platform(0, player.y + 120, width, 25, false, 'temp_full');
                newP.vanishingStarted = true; newP.startTime = Date.now();
                platforms.push(newP);
                showFeedback("🏗️ PLATAFORMA CREADA!");
                break;
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
    for (let i = 0; i < 3; i++) {
        const slot = document.getElementById(`slot-${i}`);
        slot.innerHTML = '';
        if (inventory[i]) {
            const icons = { clock: '⏱️', platform: '🏗️', power: '⚡', bomb: '💣' };
            slot.innerText = icons[inventory[i]];
            slot.onclick = () => game.useItem(i);
        } else {
            slot.onclick = null;
        }
    }
}

const shopInfoBtn = document.getElementById('shop-info-btn');
const shopHelpOverlay = document.getElementById('shop-help-overlay');
const closeHelpBtn = document.getElementById('close-help-btn');

shopFab.onclick = () => { gameActive = false; shopModal.classList.remove('hidden'); };

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
[shopFab, rankingFab].forEach((el) => { if (el) el.addEventListener('click', () => setMenuOpen(false)); });

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

closeShopBtn.onclick = () => { gameActive = true; shopModal.classList.add('hidden'); };

shopInfoBtn.onclick = () => { shopHelpOverlay.classList.remove('hidden'); };
closeHelpBtn.onclick = () => { shopHelpOverlay.classList.add('hidden'); };

window.addEventListener('keydown', (e) => {
    if (e.key === '1') game.useItem(0);
    if (e.key === '2') game.useItem(1);
    if (e.key === '3') game.useItem(2);
});

gameLoop();
