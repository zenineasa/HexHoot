/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

import I18n from '../I18n';
const i18n = new I18n();
import Social from '../Social';
import Copyright from '../Copyright';
import Login from '../Login';
import Chat from '../Chat';

declare global {
    interface Window {
        reload: () => void;
    }
}


window.addEventListener('DOMContentLoaded', function() {
    /**
     * The reload function; this was found to be not thread safe. For instance
     * if you run the following function multiple times, the rendering was
     * observed to be invoked multiple times parallely, resulting in unintended
     * behaviour. Therefore, a locking mechanism has been implemented here.
     */
    async function reload() {
        i18n.render();
        const login = new Login();
        if (await login.isLoggedIn()) {
            const chat = new Chat();
            chat.render();
        } else {
            login.render();
        }
    };
    let queue = Promise.resolve();
    window.reload = function() {
        const result = queue.then(function() {
            return reload();
        });
        queue = result.then(function() {}, function() {});
    };
    window.reload();

    Social.render();
    Copyright.render();
});
