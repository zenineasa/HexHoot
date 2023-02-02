/* Copyright (c) 2022-2023 Zenin Easa Panthakkalakath */

const requireText = require('require-text');

// This is invoked from within template.html file
const Logo = require('./../Logo'); // eslint-disable-line no-unused-vars

/**
 * This class implements a skeleton UI that is used by most modules
 */
class Layout {
    /**
     * This function renders the template into the UI.
     */
    static render() {
        // Link css
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = __dirname + '/style.css';
        document.body.appendChild(link);

        // Load the HTML template and insert it to the UI
        document.getElementById('container').innerHTML =
            Layout.loadTemplate('./template.html');
    }

    /**
     * Load template.html file and use template literals to assign all the
     * variable values
     * @param {string} filename name of the HTML file
     * @return {string} template string
     */
    static loadTemplate(filename) {
        // Use Javascript's Template literals (Template strings) for easily
        // evaluating variables in the template.html file
        return eval('`' + requireText(filename, require) + '`');
    }
}

module.exports = Layout;
