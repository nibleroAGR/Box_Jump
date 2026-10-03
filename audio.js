/* ============================================================
 * BOX JUMP PRECISION - audio.js
 * Música y efectos de sonido 100 % sintetizados con Web Audio:
 * no hay archivos de audio que descargar y funciona sin conexión.
 *
 *   SFX.play(nombre, opciones)   efecto de sonido
 *   SFX.musicStart() / musicStop()   música de fondo
 *   SFX.mood('normal' | 'lava' | 'dark')   cambia el ambiente de la música
 *   SFX.setMusic(bool) / setSfx(bool)   interruptores (se guardan en el navegador)
 * ============================================================ */
(function () {
    'use strict';

    const KEY_MUSIC = 'boxjump_music', KEY_SFX = 'boxjump_sfx';
    const readBool = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch (e) { return d; } };
    const writeBool = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) { /* no disponible */ } };

    let musicOn = readBool(KEY_MUSIC, true);
    let sfxOn = readBool(KEY_SFX, true);
    let ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
    let musicWanted = false;      // el juego pide música (partida en curso)
    let timer = null;             // planificador de la música
    let moodName = 'normal';
    let step = 0, nextT = 0;      // posición de la música (semicorcheas)
    const MUSIC_VOL = 0.30;
    const lastPlayed = {};

    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

    // ---------- contexto de audio (se crea en el primer toque del usuario) ----------
    function ensure() {
        if (ctx) return ctx;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { ctx = new AC(); } catch (e) { ctx = null; return null; }
        const comp = ctx.createDynamicsCompressor(); // evita que se sature al sonar varias cosas a la vez
        comp.connect(ctx.destination);
        master = ctx.createGain(); master.gain.value = 0.9; master.connect(comp);
        sfxBus = ctx.createGain(); sfxBus.gain.value = 0.6; sfxBus.connect(master);
        musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        return ctx;
    }
    function unlock() {
        if (!ensure()) return;
        if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignorar */ } }
        if (musicWanted && musicOn && !timer) startMusicLoop();
    }

    // ---------- bloques básicos ----------
    function tone(freq, dur, o) {
        o = o || {};
        if (!ctx) return;
        const t = ctx.currentTime + (o.at || 0);
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = o.type || 'square';
        osc.frequency.setValueAtTime(Math.max(1, freq), t);
        if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + dur);
        const v = o.vol === undefined ? 0.3 : o.vol;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t + (o.attack || 0.005));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g); g.connect(o.bus || sfxBus);
        osc.start(t); osc.stop(t + dur + 0.05);
    }
    function noise(dur, o) {
        o = o || {};
        if (!ctx || !noiseBuf) return;
        const t = ctx.currentTime + (o.at || 0);
        const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        src.buffer = noiseBuf; src.loop = true;
        f.type = o.filter || 'lowpass';
        f.frequency.setValueAtTime(o.f0 || 1000, t);
        if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + dur);
        const v = o.vol === undefined ? 0.3 : o.vol;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t + (o.attack || 0.004));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f); f.connect(g); g.connect(o.bus || sfxBus);
        src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
    }
    const arp = (notes, gap, dur, o) => notes.forEach((n, i) => tone(mtof(n), dur, Object.assign({}, o, { at: i * gap })));

    // ---------- efectos ----------
    const FX = {
        click() { tone(720, 0.05, { type: 'sine', vol: 0.18, to: 540 }); },
        jump(o) {
            const tier = o && o.tier;
            if (tier === 'PERFECT') { tone(380, 0.16, { type: 'sine', vol: 0.34, to: 820 }); tone(760, 0.09, { type: 'square', vol: 0.09, to: 1300, at: 0.02 }); }
            else if (tier === 'GOOD') tone(320, 0.16, { type: 'triangle', vol: 0.32, to: 640 });
            else tone(250, 0.2, { type: 'triangle', vol: 0.3, to: 420 });
        },
        land(o) {
            const k = Math.min(1, Math.max(0.15, ((o && o.impact) || 6) / 14));
            noise(0.09 + 0.06 * k, { f0: 900, f1: 200, vol: 0.2 * k + 0.05 });
            tone(150, 0.12, { type: 'sine', vol: 0.28 * k + 0.06, to: 60 });
        },
        hit(o) {
            const tier = o && o.tier;
            if (tier === 'PERFECT') arp([84, 88, 91], 0.045, 0.14, { type: 'triangle', vol: 0.22 });
            else if (tier === 'GOOD') arp([79, 83], 0.05, 0.12, { type: 'triangle', vol: 0.18 });
            else tone(180, 0.14, { type: 'sawtooth', vol: 0.12, to: 130 });
        },
        miss() { tone(210, 0.22, { type: 'sawtooth', vol: 0.13, to: 80 }); },
        explosion() {
            noise(0.55, { f0: 2200, f1: 120, vol: 0.5 });
            tone(130, 0.4, { type: 'sine', vol: 0.4, to: 38 });
        },
        chest() { arp([72, 76, 79, 84, 88], 0.06, 0.18, { type: 'triangle', vol: 0.22 }); noise(0.25, { filter: 'highpass', f0: 5000, vol: 0.05, at: 0.05 }); },
        reel() { tone(980, 0.04, { type: 'square', vol: 0.12 }); },
        item() { tone(560, 0.09, { type: 'square', vol: 0.16, to: 900 }); tone(900, 0.12, { type: 'square', vol: 0.14, to: 1250, at: 0.08 }); },
        spring() { tone(220, 0.28, { type: 'sine', vol: 0.38, to: 900 }); tone(440, 0.2, { type: 'square', vol: 0.08, to: 1500, at: 0.04 }); },
        shield() { tone(440, 0.18, { type: 'sine', vol: 0.3, to: 880 }); tone(660, 0.22, { type: 'sine', vol: 0.22, to: 1320, at: 0.1 }); },
        rocket() { noise(0.7, { filter: 'bandpass', f0: 400, f1: 3200, vol: 0.28 }); tone(120, 0.6, { type: 'sawtooth', vol: 0.12, to: 400 }); },
        gravity_on() { tone(180, 0.5, { type: 'sine', vol: 0.34, to: 950 }); tone(360, 0.5, { type: 'triangle', vol: 0.12, to: 1400, at: 0.05 }); },
        gravity_off() { tone(900, 0.4, { type: 'sine', vol: 0.3, to: 170 }); },
        sling_ready() { tone(300, 0.25, { type: 'triangle', vol: 0.28, to: 180 }); tone(150, 0.2, { type: 'sine', vol: 0.2, to: 90, at: 0.04 }); },
        sling_pull() { tone(210, 0.18, { type: 'triangle', vol: 0.18, to: 340 }); },
        sling_launch() { noise(0.35, { filter: 'bandpass', f0: 500, f1: 4000, vol: 0.3 }); tone(220, 0.3, { type: 'sawtooth', vol: 0.22, to: 1000 }); },
        ray() { tone(110, 0.9, { type: 'sawtooth', vol: 0.12, to: 150 }); tone(114, 0.9, { type: 'sawtooth', vol: 0.1, to: 154 }); noise(0.9, { filter: 'highpass', f0: 3000, vol: 0.05 }); },
        ray_break() { noise(0.45, { f0: 1800, f1: 90, vol: 0.45 }); tone(90, 0.35, { type: 'square', vol: 0.2, to: 40 }); },
        drone_destroy() {
            noise(0.3, { f0: 3000, f1: 300, vol: 0.4 });
            tone(520, 0.22, { type: 'square', vol: 0.2, to: 110 });
            tone(700, 0.09, { type: 'square', vol: 0.14, to: 1100, at: 0.12 });
        },
        lava() { noise(0.9, { f0: 260, f1: 90, vol: 0.4 }); tone(55, 0.8, { type: 'sawtooth', vol: 0.2, to: 40 }); },
        level_up() { arp([72, 76, 79, 84], 0.07, 0.2, { type: 'triangle', vol: 0.24 }); arp([84, 88, 91], 0.07, 0.12, { type: 'square', vol: 0.05 }); },
        unlock() { arp([67, 72, 76, 79, 84, 88], 0.07, 0.24, { type: 'triangle', vol: 0.24 }); },
        rescue_alert() { [0, 0.18, 0.36].forEach((a) => { tone(880, 0.1, { type: 'sawtooth', vol: 0.16, at: a }); tone(660, 0.1, { type: 'sawtooth', vol: 0.16, at: a + 0.09 }); }); },
        rescue_ok() { tone(1046, 0.1, { type: 'triangle', vol: 0.26, to: 1568 }); },
        rescue_win() { arp([72, 76, 79, 84, 88, 91], 0.06, 0.2, { type: 'triangle', vol: 0.26 }); },
        rescue_fail() { arp([67, 63, 60, 55], 0.1, 0.18, { type: 'sawtooth', vol: 0.15 }); },
        game_over() { arp([67, 63, 60, 55, 48], 0.17, 0.3, { type: 'square', vol: 0.15 }); tone(55, 0.9, { type: 'sine', vol: 0.3, to: 35, at: 0.5 }); },
        win() { arp([72, 76, 79, 84, 79, 84, 88, 91], 0.1, 0.28, { type: 'triangle', vol: 0.26 }); },
    };
    const MIN_GAP = { click: 40, land: 70, hit: 40, miss: 150, reel: 30, sling_pull: 90, jump: 60 };

    function play(name, opts) {
        if (!sfxOn) return;
        const fn = FX[name];
        if (!fn) return;
        if (!ensure()) return;
        if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignorar */ } return; } // sin gesto del usuario aún
        const now = performance.now(), gap = MIN_GAP[name] || 0;
        if (gap && lastPlayed[name] && now - lastPlayed[name] < gap) return;
        lastPlayed[name] = now;
        try { fn(opts); } catch (e) { /* un sonido nunca debe romper el juego */ }
    }

    // ---------- música: bucle de 4 compases (La menor - Fa - Do - Sol) ----------
    const CHORDS = [
        { root: 45, tri: [57, 60, 64] },   // Am
        { root: 41, tri: [53, 57, 60] },   // F
        { root: 48, tri: [55, 60, 64] },   // C
        { root: 43, tri: [55, 59, 62] },   // G
    ];
    const MELODY = [ // 8 corcheas por compás (null = silencio)
        [76, null, 72, null, 74, 72, 69, null],
        [77, null, 72, null, 69, null, 72, 74],
        [79, null, 76, null, 72, 74, 76, null],
        [74, null, 79, null, 78, 74, 71, null],
    ];
    const MOODS = {
        normal: { bpm: 112, melody: true, drums: 'soft', arpOct: 12, arpVol: 0.05 },
        lava: { bpm: 142, melody: true, drums: 'drive', arpOct: 12, arpVol: 0.06 },
        dark: { bpm: 84, melody: false, drums: 'none', arpOct: 0, arpVol: 0.045 },
    };

    function scheduleStep(t, s) {
        const m = MOODS[moodName] || MOODS.normal;
        const stepDur = 60 / m.bpm / 4;
        const bar = Math.floor(s / 16) % 4, i = s % 16, ch = CHORDS[bar];
        const out = { bus: musicBus };

        // bajo
        if (i === 0 || i === 8) tone(mtof(ch.root), stepDur * 6, Object.assign({ at: t - ctx.currentTime, type: 'triangle', vol: 0.3 }, out));
        if (m.drums === 'drive' && (i === 4 || i === 12)) tone(mtof(ch.root + 12), stepDur * 3, Object.assign({ at: t - ctx.currentTime, type: 'triangle', vol: 0.18 }, out));
        // pad largo en el ambiente oscuro
        if (m.drums === 'none' && i === 0) ch.tri.forEach((n) => tone(mtof(n - 12), stepDur * 15, Object.assign({ at: t - ctx.currentTime, type: 'sine', vol: 0.07, attack: 0.6 }, out)));
        // arpegio cada corchea
        if (i % 2 === 0) {
            const idx = [0, 1, 2, 1, 0, 1, 2, 1][i / 2];
            tone(mtof(ch.tri[idx] + m.arpOct), stepDur * 1.6, Object.assign({ at: t - ctx.currentTime, type: 'square', vol: m.arpVol }, out));
        }
        // melodía
        if (m.melody && i % 2 === 0) {
            const n = MELODY[bar][i / 2];
            if (n) tone(mtof(n), stepDur * 3, Object.assign({ at: t - ctx.currentTime, type: 'triangle', vol: 0.11, attack: 0.012 }, out));
        }
        // percusión
        if (m.drums !== 'none') {
            const kick = m.drums === 'drive' ? (i % 4 === 0) : (i === 0 || i === 8);
            if (kick) tone(140, 0.12, Object.assign({ at: t - ctx.currentTime, type: 'sine', vol: 0.32, to: 45 }, out));
            if (i % 4 === 2) noise(0.04, Object.assign({ at: t - ctx.currentTime, filter: 'highpass', f0: 7000, vol: m.drums === 'drive' ? 0.07 : 0.045 }, out));
            if (m.drums === 'drive' && (i === 4 || i === 12)) noise(0.09, Object.assign({ at: t - ctx.currentTime, filter: 'bandpass', f0: 1800, vol: 0.09 }, out));
        }
        return stepDur;
    }
    function pump() {
        if (!ctx || !musicOn || !musicWanted || ctx.state !== 'running') return;
        if (nextT < ctx.currentTime) nextT = ctx.currentTime + 0.05; // por si la pestaña estuvo en segundo plano
        while (nextT < ctx.currentTime + 0.25) {
            nextT += scheduleStep(nextT, step);
            step = (step + 1) % 64;
        }
    }
    function startMusicLoop() {
        if (!ctx || timer) return;
        nextT = ctx.currentTime + 0.1;
        musicBus.gain.cancelScheduledValues(ctx.currentTime);
        musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
        musicBus.gain.linearRampToValueAtTime(MUSIC_VOL, ctx.currentTime + 0.6);
        timer = setInterval(pump, 40);
        pump();
    }
    function stopMusicLoop() {
        if (timer) { clearInterval(timer); timer = null; }
        if (ctx && musicBus) {
            musicBus.gain.cancelScheduledValues(ctx.currentTime);
            musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
            musicBus.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
        }
    }

    // ---------- API ----------
    const SFX = {
        play,
        unlock,
        musicStart() { musicWanted = true; step = 0; if (musicOn && ensure()) { if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignorar */ } } stopMusicLoop(); startMusicLoop(); } },
        musicStop() { musicWanted = false; stopMusicLoop(); },
        mood(name) { if (MOODS[name] && name !== moodName) moodName = name; },
        setMusic(on) {
            musicOn = !!on; writeBool(KEY_MUSIC, musicOn);
            if (!musicOn) stopMusicLoop();
            else if (musicWanted && ensure()) startMusicLoop();
        },
        setSfx(on) { sfxOn = !!on; writeBool(KEY_SFX, sfxOn); if (sfxOn) play('click'); },
        musicEnabled() { return musicOn; },
        sfxEnabled() { return sfxOn; },
        _debug: { names: () => Object.keys(FX), pump, state: () => ({ timer: !!timer, musicWanted, moodName, step }) },
    };
    window.SFX = SFX;

    // El navegador solo permite audio tras un gesto del usuario
    ['pointerdown', 'touchstart', 'mousedown', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, { passive: true }));
    // Clic en botones de la interfaz
    document.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.closest && t.closest('button, .menu-btn, .box-opt, .inv-slot, #menu-toggle, #settings-fab, #info-fab, #home-fab, #ranking-fab')) play('click');
    }, true);
    // Sin sonido con la pestaña en segundo plano
    document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) { try { ctx.suspend(); } catch (e) { /* ignorar */ } }
        else { try { ctx.resume(); } catch (e) { /* ignorar */ } }
    });
})();
