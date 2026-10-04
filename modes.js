/* =====================================================================
   BOX JUMP — Modos: Fase diaria + Creador de fases
   Depende de: game.js (window.BJGame) y backend.js (window.BJFirebase)
   ===================================================================== */
(function () {
    'use strict';

    const G = window.BJGame;
    if (!G) { console.error('BJGame no disponible: modes.js no se inicia'); return; }

    const $ = (id) => document.getElementById(id);
    const FB = () => window.BJFirebase;
    const show = (el) => el && el.classList.remove('hidden');
    const hide = (el) => el && el.classList.add('hidden');
    const esc = (s) => String(s == null ? '' : s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

    let toastTimer = null;
    function toast(msg) {
        let t = $('bj-toast');
        if (!t) { t = document.createElement('div'); t.id = 'bj-toast'; $('game-container').appendChild(t); }
        t.textContent = msg; t.style.display = 'block';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.style.display = 'none'; }, 2800);
    }
    function needLogin() {
        if (!FB() || !FB().isSignedIn()) { toast('Inicia sesión con Google primero'); return true; }
        return false;
    }

    // =================================================================
    // 1) FASE DIARIA
    // =================================================================
    const DAILY_TZ = 'Europe/Madrid'; // la fase cambia a medianoche hora de Madrid para todos
    const DAILY_FIRST = 5;             // dificultad del primer nivel de la fase diaria
    const DAILY_TOTAL = 10;            // nº de niveles
    let pendingReport = Promise.resolve();

    const dailyKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: DAILY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

    function renderDailyRows(el, rows) {
        el.innerHTML = '';
        if (!rows.length) { el.innerHTML = '<p class="ranking-empty">Nadie ha jugado hoy todavía. ¡Sé el primero!</p>'; return; }
        const me = FB().uid();
        rows.forEach((r, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`;
            const div = document.createElement('div');
            div.className = 'ranking-row' + (r.uid === me ? ' me' : '');
            div.innerHTML = `<span class="rank-pos">${medal}</span>
                <img class="rank-avatar" src="${esc(r.photoURL)}" onerror="this.style.visibility='hidden'" />
                <span class="rank-name">${esc(r.username)}</span>
                <span class="rank-score"><small class="rank-level">${r.completed ? '✔ ' : 'Nv '}${r.completed ? DAILY_TOTAL : Math.min(DAILY_TOTAL, (r.cleared || 0) + 1)}/${DAILY_TOTAL}</small>${r.height || 0} cm</span>`;
            el.appendChild(div);
        });
    }

    async function openDaily() {
        if (needLogin()) return;
        show($('daily-screen'));
        const key = dailyKey();
        $('daily-date').innerText = key;
        $('daily-mine').innerText = 'Cargando...';
        $('daily-list').innerHTML = '<p class="ranking-empty">Cargando...</p>';
        try {
            await pendingReport; // si acabas de jugar, espera a que se guarde el resultado
            const [top, mine] = await Promise.all([FB().getDailyTop(key, 20), FB().getMyDaily(key)]);
            $('daily-mine').innerText = mine
                ? `Tu mejor hoy: ${mine.completed ? 'fase completada ✔' : 'nivel ' + Math.min(DAILY_TOTAL, (mine.cleared || 0) + 1) + '/' + DAILY_TOTAL} · ${mine.height || 0} cm`
                : 'Aún no has jugado la fase de hoy.';
            renderDailyRows($('daily-list'), top);
        } catch (err) {
            console.error('Fase diaria:', err);
            $('daily-mine').innerText = '';
            $('daily-list').innerHTML = '<p class="ranking-empty">No se pudo cargar la clasificación.<br>(¿Reglas de Firestore sin actualizar?)</p>';
        }
    }

    // Muertes de otros jugadores (lápidas). Si tarda o falla, se juega sin lápidas.
    async function loadDeaths(kind, id) {
        try {
            return await Promise.race([FB().getDeaths(kind, id), new Promise((res) => setTimeout(() => res(null), 2500))]);
        } catch (e) { console.warn('Lápidas no disponibles:', e); return null; }
    }

    async function playDaily() {
        if (needLogin()) return;
        const key = dailyKey();
        const btn = $('daily-play-btn');
        btn.disabled = true;
        const deaths = await loadDeaths('daily', key);
        btn.disabled = false;
        hide($('daily-screen'));
        G.start({
            type: 'daily', first: DAILY_FIRST, last: DAILY_FIRST + DAILY_TOTAL - 1, total: DAILY_TOTAL,
            seed: 'bj-daily-' + key,
            deaths,
            onDeath: (d) => FB().reportDeath('daily', key, d.level, d.platIdx),
            onEnd: (r) => {
                pendingReport = FB().reportDaily(key, { cleared: r.cleared, height: r.height, completed: r.completed })
                    .catch((e) => console.error('No se pudo guardar el resultado diario:', e));
                return {
                    title: r.completed ? '¡FASE DIARIA COMPLETADA!' : 'FIN DE LA FASE DIARIA',
                    note: r.completed ? `10/${DAILY_TOTAL} niveles · ${r.height} cm en el último` : `Has llegado al nivel ${Math.min(DAILY_TOTAL, r.cleared + 1)}/${DAILY_TOTAL} · ${r.height} cm`,
                    primary: { text: '🏆 VER CLASIFICACIÓN', onClick: openDaily },
                };
            },
            onExit: openDaily,
        });
    }

    $('daily-btn').addEventListener('click', openDaily);
    $('daily-play-btn').addEventListener('click', () => { if (needLogin()) return; G.askStart(playDaily); });
    $('daily-close-btn').addEventListener('click', () => hide($('daily-screen')));

    // =================================================================
    // 2) DATOS DE FASES (formato compartido con game.js)
    //    level = { wind:-3..3, lowG:bool, items:[{k,fx,y,w?,t?}] }
    //    k: 'plat' | 'drone' | 'shield' | 'dj' (cohete) | 'hole' | 'box'
    //    fx: 0..1 (posición horizontal), y: px sobre la plataforma de inicio
    //    La plataforma MÁS ALTA de cada nivel es la meta.
    // =================================================================
    const N_LEVELS = 10;
    const MIN_PLATS = 2, MAX_PLATS = 25, MAX_ITEMS = 80;
    const MIN_Y = 80, MAX_Y = 4200, MIN_GAP = 70, MAX_GAP = 400;

    const PTYPES = [
        ['normal', 'Normal', '#3d5a9d', ''], ['moving', 'Móvil', '#ffae00', '↔'], ['oscillating', 'Vertical', '#ff00aa', '↕'],
        ['spring', 'Resorte', '#00ffcc', '⤒'], ['vanishing', 'Se desvanece', '#ff00ff', '✦'], ['fragile', 'Frágil', '#dddddd', '▒'],
        ['ice', 'Hielo', '#9fe8ff', '❄'], ['sticky', 'Pegajosa', '#8a6d3b', '●'], ['mini_sticky', 'Mini pegajosa', '#ffcc00', 'm'],
        ['flash', 'Intermitente', '#ffffff', '⚡'],
    ];
    const ptype = (t) => PTYPES.find((p) => p[0] === t) || PTYPES[0];

    const newLevel = () => ({ wind: 0, lowG: false, items: [] });
    const newDraftData = () => ({ name: 'Mi fase', levels: Array.from({ length: N_LEVELS }, newLevel), verifiedSig: null, publishedId: null });

    function normalizeDraft(d) {
        const out = { id: d.id, name: d.name || 'Mi fase', verifiedSig: d.verifiedSig || null, publishedId: d.publishedId || null, levels: [] };
        for (let i = 0; i < N_LEVELS; i++) {
            const l = (d.levels && d.levels[i]) || {};
            out.levels.push({ wind: l.wind | 0, lowG: !!l.lowG, items: Array.isArray(l.items) ? l.items : [] });
        }
        return out;
    }
    // Firma canónica (Firestore no garantiza el orden de las claves)
    function canon(v) {
        if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
        if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
        return JSON.stringify(v);
    }
    function sig(levels) {
        const s = canon(levels); let h = 5381;
        for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
        return String(h);
    }
    const platsOf = (l) => l.items.filter((i) => i.k === 'plat');
    const isVerified = (d) => !!d.verifiedSig && d.verifiedSig === sig(d.levels);

    // Comprobación previa a verificar/probar. Devuelve { level, msg } o null.
    function validateLevels(d) {
        for (let i = 0; i < N_LEVELS; i++) {
            const ps = platsOf(d.levels[i]).sort((a, b) => a.y - b.y);
            if (ps.length < MIN_PLATS) return { level: i, msg: `El nivel ${i + 1} necesita al menos ${MIN_PLATS} plataformas` };
            let prev = 0;
            for (const p of ps) {
                if (p.y - prev > MAX_GAP) return { level: i, msg: `Nivel ${i + 1}: hay un salto de más de ${MAX_GAP} px entre plataformas` };
                prev = p.y;
            }
        }
        return null;
    }

    // =================================================================
    // 3) CREADOR — lista de mis fases + comunidad
    // =================================================================
    let hubTab = 'mine';

    function statusOf(d) {
        if (d.publishedId) return isVerified(normalizeDraft(d)) ? 'Publicada ✔' : 'Publicada · con cambios sin verificar';
        return isVerified(normalizeDraft(d)) ? 'Verificada ✔ · lista para publicar' : 'Borrador';
    }

    function setHubTab(tab) {
        hubTab = tab;
        $('cr-tab-mine').classList.toggle('active', tab === 'mine');
        $('cr-tab-community').classList.toggle('active', tab === 'community');
        $('cr-new-btn').classList.toggle('hidden', tab !== 'mine');
        $('cr-search-row').classList.toggle('hidden', tab !== 'community');
        if (tab === 'mine') renderMine(); else renderCommunity();
    }
    function openCreator(tab) {
        if (needLogin()) return;
        show($('creator-screen'));
        setHubTab(tab || hubTab);
    }

    async function renderMine() {
        const list = $('cr-list');
        list.innerHTML = '<p class="ranking-empty">Cargando...</p>';
        try {
            const drafts = await FB().listDrafts();
            if (hubTab !== 'mine') return;
            if (!drafts.length) { list.innerHTML = '<p class="ranking-empty">Aún no has creado ninguna fase.<br>Pulsa «Nueva fase» para empezar.</p>'; return; }
            list.innerHTML = '';
            drafts.forEach((d) => {
                const row = document.createElement('div');
                row.className = 'cr-row';
                row.innerHTML = `<div class="cr-info"><b>${esc(d.name)}</b><small>${esc(statusOf(d))}</small></div>
                    <button data-a="edit" type="button">✏️</button><button data-a="del" type="button" class="secondary-btn">🗑</button>`;
                row.querySelector('[data-a="edit"]').onclick = () => { hide($('creator-screen')); openEditor(normalizeDraft(d)); };
                row.querySelector('[data-a="del"]').onclick = async () => {
                    if (!confirm(`¿Borrar el borrador «${d.name}»?`)) return;
                    try {
                        if (d.publishedId && confirm('Esta fase también está publicada. ¿Quitarla de la comunidad?')) await FB().unpublishLevel(d.publishedId);
                        await FB().deleteDraft(d.id);
                        renderMine();
                    } catch (e) { console.error(e); toast('No se pudo borrar'); }
                };
                list.appendChild(row);
            });
        } catch (err) {
            console.error('Mis fases:', err);
            list.innerHTML = '<p class="ranking-empty">No se pudieron cargar tus fases.<br>(¿Reglas de Firestore sin actualizar?)</p>';
        }
    }

    async function renderCommunity() {
        const list = $('cr-list');
        list.innerHTML = '<p class="ranking-empty">Buscando...</p>';
        try {
            const res = await FB().searchLevels($('cr-search').value);
            if (hubTab !== 'community') return;
            if (!res.length) { list.innerHTML = '<p class="ranking-empty">No se encontró ninguna fase.</p>'; return; }
            list.innerHTML = '';
            res.forEach((lv) => {
                const row = document.createElement('div');
                row.className = 'cr-row';
                row.innerHTML = `<div class="cr-info"><b>${esc(lv.name)}</b><small>por ${esc(lv.authorName)} · ▶ ${lv.plays || 0} · ✔ ${lv.completions || 0}</small></div>
                    <button type="button">JUGAR</button>`;
                row.querySelector('button').onclick = () => playCommunity(lv);
                list.appendChild(row);
            });
        } catch (err) {
            console.error('Comunidad:', err);
            list.innerHTML = '<p class="ranking-empty">No se pudo buscar.<br>(¿Reglas de Firestore sin actualizar?)</p>';
        }
    }

    async function playCommunity(lv) {
        const d = normalizeDraft(lv);
        FB().bumpLevelStat(lv.id, 'plays');
        const deaths = await loadDeaths('level', lv.id);
        hide($('creator-screen'));
        G.start({
            type: 'custom', first: 1, last: N_LEVELS, total: N_LEVELS, levels: d.levels,
            deaths,
            onDeath: (x) => FB().reportDeath('level', lv.id, x.level, x.platIdx),
            onEnd: (r) => {
                if (r.completed) FB().bumpLevelStat(lv.id, 'completions');
                return {
                    title: r.completed ? '¡FASE SUPERADA!' : 'FIN DEL JUEGO',
                    note: `«${lv.name}» · nivel ${Math.min(N_LEVELS, r.cleared + 1)}/${N_LEVELS} · ${r.height} cm`,
                    primary: { text: 'VOLVER A LA COMUNIDAD', onClick: () => openCreator('community') },
                };
            },
            onExit: () => openCreator('community'),
        });
    }

    $('creator-btn').addEventListener('click', () => openCreator('mine'));
    $('cr-close-btn').addEventListener('click', () => hide($('creator-screen')));
    $('cr-tab-mine').addEventListener('click', () => setHubTab('mine'));
    $('cr-tab-community').addEventListener('click', () => setHubTab('community'));
    $('cr-search-btn').addEventListener('click', renderCommunity);
    $('cr-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') renderCommunity(); });
    $('cr-new-btn').addEventListener('click', async () => {
        if (needLogin()) return;
        const d = newDraftData();
        $('cr-new-btn').disabled = true;
        try { d.id = await FB().saveDraft(d); hide($('creator-screen')); openEditor(d); }
        catch (e) { console.error(e); toast('No se pudo crear la fase (¿reglas de Firestore?)'); }
        finally { $('cr-new-btn').disabled = false; }
    });

    // =================================================================
    // 4) EDITOR
    // =================================================================
    const ED = { d: null, li: 0, sel: null, pal: null, scroll: 0, W: 0, H: 0, drag: null, saveTimer: null, raf: 0 };
    const edCanvas = $('ed-canvas');
    const ec = edCanvas.getContext('2d');
    const BASE_Y = 34; // margen inferior: la línea de inicio (y=0) queda a esta altura del borde

    const lvl = () => ED.d.levels[ED.li];
    const side = () => G.getSide();
    const sy = (wy) => ED.H - BASE_Y - (wy - ED.scroll);
    const wyOf = (py) => ED.H - BASE_Y - py + ED.scroll;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const snap10 = (v) => Math.round(v / 10) * 10;

    function topIdx(l) {
        let best = -1;
        l.items.forEach((it, i) => { if (it.k === 'plat' && (best < 0 || it.y > l.items[best].y)) best = i; });
        return best;
    }
    const effW = (it) => (it.t === 'mini_sticky' ? it.w * 0.6 : it.w);
    // x "de referencia": borde izquierdo en plataformas, centro en el resto
    const refX = (it) => G.mapX(it.fx, it.k === 'plat' ? it.w : 0, ED.W, side());
    const fxOf = (x, w) => clamp((x - G.mapX(0, w, ED.W, side())) / Math.max(1, ED.W - w - 80), 0, 1);

    function bounds(it) {
        const x = refX(it), y = sy(it.y);
        switch (it.k) {
            case 'plat': return { x, y, w: effW(it), h: 20 };
            case 'drone': return { x: x - 20, y: y - 10, w: 40, h: 20 };
            case 'hole': return { x: x - it.w, y: y - it.w, w: it.w * 2, h: it.w * 2 };
            case 'box': return { x: x - it.w / 2, y: y - it.w / 2, w: it.w, h: it.w };
            case 'chest': return { x: x - 13, y: y - 20, w: 26, h: 20 };
            default: return { x: x - 12, y: y - 12, w: 24, h: 24 };
        }
    }
    function hitTest(p) {
        const items = lvl().items;
        for (let i = items.length - 1; i >= 0; i--) {
            const b = bounds(items[i]), s = 8;
            if (p.x >= b.x - s && p.x <= b.x + b.w + s && p.y >= b.y - s && p.y <= b.y + b.h + s) return i;
        }
        return -1;
    }
    function startMarker() {
        let w = 100, x = ED.W / 2 + (side() === 'left' ? 30 : 0) - 50;
        if (ED.li > 0) {
            const prev = ED.d.levels[ED.li - 1], ti = topIdx(prev);
            if (ti >= 0) { const it = prev.items[ti]; w = effW(it); x = G.mapX(it.fx, it.w, ED.W, side()); }
        }
        return { x, w };
    }

    // ---------- validación de posiciones ----------
    function posError(it, ignore) {
        const items = lvl().items;
        if (it.k === 'plat') {
            if (it.y < MIN_Y || it.y > MAX_Y) return `Las plataformas van entre ${MIN_Y} y ${MAX_Y} px de altura`;
            for (let i = 0; i < items.length; i++) {
                if (i !== ignore && items[i].k === 'plat' && Math.abs(items[i].y - it.y) < MIN_GAP) return `Demasiado cerca de otra plataforma en altura (mín. ${MIN_GAP} px)`;
            }
        } else if (it.y < 0 || it.y > MAX_Y + 100) return 'Fuera del área del nivel';
        return null;
    }

    // ---------- estado / cambios ----------
    function changed() {
        scheduleSave();
        renderPills(); refreshActions(); requestDraw();
    }
    function scheduleSave() {
        clearTimeout(ED.saveTimer);
        ED.saveTimer = setTimeout(() => saveNow(true), 2500);
    }
    async function saveNow(silent) {
        clearTimeout(ED.saveTimer);
        if (!ED.d) return true;
        try {
            ED.d.id = await FB().saveDraft(ED.d);
            if (!silent) toast('Guardado ✔');
            return true;
        } catch (e) { console.error('Guardar borrador:', e); toast('No se pudo guardar'); return false; }
    }

    function renderPills() {
        const box = $('ed-levels');
        box.innerHTML = '';
        ED.d.levels.forEach((l, i) => {
            const b = document.createElement('button');
            b.type = 'button'; b.textContent = String(i + 1);
            if (i === ED.li) b.classList.add('active');
            if (platsOf(l).length >= MIN_PLATS) b.classList.add('ok');
            b.onclick = () => { ED.li = i; ED.sel = null; ED.scroll = 0; selUI(); envUI(); renderPills(); requestDraw(); };
            box.appendChild(b);
        });
        const act = box.querySelector('.active');
        if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
    function envUI() {
        const w = lvl().wind;
        $('ed-wind-val').textContent = w === 0 ? '0' : (w < 0 ? '◀'.repeat(-w) : '▶'.repeat(w));
        $('ed-lowg').classList.toggle('active', !!lvl().lowG);
    }
    function refreshActions() {
        const ver = isVerified(ED.d);
        $('ed-publish').disabled = !ver;
        $('ed-status').textContent = ver
            ? (ED.d.publishedId ? '✔ Verificada · puedes actualizar la publicada' : '✔ Verificada · lista para publicar')
            : (ED.d.publishedId ? 'Publicada · verifica de nuevo para actualizar' : 'Para publicar tienes que pasarte los 10 niveles (VERIFICAR)');
    }

    // ---------- paleta ----------
    const PAL = [
        { id: 'none', label: '✋ Mover' },
        ...PTYPES.map((t) => ({ id: 'plat:' + t[0], label: '▬ ' + t[1], k: 'plat', t: t[0] })),
        { id: 'drone', label: '🛸 Dron', k: 'drone' }, { id: 'shield', label: '🛡 Escudo', k: 'shield' },
        { id: 'dj', label: '🚀 Cohete', k: 'dj' }, { id: 'hole', label: '🌀 Agujero', k: 'hole' }, { id: 'box', label: '📦 Caja', k: 'box' }, { id: 'chest', label: '🎁 Cofre', k: 'chest' },
    ];
    function buildPalette() {
        const box = $('ed-palette');
        box.innerHTML = '';
        PAL.forEach((p) => {
            const b = document.createElement('button');
            b.type = 'button'; b.textContent = p.label; b.dataset.id = p.id;
            b.onclick = () => { ED.pal = p.id === 'none' ? null : p; paintPalette(); };
            box.appendChild(b);
        });
        paintPalette();
    }
    function paintPalette() {
        const cur = ED.pal ? ED.pal.id : 'none';
        $('ed-palette').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.id === cur));
    }

    // ---------- panel del elemento seleccionado ----------
    function selUI() {
        const box = $('ed-sel'), l = lvl();
        const it = ED.sel != null ? l.items[ED.sel] : null;
        if (!it) { hide(box); return; }
        show(box);
        const names = { plat: 'Plataforma', drone: 'Dron', shield: 'Escudo', dj: 'Cohete', hole: 'Agujero negro', box: 'Caja', chest: 'Cofre' };
        const goal = it.k === 'plat' && ED.sel === topIdx(l);
        let h = `<b>${names[it.k]}${goal ? ' · 🏁 META' : ''}</b>`;
        if (it.k === 'plat') {
            h += `<select id="sel-type" ${goal ? 'disabled title="La meta siempre es normal"' : ''}>${PTYPES.map((t) => `<option value="${t[0]}" ${t[0] === it.t ? 'selected' : ''}>${t[1]}</option>`).join('')}</select>`;
            h += '<input id="sel-w" type="range" min="40" max="150" step="5" />';
        } else if (it.k === 'hole') h += '<input id="sel-w" type="range" min="20" max="60" step="5" />';
        else if (it.k === 'box') h += '<input id="sel-w" type="range" min="15" max="40" step="1" />';
        h += '<button id="sel-del" type="button">🗑 Borrar</button>';
        box.innerHTML = h;
        const tsel = $('sel-type'); if (tsel) tsel.onchange = () => { it.t = tsel.value; changed(); };
        const w = $('sel-w'); if (w) { w.value = it.w; w.oninput = () => { it.w = +w.value; changed(); }; }
        $('sel-del').onclick = () => { l.items.splice(ED.sel, 1); ED.sel = null; selUI(); changed(); };
    }

    // ---------- dibujo ----------
    function requestDraw() { if (!ED.raf) ED.raf = requestAnimationFrame(() => { ED.raf = 0; edDraw(); }); }

    function edDraw() {
        if (!ED.d) return;
        const c = ec, W = ED.W, H = ED.H, l = lvl(), sd = side();
        c.clearRect(0, 0, W, H);
        c.fillStyle = '#07102a'; c.fillRect(0, 0, W, H);

        // Zona de la barra de precisión (no se colocan plataformas ahí)
        c.fillStyle = 'rgba(255,255,255,0.04)';
        c.fillRect(sd === 'left' ? 0 : W - 50, 0, 50, H);
        c.fillStyle = 'rgba(255,255,255,0.25)'; c.font = '9px sans-serif'; c.textAlign = 'center';
        c.fillText('BARRA', sd === 'left' ? 25 : W - 25, 12);

        // Rejilla de alturas
        c.textAlign = 'left'; c.font = '9px sans-serif';
        for (let wy = 0; wy <= MAX_Y + 100; wy += 100) {
            const y = sy(wy);
            if (y < -10 || y > H + 10) continue;
            c.strokeStyle = 'rgba(255,255,255,0.06)'; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
            c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillText(wy + ' px', 4, y - 2);
        }

        // Inicio
        const sm = startMarker(), y0 = sy(0);
        c.fillStyle = 'rgba(0,242,255,0.25)'; c.fillRect(sm.x, y0, sm.w, 20);
        c.strokeStyle = '#00f2ff'; c.setLineDash([4, 3]); c.strokeRect(sm.x, y0, sm.w, 20); c.setLineDash([]);
        c.fillStyle = '#00f2ff'; c.textAlign = 'center'; c.fillText('INICIO', sm.x + sm.w / 2, y0 + 14);

        // Camino de saltos (plataformas ordenadas por altura)
        const ps = l.items.filter((i) => i.k === 'plat').sort((a, b) => a.y - b.y);
        c.strokeStyle = 'rgba(255,255,255,0.18)'; c.setLineDash([3, 4]); c.beginPath();
        c.moveTo(sm.x + sm.w / 2, y0);
        ps.forEach((p) => { const b = bounds(p); c.lineTo(b.x + b.w / 2, b.y); });
        c.stroke(); c.setLineDash([]);

        // Elementos
        const ti = topIdx(l);
        l.items.forEach((it, i) => drawItem(c, it, i === ti, i === ED.sel));

        // Viento
        if (l.wind) {
            c.fillStyle = '#00f2ff'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center';
            c.fillText('VIENTO ' + (l.wind < 0 ? '◀'.repeat(-l.wind) : '▶'.repeat(l.wind)), W / 2, 14);
        }
        c.textAlign = 'right'; c.fillStyle = 'rgba(255,255,255,0.35)'; c.font = '9px sans-serif';
        c.fillText(`Nivel ${ED.li + 1} · ${ps.length} plataformas`, W - (sd === 'right' ? 56 : 6), H - 6);
    }

    function drawItem(c, it, isGoal, selected) {
        const b = bounds(it), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        c.save();
        if (it.k === 'plat') {
            const col = ptype(it.t);
            c.fillStyle = isGoal ? '#ffd700' : col[2]; c.fillRect(b.x, b.y, b.w, 20);
            c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(b.x, b.y, b.w, 3);
            c.fillStyle = '#000'; c.font = 'bold 12px sans-serif'; c.textAlign = 'center';
            if (!isGoal && col[3]) c.fillText(col[3], cx, b.y + 15);
            if (isGoal) { c.font = '16px sans-serif'; c.fillText('🏁', b.x + b.w - 10, b.y - 4); }
        } else if (it.k === 'drone') {
            c.fillStyle = '#ff3300'; c.fillRect(b.x, b.y, b.w, b.h);
            c.fillStyle = '#fff'; c.fillRect(b.x + 5, b.y + 5, 5, 5); c.fillRect(b.x + b.w - 10, b.y + 5, 5, 5);
            c.strokeStyle = 'rgba(255,51,0,0.4)'; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(0, cy); c.lineTo(ED.W, cy); c.stroke();
        } else if (it.k === 'hole') {
            const g = c.createRadialGradient(cx, cy, 0, cx, cy, it.w);
            g.addColorStop(0, '#000'); g.addColorStop(0.7, '#6600ff'); g.addColorStop(1, 'rgba(102,0,255,0)');
            c.fillStyle = g; c.beginPath(); c.arc(cx, cy, it.w, 0, Math.PI * 2); c.fill();
        } else if (it.k === 'box') {
            c.fillStyle = 'hsl(215,80%,60%)'; c.fillRect(b.x, b.y, b.w, b.h);
        } else if (it.k === 'chest') {
            c.fillStyle = '#8a5a2b'; c.fillRect(b.x, b.y + 8, b.w, 12);
            c.fillStyle = '#b07a3a'; c.fillRect(b.x - 1, b.y, b.w + 2, 9);
            c.fillStyle = '#ffd700'; c.fillRect(cx - 3, b.y + 5, 6, 7);
        } else {
            c.fillStyle = it.k === 'shield' ? '#00ff64' : '#2f8bff';
            c.beginPath(); c.arc(cx, cy, 10, 0, Math.PI * 2); c.fill();
            c.fillStyle = '#000'; c.font = 'bold 10px sans-serif'; c.textAlign = 'center'; c.fillText(it.k === 'shield' ? 'S' : 'R', cx, cy + 3);
        }
        if (selected) { c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.setLineDash([4, 3]); c.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6); }
        c.restore();
    }

    // ---------- interacción (ratón y táctil) ----------
    const ptr = (e) => { const r = edCanvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    edCanvas.addEventListener('pointerdown', (e) => {
        if (!ED.d) return;
        edCanvas.setPointerCapture(e.pointerId);
        const p = ptr(e), idx = hitTest(p);
        ED.drag = { sx: p.x, sy: p.y, moved: false, idx, startScroll: ED.scroll };
        if (idx >= 0) {
            const it = lvl().items[idx];
            ED.drag.gx = p.x - refX(it); ED.drag.gy = wyOf(p.y) - it.y;
            ED.drag.orig = { fx: it.fx, y: it.y };
            ED.sel = idx; selUI(); requestDraw();
        }
    });
    edCanvas.addEventListener('pointermove', (e) => {
        const d = ED.drag; if (!d) return;
        const p = ptr(e);
        if (!d.moved && Math.hypot(p.x - d.sx, p.y - d.sy) < 6) return;
        d.moved = true;
        if (d.idx >= 0) {
            const it = lvl().items[d.idx], w = it.k === 'plat' ? it.w : 0;
            it.fx = fxOf(p.x - d.gx, w);
            it.y = clamp(snap10(wyOf(p.y) - d.gy), 0, MAX_Y + 100);
        } else {
            ED.scroll = clamp(d.startScroll + (p.y - d.sy), 0, MAX_Y - 150);
        }
        requestDraw();
    });
    function endPointer(e) {
        const d = ED.drag; if (!d) return;
        ED.drag = null;
        const p = ptr(e), l = lvl();
        if (d.idx >= 0) {
            const it = l.items[d.idx];
            if (d.moved) {
                if (it.k === 'chest') { // el cofre siempre se queda sobre la plataforma más cercana en altura
                    const ps = platsOf(l);
                    if (!ps.length) { it.fx = d.orig.fx; it.y = d.orig.y; toast('El cofre necesita una plataforma'); requestDraw(); }
                    else { it.y = ps.reduce((bst, q) => (Math.abs(q.y - it.y) < Math.abs(bst.y - it.y) ? q : bst)).y; changed(); }
                } else {
                    const err = posError(it, d.idx);
                    if (err) { it.fx = d.orig.fx; it.y = d.orig.y; toast(err); requestDraw(); }
                    else changed();
                }
            } else if (ED.pal && ED.pal.k === 'chest' && it.k === 'plat') {
                if (l.items.filter((i) => i.k === 'chest').length >= 3) toast('Máximo 3 cofres por nivel');
                else {
                    l.items.push({ k: 'chest', fx: fxOf(p.x, 0), y: it.y });
                    ED.sel = l.items.length - 1; selUI(); changed();
                }
            }
        } else if (!d.moved && ED.pal) {
            addAt(p);
        } else if (!d.moved) { ED.sel = null; selUI(); requestDraw(); }
    }
    edCanvas.addEventListener('pointerup', endPointer);
    edCanvas.addEventListener('pointercancel', () => { ED.drag = null; });
    edCanvas.addEventListener('wheel', (e) => { e.preventDefault(); ED.scroll = clamp(ED.scroll - e.deltaY, 0, MAX_Y - 150); requestDraw(); }, { passive: false });

    function addAt(p) {
        const l = lvl(), pal = ED.pal;
        if (l.items.length >= MAX_ITEMS) { toast(`Máximo ${MAX_ITEMS} elementos por nivel`); return; }
        let it;
        if (pal.k === 'chest') { toast('Toca sobre una plataforma para poner el cofre'); return; }
        if (pal.k === 'plat') {
            if (platsOf(l).length >= MAX_PLATS) { toast(`Máximo ${MAX_PLATS} plataformas por nivel`); return; }
            const w = 90;
            it = { k: 'plat', fx: fxOf(p.x - w / 2, w), y: Math.max(MIN_Y, snap10(wyOf(p.y))), w, t: pal.t };
        } else {
            const w = pal.k === 'hole' ? 35 : pal.k === 'box' ? 24 : undefined;
            it = { k: pal.k, fx: fxOf(p.x, 0), y: Math.max(0, snap10(wyOf(p.y))) };
            if (w) it.w = w;
        }
        const err = posError(it, -1);
        if (err) { toast(err); return; }
        l.items.push(it);
        ED.sel = l.items.length - 1;
        selUI(); changed();
    }

    // ---------- controles del editor ----------
    $('ed-wind-minus').onclick = () => { lvl().wind = Math.max(-3, lvl().wind - 1); envUI(); changed(); };
    $('ed-wind-plus').onclick = () => { lvl().wind = Math.min(3, lvl().wind + 1); envUI(); changed(); };
    $('ed-lowg').onclick = () => { lvl().lowG = !lvl().lowG; envUI(); changed(); };
    $('ed-clear').onclick = () => {
        if (!lvl().items.length || !confirm(`¿Vaciar el nivel ${ED.li + 1}?`)) return;
        ED.d.levels[ED.li] = newLevel(); ED.sel = null; selUI(); envUI(); changed();
    };
    $('ed-name').addEventListener('input', () => { ED.d.name = $('ed-name').value; scheduleSave(); });
    $('ed-save').onclick = () => saveNow(false);
    $('ed-back').onclick = async () => {
        await saveNow(true);
        hide($('editor-screen'));
        ED.d = null;
        openCreator('mine');
    };

    function openEditor(draft) {
        ED.d = draft; ED.li = 0; ED.sel = null; ED.scroll = 0; ED.pal = PAL[1]; // platform normal por defecto
        $('ed-name').value = draft.name;
        show($('editor-screen'));
        buildPalette(); renderPills(); envUI(); selUI(); refreshActions();
        edResize();
    }
    function backToEditor() {
        show($('editor-screen'));
        renderPills(); envUI(); selUI(); refreshActions();
        edResize();
    }
    function edResize() {
        requestAnimationFrame(() => {
            const r = edCanvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
            if (!r.width) return;
            edCanvas.width = Math.round(r.width * dpr); edCanvas.height = Math.round(r.height * dpr);
            ec.setTransform(dpr, 0, 0, dpr, 0, 0);
            ED.W = r.width; ED.H = r.height;
            requestDraw();
        });
    }
    window.addEventListener('resize', () => { if (ED.d) edResize(); });

    // ---------- probar / verificar / publicar ----------
    async function testLevel() {
        const l = lvl();
        if (platsOf(l).length < MIN_PLATS) { toast(`Pon al menos ${MIN_PLATS} plataformas en este nivel`); return; }
        await saveNow(true);
        hide($('editor-screen'));
        const n = ED.li + 1;
        G.start({
            type: 'custom', first: n, last: n, total: 1, levels: ED.d.levels,
            onEnd: (r) => ({
                title: r.completed ? '¡NIVEL SUPERADO!' : 'FIN DEL JUEGO',
                note: r.completed ? 'Así se juega tu nivel. Para publicar, verifica los 10 seguidos.' : '',
                primary: { text: 'VOLVER AL EDITOR', onClick: backToEditor },
            }),
            onExit: backToEditor,
        });
    }

    async function verify() {
        const bad = validateLevels(ED.d);
        if (bad) { ED.li = bad.level; ED.sel = null; ED.scroll = 0; selUI(); envUI(); renderPills(); requestDraw(); toast(bad.msg); return; }
        await saveNow(true);
        hide($('editor-screen'));
        const d = ED.d;
        G.start({
            type: 'custom', first: 1, last: N_LEVELS, total: N_LEVELS, levels: d.levels,
            onEnd: (r) => {
                if (r.completed) {
                    d.verifiedSig = sig(d.levels);
                    saveNow(true);
                    return {
                        title: '¡FASE VERIFICADA!', note: 'Ya puedes publicarla desde el editor.',
                        primary: { text: 'VOLVER AL EDITOR', onClick: backToEditor }, retryText: 'JUGAR OTRA VEZ',
                    };
                }
                return {
                    title: 'FASE NO SUPERADA',
                    note: `Has llegado al nivel ${Math.min(N_LEVELS, r.cleared + 1)}. Para publicar tienes que pasarte los ${N_LEVELS} niveles de una vez.`,
                    primary: { text: 'VOLVER AL EDITOR', onClick: backToEditor },
                };
            },
            onExit: backToEditor,
        });
    }

    async function publish() {
        const d = ED.d, name = (d.name || '').trim();
        if (!isVerified(d)) { toast('Primero tienes que verificar la fase'); return; }
        if (name.length < 3 || name.length > 30) { toast('El nombre debe tener entre 3 y 30 caracteres'); return; }
        $('ed-publish').disabled = true;
        try {
            d.name = name;
            d.publishedId = await FB().publishLevel(d);
            await saveNow(true);
            toast('🌐 ¡Fase publicada! Ya aparece en la comunidad');
        } catch (e) { console.error('Publicar:', e); toast('No se pudo publicar (¿reglas de Firestore?)'); }
        finally { refreshActions(); }
    }

    $('ed-test').onclick = testLevel;
    $('ed-verify').onclick = verify;
    $('ed-publish').onclick = publish;
})();
