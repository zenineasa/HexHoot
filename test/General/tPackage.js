/* Copyright (c) 2023 Zenin Easa Panthakkalakath */

const path = require('path');
const requireText = require('require-text');

QUnit.test('Check package name', function(assert) {
    const packageJson = JSON.parse(
        requireText(path.resolve() + '/package.json', require),
    );

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
    const apiURL = 'https://api.github.com/repos/'
        + githubRepo + '/releases/latest';

    // Fetch inofmration using GitHub API
    const response = await fetch(apiURL);
    const data = await response.json();

    // The version names in package.json and latest GitHub release
    const packageVersion = packageJson.version.match(/\d+/g);
    const githubVersion = data.tag_name.match(/\d+/g);

    // Ensure that the number of numbers in both the version values are equal
    assert.ok(packageVersion.length == githubVersion.length);

    // Ensure that the version of the package is greater than the latest
    // release on GitHub.
    // NOTE: We are comparing with a release; not the repository.
    var allGoodFlag = false;
    for (var i = 0; i < packageVersion.length; i++) {
        if (packageVersion[i] > githubVersion[i]) {
            allGoodFlag = true;
            break;
        } else if (packageVersion[i] < githubVersion[i]) {
            break;
        }
    }
    assert.ok(allGoodFlag);
});
