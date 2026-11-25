/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

const fs = require('fs');
const path = require('path');

/**
 * Read a UTF-8 text file. Replaces the unmaintained 'require-text' package.
 * @param {string} baseDir directory that relative paths are resolved
 * against; pass __dirname
 * @param {string} file relative or absolute path to the file
 * @return {string} the file content
 */
module.exports = function readText(baseDir, file) {
    return fs.readFileSync(path.resolve(baseDir, file), 'utf8');
};
