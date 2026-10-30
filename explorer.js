/* ==========================================================================
   Fájl-Kaland – explorer.js
   Szimulált Windows 11 Fájlkezelő és virtuális fájlrendszer (VFS) motor.

   HASZNÁLAT A JÁTÉKOKBÓL (games_1.js, games_2.js)
   ----------------------------------------------
   1) Virtuális fájlrendszer létrehozása:
        const vfs = FK.VFS.createDefault();               // alap felhasználói mappák + mintafájlok
        const vfs = FK.VFS.createDefault({ empty: true });// csak az alapmappák, fájlok nélkül
        vfs.build('documents', [                           // saját feladat-környezet felépítése
            { name: 'Suli', children: [ { name: 'matek.docx' }, { name: 'rajz.jpg', content: '🎨' } ] }
        ]);

   2) Fájlkezelő megjelenítése egy elemben (pl. a játék ctx.container-jében):
        const ex = new FK.Explorer(container, {
            vfs,
            startId: 'documents',                       // vagy startPath: 'C:\\Felhasználók\\Diák\\Dokumentumok'
            hooks: {
                onFolderCreated(e) { … },               // e.node, e.path
                onFileRenamed(e) { … },                 // e.node, e.oldName, e.newName
                onFileMoved(e) { … },                   // e.nodes, e.toId, e.toPath, e.method ('drag' | 'paste')
                onFileCopied(e) { … },                  // e.sources, e.copies, e.toId
                onFileDeleted(e) { … },                 // e.nodes, e.permanent
                onFileRestored(e) { … },                // e.nodes
                onShortcutUsed(e) { … },                // e.combo ('Ctrl+C', 'F2', …), e.source ('keyboard' | 'dock')
                onAny(type, e) { … }                    // minden esemény
            },
            disabledActions: ['delete'],                // opcionális: tiltott műveletek
            canPerform(action, nodes) { return true; }  // opcionális: false vagy magyar üzenet = tiltás
        });
        ex.destroy();                                   // a játék végén

   3) Küldetés-ellenőrző (globális): minden Fájlkezelő értesíti az éppen beállított ellenőrzőt.
        FK.setMissionChecker({ onFileMoved(e) { … }, onShortcutUsed(e) { … } });
        FK.clearMissionChecker();

   Események (hook nevek): onFolderCreated, onFileRenamed, onFileMoved, onFileCopied, onFileDeleted,
   onFileRestored, onRecycleBinEmptied, onShortcutUsed, onClipboardChanged, onFileOpened, onNavigate,
   onSelectionChanged, onUndo, onBlocked, onAny. Minden esemény document szintű 'fk:explorer'
   CustomEvent-ként is elérhető (detail.type = esemény neve).
   ========================================================================== */

(function () {
    'use strict';

    const FK = window.FK = window.FK || {};

    // ======================================================================
    // SEGÉDFÜGGVÉNYEK
    // ======================================================================
    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalize(text) {
        return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    const collator = new Intl.Collator('hu', { numeric: true, sensitivity: 'base' });

    function formatSize(bytes) {
        const b = Number(bytes || 0);
        if (b < 1024) return b + ' bájt';
        if (b < 1024 * 1024) return Math.max(1, Math.round(b / 1024)).toLocaleString('hu-HU') + ' KB';
        if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toLocaleString('hu-HU', { maximumFractionDigits: 1 }) + ' MB';
        return (b / (1024 * 1024 * 1024)).toLocaleString('hu-HU', { maximumFractionDigits: 1 }) + ' GB';
    }

    function formatDate(ts) {
        if (!ts) return '–';
        const d = new Date(ts);
        return d.toLocaleDateString('hu-HU') + ' ' + d.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
    }

    function hashString(text) {
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return Math.abs(h);
    }

    function isCoarsePointer() {
        return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    }

    function notify(message, type = 'info', useBiti = false) {
        if (typeof FK.toast === 'function') {
            FK.toast(message, type);
        }
        if (useBiti && FK.Biti && typeof FK.Biti.say === 'function') {
            FK.Biti.say(message, { mood: type === 'error' ? 'think' : 'happy' });
        }
    }

    // ======================================================================
    // FÁJLTÍPUSOK ÉS IKONOK
    // ======================================================================
    const FILE_TYPES = {
        '.txt':  { label: 'Szöveges dokumentum',   color: '#64748b', kind: 'text',   base: 2400 },
        '.jpg':  { label: 'JPG-kép',               color: '#16a34a', kind: 'image',  base: 2400000 },
        '.png':  { label: 'PNG-kép',               color: '#0d9488', kind: 'image',  base: 900000 },
        '.mp3':  { label: 'MP3 hangfájl',          color: '#9333ea', kind: 'audio',  base: 4200000 },
        '.docx': { label: 'Word-dokumentum',       color: '#2563eb', kind: 'doc',    base: 38000, letter: 'W' },
        '.pptx': { label: 'PowerPoint-bemutató',   color: '#ea580c', kind: 'slides', base: 2600000, letter: 'P' },
        '.xlsx': { label: 'Excel-munkafüzet',      color: '#15803d', kind: 'sheet',  base: 24000, letter: 'X' },
        '.exe':  { label: 'Alkalmazás',            color: '#475569', kind: 'app',    base: 18000000 },
        '.pdf':  { label: 'PDF-dokumentum',        color: '#dc2626', kind: 'pdf',    base: 640000, letter: 'PDF' },
        '.zip':  { label: 'Tömörített (zip) mappa', color: '#ca8a04', kind: 'zip',    base: 5200000 },
        '.mp4':  { label: 'MP4-videó',             color: '#db2777', kind: 'video',  base: 48000000 }
    };

    function fileType(ext) {
        return FILE_TYPES[String(ext || '').toLowerCase()] ||
            { label: (ext ? ext.replace('.', '').toUpperCase() + '-fájl' : 'Fájl'), color: '#94a3b8', kind: 'generic', base: 12000 };
    }

    /** Színes SVG fájlikon a kiterjesztés alapján. */
    function fileIcon(ext, size = 48) {
        const t = fileType(ext);
        const w = Math.round(size * 48 / 56);
        const c = t.color;
        let inner = '';
        switch (t.kind) {
            case 'text':
                inner = '<rect x="10" y="20" width="24" height="3" rx="1.5" fill="#94a3b8"/>' +
                        '<rect x="10" y="27" width="28" height="3" rx="1.5" fill="#94a3b8"/>' +
                        '<rect x="10" y="34" width="20" height="3" rx="1.5" fill="#94a3b8"/>' +
                        '<rect x="10" y="41" width="26" height="3" rx="1.5" fill="#94a3b8"/>';
                break;
            case 'image':
                inner = '<rect x="8" y="18" width="32" height="26" rx="3" fill="' + c + '" opacity=".15"/>' +
                        '<circle cx="31" cy="25" r="4" fill="#facc15"/>' +
                        '<path d="M8 42l10-12 7 8 5-5 10 9v2H8z" fill="' + c + '"/>';
                break;
            case 'audio':
                inner = '<circle cx="24" cy="33" r="13" fill="' + c + '"/>' +
                        '<path d="M21 26v11.5a3.5 3.5 0 1 1-2-3.2V24l10-2v12.5a3.5 3.5 0 1 1-2-3.2V25z" fill="#fff"/>';
                break;
            case 'doc':
            case 'slides':
            case 'sheet':
            case 'pdf': {
                const fs = t.letter.length > 1 ? 8 : 13;
                inner = '<rect x="24" y="22" width="16" height="3" rx="1.5" fill="#cbd5e1"/>' +
                        '<rect x="24" y="29" width="16" height="3" rx="1.5" fill="#cbd5e1"/>' +
                        '<rect x="24" y="36" width="16" height="3" rx="1.5" fill="#cbd5e1"/>' +
                        '<rect x="4" y="24" width="22" height="20" rx="3" fill="' + c + '"/>' +
                        '<text x="15" y="' + (t.letter.length > 1 ? 37 : 39) + '" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="800" font-size="' + fs + '" fill="#fff">' + t.letter + '</text>';
                break;
            }
            case 'app':
                inner = '<rect x="9" y="19" width="30" height="24" rx="3" fill="' + c + '"/>' +
                        '<rect x="9" y="19" width="30" height="6" rx="3" fill="#1e293b"/>' +
                        '<circle cx="13" cy="22" r="1.3" fill="#f87171"/><circle cx="17" cy="22" r="1.3" fill="#fbbf24"/><circle cx="21" cy="22" r="1.3" fill="#4ade80"/>' +
                        '<path d="M24 29l1.6 3.2 3.4.5-2.5 2.4.6 3.4-3.1-1.6-3.1 1.6.6-3.4-2.5-2.4 3.4-.5z" fill="#facc15"/>';
                break;
            case 'zip':
                inner = '<rect x="20" y="4" width="8" height="40" fill="' + c + '" opacity=".25"/>' +
                        '<rect x="20" y="8" width="4" height="4" fill="' + c + '"/><rect x="24" y="12" width="4" height="4" fill="' + c + '"/>' +
                        '<rect x="20" y="16" width="4" height="4" fill="' + c + '"/><rect x="24" y="20" width="4" height="4" fill="' + c + '"/>' +
                        '<rect x="19" y="28" width="10" height="12" rx="2" fill="' + c + '"/><rect x="22" y="33" width="4" height="4" rx="1" fill="#fff"/>';
                break;
            case 'video':
                inner = '<rect x="8" y="20" width="32" height="24" rx="4" fill="' + c + '"/>' +
                        '<path d="M21 26v12l10-6z" fill="#fff"/>';
                break;
            default:
                inner = '<text x="24" y="38" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="800" font-size="10" fill="' + c + '">' +
                        escapeHtml(String(ext || '?').replace('.', '').toUpperCase().slice(0, 4)) + '</text>';
        }
        return '<svg class="fkx-svg" viewBox="0 0 48 56" width="' + w + '" height="' + size + '" aria-hidden="true" focusable="false">' +
            '<path d="M6 2h26l12 12v38a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#fff" stroke="#cbd5e1" stroke-width="1.5"/>' +
            '<path d="M32 2v10a2 2 0 0 0 2 2h10" fill="#e2e8f0" stroke="#cbd5e1" stroke-width="1.5"/>' +
            inner +
        '</svg>';
    }

    function folderSvg(size) {
        if (typeof FK.folderIcon === 'function') return FK.folderIcon(null, size);
        const h = Math.round(size * 52 / 64);
        return '<svg class="fkx-svg" viewBox="0 0 64 52" width="' + size + '" height="' + h + '" aria-hidden="true">' +
            '<path d="M4 8a4 4 0 0 1 4-4h16l6 6h26a4 4 0 0 1 4 4v4H4z" fill="#d97706"/>' +
            '<path d="M2 18a4 4 0 0 1 4-4h52a4 4 0 0 1 4 4v26a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" fill="#fbbf24"/>' +
        '</svg>';
    }

    function driveSvg(size) {
        const h = Math.round(size * 0.75);
        return '<svg class="fkx-svg" viewBox="0 0 64 48" width="' + size + '" height="' + h + '" aria-hidden="true">' +
            '<rect x="4" y="14" width="56" height="24" rx="5" fill="#cbd5e1" stroke="#64748b" stroke-width="2"/>' +
            '<rect x="10" y="22" width="30" height="4" rx="2" fill="#64748b"/>' +
            '<circle cx="50" cy="26" r="3" fill="#22c55e"/>' +
        '</svg>';
    }

    function nodeIcon(node, size) {
        if (!node) return '';
        if (node.id === 'root') return driveSvg(size);
        if (node.type === 'folder') {
            const badge = node.badge ? '<span class="fkx-folder-badge" aria-hidden="true">' + node.badge + '</span>' : '';
            return '<span class="fkx-folder-wrap">' + folderSvg(size) + badge + '</span>';
        }
        return fileIcon(node.ext, size);
    }

    // ======================================================================
    // VIRTUÁLIS FÁJLRENDSZER (VFS)
    // ======================================================================
    class VFSError extends Error {
        constructor(message) {
            super(message);
            this.name = 'VFSError';
        }
    }

    const INVALID_CHARS = /[\\/:*?"<>|]/;
    const RECYCLE_ID = 'recycle';

    class VFS {
        constructor() {
            this.nodes = new Map();
            this.seq = 0;
            this.clipboard = { mode: null, ids: [] };
            this.listeners = {};
            this.undoStack = [];
            this.maxUndo = 30;
        }

        // ---------------- Létrehozás ----------------

        /** Alap fájlrendszer: C:\Felhasználók\Diák\{Asztal, Dokumentumok, Képek, Zenék, Letöltések} + mintafájlok. */
        static createDefault(options = {}) {
            const vfs = new VFS();
            const userName = options.userName || 'Diák';
            vfs._addNode({ id: 'root', name: 'C:', type: 'folder', parentId: null, locked: true });
            const sample = !options.empty;
            vfs.build('root', [
                { id: 'users', name: 'Felhasználók', locked: true, children: [
                    { id: 'user', name: userName, locked: true, badge: '👤', children: [
                        { id: 'desktop', name: 'Asztal', locked: true, badge: '🖥️', children: sample ? [
                            { name: 'Bevásárlólista.txt', content: 'Tej\nKenyér\nAlma\nCsoki 🍫' },
                            { name: 'Órarend.docx', content: 'Hétfő: matek, magyar, testnevelés\nKedd: angol, környezet, rajz\nSzerda: matek, ének, informatika' }
                        ] : [] },
                        { id: 'documents', name: 'Dokumentumok', locked: true, badge: '📄', children: sample ? [
                            { name: 'Suli', children: [
                                { name: 'Matek', children: [ { name: 'Szorzótábla.xlsx', content: '1×1=1, 2×2=4, 3×3=9 …' } ] },
                                { name: 'Magyar', children: [ { name: 'Fogalmazás.docx', content: 'Az én nyaram\n\nIdén nyáron a Balatonnál voltunk…' } ] },
                                { name: 'Környezet', children: [] }
                            ] },
                            { name: 'Házi feladat.docx', content: 'Matek: 34. oldal 2. és 3. feladat\nMagyar: olvasónapló' },
                            { name: 'Olvasónapló.txt', content: 'Könyv: A Pál utcai fiúk\nÍró: Molnár Ferenc' }
                        ] : [] },
                        { id: 'pictures', name: 'Képek', locked: true, badge: '🖼️', children: sample ? [
                            { name: 'Nyaralás.jpg', content: '🏖️' },
                            { name: 'Cica.jpg', content: '🐱' },
                            { name: 'Rajzom.png', content: '🎨' }
                        ] : [] },
                        { id: 'music', name: 'Zenék', locked: true, badge: '🎵', children: sample ? [
                            { name: 'Kedvenc dal.mp3', content: 'Kedvenc dal – 3:12' },
                            { name: 'Iskolacsengő.mp3', content: 'Iskolacsengő – 0:05' }
                        ] : [] },
                        { id: 'downloads', name: 'Letöltések', locked: true, badge: '⬇️', children: sample ? [
                            { name: 'Jatek_telepito.exe' },
                            { name: 'A Naprendszer.pptx', content: '1. dia: A Naprendszer\n2. dia: A Nap\n3. dia: A bolygók' },
                            { name: 'Kirándulás képek.zip' }
                        ] : [] }
                    ] }
                ] },
                { id: 'programs', name: 'Program Files', locked: true, children: [
                    { name: 'Paint', locked: true, children: [ { name: 'paint.exe', locked: true } ] },
                    { name: 'Jegyzettömb', locked: true, children: [ { name: 'notepad.exe', locked: true } ] }
                ] }
            ]);
            vfs.undoStack = [];
            return vfs;
        }

        /** Üres fájlrendszer egyetlen C: meghajtóval, saját feladatokhoz. */
        static createEmpty() {
            const vfs = new VFS();
            vfs._addNode({ id: 'root', name: 'C:', type: 'folder', parentId: null, locked: true });
            return vfs;
        }

        static fromJSON(data) {
            const vfs = new VFS();
            vfs._restoreState(typeof data === 'string' ? JSON.parse(data) : data);
            return vfs;
        }

        toJSON() {
            return { seq: this.seq, nodes: Array.from(this.nodes.values()).map(n => Object.assign({}, n)) };
        }

        _restoreState(state) {
            this.nodes = new Map();
            (state.nodes || []).forEach(n => this.nodes.set(n.id, Object.assign({}, n)));
            this.seq = state.seq || this.nodes.size;
            if (!this.nodes.has('root')) {
                this._addNode({ id: 'root', name: 'C:', type: 'folder', parentId: null, locked: true });
            }
        }

        _newId() {
            this.seq++;
            return 'n' + this.seq + '_' + Math.random().toString(36).slice(2, 6);
        }

        _addNode(data) {
            const now = Date.now();
            const node = {
                id: data.id || this._newId(),
                name: data.name,
                type: data.type === 'folder' ? 'folder' : 'file',
                ext: data.type === 'folder' ? '' : String(data.ext || '').toLowerCase(),
                size: 0,
                content: data.content ?? '',
                parentId: data.parentId ?? null,
                isDeleted: false,
                deletedAt: null,
                locked: !!data.locked,
                badge: data.badge || null,
                created: data.created || now,
                modified: data.modified || now
            };
            if (node.type === 'file') {
                node.size = Number.isFinite(data.size) ? data.size : this._defaultSize(node);
            }
            this.nodes.set(node.id, node);
            return node;
        }

        _defaultSize(node) {
            const t = fileType(node.ext);
            if (t.kind === 'text' && node.content) return Math.max(64, new Blob([String(node.content)]).size);
            const variance = (hashString(node.name + node.ext) % 1000) / 1000; // 0–1
            return Math.round(t.base * (0.6 + variance * 0.9));
        }

        /**
         * Részfa felépítése leírásból. A fájlok nevében a kiterjesztés is szerepel ("rajz.jpg").
         * spec elem: { name, id?, children?: [...], type?: 'folder', content?, size?, locked?, badge? }
         * Mappa: ha van children, vagy type: 'folder', vagy nincs kiterjesztés a nevében.
         */
        build(parentId, specList) {
            const created = [];
            (specList || []).forEach(spec => {
                const isFolder = spec.type === 'folder' || Array.isArray(spec.children) ||
                    (spec.type !== 'file' && !/\.[a-z0-9]{1,5}$/i.test(spec.name));
                let node;
                if (isFolder) {
                    node = this._addNode({ id: spec.id, name: spec.name, type: 'folder', parentId, locked: spec.locked, badge: spec.badge });
                    if (spec.children) this.build(node.id, spec.children);
                } else {
                    const parts = VFS.splitName(spec.name);
                    node = this._addNode({
                        id: spec.id, name: parts.name, ext: spec.ext || parts.ext, type: 'file', parentId,
                        content: spec.content, size: spec.size, locked: spec.locked
                    });
                }
                created.push(node);
            });
            this.emit('change', { type: 'build' });
            return created;
        }

        // ---------------- Lekérdezések ----------------

        get(id) {
            return this.nodes.get(id) || null;
        }

        static splitName(full) {
            const text = String(full || '');
            const idx = text.lastIndexOf('.');
            if (idx > 0 && idx < text.length - 1 && /^[a-z0-9]{1,5}$/i.test(text.slice(idx + 1))) {
                return { name: text.slice(0, idx), ext: text.slice(idx).toLowerCase() };
            }
            return { name: text, ext: '' };
        }

        displayName(nodeOrId) {
            const node = typeof nodeOrId === 'string' ? this.get(nodeOrId) : nodeOrId;
            if (!node) return '';
            return node.type === 'folder' ? node.name : node.name + node.ext;
        }

        /** Élő (nem törölt) gyermekek: előbb a mappák, aztán a fájlok, ábécérendben. */
        children(parentId, options = {}) {
            const list = [];
            this.nodes.forEach(n => {
                if (n.parentId === parentId && (options.includeDeleted || !n.isDeleted)) list.push(n);
            });
            return list.sort((a, b) => {
                if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
                return collator.compare(this.displayName(a), this.displayName(b));
            });
        }

        subfolders(parentId) {
            return this.children(parentId).filter(n => n.type === 'folder');
        }

        /** Igaz, ha az elem vagy valamelyik szülője a Lomtárban van. */
        isInRecycleBin(id) {
            let n = this.get(id);
            while (n) {
                if (n.isDeleted) return true;
                n = this.get(n.parentId);
            }
            return false;
        }

        exists(id) {
            return !!this.get(id) && !this.isInRecycleBin(id);
        }

        /** Igaz, ha ancestorId az id (közvetett) szülője, vagy maga az id. */
        isAncestor(ancestorId, id) {
            let n = this.get(id);
            while (n) {
                if (n.id === ancestorId) return true;
                n = this.get(n.parentId);
            }
            return false;
        }

        /** Elérési út: C:\Felhasználók\Diák\Suli */
        getPath(id) {
            if (id === RECYCLE_ID) return 'Lomtár';
            const parts = [];
            let n = this.get(id);
            while (n) {
                parts.unshift(this.displayName(n));
                n = this.get(n.parentId);
            }
            if (parts.length === 1) return parts[0] + '\\';
            return parts.join('\\');
        }

        /** Az útvonal elemei (gyökértől az adott elemig). */
        getAncestors(id) {
            const list = [];
            let n = this.get(id);
            while (n) {
                list.unshift(n);
                n = this.get(n.parentId);
            }
            return list;
        }

        /** Elem keresése elérési út alapján (kis- és nagybetű, ékezet nem számít). */
        findByPath(path) {
            const clean = String(path || '').trim().replace(/\//g, '\\').replace(/\\+$/, '');
            if (!clean) return null;
            if (normalize(clean) === 'lomtar') return { id: RECYCLE_ID };
            const parts = clean.split('\\').filter(Boolean);
            let current = this.get('root');
            if (!current || normalize(parts[0]) !== normalize(current.name)) return null;
            for (let i = 1; i < parts.length; i++) {
                const next = this.children(current.id).find(c => normalize(this.displayName(c)) === normalize(parts[i]));
                if (!next) return null;
                current = next;
            }
            return current;
        }

        /** Első találat név szerint (opcionálisan egy mappán belül, rekurzívan). */
        findByName(name, rootId = 'root') {
            const target = normalize(name);
            const stack = [rootId];
            while (stack.length) {
                const id = stack.shift();
                for (const c of this.children(id)) {
                    if (normalize(this.displayName(c)) === target) return c;
                    if (c.type === 'folder') stack.push(c.id);
                }
            }
            return null;
        }

        /** Keresés részlet alapján egy mappán belül, rekurzívan. */
        search(rootId, query) {
            const q = normalize(query);
            const results = [];
            if (!q) return results;
            const stack = [rootId];
            while (stack.length) {
                const id = stack.shift();
                this.children(id).forEach(c => {
                    if (normalize(this.displayName(c)).includes(q)) results.push(c);
                    if (c.type === 'folder') stack.push(c.id);
                });
            }
            return results;
        }

        /** A Lomtár tartalma (csak a közvetlenül törölt elemek). */
        recycleBinItems() {
            const list = [];
            this.nodes.forEach(n => {
                if (n.isDeleted) list.push(n);
            });
            return list.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
        }

        /** Mappa statisztika: fájlok, mappák száma és összméret. */
        stats(id) {
            const node = this.get(id);
            if (!node) return { files: 0, folders: 0, size: 0 };
            if (node.type === 'file') return { files: 1, folders: 0, size: node.size };
            let files = 0, folders = 0, size = 0;
            const stack = [id];
            while (stack.length) {
                const cur = stack.pop();
                this.children(cur).forEach(c => {
                    if (c.type === 'folder') {
                        folders++;
                        stack.push(c.id);
                    } else {
                        files++;
                        size += c.size;
                    }
                });
            }
            return { files, folders, size };
        }

        // ---------------- Ellenőrzések ----------------

        validateName(fullName) {
            const name = String(fullName || '');
            if (!name.trim()) return 'A név nem lehet üres!';
            if (INVALID_CHARS.test(name)) return 'A név nem tartalmazhatja ezeket a jeleket: \\ / : * ? " < > |';
            if (/[. ]$/.test(name)) return 'A név nem végződhet ponttal vagy szóközzel!';
            if (name.length > 60) return 'Ez a név túl hosszú (legfeljebb 60 karakter)!';
            if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name.trim())) return 'Ezt a nevet a Windows foglalja le, válassz másikat!';
            return null;
        }

        nameTaken(parentId, fullName, exceptId = null) {
            const target = normalize(fullName);
            return this.children(parentId).some(c => c.id !== exceptId && normalize(this.displayName(c)) === target);
        }

        /** Szabad név: "Új mappa", "Új mappa (2)", … */
        uniqueName(parentId, baseName, ext = '') {
            let candidate = baseName;
            let i = 2;
            while (this.nameTaken(parentId, candidate + ext)) {
                candidate = baseName + ' (' + i + ')';
                i++;
            }
            return candidate;
        }

        _assertFolder(id) {
            const node = this.get(id);
            if (!node || node.type !== 'folder') throw new VFSError('A célmappa nem található!');
            if (this.isInRecycleBin(id)) throw new VFSError('A Lomtárban lévő mappába nem lehet menteni!');
            return node;
        }

        _assertUnlocked(node, action) {
            if (node.locked) {
                throw new VFSError('A(z) „' + this.displayName(node) + '” egy rendszermappa vagy védett elem, ezért nem lehet ' + action + '.');
            }
        }

        _touch(id) {
            const n = this.get(id);
            if (n) n.modified = Date.now();
        }

        // ---------------- Visszavonás ----------------

        pushUndo(label) {
            this.undoStack.push({ label, state: JSON.stringify(this.toJSON()) });
            if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
        }

        canUndo() {
            return this.undoStack.length > 0;
        }

        undo() {
            const entry = this.undoStack.pop();
            if (!entry) return null;
            this._restoreState(JSON.parse(entry.state));
            this.clipboard = { mode: null, ids: [] };
            this.emit('change', { type: 'undo' });
            return entry.label;
        }

        // ---------------- Műveletek ----------------

        createFolder(parentId, name) {
            this._assertFolder(parentId);
            const finalName = name == null ? this.uniqueName(parentId, 'Új mappa') : String(name).trim();
            const err = this.validateName(finalName);
            if (err) throw new VFSError(err);
            if (this.nameTaken(parentId, finalName)) throw new VFSError('Ebben a mappában már van „' + finalName + '” nevű elem!');
            const node = this._addNode({ name: finalName, type: 'folder', parentId });
            this._touch(parentId);
            this.emit('change', { type: 'create', ids: [node.id] });
            return node;
        }

        createFile(parentId, fullName, options = {}) {
            this._assertFolder(parentId);
            const name = String(fullName || '').trim();
            const err = this.validateName(name);
            if (err) throw new VFSError(err);
            if (this.nameTaken(parentId, name)) throw new VFSError('Ebben a mappában már van „' + name + '” nevű elem!');
            const parts = VFS.splitName(name);
            const node = this._addNode({ name: parts.name, ext: options.ext || parts.ext, type: 'file', parentId, content: options.content, size: options.size });
            this._touch(parentId);
            this.emit('change', { type: 'create', ids: [node.id] });
            return node;
        }

        /** Átnevezés. Fájlnál a teljes név (kiterjesztéssel) adható meg. */
        rename(id, newFullName) {
            const node = this.get(id);
            if (!node) throw new VFSError('Az elem nem található!');
            this._assertUnlocked(node, 'átnevezni');
            const name = String(newFullName || '').trim();
            const err = this.validateName(name);
            if (err) throw new VFSError(err);
            if (this.nameTaken(node.parentId, name, node.id)) throw new VFSError('Ebben a mappában már van „' + name + '” nevű elem!');
            const oldName = this.displayName(node);
            const oldExt = node.ext;
            if (node.type === 'folder') {
                node.name = name;
            } else {
                const parts = VFS.splitName(name);
                node.name = parts.name;
                node.ext = parts.ext;
            }
            node.modified = Date.now();
            this.emit('change', { type: 'rename', ids: [id] });
            return { node, oldName, newName: this.displayName(node), extChanged: node.type === 'file' && oldExt !== node.ext };
        }

        /** Áthelyezés (kivágás + beillesztés vagy húzás). Ütközésnél automatikusan új nevet ad. */
        move(ids, targetId) {
            const target = this._assertFolder(targetId);
            const moved = [];
            ids.map(id => this.get(id)).filter(Boolean).forEach(node => {
                this._assertUnlocked(node, 'áthelyezni');
                if (node.id === target.id || (node.type === 'folder' && this.isAncestor(node.id, target.id))) {
                    throw new VFSError('A(z) „' + this.displayName(node) + '” mappát nem teheted saját magába!');
                }
                if (node.parentId === target.id) return;
                const fromId = node.parentId;
                if (this.nameTaken(target.id, this.displayName(node), node.id)) {
                    node.name = this.uniqueName(target.id, node.name, node.ext);
                }
                node.parentId = target.id;
                node.modified = Date.now();
                this._touch(fromId);
                moved.push({ node, fromId });
            });
            this._touch(target.id);
            if (moved.length) this.emit('change', { type: 'move', ids: moved.map(m => m.node.id) });
            return moved;
        }

        /** Másolat készítése (mappáknál a teljes tartalommal). */
        copyTo(ids, targetId) {
            const target = this._assertFolder(targetId);
            const copies = [];
            ids.map(id => this.get(id)).filter(Boolean).forEach(node => {
                if (node.type === 'folder' && this.isAncestor(node.id, target.id)) {
                    throw new VFSError('A(z) „' + this.displayName(node) + '” mappát nem másolhatod saját magába!');
                }
                let name = node.name;
                if (this.nameTaken(target.id, this.displayName(node))) {
                    name = this.uniqueName(target.id, node.name + ' - Másolat', node.ext);
                }
                copies.push(this._cloneTree(node, target.id, name));
            });
            this._touch(target.id);
            if (copies.length) this.emit('change', { type: 'copy', ids: copies.map(c => c.id) });
            return copies;
        }

        _cloneTree(node, parentId, newName) {
            const copy = this._addNode({
                name: newName || node.name, type: node.type, ext: node.ext, parentId,
                content: node.content, size: node.size, badge: null, locked: false
            });
            if (node.type === 'folder') {
                this.children(node.id).forEach(child => this._cloneTree(child, copy.id));
            }
            return copy;
        }

        setClipboard(mode, ids) {
            const valid = ids.filter(id => this.get(id));
            if (mode === 'cut') {
                valid.forEach(id => this._assertUnlocked(this.get(id), 'kivágni'));
            }
            this.clipboard = { mode: valid.length ? mode : null, ids: valid };
            this.emit('change', { type: 'clipboard' });
            return this.clipboard;
        }

        copy(ids) {
            return this.setClipboard('copy', ids);
        }

        cut(ids) {
            return this.setClipboard('cut', ids);
        }

        clearClipboard() {
            this.clipboard = { mode: null, ids: [] };
            this.emit('change', { type: 'clipboard' });
        }

        /** Beillesztés a vágólapról. Visszatér: { mode, nodes, moved? } */
        paste(targetId) {
            const clip = this.clipboard;
            const ids = clip.ids.filter(id => this.exists(id));
            if (!clip.mode || !ids.length) throw new VFSError('A vágólap üres. Előbb másolj vagy vágj ki valamit!');
            if (clip.mode === 'cut') {
                const moved = this.move(ids, targetId);
                this.clipboard = { mode: null, ids: [] };
                this.emit('change', { type: 'clipboard' });
                return { mode: 'cut', nodes: moved.map(m => m.node), moved };
            }
            const copies = this.copyTo(ids, targetId);
            return { mode: 'copy', nodes: copies, sources: ids.map(id => this.get(id)) };
        }

        /** Törlés a Lomtárba. */
        delete(ids) {
            const deleted = [];
            ids.map(id => this.get(id)).filter(Boolean).forEach(node => {
                this._assertUnlocked(node, 'törölni');
                if (node.isDeleted) return;
                node.isDeleted = true;
                node.deletedAt = Date.now();
                node.deletedFrom = this.getPath(node.parentId);
                deleted.push(node);
            });
            this.clipboard.ids = this.clipboard.ids.filter(id => !this.isInRecycleBin(id));
            if (deleted.length) this.emit('change', { type: 'delete', ids: deleted.map(n => n.id) });
            return deleted;
        }

        /** Végleges törlés (a teljes részfával együtt). */
        deletePermanently(ids) {
            const removed = [];
            ids.map(id => this.get(id)).filter(Boolean).forEach(node => {
                this._assertUnlocked(node, 'törölni');
                const stack = [node.id];
                const all = [];
                while (stack.length) {
                    const cur = stack.pop();
                    all.push(cur);
                    this.nodes.forEach(n => { if (n.parentId === cur) stack.push(n.id); });
                }
                all.forEach(id => this.nodes.delete(id));
                removed.push(node);
            });
            this.clipboard.ids = this.clipboard.ids.filter(id => this.nodes.has(id));
            if (removed.length) this.emit('change', { type: 'delete-permanent', ids: removed.map(n => n.id) });
            return removed;
        }

        /** Visszaállítás a Lomtárból az eredeti helyére (ha az már nem létezik, a felhasználói mappába). */
        restore(ids) {
            const restored = [];
            ids.map(id => this.get(id)).filter(n => n && n.isDeleted).forEach(node => {
                if (!this.exists(node.parentId)) {
                    node.parentId = this.get('user') ? 'user' : 'root';
                }
                if (this.nameTaken(node.parentId, this.displayName(node), node.id)) {
                    node.name = this.uniqueName(node.parentId, node.name, node.ext);
                }
                node.isDeleted = false;
                node.deletedAt = null;
                delete node.deletedFrom;
                restored.push(node);
            });
            if (restored.length) this.emit('change', { type: 'restore', ids: restored.map(n => n.id) });
            return restored;
        }

        emptyRecycleBin() {
            const items = this.recycleBinItems();
            return this.deletePermanently(items.map(n => n.id));
        }

        // ---------------- Események ----------------

        on(event, cb) {
            (this.listeners[event] = this.listeners[event] || []).push(cb);
        }

        off(event, cb) {
            this.listeners[event] = (this.listeners[event] || []).filter(f => f !== cb);
        }

        emit(event, data) {
            (this.listeners[event] || []).slice().forEach(cb => {
                try { cb(data); } catch (e) { console.error(e); }
            });
        }
    }

    VFS.RECYCLE_ID = RECYCLE_ID;
    VFS.Error = VFSError;
    FK.VFS = VFS;
    FK.fileIcon = fileIcon;
    FK.fileType = fileType;
    FK.FILE_TYPES = FILE_TYPES;

    // ======================================================================
    // KÜLDETÉS-ELLENŐRZŐ (globális)
    // ======================================================================
    FK.missionChecker = FK.missionChecker || null;
    FK.setMissionChecker = function (checker) {
        FK.missionChecker = checker || null;
    };
    FK.clearMissionChecker = function () {
        FK.missionChecker = null;
    };

    // ======================================================================
    // STÍLUSOK (a modul magával hozza őket)
    // ======================================================================
    const STYLES = `
.fkx {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 320px;
    background: #f8fafc;
    color: #1e293b;
    font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;
    user-select: none;
    -webkit-user-select: none;
    outline: none;
    overflow: hidden;
}
.fkx button { font: inherit; color: inherit; border: 0; background: transparent; cursor: pointer; }
.fkx button:disabled { opacity: .4; cursor: not-allowed; }
.fkx-top {
    display: flex; align-items: center; gap: .4rem;
    padding: .45rem .6rem; background: #eef2f7; border-bottom: 1px solid #e2e8f0;
}
.fkx-navbtn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 38px; height: 38px; border-radius: .6rem; font-size: 1.1rem; font-weight: 800; flex-shrink: 0;
}
.fkx-navbtn:hover:not(:disabled) { background: rgba(15, 23, 42, .08); }
.fkx-address {
    flex: 1; min-width: 0; height: 38px; display: flex; align-items: center;
    background: #fff; border: 1px solid #cbd5e1; border-radius: .6rem; padding: 0 .3rem; overflow: hidden; cursor: text;
}
.fkx-crumbs { display: flex; align-items: center; min-width: 0; overflow-x: auto; scrollbar-width: none; white-space: nowrap; }
.fkx-crumbs::-webkit-scrollbar { display: none; }
.fkx-crumb {
    display: inline-flex; align-items: center; gap: .25rem; padding: .25rem .45rem;
    border-radius: .4rem; font-weight: 700; font-size: .9rem; white-space: nowrap;
}
.fkx-crumb:hover { background: #e0f2fe; }
.fkx-crumb-sep { color: #94a3b8; font-size: .8rem; padding: 0 .05rem; }
.fkx-address-input {
    width: 100%; height: 100%; border: 0; outline: none; font: inherit; font-weight: 700; font-size: .9rem; padding: 0 .35rem;
    user-select: text; -webkit-user-select: text;
}
.fkx-search {
    position: relative; width: 210px; flex-shrink: 1; min-width: 110px;
}
.fkx-search input {
    width: 100%; height: 38px; border: 1px solid #cbd5e1; border-radius: .6rem; padding: 0 .6rem 0 2rem;
    font: inherit; font-size: .9rem; font-weight: 600; background: #fff; outline: none; user-select: text; -webkit-user-select: text;
}
.fkx-search input:focus, .fkx-address-input:focus { box-shadow: 0 0 0 3px rgba(59, 130, 246, .3); }
.fkx-search::before { content: '🔍'; position: absolute; left: .55rem; top: 50%; transform: translateY(-50%); font-size: .85rem; }
.fkx-toolbar {
    display: flex; align-items: center; gap: .2rem; flex-wrap: wrap;
    padding: .35rem .5rem; background: #fff; border-bottom: 1px solid #e2e8f0;
}
.fkx-tool {
    display: inline-flex; align-items: center; gap: .35rem; min-height: 40px; padding: .35rem .65rem;
    border-radius: .6rem; font-weight: 700; font-size: .88rem; white-space: nowrap;
}
.fkx-tool:hover:not(:disabled) { background: #f1f5f9; }
.fkx-tool.is-on { background: #dbeafe; color: #1d4ed8; }
.fkx-tool-icon { font-size: 1.15rem; line-height: 1; }
.fkx-tool-sep { width: 1px; align-self: stretch; margin: .25rem .2rem; background: #e2e8f0; }
.fkx-tool-spacer { flex: 1; }
.fkx-main { position: relative; flex: 1; min-height: 0; display: flex; }
.fkx-side {
    width: 220px; flex-shrink: 0; overflow-y: auto; padding: .5rem .35rem; background: #f8fafc; border-right: 1px solid #e2e8f0;
}
.fkx-side-title { padding: .5rem .55rem .25rem; font-size: .72rem; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
.fkx-side-item {
    display: flex; align-items: center; gap: .45rem; width: 100%; min-height: 36px; padding: .3rem .55rem;
    border-radius: .55rem; font-weight: 700; font-size: .9rem; text-align: left;
}
.fkx-side-item:hover { background: #e2e8f0; }
.fkx-side-item.is-current { background: #dbeafe; color: #1d4ed8; }
.fkx-side-emoji { width: 1.4rem; text-align: center; font-size: 1.05rem; }
.fkx-tree-row { display: flex; align-items: center; }
.fkx-tree-toggle {
    width: 26px; height: 32px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
    font-size: .75rem; color: #64748b; border-radius: .4rem;
}
.fkx-tree-toggle:hover { background: #e2e8f0; }
.fkx-tree-row .fkx-side-item { padding-left: .25rem; min-height: 32px; font-size: .86rem; }
.fkx-tree-row .fkx-svg { flex-shrink: 0; }
.fkx-content-wrap { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; }
.fkx-content {
    flex: 1; min-height: 0; overflow: auto; padding: .75rem; background: #fff; touch-action: pan-y;
}
.fkx-view-icons .fkx-items { display: grid; grid-template-columns: repeat(auto-fill, minmax(108px, 1fr)); gap: .35rem; align-content: start; }
.fkx-item {
    position: relative; display: flex; flex-direction: column; align-items: center; gap: .3rem;
    padding: .55rem .3rem .45rem; border-radius: .7rem; border: 2px solid transparent; touch-action: none; cursor: default;
}
.fkx-item:hover { background: #f1f5f9; }
.fkx-item.is-selected { background: #dbeafe; border-color: #93c5fd; }
.fkx-item.is-cut { opacity: .45; }
.fkx-item.is-drop-target { background: #dcfce7 !important; border-color: #22c55e !important; box-shadow: 0 0 0 4px rgba(34, 197, 94, .25); }
.fkx-item.is-dragging { opacity: .35; }
.fkx-item.is-flash { animation: fkx-flash 1s ease-in-out 3; }
@keyframes fkx-flash { 0%, 100% { box-shadow: 0 0 0 0 rgba(250, 204, 21, 0); } 50% { box-shadow: 0 0 0 6px rgba(250, 204, 21, .8); background: #fef9c3; } }
.fkx-item-icon { height: 58px; display: flex; align-items: center; justify-content: center; }
.fkx-item-name {
    max-width: 100%; font-size: .85rem; font-weight: 700; line-height: 1.2; text-align: center; word-break: break-word;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.fkx-item-sub { max-width: 100%; font-size: .7rem; font-weight: 600; color: #64748b; text-align: center; overflow-wrap: anywhere; }
.fkx-item-more {
    position: absolute; top: 2px; right: 2px; width: 30px; height: 30px; border-radius: 50%;
    display: none; align-items: center; justify-content: center; font-size: 1.1rem; font-weight: 900;
    background: #fff !important; box-shadow: 0 1px 4px rgba(15, 23, 42, .25); color: #1d4ed8 !important;
}
.fkx-item.is-selected .fkx-item-more { display: inline-flex; }
.fkx-item-more:hover { background: #eff6ff !important; }
.fkx-view-details .fkx-items { display: flex; flex-direction: column; }
.fkx-view-details .fkx-item { flex-direction: row; gap: .6rem; padding: .3rem .5rem; border-radius: .5rem; }
.fkx-view-details .fkx-item-icon { height: 30px; width: 34px; flex-shrink: 0; }
.fkx-view-details .fkx-item-name { flex: 1; text-align: left; -webkit-line-clamp: 1; }
.fkx-view-details .fkx-item-sub { width: 9rem; text-align: left; flex-shrink: 0; }
.fkx-view-details .fkx-item-more { position: static; flex-shrink: 0; }
.fkx-details-head {
    display: flex; gap: .6rem; padding: .2rem .5rem .4rem 3.1rem; font-size: .72rem; font-weight: 800; color: #64748b;
    text-transform: uppercase; border-bottom: 1px solid #e2e8f0; margin-bottom: .3rem;
}
.fkx-details-head span:first-child { flex: 1; }
.fkx-details-head span:not(:first-child) { width: 9rem; flex-shrink: 0; }
.fkx-empty { padding: 3rem 1rem; text-align: center; font-weight: 800; color: #94a3b8; }
.fkx-empty-icon { font-size: 3rem; display: block; margin-bottom: .5rem; }
.fkx-status {
    display: flex; align-items: center; gap: 1rem; padding: .3rem .8rem; font-size: .78rem; font-weight: 700; color: #475569;
    background: #f1f5f9; border-top: 1px solid #e2e8f0; white-space: nowrap; overflow: hidden;
}
.fkx-status-clip { margin-left: auto; color: #1d4ed8; overflow: hidden; text-overflow: ellipsis; }
.fkx-folder-wrap { position: relative; display: inline-flex; }
.fkx-folder-badge {
    position: absolute; right: -4px; bottom: -3px; width: 22px; height: 22px; border-radius: 50%;
    background: #fff; display: flex; align-items: center; justify-content: center; font-size: .75rem;
    box-shadow: 0 1px 4px rgba(15, 23, 42, .3);
}
.fkx-view-details .fkx-folder-badge, .fkx-side .fkx-folder-badge { display: none; }
.fkx-rename {
    width: 100%; max-width: 160px; padding: .15rem .3rem; border: 2px solid #3b82f6; border-radius: .35rem;
    font: inherit; font-size: .85rem; font-weight: 700; text-align: center; outline: none; background: #fff;
    user-select: text; -webkit-user-select: text; touch-action: auto;
}
.fkx-view-details .fkx-rename { text-align: left; max-width: 320px; }
.fkx-menu {
    position: absolute; z-index: 40; min-width: 230px; padding: .35rem; border-radius: .8rem;
    background: rgba(255, 255, 255, .97); border: 1px solid rgba(15, 23, 42, .12);
    box-shadow: 0 14px 34px rgba(15, 23, 42, .25); animation: fkx-pop .12s ease-out both;
}
@keyframes fkx-pop { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: none; } }
.fkx-menu-item {
    display: flex; align-items: center; gap: .6rem; width: 100%; min-height: 40px; padding: .35rem .65rem;
    border-radius: .5rem; font-weight: 700; font-size: .92rem; text-align: left;
}
.fkx-menu-item:hover:not(:disabled) { background: #eff6ff; }
.fkx-menu-icon { width: 1.4rem; text-align: center; }
.fkx-menu-key { margin-left: auto; padding-left: 1rem; font-size: .75rem; font-weight: 700; color: #94a3b8; }
.fkx-menu-sep { height: 1px; margin: .3rem .2rem; background: #e2e8f0; }
.fkx-ghost {
    position: fixed; z-index: 9999; pointer-events: none; display: flex; align-items: center; gap: .45rem;
    padding: .4rem .7rem .4rem .45rem; border-radius: .8rem; background: rgba(255, 255, 255, .92);
    border: 2px solid #93c5fd; box-shadow: 0 12px 28px rgba(15, 23, 42, .3); font-family: 'Nunito', system-ui, sans-serif;
    font-weight: 800; font-size: .85rem; color: #1e293b; transform: translate(14px, 14px) rotate(-3deg); opacity: .95;
}
.fkx-ghost-count {
    position: absolute; top: -10px; left: -10px; min-width: 24px; height: 24px; padding: 0 6px; border-radius: 999px;
    background: #2563eb; color: #fff; font-size: .78rem; line-height: 24px; text-align: center;
}
.fkx-ghost-hint { display: block; font-size: .72rem; font-weight: 700; color: #16a34a; }
.fkx-ghost-hint.is-bad { color: #dc2626; }
.fkx-side-item.is-drop-target, .fkx-crumb.is-drop-target {
    background: #dcfce7 !important; box-shadow: inset 0 0 0 2px #22c55e; color: #166534;
}
.fkx-dock {
    display: flex; align-items: center; justify-content: center; gap: .4rem; flex-wrap: wrap;
    padding: .5rem; background: linear-gradient(180deg, #1e293b, #0f172a); border-top: 1px solid #334155;
}
.fkx-dock-label { color: #94a3b8; font-size: .75rem; font-weight: 800; margin-right: .25rem; }
.fkx-key {
    min-width: 56px; height: 50px; padding: 0 .75rem; border-radius: .7rem;
    background: linear-gradient(180deg, #f8fafc, #cbd5e1) !important; color: #0f172a !important;
    font-weight: 900 !important; font-size: 1rem !important; box-shadow: 0 4px 0 #64748b; touch-action: manipulation;
    transition: transform .06s, box-shadow .06s;
}
.fkx-key:active, .fkx-key.is-pressed { transform: translateY(3px); box-shadow: 0 1px 0 #64748b; }
.fkx-key-ctrl { min-width: 76px; }
.fkx-key-ctrl.is-on {
    background: linear-gradient(180deg, #60a5fa, #2563eb) !important; color: #fff !important; box-shadow: 0 4px 0 #1e3a8a, 0 0 14px rgba(96, 165, 250, .8);
}
.fkx-key-wide { min-width: 84px; }
.fkx-overlay {
    position: absolute; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center;
    padding: 1rem; background: rgba(15, 23, 42, .4);
}
.fkx-dialog {
    width: min(100%, 420px); max-height: 100%; overflow: auto; border-radius: 1.1rem; background: #fff;
    box-shadow: 0 20px 50px rgba(15, 23, 42, .35); animation: fkx-pop .15s ease-out both;
}
.fkx-dialog-head { display: flex; align-items: center; gap: .6rem; padding: .9rem 1rem; border-bottom: 1px solid #e2e8f0; }
.fkx-dialog-title { flex: 1; font-weight: 800; font-size: 1.05rem; word-break: break-word; }
.fkx-dialog-close { width: 36px; height: 36px; border-radius: 50%; font-size: 1rem; }
.fkx-dialog-close:hover { background: #fee2e2; color: #b91c1c; }
.fkx-dialog-body { padding: 1rem; }
.fkx-props { display: grid; grid-template-columns: auto 1fr; gap: .5rem .9rem; font-size: .9rem; }
.fkx-props dt { font-weight: 800; color: #64748b; }
.fkx-props dd { font-weight: 700; word-break: break-all; user-select: text; -webkit-user-select: text; }
.fkx-preview { display: flex; flex-direction: column; gap: .8rem; padding: 1rem; height: 100%; background: #f8fafc; }
.fkx-preview-text {
    flex: 1; min-height: 140px; padding: 1rem; background: #fff; border: 1px solid #e2e8f0; border-radius: .6rem;
    font-family: Consolas, 'Courier New', monospace; font-size: .95rem; white-space: pre-wrap; user-select: text; -webkit-user-select: text; overflow: auto;
}
.fkx-preview-doc {
    flex: 1; padding: 1.5rem 1.75rem; background: #fff; border-radius: .3rem; box-shadow: 0 4px 16px rgba(15, 23, 42, .12);
    font-family: Georgia, 'Times New Roman', serif; white-space: pre-wrap; overflow: auto; user-select: text; -webkit-user-select: text;
}
.fkx-preview-image {
    flex: 1; min-height: 160px; display: flex; align-items: center; justify-content: center; border-radius: .8rem;
    font-size: 6rem; background: linear-gradient(135deg, #bae6fd, #fbcfe8); border: 8px solid #fff; box-shadow: 0 6px 20px rgba(15, 23, 42, .15);
}
.fkx-preview-slide {
    flex: 1; min-height: 160px; display: flex; flex-direction: column; justify-content: center; padding: 1.5rem; border-radius: .6rem;
    background: linear-gradient(135deg, #ea580c, #f59e0b); color: #fff; font-weight: 800; font-size: 1.2rem; white-space: pre-wrap;
    box-shadow: 0 6px 20px rgba(15, 23, 42, .2);
}
.fkx-preview-audio {
    display: flex; flex-direction: column; align-items: center; gap: 1rem; padding: 1.5rem; border-radius: 1rem;
    background: linear-gradient(135deg, #7c3aed, #db2777); color: #fff;
}
.fkx-eq { display: flex; align-items: flex-end; gap: 5px; height: 60px; }
.fkx-eq i { width: 10px; height: 20%; border-radius: 4px; background: #fff; opacity: .9; }
.fkx-preview-audio.is-playing .fkx-eq i { animation: fkx-eq .8s ease-in-out infinite alternate; }
.fkx-eq i:nth-child(2) { animation-delay: .15s !important; }
.fkx-eq i:nth-child(3) { animation-delay: .3s !important; }
.fkx-eq i:nth-child(4) { animation-delay: .1s !important; }
.fkx-eq i:nth-child(5) { animation-delay: .25s !important; }
.fkx-eq i:nth-child(6) { animation-delay: .05s !important; }
@keyframes fkx-eq { from { height: 15%; } to { height: 100%; } }
.fkx-play {
    width: 64px; height: 64px; border-radius: 50%; background: #fff !important; color: #7c3aed !important; font-size: 1.6rem;
    box-shadow: 0 6px 16px rgba(0, 0, 0, .25);
}
.fkx-preview-warn {
    padding: 1rem; border-radius: .8rem; background: #fef3c7; border: 2px solid #f59e0b; color: #78350f; font-weight: 700;
}
.fkx-preview-meta { font-size: .8rem; font-weight: 700; color: #64748b; }
.fkx.is-narrow .fkx-side {
    position: absolute; left: 0; top: 0; bottom: 0; z-index: 30; box-shadow: 8px 0 24px rgba(15, 23, 42, .2);
    transform: translateX(-105%); transition: transform .2s ease;
}
.fkx.is-narrow.is-side-open .fkx-side { transform: none; }
.fkx:not(.is-narrow) .fkx-side-toggle { display: none; }
.fkx.is-narrow .fkx-search { width: 130px; }
.fkx.is-tiny .fkx-tool-label { display: none; }
.fkx.is-tiny .fkx-search { display: none; }
.fkx.is-tiny .fkx-key { min-width: 46px; padding: 0 .45rem; }
.fkx.is-dock-ctrl .fkx-item.is-selected { border-style: dashed; }
@media (pointer: coarse) {
    .fkx-item { padding: .7rem .35rem .55rem; }
    .fkx-side-item { min-height: 42px; }
    .fkx-tool { min-height: 44px; }
    .fkx-menu-item { min-height: 46px; }
}
`;

    function injectStyles() {
        if (document.getElementById('fkx-styles')) return;
        const style = document.createElement('style');
        style.id = 'fkx-styles';
        style.textContent = STYLES;
        document.head.appendChild(style);
    }

    // ======================================================================
    // FÁJLKEZELŐ UI KOMPONENS
    // ======================================================================
    const QUICK_ACCESS = [
        { id: 'desktop',   label: 'Asztal',       emoji: '🖥️' },
        { id: 'documents', label: 'Dokumentumok', emoji: '📄' },
        { id: 'pictures',  label: 'Képek',        emoji: '🖼️' },
        { id: 'music',     label: 'Zenék',        emoji: '🎵' },
        { id: 'downloads', label: 'Letöltések',   emoji: '⬇️' },
        { id: RECYCLE_ID,  label: 'Lomtár',       emoji: '🗑️' }
    ];

    const SHORTCUT_COMMANDS = {
        'Ctrl+C': 'copy',
        'Ctrl+X': 'cut',
        'Ctrl+V': 'paste',
        'Ctrl+Z': 'undo',
        'Ctrl+A': 'selectAll',
        'Ctrl+Shift+N': 'newFolder',
        'Delete': 'delete',
        'Shift+Delete': 'deletePermanent',
        'F2': 'rename',
        'Enter': 'open',
        'Backspace': 'back',
        'Alt+ArrowLeft': 'back',
        'Alt+ArrowRight': 'forward',
        'Alt+ArrowUp': 'up',
        'F5': 'refresh'
    };

    const LONG_PRESS_MS = 500;
    const DOUBLE_TAP_MS = 450;

    class Explorer {
        constructor(container, opts = {}) {
            injectStyles();
            this.container = container;
            this.opts = Object.assign({
                vfs: null,
                startId: null,
                startPath: null,
                view: 'icons',
                showDock: null,
                showSidebar: true,
                hooks: {},
                disabledActions: [],
                canPerform: null,
                bitiErrors: true,
                windowPreview: true
            }, opts);

            this.vfs = this.opts.vfs || VFS.createDefault();
            let start = this.opts.startId && (this.opts.startId === RECYCLE_ID || this.vfs.exists(this.opts.startId)) ? this.opts.startId : null;
            if (!start && this.opts.startPath) {
                const found = this.vfs.findByPath(this.opts.startPath);
                if (found) start = found.id;
            }
            if (!start) start = this.vfs.get('documents') ? 'documents' : 'root';

            this.currentId = start;
            this.history = [start];
            this.historyIndex = 0;
            this.selection = new Set();
            this.anchorId = null;
            this.searchQuery = '';
            this.view = this.opts.view;
            this.dockCtrl = false;
            this.physicalCtrl = false;
            this.dockVisible = this.opts.showDock === null ? isCoarsePointer() : !!this.opts.showDock;
            this.expanded = new Set(['root', 'users', 'user']);
            this.listeners = {};
            this.press = null;
            this.drag = null;
            this.lastTap = null;
            this.renaming = null;
            this.menuContext = null;
            this.destroyed = false;
            this.lastPointerType = 'mouse';
            this.suppressClickUntil = 0;

            this.build();
            this.bind();
            this.render();

            this.onVfsChange = () => {
                if (!this.destroyed) this.render();
            };
            this.vfs.on('change', this.onVfsChange);

            Explorer.instances.add(this);
            Explorer.active = this;
        }

        // ---------------- Felépítés ----------------

        build() {
            const root = document.createElement('div');
            root.className = 'fkx';
            root.tabIndex = 0;
            root.setAttribute('role', 'application');
            root.setAttribute('aria-label', 'Fájlkezelő');
            root.innerHTML =
                '<div class="fkx-top">' +
                    '<button type="button" class="fkx-navbtn fkx-side-toggle" data-cmd="sidebar" title="Navigációs sáv" aria-label="Navigációs sáv">☰</button>' +
                    '<button type="button" class="fkx-navbtn" data-cmd="back" title="Vissza (Alt+←)" aria-label="Vissza">←</button>' +
                    '<button type="button" class="fkx-navbtn" data-cmd="forward" title="Előre (Alt+→)" aria-label="Előre">→</button>' +
                    '<button type="button" class="fkx-navbtn" data-cmd="up" title="Egy szinttel feljebb (Alt+↑)" aria-label="Egy szinttel feljebb">↑</button>' +
                    '<div class="fkx-address" title="Elérési út – kattints ide a beíráshoz"><div class="fkx-crumbs"></div></div>' +
                    '<label class="fkx-search"><span class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Keresés</span><input type="search" placeholder="Keresés…" autocomplete="off" spellcheck="false"></label>' +
                '</div>' +
                '<div class="fkx-toolbar" role="toolbar" aria-label="Eszköztár"></div>' +
                '<div class="fkx-main">' +
                    '<nav class="fkx-side" aria-label="Navigációs sáv"></nav>' +
                    '<div class="fkx-content-wrap">' +
                        '<div class="fkx-content" role="listbox" aria-multiselectable="true"></div>' +
                    '</div>' +
                '</div>' +
                '<div class="fkx-status"></div>' +
                '<div class="fkx-dock" role="toolbar" aria-label="Gyorsbillentyű-dokkoló"></div>';
            this.container.appendChild(root);
            this.root = root;
            this.el = {
                top: root.querySelector('.fkx-top'),
                address: root.querySelector('.fkx-address'),
                crumbs: root.querySelector('.fkx-crumbs'),
                search: root.querySelector('.fkx-search input'),
                toolbar: root.querySelector('.fkx-toolbar'),
                side: root.querySelector('.fkx-side'),
                content: root.querySelector('.fkx-content'),
                status: root.querySelector('.fkx-status'),
                dock: root.querySelector('.fkx-dock')
            };
            if (!this.opts.showSidebar) this.el.side.style.display = 'none';

            if (typeof ResizeObserver === 'function') {
                this.resizeObserver = new ResizeObserver(entries => {
                    const w = entries[0].contentRect.width;
                    root.classList.toggle('is-narrow', w < 680);
                    root.classList.toggle('is-tiny', w < 470);
                });
                this.resizeObserver.observe(root);
            }
        }

        bind() {
            const root = this.root;
            const content = this.el.content;

            root.addEventListener('pointerdown', ev => {
                Explorer.active = this;
                this.lastPointerType = ev.pointerType || 'mouse';
                if (this.menuEl && !ev.target.closest('.fkx-menu')) this.closeMenu();
                if (root.classList.contains('is-side-open') && !ev.target.closest('.fkx-side') && !ev.target.closest('[data-cmd="sidebar"]')) {
                    root.classList.remove('is-side-open');
                }
            }, true);
            root.addEventListener('focusin', () => { Explorer.active = this; });

            // Gombok (eszköztár, navigáció)
            root.addEventListener('click', ev => {
                const cmdBtn = ev.target.closest('[data-cmd]');
                if (cmdBtn && root.contains(cmdBtn) && !cmdBtn.disabled) {
                    ev.preventDefault();
                    this.command(cmdBtn.dataset.cmd, { source: 'toolbar' });
                    return;
                }
                const nav = ev.target.closest('[data-nav-id]');
                if (nav && !ev.target.closest('.fkx-content')) {
                    if (Date.now() < this.suppressClickUntil) return;
                    ev.preventDefault();
                    this.navigate(nav.dataset.navId);
                    if (root.classList.contains('is-narrow')) root.classList.remove('is-side-open');
                    return;
                }
                const toggle = ev.target.closest('[data-toggle-id]');
                if (toggle) {
                    const id = toggle.dataset.toggleId;
                    if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id);
                    this.renderSidebar();
                    return;
                }
                const key = ev.target.closest('[data-key]');
                if (key) {
                    this.pressDockKey(key.dataset.key);
                    return;
                }
                const more = ev.target.closest('[data-more]');
                if (more) {
                    ev.stopPropagation();
                    const item = more.closest('.fkx-item');
                    const rect = more.getBoundingClientRect();
                    this.openMenu(rect.left, rect.bottom, item ? item.dataset.id : null);
                }
            });

            // Címsor: kattintásra szöveges szerkesztés
            this.el.address.addEventListener('click', ev => {
                if (ev.target.closest('.fkx-crumb') || this.el.address.querySelector('input')) return;
                this.editAddress();
            });

            // Kereső
            this.el.search.addEventListener('input', () => {
                this.searchQuery = this.el.search.value.trim();
                this.clearSelection(true);
                this.renderContent();
                this.renderStatus();
                this.renderToolbar();
            });
            this.el.search.addEventListener('keydown', ev => {
                if (ev.key === 'Escape') {
                    this.el.search.value = '';
                    this.searchQuery = '';
                    this.render();
                }
                ev.stopPropagation();
            });

            // Fő munkaterület: kijelölés, dupla koppintás, hosszú érintés, húzás – Pointer Events
            content.addEventListener('pointerdown', ev => this.onPointerDown(ev));
            content.addEventListener('pointermove', ev => this.onPointerMove(ev));
            content.addEventListener('pointerup', ev => this.onPointerUp(ev));
            content.addEventListener('pointercancel', ev => this.onPointerCancel(ev));
            content.addEventListener('lostpointercapture', ev => {
                if (this.press && this.press.pointerId === ev.pointerId && !this.drag) this.press = null;
            });

            // Jobb klikk (egér). Érintésnél a hosszú nyomást saját időzítő kezeli.
            root.addEventListener('contextmenu', ev => {
                if (ev.target.closest('input')) return;
                ev.preventDefault();
                if (this.lastPointerType === 'touch' || this.lastPointerType === 'pen') return;
                const item = ev.target.closest('.fkx-item');
                if (!ev.target.closest('.fkx-content') && !item) return;
                if (item && !this.selection.has(item.dataset.id)) this.select([item.dataset.id]);
                if (!item) this.clearSelection();
                this.openMenu(ev.clientX, ev.clientY, item ? item.dataset.id : null);
            });

            // Görgetéskor a menü bezárul
            content.addEventListener('scroll', () => this.closeMenu(), { passive: true });
        }

        // ---------------- Események a játékok felé ----------------

        on(type, cb) {
            (this.listeners[type] = this.listeners[type] || []).push(cb);
            return () => this.off(type, cb);
        }

        off(type, cb) {
            this.listeners[type] = (this.listeners[type] || []).filter(f => f !== cb);
        }

        emit(type, data = {}) {
            const payload = Object.assign({ type, explorer: this, vfs: this.vfs, time: Date.now() }, data);
            const call = (fn, ...args) => {
                if (typeof fn !== 'function') return;
                try { fn(...args); } catch (e) { console.error('Fájlkezelő horog hiba (' + type + '):', e); }
            };
            call(this.opts.hooks[type], payload);
            (this.listeners[type] || []).slice().forEach(cb => call(cb, payload));
            call(this.opts.hooks.onAny, type, payload);
            (this.listeners.onAny || []).slice().forEach(cb => call(cb, type, payload));
            const checker = FK.missionChecker;
            if (checker) {
                call(checker[type] && checker[type].bind(checker), payload);
                call(checker.onAny && checker.onAny.bind(checker), type, payload);
            }
            const detail = Object.assign({}, payload);
            delete detail.explorer;
            delete detail.vfs;
            document.dispatchEvent(new CustomEvent('fk:explorer', { detail }));
        }

        /** Jogosultság-ellenőrzés: a játékok tilthatnak műveleteket. */
        allowed(action, nodes = []) {
            if ((this.opts.disabledActions || []).includes(action)) {
                this.blocked(action, nodes, 'Ebben a feladatban ez a művelet most nem használható. 🙂');
                return false;
            }
            if (typeof this.opts.canPerform === 'function') {
                const res = this.opts.canPerform(action, nodes, this);
                if (res === false || typeof res === 'string') {
                    this.blocked(action, nodes, typeof res === 'string' ? res : 'Ezt most nem lehet megcsinálni.');
                    return false;
                }
            }
            return true;
        }

        blocked(action, nodes, message) {
            notify(message, 'warn', this.opts.bitiErrors);
            this.emit('onBlocked', { action, nodes, message });
        }

        error(e) {
            const message = e && e.message ? e.message : String(e);
            notify(message, 'error', this.opts.bitiErrors);
        }

        // ---------------- Navigáció ----------------

        navigate(id, options = {}) {
            if (id !== RECYCLE_ID) {
                const node = this.vfs.get(id);
                if (!node || node.type !== 'folder' || this.vfs.isInRecycleBin(id)) {
                    this.error('Ez a mappa nem érhető el.');
                    return false;
                }
            }
            if (this.renaming) this.finishRename(true);
            this.closeMenu();
            this.currentId = id;
            this.searchQuery = '';
            this.el.search.value = '';
            this.selection.clear();
            this.anchorId = null;
            if (!options.fromHistory) {
                this.history = this.history.slice(0, this.historyIndex + 1);
                if (this.history[this.history.length - 1] !== id) this.history.push(id);
                this.historyIndex = this.history.length - 1;
            }
            this.vfs.getAncestors(id).forEach(n => this.expanded.add(n.id));
            this.render();
            this.el.content.scrollTop = 0;
            this.emit('onNavigate', { id, node: this.vfs.get(id), path: this.vfs.getPath(id) });
            return true;
        }

        back() {
            let i = this.historyIndex - 1;
            while (i >= 0 && this.history[i] !== RECYCLE_ID && !this.vfs.exists(this.history[i])) i--;
            if (i < 0) return;
            this.historyIndex = i;
            this.navigate(this.history[i], { fromHistory: true });
        }

        forward() {
            let i = this.historyIndex + 1;
            while (i < this.history.length && this.history[i] !== RECYCLE_ID && !this.vfs.exists(this.history[i])) i++;
            if (i >= this.history.length) return;
            this.historyIndex = i;
            this.navigate(this.history[i], { fromHistory: true });
        }

        up() {
            if (this.currentId === RECYCLE_ID) return this.navigate(this.vfs.get('user') ? 'user' : 'root');
            const node = this.vfs.get(this.currentId);
            if (node && node.parentId) this.navigate(node.parentId);
        }

        editAddress() {
            const input = document.createElement('input');
            input.className = 'fkx-address-input';
            input.value = this.vfs.getPath(this.currentId);
            input.spellcheck = false;
            this.el.crumbs.style.display = 'none';
            this.el.address.appendChild(input);
            input.focus();
            input.select();
            const finish = go => {
                if (!input.isConnected) return;
                const value = input.value;
                input.remove();
                this.el.crumbs.style.display = '';
                if (go) {
                    const found = this.vfs.findByPath(value);
                    if (found) this.navigate(found.id);
                    else this.error('A Windows nem találja ezt: „' + value + '”. Ellenőrizd, hogy jól írtad-e be!');
                }
            };
            input.addEventListener('keydown', ev => {
                ev.stopPropagation();
                if (ev.key === 'Enter') finish(true);
                if (ev.key === 'Escape') finish(false);
            });
            input.addEventListener('blur', () => finish(false));
        }

        // ---------------- Kijelölés ----------------

        select(ids, options = {}) {
            this.selection = new Set(ids.filter(id => this.vfs.get(id)));
            this.anchorId = ids.length ? ids[ids.length - 1] : null;
            this.updateSelectionView();
            if (!options.silent) this.emit('onSelectionChanged', { nodes: this.selectedNodes() });
        }

        toggleSelect(id) {
            if (this.selection.has(id)) this.selection.delete(id); else this.selection.add(id);
            this.anchorId = id;
            this.updateSelectionView();
            this.emit('onSelectionChanged', { nodes: this.selectedNodes() });
        }

        rangeSelect(id) {
            const ids = this.visibleNodes().map(n => n.id);
            const a = ids.indexOf(this.anchorId);
            const b = ids.indexOf(id);
            if (a < 0 || b < 0) return this.select([id]);
            const [from, to] = a < b ? [a, b] : [b, a];
            this.selection = new Set(ids.slice(from, to + 1));
            this.updateSelectionView();
            this.emit('onSelectionChanged', { nodes: this.selectedNodes() });
        }

        clearSelection(silent) {
            if (!this.selection.size) return;
            this.selection.clear();
            this.updateSelectionView();
            if (!silent) this.emit('onSelectionChanged', { nodes: [] });
        }

        selectedNodes() {
            return Array.from(this.selection).map(id => this.vfs.get(id)).filter(Boolean);
        }

        updateSelectionView() {
            this.el.content.querySelectorAll('.fkx-item').forEach(el => {
                const on = this.selection.has(el.dataset.id);
                el.classList.toggle('is-selected', on);
                el.setAttribute('aria-selected', String(on));
            });
            this.renderToolbar();
            this.renderStatus();
        }

        /** Egy elem kiemelése (pl. Biti tippjéhez). */
        flash(id) {
            const el = this.itemEl(id);
            if (!el) return;
            el.classList.remove('is-flash');
            void el.offsetWidth;
            el.classList.add('is-flash');
            el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            setTimeout(() => el.classList.remove('is-flash'), 3200);
        }

        itemEl(id) {
            return this.el.content.querySelector('.fkx-item[data-id="' + CSS.escape(id) + '"]');
        }

        // ---------------- Megjelenítés ----------------

        render() {
            if (this.destroyed) return;
            if (this.currentId !== RECYCLE_ID && !this.vfs.exists(this.currentId)) {
                // A megnyitott mappa eltűnt (pl. törölték): visszalépünk a legközelebbi létező szülőre
                let n = this.vfs.get(this.currentId);
                while (n && !this.vfs.exists(n.id)) n = this.vfs.get(n.parentId);
                this.currentId = n ? n.id : 'root';
            }
            Array.from(this.selection).forEach(id => {
                if (!this.vfs.get(id)) this.selection.delete(id);
            });
            this.renderAddress();
            this.renderToolbar();
            this.renderSidebar();
            this.renderContent();
            this.renderStatus();
            this.renderDock();
        }

        renderAddress() {
            const back = this.root.querySelector('[data-cmd="back"]');
            const fwd = this.root.querySelector('[data-cmd="forward"]');
            const up = this.root.querySelector('[data-cmd="up"]');
            back.disabled = this.historyIndex <= 0;
            fwd.disabled = this.historyIndex >= this.history.length - 1;
            up.disabled = this.currentId === 'root';

            let html;
            if (this.currentId === RECYCLE_ID) {
                html = '<button type="button" class="fkx-crumb" data-nav-id="' + RECYCLE_ID + '" data-drop-id="' + RECYCLE_ID + '">🗑️ Lomtár</button>';
            } else {
                html = this.vfs.getAncestors(this.currentId).map((n, i) =>
                    (i > 0 ? '<span class="fkx-crumb-sep" aria-hidden="true">›</span>' : '') +
                    '<button type="button" class="fkx-crumb" data-nav-id="' + escapeHtml(n.id) + '" data-drop-id="' + escapeHtml(n.id) + '">' +
                        (i === 0 ? '💻 ' : '') + escapeHtml(this.vfs.displayName(n)) +
                    '</button>'
                ).join('');
            }
            if (this.searchQuery) html += '<span class="fkx-crumb-sep">›</span><span class="fkx-crumb">🔍 „' + escapeHtml(this.searchQuery) + '”</span>';
            this.el.crumbs.innerHTML = html;
            this.el.crumbs.scrollLeft = this.el.crumbs.scrollWidth;
        }

        renderToolbar() {
            const inBin = this.currentId === RECYCLE_ID;
            const sel = this.selectedNodes();
            const hasSel = sel.length > 0;
            const clip = this.vfs.clipboard;
            const canPaste = !inBin && clip.mode && clip.ids.some(id => this.vfs.exists(id));
            const tool = (cmd, icon, label, enabled = true, title = '') =>
                '<button type="button" class="fkx-tool" data-cmd="' + cmd + '"' + (enabled ? '' : ' disabled') +
                ' title="' + escapeHtml(title || label) + '"><span class="fkx-tool-icon" aria-hidden="true">' + icon + '</span><span class="fkx-tool-label">' + label + '</span></button>';
            let html;
            if (inBin) {
                const binCount = this.vfs.recycleBinItems().length;
                html =
                    tool('restore', '♻️', 'Visszaállítás', hasSel, 'Kijelöltek visszaállítása') +
                    tool('deletePermanent', '❌', 'Végleges törlés', hasSel, 'Végleges törlés (Shift+Delete)') +
                    '<span class="fkx-tool-sep"></span>' +
                    tool('emptyBin', '🧹', 'Lomtár ürítése', binCount > 0) +
                    tool('properties', 'ℹ️', 'Tulajdonságok', sel.length === 1);
            } else {
                html =
                    tool('newFolder', '📁', 'Új mappa', !this.searchQuery, 'Új mappa (Ctrl+Shift+N)') +
                    '<span class="fkx-tool-sep"></span>' +
                    tool('cut', '✂️', 'Kivágás', hasSel, 'Kivágás (Ctrl+X)') +
                    tool('copy', '📋', 'Másolás', hasSel, 'Másolás (Ctrl+C)') +
                    tool('paste', '📌', 'Beillesztés', !!canPaste && !this.searchQuery, 'Beillesztés (Ctrl+V)') +
                    tool('rename', '✏️', 'Átnevezés', sel.length === 1, 'Átnevezés (F2)') +
                    tool('delete', '🗑️', 'Törlés', hasSel, 'Törlés a Lomtárba (Delete)');
            }
            html += '<span class="fkx-tool-spacer"></span>' +
                tool('undo', '↶', 'Visszavonás', this.vfs.canUndo(), 'Visszavonás (Ctrl+Z)') +
                tool('view', this.view === 'icons' ? '☰' : '▦', this.view === 'icons' ? 'Részletek' : 'Ikonok', true, 'Nézet váltása') +
                '<button type="button" class="fkx-tool' + (this.dockVisible ? ' is-on' : '') + '" data-cmd="dock" title="Gyorsbillentyű-dokkoló be/ki" aria-pressed="' + this.dockVisible + '">' +
                    '<span class="fkx-tool-icon" aria-hidden="true">⌨️</span><span class="fkx-tool-label">Billentyűk</span></button>';
            this.el.toolbar.innerHTML = html;
        }

        renderSidebar() {
            if (!this.opts.showSidebar) return;
            const cur = this.currentId;
            let html = '<div class="fkx-side-title">⭐ Gyors elérés</div>';
            QUICK_ACCESS.forEach(q => {
                if (q.id !== RECYCLE_ID && !this.vfs.exists(q.id)) return;
                const label = q.id === RECYCLE_ID ? q.label + (this.vfs.recycleBinItems().length ? ' (' + this.vfs.recycleBinItems().length + ')' : '') : q.label;
                html += '<button type="button" class="fkx-side-item' + (cur === q.id ? ' is-current' : '') + '" data-nav-id="' + q.id + '" data-drop-id="' + q.id + '">' +
                    '<span class="fkx-side-emoji" aria-hidden="true">' + q.emoji + '</span>' + escapeHtml(label) + '</button>';
            });
            html += '<div class="fkx-side-title">💻 Ez a gép</div>';
            html += this.treeHtml('root', 0);
            this.el.side.innerHTML = html;
        }

        treeHtml(id, depth) {
            const node = this.vfs.get(id);
            if (!node) return '';
            const subs = this.vfs.subfolders(id);
            const open = this.expanded.has(id);
            const icon = id === 'root' ? driveSvg(20) : folderSvg(20);
            let html = '<div class="fkx-tree-row" style="padding-left:' + (depth * 14) + 'px">' +
                (subs.length
                    ? '<button type="button" class="fkx-tree-toggle" data-toggle-id="' + escapeHtml(id) + '" aria-label="' + (open ? 'Becsukás' : 'Kinyitás') + '" aria-expanded="' + open + '">' + (open ? '▼' : '▶') + '</button>'
                    : '<span class="fkx-tree-toggle"></span>') +
                '<button type="button" class="fkx-side-item' + (this.currentId === id ? ' is-current' : '') + '" data-nav-id="' + escapeHtml(id) + '" data-drop-id="' + escapeHtml(id) + '">' +
                    icon + '<span>' + escapeHtml(id === 'root' ? 'Helyi lemez (C:)' : this.vfs.displayName(node)) + '</span></button>' +
                '</div>';
            if (open) subs.forEach(s => { html += this.treeHtml(s.id, depth + 1); });
            return html;
        }

        visibleNodes() {
            if (this.currentId === RECYCLE_ID) return this.vfs.recycleBinItems();
            if (this.searchQuery) return this.vfs.search(this.currentId, this.searchQuery);
            return this.vfs.children(this.currentId);
        }

        renderContent() {
            const nodes = this.visibleNodes();
            const inBin = this.currentId === RECYCLE_ID;
            const searching = !!this.searchQuery;
            const content = this.el.content;
            content.className = 'fkx-content fkx-view-' + this.view;
            this.root.classList.toggle('is-dock-ctrl', this.dockCtrl);
            const clip = this.vfs.clipboard;
            const cutSet = new Set(clip.mode === 'cut' ? clip.ids : []);
            const iconSize = this.view === 'icons' ? 52 : 26;

            if (!nodes.length) {
                const msg = inBin ? 'A Lomtár üres. 🎉' : searching ? 'Nincs találat erre: „' + escapeHtml(this.searchQuery) + '”' : 'Ez a mappa üres.';
                const icon = inBin ? '🗑️' : searching ? '🔍' : '📂';
                content.innerHTML = '<div class="fkx-empty"><span class="fkx-empty-icon" aria-hidden="true">' + icon + '</span>' + msg + '</div>';
                return;
            }

            let head = '';
            if (this.view === 'details') {
                head = '<div class="fkx-details-head"><span>Név</span><span>' + (inBin ? 'Eredeti hely' : searching ? 'Hely' : 'Módosítva') + '</span><span>Típus</span><span>Méret</span></div>';
            }
            const items = nodes.map(n => {
                const isFolder = n.type === 'folder';
                const name = this.vfs.displayName(n);
                const type = isFolder ? 'Fájlmappa' : fileType(n.ext).label;
                const size = isFolder ? '' : formatSize(n.size);
                const where = inBin ? (n.deletedFrom || '') : searching ? this.vfs.getPath(n.parentId) : formatDate(n.modified);
                const classes = 'fkx-item' + (isFolder ? ' is-folder' : '') + (this.selection.has(n.id) ? ' is-selected' : '') + (cutSet.has(n.id) ? ' is-cut' : '');
                const drop = isFolder && !inBin ? ' data-drop-id="' + escapeHtml(n.id) + '"' : '';
                let sub = '';
                if (this.view === 'details') {
                    sub = '<span class="fkx-item-sub">' + escapeHtml(where) + '</span><span class="fkx-item-sub">' + escapeHtml(type) + '</span><span class="fkx-item-sub">' + escapeHtml(size) + '</span>';
                } else if (inBin || searching) {
                    // Ikon nézetben csak az útvonal vége fér ki; a teljes útvonal a buborékban látszik
                    const parts = String(where).split('\\');
                    const short = parts.length > 2 ? '…\\' + parts.slice(-2).join('\\') : where;
                    sub = '<span class="fkx-item-sub" title="' + escapeHtml(where) + '">' + escapeHtml(inBin ? 'Innen: ' + short : short) + '</span>';
                }
                return '<div class="' + classes + '" data-id="' + escapeHtml(n.id) + '"' + drop + ' role="option" aria-selected="' + this.selection.has(n.id) + '" title="' + escapeHtml(name + '\n' + type + (size ? '\nMéret: ' + size : '')) + '">' +
                    '<div class="fkx-item-icon">' + nodeIcon(n, iconSize) + '</div>' +
                    '<div class="fkx-item-name">' + escapeHtml(name) + '</div>' +
                    sub +
                    '<button type="button" class="fkx-item-more" data-more aria-label="Műveletek: ' + escapeHtml(name) + '" title="Műveletek">⋮</button>' +
                '</div>';
            }).join('');
            content.innerHTML = head + '<div class="fkx-items">' + items + '</div>';
        }

        renderStatus() {
            const nodes = this.visibleNodes();
            const sel = this.selectedNodes();
            let text = nodes.length + ' elem';
            if (sel.length) {
                const size = sel.reduce((a, n) => a + (n.type === 'file' ? n.size : 0), 0);
                text += ' · ' + sel.length + ' kijelölve' + (size ? ' (' + formatSize(size) + ')' : '');
            }
            const clip = this.vfs.clipboard;
            let clipText = '';
            if (clip.mode && clip.ids.length) {
                clipText = '<span class="fkx-status-clip">📋 ' + clip.ids.length + ' elem ' + (clip.mode === 'cut' ? 'kivágva' : 'másolva') + ' – beillesztés: Ctrl+V</span>';
            }
            this.el.status.innerHTML = '<span>' + text + '</span>' + clipText;
        }

        renderDock() {
            const dock = this.el.dock;
            dock.style.display = this.dockVisible ? '' : 'none';
            if (!this.dockVisible) return;
            const ctrlOn = this.dockCtrl || this.physicalCtrl;
            dock.innerHTML =
                '<span class="fkx-dock-label">Gyorsbillentyűk:</span>' +
                '<button type="button" class="fkx-key fkx-key-ctrl' + (ctrlOn ? ' is-on' : '') + '" data-key="ctrl" aria-pressed="' + this.dockCtrl + '" title="Ctrl – nyomd meg egyszer, bekapcsolva marad">Ctrl</button>' +
                '<button type="button" class="fkx-key" data-key="c" title="Ctrl+C = Másolás">C</button>' +
                '<button type="button" class="fkx-key" data-key="x" title="Ctrl+X = Kivágás">X</button>' +
                '<button type="button" class="fkx-key" data-key="v" title="Ctrl+V = Beillesztés">V</button>' +
                '<button type="button" class="fkx-key" data-key="z" title="Ctrl+Z = Visszavonás">Z</button>' +
                '<button type="button" class="fkx-key fkx-key-wide" data-key="delete" title="Delete = Törlés">Delete</button>' +
                '<button type="button" class="fkx-key" data-key="f2" title="F2 = Átnevezés">F2</button>';
        }

        // ---------------- Pointer Events: kijelölés, dupla koppintás, hosszú érintés, húzás ----------------

        onPointerDown(ev) {
            if (ev.target.closest('[data-more]') || ev.target.closest('.fkx-rename')) return;
            if (ev.button !== undefined && ev.button > 0) return;
            if (this.renaming) this.finishRename(true);
            const item = ev.target.closest('.fkx-item');
            this.lastPointerType = ev.pointerType || 'mouse';
            this.press = {
                pointerId: ev.pointerId,
                type: ev.pointerType || 'mouse',
                id: item ? item.dataset.id : null,
                x: ev.clientX,
                y: ev.clientY,
                moved: false,
                longFired: false,
                ctrl: ev.ctrlKey || ev.metaKey || this.dockCtrl,
                shift: ev.shiftKey,
                timer: null
            };
            if (item) {
                try { this.el.content.setPointerCapture(ev.pointerId); } catch (e) { /* nem baj */ }
                // Egérrel Windows-szerűen már lenyomáskor kijelöl
                if (this.press.type === 'mouse' && !this.press.ctrl && !this.press.shift && !this.selection.has(item.dataset.id)) {
                    this.select([item.dataset.id]);
                }
            }
            if (this.press.type !== 'mouse') {
                const press = this.press;
                press.timer = setTimeout(() => {
                    if (this.press !== press || press.moved) return;
                    press.longFired = true;
                    if (press.id && !this.selection.has(press.id)) this.select([press.id]);
                    if (!press.id) this.clearSelection();
                    if (navigator.vibrate) {
                        try { navigator.vibrate(25); } catch (e) { /* nem támogatott */ }
                    }
                    this.openMenu(press.x, press.y, press.id);
                }, LONG_PRESS_MS);
            }
        }

        onPointerMove(ev) {
            const press = this.press;
            if (!press || press.pointerId !== ev.pointerId) return;
            if (this.drag) {
                this.updateDrag(ev);
                return;
            }
            const dist = Math.hypot(ev.clientX - press.x, ev.clientY - press.y);
            const threshold = press.type === 'mouse' ? 5 : 10;
            if (dist < threshold) return;
            press.moved = true;
            clearTimeout(press.timer);
            if (press.longFired || !press.id) return;
            this.startDrag(ev);
        }

        onPointerUp(ev) {
            const press = this.press;
            if (!press || press.pointerId !== ev.pointerId) return;
            clearTimeout(press.timer);
            this.press = null;
            try { this.el.content.releasePointerCapture(ev.pointerId); } catch (e) { /* nem baj */ }

            if (this.drag) {
                this.finishDrag(ev);
                return;
            }
            if (press.longFired || press.moved) return;

            if (!press.id) {
                if (!press.ctrl) this.clearSelection();
                this.lastTap = null;
                return;
            }

            // Kijelölés
            if (press.shift && this.anchorId) {
                this.rangeSelect(press.id);
            } else if (press.ctrl) {
                this.toggleSelect(press.id);
            } else if (!(this.selection.size === 1 && this.selection.has(press.id))) {
                this.select([press.id]);
            }

            // Dupla kattintás / dupla koppintás
            const now = Date.now();
            if (this.lastTap && this.lastTap.id === press.id && now - this.lastTap.time < DOUBLE_TAP_MS && !press.ctrl && !press.shift) {
                this.lastTap = null;
                this.select([press.id]);
                this.openNode(press.id);
            } else {
                this.lastTap = { id: press.id, time: now };
            }
        }

        onPointerCancel(ev) {
            const press = this.press;
            if (!press || press.pointerId !== ev.pointerId) return;
            clearTimeout(press.timer);
            this.press = null;
            if (this.drag) this.cancelDrag();
        }

        startDrag(ev) {
            const press = this.press;
            if (this.currentId === RECYCLE_ID) return;
            if (!this.selection.has(press.id)) this.select([press.id]);
            const nodes = this.selectedNodes();
            if (!nodes.length) return;
            const locked = nodes.find(n => n.locked);
            if (locked) {
                this.error('A(z) „' + this.vfs.displayName(locked) + '” védett elem, nem lehet elhúzni.');
                press.longFired = true;
                return;
            }
            const first = nodes[0];
            const ghost = document.createElement('div');
            ghost.className = 'fkx-ghost';
            ghost.innerHTML = nodeIcon(first, 34) +
                '<span><span class="fkx-ghost-name">' + escapeHtml(this.vfs.displayName(first)) + (nodes.length > 1 ? ' és még ' + (nodes.length - 1) : '') + '</span>' +
                '<span class="fkx-ghost-hint"></span></span>' +
                (nodes.length > 1 ? '<span class="fkx-ghost-count">' + nodes.length + '</span>' : '');
            document.body.appendChild(ghost);
            this.drag = { ids: nodes.map(n => n.id), ghost, targetEl: null, targetId: null, valid: false, copy: false };
            nodes.forEach(n => {
                const el = this.itemEl(n.id);
                if (el) el.classList.add('is-dragging');
            });
            this.closeMenu();
            this.updateDrag(ev);
        }

        updateDrag(ev) {
            const drag = this.drag;
            drag.ghost.style.left = ev.clientX + 'px';
            drag.ghost.style.top = ev.clientY + 'px';
            drag.copy = !!(ev.ctrlKey || ev.metaKey || this.dockCtrl);

            const under = document.elementFromPoint(ev.clientX, ev.clientY);
            let targetEl = under ? under.closest('[data-drop-id]') : null;
            if (targetEl && !this.root.contains(targetEl)) targetEl = null;
            const targetId = targetEl ? targetEl.dataset.dropId : null;

            if (drag.targetEl && drag.targetEl !== targetEl) drag.targetEl.classList.remove('is-drop-target');
            drag.targetEl = targetEl;
            drag.targetId = targetId;

            const hint = drag.ghost.querySelector('.fkx-ghost-hint');
            let valid = false;
            let text = '';
            if (targetId === RECYCLE_ID) {
                valid = true;
                text = '🗑️ Áthelyezés a Lomtárba';
            } else if (targetId) {
                const target = this.vfs.get(targetId);
                const bad = drag.ids.some(id => id === targetId || this.vfs.isAncestor(id, targetId));
                const same = !drag.copy && drag.ids.every(id => this.vfs.get(id) && this.vfs.get(id).parentId === targetId);
                if (bad) {
                    text = '⛔ Saját magába nem teheted';
                } else if (same) {
                    text = 'Már ebben a mappában van';
                } else {
                    valid = true;
                    text = (drag.copy ? '➕ Másolás ide: ' : '➡️ Áthelyezés ide: ') + this.vfs.displayName(target);
                }
            } else {
                text = drag.copy ? 'Másolás (Ctrl)' : 'Húzd egy mappára!';
            }
            drag.valid = valid;
            hint.textContent = text;
            hint.classList.toggle('is-bad', !!targetId && !valid);
            if (targetEl) targetEl.classList.toggle('is-drop-target', valid);
        }

        finishDrag(ev) {
            const drag = this.drag;
            this.cleanupDrag();
            this.suppressClickUntil = Date.now() + 350;
            if (!drag.valid || !drag.targetId) return;
            if (drag.targetId === RECYCLE_ID) {
                this.doDelete(drag.ids, false, 'drag');
            } else if (drag.copy) {
                this.doCopyTo(drag.ids, drag.targetId, 'drag');
            } else {
                this.doMove(drag.ids, drag.targetId, 'drag');
            }
        }

        cancelDrag() {
            this.cleanupDrag();
        }

        cleanupDrag() {
            const drag = this.drag;
            if (!drag) return;
            drag.ghost.remove();
            if (drag.targetEl) drag.targetEl.classList.remove('is-drop-target');
            this.root.querySelectorAll('.is-dragging').forEach(el => el.classList.remove('is-dragging'));
            this.drag = null;
        }

        // ---------------- Helyi menü (jobb klikk / hosszú érintés / ⋮) ----------------

        openMenu(clientX, clientY, itemId) {
            this.closeMenu();
            const inBin = this.currentId === RECYCLE_ID;
            const sel = itemId ? this.selectedNodes() : [];
            const clip = this.vfs.clipboard;
            const canPaste = !inBin && clip.mode && clip.ids.some(id => this.vfs.exists(id));
            const single = sel.length === 1 ? sel[0] : null;
            const entries = [];
            const add = (cmd, icon, label, key = '', enabled = true) => entries.push({ cmd, icon, label, key, enabled });
            const sep = () => entries.push({ sep: true });

            if (inBin && itemId) {
                add('restore', '♻️', 'Visszaállítás');
                add('deletePermanent', '❌', 'Végleges törlés', 'Shift+Del');
                sep();
                add('properties', 'ℹ️', 'Tulajdonságok', '', !!single);
            } else if (inBin) {
                add('emptyBin', '🧹', 'Lomtár ürítése', '', this.vfs.recycleBinItems().length > 0);
            } else if (itemId) {
                add('open', '📂', 'Megnyitás', 'Enter', !!single);
                sep();
                add('cut', '✂️', 'Kivágás', 'Ctrl+X');
                add('copy', '📋', 'Másolás', 'Ctrl+C');
                if (single && single.type === 'folder') add('pasteInto', '📌', 'Beillesztés ebbe a mappába', 'Ctrl+V', !!canPaste);
                else add('paste', '📌', 'Beillesztés', 'Ctrl+V', !!canPaste);
                sep();
                add('rename', '✏️', 'Átnevezés', 'F2', !!single);
                add('delete', '🗑️', 'Törlés', 'Del');
                sep();
                add('properties', 'ℹ️', 'Tulajdonságok', '', !!single);
            } else {
                add('newFolder', '📁', 'Új mappa', 'Ctrl+Shift+N', !this.searchQuery);
                add('paste', '📌', 'Beillesztés', 'Ctrl+V', !!canPaste && !this.searchQuery);
                sep();
                add('undo', '↶', 'Visszavonás', 'Ctrl+Z', this.vfs.canUndo());
                add('selectAll', '☑️', 'Összes kijelölése', 'Ctrl+A');
                sep();
                add('properties', 'ℹ️', 'Tulajdonságok');
            }

            const menu = document.createElement('div');
            menu.className = 'fkx-menu';
            menu.setAttribute('role', 'menu');
            menu.innerHTML = entries.map(e => e.sep
                ? '<div class="fkx-menu-sep" role="separator"></div>'
                : '<button type="button" class="fkx-menu-item" role="menuitem" data-menu-cmd="' + e.cmd + '"' + (e.enabled ? '' : ' disabled') + '>' +
                    '<span class="fkx-menu-icon" aria-hidden="true">' + e.icon + '</span>' + escapeHtml(e.label) +
                    (e.key ? '<span class="fkx-menu-key">' + e.key + '</span>' : '') +
                  '</button>'
            ).join('');
            this.root.appendChild(menu);
            this.menuEl = menu;
            this.menuContext = { itemId, targetId: single && single.type === 'folder' ? single.id : null };

            const rootRect = this.root.getBoundingClientRect();
            const mw = menu.offsetWidth;
            const mh = menu.offsetHeight;
            let left = clientX - rootRect.left;
            let top = clientY - rootRect.top;
            if (left + mw > rootRect.width - 6) left = Math.max(6, rootRect.width - mw - 6);
            if (top + mh > rootRect.height - 6) top = Math.max(6, top - mh);
            if (top + mh > rootRect.height - 6) top = Math.max(6, rootRect.height - mh - 6);
            menu.style.left = left + 'px';
            menu.style.top = top + 'px';

            menu.addEventListener('click', ev => {
                const btn = ev.target.closest('[data-menu-cmd]');
                if (!btn || btn.disabled) return;
                ev.stopPropagation();
                const cmd = btn.dataset.menuCmd;
                const ctx = this.menuContext;
                this.closeMenu();
                if (cmd === 'pasteInto') this.command('paste', { source: 'menu', targetId: ctx.targetId });
                else if (cmd === 'properties' && !ctx.itemId) this.showProperties(this.currentId === RECYCLE_ID ? null : this.currentId);
                else this.command(cmd, { source: 'menu' });
            });
            const first = menu.querySelector('.fkx-menu-item:not(:disabled)');
            if (first && this.lastPointerType === 'mouse') first.focus({ preventScroll: true });
        }

        closeMenu() {
            if (this.menuEl) {
                this.menuEl.remove();
                this.menuEl = null;
            }
        }

        // ---------------- Parancsok ----------------

        command(cmd, options = {}) {
            switch (cmd) {
                case 'back': return this.back();
                case 'forward': return this.forward();
                case 'up': return this.up();
                case 'refresh': return this.render();
                case 'sidebar': return this.root.classList.toggle('is-side-open');
                case 'view':
                    this.view = this.view === 'icons' ? 'details' : 'icons';
                    return this.render();
                case 'dock':
                    return this.setDockVisible(!this.dockVisible);
                case 'newFolder': return this.doNewFolder();
                case 'open': {
                    const sel = this.selectedNodes();
                    if (sel.length === 1) return this.openNode(sel[0].id);
                    if (!sel.length) return notify('Előbb jelölj ki valamit!', 'info');
                    return;
                }
                case 'cut': return this.doClipboard('cut');
                case 'copy': return this.doClipboard('copy');
                case 'paste': return this.doPaste(options.targetId || this.currentId);
                case 'rename': return this.doRename();
                case 'delete':
                    if (this.currentId === RECYCLE_ID) return this.doDeletePermanent();
                    return this.doDelete(Array.from(this.selection), false, options.source || 'toolbar');
                case 'deletePermanent': return this.doDeletePermanent();
                case 'restore': return this.doRestore();
                case 'emptyBin': return this.doEmptyBin();
                case 'undo': return this.doUndo();
                case 'selectAll': return this.select(this.visibleNodes().map(n => n.id));
                case 'properties': {
                    const sel = this.selectedNodes();
                    return this.showProperties(sel.length === 1 ? sel[0].id : (this.currentId === RECYCLE_ID ? null : this.currentId));
                }
                default:
                    return null;
            }
        }

        doNewFolder() {
            if (this.currentId === RECYCLE_ID) return this.error('A Lomtárban nem lehet mappát létrehozni.');
            if (this.searchQuery) return this.error('Keresés közben nem lehet mappát létrehozni. Töröld a keresést!');
            if (!this.allowed('newFolder', [])) return;
            try {
                this.vfs.pushUndo('Új mappa');
                const node = this.vfs.createFolder(this.currentId, null);
                this.select([node.id], { silent: true });
                this.startRename(node.id, { isNew: true });
            } catch (e) {
                this.vfs.undoStack.pop();
                this.error(e);
            }
        }

        doClipboard(mode) {
            const nodes = this.selectedNodes();
            if (!nodes.length) return notify('Előbb jelölj ki egy fájlt vagy mappát!', 'info', this.opts.bitiErrors);
            if (this.currentId === RECYCLE_ID) return this.error('A Lomtárban lévő elemeket előbb állítsd vissza!');
            if (!this.allowed(mode, nodes)) return;
            try {
                this.vfs.setClipboard(mode, nodes.map(n => n.id));
                notify((mode === 'cut' ? '✂️ Kivágva: ' : '📋 Másolva: ') + (nodes.length === 1 ? this.vfs.displayName(nodes[0]) : nodes.length + ' elem'), 'success');
                this.emit('onClipboardChanged', { mode, nodes });
            } catch (e) {
                this.error(e);
            }
        }

        doPaste(targetId) {
            if (this.currentId === RECYCLE_ID && targetId === RECYCLE_ID) return this.error('A Lomtárba nem lehet beilleszteni.');
            const clip = this.vfs.clipboard;
            const sources = clip.ids.map(id => this.vfs.get(id)).filter(Boolean);
            if (!clip.mode || !sources.length) return notify('A vágólap üres. Előbb másolj (Ctrl+C) vagy vágj ki (Ctrl+X) valamit!', 'info', this.opts.bitiErrors);
            if (!this.allowed('paste', sources)) return;
            const fromIds = sources.map(n => n.parentId);
            try {
                this.vfs.pushUndo('Beillesztés');
                const res = this.vfs.paste(targetId);
                const toPath = this.vfs.getPath(targetId);
                if (res.mode === 'cut') {
                    if (!res.nodes.length) {
                        this.vfs.undoStack.pop();
                        return notify('Ezek az elemek már ebben a mappában vannak.', 'info');
                    }
                    this.emit('onFileMoved', { nodes: res.nodes, fromIds, toId: targetId, toPath, method: 'paste' });
                } else {
                    this.emit('onFileCopied', { sources, copies: res.nodes, toId: targetId, toPath, method: 'paste' });
                }
                if (targetId === this.currentId) this.select(res.nodes.map(n => n.id), { silent: true });
            } catch (e) {
                this.vfs.undoStack.pop();
                this.error(e);
            }
        }

        doMove(ids, targetId, method) {
            const nodes = ids.map(id => this.vfs.get(id)).filter(Boolean);
            if (!this.allowed('move', nodes)) return;
            const fromIds = nodes.map(n => n.parentId);
            try {
                this.vfs.pushUndo('Áthelyezés');
                const moved = this.vfs.move(ids, targetId);
                if (!moved.length) {
                    this.vfs.undoStack.pop();
                    return;
                }
                this.emit('onFileMoved', { nodes: moved.map(m => m.node), fromIds, toId: targetId, toPath: this.vfs.getPath(targetId), method });
            } catch (e) {
                this.vfs.undoStack.pop();
                this.error(e);
            }
        }

        doCopyTo(ids, targetId, method) {
            const sources = ids.map(id => this.vfs.get(id)).filter(Boolean);
            if (!this.allowed('copy', sources)) return;
            try {
                this.vfs.pushUndo('Másolás');
                const copies = this.vfs.copyTo(ids, targetId);
                this.emit('onFileCopied', { sources, copies, toId: targetId, toPath: this.vfs.getPath(targetId), method });
            } catch (e) {
                this.vfs.undoStack.pop();
                this.error(e);
            }
        }

        doRename() {
            const sel = this.selectedNodes();
            if (sel.length !== 1) return notify(sel.length ? 'Egyszerre csak egy elemet nevezhetsz át!' : 'Előbb jelölj ki egy fájlt vagy mappát!', 'info', this.opts.bitiErrors);
            if (this.currentId === RECYCLE_ID) return this.error('A Lomtárban lévő elemet előbb állítsd vissza!');
            if (sel[0].locked) return this.error('A(z) „' + this.vfs.displayName(sel[0]) + '” védett elem, nem lehet átnevezni.');
            if (!this.allowed('rename', sel)) return;
            this.startRename(sel[0].id);
        }

        startRename(id, options = {}) {
            const el = this.itemEl(id);
            const node = this.vfs.get(id);
            if (!el || !node) return;
            const nameEl = el.querySelector('.fkx-item-name');
            const input = document.createElement('input');
            input.className = 'fkx-rename';
            input.type = 'text';
            input.value = this.vfs.displayName(node);
            input.spellcheck = false;
            input.setAttribute('aria-label', 'Új név');
            nameEl.replaceWith(input);
            this.renaming = { id, input, isNew: !!options.isNew, original: input.value };
            input.focus();
            const dot = node.type === 'file' ? input.value.lastIndexOf('.') : -1;
            input.setSelectionRange(0, dot > 0 ? dot : input.value.length);

            input.addEventListener('keydown', ev => {
                ev.stopPropagation();
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    this.finishRename(true);
                } else if (ev.key === 'Escape') {
                    ev.preventDefault();
                    this.finishRename(false);
                }
            });
            input.addEventListener('blur', () => this.finishRename(true));
            input.addEventListener('pointerdown', ev => ev.stopPropagation());
        }

        finishRename(commit) {
            const r = this.renaming;
            if (!r) return;
            this.renaming = null;
            const node = this.vfs.get(r.id);
            const value = r.input.value.trim();
            let renamed = null;
            if (node && commit && value && value !== r.original) {
                const parts = VFS.splitName(value);
                if (node.type === 'file' && node.ext && parts.ext !== node.ext && !r.isNew) {
                    notify('Figyelem! Megváltoztattad a kiterjesztést (' + (node.ext || 'nincs') + ' → ' + (parts.ext || 'nincs') + '). Emiatt a fájl lehet, hogy nem nyílik meg!', 'warn', this.opts.bitiErrors);
                }
                try {
                    if (!r.isNew) this.vfs.pushUndo('Átnevezés');
                    renamed = this.vfs.rename(r.id, value);
                } catch (e) {
                    if (!r.isNew) this.vfs.undoStack.pop();
                    this.error(e);
                }
            }
            this.render();
            if (r.isNew && node && this.vfs.get(r.id)) {
                const fresh = this.vfs.get(r.id);
                this.select([r.id], { silent: true });
                this.emit('onFolderCreated', { node: fresh, parentId: fresh.parentId, path: this.vfs.getPath(fresh.id), name: fresh.name });
            } else if (renamed) {
                this.emit('onFileRenamed', { node: renamed.node, oldName: renamed.oldName, newName: renamed.newName, extChanged: renamed.extChanged, path: this.vfs.getPath(renamed.node.id) });
            }
            this.root.focus({ preventScroll: true });
        }

        doDelete(ids, permanent, method = 'toolbar') {
            const nodes = ids.map(id => this.vfs.get(id)).filter(Boolean);
            if (!nodes.length) return notify('Előbb jelölj ki valamit, amit törölni szeretnél!', 'info', this.opts.bitiErrors);
            const locked = nodes.find(n => n.locked);
            if (locked) return this.error('A(z) „' + this.vfs.displayName(locked) + '” rendszermappa vagy védett elem, nem lehet törölni.');
            if (!this.allowed(permanent ? 'deletePermanent' : 'delete', nodes)) return;
            try {
                this.vfs.pushUndo('Törlés');
                const deleted = permanent ? this.vfs.deletePermanently(ids) : this.vfs.delete(ids);
                this.selection.clear();
                this.render();
                notify((permanent ? '❌ Véglegesen törölve: ' : '🗑️ Lomtárba helyezve: ') + (deleted.length === 1 ? this.vfs.displayName(deleted[0]) : deleted.length + ' elem'), 'success');
                this.emit('onFileDeleted', { nodes: deleted, permanent, method });
            } catch (e) {
                this.vfs.undoStack.pop();
                this.error(e);
            }
        }

        async doDeletePermanent() {
            const nodes = this.selectedNodes();
            if (!nodes.length) return notify('Előbb jelölj ki valamit!', 'info', this.opts.bitiErrors);
            const ok = await this.confirm('Biztosan véglegesen törlöd? ' + (nodes.length === 1 ? '„' + this.vfs.displayName(nodes[0]) + '”' : nodes.length + ' elem') + ' nem hozható vissza!', 'Végleges törlés');
            if (ok) this.doDelete(nodes.map(n => n.id), true);
        }

        doRestore() {
            const nodes = this.selectedNodes().filter(n => n.isDeleted);
            if (!nodes.length) return notify('Jelöld ki, mit szeretnél visszaállítani!', 'info', this.opts.bitiErrors);
            if (!this.allowed('restore', nodes)) return;
            this.vfs.pushUndo('Visszaállítás');
            const restored = this.vfs.restore(nodes.map(n => n.id));
            this.selection.clear();
            this.render();
            notify('♻️ Visszaállítva: ' + (restored.length === 1 ? this.vfs.displayName(restored[0]) + ' → ' + this.vfs.getPath(restored[0].parentId) : restored.length + ' elem'), 'success');
            this.emit('onFileRestored', { nodes: restored, paths: restored.map(n => this.vfs.getPath(n.id)) });
        }

        async doEmptyBin() {
            const items = this.vfs.recycleBinItems();
            if (!items.length) return notify('A Lomtár már üres.', 'info');
            if (!this.allowed('emptyBin', items)) return;
            const ok = await this.confirm('Biztosan kiüríted a Lomtárt? ' + items.length + ' elem végleg eltűnik!', 'Lomtár ürítése');
            if (!ok) return;
            this.vfs.pushUndo('Lomtár ürítése');
            const removed = this.vfs.emptyRecycleBin();
            this.selection.clear();
            this.render();
            notify('🧹 A Lomtár kiürítve.', 'success');
            this.emit('onFileDeleted', { nodes: removed, permanent: true, method: 'emptyBin' });
            this.emit('onRecycleBinEmptied', { count: removed.length, nodes: removed });
        }

        doUndo() {
            if (this.renaming) this.finishRename(false);
            const label = this.vfs.undo();
            if (!label) return notify('Nincs mit visszavonni.', 'info');
            this.selection.clear();
            this.render();
            notify('↶ Visszavonva: ' + label, 'success');
            this.emit('onUndo', { label });
        }

        confirm(text, okLabel) {
            if (typeof FK.confirmDialog === 'function') return FK.confirmDialog(text, okLabel, 'danger', 'Megerősítés');
            return Promise.resolve(window.confirm(text));
        }

        // ---------------- Megnyitás, előnézet, tulajdonságok ----------------

        openNode(id) {
            const node = this.vfs.get(id);
            if (!node) return;
            if (this.currentId === RECYCLE_ID || node.isDeleted) {
                notify('A Lomtárban lévő elemet nem lehet megnyitni. Előbb állítsd vissza! ♻️', 'info', this.opts.bitiErrors);
                return;
            }
            if (node.type === 'folder') {
                if (!this.allowed('openFolder', [node])) return;
                this.navigate(node.id);
                return;
            }
            if (!this.allowed('openFile', [node])) return;
            this.showPreview(node);
            this.emit('onFileOpened', { node, path: this.vfs.getPath(node.id) });
        }

        previewHtml(node) {
            const t = fileType(node.ext);
            const content = String(node.content || '');
            const meta = '<div class="fkx-preview-meta">' + escapeHtml(t.label) + ' · ' + formatSize(node.size) + ' · ' + escapeHtml(this.vfs.getPath(node.id)) + '</div>';
            switch (t.kind) {
                case 'text':
                    return '<div class="fkx-preview"><div class="fkx-preview-text">' + escapeHtml(content || '(Ez a szöveges fájl üres.)') + '</div>' + meta + '</div>';
                case 'doc':
                case 'pdf':
                case 'sheet':
                    return '<div class="fkx-preview"><div class="fkx-preview-doc">' + escapeHtml(content || 'Ez a dokumentum még üres. Írhatnál bele valami szépet! ✍️') + '</div>' + meta + '</div>';
                case 'image':
                    return '<div class="fkx-preview"><div class="fkx-preview-image" role="img" aria-label="' + escapeHtml(node.name) + '">' + escapeHtml(content && content.length <= 4 ? content : '🖼️') + '</div>' +
                        (content && content.length > 4 ? '<p class="fkx-preview-meta">' + escapeHtml(content) + '</p>' : '') + meta + '</div>';
                case 'slides':
                    return '<div class="fkx-preview"><div class="fkx-preview-slide">' + escapeHtml(content || node.name) + '</div>' + meta + '</div>';
                case 'audio':
                case 'video':
                    return '<div class="fkx-preview"><div class="fkx-preview-audio">' +
                        '<div style="font-size:3rem" aria-hidden="true">' + (t.kind === 'audio' ? '🎵' : '🎬') + '</div>' +
                        '<strong>' + escapeHtml(content || node.name) + '</strong>' +
                        '<div class="fkx-eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
                        '<button type="button" class="fkx-play" data-play aria-label="Lejátszás">▶</button>' +
                        '</div>' + meta + '</div>';
                case 'app':
                    return '<div class="fkx-preview"><div class="fkx-preview-warn">⚠️ <strong>Ez egy program (alkalmazás).</strong><br><br>' +
                        'Az <strong>.exe</strong> fájlok programokat indítanak el. Csak akkor futtass programot, ha tudod, honnan származik, és egy felnőtt megengedte! ' +
                        'A Fájl-Kalandban biztonsági okból nem indítunk el programokat. 🛡️</div>' + meta + '</div>';
                case 'zip':
                    return '<div class="fkx-preview"><div class="fkx-preview-warn" style="background:#fefce8;border-color:#facc15">🗜️ <strong>Tömörített mappa.</strong><br><br>' +
                        'A .zip fájlban több fájl van „összenyomva”, hogy kevesebb helyet foglaljanak. Kicsomagolás után lehet használni őket.</div>' + meta + '</div>';
                default:
                    return '<div class="fkx-preview"><div class="fkx-preview-warn" style="background:#f1f5f9;border-color:#cbd5e1">❓ Ehhez a fájltípushoz (' + escapeHtml(node.ext || 'nincs kiterjesztés') + ') nincs program, ami megnyitná.</div>' + meta + '</div>';
            }
        }

        bindPreview(body) {
            const play = body.querySelector('[data-play]');
            if (!play) return;
            play.addEventListener('click', () => {
                const box = body.querySelector('.fkx-preview-audio');
                const on = !box.classList.contains('is-playing');
                box.classList.toggle('is-playing', on);
                play.textContent = on ? '⏸' : '▶';
                play.setAttribute('aria-label', on ? 'Szünet' : 'Lejátszás');
            });
        }

        showPreview(node) {
            const title = this.vfs.displayName(node);
            if (this.opts.windowPreview && typeof FK.openWindow === 'function' && FK.WindowManager) {
                const winId = 'preview-' + node.id;
                if (FK.WindowManager.get(winId)) FK.WindowManager.close(winId);
                FK.openWindow({
                    id: winId,
                    title,
                    icon: fileType(node.ext).kind === 'image' ? '🖼️' : '📄',
                    width: 520,
                    height: 440,
                    render: body => {
                        body.innerHTML = this.previewHtml(node);
                        this.bindPreview(body);
                    }
                });
                return;
            }
            this.showDialog(title, this.previewHtml(node), nodeIcon(node, 28), body => this.bindPreview(body));
        }

        showProperties(id) {
            if (!id) {
                const items = this.vfs.recycleBinItems();
                const size = items.reduce((a, n) => a + this.vfs.stats(n.id).size + (n.type === 'file' ? 0 : 0), 0);
                this.showDialog('Lomtár – Tulajdonságok', '<dl class="fkx-props"><dt>Elemek:</dt><dd>' + items.length + '</dd><dt>Méret:</dt><dd>' + formatSize(size) + '</dd></dl>', '🗑️');
                return;
            }
            const node = this.vfs.get(id);
            if (!node) return;
            const isFolder = node.type === 'folder';
            const st = this.vfs.stats(id);
            const rows = [
                ['Név', this.vfs.displayName(node)],
                ['Típus', isFolder ? (id === 'root' ? 'Helyi lemez' : 'Fájlmappa') : fileType(node.ext).label + ' (' + node.ext + ')'],
                ['Hely', node.isDeleted ? 'Lomtár (innen: ' + (node.deletedFrom || '') + ')' : (node.parentId ? this.vfs.getPath(node.parentId) : '–')],
                ['Teljes útvonal', this.vfs.getPath(id)],
                ['Méret', formatSize(st.size) + ' (' + st.size.toLocaleString('hu-HU') + ' bájt)']
            ];
            if (isFolder) rows.push(['Tartalom', st.files + ' fájl, ' + st.folders + ' mappa']);
            rows.push(['Létrehozva', formatDate(node.created)]);
            rows.push(['Módosítva', formatDate(node.modified)]);
            if (node.locked) rows.push(['Védelem', '🔒 Rendszerelem (nem törölhető, nem nevezhető át)']);
            const html = '<dl class="fkx-props">' + rows.map(r => '<dt>' + escapeHtml(r[0]) + ':</dt><dd>' + escapeHtml(r[1]) + '</dd>').join('') + '</dl>';
            this.showDialog(this.vfs.displayName(node) + ' – Tulajdonságok', html, nodeIcon(node, 28));
            this.emit('onPropertiesOpened', { node });
        }

        showDialog(title, bodyHtml, iconHtml, after) {
            const overlay = document.createElement('div');
            overlay.className = 'fkx-overlay';
            overlay.innerHTML =
                '<div class="fkx-dialog" role="dialog" aria-modal="true" aria-label="' + escapeHtml(title) + '">' +
                    '<div class="fkx-dialog-head">' + (iconHtml || '') + '<span class="fkx-dialog-title">' + escapeHtml(title) + '</span>' +
                    '<button type="button" class="fkx-dialog-close" aria-label="Bezárás">✕</button></div>' +
                    '<div class="fkx-dialog-body">' + bodyHtml + '</div>' +
                '</div>';
            this.root.appendChild(overlay);
            const close = () => overlay.remove();
            overlay.addEventListener('click', ev => {
                if (ev.target === overlay || ev.target.closest('.fkx-dialog-close')) close();
            });
            overlay.addEventListener('keydown', ev => {
                if (ev.key === 'Escape') close();
                ev.stopPropagation();
            });
            overlay.querySelector('.fkx-dialog-close').focus();
            if (after) after(overlay.querySelector('.fkx-dialog-body'));
        }

        // ---------------- Billentyűzet és virtuális dokkoló ----------------

        setDockVisible(on) {
            this.dockVisible = !!on;
            if (!on) this.dockCtrl = false;
            this.renderToolbar();
            this.renderDock();
            this.renderContent();
        }

        /** Gyorsbillentyű végrehajtása (fizikai billentyűzetről vagy a dokkolóról). */
        runShortcut(combo, source) {
            const cmd = SHORTCUT_COMMANDS[combo];
            if (!cmd) return false;
            this.emit('onShortcutUsed', { combo, command: cmd, source });
            this.command(cmd, { source: 'shortcut' });
            return true;
        }

        pressDockKey(key) {
            const btn = this.el.dock.querySelector('[data-key="' + key + '"]');
            if (btn) {
                btn.classList.add('is-pressed');
                setTimeout(() => btn.classList.remove('is-pressed'), 120);
            }
            if (key === 'ctrl') {
                this.dockCtrl = !this.dockCtrl;
                this.renderDock();
                this.root.classList.toggle('is-dock-ctrl', this.dockCtrl);
                return;
            }
            if (key === 'delete') return this.runShortcut('Delete', 'dock');
            if (key === 'f2') return this.runShortcut('F2', 'dock');
            const letter = key.toUpperCase();
            if (!this.dockCtrl) {
                notify('A „' + letter + '” gomb önmagában csak egy betű. Kapcsold be előbb a Ctrl gombot! 😉', 'info', this.opts.bitiErrors);
                this.emit('onShortcutMissed', { key: letter, source: 'dock' });
                return;
            }
            this.runShortcut('Ctrl+' + letter, 'dock');
        }

        handleKeyDown(ev) {
            if (ev.key === 'Control' || ev.key === 'Meta') {
                if (!this.physicalCtrl) {
                    this.physicalCtrl = true;
                    if (this.dockVisible) this.renderDock();
                }
                return;
            }
            const target = ev.target;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
            if (this.root.querySelector('.fkx-overlay')) return;
            if (ev.key === 'Escape') {
                if (this.menuEl) this.closeMenu();
                else this.clearSelection();
                return;
            }
            const ctrl = ev.ctrlKey || ev.metaKey;
            let key = ev.key.length === 1 ? ev.key.toUpperCase() : ev.key;
            if (key === 'Del') key = 'Delete';
            let combo = '';
            if (ctrl) combo += 'Ctrl+';
            if (ev.altKey) combo += 'Alt+';
            if (ev.shiftKey && (ctrl || key === 'Delete')) combo += 'Shift+';
            combo += key;
            if (!SHORTCUT_COMMANDS[combo]) return;
            ev.preventDefault();
            this.runShortcut(combo, 'keyboard');
        }

        handleKeyUp(ev) {
            if ((ev.key === 'Control' || ev.key === 'Meta') && this.physicalCtrl) {
                this.physicalCtrl = false;
                if (this.dockVisible) this.renderDock();
            }
        }

        isVisible() {
            return this.root.isConnected && this.root.offsetParent !== null;
        }

        // ---------------- Életciklus ----------------

        destroy() {
            if (this.destroyed) return;
            this.destroyed = true;
            this.cleanupDrag();
            this.closeMenu();
            this.vfs.off('change', this.onVfsChange);
            if (this.resizeObserver) this.resizeObserver.disconnect();
            this.root.remove();
            Explorer.instances.delete(this);
            if (Explorer.active === this) Explorer.active = null;
        }
    }

    Explorer.instances = new Set();
    Explorer.active = null;

    // Egyetlen globális billentyűfigyelő: mindig az utoljára használt, látható Fájlkezelő kapja
    document.addEventListener('keydown', ev => {
        const ex = Explorer.active;
        if (!ex || ex.destroyed || !ex.isVisible()) return;
        const win = ex.root.closest('.fk-window');
        if (win && !win.classList.contains('is-active')) return;
        ex.handleKeyDown(ev);
    });
    document.addEventListener('keyup', ev => {
        Explorer.instances.forEach(ex => ex.handleKeyUp(ev));
    });
    window.addEventListener('blur', () => {
        Explorer.instances.forEach(ex => {
            if (ex.physicalCtrl) {
                ex.physicalCtrl = false;
                if (ex.dockVisible) ex.renderDock();
            }
        });
    });

    FK.Explorer = Explorer;
    FK.VirtualExplorer = Explorer; // álnév: a specifikációban „VirtualExplorer” néven szerepel

    /** Fájlkezelő megnyitása saját ablakban. Visszatér: Explorer példány. */
    FK.openExplorer = function (opts = {}) {
        const winId = opts.windowId || 'explorer';
        if (typeof FK.openWindow !== 'function') return null;
        const existing = FK.WindowManager && FK.WindowManager.get(winId);
        if (existing && existing.data.explorer) {
            FK.WindowManager.focus(winId);
            return existing.data.explorer;
        }
        let explorer = null;
        FK.openWindow({
            id: winId,
            title: opts.title || 'Fájlkezelő',
            icon: opts.icon || '🗂️',
            width: opts.width || 980,
            height: opts.height || 620,
            className: 'fk-explorer-window',
            render(body, win) {
                body.style.overflow = 'hidden';
                explorer = new Explorer(body, opts);
                win.data.explorer = explorer;
            },
            onFocus(win) {
                if (win.data.explorer) Explorer.active = win.data.explorer;
            },
            onClose(win) {
                if (typeof opts.onClose === 'function') opts.onClose(win.data.explorer);
                if (win.data.explorer) win.data.explorer.destroy();
            }
        });
        return explorer;
    };

    // ======================================================================
    // SZABAD GYAKORLÓ FÁJLKEZELŐ AZ ASZTALON (a diák saját, mentett fájlrendszere)
    // ======================================================================
    function sandboxKey() {
        const u = FK.state && FK.state.user;
        return 'fk-explorer-sandbox-' + (u ? u.id : 'vendeg');
    }

    function loadSandbox() {
        try {
            const raw = localStorage.getItem(sandboxKey());
            if (raw) return VFS.fromJSON(raw);
        } catch (e) { /* sérült vagy nem elérhető tároló: új fájlrendszert adunk */ }
        const u = FK.state && FK.state.user;
        const first = u && u.name ? String(u.name).trim().split(/\s+/).pop() : 'Diák';
        return VFS.createDefault({ userName: first });
    }

    let saveTimer = null;
    function saveSandbox(vfs) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try {
                localStorage.setItem(sandboxKey(), JSON.stringify(vfs.toJSON()));
            } catch (e) { /* a mentés nem kötelező */ }
        }, 400);
    }

    if (typeof FK.registerApp === 'function') {
        FK.registerApp({
            id: 'explorer',
            name: 'Fájlkezelő',
            icon: '🗂️',
            desktop: true,
            open() {
                const vfs = loadSandbox();
                vfs.on('change', () => saveSandbox(vfs));
                FK.openExplorer({ vfs, startId: 'documents', title: 'Fájlkezelő – szabad gyakorlás' });
                if (FK.Biti && typeof FK.Biti.say === 'function') {
                    FK.Biti.say('Ez a te saját gyakorló Fájlkezelőd! Bátran próbálgass: itt semmit sem ronthatsz el. A ↶ Visszavonás gomb mindig segít! 🙂', { mood: 'happy' });
                }
            }
        });
    }
})();
