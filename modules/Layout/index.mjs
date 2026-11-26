/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

import Logo from '../Logo/index.mjs';
import {html, loadStyle} from '../Html/index.mjs';

/**
 * This class implements a skeleton UI that is used by most modules
 */
export default class Layout {
    /**
     * Render the icon bar, the sidebar (with the logo) and the main content
     * area into #container.
     */
    static async render() {
        await Promise.all([
            loadStyle(new URL('./style.css', import.meta.url)),
            Logo.ready(),
        ]);
        document.getElementById('container').innerHTML = html`
            <div id="iconbar"></div>
            <div id="sidebar">${Logo.getHTML(true)}</div>
            <div id="mainContent"></div>`;
    }
}
