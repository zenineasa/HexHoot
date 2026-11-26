/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

import {getPath} from '../ImagePack/index.mjs';
import {html, loadStyle} from '../Html/index.mjs';
import socialLinks from './links.json' with {type: 'json'};

// The main process opens only these links in the browser; see Main/index.js
const {links} = socialLinks;

/**
 * This class renders the icons that link to our social media pages
 */
export default class Social {
    /**
     * Render the icons
     */
    static async render() {
        await loadStyle(new URL('./style.css', import.meta.url));
        const elem = document.createElement('div');
        elem.innerHTML = html`<div id="social">${links.map(([image, url]) =>
            html`<img src="${getPath(image)}" data-href="${url}"
                class="${image === 'social.github' ? 'invert' : ''}" />`)}
        </div>`;
        document.body.appendChild(elem);

        for (const icon of elem.getElementsByTagName('img')) {
            // Main opens allowed https links in the system browser
            icon.onclick = () => window.open(icon.dataset.href);
        }
    }
}
