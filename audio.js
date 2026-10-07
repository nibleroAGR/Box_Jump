/* ============================================================
 * BOX JUMP PRECISION - audio.js  (v3: música pre-renderizada, apenas gasta CPU durante el juego)
 * Música y efectos 100 % sintetizados con Web Audio (sin archivos, funciona sin conexión).
 *
 * Mezcla:  efectos ─┐                       ┌─> reverb (sala) ─┐
 *          música ──┴─> bus ─> EQ ─> limitador ─────────────────┴─> salida
 *  - reverberación generada al vuelo (cola de 2 s) para dar espacio
 *  - panorama estéreo en efectos y arpegios
 *  - la música se "aparta" (ducking) en los efectos grandes
 *
 * API (igual que antes):
 *   SFX.play(nombre, opciones)          efecto de sonido
 *   SFX.musicStart() / musicStop()      música de fondo
 *   SFX.mood('normal' | 'lava' | 'dark')
 *   SFX.setMusic(bool) / setSfx(bool)   interruptores (se guardan en el navegador)
 * ============================================================ */
(function () {
    'use strict';

    const KEY_MUSIC = 'boxjump_music', KEY_SFX = 'boxjump_sfx';
    const readBool = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch (e) { return d; } };
    const writeBool = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) { /* no disponible */ } };

    let musicOn = readBool(KEY_MUSIC, true);
    let sfxOn = readBool(KEY_SFX, true);
    let ctx = null, out = null, sfxBus = null, musicBus = null, revIn = null, noiseBuf = null;
    let musicWanted = false, timer = null, moodName = 'normal', step = 0, nextT = 0;
    const MUSIC_VOL = 0.42;
    // Móvil básico (pocos núcleos o poca memoria): el audio se procesa a 32 kHz (en el altavoz de un
    // móvil no se nota) con un búfer algo mayor y reverb más corta. El hilo de audio gasta ~la mitad.
    const LOW_END = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 3;
    const REVERB_S = LOW_END ? 1.4 : 2.1;
    const lastPlayed = {};
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const rnd = (a, b) => a + Math.random() * (b - a);

    // ---------- contexto y cadena de mezcla ----------
    function makeImpulse(seconds, decay) {
        const len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const d = buf.getChannelData(c);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
        }
        return buf;
    }
    function ensure() {
        if (ctx) return ctx;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try {
            ctx = LOW_END ? new AC({ latencyHint: 'balanced', sampleRate: 32000 }) : new AC();
        } catch (e) {
            try { ctx = new AC(); } catch (e2) { ctx = null; return null; } // navegadores sin esas opciones
        }

        // limitador final: nada satura aunque suenen muchas cosas a la vez
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -10; limiter.knee.value = 6; limiter.ratio.value = 12;
        limiter.attack.value = 0.003; limiter.release.value = 0.18;
        limiter.connect(ctx.destination);
        // EQ suave: quita barro en graves y un poco de dureza en agudos
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 32;
        const shelf = ctx.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 9000; shelf.gain.value = -3;
        hp.connect(shelf); shelf.connect(limiter);
        out = ctx.createGain(); out.gain.value = 0.85; out.connect(hp);

        // reverb de sala
        const conv = ctx.createConvolver(); conv.buffer = makeImpulse(REVERB_S, 2.6);
        const revGain = ctx.createGain(); revGain.gain.value = 0.55;
        const revLp = ctx.createBiquadFilter(); revLp.type = 'lowpass'; revLp.frequency.value = 5200;
        revIn = ctx.createGain(); revIn.connect(conv); conv.connect(revLp); revLp.connect(revGain); revGain.connect(out);

        sfxBus = ctx.createGain(); sfxBus.gain.value = 0.62; sfxBus.connect(out);
        // La música ya sale ecualizada y comprimida de la grabación: va directa a la salida y se ahorra
        // el limitador y la EQ en tiempo real durante toda la partida (sonido idéntico).
        musicBus = ctx.createGain(); musicBus.gain.value = 0;
        const musicOut = ctx.createGain(); musicOut.gain.value = 1 / MUSIC_VOL; // el volumen ya viene aplicado en la grabación
        musicBus.connect(musicOut); musicOut.connect(ctx.destination);

        noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        return ctx;
    }
    function unlock() {
        if (!ensure()) return;
        if (ctx.state !== 'running') { try { ctx.resume(); } catch (e) { /* ignorar */ } }
        if (musicWanted && musicOn && !timer) startMusicLoop();
    }

    // salida de una voz: panorama + envío a reverb
    function route(node, o, t, end) {
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        let last = node;
        if (pan) { pan.pan.value = Math.max(-1, Math.min(1, o.pan || 0)); last.connect(pan); last = pan; }
        last.connect(o.bus || sfxBus);
        if (o.rev) { const s = ctx.createGain(); s.gain.value = o.rev; last.connect(s); s.connect(revIn); }
    }

    // ---------- instrumentos ----------
    // voz: 1-3 osciladores (desafinados), filtro con envolvente y ADSR
    function voice(freq, dur, o) {
        o = o || {};
        if (!ctx) return;
        const t = ctx.currentTime + Math.max(0, o.at || 0);
        const a = o.attack || 0.004, dcy = o.decay === undefined ? dur * 0.5 : o.decay;
        const sus = o.sustain === undefined ? 0.35 : o.sustain, rel = o.release || 0.08;
        const v = o.vol === undefined ? 0.25 : o.vol;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t + a);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v * Math.max(0.001, sus)), t + a + dcy);
        g.gain.setValueAtTime(Math.max(0.0002, v * Math.max(0.001, sus)), t + Math.max(a + dcy, dur));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + rel);
        let head = g;
        if (o.cutoff) {
            const f = ctx.createBiquadFilter();
            f.type = o.ftype || 'lowpass'; f.Q.value = o.q || 0.8;
            f.frequency.setValueAtTime(o.cutoff, t);
            if (o.cutTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.cutTo), t + (o.cutTime || dur));
            f.connect(g); head = f;
        }
        const detunes = o.detune ? [-o.detune, o.detune] : [0];
        if (o.sub) detunes.push('sub');
        detunes.forEach((dt) => {
            const osc = ctx.createOscillator();
            osc.type = dt === 'sub' ? 'sine' : (o.type || 'square');
            const f0 = dt === 'sub' ? freq / 2 : freq;
            osc.frequency.setValueAtTime(Math.max(1, f0), t);
            if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, dt === 'sub' ? o.to / 2 : o.to), t + (o.glide || dur));
            if (dt !== 'sub' && dt) osc.detune.value = dt;
            if (o.vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = o.vib; lg.gain.value = f0 * 0.012; l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + dur + rel + 0.05); }
            const og = ctx.createGain(); og.gain.value = dt === 'sub' ? 0.6 : 1 / Math.max(1, detunes.length - (o.sub ? 1 : 0));
            osc.connect(og); og.connect(head);
            osc.start(t); osc.stop(t + dur + rel + 0.05);
        });
        route(g, o, t, dur + rel);
    }
    // ruido filtrado (golpes, explosiones, viento)
    function noise(dur, o) {
        o = o || {};
        if (!ctx || !noiseBuf) return;
        const t = ctx.currentTime + Math.max(0, o.at || 0);
        const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        src.buffer = noiseBuf; src.loop = true;
        f.type = o.filter || 'lowpass'; f.Q.value = o.q || 0.7;
        f.frequency.setValueAtTime(o.f0 || 1000, t);
        if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1), t + dur);
        const v = o.vol === undefined ? 0.3 : o.vol;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t + (o.attack || 0.003));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f); f.connect(g);
        route(g, o, t, dur);
        src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    }
    // percusión
    const kick = (o) => {
        voice(160, 0.32, Object.assign({ type: 'sine', to: 42, glide: 0.11, vol: 0.55, attack: 0.002, decay: 0.12, sustain: 0.2, release: 0.12 }, o));
        noise(0.025, Object.assign({ filter: 'highpass', f0: 3500, vol: 0.12 }, o));
    };
    const snare = (o) => {
        noise(0.18, Object.assign({ filter: 'bandpass', f0: 2200, q: 0.6, vol: 0.26, rev: 0.25 }, o));
        voice(190, 0.09, Object.assign({ type: 'triangle', to: 150, vol: 0.18, decay: 0.05, sustain: 0.1 }, o));
    };
    const hat = (o, open) => noise(open ? 0.22 : 0.045, Object.assign({ filter: 'highpass', f0: 8500, vol: open ? 0.07 : 0.05 }, o));
    const clap = (o) => [0, 0.012, 0.026].forEach((d) => noise(0.08, Object.assign({}, o, { at: (o.at || 0) + d, filter: 'bandpass', f0: 1500, q: 1.2, vol: 0.16, rev: 0.3 })));
    const arp = (notes, gap, dur, o) => notes.forEach((n, i) => voice(mtof(n), dur, Object.assign({}, o, { at: (o && o.at || 0) + i * gap, pan: (o && o.spread) ? (i % 2 ? 0.35 : -0.35) : (o && o.pan) || 0 })));
    function duck(amount, time) { // la música se aparta un momento
        if (!ctx || !musicBus || !musicOn || !musicWanted) return;
        const t = ctx.currentTime, g = musicBus.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(MUSIC_VOL * amount, t + 0.03);
        g.linearRampToValueAtTime(MUSIC_VOL, t + time);
    }

    // ---------- efectos ----------
    const FX = {
        click() { voice(1320, 0.04, { type: 'sine', vol: 0.12, decay: 0.03, sustain: 0.1, to: 990 }); noise(0.02, { filter: 'highpass', f0: 6000, vol: 0.04 }); },
        jump(o) {
            const tier = o && o.tier, p = rnd(-0.15, 0.15);
            noise(0.16, { filter: 'bandpass', f0: 600, f1: 2600, q: 1.1, vol: 0.12, pan: p });           // soplido
            if (tier === 'PERFECT') {
                voice(392, 0.2, { type: 'triangle', to: 1046, glide: 0.16, vol: 0.26, pan: p, rev: 0.15 });
                arp([88, 95], 0.05, 0.16, { type: 'sine', vol: 0.1, rev: 0.35, spread: true });            // destello
            } else if (tier === 'GOOD') voice(330, 0.2, { type: 'triangle', to: 784, glide: 0.16, vol: 0.24, pan: p, rev: 0.1 });
            else voice(262, 0.22, { type: 'triangle', to: 523, glide: 0.18, vol: 0.22, pan: p });
        },
        land(o) {
            const k = Math.min(1, Math.max(0.15, ((o && o.impact) || 6) / 14));
            voice(130, 0.16, { type: 'sine', to: 52, glide: 0.1, vol: 0.32 * k + 0.08, decay: 0.08, sustain: 0.2 });
            noise(0.08 + 0.07 * k, { f0: 1400, f1: 240, vol: 0.13 * k + 0.04 });
            if (k > 0.75) noise(0.25, { f0: 500, f1: 120, vol: 0.08, rev: 0.2 });                      // eco en caídas fuertes
        },
        hit(o) {
            const tier = o && o.tier;
            if (tier === 'PERFECT') { arp([84, 88, 91, 96], 0.04, 0.22, { type: 'triangle', vol: 0.15, rev: 0.4, spread: true }); voice(mtof(108), 0.3, { type: 'sine', vol: 0.05, rev: 0.6 }); }
            else if (tier === 'GOOD') arp([79, 84], 0.05, 0.16, { type: 'triangle', vol: 0.15, rev: 0.25, spread: true });
            else voice(196, 0.16, { type: 'sawtooth', to: 147, vol: 0.09, cutoff: 1400, cutTo: 400 });
        },
        miss() { voice(220, 0.24, { type: 'sawtooth', to: 98, vol: 0.1, cutoff: 1800, cutTo: 300, detune: 12 }); },
        explosion() {
            duck(0.35, 0.9);
            noise(0.9, { f0: 3200, f1: 90, vol: 0.55, rev: 0.25 });
            voice(110, 0.7, { type: 'sine', to: 30, glide: 0.5, vol: 0.5, decay: 0.3, sustain: 0.3 });
            noise(0.4, { filter: 'highpass', f0: 2500, f1: 800, vol: 0.12, at: 0.05, pan: 0.4 });
            noise(0.4, { filter: 'highpass', f0: 2500, f1: 800, vol: 0.12, at: 0.09, pan: -0.4 });
        },
        chest() {
            arp([72, 76, 79, 84, 88, 91], 0.055, 0.3, { type: 'triangle', vol: 0.16, rev: 0.45, spread: true });
            noise(0.5, { filter: 'highpass', f0: 7000, vol: 0.05, at: 0.05, rev: 0.5 });
        },
        reel() { voice(1760, 0.035, { type: 'square', vol: 0.07, decay: 0.02, sustain: 0.1, cutoff: 5000 }); },
        item() { voice(659, 0.1, { type: 'square', vol: 0.12, to: 988, cutoff: 3500, rev: 0.15 }); voice(988, 0.14, { type: 'square', vol: 0.11, to: 1319, at: 0.07, cutoff: 3500, rev: 0.2 }); },
        spring() {
            voice(196, 0.4, { type: 'sine', to: 1175, glide: 0.3, vol: 0.32, vib: 18, rev: 0.15 });
            voice(392, 0.25, { type: 'square', to: 1568, glide: 0.2, vol: 0.06, at: 0.03, cutoff: 3000 });
            noise(0.3, { filter: 'bandpass', f0: 800, f1: 4000, vol: 0.08 });
        },
        shield() {
            arp([69, 76, 81, 88], 0.06, 0.4, { type: 'sine', vol: 0.18, rev: 0.6, spread: true });
            voice(220, 0.6, { type: 'sawtooth', vol: 0.06, cutoff: 600, cutTo: 3000, detune: 15, attack: 0.08 });
        },
        rocket() {
            noise(0.9, { filter: 'bandpass', f0: 300, f1: 3600, q: 0.9, vol: 0.3, rev: 0.15 });
            voice(98, 0.8, { type: 'sawtooth', to: 392, glide: 0.7, vol: 0.12, cutoff: 600, cutTo: 2600, detune: 18 });
        },
        gravity_on() { voice(147, 0.7, { type: 'sine', to: 1175, glide: 0.6, vol: 0.28, vib: 7, rev: 0.4 }); voice(294, 0.6, { type: 'triangle', to: 1760, glide: 0.5, vol: 0.08, at: 0.05, rev: 0.4 }); },
        gravity_off() { voice(1047, 0.5, { type: 'sine', to: 165, glide: 0.45, vol: 0.24, rev: 0.3 }); },
        sling_ready() { voice(330, 0.3, { type: 'triangle', to: 196, vol: 0.22 }); noise(0.12, { filter: 'bandpass', f0: 1200, vol: 0.06 }); },
        sling_pull() { voice(196, 0.2, { type: 'triangle', to: 392, vol: 0.14, cutoff: 1500 }); },
        sling_launch() {
            noise(0.4, { filter: 'bandpass', f0: 500, f1: 5000, q: 1, vol: 0.28, rev: 0.15 });
            voice(220, 0.32, { type: 'sawtooth', to: 1200, glide: 0.25, vol: 0.16, cutoff: 1200, cutTo: 5000 });
        },
        ray() {
            voice(110, 1.0, { type: 'sawtooth', to: 165, vol: 0.09, detune: 25, cutoff: 900, cutTo: 2400, attack: 0.08, vib: 9 });
            noise(1.0, { filter: 'highpass', f0: 3500, vol: 0.04 });
        },
        ray_break() { duck(0.5, 0.6); noise(0.5, { f0: 2400, f1: 90, vol: 0.4, rev: 0.25 }); voice(98, 0.4, { type: 'square', to: 41, vol: 0.14, cutoff: 1200, cutTo: 200 }); },
        drone_destroy() {
            noise(0.35, { f0: 4000, f1: 260, vol: 0.38, rev: 0.2 });
            voice(587, 0.24, { type: 'square', to: 110, vol: 0.14, cutoff: 3000, cutTo: 500 });
            arp([91, 96], 0.08, 0.14, { type: 'triangle', vol: 0.1, at: 0.12, rev: 0.35, spread: true });
        },
        lava() { duck(0.5, 1.2); noise(1.1, { f0: 320, f1: 80, vol: 0.38, rev: 0.3 }); voice(55, 1.0, { type: 'sawtooth', to: 41, vol: 0.16, cutoff: 300, detune: 20 }); },
        level_up() {
            duck(0.45, 1.0);
            arp([72, 76, 79, 84], 0.07, 0.3, { type: 'triangle', vol: 0.18, rev: 0.45, spread: true });
            arp([84, 88, 91, 96], 0.07, 0.2, { type: 'square', vol: 0.04, cutoff: 4000, rev: 0.4, at: 0.02 });
            voice(mtof(48), 0.5, { type: 'sine', vol: 0.2, at: 0.21 });
        },
        unlock() { duck(0.4, 1.4); arp([67, 72, 76, 79, 84, 88, 91], 0.07, 0.4, { type: 'triangle', vol: 0.17, rev: 0.55, spread: true }); },
        rescue_alert() { [0, 0.2, 0.4].forEach((a) => { voice(988, 0.1, { type: 'square', vol: 0.09, at: a, cutoff: 3500 }); voice(740, 0.1, { type: 'square', vol: 0.09, at: a + 0.1, cutoff: 3500 }); }); },
        rescue_ok() { voice(1047, 0.14, { type: 'triangle', vol: 0.2, to: 1568, rev: 0.35 }); },
        rescue_win() { duck(0.4, 1.2); arp([72, 76, 79, 84, 88, 91], 0.06, 0.3, { type: 'triangle', vol: 0.18, rev: 0.5, spread: true }); },
        rescue_fail() { arp([67, 63, 60, 55], 0.1, 0.22, { type: 'sawtooth', vol: 0.09, cutoff: 1500, cutTo: 400 }); },
        game_over() {
            duck(0.15, 2.5);
            arp([69, 65, 62, 57], 0.22, 0.5, { type: 'triangle', vol: 0.16, rev: 0.5 });
            voice(mtof(33), 1.6, { type: 'sawtooth', vol: 0.12, cutoff: 400, cutTo: 120, detune: 15, at: 0.6, attack: 0.1 });
        },
        win() {
            duck(0.2, 2.2);
            arp([72, 76, 79, 84, 79, 84, 88, 91], 0.1, 0.36, { type: 'triangle', vol: 0.18, rev: 0.45, spread: true });
            [0, 0.4, 0.8].forEach((a) => { kick({ at: a, bus: sfxBus }); });
            voice(mtof(96), 1.2, { type: 'sine', vol: 0.06, at: 0.8, rev: 0.7 });
        },
    };
    const MIN_GAP = { click: 40, land: 70, hit: 40, miss: 150, reel: 30, sling_pull: 90, jump: 60, explosion: 60 };

    function play(name, opts) {
        if (!sfxOn) return;
        const fn = FX[name];
        if (!fn || !ensure()) return;
        if (ctx.state !== 'running') { try { ctx.resume(); } catch (e) { /* ignorar */ } return; } // sin gesto del usuario aún
        const now = performance.now(), gap = MIN_GAP[name] || 0;
        if (gap && lastPlayed[name] && now - lastPlayed[name] < gap) return;
        lastPlayed[name] = now;
        try { fn(opts); } catch (e) { /* un sonido nunca debe romper el juego */ }
    }

    // ---------- música: canción de 8 compases (A A B A') en La menor ----------
    const PROG = [ // raíz del bajo y acorde (MIDI)
        { r: 45, c: [57, 60, 64] }, { r: 41, c: [57, 60, 65] }, { r: 48, c: [55, 60, 64] }, { r: 43, c: [55, 59, 62] },  // Am F C G
        { r: 41, c: [57, 60, 65] }, { r: 43, c: [55, 59, 62] }, { r: 40, c: [55, 59, 64] }, { r: 45, c: [57, 60, 64] },  // F G Em Am
    ];
    const LEAD = [ // corcheas por compás (null = silencio)
        [76, null, 79, 76, 74, null, 72, null], [72, null, 74, 76, null, 72, 69, null],
        [79, null, 76, null, 79, 81, 79, null], [74, null, 71, 74, 79, null, 78, null],
        [77, null, 76, 74, 72, null, 74, null], [74, 76, 79, null, 81, null, 79, null],
        [79, null, 76, null, 74, 72, 71, null], [69, null, null, null, 72, 71, 69, null],
    ];
    const MOODS = {
        normal: { bpm: 108, drums: 'groove', lead: true, pad: true, arpOct: 12, arpVol: 0.045, bass: 'pluck' },
        lava:   { bpm: 136, drums: 'drive',  lead: true, pad: false, arpOct: 12, arpVol: 0.05, bass: 'drive' },
        dark:   { bpm: 78,  drums: 'none',   lead: false, pad: true, arpOct: 0, arpVol: 0.035, bass: 'drone' },
    };
    const MB = (o) => Object.assign({ bus: musicBus }, o);

    function scheduleStep(t, s) {
        const m = MOODS[moodName] || MOODS.normal;
        const sd = 60 / m.bpm / 4;
        const bar = Math.floor(s / 16) % 8, i = s % 16, ch = PROG[bar];
        const at = t - ctx.currentTime;
        const section = bar < 4 ? 'A' : 'B';

        // bajo
        if (m.bass === 'pluck' && (i === 0 || i === 6 || i === 10)) voice(mtof(ch.r), sd * (i === 0 ? 5 : 3), MB({ at, type: 'sawtooth', vol: 0.2, cutoff: 900, cutTo: 220, cutTime: sd * 3, decay: sd * 2, sustain: 0.3, sub: true }));
        if (m.bass === 'drive' && i % 2 === 0) voice(mtof(ch.r + (i % 4 === 2 ? 12 : 0)), sd * 1.6, MB({ at, type: 'sawtooth', vol: 0.16, cutoff: 1400, cutTo: 260, cutTime: sd * 1.5, decay: sd, sustain: 0.2 }));
        if (m.bass === 'drone' && i === 0) voice(mtof(ch.r - 12), sd * 15, MB({ at, type: 'sine', vol: 0.18, attack: 0.4, sustain: 0.8, release: 0.6 }));
        // pad en cada compás (entra suave)
        if (m.pad && i === 0) ch.c.forEach((n, k) => voice(mtof(n), sd * 15, MB({ at, type: 'sawtooth', vol: 0.03, detune: 9, cutoff: moodName === 'dark' ? 700 : 1300, attack: 0.5, sustain: 0.85, release: 0.7, rev: 0.5, pan: (k - 1) * 0.4 })));
        // arpegio con efecto ping-pong
        if (i % 2 === 0) {
            const pat = section === 'A' ? [0, 1, 2, 1, 0, 2, 1, 2] : [2, 1, 0, 1, 2, 0, 1, 0];
            const n = ch.c[pat[i / 2]] + m.arpOct + (i === 14 && section === 'B' ? 12 : 0);
            voice(mtof(n), sd * 1.5, MB({ at, type: 'square', vol: m.arpVol, cutoff: 2600, cutTo: 700, cutTime: sd * 1.4, decay: sd, sustain: 0.15, rev: 0.3, pan: (i / 2) % 2 ? 0.45 : -0.45 }));
        }
        // melodía (en el ambiente oscuro, campanitas sueltas)
        if (m.lead && i % 2 === 0) {
            const n = LEAD[bar][i / 2];
            if (n) voice(mtof(n), sd * 2.6, MB({ at, type: 'triangle', vol: 0.085, attack: 0.01, decay: sd * 1.5, sustain: 0.45, vib: 5.5, rev: 0.35, detune: 4 }));
        }
        if (!m.lead && (i === 0 || i === 10) && bar % 2 === 0) voice(mtof(ch.c[2] + 24), sd * 6, MB({ at, type: 'sine', vol: 0.05, decay: sd * 3, sustain: 0.2, rev: 0.8, pan: i ? 0.4 : -0.4 }));
        // batería
        if (m.drums === 'groove') {
            if (i === 0 || i === 7 || i === 8) kick(MB({ at }));
            if (i === 4 || i === 12) snare(MB({ at }));
            if (i % 2 === 0) hat(MB({ at, pan: 0.25 }), i === 14);
            if (bar === 7 && i >= 12) snare(MB({ at, vol: 0.12 }));                       // redoble de final de vuelta
        } else if (m.drums === 'drive') {
            if (i % 4 === 0) kick(MB({ at }));
            if (i === 4 || i === 12) { snare(MB({ at })); clap(MB({ at })); }
            hat(MB({ at, pan: i % 2 ? 0.3 : -0.3 }), i % 4 === 2);
        }
        return sd;
    }
    // ---------- música pre-renderizada ----------
    // Antes la música se sintetizaba en directo: cada semicorchea creaba decenas de osciladores,
    // filtros y envíos de reverb en el hilo principal, compitiendo con el juego (en móvil se notaba).
    // Ahora cada ambiente (normal / lava / oscuro) se "graba" UNA vez con un OfflineAudioContext
    // (fuera de tiempo real) y luego se reproduce en bucle como un simple búfer: casi 0 CPU.
    const MUSIC_RATE = 24000;   // frecuencia de muestreo de la música grabada (suficiente y ocupa la mitad)
    const MUSIC_TAIL = 3;       // segundos extra para las colas (reverb, notas largas) que se pliegan al inicio
    const LOOP_STEPS = 128;     // 8 compases de semicorcheas
    const musicBufs = {};       // mood -> AudioBuffer
    const rendering = {};       // mood -> Promise
    let musicSrc = null, musicSrcGain = null, playingMood = null;

    function renderMood(name) {
        if (musicBufs[name]) return Promise.resolve(musicBufs[name]);
        if (rendering[name]) return rendering[name];
        const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!OAC) return Promise.resolve(null);
        const m = MOODS[name];
        const loopSec = LOOP_STEPS * (60 / m.bpm / 4);
        const total = Math.ceil((loopSec + MUSIC_TAIL) * MUSIC_RATE);
        let off;
        try { off = new OAC(2, total, MUSIC_RATE); } catch (e) { return Promise.resolve(null); }

        // Se apunta momentáneamente el sintetizador al contexto offline (todo es síncrono)
        const saved = { ctx, revIn, noiseBuf, musicBus, moodName };
        try {
            ctx = off;
            // misma cadena que la salida en directo (EQ suave + limitador), aplicada ya en la grabación
            const limO = off.createDynamicsCompressor();
            limO.threshold.value = -10; limO.knee.value = 6; limO.ratio.value = 12; limO.attack.value = 0.003; limO.release.value = 0.18;
            const hpO = off.createBiquadFilter(); hpO.type = 'highpass'; hpO.frequency.value = 32;
            const shO = off.createBiquadFilter(); shO.type = 'highshelf'; shO.frequency.value = 9000; shO.gain.value = -3;
            const masterO = off.createGain(); masterO.gain.value = MUSIC_VOL * 0.85; // mismo nivel que entraba al limitador en directo
            masterO.connect(hpO); hpO.connect(shO); shO.connect(limO); limO.connect(off.destination);
            const outO = off.createGain(); outO.gain.value = 1; outO.connect(masterO);
            const conv = off.createConvolver(); conv.buffer = makeImpulse(2.1, 2.6);
            const revGain = off.createGain(); revGain.gain.value = 0.55;
            const revLp = off.createBiquadFilter(); revLp.type = 'lowpass'; revLp.frequency.value = 5200;
            revIn = off.createGain(); revIn.connect(conv); conv.connect(revLp); revLp.connect(revGain); revGain.connect(outO);
            musicBus = off.createGain(); musicBus.gain.value = 1; musicBus.connect(outO);
            noiseBuf = off.createBuffer(1, MUSIC_RATE * 2, MUSIC_RATE);
            const nd = noiseBuf.getChannelData(0);
            for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
            moodName = name;
            let t = 0.0001;
            for (let st = 0; st < LOOP_STEPS; st++) t += scheduleStep(t, st);
        } catch (e) {
            console.warn('No se pudo preparar la música', e);
        } finally {
            ctx = saved.ctx; revIn = saved.revIn; noiseBuf = saved.noiseBuf; musicBus = saved.musicBus; moodName = saved.moodName;
        }

        rendering[name] = new Promise((resolve) => {
            off.oncomplete = (ev) => resolve(ev.renderedBuffer);
            const r = off.startRendering();
            if (r && r.then) r.then(resolve, () => resolve(null));
        }).then((buf) => {
            if (!buf) return null;
            // Bucle sin cortes: la cola que sobra del final se suma al principio
            const loopLen = Math.round(loopSec * MUSIC_RATE);
            const loop = off.createBuffer(2, loopLen, MUSIC_RATE); // (createBuffer: compatible también con Safari antiguo)
            for (let c = 0; c < 2; c++) {
                const src = buf.getChannelData(c), dst = loop.getChannelData(c);
                dst.set(src.subarray(0, loopLen));
                for (let i = loopLen; i < src.length; i++) dst[i - loopLen] += src[i];
            }
            musicBufs[name] = loop;
            if (musicWanted && musicOn && name === moodName && playingMood !== name) playMood(name);
            return loop;
        }).catch(() => null);
        return rendering[name];
    }
    // Se graban los tres ambientes al cargar (el normal primero), con pausas para no dar tirones
    function prerenderAll() {
        renderMood('normal')
            .then(() => new Promise((r) => setTimeout(r, 400))).then(() => renderMood('lava'))
            .then(() => new Promise((r) => setTimeout(r, 400))).then(() => renderMood('dark'));
    }

    function playMood(name) {
        if (!ctx || !musicBus) return;
        const buf = musicBufs[name];
        if (!buf) { renderMood(name); return; }           // empezará solo cuando termine de grabarse
        const t = ctx.currentTime, FADE = 0.8;
        if (musicSrc) { // fundido cruzado con el ambiente anterior
            const oldSrc = musicSrc, oldGain = musicSrcGain;
            oldGain.gain.cancelScheduledValues(t);
            oldGain.gain.setValueAtTime(oldGain.gain.value, t);
            oldGain.gain.linearRampToValueAtTime(0, t + FADE);
            try { oldSrc.stop(t + FADE + 0.05); } catch (e) { /* ya parada */ }
        }
        const src = ctx.createBufferSource(), g = ctx.createGain();
        src.buffer = buf; src.loop = true;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(1, t + (musicSrc ? FADE : 0.05));
        src.connect(g); g.connect(musicBus);
        src.start(t);
        musicSrc = src; musicSrcGain = g; playingMood = name;
    }
    function startMusicLoop() {
        if (!ctx || timer) return;
        timer = true; // la música está sonando (o esperando a estar grabada)
        musicBus.gain.cancelScheduledValues(ctx.currentTime);
        musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
        musicBus.gain.linearRampToValueAtTime(MUSIC_VOL, ctx.currentTime + 1.2);
        playMood(moodName);
    }
    function stopMusicLoop() {
        timer = null;
        if (ctx && musicBus) {
            const t = ctx.currentTime;
            musicBus.gain.cancelScheduledValues(t);
            musicBus.gain.setValueAtTime(musicBus.gain.value, t);
            musicBus.gain.linearRampToValueAtTime(0, t + 0.6);
            if (musicSrc) { try { musicSrc.stop(t + 0.65); } catch (e) { /* ya parada */ } }
        }
        musicSrc = null; musicSrcGain = null; playingMood = null;
    }

    // ---------- API ----------
    const SFX = {
        play,
        unlock,
        musicStart() { musicWanted = true; step = 0; if (musicOn && ensure()) { if (ctx.state !== 'running') { try { ctx.resume(); } catch (e) { /* ignorar */ } } stopMusicLoop(); startMusicLoop(); } },
        musicStop() { musicWanted = false; stopMusicLoop(); },
        mood(name) {
            if (!MOODS[name] || name === moodName) return;
            moodName = name;
            if (timer && musicOn && musicWanted) playMood(name);
        },
        setMusic(on) {
            musicOn = !!on; writeBool(KEY_MUSIC, musicOn);
            if (!musicOn) stopMusicLoop();
            else { prerenderAll(); if (musicWanted && ensure()) startMusicLoop(); }
        },
        setSfx(on) { sfxOn = !!on; writeBool(KEY_SFX, sfxOn); if (sfxOn) play('click'); },
        musicEnabled() { return musicOn; },
        sfxEnabled() { return sfxOn; },
        _debug: { names: () => Object.keys(FX), state: () => ({ playing: playingMood, musicWanted, moodName, ready: Object.keys(musicBufs) }) },
    };
    window.SFX = SFX;

    // Grabar la música en segundo plano poco después de cargar (mientras se está en el menú)
    if (musicOn) setTimeout(prerenderAll, 600);

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
