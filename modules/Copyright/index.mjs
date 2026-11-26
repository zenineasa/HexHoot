/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

import {loadStyle} from '../Html/index.mjs';

/**
 * This class adds copyright message to the UI. This is one of the simplest
 * modules that we have, and hence, could be treated as a "Hello World!"
 * module.
 */
export default class Copyright {
    /**
     * This function renders the copyright message into the UI.
     */
    static async render() {
        await loadStyle(new URL('./style.css', import.meta.url));
        const elem = document.createElement('div');
        elem.id = 'copyright';
        elem.textContent = 'Copyright © 2021-2026 Zenin Easa ' +
            'Panthakkalakath';
        document.body.appendChild(elem);
    }
}
