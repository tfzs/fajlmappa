/* ==========================================================================
   Fájl-Kaland – games_1.js
   Az első három játékmodul:
     1. Kiterjesztés-párosító   (Micsoda ez a fájl?)
     2. Útvonal-labirintus      (Navigáció és fastruktúra – explorer.js-sel)
     3. Billentyűparancs-nindzsa (Gyorsbillentyűk gyakorlása)

   Integráció:
     - FK.registerGame(...) – core.js (játékablak, AdaptiveEngine, Biti)
     - ctx.newTask() / ctx.error(hint) / ctx.complete() / ctx.fail() / ctx.setHint() / ctx.onLevelChange()
     - FK.VFS és FK.Explorer – explorer.js (Útvonal-labirintus)
   Minden játék az aktuális nehézségi szinthez (1–5) igazodik; a szint a kör
   elején a ctx.level értékéből kerül kiolvasásra.
   A közös játékkeretet (FK.GameKit) a games_2.js is használja, ezért a
   games_1.js-nek előbb kell betöltődnie (az index.html így tölti be).
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

    function shuffle(list) {
        const a = list.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function pick(list) {
        return list[Math.floor(Math.random() * list.length)];
    }

    function sample(list, n) {
        return shuffle(list).slice(0, Math.max(0, n));
    }

    function normalizeName(text) {
        return String(text || '')
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/[\s_-]+/g, '_')
            .trim();
    }

    function starsHtml(level) {
        if (typeof FK.stars === 'function') return FK.stars(level);
        return '★'.repeat(level) + '☆'.repeat(5 - level);
    }

    function fileIconHtml(ext, size) {
        if (typeof FK.fileIcon === 'function') return FK.fileIcon(ext, size);
        return '<span style="font-size:' + Math.round(size * 0.7) + 'px">📄</span>';
    }

    function say(text, mood) {
        if (FK.Biti && typeof FK.Biti.say === 'function') FK.Biti.say(text, { mood: mood || 'happy' });
    }

    function isWindowActive(el) {
        if (!el || !el.isConnected || el.offsetParent === null) return false;
        const win = el.closest('.fk-window');
        if (win && !win.classList.contains('is-active')) return false;
        const modal = document.getElementById('confirm-modal');
        if (modal && !modal.classList.contains('hidden')) return false;
        if (document.querySelector('.fk-celebrate')) return false;
        return true;
    }

    // ======================================================================
    // STÍLUSOK
    // ======================================================================
    const STYLES = `
.fkg {
    position: relative; display: flex; flex-direction: column; height: 100%; min-height: 420px;
    background: #f8fafc; color: #1e293b; font-family: 'Nunito', system-ui, sans-serif;
    user-select: none; -webkit-user-select: none; overflow: hidden;
}
.fkg button { font: inherit; border: 0; cursor: pointer; }
.fkg-head {
    display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; padding: .55rem .9rem;
    background: #fff; border-bottom: 1px solid #e2e8f0;
}
.fkg-title { margin-right: auto; font-family: 'Baloo 2', 'Nunito', sans-serif; font-size: 1.2rem; font-weight: 800; color: #0f172a; }
.fkg-chip {
    display: inline-flex; align-items: center; gap: .3rem; padding: .25rem .7rem; border-radius: 999px;
    background: #f1f5f9; font-weight: 800; font-size: .85rem; white-space: nowrap;
}
.fkg-chip .fk-stars { font-size: .95rem; }
.fkg-chip-err { background: #fee2e2; color: #b91c1c; }
.fkg-chip-time { background: #fef3c7; color: #92400e; }
.fkg-chip-time.is-urgent { background: #fecaca; color: #b91c1c; animation: fkg-pulse .6s ease-in-out infinite; }
.fkg-iconbtn {
    min-width: 40px; height: 36px; padding: 0 .6rem; border-radius: .6rem; background: #f1f5f9; font-weight: 800;
}
.fkg-iconbtn:hover { background: #e2e8f0; }
.fkg-body { position: relative; flex: 1; min-height: 0; overflow: auto; }
.fkg-overlay {
    position: absolute; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center;
    padding: 1rem; background: rgba(15, 23, 42, .45);
}
.fkg-summary {
    width: min(100%, 420px); padding: 1.5rem; border-radius: 1.4rem; background: #fff; text-align: center;
    box-shadow: 0 20px 50px rgba(15, 23, 42, .35); animation: fkg-pop .35s cubic-bezier(.2, .9, .3, 1.3) both;
}
.fkg-summary-emoji { font-size: 3.5rem; line-height: 1; }
.fkg-summary h3 { margin: .4rem 0 .6rem; font-family: 'Baloo 2', 'Nunito', sans-serif; font-size: 1.6rem; font-weight: 800; }
.fkg-summary ul { list-style: none; margin: 0 0 1rem; padding: 0; display: flex; flex-direction: column; gap: .35rem; font-weight: 700; color: #334155; }
.fkg-summary-actions { display: flex; flex-wrap: wrap; gap: .5rem; justify-content: center; }
.fkg-btn {
    min-height: 46px; padding: .6rem 1.2rem; border-radius: .9rem; font-family: 'Baloo 2', 'Nunito', sans-serif;
    font-weight: 800; font-size: 1.05rem; transition: transform .08s;
}
.fkg-btn:active { transform: translateY(2px); }
.fkg-btn-go { background: #16a34a; color: #fff; box-shadow: 0 4px 0 #15803d; }
.fkg-btn-ghost { background: #f1f5f9; color: #334155; }
.fkg-spinner {
    width: 2.2rem; height: 2.2rem; margin: 0 auto .6rem; border: 4px solid #cbd5e1; border-top-color: #2563eb;
    border-radius: 50%; animation: fkg-spin .7s linear infinite;
}
.fkg-feedback {
    position: absolute; left: 50%; top: .8rem; z-index: 35; transform: translateX(-50%); pointer-events: none;
    padding: .5rem 1rem; border-radius: 999px; font-weight: 800; font-size: 1rem; white-space: nowrap;
    box-shadow: 0 8px 20px rgba(15, 23, 42, .2); animation: fkg-feedback 1.4s ease-out both;
}
.fkg-feedback.is-ok { background: #dcfce7; color: #166534; }
.fkg-feedback.is-bad { background: #fee2e2; color: #991b1b; }
.fkg-feedback.is-info { background: #e0f2fe; color: #075985; }
@keyframes fkg-feedback { 0% { opacity: 0; transform: translate(-50%, -10px); } 15% { opacity: 1; transform: translate(-50%, 0); } 80% { opacity: 1; } 100% { opacity: 0; } }
@keyframes fkg-pop { from { opacity: 0; transform: scale(.85); } to { opacity: 1; transform: none; } }
@keyframes fkg-spin { to { transform: rotate(360deg); } }
@keyframes fkg-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
@keyframes fkg-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-8px); } 40% { transform: translateX(8px); } 60% { transform: translateX(-6px); } 80% { transform: translateX(6px); } }
@keyframes fkg-belt { from { background-position: 0 0; } to { background-position: 40px 0; } }

/* ---------- 1. Kiterjesztés-párosító ---------- */
.fkg1 { display: flex; flex-direction: column; gap: .9rem; height: 100%; padding: .9rem; }
.fkg1-beltwrap { position: relative; }
.fkg1-belt-label { display: flex; justify-content: space-between; margin-bottom: .3rem; font-size: .8rem; font-weight: 800; color: #64748b; }
.fkg1-belt {
    position: relative; height: 150px; border-radius: 1rem; overflow: hidden;
    background: repeating-linear-gradient(90deg, #475569 0 20px, #3f4b5e 20px 40px);
    box-shadow: inset 0 6px 0 #1e293b, inset 0 -6px 0 #1e293b, 0 6px 14px rgba(15, 23, 42, .2);
    animation: fkg-belt .9s linear infinite; touch-action: pan-y;
}
.fkg1-belt.is-paused { animation-play-state: paused; }
.fkg1-belt::after {
    content: '⚠️'; position: absolute; right: 0; top: 0; bottom: 0; width: 44px; display: flex; align-items: center; justify-content: center;
    background: repeating-linear-gradient(45deg, #facc15 0 10px, #1e293b 10px 20px); font-size: 1.2rem; opacity: .9;
}
.fkg1-card {
    position: absolute; top: 50%; left: 0; width: 124px; padding: .55rem .4rem .45rem; margin-top: -58px;
    display: flex; flex-direction: column; align-items: center; gap: .25rem; border-radius: .9rem; background: #fff;
    box-shadow: 0 6px 14px rgba(0, 0, 0, .3); cursor: grab; touch-action: none; z-index: 2; will-change: left;
}
.fkg1-card.is-selected { outline: 4px solid #facc15; outline-offset: 2px; }
.fkg1-card.is-dragging {
    position: fixed; margin: 0; transform: translate(-50%, -50%) rotate(-4deg) scale(1.08); z-index: 9999;
    pointer-events: none; cursor: grabbing; box-shadow: 0 16px 32px rgba(0, 0, 0, .35);
}
.fkg1-card.is-wrong { animation: fkg-shake .45s ease-in-out; outline: 4px solid #ef4444; }
.fkg1-card.is-falling { transition: transform .5s ease-in, opacity .5s; transform: translateY(120px) rotate(30deg); opacity: 0; }
.fkg1-card.is-sorted { transition: transform .35s ease-in, opacity .35s; transform: scale(.3); opacity: 0; }
.fkg1-name { max-width: 100%; font-size: .78rem; font-weight: 800; text-align: center; line-height: 1.15; word-break: break-all; }
.fkg1-name b { color: #2563eb; font-size: .9rem; }
.fkg1-stations { display: grid; grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)); gap: .6rem; }
.fkg1-station {
    min-height: 112px; padding: .6rem .4rem; border-radius: 1.1rem; border: 3px dashed var(--st-color, #94a3b8);
    background: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .2rem;
    text-align: center; transition: transform .12s, background .12s, box-shadow .12s;
}
.fkg1-station:hover { background: #f8fafc; }
.fkg1-station-icon { font-size: 2.1rem; line-height: 1; }
.fkg1-station-name { font-weight: 800; font-size: .9rem; line-height: 1.15; }
.fkg1-station-exts { font-size: .72rem; font-weight: 800; color: #64748b; }
.fkg1-station-count { font-size: .72rem; font-weight: 800; color: #16a34a; min-height: 1em; }
.fkg1-station.is-hover { transform: scale(1.05); border-style: solid; background: #f0fdf4; box-shadow: 0 0 0 5px rgba(34, 197, 94, .2); }
.fkg1-station.is-target { border-style: solid; box-shadow: 0 0 0 4px rgba(250, 204, 21, .35); }
.fkg1-station.is-ok { animation: fkg-pulse .4s ease-in-out; background: #dcfce7; border-color: #22c55e; border-style: solid; }
.fkg1-station.is-bad { animation: fkg-shake .45s ease-in-out; background: #fee2e2; border-color: #ef4444; border-style: solid; }
.fkg1-tip { font-size: .85rem; font-weight: 700; color: #475569; text-align: center; }

/* ---------- 2. Útvonal-labirintus ---------- */
.fkg2 { display: flex; flex-direction: column; height: 100%; }
.fkg2-mission {
    display: flex; flex-wrap: wrap; align-items: center; gap: .6rem 1rem; padding: .75rem 1rem;
    background: linear-gradient(135deg, #ecfeff, #ede9fe); border-bottom: 1px solid #c7d2fe;
}
.fkg2-mission-icon { font-size: 2.2rem; line-height: 1; }
.fkg2-mission-text { flex: 1 1 320px; font-weight: 800; font-size: 1rem; line-height: 1.4; }
.fkg2-path {
    display: inline-block; margin: .15rem 0; padding: .15rem .5rem; border-radius: .45rem; background: #0f172a; color: #a5f3fc;
    font-family: Consolas, 'Courier New', monospace; font-size: .92rem; word-break: break-all; user-select: text; -webkit-user-select: text;
}
.fkg2-where { flex: 1 1 100%; font-size: .82rem; font-weight: 700; color: #475569; }
.fkg2-where code { font-family: Consolas, 'Courier New', monospace; color: #1d4ed8; word-break: break-all; }
.fkg2-explorer { position: relative; flex: 1; min-height: 0; }

/* ---------- 3. Billentyűparancs-nindzsa ---------- */
.fkg3 { display: flex; flex-direction: column; gap: .8rem; height: 100%; padding: .9rem; }
.fkg3-challenge {
    position: relative; padding: 1rem 1.2rem; border-radius: 1.2rem; background: linear-gradient(135deg, #1e1b4b, #312e81);
    color: #fff; box-shadow: 0 8px 20px rgba(49, 46, 129, .3); overflow: hidden;
}
.fkg3-challenge::before { content: '🥷'; position: absolute; right: .8rem; top: 50%; transform: translateY(-50%); font-size: 3.2rem; opacity: .25; }
.fkg3-step { font-size: .78rem; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: #a5b4fc; }
.fkg3-prompt { margin-top: .2rem; font-family: 'Baloo 2', 'Nunito', sans-serif; font-size: 1.45rem; font-weight: 800; line-height: 1.2; padding-right: 3rem; }
.fkg3-help { margin-top: .5rem; display: flex; align-items: center; gap: .4rem; flex-wrap: wrap; font-weight: 700; color: #e0e7ff; }
.fkg3-kbd {
    display: inline-flex; align-items: center; justify-content: center; min-width: 2.2rem; height: 2.1rem; padding: 0 .55rem;
    border-radius: .5rem; background: #f8fafc; color: #0f172a; font-weight: 900; box-shadow: 0 3px 0 #94a3b8;
}
.fkg3-seq { display: flex; gap: .35rem; margin-top: .5rem; flex-wrap: wrap; }
.fkg3-seq span { padding: .15rem .55rem; border-radius: 999px; background: rgba(255, 255, 255, .15); font-size: .8rem; font-weight: 800; }
.fkg3-seq span.is-done { background: #22c55e; }
.fkg3-seq span.is-now { background: #facc15; color: #1e1b4b; }
.fkg3-timebar { height: 8px; margin-top: .7rem; border-radius: 999px; background: rgba(255, 255, 255, .2); overflow: hidden; }
.fkg3-timebar i { display: block; height: 100%; width: 100%; background: linear-gradient(90deg, #f87171, #facc15, #4ade80); transform-origin: left; }
.fkg3-challenge, .fkg3-dock { flex-shrink: 0; }
.fkg3-stage { flex: 1; min-height: 170px; display: flex; gap: .8rem; }
.fkg3-window { flex: 1; min-width: 0; display: flex; flex-direction: column; border-radius: 1rem; background: #fff; border: 1px solid #e2e8f0; box-shadow: 0 6px 16px rgba(15, 23, 42, .1); overflow: hidden; }
.fkg3-wtitle { display: flex; align-items: center; gap: .45rem; padding: .5rem .8rem; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; font-weight: 800; }
.fkg3-files { flex: 1; min-height: 0; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: .5rem; align-content: start; padding: .8rem; }
.fkg3-tile { display: flex; flex-direction: column; align-items: center; gap: .25rem; padding: .5rem .3rem; border-radius: .8rem; border: 2px solid transparent; }
.fkg3-tile.is-selected { background: #dbeafe; border-color: #60a5fa; }
.fkg3-tile.is-cut { opacity: .4; }
.fkg3-tile.is-new { animation: fkg-pop .4s cubic-bezier(.2, .9, .3, 1.4) both; background: #dcfce7; }
.fkg3-tile.is-wrong { animation: fkg-shake .45s ease-in-out; }
.fkg3-tile.is-oops { background: #fee2e2; border-color: #f87171; }
.fkg3-tile-name { font-size: .8rem; font-weight: 800; text-align: center; word-break: break-all; }
.fkg3-tile-name.is-editing { padding: 0 .3rem; border: 2px solid #3b82f6; border-radius: .3rem; background: #fff; }
.fkg3-tile-name.is-editing::after { content: '|'; animation: fkg-blink 1s steps(1) infinite; color: #2563eb; }
@keyframes fkg-blink { 50% { opacity: 0; } }
.fkg3-side { width: 170px; display: flex; flex-direction: column; gap: .8rem; flex-shrink: 0; }
.fkg3-tray, .fkg3-bin {
    flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .3rem; padding: .7rem;
    border-radius: 1rem; background: #fff; border: 2px dashed #cbd5e1; text-align: center; font-weight: 800; font-size: .82rem; color: #64748b;
}
.fkg3-tray.is-full { border-style: solid; border-color: #60a5fa; background: #eff6ff; color: #1d4ed8; }
.fkg3-bin.is-full { border-style: solid; border-color: #f87171; background: #fef2f2; color: #b91c1c; }
.fkg3-tray-icon, .fkg3-bin-icon { font-size: 2rem; line-height: 1; }
.fkg3-dock {
    display: flex; align-items: center; justify-content: center; gap: .45rem; flex-wrap: wrap; padding: .6rem;
    border-radius: 1rem; background: linear-gradient(180deg, #1e293b, #0f172a);
}
.fkg3-dock-label { color: #94a3b8; font-size: .78rem; font-weight: 800; }
.fkg3-key {
    min-width: 58px; height: 54px; padding: 0 .8rem; border-radius: .75rem; background: linear-gradient(180deg, #f8fafc, #cbd5e1);
    color: #0f172a; font-weight: 900; font-size: 1.05rem; box-shadow: 0 4px 0 #64748b; touch-action: manipulation; transition: transform .06s, box-shadow .06s;
}
.fkg3-key.is-pressed, .fkg3-key:active { transform: translateY(3px); box-shadow: 0 1px 0 #64748b; }
.fkg3-key-ctrl { min-width: 80px; }
.fkg3-key-ctrl.is-on { background: linear-gradient(180deg, #60a5fa, #2563eb); color: #fff; box-shadow: 0 4px 0 #1e3a8a, 0 0 16px rgba(96, 165, 250, .85); }
.fkg3-key-wide { min-width: 90px; }
@media (max-width: 640px) {
    .fkg3-stage { flex-direction: column; }
    .fkg3-side { width: auto; flex-direction: row; }
    .fkg3-prompt { font-size: 1.2rem; }
    .fkg1-card { width: 104px; }
    .fkg1-belt { height: 140px; }
}
`;

    function injectStyles() {
        if (document.getElementById('fkg1-styles')) return;
        const style = document.createElement('style');
        style.id = 'fkg1-styles';
        style.textContent = STYLES;
        document.head.appendChild(style);
    }

    // ======================================================================
    // KÖZÖS JÁTÉKKERET
    // ======================================================================
    function createShell(container, ctx, opts) {
        injectStyles();
        container.style.height = '100%';
        container.innerHTML =
            '<div class="fkg">' +
                '<div class="fkg-head">' +
                    '<span class="fkg-title">' + opts.icon + ' ' + escapeHtml(opts.title) + '</span>' +
                    '<span class="fkg-chip" data-level title="Nehézségi szint"></span>' +
                    '<span class="fkg-chip" data-progress></span>' +
                    '<span class="fkg-chip fkg-chip-time" data-timer style="display:none"></span>' +
                    '<span class="fkg-chip fkg-chip-err" data-errors title="Hibák ebben a körben">❌ 0</span>' +
                    (opts.pausable ? '<button type="button" class="fkg-iconbtn" data-pause title="Szünet">⏸</button>' : '') +
                '</div>' +
                '<div class="fkg-body"></div>' +
            '</div>';
        const root = container.querySelector('.fkg');
        const shell = {
            root,
            body: root.querySelector('.fkg-body'),
            alive: true,
            setLevel(level) {
                root.querySelector('[data-level]').innerHTML = starsHtml(level || ctx.level);
            },
            setProgress(text) {
                root.querySelector('[data-progress]').textContent = text;
            },
            setErrors(n) {
                root.querySelector('[data-errors]').textContent = '❌ ' + n;
            },
            setTimer(seconds) {
                const el = root.querySelector('[data-timer]');
                if (seconds === null || seconds === undefined) {
                    el.style.display = 'none';
                    return;
                }
                el.style.display = '';
                el.textContent = '⏱️ ' + Math.max(0, Math.ceil(seconds)) + ' mp';
                el.classList.toggle('is-urgent', seconds <= 3);
            },
            feedback(text, type = 'ok') {
                const el = document.createElement('div');
                el.className = 'fkg-feedback is-' + type;
                el.textContent = text;
                root.appendChild(el);
                setTimeout(() => el.remove(), 1500);
            },
            clearOverlay() {
                root.querySelectorAll('.fkg-overlay').forEach(o => o.remove());
            },
            showBusy(text) {
                shell.clearOverlay();
                const o = document.createElement('div');
                o.className = 'fkg-overlay';
                o.innerHTML = '<div class="fkg-summary"><div class="fkg-spinner"></div><strong>' + escapeHtml(text) + '</strong></div>';
                root.appendChild(o);
            },
            showSummary(data) {
                shell.clearOverlay();
                const o = document.createElement('div');
                o.className = 'fkg-overlay';
                o.innerHTML =
                    '<div class="fkg-summary" role="dialog" aria-label="' + escapeHtml(data.title) + '">' +
                        '<div class="fkg-summary-emoji" aria-hidden="true">' + data.emoji + '</div>' +
                        '<h3>' + escapeHtml(data.title) + '</h3>' +
                        '<ul>' + data.lines.map(l => '<li>' + escapeHtml(l) + '</li>').join('') + '</ul>' +
                        '<div class="fkg-summary-actions">' +
                            '<button type="button" class="fkg-btn fkg-btn-ghost" data-quit>Kilépés</button>' +
                            '<button type="button" class="fkg-btn fkg-btn-go" data-next>' + escapeHtml(data.nextLabel || 'Következő kör ▶') + '</button>' +
                        '</div>' +
                    '</div>';
                root.appendChild(o);
                o.querySelector('[data-next]').addEventListener('click', () => {
                    o.remove();
                    data.onNext();
                });
                o.querySelector('[data-quit]').addEventListener('click', () => ctx.close());
                o.querySelector('[data-next]').focus();
            },
            onPause(cb) {
                const btn = root.querySelector('[data-pause]');
                if (btn) btn.addEventListener('click', () => cb(btn));
            }
        };
        shell.setLevel(ctx.level);
        ctx.onLevelChange(level => {
            if (shell.alive) shell.setLevel(level);
        });
        return shell;
    }

    /** Kör lezárása: mentés az AdaptiveEngine-nel, majd összefoglaló. */
    async function finishRound(ctx, shell, info) {
        shell.showBusy('Eredmény mentése…');
        let res = null;
        try {
            res = info.success ? await ctx.complete() : await ctx.fail();
        } catch (e) {
            res = null;
        }
        if (!shell.alive) return;
        const lines = info.lines.slice();
        if (res && res.saved) {
            if (res.earned && (res.earned.xp || res.earned.coins)) lines.push('⭐ +' + res.earned.xp + ' XP   🪙 +' + res.earned.coins + ' Bájt-érme');
            if (res.difficulty_up) {
                lines.push('🚀 Szintlépés! Mostantól ' + res.difficulty_level + '. szinten játszol.');
                if (res.bonus && res.bonus.xp) lines.push('🎁 Bónusz: +' + res.bonus.xp + ' XP és +' + res.bonus.coins + ' érme');
            } else if (res.difficulty_down) {
                lines.push('🙂 Egy kicsit könnyebb szinten (' + res.difficulty_level + '.) folytatjuk.');
            } else if (info.success) {
                const p = typeof FK.progressFor === 'function' ? FK.progressFor(ctx.gameId) : null;
                if (p && res.difficulty_level < 5) lines.push('🎯 Hibátlan sorozat: ' + p.streak + ' / 3 (3 = szintlépés)');
            }
        } else {
            lines.push('⚠️ Az eredményt most nem sikerült elmenteni.');
        }
        shell.setLevel(ctx.level);
        shell.showSummary({
            emoji: info.success ? (info.errors === 0 ? '🏆' : '✅') : '💪',
            title: info.success ? (info.errors === 0 ? 'Hibátlan kör!' : 'Kör teljesítve!') : 'Ez most nem sikerült…',
            lines,
            onNext: info.onNext
        });
    }

    // ======================================================================
    // 1. JÁTÉK – KITERJESZTÉS-PÁROSÍTÓ
    // ======================================================================
    const STATIONS = {
        image:   { name: 'Képnézegető',          icon: '🖼️', color: '#16a34a', exts: ['.jpg', '.png'] },
        music:   { name: 'Zenelejátszó',         icon: '🎵', color: '#9333ea', exts: ['.mp3'] },
        text:    { name: 'Szövegszerkesztő',     icon: '📝', color: '#2563eb', exts: ['.txt', '.docx'] },
        program: { name: 'Futtatható program',   icon: '⚙️', color: '#475569', exts: ['.exe'] },
        zip:     { name: 'Tömörítő',             icon: '🗜️', color: '#ca8a04', exts: ['.zip'] },
        video:   { name: 'Videólejátszó',        icon: '🎬', color: '#db2777', exts: ['.mp4'] },
        pdf:     { name: 'PDF-olvasó',           icon: '📕', color: '#dc2626', exts: ['.pdf'] },
        office:  { name: 'Táblázat és bemutató', icon: '📊', color: '#ea580c', exts: ['.xlsx', '.pptx'] }
    };

    const EXT_INFO = {
        '.jpg':  'kép (fénykép)',
        '.png':  'kép (rajz, képernyőkép)',
        '.mp3':  'zene, hangfájl',
        '.txt':  'egyszerű szöveg',
        '.docx': 'Word-dokumentum (szöveg)',
        '.exe':  'futtatható program',
        '.zip':  'tömörített fájl',
        '.mp4':  'videó',
        '.pdf':  'PDF-dokumentum',
        '.xlsx': 'Excel-táblázat',
        '.pptx': 'PowerPoint-bemutató'
    };

    const FILE_NAMES = {
        '.jpg':  ['nyaralas', 'osztalykep', 'kiskutya', 'naplemente', 'szulinap', 'balaton'],
        '.png':  ['rajzom', 'kepernyokep', 'logo', 'terkep', 'matrica'],
        '.mp3':  ['himnusz', 'kedvenc_dal', 'csengo', 'gitar_dallam', 'tavaszi_szel'],
        '.txt':  ['jegyzet', 'bevasarlolista', 'otletek', 'olvasonaplo', 'jelszo_tippek'],
        '.docx': ['beadando', 'fogalmazas', 'meghivo', 'level_nagyinak', 'kiselőadás'],
        '.exe':  ['jatekindito', 'telepito', 'rajzprogram', 'szamologep', 'frissites'],
        '.zip':  ['kepek_csomag', 'osszes_hazi', 'letoltes', 'mentes_2025'],
        '.mp4':  ['osztalykirandulas', 'video_klip', 'film_elozetes', 'focimeccs'],
        '.pdf':  ['kozlemeny', 'orarend', 'tankonyv_fejezet', 'szuloi_level'],
        '.xlsx': ['koltsegvetes', 'jegyek', 'szorzotabla', 'edzesnaplo'],
        '.pptx': ['bolygok_bemutato', 'eloadas_a_vizrol', 'dinoszauruszok']
    };

    // Félrevezető nevek: a név mást sugall, de csak a kiterjesztés számít!
    const TRICKY_NAMES = {
        '.jpg':  ['zenekar_foto', 'program_terv', 'video_kepkocka', 'dalszoveg_kepe'],
        '.png':  ['zene_ikon', 'szoveg_kepe', 'film_plakat'],
        '.mp3':  ['dalszoveg', 'kep_hangja', 'jegyzet_felolvasva', 'video_hang'],
        '.txt':  ['zene_szoveg', 'fenykep_leiras', 'video_otletek', 'program_lista'],
        '.docx': ['zeneora_jegyzet', 'kepek_listaja', 'film_ismerteto'],
        '.exe':  ['cica_kep.jpg', 'kedvenc_dal.mp3', 'hazi_feladat.docx', 'ingyen_jatek'],
        '.zip':  ['video_gyujtemeny', 'zene_album', 'fenykepek'],
        '.mp4':  ['kepek_diavetites', 'zene_klip_szoveg', 'jegyzet_video'],
        '.pdf':  ['program_leiras', 'kep_galeria', 'zene_kotta'],
        '.xlsx': ['film_lista', 'zene_toplista', 'foto_lista'],
        '.pptx': ['zene_bemutato', 'kep_album', 'video_terv']
    };

    const G1_LEVELS = {
        1: { stations: ['image', 'music', 'text'], exts: ['.jpg', '.mp3', '.txt'], count: 6, travel: 17000, gap: 5600, maxOnBelt: 2, tricky: 0, showExts: true },
        2: { stations: ['image', 'music', 'text', 'program'], exts: ['.jpg', '.png', '.mp3', '.txt', '.docx', '.exe'], count: 7, travel: 14500, gap: 4500, maxOnBelt: 3, tricky: 0, showExts: true },
        3: { stations: ['image', 'music', 'text', 'program', 'zip', 'video'], exts: ['.jpg', '.png', '.mp3', '.txt', '.docx', '.exe', '.zip', '.mp4'], count: 8, travel: 12500, gap: 3800, maxOnBelt: 3, tricky: 0.15, showExts: false },
        4: { stations: ['image', 'music', 'text', 'program', 'zip', 'video', 'pdf'], exts: ['.jpg', '.png', '.mp3', '.txt', '.docx', '.exe', '.zip', '.mp4', '.pdf'], count: 9, travel: 11000, gap: 3200, maxOnBelt: 4, tricky: 0.35, showExts: false },
        5: { stations: ['image', 'music', 'text', 'program', 'zip', 'video', 'pdf', 'office'], exts: ['.jpg', '.png', '.mp3', '.txt', '.docx', '.exe', '.zip', '.mp4', '.pdf', '.xlsx', '.pptx'], count: 10, travel: 9500, gap: 2600, maxOnBelt: 4, tricky: 0.6, showExts: false }
    };

    function stationForExt(ext) {
        return Object.keys(STATIONS).find(k => STATIONS[k].exts.includes(ext));
    }

    class ExtensionMatcher {
        constructor(container, ctx) {
            this.ctx = ctx;
            this.shell = createShell(container, ctx, { title: 'Kiterjesztés-párosító', icon: '🔍', pausable: true });
            this.cards = [];
            this.raf = null;
            this.paused = false;
            this.running = false;
            this.selectedId = null;
            this.drag = null;
            this.uid = 0;
            this.onWindowMove = ev => this.onDragMove(ev);
            this.onWindowUp = ev => this.onDragEnd(ev);
            this.shell.onPause(btn => this.togglePause(btn));
            ctx.setHint(() => this.hint());
            this.startRound();
        }

        startRound() {
            const level = this.ctx.level;
            this.level = level;
            this.cfg = G1_LEVELS[level] || G1_LEVELS[1];
            this.ctx.newTask();
            this.errors = 0;
            this.sorted = 0;
            this.missed = 0;
            this.cards = [];
            this.selectedId = null;
            this.queue = this.buildQueue();
            this.total = this.queue.length;
            this.lastSpawn = -Infinity;
            this.lastFrame = null;
            this.shell.setLevel(level);
            this.shell.setErrors(0);
            this.render();
            this.updateProgress();
            this.running = true;
            this.paused = false;
            this.raf = requestAnimationFrame(t => this.tick(t));
            if (level === 1) {
                say('Húzd a fájlokat a megfelelő állomásra, vagy koppints a fájlra, majd az állomásra! Figyeld a pont utáni részt! 👀', 'happy');
            } else if (this.cfg.tricky >= 0.35) {
                say('Vigyázz, trükkös fájlnevek jönnek! Csak a kiterjesztés számít, vagyis az utolsó pont utáni rész! 🕵️', 'think');
            }
        }

        buildQueue() {
            const cfg = this.cfg;
            const list = [];
            // Minden állomásra jusson legalább egy fájl
            const mustExts = cfg.stations.map(st => pick(STATIONS[st].exts.filter(e => cfg.exts.includes(e))));
            while (list.length < cfg.count) {
                const ext = mustExts.length ? mustExts.shift() : pick(cfg.exts);
                const tricky = Math.random() < cfg.tricky;
                let base;
                if (tricky) {
                    let pool = TRICKY_NAMES[ext].slice();
                    // A dupla kiterjesztésű csali (pl. cica_kep.jpg.exe) csak 5. szinten jelenik meg
                    if (this.level < 5) pool = pool.filter(n => !/\.[a-z0-9]+$/i.test(n));
                    base = pick(pool.length ? pool : FILE_NAMES[ext]);
                } else {
                    base = pick(FILE_NAMES[ext]);
                }
                list.push({ id: 'c' + (++this.uid), base, ext, tricky });
            }
            return shuffle(list);
        }

        render() {
            const cfg = this.cfg;
            this.shell.body.innerHTML =
                '<div class="fkg1">' +
                    '<div class="fkg1-beltwrap">' +
                        '<div class="fkg1-belt-label"><span>📦 Érkező fájlok</span><span>Ne hagyd leesni! ⚠️</span></div>' +
                        '<div class="fkg1-belt" aria-label="Futószalag"></div>' +
                    '</div>' +
                    '<p class="fkg1-tip">Húzd a fájlt a megfelelő feldolgozó állomásra – vagy koppints a fájlra, aztán az állomásra!</p>' +
                    '<div class="fkg1-stations">' + cfg.stations.map(key => {
                        const st = STATIONS[key];
                        const exts = st.exts.filter(e => cfg.exts.includes(e));
                        return '<button type="button" class="fkg1-station" data-station="' + key + '" style="--st-color:' + st.color + '">' +
                            '<span class="fkg1-station-icon" aria-hidden="true">' + st.icon + '</span>' +
                            '<span class="fkg1-station-name">' + escapeHtml(st.name) + '</span>' +
                            (cfg.showExts ? '<span class="fkg1-station-exts">' + exts.join(' ') + '</span>' : '') +
                            '<span class="fkg1-station-count" data-count></span>' +
                        '</button>';
                    }).join('') + '</div>' +
                '</div>';
            this.belt = this.shell.body.querySelector('.fkg1-belt');
            this.stationsEl = this.shell.body.querySelector('.fkg1-stations');
            this.stationCounts = {};
            this.stationsEl.addEventListener('click', ev => {
                const st = ev.target.closest('[data-station]');
                if (!st) return;
                if (!this.selectedId) {
                    this.shell.feedback('Előbb válassz egy fájlt a szalagról! 👆', 'info');
                    return;
                }
                const card = this.cards.find(c => c.id === this.selectedId);
                if (card) this.evaluate(card, st.dataset.station);
            });
            this.belt.addEventListener('pointerdown', ev => this.onCardDown(ev));
        }

        spawn() {
            const file = this.queue.shift();
            const el = document.createElement('div');
            el.className = 'fkg1-card';
            el.dataset.id = file.id;
            el.innerHTML = fileIconHtml(file.ext, 46) +
                '<span class="fkg1-name">' + escapeHtml(file.base) + '<b>' + escapeHtml(file.ext) + '</b></span>';
            el.setAttribute('role', 'button');
            el.setAttribute('aria-label', 'Fájl: ' + file.base + file.ext);
            this.belt.appendChild(el);
            const card = Object.assign({}, file, { el, progress: 0, dragging: false, done: false });
            this.cards.push(card);
        }

        tick(time) {
            if (!this.running) return;
            this.raf = requestAnimationFrame(t => this.tick(t));
            const visible = this.belt && this.belt.isConnected && this.belt.offsetParent !== null && !document.hidden;
            const overlay = this.shell.root.querySelector('.fkg-overlay') || document.querySelector('.fk-celebrate');
            const frozen = this.paused || !visible || !!overlay;
            this.belt.classList.toggle('is-paused', frozen);
            if (this.lastFrame === null) this.lastFrame = time;
            const dt = Math.min(100, time - this.lastFrame);
            this.lastFrame = time;
            if (frozen) return;

            this.lastSpawn = this.lastSpawn === -Infinity ? time - this.cfg.gap : this.lastSpawn;
            const active = this.cards.filter(c => !c.done).length;
            if (this.queue.length && active < this.cfg.maxOnBelt && time - this.lastSpawn >= this.cfg.gap) {
                this.spawn();
                this.lastSpawn = time;
            }

            const width = this.belt.clientWidth;
            this.cards.forEach(card => {
                if (card.done || card.dragging) return;
                card.progress += dt / this.cfg.travel;
                const cw = card.el.offsetWidth;
                const maxX = width - cw - 46;
                card.el.style.left = Math.round(Math.min(1, card.progress) * maxX) + 'px';
                if (card.progress >= 1) this.miss(card);
            });

            if (!this.queue.length && this.cards.every(c => c.done) && this.running) {
                this.endRound();
            }
        }

        togglePause(btn) {
            this.paused = !this.paused;
            btn.textContent = this.paused ? '▶' : '⏸';
            btn.title = this.paused ? 'Folytatás' : 'Szünet';
            this.shell.feedback(this.paused ? '⏸ Szünet' : '▶ Folytatjuk!', 'info');
        }

        // ---------- Pointer Events: húzás és koppintás ----------
        onCardDown(ev) {
            const el = ev.target.closest('.fkg1-card');
            if (!el || (ev.button !== undefined && ev.button > 0)) return;
            const card = this.cards.find(c => c.id === el.dataset.id && !c.done);
            if (!card) return;
            ev.preventDefault();
            this.drag = { card, startX: ev.clientX, startY: ev.clientY, pointerId: ev.pointerId, active: false, hoverEl: null };
            window.addEventListener('pointermove', this.onWindowMove);
            window.addEventListener('pointerup', this.onWindowUp);
            window.addEventListener('pointercancel', this.onWindowUp);
        }

        onDragMove(ev) {
            const d = this.drag;
            if (!d || ev.pointerId !== d.pointerId) return;
            const dist = Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY);
            if (!d.active) {
                if (dist < 8) return;
                d.active = true;
                d.card.dragging = true;
                // Biti szövegbuboréka ne takarja el az állomásokat húzás közben (tableten fontos)
                if (FK.Biti && typeof FK.Biti.hideBubble === 'function') FK.Biti.hideBubble();
                d.card.el.classList.add('is-dragging');
                this.select(d.card.id);
            }
            d.card.el.style.left = ev.clientX + 'px';
            d.card.el.style.top = ev.clientY + 'px';
            // elementsFromPoint: a húzott kártya vagy más lebegő elem alatt is megtaláljuk az állomást
            const st = document.elementsFromPoint(ev.clientX, ev.clientY)
                .map(el => el.closest('.fkg1-station'))
                .find(el => el && this.stationsEl.contains(el)) || null;
            if (d.hoverEl && d.hoverEl !== st) d.hoverEl.classList.remove('is-hover');
            if (st) st.classList.add('is-hover');
            d.hoverEl = st;
        }

        onDragEnd(ev) {
            const d = this.drag;
            if (!d || ev.pointerId !== d.pointerId) return;
            window.removeEventListener('pointermove', this.onWindowMove);
            window.removeEventListener('pointerup', this.onWindowUp);
            window.removeEventListener('pointercancel', this.onWindowUp);
            this.drag = null;
            if (d.hoverEl) d.hoverEl.classList.remove('is-hover');
            if (!d.active) {
                // Koppintás: kijelölés (vagy kijelölés megszüntetése)
                this.select(this.selectedId === d.card.id ? null : d.card.id);
                return;
            }
            const card = d.card;
            this.returnToBelt(card);
            if (d.hoverEl && ev.type !== 'pointercancel') {
                this.evaluate(card, d.hoverEl.dataset.station);
            }
        }

        returnToBelt(card) {
            card.dragging = false;
            card.el.classList.remove('is-dragging');
            card.el.style.top = '';
            const maxX = this.belt.clientWidth - card.el.offsetWidth - 46;
            card.el.style.left = Math.round(Math.min(1, card.progress) * maxX) + 'px';
        }

        select(id) {
            this.selectedId = id;
            this.cards.forEach(c => c.el.classList.toggle('is-selected', c.id === id));
        }

        // ---------- Kiértékelés ----------
        evaluate(card, stationKey) {
            if (card.done) return;
            const stEl = this.stationsEl.querySelector('[data-station="' + stationKey + '"]');
            const correctKey = stationForExt(card.ext);
            if (STATIONS[stationKey].exts.includes(card.ext)) {
                card.done = true;
                this.sorted++;
                this.select(null);
                card.el.classList.add('is-sorted');
                setTimeout(() => card.el.remove(), 380);
                this.flashStation(stEl, 'is-ok');
                this.stationCounts[stationKey] = (this.stationCounts[stationKey] || 0) + 1;
                stEl.querySelector('[data-count]').textContent = '✔ ' + this.stationCounts[stationKey];
                this.shell.feedback(card.tricky ? '🕵️ Nem hagytad magad becsapni!' : pick(['✔ Szuper!', '✔ Pontosan!', '✔ Ügyes!', '✔ Telitalálat!']), 'ok');
            } else {
                this.errors++;
                this.shell.setErrors(this.errors);
                this.flashStation(stEl, 'is-bad');
                card.el.classList.remove('is-wrong');
                void card.el.offsetWidth;
                card.el.classList.add('is-wrong');
                const name = card.base + card.ext;
                const hint = card.tricky
                    ? 'A(z) „' + name + '” neve becsapós! Nézd az utolsó pont utáni részt: ' + card.ext + ' = ' + EXT_INFO[card.ext] + ' → ' + STATIONS[correctKey].name + '.'
                    : 'A(z) ' + card.ext + ' kiterjesztés jelentése: ' + EXT_INFO[card.ext] + '. Ez a(z) ' + STATIONS[correctKey].name + ' állomásra való!';
                this.ctx.error(hint);
                this.shell.feedback('✖ Nem ide való!', 'bad');
                if (card.ext === '.exe' && /\.[a-z0-9]+$/i.test(card.base)) {
                    setTimeout(() => say('Vigyázz! A „' + name + '” képnek vagy zenének álcázott PROGRAM. Az ilyen fájlok veszélyesek lehetnek! 🛡️', 'think'), 300);
                }
            }
            this.updateProgress();
        }

        miss(card) {
            card.done = true;
            this.missed++;
            this.errors++;
            this.shell.setErrors(this.errors);
            if (this.selectedId === card.id) this.select(null);
            card.el.classList.add('is-falling');
            setTimeout(() => card.el.remove(), 520);
            const correctKey = stationForExt(card.ext);
            this.ctx.error('Leesett a(z) „' + card.base + card.ext + '” a szalagról! A(z) ' + card.ext + ' fájlok helye: ' + STATIONS[correctKey].name + '.');
            this.shell.feedback('💥 Leesett egy fájl!', 'bad');
            this.updateProgress();
        }

        flashStation(el, cls) {
            if (!el) return;
            el.classList.remove('is-ok', 'is-bad');
            void el.offsetWidth;
            el.classList.add(cls);
            setTimeout(() => el.classList.remove(cls), 600);
        }

        updateProgress() {
            this.shell.setProgress('📦 ' + (this.sorted + this.missed) + ' / ' + this.total);
        }

        hint() {
            const card = this.cards.filter(c => !c.done).sort((a, b) => b.progress - a.progress)[0];
            if (!card) return 'Figyeld a szalagot, mindjárt jön a következő fájl!';
            const key = stationForExt(card.ext);
            this.stationsEl.querySelectorAll('.is-target').forEach(e => e.classList.remove('is-target'));
            const stEl = this.stationsEl.querySelector('[data-station="' + key + '"]');
            if (stEl) {
                stEl.classList.add('is-target');
                setTimeout(() => stEl.classList.remove('is-target'), 4000);
            }
            return 'A(z) „' + card.base + card.ext + '” kiterjesztése ' + card.ext + ' – ez ' + EXT_INFO[card.ext] + '. Vidd a(z) ' + STATIONS[key].name + ' állomásra!';
        }

        endRound() {
            this.running = false;
            cancelAnimationFrame(this.raf);
            const success = this.errors <= Math.floor(this.total / 2);
            finishRound(this.ctx, this.shell, {
                success,
                errors: this.errors,
                lines: [
                    '📦 Helyesen válogatva: ' + this.sorted + ' / ' + this.total,
                    '❌ Hibák: ' + this.errors + (this.missed ? ' (ebből leesett: ' + this.missed + ')' : '')
                ],
                onNext: () => this.startRound()
            });
        }

        destroy() {
            this.running = false;
            this.shell.alive = false;
            cancelAnimationFrame(this.raf);
            window.removeEventListener('pointermove', this.onWindowMove);
            window.removeEventListener('pointerup', this.onWindowUp);
            window.removeEventListener('pointercancel', this.onWindowUp);
            this.cards.forEach(c => c.el.remove());
        }
    }

    // ======================================================================
    // 2. JÁTÉK – ÚTVONAL-LABIRINTUS
    // ======================================================================
    const PATH_POOLS = [
        ['Suli', 'Dokumentumok', 'Projektek', 'Iskola'],
        ['4_osztaly', '5_osztaly', '6_osztaly', '7_osztaly'],
        ['Matematika', 'Magyar', 'Természetismeret', 'Angol', 'Történelem', 'Rajz', 'Ének'],
        ['Erdő', 'Víz', 'Állatok', 'Növények', 'Törtek', 'Versek', 'Mesék', 'Térképek'],
        ['Tavasz', 'Nyár', 'Ősz', 'Tél', 'Gyakorlás', 'Témazáró']
    ];

    const ROOT_DISTRACTORS = ['Játékok', 'Zenék', 'Fotók', 'Letöltések', 'Program Files'];
    const FILLER_FILES = ['jegyzet.txt', 'rajz.png', 'feladatlap.docx', 'dal.mp3', 'kép.jpg', 'lista.txt', 'bemutató.pptx'];
    const NEW_FOLDER_NAMES = ['Házi_feladat', 'Projekt', 'Kirándulás', 'Rajzok', 'Jegyzetek', 'Gyűjtemény', 'Kísérletek'];

    const G2_LEVELS = {
        1: { depth: 2, siblings: 2, decoys: 0, sidebar: true,  startDeep: false, createChance: 0.35 },
        2: { depth: 3, siblings: 2, decoys: 0, sidebar: true,  startDeep: false, createChance: 0.45 },
        3: { depth: 4, siblings: 3, decoys: 1, sidebar: true,  startDeep: false, createChance: 0.5 },
        4: { depth: 4, siblings: 3, decoys: 2, sidebar: false, startDeep: true,  createChance: 0.5 },
        5: { depth: 5, siblings: 3, decoys: 3, sidebar: false, startDeep: true,  createChance: 0.5 }
    };

    function similarName(name) {
        const variants = [name + '_régi', name + '_másolat', name + '2', name + '_vázlat', name.replace(/_/g, '-'), name + 'k'];
        return pick(variants.filter(v => v !== name));
    }

    class PathMaze {
        constructor(container, ctx) {
            this.ctx = ctx;
            this.shell = createShell(container, ctx, { title: 'Útvonal-labirintus', icon: '🧭' });
            this.explorer = null;
            this.missionDone = false;
            ctx.setHint(() => this.hint());
            this.startRound();
        }

        startRound() {
            const level = this.ctx.level;
            this.level = level;
            this.cfg = G2_LEVELS[level] || G2_LEVELS[1];
            this.ctx.newTask();
            this.errors = 0;
            this.missionDone = false;
            this.decoyVisited = new Set();
            this.wrongPlaceIds = new Set();
            this.shell.setLevel(level);
            this.shell.setErrors(0);
            this.buildWorld();
            // Ha csali mappában indulunk, a visszafelé (felfelé) lépés közben érintett csalik nem számítanak hibának
            for (let id = this.startId; id && id !== 'root'; id = (this.vfs.get(id) || {}).parentId) {
                if (this.decoyIds.has(id)) this.decoyVisited.add(id);
            }
            this.render();
        }

        buildWorld() {
            const cfg = this.cfg;
            const vfs = FK.VFS.createEmpty();
            this.vfs = vfs;
            this.pathIds = [];
            this.decoyIds = new Set();
            this.deepDecoyId = null;
            const decoyDepths = new Set(sample([...Array(cfg.depth).keys()].filter(d => d >= 1), cfg.decoys));
            if (cfg.decoys > 0 && decoyDepths.size === 0) decoyDepths.add(Math.min(1, cfg.depth - 1));

            // Gyökérszintű zavaró mappák
            vfs.build('root', sample(ROOT_DISTRACTORS, 2).map(n => ({ name: n, children: [{ name: pick(FILLER_FILES) }] })));

            let parentId = 'root';
            for (let d = 0; d < cfg.depth; d++) {
                const pool = PATH_POOLS[d] || PATH_POOLS[PATH_POOLS.length - 1];
                const existing = vfs.children(parentId).map(n => n.name);
                const chosen = pick(pool.filter(n => !existing.includes(n)));
                const siblings = sample(pool.filter(n => n !== chosen && !existing.includes(n)), cfg.siblings);
                const [main] = vfs.build(parentId, [{ name: chosen, type: 'folder' }]);
                this.pathIds.push(main.id);

                siblings.forEach(name => {
                    const nextPool = PATH_POOLS[d + 1] || ['Régi', 'Archív'];
                    vfs.build(parentId, [{
                        name,
                        children: sample(nextPool, 1 + Math.floor(Math.random() * 2)).map(n => ({ name: n, children: [{ name: pick(FILLER_FILES) }] }))
                            .concat([{ name: pick(FILLER_FILES) }])
                    }]);
                });

                if (decoyDepths.has(d)) {
                    let decoyName = similarName(chosen);
                    while (vfs.nameTaken(parentId, decoyName)) decoyName = similarName(chosen) + '_' + Math.floor(Math.random() * 9 + 1);
                    const nextPool = PATH_POOLS[d + 1] || ['Régi'];
                    const [decoy] = vfs.build(parentId, [{
                        name: decoyName,
                        children: sample(nextPool, 2).map(n => ({ name: n, children: [{ name: 'Üres_láda.txt', content: 'Ez a láda üres… A kincs nem itt van! 🙃' }] }))
                            .concat([{ name: 'Üres_láda.txt', content: 'Ez csak egy csali mappa! 🙃' }])
                    }]);
                    this.decoyIds.add(decoy.id);
                    if (!this.deepDecoyId) {
                        const deeper = vfs.subfolders(decoy.id)[0];
                        this.deepDecoyId = deeper ? deeper.id : decoy.id;
                    }
                }

                if (d < cfg.depth - 1 && Math.random() < 0.6) vfs.build(main.id, [{ name: pick(FILLER_FILES) }]);
                parentId = main.id;
            }

            // Ha nincs csali, a mély kezdőpont egy testvérág mélye legyen
            if (cfg.startDeep && !this.deepDecoyId) {
                const firstLevel = vfs.subfolders('root').filter(n => n.id !== this.pathIds[0]);
                const branch = firstLevel[0];
                const deeper = branch ? vfs.subfolders(branch.id)[0] : null;
                this.deepDecoyId = deeper ? deeper.id : (branch ? branch.id : 'root');
            }

            this.targetId = this.pathIds[this.pathIds.length - 1];
            this.mode = Math.random() < cfg.createChance ? 'create' : 'find';
            if (this.mode === 'find') {
                const [treasure] = vfs.build(this.targetId, [{ name: 'Kincs.png', content: '💎' }]);
                this.treasureId = treasure.id;
                vfs.build(this.targetId, [{ name: pick(FILLER_FILES.filter(f => f !== 'kép.jpg')) }]);
            } else {
                const taken = vfs.children(this.targetId).map(n => normalizeName(n.name));
                this.newName = pick(NEW_FOLDER_NAMES.filter(n => !taken.includes(normalizeName(n))));
                this.treasureId = null;
            }
            vfs.undoStack = [];
            this.startId = this.cfg.startDeep && this.deepDecoyId ? this.deepDecoyId : 'root';
        }

        render() {
            if (this.explorer) {
                this.explorer.destroy();
                this.explorer = null;
            }
            const targetPath = this.vfs.getPath(this.targetId);
            let text;
            if (this.mode === 'find') {
                text = 'Keresd meg az elrejtett kincset itt: <span class="fkg2-path">' + escapeHtml(targetPath) + '</span><br>' +
                       'Ha odaértél, nyisd meg a <b>Kincs.png</b> fájlt dupla kattintással (vagy dupla koppintással)!';
            } else {
                text = 'Hozd létre a hiányzó <b>' + escapeHtml(this.newName) + '</b> mappát itt: <span class="fkg2-path">' + escapeHtml(targetPath) + '</span><br>' +
                       'Használd az <b>Új mappa</b> gombot, és írd be pontosan a nevet!';
            }
            if (this.startId !== 'root') text += '<br>⚠️ Most rossz helyen állsz – először lépj vissza a <b>↑</b> gombbal!';

            this.shell.body.innerHTML =
                '<div class="fkg2">' +
                    '<div class="fkg2-mission">' +
                        '<span class="fkg2-mission-icon" aria-hidden="true">' + (this.mode === 'find' ? '💎' : '📁') + '</span>' +
                        '<div class="fkg2-mission-text">' + text + '</div>' +
                        '<div class="fkg2-where">🧭 Itt vagy most: <code data-where></code></div>' +
                    '</div>' +
                    '<div class="fkg2-explorer"></div>' +
                '</div>';
            this.whereEl = this.shell.body.querySelector('[data-where]');
            this.shell.setProgress(this.mode === 'find' ? '💎 Kincskeresés' : '📁 Mappaépítés');

            const disabled = ['delete', 'deletePermanent', 'emptyBin', 'cut', 'copy', 'paste', 'move', 'restore'];
            if (this.mode === 'find') disabled.push('newFolder', 'rename');

            this.explorer = new FK.Explorer(this.shell.body.querySelector('.fkg2-explorer'), {
                vfs: this.vfs,
                startId: this.startId,
                showSidebar: this.cfg.sidebar,
                showDock: false,
                windowPreview: false,
                disabledActions: disabled,
                hooks: {
                    onNavigate: e => this.onNavigate(e),
                    onFileOpened: e => this.onFileOpened(e),
                    onFolderCreated: e => this.onFolderCreated(e),
                    onFileRenamed: e => this.onFileRenamed(e)
                }
            });
            this.updateWhere();
            if (this.level >= 4) {
                say('Ezen a szinten nincs mappafa! Használd a ↑ (feljebb) gombot és a címsort. Figyelj a hasonló nevű csali mappákra! 🕵️', 'think');
            } else if (this.level === 1) {
                say('Nyisd meg a mappákat dupla kattintással, egymás után, ahogy az útvonalban látod! 🧭', 'happy');
            }
        }

        updateWhere() {
            if (this.whereEl && this.explorer) this.whereEl.textContent = this.vfs.getPath(this.explorer.currentId);
        }

        onNavigate(e) {
            this.updateWhere();
            if (this.missionDone) return;
            if (this.decoyIds.has(e.id) && !this.decoyVisited.has(e.id)) {
                this.decoyVisited.add(e.id);
                this.addError('Ez a(z) „' + this.vfs.displayName(e.id) + '” mappa csak egy hasonló nevű csali! Olvasd el figyelmesen az útvonalat, és lépj vissza a ↑ gombbal!');
                return;
            }
            const idx = this.pathIds.indexOf(e.id);
            if (idx >= 0) this.shell.feedback(idx === this.pathIds.length - 1 ? '🎯 Megérkeztél!' : '👣 Jó irány!', 'ok');
        }

        onFileOpened(e) {
            if (this.missionDone || this.mode !== 'find') return;
            if (e.node.id === this.treasureId) {
                this.complete();
            } else if (/^Üres_láda/i.test(e.node.name)) {
                this.addError('Ez csak egy üres láda egy csali mappában! A kincs ezen az úton van: ' + this.vfs.getPath(this.targetId));
            }
        }

        nameMatches(name) {
            return normalizeName(name) === normalizeName(this.newName);
        }

        onFolderCreated(e) {
            if (this.missionDone || this.mode !== 'create') return;
            if (e.node.parentId === this.targetId) {
                if (this.nameMatches(e.node.name)) {
                    this.complete();
                } else {
                    this.addError('Jó helyen vagy, de a mappa neve legyen pontosan: „' + this.newName + '”. Jelöld ki, és nevezd át az F2 gombbal!');
                }
            } else {
                this.wrongPlaceIds.add(e.node.id);
                this.addError('Ezt a mappát rossz helyen hoztad létre (' + e.path + '). A helyes hely: ' + this.vfs.getPath(this.targetId));
            }
        }

        onFileRenamed(e) {
            if (this.missionDone || this.mode !== 'create') return;
            if (e.node.type === 'folder' && e.node.parentId === this.targetId && this.nameMatches(e.node.name)) {
                this.complete();
            }
        }

        addError(hint) {
            this.errors++;
            this.shell.setErrors(this.errors);
            this.shell.feedback('✖ Hoppá!', 'bad');
            this.ctx.error(hint);
        }

        complete() {
            this.missionDone = true;
            this.shell.feedback(this.mode === 'find' ? '💎 Megtaláltad a kincset!' : '📁 Kész a mappa!', 'ok');
            const steps = this.pathIds.length;
            setTimeout(() => {
                if (!this.shell.alive) return;
                finishRound(this.ctx, this.shell, {
                    success: true,
                    errors: this.errors,
                    lines: [
                        (this.mode === 'find' ? '💎 Kincs megtalálva: ' : '📁 Mappa létrehozva: ') + this.vfs.getPath(this.targetId),
                        '🪜 Mappamélység: ' + steps,
                        '❌ Hibák: ' + this.errors
                    ],
                    onNext: () => this.startRound()
                });
            }, 900);
        }

        hint() {
            if (!this.explorer || this.missionDone) return null;
            const cur = this.explorer.currentId;
            if (cur === this.targetId) {
                if (this.mode === 'find') {
                    if (this.treasureId) this.explorer.flash(this.treasureId);
                    return 'Itt vagy! Kattints duplán a Kincs.png fájlra!';
                }
                return 'Itt vagy! Kattints az „Új mappa” gombra, és írd be: ' + this.newName;
            }
            if (cur === 'root' || this.vfs.isAncestor(cur, this.targetId)) {
                const next = this.pathIds.find(id => this.vfs.get(id).parentId === cur);
                if (next) {
                    this.explorer.flash(next);
                    return 'Jó úton jársz! Most nyisd meg a(z) „' + this.vfs.displayName(next) + '” mappát.';
                }
            }
            return 'Ez nem a jó irány. Lépj vissza a szülőmappába a ↑ gombbal, és nézd meg újra az útvonalat!';
        }

        destroy() {
            this.shell.alive = false;
            if (this.explorer) this.explorer.destroy();
            this.explorer = null;
        }
    }

    // ======================================================================
    // 3. JÁTÉK – BILLENTYŰPARANCS-NINDZSA
    // ======================================================================
    const NINJA_ACTIONS = {
        copy:   { combo: 'Ctrl+C', keys: ['Ctrl', 'C'], label: 'Másolás',     prompts: ['Másold le a kijelölt fájlt!', 'Tedd a kijelölt fájl másolatát a vágólapra!'], tip: 'Másolás = Copy (angolul) → Ctrl + C' },
        cut:    { combo: 'Ctrl+X', keys: ['Ctrl', 'X'], label: 'Kivágás',     prompts: ['Vágd ki a kijelölt fájlt!', 'Vágd ki a fájlt, hogy máshová vihesd!'], tip: 'Kivágás: az X olyan, mint egy nyitott olló ✂️ → Ctrl + X' },
        paste:  { combo: 'Ctrl+V', keys: ['Ctrl', 'V'], label: 'Beillesztés', prompts: ['Illeszd be ide a vágólapon lévő fájlt!', 'Tedd be ebbe a mappába, ami a vágólapon van!'], tip: 'Beillesztés: a V rögtön a C mellett van → Ctrl + V' },
        rename: { combo: 'F2',     keys: ['F2'],        label: 'Átnevezés',   prompts: ['Nevezd át a kijelölt fájlt gyorsbillentyűvel!', 'Adj új nevet a kijelölt fájlnak!'], tip: 'Átnevezés: F2 – a billentyűzet legfelső sorában' },
        delete: { combo: 'Delete', keys: ['Delete'],    label: 'Törlés',      prompts: ['Töröld a kijelölt fájlt!', 'Ez a fájl már nem kell. Dobd a Lomtárba!'], tip: 'Törlés: Delete (Del) billentyű' },
        undo:   { combo: 'Ctrl+Z', keys: ['Ctrl', 'Z'], label: 'Visszavonás', prompts: ['Hoppá, ez véletlen volt! Vond vissza az utolsó műveletet!', 'Ez nem jó így! Csináld vissza!'], tip: 'Visszavonás: Ctrl + Z – a Z az X mellett, bal oldalt' }
    };

    const NINJA_SEQUENCES = [
        { title: 'Helyezd át a fájlt a Képek mappába!', steps: ['cut', 'paste'] },
        { title: 'Készíts másolatot a fájlról a Képek mappába!', steps: ['copy', 'paste'] },
        { title: 'Töröld a fájlt, aztán gondold meg magad, és hozd vissza!', steps: ['delete', 'undo'] },
        { title: 'Másold le, illeszd be a Képek mappába, és nevezd át!', steps: ['copy', 'paste', 'rename'] },
        { title: 'Vágd ki, illeszd be a Képek mappába, aztán vond vissza!', steps: ['cut', 'paste', 'undo'] },
        { title: 'Nevezd át a fájlt, majd töröld!', steps: ['rename', 'delete'] }
    ];

    const G3_LEVELS = {
        1: { count: 4, actions: ['copy', 'paste', 'delete', 'rename'], help: 'biti', timer: 0, sequences: false, strictCtrl: false },
        2: { count: 5, actions: ['copy', 'paste', 'cut', 'delete', 'rename', 'undo'], help: 'card', timer: 0, sequences: false, strictCtrl: false },
        3: { count: 6, actions: ['copy', 'paste', 'cut', 'delete', 'rename', 'undo'], help: 'none', timer: 0, sequences: false, strictCtrl: false },
        4: { count: 6, actions: ['copy', 'paste', 'cut', 'delete', 'rename', 'undo'], help: 'none', timer: 9, sequences: false, strictCtrl: true },
        5: { count: 4, actions: ['copy', 'paste', 'cut', 'delete', 'rename', 'undo'], help: 'none', timer: 0, stepTime: 5, sequences: true, strictCtrl: true }
    };

    const NINJA_FILES = [
        { name: 'nyaralas', ext: '.jpg' }, { name: 'fogalmazas', ext: '.docx' }, { name: 'kedvenc_dal', ext: '.mp3' },
        { name: 'jegyzet', ext: '.txt' }, { name: 'rajzom', ext: '.png' }, { name: 'bemutato', ext: '.pptx' }
    ];

    class ShortcutNinja {
        constructor(container, ctx) {
            this.ctx = ctx;
            this.shell = createShell(container, ctx, { title: 'Billentyűparancs-nindzsa', icon: '🥷' });
            this.dockCtrl = false;
            this.physicalCtrl = false;
            this.timer = null;
            this.locked = false;
            this.onKeyDown = ev => this.handleKeyDown(ev);
            this.onKeyUp = ev => this.handleKeyUp(ev);
            document.addEventListener('keydown', this.onKeyDown, true);
            document.addEventListener('keyup', this.onKeyUp, true);
            ctx.setHint(() => this.hint());
            this.startRound();
        }

        startRound() {
            const level = this.ctx.level;
            this.level = level;
            this.cfg = G3_LEVELS[level] || G3_LEVELS[1];
            this.ctx.newTask();
            this.errors = 0;
            this.done = 0;
            this.challenges = this.buildChallenges();
            this.index = -1;
            this.shell.setLevel(level);
            this.shell.setErrors(0);
            this.renderFrame();
            this.nextChallenge();
        }

        buildChallenges() {
            const cfg = this.cfg;
            if (cfg.sequences) {
                return sample(NINJA_SEQUENCES, cfg.count).map(s => ({ title: s.title, steps: s.steps.slice() }));
            }
            const list = [];
            let pool = [];
            while (list.length < cfg.count) {
                if (!pool.length) pool = shuffle(cfg.actions);
                const a = pool.shift();
                if (list.length && list[list.length - 1].steps[0] === a) continue;
                list.push({ title: pick(NINJA_ACTIONS[a].prompts), steps: [a] });
            }
            return list;
        }

        renderFrame() {
            this.shell.body.innerHTML =
                '<div class="fkg3">' +
                    '<div class="fkg3-challenge" aria-live="polite"></div>' +
                    '<div class="fkg3-stage">' +
                        '<div class="fkg3-window">' +
                            '<div class="fkg3-wtitle"><span data-folder-icon>📁</span><span data-folder>Dokumentumok</span></div>' +
                            '<div class="fkg3-files"></div>' +
                        '</div>' +
                        '<div class="fkg3-side">' +
                            '<div class="fkg3-tray"><span class="fkg3-tray-icon" aria-hidden="true">📋</span><span data-tray>A vágólap üres</span></div>' +
                            '<div class="fkg3-bin"><span class="fkg3-bin-icon" aria-hidden="true">🗑️</span><span data-bin>Lomtár</span></div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="fkg3-dock" role="toolbar" aria-label="Gyorsbillentyű-dokkoló">' +
                        '<span class="fkg3-dock-label">Billentyűk:</span>' +
                        '<button type="button" class="fkg3-key fkg3-key-ctrl" data-k="ctrl" aria-pressed="false" title="Ctrl – egy koppintással bekapcsolva marad">Ctrl</button>' +
                        '<button type="button" class="fkg3-key" data-k="c">C</button>' +
                        '<button type="button" class="fkg3-key" data-k="x">X</button>' +
                        '<button type="button" class="fkg3-key" data-k="v">V</button>' +
                        '<button type="button" class="fkg3-key" data-k="z">Z</button>' +
                        '<button type="button" class="fkg3-key fkg3-key-wide" data-k="delete">Delete</button>' +
                        '<button type="button" class="fkg3-key" data-k="f2">F2</button>' +
                    '</div>' +
                '</div>';
            this.challengeEl = this.shell.body.querySelector('.fkg3-challenge');
            this.filesEl = this.shell.body.querySelector('.fkg3-files');
            this.dockEl = this.shell.body.querySelector('.fkg3-dock');
            this.dockEl.addEventListener('click', ev => {
                const btn = ev.target.closest('[data-k]');
                if (btn) this.pressDock(btn.dataset.k, btn);
            });
            this.renderDock();
        }

        // ---------- Jelenet (szimulált mappa) ----------
        setupScene(challenge) {
            const files = sample(NINJA_FILES, 4).map((f, i) => ({ id: 'f' + i + '_' + Date.now(), name: f.name, ext: f.ext, state: '' }));
            this.scene = {
                folder: 'Dokumentumok',
                files,
                selectedId: files[0].id,
                clipboard: null,
                bin: [],
                history: []
            };
            const first = challenge.steps[0];
            if (first === 'paste') {
                // A vágólapon már van valami, és egy másik mappában vagyunk
                const src = files.splice(0, 1)[0];
                this.scene.clipboard = { mode: 'copy', file: src };
                this.scene.folder = 'Képek';
                this.scene.selectedId = null;
            } else if (first === 'undo') {
                // Egy „véletlen” művelet, amit vissza kell vonni
                const victim = files[0];
                this.scene.history.push({ type: 'delete', file: Object.assign({}, victim), index: 0 });
                files.splice(0, 1);
                this.scene.bin.push(victim);
                this.scene.selectedId = files[0] ? files[0].id : null;
                this.scene.oops = 'Véletlenül törölted: ' + victim.name + victim.ext + '!';
            }
            this.renderScene();
        }

        renderScene(effect) {
            const s = this.scene;
            this.shell.body.querySelector('[data-folder]').textContent = s.folder + (s.oops ? ' – ' + s.oops : '');
            this.filesEl.innerHTML = s.files.map(f =>
                '<div class="fkg3-tile' + (f.id === s.selectedId ? ' is-selected' : '') + (f.state ? ' ' + f.state : '') + '" data-fid="' + f.id + '">' +
                    fileIconHtml(f.ext, 46) +
                    '<span class="fkg3-tile-name' + (f.editing ? ' is-editing' : '') + '">' + escapeHtml(f.name + f.ext) + '</span>' +
                '</div>'
            ).join('') || '<div style="grid-column:1/-1;text-align:center;color:#94a3b8;font-weight:800;padding:2rem">Ez a mappa üres.</div>';
            const tray = this.shell.body.querySelector('.fkg3-tray');
            tray.classList.toggle('is-full', !!s.clipboard);
            this.shell.body.querySelector('[data-tray]').textContent = s.clipboard
                ? (s.clipboard.mode === 'cut' ? '✂️ Kivágva: ' : '📋 Másolva: ') + s.clipboard.file.name + s.clipboard.file.ext
                : 'A vágólap üres';
            const bin = this.shell.body.querySelector('.fkg3-bin');
            bin.classList.toggle('is-full', s.bin.length > 0);
            this.shell.body.querySelector('[data-bin]').textContent = s.bin.length ? 'Lomtár (' + s.bin.length + ')' : 'Lomtár (üres)';
            if (effect) setTimeout(() => {
                this.filesEl.querySelectorAll('.is-new').forEach(e => e.classList.remove('is-new'));
                this.scene.files.forEach(f => { if (f.state === 'is-new') f.state = ''; });
            }, 600);
        }

        /** A helyes művelet látható hatása a jelenetben. */
        applyAction(action) {
            const s = this.scene;
            const sel = s.files.find(f => f.id === s.selectedId);
            s.oops = null;
            switch (action) {
                case 'copy':
                    if (sel) s.clipboard = { mode: 'copy', file: Object.assign({}, sel) };
                    break;
                case 'cut':
                    if (sel) {
                        s.clipboard = { mode: 'cut', file: Object.assign({}, sel) };
                        sel.state = 'is-cut';
                    }
                    // Összetett sorozatban a kivágás után átlépünk a célmappába
                    if (this.current.steps.length > 1) {
                        setTimeout(() => {
                            if (!this.shell.alive || !this.scene) return;
                            s.history.push({ type: 'cut-origin', files: s.files.slice(), folder: s.folder });
                            s.files = s.files.filter(f => f.state !== 'is-cut');
                            s.folder = 'Képek';
                            s.selectedId = null;
                            this.renderScene();
                        }, 450);
                    }
                    break;
                case 'paste': {
                    if (!s.clipboard) break;
                    if (this.current.steps.length > 1 && s.folder !== 'Képek' && s.clipboard.mode === 'copy') {
                        s.folder = 'Képek';
                        s.files = sample(NINJA_FILES.filter(f => f.name !== s.clipboard.file.name), 2).map((f, i) => ({ id: 'k' + i + Date.now(), name: f.name, ext: f.ext, state: '' }));
                    }
                    const copy = { id: 'p' + Date.now(), name: s.clipboard.file.name, ext: s.clipboard.file.ext, state: 'is-new' };
                    s.files.push(copy);
                    s.history.push({ type: 'paste', id: copy.id });
                    s.selectedId = copy.id;
                    if (s.clipboard.mode === 'cut') s.clipboard = null;
                    break;
                }
                case 'rename':
                    if (sel) {
                        sel.editing = true;
                        const old = sel.name;
                        setTimeout(() => {
                            if (!this.shell.alive || !this.scene) return;
                            sel.editing = false;
                            sel.name = pick(['uj_nev', 'atnevezve', 'vegleges', 'kesz_munka']);
                            sel.state = 'is-new';
                            s.history.push({ type: 'rename', id: sel.id, old });
                            this.renderScene(true);
                        }, 650);
                    }
                    break;
                case 'delete':
                    if (sel) {
                        const index = s.files.indexOf(sel);
                        s.files = s.files.filter(f => f !== sel);
                        s.bin.push(sel);
                        s.history.push({ type: 'delete', file: sel, index });
                        s.selectedId = s.files[0] ? s.files[0].id : null;
                    }
                    break;
                case 'undo': {
                    const last = s.history.pop();
                    if (last && last.type === 'delete') {
                        s.bin = s.bin.filter(f => f.id !== last.file.id);
                        const restored = Object.assign({}, last.file, { state: 'is-new' });
                        s.files.splice(Math.min(last.index, s.files.length), 0, restored);
                        s.selectedId = restored.id;
                    } else if (last && last.type === 'paste') {
                        s.files = s.files.filter(f => f.id !== last.id);
                        const origin = s.history.find(h => h.type === 'cut-origin');
                        if (origin) {
                            s.folder = origin.folder;
                            s.files = origin.files.map(f => Object.assign({}, f, { state: f.state === 'is-cut' ? 'is-new' : '' }));
                        }
                    } else if (last && last.type === 'rename') {
                        const f = s.files.find(x => x.id === last.id);
                        if (f) {
                            f.name = last.old;
                            f.state = 'is-new';
                        }
                    }
                    break;
                }
            }
            this.renderScene(true);
        }

        // ---------- Kihívások ----------
        nextChallenge() {
            this.clearTimer();
            this.index++;
            if (this.index >= this.challenges.length) {
                this.endRound();
                return;
            }
            this.current = this.challenges[this.index];
            this.stepIndex = 0;
            this.locked = false;
            this.setupScene(this.current);
            this.renderChallenge();
            this.shell.setProgress('🥷 ' + (this.index + 1) + ' / ' + this.challenges.length);
            const step = NINJA_ACTIONS[this.current.steps[0]];
            if (this.cfg.help === 'biti') {
                say(this.current.title + ' Súgó: ' + step.tip, 'happy');
            }
            const seconds = this.cfg.sequences ? this.current.steps.length * this.cfg.stepTime + 2 : this.cfg.timer;
            if (seconds) this.startTimer(seconds);
        }

        renderChallenge() {
            const c = this.current;
            const step = NINJA_ACTIONS[c.steps[this.stepIndex]];
            let help = '';
            if (this.cfg.help === 'biti' || this.cfg.help === 'card') {
                help = '<div class="fkg3-help">Súgó: ' + step.keys.map(k => '<span class="fkg3-kbd">' + k + '</span>').join(' + ') + ' <span>(' + escapeHtml(step.label) + ')</span></div>';
            }
            let seq = '';
            if (c.steps.length > 1) {
                seq = '<div class="fkg3-seq">' + c.steps.map((s, i) =>
                    '<span class="' + (i < this.stepIndex ? 'is-done' : i === this.stepIndex ? 'is-now' : '') + '">' + (i + 1) + '. ' +
                    (this.level >= 5 && i >= this.stepIndex ? '???' : NINJA_ACTIONS[s].label) + '</span>'
                ).join('') + '</div>';
            }
            this.challengeEl.innerHTML =
                '<div class="fkg3-step">' + (c.steps.length > 1 ? 'Összetett feladat · ' + (this.stepIndex + 1) + '. lépés' : 'Kihívás') + '</div>' +
                '<div class="fkg3-prompt">' + escapeHtml(c.title) + '</div>' +
                help + seq +
                '<div class="fkg3-timebar" data-timebar style="display:none"><i></i></div>';
        }

        startTimer(seconds) {
            this.clearTimer();
            const bar = this.challengeEl.querySelector('[data-timebar]');
            const fill = bar.querySelector('i');
            bar.style.display = '';
            const total = seconds * 1000;
            const start = performance.now();
            let pausedAt = null;
            let pausedTotal = 0;
            const loop = now => {
                if (!this.shell.alive || this.timer === null) return;
                const frozen = !isWindowActive(this.shell.root) || this.locked;
                if (frozen) {
                    if (pausedAt === null) pausedAt = now;
                } else if (pausedAt !== null) {
                    pausedTotal += now - pausedAt;
                    pausedAt = null;
                }
                const elapsed = (pausedAt !== null ? pausedAt : now) - start - pausedTotal;
                const left = Math.max(0, total - elapsed);
                fill.style.transform = 'scaleX(' + (left / total) + ')';
                this.shell.setTimer(left / 1000);
                if (left <= 0) {
                    this.timer = null;
                    this.shell.setTimer(null);
                    this.timeout();
                    return;
                }
                this.timer = requestAnimationFrame(loop);
            };
            this.timer = requestAnimationFrame(loop);
        }

        clearTimer() {
            if (this.timer !== null) cancelAnimationFrame(this.timer);
            this.timer = null;
            this.shell.setTimer(null);
        }

        timeout() {
            const step = NINJA_ACTIONS[this.current.steps[this.stepIndex]];
            this.errors++;
            this.shell.setErrors(this.errors);
            this.shell.feedback('⏰ Lejárt az idő!', 'bad');
            this.ctx.error('Lejárt az idő! A megoldás: ' + step.tip);
            this.locked = true;
            setTimeout(() => {
                if (this.shell.alive) this.nextChallenge();
            }, 1400);
        }

        // ---------- Bevitel: fizikai billentyűzet és dokkoló ----------
        handleKeyDown(ev) {
            if (!isWindowActive(this.shell.root)) return;
            if (ev.key === 'Control' || ev.key === 'Meta') {
                if (!this.physicalCtrl) {
                    this.physicalCtrl = true;
                    this.renderDock();
                }
                return;
            }
            const target = ev.target;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
            const ctrl = ev.ctrlKey || ev.metaKey;
            const key = ev.key.length === 1 ? ev.key.toUpperCase() : ev.key;
            let combo = null;
            if (key === 'F2') combo = 'F2';
            else if (key === 'Delete' || key === 'Del' || key === 'Backspace') combo = 'Delete';
            else if (['C', 'X', 'V', 'Z'].includes(key)) combo = ctrl ? 'Ctrl+' + key : key;
            if (!combo) return;
            ev.preventDefault();
            ev.stopPropagation();
            this.flashDockKey(combo);
            this.input(combo, 'keyboard');
        }

        handleKeyUp(ev) {
            if ((ev.key === 'Control' || ev.key === 'Meta') && this.physicalCtrl) {
                this.physicalCtrl = false;
                this.renderDock();
            }
        }

        pressDock(k, btn) {
            btn.classList.add('is-pressed');
            setTimeout(() => btn.classList.remove('is-pressed'), 120);
            if (k === 'ctrl') {
                this.dockCtrl = !this.dockCtrl;
                this.renderDock();
                return;
            }
            if (k === 'delete') return this.input('Delete', 'dock');
            if (k === 'f2') return this.input('F2', 'dock');
            const letter = k.toUpperCase();
            const withCtrl = this.dockCtrl;
            // A dokkoló Ctrl gombja „ragadós”: egy betű után magától kikapcsol, mint a Windows Ragadós billentyűi
            if (this.dockCtrl) {
                this.dockCtrl = false;
                this.renderDock();
            }
            this.input(withCtrl ? 'Ctrl+' + letter : letter, 'dock');
        }

        flashDockKey(combo) {
            const map = { 'Delete': 'delete', 'F2': 'f2' };
            const k = map[combo] || combo.slice(-1).toLowerCase();
            const btn = this.dockEl && this.dockEl.querySelector('[data-k="' + k + '"]');
            if (btn) {
                btn.classList.add('is-pressed');
                setTimeout(() => btn.classList.remove('is-pressed'), 120);
            }
        }

        renderDock() {
            if (!this.dockEl) return;
            const btn = this.dockEl.querySelector('[data-k="ctrl"]');
            const on = this.dockCtrl || this.physicalCtrl;
            btn.classList.toggle('is-on', on);
            btn.setAttribute('aria-pressed', String(this.dockCtrl));
        }

        input(combo, source) {
            if (this.locked || !this.current) return;
            const expected = NINJA_ACTIONS[this.current.steps[this.stepIndex]];
            if (combo.length === 1) {
                // Ctrl nélküli betű
                const msg = source === 'dock'
                    ? 'A(z) „' + combo + '” önmagában csak egy betű! Kapcsold be előbb a Ctrl gombot a dokkolón! 😉'
                    : 'A(z) „' + combo + '” önmagában csak egy betű! Tartsd lenyomva a Ctrl billentyűt is! 😉';
                if (this.cfg.strictCtrl) {
                    this.wrong(msg + ' (' + expected.tip + ')');
                } else {
                    this.shell.feedback('Ctrl nélkül ez csak egy betű!', 'info');
                    say(msg, 'think');
                }
                return;
            }
            if (combo === expected.combo) {
                this.right(combo);
            } else {
                const pressed = Object.keys(NINJA_ACTIONS).find(k => NINJA_ACTIONS[k].combo === combo);
                const pressedLabel = pressed ? NINJA_ACTIONS[pressed].label : combo;
                this.wrong('A(z) ' + combo + ' a(z) „' + pressedLabel + '” parancs. Most ez kell: ' + expected.label + '. ' + (this.level <= 3 ? expected.tip : 'Gondold végig, melyik betű illik hozzá!'));
            }
        }

        right(combo) {
            const action = this.current.steps[this.stepIndex];
            this.applyAction(action);
            this.stepIndex++;
            if (this.stepIndex >= this.current.steps.length) {
                this.done++;
                this.locked = true;
                this.clearTimer();
                this.shell.feedback(pick(['🥷 Nindzsa-mozdulat!', '⚡ Villámgyors!', '✔ Pontos!', '🎯 Telitalálat!']) + ' (' + combo + ')', 'ok');
                setTimeout(() => {
                    if (this.shell.alive) this.nextChallenge();
                }, 1100);
            } else {
                this.shell.feedback('✔ ' + combo + ' – jöhet a következő lépés!', 'ok');
                this.renderChallenge();
                const bar = this.challengeEl.querySelector('[data-timebar]');
                if (bar && this.timer !== null) bar.style.display = '';
            }
        }

        wrong(hint) {
            this.errors++;
            this.shell.setErrors(this.errors);
            this.shell.feedback('✖ Nem ez a parancs!', 'bad');
            const sel = this.filesEl.querySelector('.is-selected') || this.filesEl.querySelector('.fkg3-tile');
            if (sel) {
                sel.classList.remove('is-wrong');
                void sel.offsetWidth;
                sel.classList.add('is-wrong');
            }
            this.ctx.error(hint);
        }

        hint() {
            if (!this.current) return null;
            const step = NINJA_ACTIONS[this.current.steps[this.stepIndex]];
            return step ? step.tip : null;
        }

        endRound() {
            this.clearTimer();
            this.locked = true;
            const success = this.errors <= Math.floor(this.challenges.length / 2) + (this.cfg.sequences ? 1 : 0);
            finishRound(this.ctx, this.shell, {
                success,
                errors: this.errors,
                lines: [
                    '🥷 Teljesített kihívások: ' + this.done + ' / ' + this.challenges.length,
                    '❌ Hibák: ' + this.errors
                ],
                onNext: () => this.startRound()
            });
        }

        destroy() {
            this.shell.alive = false;
            this.clearTimer();
            document.removeEventListener('keydown', this.onKeyDown, true);
            document.removeEventListener('keyup', this.onKeyUp, true);
        }
    }

    // ======================================================================
    // REGISZTRÁCIÓ A CORE.JS-BEN
    // ======================================================================
    function makeGame(def, SessionClass) {
        let session = null;
        return Object.assign({}, def, {
            mount(container, ctx) {
                if (session) session.destroy();
                session = new SessionClass(container, ctx);
            },
            unmount() {
                if (session) session.destroy();
                session = null;
            },
            getHint() {
                return session && typeof session.hint === 'function' ? session.hint() : null;
            }
        });
    }

    // A közös játékkeretet a games_2.js (4–6. játék) is használja
    FK.GameKit = {
        escapeHtml, shuffle, pick, sample, normalizeName, starsHtml, fileIconHtml, say, isWindowActive,
        injectStyles, createShell, finishRound, makeGame
    };

    function register() {
        if (typeof FK.registerGame !== 'function') {
            console.warn('Fájl-Kaland: a games_1.js-hez a core.js szükséges.');
            return;
        }
        FK.registerGame(makeGame({
            id: 1,
            name: 'Kiterjesztés-párosító',
            icon: '🔍',
            color: '#3b82f6',
            description: 'Micsoda ez a fájl? Juttasd a futószalagon érkező fájlokat a megfelelő feldolgozó állomásra a kiterjesztésük alapján!'
        }, ExtensionMatcher));

        FK.registerGame(makeGame({
            id: 2,
            name: 'Útvonal-labirintus',
            icon: '🧭',
            color: '#10b981',
            description: 'Igazodj el a mappák útvesztőjében! Keresd meg a kincset az elérési út alapján, vagy hozd létre a hiányzó mappát a jó helyen.'
        }, PathMaze));

        FK.registerGame(makeGame({
            id: 3,
            name: 'Billentyűparancs-nindzsa',
            icon: '🥷',
            color: '#8b5cf6',
            description: 'Légy villámgyors! Másolás, kivágás, beillesztés, átnevezés, törlés és visszavonás – csak gyorsbillentyűkkel!'
        }, ShortcutNinja));
    }

    register();
})();
