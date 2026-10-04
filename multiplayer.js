/* =====================================================================
   BOX JUMP — Multijugador (carrera 1 contra 1)
   Depende de: game.js (window.BJGame) y backend.js (window.BJFirebase)

   - Retar a un amigo (círculo verde = conectado, rojo = no conectado).
   - Jugar con un desconocido: se invita a alguien de la sala que no sea amigo;
     si rechaza, se invita al siguiente. Si no hay nadie, se avisa.
   - Al aceptar: cuenta atrás de 10 s (foto y nombre VS foto y nombre) y
     carrera en los 5 primeros niveles de la fase del día. Gana quien
     supere antes el 5.º nivel. El rival se ve en modo sombra.
   - Ranking propio: victorias (users.mpWins) y carreras (users.mpPlayed).

   Firestore:
     lobby/{uid}                 jugadores que están ahora en la sala
     invites/{id}                invitaciones (pending/accepted/declined/expired)
     matches/{id}                carrera (jugadores, ganador)
     matches/{id}/state/{uid}    posición de cada jugador (para el fantasma)
   ===================================================================== */
(function () {
    'use strict';

    const G = window.BJGame;
    if (!G) { console.error('BJGame no disponible: multiplayer.js no se inicia'); return; }

    // ---------- ajustes ----------
    const ONLINE_MS = 75000;      // "conectado" si ha dado señales en los últimos 75 s
    const LOBBY_BEAT_MS = 20000;  // cada cuánto se renueva la presencia en la sala
    const LOBBY_TTL_MS = 50000;   // en la sala solo cuentan los que han renovado hace menos de esto
    const INVITE_TTL_MS = 25000;  // tiempo para aceptar una invitación
    const COUNTDOWN_S = 10;       // cuenta atrás antes de la carrera
    const RACE_FIRST = 5;         // la carrera usa los niveles de la fase del día...
    const RACE_LEVELS = 5;        // ...pero solo 5
    const SEND_EVERY_MS = 250;    // envío de la posición propia (4 veces por segundo)
    const OPP_TIMEOUT_MS = 30000; // si el rival no da señales en 30 s, se le da por desconectado

    // ---------- utilidades ----------
    const $ = (id) => document.getElementById(id);
    const FB = () => window.BJFirebase;
    const show = (el) => el && el.classList.remove('hidden');
    const hide = (el) => el && el.classList.add('hidden');
    const esc = (s) => String(s == null ? '' : s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
    const millis = (t) => (t && t.toMillis ? t.toMillis() : (typeof t === 'number' ? t : 0));
    const db = () => FB().db();
    const myUid = () => (FB() && FB().uid ? FB().uid() : null);
    const sfx = (n) => { try { if (window.SFX) window.SFX.play(n); } catch (e) { /* sin audio */ } };
    const avatar = (url) => url || 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#1e2d4d"/><circle cx="20" cy="15" r="7" fill="#3d5a9d"/><rect x="8" y="25" width="24" height="12" rx="6" fill="#3d5a9d"/></svg>');

    let toastTimer = null;
    function toast(msg) {
        let t = $('bj-toast');
        if (!t) { t = document.createElement('div'); t.id = 'bj-toast'; $('game-container').appendChild(t); }
        t.textContent = msg; t.style.display = 'block';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.style.display = 'none'; }, 3000);
    }
    function setStatus(msg) { const el = $('mp-status'); if (el) el.textContent = msg || ''; }

    // =================================================================
    // 1) SALA (pantalla multijugador)
    // =================================================================
    let lobbyTimer = null, friendsTimer = null, inLobby = false;

    async function lobbyBeat() {
        const uid = myUid(); if (!uid) return;
        try {
            const me = await FB().identity();
            await db().collection('lobby').doc(uid).set({
                username: me.username, photoURL: me.photoURL, busy: !!race, lastSeen: FB().serverTs(),
            });
        } catch (e) { console.warn('No se pudo entrar en la sala:', e); }
    }
    function leaveLobby() {
        inLobby = false;
        clearInterval(lobbyTimer); lobbyTimer = null;
        clearInterval(friendsTimer); friendsTimer = null;
        const uid = myUid();
        if (uid) db().collection('lobby').doc(uid).delete().catch(() => { /* no crítico */ });
    }

    function openLobby() {
        if (!FB() || !FB().isSignedIn()) { toast('Inicia sesión con Google primero'); return; }
        show($('mp-screen'));
        setStatus('');
        inLobby = true;
        lobbyBeat();
        clearInterval(lobbyTimer); lobbyTimer = setInterval(lobbyBeat, LOBBY_BEAT_MS);
        renderFriends();
        clearInterval(friendsTimer); friendsTimer = setInterval(renderFriends, 15000);
    }
    function closeLobby() {
        cancelOutgoing();
        leaveLobby();
        hide($('mp-screen'));
    }

    async function renderFriends() {
        const list = $('mp-friends');
        if (!list) return;
        if (!list.children.length) list.innerHTML = '<p class="ranking-empty">Cargando amigos...</p>';
        try {
            const friends = await FB().friendsWithPresence();
            const now = Date.now();
            friends.forEach((f) => { f.online = now - f.lastSeenMs < ONLINE_MS; });
            friends.sort((a, b) => (b.online - a.online) || a.username.localeCompare(b.username));
            if (!friends.length) {
                list.innerHTML = '<p class="ranking-empty">Aún no tienes amigos.<br>Añádelos con su código en Configuración o en el ranking.</p>';
                return;
            }
            list.innerHTML = '';
            friends.forEach((f) => {
                const row = document.createElement('div');
                row.className = 'mp-friend';
                row.innerHTML = `
                    <span class="mp-avatar-wrap"><img src="${esc(avatar(f.photoURL))}" alt="" /><i class="mp-dot ${f.online ? 'on' : 'off'}"></i></span>
                    <span class="mp-name">${esc(f.username)}<small>${f.online ? 'Conectado' : 'No conectado'}</small></span>
                    <button class="mp-invite-btn" type="button" ${f.online ? '' : 'disabled'}>⚔️ RETAR</button>`;
                row.querySelector('img').onerror = function () { this.src = avatar(''); };
                row.querySelector('button').onclick = () => {
                    if (outgoing) { toast('Ya estás esperando una respuesta'); return; }
                    if (!f.online) { toast(f.username + ' no está conectado'); return; }
                    sendInvite({ uid: f.uid, name: f.username, photo: f.photoURL }, 'friend');
                };
                list.appendChild(row);
            });
        } catch (e) {
            console.error('No se pudieron cargar los amigos:', e);
            list.innerHTML = '<p class="ranking-empty">No se pudieron cargar tus amigos.<br>(¿Reglas de Firestore sin actualizar?)</p>';
        }
    }

    // =================================================================
    // 2) INVITACIONES QUE ENVÍO
    // =================================================================
    let outgoing = null;     // { ref, target, kind, unsub, timer }
    let randomQueue = [];    // candidatos de la sala para "jugar con un desconocido"

    async function sendInvite(target, kind) {
        const uid = myUid(); if (!uid) return;
        try {
            const me = await FB().identity();
            const ref = db().collection('invites').doc();
            await ref.set({
                from: uid, fromName: me.username, fromPhoto: me.photoURL,
                to: target.uid, toName: target.name || 'Jugador',
                kind, status: 'pending', createdAt: FB().serverTs(),
            });
            outgoing = { ref, target, kind, me, unsub: null, timer: null };
            setStatus(`⏳ Esperando a ${target.name || 'tu rival'}...`);
            show($('mp-cancel'));
            outgoing.unsub = ref.onSnapshot((snap) => {
                const d = snap.data(); if (!d || !outgoing || outgoing.ref.id !== ref.id) return;
                if (d.status === 'accepted' && d.matchId) {
                    const o = outgoing; clearOutgoing();
                    startRace(d.matchId, o.target, o.me);
                } else if (d.status === 'declined' || d.status === 'expired') {
                    const o = outgoing; clearOutgoing();
                    onRefused(o.target, o.kind, d.status === 'expired');
                }
            }, (e) => console.warn('Invitación sin seguimiento:', e));
            // Si no contesta a tiempo, caduca (solo si sigue pendiente)
            outgoing.timer = setTimeout(() => expireInvite(ref), INVITE_TTL_MS);
        } catch (e) {
            console.error('No se pudo enviar la invitación:', e);
            setStatus('No se pudo enviar la invitación.');
        }
    }
    async function expireInvite(ref) {
        try {
            await db().runTransaction(async (tx) => {
                const s = await tx.get(ref);
                if (s.exists && s.data().status === 'pending') tx.update(ref, { status: 'expired' });
            });
        } catch (e) { /* el listener resolverá lo que haya pasado */ }
    }
    function clearOutgoing() {
        if (!outgoing) return;
        if (outgoing.unsub) outgoing.unsub();
        clearTimeout(outgoing.timer);
        outgoing = null;
        hide($('mp-cancel'));
    }
    function cancelOutgoing() {
        randomQueue = [];
        if (!outgoing) return;
        const ref = outgoing.ref;
        clearOutgoing();
        expireInvite(ref);
        setStatus('Invitación cancelada.');
    }
    function onRefused(target, kind, timedOut) {
        const who = target.name || 'El jugador';
        if (kind === 'random') {
            setStatus(`${who} ${timedOut ? 'no ha contestado' : 'ha rechazado'}. Buscando a otro jugador...`);
            tryNextRandom();
        } else {
            setStatus(`${who} ${timedOut ? 'no ha contestado a tiempo' : 'ha rechazado la invitación'}.`);
            sfx('miss');
        }
    }

    // Jugar con un desconocido: alguien de la sala que no sea amigo
    async function playRandom() {
        if (outgoing) { toast('Ya estás esperando una respuesta'); return; }
        setStatus('🔎 Buscando jugadores en la sala...');
        try {
            const uid = myUid();
            const friends = new Set(await FB().myFriendUids());
            const snap = await db().collection('lobby').get();
            const now = Date.now();
            randomQueue = snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
                .filter((c) => c.uid !== uid && !friends.has(c.uid) && !c.busy && now - millis(c.lastSeen) < LOBBY_TTL_MS);
            for (let i = randomQueue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [randomQueue[i], randomQueue[j]] = [randomQueue[j], randomQueue[i]]; }
            tryNextRandom(true);
        } catch (e) {
            console.error('No se pudo leer la sala:', e);
            setStatus('No se pudo buscar en la sala.');
        }
    }
    function tryNextRandom(first) {
        const c = randomQueue.shift();
        if (!c) {
            setStatus(first ? '😕 No hay nadie en la sala ahora mismo. Prueba en un rato o reta a un amigo.'
                : '😕 No queda nadie más en la sala. Prueba en un rato.');
            if (first) toast('No hay nadie en la sala');
            return;
        }
        sendInvite({ uid: c.uid, name: c.username, photo: c.photoURL }, 'random');
    }

    // =================================================================
    // 3) INVITACIONES QUE RECIBO
    // =================================================================
    let inviteUnsub = null;
    let incoming = null;     // { id, data, timer, tick }
    const declinedQueue = [];

    function listenInvites() {
        stopInvites();
        const uid = myUid(); if (!uid) return;
        inviteUnsub = db().collection('invites').where('to', '==', uid).where('status', '==', 'pending')
            .onSnapshot((snap) => {
                snap.docChanges().forEach((ch) => {
                    if (ch.type !== 'added') return;
                    const d = ch.doc.data();
                    const age = Date.now() - (millis(d.createdAt) || Date.now());
                    if (age > INVITE_TTL_MS * 2) return;            // invitación antigua
                    if (race || incoming) { respond(ch.doc.id, 'declined'); return; } // ocupado
                    showIncoming(ch.doc.id, d);
                });
                // si la que estoy viendo ya no está pendiente (la cancelaron), se cierra
                if (incoming && !snap.docs.some((d) => d.id === incoming.id)) closeIncoming();
            }, (e) => console.warn('No se pueden recibir invitaciones:', e));
    }
    function stopInvites() { if (inviteUnsub) { inviteUnsub(); inviteUnsub = null; } closeIncoming(); }

    function showIncoming(id, d) {
        incoming = { id, data: d, left: Math.round(INVITE_TTL_MS / 1000) };
        $('mp-inv-photo').src = avatar(d.fromPhoto);
        $('mp-inv-text').innerHTML = `<strong>${esc(d.fromName || 'Un jugador')}</strong> te reta a una carrera` +
            (d.kind === 'random' ? '<br><small>(jugador de la sala)</small>' : '');
        $('mp-inv-timer').textContent = incoming.left + ' s';
        show($('mp-invite-modal'));
        sfx('rescue_alert');
        if (navigator.vibrate) { try { navigator.vibrate([60, 60, 60]); } catch (e) { /* sin vibración */ } }
        incoming.timer = setInterval(() => {
            if (!incoming) return;
            incoming.left--;
            $('mp-inv-timer').textContent = Math.max(0, incoming.left) + ' s';
            if (incoming.left <= 0) { respond(incoming.id, 'declined'); closeIncoming(); }
        }, 1000);
    }
    function closeIncoming() {
        if (incoming) clearInterval(incoming.timer);
        incoming = null;
        hide($('mp-invite-modal'));
    }
    function respond(id, status) {
        const ref = db().collection('invites').doc(id);
        return db().runTransaction(async (tx) => {
            const s = await tx.get(ref);
            if (s.exists && s.data().status === 'pending') tx.update(ref, { status });
        }).catch((e) => console.warn('No se pudo responder a la invitación:', e));
    }

    async function acceptIncoming() {
        if (!incoming) return;
        const { id, data } = incoming;
        closeIncoming();
        cancelOutgoing();
        const uid = myUid();
        try {
            const me = await FB().identity();
            const invRef = db().collection('invites').doc(id);
            const matchRef = db().collection('matches').doc();
            const ok = await db().runTransaction(async (tx) => {
                const s = await tx.get(invRef);
                if (!s.exists || s.data().status !== 'pending') return false;
                tx.set(matchRef, {
                    players: [data.from, uid],
                    names: { [data.from]: data.fromName || 'Jugador', [uid]: me.username },
                    photos: { [data.from]: data.fromPhoto || '', [uid]: me.photoURL || '' },
                    day: FB().dailyKey(), createdAt: FB().serverTs(), winner: null, reason: null,
                });
                tx.update(invRef, { status: 'accepted', matchId: matchRef.id });
                return true;
            });
            if (!ok) { toast('La invitación ya no está disponible'); return; }
            if (G.isPlaying()) G.toMenu(); // se abandona la partida que estuviera jugando
            startRace(matchRef.id, { uid: data.from, name: data.fromName, photo: data.fromPhoto }, me);
        } catch (e) {
            console.error('No se pudo aceptar la invitación:', e);
            toast('No se pudo aceptar la invitación');
        }
    }

    // =================================================================
    // 4) CARRERA
    // =================================================================
    let race = null; // { id, opp, me, ref, unsubMatch, unsubOpp, sendTimer, watchTimer, lastOppAt, lastSent, started, ended, cdTimer }

    function startRace(matchId, opp, me) {
        leaveLobby();
        hide($('mp-screen')); hide($('mp-result-screen'));
        setStatus('');
        const uid = myUid();
        const ref = db().collection('matches').doc(matchId);
        race = { id: matchId, opp, me, ref, lastOppAt: Date.now(), lastSent: '', started: false, ended: false, day: FB().dailyKey() };

        // ganador (lo escribe quien termina primero, o el que se queda si el otro abandona)
        race.unsubMatch = ref.onSnapshot((snap) => {
            const d = snap.data(); if (!d || !race || race.id !== matchId) return;
            if (d.day) race.day = d.day;
            if (d.winner) endRace(d.winner === uid, d.reason);
        }, (e) => console.warn('Carrera sin seguimiento:', e));
        // posición del rival (fantasma)
        race.unsubOpp = ref.collection('state').doc(opp.uid).onSnapshot((snap) => {
            const d = snap.data(); if (!d || !race) return;
            race.lastOppAt = Date.now();
            G.setGhost({ name: opp.name, level: d.level, hgt: d.hgt, xf: d.xf, rot: d.rot, box: d.box, alive: d.alive });
        });

        // cuenta atrás: foto y nombre VS foto y nombre
        $('vs-me-photo').src = avatar(me.photoURL); $('vs-me-name').textContent = me.username;
        $('vs-opp-photo').src = avatar(opp.photo); $('vs-opp-name').textContent = opp.name || 'Rival';
        $('vs-names').textContent = `${me.username} VS ${opp.name || 'Rival'}`;
        let left = COUNTDOWN_S;
        $('vs-count').textContent = left;
        show($('mp-vs-screen'));
        sfx('level_up');
        race.cdTimer = setInterval(() => {
            left--;
            if (left > 0) { $('vs-count').textContent = left; sfx(left <= 3 ? 'rescue_ok' : 'click'); return; }
            clearInterval(race.cdTimer); race.cdTimer = null;
            $('vs-count').textContent = '¡YA!';
            sfx('win');
            setTimeout(() => { hide($('mp-vs-screen')); beginRace(); }, 500);
        }, 1000);
    }

    function beginRace() {
        if (!race || race.ended) return;
        race.started = true; race.lastOppAt = Date.now();
        G.setGhost({ name: race.opp.name, level: RACE_FIRST, hgt: 0, xf: 0.5, rot: 0, box: 'normal', alive: true });
        G.start({
            type: 'race', first: RACE_FIRST, last: RACE_FIRST + RACE_LEVELS - 1, total: RACE_LEVELS,
            seed: 'bj-daily-' + race.day, // mismos niveles que la fase del día
            box: 'normal',                // los dos empiezan con la misma caja
            respawn: true,                // al caer se reaparece en el mismo nivel a los 3 s
            onEnd: (r) => { if (r.completed) declareWinner(myUid(), 'meta'); return { silent: true }; },
            onExit: () => declareWinner(race && race.opp.uid, 'abandono'),
        });
        // envío de la posición propia
        race.sendTimer = setInterval(sendState, SEND_EVERY_MS);
        // rival desconectado
        race.watchTimer = setInterval(() => {
            if (race && race.started && !race.ended && Date.now() - race.lastOppAt > OPP_TIMEOUT_MS) declareWinner(myUid(), 'desconexion');
        }, 5000);
    }

    function sendState() {
        if (!race || !race.started || race.ended) return;
        const st = G.raceSnapshot();
        const key = JSON.stringify(st);
        if (key === race.lastSent && Date.now() - (race.lastSentAt || 0) < 5000) return; // nada nuevo (latido cada 5 s)
        race.lastSent = key; race.lastSentAt = Date.now();
        race.ref.collection('state').doc(myUid()).set(st).catch(() => { /* se reintenta en el siguiente envío */ });
    }

    function declareWinner(winnerUid, reason) {
        if (!race || race.ended || !winnerUid) return;
        const ref = race.ref;
        db().runTransaction(async (tx) => {
            const s = await tx.get(ref);
            if (s.exists && !s.data().winner) tx.update(ref, { winner: winnerUid, reason: reason || 'meta', finishedAt: FB().serverTs() });
        }).catch((e) => {
            console.error('No se pudo cerrar la carrera:', e);
            if (race && !race.ended) endRace(winnerUid === myUid(), reason); // sin conexión: se resuelve en local
        });
    }

    function endRace(won, reason) {
        if (!race || race.ended) return;
        const r = race;
        r.ended = true;
        clearInterval(r.cdTimer); clearInterval(r.sendTimer); clearInterval(r.watchTimer);
        if (r.unsubMatch) r.unsubMatch();
        if (r.unsubOpp) r.unsubOpp();
        hide($('mp-vs-screen'));
        G.setGhost(null);
        if (G.mode() === 'race') G.toMenu();
        race = null;
        FB().recordRaceResult(won);

        const opp = r.opp.name || 'Tu rival';
        let note;
        if (reason === 'abandono') note = won ? `${opp} ha abandonado la carrera.` : 'Has abandonado la carrera.';
        else if (reason === 'desconexion') note = won ? `${opp} se ha desconectado.` : 'Has perdido la conexión con la carrera.';
        else note = won ? `Has superado los ${RACE_LEVELS} niveles antes que ${opp}.` : `${opp} ha superado los ${RACE_LEVELS} niveles antes que tú.`;
        $('mp-result-title').textContent = won ? '🏆 ¡HAS GANADO!' : '😓 HAS PERDIDO';
        $('mp-result-note').textContent = note;
        show($('mp-result-screen'));
        sfx(won ? 'win' : 'game_over');
    }

    // =================================================================
    // 5) INTERFAZ
    // =================================================================
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    on('mp-btn', openLobby);
    on('cup-mp-btn', () => FB() && FB().openRanking('multi'));
    on('mp-random-btn', playRandom);
    on('mp-cancel', cancelOutgoing);
    on('mp-close-btn', closeLobby);
    on('mp-inv-accept', acceptIncoming);
    on('mp-inv-decline', () => { if (incoming) respond(incoming.id, 'declined'); closeIncoming(); });
    on('mp-result-ranking', () => { hide($('mp-result-screen')); FB() && FB().openRanking('multi'); });
    on('mp-result-again', () => { hide($('mp-result-screen')); openLobby(); });
    on('mp-result-close', () => hide($('mp-result-screen')));

    window.addEventListener('bj-auth-changed', (e) => {
        if (e.detail && e.detail.signedIn) listenInvites();
        else { stopInvites(); cancelOutgoing(); if (inLobby) closeLobby(); }
    });
    // Al cerrar la página se sale de la sala y se cancela lo pendiente
    window.addEventListener('pagehide', () => {
        if (inLobby) leaveLobby();
        if (outgoing) expireInvite(outgoing.ref);
    });
})();
