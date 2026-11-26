/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

// URLs of the images, for the renderer.

import map from './map.json' with {type: 'json'};

/**
 * @param {string} hierarchy for example 'interface.sendButton'
 * @return {string} the image URL
 */
export function getPath(hierarchy) {
    const value = hierarchy.split('.').reduce(
        (node, name) => (node && Object.hasOwn(node, name)) ?
            node[name] : undefined, map);
    if (typeof value !== 'string') {
        throw new Error('Unknown image: ' + hierarchy);
    }
    return new URL('./images/' + value, import.meta.url).href;
}

export default {getPath};
