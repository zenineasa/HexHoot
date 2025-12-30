/* Copyright (c) 2022-2025 Zenin Easa Panthakkalakath */

import requireText = require('require-text');

/**
 * This class adds copyright message to the UI. This is one of the simplest
 * modules that we have, and hence, could be treated as a "Hello World!"
 * module.
 */
export default class Copyright {
    /**
     * This function renders the template into the UI.
     */
    static render() {
        // Link css
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = __dirname + '/style.css';
        document.body.appendChild(link);

        // Ensure that the CSS is loaded before the HTML is
        link.addEventListener('load', () => {
            const elem = document.createElement('div');
            elem.innerHTML = requireText('./template.html', require);
            document.body.appendChild(elem);
        });
    }
}
