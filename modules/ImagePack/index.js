/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

// File paths of the images, for the main process and the build. The renderer
// uses index.mjs, which gives URLs.

const path = require('path');
const map = require('./map.json');

/**
 * Look up an image by its place in map.json
 * @param {string} hierarchy for example 'branding.favicon'
 * @return {string} the image file, relative to the images directory
 */
function lookup(hierarchy) {
    const value = hierarchy.split('.').reduce(
        (node, name) => (node && Object.hasOwn(node, name)) ?
            node[name] : undefined, map);
    if (typeof value !== 'string') {
        throw new Error('Unknown image: ' + hierarchy);
    }
    return value;
}

module.exports = {
    lookup,
    /**
     * @param {string} hierarchy for example 'branding.favicon'
     * @return {string} absolute path of the image
     */
    getPath(hierarchy) {
        return path.join(__dirname, 'images', lookup(hierarchy));
    },
};
