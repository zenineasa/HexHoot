/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

import requireText = require('require-text');
import { shell } from 'electron';

// The following is used by the template
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as imagePack from '../ImagePack';

/**
 * This class helps in rendering the icons that link to our social media pages
 */
export default class Social {
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
        link.addEventListener('load', () => {
            const elem = document.createElement('div');
            const imagePack = require('../ImagePack');
            elem.innerHTML =
                eval('`' + requireText('./template.html', require) + '`');
            document.body.appendChild(elem);

            const icons = elem.getElementsByTagName('img');
            for (let i = 0; i < icons.length; i++) {
                icons[i].onclick = function(this: HTMLElement) {
                    const href = this.getAttribute('href');
                    if(href) shell.openExternal(href);
                };
            }
        });
    }
}
