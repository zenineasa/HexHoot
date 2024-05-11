/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

/**
 * This file contains the utility functions shared by different tests.
 */

const utils = [];

/**
* A function that makes sure that a DIV named 'container' is available for
* the layout to render it's contents into.
*/
utils.setFixtureWithContainerDOMElemenent = async function() {
    const fixture = document.getElementById('qunit-fixture');

    // Ensure that all children are removed
    while (fixture.firstChild) {
        fixture.removeChild(fixture.firstChild);
    }

    await new Promise(function(resolve, _reject) {
        // To ensure that innerHTML has changed before resolving
        const observer = new MutationObserver(
            function(_mutationsList, _observer) {
                resolve();
            }
        );
        observer.observe(fixture, {
            characterData: false, childList: true, attributes: false
        });

        const div = document.createElement('div');
        div.id = 'container';
        fixture.innerHTML = div.outerHTML;
    });
};

/**
 * A function that returns filename from the path
 * @param {string} path the path of the file
 * @return {string} the filename
 */
utils.getFileNameFromPath = function(path) {
    return path.replace(/^.*[\\\/]/, '');
};

/**
 * A function that enables retrying a test if it failed the first time.
 * @param {function} callback a test with assertions
 * @param {function} assert the real assert function handle from QUnit
 * @param {Number} numTries the number of tries to attempt again
 * @param {Number} interval time interval to wait for before the next attempt
 */
utils.waitAndTryAgain = async function(
    callback, assert, numTries=3, interval=200
) {
    // NOTE: Implement other methods in assert as required
    var argAssert = {
        'strictEqual': function(actual, expected, message="") {
            if (actual !== expected) {
                throw new Error('Assertion failed: ' + message);
            }
            assert.equal(actual, expected, message);
        },
        'notEqual': function(actual, expected, message="") {
            if (actual === expected) {
                throw new Error('Assertion failed: ' + message);
            }
            assert.notEqual(actual, expected, message);
        },
        'true': function(isTrue, message="") {
            if (!isTrue) {
                throw new Error('Assertion failed: ' + message);
            }
            assert.true(isTrue, message);
        },
        'ok': function(isOkay, message="") {
            if (!isOkay) {
                throw new Error('Assertion failed: ' + message);
            }
            assert.ok(isOkay, message);
        } // TODO: What is the difference between 'ok' and 'true'?
    };

    if (numTries <= 0) {
        argAssert = assert;
    }

    try {
        await callback(argAssert);
        return; // Resolve the promise if the callback succeeds
    } catch (error) {
        if(numTries === 0) {
            assert.ok(false, error.message); // Fail the test
            throw error; // Reject the promise
        } else {
            // Wait for the interval
            await new Promise(resolve => setTimeout(resolve, interval));
            // Retry the callback
            await utils.waitAndTryAgain(callback, assert, numTries - 1, interval);
        }
    }
};

module.exports = utils;
