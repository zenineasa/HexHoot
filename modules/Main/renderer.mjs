/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

// Entry point of the renderer. It runs sandboxed, with no Node.js; Core is
// reached through window.hexhoot, which preload.js provides.

import i18n from '../I18n/index.mjs';
import Social from '../Social/index.mjs';
import Copyright from '../Copyright/index.mjs';
import Login from '../Login/index.mjs';
import Chat from '../Chat/index.mjs';
import PasswordCheck from '../PasswordCheck/index.mjs';

/**
 * Render the app for the current state (logged in or not)
 */
async function render() {
    await i18n.render();
    const login = new Login();
    if (await login.isLoggedIn()) {
        await new Chat().render();
        // Not awaited: the check never holds up the app
        PasswordCheck.render().catch(() => {});
    } else {
        PasswordCheck.remove();
        await login.render();
    }
}

// Renders must not overlap, so they are queued.
let queue = Promise.resolve();
window.reload = function() {
    const result = queue.then(render);
    queue = result.then(function() {}, function(err) {
        console.error('Render failed:', err);
    });
    return result;
};

await i18n.selectLanguageFromPreferences();
window.reload();
Social.render();
Copyright.render();
// A check can fall due while the app stays open
setInterval(async () => {
    if (await new Login().isLoggedIn()) {
        PasswordCheck.render().catch(() => {});
    }
}, 3600 * 1000);
