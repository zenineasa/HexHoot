/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

const requireText = require('require-text');
const shell = require('electron').shell;

// The following is used by the template
// eslint-disable-next-line no-unused-vars
const imagePack = require('../ImagePack');

/**
 * This class helps in rendering the icons that link to our social media pages
 */
class Social {
    /**
     * This function returns a DOM element containing the logo
     */
    static render() {
        // Link css
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = __dirname + '/style.css';
        document.body.appendChild(link);

        // Ensure that the CSS is loaded before the HTML is
        link.addEventListener('load', function() {
            const elem = document.createElement('div');
            elem.innerHTML =
                eval('`' + requireText('./template.html', require) + '`');
            document.body.appendChild(elem);

            const icons = elem.getElementsByTagName('img');
            for (let i = 0; i < icons.length; i++) {
                icons[i].onclick = function() {
                    shell.openExternal(this.getAttribute('href'));
                };
            }
        });
    }
}

module.exports = Social;
