// Lógica del Editor de Guiones (Formatos, Atajos y Paginación)
// pagesContainer ya lo declara app.js (se carga antes) — reutilizamos esa misma variable global.
const styles = ['slugline', 'action', 'character', 'parenthetical', 'dialogue', 'transition'];

const flowMap = {
    'slugline': 'action',
    'character': 'dialogue',
    'parenthetical': 'dialogue',
    'dialogue': 'action',
    'action': 'action',
    'transition': 'slugline'
};

// Variable global que rastrea exactamente en qué bloque de texto está el usuario
let currentFocusBlock = null;

// ==================== RASTREO DEL CURSOR (A PRUEBA DE FALLOS) ====================
document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;

    let node = selection.anchorNode;
    
    // Si el usuario hace clic en un espacio vacío de la página
    if (node && node.nodeType === 1 && node.classList && node.classList.contains('page')) {
        node = node.childNodes[selection.anchorOffset] || node.lastElementChild;
    }

    // Subimos por el árbol DOM hasta encontrar el div que contiene el formato (hijo directo de .page)
    while (node && node !== pagesContainer) {
        if (node.parentElement && node.parentElement.classList && node.parentElement.classList.contains('page')) {
            if (/auto(more|cue)/.test(node.className)) return;
            currentFocusBlock = node;
            updateActiveButton(node.className);
            return;
        }
        node = node.parentElement;
    }
});

function updateActiveButton(className) {
    document.querySelectorAll('.btn-style').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-type') === className) {
            btn.classList.add('active');
        }
    });
}

// ==================== APLICAR ESTILO (BOTONES) ====================
window.applyStyle = function(className) {
    if (currentFocusBlock) {
        currentFocusBlock.className = className;
        updateActiveButton(className);
    }
};

// ==================== ZOOM ====================
const zoomSelect = document.getElementById('zoom-select');
if(zoomSelect) {
    zoomSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        pagesContainer.style.transform = `scale(${val})`;
    });
}

// ==================== LÓGICA DE TECLADO ====================
pagesContainer.addEventListener('keydown', (e) => {
    if (!currentFocusBlock) return;
    if (e.key === 'Enter' || e.key === 'Tab') healAll();
    if (!currentFocusBlock) return;

    const page = currentFocusBlock.closest('.page');
    if (!page || page.contentEditable === "false") return;

    if (e.key === 'Escape') { clearSg(); return; }
    if (currentFocusBlock.dataset.sg && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const b = currentFocusBlock, typed = b.textContent, g = b.dataset.sg;
        if ((e.key === 'ArrowRight' && atEnd(b)) || (e.key === ' ' && typed.trim().length >= 3 && !/\s/.test(g.trim()))) {
            e.preventDefault(); b.textContent = typed + g + (e.key === ' ' ? ' ' : ''); clearSg(); caretEnd(b); return;
        }
        if (e.key === 'Enter') { b.textContent = typed + g; clearSg(); }
    }

    // TAB: Cambiar estilo cíclicamente
    if (e.key === 'Tab') {
        e.preventDefault();
        const currentType = currentFocusBlock.className || 'action';
        const nextIndex = (styles.indexOf(currentType) + 1) % styles.length;
        const nextType = styles[nextIndex];
        currentFocusBlock.className = nextType;
        updateActiveButton(nextType);
        checkPagination(page); flushAll();
        return;
    }

    // ENTER: Nueva línea con lógica de flujo
    if (e.key === 'Enter') {
        e.preventDefault();
        const currentType = currentFocusBlock.className || 'action';
        const nextType = flowMap[currentType] || 'action';

        const newBlock = document.createElement('div');
        newBlock.className = nextType;
        newBlock.innerHTML = '<br>';
        
        // Insertar después del bloque actual
        currentFocusBlock.after(newBlock);

        // Mover el cursor al nuevo bloque
        const selection = window.getSelection();
        const range = document.createRange();
        range.setStart(newBlock, 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        
        updateActiveButton(nextType);
        currentFocusBlock = newBlock; // Actualizar referencia local inmediatamente
        
        // Forzar chequeo de paginación
        checkPagination(page);
        flushAll();
    }
});

// ==================== PAGINACIÓN (EL NÚCLEO) ====================
pagesContainer.addEventListener('beforeinput', () => healAll());
pagesContainer.addEventListener('input', (e) => {
    const page = e.target.closest('.page');
    if (needAll) flushAll(); else if (page) checkPagination(page);
    clearSg();
    if (currentFocusBlock && /^insert(Composition)?Text$/.test(e.inputType || '')) showSg(currentFocusBlock);
});

// Función para guardar y restaurar el caret
function saveCaret() {
    const selection = window.getSelection();
    if(selection.rangeCount === 0) return null;
    return { node: selection.anchorNode, offset: selection.anchorOffset };
}
function restoreCaret(caretInfo) {
    if(!caretInfo || !caretInfo.node) return;
    try {
        const selection = window.getSelection();
        const range = document.createRange();
        range.setStart(caretInfo.node, caretInfo.offset);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    } catch(e) {}
}

window.reflowPagination = function(startPage) {
    checkPagination(startPage);
}

// ==================== SUGERENCIAS, (MORE)/(CONT'D) Y GUARDADO LIMPIO ====================
let needAll = false, splitSeq = 0, cpDepth = 0, cpCaret = null;
const SG_MIN = { character: 1, slugline: 2, parenthetical: 2, transition: 2 };

function caretEnd(b) { const r = document.createRange(); r.selectNodeContents(b); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
function caretAt(b, off) {
    const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT); let n, acc = 0;
    while ((n = w.nextNode())) {
        if (off <= acc + n.length) { const r = document.createRange(); r.setStart(n, off - acc); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return; }
        acc += n.length;
    }
    caretEnd(b);
}
function blockOf(n) {
    if (n && n.nodeType === 1 && n.classList.contains('page')) return null;
    while (n && n.parentElement) { if (n.parentElement.classList && n.parentElement.classList.contains('page')) return n; n = n.parentElement; }
    return null;
}
function caretLogical() {
    const s = getSelection(); if (!s.rangeCount) return null;
    const b = blockOf(s.anchorNode); if (!b || /auto(more|cue)/.test(b.className)) return null;
    const r = document.createRange(); r.selectNodeContents(b); r.setEnd(s.anchorNode, s.anchorOffset);
    let off = r.toString().length;
    if (b.dataset.cont) { const p = pagesContainer.querySelector(`[data-part="${b.dataset.cont}"]`); off += p ? p.textContent.length : 0; }
    return { b, off };
}
function setCaretLogical(c) {
    if (!c) return;
    const id = c.b.dataset.part || c.b.dataset.cont; if (!id) return;
    const p = pagesContainer.querySelector(`[data-part="${id}"]`), k = pagesContainer.querySelector(`[data-cont="${id}"]`);
    if (!p) return;
    const len = p.textContent.length;
    if (k && c.off > len) caretAt(k, c.off - len); else caretAt(p, c.off);
}
// Une los diálogos partidos para que la edición actúe sobre bloques enteros
function healAll() {
    const ms = pagesContainer.querySelectorAll('.automore'); if (!ms.length) return;
    const c = caretLogical();
    ms.forEach(m => {
        const id = m.dataset.k, p = pagesContainer.querySelector(`[data-part="${id}"]`), k = pagesContainer.querySelector(`[data-cont="${id}"]`), q = pagesContainer.querySelector(`.autocue[data-k="${id}"]`);
        m.remove(); if (q) q.remove();
        if (p && k) { p.append(...k.childNodes); p.normalize(); }
        if (k) k.remove();
    });
    if (currentFocusBlock && !currentFocusBlock.isConnected) {
        const id = currentFocusBlock.dataset.cont || currentFocusBlock.dataset.part;
        currentFocusBlock = pagesContainer.querySelector(`[data-part="${id}"]`);
    }
    needAll = true; setCaretLogical(c);
}
function flushAll() { if (needAll) { needAll = false; document.querySelectorAll('.page').forEach(p => checkPagination(p)); } }

function findLineStart(b, k) {
    const sc = parseFloat(zoomSelect && zoomSelect.value) || 1, base = b.getBoundingClientRect().top;
    const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT), r = document.createRange(); let n;
    while ((n = w.nextNode())) for (let i = 0; i < n.length; i++) {
        r.setStart(n, i); r.setEnd(n, i + 1); const q = r.getClientRects();
        if (q.length && Math.round((q[0].top - base) / (16 * sc)) >= k) return { node: n, off: i };
    }
    return null;
}
// Parte el último diálogo de la página por líneas: (MORE) abajo y NOMBRE (CONT'D) arriba en la siguiente
function trySplit(page, nextPage) {
    try {
        const b = page.lastElementChild, LH = 16;
        if (!b || b.className !== 'dialogue') return false;
        let c = b.previousElementSibling;
        while (c && !c.classList.contains('character')) c = c.previousElementSibling;
        if (!c) return false;
        const n = Math.round(b.offsetHeight / LH);
        let fit = Math.floor((1056 - 96 - b.offsetTop - LH) / LH);
        if (n - fit < 2) fit = n - 2;
        if (n < 4 || fit < 2) return false;
        const pt = findLineStart(b, fit); if (!pt) return false;
        const rg = document.createRange(); rg.setStart(pt.node, pt.off); rg.setEnd(b, b.childNodes.length);
        const id = 's' + (++splitSeq) + Date.now().toString(36);
        const cont = document.createElement('div'); cont.className = 'dialogue'; cont.dataset.cont = id; cont.appendChild(rg.extractContents());
        b.dataset.part = id;
        const more = document.createElement('div'); more.className = 'automore'; more.dataset.k = id; more.contentEditable = 'false'; more.textContent = '(MORE)';
        const cue = document.createElement('div'); cue.className = 'character autocue'; cue.dataset.k = id; cue.contentEditable = 'false';
        cue.textContent = c.textContent.trim().replace(/\s*\(CONT'?D\)\s*$/i, '') + " (CONT'D)";
        b.after(more); nextPage.insertBefore(cont, nextPage.firstChild); nextPage.insertBefore(cue, cont);
        return true;
    } catch (err) { return false; }
}
// Encabezado, personaje o paréntesis nunca quedan solos al final de página
function keepNext(page) {
    const nx = page.nextElementSibling; if (!nx) return;
    const caret = saveCaret(); let moved = false;
    while (page.childElementCount > 1 && /^(slugline|character|parenthetical)$/.test(page.lastElementChild.className)) { nx.insertBefore(page.lastElementChild, nx.firstChild); moved = true; }
    if (moved) { restoreCaret(caret); if (nx.scrollHeight > 1056) checkPagination(nx); }
}
// (CONT'D) automático cuando el mismo personaje sigue hablando tras una acción
function updateContd() {
    let last = '';
    pagesContainer.querySelectorAll('.page > div').forEach(b => {
        const c = b.className;
        if (c === 'slugline' || c === 'transition') last = '';
        else if (c === 'character') {
            const n = b.textContent.replace(/\s*\(.*?\)/g, '').trim().toUpperCase();
            if (n && n === last && !/cont/i.test(b.textContent)) b.dataset.cd = 1; else delete b.dataset.cd;
            if (n) last = n;
        }
    });
}
// Contenido limpio para guardar: sin bloques automáticos y con los diálogos unidos
window.getScriptContent = function () {
    const tmp = document.createElement('div');
    pagesContainer.querySelectorAll('.page').forEach(p => [...p.children].forEach(c => tmp.appendChild(c.cloneNode(true))));
    tmp.querySelectorAll('.automore,.autocue').forEach(x => x.remove());
    tmp.querySelectorAll('[data-cont]').forEach(k => {
        const p = tmp.querySelector(`[data-part="${k.dataset.cont}"]`);
        if (p) p.append(...k.childNodes); k.remove();
    });
    tmp.querySelectorAll('[data-part],[data-cd],[data-sg]').forEach(x => { x.removeAttribute('data-part'); x.removeAttribute('data-cd'); x.removeAttribute('data-sg'); });
    return tmp.innerHTML;
};

// Sugerencias en gris (Enter, Espacio o → las aceptan; Esc las descarta)
function atEnd(b) {
    const s = getSelection(); if (!s.rangeCount || !s.isCollapsed || !b.contains(s.anchorNode)) return false;
    const r = document.createRange(); r.selectNodeContents(b); r.setStart(s.anchorNode, s.anchorOffset); return r.toString() === '';
}
function clearSg() { pagesContainer.querySelectorAll('[data-sg]').forEach(x => x.removeAttribute('data-sg')); }
function showSg(b) {
    clearSg(); const t = b.className, min = SG_MIN[t]; if (!min || !atEnd(b)) return;
    const typed = b.textContent.replace(/\u00a0/g, ' '); if (typed.trim().length < min) return;
    const U = typed.toUpperCase(), cnt = new Map(); let best = null, bn = 0;
    pagesContainer.querySelectorAll('.page > .' + t).forEach(x => {
        if (x === b) return; const v = x.textContent.replace(/\u00a0/g, ' ').trim(); if (!v) return;
        const k = v.toUpperCase(), o = cnt.get(k); cnt.set(k, { v, n: (o ? o.n : 0) + 1 });
    });
    cnt.forEach((o, k) => { if (k.length > U.length && k.startsWith(U) && o.n > bn) { best = o; bn = o.n; } });
    if (best) b.dataset.sg = best.v.slice(typed.length);
}
document.addEventListener('selectionchange', () => {
    const g = pagesContainer.querySelector('[data-sg]');
    if (g && (g !== currentFocusBlock || !atEnd(g))) clearSg();
});

function checkPagination(page) {
    if (!page) return;
    if (cpDepth++ === 0) cpCaret = caretLogical();
    try { _check(page); }
    finally { if (--cpDepth === 0) { setCaretLogical(cpCaret); updateContd(); } }
}

function _check(page) {
    if(!page) return;
    // 11in = 1056px @ 96dpi.
    const pageHeight = 1056;

    // 1. DESBORDAMIENTO (Push down)
    while (page.scrollHeight > pageHeight && page.lastElementChild && page.childElementCount > 1) {
        let nextPage = page.nextElementSibling;
        if (!nextPage) {
            nextPage = document.createElement('div');
            nextPage.className = 'page';
            nextPage.contentEditable = true;
            nextPage.spellcheck = false;
            page.parentNode.insertBefore(nextPage, page.nextSibling);
        }
        
        if (trySplit(page, nextPage)) { if (nextPage.scrollHeight > pageHeight) checkPagination(nextPage); continue; }
        const lastChild = page.lastElementChild;
        const caret = saveCaret();
        
        nextPage.insertBefore(lastChild, nextPage.firstChild);
        
        restoreCaret(caret);
        
        if(nextPage.scrollHeight > pageHeight) {
            checkPagination(nextPage);
        }
    }

    keepNext(page);

    // 2. REFLUJO HACIA ARRIBA (Pull up)
    let nextPage = page.nextElementSibling;
    if (nextPage) {
        let firstChild = nextPage.firstElementChild;
        if (firstChild && page.scrollHeight <= pageHeight - 20) {
            const caret = saveCaret();
            page.appendChild(firstChild);
            
            // Si al traerlo desborda, lo devolvemos
            if (page.scrollHeight > pageHeight) {
                page.removeChild(firstChild);
                nextPage.insertBefore(firstChild, nextPage.firstChild);
            } else {
                restoreCaret(caret);
                checkPagination(page);
                return;
            }
        }
        
        // Eliminar página siguiente si quedó vacía
        if (nextPage.childNodes.length === 0 || (nextPage.childNodes.length === 1 && nextPage.innerHTML === '<br>')) {
            nextPage.remove();
        }
    }
}

// ==================== ESTADÍSTICAS ====================
const CAP = /(?<![\p{L}\d])\p{Lu}[\p{Lu}\d]{2,}(?:\s+\p{Lu}[\p{Lu}\d]{2,})*(?![\p{L}\d])/gu;
const MUS = /m[úu]sica|canci[óo]n|melod[íi]a|banda sonora|sonata|[óo]pera|♪/i;
const esc = s => { const d = document.createElement('i'); d.textContent = s; return d.innerHTML; };
function updateStats() {
    const pages = document.querySelectorAll('.page');
    pages.forEach((p, i) => p.dataset.pn = i + 1);
    const set = (k, v) => { const e = document.getElementById('stat-' + k); if (e) e.textContent = v; };
    const lists = document.getElementById('stat-lists');
    if (pages.length > 0 && pages[0].contentEditable === "false") {
        ['pages', 'chars', 'scenes', 'objs', 'music'].forEach(k => set(k, 0));
        if (lists) lists.innerHTML = '';
        return;
    }
    const blocks = [...pagesContainer.querySelectorAll('.page > div')].filter(b => !/auto(more|cue)/.test(b.className));
    const chars = new Map(), words = new Set(), objs = new Map(), mus = []; let scenes = 0;
    blocks.forEach(b => {
        if (b.className !== 'character') return;
        const n = b.textContent.replace(/\s*\(.*?\)/g, '').trim().toUpperCase();
        if (n) { chars.set(n, (chars.get(n) || 0) + 1); n.split(/\s+/).forEach(w => words.add(w)); }
    });
    blocks.forEach(b => {
        const x = b.textContent.trim(); if (!x) return;
        if (b.className === 'slugline') scenes++;
        else if (b.className === 'action') {
            x.split(/(?<=[.!?])\s+|\n/).forEach(t => { if (MUS.test(t)) mus.push(t.length > 60 ? t.slice(0, 57) + '…' : t); });
            for (const g of x.matchAll(CAP)) {
                const o = g[0];
                if (o.split(/\s+/).some(w => words.has(w)) || MUS.test(o)) continue;
                objs.set(o, (objs.get(o) || 0) + 1);
            }
        }
    });
    set('pages', pages.length); set('chars', chars.size); set('scenes', scenes); set('objs', objs.size); set('music', mus.length);
    const top = m => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
    const sec = (t, rows) => rows.length ? `<h4>${t}</h4>` + rows.map(([a, n]) => `<div class="stat-row"><span>${esc(a)}</span><b>${n}</b></div>`).join('') : '';
    if (lists) lists.innerHTML = sec('Personajes', top(chars)) + sec('Objetos', top(objs).map(([a, n]) => [a, '×' + n])) + sec('Música', mus.map(m => [m, '']));
}
window.updateStats = updateStats;

const observer = new MutationObserver(() => {
    updateStats();
});
observer.observe(pagesContainer, { childList: true, subtree: true, characterData: true });
