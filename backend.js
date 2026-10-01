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
    let activeRankingTab = 'global';

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

    async function addFriendByCode(code) {
        const clean = (code || '').trim();
        if (!currentUser) return { ok: false, msg: 'Inicia sesión primero' };
        if (!clean) return { ok: false, msg: 'Código vacío' };
        if (clean === currentUser.uid) return { ok: false, msg: 'No puedes añadirte a ti mismo' };
        try {
            let friendUid = null;
            const q = await users().where('friendCodeLower', '==', clean.toLowerCase()).limit(1).get();
            if (!q.empty) friendUid = q.docs[0].id;
            if (!friendUid) { // compatibilidad con códigos antiguos (uid)
                const legacy = await users().doc(clean).get();
                if (legacy.exists) friendUid = legacy.id;
            }
            if (!friendUid) return { ok: false, msg: 'No existe ningún jugador con ese código' };
            if (friendUid === currentUser.uid) return { ok: false, msg: 'No puedes añadirte a ti mismo' };
            await users().doc(currentUser.uid).update({
                friends: firebase.firestore.FieldValue.arrayUnion(friendUid),
            });
            return { ok: true };
        } catch (err) {
            console.error('No se pudo añadir amigo:', err);
            return { ok: false, msg: 'Error al añadir amigo' };
        }
    }

    function renderRankingRows(items, emptyMsg) {
        dom.rankingList.innerHTML = '';
        if (!items.length) {
            dom.rankingList.innerHTML = `<p class="ranking-empty">${emptyMsg}</p>`;
            return;
        }
        items.forEach((it, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`;
            const safeName = (it.username || it.displayName || 'Jugador').replace(/[<>&]/g, '');
            const row = document.createElement('div');
            row.className = 'ranking-row' + (currentUser && it.uid === currentUser.uid ? ' me' : '');
            row.innerHTML = `
                <span class="rank-pos">${medal}</span>
                <img class="rank-avatar" src="${it.photoURL || ''}" onerror="this.style.visibility='hidden'" />
                <span class="rank-name">${safeName}</span>
                <span class="rank-score"><small class="rank-level">Nv ${it.bestLevel || 1}</small>${it.bestHeight || 0} cm</span>
            `;
            dom.rankingList.appendChild(row);
        });
    }

    async function refreshRankingView() {
        dom.rankingList.innerHTML = '<p class="ranking-empty">Cargando...</p>';
        const isGlobal = activeRankingTab === 'global';
        dom.addFriendRow.classList.toggle('hidden', isGlobal);
        try {
            const items = isGlobal ? await fetchGlobalTop(20) : await fetchFriendsTop();
            const emptyMsg = isGlobal
                ? 'Aún no hay marcas. ¡Sé el primero!'
                : 'Añade amigos con su código para ver su clasificación aquí.';
            renderRankingRows(items, emptyMsg);
        } catch (err) {
            console.error('Error al cargar la clasificación:', err);
            dom.rankingList.innerHTML = '<p class="ranking-empty">Error al cargar la clasificación.</p>';
        }
    }

    function openRankingModal() {
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

    function signOutUser() {
        auth.signOut().catch((err) => console.error('Error al cerrar sesión:', err));
    }

    // ---------------------------------------------------------------
    // 7) Reacción a cambios de sesión: actualiza la UI y avisa a game.js
    // ---------------------------------------------------------------
    auth.onAuthStateChanged(async (user) => {
        currentUser = user;

        if (!user) {
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

    dom.rankingFab.addEventListener('click', openRankingModal);
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

    dom.addFriendBtn.addEventListener('click', async () => {
        dom.addFriendBtn.disabled = true;
        const res = await addFriendByCode(dom.friendCodeInput.value);
        dom.addFriendBtn.disabled = false;
        if (res.ok) {
            dom.friendCodeInput.value = '';
            refreshRankingView();
        } else {
            alert(res.msg);
        }
    });

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
        saveProgress,
        uid: () => (currentUser ? currentUser.uid : null),
        reportDaily, getDailyTop, getMyDaily,
        reportDeath, getDeaths,
        listDrafts, saveDraft, deleteDraft,
        publishLevel, unpublishLevel, searchLevels, bumpLevelStat,
    };
})();
