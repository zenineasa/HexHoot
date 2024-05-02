/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

const path = require('path');
const glob = require('glob');
const requireText = require('require-text');
const regex = require('copyright-regex');

QUnit.test('Check code files for copyright message', async function(assert) {
    // All files to ignore in the following checks
    const options = {
        ignore: [
            'out/**/*',
            'node_modules/**/*',
            'package-lock.json',
        ],
    };

    const files = await glob.glob('**/*.+(html|js|json)', options);
    assert.ok(files.length > 1);
    for (let i = 0; i < files.length; i++) {
        const fileContent =
            requireText(path.join('./../../../', files[i]), require);
        const matches = fileContent.match(regex());
        assert.ok(matches[5].trim() == 'Zenin Easa Panthakkalakath',
            'Copyright message not found in: ' + files[i],
        );
    }
});
