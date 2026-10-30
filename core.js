/* ==========================================================================
   Fájl-Kaland – core.js  (verzió: 0.6.1 beta)
   Bejelentkezés, tanári vezérlőpult, Windows 11 jellegű diák asztal,
   ablakkezelő, Adaptív Nehézségi Motor, Biti a kiber-robot, Bájt-Bolt,
   profil és kitűzők.

   A későbbi modulok (explorer.js, games_1.js, games_2.js) a window.FK
   objektumon keresztül csatlakoznak:

     FK.registerGame({
         id: 1,                         // 1–6
         name: 'Kiterjesztés-párosító', // opcionális, felülírja az alapnevet
         icon: '📁',                    // opcionális
         description: '…',              // opcionális
         mount(container, ctx) { … },   // a játék felépítése a megadott elembe
         unmount() { … },               // opcionális takarítás bezáráskor
         getHint(level) { return '…'; } // opcionális: Biti tétlenségi tippje
     });

   A ctx (játék-környezet) tartalma:
     ctx.level                 – aktuális nehézségi szint (1–5, getter)
     ctx.newTask()             – új feladat kezdése (hibaszámláló nullázása)
     ctx.error(hint)           – hibás lépés jelzése (2. hibánál könnyebb szint + Biti segít)
     ctx.complete({xp, coins}) – sikeres feladat → mentés az api.php-ba (Promise)
     ctx.fail()                – sikertelen/feladott feladat → mentés
     ctx.setHint(textOrFn)     – az aktuális feladat tippje (Biti 20 mp tétlenség után mondja)
     ctx.onLevelChange(cb)     – értesítés nehézségi szint változáskor
     ctx.biti                  – Biti objektum (say, praise, help, tip)
     ctx.close()               – a játékablak bezárása

   Egyéb alkalmazás (pl. fájlkezelő) regisztrálása:
     FK.registerApp({ id: 'explorer', name: 'Fájlkezelő', icon: '🗂️', desktop: true, open() { … } });
   ========================================================================== */

(function () {
    'use strict';

    const API_URL = 'api.php';

    // ======================================================================
    // GLOBÁLIS ÁLLAPOT
    // ======================================================================
    const FK = window.FK = window.FK || {};
    FK.VERSION = '0.6.1 beta';
    FK.state = { user: null, progress: [] };
    FK.apps = FK.apps || {};
    FK.games = FK.games || {};

    // A 6 játékmód alapadatai (ugyanazok, mint a games_1.js / games_2.js regisztrációjában; azok felülírhatják)
    const GAME_DEFS = {
        1: { id: 1, name: 'Kiterjesztés-párosító',       icon: '🔍', color: '#3b82f6', description: 'Juttasd a futószalagon érkező fájlokat a megfelelő állomásra a kiterjesztésük alapján!' },
        2: { id: 2, name: 'Útvonal-labirintus',          icon: '🧭', color: '#10b981', description: 'Igazodj el a mappák útvesztőjében az elérési utak segítségével!' },
        3: { id: 3, name: 'Billentyűparancs-nindzsa',    icon: '🥷', color: '#8b5cf6', description: 'Másolás, kivágás, beillesztés, átnevezés, törlés és visszavonás – gyorsbillentyűkkel!' },
        4: { id: 4, name: 'Káosz Kapitány Szobája',      icon: '🏴‍☠️', color: '#f59e0b', description: 'Hozz létre mappákat, nevezd át a csúnya nevű fájlokat, és tegyél mindent a helyére!' },
        5: { id: 5, name: 'Lomtár-mentő és Vírusvadász', icon: '🛡️', color: '#ef4444', description: 'Mentsd ki a házi feladatokat a Lomtárból, és vadászd le a gyanús .exe fájlokat!' },
        6: { id: 6, name: 'A Digitális Detektív',        icon: '🕵️', color: '#6366f1', description: 'Oldd meg a rejtélyt a mappákban elrejtett nyomok segítségével!' }
    };
    FK.gameDefs = GAME_DEFS;
    FK.gameNames = {};
    Object.keys(GAME_DEFS).forEach(id => { FK.gameNames[id] = GAME_DEFS[id].name; });

    // A bolt megjelenítési adatai (az árat és a tulajdonjogot a szerver adja)
    const SHOP_META = {
        bg_default:   { type: 'bg',     name: 'Kék álom',      emoji: '💙', desc: 'Az eredeti Fájl-Kaland háttér.' },
        bg_station:   { type: 'bg',     name: 'Űrállomás',     emoji: '🛰️', desc: 'Csillagok, bolygó és egy keringő űrállomás.' },
        bg_cyber:     { type: 'bg',     name: 'Cyberpunk',     emoji: '🌆', desc: 'Neon napnyugta és végtelen rács.' },
        bg_cats:      { type: 'bg',     name: 'Cicás',         emoji: '🐱', desc: 'Cicafejek és mancsnyomok mindenhol.' },
        bg_jungle:    { type: 'bg',     name: 'Dzsungel',      emoji: '🌴', desc: 'Sűrű, zöld levelek erdeje.' },
        bg_football:  { type: 'bg',     name: 'Focipálya',     emoji: '⚽', desc: 'Csíkos gyep, felezővonal és kezdőkör.' },
        folder_default: { type: 'folder', name: 'Alap sárga',    emoji: '📂', desc: 'A klasszikus sárga mappa.' },
        folder_gold:  { type: 'folder', name: 'Arany kincses', emoji: '💎', desc: 'Csillogó arany mappa drágakővel.' },
        folder_neon:  { type: 'folder', name: 'Neon kék',      emoji: '💡', desc: 'Sötétben világító neon mappa.' },
        folder_pixel: { type: 'folder', name: 'Pixeles',       emoji: '👾', desc: 'Retró, kockás videojáték-stílus.' }
    };

    // ======================================================================
    // SEGÉDFÜGGVÉNYEK
    // ======================================================================
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatNumber(n) {
        return Number(n || 0).toLocaleString('hu-HU');
    }

    function formatDate(sqlDate) {
        if (!sqlDate) return '–';
        const d = new Date(String(sqlDate).replace(' ', 'T'));
        if (isNaN(d.getTime())) return escapeHtml(sqlDate);
        return d.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' }) + ' ' +
               d.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
    }

    function initials(name) {
        const parts = String(name || '?').trim().split(/\s+/);
        const first = parts[0] ? parts[0][0] : '?';
        const second = parts.length > 1 ? parts[parts.length - 1][0] : '';
        return (first + second).toUpperCase();
    }

    /** Magyar névsorrend: a keresztnév az utolsó szó. */
    function firstName(name) {
        const parts = String(name || '').trim().split(/\s+/);
        return parts[parts.length - 1] || 'Kalandor';
    }

    function randomItem(list) {
        return list[Math.floor(Math.random() * list.length)];
    }

    /** XP alapú játékosszint (megegyezik a PHP level_from_xp logikával). */
    function levelInfo(xp) {
        let level = 1, need = 100, rest = Number(xp || 0);
        while (rest >= need) { rest -= need; level++; need += 50; }
        return { level, current: rest, need, ratio: need > 0 ? rest / need : 0 };
    }

    function stars(level, max = 5) {
        let html = '';
        for (let i = 1; i <= max; i++) {
            html += '<span class="fk-star' + (i <= level ? ' is-on' : '') + '" aria-hidden="true">★</span>';
        }
        return '<span class="fk-stars" title="' + level + '. szint" aria-label="' + level + '. nehézségi szint">' + html + '</span>';
    }

    function showScreen(id) {
        $$('.fk-screen').forEach(el => el.classList.add('hidden'));
        $('#' + id).classList.remove('hidden');
        document.body.dataset.screen = id;
    }

    function progressFor(gameId) {
        return (FK.state.progress || []).find(p => Number(p.game_id) === Number(gameId)) ||
            { game_id: gameId, difficulty_level: 1, streak: 0, total_completed: 0, total_errors: 0, started: false };
    }

    FK.$ = $;
    FK.$$ = $$;
    FK.escapeHtml = escapeHtml;
    FK.formatNumber = formatNumber;
    FK.levelInfo = levelInfo;
    FK.stars = stars;
    FK.progressFor = progressFor;

    // ======================================================================
    // API HÍVÁS
    // ======================================================================
    async function api(action, data = null, method = null) {
        const httpMethod = method || (data ? 'POST' : 'GET');
        const options = {
            method: httpMethod,
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
        };
        let url = API_URL + '?action=' + encodeURIComponent(action);
        if (httpMethod === 'POST') {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(data || {});
        } else if (data) {
            Object.keys(data).forEach(k => { url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(data[k]); });
        }
        let response;
        try {
            response = await fetch(url, options);
        } catch (e) {
            throw new Error('Nem érhető el a szerver. Ellenőrizd az internetkapcsolatot!');
        }
        let json;
        try {
            json = await response.json();
        } catch (e) {
            throw new Error('A szerver hibás választ adott. (Fut a PHP?)');
        }
        if (!json.success) {
            const err = new Error(json.error || 'Ismeretlen hiba történt.');
            err.status = response.status;
            if (response.status === 401 && action !== 'login') {
                handleSessionExpired();
            }
            throw err;
        }
        return json;
    }
    FK.api = api;

    function handleSessionExpired() {
        if (FK.state.user) {
            resetStudentSession();
            FK.state.user = null;
            showScreen('screen-auth');
            showAuthMessage('Lejárt a munkameneted, kérlek, jelentkezz be újra!', 'warn');
        }
    }

    // ======================================================================
    // ÉRTESÍTÉSEK (TOAST)
    // ======================================================================
    function toast(message, type = 'info') {
        const zoneId = document.body.dataset.screen === 'screen-teacher' ? 'teacher-toast-zone' : 'fk-toast-zone';
        const zone = $('#' + zoneId);
        if (!zone) return;
        const icons = { info: 'ℹ️', success: '✅', error: '⚠️', warn: '⏳', coin: '🪙', xp: '⭐', achievement: '🏆' };
        const el = document.createElement('div');
        el.className = 'fk-toast fk-toast-' + type;
        el.setAttribute('role', 'status');
        el.innerHTML = '<span class="text-xl" aria-hidden="true">' + (icons[type] || icons.info) + '</span><span>' + escapeHtml(message) + '</span>';
        zone.appendChild(el);
        setTimeout(() => {
            el.classList.add('is-leaving');
            setTimeout(() => el.remove(), 300);
        }, type === 'achievement' ? 5500 : 3800);
    }
    FK.toast = toast;

    // ======================================================================
    // MEGERŐSÍTŐ PÁRBESZÉDABLAK (tanárnak és diáknak is)
    // ======================================================================
    function confirmDialog(text, okLabel = 'Igen', okType = 'danger', title = 'Biztos vagy benne?') {
        return new Promise(resolve => {
            const modal = $('#confirm-modal');
            const okBtn = $('#confirm-ok');
            const cancelBtn = $('#confirm-cancel');
            $('#confirm-title').textContent = title;
            $('#confirm-text').textContent = text;
            okBtn.textContent = okLabel;
            okBtn.className = 'fk-btn fk-btn-' + okType;
            modal.classList.remove('hidden');
            okBtn.focus();
            const close = result => {
                modal.classList.add('hidden');
                okBtn.removeEventListener('click', onOk);
                cancelBtn.removeEventListener('click', onCancel);
                modal.removeEventListener('click', onBackdrop);
                document.removeEventListener('keydown', onKey);
                resolve(result);
            };
            const onOk = () => close(true);
            const onCancel = () => close(false);
            const onBackdrop = ev => { if (ev.target === modal) close(false); };
            const onKey = ev => { if (ev.key === 'Escape') close(false); };
            okBtn.addEventListener('click', onOk);
            cancelBtn.addEventListener('click', onCancel);
            modal.addEventListener('click', onBackdrop);
            document.addEventListener('keydown', onKey);
        });
    }
    FK.confirmDialog = confirmDialog;

    // ======================================================================
    // 1. BEJELENTKEZÉS / REGISZTRÁCIÓ
    // ======================================================================
    function showAuthMessage(text, type = 'error') {
        const box = $('#auth-message');
        box.className = 'mb-4 rounded-2xl px-4 py-3 font-bold text-sm fk-msg-' + type;
        box.textContent = text;
        box.classList.remove('hidden');
    }

    function hideAuthMessage() {
        $('#auth-message').classList.add('hidden');
    }

    function switchAuthTab(tab) {
        const isLogin = tab === 'login';
        $('#form-login').classList.toggle('hidden', !isLogin);
        $('#form-register').classList.toggle('hidden', isLogin);
        $('#tab-login').classList.toggle('is-active', isLogin);
        $('#tab-register').classList.toggle('is-active', !isLogin);
        $('#tab-login').setAttribute('aria-selected', String(isLogin));
        $('#tab-register').setAttribute('aria-selected', String(!isLogin));
        hideAuthMessage();
        if (!isLogin) loadRegisterClasses();
        setTimeout(() => (isLogin ? $('#login-username') : $('#reg-name')).focus(), 50);
    }

    async function loadRegisterClasses() {
        const select = $('#reg-class');
        try {
            const res = await api('get_classes');
            const current = select.value;
            select.innerHTML = '<option value="">Válaszd ki az osztályodat…</option>' +
                res.classes.map(c => '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>').join('');
            select.value = current;
        } catch (e) {
            showAuthMessage(e.message);
        }
    }

    function setBusy(form, busy) {
        $$('button, input, select', form).forEach(el => { el.disabled = busy; });
        const submit = $('button[type="submit"]', form);
        if (submit) submit.classList.toggle('is-loading', busy);
    }

    async function handleLogin(ev) {
        ev.preventDefault();
        hideAuthMessage();
        const form = ev.currentTarget;
        const username = $('#login-username').value.trim();
        const password = $('#login-password').value;
        if (!username || !password) {
            showAuthMessage('Add meg a felhasználónevedet és a jelszavadat!');
            return;
        }
        setBusy(form, true);
        try {
            const res = await api('login', { username, password });
            $('#login-password').value = '';
            enterApp(res.user, res.progress || [], res.new_achievements || []);
        } catch (e) {
            const pending = e.status === 403;
            showAuthMessage(e.message, pending ? 'warn' : 'error');
            if (!pending) $('#login-password').select();
        } finally {
            setBusy(form, false);
        }
    }

    async function handleRegister(ev) {
        ev.preventDefault();
        hideAuthMessage();
        const form = ev.currentTarget;
        const name = $('#reg-name').value.trim().replace(/\s+/g, ' ');
        const classId = $('#reg-class').value;
        const username = $('#reg-username').value.trim();
        const password = $('#reg-password').value;
        const password2 = $('#reg-password2').value;

        if (name.length < 3 || !name.includes(' ')) return showAuthMessage('Kérlek, a teljes nevedet írd be (vezetéknév és keresztnév)!');
        if (!classId) return showAuthMessage('Kérlek, válaszd ki az osztályodat!');
        if (username.length < 3) return showAuthMessage('A felhasználónév legalább 3 karakter legyen!');
        if (/\s/.test(username)) return showAuthMessage('A felhasználónévben nem lehet szóköz!');
        if (password.length < 4) return showAuthMessage('A jelszó legalább 4 karakter legyen!');
        if (password !== password2) return showAuthMessage('A két jelszó nem egyezik. Írd be újra!');

        setBusy(form, true);
        try {
            const res = await api('register', { name, class_id: Number(classId), username, password });
            form.reset();
            switchAuthTab('login');
            $('#login-username').value = username;
            showAuthMessage(res.message || 'Sikeres regisztráció!', 'success');
        } catch (e) {
            showAuthMessage(e.message);
        } finally {
            setBusy(form, false);
        }
    }

    async function logout() {
        try { await api('logout', {}); } catch (e) { /* a kijelentkezés hibája nem akadályozza a kilépést */ }
        resetStudentSession();
        FK.state.user = null;
        FK.state.progress = [];
        document.dispatchEvent(new CustomEvent('fk:logout'));
        $('#form-login').reset();
        switchAuthTab('login');
        showScreen('screen-auth');
        showAuthMessage('Sikeresen kijelentkeztél. Viszlát! 👋', 'success');
    }
    FK.logout = logout;

    function enterApp(user, progress, newAchievements) {
        FK.state.user = user;
        FK.state.progress = progress || [];
        if (user.role === 'teacher') {
            initTeacher();
        } else {
            initStudent(newAchievements || []);
        }
    }

    function bindAuthEvents() {
        $$('[data-tab]').forEach(btn => btn.addEventListener('click', () => switchAuthTab(btn.dataset.tab)));
        $('#form-login').addEventListener('submit', handleLogin);
        $('#form-register').addEventListener('submit', handleRegister);
        $$('[data-toggle-password]').forEach(btn => btn.addEventListener('click', () => {
            const input = $('#' + btn.dataset.togglePassword);
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            btn.textContent = show ? '🙈' : '👁️';
            btn.setAttribute('aria-label', show ? 'Jelszó elrejtése' : 'Jelszó megjelenítése');
        }));
    }

    // ======================================================================
    // 1/B. TANÁRI VEZÉRLŐPULT
    // ======================================================================
    const teacher = {
        initialized: false,
        panel: 'pending',
        classes: [],
        pending: [],
        stats: { students: [], summary: null }
    };

    function teacherAction(sub, data = {}) {
        return api('teacher_actions', Object.assign({ sub }, data));
    }

    function currentClassFilter() {
        return Number($('#teacher-class-filter').value || 0);
    }

    function initTeacher() {
        showScreen('screen-teacher');
        $('#teacher-name').textContent = FK.state.user.name;
        if (!teacher.initialized) {
            bindTeacherEvents();
            teacher.initialized = true;
        }
        switchTeacherPanel('pending');
        refreshTeacher();
    }

    function bindTeacherEvents() {
        $$('.fk-teacher-tab').forEach(btn => btn.addEventListener('click', () => switchTeacherPanel(btn.dataset.panel)));
        $('#teacher-class-filter').addEventListener('change', refreshTeacherData);
        $('#teacher-refresh').addEventListener('click', refreshTeacher);
        $('#teacher-logout').addEventListener('click', logout);

        // Jóváhagyás
        $('#pending-select-all').addEventListener('change', ev => {
            $$('.pending-check').forEach(cb => { cb.checked = ev.target.checked; });
            updatePendingButtons();
        });
        $('#pending-tbody').addEventListener('change', ev => {
            if (ev.target.classList.contains('pending-check')) updatePendingButtons();
        });
        $('#pending-tbody').addEventListener('click', async ev => {
            const btn = ev.target.closest('button[data-act]');
            if (!btn) return;
            const id = Number(btn.dataset.id);
            if (btn.dataset.act === 'approve') {
                await approveStudents([id]);
            } else if (btn.dataset.act === 'reject') {
                const st = teacher.pending.find(p => p.id === id);
                if (await confirmDialog('Elutasítod ' + (st ? st.name : 'a diák') + ' regisztrációját? A fiók törlődik.')) {
                    await rejectStudents([id]);
                }
            }
        });
        $('#pending-approve-selected').addEventListener('click', () => approveStudents(selectedPendingIds()));
        $('#pending-reject-selected').addEventListener('click', async () => {
            const ids = selectedPendingIds();
            if (ids.length && await confirmDialog(ids.length + ' regisztráció elutasítása. A fiókok törlődnek.')) {
                await rejectStudents(ids);
            }
        });
        $('#pending-approve-all').addEventListener('click', async () => {
            if (!teacher.pending.length) return toast('Nincs jóváhagyásra váró diák.', 'info');
            const classId = currentClassFilter();
            const label = classId ? 'a kiválasztott osztály összes' : 'az összes';
            if (!(await confirmDialog('Jóváhagyod ' + label + ' várakozó diákját (' + teacher.pending.length + ' fő)?', 'Igen, mind', 'success'))) return;
            try {
                const res = await teacherAction('approve_all', { class_id: classId });
                toast(res.message, 'success');
                await Promise.all([refreshTeacherData(), loadTeacherClasses()]);
            } catch (e) { toast(e.message, 'error'); }
        });

        // Előrehaladás
        $('#progress-search').addEventListener('input', renderProgress);
        $('#progress-sort').addEventListener('change', renderProgress);

        // Osztályok
        $('#form-add-class').addEventListener('submit', async ev => {
            ev.preventDefault();
            const input = $('#new-class-name');
            const name = input.value.trim().replace(/\s+/g, '');
            if (!name) return toast('Add meg az osztály nevét!', 'error');
            try {
                const res = await teacherAction('add_class', { name });
                toast(res.message, 'success');
                input.value = '';
                await loadTeacherClasses();
            } catch (e) { toast(e.message, 'error'); }
        });
        $('#classes-grid').addEventListener('click', ev => {
            const card = ev.target.closest('[data-class-id]');
            if (!card) return;
            $('#teacher-class-filter').value = card.dataset.classId;
            refreshTeacherData();
            switchTeacherPanel('progress');
        });

        // Jelszó-visszaállítás
        $('#reset-generate').addEventListener('click', () => { $('#reset-password').value = generatePassword(); });
        $('#form-reset-password').addEventListener('submit', async ev => {
            ev.preventDefault();
            const studentId = Number($('#reset-student').value);
            const newPassword = $('#reset-password').value.trim();
            if (!studentId) return toast('Válassz ki egy diákot!', 'error');
            if (newPassword.length < 4) return toast('Az új jelszó legalább 4 karakter legyen!', 'error');
            try {
                const res = await teacherAction('reset_password', { student_id: studentId, new_password: newPassword });
                toast(res.message + ' Új jelszó: ' + newPassword, 'success');
            } catch (e) { toast(e.message, 'error'); }
        });
    }

    function switchTeacherPanel(panel) {
        teacher.panel = panel;
        $$('.fk-teacher-tab').forEach(btn => btn.classList.toggle('is-active', btn.dataset.panel === panel));
        $$('.fk-teacher-panel').forEach(sec => sec.classList.toggle('hidden', sec.id !== 'panel-' + panel));
    }

    async function refreshTeacher() {
        await loadTeacherClasses();
        await refreshTeacherData();
    }

    async function refreshTeacherData() {
        await Promise.all([loadPending(), loadStats(), loadResetStudents()]);
    }

    async function loadTeacherClasses() {
        try {
            const res = await teacherAction('list_classes');
            teacher.classes = res.classes;
            const filter = $('#teacher-class-filter');
            const current = filter.value;
            filter.innerHTML = '<option value="0">Minden osztály</option>' +
                res.classes.map(c => '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>').join('');
            filter.value = res.classes.some(c => String(c.id) === current) ? current : '0';
            renderClasses();
        } catch (e) { toast(e.message, 'error'); }
    }

    function renderClasses() {
        const grid = $('#classes-grid');
        if (!teacher.classes.length) {
            grid.innerHTML = '<p class="text-slate-500 font-bold">Még nincs osztály.</p>';
            return;
        }
        grid.innerHTML = teacher.classes.map(c =>
            '<button type="button" class="fk-class-card" data-class-id="' + c.id + '">' +
                '<span class="fk-class-name">' + escapeHtml(c.name) + '</span>' +
                '<span class="text-sm font-bold text-slate-600">🧒 ' + c.active_count + ' aktív diák</span>' +
                (c.pending_count > 0
                    ? '<span class="text-sm font-bold text-amber-600">⏳ ' + c.pending_count + ' várakozik</span>'
                    : '<span class="text-sm font-bold text-emerald-600">✔ nincs várakozó</span>') +
                '<span class="text-xs font-bold text-blue-600 mt-1">Statisztika megnyitása →</span>' +
            '</button>'
        ).join('');
    }

    async function loadPending() {
        try {
            const res = await teacherAction('list_pending', { class_id: currentClassFilter() });
            teacher.pending = res.students;
            renderPending();
        } catch (e) { toast(e.message, 'error'); }
    }

    function renderPending() {
        const tbody = $('#pending-tbody');
        const list = teacher.pending;
        $('#pending-select-all').checked = false;
        $('#pending-empty').classList.toggle('hidden', list.length > 0);
        tbody.parentElement.parentElement.classList.toggle('hidden', list.length === 0);
        const badge = $('#pending-badge');
        badge.textContent = list.length;
        badge.classList.toggle('hidden', list.length === 0);

        tbody.innerHTML = list.map(s =>
            '<tr>' +
                '<td><input type="checkbox" class="fk-check pending-check" value="' + s.id + '" aria-label="' + escapeHtml(s.name) + ' kijelölése"></td>' +
                '<td class="font-bold text-slate-800">' + escapeHtml(s.name) + '</td>' +
                '<td class="font-mono text-slate-600">' + escapeHtml(s.username) + '</td>' +
                '<td><span class="fk-chip">' + escapeHtml(s.class_name || '–') + '</span></td>' +
                '<td class="text-slate-500 text-sm whitespace-nowrap">' + formatDate(s.created_at) + '</td>' +
                '<td class="text-right whitespace-nowrap">' +
                    '<button type="button" class="fk-btn fk-btn-success fk-btn-sm" data-act="approve" data-id="' + s.id + '">✅ Jóváhagy</button> ' +
                    '<button type="button" class="fk-btn fk-btn-outline-danger fk-btn-sm" data-act="reject" data-id="' + s.id + '" aria-label="Elutasítás">✖</button>' +
                '</td>' +
            '</tr>'
        ).join('');
        updatePendingButtons();
    }

    function selectedPendingIds() {
        return $$('.pending-check:checked').map(cb => Number(cb.value));
    }

    function updatePendingButtons() {
        const n = selectedPendingIds().length;
        $('#pending-approve-selected').disabled = n === 0;
        $('#pending-reject-selected').disabled = n === 0;
        $('#pending-approve-selected').textContent = n > 0 ? '✅ Kijelöltek jóváhagyása (' + n + ')' : '✅ Kijelöltek jóváhagyása';
        const all = $$('.pending-check');
        $('#pending-select-all').checked = all.length > 0 && n === all.length;
        $('#pending-select-all').indeterminate = n > 0 && n < all.length;
    }

    async function approveStudents(ids) {
        if (!ids.length) return;
        try {
            const res = await teacherAction('approve', { ids });
            toast(res.message, 'success');
            await Promise.all([loadPending(), loadStats(), loadResetStudents(), loadTeacherClasses()]);
        } catch (e) { toast(e.message, 'error'); }
    }

    async function rejectStudents(ids) {
        if (!ids.length) return;
        try {
            const res = await teacherAction('reject', { ids });
            toast(res.message, 'success');
            await Promise.all([loadPending(), loadTeacherClasses()]);
        } catch (e) { toast(e.message, 'error'); }
    }

    async function loadStats() {
        try {
            const res = await teacherAction('class_stats', { class_id: currentClassFilter() });
            teacher.stats = res;
            renderStats();
            renderProgress();
        } catch (e) { toast(e.message, 'error'); }
    }

    function renderStats() {
        const s = teacher.stats.summary || { student_count: 0, avg_xp: 0, total_coins: 0, games: [] };
        $('#stat-students').textContent = formatNumber(s.student_count);
        $('#stat-avg-xp').textContent = formatNumber(s.avg_xp);
        $('#stat-coins').textContent = formatNumber(s.total_coins);
        $('#stat-completed').textContent = formatNumber((s.games || []).reduce((a, g) => a + g.completed, 0));
    }

    function renderProgress() {
        const thead = $('#progress-thead');
        const tbody = $('#progress-tbody');
        const tfoot = $('#progress-tfoot');
        const query = $('#progress-search').value.trim().toLowerCase();
        const sort = $('#progress-sort').value;
        const totalErrors = st => st.games.reduce((a, g) => a + g.total_errors, 0);
        const gameIds = Object.keys(GAME_DEFS);

        let rows = (teacher.stats.students || []).filter(st =>
            !query || st.name.toLowerCase().includes(query) || st.username.toLowerCase().includes(query));

        const collator = new Intl.Collator('hu');
        rows = rows.slice().sort((a, b) => {
            switch (sort) {
                case 'name':   return collator.compare(a.name, b.name);
                case 'xp':     return b.xp - a.xp;
                case 'coins':  return b.coins - a.coins;
                case 'errors': return totalErrors(b) - totalErrors(a);
                default:       return collator.compare(a.class_name || '', b.class_name || '') || collator.compare(a.name, b.name);
            }
        });

        thead.innerHTML = '<tr>' +
            '<th class="fk-sticky-col">Diák</th>' +
            '<th>Osztály</th>' +
            '<th class="text-center">Szint</th>' +
            '<th class="text-right">⭐ XP</th>' +
            '<th class="text-right">🪙 Érme</th>' +
            gameIds.map(g =>
                '<th class="text-center"><span class="block text-xs text-slate-400">' + g + '. játék</span>' +
                escapeHtml(GAME_DEFS[g].icon + ' ' + GAME_DEFS[g].name) + '</th>'
            ).join('') +
            '<th class="text-right">❌ Össz. hiba</th>' +
        '</tr>';

        const hasStudents = (teacher.stats.students || []).length > 0;
        $('#progress-empty').classList.toggle('hidden', hasStudents);
        tbody.parentElement.parentElement.classList.toggle('hidden', !hasStudents);

        if (hasStudents && rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="' + (6 + gameIds.length) + '" class="text-center py-6 font-bold text-slate-500">Nincs találat a keresésre.</td></tr>';
        } else {
            tbody.innerHTML = rows.map(st =>
                '<tr>' +
                    '<td class="fk-sticky-col"><div class="flex items-center gap-2"><span class="fk-avatar fk-avatar-xs">' + escapeHtml(initials(st.name)) + '</span>' +
                        '<div><div class="font-bold text-slate-800 whitespace-nowrap">' + escapeHtml(st.name) + '</div><div class="text-xs font-mono text-slate-500">' + escapeHtml(st.username) + '</div></div></div></td>' +
                    '<td><span class="fk-chip">' + escapeHtml(st.class_name || '–') + '</span></td>' +
                    '<td class="text-center font-extrabold text-indigo-700">' + st.level + '</td>' +
                    '<td class="text-right font-bold">' + formatNumber(st.xp) + '</td>' +
                    '<td class="text-right font-bold">' + formatNumber(st.coins) + '</td>' +
                    st.games.map(g =>
                        '<td class="text-center" title="' + escapeHtml((GAME_DEFS[g.game_id] || {}).name || '') + ': ' +
                            (g.started ? g.difficulty_level + '. szint, ' + g.total_completed + ' teljesítés, ' + g.total_errors + ' hiba, sorozat: ' + g.streak : 'még nem játszott') + '">' +
                            '<div class="flex flex-col items-center gap-0.5">' +
                                '<span class="fk-lvl fk-lvl-' + (g.started ? g.difficulty_level : 0) + '">' + (g.started ? g.difficulty_level : '–') + '</span>' +
                                (g.started ? '<span class="text-[11px] font-bold text-slate-500 whitespace-nowrap">✔' + g.total_completed + ' · ❌' + g.total_errors + '</span>' : '') +
                            '</div>' +
                        '</td>'
                    ).join('') +
                    '<td class="text-right font-bold ' + (totalErrors(st) > 20 ? 'text-rose-600' : 'text-slate-700') + '">' + formatNumber(totalErrors(st)) + '</td>' +
                '</tr>'
            ).join('');
        }

        const s = teacher.stats.summary;
        if (s && hasStudents) {
            tfoot.innerHTML = '<tr>' +
                '<td class="fk-sticky-col font-extrabold">Osztályátlag</td><td></td><td></td>' +
                '<td class="text-right font-extrabold">' + formatNumber(s.avg_xp) + '</td>' +
                '<td class="text-right font-extrabold">' + formatNumber(s.student_count ? Math.round(s.total_coins / s.student_count) : 0) + '</td>' +
                s.games.map(g => '<td class="text-center text-xs font-bold text-slate-600">' +
                    (g.players ? 'átl. ' + g.avg_level + '. szint<br>' + g.players + ' fő · ❌' + g.errors : '–') + '</td>').join('') +
                '<td></td>' +
            '</tr>';
        } else {
            tfoot.innerHTML = '';
        }
    }

    async function loadResetStudents() {
        try {
            const res = await teacherAction('list_students', { class_id: currentClassFilter() });
            const select = $('#reset-student');
            const current = select.value;
            select.innerHTML = '<option value="">Válassz diákot…</option>' +
                res.students.map(s => '<option value="' + s.id + '">' + escapeHtml(s.name) + ' (' + escapeHtml(s.class_name || '–') + ', ' + escapeHtml(s.username) + ')</option>').join('');
            if (res.students.some(s => String(s.id) === current)) select.value = current;
        } catch (e) { toast(e.message, 'error'); }
    }

    function generatePassword() {
        const words = ['alma', 'mappa', 'cica', 'fecske', 'hold', 'csillag', 'nap', 'maci', 'roka', 'bagoly', 'felho', 'pinty'];
        const arr = new Uint32Array(2);
        crypto.getRandomValues(arr);
        return words[arr[0] % words.length] + (10 + (arr[1] % 90));
    }

    // ======================================================================
    // MAPPAIKON-STÍLUSOK (SVG) – az explorer.js is használja: FK.folderIcon(stílus, méret)
    // ======================================================================
    let svgUid = 0;

    function folderIcon(style, size = 48) {
        const uid = 'fkf' + (++svgUid);
        const w = size;
        const h = Math.round(size * 52 / 64);
        const open = '<svg class="fk-folder-svg" viewBox="0 0 64 52" width="' + w + '" height="' + h + '" aria-hidden="true" focusable="false"';

        switch (style) {
            case 'folder_gold':
                return open + '>' +
                    '<defs>' +
                        '<linearGradient id="' + uid + 'g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fef9c3"/><stop offset=".45" stop-color="#facc15"/><stop offset="1" stop-color="#b45309"/></linearGradient>' +
                        '<linearGradient id="' + uid + 'b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ca8a04"/><stop offset="1" stop-color="#78350f"/></linearGradient>' +
                    '</defs>' +
                    '<path d="M4 8a4 4 0 0 1 4-4h16l6 6h26a4 4 0 0 1 4 4v4H4z" fill="url(#' + uid + 'b)"/>' +
                    '<path d="M2 18a4 4 0 0 1 4-4h52a4 4 0 0 1 4 4v26a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" fill="url(#' + uid + 'g)" stroke="#92400e" stroke-width="1.5"/>' +
                    '<rect x="2" y="27" width="60" height="5" fill="#92400e" opacity=".55"/>' +
                    '<path d="M32 23l6 6-6 9-6-9z" fill="#ef4444" stroke="#7f1d1d" stroke-width="1"/>' +
                    '<path d="M32 23l3 6h-6z" fill="#fecaca" opacity=".8"/>' +
                    '<path d="M50 18l1.5 3.5L55 23l-3.5 1.5L50 28l-1.5-3.5L45 23l3.5-1.5z" fill="#fff" class="fk-sparkle"/>' +
                    '<path d="M12 36l1 2.2 2.2 1-2.2 1L12 42.4l-1-2.2-2.2-1 2.2-1z" fill="#fff" class="fk-sparkle fk-sparkle-2"/>' +
                '</svg>';

            case 'folder_neon':
                return open + ' class="fk-folder-svg fk-folder-neon">' +
                    '<defs>' +
                        '<filter id="' + uid + 'f" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
                    '</defs>' +
                    '<g filter="url(#' + uid + 'f)">' +
                        '<path d="M5 9a4 4 0 0 1 4-4h15l6 6h25a4 4 0 0 1 4 4v3H5z" fill="#0b1229" stroke="#22d3ee" stroke-width="2"/>' +
                        '<path d="M3 18a4 4 0 0 1 4-4h50a4 4 0 0 1 4 4v25a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" fill="#0f172a" stroke="#22d3ee" stroke-width="2.5"/>' +
                        '<path d="M10 22h44" stroke="#e879f9" stroke-width="2" stroke-linecap="round"/>' +
                        '<path d="M10 39h18" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/>' +
                    '</g>' +
                '</svg>';

            case 'folder_pixel': {
                // 16×13-as rácson felépített, kockás mappa
                const px = (x, y, wd, ht, c) => '<rect x="' + (x * 4) + '" y="' + (y * 4) + '" width="' + (wd * 4) + '" height="' + (ht * 4) + '" fill="' + c + '"/>';
                return open + ' shape-rendering="crispEdges">' +
                    px(1, 1, 6, 1, '#7c2d12') +
                    px(1, 2, 14, 2, '#c2410c') +
                    px(7, 1, 1, 1, '#9a3412') +
                    px(0, 4, 16, 1, '#7c2d12') +
                    px(0, 5, 1, 7, '#7c2d12') +
                    px(15, 5, 1, 7, '#7c2d12') +
                    px(1, 12, 14, 1, '#7c2d12') +
                    px(1, 5, 14, 7, '#f97316') +
                    px(1, 5, 14, 1, '#fdba74') +
                    px(1, 6, 1, 5, '#fdba74') +
                    px(13, 10, 2, 2, '#c2410c') +
                    px(3, 7, 2, 2, '#fed7aa') +
                '</svg>';
            }

            default:
                return open + '>' +
                    '<defs><linearGradient id="' + uid + 'g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs>' +
                    '<path d="M4 8a4 4 0 0 1 4-4h16l6 6h26a4 4 0 0 1 4 4v4H4z" fill="#d97706"/>' +
                    '<path d="M2 18a4 4 0 0 1 4-4h52a4 4 0 0 1 4 4v26a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" fill="url(#' + uid + 'g)"/>' +
                    '<path d="M4 19h56" stroke="#fff" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/>' +
                '</svg>';
        }
    }
    FK.folderIcon = (style, size) => folderIcon(style || (FK.state.user && FK.state.user.equipped_folder) || 'default', size);

    // ======================================================================
    // ABLAKKEZELŐ (Windows 11 jellegű ablakok)
    // ======================================================================
    const WindowManager = {
        windows: new Map(),
        zTop: 100,
        activeId: null,
        cascade: 0,

        layer() {
            return $('#fk-window-layer');
        },

        isCompact() {
            return window.innerWidth < 768;
        },

        /**
         * Ablak megnyitása.
         * opts: { id, title, icon, width, height, className, render(body, win), onClose(win), onFocus(win), onBlur(win), onMinimize(win) }
         */
        open(opts) {
            if (this.windows.has(opts.id)) {
                this.focus(opts.id);
                return this.windows.get(opts.id);
            }
            const layer = this.layer();
            const bounds = layer.getBoundingClientRect();
            const width = Math.min(opts.width || 760, bounds.width - 24);
            const height = Math.min(opts.height || 540, bounds.height - 24);
            const offset = (this.cascade++ % 6) * 28;
            const left = Math.max(12, Math.round((bounds.width - width) / 2) + offset - 70);
            const top = Math.max(12, Math.round((bounds.height - height) / 2) + offset - 50);

            const el = document.createElement('section');
            el.className = 'fk-window ' + (opts.className || '');
            el.setAttribute('role', 'dialog');
            el.setAttribute('aria-label', opts.title);
            el.dataset.windowId = opts.id;
            el.style.left = left + 'px';
            el.style.top = top + 'px';
            el.style.width = width + 'px';
            el.style.height = height + 'px';
            el.innerHTML =
                '<header class="fk-window-titlebar">' +
                    '<span class="fk-window-icon" aria-hidden="true">' + (opts.icon || '🪟') + '</span>' +
                    '<span class="fk-window-title">' + escapeHtml(opts.title) + '</span>' +
                    '<div class="fk-window-controls">' +
                        '<button type="button" class="fk-wbtn" data-wact="min" aria-label="Kis méret" title="Kis méret">&#8212;</button>' +
                        '<button type="button" class="fk-wbtn" data-wact="max" aria-label="Teljes méret" title="Teljes méret">&#9744;</button>' +
                        '<button type="button" class="fk-wbtn fk-wbtn-close" data-wact="close" aria-label="Bezárás" title="Bezárás">&#10005;</button>' +
                    '</div>' +
                '</header>' +
                '<div class="fk-window-body"></div>' +
                '<div class="fk-window-resize" aria-hidden="true"></div>';
            layer.appendChild(el);

            const win = {
                id: opts.id,
                el,
                body: $('.fk-window-body', el),
                opts,
                minimized: false,
                maximized: false,
                restoreRect: null,
                data: {}
            };
            this.windows.set(opts.id, win);

            if (this.isCompact()) this.setMaximized(win, true);

            this.bindWindow(win);
            this.addTaskbarButton(win);
            this.focus(opts.id);
            if (typeof opts.render === 'function') opts.render(win.body, win);
            document.dispatchEvent(new CustomEvent('fk:window-open', { detail: { id: opts.id } }));
            return win;
        },

        bindWindow(win) {
            const el = win.el;
            el.addEventListener('pointerdown', () => this.focus(win.id), true);

            $('.fk-window-controls', el).addEventListener('click', ev => {
                const btn = ev.target.closest('[data-wact]');
                if (!btn) return;
                ev.stopPropagation();
                if (btn.dataset.wact === 'close') this.close(win.id);
                if (btn.dataset.wact === 'min') this.minimize(win.id);
                if (btn.dataset.wact === 'max') this.toggleMaximize(win.id);
            });

            // Húzás a címsornál fogva (egérrel és érintéssel is)
            const bar = $('.fk-window-titlebar', el);
            bar.addEventListener('dblclick', ev => {
                if (!ev.target.closest('.fk-window-controls')) this.toggleMaximize(win.id);
            });
            bar.addEventListener('pointerdown', ev => {
                if (ev.target.closest('.fk-window-controls') || win.maximized || ev.button > 0) return;
                ev.preventDefault();
                const layerRect = this.layer().getBoundingClientRect();
                const startX = ev.clientX;
                const startY = ev.clientY;
                const startLeft = el.offsetLeft;
                const startTop = el.offsetTop;
                bar.setPointerCapture(ev.pointerId);
                el.classList.add('is-dragging');
                const move = e => {
                    let nl = startLeft + (e.clientX - startX);
                    let nt = startTop + (e.clientY - startY);
                    nl = Math.min(Math.max(nl, -el.offsetWidth + 120), layerRect.width - 120);
                    nt = Math.min(Math.max(nt, 0), layerRect.height - 48);
                    el.style.left = nl + 'px';
                    el.style.top = nt + 'px';
                };
                const up = () => {
                    el.classList.remove('is-dragging');
                    bar.removeEventListener('pointermove', move);
                    bar.removeEventListener('pointerup', up);
                    bar.removeEventListener('pointercancel', up);
                };
                bar.addEventListener('pointermove', move);
                bar.addEventListener('pointerup', up);
                bar.addEventListener('pointercancel', up);
            });

            // Átméretezés a jobb alsó saroknál
            const grip = $('.fk-window-resize', el);
            grip.addEventListener('pointerdown', ev => {
                if (win.maximized) return;
                ev.preventDefault();
                ev.stopPropagation();
                const startX = ev.clientX;
                const startY = ev.clientY;
                const startW = el.offsetWidth;
                const startH = el.offsetHeight;
                grip.setPointerCapture(ev.pointerId);
                const move = e => {
                    el.style.width = Math.max(320, startW + (e.clientX - startX)) + 'px';
                    el.style.height = Math.max(240, startH + (e.clientY - startY)) + 'px';
                };
                const up = () => {
                    grip.removeEventListener('pointermove', move);
                    grip.removeEventListener('pointerup', up);
                    grip.removeEventListener('pointercancel', up);
                    document.dispatchEvent(new CustomEvent('fk:window-resize', { detail: { id: win.id } }));
                };
                grip.addEventListener('pointermove', move);
                grip.addEventListener('pointerup', up);
                grip.addEventListener('pointercancel', up);
            });
        },

        addTaskbarButton(win) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'fk-taskbar-btn fk-taskbar-winbtn is-open';
            btn.dataset.windowId = win.id;
            btn.title = win.opts.title;
            btn.setAttribute('aria-label', win.opts.title);
            btn.innerHTML = '<span aria-hidden="true">' + (win.opts.icon || '🪟') + '</span>';
            btn.addEventListener('click', () => {
                if (this.activeId === win.id && !win.minimized) {
                    this.minimize(win.id);
                } else {
                    this.focus(win.id);
                }
            });
            $('#fk-taskbar-windows').appendChild(btn);
            win.taskbarBtn = btn;
        },

        focus(id) {
            const win = this.windows.get(id);
            if (!win) return;
            if (win.minimized) {
                win.minimized = false;
                win.el.classList.remove('is-minimized');
            }
            if (this.activeId && this.activeId !== id) {
                const prev = this.windows.get(this.activeId);
                if (prev) {
                    prev.el.classList.remove('is-active');
                    if (prev.taskbarBtn) prev.taskbarBtn.classList.remove('is-active');
                    if (typeof prev.opts.onBlur === 'function') prev.opts.onBlur(prev);
                }
            }
            const changed = this.activeId !== id;
            this.activeId = id;
            win.el.style.zIndex = String(++this.zTop);
            win.el.classList.add('is-active');
            if (win.taskbarBtn) win.taskbarBtn.classList.add('is-active');
            if (changed && typeof win.opts.onFocus === 'function') win.opts.onFocus(win);
            hideWelcome();
        },

        minimize(id) {
            const win = this.windows.get(id);
            if (!win) return;
            win.minimized = true;
            win.el.classList.add('is-minimized');
            win.el.classList.remove('is-active');
            if (win.taskbarBtn) win.taskbarBtn.classList.remove('is-active');
            if (this.activeId === id) this.activeId = null;
            if (typeof win.opts.onMinimize === 'function') win.opts.onMinimize(win);
            this.focusTopmost();
        },

        setMaximized(win, on) {
            if (on && !win.maximized) {
                win.restoreRect = { left: win.el.style.left, top: win.el.style.top, width: win.el.style.width, height: win.el.style.height };
            }
            win.maximized = on;
            win.el.classList.toggle('is-maximized', on);
            if (!on && win.restoreRect) {
                Object.assign(win.el.style, win.restoreRect);
            }
        },

        toggleMaximize(id) {
            const win = this.windows.get(id);
            if (!win) return;
            if (this.isCompact() && win.maximized) return; // kis képernyőn mindig teljes méret
            this.setMaximized(win, !win.maximized);
            document.dispatchEvent(new CustomEvent('fk:window-resize', { detail: { id } }));
        },

        close(id) {
            const win = this.windows.get(id);
            if (!win) return;
            if (typeof win.opts.onClose === 'function') {
                try { win.opts.onClose(win); } catch (e) { console.error(e); }
            }
            win.el.classList.add('is-closing');
            if (win.taskbarBtn) win.taskbarBtn.remove();
            this.windows.delete(id);
            if (this.activeId === id) this.activeId = null;
            setTimeout(() => win.el.remove(), 160);
            this.focusTopmost();
            document.dispatchEvent(new CustomEvent('fk:window-close', { detail: { id } }));
        },

        closeAll() {
            Array.from(this.windows.keys()).forEach(id => this.close(id));
        },

        focusTopmost() {
            let best = null;
            this.windows.forEach(w => {
                if (!w.minimized && (!best || Number(w.el.style.zIndex) > Number(best.el.style.zIndex))) best = w;
            });
            if (best) this.focus(best.id);
        },

        get(id) {
            return this.windows.get(id) || null;
        },

        setTitle(id, title) {
            const win = this.windows.get(id);
            if (!win) return;
            win.opts.title = title;
            $('.fk-window-title', win.el).textContent = title;
            if (win.taskbarBtn) win.taskbarBtn.title = title;
        }
    };
    FK.WindowManager = WindowManager;
    FK.openWindow = opts => WindowManager.open(opts);
    FK.closeWindow = id => WindowManager.close(id);

    // ======================================================================
    // BITI, A KIBER-ROBOT (segítő karakter)
    // ======================================================================
    const Biti = {
        el: null,
        bubble: null,
        textEl: null,
        hideTimer: null,
        idleTimer: null,
        idleTarget: null,
        idleGetHint: null,
        idleDelay: 20000,
        idleHandler: null,
        collapsed: false,

        tips: [
            'Tudtad? A mappák olyanok, mint a fiókok: rendben tartják a fájljaidat!',
            'A fájl neve után, a pont mögött van a kiterjesztés. Például: rajz.png',
            'A Ctrl + C másol, a Ctrl + V beilleszt. Próbáld ki!',
            'A Lomtárból vissza lehet hozni a véletlenül törölt fájlokat.',
            'Egy jó fájlnév rövid, és elárulja, mi van benne.',
            'A .txt szöveg, a .jpg és .png kép, az .mp3 zene. Ügyes vagy, ha ezt megjegyzed!',
            'Ha elakadsz, kattints rám, és adok egy tippet!',
            'Gyűjts Bájt-érméket, és vegyél új hátteret a Bájt-Boltban!'
        ],

        praises: [
            'Szuper vagy! 🌟',
            'Hibátlan! Így tovább! 🚀',
            'Wow, ez nagyon ügyes volt! 🤩',
            'Igazi fájl-mester vagy! 🏆',
            'Bip-bup! A processzorom is tapsol! 👏',
            'Csodás munka! 💪'
        ],

        encouragements: [
            'Hoppá! Semmi baj, próbáld újra! 🙂',
            'Majdnem! Nézd meg még egyszer figyelmesen!',
            'Hibázni szabad, abból tanulunk! 💡',
            'Nyugi, menni fog! Gondold át még egyszer!'
        ],

        init() {
            if (this.el) return;
            const root = $('#fk-biti-root');
            root.innerHTML =
                '<div id="fk-biti" class="fk-biti is-hidden" data-mood="happy">' +
                    '<div class="fk-biti-bubble" role="status" aria-live="polite">' +
                        '<button type="button" class="fk-biti-close" aria-label="Buborék bezárása">✕</button>' +
                        '<p class="fk-biti-text"></p>' +
                    '</div>' +
                    '<button type="button" class="fk-biti-bot" aria-label="Biti, a kiber-robot – kattints egy tippért!">' + this.svg() + '</button>' +
                    '<button type="button" class="fk-biti-toggle" aria-label="Biti elrejtése" title="Biti elrejtése">–</button>' +
                '</div>';
            this.el = $('#fk-biti');
            this.bubble = $('.fk-biti-bubble', this.el);
            this.textEl = $('.fk-biti-text', this.el);
            $('.fk-biti-close', this.el).addEventListener('click', () => this.hideBubble());
            $('.fk-biti-bot', this.el).addEventListener('click', () => {
                if (this.collapsed) {
                    this.setCollapsed(false);
                    return;
                }
                const hint = this.idleGetHint ? this.idleGetHint() : null;
                this.say(hint || randomItem(this.tips), { mood: hint ? 'think' : 'happy' });
            });
            $('.fk-biti-toggle', this.el).addEventListener('click', () => this.setCollapsed(!this.collapsed));
        },

        svg() {
            return '<svg class="fk-biti-svg" viewBox="0 0 120 140" width="96" height="112" aria-hidden="true" focusable="false">' +
                '<defs>' +
                    '<linearGradient id="bitiBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e0f2fe"/><stop offset="1" stop-color="#7dd3fc"/></linearGradient>' +
                    '<linearGradient id="bitiHead" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#bae6fd"/></linearGradient>' +
                '</defs>' +
                // antenna
                '<line x1="60" y1="8" x2="60" y2="26" stroke="#475569" stroke-width="4" stroke-linecap="round"/>' +
                '<circle class="fk-biti-light" cx="60" cy="8" r="7" fill="#f43f5e"/>' +
                // fülek
                '<rect x="10" y="44" width="10" height="24" rx="5" fill="#38bdf8"/>' +
                '<rect x="100" y="44" width="10" height="24" rx="5" fill="#38bdf8"/>' +
                // fej
                '<rect x="18" y="24" width="84" height="64" rx="22" fill="url(#bitiHead)" stroke="#0284c7" stroke-width="3"/>' +
                // arc képernyő
                '<rect x="28" y="34" width="64" height="44" rx="14" fill="#0f172a"/>' +
                // szemek
                '<g class="fk-biti-eyes">' +
                    '<ellipse cx="46" cy="53" rx="7" ry="8" fill="#67e8f9"/>' +
                    '<ellipse cx="74" cy="53" rx="7" ry="8" fill="#67e8f9"/>' +
                    '<circle cx="48" cy="50" r="2.4" fill="#fff"/>' +
                    '<circle cx="76" cy="50" r="2.4" fill="#fff"/>' +
                '</g>' +
                // száj (hangulatfüggő)
                '<path class="fk-biti-mouth fk-biti-mouth-happy" d="M48 66 Q60 76 72 66" stroke="#67e8f9" stroke-width="4" fill="none" stroke-linecap="round"/>' +
                '<ellipse class="fk-biti-mouth fk-biti-mouth-think" cx="60" cy="69" rx="5" ry="4" fill="#67e8f9"/>' +
                '<path class="fk-biti-mouth fk-biti-mouth-excited" d="M46 64 Q60 82 74 64 Z" fill="#67e8f9"/>' +
                // pirospozsgás arc
                '<circle cx="34" cy="68" r="4" fill="#f472b6" opacity=".55"/>' +
                '<circle cx="86" cy="68" r="4" fill="#f472b6" opacity=".55"/>' +
                // nyak és test
                '<rect x="50" y="88" width="20" height="8" rx="3" fill="#64748b"/>' +
                '<rect x="26" y="94" width="68" height="40" rx="16" fill="url(#bitiBody)" stroke="#0284c7" stroke-width="3"/>' +
                '<rect x="44" y="104" width="32" height="20" rx="6" fill="#0f172a"/>' +
                '<text x="60" y="119" text-anchor="middle" font-family="Baloo 2, Nunito, sans-serif" font-weight="800" font-size="14" fill="#facc15">B</text>' +
                // karok
                '<rect class="fk-biti-arm-l" x="12" y="98" width="14" height="26" rx="7" fill="#38bdf8"/>' +
                '<rect class="fk-biti-arm-r" x="94" y="98" width="14" height="26" rx="7" fill="#38bdf8"/>' +
            '</svg>';
        },

        show() {
            this.init();
            this.el.classList.remove('is-hidden');
        },

        hide() {
            if (!this.el) return;
            this.hideBubble();
            this.el.classList.add('is-hidden');
            this.stopIdleWatch();
        },

        setCollapsed(on) {
            this.collapsed = on;
            this.el.classList.toggle('is-collapsed', on);
            const toggle = $('.fk-biti-toggle', this.el);
            toggle.textContent = on ? '+' : '–';
            toggle.setAttribute('aria-label', on ? 'Biti megjelenítése' : 'Biti elrejtése');
            toggle.title = on ? 'Biti megjelenítése' : 'Biti elrejtése';
            if (on) this.hideBubble();
        },

        setMood(mood) {
            if (this.el) this.el.dataset.mood = mood;
        },

        /** Biti mond valamit. options: { mood: 'happy'|'think'|'excited'|'sad', duration: ms } */
        say(text, options = {}) {
            this.show();
            if (this.collapsed) this.setCollapsed(false);
            const mood = options.mood || 'happy';
            const duration = options.duration || Math.min(12000, 4000 + String(text).length * 55);
            this.setMood(mood);
            this.textEl.textContent = text;
            this.bubble.classList.remove('is-visible');
            void this.bubble.offsetWidth;
            this.bubble.classList.add('is-visible');
            this.el.classList.remove('is-talking');
            void this.el.offsetWidth;
            this.el.classList.add('is-talking');
            clearTimeout(this.hideTimer);
            this.hideTimer = setTimeout(() => this.hideBubble(), duration);
        },

        hideBubble() {
            if (!this.bubble) return;
            this.bubble.classList.remove('is-visible');
            this.el.classList.remove('is-talking');
            this.setMood('happy');
        },

        praise(extra) {
            this.say(randomItem(this.praises) + (extra ? ' ' + extra : ''), { mood: 'excited' });
        },

        encourage() {
            this.say(randomItem(this.encouragements), { mood: 'think' });
        },

        help(text) {
            this.say(text || 'Elakadtál? Gondold végig lépésről lépésre, és figyeld meg az ikonokat!', { mood: 'think', duration: 11000 });
        },

        tip() {
            this.say(randomItem(this.tips), { mood: 'happy' });
        },

        /** Tétlenség figyelése: ha 20 mp-ig nem történik semmi a megadott elemen, Biti tippet ad. */
        startIdleWatch(target, getHint) {
            this.stopIdleWatch();
            this.idleTarget = target;
            this.idleGetHint = getHint || null;
            this.idleHandler = () => this.resetIdle();
            ['pointerdown', 'keydown', 'wheel', 'input', 'dragstart'].forEach(evt =>
                target.addEventListener(evt, this.idleHandler, { passive: true }));
            this.resetIdle();
        },

        resetIdle() {
            clearTimeout(this.idleTimer);
            if (!this.idleTarget) return;
            this.idleTimer = setTimeout(() => {
                const hint = this.idleGetHint ? this.idleGetHint() : null;
                this.help(hint ? '💡 Tipp: ' + hint : 'Elakadtál? ' + randomItem(this.tips));
                this.resetIdle();
            }, this.idleDelay);
        },

        pauseIdle() {
            clearTimeout(this.idleTimer);
        },

        stopIdleWatch() {
            clearTimeout(this.idleTimer);
            if (this.idleTarget && this.idleHandler) {
                ['pointerdown', 'keydown', 'wheel', 'input', 'dragstart'].forEach(evt =>
                    this.idleTarget.removeEventListener(evt, this.idleHandler));
            }
            this.idleTarget = null;
            this.idleGetHint = null;
            this.idleHandler = null;
        }
    };
    FK.Biti = Biti;
    window.Biti = Biti;

    // ======================================================================
    // LÁTVÁNYOS ANIMÁCIÓK (szintlépés, kitűzők)
    // ======================================================================
    const Celebration = {
        queue: [],
        showing: false,

        /** opts: { title, subtitle, emoji, level, bonus: {xp, coins} } */
        show(opts) {
            this.queue.push(opts);
            if (!this.showing) this.next();
        },

        next() {
            const opts = this.queue.shift();
            if (!opts) {
                this.showing = false;
                return;
            }
            this.showing = true;
            const root = $('#fk-celebration-root');
            const colors = ['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#facc15', '#14b8a6'];
            let confetti = '';
            for (let i = 0; i < 70; i++) {
                const left = Math.random() * 100;
                const delay = Math.random() * 0.8;
                const dur = 2.2 + Math.random() * 1.8;
                const size = 6 + Math.random() * 8;
                const rot = Math.floor(Math.random() * 360);
                confetti += '<i style="left:' + left.toFixed(1) + '%;width:' + size.toFixed(0) + 'px;height:' + (size * 1.6).toFixed(0) + 'px;background:' +
                    colors[i % colors.length] + ';animation-delay:' + delay.toFixed(2) + 's;animation-duration:' + dur.toFixed(2) + 's;transform:rotate(' + rot + 'deg)"></i>';
            }
            const bonus = opts.bonus && (opts.bonus.xp || opts.bonus.coins)
                ? '<div class="fk-celebrate-bonus">' +
                      (opts.bonus.xp ? '<span>⭐ +' + opts.bonus.xp + ' XP</span>' : '') +
                      (opts.bonus.coins ? '<span><span class="fk-coin">B</span> +' + opts.bonus.coins + '</span>' : '') +
                  '</div>'
                : '';
            const overlay = document.createElement('div');
            overlay.className = 'fk-celebrate';
            overlay.setAttribute('role', 'alert');
            overlay.innerHTML =
                '<div class="fk-confetti" aria-hidden="true">' + confetti + '</div>' +
                '<div class="fk-celebrate-card">' +
                    '<div class="fk-celebrate-rays" aria-hidden="true"></div>' +
                    '<div class="fk-celebrate-emoji" aria-hidden="true">' + (opts.emoji || '🚀') + '</div>' +
                    '<h2 class="fk-celebrate-title">' + escapeHtml(opts.title || 'Szintlépés!') + '</h2>' +
                    (opts.subtitle ? '<p class="fk-celebrate-sub">' + escapeHtml(opts.subtitle) + '</p>' : '') +
                    (opts.level ? '<div class="fk-celebrate-stars">' + stars(opts.level) + '</div>' : '') +
                    bonus +
                    '<p class="fk-celebrate-hint">Koppints a folytatáshoz!</p>' +
                '</div>';
            root.appendChild(overlay);
            const close = () => {
                if (overlay.classList.contains('is-leaving')) return;
                overlay.classList.add('is-leaving');
                setTimeout(() => {
                    overlay.remove();
                    this.next();
                }, 350);
            };
            overlay.addEventListener('click', close);
            setTimeout(close, opts.duration || 4200);
        }
    };
    FK.Celebration = Celebration;

    function announceAchievements(list) {
        (list || []).forEach((a, i) => {
            setTimeout(() => {
                toast('Új kitűző: ' + a.icon + ' ' + a.name + '!', 'achievement');
                Celebration.show({ title: 'Új kitűző!', subtitle: a.name + ' – ' + a.desc, emoji: a.icon, duration: 3600 });
            }, i * 400);
        });
        if (list && list.length) {
            setTimeout(() => Biti.say('Gratulálok! Megszerezted ezt a kitűzőt: ' + list[0].name + '! Nézd meg a Profilodban!', { mood: 'excited' }), 600);
        }
    }
    FK.announceAchievements = announceAchievements;

    // ======================================================================
    // ADAPTÍV NEHÉZSÉGI MOTOR
    // ======================================================================
    const AdaptiveEngine = {
        gameId: null,
        level: 1,
        streak: 0,
        taskErrors: 0,
        loweredThisTask: false,
        taskActive: false,
        saving: false,
        listeners: {},

        STREAK_TO_LEVEL_UP: 3,
        ERRORS_TO_LEVEL_DOWN: 2,
        MIN_LEVEL: 1,
        MAX_LEVEL: 5,

        /** Játék indításakor: a mentett szint és sorozat betöltése. */
        start(gameId) {
            const p = progressFor(gameId);
            this.gameId = Number(gameId);
            this.level = Math.min(this.MAX_LEVEL, Math.max(this.MIN_LEVEL, Number(p.difficulty_level) || 1));
            this.streak = Number(p.streak) || 0;
            this.taskErrors = 0;
            this.loweredThisTask = false;
            this.taskActive = false;
            this.saving = false;
            return this.level;
        },

        stop() {
            this.gameId = null;
            this.taskActive = false;
            this.listeners = {};
        },

        getLevel() {
            return this.level;
        },

        on(event, cb) {
            (this.listeners[event] = this.listeners[event] || []).push(cb);
        },

        emit(event, data) {
            (this.listeners[event] || []).forEach(cb => {
                try { cb(data); } catch (e) { console.error(e); }
            });
            document.dispatchEvent(new CustomEvent('fk:engine-' + event, { detail: data }));
        },

        /** Új feladat kezdete. */
        beginTask() {
            this.taskErrors = 0;
            this.loweredThisTask = false;
            this.taskActive = true;
            Biti.resetIdle();
            return this.level;
        },

        /**
         * Hibás lépés. A 2. hibánál a nehézség eggyel csökken (min. 1), és Biti segít.
         * Visszatér: { level, errors, lowered }
         */
        recordError(hint) {
            if (!this.taskActive) this.beginTask();
            this.taskErrors++;
            this.streak = 0;
            let lowered = false;

            if (this.taskErrors === this.ERRORS_TO_LEVEL_DOWN) {
                if (this.level > this.MIN_LEVEL && !this.loweredThisTask) {
                    this.level--;
                    this.loweredThisTask = true;
                    lowered = true;
                    Biti.help('Semmi gond, egy kicsit könnyítek a feladatokon (' + this.level + '. szint). ' + (hint ? '💡 Tipp: ' + hint : 'Figyeld meg jól a részleteket!'));
                    this.emit('level-change', { level: this.level, direction: 'down' });
                } else {
                    Biti.help(hint ? '💡 Tipp: ' + hint : 'Segítek! Olvasd el újra a feladatot lassan, és nézd meg az ikonokat!');
                }
            } else if (this.taskErrors > this.ERRORS_TO_LEVEL_DOWN && hint) {
                Biti.help('💡 ' + hint);
            } else {
                Biti.encourage();
            }

            this.emit('error', { errors: this.taskErrors, level: this.level, lowered });
            return { level: this.level, errors: this.taskErrors, lowered };
        },

        /** Az alapjutalom a nehézségi szinttől és a hibák számától függ. */
        defaultReward(success, errors) {
            if (!success) return { xp: 0, coins: 0 };
            const xp = Math.max(5, 10 + this.level * 5 - errors * 3);
            const coins = Math.max(1, 2 + this.level * 2 - errors);
            return { xp, coins };
        },

        /**
         * Feladat vége: szinkronizálás a save_progress végponttal.
         * opts: { success = true, xp, coins, silent }
         */
        async completeTask(opts = {}) {
            if (this.gameId === null) return { saved: false };
            if (this.saving) return { saved: false, busy: true };
            const success = opts.success !== false;
            const errors = this.taskErrors;
            const reward = this.defaultReward(success, errors);
            const xp = Number.isFinite(opts.xp) ? opts.xp : reward.xp;
            const coins = Number.isFinite(opts.coins) ? opts.coins : reward.coins;
            const levelBefore = this.level;

            this.saving = true;
            this.taskActive = false;
            Biti.pauseIdle();

            let res;
            try {
                res = await api('save_progress', { game_id: this.gameId, success, errors, xp, coins });
            } catch (e) {
                this.saving = false;
                toast(e.message, 'error');
                Biti.say('Hoppá, nem sikerült elmenteni az eredményt. Próbáljuk újra a következő feladatnál!', { mood: 'sad' });
                Biti.resetIdle();
                return { saved: false, error: e.message };
            }
            this.saving = false;

            // A szerver a hiteles forrás
            const p = (res.progress || []).find(x => Number(x.game_id) === this.gameId);
            this.level = Number(res.difficulty_level) || this.level;
            this.streak = p ? Number(p.streak) : 0;
            FK.setUser(res.user, res.progress);

            if (res.earned && (res.earned.xp || res.earned.coins)) {
                toast('+' + res.earned.xp + ' XP és +' + res.earned.coins + ' Bájt-érme!', 'coin');
            }

            if (res.difficulty_up) {
                Celebration.show({
                    title: 'Szintlépés!',
                    subtitle: GAME_DEFS[this.gameId].name + ': ' + this.level + '. nehézségi szint',
                    emoji: '🚀',
                    level: this.level,
                    bonus: res.bonus
                });
                Biti.say('Hű, 3 hibátlan feladat zsinórban! Jöhet a ' + this.level + '. szint! 🚀', { mood: 'excited' });
                this.emit('level-change', { level: this.level, direction: 'up' });
            } else if (success && errors === 0) {
                const left = this.STREAK_TO_LEVEL_UP - this.streak;
                Biti.praise(this.level < this.MAX_LEVEL && left > 0 && left < this.STREAK_TO_LEVEL_UP
                    ? 'Még ' + left + ' hibátlan, és szintet lépsz!'
                    : '');
            } else if (success) {
                Biti.say('Megcsináltad! Legközelebb próbáld hiba nélkül! 💪', { mood: 'happy' });
            }

            if (this.level !== levelBefore && !res.difficulty_up) {
                this.emit('level-change', { level: this.level, direction: this.level < levelBefore ? 'down' : 'up' });
            }

            if (res.player_level_up) {
                Celebration.show({
                    title: 'Új játékosszint!',
                    subtitle: 'Elérted a(z) ' + res.player_level + '. szintet!',
                    emoji: '🏆'
                });
            }

            announceAchievements(res.new_achievements);
            this.emit('task-complete', res);
            this.taskErrors = 0;
            this.loweredThisTask = false;
            Biti.resetIdle();
            return Object.assign({ saved: true }, res);
        }
    };
    FK.AdaptiveEngine = AdaptiveEngine;
    window.AdaptiveEngine = AdaptiveEngine;

    // ======================================================================
    // ALKALMAZÁSOK ÉS JÁTÉKOK REGISZTRÁLÁSA
    // ======================================================================
    FK.registerApp = function (app) {
        if (!app || !app.id) return;
        FK.apps[app.id] = app;
        if (FK.state.user && FK.state.user.role === 'student') {
            renderDesktop();
            renderStartMenu();
        }
    };

    FK.registerGame = function (game) {
        if (!game || !GAME_DEFS[game.id]) {
            console.warn('Fájl-Kaland: érvénytelen játék-regisztráció', game);
            return;
        }
        const def = GAME_DEFS[game.id];
        ['name', 'icon', 'description', 'color'].forEach(k => { if (game[k]) def[k] = game[k]; });
        FK.gameNames[game.id] = def.name;
        FK.games[game.id] = game;
        if (FK.state.user && FK.state.user.role === 'student') {
            renderDesktop();
            renderStartMenu();
        }
    };

    function appList() {
        const list = [];
        Object.keys(GAME_DEFS).forEach(id => {
            const g = GAME_DEFS[id];
            list.push({ id: 'game-' + id, name: g.name, icon: g.icon, kind: 'game', gameId: Number(id), color: g.color });
        });
        list.push({ id: 'shop', name: 'Bájt-Bolt', icon: '🛒', kind: 'app' });
        list.push({ id: 'profile', name: 'Profilom és Kitűzők', icon: '🏆', kind: 'app' });
        Object.keys(FK.apps).forEach(id => {
            const a = FK.apps[id];
            if (a && a.desktop !== false && !['shop', 'profile'].includes(id)) {
                list.push({ id, name: a.name || id, icon: a.icon || '🪟', kind: 'module' });
            }
        });
        return list;
    }

    function openApp(id) {
        closeStartMenu();
        if (id.startsWith('game-')) return openGame(Number(id.slice(5)));
        if (id === 'shop') return openShop();
        if (id === 'profile') return openProfile();
        const app = FK.apps[id];
        if (app && typeof app.open === 'function') {
            hideWelcome();
            return app.open();
        }
        toast('Ez a program hamarosan elérhető lesz! 🚧', 'info');
    }
    FK.openApp = openApp;

    // ======================================================================
    // 2. DIÁK ASZTAL
    // ======================================================================
    let studentInitialized = false;
    let clockTimer = null;

    function initStudent(newAchievements) {
        showScreen('screen-student');
        if (!studentInitialized) {
            bindStudentEvents();
            studentInitialized = true;
        }
        Biti.init();
        updateStudentUI();
        renderDesktop();
        renderStartMenu();
        renderPinned();
        startClock();
        $('#fk-welcome').classList.remove('hidden');

        const u = FK.state.user;
        Biti.show();
        setTimeout(() => {
            Biti.say('Szia, ' + firstName(u.name) + '! Én Biti vagyok, a kiber-robot. 🤖 Válassz egy kalandot az asztalon, és segítek, ha elakadsz!', { mood: 'excited', duration: 9000 });
        }, 500);
        announceAchievements(newAchievements);

        document.dispatchEvent(new CustomEvent('fk:student-ready', { detail: { user: FK.state.user, progress: FK.state.progress } }));
    }

    function resetStudentSession() {
        WindowManager.closeAll();
        AdaptiveEngine.stop();
        Biti.hide();
        closeStartMenu();
        clearInterval(clockTimer);
    }

    function hideWelcome() {
        const w = $('#fk-welcome');
        if (w) w.classList.add('hidden');
    }

    /** Tálca, start menü, háttér és mappa-stílus frissítése. */
    function updateStudentUI() {
        const u = FK.state.user;
        if (!u || u.role !== 'student') return;
        const info = levelInfo(u.xp);
        $('#fk-taskbar-name').textContent = u.name;
        $('#fk-taskbar-class').textContent = u.class_name ? u.class_name + ' osztály' : '';
        $('#fk-taskbar-avatar').textContent = initials(u.name);
        $('#fk-start-name').textContent = u.name;
        $('#fk-start-class').textContent = (u.class_name ? u.class_name + ' · ' : '') + info.level + '. szint';
        $('#fk-start-avatar').textContent = initials(u.name);
        $('#fk-welcome-name').textContent = firstName(u.name);
        $('#fk-level').textContent = info.level;
        $('#fk-xp').textContent = formatNumber(u.xp) + ' XP';
        $('#fk-xpbar-fill').style.width = Math.round(info.ratio * 100) + '%';
        $('#fk-coins').textContent = formatNumber(u.coins);

        applyBackground(u.equipped_bg);
        applyFolderStyle(u.equipped_folder);
    }
    FK.updateStudentUI = updateStudentUI;

    function applyBackground(bg) {
        const desktop = $('#fk-desktop');
        desktop.className = desktop.className.replace(/\bfk-bg-\S+/g, '').replace(/\s+/g, ' ').trim() + ' fk-bg-' + (bg || 'default');
    }

    let currentFolderStyle = null;
    function applyFolderStyle(style) {
        const s = style || 'default';
        document.body.className = document.body.className.replace(/\bfk-folder-\S+/g, '').replace(/\s+/g, ' ').trim() + ' fk-folder-' + s;
        if (currentFolderStyle !== s) {
            currentFolderStyle = s;
            renderDesktop();
            document.dispatchEvent(new CustomEvent('fk:folder-style', { detail: { style: s } }));
        }
    }

    /** Felhasználói adatok frissítése API-válasz alapján. */
    FK.setUser = function (user, progress) {
        const prev = FK.state.user;
        FK.state.user = user;
        if (progress) FK.state.progress = progress;
        updateStudentUI();
        if (prev) {
            if (user.coins > prev.coins) bumpPill('#fk-coins');
            if (user.xp > prev.xp) bumpPill('#fk-xp');
        }
        refreshOpenPanels();
        document.dispatchEvent(new CustomEvent('fk:user-updated', { detail: { user, progress: FK.state.progress } }));
    };

    function bumpPill(sel) {
        const pill = $(sel).closest('.fk-pill');
        pill.classList.remove('is-bump');
        void pill.offsetWidth;
        pill.classList.add('is-bump');
    }

    function renderDesktop() {
        const box = $('#fk-desktop-icons');
        if (!box || !FK.state.user) return;
        const style = FK.state.user.equipped_folder || 'default';
        box.innerHTML = appList().map(app => {
            let img;
            if (app.kind === 'game') {
                const p = progressFor(app.gameId);
                img = '<span class="fk-desktop-icon-img fk-desktop-folder">' + folderIcon(style, 58) +
                      '<span class="fk-desktop-badge" aria-hidden="true">' + app.icon + '</span>' +
                      (p.started ? '<span class="fk-desktop-lvl" title="' + p.difficulty_level + '. szint">' + p.difficulty_level + '</span>' : '') +
                      '</span>';
            } else {
                img = '<span class="fk-desktop-icon-img" aria-hidden="true">' + app.icon + '</span>';
            }
            return '<button type="button" class="fk-desktop-icon" data-app="' + escapeHtml(app.id) + '" title="' + escapeHtml(app.name) + '">' +
                img + '<span class="fk-desktop-icon-label">' + escapeHtml(app.name) + '</span></button>';
        }).join('');
    }

    function renderStartMenu() {
        const box = $('#fk-start-apps');
        if (!box) return;
        box.innerHTML = appList().map(app =>
            '<button type="button" class="fk-start-app" data-app="' + escapeHtml(app.id) + '"><span aria-hidden="true">' + app.icon + '</span>' + escapeHtml(app.name) + '</button>'
        ).join('');
    }

    function renderPinned() {
        const box = $('#fk-taskbar-pinned');
        if (!box) return;
        const pinned = [
            { id: 'game-1', icon: GAME_DEFS[1].icon, name: GAME_DEFS[1].name },
            { id: 'shop', icon: '🛒', name: 'Bájt-Bolt' },
            { id: 'profile', icon: '🏆', name: 'Profilom és Kitűzők' }
        ];
        box.innerHTML = pinned.map(p =>
            '<button type="button" class="fk-taskbar-btn fk-taskbar-pin" data-app="' + p.id + '" title="' + escapeHtml(p.name) + '" aria-label="' + escapeHtml(p.name) + '">' + p.icon + '</button>'
        ).join('');
    }

    function toggleStartMenu(force) {
        const menu = $('#fk-start-menu');
        const open = typeof force === 'boolean' ? force : menu.classList.contains('hidden');
        menu.classList.toggle('hidden', !open);
        $('#fk-start-button').setAttribute('aria-expanded', String(open));
    }

    function closeStartMenu() {
        const menu = $('#fk-start-menu');
        if (menu) toggleStartMenu(false);
    }

    function bindStudentEvents() {
        const icons = $('#fk-desktop-icons');

        // Egérrel: egy kattintás kijelöl, dupla kattintás megnyit. Érintéssel: egy koppintás megnyit.
        let lastPointerType = 'mouse';
        icons.addEventListener('pointerdown', ev => { lastPointerType = ev.pointerType || 'mouse'; });
        icons.addEventListener('click', ev => {
            const icon = ev.target.closest('.fk-desktop-icon');
            if (!icon) return;
            $$('.fk-desktop-icon', icons).forEach(i => i.classList.toggle('is-selected', i === icon));
            // ev.detail === 0: billentyűzettel (Enter/Szóköz) aktiválva
            if (ev.detail === 0 || lastPointerType === 'touch' || lastPointerType === 'pen') {
                openApp(icon.dataset.app);
            }
        });
        icons.addEventListener('dblclick', ev => {
            const icon = ev.target.closest('.fk-desktop-icon');
            if (icon && lastPointerType === 'mouse') openApp(icon.dataset.app);
        });

        // Üres asztalra kattintás: kijelölés törlése, start menü bezárása
        $('#fk-desktop').addEventListener('pointerdown', ev => {
            if (!ev.target.closest('.fk-desktop-icon')) $$('.fk-desktop-icon').forEach(i => i.classList.remove('is-selected'));
        });
        document.addEventListener('pointerdown', ev => {
            if (!ev.target.closest('#fk-start-menu') && !ev.target.closest('#fk-start-button')) closeStartMenu();
        });

        $('#fk-start-button').addEventListener('click', ev => { ev.stopPropagation(); toggleStartMenu(); });
        $('#fk-start-apps').addEventListener('click', ev => {
            const btn = ev.target.closest('[data-app]');
            if (btn) openApp(btn.dataset.app);
        });
        $('#fk-taskbar-pinned').addEventListener('click', ev => {
            const btn = ev.target.closest('[data-app]');
            if (btn) openApp(btn.dataset.app);
        });
        $('#fk-taskbar-user').addEventListener('click', () => openApp('profile'));
        $('#fk-coins-pill').addEventListener('click', () => openApp('shop'));

        $$('#screen-student [data-action="logout"]').forEach(btn => btn.addEventListener('click', async () => {
            if (typeof FK.beforeLogout === 'function') {
                const ok = await FK.beforeLogout();
                if (ok === false) return;
            }
            if (await confirmDialog('Biztosan ki szeretnél jelentkezni? Az eredményeid el vannak mentve.', 'Kijelentkezem', 'danger', 'Kijelentkezés')) {
                logout();
            }
        }));

        document.addEventListener('keydown', ev => {
            if (document.body.dataset.screen !== 'screen-student') return;
            if (ev.key === 'Escape') closeStartMenu();
            if (ev.key === 'Meta') toggleStartMenu();
        });

        window.addEventListener('resize', () => {
            if (!WindowManager.isCompact()) return;
            WindowManager.windows.forEach(w => WindowManager.setMaximized(w, true));
        });
    }

    function startClock() {
        const tick = () => {
            const now = new Date();
            $('#fk-clock-time').textContent = now.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
            $('#fk-clock-date').textContent = now.toLocaleDateString('hu-HU');
        };
        tick();
        clearInterval(clockTimer);
        clockTimer = setInterval(tick, 15000);
    }

    /** Nyitott bolt/profil/játék-bevezető ablakok frissítése adatváltozáskor. */
    function refreshOpenPanels() {
        const shop = WindowManager.get('shop');
        if (shop && shop.data.render) shop.data.render();
        const profile = WindowManager.get('profile');
        if (profile && profile.data.render) profile.data.render();
        WindowManager.windows.forEach(w => {
            if (w.id.startsWith('game-') && w.data.renderIntro && !w.data.running) w.data.renderIntro();
        });
        renderDesktopBadges();
    }

    function renderDesktopBadges() {
        $$('#fk-desktop-icons .fk-desktop-icon[data-app^="game-"]').forEach(btn => {
            const p = progressFor(Number(btn.dataset.app.slice(5)));
            const holder = $('.fk-desktop-folder', btn);
            let lvl = $('.fk-desktop-lvl', btn);
            if (!p.started) {
                if (lvl) lvl.remove();
                return;
            }
            if (!lvl) {
                lvl = document.createElement('span');
                lvl.className = 'fk-desktop-lvl';
                holder.appendChild(lvl);
            }
            lvl.textContent = p.difficulty_level;
            lvl.title = p.difficulty_level + '. szint';
        });
    }

    // ======================================================================
    // JÁTÉKABLAK ÉS JÁTÉK-KÖRNYEZET (ctx)
    // ======================================================================
    function openGame(gameId) {
        const def = GAME_DEFS[gameId];
        if (!def) return;
        const winId = 'game-' + gameId;
        if (WindowManager.get(winId)) {
            WindowManager.focus(winId);
            return;
        }
        // Egyszerre egy játék fut – a másikat bezárjuk, hogy a motor ne keveredjen össze
        WindowManager.windows.forEach(w => {
            if (w.id.startsWith('game-') && w.id !== winId) WindowManager.close(w.id);
        });

        WindowManager.open({
            id: winId,
            title: def.name,
            icon: def.icon,
            width: 980,
            height: 640,
            className: 'fk-game-window',
            render(body, win) {
                win.data.renderIntro = () => renderGameIntro(body, win, gameId);
                win.data.renderIntro();
            },
            onFocus(win) {
                if (win.data.running) Biti.startIdleWatch(win.body, win.data.getHint);
            },
            onBlur() {
                Biti.stopIdleWatch();
            },
            onMinimize() {
                Biti.stopIdleWatch();
            },
            onClose(win) {
                stopGame(win, gameId);
            }
        });
    }

    function renderGameIntro(body, win, gameId) {
        const def = GAME_DEFS[gameId];
        const p = progressFor(gameId);
        const available = !!FK.games[gameId];
        body.innerHTML =
            '<div class="fk-game-intro" style="--game-color:' + def.color + '">' +
                '<div class="fk-game-intro-icon" aria-hidden="true">' + def.icon + '</div>' +
                '<h2 class="fk-game-intro-title">' + escapeHtml(def.name) + '</h2>' +
                '<p class="fk-game-intro-desc">' + escapeHtml(def.description) + '</p>' +
                '<div class="fk-game-intro-stats">' +
                    '<div><span class="fk-mini-label">Nehézség</span>' + stars(p.difficulty_level) + '</div>' +
                    '<div><span class="fk-mini-label">Teljesítve</span><strong>' + formatNumber(p.total_completed) + '</strong></div>' +
                    '<div><span class="fk-mini-label">Hibátlan sorozat</span><strong>' + p.streak + ' / 3</strong></div>' +
                '</div>' +
                (available
                    ? '<button type="button" class="fk-btn fk-btn-success text-xl px-8" data-start-game>Indulhat a kaland! 🚀</button>'
                    : '<div class="fk-soon">🚧 Ez a kaland hamarosan érkezik! Addig nézz be a Bájt-Boltba, vagy próbálj ki egy másik játékot.</div>') +
                '<p class="fk-game-intro-rule">3 hibátlan feladat zsinórban = szintlépés + bónusz! 2 hiba egy feladatban = könnyebb szint.</p>' +
            '</div>';
        const btn = $('[data-start-game]', body);
        if (btn) btn.addEventListener('click', () => startGame(win, gameId));
    }

    function startGame(win, gameId) {
        const game = FK.games[gameId];
        if (!game) return;
        AdaptiveEngine.start(gameId);
        win.data.running = true;
        win.data.hint = null;
        win.data.levelListeners = [];
        win.data.getHint = () => {
            const h = win.data.hint;
            if (typeof h === 'function') return h(AdaptiveEngine.level);
            if (h) return h;
            if (typeof game.getHint === 'function') return game.getHint(AdaptiveEngine.level);
            return null;
        };

        AdaptiveEngine.on('level-change', data => {
            win.data.levelListeners.forEach(cb => {
                try { cb(data.level, data.direction); } catch (e) { console.error(e); }
            });
        });

        const ctx = {
            gameId,
            container: win.body,
            engine: AdaptiveEngine,
            biti: Biti,
            get level() { return AdaptiveEngine.level; },
            newTask() {
                win.data.hint = null;
                return AdaptiveEngine.beginTask();
            },
            error(hint) {
                return AdaptiveEngine.recordError(hint || (win.data.getHint ? win.data.getHint() : null));
            },
            complete(opts = {}) {
                return AdaptiveEngine.completeTask(Object.assign({}, opts, { success: true }));
            },
            fail(opts = {}) {
                return AdaptiveEngine.completeTask(Object.assign({}, opts, { success: false }));
            },
            setHint(textOrFn) {
                win.data.hint = textOrFn;
            },
            onLevelChange(cb) {
                win.data.levelListeners.push(cb);
            },
            setTitle(text) {
                WindowManager.setTitle(win.id, text);
            },
            close() {
                WindowManager.close(win.id);
            }
        };
        win.data.ctx = ctx;

        clearElement(win.body);
        const container = document.createElement('div');
        container.className = 'fk-game-container';
        win.body.appendChild(container);
        ctx.container = container;

        Biti.startIdleWatch(win.body, win.data.getHint);
        Biti.say('Kezdődik a(z) ' + GAME_DEFS[gameId].name + '! ' + AdaptiveEngine.level + '. szinten indulunk. Hajrá! 💪', { mood: 'excited' });

        try {
            game.mount(container, ctx);
        } catch (e) {
            console.error(e);
            toast('Hiba történt a játék indításakor.', 'error');
            stopGame(win, gameId);
            win.data.renderIntro();
        }
    }

    function clearElement(el) {
        while (el.firstChild) el.removeChild(el.firstChild);
    }

    function stopGame(win, gameId) {
        if (!win.data.running) return;
        win.data.running = false;
        const game = FK.games[gameId];
        if (game && typeof game.unmount === 'function') {
            try { game.unmount(); } catch (e) { console.error(e); }
        }
        AdaptiveEngine.stop();
        Biti.stopIdleWatch();
    }

    // ======================================================================
    // BÁJT-BOLT
    // ======================================================================
    function openShop() {
        WindowManager.open({
            id: 'shop',
            title: 'Bájt-Bolt',
            icon: '🛒',
            width: 900,
            height: 620,
            className: 'fk-shop-window',
            render(body, win) {
                win.data.tab = 'bg';
                win.data.items = null;
                win.data.render = () => renderShop(body, win);
                body.addEventListener('click', ev => handleShopClick(ev, win));
                loadShopItems(win);
            }
        });
    }

    async function loadShopItems(win) {
        win.data.render();
        try {
            const res = await api('shop_items');
            win.data.items = res.items;
            win.data.render();
        } catch (e) {
            win.body.innerHTML = '<div class="fk-empty">⚠️ ' + escapeHtml(e.message) + '</div>';
        }
    }

    function shopItemsFor(win, type) {
        const u = FK.state.user;
        const serverItems = win.data.items || [];
        const defaults = type === 'bg'
            ? [{ id: 'default', key: 'bg_default', type: 'bg', price: 0, owned: true, equipped: u.equipped_bg === 'default' }]
            : [{ id: 'default', key: 'folder_default', type: 'folder', price: 0, owned: true, equipped: u.equipped_folder === 'default' }];
        const rest = serverItems.filter(i => i.type === type).map(i => ({
            id: i.id,
            key: i.id,
            type: i.type,
            price: i.price,
            owned: (u.unlocked_items || []).includes(i.id),
            equipped: type === 'bg' ? u.equipped_bg === i.id : u.equipped_folder === i.id,
            serverName: i.name
        }));
        return defaults.concat(rest);
    }

    function renderShop(body, win) {
        const u = FK.state.user;
        if (!u) return;
        const tab = win.data.tab;
        const tabs = [
            { id: 'bg', label: '🖼️ Hátterek' },
            { id: 'folder', label: '📁 Mappastílusok' },
            { id: 'badges', label: '🏅 Kitűzők' }
        ];
        let content;
        if (win.data.items === null && tab !== 'badges') {
            content = '<div class="fk-empty"><span class="fk-spinner"></span> Betöltés…</div>';
        } else if (tab === 'badges') {
            content = renderAchievementsGrid(u.achievements || []);
        } else {
            content = '<div class="fk-shop-grid">' + shopItemsFor(win, tab).map(item => {
                const meta = SHOP_META[item.key] || { name: item.serverName || item.id, emoji: '🎁', desc: '' };
                const preview = item.type === 'bg'
                    ? '<div class="fk-shop-preview fk-bg-' + escapeHtml(item.id) + '"><span class="fk-shop-preview-bar"></span></div>'
                    : '<div class="fk-shop-preview fk-shop-preview-folder">' + folderIcon(item.id, 88) + '</div>';
                let action;
                if (item.equipped) {
                    action = '<button type="button" class="fk-btn fk-btn-ghost w-full" disabled>✔ Használatban</button>';
                } else if (item.owned) {
                    action = '<button type="button" class="fk-btn fk-btn-primary w-full" data-equip="' + escapeHtml(item.id) + '" data-slot="' + item.type + '">Felszerelem</button>';
                } else if (u.coins >= item.price) {
                    action = '<button type="button" class="fk-btn fk-btn-success w-full" data-buy="' + escapeHtml(item.id) + '" data-price="' + item.price + '" data-name="' + escapeHtml(meta.name) + '">Megveszem · <span class="fk-coin fk-coin-sm">B</span> ' + item.price + '</button>';
                } else {
                    action = '<button type="button" class="fk-btn fk-btn-ghost w-full" disabled>🔒 Még ' + (item.price - u.coins) + ' érme kell</button>';
                }
                return '<article class="fk-shop-card' + (item.equipped ? ' is-equipped' : '') + '">' +
                    preview +
                    '<div class="fk-shop-info">' +
                        '<h3 class="fk-shop-name"><span aria-hidden="true">' + meta.emoji + '</span> ' + escapeHtml(meta.name) + '</h3>' +
                        '<p class="fk-shop-desc">' + escapeHtml(meta.desc) + '</p>' +
                        (item.price > 0 && !item.owned ? '<p class="fk-shop-price"><span class="fk-coin fk-coin-sm">B</span> ' + item.price + ' Bájt-érme</p>' : '<p class="fk-shop-price fk-shop-owned">' + (item.price === 0 ? 'Ingyenes' : 'A tiéd!') + '</p>') +
                        action +
                    '</div>' +
                '</article>';
            }).join('') + '</div>';
        }

        body.innerHTML =
            '<div class="fk-shop">' +
                '<div class="fk-shop-header">' +
                    '<div>' +
                        '<h2 class="fk-panel-title">Bájt-Bolt</h2>' +
                        '<p class="fk-panel-sub">Költsd el a feladatokkal szerzett Bájt-érméidet!</p>' +
                    '</div>' +
                    '<div class="fk-pill fk-pill-coin fk-pill-big"><span class="fk-coin">B</span><strong>' + formatNumber(u.coins) + '</strong></div>' +
                '</div>' +
                '<div class="fk-tabs" role="tablist">' +
                    tabs.map(t => '<button type="button" role="tab" class="fk-tab' + (t.id === tab ? ' is-active' : '') + '" data-shop-tab="' + t.id + '" aria-selected="' + (t.id === tab) + '">' + t.label + '</button>').join('') +
                '</div>' +
                '<div class="fk-shop-content">' + content + '</div>' +
            '</div>';
    }

    async function handleShopClick(ev, win) {
        const tabBtn = ev.target.closest('[data-shop-tab]');
        if (tabBtn) {
            win.data.tab = tabBtn.dataset.shopTab;
            win.data.render();
            return;
        }
        const buyBtn = ev.target.closest('[data-buy]');
        if (buyBtn) {
            const id = buyBtn.dataset.buy;
            const ok = await confirmDialog('Megveszed: ' + buyBtn.dataset.name + ' – ' + buyBtn.dataset.price + ' Bájt-érméért?', 'Megveszem!', 'success', 'Vásárlás');
            if (!ok) return;
            buyBtn.disabled = true;
            try {
                const res = await api('buy_item', { item_id: id, equip: true });
                (win.data.items || []).forEach(i => { if (i.id === id) i.owned = true; });
                FK.setUser(res.user);
                toast(res.message, 'success');
                Biti.say('Szuper választás! Már fel is szereltem neked. 😎', { mood: 'excited' });
                announceAchievements(res.new_achievements);
            } catch (e) {
                toast(e.message, 'error');
                buyBtn.disabled = false;
            }
            return;
        }
        const equipBtn = ev.target.closest('[data-equip]');
        if (equipBtn) {
            equipBtn.disabled = true;
            try {
                const res = await api('equip_item', { item_id: equipBtn.dataset.equip, slot: equipBtn.dataset.slot });
                FK.setUser(res.user);
                toast('Beállítva! ✨', 'success');
            } catch (e) {
                toast(e.message, 'error');
                equipBtn.disabled = false;
            }
        }
    }

    // ======================================================================
    // PROFILOM ÉS KITŰZŐK
    // ======================================================================
    function renderAchievementsGrid(list) {
        const earned = list.filter(a => a.earned).length;
        return '<div class="fk-ach-summary">🏅 Megszerzett kitűzők: <strong>' + earned + ' / ' + list.length + '</strong></div>' +
            '<div class="fk-ach-grid">' + list.map(a =>
                '<div class="fk-ach' + (a.earned ? ' is-earned' : '') + '" title="' + escapeHtml(a.desc) + '">' +
                    '<div class="fk-ach-medal" aria-hidden="true">' + (a.earned ? a.icon : '🔒') + '</div>' +
                    '<div class="fk-ach-name">' + escapeHtml(a.name) + '</div>' +
                    '<div class="fk-ach-desc">' + escapeHtml(a.desc) + '</div>' +
                '</div>'
            ).join('') + '</div>';
    }

    function openProfile() {
        WindowManager.open({
            id: 'profile',
            title: 'Profilom és Kitűzők',
            icon: '🏆',
            width: 860,
            height: 640,
            className: 'fk-profile-window',
            render(body, win) {
                win.data.render = () => renderProfile(body);
                win.data.render();
                body.addEventListener('click', ev => {
                    const g = ev.target.closest('[data-open-game]');
                    if (g) openGame(Number(g.dataset.openGame));
                    if (ev.target.closest('[data-open-shop]')) openShop();
                });
            }
        });
    }

    function renderProfile(body) {
        const u = FK.state.user;
        if (!u) return;
        const info = levelInfo(u.xp);
        const games = Object.keys(GAME_DEFS).map(id => {
            const def = GAME_DEFS[id];
            const p = progressFor(id);
            return '<button type="button" class="fk-progress-card" data-open-game="' + id + '" style="--game-color:' + def.color + '">' +
                '<span class="fk-progress-icon" aria-hidden="true">' + def.icon + '</span>' +
                '<span class="fk-progress-body">' +
                    '<span class="fk-progress-name">' + escapeHtml(def.name) + '</span>' +
                    stars(p.difficulty_level) +
                    '<span class="fk-progress-meta">✔ ' + p.total_completed + ' teljesítve · ❌ ' + p.total_errors + ' hiba</span>' +
                '</span>' +
            '</button>';
        }).join('');

        body.innerHTML =
            '<div class="fk-profile">' +
                '<section class="fk-profile-hero">' +
                    '<div class="fk-avatar fk-avatar-xl">' + escapeHtml(initials(u.name)) + '</div>' +
                    '<div class="fk-profile-main">' +
                        '<h2 class="fk-panel-title">' + escapeHtml(u.name) + '</h2>' +
                        '<p class="fk-panel-sub">' + escapeHtml(u.class_name ? u.class_name + ' osztály' : '') + ' · @' + escapeHtml(u.username) + '</p>' +
                        '<div class="fk-profile-level">' +
                            '<span class="fk-level-badge">' + info.level + '. szint</span>' +
                            '<div class="fk-profile-xpbar"><span style="width:' + Math.round(info.ratio * 100) + '%"></span></div>' +
                            '<span class="fk-profile-xptext">' + info.current + ' / ' + info.need + ' XP</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="fk-profile-stats">' +
                        '<div class="fk-profile-stat"><span>⭐</span><strong>' + formatNumber(u.xp) + '</strong><small>összes XP</small></div>' +
                        '<button type="button" class="fk-profile-stat" data-open-shop><span><span class="fk-coin">B</span></span><strong>' + formatNumber(u.coins) + '</strong><small>Bájt-érme</small></button>' +
                    '</div>' +
                '</section>' +
                '<h3 class="fk-section-title">🎮 Kalandjaim</h3>' +
                '<div class="fk-progress-grid">' + games + '</div>' +
                '<h3 class="fk-section-title">🏅 Kitűzőim</h3>' +
                renderAchievementsGrid(u.achievements || []) +
            '</div>';
    }

    // ======================================================================
    // INDULÁS
    // ======================================================================
    async function boot() {
        bindAuthEvents();
        try {
            const res = await api('check_session');
            if (res.logged_in) {
                enterApp(res.user, res.progress || [], res.new_achievements || []);
                return;
            }
        } catch (e) {
            showScreen('screen-auth');
            showAuthMessage(e.message);
            return;
        }
        showScreen('screen-auth');
        switchAuthTab('login');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
