/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// An accessibility audit of what the window shows right now, run inside the
// page (docs/design/ui-hive.md, "Accessibility"). It reports:
// - contrast: visible text (and placeholders and icons) whose colour, over
//   the background actually behind it, is below WCAG AA: 4.5:1 for text,
//   3:1 for large text (24px, or 18.66px bold) and for icons;
// - unnamed: controls a screen reader would announce without a name.
// While a modal dialog is open, only the dialog is checked: the rest is
// inert. Disabled controls are exempt from contrast, as WCAG allows.
// Running animations are waited for first.

const AUDIT = String.raw`(async () => {
    // Measure the end state, not a panel halfway through sliding in
    await Promise.all(document.getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})));
    const parse = (value) => {
        const m = value.match(/rgba?\(([^)]+)\)/);
        if (!m) {
            return null;
        }
        const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean)
            .map(Number);
        return {r, g, b, a};
    };
    const over = (top, bottom) => ({
        r: top.r * top.a + bottom.r * (1 - top.a),
        g: top.g * top.a + bottom.g * (1 - top.a),
        b: top.b * top.a + bottom.b * (1 - top.a),
        a: 1,
    });
    const luminance = ({r, g, b}) => {
        const lin = (c) => {
            c /= 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (a, b) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
    };
    const hex = ({r, g, b}) => '#' + [r, g, b].map((c) =>
        Math.round(c).toString(16).padStart(2, '0')).join('');
    const describe = (el) => {
        let s = el.tagName.toLowerCase();
        if (el.id) {
            s += '#' + el.id;
        }
        const cls = [...el.classList].slice(0, 3).join('.');
        if (cls) {
            s += '.' + cls;
        }
        const name = el.getAttribute('name');
        if (name) {
            s += '[name=' + name + ']';
        }
        return s;
    };
    const path = (el) => {
        const parts = [];
        for (let e = el; e && e !== document.body && parts.length < 4;
            e = e.parentElement) {
            parts.unshift(describe(e));
        }
        return parts.join(' > ');
    };
    const visible = (el) => {
        if (!el.getClientRects().length) {
            return false;
        }
        for (let e = el; e; e = e.parentElement) {
            const s = getComputedStyle(e);
            if (s.visibility === 'hidden' || s.display === 'none' ||
                Number(s.opacity) === 0 || e.classList.contains('sr-only')) {
                return false;
            }
        }
        return true;
    };
    // The colour behind an element: its own background and its ancestors',
    // composited, down to the page. null if an image is in the way.
    const backgroundOf = (el) => {
        const layers = [];
        for (let e = el; e; e = e.parentElement) {
            const s = getComputedStyle(e);
            if (s.backgroundImage !== 'none') {
                return null;
            }
            const c = parse(s.backgroundColor);
            if (c && c.a > 0) {
                layers.push(c);
                if (c.a >= 1) {
                    break;
                }
            }
        }
        let bg = {r: 255, g: 255, b: 255, a: 1};
        for (const layer of layers.reverse()) {
            bg = over(layer, bg);
        }
        return bg;
    };
    const opacityOf = (el) => {
        let o = 1;
        for (let e = el; e; e = e.parentElement) {
            o *= Number(getComputedStyle(e).opacity);
        }
        return o;
    };
    const modal = [...document.querySelectorAll('dialog[open]')]
        .find((d) => d.matches(':modal'));
    const root = modal || document.body;
    const contrast = [];
    const seen = new Set();
    let checked = 0;
    const check = (el, colour, kind, large) => {
        const bg = backgroundOf(el);
        if (!bg || !colour) {
            return;
        }
        checked++;
        const fg = over({...colour, a: colour.a * opacityOf(el)}, bg);
        const r = ratio(fg, bg);
        const need = large ? 3 : 4.5;
        const key = kind + path(el) + hex(fg) + hex(bg);
        if (r < need && !seen.has(key)) {
            seen.add(key);
            contrast.push({element: path(el), kind, ratio: +r.toFixed(2),
                need, fg: hex(fg), bg: hex(bg),
                text: (el.textContent || el.placeholder || '').trim()
                    .slice(0, 40)});
        }
    };
    const disabled = (el) => Boolean(el.closest(
        ':disabled, [aria-disabled=true]'));
    for (const el of root.querySelectorAll('*')) {
        if (el.closest('svg') && el.tagName !== 'svg' || !visible(el) ||
            disabled(el)) {
            continue;
        }
        const s = getComputedStyle(el);
        const size = parseFloat(s.fontSize);
        const large = size >= 24 ||
            size >= 18.66 && Number(s.fontWeight) >= 700;
        const ownText = [...el.childNodes].some((n) =>
            n.nodeType === Node.TEXT_NODE && n.textContent.trim());
        if (ownText) {
            check(el, parse(s.color), 'text', large);
        }
        if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') &&
            el.placeholder && !el.value) {
            check(el, parse(getComputedStyle(el, '::placeholder').color),
                'placeholder', large);
        }
        if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') &&
            el.value) {
            check(el, parse(s.color), 'text', large);
        }
        if (el.tagName === 'svg') {
            // Icons paint their shapes, with a stroke or a fill
            const shape = el.querySelector('path, circle, rect, polygon, line');
            const ss = shape && getComputedStyle(shape);
            const paint = ss && (ss.stroke !== 'none' ? ss.stroke : ss.fill);
            check(el, parse(paint || '') || parse(s.color), 'icon', true);
        }
    }

    // Accessible names, roughly as the accessibility tree computes them
    const nameOf = (el) => {
        const labelledby = el.getAttribute('aria-labelledby');
        if (labelledby) {
            return labelledby.split(/\s+/).map((id) =>
                document.getElementById(id)?.textContent || '').join(' ')
                .trim();
        }
        if (el.getAttribute('aria-label')?.trim()) {
            return el.getAttribute('aria-label').trim();
        }
        // A dialog is named by its label only, never by all its text
        if (el.tagName === 'DIALOG' || el.getAttribute('role') === 'dialog') {
            return '';
        }
        if (el.labels?.length) {
            return [...el.labels].map((l) => l.textContent).join(' ').trim();
        }
        const text = el.tagName === 'SELECT' || el.tagName === 'INPUT' ||
            el.tagName === 'TEXTAREA' ? '' : el.textContent.trim();
        return text || el.getAttribute('title')?.trim() ||
            el.getAttribute('alt')?.trim() || el.placeholder?.trim() || '';
    };
    const unnamed = [];
    const controls = root.querySelectorAll('button, a[href], input, select, ' +
        'textarea, [role=button], [role=img], [role=dialog], dialog, ' +
        '[tabindex]:not([tabindex="-1"]), img');
    for (const el of controls) {
        if (el.type === 'hidden' || el.closest('[aria-hidden=true]') ||
            !visible(el) && el.tagName !== 'DIALOG') {
            continue;
        }
        if (el.tagName === 'IMG' && el.getAttribute('alt') === '') {
            continue;
        }
        if (!nameOf(el)) {
            unnamed.push(path(el));
        }
    }
    return {contrast, unnamed, checked};
})()`;

/**
 * Audit what the window shows now
 * @param {Object} app a launched app (driver.mjs)
 * @return {Promise<{contrast: Object[], unnamed: string[], checked: number}>}
 *     what fails, and how many colours were checked
 */
export function audit(app) {
    return app.evaluate(AUDIT);
}

/**
 * Audit in both themes, then go back to the theme that was set
 * @param {Object} app a launched app
 * @param {string} where a name for the screen, used in failures
 * @return {Promise<Object[]>} the failures, each with the theme and screen
 */
export async function auditBothThemes(app, where) {
    const was = await app.evaluate('document.documentElement.dataset.theme');
    const failures = [];
    for (const theme of ['night', 'day']) {
        await app.evaluate(
            `document.documentElement.dataset.theme = '${theme}'`);
        const {contrast, unnamed, checked} = await audit(app);
        if (!checked) {
            failures.push({where, theme, kind: 'nothing was checked'});
        }
        for (const c of contrast) {
            failures.push({where, theme, ...c});
        }
        for (const element of unnamed) {
            failures.push({where, theme, kind: 'no name', element});
        }
    }
    await app.evaluate(`document.documentElement.dataset.theme = '${was}'`);
    return failures;
}
