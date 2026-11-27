/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Night, day, or follow the computer. <html data-theme> selects the palette
// in Main/style.css.

import dbMessenger from '../DBMessenger/index.mjs';

/**
 * Apply a theme preference to the window
 * @param {string} [choice] 'night', 'day' or 'system'
 */
export function applyTheme(choice) {
    const theme = choice === 'day' || choice === 'night' ? choice :
        choice === 'system' && matchMedia('(prefers-color-scheme: light)')
            .matches ? 'day' : 'night';
    document.documentElement.dataset.theme = theme;
}

/**
 * Read the theme preference and apply it
 * @return {Promise<string>} the preference
 */
export async function loadTheme() {
    const choice = (await dbMessenger.getPreference('theme'))?.value ||
        'night';
    applyTheme(choice);
    return choice;
}
