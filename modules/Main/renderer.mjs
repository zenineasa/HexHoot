/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

// Entry point of the renderer. It runs sandboxed, with no Node.js; Core is
// reached through window.hexhoot, which preload.js provides.

import i18n from '../I18n/index.mjs';
import dbMessenger from '../DBMessenger/index.mjs';
import Login from '../Login/index.mjs';
import App from '../App/index.mjs';
import {loadTheme} from '../App/theme.mjs';
import PasswordCheck from '../PasswordCheck/index.mjs';

/**
 * Render the app for the current state (signed in or not)
 */
async function render() {
    await loadTheme();
    const login = new Login();
    if (await login.isLoggedIn()) {
        await App.render();
        // Not awaited: the check never holds up the app
        PasswordCheck.render().catch(() => {});
    } else {
        PasswordCheck.remove();
        await login.render();
    }
}

// Renders must not overlap, so they are queued; requests made before the
// next render starts share it.
let queue = Promise.resolve();
let waiting = null;
window.reload = function() {
    if (waiting) {
        return waiting;
    }
    const result = waiting = queue.then(() => {
        waiting = null;
        return render();
    });
    queue = result.then(function() {}, function(err) {
        console.error('Render failed:', err);
    });
    return result;
};

// Removing the account (Settings) or restoring elsewhere changes the state
dbMessenger.on('account', () => window.reload());

// Main reloads the window this way when Core had to be restarted
if (new URLSearchParams(location.search).has('restarted')) {
    history.replaceState(null, '', location.pathname);
    App.restartedAt = Date.now();
}

await i18n.selectLanguageFromPreferences();
window.reload();
// A check can fall due while the app stays open
setInterval(async () => {
    if (await new Login().isLoggedIn()) {
        PasswordCheck.render().catch(() => {});
    }
}, 3600 * 1000);
