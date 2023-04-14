/* Copyright (c) 2023 Zenin Easa Panthakkalakath */

const path = require('path');
const requireText = require('require-text');


/**
 * Sometimes, the fetch doesn't happen properly on GitHub CI. This function may
 * help reduce sporadic failures caused by the same.
 * @param {string} url the address to fetch from
 * @param {number} retries the maximum number of times we retry
 * @return {Object} the response from fetch
 */
function fetchJSONWithRetry(url, retries = 10) {
    return fetch(url)
        .then(function(response) {
            if (response.ok) {
                return response;
            }
            throw new Error('Network response was not ok');
        })
        .catch(function(error) {
            if (retries <= 0) {
                throw error;
            }
            return fetchJSONWithRetry(url, retries - 1);
        });
}

QUnit.test('Check package name', function(assert) {
    // Read package.json
    const packageJson = JSON.parse(
        requireText(path.resolve() + '/package.json', require),
    );

    // Ensure that the package name in package.json is always 'hexhoot'
    assert.ok(
        packageJson.name === 'hexhoot',
        'Package name should be "hexhoot"',
    );
});

QUnit.test('Version greater than in GitHub release', async function(assert) {
    // Read package.json
    const packageJson = JSON.parse(
        requireText(path.resolve() + '/package.json', require),
    );

    // Get the GitHub API URL using information from package.json
    const githubRepo = packageJson.repository.url
        .split('git+https://github.com/')[1].split('.git')[0];
    const apiURL = 'https://api.github.com/repos/' + githubRepo +
        '/releases/latest';

    // Fetch inofmration using GitHub API
    let response = [];
    try {
        response = await fetchJSONWithRetry(apiURL);
    } catch (err) {
        console.warn('No response from GitHub API');
        assert.ok(true);
        return;
    }

    const data = await response.json();

    // The version names in package.json and latest GitHub release
    const packageVersion = packageJson.version.match(/\d+/g);
    const githubVersion = data.tag_name.match(/\d+/g);

    // Ensure that the number of numbers in both the version values are equal
    assert.ok(packageVersion.length == githubVersion.length);

    // Ensure that the version of the package is greater than the latest
    // release on GitHub.
    // NOTE: We are comparing with a release; not the repository.
    let allGoodFlag = false;
    for (let i = 0; i < packageVersion.length; i++) {
        if (packageVersion[i] > githubVersion[i]) {
            allGoodFlag = true;
            break;
        } else if (packageVersion[i] < githubVersion[i]) {
            break;
        }
    }
    assert.ok(allGoodFlag);
});
