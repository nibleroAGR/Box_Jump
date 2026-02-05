/**
 * BOX JUMP PRECISION - v4 Final
 * Juego de habilidad por niveles, precisión y desafíos temporales.
 */

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreValue = document.getElementById('score-value');
const levelValue = document.getElementById('level-value');
const finalScore = document.getElementById('final-score');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const msgOverlay = document.getElementById('msg-overlay');
const msgText = document.getElementById('msg-text');

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

const THEME = {
    player: '#00f2ff',
    platform: '#1e2d4d',
    platformBright: '#3d5a9d',
    platformVanishing: '#ff00ff',
    ball: '#ff00ea'
};

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
        if (!this.onGround) {
            this.vy += this.gravity;
            this.rotation += this.angularVelocity;
        } else {
            this.vy = 0;
            this.vx *= 0.85;
            this.rotation = 0;
            this.angularVelocity = 0;
        }

        this.x += this.vx;
        this.y += this.vy;

        if (this.x < 0) this.x = 0;
        if (this.x + this.w > width) this.x = width - this.w;

        if (this.y > height) {
            endGame();
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
    canal: { x: 0, y: 0, w: 40, h: 0, rightPadding: 25 },
    targetArea: { y: 0, h: 200, greenScale: 0.2 },

    init() {
        this.canal.w = 40;
        this.canal.x = width - this.canal.w - this.canal.rightPadding;
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

        // Zona verde dinámica
        this.targetArea.greenScale = Math.max(0.05, 0.45 - (difficultyFactor * 0.3));

        const randomVariance = (Math.random() - 0.5) * 1.5;
        this.ball.speed = (5 + (score * 0.005) + (difficultyFactor * 2.5)) + randomVariance;
        if (this.ball.speed < 4) this.ball.speed = 4;
        if (this.ball.speed > 16) this.ball.speed = 16;
    },

    update() {
        if (!this.ball.active) return;
        this.ball.y += this.ball.speed;
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
            const greenLimit = maxDist * this.targetArea.greenScale;
            const yellowLimit = maxDist * 0.65;

            if (dist < greenLimit) {
                tier = "PERFECT"; multiplier = 1.0;
                subScore = Math.ceil((1 - (dist / greenLimit)) * 5) / 5;
                if (subScore < 0.2) subScore = 0.2;
            } else if (dist < yellowLimit) {
                tier = "GOOD"; multiplier = 0.7; subScore = 0.5;
            } else {
                tier = "POOR"; multiplier = 0.4; subScore = 0.2;
            }

            const points = Math.round(subScore * 100);
            score += points;
            scoreValue.innerText = score;
            showFeedback(tier + (tier === "PERFECT" ? ` x${Math.round(subScore * 5)}` : "") + " +" + points);
            createExplosion(this.ball.x, this.ball.y, multiplier);
            this.spawnBall();
            return { multiplier, tier, subScore };
        }
        return { multiplier: 0, tier: "MISSED", subScore: 0 };
    },

    draw() {
        ctx.save();
        const tx = this.canal.x, ty = this.canal.y, tw = this.canal.w, th = this.canal.h;

        // Progress bar
        const progressX = tx + tw + 10;
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
        const greenH = areaH * this.targetArea.greenScale;
        const yellowH = areaH * 0.25;
        const redH = (areaH - greenH - yellowH * 2) / 2;

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
            scoreValue.innerText = score;
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
    constructor(x, y, w, h, isGoal = false, isVanishing = false) {
        this.x = x; this.y = y; this.w = w; this.h = h;
        this.isGoal = isGoal; this.isVanishing = isVanishing;
        this.alpha = 1.0; this.vanishingStarted = false; this.startTime = 0;
    }

    draw() {
        ctx.save();
        ctx.globalAlpha = this.alpha;
        const grad = ctx.createLinearGradient(this.x, this.y, this.x, this.y + this.h);
        if (this.isGoal) { grad.addColorStop(0, '#ffd700'); grad.addColorStop(1, '#b8860b'); }
        else if (this.isVanishing) { grad.addColorStop(0, '#ff00ff'); grad.addColorStop(1, '#660066'); }
        else { grad.addColorStop(0, THEME.platformBright); grad.addColorStop(1, THEME.platform); }
        ctx.fillStyle = grad;
        ctx.fillRect(this.x, this.y, this.w, this.h);
        if (this.isGoal) this.drawFlag();
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillRect(this.x, this.y, this.w, 2);
        ctx.restore();
    }

    drawFlag() {
        const fx = this.x + this.w - 15, fy = this.y - 30;
        ctx.fillStyle = '#fff'; ctx.fillRect(fx, fy, 3, 30);
        const wave = Math.sin(Date.now() / 200) * 5;
        ctx.fillStyle = '#ff3300';
        ctx.beginPath(); ctx.moveTo(fx + 3, fy); ctx.lineTo(fx + 20, fy + 7 + wave); ctx.lineTo(fx + 3, fy + 15); ctx.closePath(); ctx.fill();
    }

    update() {
        if (this.isVanishing && this.vanishingStarted) {
            const elapsed = Date.now() - this.startTime;
            this.alpha = Math.max(0, 1 - (elapsed / 5000));
            if (elapsed >= 5000) return false;
        }
        return true;
    }
}

function initPlatforms() {
    platforms = [];
    props = [];
    level = 1; score = 0; platformsInLevel = 5; platformsReached = 0; totalPlatformGlobalCount = 0;

    levelValue.innerText = level;
    scoreValue.innerText = score;

    platforms.push(new Platform(width / 2 - 50, height - 150, 100, 20));
    player.x = width / 2 - player.w / 2;
    player.y = height - 150 - player.h;
    player.currentPlatform = platforms[0];
    for (let i = 1; i < platformsInLevel; i++) {
        spawnNextPlatform(i === platformsInLevel - 1);
    }
}

function spawnNextPlatform(forceGoal = false) {
    const last = platforms[platforms.length - 1];
    const marginY = 100 + Math.random() * 80;
    const nextY = last.y - marginY;
    const nextW = 70 + Math.random() * 40;
    const nextX = 30 + Math.random() * (width - nextW - 80);

    totalPlatformGlobalCount++;
    const isVanishing = !forceGoal && (totalPlatformGlobalCount % 10 === 0);
    const platform = new Platform(nextX, nextY, nextW, 20, forceGoal, isVanishing);
    platforms.push(platform);

    // Aleatoriamente añadir un cubo de utilería
    if (!forceGoal && Math.random() < 0.4) {
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

    platformsInLevel = 5 + (level - 1);
    platformsReached = 0;
    msgText.innerText = "¡NIVEL " + level + "!";
    msgText.style.color = "#00f2ff";
    msgOverlay.classList.remove('hidden');

    const current = player.currentPlatform;
    platforms = [current];
    props = []; // Limpiamos props viejos al cambiar nivel
    // Re-spawn platforms for the new level
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

function handleJump(precision) {
    const { multiplier, tier, subScore } = precision;
    if (!player.onGround || multiplier <= 0) return;
    const candidates = platforms.filter(p => p.y < player.y).sort((a, b) => b.y - a.y);
    if (candidates.length === 0) return;
    const target = candidates[0];
    const distY = player.y - target.y + player.h;

    const targetMultiplier = (tier === "PERFECT") ? 1.08 : (tier === "GOOD" ? 1.45 : (Math.random() > 0.5 ? 2.0 : 0.4));
    const vy = -Math.sqrt(2 * player.gravity * distY) * targetMultiplier;

    const tRise = Math.abs(vy / player.gravity);
    const hMax = (vy * vy) / (2 * player.gravity);
    const hFall = hMax - distY;
    const tFall = Math.sqrt(Math.max(0, 2 * hFall / player.gravity));
    const totalT = tRise + tFall;

    const targetCenterX = target.x + target.w / 2;
    const dx = targetCenterX - (player.x + player.w / 2);
    player.vy = vy;
    player.vx = dx / totalT;
    player.onGround = false;
    player.angularVelocity = (tier === "PERFECT" ? 0.15 : (tier === "GOOD" ? 0.35 : 0.6));
}

function checkCollisions() {
    player.onGround = false;

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

            // Empujón lateral
            const playerCenterX = player.x + player.w / 2;
            const propCenterX = prop.x + prop.w / 2;
            const force = (player.vx || (propCenterX > playerCenterX ? 2 : -2));
            prop.vx += force * 0.5;
            prop.vy -= 2; // Pequeño salto al chocar
        }
    });

    // Colisión Jugador con Plataformas
    platforms.forEach(p => {
        if (player.vy >= 0 && player.x + player.w > p.x && player.x < p.x + p.w &&
            player.y + player.h >= p.y && player.y + player.h <= p.y + p.h + 10) {
            player.y = p.y - player.h;
            player.onGround = true;
            if (player.currentPlatform !== p) {
                player.currentPlatform = p;
                platformsReached++;
                if (p.isVanishing && !p.vanishingStarted) { p.vanishingStarted = true; p.startTime = Date.now(); }
                if (p.isGoal) nextLevel();
            }
        }
    });
}

function update() {
    if (!gameActive) return;
    player.update();
    precisionSystem.update();

    // Actualizar props y eliminar si caen
    for (let i = props.length - 1; i >= 0; i--) {
        if (!props[i].update()) {
            props.splice(i, 1);
        }
    }

    checkCollisions();

    for (let i = platforms.length - 1; i >= 0; i--) {
        if (!platforms[i].update()) {
            if (player.currentPlatform === platforms[i]) player.onGround = false;
            platforms.splice(i, 1);
        }
    }

    const cameraThreshold = height * 0.4;
    if (player.y < cameraThreshold) {
        const diff = cameraThreshold - player.y;
        player.y += diff;
        platforms.forEach(p => p.y += diff);
        props.forEach(pr => pr.y += diff);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy; p.life -= 0.02;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

function draw() {
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    for (let i = 0; i < height; i += 40) {
        ctx.beginPath(); ctx.moveTo(0, i + (player.y % 40)); ctx.lineTo(width, i + (player.y % 40)); ctx.stroke();
    }
    platforms.forEach(p => p.draw());
    props.forEach(pr => pr.draw());
    player.draw();
    precisionSystem.draw();
    particles.forEach(p => {
        ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 4, 4);
    });
    ctx.globalAlpha = 1;
}

function gameLoop() { update(); draw(); requestAnimationFrame(gameLoop); }
function startGame() {
    gameActive = true;
    score = 0;
    level = 1;
    scoreValue.innerText = "0";
    levelValue.innerText = "1";
    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    initPlatforms();
    precisionSystem.spawnBall();
}
function endGame() {
    gameActive = false; finalScore.innerText = score;
    gameOverScreen.classList.remove('hidden');
}

window.addEventListener('resize', resize);
resize();
startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);

const triggerAction = (e) => {
    if (e.cancelable) e.preventDefault();
    if (!gameActive) return;
    const precision = precisionSystem.checkHit();
    if (precision.multiplier > 0) handleJump(precision);
};
window.addEventListener('mousedown', triggerAction);
window.addEventListener('touchstart', triggerAction, { passive: false });

gameLoop();
