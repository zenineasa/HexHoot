/* Copyright (c) 2022-2023 Zenin Easa Panthakkalakath */

/**
 * This file contains the utility functions shared by different tests.
 */

const utils = [];

/**
* A function that makes sure that a DIV named 'container' is available for
* the layout to render it's contents into.
*/
utils.setFixtureWithContainerDOMElemenent = function() {
    const div = document.createElement('div');
    div.id = 'container';
    document.getElementById('qunit-fixture').innerHTML = div.outerHTML;
};

/**
 * A function that returns filename from the path
 * @param {string} path the path of the file
 * @return {string} the filename
 */
utils.getFileNameFromPath = function(path) {
    return path.replace(/^.*[\\\/]/, '');
};

module.exports = utils;
