/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

import requireText = require('require-text');

// This is invoked from within template.html file
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import Logo from '../Logo';

/**
 * This class implements a skeleton UI that is used by most modules
 */
export default class Layout {
    /**
     * This function renders the template into the UI.
     */
    static async render() {
        console.log('Layout.render called');
        // Link css
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = __dirname + '/style.css';

        await new Promise<void>((resolve, _reject) => {
            document.body.appendChild(link);

            // Ensure that the CSS is loaded before the HTML is
            const linkOnLoadCallback = function() {
                // This should be invoked only once
                link.removeEventListener('load', linkOnLoadCallback);

                const container = document.getElementById('container');

                // To ensure that innerHTML has changed before resolving
                const observer = new MutationObserver(
                    function(_mutationsList, _observer) {
                        if (container && container.hasChildNodes()) {
                            resolve();
                        }
                    }
                );
                if (container) {
                    observer.observe(container, {
                        characterData: false, childList: true, attributes: false
                    });

                    // Load the HTML template and insert it to the UI
                    container.innerHTML = Layout.loadTemplate('./template.html');
                } else {
                  console.error("Container not found");
                  resolve(); // Or reject
                }
            };
            link.addEventListener('load', linkOnLoadCallback);
        });
    }

    /**
     * Load template.html file and use template literals to assign all the
     * variable values
     * @param {string} filename name of the HTML file
     * @return {string} template string
     */
    static loadTemplate(filename: string) {
        // Use Javascript's Template literals (Template strings) for easily
        // evaluating variables in the template.html file
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const Logo = require('../Logo').default;
        return eval('`' + requireText(filename, require) + '`');
    }
}
