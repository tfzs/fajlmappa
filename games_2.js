/* ==========================================================================
   Fájl-Kaland – games_2.js
   A további három, történetvezérelt és szimulátoros játékmodul:
     4. Káosz Kapitány Szobája          (Rendrakós szimulátor és Fájlnév-szépségverseny)
     5. Lomtár-mentőakció és Vírusvadász (Visszaállítás, gyanús .exe fájlok, Lomtár ürítése)
     6. A Digitális Detektív             (Nyomozós kaland, 6 véletlenszerű esettel)

   Integráció:
     - FK.registerGame(...) – core.js (játékablak, AdaptiveEngine, Biti)
     - ctx.newTask() / ctx.error(hint) / ctx.complete() / ctx.fail() / ctx.setHint() / ctx.onLevelChange()
     - FK.VFS és FK.Explorer – explorer.js (mindhárom játék a szimulált Fájlkezelőben zajlik)
     - FK.GameKit – a games_1.js közös játékkerete (fejléc, összegzés, mentés),
       ezért a games_2.js-nek a games_1.js UTÁN kell betöltődnie.
   Minden játék az aktuális nehézségi szinthez (1–5) igazodik; a szint a kör
   elején a ctx.level értékéből kerül kiolvasásra.
   ========================================================================== */

(function () {
    'use strict';

    const FK = window.FK = window.FK || {};
    const KIT = FK.GameKit;

    if (!KIT || !FK.VFS || !FK.Explorer) {
        console.warn('Fájl-Kaland: a games_2.js-hez a core.js, az explorer.js és a games_1.js szükséges (ebben a sorrendben).');
        return;
    }

    const { escapeHtml, shuffle, pick, sample, normalizeName, say, createShell, finishRound, makeGame } = KIT;

    // ======================================================================
    // SEGÉDFÜGGVÉNYEK
    // ======================================================================
    function userFirstName() {
        const user = FK.state && FK.state.user;
        if (!user || !user.name) return 'Diák';
        const parts = String(user.name).trim().split(/\s+/);
        return parts[parts.length - 1] || 'Diák';
    }

    /** Alap Windows-szerű fájlrendszer, az alapmappák üresen. */
    function makeBaseVfs() {
        const vfs = FK.VFS.createDefault({ userName: userFirstName(), empty: true });
        vfs.undoStack = [];
        return vfs;
    }

    function splitFull(fullName) {
        return FK.VFS.splitName(fullName);
    }

    /** Egy mappa közvetlen almappája név szerint (ékezet- és kisbetű-érzéketlenül). */
    function findChildFolder(vfs, parentId, name) {
        const target = normalizeName(name);
        return vfs.children(parentId).find(n => n.type === 'folder' && normalizeName(n.name) === target) || null;
    }

    /** Relatív útvonal (név-tömb) feloldása egy kiinduló mappától. */
    function resolveRel(vfs, rootId, rel) {
        let cur = rootId;
        for (const part of rel) {
            const next = findChildFolder(vfs, cur, part);
            if (!next) return null;
            cur = next.id;
        }
        return cur;
    }

    /** Mappák létrehozása (ha még nincsenek), és a legmélyebb mappa azonosítója. */
    function ensurePath(vfs, baseId, names) {
        let cur = baseId;
        names.forEach(name => {
            const existing = findChildFolder(vfs, cur, name);
            if (existing) {
                cur = existing.id;
            } else {
                const [created] = vfs.build(cur, [{ name, type: 'folder' }]);
                cur = created.id;
            }
        });
        return cur;
    }

    function addFile(vfs, parentId, fullName, content) {
        const [node] = vfs.build(parentId, [{ name: fullName, type: 'file', content: content || '' }]);
        return node;
    }

    // ======================================================================
    // STÍLUSOK
    // ======================================================================
    const STYLES = `
/* ---------- Küldetés-elrendezés (panel + Fájlkezelő) ---------- */
.fkq { display: flex; height: 100%; min-height: 0; }
.fkq-panel {
    width: 300px; flex-shrink: 0; display: flex; flex-direction: column; gap: .7rem; padding: .8rem;
    overflow-y: auto; background: #fff; border-right: 1px solid #e2e8f0; user-select: text; -webkit-user-select: text;
}
.fkq-explorer { position: relative; flex: 1; min-width: 0; min-height: 0; }
.fkq-story {
    padding: .7rem .85rem; border-radius: 1rem; background: linear-gradient(135deg, #eef2ff, #f5f3ff);
    border: 1px solid #c7d2fe; font-weight: 700; font-size: .88rem; line-height: 1.45; color: #312e81;
}
.fkq-story h4 { margin: 0 0 .3rem; font-family: 'Baloo 2', 'Nunito', sans-serif; font-size: 1.08rem; font-weight: 800; color: #1e1b4b; }
.fkq-rule {
    padding: .55rem .7rem; border-radius: .8rem; background: #fef9c3; border: 1px dashed #eab308;
    font-size: .84rem; font-weight: 700; line-height: 1.4; color: #713f12;
}
.fkq-rule b { color: #422006; }
.fkq-section-title { font-size: .74rem; font-weight: 900; text-transform: uppercase; letter-spacing: .06em; color: #64748b; }
.fkq-tasks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .35rem; }
.fkq-task {
    display: flex; align-items: flex-start; gap: .45rem; padding: .42rem .6rem; border-radius: .7rem;
    background: #f8fafc; border: 1px solid #e2e8f0; font-size: .85rem; font-weight: 700; line-height: 1.35; color: #334155;
    transition: background .2s, border-color .2s;
}
.fkq-task-mark {
    flex-shrink: 0; width: 1.25rem; height: 1.25rem; margin-top: .05rem; border-radius: 50%; border: 2px solid #94a3b8;
    display: inline-flex; align-items: center; justify-content: center; font-size: .75rem; font-weight: 900; color: #fff;
}
.fkq-task.is-done { background: #dcfce7; border-color: #86efac; color: #166534; }
.fkq-task.is-done .fkq-task-mark { background: #22c55e; border-color: #22c55e; }
.fkq-task.is-locked { opacity: .5; }
.fkq-task.is-just-done { animation: fkq-flash .7s ease-out; }
.fkq-task code, .fkq-rule code, .fkq-story code {
    font-family: Consolas, 'Courier New', monospace; font-size: .8rem; background: rgba(15, 23, 42, .08);
    padding: 0 .25rem; border-radius: .3rem; word-break: break-all;
}
.fkq-meter { height: 10px; border-radius: 999px; background: #e2e8f0; overflow: hidden; }
.fkq-meter i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #22c55e, #4ade80); border-radius: 999px; transition: width .4s ease; }
@keyframes fkq-flash { 0% { transform: scale(1); } 40% { transform: scale(1.04); box-shadow: 0 0 0 4px rgba(34, 197, 94, .35); } 100% { transform: scale(1); } }
@media (max-width: 820px) {
    .fkq { flex-direction: column; }
    .fkq-panel { width: auto; max-height: 42%; border-right: 0; border-bottom: 1px solid #e2e8f0; }
}

/* ---------- 4. Káosz Kapitány ---------- */
.fkg4-captain { display: flex; align-items: center; gap: .6rem; }
.fkg4-captain-face { font-size: 2.4rem; line-height: 1; animation: fkg4-wobble 2.4s ease-in-out infinite; }
@keyframes fkg4-wobble { 0%, 100% { transform: rotate(-6deg); } 50% { transform: rotate(6deg); } }

/* ---------- 5. Lomtár-mentő és Vírusvadász ---------- */
.fkg5-phase { display: flex; align-items: center; gap: .4rem; font-weight: 900; font-size: .9rem; color: #0f172a; }
.fkg5-phase span { display: inline-flex; align-items: center; justify-content: center; width: 1.5rem; height: 1.5rem; border-radius: 50%; background: #e2e8f0; font-size: .8rem; }
.fkg5-phase.is-active span { background: #2563eb; color: #fff; }
.fkg5-phase.is-done span { background: #22c55e; color: #fff; }
.fkg5-alert {
    padding: .55rem .7rem; border-radius: .8rem; background: #fee2e2; border: 1px solid #fca5a5;
    font-size: .84rem; font-weight: 800; color: #991b1b; line-height: 1.4;
}
.fkg5-virus-list { margin: .3rem 0 0; padding-left: 1.1rem; font-size: .8rem; }

/* ---------- 6. Digitális Detektív ---------- */
.fkg6-notebook {
    position: relative; padding: .7rem .85rem .8rem 1.6rem; border-radius: .9rem; border: 1px solid #fcd34d;
    background: #fffbeb repeating-linear-gradient(180deg, transparent 0 1.55rem, rgba(217, 119, 6, .18) 1.55rem 1.6rem);
    box-shadow: 0 6px 14px rgba(120, 53, 15, .12);
}
.fkg6-notebook::before { content: ''; position: absolute; left: .9rem; top: 0; bottom: 0; width: 2px; background: rgba(239, 68, 68, .45); }
.fkg6-notebook h4 { margin: 0 0 .35rem; font-family: 'Baloo 2', 'Nunito', sans-serif; font-size: 1.02rem; font-weight: 800; color: #78350f; }
.fkg6-clues { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .2rem; }
.fkg6-clue { font-size: .86rem; font-weight: 800; color: #92400e; line-height: 1.4; }
.fkg6-clue.is-missing { color: #a8a29e; font-weight: 700; }
.fkg6-clue b { font-family: Consolas, 'Courier New', monospace; letter-spacing: .08em; color: #b45309; }
.fkg6-form { display: flex; flex-direction: column; gap: .45rem; }
.fkg6-form label { font-weight: 900; font-size: .86rem; color: #1e293b; }
.fkg6-form-row { display: flex; gap: .4rem; }
.fkg6-input {
    flex: 1; min-width: 0; height: 46px; padding: 0 .75rem; border-radius: .8rem; border: 2px solid #cbd5e1;
    font: inherit; font-family: Consolas, 'Courier New', monospace; font-size: 1.1rem; font-weight: 800; letter-spacing: .1em;
    text-transform: uppercase; background: #fff; color: #0f172a; user-select: text; -webkit-user-select: text;
}
.fkg6-input:focus { outline: none; border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99, 102, 241, .25); }
.fkg6-input.is-wrong { border-color: #ef4444; animation: fkg-shake .45s ease-in-out; }
.fkg6-submit {
    height: 46px; padding: 0 1rem; border-radius: .8rem; background: #4f46e5; color: #fff; font-family: 'Baloo 2', 'Nunito', sans-serif;
    font-weight: 800; font-size: 1rem; box-shadow: 0 4px 0 #3730a3;
}
.fkg6-submit:active { transform: translateY(2px); box-shadow: 0 2px 0 #3730a3; }
`;

    function injectStyles() {
        if (typeof KIT.injectStyles === 'function') KIT.injectStyles();
        if (document.getElementById('fkg2x-styles')) return;
        const style = document.createElement('style');
        style.id = 'fkg2x-styles';
        style.textContent = STYLES;
        document.head.appendChild(style);
    }

    // ======================================================================
    // KÖZÖS KÜLDETÉS-ALAP (panel + Fájlkezelő + feladatlista)
    // ======================================================================
    class QuestBase {
        constructor(container, ctx, shellOpts) {
            injectStyles();
            this.ctx = ctx;
            this.shell = createShell(container, ctx, shellOpts);
            this.explorer = null;
            this.vfs = null;
            this.finished = false;
            this.errors = 0;
            this.doneKeys = new Set();
            this.onVfsChange = () => this.scheduleEvaluate();
            this.evalTimer = null;
            ctx.setHint(() => this.hint());
        }

        /** Az elrendezés felépítése: bal oldalon a küldetés-panel, jobb oldalon a Fájlkezelő. */
        layout(panelHtml) {
            this.destroyExplorer();
            this.shell.body.innerHTML =
                '<div class="fkq">' +
                    '<aside class="fkq-panel">' + panelHtml + '</aside>' +
                    '<div class="fkq-explorer"></div>' +
                '</div>';
            this.panel = this.shell.body.querySelector('.fkq-panel');
            this.explorerEl = this.shell.body.querySelector('.fkq-explorer');
        }

        mountExplorer(opts) {
            this.destroyExplorer();
            this.explorer = new FK.Explorer(this.explorerEl, Object.assign({
                vfs: this.vfs,
                showSidebar: true,
                showDock: null,
                windowPreview: false
            }, opts));
            this.vfs.on('change', this.onVfsChange);
        }

        destroyExplorer() {
            if (this.vfs) this.vfs.off('change', this.onVfsChange);
            if (this.explorer) this.explorer.destroy();
            this.explorer = null;
        }

        /** Feladatlista kirajzolása. tasks: [{ key, html, done, locked }] */
        renderTasks(el, tasks) {
            if (!el) return;
            el.innerHTML = tasks.map(t => {
                const justDone = t.done && !this.doneKeys.has(t.key);
                if (t.done) this.doneKeys.add(t.key);
                else this.doneKeys.delete(t.key);
                return '<li class="fkq-task' + (t.done ? ' is-done' : '') + (t.locked && !t.done ? ' is-locked' : '') + (justDone ? ' is-just-done' : '') + '">' +
                    '<span class="fkq-task-mark" aria-hidden="true">' + (t.done ? '✓' : '') + '</span>' +
                    '<span>' + t.html + '</span>' +
                '</li>';
            }).join('');
        }

        setMeter(el, done, total) {
            if (!el) return;
            const pct = total ? Math.round(done / total * 100) : 0;
            el.querySelector('i').style.width = pct + '%';
            el.setAttribute('aria-valuenow', String(pct));
        }

        scheduleEvaluate() {
            if (this.finished || !this.shell.alive) return;
            clearTimeout(this.evalTimer);
            this.evalTimer = setTimeout(() => {
                if (!this.finished && this.shell.alive) this.evaluate();
            }, 60);
        }

        addError(hint) {
            this.errors++;
            this.shell.setErrors(this.errors);
            this.shell.feedback('✖ Hoppá!', 'bad');
            this.ctx.error(hint);
        }

        finish(lines) {
            if (this.finished) return;
            this.finished = true;
            setTimeout(() => {
                if (!this.shell.alive) return;
                finishRound(this.ctx, this.shell, {
                    success: true,
                    errors: this.errors,
                    lines: lines.concat(['❌ Hibák: ' + this.errors]),
                    onNext: () => this.startRound()
                });
            }, 900);
        }

        flashIfVisible(id) {
            if (!this.explorer || !id) return;
            const node = this.vfs.get(id);
            if (node && node.parentId === this.explorer.currentId) this.explorer.flash(id);
        }

        destroy() {
            this.shell.alive = false;
            clearTimeout(this.evalTimer);
            this.destroyExplorer();
        }
    }

    // ======================================================================
    // 4. JÁTÉK – KÁOSZ KAPITÁNY SZOBÁJA
    // ======================================================================
    const G4_SCHOOL = {
        Matek: [
            { name: 'szorzotabla_gyakorlo.xlsx', content: '2×3=6\n3×4=12\n5×6=30\n7×8=56' },
            { name: 'tortek_feladatlap.docx', content: 'Törtek gyakorlása\n1) 1/2 + 1/4 = ?\n2) 3/4 – 1/4 = ?' },
            { name: 'geometria_jegyzet.pdf', content: 'A négyzet minden oldala egyenlő hosszú. A téglalap szemközti oldalai egyenlők.' },
            { name: 'fejszamolas_verseny.txt', content: 'Fejszámolóverseny eredményei: 1. hely – 4.a osztály' }
        ],
        Magyar: [
            { name: 'fogalmazas_a_nyarrol.docx', content: 'Az én nyaram\n\nIdén nyáron a nagymamámnál voltam vidéken…' },
            { name: 'olvasonaplo_Pal_utcai_fiuk.txt', content: 'Könyv: A Pál utcai fiúk\nÍró: Molnár Ferenc\nKedvenc szereplőm: Nemecsek' },
            { name: 'versek_gyujtemeny.pdf', content: 'Petőfi Sándor: Anyám tyúkja\nWeöres Sándor: Bóbita' },
            { name: 'helyesiras_szabalyok.docx', content: 'A j hangot ly-nal írjuk például ezekben: folyó, gólya, király.' }
        ],
        Környezet: [
            { name: 'vizkorforgas.pptx', content: '1. dia: A víz körforgása\n2. dia: Párolgás\n3. dia: Csapadék' },
            { name: 'novenyek_reszei.txt', content: 'A növény részei: gyökér, szár, levél, virág, termés.' },
            { name: 'idojaras_naplo.xlsx', content: 'Hétfő: napos, 18 °C\nKedd: esős, 12 °C\nSzerda: felhős, 15 °C' },
            { name: 'erdei_allatok.pdf', content: 'Az erdő lakói: őz, szarvas, róka, vaddisznó, harkály.' }
        ]
    };

    const G4_IMAGES = {
        'Nyaralás': [
            { name: 'balaton_strand.jpg', content: '🏖️' },
            { name: 'homokvar.png', content: '🏰' },
            { name: 'hegyi_tura.jpg', content: '⛰️' }
        ],
        'Állatok': [
            { name: 'cica_alszik.jpg', content: '🐱' },
            { name: 'kutya_labdaval.png', content: '🐶' },
            { name: 'papagaj.jpg', content: '🦜' }
        ]
    };

    const G4_MUSIC = [
        { name: 'kedvenc_dalom.mp3', content: 'Kedvenc dalom – 3:12' },
        { name: 'iskolai_korus.mp3', content: 'Iskolai kórus: Tavaszi szél – 2:40' },
        { name: 'gitar_gyakorlas.mp3', content: 'Gitárgyakorlás – 1:55' },
        { name: 'szulinapi_dal.mp3', content: 'Boldog születésnapot! – 0:45' },
        { name: 'tanc_zene.mp3', content: 'Táncórai zene – 4:01' }
    ];

    /** Borzalmas nevű iskolai fájlok: a tartalmukból derül ki a helyes név (Tantárgy_Téma). */
    const G4_BAD_DOCS = [
        { bad: 'asdfgh', ext: '.pptx', subject: 'Környezet', topic: 'Vulkánok', body: '1. dia: Mi az a vulkán?\n2. dia: Hogyan tör ki?\n3. dia: Híres vulkánok: Etna, Vezúv' },
        { bad: 'névtelen123', ext: '.docx', subject: 'Magyar', topic: 'Mesék', body: 'Kedvenc népmeséim: A só, Az égig érő fa, A kiskakas gyémánt félkrajcárja.' },
        { bad: 'dokumentum1', ext: '.docx', subject: 'Matek', topic: 'Törtek', body: 'A tört két része: a számláló és a nevező. Például: 3/4' },
        { bad: 'qwerty', ext: '.xlsx', subject: 'Matek', topic: 'Szorzás', body: '6×7=42\n8×9=72\n12×3=36' },
        { bad: 'uj_fajl(3)', ext: '.txt', subject: 'Környezet', topic: 'Madarak', body: 'Télen is itt maradó madarak: cinege, veréb, harkály.' },
        { bad: 'xxx', ext: '.pdf', subject: 'Magyar', topic: 'Helyesírás', body: 'Szabály: a mondat elejét nagy kezdőbetűvel írjuk, a végére írásjelet teszünk.' },
        { bad: 'aaaaa_vegleges_JO', ext: '.pptx', subject: 'Környezet', topic: 'Naprendszer', body: '1. dia: A Nap\n2. dia: A bolygók\n3. dia: A Hold' },
        { bad: 'lkjhg', ext: '.docx', subject: 'Matek', topic: 'Geometria', body: 'A háromszögnek három oldala és három csúcsa van.' }
    ];

    /** Borzalmas nevű fotók: a helyes név Hely_Év. */
    const G4_BAD_IMAGES = [
        { bad: 'IMG_0042', ext: '.jpg', place: 'Balaton', year: '2025', theme: 'Nyaralás' },
        { bad: 'névtelen_kép', ext: '.jpg', place: 'Tihany', year: '2024', theme: 'Nyaralás' },
        { bad: 'kép(1)', ext: '.png', place: 'Mátra', year: '2025', theme: 'Nyaralás' },
        { bad: 'DSC9981', ext: '.jpg', place: 'Hortobágy', year: '2026', theme: 'Nyaralás' }
    ];

    const G4_LEVELS = {
        1: { files: 8,  badDocs: 2, badImages: 0, subjects: [],                            schoolSub: false, imageSub: false },
        2: { files: 10, badDocs: 2, badImages: 1, subjects: [],                            schoolSub: false, imageSub: false },
        3: { files: 11, badDocs: 3, badImages: 1, subjects: ['Matek', 'Magyar'],           schoolSub: true,  imageSub: false },
        4: { files: 13, badDocs: 3, badImages: 1, subjects: ['Matek', 'Magyar', 'Környezet'], schoolSub: true,  imageSub: false },
        5: { files: 15, badDocs: 4, badImages: 2, subjects: ['Matek', 'Magyar', 'Környezet'], schoolSub: true,  imageSub: true }
    };

    class ChaosCaptain extends QuestBase {
        constructor(container, ctx) {
            super(container, ctx, { title: 'Káosz Kapitány Szobája', icon: '🏴‍☠️' });
            this.startRound();
        }

        startRound() {
            this.level = this.ctx.level;
            this.cfg = G4_LEVELS[this.level] || G4_LEVELS[1];
            this.ctx.newTask();
            this.errors = 0;
            this.finished = false;
            this.doneKeys = new Set();
            this.copyOrigin = new Map();
            this.warnedParent = new Set();
            this.shell.setLevel(this.level);
            this.shell.setErrors(0);
            this.buildWorld();
            this.render();
            this.evaluate();
            if (this.level === 1) {
                say('Káosz Kapitány mindent összevissza hagyott! Először hozd létre a mappákat az „Új mappa” gombbal, aztán húzd beléjük a fájlokat! 📁', 'happy');
            } else if (this.cfg.schoolSub) {
                say('Ezen a szinten almappák is kellenek: az Iskola mappán belül tantárgyanként külön mappa! 🗂️', 'think');
            }
        }

        buildWorld() {
            const cfg = this.cfg;
            this.vfs = makeBaseVfs();
            this.chaosId = Math.random() < 0.5 ? 'desktop' : 'downloads';
            this.chaosName = this.vfs.get(this.chaosId).name;

            // Szükséges mappák (relatív útvonalak a káosz helyétől)
            const folders = [['Iskola']];
            if (cfg.schoolSub) cfg.subjects.forEach(s => folders.push(['Iskola', s]));
            folders.push(['Képek']);
            if (cfg.imageSub) folders.push(['Képek', 'Nyaralás'], ['Képek', 'Állatok']);
            folders.push(['Zenék']);
            this.requiredFolders = folders;

            const subjects = cfg.schoolSub ? cfg.subjects : ['Matek', 'Magyar', 'Környezet'];
            const schoolTarget = subject => cfg.schoolSub ? ['Iskola', subject] : ['Iskola'];
            const imageTarget = theme => cfg.imageSub ? ['Képek', theme] : ['Képek'];

            const items = [];
            // Rossz nevű iskolai dokumentumok
            sample(G4_BAD_DOCS.filter(d => subjects.includes(d.subject)), cfg.badDocs).forEach(d => {
                items.push({
                    kind: 'school', origName: d.bad, ext: d.ext, subject: d.subject, target: schoolTarget(d.subject),
                    proper: d.subject + '_' + d.topic,
                    content: '📚 Iskolai anyag\n\nTantárgy: ' + d.subject + '\nTéma: ' + d.topic + '\n\n' + d.body
                });
            });
            // Rossz nevű fotók
            sample(G4_BAD_IMAGES, cfg.badImages).forEach(b => {
                items.push({
                    kind: 'image', origName: b.bad, ext: b.ext, theme: b.theme, target: imageTarget(b.theme),
                    proper: b.place + '_' + b.year,
                    content: '📸 Fotó · Hely: ' + b.place + ' · Év: ' + b.year + ' · Egy szép nyári emlék a családdal.'
                });
            });
            // Rendes nevű fájlok
            const rest = cfg.files - items.length;
            const schoolCount = Math.round(rest * 0.4);
            const imageCount = Math.round(rest * 0.3);
            const musicCount = rest - schoolCount - imageCount;
            const schoolPool = shuffle(subjects.flatMap(s => G4_SCHOOL[s].map(f => Object.assign({ subject: s }, f))));
            // Minden tantárgyból legyen legalább egy fájl
            const chosenSchool = [];
            subjects.forEach(s => {
                const f = schoolPool.find(x => x.subject === s && !chosenSchool.includes(x));
                if (f) chosenSchool.push(f);
            });
            schoolPool.forEach(f => {
                if (chosenSchool.length < Math.max(schoolCount, subjects.length) && !chosenSchool.includes(f)) chosenSchool.push(f);
            });
            chosenSchool.forEach(f => {
                const parts = splitFull(f.name);
                items.push({ kind: 'school', origName: parts.name, ext: parts.ext, subject: f.subject, target: schoolTarget(f.subject), content: f.content });
            });
            const imagePool = shuffle(Object.keys(G4_IMAGES).flatMap(t => G4_IMAGES[t].map(f => Object.assign({ theme: t }, f))));
            const chosenImages = [];
            if (cfg.imageSub) {
                Object.keys(G4_IMAGES).forEach(t => {
                    const f = imagePool.find(x => x.theme === t);
                    if (f) chosenImages.push(f);
                });
            }
            imagePool.forEach(f => {
                if (chosenImages.length < imageCount && !chosenImages.includes(f)) chosenImages.push(f);
            });
            chosenImages.forEach(f => {
                const parts = splitFull(f.name);
                items.push({ kind: 'image', origName: parts.name, ext: parts.ext, theme: f.theme, target: imageTarget(f.theme), content: f.content });
            });
            sample(G4_MUSIC, Math.max(1, musicCount)).forEach(f => {
                const parts = splitFull(f.name);
                items.push({ kind: 'music', origName: parts.name, ext: parts.ext, target: ['Zenék'], content: f.content });
            });

            this.items = shuffle(items);
            this.items.forEach((it, i) => {
                const node = addFile(this.vfs, this.chaosId, it.origName + it.ext, it.content);
                it.id = node.id;
                it.index = i;
            });
            this.vfs.undoStack = [];
        }

        relText(rel) {
            return this.chaosName + '\\' + rel.join('\\');
        }

        render() {
            const badDocs = this.items.some(i => i.proper && i.kind === 'school');
            const badImages = this.items.some(i => i.proper && i.kind === 'image');
            let rules = '';
            if (badDocs || badImages) {
                rules = '<div class="fkq-rule">🏆 <b>Fájlnév-szépségverseny!</b> A csúnya nevű fájlokat nyisd meg dupla kattintással, nézd meg, mi van bennük, és nevezd át őket (F2) a szabály szerint:<br>' +
                    (badDocs ? '📄 Iskolai anyag: <code>Tantárgy_Téma</code> (pl. <code>Környezet_Vulkánok.pptx</code>)<br>' : '') +
                    (badImages ? '📸 Fotó: <code>Hely_Év</code> (pl. <code>Balaton_2025.jpg</code>)<br>' : '') +
                    'A kiterjesztést (a pont utáni részt) ne változtasd meg!</div>';
            }
            this.layout(
                '<div class="fkq-story">' +
                    '<div class="fkg4-captain"><span class="fkg4-captain-face" aria-hidden="true">🏴‍☠️</span>' +
                    '<h4>Káosz Kapitány járt itt!</h4></div>' +
                    'A(z) <b>' + escapeHtml(this.chaosName) + '</b> mappában ' + this.items.length + ' fájl hever összevissza. Rakj rendet: hozd létre a mappákat, nevezd át a csúnya nevű fájlokat, és tegyél mindent a helyére!' +
                '</div>' +
                rules +
                '<div class="fkq-section-title">Feladatok</div>' +
                '<div class="fkq-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div>' +
                '<ul class="fkq-tasks" data-tasks></ul>'
            );
            this.tasksEl = this.panel.querySelector('[data-tasks]');
            this.meterEl = this.panel.querySelector('.fkq-meter');
            this.mountExplorer({
                startId: this.chaosId,
                hooks: {
                    onFileMoved: e => this.onPlaced(e.nodes, e.toId),
                    onFileCopied: e => {
                        e.copies.forEach((c, i) => {
                            const src = e.sources[i];
                            if (src) this.copyOrigin.set(c.id, this.originOf(src.id));
                        });
                        this.onPlaced(e.copies, e.toId);
                    },
                    onFileRenamed: e => this.onRenamed(e),
                    onFolderCreated: e => this.onFolderCreated(e),
                    onFileOpened: e => this.onOpened(e)
                },
                canPerform: (action, nodes) => this.canPerform(action, nodes)
            });
        }

        originOf(id) {
            let cur = id;
            const seen = new Set();
            while (this.copyOrigin.has(cur) && !seen.has(cur)) {
                seen.add(cur);
                cur = this.copyOrigin.get(cur);
            }
            return cur;
        }

        itemOf(id) {
            const origin = this.originOf(id);
            return this.items.find(it => it.id === origin) || null;
        }

        /** Egy feladat-fájl élő példányai (az eredeti és a róla készült másolatok). */
        liveMembers(item) {
            const ids = [item.id];
            this.copyOrigin.forEach((_, copyId) => {
                if (this.originOf(copyId) === item.id) ids.push(copyId);
            });
            return ids.map(id => this.vfs.get(id)).filter(n => n && this.vfs.exists(n.id));
        }

        folderIdFor(rel) {
            if (!this.vfs.exists(this.chaosId)) return null;
            return resolveRel(this.vfs, this.chaosId, rel);
        }

        isProperlyNamed(item, node) {
            return normalizeName(node.name) === normalizeName(item.proper) && node.ext === item.ext;
        }

        itemPlaced(item) {
            const target = this.folderIdFor(item.target);
            if (!target) return false;
            return this.liveMembers(item).some(n => n.parentId === target);
        }

        itemRenamed(item) {
            if (!item.proper) return true;
            return this.liveMembers(item).some(n => this.isProperlyNamed(item, n));
        }

        displayItem(item) {
            const live = this.liveMembers(item);
            const node = live[0] || this.vfs.get(item.id);
            return node ? this.vfs.displayName(node) : item.origName + item.ext;
        }

        // ---------- Események ----------
        onPlaced(nodes, toId) {
            if (this.finished) return;
            const requiredIds = this.requiredFolders.map(rel => ({ rel, id: this.folderIdFor(rel) })).filter(f => f.id);
            nodes.forEach(node => {
                const item = this.itemOf(node.id);
                if (!item) return;
                const targetId = this.folderIdFor(item.target);
                if (toId === targetId) {
                    this.shell.feedback('✔ ' + this.vfs.displayName(node) + ' a helyére került!', 'ok');
                    return;
                }
                if (targetId && this.vfs.isAncestor(toId, targetId)) {
                    // Jó irány, de még mélyebbre kell tenni (pl. Iskola helyett Iskola\Matek)
                    if (!this.warnedParent.has(item.id)) {
                        this.warnedParent.add(item.id);
                        this.shell.feedback('👍 Jó irány, de még pontosabb helyre kell!', 'info');
                        say('Majdnem! A(z) „' + this.vfs.displayName(node) + '” helye: ' + this.relText(item.target) + '. Nyisd meg a mappát, és tedd bele a megfelelő almappába!', 'think');
                    }
                    return;
                }
                const wrongRequired = requiredIds.find(f => f.id === toId) || (toId !== this.chaosId && this.vfs.isAncestor(this.chaosId, toId));
                if (wrongRequired) {
                    this.addError('A(z) „' + this.vfs.displayName(node) + '” nem ebbe a mappába való! ' + this.categoryHint(item) + ' Helye: ' + this.relText(item.target) + '.');
                }
            });
        }

        categoryHint(item) {
            if (item.kind === 'school') return 'Ez egy iskolai anyag (' + item.subject + ').';
            if (item.kind === 'image') return 'Ez egy kép (' + item.ext + ').';
            return 'Ez egy zene (' + item.ext + ').';
        }

        onRenamed(e) {
            if (this.finished) return;
            const item = this.itemOf(e.node.id);
            if (e.node.type === 'folder' || !item) return;
            if (e.extChanged) {
                this.addError('Vigyázz! Az átnevezéskor megváltozott a kiterjesztés. A(z) ' + item.ext + ' részt hagyd meg, csak a pont előtti részt írd át!');
                return;
            }
            if (!item.proper) {
                this.shell.feedback('Ennek a fájlnak már szép neve volt 🙂', 'info');
                return;
            }
            if (this.isProperlyNamed(item, e.node)) {
                this.shell.feedback('🏆 Gyönyörű fájlnév!', 'ok');
            } else {
                this.shell.feedback('🤔 Majdnem… nézd meg a szabályt!', 'info');
                say('Nyisd meg a fájlt, és nézd meg, mi van benne! A szabály: ' + (item.kind === 'image' ? 'Hely_Év' : 'Tantárgy_Téma') + '. Például: ' + (item.kind === 'image' ? 'Balaton_2025' : 'Környezet_Vulkánok') + item.ext, 'think');
            }
        }

        onFolderCreated(e) {
            if (this.finished) return;
            const ok = this.requiredFolders.some(rel => this.folderIdFor(rel) === e.node.id);
            if (ok) {
                this.shell.feedback('📁 ' + e.node.name + ' mappa kész!', 'ok');
            } else if (this.vfs.isAncestor(this.chaosId, e.node.id)) {
                const names = this.requiredFolders.map(r => r[r.length - 1]);
                const near = names.find(n => normalizeName(n) === normalizeName(e.node.name));
                say(near
                    ? 'Jó a név, de rossz helyen van a(z) „' + e.node.name + '” mappa! Nézd meg a feladatlistát, hová kell.'
                    : 'Ilyen nevű mappát nem kértünk. A kért mappák: ' + names.join(', ') + '. Az F2 gombbal átnevezheted!', 'think');
            }
        }

        onOpened(e) {
            const item = this.itemOf(e.node.id);
            if (item && item.proper && !this.itemRenamed(item)) {
                setTimeout(() => {
                    if (this.shell.alive && !this.finished) {
                        say(item.kind === 'image'
                            ? 'Nézd meg a kép alatti szöveget: ott a hely és az év! Ebből lesz az új név: Hely_Év 📸'
                            : 'Olvasd el a tantárgyat és a témát! Ebből lesz az új név: Tantárgy_Téma ✍️', 'happy');
                    }
                }, 500);
            }
        }

        canPerform(action, nodes) {
            if (action === 'deletePermanent' || action === 'emptyBin') {
                const lost = nodes.map(n => this.itemOf(n.id)).find(item => item && this.liveMembers(item).length === 0);
                if (lost) {
                    this.addError('A(z) „' + lost.origName + lost.ext + '” még kell! Ha véglegesen törlöd, elveszik. Inkább állítsd vissza a Lomtárból!');
                    return 'Ezt a fájlt még nem szabad véglegesen törölni – a rendrakáshoz kell! ♻️';
                }
            }
            return true;
        }

        // ---------- Kiértékelés ----------
        evaluate() {
            if (!this.tasksEl) return;
            const tasks = [];
            this.requiredFolders.forEach(rel => {
                tasks.push({
                    key: 'f:' + rel.join('/'),
                    html: '📁 Hozd létre: <code>' + escapeHtml(this.relText(rel)) + '</code>',
                    done: !!this.folderIdFor(rel)
                });
            });
            this.items.filter(it => it.proper).forEach(it => {
                const done = this.itemRenamed(it);
                tasks.push({
                    key: 'r:' + it.id,
                    html: '✏️ Nevezd át: <code>' + escapeHtml(it.origName + it.ext) + '</code>' + (done ? ' → <code>' + escapeHtml(this.displayItem(it)) + '</code>' : ''),
                    done
                });
            });
            const placed = this.items.filter(it => this.itemPlaced(it)).length;
            tasks.push({
                key: 'p',
                html: '📦 Minden fájl a helyén: ' + placed + ' / ' + this.items.length,
                done: placed === this.items.length
            });
            const loose = this.vfs.exists(this.chaosId) ? this.vfs.children(this.chaosId).filter(n => n.type === 'file') : [];
            tasks.push({
                key: 'l',
                html: '🧹 Ne maradjon szétszórt fájl itt: <code>' + escapeHtml(this.chaosName) + '</code>' + (loose.length ? ' (még ' + loose.length + ')' : ''),
                done: loose.length === 0
            });
            this.renderTasks(this.tasksEl, tasks);
            const doneCount = tasks.filter(t => t.done).length;
            this.setMeter(this.meterEl, doneCount, tasks.length);
            this.shell.setProgress('🧹 ' + doneCount + ' / ' + tasks.length);
            if (doneCount === tasks.length) {
                this.shell.feedback('✨ Ragyogó rend!', 'ok');
                const renamed = this.items.filter(it => it.proper).length;
                this.finish([
                    '🧹 Rendet raktál itt: ' + this.chaosName,
                    '📦 Rendszerezett fájlok: ' + this.items.length,
                    '📁 Létrehozott mappák: ' + this.requiredFolders.length,
                    '✏️ Szépre átnevezett fájlok: ' + renamed
                ]);
            }
        }

        hint() {
            if (this.finished || !this.explorer) return null;
            const missingFolder = this.requiredFolders.find(rel => !this.folderIdFor(rel));
            if (missingFolder) {
                const parentRel = missingFolder.slice(0, -1);
                const where = parentRel.length ? this.relText(parentRel) : this.chaosName;
                return 'Menj ide: ' + where + ', kattints az „Új mappa” gombra, és írd be: ' + missingFolder[missingFolder.length - 1];
            }
            const toRename = this.items.find(it => it.proper && !this.itemRenamed(it));
            if (toRename) {
                const node = this.liveMembers(toRename)[0];
                if (node) this.flashIfVisible(node.id);
                return 'Nyisd meg a(z) „' + this.displayItem(toRename) + '” fájlt dupla kattintással! A tartalma alapján az új neve ez legyen: ' + toRename.proper + toRename.ext + ' (jelöld ki, majd F2).';
            }
            const toPlace = this.items.find(it => !this.itemPlaced(it));
            if (toPlace) {
                const node = this.liveMembers(toPlace)[0];
                if (node) this.flashIfVisible(node.id);
                return 'A(z) „' + this.displayItem(toPlace) + '” helye: ' + this.relText(toPlace.target) + '. Húzd rá a mappára, vagy vágd ki (Ctrl+X) és illeszd be (Ctrl+V)!';
            }
            return 'Ha másolással dolgoztál, az eredeti fájlok még ott vannak a(z) ' + this.chaosName + ' mappában. Töröld őket, hogy ne maradjon rendetlenség!';
        }
    }

    // ======================================================================
    // 5. JÁTÉK – LOMTÁR-MENTŐAKCIÓ ÉS VÍRUSVADÁSZ
    // ======================================================================
    const G5_HOMEWORK = [
        { name: 'Matek_házi.docx', content: 'Matek házi feladat\n34. oldal 2. és 3. feladat\n1) 125 + 375 = 500' },
        { name: 'Fogalmazás_a_nyárról.docx', content: 'Az én nyaram\n\nIdén nyáron a Balatonnál táboroztam…' },
        { name: 'Szorzótábla_gyakorlás.xlsx', content: '7×1=7\n7×2=14\n7×3=21\n…' },
        { name: 'Környezet_kiselőadás.pptx', content: '1. dia: A víz körforgása\n2. dia: Párolgás és csapadék' },
        { name: 'Olvasónapló.txt', content: 'Könyv: Vuk\nÍró: Fekete István\nKedvenc rész: amikor Vuk megmenti Karakot.' },
        { name: 'Angol_szavak.txt', content: 'dog – kutya\ncat – macska\nschool – iskola\nfriend – barát' },
        { name: 'Rajzpályázat.png', content: '🎨' },
        { name: 'Történelem_vázlat.docx', content: 'A honfoglalás: 895 körül\nVezér: Árpád' }
    ];

    const G5_JUNK = [
        { name: 'régi_bevásárlólista.txt', content: 'Tej, kenyér (múlt heti)' },
        { name: 'elrontott_rajz.png', content: '🖍️' },
        { name: 'teszt123.txt', content: 'aaaaaaa' },
        { name: 'képernyőkép_üres.png', content: '⬜' },
        { name: 'Matek_házi_RÉGI_rossz.docx', content: 'Ez egy régi, hibás változat. Nem kell már!' },
        { name: 'Fogalmazás_vázlat_eldobni.docx', content: 'Áthúzott, összefirkált vázlat.' }
    ];

    const G5_VIRUSES = [
        'ingyen_robux_hack', 'nyeremenyjatek_virus', 'ingyen_vbucks', 'szuper_csalas_jatekhoz', 'gyorsitsd_fel_a_geped',
        'kattints_ide_azonnal', 'free_skins_generator', 'jelszo_lopo'
    ];

    /** Dupla kiterjesztésű álcázott vírusok és a valódi „ikertestvéreik”. */
    const G5_DOUBLE = [
        { fake: 'cica_kep.jpg', twin: 'cica_kep.jpg', twinContent: '🐱' },
        { fake: 'szorzotabla.docx', twin: 'szorzotabla.docx', twinContent: '1×1=1\n2×2=4\n3×3=9' },
        { fake: 'kedvenc_dal.mp3', twin: 'kedvenc_dal.mp3', twinContent: 'Kedvenc dal – 3:12' },
        { fake: 'osztalykep.png', twin: 'osztalykep.png', twinContent: '👩‍🏫' },
        { fake: 'hazi_feladat.pdf', twin: 'hazi_feladat.pdf', twinContent: 'Házi feladat: 12. oldal 4. feladat' }
    ];

    const G5_SAFE = [
        { name: 'Órarend.docx', content: 'Hétfő: matek, magyar, testnevelés\nKedd: angol, környezet, rajz' },
        { name: 'Bevásárlólista.txt', content: 'Tej\nKenyér\nAlma' },
        { name: 'nyaralas.jpg', content: '🏖️' },
        { name: 'A_Naprendszer.pptx', content: '1. dia: A Nap\n2. dia: A bolygók' },
        { name: 'Kirándulás_képek.zip', content: '' },
        { name: 'iskolacsengo.mp3', content: 'Iskolacsengő – 0:05' },
        { name: 'Receptek.docx', content: 'Palacsinta: liszt, tej, tojás, csipet só' }
    ];

    const G5_LEVELS = {
        1: { homework: 2, junk: 0, viruses: 2, doubles: 0, places: ['downloads'],                                     listViruses: true },
        2: { homework: 3, junk: 1, viruses: 3, doubles: 0, places: ['downloads', 'desktop'],                          listViruses: false },
        3: { homework: 3, junk: 2, viruses: 4, doubles: 0, places: ['downloads', 'desktop', 'documents', 'nested'],   listViruses: false },
        4: { homework: 4, junk: 3, viruses: 4, doubles: 2, places: ['downloads', 'desktop', 'documents', 'nested'],   listViruses: false },
        5: { homework: 5, junk: 3, viruses: 5, doubles: 3, places: ['downloads', 'desktop', 'documents', 'nested'],   listViruses: false }
    };

    const G5_BROTHERS = ['Peti', 'Marci', 'Bence', 'Zsombi', 'Dani'];

    class RecycleRescue extends QuestBase {
        constructor(container, ctx) {
            super(container, ctx, { title: 'Lomtár-mentőakció és Vírusvadász', icon: '🛡️' });
            this.startRound();
        }

        startRound() {
            this.level = this.ctx.level;
            this.cfg = G5_LEVELS[this.level] || G5_LEVELS[1];
            this.ctx.newTask();
            this.errors = 0;
            this.finished = false;
            this.doneKeys = new Set();
            this.warnedDouble = new Set();
            this.brother = pick(G5_BROTHERS);
            this.shell.setLevel(this.level);
            this.shell.setErrors(0);
            this.buildWorld();
            this.render();
            this.evaluate();
            if (this.cfg.doubles > 0) {
                setTimeout(() => {
                    if (this.shell.alive) say('Figyelem, vírusvadász! Egyes vírusok álruhában vannak: pl. „cica_kep.jpg.exe”. Mindig a LEGUTOLSÓ pont utáni rész számít! Ha az .exe, akkor az egy program! 🕵️', 'think');
                }, 400);
            } else {
                say('Kezdjük a mentéssel! A Lomtárban jelöld ki a házi feladatot, és nyomd meg a „Visszaállítás” gombot! ♻️', 'happy');
            }
        }

        buildWorld() {
            const cfg = this.cfg;
            const vfs = makeBaseVfs();
            this.vfs = vfs;

            // Házi feladatok mappái
            const hwRoot = ensurePath(vfs, 'documents', ['Házi feladatok']);
            const subjFolders = {};
            if (this.level >= 3) {
                ['Matek', 'Magyar'].forEach(s => { subjFolders[s] = ensurePath(vfs, 'documents', ['Házi feladatok', s]); });
            }

            // Biztonságos fájlok szétszórva
            const safePlaces = ['desktop', 'downloads', 'documents', 'pictures'];
            this.safeIds = new Set();
            sample(G5_SAFE, 5).forEach((f, i) => {
                const node = addFile(vfs, safePlaces[i % safePlaces.length], f.name, f.content);
                this.safeIds.add(node.id);
            });

            // A kitörölt házi feladatok
            this.homework = sample(G5_HOMEWORK, cfg.homework).map(h => {
                let parent = hwRoot;
                if (this.level >= 3) {
                    if (/^Matek|Szorzó/i.test(h.name)) parent = subjFolders.Matek;
                    else if (/^Fogalmaz|Olvasó/i.test(h.name)) parent = subjFolders.Magyar;
                }
                const node = addFile(vfs, parent, h.name, h.content);
                return { id: node.id, name: h.name };
            });
            // Egy megmaradt házi feladat is legyen ott (nem kell vele semmit csinálni)
            addFile(vfs, hwRoot, 'Feladatok_listája.txt', 'Ezeket kell beadni a héten:\n' + this.homework.map(h => '• ' + h.name).join('\n'));

            // Szemét, ami maradjon a Lomtárban
            const junkPool = this.level >= 5 ? G5_JUNK.slice() : G5_JUNK.filter(j => !/RÉGI|eldobni/i.test(j.name));
            this.junk = sample(junkPool, cfg.junk).map(j => {
                const node = addFile(vfs, hwRoot, j.name, j.content);
                return { id: node.id, name: j.name };
            });

            // Törlés a Lomtárba (a kisöcs „munkája”)
            vfs.delete(this.homework.map(h => h.id).concat(this.junk.map(j => j.id)));

            // Vírusok
            const placeIds = cfg.places.map(p => {
                if (p === 'nested') return ensurePath(vfs, 'downloads', ['Játékok', 'Csalások']);
                return p;
            });
            this.viruses = [];
            const plain = sample(G5_VIRUSES, cfg.viruses - cfg.doubles);
            plain.forEach((v, i) => {
                const parent = placeIds[i % placeIds.length];
                const node = addFile(vfs, parent, v + '.exe', '');
                this.viruses.push({ id: node.id, name: v + '.exe', double: false });
            });
            sample(G5_DOUBLE, cfg.doubles).forEach((d, i) => {
                const parent = placeIds[(plain.length + i) % placeIds.length];
                // Az ikertestvér valódi, biztonságos fájl ugyanabban a mappában
                const twinName = vfs.nameTaken(parent, d.twin) ? 'eredeti_' + d.twin : d.twin;
                const twin = addFile(vfs, parent, twinName, d.twinContent);
                this.safeIds.add(twin.id);
                const node = addFile(vfs, parent, d.fake + '.exe', '');
                this.viruses.push({ id: node.id, name: d.fake + '.exe', double: true });
            });
            vfs.undoStack = [];
        }

        render() {
            const cfg = this.cfg;
            const virusInfo = cfg.listViruses
                ? '<ul class="fkg5-virus-list">' + this.viruses.map(v => '<li><code>' + escapeHtml(v.name) + '</code></li>').join('') + '</ul>'
                : '';
            this.layout(
                '<div class="fkq-story"><h4>🚨 Riadó a gépen!</h4>' +
                    escapeHtml(this.brother) + ', a kisöcséd játszott a számítógépen. Véletlenül kitörölte a fontos házi feladataidat, ráadásul letöltött néhány gyanús programot is! Mentsd meg a gépet!' +
                '</div>' +
                '<div class="fkg5-phase" data-phase="1"><span>1</span>Mentsd ki a házi feladatokat a Lomtárból!</div>' +
                '<ul class="fkq-tasks" data-tasks1></ul>' +
                '<div class="fkg5-phase" data-phase="2"><span>2</span>Vírusvadászat</div>' +
                '<div class="fkg5-alert">🦠 Keresd meg és töröld az összes gyanús <b>.exe</b> programot az Asztalon, a Letöltésekben és a Dokumentumokban! A rendes fájlokat (képek, dokumentumok, zenék) hagyd békén!' + virusInfo + '</div>' +
                '<ul class="fkq-tasks" data-tasks2></ul>' +
                '<div class="fkg5-phase" data-phase="3"><span>3</span>Végleges takarítás</div>' +
                '<ul class="fkq-tasks" data-tasks3></ul>' +
                '<div class="fkq-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div>'
            );
            this.tasksEls = [1, 2, 3].map(i => this.panel.querySelector('[data-tasks' + i + ']'));
            this.phaseEls = [1, 2, 3].map(i => this.panel.querySelector('[data-phase="' + i + '"]'));
            this.meterEl = this.panel.querySelector('.fkq-meter');
            this.mountExplorer({
                startId: 'recycle',
                hooks: {
                    onFileRestored: e => this.onRestored(e),
                    onFileDeleted: e => this.onDeleted(e),
                    onSelectionChanged: e => this.onSelection(e),
                    onFileOpened: e => this.onOpened(e)
                },
                canPerform: (action, nodes) => this.canPerform(action, nodes)
            });
        }

        isVirus(id) {
            return this.viruses.some(v => v.id === id);
        }

        isHomework(id) {
            return this.homework.some(h => h.id === id);
        }

        isJunk(id) {
            return this.junk.some(j => j.id === id);
        }

        /** Egy elem és az összes leszármazottja. */
        withDescendants(nodes) {
            const out = [];
            const stack = nodes.map(n => n.id);
            while (stack.length) {
                const id = stack.pop();
                out.push(id);
                this.vfs.nodes.forEach(n => { if (n.parentId === id) stack.push(n.id); });
            }
            return out;
        }

        canPerform(action, nodes) {
            const all = this.withDescendants(nodes);
            if (action === 'delete') {
                const hw = all.find(id => this.isHomework(id));
                if (hw) {
                    this.addError('A(z) „' + this.vfs.displayName(hw) + '” egy házi feladat – éppen most mentetted meg! Ne töröld ki újra!');
                    return 'Ezt ne töröld! Ez egy fontos házi feladat. 📚';
                }
                const safe = all.find(id => this.safeIds.has(id));
                if (safe) {
                    const node = this.vfs.get(safe);
                    this.addError('A(z) „' + this.vfs.displayName(node) + '” nem vírus! A kiterjesztése ' + (node.ext || '(nincs)') + ', ez egy rendes fájl. Csak az .exe programokat kell törölni!');
                    return 'Ez egy rendes fájl (' + (node.ext || 'mappa') + '), nem vírus! 🙂';
                }
            }
            if (action === 'deletePermanent' || action === 'emptyBin') {
                const hw = all.find(id => this.isHomework(id) && this.vfs.get(id) && this.vfs.get(id).isDeleted);
                if (hw) {
                    this.addError('Állj! A Lomtárban még ott van a(z) „' + this.vfs.displayName(hw) + '” házi feladat! Előbb állítsd vissza, különben örökre elveszik!');
                    return 'Előbb mentsd ki a házi feladatokat a Lomtárból! ♻️';
                }
                const safe = all.find(id => this.safeIds.has(id) && this.vfs.isInRecycleBin(id));
                if (safe) {
                    this.addError('A Lomtárban van egy rendes fájl is: „' + this.vfs.displayName(safe) + '”. Előbb állítsd vissza!');
                    return 'Egy hasznos fájl is a Lomtárban van – előbb állítsd vissza! ♻️';
                }
            }
            if (action === 'restore') {
                const virus = all.find(id => this.isVirus(id));
                if (virus) {
                    this.addError('A(z) „' + this.vfs.displayName(virus) + '” egy vírus! Azt nem szabad visszaállítani, annak a Lomtárban a helye – aztán végleg törölni!');
                    return 'Vírust nem állítunk vissza! 🦠';
                }
                const junk = all.find(id => this.isJunk(id));
                if (junk) {
                    this.addError('A(z) „' + this.vfs.displayName(junk) + '” nincs a mentendő házi feladatok listáján. Nézd meg figyelmesen a nevet!');
                    return 'Ez nem kell – csak a listán szereplő házi feladatokat mentsd ki! 📝';
                }
            }
            return true;
        }

        onRestored(e) {
            if (this.finished) return;
            const hw = e.nodes.filter(n => this.isHomework(n.id));
            if (hw.length) {
                this.shell.feedback('♻️ Megmentve: ' + this.vfs.displayName(hw[0]), 'ok');
            }
            const all = this.homework.every(h => this.vfs.exists(h.id));
            if (all && hw.length) {
                setTimeout(() => {
                    if (this.shell.alive && !this.finished) say('Minden házi feladat megmenekült! 🎉 Most jöhet a vírusvadászat: nézz körül az Asztalon és a Letöltések mappában!', 'happy');
                }, 300);
            }
        }

        onDeleted(e) {
            if (this.finished) return;
            const viruses = e.nodes.filter(n => this.isVirus(n.id) || this.withDescendants([n]).some(id => this.isVirus(id)));
            if (viruses.length && !e.permanent) {
                this.shell.feedback('🦠 Vírus a Lomtárban!', 'ok');
                const left = this.viruses.filter(v => this.vfs.exists(v.id)).length;
                if (left === 0) {
                    setTimeout(() => {
                        if (this.shell.alive && !this.finished) say('Minden vírus a Lomtárban van! De még ott lapulnak… Ürítsd ki a Lomtárat, hogy végleg eltűnjenek! 🧹', 'happy');
                    }, 300);
                }
            } else if (e.permanent && viruses.length) {
                this.shell.feedback('💥 Vírus megsemmisítve!', 'ok');
            }
        }

        onSelection(e) {
            if (this.finished || this.level < 4) return;
            const node = (e.nodes || [])[0];
            if (!node) return;
            const virus = this.viruses.find(v => v.id === node.id && v.double);
            if (virus && !this.warnedDouble.has(virus.id)) {
                this.warnedDouble.add(virus.id);
                say('Nézd csak meg jól: „' + virus.name + '”! Az utolsó pont után .exe áll – ez egy álcázott PROGRAM, nem ' + (/\.(jpg|png)$/.test(splitFull(virus.name).name) ? 'kép' : 'dokumentum vagy zene') + '! 🕵️', 'think');
            }
        }

        onOpened(e) {
            if (this.isVirus(e.node.id)) {
                setTimeout(() => {
                    if (this.shell.alive) say('Szerencsére a Fájl-Kalandban nem futnak a programok! A valóságban egy ilyen .exe kárt okozhatna. Töröld! 🛡️', 'think');
                }, 400);
            }
        }

        evaluate() {
            if (!this.tasksEls) return;
            const hwTasks = this.homework.map(h => {
                const node = this.vfs.get(h.id);
                const done = !!node && this.vfs.exists(h.id);
                return {
                    key: 'h:' + h.id,
                    html: '♻️ Mentsd ki: <code>' + escapeHtml(h.name) + '</code>' + (done ? ' → <code>' + escapeHtml(this.vfs.getPath(node.parentId).split('\\').slice(-2).join('\\')) + '</code>' : ''),
                    done
                };
            });
            const phase1 = hwTasks.every(t => t.done);
            const deletedCount = this.viruses.filter(v => !this.vfs.exists(v.id)).length;
            const goneCount = this.viruses.filter(v => !this.vfs.get(v.id)).length;
            const safeLost = Array.from(this.safeIds).some(id => !this.vfs.get(id));
            const virusTasks = [{
                key: 'v',
                html: '🦠 Gyanús programok a Lomtárban: ' + deletedCount + ' / ' + this.viruses.length,
                done: deletedCount === this.viruses.length
            }];
            if (this.cfg.doubles > 0) {
                const doubles = this.viruses.filter(v => v.double);
                const caught = doubles.filter(v => !this.vfs.exists(v.id)).length;
                virusTasks.push({
                    key: 'vd',
                    html: '🕵️ Álcázott (dupla kiterjesztésű) vírusok: ' + caught + ' / ' + doubles.length,
                    done: caught === doubles.length
                });
            }
            const phase2 = deletedCount === this.viruses.length;
            const cleanTasks = [{
                key: 'c',
                html: '🧹 Ürítsd ki a Lomtárat, hogy a vírusok végleg eltűnjenek: ' + goneCount + ' / ' + this.viruses.length,
                done: goneCount === this.viruses.length,
                locked: !phase1 || !phase2
            }];
            this.renderTasks(this.tasksEls[0], hwTasks);
            this.renderTasks(this.tasksEls[1], virusTasks);
            this.renderTasks(this.tasksEls[2], cleanTasks);
            const phases = [phase1, phase2, goneCount === this.viruses.length];
            const activeIdx = phases.findIndex(p => !p);
            this.phaseEls.forEach((el, i) => {
                el.classList.toggle('is-done', phases[i]);
                el.classList.toggle('is-active', i === activeIdx);
            });
            const total = hwTasks.length + virusTasks.length + cleanTasks.length;
            const done = hwTasks.concat(virusTasks, cleanTasks).filter(t => t.done).length;
            this.setMeter(this.meterEl, done, total);
            this.shell.setProgress('🛡️ ' + done + ' / ' + total);
            if (phase1 && goneCount === this.viruses.length && !safeLost) {
                this.shell.feedback('🛡️ A gép biztonságban van!', 'ok');
                this.finish([
                    '♻️ Megmentett házi feladatok: ' + this.homework.length,
                    '🦠 Megsemmisített vírusok: ' + this.viruses.length,
                    this.cfg.doubles ? '🕵️ Leleplezett álcázott vírusok: ' + this.cfg.doubles : '🧹 A Lomtár kiürítve'
                ]);
            }
        }

        hint() {
            if (this.finished || !this.explorer) return null;
            const hw = this.homework.find(h => !this.vfs.exists(h.id));
            if (hw) {
                if (this.explorer.currentId !== 'recycle') return 'Nyisd meg a Lomtárat (bal oldalt, a 🗑️ ikon), és keresd meg ezt: ' + hw.name;
                this.explorer.flash(hw.id);
                return 'Jelöld ki a(z) „' + hw.name + '” fájlt, és kattints a „Visszaállítás” gombra (vagy jobb klikk → Visszaállítás)!';
            }
            const virus = this.viruses.find(v => this.vfs.exists(v.id));
            if (virus) {
                const parent = this.vfs.get(virus.parentId);
                this.flashIfVisible(virus.id);
                return 'Még van egy vírus itt: ' + this.vfs.getPath(parent.id) + ' – keresd az .exe végű fájlt' + (virus.double ? ' (álcázva van, figyeld a végét!)' : '') + ', jelöld ki, és nyomd meg a Delete gombot!';
            }
            if (this.viruses.some(v => this.vfs.get(v.id))) {
                return 'A vírusok még a Lomtárban vannak. Nyisd meg a Lomtárat, és kattints a „Lomtár ürítése” gombra!';
            }
            return null;
        }
    }

    // ======================================================================
    // 6. JÁTÉK – A DIGITÁLIS DETEKTÍV
    // ======================================================================
    /**
     * Esetek. Minden eset:
     *  - places: legalább 5 helyszín (az első elem egy jól ismert mappa-azonosító, a többi almappa-név)
     *  - flavor: helyszíni megfigyelések (sorban kerülnek a nyomokba)
     *  - photo: a fotós nyom leírása
     *  - pieces: kódrészletek (sorrendben)
     *  - decoys: hamis nyomok szövegei
     */
    const G6_CASES = [
        {
            id: 'torta',
            emoji: '🎂',
            title: 'A tanári szoba tortarejtélye',
            question: 'Ki ette meg a tanári szobából a születésnapi tortát?',
            intro: 'Ma van Kati néni születésnapja, de a tanári szobából eltűnt a csokitorta! Csak néhány morzsa maradt az asztalon… Kövesd a digitális nyomokat, és fejtsd meg, ki volt a tettes!',
            places: [
                ['documents', 'Iskola', 'Tanári szoba'], ['documents', 'Iskola', 'Konyha'], ['documents', 'Iskola', 'Udvar'],
                ['desktop', 'Ügyeletes jegyzetek'], ['downloads', 'Kamera felvételek'], ['documents', 'Iskola', 'Folyosó']
            ],
            flavor: [
                'A tanári asztalon csokis ujjlenyomatokat találtam… de furcsa, kerek alakúak.',
                'A konyhában valaki „elmosogatta” a tortás tányért – csak éppen nyelvvel. 👅',
                'Az udvaron kis mancsnyomok vezetnek a fák felé.',
                'Az ügyeletes tanár látott valamit négy lábon szaladni a folyosón.',
                'A lépcső alján egy csokis szőrcsomót találtam.'
            ],
            photo: 'A kamera felvételén egy farkcsóváló árnyék látszik a tanári ajtaja előtt.',
            pieces: ['CSO', 'KI', 'MAN', 'CS', 'TOR'],
            decoys: ['Gáspár bácsi tényleg itt ebédelt, de ő almás pitét evett, nem tortát. Hamis nyom! 🥧', 'Ez csak a menza heti étlapja. Semmi köze az ügyhöz.', 'Valaki itt felejtette a matekfüzetét. Nem ez a nyom!'],
            solution: 'A tettes Bodri, az iskola kutyája! A morzsák és a mancsnyomok egyenesen a kosaráig vezettek. 🐶'
        },
        {
            id: 'terkep',
            emoji: '🗺️',
            title: 'Az elveszett kincses térkép',
            question: 'Hol van az elrejtett kincses térkép kódja?',
            intro: 'Nagypapa a régi kincses térképét a számítógépen rejtette el, darabokra szedve. A padláson álló láda lakatjához egy titkos kód kell!',
            places: [
                ['documents', 'Nagypapa', 'Régi levelek'], ['documents', 'Nagypapa', 'Utazások'], ['desktop', 'Kalóz jegyzetek'],
                ['downloads', 'Szkennelt lapok'], ['documents', 'Nagypapa', 'Receptek'], ['desktop', 'Térképek']
            ],
            flavor: [
                'Egy megsárgult levélben ez áll: „A kincs ott van, ahol a nagymama a befőtteket tartja…”',
                'Nagypapa útinaplója: „1975-ben egy szigeten ástam el valamit.”',
                'A kalózjegyzet sarkában egy X jel és egy nyíl látható.',
                'A szkennelt lapon egy iránytű rajza van: Észak felé 10 lépés!',
                'A receptek között egy cetli: „Nem minden recept étel…”'
            ],
            photo: 'A régi fényképen nagypapa egy bőrönd mellett áll, a háttérben a padlás ablaka.',
            pieces: ['KIN', 'CS', 'LA', 'DA', 'X'],
            decoys: ['Ez csak a nagymama palacsintareceptje. Finom, de nem nyom! 🥞', 'Egy régi villanyszámla 1998-ból. Nem ez kell.', 'Egy nyaralós képeslap a Balatonról. Hamis nyom!'],
            solution: 'A kincsesláda a padláson van, a régi bőrönd alatt – benne nagypapa gyerekkori kincsei! 💰'
        },
        {
            id: 'zene',
            emoji: '🎻',
            title: 'Rejtélyes hangok a zeneteremben',
            question: 'Mi szól éjjelente az iskola zenetermében?',
            intro: 'Éjjelente furcsa dallam szól az üres zeneteremben. A gondnok bácsi már nem mer bemenni! Derítsd ki, mi okozza a hangot!',
            places: [
                ['documents', 'Iskola', 'Zeneterem'], ['documents', 'Iskola', 'Gondnoki iroda'], ['music', 'Felvételek'],
                ['desktop', 'Éjszakai napló'], ['downloads', 'Hangfájlok'], ['documents', 'Iskola', 'Szertár']
            ],
            flavor: [
                'A zongora mellett egy töltőkábel lóg ki a konnektorból.',
                'A gondnoki naplóban: „Minden éjjel pontban 3:00-kor szól a dallam.”',
                'A hangfelvételen egy vidám csengőhang hallatszik… nagyon ismerős!',
                'Valaki a „Talált tárgyak” listájára felírta: „fekete telefon, eltűnt hétfőn”.',
                'A szertárban egy üres telefontokot találtam.'
            ],
            photo: 'A fotón a zongora alatt valami halványan világít a sötétben.',
            pieces: ['DAL', 'LAM', 'HANG', 'JE', 'GY'],
            decoys: ['Ez csak a kórus kottája. Szép dal, de nem nyom! 🎶', 'A dobos fiúk próbabeosztása. Nem ez kell.', 'Egy hangszerkatalógus. Hamis nyom!'],
            solution: 'A zongora alatt Karcsi bácsi elfelejtett, bekapcsolva hagyott telefonja szólt – minden éjjel 3:00-kor csörgött az ébresztője! 📱'
        },
        {
            id: 'menu',
            emoji: '🍕',
            title: 'Ki cserélte ki az ebédlő menüjét?',
            question: 'Ki írta át az iskolai ebédlő heti menüjét?',
            intro: 'Hétfő reggel az ebédlő kijelzőjén a spenót helyett csupa pizza, fagyi és palacsinta szerepel! A szakácsnéni nagyon mérges. Ki írta át a menüt?',
            places: [
                ['documents', 'Ebédlő', 'Menük'], ['documents', 'Szakkörök', 'Robotika'], ['desktop', 'Szakácsnéni üzenetei'],
                ['downloads', 'Kijelző frissítés'], ['documents', 'Szakkörök', 'Informatika'], ['documents', 'Ebédlő', 'Raktár']
            ],
            flavor: [
                'A menüfájl módosításának ideje: péntek délután 15:30 – épp szakköridő!',
                'A robotika-szakkör füzetében: „Kísérlet: üzenet küldése egy kijelzőre”.',
                'A szakácsnéni szerint pénteken kis robotzümmögést hallott a folyosón.',
                'A kijelző frissítési naplójában egy furcsa név áll: „RoboBence_4b”.',
                'Az informatikateremben egy cetli: „Ne felejtsük el visszaállítani a menüt!!!”'
            ],
            photo: 'A fotón egy kis robot áll a kijelző előtt, rajta matrica: „4.b”.',
            pieces: ['RO', 'BOT', 'PIZ', 'ZA', 'MENU'],
            decoys: ['Ez a múlt havi menü – akkor még tényleg spenót volt. Hamis nyom! 🥬', 'Egy recept a karácsonyi bejglihez. Nem ez kell.', 'A konyhai mosogatási beosztás. Nem nyom!'],
            solution: 'A 4.b osztály robotszakköre programozta át a kijelzőt egy kísérlet közben – és elfelejtették visszaállítani! 🤖'
        },
        {
            id: 'kabala',
            emoji: '🧸',
            title: 'Az eltűnt osztálykabala',
            question: 'Hová tűnt Brumi, az osztály plüssmacija?',
            intro: 'Brumi, az osztály szeretett plüssmacija reggel még a polcon ült, délutánra nyoma veszett! Az egész osztály őt keresi.',
            places: [
                ['documents', 'Osztály', 'Polc'], ['documents', 'Osztály', 'Ablakpárkány'], ['desktop', 'Hirdetőtábla'],
                ['downloads', 'Iskolarádió'], ['documents', 'Iskola', 'Mosoda'], ['documents', 'Osztály', 'Szekrény']
            ],
            flavor: [
                'A polcon egy kis pocsolya és egy szappanbuborék maradt.',
                'Az ablakpárkányon egy „Takarítási nap: szerda” cédula lóg.',
                'A hirdetőtáblán: „Szerdán minden plüsst kimosunk! – a takarító néni”.',
                'Az iskolarádió bemondta: „Elveszett egy barna maci. Aki látta, szóljon!”',
                'A szekrényben egy üres kosár, levendula illattal.'
            ],
            photo: 'A fotón a mosoda szárítókötelén egy barna maci lóg a fülénél fogva.',
            pieces: ['BRU', 'MI', 'MA', 'CI', 'MOS'],
            decoys: ['Ez csak az osztály születésnapi listája. Hamis nyom! 🎈', 'Egy rajz egy unikornisról. Szép, de nem nyom.', 'A tornaterem órarendje. Nem ez kell.'],
            solution: 'Brumit a takarító néni vitte el kimosni a takarítási napon – holnap illatosan visszatér a polcra! 🫧'
        },
        {
            id: 'konyvtar',
            emoji: '📚',
            title: 'Titkos üzenet a könyvtárban',
            question: 'Mit rejt a könyvtárban talált rejtjeles üzenet?',
            intro: 'Egy régi könyvből kiesett egy rejtjeles cetli: „Aki megfejti, jutalmat kap!” A nyomok a számítógépen folytatódnak…',
            places: [
                ['documents', 'Könyvtár', 'Mesekönyvek'], ['documents', 'Könyvtár', 'Lexikonok'], ['desktop', 'Olvasókör'],
                ['downloads', 'E-könyvek'], ['documents', 'Könyvtár', 'Folyóiratok'], ['desktop', 'Kölcsönzések']
            ],
            flavor: [
                'A mesekönyvek között egy könyvjelző: „Folytatás a lexikonnál…”',
                'A lexikon „K” betűjénél be van hajtva a lap: KINCS.',
                'Az olvasókör jegyzetében: „A könyvtáros néni szereti a rejtvényeket.”',
                'Az e-könyvek között egy fájl: „Hogyan írjunk titkosírást?”',
                'A kölcsönzési listán egy furcsa bejegyzés: „Jutalom – a pult alatt”.'
            ],
            photo: 'A fotón a könyvtári pult alatt egy szalaggal átkötött csomag látszik.',
            pieces: ['MESE', 'KONYV', 'JU', 'TA', 'LOM'],
            decoys: ['Ez egy szótár „A” betűs oldala. Hamis nyom! 📖', 'A könyvtár nyitvatartása. Nem ez kell.', 'Egy lejárt kölcsönzési figyelmeztetés. Nem nyom!'],
            solution: 'Az üzenet a könyvtáros néni kincskereső játéka volt: a pult alatt egy vadonatúj mesekönyv várt rád jutalmul! 🎁'
        }
    ];

    const G6_LEVELS = {
        1: { stations: ['read', 'read', 'photo'],                      vague: false, decoys: 0, showPieces: true,  shuffleMiddle: false },
        2: { stations: ['read', 'restore', 'photo'],                   vague: false, decoys: 0, showPieces: true,  shuffleMiddle: false },
        3: { stations: ['read', 'restore', 'rename', 'photo'],         vague: false, decoys: 1, showPieces: false, shuffleMiddle: false },
        4: { stations: ['read', 'rename', 'restore', 'photo'],         vague: true,  decoys: 2, showPieces: false, shuffleMiddle: true },
        5: { stations: ['read', 'restore', 'rename', 'photo', 'read'], vague: true,  decoys: 3, showPieces: false, shuffleMiddle: true }
    };

    const G6_FILLERS = [
        { name: 'jegyzet.txt', content: 'Semmi különös. Csak egy bevásárlólista: tej, kenyér.' },
        { name: 'rajz.png', content: '🖍️' },
        { name: 'órarend.docx', content: 'Hétfő: matek, magyar, rajz' },
        { name: 'zene.mp3', content: 'Valami dallam – 2:31' },
        { name: 'lista.txt', content: '1. Alma\n2. Körte\n3. Szilva' },
        { name: 'beszámoló.docx', content: 'Egy unalmas beszámoló a múlt hétről.' }
    ];

    class DigitalDetective extends QuestBase {
        constructor(container, ctx) {
            super(container, ctx, { title: 'A Digitális Detektív', icon: '🕵️' });
            this.lastCaseId = null;
            this.startRound();
        }

        startRound() {
            this.level = this.ctx.level;
            this.cfg = G6_LEVELS[this.level] || G6_LEVELS[1];
            this.ctx.newTask();
            this.errors = 0;
            this.finished = false;
            this.doneKeys = new Set();
            const pool = G6_CASES.filter(c => c.id !== this.lastCaseId);
            this.caseData = pick(pool);
            this.lastCaseId = this.caseData.id;
            this.shell.setLevel(this.level);
            this.shell.setErrors(0);
            this.buildWorld();
            this.render();
            this.evaluate();
            say(this.level <= 2
                ? 'Detektív, munkára fel! 🔎 Nyisd meg az Asztalon a „START_Nyomozás.txt” fájlt dupla kattintással!'
                : 'Új ügy érkezett! 🔎 Kezdd a „START_Nyomozás.txt” fájllal az Asztalon, és jegyezd fel a kódrészleteket!', 'happy');
        }

        buildWorld() {
            const c = this.caseData;
            const cfg = this.cfg;
            const vfs = makeBaseVfs();
            this.vfs = vfs;

            let types = cfg.stations.slice();
            if (cfg.shuffleMiddle) {
                const middle = shuffle(types.slice(1, -1));
                types = [types[0]].concat(middle, [types[types.length - 1]]);
                // A fotós nyom ne legyen az első
                if (types[0] === 'photo') types.reverse();
            }

            const places = shuffle(c.places);
            const photoFolderId = ensurePath(vfs, 'pictures', ['2026-os fotók']);
            // Csali fotómappák
            const old = ensurePath(vfs, 'pictures', ['2025-ös fotók']);
            addFile(vfs, old, 'kirándulás.jpg', '⛰️');
            addFile(vfs, old, 'osztálykép.jpg', '👧👦');
            if (this.level >= 4) {
                const near = ensurePath(vfs, 'pictures', ['2026-os fotók_régi']);
                addFile(vfs, near, 'homályos_kép.jpg', '🌫️');
            }
            addFile(vfs, photoFolderId, 'tábortűz.jpg', '🔥');

            const pieces = c.pieces.slice(0, types.length).map((p, i, arr) => i === arr.length - 1 ? p + (Math.floor(Math.random() * 90) + 10) : p);
            this.code = pieces.join('');

            this.stations = types.map((type, i) => {
                const no = i + 1;
                let parentId;
                let folderName;
                if (type === 'photo') {
                    parentId = photoFolderId;
                    folderName = '2026-os fotók';
                } else {
                    const place = places[i % places.length];
                    parentId = ensurePath(vfs, place[0], place.slice(1));
                    folderName = place[place.length - 1];
                    // Néhány hétköznapi fájl a helyszínen
                    sample(G6_FILLERS, 1 + Math.floor(Math.random() * 2)).forEach(f => {
                        if (!vfs.nameTaken(parentId, f.name)) addFile(vfs, parentId, f.name, f.content);
                    });
                }
                let fileName;
                if (type === 'read') fileName = 'nyom_' + no + '.txt';
                else if (type === 'restore') fileName = 'kidobott_cetli.txt';
                else if (type === 'rename') fileName = 'titkos_uzenet.dat';
                else fileName = 'bizonyíték_' + no + '.jpg';
                return { no, type, parentId, folderName, fileName, piece: pieces[i], id: null, found: false };
            });

            // Nyomfájlok tartalma (a következő nyomra mutató útmutatással)
            this.stations.forEach((st, i) => {
                const next = this.stations[i + 1];
                const pointer = next
                    ? '➡️ ' + this.pointerText(next)
                    : '🏁 Ez volt az utolsó nyom! Rakd össze a kódrészleteket sorrendben (1., 2., 3. …), és írd be a nyomozói jegyzetfüzetbe!';
                let content;
                if (st.type === 'photo') {
                    content = '📸 ' + c.photo + ' · A kép hátoldalán: „' + st.no + '. kódrészlet: ' + st.piece + '” · ' + pointer;
                } else {
                    content = '🕵️ ' + st.no + '. nyom\n\n' + c.flavor[i % c.flavor.length] + '\n\n🔑 ' + st.no + '. kódrészlet: ' + st.piece + '\n\n' + pointer;
                }
                const node = addFile(vfs, st.parentId, st.fileName, content);
                st.id = node.id;
            });

            // Hamis nyomok
            this.decoyIds = new Set();
            const decoyPlaces = places.slice(this.stations.length).concat(places);
            for (let d = 0; d < cfg.decoys; d++) {
                const place = decoyPlaces[d % decoyPlaces.length];
                const parentId = ensurePath(vfs, place[0], place.slice(1));
                const name = vfs.nameTaken(parentId, 'gyanús_cetli.txt') ? 'hamis_nyom_' + (d + 1) + '.txt' : 'gyanús_cetli.txt';
                const node = addFile(vfs, parentId, name, '🤨 ' + c.decoys[d % c.decoys.length]);
                this.decoyIds.add(node.id);
            }

            // Kezdőfájl az Asztalon
            const start = addFile(vfs, 'desktop',
                'START_Nyomozás.txt',
                c.emoji + ' ' + c.title.toUpperCase() + '\n\n' + c.intro + '\n\n❓ A kérdés: ' + c.question + '\n\n' +
                '🔑 A megoldáshoz egy titkos kódot kell összeraknod, ami ' + this.stations.length + ' kódrészletből áll. Minden nyomnál találsz egyet!\n\n' +
                '➡️ ' + this.pointerText(this.stations[0]));
            this.startFileId = start.id;

            // A „visszaállítós” nyomot a Lomtárba tesszük
            this.stations.filter(st => st.type === 'restore').forEach(st => vfs.delete([st.id]));
            vfs.undoStack = [];
        }

        /** Útmutatás a következő nyomhoz – magasabb szinten kevésbé pontos. */
        pointerText(st) {
            const path = this.vfs.getPath(st.parentId);
            const vague = this.cfg.vague;
            switch (st.type) {
                case 'read':
                    return vague
                        ? 'A következő nyom a(z) „' + st.folderName + '” nevű mappában van. Keresd meg! (Tipp: használd a keresőt, vagy nézz körül a mappákban.)'
                        : 'Nézd meg ezt a mappát: ' + path + '\nOtt vár rád a(z) „' + st.fileName + '” fájl.';
                case 'restore':
                    return vague
                        ? 'A következő nyom a szemétben landolt… 🗑️ Mentsd ki, és olvasd el!'
                        : 'Hoppá! Valaki kidobta a következő nyomot a Lomtárba! Keresd meg a(z) „' + st.fileName + '” fájlt a Lomtárban, állítsd vissza, és nyisd meg!';
                case 'rename':
                    return vague
                        ? 'A(z) „' + st.folderName + '” mappában van egy fájl, amit a gép nem tud megnyitni. Javítsd ki a kiterjesztését .txt-re, és olvasd el!'
                        : 'A következő nyom itt van: ' + path + '\\' + st.fileName + ' – de a gép nem tudja megnyitni, mert rossz a kiterjesztése! Nevezd át „titkos_uzenet.txt”-re (F2), és nyisd meg!';
                default:
                    return vague
                        ? 'Nézd meg a 2026-os fotók mappát!'
                        : 'Nézd meg a Képek mappán belül a „2026-os fotók” mappát! A(z) „' + st.fileName + '” képen van a következő kódrészlet.';
            }
        }

        render() {
            const c = this.caseData;
            this.layout(
                '<div class="fkq-story"><h4>' + c.emoji + ' ' + escapeHtml(c.title) + '</h4>' +
                    escapeHtml(c.intro) + '<br><br>❓ <b>' + escapeHtml(c.question) + '</b>' +
                '</div>' +
                '<div class="fkg6-notebook"><h4>📒 Nyomozói jegyzetfüzet</h4><ul class="fkg6-clues" data-clues></ul></div>' +
                (this.cfg.showPieces ? '' : '<div class="fkq-rule">✍️ A kódrészleteket most neked kell megjegyezned vagy felírnod egy papírra!</div>') +
                '<form class="fkg6-form" data-form autocomplete="off">' +
                    '<label for="fkg6-code">🔐 A titkos kód:</label>' +
                    '<div class="fkg6-form-row">' +
                        '<input id="fkg6-code" class="fkg6-input" data-code maxlength="24" spellcheck="false" placeholder="pl. ABC12">' +
                        '<button type="submit" class="fkg6-submit">Ellenőrzés</button>' +
                    '</div>' +
                '</form>'
            );
            this.cluesEl = this.panel.querySelector('[data-clues]');
            this.codeInput = this.panel.querySelector('[data-code]');
            this.panel.querySelector('[data-form]').addEventListener('submit', ev => {
                ev.preventDefault();
                this.checkCode();
            });
            // A kódmezőben gépelt betűk ne indítsanak Fájlkezelő-gyorsbillentyűt
            this.codeInput.addEventListener('keydown', ev => ev.stopPropagation());
            this.mountExplorer({
                startId: 'desktop',
                disabledActions: ['delete', 'deletePermanent', 'emptyBin', 'cut', 'copy', 'paste', 'move', 'newFolder'],
                hooks: {
                    onFileOpened: e => this.onOpened(e),
                    onFileRestored: e => this.onRestored(e),
                    onFileRenamed: e => this.onRenamed(e)
                }
            });
        }

        onOpened(e) {
            if (this.finished) return;
            const node = e.node;
            if (node.id === this.startFileId) {
                this.shell.feedback('📜 Az ügy elkezdődött!', 'info');
                return;
            }
            if (this.decoyIds.has(node.id)) {
                this.shell.feedback('🤨 Hamis nyom!', 'info');
                say('Ez egy hamis nyom volt! Egy jó detektív nem esik pánikba – olvasd el újra az utolsó igazi nyomot! 🕵️', 'think');
                return;
            }
            const st = this.stations.find(s => s.id === node.id);
            if (!st) return;
            if (st.type === 'rename' && node.ext !== '.txt') {
                say('Ezt a fájlt a gép nem tudja megnyitni, mert a kiterjesztése ' + node.ext + '. Jelöld ki, nyomd meg az F2 gombot, és írd át a végét .txt-re!', 'think');
                return;
            }
            if (!st.found) {
                st.found = true;
                this.shell.feedback('🔎 Új nyom: ' + st.no + '. kódrészlet!', 'ok');
                if (this.stations.every(s => s.found)) {
                    setTimeout(() => {
                        if (this.shell.alive && !this.finished) say('Megvan az összes nyom! Rakd össze a kódrészleteket sorrendben, és írd be a jegyzetfüzet alatti mezőbe! 🔐', 'happy');
                    }, 500);
                }
                this.evaluate();
            }
        }

        onRestored(e) {
            if (this.finished) return;
            const st = this.stations.find(s => e.nodes.some(n => n.id === s.id));
            if (st) {
                this.shell.feedback('♻️ Előkerült a cetli!', 'ok');
                say('Szuper! A cetli visszakerült ide: ' + this.vfs.getPath(st.parentId) + '. Menj oda, és nyisd meg! 📄', 'happy');
            }
        }

        onRenamed(e) {
            if (this.finished) return;
            const st = this.stations.find(s => s.id === e.node.id);
            if (!st || st.type !== 'rename') return;
            if (e.node.ext === '.txt') {
                this.shell.feedback('🔧 Megjavítottad a kiterjesztést!', 'ok');
                say('Most már meg tudod nyitni! Kattints rá duplán! 📖', 'happy');
            } else {
                say('A kiterjesztés még mindig nem jó (' + (e.node.ext || 'nincs') + '). Az utolsó pont után ez álljon: txt', 'think');
            }
        }

        normalizeCode(text) {
            return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        }

        checkCode() {
            if (this.finished) return;
            const value = this.normalizeCode(this.codeInput.value);
            if (!value) {
                this.shell.feedback('Előbb írd be a kódot!', 'info');
                this.codeInput.focus();
                return;
            }
            if (value === this.code) {
                this.codeInput.disabled = true;
                this.shell.feedback('🔓 A kód helyes! Az ügy megoldva!', 'ok');
                this.stations.forEach(s => { s.found = true; });
                this.evaluate();
                this.finish([
                    '🕵️ Ügy: ' + this.caseData.title,
                    '💡 ' + this.caseData.solution,
                    '🔐 A titkos kód: ' + this.code,
                    '🔎 Nyomok: ' + this.stations.length
                ]);
                return;
            }
            this.codeInput.classList.remove('is-wrong');
            void this.codeInput.offsetWidth;
            this.codeInput.classList.add('is-wrong');
            const found = this.stations.filter(s => s.found).length;
            let hint;
            if (found < this.stations.length) {
                hint = 'Ez még nem a jó kód. Eddig ' + found + ' nyomot találtál a(z) ' + this.stations.length + ' közül – keresd meg a többit is!';
            } else {
                const sameLetters = value.length === this.code.length && value.split('').sort().join('') === this.code.split('').sort().join('');
                hint = sameLetters
                    ? 'Majdnem! A betűk jók, de a sorrend nem. Az 1. nyom kódrészlete kerüljön előre, utána a 2., és így tovább!'
                    : 'Nem jó a kód. Nézd meg újra a nyomokat: minden fájlban van egy „kódrészlet”. Ezeket kell sorban egymás után írnod!';
            }
            this.addError(hint);
        }

        evaluate() {
            if (!this.cluesEl) return;
            this.cluesEl.innerHTML = this.stations.map(st => {
                if (!st.found) return '<li class="fkg6-clue is-missing">❔ ' + st.no + '. nyom: még nem találtad meg</li>';
                return '<li class="fkg6-clue">✔ ' + st.no + '. nyom: ' + (this.cfg.showPieces ? 'kódrészlet <b>' + escapeHtml(st.piece) + '</b>' : 'megtalálva') + '</li>';
            }).join('');
            const found = this.stations.filter(s => s.found).length;
            this.shell.setProgress('🔎 ' + found + ' / ' + this.stations.length + ' nyom');
        }

        hint() {
            if (this.finished || !this.explorer) return null;
            const next = this.stations.find(s => !s.found);
            if (!next) return 'Megvan minden nyom! Írd be a kódrészleteket egymás után (1., 2., 3. …) a „titkos kód” mezőbe!';
            const startNode = this.vfs.get(this.startFileId);
            if (this.stations.every(s => !s.found) && startNode && this.explorer.currentId === 'desktop') {
                this.explorer.flash(this.startFileId);
                if (next.type !== 'read' || this.level <= 2) return 'Nyisd meg a „START_Nyomozás.txt” fájlt dupla kattintással, és olvasd el, hová vezet az első nyom!';
            }
            const node = this.vfs.get(next.id);
            switch (next.type) {
                case 'restore':
                    if (node && node.isDeleted) {
                        if (this.explorer.currentId === 'recycle') this.explorer.flash(next.id);
                        return 'Nyisd meg a Lomtárat, jelöld ki a(z) „kidobott_cetli.txt” fájlt, és kattints a „Visszaállítás” gombra!';
                    }
                    this.flashIfVisible(next.id);
                    return 'A cetli visszakerült ide: ' + this.vfs.getPath(next.parentId) + '. Menj oda, és nyisd meg dupla kattintással!';
                case 'rename':
                    this.flashIfVisible(next.id);
                    if (node && node.ext !== '.txt') return 'A rejtélyes fájl itt van: ' + this.vfs.getPath(next.parentId) + '. Jelöld ki, nyomd meg az F2 gombot, és a végét írd át .txt-re!';
                    return 'Most nyisd meg a megjavított fájlt dupla kattintással!';
                case 'photo':
                    this.flashIfVisible(next.id);
                    return 'Menj a Képek mappába, azon belül a „2026-os fotók” mappába, és nyisd meg a(z) „' + next.fileName + '” képet!';
                default:
                    this.flashIfVisible(next.id);
                    return 'A következő nyom itt van: ' + this.vfs.getPath(next.parentId) + ' – nyisd meg a(z) „' + next.fileName + '” fájlt!';
            }
        }
    }

    // ======================================================================
    // REGISZTRÁCIÓ A CORE.JS-BEN
    // ======================================================================
    function register() {
        if (typeof FK.registerGame !== 'function') {
            console.warn('Fájl-Kaland: a games_2.js-hez a core.js szükséges.');
            return;
        }
        FK.registerGame(makeGame({
            id: 4,
            name: 'Káosz Kapitány Szobája',
            icon: '🏴‍☠️',
            color: '#f59e0b',
            description: 'Káosz Kapitány mindent szétszórt! Hozz létre mappákat, nevezd át a csúnya nevű fájlokat a tartalmuk alapján, és tegyél mindent a helyére!'
        }, ChaosCaptain));

        FK.registerGame(makeGame({
            id: 5,
            name: 'Lomtár-mentő és Vírusvadász',
            icon: '🛡️',
            color: '#ef4444',
            description: 'Mentsd ki a véletlenül kitörölt házi feladatokat a Lomtárból, vadászd le a gyanús .exe vírusokat, és ürítsd ki a Lomtárat!'
        }, RecycleRescue));

        FK.registerGame(makeGame({
            id: 6,
            name: 'A Digitális Detektív',
            icon: '🕵️',
            color: '#6366f1',
            description: 'Oldd meg a rejtélyt! Kutass a mappákban, olvasd el a nyomokat, állíts vissza és nevezz át fájlokat, végül írd be a titkos kódot!'
        }, DigitalDetective));
    }

    register();
})();
