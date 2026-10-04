/* =====================================================================
   BOX JUMP — Backend (login, ranking, guardado de partida)
   Reescrito desde cero. Usa el SDK "compat" de Firebase (scripts clásicos,
   sin import/export encadenados) para máxima compatibilidad entre
   navegadores y dispositivos.

   Login: Google (Firebase Auth).

   Contrato con game.js (no se toca game.js, solo se respeta esta API):
     - window.BJFirebase.isSignedIn()          -> boolean
     - window.BJFirebase.promptSignIn()        -> abre el login
     - window.BJFirebase.reportRun(level, heightCm)   (nivel alcanzado y altura en ese nivel)
     - window.BJFirebase.saveProgress(level)
     - evento 'bj-auth-changed' en window, con detail:
         { signedIn: false }
         { signedIn: true, uid, bestLevel, bestHeight, username, savedGame }
   ===================================================================== */
(function () {
    'use strict';

    // ---------------------------------------------------------------
    // 1) Configuración e inicialización de Firebase
    // ---------------------------------------------------------------
    const firebaseConfig = {
        apiKey: "AIzaSyDe0IgL9f9s_2YbuFNBIEGsUW23YCdr-SE",
        authDomain: "boxjump-629c3.firebaseapp.com",
        projectId: "boxjump-629c3",
        storageBucket: "boxjump-629c3.firebasestorage.app",
        messagingSenderId: "379206365429",
        appId: "1:379206365429:web:3201f0350a03671e4f95bc",
        measurementId: "G-RZ45FWBDWY",
    };

    // Si el SDK de Firebase no se ha cargado (red, bloqueador, etc.) lo
    // decimos en pantalla en vez de fallar en silencio.
    if (typeof firebase === 'undefined' || typeof firebase.auth !== 'function' || typeof firebase.firestore !== 'function') {
        const msg = document.getElementById('auth-debug-msg');
        if (msg) {
            msg.innerText = 'No se pudo cargar Firebase (revisa tu conexión o desactiva bloqueadores) y recarga la página.';
            msg.classList.remove('hidden');
        }
        console.error('Firebase SDK no disponible');
        return;
    }

    firebase.initializeApp(firebaseConfig);
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    // ¿Estamos dentro de un iframe? Ahí signInWithRedirect no funciona.
    let inIframe = false;
    try { inIframe = window.self !== window.top; } catch (e) { inIframe = true; }
    const auth = firebase.auth();
    const db = firebase.firestore();
    // Ayuda en redes móviles / proxies donde el canal normal de Firestore falla
    try { db.settings({ experimentalAutoDetectLongPolling: true, merge: true }); } catch (e) { /* no crítico */ }
    const users = () => db.collection('users');

    // ---------------------------------------------------------------
    // 2) Referencias al DOM
    // ---------------------------------------------------------------
    const $ = (id) => document.getElementById(id);

    const dom = {
        loginBlock: $('login-block'),
        profileBlock: $('profile-block'),
        profileAvatar: $('profile-avatar'),
        profileName: $('profile-name'),
        googleBtn: $('google-signin-btn'),
        signoutBtn: $('signout-btn'),
        authDebugMsg: $('auth-debug-msg'),
        rankingFab: $('ranking-fab'),
        usernameRow: $('username-row'),
        editUsernameBtn: $('edit-username-btn'),
        usernameEditRow: $('username-edit-row'),
        usernameInput: $('username-input'),
        saveUsernameBtn: $('save-username-btn'),
        rankingModal: $('ranking-modal'),
        rankingList: $('ranking-list'),
        closeRankingBtn: $('close-ranking-btn'),
        tabGlobal: $('tab-global'),
        tabFriends: $('tab-friends'),
        rankingTitle: $('ranking-title'),
        settingsFriendInput: $('settings-friend-input'),
        settingsFriendBtn: $('settings-friend-btn'),
        settingsFriendMsg: $('settings-friend-msg'),
        rankingNote: $('ranking-note'),
        trophyBar: $('trophy-bar'),
        trophyBanner: $('trophy-banner'),
        addFriendRow: $('add-friend-row'),
        friendCodeInput: $('friend-code-input'),
        addFriendBtn: $('add-friend-btn'),
        myFriendCodeEl: $('my-friend-code'),
        myCodeValue: $('my-code-value'),
        copyCodeBtn: $('copy-code-btn'),
        settingsCodeInput: $('settings-code-input'),
        settingsCodeSave: $('settings-code-save'),
        settingsCodeReset: $('settings-code-reset'),
        settingsMsg: $('settings-msg'),
    };

    dom.profileAvatar.onerror = () => { dom.profileAvatar.style.visibility = 'hidden'; };

    let currentUser = null;

    function avatarFor(name) {
        const letter = ((name || 'J').trim()[0] || 'J').toUpperCase().replace(/[<>&"']/g, 'J');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#101e3a"/><text x="32" y="43" font-size="32" font-family="Arial" font-weight="700" fill="#00f2ff" text-anchor="middle">${letter}</text></svg>`;
        return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }
    let activeRankingTab = 'global';   // 'global' | 'friends'
    let activeRankingScope = 'general'; // 'daily' (ranking del día) | 'general' | 'multi' (multijugador)

    const AUTH_ERRORS = {
        'auth/popup-closed-by-user': 'Has cerrado la ventana de Google antes de terminar.',
        'auth/popup-blocked': 'El navegador ha bloqueado la ventana de Google. Permite las ventanas emergentes.',
        'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase (Authentication → Settings → Authorized domains).',
        'auth/network-request-failed': 'Error de red. Comprueba tu conexión.',
        'auth/too-many-requests': 'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
        'auth/user-disabled': 'Esta cuenta ha sido deshabilitada.',
        'auth/operation-not-allowed': 'El acceso con Google no está activado en Firebase.',
        'auth/web-storage-unsupported': 'Tu navegador bloquea el almacenamiento. Abre el juego en Chrome o Safari.',
    };
    function showAuthError(err, isInfo) {
        if (!dom.authDebugMsg) return;
        let text;
        if (typeof err === 'string') text = err;
        else {
            const base = (err && AUTH_ERRORS[err.code]) || (err && (err.message || err.code)) || 'Error desconocido';
            text = (err && err.code && !base.includes(err.code)) ? `${base} (${err.code})` : base;
        }
        dom.authDebugMsg.style.color = isInfo ? '#5dffb0' : '#ff6b6b';
        dom.authDebugMsg.innerText = text;
        dom.authDebugMsg.classList.remove('hidden');
    }
    function hideAuthError() {
        dom.authDebugMsg && dom.authDebugMsg.classList.add('hidden');
    }

    // ---------------------------------------------------------------
    // 3) Nombres de usuario únicos (editable, con sufijo 1/2/3... si
    //    ya existe)
    // ---------------------------------------------------------------
    async function ensureUniqueUsername(base, uidToExclude) {
        let candidate = (base || '').trim().slice(0, 20) || 'Jugador';
        let suffix = 0;
        // Prueba "Nombre", "Nombre1", "Nombre2"... hasta encontrar uno libre.
        while (true) {
            const attempt = suffix === 0 ? candidate : `${candidate}${suffix}`;
            try {
                const snap = await users().where('username', '==', attempt).get();
                const takenByOther = snap.docs.some((d) => d.id !== uidToExclude);
                if (!takenByOther) return attempt;
            } catch (err) {
                console.error('No se pudo comprobar el nombre de usuario:', err);
                return attempt; // no bloqueamos el login por esto
            }
            suffix++;
        }
    }

    // Código de amigo: por defecto el nombre de usuario; editable. Es único
    // (sin distinguir mayúsculas) y es lo que se comparte con los amigos.
    async function ensureUniqueFriendCode(base, uidToExclude) {
        const clean = (base || '').trim().slice(0, 20) || 'Jugador';
        let suffix = 0;
        while (true) {
            const attempt = suffix === 0 ? clean : `${clean}${suffix}`;
            try {
                const snap = await users().where('friendCodeLower', '==', attempt.toLowerCase()).get();
                if (!snap.docs.some((d) => d.id !== uidToExclude)) return attempt;
            } catch (err) {
                console.error('No se pudo comprobar el código de amigo:', err);
                return attempt;
            }
            suffix++;
        }
    }

    function showSettingsMsg(text, ok) {
        if (!dom.settingsMsg) return;
        dom.settingsMsg.innerText = text || '';
        dom.settingsMsg.style.color = ok ? '#5dffb0' : '#ff6b6b';
        dom.settingsMsg.classList.toggle('hidden', !text);
    }

    function showFriendCode(code) {
        if (dom.myCodeValue) dom.myCodeValue.innerText = code || '-';
        if (dom.settingsCodeInput) dom.settingsCodeInput.value = code || '';
    }

    // ---------------------------------------------------------------
    // 4) Perfil del jugador en Firestore
    // ---------------------------------------------------------------
    async function loadOrCreateProfile(user) {
        const ref = users().doc(user.uid);
        const snap = await ref.get();

        if (!snap.exists) {
            const emailName = (user.email || '').split('@')[0];
            const username = await ensureUniqueUsername(user.displayName || emailName, user.uid);
            const profile = {
                displayName: user.displayName || emailName || 'Jugador',
                username,
                friendCode: username,
                friendCodeLower: username.toLowerCase(),
                friendCodeCustom: false,
                photoURL: user.photoURL || '',
                bestLevel: 1,
                bestHeight: 0,
                bestRank: RANK_BASE, // = bestLevel * RANK_BASE + bestHeight (permite ordenar sin índice compuesto)
                friends: [],
                savedGame: null,
                checkpointFromRank: true, // perfil nuevo: no necesita la corrección de versiones anteriores
                checkpointFromRank2: true, // ni la segunda corrección (partidas empezadas por error)
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            };
            await ref.set(profile);
            return profile;
        }

        // El perfil ya existe: refrescamos nombre/foto de Google, pero
        // respetamos el nombre de usuario editable que haya elegido.
        const data = snap.data();
        const emailName = (user.email || '').split('@')[0];
        const patch = {
            displayName: user.displayName || emailName || 'Jugador',
            photoURL: user.photoURL || '',
        };
        if (!data.username) {
            patch.username = await ensureUniqueUsername(user.displayName || emailName, user.uid);
        }
        if (!data.friendCode || !data.friendCodeLower) {
            const base = data.friendCode || patch.username || data.username;
            const code = await ensureUniqueFriendCode(base, user.uid);
            patch.friendCode = code;
            patch.friendCodeLower = code.toLowerCase();
            patch.friendCodeCustom = !!data.friendCodeCustom;
        }
        // Migración desde el sistema de puntos: calcula la clave de ranking (nivel, altura)
        if (typeof data.bestRank !== 'number') {
            patch.bestLevel = data.bestLevel || 1;
            patch.bestHeight = data.bestHeight || 0;
            patch.bestRank = patch.bestLevel * RANK_BASE + patch.bestHeight;
        }
        // Corrección única (versiones anteriores): si el ranking dice que llegó más lejos que la
        // partida guardada, se le deja continuar desde el último checkpoint (múltiplo de 5) de ese nivel.
        // Ej.: partida en nivel 10 y ranking en nivel 24 -> "Continuar (Nivel 20)". Solo se hace una vez.
        // Segunda corrección única (octubre 2026): jugadores que empezaron una nueva partida por error.
        // Igual que la anterior: si el ranking va por delante de la partida guardada, se recupera el
        // último checkpoint de su nivel del ranking. Se marca con checkpointFromRank2 y no se repite nunca más.
        if (!data.checkpointFromRank || !data.checkpointFromRank2) {
            const rankLevel = patch.bestLevel || data.bestLevel || 1;
            const rankCheckpoint = Math.floor(rankLevel / 5) * 5;
            const savedLevel = (data.savedGame && data.savedGame.level) || 0;
            if (rankCheckpoint >= 5 && rankCheckpoint > savedLevel) {
                patch.savedGame = { level: rankCheckpoint, updatedAt: Date.now() };
            }
            patch.checkpointFromRank = true;
            patch.checkpointFromRank2 = true;
        }
        await ref.update(patch);
        return { ...data, ...patch };
    }

    async function saveUsername(newName) {
        if (!currentUser) return null;
        const unique = await ensureUniqueUsername(newName, currentUser.uid);
        const ref = users().doc(currentUser.uid);
        const patch = { username: unique };
        try {
            const snap = await ref.get();
            const data = snap.exists ? snap.data() : {};
            // Si no ha personalizado el código, sigue al nombre de usuario
            if (!data.friendCodeCustom) {
                const code = await ensureUniqueFriendCode(unique, currentUser.uid);
                patch.friendCode = code;
                patch.friendCodeLower = code.toLowerCase();
                patch.friendCodeCustom = false;
            }
        } catch (err) { console.error('No se pudo actualizar el código de amigo:', err); }
        await ref.update(patch);
        if (patch.friendCode) showFriendCode(patch.friendCode);
        return unique;
    }

    async function saveFriendCode(rawCode) {
        if (!currentUser) return { ok: false, msg: 'Inicia sesión primero' };
        const code = (rawCode || '').trim();
        if (code.length < 3 || code.length > 20) return { ok: false, msg: 'Debe tener entre 3 y 20 caracteres' };
        if (!/^[\p{L}\p{N}_.\-]+$/u.test(code)) return { ok: false, msg: 'Solo letras, números, _ . -' };
        try {
            const snap = await users().where('friendCodeLower', '==', code.toLowerCase()).get();
            if (snap.docs.some((d) => d.id !== currentUser.uid)) return { ok: false, msg: 'Ese código ya está en uso' };
            await users().doc(currentUser.uid).update({
                friendCode: code,
                friendCodeLower: code.toLowerCase(),
                friendCodeCustom: true,
            });
            showFriendCode(code);
            return { ok: true, code };
        } catch (err) {
            console.error('No se pudo guardar el código de amigo:', err);
            return { ok: false, msg: 'Error al guardar el código' };
        }
    }

    async function resetFriendCode() {
        if (!currentUser) return { ok: false, msg: 'Inicia sesión primero' };
        try {
            const ref = users().doc(currentUser.uid);
            const snap = await ref.get();
            const username = (snap.exists && snap.data().username) || currentUser.displayName || 'Jugador';
            const code = await ensureUniqueFriendCode(username, currentUser.uid);
            await ref.update({ friendCode: code, friendCodeLower: code.toLowerCase(), friendCodeCustom: false });
            showFriendCode(code);
            return { ok: true, code };
        } catch (err) {
            console.error('No se pudo restablecer el código de amigo:', err);
            return { ok: false, msg: 'Error al restablecer el código' };
        }
    }

    // Guarda tu mejor marca: primero cuenta el nivel y, a igualdad, la altura (cm) alcanzada en él.
    async function reportRun(level, height) {
        if (!currentUser) return;
        try {
            const ref = users().doc(currentUser.uid);
            const snap = await ref.get();
            const data = snap.exists ? snap.data() : {};
            const oldRank = typeof data.bestRank === 'number'
                ? data.bestRank
                : (data.bestLevel || 1) * RANK_BASE + (data.bestHeight || 0);
            const h = Math.max(0, Math.min(RANK_BASE - 1, Math.round(height || 0)));
            const newRank = level * RANK_BASE + h;
            if (newRank > oldRank) {
                await ref.update({
                    bestLevel: level, bestHeight: h, bestRank: newRank,
                    displayName: currentUser.displayName || 'Jugador',
                    photoURL: currentUser.photoURL || '',
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                });
            }
        } catch (err) {
            console.error('No se pudo guardar la marca:', err);
        }
    }

    // Nueva partida confirmada: se borra el checkpoint guardado
    async function resetProgress() {
        if (!currentUser) return;
        try { await users().doc(currentUser.uid).update({ savedGame: null }); }
        catch (err) { console.error('No se pudo borrar el progreso:', err); }
    }

    async function saveProgress(level) {
        if (!currentUser) return;
        try {
            await users().doc(currentUser.uid).update({
                savedGame: { level, updatedAt: Date.now() },
            });
        } catch (err) {
            console.error('No se pudo guardar el progreso:', err);
        }
    }

    // ---------------------------------------------------------------
    // 5) Ranking (global y amigos)
    // ---------------------------------------------------------------
    // Orden del ranking: primero el nivel máximo alcanzado y después la altura (cm) en ese nivel.
    const RANK_BASE = 100000;
    const rankKeyOf = (u) => (typeof u.bestRank === 'number' ? u.bestRank : (u.bestLevel || 1) * RANK_BASE + (u.bestHeight || 0));
    const rankCompare = (a, b) => rankKeyOf(b) - rankKeyOf(a);

    async function fetchGlobalTop(n) {
        // Campo único (bestRank): no necesita índice compuesto
        const snap = await users().orderBy('bestRank', 'desc').limit(n).get();
        return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    }

    async function fetchMultiTop(n) {
        const snap = await users().orderBy('mpWins', 'desc').limit(n).get();
        return snap.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((u) => (u.mpWins || 0) > 0 || (u.mpPlayed || 0) > 0);
    }

    async function fetchFriendsTop() {
        if (!currentUser) return [];
        const mySnap = await users().doc(currentUser.uid).get();
        const myData = mySnap.exists ? mySnap.data() : { friends: [], bestLevel: 1, bestHeight: 0 };
        const list = [{ uid: currentUser.uid, ...myData }];
        for (const fid of myData.friends || []) {
            try {
                const fSnap = await users().doc(fid).get();
                if (fSnap.exists) list.push({ uid: fid, ...fSnap.data() });
            } catch (err) { /* amigo no accesible: se omite */ }
        }
        list.sort(rankCompare);
        return list;
    }

    // ---------- Solicitudes de amistad ----------
    // friendRequests/{from}_{to}: { from, to, fromName, fromPhoto, toName, status: 'pending' | 'accepted', createdAt }
    // - Quien envía crea la solicitud (pending).
    // - Quien la recibe ve una notificación: al aceptar se añade al otro en SU lista y marca 'accepted';
    //   al rechazar la borra.
    // - Quien la envió, al ver 'accepted', añade al otro en SU lista y borra la solicitud.
    //   (Cada uno solo escribe en su propio perfil.)
    const friendReqs = () => db.collection('friendRequests');
    const reqId = (from, to) => from + '_' + to;

    async function findUidByCode(clean) {
        const q = await users().where('friendCodeLower', '==', clean.toLowerCase()).limit(1).get();
        if (!q.empty) return q.docs[0].id;
        const legacy = await users().doc(clean).get(); // compatibilidad con códigos antiguos (uid)
        return legacy.exists ? legacy.id : null;
    }

    async function addFriendByCode(code) {
        const clean = (code || '').trim();
        if (!currentUser) return { ok: false, msg: 'Inicia sesión primero' };
        if (!clean) return { ok: false, msg: 'Escribe el código de tu amigo' };
        const me = currentUser.uid;
        try {
            const friendUid = await findUidByCode(clean);
            if (!friendUid) return { ok: false, msg: 'No existe ningún jugador con ese código' };
            if (friendUid === me) return { ok: false, msg: 'No puedes añadirte a ti mismo' };

            const [mySnap, theirSnap] = await Promise.all([users().doc(me).get(), users().doc(friendUid).get()]);
            const mine = (mySnap.exists && mySnap.data().friends) || [];
            const theirs = (theirSnap.exists && theirSnap.data().friends) || [];
            const theirName = (theirSnap.exists && (theirSnap.data().username || theirSnap.data().displayName)) || 'Jugador';
            if (mine.includes(friendUid) && theirs.includes(me)) return { ok: false, msg: `Ya eres amigo de ${theirName}` };

            // ¿Esa persona ya me había enviado una solicitud? Entonces se acepta directamente.
            const back = await friendReqs().doc(reqId(friendUid, me)).get();
            if (back.exists && back.data().status === 'pending') {
                await acceptFriendRequest(back.id, back.data());
                return { ok: true, msg: `¡Ahora eres amigo de ${theirName}!` };
            }
            const mineReq = await friendReqs().doc(reqId(me, friendUid)).get();
            if (mineReq.exists && mineReq.data().status === 'pending') {
                return { ok: false, msg: `Ya enviaste una solicitud a ${theirName}. Espera a que la acepte.` };
            }
            if (mineReq.exists) await mineReq.ref.delete().catch(() => { /* restos de una anterior */ });

            const meId = await myIdentity();
            await friendReqs().doc(reqId(me, friendUid)).set({
                from: me, to: friendUid,
                fromName: meId.username, fromPhoto: meId.photoURL || '',
                toName: theirName,
                status: 'pending',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
            return { ok: true, msg: `Solicitud enviada a ${theirName} ✔` };
        } catch (err) {
            console.error('No se pudo enviar la solicitud de amistad:', err);
            return { ok: false, msg: 'No se pudo enviar la solicitud. Inténtalo de nuevo.' };
        }
    }

    async function acceptFriendRequest(id, data) {
        const me = currentUser.uid;
        await users().doc(me).update({ friends: firebase.firestore.FieldValue.arrayUnion(data.from) });
        await friendReqs().doc(id).update({ status: 'accepted' });
    }
    async function declineFriendRequest(id) {
        await friendReqs().doc(id).delete();
    }

    // Aviso corto en la parte de arriba
    let toastTimer = null;
    function toast(text, ms) {
        const el = $('bj-toast'); if (!el) return;
        el.innerText = text;
        el.classList.remove('hidden');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.add('hidden'), ms || 3200);
    }
    const playSfx = (n) => { try { if (window.SFX) window.SFX.play(n); } catch (e) { /* sin audio */ } };
    const escHtml = (t) => String(t == null ? '' : t).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

    // Solicitudes que me llegan: se muestran una a una, nunca en mitad de una partida
    const reqQueue = [];
    let reqShowing = null, reqWaitTimer = null, reqInUnsub = null, reqOutUnsub = null;
    const isPlayingNow = () => !!(window.BJGame && window.BJGame.isPlaying && window.BJGame.isPlaying());

    function pumpFriendRequests() {
        if (reqShowing || !reqQueue.length) return;
        if (isPlayingNow()) { // se espera a que termine la partida
            if (!reqWaitTimer) reqWaitTimer = setInterval(() => {
                if (!isPlayingNow()) { clearInterval(reqWaitTimer); reqWaitTimer = null; pumpFriendRequests(); }
            }, 1500);
            return;
        }
        reqShowing = reqQueue.shift();
        const d = reqShowing.data;
        $('friend-req-photo').src = d.fromPhoto || avatarFor(d.fromName);
        $('friend-req-text').innerHTML = `<strong>${escHtml(d.fromName || 'Un jugador')}</strong> quiere ser tu amigo`;
        $('friend-req-accept').disabled = false; $('friend-req-decline').disabled = false;
        $('friend-req-modal').classList.remove('hidden');
        playSfx('rescue_alert');
        if (navigator.vibrate) { try { navigator.vibrate([50, 50, 50]); } catch (e) { /* sin vibración */ } }
    }
    function closeFriendRequest() {
        reqShowing = null;
        $('friend-req-modal').classList.add('hidden');
        setTimeout(pumpFriendRequests, 300);
    }
    async function answerFriendRequest(accept) {
        if (!reqShowing) return;
        const { id, data } = reqShowing;
        $('friend-req-accept').disabled = true; $('friend-req-decline').disabled = true;
        try {
            if (accept) {
                await acceptFriendRequest(id, data);
                toast(`🤝 ¡Ahora eres amigo de ${data.fromName || 'tu amigo'}!`);
                playSfx('rescue_ok');
                if (!dom.rankingModal.classList.contains('hidden')) refreshRankingView();
            } else {
                await declineFriendRequest(id);
            }
        } catch (err) {
            console.error('No se pudo responder a la solicitud:', err);
            toast('No se pudo responder a la solicitud. Inténtalo de nuevo.');
            reqQueue.unshift(reqShowing); // vuelve a la cola
        }
        closeFriendRequest();
    }

    function listenFriendRequests() {
        stopFriendRequests();
        if (!currentUser) return;
        const me = currentUser.uid;
        // Recibidas y pendientes
        reqInUnsub = friendReqs().where('to', '==', me).where('status', '==', 'pending').onSnapshot((snap) => {
            snap.docChanges().forEach((ch) => {
                const id = ch.doc.id;
                if (ch.type === 'added') {
                    if (!reqQueue.some((r) => r.id === id) && !(reqShowing && reqShowing.id === id)) reqQueue.push({ id, data: ch.doc.data() });
                } else if (ch.type === 'removed') { // la cancelaron o ya se respondió
                    const i = reqQueue.findIndex((r) => r.id === id); if (i >= 0) reqQueue.splice(i, 1);
                }
            });
            pumpFriendRequests();
        }, (e) => console.warn('No se pueden recibir solicitudes de amistad (¿reglas de Firestore?):', e));
        // Enviadas y ya aceptadas: completo la amistad en mi lado
        reqOutUnsub = friendReqs().where('from', '==', me).where('status', '==', 'accepted').onSnapshot((snap) => {
            snap.docChanges().forEach(async (ch) => {
                if (ch.type !== 'added') return;
                const d = ch.doc.data();
                try {
                    await users().doc(me).update({ friends: firebase.firestore.FieldValue.arrayUnion(d.to) });
                    await ch.doc.ref.delete();
                    toast(`🤝 ${d.toName || 'Tu amigo'} ha aceptado tu solicitud de amistad`);
                    playSfx('rescue_ok');
                    if (!dom.rankingModal.classList.contains('hidden')) refreshRankingView();
                } catch (err) { console.warn('No se pudo completar la amistad:', err); }
            });
        }, (e) => console.warn('No se pueden leer las solicitudes enviadas:', e));
    }
    function stopFriendRequests() {
        if (reqInUnsub) { reqInUnsub(); reqInUnsub = null; }
        if (reqOutUnsub) { reqOutUnsub(); reqOutUnsub = null; }
        if (reqWaitTimer) { clearInterval(reqWaitTimer); reqWaitTimer = null; }
        reqQueue.length = 0;
        if (reqShowing) { reqShowing = null; $('friend-req-modal').classList.add('hidden'); }
    }
    $('friend-req-accept').addEventListener('click', () => answerFriendRequest(true));
    $('friend-req-decline').addEventListener('click', () => answerFriendRequest(false));

    // ---------- Copas (oro / plata / bronce) ----------
    const DAILY_TOTAL = 10;                       // niveles de la fase diaria
    const MIN_PLAYERS_FOR_CUP = 3;                // hacen falta al menos 3 jugadores para dar copa
    const CUP_COLORS = { gold: '#ffd700', silver: '#c9d2dc', bronze: '#cd7f32' };
    const CUP_NAMES = { gold: 'oro', silver: 'plata', bronze: 'bronce' };
    const CUP_BY_POS = ['gold', 'silver', 'bronze'];
    function cupSVG(kind, size) {
        const c = CUP_COLORS[kind] || '#888', s = size || 20;
        return `<svg class="cup" viewBox="0 0 24 24" width="${s}" height="${s}" aria-label="copa de ${CUP_NAMES[kind] || ''}">` +
            `<path d="M6 3h12v4a6 6 0 0 1-12 0V3z" fill="${c}"/>` +
            `<path d="M6 5H3v2a4 4 0 0 0 3 3.8M18 5h3v2a4 4 0 0 1-3 3.8" fill="none" stroke="${c}" stroke-width="1.7" stroke-linecap="round"/>` +
            `<rect x="10.5" y="12.5" width="3" height="4" fill="${c}"/><rect x="7" y="17" width="10" height="3" rx="1" fill="${c}"/>` +
            `<path d="M9 5.5v2.2a3 3 0 0 0 1.4 2.5" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1.2" stroke-linecap="round"/></svg>`;
    }
    // Posición con copa solo si hay al menos 3 jugadores en esa clasificación
    const posLabel = (i, total) => (i < 3 && total >= MIN_PLAYERS_FOR_CUP ? cupSVG(CUP_BY_POS[i], 22) : `${i + 1}º`);

    function renderRankingRows(items, emptyMsg, kind) {
        dom.rankingList.innerHTML = '';
        if (!items.length) {
            dom.rankingList.innerHTML = `<p class="ranking-empty">${emptyMsg}</p>`;
            return;
        }
        items.forEach((it, i) => {
            const safeName = (it.username || it.displayName || 'Jugador').replace(/[<>&]/g, '');
            const score = kind === 'multi'
                ? `<small class="rank-level">${it.mpPlayed || 0} carreras</small>${it.mpWins || 0} 🏆`
                : kind === 'daily'
                ? `<small class="rank-level">${it.completed ? '✔ ' + DAILY_TOTAL : 'Nv ' + Math.min(DAILY_TOTAL, (it.cleared || 0) + 1)}/${DAILY_TOTAL}</small>${it.height || 0} cm`
                : `<small class="rank-level">Nv ${it.bestLevel || 1}</small>${it.bestHeight || 0} cm`;
            const row = document.createElement('div');
            row.className = 'ranking-row' + (currentUser && it.uid === currentUser.uid ? ' me' : '');
            row.innerHTML = `
                <span class="rank-pos">${posLabel(i, items.length)}</span>
                <img class="rank-avatar" src="${it.photoURL || ''}" onerror="this.style.visibility='hidden'" />
                <span class="rank-name">${safeName}</span>
                <span class="rank-score">${score}</span>
            `;
            dom.rankingList.appendChild(row);
        });
    }

    // Marcador de copas conseguidas (se guardan en el perfil: users/{uid}.trophies)
    function trophyCounts(map) {
        const c = { gold: 0, silver: 0, bronze: 0 };
        Object.values(map || {}).forEach((m) => { if (c[m] !== undefined) c[m]++; });
        return c;
    }
    async function renderTrophyBar() {
        if (!dom.trophyBar || !currentUser) return;
        try {
            const snap = await users().doc(currentUser.uid).get();
            const t = (snap.exists && snap.data().trophies) || {};
            const g = trophyCounts(t.global), f = trophyCounts(t.friends);
            const part = (label, c) => `<span class="trophy-group"><b>${label}</b>` +
                ['gold', 'silver', 'bronze'].map((k) => `${cupSVG(k, 18)}<i>${c[k]}</i>`).join('') + '</span>';
            dom.trophyBar.innerHTML = '<span class="trophy-title">TUS COPAS</span>' + part('Global', g) + part('Amigos', f);
            dom.trophyBar.classList.remove('hidden');
        } catch (err) { dom.trophyBar.classList.add('hidden'); }
    }

    async function refreshRankingView() {
        dom.rankingList.innerHTML = '<p class="ranking-empty">Cargando...</p>';
        const isGlobal = activeRankingTab === 'global';
        const daily = activeRankingScope === 'daily';
        const multi = activeRankingScope === 'multi';
        dom.addFriendRow.classList.toggle('hidden', isGlobal);
        if (dom.rankingNote) {
            dom.rankingNote.textContent = multi
                ? 'Carreras multijugador: cuenta el número de victorias.'
                : daily
                ? `Fase diaria de hoy (${dailyKey()}). Las copas de oro, plata y bronce solo se dan con ${MIN_PLAYERS_FOR_CUP} jugadores o más.`
                : `Clasificación general. Las copas solo se muestran con ${MIN_PLAYERS_FOR_CUP} jugadores o más.`;
        }
        renderTrophyBar();
        try {
            let items;
            if (multi) items = isGlobal ? await fetchMultiTop(20) : (await fetchFriendsTop()).sort((a, b) => (b.mpWins || 0) - (a.mpWins || 0) || (a.mpPlayed || 0) - (b.mpPlayed || 0));
            else if (daily) items = isGlobal ? await getDailyTop(dailyKey(), 20) : await getDailyFriends(dailyKey());
            else items = isGlobal ? await fetchGlobalTop(20) : await fetchFriendsTop();
            const emptyMsg = multi
                ? (isGlobal ? 'Nadie ha ganado una carrera todavía. ¡Sé el primero!' : 'Añade amigos con su código y rétalos a una carrera.')
                : daily
                ? (isGlobal ? 'Nadie ha jugado hoy la fase diaria todavía. ¡Sé el primero!' : 'Ni tú ni tus amigos habéis jugado la fase de hoy todavía.')
                : (isGlobal ? 'Aún no hay marcas. ¡Sé el primero!' : 'Añade amigos con su código para ver su clasificación aquí.');
            renderRankingRows(items, emptyMsg, multi ? 'multi' : (daily ? 'daily' : 'general'));
        } catch (err) {
            console.error('Error al cargar la clasificación:', err);
            dom.rankingList.innerHTML = '<p class="ranking-empty">Error al cargar la clasificación.</p>';
        }
    }

    // scope: 'daily' (fase diaria de hoy) o 'general'. Siempre se abre en GLOBAL; el jugador cambia a AMIGOS.
    function openRankingModal(scope) {
        activeRankingScope = (scope === 'daily' || scope === 'multi') ? scope : 'general';
        activeRankingTab = 'global';
        dom.tabGlobal.classList.add('active');
        dom.tabFriends.classList.remove('active');
        if (dom.rankingTitle) dom.rankingTitle.textContent = activeRankingScope === 'multi' ? '⚔️ MULTIJUGADOR'
            : (activeRankingScope === 'daily' ? '📅 FASE DIARIA · HOY' : '🏆 CLASIFICACIÓN GENERAL');
        dom.rankingModal.classList.remove('hidden');
        window.__bjOpenRanking && window.__bjOpenRanking();
        refreshRankingView();
    }
    function closeRankingModal() {
        dom.rankingModal.classList.add('hidden');
        window.__bjCloseRanking && window.__bjCloseRanking();
    }

    // ---------------------------------------------------------------
    // 6) Registro / login / logout con email y contraseña
    // ---------------------------------------------------------------
    async function signIn() {
        dom.googleBtn.disabled = true;
        hideAuthError();
        try {
            await auth.signInWithPopup(provider);
        } catch (err) {
            console.error('signInWithPopup falló:', err);
            const canFallBackToRedirect = !inIframe && [
                'auth/popup-blocked',
                'auth/cancelled-popup-request',
                'auth/operation-not-supported-in-this-environment',
            ].includes(err.code);
            if (canFallBackToRedirect) {
                try {
                    await auth.signInWithRedirect(provider);
                    return; // la página navegará fuera; seguirá al volver
                } catch (err2) {
                    console.error('signInWithRedirect también falló:', err2);
                    showAuthError(err2);
                }
            } else if (err.code !== 'auth/cancelled-popup-request') {
                showAuthError(err);
            }
        } finally {
            dom.googleBtn.disabled = false;
        }
    }

    // Si volvemos de un signInWithRedirect, recogemos aquí el resultado.
    auth.getRedirectResult().catch((err) => {
        console.error('Error al completar el login por redirect:', err);
        showAuthError(err);
    });

    // ---------- Presencia (círculo verde / rojo en la lista de amigos) ----------
    const PRESENCE_EVERY_MS = 30000;
    let presenceTimer = null;
    function presenceBeat() {
        if (!currentUser || document.hidden) return;
        users().doc(currentUser.uid).set({ lastSeen: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true })
            .catch((e) => console.warn('Presencia no actualizada:', e));
    }
    function startPresence() {
        stopPresence();
        presenceBeat();
        presenceTimer = setInterval(presenceBeat, PRESENCE_EVERY_MS);
    }
    function stopPresence() { if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; } }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) presenceBeat(); });

    // Amigos con su estado de conexión
    async function friendsWithPresence() {
        if (!currentUser) return [];
        const ids = await myFriendUids();
        const docs = await Promise.all(ids.map((id) => users().doc(id).get().catch(() => null)));
        return docs.filter((d) => d && d.exists).map((d) => {
            const v = d.data();
            const seen = v.lastSeen && v.lastSeen.toMillis ? v.lastSeen.toMillis() : 0;
            return { uid: d.id, username: v.username || v.displayName || 'Jugador', photoURL: v.photoURL || '', lastSeenMs: seen };
        });
    }
    // Resultado de una carrera: cada jugador suma en su propio perfil
    async function recordRaceResult(won) {
        if (!currentUser) return;
        const inc = firebase.firestore.FieldValue.increment;
        const patch = { mpPlayed: inc(1) };
        if (won) patch.mpWins = inc(1);
        try { await users().doc(currentUser.uid).set(patch, { merge: true }); }
        catch (e) { console.error('No se pudo guardar el resultado de la carrera:', e); }
    }

    function signOutUser() {
        auth.signOut().catch((err) => console.error('Error al cerrar sesión:', err));
    }

    // ---------------------------------------------------------------
    // 7) Reacción a cambios de sesión: actualiza la UI y avisa a game.js
    // ---------------------------------------------------------------
    auth.onAuthStateChanged(async (user) => {
        currentUser = user;

        if (!user) {
            stopPresence();
            stopFriendRequests();
            dom.loginBlock.classList.remove('hidden');
            dom.profileBlock.classList.add('hidden');
            dom.rankingModal.classList.add('hidden');
            dom.myFriendCodeEl.classList.add('hidden');
            showFriendCode('');
            showSettingsMsg('');
            window.dispatchEvent(new CustomEvent('bj-auth-changed', { detail: { signedIn: false } }));
            return;
        }

        dom.loginBlock.classList.add('hidden');
        dom.profileBlock.classList.remove('hidden');
        dom.profileAvatar.style.visibility = 'visible';
        dom.profileAvatar.src = user.photoURL || avatarFor(user.displayName || user.email);
        dom.usernameEditRow.classList.add('hidden');
        dom.usernameRow.classList.remove('hidden');
        dom.myFriendCodeEl.classList.remove('hidden');
        showFriendCode('');

        try {
            const profile = await loadOrCreateProfile(user);
            showFriendCode(profile.friendCode || profile.username || '');
            dom.profileName.innerText = profile.username || user.displayName || 'Jugador';
            dom.profileAvatar.src = profile.photoURL || avatarFor(profile.username || user.email);
            startPresence();
            listenFriendRequests();
            checkTrophies().then(showTrophyBanner).catch((err) => console.warn('Copas no disponibles:', err));
            window.dispatchEvent(new CustomEvent('bj-auth-changed', {
                detail: {
                    signedIn: true,
                    uid: user.uid,
                    bestLevel: profile.bestLevel || 1,
                    bestHeight: profile.bestHeight || 0,
                    username: profile.username || user.displayName || 'Jugador',
                    savedGame: profile.savedGame || null,
                },
            }));
        } catch (err) {
            console.error('Error leyendo/creando el perfil en Firestore:', err);
            dom.profileName.innerText = user.displayName || 'Jugador';
        }
    });

    // ---------------------------------------------------------------
    // 8) Listeners de la interfaz
    // ---------------------------------------------------------------
    dom.googleBtn.addEventListener('click', signIn);
    dom.signoutBtn.addEventListener('click', signOutUser);

    dom.rankingFab.addEventListener('click', () => openRankingModal('general'));
    dom.closeRankingBtn.addEventListener('click', closeRankingModal);

    dom.tabGlobal.addEventListener('click', () => {
        activeRankingTab = 'global';
        dom.tabGlobal.classList.add('active');
        dom.tabFriends.classList.remove('active');
        refreshRankingView();
    });
    dom.tabFriends.addEventListener('click', () => {
        activeRankingTab = 'friends';
        dom.tabFriends.classList.add('active');
        dom.tabGlobal.classList.remove('active');
        refreshRankingView();
    });

    function showFriendMsg(text, ok) {
        if (!dom.settingsFriendMsg) return;
        dom.settingsFriendMsg.innerText = text || '';
        dom.settingsFriendMsg.style.color = ok ? '#5dffb0' : '#ff6b6b';
        dom.settingsFriendMsg.classList.toggle('hidden', !text);
    }
    if (dom.settingsFriendBtn) {
        dom.settingsFriendBtn.addEventListener('click', async () => {
            dom.settingsFriendBtn.disabled = true;
            const res = await addFriendByCode(dom.settingsFriendInput.value);
            dom.settingsFriendBtn.disabled = false;
            showFriendMsg(res.msg, res.ok);
            if (res.ok) dom.settingsFriendInput.value = '';
        });
        dom.settingsFriendInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') dom.settingsFriendBtn.click(); });
    }

    dom.addFriendBtn.addEventListener('click', async () => {
        dom.addFriendBtn.disabled = true;
        const res = await addFriendByCode(dom.friendCodeInput.value);
        dom.addFriendBtn.disabled = false;
        toast(res.msg, 3800);
        if (res.ok) {
            dom.friendCodeInput.value = '';
            refreshRankingView();
        }
    });
    dom.friendCodeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') dom.addFriendBtn.click(); });

    dom.settingsCodeSave.addEventListener('click', async () => {
        dom.settingsCodeSave.disabled = true;
        const res = await saveFriendCode(dom.settingsCodeInput.value);
        showSettingsMsg(res.ok ? 'Código guardado ✔' : res.msg, res.ok);
        dom.settingsCodeSave.disabled = false;
    });
    dom.settingsCodeReset.addEventListener('click', async () => {
        dom.settingsCodeReset.disabled = true;
        const res = await resetFriendCode();
        showSettingsMsg(res.ok ? 'Código restablecido al nombre de usuario' : res.msg, res.ok);
        dom.settingsCodeReset.disabled = false;
    });
    dom.settingsCodeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') dom.settingsCodeSave.click(); });
    dom.copyCodeBtn.addEventListener('click', () => {
        if (currentUser && navigator.clipboard) {
            navigator.clipboard.writeText(dom.myCodeValue.innerText).catch(() => {});
        }
    });

    // Edición del nombre de usuario (usado para compartir / ranking)
    dom.editUsernameBtn.addEventListener('click', () => {
        dom.usernameInput.value = dom.profileName.innerText;
        dom.usernameRow.classList.add('hidden');
        dom.usernameEditRow.classList.remove('hidden');
        dom.usernameInput.focus();
    });
    async function submitUsername() {
        if (!currentUser) return;
        const requested = dom.usernameInput.value.trim();
        if (!requested) { alert('El nombre de usuario no puede estar vacío'); return; }
        dom.saveUsernameBtn.disabled = true;
        try {
            const finalName = await saveUsername(requested);
            dom.profileName.innerText = finalName;
            if (finalName !== requested) {
                alert(`Ese nombre ya estaba en uso. Se ha asignado "${finalName}".`);
            }
        } catch (err) {
            console.error('No se pudo actualizar el nombre de usuario:', err);
            alert('No se pudo actualizar el nombre de usuario. Inténtalo de nuevo.');
        } finally {
            dom.saveUsernameBtn.disabled = false;
            dom.usernameEditRow.classList.add('hidden');
            dom.usernameRow.classList.remove('hidden');
        }
    }
    dom.saveUsernameBtn.addEventListener('click', submitUsername);
    dom.usernameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitUsername();
    });

    // ---------------------------------------------------------------
    // 8b) Modos: Fase diaria y Creador de fases
    //   daily/{YYYY-MM-DD}/scores/{uid}     -> mejor resultado del día de cada jugador
    //   users/{uid}/drafts/{id}             -> borradores privados del editor
    //   levels/{id}                         -> fases publicadas (visibles para todos)
    // ---------------------------------------------------------------
    const dailyCol = (key) => db.collection('daily').doc(key).collection('scores');
    const levelsCol = () => db.collection('levels');
    const draftsCol = () => users().doc(currentUser.uid).collection('drafts');
    const ts = () => firebase.firestore.FieldValue.serverTimestamp();
    const clone = (o) => JSON.parse(JSON.stringify(o));

    async function myIdentity() {
        const snap = await users().doc(currentUser.uid).get();
        const d = snap.exists ? snap.data() : {};
        return {
            username: d.username || currentUser.displayName || 'Jugador',
            photoURL: d.photoURL || currentUser.photoURL || '',
        };
    }

    // Fase diaria: res = { cleared, height, completed }. Cuenta el nivel alcanzado y, a igualdad, la altura.
    // rankKey = nivelesSuperados * RANK_BASE + altura  (completar la fase = 10 niveles superados)
    async function reportDaily(key, res) {
        if (!currentUser) return;
        const ref = dailyCol(key).doc(currentUser.uid);
        const snap = await ref.get();
        const old = snap.exists ? snap.data() : null;
        const h = Math.max(0, Math.min(RANK_BASE - 1, Math.round(res.height || 0)));
        const rankKey = res.cleared * RANK_BASE + h;
        if (old && (old.rankKey || 0) >= rankKey) return;
        const who = await myIdentity();
        await ref.set({
            uid: currentUser.uid, username: who.username, photoURL: who.photoURL,
            cleared: res.cleared, height: h, completed: !!res.completed, rankKey, updatedAt: ts(),
        });
    }
    async function getDailyTop(key, n) {
        const snap = await dailyCol(key).orderBy('rankKey', 'desc').limit(n || 20).get();
        return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    }
    async function getMyDaily(key) {
        if (!currentUser) return null;
        const snap = await dailyCol(key).doc(currentUser.uid).get();
        return snap.exists ? { uid: snap.id, ...snap.data() } : null;
    }

    // Clave del día en hora de Madrid (la misma que usa la fase diaria) y días anteriores
    const DAILY_TZ = 'Europe/Madrid';
    const dailyKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: DAILY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    function dayKeyBack(n) {
        const [y, m, d] = dailyKey().split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
    }
    async function myFriendUids() {
        const snap = await users().doc(currentUser.uid).get();
        return (snap.exists && snap.data().friends) || [];
    }
    // Fase diaria entre tú y tus amigos (solo los que han jugado ese día)
    async function getDailyFriends(key) {
        if (!currentUser) return [];
        const uids = [currentUser.uid, ...(await myFriendUids())];
        const docs = await Promise.all(uids.map((u) => dailyCol(key).doc(u).get().catch(() => null)));
        return docs.filter((s) => s && s.exists).map((s) => ({ uid: s.id, ...s.data() }))
            .sort((a, b2) => (b2.rankKey || 0) - (a.rankKey || 0));
    }

    // ---------- Copas de la fase diaria ----------
    // Cuando un día se cierra se mira tu puesto: 1.º oro, 2.º plata, 3.º bronce, siempre que
    // haya al menos 3 jugadores en esa categoría (global: todos los que jugaron; amigos: tú y tus amigos).
    // Se revisan los últimos 7 días que aún no se habían revisado y se guardan en users/{uid}.trophies.
    async function checkTrophies() {
        if (!currentUser) return [];
        const uid = currentUser.uid, lsKey = 'bj_trophy_checked_' + uid;
        // El último día revisado se guarda en la cuenta (no en el navegador): así las copas no
        // se vuelven a anunciar ni a reescribir al entrar desde otro dispositivo.
        let last = null;
        try { const me = await users().doc(uid).get(); last = (me.exists && me.data().trophyCheckedDay) || null; } catch (e) { /* sin red */ }
        if (!last) { try { last = localStorage.getItem(lsKey); } catch (e) { /* no disponible */ } }
        const days = [];
        for (let i = 1; i <= 7; i++) { const k = dayKeyBack(i); if (last && k <= last) break; days.unshift(k); }
        if (!days.length) return [];
        const awards = [];
        let friendUids = null;
        const medalFor = (docs, mine) => {
            if (docs.length < MIN_PLAYERS_FOR_CUP) return null;
            const pos = docs.filter((r) => (r.rankKey || 0) > (mine.rankKey || 0)).length; // 0 = primero (los empates comparten puesto)
            return pos < 3 ? CUP_BY_POS[pos] : null;
        };
        for (const day of days) {
            const mine = await getMyDaily(day);
            if (!mine) continue;
            const top = await getDailyTop(day, 3);
            const g = medalFor(top, mine);
            if (g) awards.push({ day, cat: 'global', medal: g });
            if (friendUids === null) friendUids = await myFriendUids();
            if (friendUids.length >= MIN_PLAYERS_FOR_CUP - 1) {
                const fdocs = await getDailyFriends(day);
                const f = medalFor(fdocs, mine);
                if (f) awards.push({ day, cat: 'friends', medal: f });
            }
        }
        if (awards.length) {
            const trophies = { global: {}, friends: {} };
            awards.forEach((a) => { trophies[a.cat][a.day] = a.medal; });
            await users().doc(uid).set({ trophies }, { merge: true });
        }
        try { await users().doc(uid).set({ trophyCheckedDay: dayKeyBack(1) }, { merge: true }); } catch (e) { console.warn('No se pudo guardar el día revisado:', e); }
        try { localStorage.setItem(lsKey, dayKeyBack(1)); } catch (e) { /* no disponible */ }
        return awards;
    }
    function showTrophyBanner(awards) {
        if (!dom.trophyBanner || !awards || !awards.length) return;
        const txt = awards.map((a) => `${cupSVG(a.medal, 18)} copa de ${CUP_NAMES[a.medal]} (${a.cat === 'global' ? 'global' : 'amigos'}, ${a.day})`).join(' · ');
        dom.trophyBanner.innerHTML = '🏆 ¡Has ganado! ' + txt;
        dom.trophyBanner.classList.remove('hidden');
    }

    // Lápidas: contador de muertes por nivel y plataforma.
    //   daily/{fecha}/deaths/L{nivel}   y   levels/{id}/deaths/L{nivel}
    //   Cada documento es { p0: n, p1: n, ... }: p{i} = veces que alguien murió saltando desde la plataforma i del nivel.
    const deathsCol = (kind, id) => (kind === 'daily'
        ? db.collection('daily').doc(id).collection('deaths')
        : db.collection('levels').doc(id).collection('deaths'));
    async function reportDeath(kind, id, level, platIdx) {
        if (!currentUser || !id || platIdx == null || platIdx < 0) return;
        try {
            await deathsCol(kind, id).doc('L' + level).set({ ['p' + platIdx]: firebase.firestore.FieldValue.increment(1) }, { merge: true });
        } catch (err) { console.warn('No se pudo registrar la muerte', err); }
    }
    // Devuelve { [nivel]: { [idxPlataforma]: nMuertes } }
    async function getDeaths(kind, id) {
        const snap = await deathsCol(kind, id).get();
        const out = {};
        snap.docs.forEach((d) => {
            const lv = parseInt(d.id.slice(1), 10);
            if (!(lv >= 1)) return;
            const m = {};
            Object.entries(d.data()).forEach(([k, v]) => { if (k[0] === 'p' && v > 0) m[parseInt(k.slice(1), 10)] = v | 0; });
            out[lv] = m;
        });
        return out;
    }

    // Borradores
    async function listDrafts() {
        if (!currentUser) return [];
        const snap = await draftsCol().orderBy('updatedAt', 'desc').get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
    async function saveDraft(d) {
        if (!currentUser) throw new Error('Sin sesión');
        const data = clone({ name: d.name || 'Mi fase', levels: d.levels, verifiedSig: d.verifiedSig || null, publishedId: d.publishedId || null });
        data.updatedAt = ts();
        if (d.id) { await draftsCol().doc(d.id).set(data, { merge: true }); return d.id; }
        const ref = await draftsCol().add(data);
        return ref.id;
    }
    async function deleteDraft(id) { await draftsCol().doc(id).delete(); }

    // Publicación (el cliente solo llama aquí tras verificar la fase)
    async function publishLevel(d) {
        if (!currentUser) throw new Error('Sin sesión');
        const who = await myIdentity();
        const name = (d.name || '').trim();
        const base = {
            name, nameLower: name.toLowerCase(),
            authorUid: currentUser.uid, authorName: who.username, authorLower: who.username.toLowerCase(),
            levels: clone(d.levels), updatedAt: ts(),
        };
        if (d.publishedId) {
            try {
                const ref = levelsCol().doc(d.publishedId);
                const s = await ref.get();
                if (s.exists && s.data().authorUid === currentUser.uid) { await ref.update(base); return d.publishedId; }
            } catch (err) { console.warn('No se pudo actualizar la fase publicada, se crea una nueva', err); }
        }
        const ref = await levelsCol().add({ ...base, plays: 0, completions: 0, createdAt: ts() });
        return ref.id;
    }
    async function unpublishLevel(id) { await levelsCol().doc(id).delete(); }

    // Búsqueda: sin texto = las más recientes. Con texto = coincidencia por nombre o autor.
    async function searchLevels(q) {
        const ql = (q || '').trim().toLowerCase();
        const out = new Map();
        const add = (snap) => snap.docs.forEach((d) => out.set(d.id, { id: d.id, ...d.data() }));
        const recent = await levelsCol().orderBy('createdAt', 'desc').limit(ql ? 150 : 30).get();
        if (!ql) { add(recent); return [...out.values()]; }
        recent.docs.forEach((d) => {
            const v = d.data();
            if ((v.nameLower || '').includes(ql) || (v.authorLower || '').includes(ql)) out.set(d.id, { id: d.id, ...v });
        });
        try { add(await levelsCol().orderBy('nameLower').startAt(ql).endAt(ql + '\uf8ff').limit(30).get()); } catch (e) { /* no crítico */ }
        try { add(await levelsCol().orderBy('authorLower').startAt(ql).endAt(ql + '\uf8ff').limit(30).get()); } catch (e) { /* no crítico */ }
        return [...out.values()];
    }
    async function bumpLevelStat(id, field) {
        try { await levelsCol().doc(id).update({ [field]: firebase.firestore.FieldValue.increment(1) }); }
        catch (err) { console.warn('No se pudo actualizar el contador', err); }
    }

    // ---------------------------------------------------------------
    // 9) API pública para game.js
    // ---------------------------------------------------------------
    window.BJFirebase = {
        isSignedIn: () => !!currentUser,
        promptSignIn: () => dom.googleBtn.click(),
        reportRun,
        saveProgress, resetProgress,
        openRanking: (scope) => openRankingModal(scope),
        // multijugador
        db: () => db, serverTs: () => firebase.firestore.FieldValue.serverTimestamp(),
        identity: () => myIdentity(), friendsWithPresence, myFriendUids, recordRaceResult, dailyKey: () => dailyKey(),
        uid: () => (currentUser ? currentUser.uid : null),
        reportDaily, getDailyTop, getMyDaily, getDailyFriends, checkTrophies,
        reportDeath, getDeaths,
        listDrafts, saveDraft, deleteDraft,
        publishLevel, unpublishLevel, searchLevels, bumpLevelStat,
    };
})();
