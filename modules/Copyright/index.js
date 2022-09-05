/* Copyright (c) 2022 Zenin Easa Panthakkalakath */

const requireText = require('require-text');

/**
 * This class adds copyright message to the UI. This is one of the simplest
 * modules that we have, and hence, could be treated as a "Hello World!"
 * module.
 */
class Copyright {
    /**
     * This function renders the template into the UI.
     */
    static render() {
        // Link css
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = __dirname + '/style.css';
        document.body.appendChild(link);

        // Create and append a DIV with the message
        const elem = document.createElement('div');
        elem.innerHTML = requireText('./template.html', require);
        document.body.appendChild(elem);
    }
}

module.exports = Copyright;
