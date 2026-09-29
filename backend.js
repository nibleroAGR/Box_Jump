/* =====================================================================
   BOX JUMP — Backend (login, ranking, guardado de partida)
   Reescrito desde cero. Usa el SDK "compat" de Firebase (scripts clásicos,
   sin import/export encadenados) para máxima compatibilidad entre
   navegadores y dispositivos.

   Login: Google (Firebase Auth).

   Contrato con game.js (no se toca game.js, solo se respeta esta API):
     - window.BJFirebase.isSignedIn()          -> boolean
     - window.BJFirebase.promptSignIn()        -> abre el login
     - window.BJFirebase.reportScore(score, level)
     - window.BJFirebase.saveProgress(score, level)
     - evento 'bj-auth-changed' en window, con detail:
         { signedIn: false }
         { signedIn: true, uid, bestScore, username, savedGame }
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
                bestScore: 0,
                bestLevel: 1,
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

    async function reportScore(score, level) {
        if (!currentUser) return;
        try {
            const ref = users().doc(currentUser.uid);
            const snap = await ref.get();
            const data = snap.exists ? snap.data() : { bestScore: 0, bestLevel: 1 };
            const patch = {};
            if (score > (data.bestScore || 0)) patch.bestScore = score;
            if (level > (data.bestLevel || 1)) patch.bestLevel = level;
            if (Object.keys(patch).length) {
                await ref.update({
                    ...patch,
                    displayName: currentUser.displayName || 'Jugador',
                    photoURL: currentUser.photoURL || '',
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                });
            }
        } catch (err) {
            console.error('No se pudo guardar la puntuación:', err);
        }
    }

    async function saveProgress(score, level) {
        if (!currentUser) return;
        try {
            await users().doc(currentUser.uid).update({
                savedGame: { score, level, updatedAt: Date.now() },
            });
        } catch (err) {
            console.error('No se pudo guardar el progreso:', err);
        }
    }

    // ---------------------------------------------------------------
    // 5) Ranking (global y amigos)
    // ---------------------------------------------------------------
    // Orden del ranking: primero el nivel máximo alcanzado y después los puntos.
    const rankCompare = (a, b) =>
        ((b.bestLevel || 1) - (a.bestLevel || 1)) || ((b.bestScore || 0) - (a.bestScore || 0));

    async function fetchGlobalTop(n) {
        let docs;
        try {
            // Requiere un índice compuesto (bestLevel desc, bestScore desc)
            const snap = await users().orderBy('bestLevel', 'desc').orderBy('bestScore', 'desc').limit(n).get();
            docs = snap.docs;
        } catch (err) {
            // Sin índice: se pide por nivel y se desempata por puntos en el cliente
            console.warn('Falta el índice compuesto del ranking; usando ordenación en cliente.', err);
            const snap = await users().orderBy('bestLevel', 'desc').limit(Math.max(n * 5, 100)).get();
            docs = snap.docs;
        }
        return docs.map((d) => ({ uid: d.id, ...d.data() })).sort(rankCompare).slice(0, n);
    }

    async function fetchFriendsTop() {
        if (!currentUser) return [];
        const mySnap = await users().doc(currentUser.uid).get();
        const myData = mySnap.exists ? mySnap.data() : { friends: [], bestScore: 0 };
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
                <span class="rank-score"><small class="rank-level">Nv ${it.bestLevel || 1}</small>${it.bestScore || 0}</span>
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
                ? 'Aún no hay puntuaciones. ¡Sé el primero!'
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
                    bestScore: profile.bestScore || 0,
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
    // 9) API pública para game.js
    // ---------------------------------------------------------------
    window.BJFirebase = {
        isSignedIn: () => !!currentUser,
        promptSignIn: () => dom.googleBtn.click(),
        reportScore,
        saveProgress,
    };
})();
