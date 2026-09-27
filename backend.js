/* =====================================================================
   BOX JUMP — Backend (login, ranking, guardado de partida)
   Reescrito desde cero. Usa el SDK "compat" de Firebase (scripts clásicos,
   sin import/export encadenados) para máxima compatibilidad entre
   navegadores y dispositivos.

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

    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const db = firebase.firestore();
    const provider = new firebase.auth.GoogleAuthProvider();
    const users = () => db.collection('users');

    // ¿Estamos dentro de un iframe? Si es así, signInWithRedirect no
    // funciona (Google no permite el login embebido en un frame).
    let inIframe = false;
    try { inIframe = window.self !== window.top; } catch (e) { inIframe = true; }

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
    };

    dom.profileAvatar.onerror = () => { dom.profileAvatar.style.visibility = 'hidden'; };

    let currentUser = null;
    let activeRankingTab = 'global';

    function showAuthError(err) {
        if (!dom.authDebugMsg) return;
        const text = (err && (err.code || err.message)) ? `Error: ${err.code || ''} ${err.message || ''}`.trim() : String(err);
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

    // ---------------------------------------------------------------
    // 4) Perfil del jugador en Firestore
    // ---------------------------------------------------------------
    async function loadOrCreateProfile(user) {
        const ref = users().doc(user.uid);
        const snap = await ref.get();

        if (!snap.exists) {
            const username = await ensureUniqueUsername(user.displayName, user.uid);
            const profile = {
                displayName: user.displayName || 'Jugador',
                username,
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
        const patch = {
            displayName: user.displayName || 'Jugador',
            photoURL: user.photoURL || '',
        };
        if (!data.username) {
            patch.username = await ensureUniqueUsername(user.displayName, user.uid);
        }
        await ref.update(patch);
        return { ...data, ...patch };
    }

    async function saveUsername(newName) {
        if (!currentUser) return null;
        const unique = await ensureUniqueUsername(newName, currentUser.uid);
        await users().doc(currentUser.uid).update({ username: unique });
        return unique;
    }

    async function reportScore(score, level) {
        if (!currentUser) return;
        try {
            const ref = users().doc(currentUser.uid);
            const snap = await ref.get();
            const data = snap.exists ? snap.data() : { bestScore: 0, bestLevel: 1 };
            if (score > (data.bestScore || 0)) {
                await ref.update({
                    bestScore: score,
                    bestLevel: Math.max(level, data.bestLevel || 1),
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
    async function fetchGlobalTop(n) {
        const snap = await users().orderBy('bestScore', 'desc').limit(n).get();
        return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
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
        list.sort((a, b) => (b.bestScore || 0) - (a.bestScore || 0));
        return list;
    }

    async function addFriendByCode(code) {
        const clean = (code || '').trim();
        if (!currentUser) return { ok: false, msg: 'Inicia sesión primero' };
        if (!clean) return { ok: false, msg: 'Código vacío' };
        if (clean === currentUser.uid) return { ok: false, msg: 'No puedes añadirte a ti mismo' };
        try {
            const fSnap = await users().doc(clean).get();
            if (!fSnap.exists) return { ok: false, msg: 'No existe ningún jugador con ese código' };
            await users().doc(currentUser.uid).update({
                friends: firebase.firestore.FieldValue.arrayUnion(clean),
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
                <span class="rank-score">${it.bestScore || 0}</span>
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
    // 6) Login / logout con Google
    // ---------------------------------------------------------------
    async function signIn() {
        dom.googleBtn.disabled = true;
        hideAuthError();
        try {
            // El popup funciona igual en escritorio y en la mayoría de
            // móviles/tablets con un navegador real, así que se intenta
            // siempre primero.
            await auth.signInWithPopup(provider);
        } catch (err) {
            console.error('signInWithPopup falló:', err);
            const canFallBackToRedirect = !inIframe && [
                'auth/popup-blocked',
                'auth/popup-closed-by-user',
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
            } else {
                showAuthError(err);
            }
        } finally {
            dom.googleBtn.disabled = false;
        }
    }

    function signOutUser() {
        auth.signOut().catch((err) => console.error('Error al cerrar sesión:', err));
    }

    // Si volvemos de un signInWithRedirect, recogemos aquí el resultado.
    auth.getRedirectResult().catch((err) => {
        if (err && err.code && err.code !== 'auth/no-auth-event') {
            console.error('Error al completar el login por redirect:', err);
            showAuthError(err);
        }
    });

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
            window.dispatchEvent(new CustomEvent('bj-auth-changed', { detail: { signedIn: false } }));
            return;
        }

        dom.loginBlock.classList.add('hidden');
        dom.profileBlock.classList.remove('hidden');
        dom.profileAvatar.style.visibility = 'visible';
        dom.profileAvatar.src = user.photoURL || '';
        dom.usernameEditRow.classList.add('hidden');
        dom.usernameRow.classList.remove('hidden');
        dom.myFriendCodeEl.classList.remove('hidden');
        dom.myCodeValue.innerText = user.uid;

        try {
            const profile = await loadOrCreateProfile(user);
            dom.profileName.innerText = profile.username || user.displayName || 'Jugador';
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

    dom.copyCodeBtn.addEventListener('click', () => {
        if (currentUser && navigator.clipboard) {
            navigator.clipboard.writeText(currentUser.uid).catch(() => {});
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
